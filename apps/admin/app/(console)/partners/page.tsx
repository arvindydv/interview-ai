'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { formatInr, partnerPath, type AdminPartnerRow, type CreatePartnerInput } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { date, int } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';
import { Card, Empty, ErrorNote, PageHeader, Pill, Spinner, Table } from '@/components/ui';

const EMPTY_FORM = { email: '', code: '', name: '', instagram: '', commissionPercent: '20' };

function CreatePartner({ onDone }: { onDone: (id: string) => void }) {
  const [f, setF] = useState(EMPTY_FORM);
  const act = useAction();
  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: CreatePartnerInput = { ...f, commissionPercent: Number(f.commissionPercent) };
    let id = '';
    if (await act.run('create', async () => ({ id } = await adminApi<{ id: string }>('/admin/partners', { method: 'POST', body: JSON.stringify(body) })))) {
      onDone(id);
    }
  };

  return (
    <Card title="New partner">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-muted lg:col-span-2">
          Account email
          <input className="input mt-1 !text-sm" type="email" required value={f.email} onChange={set('email')} placeholder="They sign up on the website first" />
        </label>
        <label className="text-xs text-muted">
          Name
          <input className="input mt-1 !text-sm" required maxLength={80} value={f.name} onChange={set('name')} placeholder="Riya Sharma" />
        </label>
        <label className="text-xs text-muted">
          Instagram
          <input className="input mt-1 !text-sm" maxLength={60} value={f.instagram} onChange={set('instagram')} placeholder="@handle" />
        </label>
        <label className="text-xs text-muted">
          Commission %
          <input className="input mt-1 !text-sm" type="number" required min={0.01} max={100} step={0.01} value={f.commissionPercent} onChange={set('commissionPercent')} />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Link code
          <input
            className="input mt-1 !text-sm"
            required
            pattern="[a-z0-9][a-z0-9_\-]{2,31}"
            title="3–32 lowercase letters, digits, - or _"
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })}
            placeholder="riya"
          />
          {f.code && <span className="mt-1 block text-faint">Link: {partnerPath(f.code)}</span>}
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-3 lg:justify-end">
          <button type="submit" disabled={act.busy === 'create'} className="btn btn-primary">
            {act.busy === 'create' ? <Spinner /> : <Plus size={16} />} Create partner
          </button>
        </div>
      </form>
      {act.error && <div className="mt-3"><ErrorNote>{act.error}</ErrorNote></div>}
    </Card>
  );
}

export default function PartnersPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [r] = useAsync(() => adminApi<{ rows: AdminPartnerRow[] }>('/admin/partners'), []);
  const rows = r.data?.rows;
  const owed = rows?.reduce((s, p) => s + Math.max(p.totals.balance, 0), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Partners"
        subtitle={rows ? `${rows.length} partners · ${formatInr(owed)} owed in total` : undefined}
        action={
          <button className="btn btn-primary" onClick={() => setCreating(!creating)}>
            {creating ? <X size={16} /> : <Plus size={16} />} {creating ? 'Cancel' : 'New partner'}
          </button>
        }
      />
      {creating && <CreatePartner onDone={(id) => router.push(`/partners/${id}`)} />}
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {rows && rows.length === 0 ? (
          <Empty>No partners yet. Create one to give an influencer their invite link.</Empty>
        ) : (
          <Table head={['Partner', 'Code', 'Rate', 'Clicks', 'Sign-ups', 'Paying', 'Revenue', 'Earned', 'Owed', 'Since']}>
            {rows?.map((p) => (
              <tr key={p.id} className="cursor-pointer transition hover:bg-white/[0.02]" onClick={() => router.push(`/partners/${p.id}`)}>
                <td className="max-w-[240px] px-5 py-3">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <span className="truncate">{p.name}</span>
                    {!p.active && <Pill tone="warn">paused</Pill>}
                  </p>
                  <p className="truncate text-xs text-faint">{p.instagram ? `@${p.instagram}` : p.email}</p>
                </td>
                <td className="px-5 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-5 py-3 tabular-nums">{p.commissionPercent}%</td>
                <td className="px-5 py-3 tabular-nums">{int(p.totals.clicks)}</td>
                <td className="px-5 py-3 tabular-nums">{int(p.totals.signups)}</td>
                <td className="px-5 py-3 tabular-nums">{int(p.totals.payingUsers)}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatInr(p.totals.revenue)}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatInr(p.totals.earned)}</td>
                <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums">{formatInr(p.totals.balance)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{date(p.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        {r.state === 'loading' && !rows && <div className="flex justify-center py-10"><Spinner className="text-muted" /></div>}
      </Card>
    </>
  );
}
