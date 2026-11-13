import { AUTO_APPLY_PROVIDERS, resolveChannel, type ApplyChannel } from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { hasCredential } from './credentials.js';

// Which channel an application goes through (packages/shared/src/applyPipeline.ts resolveChannel), from
// what is actually in place for it: an employer credential, an operator-enabled server-side form
// filler, a connected browser extension. Enforced again at every claim (routes/applier.ts, the
// extension's claim, queues/submit.ts): a row is only ever sent through the channel stored on it.

/** A browser seen this recently is taken to be running the extension (same as autoApplyReports.ts). */
const BROWSER_ACTIVE_DAYS = 3;

export function cloudFormProviders(raw = env.AUTO_APPLY_CLOUD_FORM_PROVIDERS): Set<string> {
  return new Set(raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean));
}

export interface ChannelContext {
  provider: string;
  board: string | null;
  userId: string;
}

export async function channelFor(c: ChannelContext, opts: { skipApi?: boolean } = {}): Promise<ApplyChannel> {
  const [[s], [d]] = await Promise.all([
    sql<{ cloud_submit: boolean }[]>`select cloud_submit from public.auto_apply_settings where user_id = ${c.userId}`,
    sql<{ n: number }[]>`
      select count(*)::int as n from public.auto_apply_devices
      where user_id = ${c.userId} and revoked_at is null and last_seen_at > now() - make_interval(days => ${BROWSER_ACTIVE_DAYS})`,
  ]);
  return resolveChannel({
    provider: c.provider,
    hasApiCredential: !opts.skipApi && (await hasCredential(c.provider, c.board)),
    cloudFormEnabled: cloudFormProviders().has(c.provider) && Boolean(s?.cloud_submit),
    // Only with a browser to do it: otherwise the candidate submits (Assisted).
    extensionSupported: (AUTO_APPLY_PROVIDERS as readonly string[]).includes(c.provider) && d.n > 0,
  });
}

export const ASSISTED_REASON =
  'No automatic route is available for this job board: apply on the employer’s page with the resume Friday prepared, then confirm it here.';
