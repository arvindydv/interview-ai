import type { TrialBalance } from '@parakeet/shared';
import { sql } from './db.js';

// Live session metering. Every connection's time is recorded on its live_sessions row (minutes
// history for the admin console). Users on the 'free' plan also spend `users.trial_seconds`: the free
// trial plus any minute packs they bought (lib/billing.ts). Other plans are unlimited until they
// expire (public.current_plan), after which the user is metered again.

export const TRIAL_PLAN = 'free';
export const TRIAL_ENDED_MESSAGE =
  'You are out of session minutes. Buy more minutes or get a monthly or yearly plan to keep using live sessions.';

/** Charge at most this often, so an open session overshoots the allowance by a few seconds at most. */
const TICK_MS = 10_000;

const left = (t: TrialBalance) => Math.max(t.totalSeconds - t.usedSeconds, 0);

/** The user's trial balance, or null when their plan isn't metered. */
export async function trialBalance(userId: string): Promise<TrialBalance | null> {
  const [row] = await sql<{ plan: string; total: number; used: number }[]>`
    select public.current_plan(plan, plan_expires_at) as plan, trial_seconds as total, trial_used_seconds as used
    from public.users where id = ${userId}`;
  return row?.plan === TRIAL_PLAN ? { totalSeconds: row.total, usedSeconds: row.used } : null;
}

/**
 * Records `seconds` of session time: on the live session (if known) and, for the free plan, against
 * the trial (capped at the allowance). Returns the trial balance afterwards, or null if not metered.
 */
async function charge(userId: string, liveSessionId: string | null, seconds: number): Promise<TrialBalance | null> {
  // Data-modifying CTEs all run; `s` sees what `u` actually took from the trial.
  const [row] = await sql<{ total: number | null; used: number | null }[]>`
    with b as (
      select id, public.current_plan(plan, plan_expires_at) as plan, trial_seconds, trial_used_seconds as before
      from public.users where id = ${userId} for update
    ), u as (
      update public.users p set trial_used_seconds = least(b.trial_seconds, b.before + ${seconds})
      from b where p.id = b.id and b.plan = ${TRIAL_PLAN}
      returning p.trial_seconds, p.trial_used_seconds, p.trial_used_seconds - b.before as charged
    ), s as (
      update public.live_sessions
      set seconds = seconds + ${seconds}, trial_seconds = trial_seconds + coalesce((select charged from u), 0)
      where id = ${liveSessionId}
    )
    select (select trial_seconds from u) as total, (select trial_used_seconds from u) as used`;
  return row?.total == null || row.used == null ? null : { totalSeconds: row.total, usedSeconds: row.used };
}

/** Spends `seconds` of the user's minutes outside a live session (practice). Null if not metered. */
export const chargeMinutes = (userId: string, seconds: number) => charge(userId, null, seconds);

export const minutesLeft = (t: TrialBalance) => left(t);

interface MeterLog {
  warn: (o: object, m: string) => void;
}

interface MeterHooks {
  /** The latest trial balance (null = not metered): on start and after every charge. */
  onBalance: (trial: TrialBalance | null) => void;
  /** Called once when the trial runs out (immediately if it was already used up). */
  onEnded: () => void;
}

/**
 * Meters one live connection. If Postgres can't be reached the session keeps working rather than
 * locking the user out mid-interview.
 */
export class SessionMeter {
  private ended = false;
  private stopped = false;
  private since = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private last: TrialBalance | null = null;

  constructor(
    private readonly userId: string,
    private readonly liveSessionId: Promise<string | null>,
    private readonly log: MeterLog,
    private readonly hooks: MeterHooks,
  ) {}

  get hasEnded() {
    return this.ended;
  }

  async start() {
    this.since = Date.now();
    const trial = await trialBalance(this.userId).catch((err) => {
      this.log.warn({ err }, 'could not read trial balance');
      return null;
    });
    if (this.stopped) return;
    this.last = trial;
    this.hooks.onBalance(trial);
    this.next(trial);
  }

  /** Records the time since the last tick and stops metering. */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.tick().catch((err) => this.log.warn({ err }, 'could not record session time'));
  }

  private next(trial: TrialBalance | null) {
    if (this.stopped) return;
    if (!this.ended && trial && left(trial) <= 0) {
      this.ended = true;
      this.hooks.onEnded();
    }
    // Session time is still recorded after the trial ends (the socket stays open). Unmetered plans
    // are re-checked each tick, so a downgrade to 'free' starts metering.
    const delay = trial && !this.ended ? Math.min(TICK_MS, left(trial) * 1000) : TICK_MS;
    this.timer = setTimeout(() => {
      this.tick().then(
        (t) => {
          if (this.stopped) return;
          this.hooks.onBalance(t);
          this.next(t);
        },
        (err) => {
          // Keep the last known balance; the unrecorded time is retried on the next tick.
          this.log.warn({ err }, 'could not record session time');
          this.next(this.last);
        },
      );
    }, delay);
  }

  private async tick() {
    // Whole seconds only; the remainder carries over to the next tick.
    // Claimed before awaiting, so a tick in flight and stop() never charge the same seconds twice.
    const seconds = Math.floor((Date.now() - this.since) / 1000);
    this.since += seconds * 1000;
    try {
      this.last = await charge(this.userId, await this.liveSessionId, seconds);
      return this.last;
    } catch (err) {
      this.since -= seconds * 1000; // retried on the next tick
      throw err;
    }
  }
}
