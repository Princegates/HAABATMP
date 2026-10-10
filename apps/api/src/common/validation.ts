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

/**
 * The schema for a PATCH: every field optional, and a field that was not sent stays absent. zod 4's `.partial()` still
 * applies `.default()` values, so a request that only changed a title would silently reset fee, status, pass mark and so on.
 * Use this instead of `.partial()` on any schema that has defaults.
 */
export function patchOf<T extends z.ZodObject<any>>(schema: T) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, any>)) {
    const def = field?._zod?.def;
    shape[key] = (def?.type === 'default' || def?.type === 'prefault' ? def.innerType : field).optional();
  }
  return z.object(shape) as unknown as z.ZodType<Partial<z.output<T>>>;
}
