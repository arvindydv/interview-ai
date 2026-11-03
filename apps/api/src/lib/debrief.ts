import { AUTO_DEBRIEF_MIN_QUESTIONS } from '@parakeet/shared';
import { sql } from './db.js';
import { historyQueue } from './queues.js';

// Feedback after a real interview (spec G2): written by the worker (queues/history.ts) on its own when
// a desktop session with enough questions ends, or when the user asks for it from History.

/** Lets the last lines of the conversation land before the feedback reads them. */
const SETTLE_MS = 3_000;

export type DebriefRequest = { status: 'pending' } | { error: 'not_found' | 'no_text' | 'unavailable' };

/** Queues the feedback for a session. `auto`: only for a real interview the user hasn't opted out of keeping. */
export async function requestDebrief(sessionId: string, userId: string, opts: { auto?: boolean } = {}): Promise<DebriefRequest> {
  const [row] = await sql<{ id: string; summary_status: string | null; with_text: number; retention: string }[]>`
    select s.id, s.summary_status,
           (select count(*)::int from public.live_turns t where t.live_session_id = s.id and t.question <> '' and t.status <> 'blocked') as with_text,
           coalesce(u.history_retention, 'forever') as retention
    from public.live_sessions s
    left join public.users u on u.id = s.user_id
    where s.id = ${sessionId} and s.user_id = ${userId} and s.deleted_at is null`;
  if (!row) return { error: 'not_found' };
  if (opts.auto) {
    // "Don't save" means no interview text is kept, so there's nothing to keep feedback on either.
    if (row.summary_status || row.retention === 'off' || row.with_text < AUTO_DEBRIEF_MIN_QUESTIONS) return { error: 'no_text' };
  } else if (!row.with_text) {
    return { error: 'no_text' };
  }
  if (row.summary_status === 'pending') return { status: 'pending' };
  await sql`update public.live_sessions set summary_status = 'pending' where id = ${row.id}`;
  try {
    await historyQueue.add('history.summary', { sessionId: row.id }, { jobId: `history-summary-${row.id}-${Date.now()}`, delay: opts.auto ? SETTLE_MS : 0 });
  } catch {
    await sql`update public.live_sessions set summary_status = 'failed' where id = ${row.id}`;
    return { error: 'unavailable' };
  }
  return { status: 'pending' };
}
