'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Search } from 'lucide-react';
import type { AdminUserRow, Paged } from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { ago, date, dateTime, int } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/useAsync';
import { Card, Dot, Empty, ErrorNote, PageHeader, Pager, Pill, selectCls, Spinner, Table } from '@/components/ui';

export default function UsersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [q, status, plan, sort]);

  const [r] = useAsync(
    () => adminApi<Paged<AdminUserRow>>(`/admin/users${qs({ q, status, plan, sort, page })}`),
    [q, status, plan, sort, page],
  );
  const d = r.data;

  return (
    <>
      <PageHeader title="Users" subtitle={d ? `${int(d.total)} matching` : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input className="input !py-2 !pl-9 !text-sm" placeholder="Search email or user ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <input className="input !w-32 !py-2 !text-sm" placeholder="Plan" value={plan} onChange={(e) => setPlan(e.target.value.trim())} aria-label="Plan" />
        <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="">Newest first</option>
          <option value="active">Recently active</option>
          <option value="questions">Most questions</option>
          <option value="email">Email A–Z</option>
        </select>
        {r.state === 'loading' && <Spinner className="text-muted" />}
      </div>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>No users match these filters.</Empty>
        ) : (
          <Table head={['User', 'Plan', 'Status', 'Questions', 'Devices', 'Resume', 'Last active', 'Joined']}>
            {d?.rows.map((u) => (
              <tr key={u.id} className="cursor-pointer transition hover:bg-white/[0.02]" onClick={() => router.push(`/users/${u.id}`)}>
                <td className="max-w-[280px] px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold uppercase text-bg">
                      {u.email[0]}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-medium">
                        <span className="truncate">{u.email}</span>
                        {u.online && <Dot tone="ok" pulse />}
                      </p>
                      <p className="truncate text-xs capitalize text-faint">{u.authProvider}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <Pill tone={u.plan === 'free' ? 'neutral' : 'info'}>{u.plan}</Pill>
                </td>
                <td className="px-5 py-3">
                  <Pill tone={u.status === 'active' ? 'ok' : 'bad'}>{u.status}</Pill>
                </td>
                <td className="px-5 py-3 tabular-nums">{int(u.questions)}</td>
                <td className="px-5 py-3 tabular-nums">{u.devices}</td>
                <td className="px-5 py-3">{u.hasResume ? <Check size={16} className="text-brand" /> : <span className="text-faint">–</span>}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted" title={dateTime(u.lastActiveAt ?? u.lastSignInAt)}>
                  {ago(u.lastActiveAt ?? u.lastSignInAt)}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{date(u.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
    </>
  );
}
