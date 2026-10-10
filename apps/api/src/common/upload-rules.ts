import { BadRequestException } from '@nestjs/common';

/** What each allowed type must look like on the inside. The browser's claimed type is never trusted. */
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


/** Checks an uploaded file against the allowed types and size, by its content. Returns its extension and the type to store it as. */
export function inspectUpload(file: { originalname: string; size: number; buffer: Buffer }, rules: { allowed: string[]; max_mb: number }, envMaxMb: number) {
  const max = Math.min(rules.max_mb, envMaxMb) * 1024 * 1024;
  if (file.size > max) throw new BadRequestException(`Files can be up to ${Math.floor(max / 1048576)} MB`);
  const ext = (file.originalname.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
  const type = TYPES[ext];
  if (!type || !rules.allowed.includes(ext)) throw new BadRequestException(`This file type is not allowed. Allowed: ${rules.allowed.join(', ')}`);
  if (!type.check(file.buffer)) throw new BadRequestException('The file content does not match its type');
  return { ext, mime: type.mime };
}
