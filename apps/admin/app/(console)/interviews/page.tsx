'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { ROUND_TYPES, type AdminInterviewRow, type Paged } from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { ago, int } from '@/lib/format';
import { useAsync, useDebounced } from '@/lib/useAsync';
import { Card, Drawer, Empty, ErrorNote, PageHeader, Pager, selectCls, Spinner, Table } from '@/components/ui';

const roundLabel = (id: string) => ROUND_TYPES.find((r) => r.id === id)?.label ?? id;

function JobDescription({ row, onClose }: { row: AdminInterviewRow | null; onClose: () => void }) {
  const [r] = useAsync(
    () => (row ? adminApi<{ jobDescription: string }>(`/admin/interviews/${row.id}`) : Promise.resolve(null)),
    [row?.id],
  );
  return (
    <Drawer open={row !== null} onClose={onClose} title={row ? [row.role, row.company].filter(Boolean).join(' at ') || 'Interview' : ''}>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {r.state === 'loading' ? (
        <Spinner className="text-muted" />
      ) : (
        <>
          <h3 className="eyebrow">Job description</h3>
          <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 text-sm">
            {r.data?.jobDescription || <span className="text-faint">(none provided)</span>}
          </p>
        </>
      )}
    </Drawer>
  );
}

export default function InterviewsPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [round, setRound] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminInterviewRow | null>(null);

  useEffect(() => setPage(1), [q, round]);
  const [r] = useAsync(() => adminApi<Paged<AdminInterviewRow>>(`/admin/interviews${qs({ q, round, page })}`), [q, round, page]);
  const d = r.data;

  return (
    <>
      <PageHeader title="Interviews" subtitle="Interview setups users are preparing for (field, organisation, role, round, job description)." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input className="input !py-2 !pl-9 !text-sm" placeholder="Search email, field, company or role" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className={selectCls} value={round} onChange={(e) => setRound(e.target.value)} aria-label="Round">
          <option value="">Any round</option>
          {ROUND_TYPES.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.label}
            </option>
          ))}
        </select>
        {r.state === 'loading' && <Spinner className="text-muted" />}
      </div>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>No interview setups match.</Empty>
        ) : (
          <Table head={['User', 'Field', 'Role', 'Organisation', 'Round', 'Job description', 'Updated']}>
            {d?.rows.map((i) => (
              <tr key={i.id} className="cursor-pointer transition hover:bg-white/[0.02]" onClick={() => setOpen(i)}>
                <td className="max-w-[220px] truncate px-5 py-3">
                  <Link href={`/users/${i.userId}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand">
                    {i.userEmail}
                  </Link>
                </td>
                <td className="px-5 py-3">{i.field || <span className="text-faint">–</span>}</td>
                <td className="px-5 py-3">{i.role || <span className="text-faint">–</span>}</td>
                <td className="px-5 py-3">{i.company || <span className="text-faint">–</span>}</td>
                <td className="whitespace-nowrap px-5 py-3">{roundLabel(i.roundType)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{i.jdChars ? `${int(i.jdChars)} chars` : '–'}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{ago(i.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
      <JobDescription row={open} onClose={() => setOpen(null)} />
    </>
  );
}
