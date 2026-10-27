import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { FREE_MINUTES, type FreeTrialStatus } from '@parakeet/shared';
import { DISPOSABLE_DOMAINS } from '../data/disposableDomains.js';
import { env } from '../env.js';
import { sql } from './db.js';

// The free trial, once per person (migration 20261028000500_free_trial_once.sql). Accounts start
// with no trial minutes; the desktop app claims them when it registers the computer it runs on. Each
// check closes a cheap way to farm minutes with throwaway accounts:
//   * a computer gets one trial (hashed OS machine id, not our own reinstallable files),
//   * a mailbox gets one trial (Gmail dots and "+tags" don't make a new one),
//   * temporary inboxes get none,
//   * one network can claim only a few in a week, so faking machine ids against the API doesn't scale.
// Claims outlive the account, so deleting it and signing up again doesn't help either.

export const FREE_TRIAL_SECONDS = FREE_MINUTES * 60;
const MAX_CLAIMS_PER_NETWORK = 5;
const NETWORK_WINDOW_DAYS = 7;

const disposable = new Set(DISPOSABLE_DOMAINS.split('\n').filter(Boolean));

/** A temporary-inbox address (including subdomains of one, e.g. x.yopmail.com). */
export function isDisposableEmail(email: string) {
  const parts = email.trim().toLowerCase().split('@')[1]?.split('.') ?? [];
  for (let i = 0; i < parts.length - 1; i++) if (disposable.has(parts.slice(i).join('.'))) return true;
  return false;
}

/** The app already hashes the machine id; hash it again so stored values only mean something here. */
const hash = (value: string) => createHash('sha256').update(`${env.DEVICE_ID_PEPPER ?? ''}:${value}`).digest('hex');

/** IPv6 users get a whole /64 each, so count the prefix rather than the address. */
function networkOf(ip: string) {
  if (!isIPv6(ip)) return ip;
  const full = ip.includes('::') ? expandIPv6(ip) : ip.split(':');
  return full.slice(0, 4).join(':');
}

function expandIPv6(ip: string) {
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
}

export const machineHash = (machineId: string) => hash(`machine:${machineId}`);

/**
 * Grants the free trial to `userId` if this computer, mailbox and network are eligible, and returns
 * the account's trial status. Safe to call on every device registration: a granted trial is never
 * granted twice, and a refused one is looked at again (e.g. on another computer).
 */
export async function claimFreeTrial(userId: string, machineId: string | null, ip: string): Promise<FreeTrialStatus> {
  return sql.begin(async (tx) => {
    const [user] = await tx<{ trial_status: FreeTrialStatus; email: string; email_canonical: string }[]>`
      select trial_status, email, email_canonical from public.users where id = ${userId} for update`;
    if (!user) return 'pending';
    if (user.trial_status === 'granted') return 'granted';

    const refuse = async (status: FreeTrialStatus) => {
      await tx`update public.users set trial_status = ${status} where id = ${userId}`;
      return status;
    };

    if (isDisposableEmail(user.email)) return refuse('disposable_email');
    if (!machineId) return refuse('no_device_id');
    const machine = machineHash(machineId);
    const network = hash(`ip:${networkOf(ip)}`);

    const [machineClaim] = await tx`select 1 from public.trial_claims where machine_hash = ${machine}`;
    if (machineClaim) return refuse('device_used');
    const [emailClaim] = await tx`select 1 from public.trial_claims where email_canonical = ${user.email_canonical}`;
    if (emailClaim) return refuse('email_used');
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.trial_claims
      where ip_hash = ${network} and created_at > now() - make_interval(days => ${NETWORK_WINDOW_DAYS})`;
    if (n >= MAX_CLAIMS_PER_NETWORK) return refuse('network_limit');

    // Two accounts racing on one computer: only one insert wins.
    const claimed = await tx`
      insert into public.trial_claims (machine_hash, user_id, email_canonical, ip_hash)
      values (${machine}, ${userId}, ${user.email_canonical}, ${network})
      on conflict (machine_hash) do nothing returning 1`;
    if (!claimed.length) return refuse('device_used');
    await tx`
      update public.users
      set trial_seconds = trial_seconds + ${FREE_TRIAL_SECONDS}, trial_status = 'granted', trial_granted_at = now()
      where id = ${userId}`;
    return 'granted';
  });
}
