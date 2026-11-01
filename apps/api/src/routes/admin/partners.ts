import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PARTNER_CODE_RE, percentToBps, type AdminPartnerRow, type PartnerDashboard } from '@parakeet/shared';
import { audit, requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import {
  TOTALS_COLUMNS, partnerDashboard, toPartnerProfile, toTotals, type PartnerRow, type TotalsRow,
} from '../../lib/partners.js';

const uuid = z.uuid();
const percent = z.number().min(0.01, 'Commission must be above 0%').max(100, 'Commission can be at most 100%');

const createBody = z.object({
  email: z.string().trim().toLowerCase().email('Enter the partner’s account email'),
  code: z.string().trim().toLowerCase().regex(PARTNER_CODE_RE, 'Code: 3–32 lowercase letters, digits, - or _'),
  name: z.string().trim().min(1, 'Enter a name').max(80),
  instagram: z.string().trim().max(60).transform((s) => s.replace(/^@/, '')).optional(),
  commissionPercent: percent,
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  instagram: z.string().trim().max(60).transform((s) => s.replace(/^@/, '')).optional(),
  commissionPercent: percent.optional(),
  active: z.boolean().optional(),
});

const payoutBody = z.object({
  amount: z.number().int().positive('Enter an amount').max(100_000_000_00),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const notFound = { error: 'not_found', message: 'No such partner' };

export default async function adminPartnerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/partners', async (): Promise<{ rows: AdminPartnerRow[] }> => {
    const rows = await sql<(PartnerRow & TotalsRow & { email: string })[]>`
      select p.id, p.code, p.name, p.instagram, p.commission_bps, p.active, p.created_at, u.email, ${TOTALS_COLUMNS}
      from public.partners p join public.users u on u.id = p.user_id
      order by p.active desc, p.created_at desc`;
    return { rows: rows.map((r) => ({ ...toPartnerProfile(r), email: r.email, totals: toTotals(r) })) };
  });

  app.post('/admin/partners', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid partner' });
    const { email, code, name, instagram, commissionPercent } = body.data;

    const [user] = await sql<{ id: string }[]>`select id from public.users where lower(email) = ${email}`;
    if (!user) {
      return reply.code(404).send({
        error: 'no_account',
        message: 'No account with this email. Ask the partner to sign up on the website first.',
      });
    }
    const [taken] = await sql<{ code_taken: boolean; user_taken: boolean }[]>`
      select bool_or(code = ${code}) as code_taken, bool_or(user_id = ${user.id}) as user_taken
      from public.partners where code = ${code} or user_id = ${user.id}`;
    if (taken?.code_taken) return reply.code(409).send({ error: 'code_taken', message: 'That code is already in use.' });
    if (taken?.user_taken) return reply.code(409).send({ error: 'already_partner', message: 'This account is already a partner.' });

    const [row] = await sql<{ id: string }[]>`
      insert into public.partners (user_id, code, name, instagram, commission_bps)
      values (${user.id}, ${code}, ${name}, ${instagram ?? ''}, ${percentToBps(commissionPercent)})
      returning id`;
    await audit(req, 'partner.create', row.id, { email, code, commissionPercent });
    return { id: row.id };
  });

  app.get<{ Params: { id: string } }>('/admin/partners/:id', async (req, reply): Promise<PartnerDashboard & { email: string }> => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send(notFound);
    const [dashboard, [owner]] = await Promise.all([
      partnerDashboard(req.params.id, true),
      sql<{ email: string }[]>`
        select u.email from public.partners p join public.users u on u.id = p.user_id where p.id = ${req.params.id}`,
    ]);
    if (!dashboard || !owner) return reply.code(404).send(notFound);
    return { ...dashboard, email: owner.email };
  });

  app.patch<{ Params: { id: string } }>('/admin/partners/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send(notFound);
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid update' });
    const { name, instagram, commissionPercent, active } = body.data;
    const [row] = await sql`
      update public.partners set
        name = coalesce(${name ?? null}, name),
        instagram = coalesce(${instagram ?? null}, instagram),
        commission_bps = coalesce(${commissionPercent === undefined ? null : percentToBps(commissionPercent)}::int, commission_bps),
        active = coalesce(${active ?? null}::boolean, active)
      where id = ${req.params.id}
      returning id`;
    if (!row) return reply.code(404).send(notFound);
    await audit(req, 'partner.update', req.params.id, body.data);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/partners/:id/payouts', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send(notFound);
    const body = payoutBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid payout' });
    const { amount, reference, note } = body.data;
    const [row] = await sql<{ id: string }[]>`
      insert into public.partner_payouts (partner_id, amount, reference, note, created_by)
      select id, ${amount}, ${reference ?? ''}, ${note ?? ''}, ${req.admin.email} from public.partners where id = ${req.params.id}
      returning id`;
    if (!row) return reply.code(404).send(notFound);
    await audit(req, 'partner.payout', req.params.id, { payoutId: row.id, amount, reference });
    return { id: row.id };
  });

  // For a payout recorded by mistake.
  app.delete<{ Params: { id: string; payoutId: string } }>('/admin/partners/:id/payouts/:payoutId', async (req, reply) => {
    const { id, payoutId } = req.params;
    if (!uuid.safeParse(id).success || !uuid.safeParse(payoutId).success) return reply.code(404).send(notFound);
    const [row] = await sql<{ amount: number }[]>`
      delete from public.partner_payouts where id = ${payoutId} and partner_id = ${id} returning amount`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such payout' });
    await audit(req, 'partner.payout.delete', id, { payoutId, amount: row.amount });
    return { ok: true };
  });
}
