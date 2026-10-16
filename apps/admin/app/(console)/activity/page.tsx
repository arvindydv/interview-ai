'use client';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { AdminTurn, Paged } from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { int } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/useAsync';
import { TurnDrawer, TurnRow, turnHead } from '@/components/turns';
import { Card, Empty, ErrorNote, PageHeader, Pager, selectCls, Spinner, Table } from '@/components/ui';

const REFRESH_MS = 10_000;

export default function ActivityPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setPage(1), [q, status]);

  const [r, reload] = useAsync(() => adminApi<Paged<AdminTurn>>(`/admin/activity${qs({ q, status, page })}`), [q, status, page]);

  // Auto-refresh the first page so new questions appear as users ask them.
  useEffect(() => {
    if (!live || page !== 1) return;
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, page, reload]);

  const d = r.data;
  return (
    <>
      <PageHeader
        title="Live activity"
        subtitle={d ? `${int(d.total)} questions asked in live interviews` : 'Every question asked in a live interview, with its answer'}
        action={
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-[var(--color-brand)]" />
            Auto-refresh
          </label>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            className="input !py-2 !pl-9 !text-sm"
            placeholder="Search question, email, company or role"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Outcome">
          <option value="">All outcomes</option>
          <option value="done">Answered</option>
          <option value="error">Errors</option>
          <option value="cancelled">Cancelled</option>
          <option value="blocked">Blocked (limit / maintenance)</option>
        </select>
        {r.state === 'loading' && <Spinner className="text-muted" />}
      </div>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>No questions yet. They appear here as soon as someone asks one in the desktop app.</Empty>
        ) : (
          <Table head={turnHead()}>
            {d?.rows.map((t) => <TurnRow key={t.id} t={t} onOpen={() => setOpen(t.id)} />)}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
      <TurnDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}
