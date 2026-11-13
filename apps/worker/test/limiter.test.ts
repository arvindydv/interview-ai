// The shared submission limiter (src/submit/limiter.ts) on Redis database 15, which no dev worker
// reads. Two limiters on two separate connections stand in for two worker processes.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { SubmitLimiter, type ScriptClient } from '../src/submit/limiter.js';

const REDIS = 'redis://127.0.0.1:6380/15';

async function redisUp() {
  const q = new Queue('limiter-probe', { connection: { url: REDIS, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: () => null } });
  try {
    await Promise.race([q.waitUntilReady(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000))]);
    return true;
  } catch {
    return false;
  } finally {
    await q.close().catch(() => {});
  }
}

const available = await redisUp();

describe('shared submission limiter', { skip: !available && 'local Redis not reachable' }, () => {
  // Two "processes": separate connections, separate limiter instances.
  const queues = [new Queue('limiter-a', { connection: { url: REDIS } }), new Queue('limiter-b', { connection: { url: REDIS } })];
  const client = (i: number) => async () => (await queues[i].getBackend().client) as unknown as ScriptClient & { pttl(k: string): Promise<number>; del(...k: string[]): Promise<number>; exists(k: string): Promise<number> };
  const a = new SubmitLimiter(client(0));
  const b = new SubmitLimiter(client(1));
  let provider = '';

  before(async () => {
    await Promise.all(queues.map((q) => q.waitUntilReady()));
  });
  beforeEach(() => {
    provider = `test-${randomUUID().slice(0, 8)}`;
  });
  after(async () => {
    for (const q of queues) await q.close();
  });

  test('two workers never start requests to one provider closer than minIntervalMs', async () => {
    const o = { minIntervalMs: 150, maxConcurrent: 10 };
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const slot = await (i % 2 ? a : b).acquire(provider, o, 10_000);
        assert.ok(slot);
        starts.push(Date.now());
        await slot.release();
      }),
    );
    starts.sort((x, y) => x - y);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 140, `gap ${starts[i] - starts[i - 1]} ms`);
  });

  test('providers are paced independently', async () => {
    const o = { minIntervalMs: 5_000, maxConcurrent: 1 };
    const t0 = Date.now();
    const s1 = await a.acquire(provider, o, 1_000);
    const s2 = await b.acquire(`${provider}-other`, o, 1_000);
    assert.ok(s1 && s2);
    assert.ok(Date.now() - t0 < 1_000);
    await s1.release();
    await s2.release();
  });

  test('the concurrency cap holds across workers; a released slot frees it', async () => {
    const o = { minIntervalMs: 0, maxConcurrent: 2 };
    const s1 = await a.acquire(provider, o, 1_000);
    const s2 = await b.acquire(provider, o, 1_000);
    assert.ok(s1 && s2);
    assert.equal(await a.acquire(provider, o, 400), null, 'a third is refused while two are in flight');
    await s1.release();
    const s3 = await b.acquire(provider, o, 1_000);
    assert.ok(s3, 'released → available');
    await s2.release();
    await s3.release();
  });

  test('a crashed holder frees its slot when its lease runs out', async () => {
    const o = { minIntervalMs: 0, maxConcurrent: 1, leaseMs: 300 };
    const held = await a.acquire(provider, o, 1_000);
    assert.ok(held); // never released: the worker "died"
    assert.equal(await b.acquire(provider, o, 100), null);
    const next = await b.acquire(provider, o, 2_000);
    assert.ok(next, 'available after the lease');
    await next.release();
  });

  test('a 429 cool-down blocks every worker until it expires, and is never shortened', async () => {
    const o = { minIntervalMs: 0, maxConcurrent: 5 };
    await a.coolDown(provider, 600);
    await b.coolDown(provider, 100); // a shorter one doesn't cut it
    assert.equal(await b.acquire(provider, o, 200), null);
    assert.equal(await a.acquire(provider, o, 200), null);
    const t0 = Date.now();
    const slot = await b.acquire(provider, o, 2_000);
    assert.ok(slot);
    assert.ok(Date.now() - t0 >= 150, 'waited out the rest of the cool-down');
    await slot.release();
  });

  test('keys expire: nothing is left holding a provider forever', async () => {
    const r = await client(0)();
    const slot = await a.acquire(provider, { minIntervalMs: 1_000, maxConcurrent: 1, leaseMs: 2_000 }, 1_000);
    await a.coolDown(provider, 1_000);
    for (const k of [`submit:pace:${provider}`, `submit:conc:${provider}`, `submit:cool:${provider}`]) {
      const ttl = await r.pttl(k);
      assert.ok(ttl > 0 && ttl <= 63_000, `${k} ttl ${ttl}`);
    }
    await slot!.release();
    await r.del(`submit:pace:${provider}`, `submit:conc:${provider}`, `submit:cool:${provider}`);
  });

  test('an aborted wait gives up without a slot', async () => {
    const o = { minIntervalMs: 0, maxConcurrent: 1 };
    const held = await a.acquire(provider, o, 1_000);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const t0 = Date.now();
    assert.equal(await b.acquire(provider, o, 10_000, ctl.signal), null);
    assert.ok(Date.now() - t0 < 500, 'gives up promptly');
    await held!.release();
  });
});
