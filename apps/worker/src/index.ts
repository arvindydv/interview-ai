import { env } from './env.js';
import { sql } from './db.js';
import { transport, verifyMailer } from './mailer.js';
import { closeAutoApplyQueue, startAutoApplyWorker } from './queues/autoApply.js';
import { startColdEmailWorker } from './queues/coldEmail.js';
import { startEmailWorker } from './queues/email.js';
import { startHistoryWorker } from './queues/history.js';
import { closeJobBotQueue, startJobBotWorker } from './experimental/jobBotQueue.js';
import { installCrashLogging, startHeartbeat } from './heartbeat.js';
import { closeRetentionQueue, startRetentionWorker } from './queues/retention.js';
import { closeDiscoveryQueue, startDiscoveryWorker } from './queues/discovery.js';
import { closeListingsQueue, startListingsWorker } from './queues/listings.js';
import { closeMatchesQueue, startMatchesWorker } from './queues/matches.js';
import { startPracticeWorker } from './queues/practice.js';
import { startProfileWorker } from './queues/profile.js';
import { startSystemWorker } from './queues/system.js';
import { startTailorWorker } from './queues/tailor.js';
import { closeReportQueue, startReportWorker } from './queues/report.js';
import { closeSubmitQueue, startSubmitWorker } from './queues/submit.js';

// Background jobs (spec §3.2). Resume parsing, Interview Pack builds, summaries, scoring, retention
// and usage roll-ups get their own queues here as they land.
installCrashLogging();
// The experimental LinkedIn/Indeed/Naukri bot starts only with JOB_BOT_EXPERIMENTAL=true (and is never scheduled).
const workers = [startRetentionWorker(), startSystemWorker(), startEmailWorker(), startProfileWorker(), startPracticeWorker(), startHistoryWorker(), startListingsWorker(), startMatchesWorker(), startDiscoveryWorker(), startTailorWorker(), startAutoApplyWorker(), startSubmitWorker(), startColdEmailWorker(), startReportWorker(), startJobBotWorker()].filter((w): w is NonNullable<typeof w> => w !== null);
console.log(`[worker] listening on queues "system", "email", "profile", "practice", "history", "listings", "matches", "discovery", "tailor", "autoapply", "autosubmit", "coldemail", "report", "retention"${env.JOB_BOT_EXPERIMENTAL ? ', "jobbot" (experimental)' : ''} (${env.REDIS_URL})`);
void verifyMailer();
const stopHeartbeat = startHeartbeat(workers.map((w) => w.name));

const shutdown = async () => {
  await Promise.allSettled([...workers.map((w) => w.close()), closeListingsQueue(), closeMatchesQueue(), closeDiscoveryQueue(), closeAutoApplyQueue(), closeSubmitQueue(), closeReportQueue(), closeJobBotQueue(), closeRetentionQueue(), stopHeartbeat()]);
  transport.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
