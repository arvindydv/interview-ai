import { env } from './env.js';
import { sql } from './db.js';
import { transport, verifyMailer } from './mailer.js';
import { closeAutoApplyQueue, startAutoApplyWorker } from './queues/autoApply.js';
import { startEmailWorker } from './queues/email.js';
import { startHistoryWorker } from './queues/history.js';
import { closeDiscoveryQueue, startDiscoveryWorker } from './queues/discovery.js';
import { closeListingsQueue, startListingsWorker } from './queues/listings.js';
import { closeMatchesQueue, startMatchesWorker } from './queues/matches.js';
import { startPracticeWorker } from './queues/practice.js';
import { startProfileWorker } from './queues/profile.js';
import { startSystemWorker } from './queues/system.js';
import { startTailorWorker } from './queues/tailor.js';

// Background jobs (spec §3.2). Resume parsing, Interview Pack builds, summaries, scoring, retention
// and usage roll-ups get their own queues here as they land.
const workers = [startSystemWorker(), startEmailWorker(), startProfileWorker(), startPracticeWorker(), startHistoryWorker(), startListingsWorker(), startMatchesWorker(), startDiscoveryWorker(), startTailorWorker(), startAutoApplyWorker()];
console.log(`[worker] listening on queues "system", "email", "profile", "practice", "history", "listings", "matches", "discovery", "tailor", "autoapply" (${env.REDIS_URL})`);
void verifyMailer();

const shutdown = async () => {
  await Promise.allSettled([...workers.map((w) => w.close()), closeListingsQueue(), closeMatchesQueue(), closeDiscoveryQueue(), closeAutoApplyQueue()]);
  transport.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
