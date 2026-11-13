// Audits the tailored resume behind every Auto Apply application (read-only):
//
//   pnpm --filter @parakeet/worker exec tsx scripts/audit-tailored-resumes.ts [--user <uuid>] [--json]
//
// For each application: a tailored resume is linked, belongs to the same user and job, finished
// ("ready"), has a stored file that really is a PDF/DOCX, differs from the source resume, isn't shared
// with another job, and every line it rewrote passes today's fact guard (no skill, employer, degree,
// certification or number the source resume doesn't contain). Exit code 1 when anything fails.
import { createHash } from 'node:crypto';
import { unsupportedTerms } from '@parakeet/shared';
import { sql } from '../src/db.js';

const args = process.argv.slice(2);
const userId = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;
const asJson = args.includes('--json');

interface Row {
  id: string;
  user_id: string;
  listing_id: string | null;
  status: string;
  title: string;
  company: string;
  t_id: string | null;
  t_user: string | null;
  t_listing: string | null;
  t_status: string | null;
  file: Buffer | null;
  file_name: string | null;
  edits: { before: string; after: string }[] | null;
  cover: boolean;
  source_file: Buffer | null;
  source_text: string | null;
}

const rows = await sql<Row[]>`
  select a.id, a.user_id, a.listing_id, a.status, a.title, a.company,
         t.id as t_id, t.user_id as t_user, t.listing_id as t_listing, t.status as t_status, t.file, t.file_name,
         t.content->'edits' as edits, t.cover_letter_file is not null as cover,
         coalesce(j.file, r.file) as source_file, coalesce(j.text, r.text) as source_text
  from public.auto_applications a
  left join public.tailored_resumes t on t.id = a.tailored_resume_id
  left join public.resumes r on r.id = t.resume_id
  left join public.job_resumes j on j.id = t.job_resume_id
  ${userId ? sql`where a.user_id = ${userId}` : sql``}
  order by a.created_at`;

const kind = (b: Buffer | null) =>
  !b ? null : b.subarray(0, 5).toString('latin1') === '%PDF-' ? 'pdf' : b[0] === 0x50 && b[1] === 0x4b ? 'docx' : 'unknown';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sharedBy = new Map<string, Set<string>>();
for (const r of rows) if (r.t_id && r.listing_id) (sharedBy.get(r.t_id) ?? sharedBy.set(r.t_id, new Set()).get(r.t_id)!).add(r.listing_id);

const report = rows.map((r) => {
  const problems: string[] = [];
  // Applications skipped before preparation never got this far; nothing to check.
  if (!r.t_id) {
    if (!['skipped', 'preparing'].includes(r.status)) problems.push('no tailored resume linked');
    return { id: r.id, job: `${r.title} @ ${r.company}`, status: r.status, problems, edits: 0 };
  }
  if (r.t_user !== r.user_id) problems.push('tailored resume belongs to another user');
  if (r.t_listing !== r.listing_id) problems.push('tailored resume is for another job');
  if (r.t_status !== 'ready') problems.push(`tailoring ${r.t_status}`);
  const k = kind(r.file);
  if (!k) problems.push('no file stored');
  else if (k === 'unknown') problems.push('stored file is not a PDF or DOCX');
  else if (r.file_name && !r.file_name.toLowerCase().endsWith(`.${k}`)) problems.push(`file name ${r.file_name} doesn't match its ${k} content`);
  if (r.file && r.source_file && hash(r.file) === hash(r.source_file)) problems.push('file identical to the source resume (nothing tailored)');
  if ((sharedBy.get(r.t_id)?.size ?? 0) > 1) problems.push('one tailored resume used for several jobs');
  const edits = r.edits ?? [];
  for (const e of edits) {
    const bad = unsupportedTerms(e.after, r.source_text ?? '');
    if (bad.length) problems.push(`rewrite names what the resume doesn't: ${bad.join(', ')} — "${e.after.slice(0, 90)}"`);
  }
  if (!r.cover) problems.push('(note) no cover letter');
  return { id: r.id, job: `${r.title} @ ${r.company}`, status: r.status, problems, edits: edits.length, bytes: r.file?.length ?? 0, format: k };
});

const failing = report.filter((r) => r.problems.some((p) => !p.startsWith('(note)')));
if (asJson) console.log(JSON.stringify({ applications: report.length, failing: failing.length, report }, null, 2));
else {
  for (const r of report) {
    const mark = r.problems.some((p) => !p.startsWith('(note)')) ? '✖' : '✔';
    console.log(`${mark} ${r.status.padEnd(9)} ${r.job.slice(0, 60).padEnd(60)} edits=${r.edits}${'format' in r && r.format ? ` ${r.format} ${Math.round((r.bytes ?? 0) / 1024)} KB` : ''}`);
    for (const p of r.problems) console.log(`    - ${p}`);
  }
  console.log(`\n${report.length} applications, ${failing.length} with problems`);
}
await sql.end();
process.exit(failing.length ? 1 : 0);
