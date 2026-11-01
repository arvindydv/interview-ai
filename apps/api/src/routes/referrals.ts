import type { FastifyInstance } from 'fastify';
import { normalizePartnerCode, type PartnerDashboard, type ReferralClaimResult, type ReferralClickResult } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { claimReferral, partnerDashboard, partnerIdForUser, recordClick } from '../lib/partners.js';
import { ensureUser } from '../lib/users.js';

// Referral links (lib/partners.ts). The website's /r/<code> page reports the visit here, keeps the
// code in a cookie, and claims it for the account once the visitor has signed in.

const NO_CODE = { error: 'not_found', message: 'This invite link is not valid.' };

/** Public: counts a visit to a partner's link. */
export async function referralClickRoutes(app: FastifyInstance) {
  app.post('/v1/referrals/click', async (req, reply): Promise<ReferralClickResult> => {
    const code = normalizePartnerCode((req.body as { code?: unknown } | undefined)?.code);
    const name = code && (await recordClick(code, req.ip));
    if (!name) return reply.code(404).send(NO_CODE);
    return { name };
  });
}

export default async function referralRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/v1/referrals/claim', async (req, reply): Promise<ReferralClaimResult> => {
    const code = normalizePartnerCode((req.body as { code?: unknown } | undefined)?.code);
    if (!code) return reply.code(400).send({ error: 'bad_request', message: 'Invalid code' });
    await ensureUser(req);
    const result = await claimReferral(req.user.id, code);
    if (result.attributed) req.log.info({ userId: req.user.id, code }, 'referral attributed');
    return result;
  });

  // The signed-in partner's own numbers. Referred people are anonymous here.
  app.get('/v1/partner', async (req, reply): Promise<PartnerDashboard> => {
    const id = await partnerIdForUser(req.user.id);
    const dashboard = id && (await partnerDashboard(id));
    if (!dashboard) return reply.code(404).send({ error: 'not_partner', message: 'This account is not a partner.' });
    return dashboard;
  });
}
