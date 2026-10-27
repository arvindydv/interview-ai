import type { FastifyRequest } from 'fastify';
import { sql } from './db.js';

/** Profile rows reference public.users, which is normally created by GET /v1/me. */
export async function ensureUser(req: FastifyRequest) {
  await sql`
    insert into public.users (id, email, auth_provider)
    values (${req.user.id}, ${req.user.email}, ${req.user.provider})
    on conflict (id) do nothing`;
}
