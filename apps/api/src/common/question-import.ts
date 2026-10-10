import JSZip from 'jszip';
import { validateQuestionShape } from './grading';

/**
 * Reads questions from a Word (.docx) file written in a plain layout:
 *
 *   1. Which ICAO Annex covers aviation security?
 *   A. Annex 6
 *   B. Annex 17
 *   C. Annex 14
 *   Answer: B
 *   Marks: 2          (optional, default 1)
 *   Level: easy       (optional: easy, medium or hard)
 *   Topic: AVSEC      (optional)
 *   Explanation: ...  (optional)
 *
 * True or false has no options: "Answer: True". Several correct options: "Answer: A, C".
 * Short answer has no options: "Answer: Annex 17" (separate accepted answers with | or ;).
 * An essay has no answer, or "Type: Essay". A correct option can also be marked with a * at the end.
 */

export interface ParsedQuestion {
  n: number;
  prompt: string;
  type: 'mcq_single' | 'mcq_multi' | 'true_false' | 'short_answer' | 'essay' | 'scenario';
  options: string[] | null;
  answer: number | number[] | boolean | string[] | null;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string | null;
  explanation: string | null;
  problems: string[];
}

const MAX_QUESTIONS = 500;

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** The paragraphs of a .docx, in order (text inside tables included), as plain lines. */
export async function docxParagraphs(file: Buffer): Promise<string[]> {
  if (file.length < 4 || file[0] !== 0x50 || file[1] !== 0x4b) throw new Error('This is not a Word .docx file. In Word, choose File > Save As > Word Document (.docx).');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('This file could not be opened. Save it again as a Word Document (.docx).'); }
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('This is not a Word document. Save it as a Word Document (.docx).');
  // refuse files that unpack to something absurd
  const xml = await entry.async('string');
  if (xml.length > 20_000_000) throw new Error('This document is too large to import. Split it into smaller files.');
  const out: string[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    let text = '';
    for (const m of p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:noBreakHyphen\/>/g)) {
      if (m[0].startsWith('<w:t')) text += decode(m[1]);
      else if (m[0] === '<w:tab/>') text += ' ';
      else if (m[0] === '<w:br/>') text += '\n';
      else text += '-';
    }
    for (const line of text.split('\n')) out.push(line.replace(/ /g, ' ').trim());
  }
  return out;
}

const NUMBERED = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-]\s+(.*)$/i;
const OPTION = /^\(?([A-Ha-h])[.)]\s+(.*)$/;
const FIELD = /^(answers?|marks?|points?|level|difficulty|topic|explanation|type)\s*[:=]\s*(.*)$/i;

interface Block { lines: string[]; startedAt: number }

function split(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let sawBlank = false;
  const complete = (b: Block) => b.lines.some((l) => FIELD.test(l) && /^(answers?|type)/i.test(l)) || b.lines.filter((l) => OPTION.test(l)).length >= 2;
  lines.forEach((l, i) => {
    if (!l) { sawBlank = true; return; }
    const startsNew = NUMBERED.test(l) && !OPTION.test(l) && !FIELD.test(l);
    const afterBlock = cur && sawBlank && complete(cur) && !OPTION.test(l) && !FIELD.test(l);
    if (!cur || startsNew || afterBlock) { cur = { lines: [], startedAt: i + 1 }; blocks.push(cur); }
    cur.lines.push(l);
    sawBlank = false;
  });
  return blocks;
}

function parseBlock(b: Block, n: number): ParsedQuestion {
  const problems: string[] = [];
  const promptLines: string[] = [];
  const options: string[] = [];
  const optionLetters: string[] = [];
  const correctMarked: number[] = [];
  const f: Record<string, string> = {};
  let lastField: string | null = null;

  b.lines.forEach((raw, idx) => {
    let line = raw;
    if (idx === 0) { const m = NUMBERED.exec(line); if (m) line = m[2]; }
    const fld = FIELD.exec(line);
    if (fld) { lastField = fld[1].toLowerCase().replace(/s$/, ''); f[lastField] = fld[2].trim(); return; }
    const opt = OPTION.exec(line);
    if (opt && idx > 0) {
      let text = opt[2].trim();
      const marked = /\s*(\*|\(correct\)|✓|✔)\s*$/i.test(text);
      if (marked) { text = text.replace(/\s*(\*|\(correct\)|✓|✔)\s*$/i, '').trim(); correctMarked.push(options.length); }
      options.push(text); optionLetters.push(opt[1].toUpperCase()); lastField = 'option';
      return;
    }
    // a line that belongs to whatever came just before it
    if (lastField === 'option' && options.length) options[options.length - 1] += ` ${line}`;
    else if (lastField && f[lastField] !== undefined) f[lastField] += ` ${line}`;
    else promptLines.push(line);
  });

  const prompt = promptLines.join(' ').trim();
  if (!prompt) problems.push('The question text is missing');
  else if (prompt.length < 3) problems.push('The question text is too short');

  const explicitType = (f.type ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const answerRaw = (f.answer ?? '').trim();
  let type: ParsedQuestion['type'] | undefined;
  let answer: ParsedQuestion['answer'] = null;
  let opts: string[] | null = null;

  const letterIndex = (s: string) => optionLetters.indexOf(s.toUpperCase());
  const answerLetters = answerRaw ? answerRaw.split(/[\s,;/&]+|\band\b/i).map((x) => x.replace(/[^A-Za-z]/g, '')).filter(Boolean) : [];

  if (explicitType === 'essay' || explicitType === 'scenario') {
    type = explicitType === 'scenario' ? 'scenario' : 'essay';
  } else if (options.length) {
    opts = options;
    const idx = [...new Set([...correctMarked, ...answerLetters.map(letterIndex)])];
    if (!idx.length) problems.push('Mark the correct option: add a line like "Answer: B"');
    else if (idx.includes(-1)) problems.push(`The answer "${answerRaw}" does not match an option letter (${optionLetters.join(', ')})`);
    else if (['mcqmulti', 'multiple', 'multipleanswers'].includes(explicitType) || idx.length > 1) { type = 'mcq_multi'; answer = idx.sort((a, c) => a - c); }
    if (!type) { type = 'mcq_single'; if (idx.length === 1 && idx[0] >= 0) answer = idx[0]; }
    if (options.length < 2) problems.push('A multiple choice question needs at least two options');
    if (options.length > 8) problems.push('Use at most eight options');
  } else if (/^(true|false|t|f|yes|no)$/i.test(answerRaw) || ['truefalse', 'trueorfalse', 'tf'].includes(explicitType)) {
    type = 'true_false';
    answer = /^(true|t|yes)$/i.test(answerRaw) ? true : /^(false|f|no)$/i.test(answerRaw) ? false : null;
    if (answer === null) problems.push('For true or false, write "Answer: True" or "Answer: False"');
  } else if (answerRaw) {
    type = 'short_answer';
    answer = answerRaw.split(/\s*[|;]\s*/).map((x) => x.trim()).filter(Boolean);
  } else {
    type = 'essay'; // no options and no answer: marked by hand
  }

  const marksNum = f.mark ? Number(String(f.mark).replace(/[^\d.]/g, '')) : f.point ? Number(String(f.point).replace(/[^\d.]/g, '')) : 1;
  const marks = Number.isFinite(marksNum) && marksNum > 0 && marksNum <= 100 ? marksNum : 1;
  if (f.mark && !(marksNum > 0 && marksNum <= 100)) problems.push(`Marks "${f.mark}" must be a number between 0.5 and 100`);
  const lvl = (f.level ?? f.difficulty ?? 'medium').toLowerCase();
  const difficulty = (['easy', 'medium', 'hard'].includes(lvl) ? lvl : 'medium') as ParsedQuestion['difficulty'];
  if ((f.level ?? f.difficulty) && !['easy', 'medium', 'hard'].includes(lvl)) problems.push(`Level "${f.level ?? f.difficulty}" must be easy, medium or hard`);

  if (!problems.length) { const shape = validateQuestionShape(type, opts, answer); if (shape) problems.push(shape); }
  if (prompt.length > 4000) problems.push('The question text is longer than 4000 characters');

  return { n, prompt, type: type ?? 'essay', options: opts, answer, marks, difficulty, topic: f.topic?.slice(0, 200) || null, explanation: f.explanation?.slice(0, 3000) || null, problems };
}

export function parseQuestionLines(lines: string[]): ParsedQuestion[] {
  // headings, instructions and notes are not questions: a question starts with a number, or has options or an Answer line
  const blocks = split(lines).filter((b) => NUMBERED.test(b.lines[0]) || b.lines.some((l, i) => i > 0 && OPTION.test(l)) || b.lines.some((l) => FIELD.test(l)));
  if (blocks.length > MAX_QUESTIONS) throw new Error(`This file has more than ${MAX_QUESTIONS} questions. Split it into smaller files.`);
  return blocks.map((b, i) => parseBlock(b, i + 1));
}

export async function parseQuestionDocx(file: Buffer): Promise<ParsedQuestion[]> {
  return parseQuestionLines(await docxParagraphs(file));
}
