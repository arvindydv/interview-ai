import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from 'bullmq';

// The experimental LinkedIn/Indeed/Naukri bot must not start or be scheduled unless switched on. A Redis
// database no dev worker reads, so the real queues are untouched.
process.env.REDIS_URL = 'redis://127.0.0.1:6380/15';
process.env.JOB_BOT_EXPERIMENTAL = 'false';

let redisUp = true;
const probe = new Queue('jobbot', { connection: { url: process.env.REDIS_URL } });
try {
  await Promise.race([probe.waitUntilReady(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000))]);
} catch {
  redisUp = false;
}

test('with JOB_BOT_EXPERIMENTAL off the bot worker does not start, and an old schedule is removed', { skip: !redisUp && 'Redis not reachable' }, async () => {
  // A schedule left by an older version.
  await probe.upsertJobScheduler('jobbot-tick', { pattern: '0 9-21/2 * * *', tz: 'Asia/Kolkata' }, { name: 'jobbot.tick', data: {} });
  const { startJobBotWorker, removeJobBotSchedule, closeJobBotQueue } = await import('../src/experimental/jobBotQueue.js');
  assert.equal(startJobBotWorker(), null);
  await removeJobBotSchedule();
  assert.deepEqual(await probe.getJobSchedulers(), []);
  await closeJobBotQueue();
  await probe.obliterate({ force: true });
  await probe.close();
});

test('the experimental bot has no automatic schedule in its source', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/experimental/jobBotQueue.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /upsertJobScheduler/);
  assert.doesNotMatch(src, /jobbot\.tick'\)/);
});
