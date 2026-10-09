import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Module, NotFoundException, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { ENV, Env } from '../config';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { isStaff } from '../common/scope';
import { SettingsService } from '../common/settings.service';
import { MalwareScanner, StorageService } from '../common/storage.service';
import { pageQuery, parse, uuid } from '../common/validation';

const CATEGORIES = ['identification', 'certificate', 'licence', 'training_record', 'course_material', 'attendance', 'examination', 'instructor_qualification', 'financial', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

// What each allowed type must look like on the inside. The browser's claimed type is never trusted.
const TYPES: Record<string, { mime: string; check: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', check: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  png: { mime: 'image/png', check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: zip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: zip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: zip },
  csv: { mime: 'text/csv', check: text },
  txt: { mime: 'text/plain', check: text },
};
function zip(b: Buffer) { return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05); }
function text(b: Buffer) { return !b.subarray(0, Math.min(b.length, 8192)).includes(0); }

/** Which categories each role may upload, and for whom. */
const UPLOAD: Record<string, Category[]> = {
  super_admin: [...CATEGORIES], training_admin: CATEGORIES.filter((c) => c !== 'financial'),
  instructor: ['instructor_qualification', 'course_material', 'attendance', 'examination'],
  trainee: ['identification', 'licence', 'certificate', 'other'],
  org_admin: ['certificate', 'licence', 'training_record', 'other'],
  finance_officer: ['financial'], auditor: [],
};

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly storage: StorageService, private readonly scanner: MalwareScanner,
    private readonly settings: SettingsService, @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @Require('documents:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(pageQuery.extend({ owner_user_id: uuid.optional(), organization_id: uuid.optional(), category: z.enum(CATEGORIES).optional() }), query);
    const params: any[] = [];
    const where: string[] = [this.readScope(u, params)];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (f.owner_user_id) add('d.owner_user_id = ?', f.owner_user_id);
    if (f.organization_id) add('d.organization_id = ?', f.organization_id);
    if (f.category) add('d.category = ?', f.category);
    if (f.q) add('d.filename ilike ?', `%${f.q}%`);
    const data = await this.db.query(
      `select d.id, d.category, d.filename, d.mime_type, d.size_bytes, d.confidential, d.owner_user_id, d.organization_id, d.created_at, x.full_name as owner_name, up.full_name as uploaded_by_name
         from documents d left join users x on x.id = d.owner_user_id left join users up on up.id = d.uploaded_by
        where ${where.join(' and ')} order by d.created_at desc limit ${f.limit} offset ${f.offset}`, params);
    return { data };
  }

  @Post()
  @Require('documents:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @ActorCtx() actor: Actor) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    const d = parse(z.object({ category: z.enum(CATEGORIES), owner_user_id: uuid.optional(), organization_id: uuid.optional(), confidential: z.enum(['true', 'false']).default('true') }), body);
    if (!UPLOAD[u.role]?.includes(d.category)) throw new ForbiddenException('You cannot upload this kind of document');

    const rules = await this.settings.get<{ allowed: string[]; max_mb: number }>('file_types');
    const max = Math.min(rules.max_mb, this.env.MAX_UPLOAD_MB) * 1024 * 1024;
    if (file.size > max) throw new BadRequestException(`Files can be up to ${Math.floor(max / 1048576)} MB`);
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
    const type = TYPES[ext];
    if (!type || !rules.allowed.includes(ext)) throw new BadRequestException(`This file type is not allowed. Allowed: ${rules.allowed.join(', ')}`);
    if (!type.check(file.buffer)) throw new BadRequestException('The file content does not match its type');
    if (!(await this.scanner.clean(file.buffer))) {
      await this.audit.log(null, actor, 'document.rejected_malware', 'document', null, null, { filename: file.originalname });
      throw new BadRequestException('The file was rejected by the virus scanner');
    }

    // ownership: trainees upload for themselves; client admins only for their own people
    let ownerId = d.owner_user_id ?? null;
    let orgId = d.organization_id ?? null;
    if (u.role === 'trainee') { ownerId = u.id; orgId = u.organizationId; }
    else if (u.role === 'org_admin') {
      orgId = u.organizationId;
      if (ownerId && !(await this.db.one('select 1 from users where id = $1 and organization_id = $2', [ownerId, u.organizationId]))) throw new NotFoundException('Trainee not found');
    } else if (u.role === 'instructor' && d.category === 'instructor_qualification') ownerId = u.id;
    else if (ownerId && !isStaff(u) && u.role !== 'finance_officer') throw new ForbiddenException();

    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 150);
    const key = `${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    try {
      return await this.db.tx(async (q) => {
        const row = await q.one<any>(
          `insert into documents (category, filename, mime_type, size_bytes, sha256, storage_key, owner_user_id, organization_id, confidential, uploaded_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, category, filename, mime_type, size_bytes, created_at`,
          [d.category, safeName, type.mime, file.size, createHash('sha256').update(file.buffer).digest('hex'), key, ownerId, orgId, d.confidential === 'true', u.id]);
        await this.audit.log(q, actor, 'document.upload', 'document', row.id, null, { category: d.category, filename: safeName, owner_user_id: ownerId });
        return row;
      });
    } catch (e) { await this.storage.remove(key); throw e; }
  }

  @Get(':id/download')
  @Require('documents:read')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: any, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const params: any[] = [id];
    const doc = await this.db.one<any>(`select d.* from documents d where d.id = $1 and ${this.readScope(u, params)}`, params);
    if (!doc) throw new NotFoundException();
    const body = await this.storage.get(doc.storage_key);
    if (doc.category === 'identification' || doc.confidential) await this.audit.log(null, actor, 'document.download', 'document', id, null, { category: doc.category });
    res.set({ 'Content-Type': doc.mime_type, 'Content-Disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    return new StreamableFile(body);
  }

  @Delete(':id')
  @Require('documents:delete')
  async remove(@Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const doc = await this.db.tx(async (q) => {
      const row = await q.one<any>('delete from documents where id = $1 returning *', [id]);
      if (!row) throw new NotFoundException();
      await this.audit.log(q, actor, 'document.delete', 'document', id, { category: row.category, filename: row.filename }, null);
      return row;
    });
    await this.storage.remove(doc.storage_key);
    return { ok: true };
  }

  /** SQL condition limiting what a role may see. Appends its own parameters. */
  private readScope(u: AuthUser, params: any[]): string {
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    switch (u.role) {
      case 'super_admin': case 'auditor': return 'true';
      case 'training_admin': return `d.category <> 'financial'`;
      case 'finance_officer': return `d.category = 'financial'`;
      case 'trainee': return `d.owner_user_id = ${p(u.id)}`;
      case 'instructor': return `(d.uploaded_by = ${p(u.id)} or d.category = 'course_material')`;
      case 'org_admin': {
        const o = p(u.organizationId);
        return `(d.organization_id = ${o} or d.owner_user_id in (select id from users where organization_id = ${o})) and d.category in ('certificate','licence','training_record','other')`;
      }
      default: return 'false';
    }
  }
}

@Module({ controllers: [DocumentsController] })
export class DocumentsModule {}
