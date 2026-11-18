'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Star } from 'lucide-react';
import {
  FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, type AdminFeedback, type FeedbackKind, type FeedbackStatus, type Paged,
} from '@parakeet/shared';
import { adminApi, qs } from '@/lib/api';
import { dateTime, int } from '@/lib/format';
import { useAction, useAsync, useDebounced } from '@/lib/useAsync';
import { Card, Drawer, Empty, ErrorNote, PageHeader, Pager, Pill, selectCls, Spinner, Table, type Tone } from '@/components/ui';

const KIND_TONE: Record<FeedbackKind, Tone> = { review: 'ok', idea: 'neutral', bug: 'bad', other: 'neutral' };
const STATUS: Record<FeedbackStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'warn' },
  approved: { label: 'Shown on site', tone: 'ok' },
  hidden: { label: 'Hidden', tone: 'neutral' },
  done: { label: 'Done', tone: 'neutral' },
};

function Stars({ n }: { n: number | null }) {
  if (n === null) return <span className="text-faint">–</span>;
  return (
    <span className="inline-flex gap-0.5 text-warn" aria-label={`${n} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={13} fill={i < n ? 'currentColor' : 'none'} className={i < n ? '' : 'text-faint'} />
      ))}
    </span>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

function FeedbackDrawer({ item, onClose, onSaved }: { item: AdminFeedback | null; onClose: () => void; onSaved: (f: AdminFeedback) => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  useEffect(() => setNote(item?.adminNote ?? ''), [item?.id, item?.adminNote]);

  const save = (patch: { status?: FeedbackStatus; adminNote?: string }) =>
    item &&
    act.run(patch.status ?? 'note', async () =>
      onSaved(await adminApi<AdminFeedback>(`/admin/feedback/${item.id}/review`, { method: 'POST', body: JSON.stringify(patch) })),
    );
  const review = item?.kind === 'review';

  return (
    <Drawer open={item !== null} onClose={onClose} title={review ? 'Review' : 'Feedback'}>
      {item && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Meta label="User">
              <Link href={`/users/${item.userId}`} className="hover:text-brand" onClick={onClose}>
                {item.userEmail}
              </Link>
            </Meta>
            <Meta label="Sent">{dateTime(item.updatedAt)}</Meta>
            <Meta label="Type">
              <Pill tone={KIND_TONE[item.kind]}>{FEEDBACK_KIND_LABELS[item.kind]}</Pill>
            </Meta>
            <Meta label="Status">
              <Pill tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Pill>
            </Meta>
            {review && (
              <>
                <Meta label="Rating">
                  <Stars n={item.rating} />
                </Meta>
                <Meta label="May be published">{item.publish ? 'Yes, user agreed' : 'No'}</Meta>
                <Meta label="Shown as">{item.displayName || '–'}</Meta>
                <Meta label="Role">{item.role || '–'}</Meta>
              </>
            )}
          </dl>
          <section>
            <h3 className="eyebrow">Message</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 text-sm">{item.message}</p>
          </section>
          {review && !item.publish && (
            <p className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm text-muted">
              The user didn’t agree to publishing, so this review can’t be shown on the website.
            </p>
          )}
          <section>
            <h3 className="eyebrow">Review</h3>
            <textarea
              className="input mt-2 min-h-24 !text-sm"
              placeholder="Internal note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            {act.error && <ErrorNote>{act.error}</ErrorNote>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {review ? (
                <>
                  <button
                    className="btn btn-primary !py-2 !text-sm"
                    disabled={!!act.busy || !item.publish}
                    onClick={() => save({ status: 'approved', adminNote: note })}
                  >
                    Show on website
                  </button>
                  <button className="btn btn-secondary !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'hidden', adminNote: note })}>
                    Hide
                  </button>
                </>
              ) : (
                <button className="btn btn-primary !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'done', adminNote: note })}>
                  Mark done
                </button>
              )}
              {item.status !== 'new' && (
                <button className="btn btn-ghost !py-2 !text-sm" disabled={!!act.busy} onClick={() => save({ status: 'new', adminNote: note })}>
                  Back to new
                </button>
              )}
              <button className="btn btn-ghost !py-2 !text-sm" disabled={!!act.busy || note === item.adminNote} onClick={() => save({ adminNote: note })}>
                Save note
              </button>
              {act.busy && <Spinner className="text-muted" />}
            </div>
            {item.reviewedBy && (
              <p className="mt-3 text-xs text-muted">
                Last reviewed by {item.reviewedBy} on {dateTime(item.reviewedAt)}
              </p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function FeedbackPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('new');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminFeedback | null>(null);

  useEffect(() => setPage(1), [q, status, kind]);

  const [r, reload] = useAsync(
    () => adminApi<Paged<AdminFeedback> & { pending: number; average: number | null }>(`/admin/feedback${qs({ q, status, kind, page })}`),
    [q, status, kind, page],
  );
  const d = r.data;

  return (
    <>
      <PageHeader
        title="Reviews & feedback"
        subtitle={
          d
            ? `${int(d.pending)} new · average rating ${d.average ?? '–'} · approved reviews appear on the website`
            : 'Ratings, reviews and suggestions from users'
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input className="input !py-2 !pl-9 !text-sm" placeholder="Search email, name or message" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="approved">Shown on site</option>
          <option value="hidden">Hidden</option>
          <option value="done">Done</option>
        </select>
        <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {FEEDBACK_KINDS.map((x) => (
            <option key={x} value={x}>
              {FEEDBACK_KIND_LABELS[x]}
            </option>
          ))}
        </select>
        {r.state === 'loading' && <Spinner className="text-muted" />}
      </div>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}

      <Card pad={false}>
        {d && d.rows.length === 0 ? (
          <Empty>{status === 'new' ? 'Nothing new.' : 'No feedback matches.'}</Empty>
        ) : (
          <Table head={['When', 'User', 'Type', 'Rating', 'Message', 'Status']}>
            {d?.rows.map((x) => (
              <tr key={x.id} onClick={() => setOpen(x)} className="cursor-pointer align-top hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(x.updatedAt)}</td>
                <td className="max-w-[200px] truncate px-5 py-3">{x.userEmail}</td>
                <td className="px-5 py-3">
                  <Pill tone={KIND_TONE[x.kind]}>{FEEDBACK_KIND_LABELS[x.kind]}</Pill>
                </td>
                <td className="px-5 py-3">
                  <Stars n={x.rating} />
                </td>
                <td className="max-w-[360px] truncate px-5 py-3 text-muted">{x.message}</td>
                <td className="px-5 py-3">
                  <Pill tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Pill>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
      </Card>
      <FeedbackDrawer
        item={open}
        onClose={() => setOpen(null)}
        onSaved={(saved) => {
          setOpen(saved);
          reload();
        }}
      />
    </>
  );
}
