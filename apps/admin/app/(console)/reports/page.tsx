'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  REPORT_REASON_LABELS, REPORT_REASONS, type AdminReport, type Paged, type ReportReason, type ReportStatus,
} from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { dateTime, int } from '@/lib/format';
import { useAction, useAsync, useDebounced } from '@/lib/useAsync';
import { Card, Drawer, Empty, ErrorNote, PageHeader, Pager, Pill, selectCls, Spinner, Table, type Tone } from '@/components/ui';

const REASON_TONE: Record<ReportReason, Tone> = { harmful: 'bad', inappropriate: 'bad', misleading: 'warn', other: 'neutral' };
const STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'warn' },
  actioned: { label: 'Actioned', tone: 'ok' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

function ReportDrawer({ report, onClose, onSaved }: { report: AdminReport | null; onClose: () => void; onSaved: (r: AdminReport) => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  useEffect(() => setNote(report?.adminNote ?? ''), [report?.id, report?.adminNote]);

  const save = (patch: { status?: ReportStatus; adminNote?: string }) =>
    report &&
    act.run(patch.status ?? 'note', async () =>
      onSaved(await adminApi<AdminReport>(`/admin/reports/${report.id}/review`, { method: 'POST', body: JSON.stringify(patch) })),
    );

  return (
    <Drawer open={report !== null} onClose={onClose} title="Reported response">
      {report && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Meta label="User">
              <Link href={`/users/${report.userId}`} className="hover:text-brand" onClick={onClose}>
                {report.userEmail}
              </Link>
            </Meta>
            <Meta label="Reported">{dateTime(report.createdAt)}</Meta>
            <Meta label="Reason">
              <Pill tone={REASON_TONE[report.reason]}>{REPORT_REASON_LABELS[report.reason]}</Pill>
            </Meta>
            <Meta label="Status">
              <Pill tone={STATUS[report.status].tone}>{STATUS[report.status].label}</Pill>
            </Meta>
            <Meta label="Model">
              <span className="font-mono text-xs">{report.model ?? '–'}</span>
            </Meta>
            <Meta label="Response id">
              <span className="font-mono text-xs" title={report.turnId}>
                {report.turnId}
              </span>
            </Meta>
          </dl>
          {!report.liveTurnId && (
            <p className="rounded-xl border border-warn/25 bg-warn/5 px-4 py-3 text-sm text-warn">
              No recorded answer matched this report, so the text below is what the user’s app sent.
            </p>
          )}
          <section>
            <h3 className="eyebrow">User’s details</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 text-sm">
              {report.details || <span className="text-faint">(none given)</span>}
            </p>
          </section>
          <section>
            <h3 className="eyebrow">Question</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 text-sm">
              {report.question || <span className="text-faint">(screenshot only, images are not stored)</span>}
            </p>
          </section>
          <section>
            <h3 className="eyebrow">Answer</h3>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-line bg-bg p-4 font-sans text-sm leading-relaxed">
              {report.answer || <span className="text-faint">(no answer text)</span>}
            </pre>
          </section>
          <section>
            <h3 className="eyebrow">Review</h3>
            <textarea
              className="input mt-2 min-h-24 !text-sm"
              placeholder="Internal note: what was done about it"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            {act.error && <ErrorNote>{act.error}</ErrorNote>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'actioned', adminNote: note })}>
                Mark actioned
              </button>
              <button className="btn btn-secondary !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'dismissed', adminNote: note })}>
                Dismiss
              </button>
              {report.status !== 'open' && (
                <button className="btn btn-ghost !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'open', adminNote: note })}>
                  Reopen
                </button>
              )}
              <button className="btn btn-ghost !py-2 !text-sm" disabled={!!act.busy || note === report.adminNote} onClick={() => save({ adminNote: note })}>
                Save note
              </button>
              {act.busy && <Spinner className="text-muted" />}
            </div>
            {report.reviewedBy && (
              <p className="mt-3 text-xs text-muted">
                Last reviewed by {report.reviewedBy} on {dateTime(report.reviewedAt)}
              </p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('open');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminReport | null>(null);

  useEffect(() => setPage(1), [q, status, reason]);

  const [r, reload] = useAsync(
    () => adminApi<Paged<AdminReport> & { open: number }>(`/admin/reports${qs({ q, status, reason, page })}`),
    [q, status, reason, page],
  );
  const d = r.data;

  return (
    <>
      <PageHeader
        title="Reported responses"
        subtitle={d ? `${int(d.open)} open · AI answers users flagged from the desktop app` : 'AI answers users flagged from the desktop app'}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            className="input !py-2 !pl-9 !text-sm"
            placeholder="Search email, details, question or answer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="actioned">Actioned</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select className={selectCls} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
          <option value="">All reasons</option>
          {REPORT_REASONS.map((x) => (
            <option key={x} value={x}>
              {REPORT_REASON_LABELS[x]}
            </option>
          ))}
        </select>
        {r.state === 'loading' && <Spinner className="text-muted" />}
      </div>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>{status === 'open' ? 'No open reports.' : 'No reports match.'}</Empty>
        ) : (
          <Table head={['When', 'User', 'Reason', 'Details', 'Answer', 'Status']}>
            {d?.rows.map((x) => (
              <tr key={x.id} onClick={() => setOpen(x)} className="cursor-pointer align-top hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(x.createdAt)}</td>
                <td className="max-w-[200px] truncate px-5 py-3">{x.userEmail}</td>
                <td className="px-5 py-3">
                  <Pill tone={REASON_TONE[x.reason]}>{REPORT_REASON_LABELS[x.reason]}</Pill>
                </td>
                <td className="max-w-[240px] truncate px-5 py-3 text-muted">{x.details || '–'}</td>
                <td className="max-w-[320px] truncate px-5 py-3 text-muted">{x.answer || '–'}</td>
                <td className="px-5 py-3">
                  <Pill tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Pill>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
      <ReportDrawer
        report={open}
        onClose={() => setOpen(null)}
        onSaved={(saved) => {
          setOpen(saved);
          reload();
        }}
      />
    </>
  );
}
