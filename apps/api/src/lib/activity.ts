import type { TurnStatus } from '@parakeet/shared';
import type { AuthUser } from './auth.js';
import { sql } from './db.js';

// Live-answer activity for the admin console: one row per connection and per question.
// Writes are best-effort; callers catch and log, so tracking can never break an answer.

const MAX_QUESTION_CHARS = 4_000;
const MAX_ANSWER_CHARS = 20_000;

export async function openLiveSession(user: AuthUser, clientSessionId: string): Promise<string> {
  // The user record is normally created by GET /v1/me; make sure it exists for the foreign key.
  await sql`
    insert into public.users (id, email, auth_provider)
    values (${user.id}, ${user.email}, ${user.provider})
    on conflict (id) do nothing`;
  const [row] = await sql<{ id: string }[]>`
    insert into public.live_sessions (user_id, client_session_id)
    values (${user.id}, ${clientSessionId.slice(0, 128)})
    returning id`;
  return row.id;
}

export async function closeLiveSession(id: string) {
  await sql`update public.live_sessions set disconnected_at = now() where id = ${id}`;
}

export interface TurnRecord {
  userId: string;
  liveSessionId: string | null;
  turnId: string;
  question: string;
  answer: string;
  imageCount: number;
  interviewId: string | null;
  field: string;
  company: string;
  role: string;
  hasResume: boolean;
  model: string | null;
  tier: string | null;
  status: TurnStatus;
  errorCode: string | null;
  tokensIn: number;
  tokensOut: number;
  ttftMs: number | null;
  durationMs: number | null;
}

export async function recordTurn(t: TurnRecord) {
  // With history off (spec G3), only usage is stored, never the question or answer text.
  const localOnly = sql`coalesce((select history_retention = 'off' from public.users where id = ${t.userId}), false)`;
  await sql`
    insert into public.live_turns (
      user_id, live_session_id, turn_id, question, answer, image_count, interview_id, field, company, role, has_resume,
      model, tier, status, error_code, tokens_in, tokens_out, ttft_ms, duration_ms
    ) values (
      ${t.userId}, ${t.liveSessionId}, ${t.turnId.slice(0, 128)},
      case when ${localOnly} then '' else ${t.question.slice(0, MAX_QUESTION_CHARS)} end,
      case when ${localOnly} then '' else ${t.answer.slice(0, MAX_ANSWER_CHARS)} end, ${t.imageCount}, ${t.interviewId}, ${t.field}, ${t.company}, ${t.role}, ${t.hasResume},
      ${t.model}, ${t.tier}, ${t.status}, ${t.errorCode}, ${t.tokensIn}, ${t.tokensOut}, ${t.ttftMs}, ${t.durationMs}
    )`;
  await sql`update public.users set last_active_at = now() where id = ${t.userId}`;
}

/** Questions the user has asked since 00:00 UTC (blocked attempts don't count). */
export async function questionsToday(userId: string) {
  const [row] = await sql<{ plan: string; n: number }[]>`
    select public.current_plan(u.plan, u.plan_expires_at) as plan, (
      select count(*)::int from public.live_turns t
      where t.user_id = u.id and t.status <> 'blocked'
        and t.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    ) as n
    from public.users u where u.id = ${userId}`;
  return row ?? { plan: 'free', n: 0 };
}
