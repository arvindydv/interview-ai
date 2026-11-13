// Syncs the given job sources now, in this process (not through the shared queue), e.g. boards a
// migration just added. With --provider/--board pairs or --new (sources never synced).
//
//   cd apps/worker && node --import tsx scripts/sync-sources.ts --new
import { sql } from '../src/db.js';
import { closeListingsQueue, syncSource } from '../src/queues/listings.js';

const ids = process.argv.includes('--new')
  ? (await sql<{ id: string }[]>`select id from public.job_sources where enabled and last_synced_at is null order by created_at`).map((r) => r.id)
  : process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const id of ids) {
  try {
    const r = await syncSource({ data: { sourceId: id }, attemptsMade: 0, opts: { attempts: 1 } });
    console.log(JSON.stringify({ id, ...r }));
  } catch (err) {
    console.log(JSON.stringify({ id, error: (err as Error).message }));
  }
}
await closeListingsQueue();
await sql.end();
