import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { env } from '../env.js';

// Per-provider pacing for authorized ATS submissions, shared by every worker process through Redis, so
// a second worker (or a restart mid-burst) can't double an ATS's documented rate:
//
//   submit:pace:<provider>  the earliest time (ms, Redis clock) the next request may start
//   submit:conc:<provider>  sorted set of slots in use (token → lease expiry), capping concurrent requests
//   submit:cool:<provider>  set when the ATS answered 429: every worker waits until it expires
//
// Times come from Redis's own clock (TIME), so workers on different machines agree. Every key expires,
// so a crashed worker can never hold a provider forever.

/** What the limiter needs from a Redis client: BullMQ's script commands (IRedisClient). */
export interface ScriptClient {
  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
  runCommand(name: string, args: (string | number)[]): Promise<unknown>;
}

export interface LimitOptions {
  /** Minimum gap between two request starts to this provider, across all workers. */
  minIntervalMs: number;
  /** Requests to this provider in flight at once, across all workers. */
  maxConcurrent: number;
  /** A slot held longer than this (a crashed worker) is freed. */
  leaseMs?: number;
}

export interface Slot {
  release(): Promise<void>;
}

const NOW = `local t = redis.call('TIME') local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

// KEYS: pace, conc, cool. ARGV: minIntervalMs, maxConcurrent, token, leaseMs.
// Returns 0 when the slot is taken, else how long to wait (ms) before asking again.
const ACQUIRE = `${NOW}
local cool = redis.call('PTTL', KEYS[3])
if cool > 0 then return cool end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local maxc = tonumber(ARGV[2])
if redis.call('ZCARD', KEYS[2]) >= maxc then
  local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local wait = 250
  if first[2] then wait = math.min(math.max(tonumber(first[2]) - now, 50), 1000) end
  return wait
end
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
if nxt > now then return nxt - now end
local gap = tonumber(ARGV[1])
redis.call('SET', KEYS[1], now + gap, 'PX', gap + 60000)
local lease = tonumber(ARGV[4])
redis.call('ZADD', KEYS[2], now + lease, ARGV[3])
redis.call('PEXPIRE', KEYS[2], lease + 60000)
return 0`;

const RELEASE = `redis.call('ZREM', KEYS[1], ARGV[1]) return 1`;

// KEYS: cool. ARGV: ms. Extends a cool-down, never shortens it.
const COOL = `if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[1]) then redis.call('SET', KEYS[1], '1', 'PX', ARGV[1]) end return 1`;

const keys = (provider: string) => [`submit:pace:${provider}`, `submit:conc:${provider}`, `submit:cool:${provider}`];

const defined = new WeakSet<ScriptClient>();
function ready(redis: ScriptClient) {
  if (!defined.has(redis)) {
    redis.defineCommand('fridaySubmitAcquire', { numberOfKeys: 3, lua: ACQUIRE });
    redis.defineCommand('fridaySubmitRelease', { numberOfKeys: 1, lua: RELEASE });
    redis.defineCommand('fridaySubmitCool', { numberOfKeys: 1, lua: COOL });
    defined.add(redis);
  }
  return redis;
}

export class SubmitLimiter {
  constructor(private readonly client: () => Promise<ScriptClient>) {}

  /**
   * Waits for a slot to send to `provider`. Null when none came within `maxWaitMs` (the caller puts the
   * application back for later rather than holding its claim).
   */
  async acquire(provider: string, o: LimitOptions, maxWaitMs = 5 * 60_000, signal?: AbortSignal): Promise<Slot | null> {
    const token = randomUUID();
    const [pace, conc, cool] = keys(provider);
    const lease = o.leaseMs ?? 5 * 60_000;
    const deadline = Date.now() + maxWaitMs;
    const redis = ready(await this.client());
    for (;;) {
      if (signal?.aborted) return null;
      const wait = Number(await redis.runCommand('fridaySubmitAcquire', [pace, conc, cool, Math.max(0, o.minIntervalMs), Math.max(1, o.maxConcurrent), token, lease]));
      if (wait <= 0) {
        return { release: async () => void (await redis.runCommand('fridaySubmitRelease', [conc, token])) };
      }
      if (Date.now() + wait > deadline) return null;
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.min(wait, 5_000));
        signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
      });
    }
  }

  /** The ATS said 429: every worker leaves this provider alone for `ms`. */
  async coolDown(provider: string, ms: number) {
    const redis = ready(await this.client());
    await redis.runCommand('fridaySubmitCool', [keys(provider)[2], Math.max(1, Math.round(ms))]);
  }
}

let shared: { limiter: SubmitLimiter; queue: Queue } | null = null;

/** The worker's limiter, on the worker's Redis (through BullMQ's connection; no extra dependency). */
export function submitLimiter(): SubmitLimiter {
  if (!shared) {
    const queue = new Queue('autosubmit', { connection: { url: env.REDIS_URL } });
    shared = { queue, limiter: new SubmitLimiter(async () => (await queue.getBackend().client) as unknown as ScriptClient) };
  }
  return shared.limiter;
}

export async function closeSubmitLimiter() {
  await shared?.queue.close();
  shared = null;
}
