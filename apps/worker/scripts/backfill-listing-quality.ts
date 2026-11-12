// One-off after migration 20261110000100: classifies listings stored before it (tech category,
// eligibility, canonical apply URL). Syncs keep these current from then on. Safe to re-run.
//
//   cd apps/worker && node --import tsx scripts/backfill-listing-quality.ts
import { canonicalUrl, eligibility, techCategory, type Workplace } from '@parakeet/shared';
import { sql } from '../src/db.js';

let done = 0;
for (;;) {
  const rows = await sql<{ id: string; title: string; location: string; workplace: Workplace | null; apply_url: string }[]>`
    select id, title, location, workplace, apply_url from public.job_listings
    where eligibility is null order by id limit 2000`;
  if (!rows.length) break;
  const values = rows.map((r) => ({
    id: r.id,
    tech_category: techCategory(r.title),
    eligibility: eligibility(r.location, r.workplace),
    canonical_url: canonicalUrl(r.apply_url),
  }));
  await sql`
    update public.job_listings l set tech_category = v.tech_category, eligibility = v.eligibility, canonical_url = v.canonical_url
    from (select * from jsonb_to_recordset(${sql.json(values)}) as x(id uuid, tech_category text, eligibility text, canonical_url text)) v
    where l.id = v.id`;
  done += rows.length;
}
console.log(`classified ${done} listings`);
await sql.end();
