import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, Module, NotFoundException, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { memoryStorage } from 'multer';
import { ENV, Env } from '../config';
import { teachesCourse } from '../common/course-access';
import { SettingsService } from '../common/settings.service';
import { MalwareScanner, StorageService } from '../common/storage.service';
import { inspectUpload } from '../common/upload-rules';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { isStaff } from '../common/scope';
import { isoDate, pageQuery, parse, uuid, patchOf } from '../common/validation';
import { plural, removeProgramme } from '../common/cascade';

const categoryBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, 'two to five capital letters'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullish(),
});
const delivery = z.enum(['classroom', 'online', 'blended', 'practical']);
const courseBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'letters, digits and dashes'),
  title: z.string().trim().min(3).max(200),
  category_id: uuid,
  description: z.string().trim().max(5000).nullish(),
  objectives: z.string().trim().max(5000).nullish(),
  duration_hours: z.number().min(0).max(2000).default(0),
  delivery_method: delivery.default('classroom'),
  target_audience: z.string().trim().max(1000).nullish(),
  capacity: z.number().int().min(1).max(1000).default(20),
  fee: z.number().min(0).max(1e8).default(0),
  currency: z.string().length(3).toUpperCase().default('GHS'),
  pass_mark: z.number().int().min(0).max(100).default(70),
  min_attendance_pct: z.number().int().min(0).max(100).default(80),
  validity_months: z.number().int().min(1).max(240).nullish(),
  approving_body: z.string().trim().max(200).nullish(),
  approval_reference: z.string().trim().max(200).nullish(),
  approval_expiry: isoDate.nullish(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});
const listQuery = pageQuery.extend({ status: z.enum(['draft', 'active', 'archived']).optional(), category_id: uuid.optional() });
const materialBody = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(['video', 'pdf', 'presentation', 'document', 'audio', 'image', 'scorm', 'link']),
  url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Use a web address that starts with http:// or https://').nullish(),
  document_id: uuid.nullish(),
  required: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
}).refine((m) => m.url || m.document_id, { message: 'Provide a url or an uploaded document' });

@Controller()
export class CoursesController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly storage: StorageService, private readonly scanner: MalwareScanner,
    private readonly settings: SettingsService, @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------ categories

  @Get('course-categories')
  @Require('courses:read')
  categories() {
    return this.db.query('select c.*, (select count(*) from courses x where x.category_id = c.id)::int as course_count from course_categories c order by c.name');
  }

  @Post('course-categories')
  @Require('courses:write')
  async createCategory(@Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(categoryBody, body);
    return this.db.tx(async (q) => {
      const row = await q.one('insert into course_categories (code, name, description) values ($1,$2,$3) returning *', [d.code, d.name, d.description ?? null]);
      await this.audit.log(q, actor, 'course_category.create', 'course_category', row.id, null, row);
      return row;
    });
  }

  @Patch('course-categories/:id')
  @Require('courses:write')
  async updateCategory(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(patchOf(categoryBody.omit({ code: true })), body);
    return this.db.tx(async (q) => {
      const before = await q.one('select * from course_categories where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const after = await q.one('update course_categories set name = $2, description = $3 where id = $1 returning *',
        [id, d.name ?? before.name, d.description === undefined ? before.description : d.description]);
      await this.audit.log(q, actor, 'course_category.update', 'course_category', id, before, after);
      return after;
    });
  }

  /**
   * Deleting is only allowed while nothing real depends on the course. Once a programme, a certificate or an assessment
   * exists, the training record has to stay, so the answer is "archive it instead".
   */
  private async deleteCourseIn(q: Q, id: string, actor: Actor, everything = false) {
    const course = await q.one<any>('select * from courses where id = $1 for update', [id]);
    if (!course) throw new NotFoundException();
    if (everything) {
      // Super Administrator clean-up (demo data): the course's programmes, registrations and assessments go with it.
      // Certificates, finalised results and recorded payments are the official record and still block the delete.
      for (const p of await q.query<{ id: string; code: string }>('select id, code from programmes where course_id = $1', [id])) await removeProgramme(q, p);
      const certs = await q.one<{ n: number }>('select count(*)::int n from certificates where course_id = $1', [id]);
      if (certs && certs.n) throw new ConflictException(`${course.code} cannot be deleted because of ${plural(certs.n, 'certificate')}. Certificates are the official record and are never deleted. Archive the course instead.`);
      await q.query('delete from exam_attempts where assessment_id in (select id from assessments where course_id = $1)', [id]);
      await q.query('delete from assessments where course_id = $1', [id]);
    }
    const n = await q.one<{ programmes: number; certificates: number; assessments: number }>(
      `select (select count(*) from programmes where course_id = $1)::int as programmes,
              (select count(*) from certificates where course_id = $1)::int as certificates,
              (select count(*) from assessments where course_id = $1)::int as assessments`, [id]);
    const used = [n!.programmes && `${n!.programmes} programme${n!.programmes === 1 ? '' : 's'}`, n!.certificates && `${n!.certificates} certificate${n!.certificates === 1 ? '' : 's'}`, n!.assessments && `${n!.assessments} assessment${n!.assessments === 1 ? '' : 's'}`].filter(Boolean);
    if (used.length) throw new ConflictException(`${course.code} cannot be deleted because it has ${used.join(', ')}. Archive it instead so the training history is kept.`);
    // set-up that only exists to serve this course goes with it
    await q.query('delete from course_prerequisites where course_id = $1 or prerequisite_id = $1', [id]);
    await q.query('delete from compliance_requirements where course_id = $1', [id]);
    await q.query('delete from questions where course_id = $1', [id]);
    try {
      await q.query('delete from courses where id = $1', [id]);
    } catch (e: any) {
      if (e.code === '23503') throw new ConflictException(`${course.code} is still used by other records. Archive it instead.`);
      throw e;
    }
    await this.audit.log(q, actor, 'course.delete', 'course', id, course, null);
    return course;
  }

  @Delete('courses/:id')
  @Require('courses:write')
  async deleteCourse(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() query: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { with_records } = parse(z.object({ with_records: z.enum(['true']).optional() }), query);
    if (with_records && u.role !== 'super_admin') throw new ForbiddenException('Only a Super Administrator can delete a course together with its programmes and assessments.');
    const c = await this.db.tx((q) => this.deleteCourseIn(q, id, actor, !!with_records));
    return { ok: true, deleted: c.code };
  }

  @Delete('course-categories/:id')
  @Require('courses:write')
  async deleteCategory(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() query: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { with_courses } = parse(z.object({ with_courses: z.enum(['true']).optional() }), query);
    const everything = u.role === 'super_admin';
    return this.db.tx(async (q) => {
      const cat = await q.one<any>('select * from course_categories where id = $1 for update', [id]);
      if (!cat) throw new NotFoundException();
      const courses = await q.query<{ id: string; code: string }>('select id, code from courses where category_id = $1 order by code', [id]);
      if (courses.length && !with_courses) {
        throw new ConflictException(`${cat.name} still has ${courses.length} course${courses.length === 1 ? '' : 's'}. Delete them first, or delete the category together with its courses.`);
      }
      const blocked: string[] = [];
      for (const c of courses) {
        try { await q.query('savepoint c'); await this.deleteCourseIn(q, c.id, actor, everything); await q.query('release savepoint c'); }
        catch (e) { await q.query('rollback to savepoint c'); if (e instanceof ConflictException) blocked.push(c.code); else throw e; }
      }
      if (blocked.length) throw new ConflictException(`Nothing was deleted. These courses have certificates or other official records and can only be archived: ${blocked.join(', ')}.`);
      await q.query('delete from course_categories where id = $1', [id]);
      await this.audit.log(q, actor, 'course_category.delete', 'course_category', id, { ...cat, courses_deleted: courses.map((c) => c.code) }, null);
      return { ok: true, deleted: cat.code, courses_deleted: courses.length };
    });
  }

  // ------------------------------------------------------------ courses

  @Get('courses')
  @Require('courses:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(listQuery, query);
    const params: any[] = [];
    const where: string[] = [];
    // Trainees and client admins only ever see active courses.
    if (!isStaff(u) && u.role !== 'auditor') where.push(`c.status = 'active'`);
    else if (f.status) { params.push(f.status); where.push(`c.status = $${params.length}`); }
    if (f.category_id) { params.push(f.category_id); where.push(`c.category_id = $${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(c.title ilike $${params.length} or c.code ilike $${params.length})`); }
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select c.*, k.name as category_name, k.code as category_code,
              (select count(*) from programmes p where p.course_id = c.id and p.status in ('open_for_registration','ongoing')) as live_programmes
         from courses c join course_categories k on k.id = c.category_id ${w}
        order by c.title limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from courses c ${w}`, params))!.n;
    return { data, total };
  }

  @Get('courses/:id')
  @Require('courses:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const course = await this.db.one<any>(
      `select c.*, k.name as category_name, k.code as category_code from courses c join course_categories k on k.id = c.category_id where c.id = $1`, [id]);
    if (!course || (course.status !== 'active' && !isStaff(u) && u.role !== 'auditor')) throw new NotFoundException();
    const [prerequisites, instructors, modules] = await Promise.all([
      this.db.query(`select c.id, c.code, c.title from course_prerequisites p join courses c on c.id = p.prerequisite_id where p.course_id = $1 order by c.code`, [id]),
      this.db.query(`select u.id, u.full_name from course_instructors ci join users u on u.id = ci.instructor_id where ci.course_id = $1 order by u.full_name`, [id]),
      this.db.query(
        `select m.*, coalesce(json_agg(l order by l.position) filter (where l.id is not null), '[]') as materials
           from course_modules m left join learning_materials l on l.module_id = m.id
          where m.course_id = $1 group by m.id order by m.position, m.created_at`, [id]),
    ]);
    // the reading list is for people on the course: staff, auditors, instructors, and trainees confirmed on a programme of it
    let seesMaterials = isStaff(u) || u.role === 'auditor' || u.role === 'instructor';
    if (!seesMaterials && u.role === 'trainee') {
      seesMaterials = !!(await this.db.one(
        `select 1 from enrollments e join programmes p on p.id = e.programme_id where p.course_id = $1 and e.trainee_id = $2 and e.status in ('confirmed','completed') limit 1`, [id, u.id]));
    }
    const canEditMaterials = isStaff(u) || (u.role === 'instructor' && (await teachesCourse(this.db, u.id, id)));
    return { ...course, prerequisites, instructors, can_edit_materials: canEditMaterials, modules: seesMaterials ? modules : modules.map((m: any) => ({ ...m, materials: [] })) };
  }

  @Post('courses')
  @Require('courses:write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(courseBody, body);
    return this.db.tx(async (q) => {
      const row = await q.one(
        `insert into courses (code,title,category_id,description,objectives,duration_hours,delivery_method,target_audience,capacity,fee,currency,
            pass_mark,min_attendance_pct,validity_months,approving_body,approval_reference,approval_expiry,status,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
        [d.code, d.title, d.category_id, d.description ?? null, d.objectives ?? null, d.duration_hours, d.delivery_method, d.target_audience ?? null, d.capacity, d.fee, d.currency,
          d.pass_mark, d.min_attendance_pct, d.validity_months ?? null, d.approving_body ?? null, d.approval_reference ?? null, d.approval_expiry ?? null, d.status, u.id]);
      await this.audit.log(q, actor, 'course.create', 'course', row.id, null, row);
      return row;
    });
  }

  @Patch('courses/:id')
  @Require('courses:write')
  async update(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(patchOf(courseBody), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from courses where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      const m = { ...before, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? null])) } as any;
      // Changing pass mark, attendance or validity after enrolments exist would silently change past outcomes.
      const touchesRules = ['pass_mark', 'min_attendance_pct', 'validity_months'].some((k) => k in d && (d as any)[k] !== before[k]);
      if (touchesRules && (await q.one(`select 1 from enrollments e join programmes p on p.id = e.programme_id where p.course_id = $1 and p.status in ('ongoing','completed') limit 1`, [id]))) {
        throw new ConflictException('Pass mark, attendance and validity cannot change once programmes have started. Create a new course version instead.');
      }
      const after = await q.one(
        `update courses set code=$2,title=$3,category_id=$4,description=$5,objectives=$6,duration_hours=$7,delivery_method=$8,target_audience=$9,capacity=$10,fee=$11,
            currency=$12,pass_mark=$13,min_attendance_pct=$14,validity_months=$15,approving_body=$16,approval_reference=$17,approval_expiry=$18,status=$19 where id=$1 returning *`,
        [id, m.code, m.title, m.category_id, m.description, m.objectives, m.duration_hours, m.delivery_method, m.target_audience, m.capacity, m.fee, m.currency,
          m.pass_mark, m.min_attendance_pct, m.validity_months, m.approving_body, m.approval_reference, m.approval_expiry, m.status]);
      await this.audit.log(q, actor, 'course.update', 'course', id, before, after);
      return after;
    });
  }

  @Put('courses/:id/prerequisites')
  @Require('courses:write')
  async setPrerequisites(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { ids } = parse(z.object({ ids: z.array(uuid).max(20) }), body);
    if (ids.includes(id)) throw new BadRequestException('A course cannot be its own prerequisite');
    return this.db.tx(async (q) => {
      // Reject cycles: none of the new prerequisites may (transitively) require this course.
      if (ids.length) {
        const cyc = await q.one(
          `with recursive up(id) as (select prerequisite_id from course_prerequisites where course_id = any($1::uuid[])
                                      union select p.prerequisite_id from course_prerequisites p join up on p.course_id = up.id)
           select 1 from up where id = $2 limit 1`, [ids, id]);
        if (cyc) throw new BadRequestException('That would create a circular prerequisite chain');
      }
      await q.query('delete from course_prerequisites where course_id = $1', [id]);
      for (const p of ids) await q.query('insert into course_prerequisites (course_id, prerequisite_id) values ($1,$2)', [id, p]);
      await this.audit.log(q, actor, 'course.prerequisites_set', 'course', id, null, { ids });
      return { ids };
    });
  }

  @Put('courses/:id/instructors')
  @Require('courses:write')
  async setInstructors(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { ids } = parse(z.object({ ids: z.array(uuid).max(50) }), body);
    return this.db.tx(async (q) => {
      if (ids.length) {
        const ok = await q.one<{ n: number }>(`select count(*) n from users where id = any($1::uuid[]) and role = 'instructor' and status <> 'suspended'`, [ids]);
        if (ok!.n !== new Set(ids).size) throw new BadRequestException('Every selected person must be an active instructor');
      }
      await q.query('delete from course_instructors where course_id = $1', [id]);
      for (const i of new Set(ids)) await q.query('insert into course_instructors (course_id, instructor_id) values ($1,$2)', [id, i]);
      await this.audit.log(q, actor, 'course.instructors_set', 'course', id, null, { ids });
      return { ids };
    });
  }

  // ------------------------------------------------------------ modules and materials

  /** Staff manage every course's material. An instructor manages the material of courses they teach, and removes only what they added. */
  private async assertMaterialsAccess(u: AuthUser, courseId: string) {
    if (isStaff(u)) return;
    if (u.role === 'instructor' && (await teachesCourse(this.db, u.id, courseId))) return;
    throw new ForbiddenException('You can only add learning material to courses you teach');
  }

  @Post('courses/:id/modules')
  @Require('courses:write', 'materials:write')
  async addModule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    if (!(await this.db.one('select 1 from courses where id = $1', [id]))) throw new NotFoundException();
    await this.assertMaterialsAccess(u, id);
    const d = parse(z.object({ title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).nullish(), position: z.number().int().min(0).default(0) }), body);
    return this.db.tx(async (q) => {
      const row = await q.one('insert into course_modules (course_id, title, description, position, created_by) values ($1,$2,$3,$4,$5) returning *', [id, d.title, d.description ?? null, d.position, u.id]);
      await this.audit.log(q, actor, 'course_module.create', 'course', id, null, row);
      return row;
    });
  }

  @Delete('modules/:id')
  @Require('courses:write', 'materials:write')
  async deleteModule(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const m = await q.one<any>('select * from course_modules where id = $1 for update', [id]);
      if (!m) throw new NotFoundException();
      await this.assertMaterialsAccess(u, m.course_id);
      if (!isStaff(u)) {
        // an instructor removes their own module, and only while nobody else has put material in it
        const others = await q.one(`select 1 from learning_materials where module_id = $1 and created_by is distinct from $2 limit 1`, [id, u.id]);
        if (m.created_by !== u.id || others) throw new ForbiddenException('You can only remove modules and material you added yourself');
      }
      const row = await q.one<any>('delete from course_modules where id = $1 returning *', [id]);
      await this.audit.log(q, actor, 'course_module.delete', 'course', row.course_id, row, null);
      return { ok: true };
    });
  }

  @Post('modules/:id/materials')
  @Require('courses:write', 'materials:write')
  async addMaterial(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const mod = await this.db.one<any>('select course_id from course_modules where id = $1', [id]);
    if (!mod) throw new NotFoundException();
    await this.assertMaterialsAccess(u, mod.course_id);
    const d = parse(materialBody, body);
    // a file attached by id must be one this person uploaded; staff may attach any
    if (d.document_id && !isStaff(u) && !(await this.db.one('select 1 from documents where id = $1 and uploaded_by = $2', [d.document_id, u.id]))) throw new ForbiddenException('You can only attach files you uploaded');
    return this.db.tx(async (q) => {
      const row = await q.one(
        'insert into learning_materials (module_id, title, kind, url, document_id, required, position, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
        [id, d.title, d.kind, d.url ?? null, d.document_id ?? null, d.required, d.position, u.id]);
      await this.audit.log(q, actor, 'learning_material.create', 'learning_material', row.id, null, row);
      return row;
    });
  }

  /** Upload a file and attach it as material in one step. The same type, size and virus checks as Documents apply. */
  @Post('modules/:id/materials/upload')
  @Require('courses:write', 'materials:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024 + 1024, files: 1 } }))
  async uploadMaterial(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file: { originalname: string; size: number; buffer: Buffer } | undefined, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    if (!file) throw new BadRequestException('Choose a file to upload');
    const mod = await this.db.one<any>('select course_id from course_modules where id = $1', [id]);
    if (!mod) throw new NotFoundException();
    await this.assertMaterialsAccess(u, mod.course_id);
    const d = parse(z.object({ title: z.string().trim().min(2).max(200), kind: z.enum(['video', 'pdf', 'presentation', 'document', 'audio', 'image', 'scorm']), required: z.enum(['true', 'false']).default('true') }), body);
    const rules = await this.settings.get<{ allowed: string[]; max_mb: number }>('file_types');
    const { ext, mime } = inspectUpload(file, rules, this.env.MAX_UPLOAD_MB);
    if (!(await this.scanner.clean(file.buffer))) {
      await this.audit.log(null, actor, 'document.rejected_malware', 'document', null, null, { filename: file.originalname });
      throw new BadRequestException('The file was rejected by the virus scanner');
    }
    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 150);
    const key = `${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, mime);
    try {
      return await this.db.tx(async (q) => {
        const doc = await q.one<any>(
          `insert into documents (category, filename, mime_type, size_bytes, sha256, storage_key, confidential, uploaded_by) values ('course_material',$1,$2,$3,$4,$5,false,$6) returning id`,
          [safeName, mime, file.size, createHash('sha256').update(file.buffer).digest('hex'), key, u.id]);
        const pos = await q.one<{ n: number }>('select count(*)::int n from learning_materials where module_id = $1', [id]);
        const row = await q.one('insert into learning_materials (module_id, title, kind, document_id, required, position, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *', [id, d.title, d.kind, doc.id, d.required === 'true', pos!.n, u.id]);
        await this.audit.log(q, actor, 'learning_material.create', 'learning_material', row.id, null, { ...row, filename: safeName });
        return row;
      });
    } catch (e) { await this.storage.remove(key); throw e; }
  }

  /** Download an uploaded material: staff, auditors, instructors of the course, and trainees confirmed on a programme of it. */
  @Get('materials/:id/file')
  @Require('courses:read')
  async materialFile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: any) {
    parse(uuid, id);
    const m = await this.db.one<any>(
      `select l.id, d.storage_key, d.mime_type, d.filename, cm.course_id from learning_materials l join course_modules cm on cm.id = l.module_id join documents d on d.id = l.document_id where l.id = $1`, [id]);
    if (!m) throw new NotFoundException();
    let ok = isStaff(u) || u.role === 'auditor';
    if (!ok && u.role === 'instructor') ok = await teachesCourse(this.db, u.id, m.course_id);
    if (!ok && u.role === 'trainee') {
      ok = !!(await this.db.one(`select 1 from enrollments e join programmes p on p.id = e.programme_id where p.course_id = $1 and e.trainee_id = $2 and e.status in ('confirmed','completed') limit 1`, [m.course_id, u.id]));
    }
    if (!ok) throw new NotFoundException();
    const body = await this.storage.get(m.storage_key);
    res.set({ 'Content-Type': m.mime_type, 'Content-Disposition': `attachment; filename="${String(m.filename).replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    return new StreamableFile(body);
  }

  @Delete('materials/:id')
  @Require('courses:write', 'materials:write')
  async deleteMaterial(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const l = await q.one<any>('select l.*, cm.course_id from learning_materials l join course_modules cm on cm.id = l.module_id where l.id = $1 for update of l', [id]);
      if (!l) throw new NotFoundException();
      await this.assertMaterialsAccess(u, l.course_id);
      if (!isStaff(u) && l.created_by !== u.id) throw new ForbiddenException('You can only remove modules and material you added yourself');
      const row = await q.one('delete from learning_materials where id = $1 returning *', [id]);
      await this.audit.log(q, actor, 'learning_material.delete', 'learning_material', id, row, null);
      return { ok: true };
    });
  }

  /** A trainee records progress on a material, but only for a course they are enrolled in. */
  @Put('materials/:id/progress')
  @Require('courses:read')
  async setProgress(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    if (u.role !== 'trainee') throw new BadRequestException('Only trainees record learning progress');
    const { status } = parse(z.object({ status: z.enum(['not_started', 'in_progress', 'completed']) }), body);
    const allowed = await this.db.one(
      `select 1 from learning_materials l join course_modules m on m.id = l.module_id
        join programmes p on p.course_id = m.course_id
        join enrollments e on e.programme_id = p.id and e.trainee_id = $2 and e.status in ('confirmed','completed')
       where l.id = $1 limit 1`, [id, u.id]);
    if (!allowed) throw new NotFoundException();
    return this.db.one(
      `insert into material_progress (trainee_id, material_id, status) values ($2,$1,$3)
       on conflict (trainee_id, material_id) do update set status = excluded.status, updated_at = now() returning *`, [id, u.id, status]);
  }

  /** The modules and materials of a course the trainee is enrolled on, with their own progress on each. */
  @Get('my/learning/:courseId')
  @Require('courses:read')
  async myCourse(@CurrentUser() u: AuthUser, @Param('courseId') courseId: string) {
    parse(uuid, courseId);
    if (u.role !== 'trainee') throw new BadRequestException('Only trainees have learning progress');
    const enrolled = await this.db.one(
      `select 1 from enrollments e join programmes p on p.id = e.programme_id where e.trainee_id = $1 and p.course_id = $2 and e.status in ('confirmed','completed') limit 1`, [u.id, courseId]);
    if (!enrolled) throw new NotFoundException();
    const course = await this.db.one('select id, code, title from courses where id = $1', [courseId]);
    const modules = await this.db.query(
      `select m.id, m.title, m.description,
              coalesce(json_agg(json_build_object('id', l.id, 'title', l.title, 'kind', l.kind, 'url', l.url, 'required', l.required, 'status', coalesce(mp.status, 'not_started')) order by l.position)
                       filter (where l.id is not null), '[]') as materials
         from course_modules m left join learning_materials l on l.module_id = m.id
         left join material_progress mp on mp.material_id = l.id and mp.trainee_id = $1
        where m.course_id = $2 group by m.id order by m.position, m.created_at`, [u.id, courseId]);
    return { course, modules };
  }

  /** Remaining learning requirements for the signed-in trainee. */
  @Get('my/learning')
  @Require('courses:read')
  async myLearning(@CurrentUser() u: AuthUser) {
    return this.db.query(
      `select c.id as course_id, c.code, c.title, p.id as programme_id,
              count(l.id) filter (where l.required) as required_items,
              count(mp.material_id) filter (where mp.status = 'completed' and l.required) as completed_items
         from enrollments e join programmes p on p.id = e.programme_id join courses c on c.id = p.course_id
         left join course_modules m on m.course_id = c.id
         left join learning_materials l on l.module_id = m.id
         left join material_progress mp on mp.material_id = l.id and mp.trainee_id = e.trainee_id
        where e.trainee_id = $1 and e.status in ('confirmed','completed')
        group by c.id, p.id order by c.title`, [u.id]);
  }
}

@Module({ controllers: [CoursesController] })
export class CoursesModule {}
