import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6380'),
  DATABASE_URL: z.url().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),

  // Resume analysis: Claude (ANTHROPIC_API_KEY, or any source the SDK resolves) or OpenRouter. Without
  // either, resumes are still used for answers as full text, just not analysed.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /**
   * Resume analysis runs before the interview, so quality matters more than speed (spec A4). Ids with
   * a "/" go through OpenRouter. Default: claude-sonnet-5-5, or anthropic/claude-sonnet-5.5 when only
   * OPENROUTER_API_KEY is set.
   */
  LLM_PROFILE_MODEL: z.string().optional(),

  // Brevo transactional SMTP. Without credentials (dev only) mail goes to the local Mailpit inbox.
  SMTP_HOST: z.string().default('smtp-relay.brevo.com'),
  SMTP_PORT: z.coerce.number().default(587),
  BREVO_SMTP_LOGIN: z.string().optional(),
  BREVO_SMTP_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Parakeet <no-reply@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),
});

// Empty values in .env mean "not set".
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));

if (env.NODE_ENV === 'production' && !(env.BREVO_SMTP_LOGIN && env.BREVO_SMTP_KEY)) {
  throw new Error('BREVO_SMTP_LOGIN and BREVO_SMTP_KEY are required in production');
}
