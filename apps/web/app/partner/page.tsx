'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BadgeIndianRupee, Check, Copy, Handshake, Info, Link2, MousePointerClick, Receipt, UserPlus, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  REFERRAL_ACCOUNT_MAX_AGE_DAYS, REFERRAL_COOKIE_DAYS, formatInr, partnerPath, type DayPoint, type PartnerDashboard,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Card, Pill } from '@/components/ui';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="glass min-w-0 rounded-2xl p-4">
      <p className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} className="text-brand" /> {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-faint">{hint}</p>}
    </div>
  );
}

/** 30 daily bars; hover a bar for the day and value. */
function Bars({ title, points, format = String }: { title: string; points: DayPoint[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted">{title}</p>
        <p className="text-sm font-semibold tabular-nums">{format(total)}</p>
      </div>
      <div className="mt-3 flex h-20 items-end gap-[3px]" role="img" aria-label={`${title}: ${format(total)} in the last 30 days`}>
        {points.map((p) => (
          <div
            key={p.day}
            title={`${dayLabel(p.day)}: ${format(p.value)}`}
            className={`flex-1 rounded-sm ${p.value ? 'bg-brand/80 hover:bg-brand' : 'bg-white/[0.06]'}`}
            style={{ height: p.value ? `${Math.max(8, (p.value / max) * 100)}%` : '4px' }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{dayLabel(points[0]?.day ?? '')}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Table({ head, children, empty }: { head: string[]; children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead>
          <tr className="border-y border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-5 py-2.5 font-medium ${i > 1 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}${partnerPath(code)}`;
  const copy = () =>
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-sm">{url}</code>
      <button onClick={copy} className="btn btn-primary shrink-0">
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

export default function PartnerPage() {
  const email = useRequireSession();
  const [data, setData] = useState<PartnerDashboard | null>(null);
  const [error, setError] = useState<{ notPartner: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!email) return;
    api<PartnerDashboard>('/v1/partner').then(setData, (e) =>
      setError({
        notPartner: e instanceof ApiError && e.status === 404,
        message: e instanceof ApiError ? e.message : 'Something went wrong. Try again.',
      }),
    );
  }, [email]);

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const p = data?.partner;
  const t = data?.totals;

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-sm text-muted">Partner programme</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{p ? p.name : 'Partner dashboard'}</h1>
            {p && (p.active ? <Pill tone="ok">Active</Pill> : <Pill tone="warn">Paused</Pill>)}
          </div>
          {p?.instagram && (
            <a
              href={`https://instagram.com/${p.instagram}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-sm text-muted hover:text-fg"
            >
              @{p.instagram}
            </a>
          )}
        </header>

        {error && (
          <Card>
            {error.notPartner ? (
              <div className="flex items-start gap-3 text-sm">
                <Handshake size={18} className="mt-0.5 shrink-0 text-brand" />
                <p className="text-muted">
                  This page is for Friday AI partners. If you create content and would like to share Friday AI with your
                  audience, <Link href="/contact" className="font-medium text-brand hover:underline">get in touch</Link>.
                </p>
              </div>
            ) : (
              <p className="text-sm text-danger">{error.message}</p>
            )}
          </Card>
        )}

        {!data && !error && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="glass h-[104px] animate-pulse rounded-2xl" />
            ))}
          </div>
        )}

        {data && p && t && (
          <>
            <Card title="Your invite link" icon={Link2}>
              <InviteLink code={p.code} />
              <p className="mt-3 text-sm text-muted">
                You earn <span className="font-semibold text-fg">{p.commissionPercent}%</span> of every payment made by
                people who sign up through this link.
                {!p.active && ' Your link is paused right now: new sign-ups and payments are not credited.'}
              </p>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat icon={MousePointerClick} label="Link clicks" value={t.clicks.toLocaleString('en-IN')} hint="All time" />
              <Stat icon={UserPlus} label="Sign-ups" value={t.signups.toLocaleString('en-IN')} hint="People who joined through you" />
              <Stat icon={Users} label="Paying users" value={t.payingUsers.toLocaleString('en-IN')} hint="Made at least one payment" />
              <Stat icon={Receipt} label="Their payments" value={formatInr(t.revenue)} hint="Refunds excluded" />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Stat icon={BadgeIndianRupee} label="You earned" value={formatInr(t.earned)} hint="All time" />
              <Stat icon={Check} label="Paid to you" value={formatInr(t.paidOut)} />
              <Stat
                icon={Wallet}
                label="Balance due"
                value={<span className={t.balance > 0 ? 'text-brand' : ''}>{formatInr(Math.max(t.balance, 0))}</span>}
                hint={t.balance < 0 ? `${formatInr(-t.balance)} refunded after payout, deducted next time` : 'Paid out by the Friday AI team'}
              />
            </div>

            <Card title="Last 30 days">
              <div className="grid gap-8 md:grid-cols-3">
                <Bars title="Link clicks" points={data.series.clicks} />
                <Bars title="Sign-ups" points={data.series.signups} />
                <Bars title="Earned" points={data.series.earned} format={formatInr} />
              </div>
            </Card>

            <Card title="People you referred" icon={Users}>
              <Table head={['Person', 'Joined', 'Paid', 'Your commission']} empty="Nobody has signed up through your link yet.">
                {data.referrals.map((r) => (
                  <tr key={r.label}>
                    <td className="px-5 py-3 font-medium">{r.label}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{shortDate(r.joinedAt)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.paid ? formatInr(r.paid) : <span className="text-faint">–</span>}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.commission ? formatInr(r.commission) : <span className="text-faint">–</span>}</td>
                  </tr>
                ))}
              </Table>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Commission by payment" icon={Receipt}>
                <Table head={['Date', 'Person', 'Payment', 'Commission']} empty="No payments yet.">
                  {data.earnings.map((e, i) => (
                    <tr key={i} className={e.status === 'refunded' ? 'text-faint' : ''}>
                      <td className="whitespace-nowrap px-5 py-3">{shortDate(e.paidAt)}</td>
                      <td className="px-5 py-3">{e.label}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatInr(e.amount)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {e.status === 'refunded' ? (
                          <span title="Refunded, so not counted">
                            <s>{formatInr(e.commission)}</s> <span className="text-xs">refunded</span>
                          </span>
                        ) : (
                          formatInr(e.commission)
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>

              <Card title="Payouts" icon={Wallet}>
                <Table head={['Date', 'Reference', 'Amount']} empty="No payouts yet.">
                  {data.payouts.map((o) => (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap px-5 py-3">{shortDate(o.paidAt)}</td>
                      <td className="max-w-[200px] truncate px-5 py-3 text-muted" title={o.note || undefined}>{o.reference || '–'}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatInr(o.amount)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>

            <Card title="How it's counted" icon={Info}>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                <li>A click counts once per visitor per hour.</li>
                <li>
                  Someone counts as your referral if they sign up within {REFERRAL_COOKIE_DAYS} days of opening your link in
                  the same browser. Only new accounts count (up to {REFERRAL_ACCOUNT_MAX_AGE_DAYS} days old, before their
                  first payment). If they opened another partner&apos;s link first, they belong to that partner.
                </li>
                <li>You earn your commission rate on every payment they make, at the rate in effect on the day they pay.</li>
                <li>If a payment is refunded, its commission no longer counts.</li>
                <li>Referred people are shown without their names or emails, to protect their privacy.</li>
              </ul>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
