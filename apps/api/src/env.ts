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
  // LLM. Model ids with a "/" (e.g. openai/gpt-oss-120b:nitro) go through OpenRouter; claude-* ids go
  // straight to the Claude API. With neither key set, the live channel streams a labelled sample.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Text questions: fast tier (spec C4). Default depends on which key is set (lib/llm.ts). */
  LLM_FAST_MODEL: z.string().optional(),
  /** Screenshot questions: vision / strong tier (spec D3). */
  LLM_VISION_MODEL: z.string().optional(),

  // Live transcription: Deepgram Flux (turn-based streaming STT). Without a key, only typed and
  // screenshot questions work.
  DEEPGRAM_API_KEY: z.string().optional(),
  /** flux-general-en (English) or flux-general-multi (multilingual). */
  DEEPGRAM_MODEL: z.string().default('flux-general-en'),
  /** Confidence needed to end a turn (0.5–0.9). Higher waits longer before answering. */
  DEEPGRAM_EOT_THRESHOLD: z.coerce.number().min(0.5).max(0.9).default(0.7),
  /**
   * Confidence at which an answer starts speculatively, before the turn is confirmed (0.3–0.9).
   * Lower starts sooner; a speculative answer for a question that turns out unfinished is discarded.
   */
  DEEPGRAM_EAGER_EOT_THRESHOLD: z.coerce.number().min(0.3).max(0.9).default(0.4),
  /** A turn ends after this much silence even if the model is unsure. */
  DEEPGRAM_EOT_TIMEOUT_MS: z.coerce.number().int().min(500).max(10000).default(2000),
  /** Public website URL, used for links in emails. */
  APP_URL: z.url().default('http://localhost:3100'),

  // Admin console (apps/admin). /admin/* is disabled until all three are set.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  /** Signs admin session tokens. Changing it signs every admin out. */
  ADMIN_JWT_SECRET: z.string().optional(),
  ADMIN_SESSION_HOURS: z.coerce.number().default(12),
});

// Empty values in .env mean "not set".
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
