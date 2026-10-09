import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool,
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Where the browser app lives. Used for CORS and for certificate verification links.
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  // 'dev' signs its own tokens and is refused in production. 'supabase' verifies Supabase Auth tokens.
  AUTH_MODE: z.enum(['dev', 'supabase']).default('dev'),
  DEV_PASSWORD: z.string().default('ChangeMe!2026'),
  DEV_JWT_SECRET: z.string().default('dev-only-secret-change-me-dev-only-secret'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  MFA_ROLES: z.string().default('super_admin,training_admin,finance_officer,auditor'),

  // 32 bytes, base64. Encrypts identity numbers at rest.
  DATA_ENCRYPTION_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  SUPABASE_STORAGE_BUCKET: z.string().default('atmp-documents'),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('HAAB Training <training@localhost>'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.AUTH_MODE === 'dev') problems.push('AUTH_MODE=dev is not allowed in production');
    if (!env.DATA_ENCRYPTION_KEY) problems.push('DATA_ENCRYPTION_KEY is required in production');
    if (env.AUTH_MODE === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY)) {
      problems.push('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    if (env.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER=local loses files on redeploy; use supabase');
    if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`);
  }
  return env;
}

export const ENV = Symbol('ENV');
