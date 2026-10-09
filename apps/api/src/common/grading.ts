import { z } from 'zod';

export type QuestionType = 'mcq_single' | 'mcq_multi' | 'true_false' | 'short_answer' | 'essay' | 'matching' | 'scenario';

export interface QuestionRow {
  id: string;
  type: QuestionType;
  options: any;
  answer: any;
  marks: number;
}

export interface Graded {
  marks: number;
  needsManual: boolean;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Marks one response. Subjective questions are left for a marker. */
export function grade(q: QuestionRow, response: unknown, awardableMarks = q.marks): Graded {
  const full = awardableMarks;
  switch (q.type) {
    case 'essay':
    case 'scenario':
      return { marks: 0, needsManual: true };

    case 'true_false':
      return { marks: typeof response === 'boolean' && response === q.answer ? full : 0, needsManual: false };

    case 'mcq_single':
      return { marks: Number.isInteger(response) && response === q.answer ? full : 0, needsManual: false };

    case 'mcq_multi': {
      const correct: number[] = q.answer ?? [];
      const given = Array.isArray(response) ? [...new Set(response.filter((x) => Number.isInteger(x)))] : [];
      if (!correct.length) return { marks: 0, needsManual: false };
      const hits = given.filter((g) => correct.includes(g)).length;
      const misses = given.length - hits;
      // partial credit, but picking wrong options costs marks, so ticking everything does not pay
      return { marks: r2(full * Math.max(0, hits - misses) / correct.length), needsManual: false };
    }

    case 'short_answer': {
      const accepted: string[] = (q.answer ?? []).map(norm);
      return { marks: typeof response === 'string' && accepted.includes(norm(response)) ? full : 0, needsManual: false };
    }

    case 'matching': {
      const key: number[] = q.answer ?? [];
      const given = Array.isArray(response) ? response : [];
      if (!key.length) return { marks: 0, needsManual: false };
      const right = key.filter((k, i) => given[i] === k).length;
      return { marks: r2(full * right / key.length), needsManual: false };
    }
  }
  return { marks: 0, needsManual: true };
}

/** Shape check for a question as authored by staff. Returns an error message or null. */
export function validateQuestionShape(type: QuestionType, options: any, answer: any): string | null {
  const strings = z.array(z.string().trim().min(1).max(500));
  switch (type) {
    case 'mcq_single': {
      if (!strings.min(2).max(8).safeParse(options).success) return 'Provide 2 to 8 options';
      return Number.isInteger(answer) && answer >= 0 && answer < options.length ? null : 'The correct answer must be one of the options';
    }
    case 'mcq_multi': {
      if (!strings.min(2).max(8).safeParse(options).success) return 'Provide 2 to 8 options';
      const ok = Array.isArray(answer) && answer.length >= 1 && new Set(answer).size === answer.length && answer.every((a) => Number.isInteger(a) && a >= 0 && a < options.length);
      return ok ? null : 'Choose at least one correct option';
    }
    case 'true_false':
      return typeof answer === 'boolean' ? null : 'The answer must be true or false';
    case 'short_answer':
      return strings.min(1).max(10).safeParse(answer).success ? null : 'Provide at least one accepted answer';
    case 'matching': {
      const ok = options && strings.min(2).max(10).safeParse(options.left).success && strings.min(2).max(10).safeParse(options.right).success;
      if (!ok || options.left.length !== options.right.length) return 'Provide matching left and right lists of equal length';
      const valid = Array.isArray(answer) && answer.length === options.left.length && answer.every((a) => Number.isInteger(a) && a >= 0 && a < options.right.length);
      return valid ? null : 'Each left item needs a correct right item';
    }
    case 'essay':
    case 'scenario':
      return null;
  }
}

/** What a trainee may see of a question: never the answer or the explanation. */
export function publicQuestion(q: { id: string; type: string; prompt: string; options: any; marks: number }) {
  return { id: q.id, type: q.type, prompt: q.prompt, options: q.options, marks: q.marks };
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
