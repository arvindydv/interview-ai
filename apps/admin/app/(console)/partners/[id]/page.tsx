'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Pause, Play, Save, Trash2, Wallet } from 'lucide-react';
import { formatInr, partnerPath, type CreatePayoutInput, type PartnerDashboard, type UpdatePartnerInput } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { date, dateTime, int } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';
import { Card, ErrorNote, Pill, Spinner, Stat, Table } from '@/components/ui';

const WEBSITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://friday-ai.in').replace(/\/$/, '');

type Detail = PartnerDashboard & { email: string };

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [r, reload] = useAsync(() => adminApi<Detail>(`/admin/partners/${id}`), [id]);
  const act = useAction();
  const [edit, setEdit] = useState({ name: '', instagram: '', commissionPercent: '' });
  const [payout, setPayout] = useState({ rupees: '', reference: '', note: '' });

  const d = r.data;
  useEffect(() => {
    if (d) setEdit({ name: d.partner.name, instagram: d.partner.instagram, commissionPercent: String(d.partner.commissionPercent) });
  }, [d]);

  if (!d) return r.state === 'error' ? <ErrorNote>{r.error}</ErrorNote> : <Spinner className="text-muted" />;
  const p = d.partner;
  const t = d.totals;

  const patch = (key: string, body: UpdatePartnerInput, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    act.run(key, () => adminApi(`/admin/partners/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).then((ok) => ok && reload());
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const percent = Number(edit.commissionPercent);
    const rateChanged = percent !== p.commissionPercent;
    patch(
      'save',
      { name: edit.name, instagram: edit.instagram, commissionPercent: percent },
      rateChanged ? `Change the commission from ${p.commissionPercent}% to ${percent}%? Only payments made from now on use the new rate.` : undefined,
    );
  };

  const addPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Math.round(Number(payout.rupees) * 100);
    if (!window.confirm(`Record a payout of ${formatInr(amount)} to ${p.name}? It shows on their dashboard.`)) return;
    const body: CreatePayoutInput = { amount, reference: payout.reference, note: payout.note };
    if (await act.run('payout', () => adminApi(`/admin/partners/${id}/payouts`, { method: 'POST', body: JSON.stringify(body) }))) {
      setPayout({ rupees: '', reference: '', note: '' });
      reload();
    }
  };

  const deletePayout = (payoutId: string, amount: number) => {
    if (!window.confirm(`Delete the ${formatInr(amount)} payout? Only do this if it was recorded by mistake.`)) return;
    act.run(`del-${payoutId}`, () => adminApi(`/admin/partners/${id}/payouts/${payoutId}`, { method: 'DELETE' })).then((ok) => ok && reload());
  };

  return (
    <>
      <Link href="/partners" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={15} /> Partners
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 truncate text-2xl font-semibold tracking-tight">
            {p.name} {p.active ? <Pill tone="ok">active</Pill> : <Pill tone="warn">paused</Pill>}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {d.email}
            {p.instagram && ` · @${p.instagram}`} · partner since {date(p.createdAt)}
          </p>
          <p className="mt-1 font-mono text-xs text-faint">{WEBSITE_URL}{partnerPath(p.code)}</p>
        </div>
        <button
          className="btn btn-ghost"
          disabled={act.busy === 'active'}
          onClick={() =>
            patch(
              'active',
              { active: !p.active },
              p.active ? `Pause ${p.name}? Their link stops crediting new sign-ups and their referrals stop earning.` : undefined,
            )
          }
        >
          {p.active ? <Pause size={16} /> : <Play size={16} />} {p.active ? 'Pause' : 'Resume'}
        </button>
      </header>
      {act.error && <ErrorNote>{act.error}</ErrorNote>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Link clicks" value={t.clicks} />
        <Stat label="Sign-ups" value={t.signups} hint={t.clicks ? `${((t.signups / t.clicks) * 100).toFixed(1)}% of clicks` : undefined} />
        <Stat label="Paying users" value={t.payingUsers} />
        <Stat label="Revenue" value={formatInr(t.revenue)} hint="Paid, refunds excluded" />
        <Stat label="Earned" value={formatInr(t.earned)} />
        <Stat label="Paid out" value={formatInr(t.paidOut)} />
        <Stat label="Owed" value={formatInr(t.balance)} hint={t.balance < 0 ? 'Refunds after a payout' : undefined} />
        <Stat label="Rate" value={`${p.commissionPercent}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Name
              <input className="input mt-1 !text-sm" required maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Instagram
              <input className="input mt-1 !text-sm" maxLength={60} value={edit.instagram} onChange={(e) => setEdit({ ...edit, instagram: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Commission %
              <input
                className="input mt-1 !text-sm" type="number" required min={0.01} max={100} step={0.01}
                value={edit.commissionPercent} onChange={(e) => setEdit({ ...edit, commissionPercent: e.target.value })}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={act.busy === 'save'} className="btn btn-primary">
                {act.busy === 'save' ? <Spinner /> : <Save size={16} />} Save
              </button>
            </div>
          </form>
        </Card>

        <Card title="Record a payout" icon={Wallet}>
          <form onSubmit={addPayout} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Amount (₹)
              <input
                className="input mt-1 !text-sm" type="number" required min={1} step={0.01} value={payout.rupees}
                placeholder={t.balance > 0 ? String(t.balance / 100) : ''}
                onChange={(e) => setPayout({ ...payout, rupees: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted">
              UPI / bank reference
              <input className="input mt-1 !text-sm" maxLength={120} value={payout.reference} onChange={(e) => setPayout({ ...payout, reference: e.target.value })} />
            </label>
            <label className="text-xs text-muted sm:col-span-2">
              Note
              <input className="input mt-1 !text-sm" maxLength={500} value={payout.note} onChange={(e) => setPayout({ ...payout, note: e.target.value })} />
            </label>
            <div>
              <button type="submit" disabled={act.busy === 'payout'} className="btn btn-primary">
                {act.busy === 'payout' ? <Spinner /> : <Wallet size={16} />} Record payout
              </button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Payouts" pad={false}>
        <Table head={['Paid', 'Amount', 'Reference', 'Note', '']}>
          {d.payouts.map((o) => (
            <tr key={o.id}>
              <td className="whitespace-nowrap px-5 py-3">{dateTime(o.paidAt)}</td>
              <td className="px-5 py-3 tabular-nums">{formatInr(o.amount)}</td>
              <td className="px-5 py-3">{o.reference || '–'}</td>
              <td className="max-w-[320px] truncate px-5 py-3 text-muted">{o.note || '–'}</td>
              <td className="px-5 py-3 text-right">
                <button className="btn btn-ghost !p-1.5" aria-label="Delete payout" disabled={act.busy === `del-${o.id}`} onClick={() => deletePayout(o.id, o.amount)}>
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
        {d.payouts.length === 0 && <p className="px-5 py-6 text-sm text-muted">No payouts yet.</p>}
      </Card>

      <Card title={`Referred users (${int(t.signups)})`} pad={false}>
        <Table head={['User', 'Label', 'Joined', 'Paid', 'Commission']}>
          {d.referrals.map((u) => (
            <tr key={u.userId}>
              <td className="px-5 py-3">
                <Link href={`/users/${u.userId}`} className="font-medium hover:text-brand">{u.email}</Link>
              </td>
              <td className="px-5 py-3 text-muted">{u.label}</td>
              <td className="whitespace-nowrap px-5 py-3 text-muted">{date(u.joinedAt)}</td>
              <td className="px-5 py-3 tabular-nums">{u.paid ? formatInr(u.paid) : '–'}</td>
              <td className="px-5 py-3 tabular-nums">{u.commission ? formatInr(u.commission) : '–'}</td>
            </tr>
          ))}
        </Table>
        {d.referrals.length === 0 && <p className="px-5 py-6 text-sm text-muted">Nobody has signed up through this link yet.</p>}
      </Card>

      <Card title="Commission by payment" pad={false}>
        <Table head={['Paid', 'User', 'Payment', 'Commission', 'Status']}>
          {d.earnings.map((e, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap px-5 py-3">{dateTime(e.paidAt)}</td>
              <td className="px-5 py-3 text-muted">{e.label}</td>
              <td className="px-5 py-3 tabular-nums">{formatInr(e.amount)}</td>
              <td className="px-5 py-3 tabular-nums">{formatInr(e.commission)}</td>
              <td className="px-5 py-3">{e.status === 'paid' ? <Pill tone="ok">paid</Pill> : <Pill tone="bad">refunded</Pill>}</td>
            </tr>
          ))}
        </Table>
        {d.earnings.length === 0 && <p className="px-5 py-6 text-sm text-muted">No payments yet.</p>}
      </Card>
    </>
  );
}
