// Builds (and stores) the daily Friday Jobs report for the given India-time days, or yesterday, and
// prints it. The worker does this itself every night (queues/report.ts); this is for backfills and checks.
//
//   cd apps/worker && node --import tsx scripts/daily-report.ts [2026-11-12 ...]
import { sql } from '../src/db.js';
import { closeReportQueue, generateDailyReport } from '../src/queues/report.js';

const days = process.argv.slice(2);
for (const d of days.length ? days : [undefined]) console.log(JSON.stringify(await generateDailyReport(d), null, 2));
await closeReportQueue();
await sql.end();
