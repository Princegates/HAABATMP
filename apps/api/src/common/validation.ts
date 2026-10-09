import { BadRequestException } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const isoDateTime = z.string().datetime({ offset: true });
export const optionalText = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
});

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && uuid.safeParse(v).success;
}
