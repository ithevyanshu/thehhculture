import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Production domains are included so the site works even if the host's env var is missing.
  CORS_ORIGINS: z.string().default('http://localhost:5173,https://dhhculture.in,https://www.dhhculture.in'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // Tolerate quotes, spaces and trailing slashes: browsers send e.g. "https://dhhculture.in".
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((o) => o.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '').toLowerCase())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
