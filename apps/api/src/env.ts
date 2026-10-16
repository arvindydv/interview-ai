import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3100'),
  SUPABASE_URL: z.url(),
  // Only needed if the Supabase project still signs tokens with the legacy shared secret (HS256).
  SUPABASE_JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // Claude. Credentials come from ANTHROPIC_API_KEY (or any source the SDK resolves); without
  // them the live channel streams a labelled sample answer instead.
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Text questions: fast tier (spec C4). */
  LLM_FAST_MODEL: z.string().default('claude-haiku-5-5'),
  /** Screenshot questions: vision / strong tier (spec D3). */
  LLM_VISION_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Public website URL, used for links in emails. */
  APP_URL: z.url().default('http://localhost:3100'),

  // Admin console (apps/admin). /admin/* is disabled until all three are set.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  /** Signs admin session tokens. Changing it signs every admin out. */
  ADMIN_JWT_SECRET: z.string().optional(),
  ADMIN_SESSION_HOURS: z.coerce.number().default(12),
});

export const env = schema.parse(process.env);
