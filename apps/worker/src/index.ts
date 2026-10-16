import { env } from './env.js';
import { sql } from './db.js';
import { transport, verifyMailer } from './mailer.js';
import { startEmailWorker } from './queues/email.js';
import { startProfileWorker } from './queues/profile.js';
import { startSystemWorker } from './queues/system.js';

// Background jobs (spec §3.2). Resume parsing, Interview Pack builds, summaries, scoring, retention
// and usage roll-ups get their own queues here as they land.
const workers = [startSystemWorker(), startEmailWorker(), startProfileWorker()];
console.log(`[worker] listening on queues "system", "email", "profile" (${env.REDIS_URL})`);
void verifyMailer();

const shutdown = async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  transport.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
