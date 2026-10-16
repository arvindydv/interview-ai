'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { AuditEntry, Paged } from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Card, Empty, ErrorNote, PageHeader, Pager, Pill, Table, type Tone } from '@/components/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tone(action: string): Tone {
  if (/delete|suspend|clean/.test(action) && !action.includes('unsuspend')) return 'bad';
  if (action.startsWith('settings')) return 'info';
  return 'neutral';
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [r] = useAsync(() => adminApi<Paged<AuditEntry>>(`/admin/audit${qs({ page })}`), [page]);
  const d = r.data;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change made from this console." />
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>No admin actions yet.</Empty>
        ) : (
          <Table head={['When', 'Admin', 'Action', 'Target', 'Details']}>
            {d?.rows.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(a.createdAt)}</td>
                <td className="px-5 py-3">{a.adminEmail}</td>
                <td className="px-5 py-3">
                  <Pill tone={tone(a.action)}>{a.action}</Pill>
                </td>
                <td className="px-5 py-3 font-mono text-xs">
                  {a.target && UUID.test(a.target) && !a.action.endsWith('delete') ? (
                    <Link href={`/users/${a.target}`} className="hover:text-brand">
                      {a.target.slice(0, 8)}…
                    </Link>
                  ) : (
                    a.target ?? '–'
                  )}
                </td>
                <td className="max-w-md px-5 py-3 font-mono text-xs break-all text-muted">
                  {Object.keys(a.details).length ? JSON.stringify(a.details) : '–'}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
    </>
  );
}
