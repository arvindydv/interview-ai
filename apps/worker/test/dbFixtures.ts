import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// Throwaway rows in the local Supabase database for tests that need real SQL. Tests using these skip
// when the database isn't reachable (CI runs the worker tests without one).

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export async function dbAvailable(): Promise<boolean> {
  const probe = postgres(DATABASE_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    await probe`select 1 from public.audit_logs limit 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

export async function createUser(sql: postgres.Sql) {
  const id = randomUUID();
  const email = `test-${id.slice(0, 8)}@example.com`;
  await sql`insert into auth.users (id, email, aud, role) values (${id}, ${email}, 'authenticated', 'authenticated')`;
  await sql`insert into public.users (id, email, auth_provider) values (${id}, ${email}, 'email')`;
  return { id, email };
}

export async function deleteUser(sql: postgres.Sql, id: string) {
  await sql`delete from auth.users where id = ${id}`;
}

export async function createSource(sql: postgres.Sql) {
  const [s] = await sql<{ id: string }[]>`
    insert into public.job_sources (provider, board, company, enabled)
    values ('greenhouse', ${`test-${randomUUID().slice(0, 8)}`}, 'Test Co', false) returning id`;
  return s.id;
}

export async function createListing(sql: postgres.Sql, sourceId: string, closedDaysAgo: number | null = null) {
  const [l] = await sql<{ id: string }[]>`
    insert into public.job_listings (source_id, external_id, title, company, apply_url, closed_at)
    values (${sourceId}, ${randomUUID()}, 'Backend Engineer', 'Test Co', 'https://example.com/apply',
            ${closedDaysAgo === null ? null : sql`now() - make_interval(days => ${closedDaysAgo})`})
    returning id`;
  return l.id;
}
