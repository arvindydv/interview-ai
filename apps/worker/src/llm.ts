import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from './env.js';

// Structured model calls for background jobs: Claude (ANTHROPIC_API_KEY, or any source the SDK
// resolves) or OpenRouter. Model ids with a "/" go through OpenRouter.

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }));
const anthropicConfigured = () =>
  Boolean(env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

export const llmConfigured = () => anthropicConfigured() || Boolean(env.OPENROUTER_API_KEY);

/** The Sonnet-tier default, through whichever provider is configured. */
export const defaultModel = () =>
  anthropicConfigured() || !env.OPENROUTER_API_KEY ? 'claude-sonnet-5-5' : 'anthropic/claude-sonnet-5.5';

/** A failure that retrying won't fix (bad key, rejected request). */
export class PermanentError extends Error {}

export interface StructuredRequest<T extends z.ZodType> {
  model: string;
  schema: T;
  /** Name for the JSON schema (OpenRouter). */
  name: string;
  system: string;
  user: string;
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

/** `data` is null when the model refused or its output didn't match the schema. */
export type StructuredResult<T> = { data: T | null; stop: string | null; usage: unknown };

export function structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
  return req.model.includes('/') ? viaOpenRouter(req) : viaClaude(req);
}

async function viaClaude<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
  try {
    const response = await anthropic().messages.parse({
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    return {
      data: response.stop_reason === 'refusal' ? null : (response.parsed_output as z.infer<T> | null),
      stop: response.stop_reason,
      usage: response.usage,
    };
  } catch (err) {
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.BadRequestError
    ) {
      throw new PermanentError((err as Error).message);
    }
    throw err;
  }
}

/** OpenRouter (OpenAI-compatible) with a JSON-schema response format, validated with the same schema. */
async function viaOpenRouter<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Friday AI' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: z.toJSONSchema(req.schema) } },
      reasoning: { effort: req.effort, exclude: true },
      provider: { require_parameters: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = `OpenRouter ${res.status}: ${body?.error?.message ?? res.statusText}`;
    if ([400, 401, 402, 403, 404].includes(res.status)) throw new PermanentError(message);
    throw new Error(message);
  }
  const choice = body?.choices?.[0];
  const content: string = choice?.message?.content ?? '';
  // Tolerate a fenced block, in case a provider wraps the JSON.
  const json = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  let raw: unknown = null;
  try {
    raw = JSON.parse(json || 'null');
  } catch {
    // Treated like a schema mismatch below.
  }
  const parsed = req.schema.safeParse(raw);
  return { data: parsed.success ? parsed.data : null, stop: choice?.finish_reason ?? null, usage: body?.usage };
}
