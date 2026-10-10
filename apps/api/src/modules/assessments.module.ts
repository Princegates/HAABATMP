import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { parseQuestionDocx } from '../common/question-import';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Actor, AuthUser } from '../common/auth.types';
import { AuditService } from '../common/audit.service';
import { Db, Q } from '../common/db.service';
import { ActorCtx, CurrentUser, Require } from '../common/decorators';
import { grade, publicQuestion, QuestionRow, shuffle, validateQuestionShape } from '../common/grading';
import { NotifyService } from '../common/notify.service';
import { isStaff } from '../common/scope';
import { isoDateTime, pageQuery, parse, uuid } from '../common/validation';

const TYPES = ['mcq_single', 'mcq_multi', 'true_false', 'short_answer', 'essay', 'matching', 'scenario'] as const;
const GRACE_MS = 10_000; // network slack on the final autosave; the clock itself is the server's

const questionBody = z.object({
  course_id: uuid,
  module_id: uuid.nullish(),
  topic: z.string().trim().max(200).nullish(),
  type: z.enum(TYPES),
  prompt: z.string().trim().min(3).max(4000),
  options: z.any().nullish(),
  answer: z.any().nullish(),
  marks: z.number().positive().max(100).default(1),
  explanation: z.string().trim().max(3000).nullish(),
});
const assessmentBody = z.object({
  course_id: uuid,
  programme_id: uuid.nullish(),
  title: z.string().trim().min(3).max(200),
  kind: z.enum(['exam', 'quiz', 'practical']).default('exam'),
  duration_minutes: z.number().int().min(1).max(600).default(60),
  pass_mark: z.number().int().min(0).max(100).default(70),
  max_attempts: z.number().int().min(1).max(10).default(1),
  randomize: z.boolean().default(true),
  release_mode: z.enum(['immediate', 'manual']).default('manual'),
  opens_at: isoDateTime.nullish(),
  closes_at: isoDateTime.nullish(),
});

@Controller()
export class AssessmentsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notify: NotifyService) {}

  // ------------------------------------------------------------ question bank

  @Get('questions')
  @Require('questions:write', 'assessments:read')
  async questions(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    if (u.role === 'trainee') throw new ForbiddenException();
    const f = parse(pageQuery.extend({ course_id: uuid.optional(), module_id: uuid.optional(), type: z.enum(TYPES).optional(), topic: z.string().max(200).optional(), status: z.enum(['active', 'retired']).default('active') }), query);
    const params: any[] = [f.status];
    const where = ['q.status = $1'];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.course_id) add('q.course_id = ?', f.course_id);
    if (f.module_id) add('q.module_id = ?', f.module_id);
    if (f.type) add('q.type = ?', f.type);
    if (f.topic) add('q.topic ilike ?', `%${f.topic}%`);
    if (f.q) add('q.prompt ilike ?', `%${f.q}%`);
    const data = await this.db.query(`select q.* from questions q where ${where.join(' and ')} order by q.created_at desc limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from questions q where ${where.join(' and ')}`, params))!.n;
    return { data, total };
  }

  @Post('questions')
  @Require('questions:write')
  async createQuestion(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(questionBody, body);
    const problem = validateQuestionShape(d.type, d.options, d.answer);
    if (problem) throw new BadRequestException(problem);
    return this.db.tx(async (q) => {
      const row = await q.one(
        `insert into questions (course_id,module_id,topic,type,prompt,options,answer,marks,explanation,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [d.course_id, d.module_id ?? null, d.topic ?? null, d.type, d.prompt, d.options == null ? null : JSON.stringify(d.options), d.answer == null ? null : JSON.stringify(d.answer), d.marks, d.explanation ?? null, u.id]);
      await this.audit.log(q, actor, 'question.create', 'question', row.id, null, { id: row.id, type: row.type, course_id: row.course_id });
      return row;
    });
  }

  /**
   * Questions from a Word file. Without commit=true this only reads the file and shows what it found, so nothing is
   * saved until the person has seen the preview. A file with any problem is refused as a whole: fix it and upload again.
   */
  @Post('questions/import')
  @Require('questions:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importQuestions(@CurrentUser() u: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const { course_id, commit } = parse(z.object({ course_id: uuid, commit: z.enum(['true', 'false']).default('false') }), body);
    if (!file) throw new BadRequestException('Choose a Word file (.docx) to upload');
    if (!/\.docx$/i.test(file.originalname)) throw new BadRequestException('Only Word .docx files are accepted. In Word, choose File > Save As > Word Document (.docx).');
    const course = await this.db.one<any>('select id, code from courses where id = $1', [course_id]);
    if (!course) throw new BadRequestException('Unknown course');
    let parsed;
    try { parsed = await parseQuestionDocx(file.buffer); } catch (e: any) { throw new BadRequestException(e.message); }
    if (!parsed.length) throw new BadRequestException('No questions were found. Check the file follows the template: a numbered question, options A, B, C and a line "Answer: B".');
    const existing = new Set((await this.db.query<{ p: string }>(`select lower(prompt) as p from questions where course_id = $1`, [course_id])).map((r) => r.p));
    const seen = new Set<string>();
    const questions = parsed.map((q) => {
      const key = q.prompt.toLowerCase();
      const duplicate = existing.has(key) || seen.has(key);
      seen.add(key);
      return { ...q, duplicate };
    });
    const bad = questions.filter((q) => q.problems.length).length;
    const toAdd = questions.filter((q) => !q.problems.length && !q.duplicate);
    const summary = { total: questions.length, ready: toAdd.length, with_problems: bad, duplicates: questions.filter((q) => q.duplicate).length };
    if (commit !== 'true') return { ...summary, questions, can_import: bad === 0 && toAdd.length > 0 };
    if (bad) throw new BadRequestException(`${bad} question${bad === 1 ? ' has' : 's have'} problems. Fix them in the Word file and upload it again. Nothing was imported.`);
    if (!toAdd.length) throw new BadRequestException('Every question in this file is already in the question bank.');
    await this.db.tx(async (q) => {
      for (const d of toAdd) {
        await q.query(
          `insert into questions (course_id,topic,type,prompt,options,answer,marks,explanation,created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [course_id, d.topic, d.type, d.prompt, d.options == null ? null : JSON.stringify(d.options), d.answer == null ? null : JSON.stringify(d.answer), d.marks, d.explanation, u.id]);
      }
      await this.audit.log(q, actor, 'question.import', 'course', course_id, null, { file: file.originalname.slice(0, 120), imported: toAdd.length, skipped_duplicates: summary.duplicates });
    });
    return { ...summary, imported: toAdd.length };
  }

  @Patch('questions/:id')
  @Require('questions:write')
  async updateQuestion(@Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(questionBody.omit({ course_id: true }).partial().extend({ status: z.enum(['active', 'retired']).optional() }), body);
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select * from questions where id = $1 for update', [id]);
      if (!before) throw new NotFoundException();
      // A question already used in a taken exam is retired, not rewritten, so past marks stay explainable.
      const used = await q.one(`select 1 from attempt_answers where question_id = $1 limit 1`, [id]);
      const m = { ...before, ...d } as any;
      if (used && (('prompt' in d && d.prompt !== before.prompt) || 'options' in d || 'answer' in d || 'type' in d || 'marks' in d)) {
        throw new ConflictException('This question has been answered in an exam. Retire it and create a new one.');
      }
      const problem = validateQuestionShape(m.type, m.options, m.answer);
      if (problem) throw new BadRequestException(problem);
      const after = await q.one(
        `update questions set module_id=$2,topic=$3,difficulty=$4,type=$5,prompt=$6,options=$7,answer=$8,marks=$9,explanation=$10,status=$11 where id=$1 returning *`,
        [id, m.module_id, m.topic, m.difficulty, m.type, m.prompt, m.options == null ? null : JSON.stringify(m.options), m.answer == null ? null : JSON.stringify(m.answer), m.marks, m.explanation, m.status]);
      await this.audit.log(q, actor, 'question.update', 'question', id, { prompt: before.prompt, status: before.status }, { prompt: after.prompt, status: after.status });
      return after;
    });
  }

  // ------------------------------------------------------------ assessments (staff)

  @Get('assessments')
  @Require('assessments:read')
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    if (u.role === 'trainee') throw new ForbiddenException();
    const f = parse(pageQuery.extend({ programme_id: uuid.optional(), course_id: uuid.optional(), status: z.enum(['draft', 'published', 'closed']).optional() }), query);
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'instructor') add(this.instructorScope(), u.id);
    if (f.programme_id) add('a.programme_id = ?', f.programme_id);
    if (f.course_id) add('a.course_id = ?', f.course_id);
    if (f.status) add('a.status = ?', f.status);
    if (f.q) add('a.title ilike ?', `%${f.q}%`);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const data = await this.db.query(
      `select a.*, c.code as course_code, c.title as course_title, p.code as programme_code,
              (select count(*) from assessment_questions aq where aq.assessment_id = a.id) as question_count,
              (select coalesce(sum(marks),0) from assessment_questions aq where aq.assessment_id = a.id) as total_marks,
              (select count(*) from exam_attempts x where x.assessment_id = a.id and x.status = 'submitted') as awaiting_marking
         from assessments a join courses c on c.id = a.course_id left join programmes p on p.id = a.programme_id
         ${w} order by a.created_at desc limit ${f.limit} offset ${f.offset}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*) n from assessments a ${w}`, params))!.n;
    return { data, total };
  }

  @Get('assessments/:id')
  @Require('assessments:read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    if (u.role === 'trainee') throw new NotFoundException();
    const a = await this.loadManaged(u, id);
    const questions = await this.db.query(
      `select q.*, aq.marks as assigned_marks, aq.position from assessment_questions aq join questions q on q.id = aq.question_id where aq.assessment_id = $1 order by aq.position`, [id]);
    return { ...a, questions };
  }

  @Post('assessments')
  @Require('assessments:write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ActorCtx() actor: Actor) {
    const d = parse(assessmentBody, body);
    if (d.opens_at && d.closes_at && d.closes_at <= d.opens_at) throw new BadRequestException('Closing time must be after opening time');
    return this.db.tx(async (q) => {
      if (d.programme_id) {
        const p = await q.one<any>('select course_id, lead_instructor_id from programmes where id = $1', [d.programme_id]);
        if (!p || p.course_id !== d.course_id) throw new BadRequestException('That programme does not belong to this course');
        if (u.role === 'instructor' && p.lead_instructor_id !== u.id && !(await q.one('select 1 from sessions where programme_id = $1 and instructor_id = $2 limit 1', [d.programme_id, u.id]))) throw new ForbiddenException('You are not assigned to this programme');
      } else if (u.role === 'instructor' && !(await q.one('select 1 from course_instructors where course_id = $1 and instructor_id = $2', [d.course_id, u.id]))) {
        throw new ForbiddenException('You are not authorised for this course');
      }
      const row = await q.one(
        `insert into assessments (course_id,programme_id,title,kind,duration_minutes,pass_mark,max_attempts,randomize,release_mode,opens_at,closes_at,created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [d.course_id, d.programme_id ?? null, d.title, d.kind, d.duration_minutes, d.pass_mark, d.max_attempts, d.randomize, d.release_mode, d.opens_at ?? null, d.closes_at ?? null, u.id]);
      await this.audit.log(q, actor, 'assessment.create', 'assessment', row.id, null, row);
      return row;
    });
  }

  @Patch('assessments/:id')
  @Require('assessments:write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const parsed = parse(assessmentBody.omit({ course_id: true, programme_id: true }).partial(), body);
    // only what the caller actually sent counts as a change; the schema's defaults must not overwrite saved values
    const sent = new Set(Object.keys((body ?? {}) as object));
    const d = Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as typeof parsed;
    const a = await this.loadManaged(u, id);
    const onlyWindow = Object.keys(d).every((k) => k === 'closes_at' || k === 'opens_at');
    if (a.status !== 'draft' && !onlyWindow) throw new ConflictException('A published assessment can only have its opening and closing times changed');
    const merged = { ...a, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? null])) } as any;
    if (merged.opens_at && merged.closes_at && new Date(merged.closes_at) <= new Date(merged.opens_at)) throw new BadRequestException('Closing time must be after opening time');
    return this.db.tx(async (q) => {
      const m = merged;
      const after = await q.one(
        `update assessments set title=$2,kind=$3,duration_minutes=$4,pass_mark=$5,max_attempts=$6,randomize=$7,release_mode=$8,opens_at=$9,closes_at=$10 where id=$1 returning *`,
        [id, m.title, m.kind, m.duration_minutes, m.pass_mark, m.max_attempts, m.randomize, m.release_mode, m.opens_at, m.closes_at]);
      await this.audit.log(q, actor, 'assessment.update', 'assessment', id, a, after);
      return after;
    });
  }

  @Put('assessments/:id/questions')
  @Require('assessments:write')
  async setQuestions(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { items } = parse(z.object({ items: z.array(z.object({ question_id: uuid, marks: z.number().positive().max(100).optional() })).max(300) }), body);
    const a = await this.loadManaged(u, id);
    if (a.status !== 'draft') throw new ConflictException('Questions can only be changed while the assessment is a draft');
    return this.db.tx(async (q) => {
      const ids = items.map((i) => i.question_id);
      const found = await q.query<any>(`select id, marks from questions where id = any($1::uuid[]) and course_id = $2 and status = 'active'`, [ids, a.course_id]);
      if (found.length !== new Set(ids).size) throw new BadRequestException('Every question must be an active question from this course');
      const base = new Map(found.map((f) => [f.id, f.marks]));
      await q.query('delete from assessment_questions where assessment_id = $1', [id]);
      let pos = 0;
      for (const it of items) await q.query('insert into assessment_questions (assessment_id, question_id, position, marks) values ($1,$2,$3,$4) on conflict do nothing', [id, it.question_id, pos++, it.marks ?? base.get(it.question_id)]);
      await this.audit.log(q, actor, 'assessment.questions_set', 'assessment', id, null, { count: items.length });
      return { count: items.length };
    });
  }

  /** Draws random questions from the bank, optionally by topic or module. */
  @Post('assessments/:id/questions/auto')
  @Require('assessments:write')
  async autoPick(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const d = parse(z.object({ count: z.number().int().min(1).max(200), topic: z.string().max(200).optional(), module_id: uuid.optional(), types: z.array(z.enum(TYPES)).optional() }), body);
    const a = await this.loadManaged(u, id);
    if (a.status !== 'draft') throw new ConflictException('Questions can only be changed while the assessment is a draft');
    return this.db.tx(async (q) => {
      const params: any[] = [a.course_id, id];
      const where = [`q.course_id = $1`, `q.status = 'active'`, `q.id not in (select question_id from assessment_questions where assessment_id = $2)`];
      if (d.topic) { params.push(d.topic); where.push(`q.topic ilike $${params.length}`); }
      if (d.module_id) { params.push(d.module_id); where.push(`q.module_id = $${params.length}`); }
      if (d.types?.length) { params.push(d.types); where.push(`q.type = any($${params.length}::text[])`); }
      params.push(d.count);
      const picked = await q.query<any>(`select q.id, q.marks from questions q where ${where.join(' and ')} order by random() limit $${params.length}`, params);
      const start = (await q.one<{ n: number }>('select coalesce(max(position), -1) + 1 as n from assessment_questions where assessment_id = $1', [id]))!.n;
      let pos = start;
      for (const p of picked) await q.query('insert into assessment_questions (assessment_id, question_id, position, marks) values ($1,$2,$3,$4)', [id, p.id, pos++, p.marks]);
      await this.audit.log(q, actor, 'assessment.questions_auto', 'assessment', id, null, { requested: d.count, added: picked.length });
      return { added: picked.length, short_by: d.count - picked.length };
    });
  }

  @Post('assessments/:id/publish')
  @Require('assessments:write')
  async publish(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const a = await this.loadManaged(u, id);
    if (a.status !== 'draft') throw new ConflictException('Already published');
    const n = await this.db.one<{ n: number; m: number }>('select count(*) n, coalesce(sum(marks),0) m from assessment_questions where assessment_id = $1', [id]);
    if (!n!.n || !(n!.m > 0)) throw new BadRequestException('Add questions before publishing');
    return this.setAssessmentStatus(id, 'published', actor);
  }

  @Post('assessments/:id/close')
  @Require('assessments:write')
  async close(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    await this.loadManaged(u, id);
    return this.setAssessmentStatus(id, 'closed', actor);
  }

  /** Makes marked attempts visible to the trainees who sat them. */
  @Post('assessments/:id/release')
  @Require('attempts:mark')
  async release(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const a = await this.loadManaged(u, id);
    return this.db.tx(async (q) => {
      const rows = await q.query<any>(`update exam_attempts set results_released = true where assessment_id = $1 and status = 'marked' and not results_released returning id, trainee_id, percentage`, [id]);
      for (const r of rows) {
        await this.notify.notify({ userId: r.trainee_id, kind: 'assessment.released', subject: `Result available: ${a.title}`, body: `Your result for "${a.title}" is now available in the training platform.` }, q);
      }
      await this.audit.log(q, actor, 'assessment.release', 'assessment', id, null, { released: rows.length });
      return { released: rows.length };
    });
  }

  // ------------------------------------------------------------ trainee: sit an assessment

  @Get('my/assessments')
  @Require('assessments:read')
  async mine(@CurrentUser() u: AuthUser) {
    if (u.role !== 'trainee') throw new ForbiddenException();
    return this.db.query(
      `select a.id, a.title, a.kind, a.duration_minutes, a.max_attempts, a.pass_mark, a.opens_at, a.closes_at, a.programme_id, p.code as programme_code,
              (select count(*) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $1) as attempts_used,
              (select x.id from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $1 and x.status = 'in_progress' and x.deadline_at > now() limit 1) as in_progress_attempt,
              (select max(x.percentage) from exam_attempts x where x.assessment_id = a.id and x.trainee_id = $1 and x.results_released) as best_percentage
         from assessments a join programmes p on p.id = a.programme_id
         join enrollments e on e.programme_id = a.programme_id and e.trainee_id = $1 and e.status in ('confirmed','completed')
        where a.status = 'published' order by coalesce(a.closes_at, p.end_date::timestamptz)`, [u.id]);
  }

  @Post('assessments/:id/start')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Require('assessments:read')
  async start(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    if (u.role !== 'trainee') throw new ForbiddenException('Only trainees sit assessments');
    return this.db.tx(async (q) => {
      const a = await q.one<any>(`select * from assessments where id = $1 and status = 'published' for update`, [id]);
      if (!a) throw new NotFoundException();
      if (!(await q.one(`select 1 from enrollments where programme_id = $1 and trainee_id = $2 and status = 'confirmed'`, [a.programme_id, u.id]))) throw new ForbiddenException('You are not confirmed on this programme');
      const now = Date.now();
      if (a.opens_at && now < new Date(a.opens_at).getTime()) throw new ConflictException('This assessment has not opened yet');
      if (a.closes_at && now > new Date(a.closes_at).getTime()) throw new ConflictException('This assessment has closed');

      let attempt = await q.one<any>(`select * from exam_attempts where assessment_id = $1 and trainee_id = $2 and status = 'in_progress' for update`, [id, u.id]);
      if (attempt && new Date(attempt.deadline_at).getTime() + GRACE_MS < now) {
        await this.finish(q, attempt.id, true); // time ran out while away; mark what was saved
        attempt = null;
      }
      let resumed = true;
      if (!attempt) {
        resumed = false;
        const used = await q.one<{ n: number }>('select count(*) n from exam_attempts where assessment_id = $1 and trainee_id = $2', [id, u.id]);
        if (used!.n >= a.max_attempts) throw new ConflictException('You have used all your attempts');
        const qs = await q.query<{ question_id: string }>('select question_id from assessment_questions where assessment_id = $1 order by position', [id]);
        const order = a.randomize ? shuffle(qs.map((x) => x.question_id)) : qs.map((x) => x.question_id);
        let deadline = now + a.duration_minutes * 60_000;
        if (a.closes_at) deadline = Math.min(deadline, new Date(a.closes_at).getTime());
        attempt = await q.one<any>(
          `insert into exam_attempts (assessment_id, trainee_id, attempt_no, deadline_at, question_order) values ($1,$2,$3,$4,$5) returning *`,
          [id, u.id, used!.n + 1, new Date(deadline).toISOString(), JSON.stringify(order)]);
        await this.audit.log(q, actor, 'attempt.start', 'exam_attempt', attempt.id, null, { assessment_id: id, attempt_no: attempt.attempt_no });
      }
      return { resumed, ...(await this.attemptPayload(q, attempt)) };
    });
  }

  @Get('attempts/:id')
  @Require('assessments:read')
  async attempt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    if (u.role !== 'trainee') throw new ForbiddenException('Use the review endpoint');
    return this.db.tx(async (q) => {
      const a = await q.one<any>('select * from exam_attempts where id = $1 and trainee_id = $2 for update', [id, u.id]);
      if (!a) throw new NotFoundException();
      if (a.status === 'in_progress' && new Date(a.deadline_at).getTime() + GRACE_MS < Date.now()) await this.finish(q, id, true);
      const fresh = await q.one<any>('select * from exam_attempts where id = $1', [id]);
      const payload = await this.attemptPayload(q, fresh);
      if (fresh.status !== 'in_progress' && fresh.results_released) {
        const ans = await q.query<any>(`select question_id, awarded_marks, feedback from attempt_answers where attempt_id = $1`, [id]);
        return { ...payload, result: { score: fresh.score, max_score: fresh.max_score, percentage: fresh.percentage }, marking: ans };
      }
      return payload;
    });
  }

  /** Autosave. Rejected once the server clock says time is up. */
  @Put('attempts/:id/answers')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Require('assessments:read')
  async save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const { answers } = parse(z.object({ answers: z.record(uuid, z.any()) }), body);
    const outcome = await this.db.tx(async (q) => {
      const a = await q.one<any>('select * from exam_attempts where id = $1 and trainee_id = $2 for update', [id, u.id]);
      if (!a) throw new NotFoundException();
      if (a.status !== 'in_progress') throw new ConflictException('This attempt has already been submitted');
      if (new Date(a.deadline_at).getTime() + GRACE_MS < Date.now()) {
        await this.finish(q, id, true);
        return { timeUp: true as const }; // returned, not thrown: throwing here would roll the submission back
      }
      const allowed = new Set<string>(a.question_order);
      let saved = 0;
      for (const [qid, response] of Object.entries(answers)) {
        if (!allowed.has(qid)) continue;
        await q.query(
          `insert into attempt_answers (attempt_id, question_id, response) values ($1,$2,$3)
           on conflict (attempt_id, question_id) do update set response = excluded.response, saved_at = now()`,
          [id, qid, JSON.stringify(response ?? null)]);
        saved++;
      }
      return { timeUp: false as const, saved, deadline_at: a.deadline_at };
    });
    if (outcome.timeUp) throw new ConflictException({ statusCode: 409, message: 'Time is up. Your saved answers have been submitted.', code: 'TIME_UP' });
    return { saved: outcome.saved, server_time: new Date().toISOString(), deadline_at: outcome.deadline_at };
  }

  @Post('attempts/:id/submit')
  @Require('assessments:read')
  async submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    return this.db.tx(async (q) => {
      const a = await q.one<any>('select * from exam_attempts where id = $1 and trainee_id = $2 for update', [id, u.id]);
      if (!a) throw new NotFoundException();
      if (a.status !== 'in_progress') return { status: a.status };
      const late = new Date(a.deadline_at).getTime() + GRACE_MS < Date.now();
      const out = await this.finish(q, id, late);
      await this.audit.log(q, actor, 'attempt.submit', 'exam_attempt', id, null, { late, needs_marking: out.needsManual });
      return { status: out.needsManual ? 'submitted' : 'marked', late };
    });
  }

  // ------------------------------------------------------------ staff: marking

  @Get('attempts')
  @Require('attempts:mark')
  async queue(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const f = parse(pageQuery.extend({ assessment_id: uuid.optional(), programme_id: uuid.optional(), status: z.enum(['in_progress', 'submitted', 'marked']).optional() }), query);
    // no filter means every attempt that has been handed in, waiting or already marked
    const params: any[] = [];
    const where: string[] = [];
    if (f.status) { params.push(f.status); where.push('x.status = $1'); } else where.push(`x.status in ('submitted','marked')`);
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (u.role === 'instructor') add(this.instructorScope('a'), u.id);
    if (f.assessment_id) add('x.assessment_id = ?', f.assessment_id);
    if (f.programme_id) add('a.programme_id = ?', f.programme_id);
    const data = await this.db.query(
      `select x.id, x.attempt_no, x.submitted_at, x.status, x.percentage, x.results_released, t.full_name as trainee_name, a.title as assessment_title, a.id as assessment_id,
              (select count(*) from attempt_answers aa where aa.attempt_id = x.id and aa.needs_manual and aa.marked_by is null) as unmarked_answers
         from exam_attempts x join assessments a on a.id = x.assessment_id join users t on t.id = x.trainee_id
        where ${where.join(' and ')} order by x.submitted_at nulls last limit ${f.limit} offset ${f.offset}`, params);
    return { data };
  }

  @Get('attempts/:id/review')
  @Require('attempts:mark')
  async review(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    parse(uuid, id);
    const a = await this.loadAttemptForMarker(u, id);
    const items = await this.db.query(
      `select q.id as question_id, q.type, q.prompt, q.options, q.answer, q.explanation, q.marks, aa.response, aa.awarded_marks, aa.needs_manual, aa.feedback
         from jsonb_array_elements_text($1::jsonb) with ordinality o(qid, ord)
         join questions q on q.id = o.qid::uuid left join attempt_answers aa on aa.attempt_id = $2 and aa.question_id = q.id order by o.ord`,
      [JSON.stringify(a.question_order), id]);
    return { attempt: a, items };
  }

  @Put('attempts/:id/mark')
  @Require('attempts:mark')
  async mark(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @ActorCtx() actor: Actor) {
    parse(uuid, id);
    const { marks } = parse(z.object({ marks: z.array(z.object({ question_id: uuid, awarded_marks: z.number().min(0), feedback: z.string().trim().max(2000).nullish() })).min(1).max(300) }), body);
    await this.loadAttemptForMarker(u, id);
    return this.db.tx(async (q) => {
      const a = await q.one<any>(`select * from exam_attempts where id = $1 and status in ('submitted','marked') for update`, [id]);
      if (!a) throw new ConflictException('This attempt is not ready for marking');
      const caps = new Map((await q.query<{ question_id: string; marks: number }>('select question_id, marks from assessment_questions where assessment_id = $1', [a.assessment_id])).map((c) => [c.question_id, c.marks]));
      for (const m of marks) {
        const cap = caps.get(m.question_id);
        if (cap === undefined) throw new BadRequestException('A question does not belong to this assessment');
        if (m.awarded_marks > cap) throw new BadRequestException(`Marks cannot exceed ${cap} for a question`);
        await q.query(
          `insert into attempt_answers (attempt_id, question_id, awarded_marks, feedback, marked_by, needs_manual) values ($1,$2,$3,$4,$5,true)
           on conflict (attempt_id, question_id) do update set awarded_marks = excluded.awarded_marks, feedback = excluded.feedback, marked_by = excluded.marked_by`,
          [id, m.question_id, m.awarded_marks, m.feedback ?? null, u.id]);
      }
      const out = await this.totals(q, id);
      const complete = out.unmarked === 0;
      const asm = await q.one<any>('select release_mode, pass_mark from assessments where id = $1', [a.assessment_id]);
      const after = await q.one<any>(
        `update exam_attempts set score=$2, max_score=$3, percentage=$4, status=$5, marked_by = case when $6 then $7::uuid else marked_by end,
                marked_at = case when $6 then now() else marked_at end, results_released = results_released or ($6 and $8) where id=$1 returning *`,
        [id, out.score, out.max, out.pct, complete ? 'marked' : 'submitted', complete, u.id, asm.release_mode === 'immediate']);
      await this.audit.log(q, actor, 'attempt.mark', 'exam_attempt', id, { score: a.score, status: a.status }, { score: out.score, status: after.status });
      return after;
    });
  }

  /** Called by the scheduled job: closes attempts whose time ran out while the trainee was away. */
  async sweepExpiredAttempts(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(`select id from exam_attempts where status = 'in_progress' and deadline_at + interval '10 seconds' < now()`);
    for (const r of rows) await this.db.tx((q) => this.finish(q, r.id, true));
    return rows.length;
  }

  // ------------------------------------------------------------ internals

  /** SQL fragment limiting an instructor to assessments they created, lead or teach on. $n is their user id. */
  private instructorScope(alias = 'a') {
    return `(${alias}.created_by = ? or exists (select 1 from programmes pp where pp.id = ${alias}.programme_id and (pp.lead_instructor_id = ? or exists (select 1 from sessions ss where ss.programme_id = pp.id and ss.instructor_id = ?))))`;
  }

  private async loadManaged(u: AuthUser, id: string) {
    const a = await this.db.one<any>('select * from assessments where id = $1', [id]);
    if (!a) throw new NotFoundException();
    if (isStaff(u) || u.role === 'auditor') return a;
    if (u.role === 'instructor') {
      const ok = a.created_by === u.id || (a.programme_id && (await this.db.one(
        `select 1 from programmes p where p.id = $1 and (p.lead_instructor_id = $2 or exists (select 1 from sessions s where s.programme_id = p.id and s.instructor_id = $2))`, [a.programme_id, u.id])));
      if (ok) return a;
    }
    throw new NotFoundException();
  }

  private async loadAttemptForMarker(u: AuthUser, id: string) {
    const a = await this.db.one<any>('select * from exam_attempts where id = $1', [id]);
    if (!a) throw new NotFoundException();
    await this.loadManaged(u, a.assessment_id);
    return a;
  }

  private async setAssessmentStatus(id: string, status: string, actor: Actor) {
    return this.db.tx(async (q) => {
      const before = await q.one<any>('select status from assessments where id = $1 for update', [id]);
      const after = await q.one('update assessments set status = $2 where id = $1 returning *', [id, status]);
      await this.audit.log(q, actor, `assessment.${status}`, 'assessment', id, before, { status });
      return after;
    });
  }

  private async attemptPayload(q: Q, attempt: any) {
    const a = await q.one<any>('select id, title, duration_minutes, pass_mark from assessments where id = $1', [attempt.assessment_id]);
    const qs = await q.query<any>(
      `select q.id, q.type, q.prompt, q.options, aq.marks from questions q join assessment_questions aq on aq.question_id = q.id and aq.assessment_id = $1 where q.id = any($2::uuid[])`,
      [attempt.assessment_id, attempt.question_order]);
    const byId = new Map(qs.map((x) => [x.id, x]));
    const saved = await q.query<any>('select question_id, response from attempt_answers where attempt_id = $1', [attempt.id]);
    return {
      attempt: { id: attempt.id, attempt_no: attempt.attempt_no, status: attempt.status, started_at: attempt.started_at, deadline_at: attempt.deadline_at, submitted_at: attempt.submitted_at, server_time: new Date().toISOString() },
      assessment: a,
      questions: (attempt.question_order as string[]).map((id) => byId.get(id)).filter(Boolean).map(publicQuestion),
      answers: Object.fromEntries(saved.filter((s) => s.response !== null).map((s) => [s.question_id, s.response])),
    };
  }

  /** Grades every question in the attempt and closes it. Unanswered questions score zero. */
  private async finish(q: Q, attemptId: string, late: boolean): Promise<{ needsManual: boolean }> {
    const a = await q.one<any>('select * from exam_attempts where id = $1', [attemptId]);
    const qs = await q.query<any>(
      `select q.id, q.type, q.options, q.answer, aq.marks from questions q join assessment_questions aq on aq.question_id = q.id and aq.assessment_id = $1 where q.id = any($2::uuid[])`,
      [a.assessment_id, a.question_order]);
    const saved = new Map((await q.query<any>('select question_id, response from attempt_answers where attempt_id = $1', [attemptId])).map((s) => [s.question_id, s.response]));
    let needsManual = false;
    for (const qu of qs) {
      const g = grade(qu as QuestionRow, saved.get(qu.id));
      const unanswered = !saved.has(qu.id);
      const manual = g.needsManual && !unanswered; // an unanswered essay needs no marker: it is zero
      if (manual) needsManual = true;
      await q.query(
        `insert into attempt_answers (attempt_id, question_id, awarded_marks, needs_manual) values ($1,$2,$3,$4)
         on conflict (attempt_id, question_id) do update set awarded_marks = excluded.awarded_marks, needs_manual = excluded.needs_manual`,
        [attemptId, qu.id, manual ? null : g.marks, manual]);
    }
    const t = await this.totals(q, attemptId);
    const asm = await q.one<any>('select release_mode from assessments where id = $1', [a.assessment_id]);
    await q.query(
      `update exam_attempts set submitted_at = case when $2 then least(now(), deadline_at) else now() end, status = $3, score = $4, max_score = $5, percentage = $6,
              marked_at = case when $3 = 'marked' then now() end, results_released = ($3 = 'marked' and $7) where id = $1`,
      [attemptId, late, needsManual ? 'submitted' : 'marked', t.score, t.max, t.pct, asm.release_mode === 'immediate']);
    return { needsManual };
  }

  private async totals(q: Q, attemptId: string) {
    const r = await q.one<any>(
      `select coalesce(sum(aa.awarded_marks), 0) as score, (select coalesce(sum(aq.marks), 0) from assessment_questions aq join exam_attempts x on x.assessment_id = aq.assessment_id where x.id = $1) as max,
              count(*) filter (where aa.needs_manual and aa.marked_by is null) as unmarked
         from attempt_answers aa where aa.attempt_id = $1`, [attemptId]);
    const score = Math.round(r.score * 100) / 100;
    return { score, max: r.max, unmarked: r.unmarked, pct: r.max > 0 ? Math.round((score / r.max) * 10000) / 100 : 0 };
  }
}

@Module({ controllers: [AssessmentsController] })
export class AssessmentsModule {}
