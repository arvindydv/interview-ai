'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronDown, ExternalLink, FileText, RotateCcw, Trash2 } from 'lucide-react';
import {
  AUTO_APPLY_STATUS_LABELS, type AutoApplication, type AutoApplicationDetail, type AutoApplyStatus, type FormQuestion,
} from '@parakeet/shared';
import { Spinner } from './ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

// Auto Apply's applications by status, with what each needs and its full history.

export const TABS: { id: AutoApplyStatus; hint: string }[] = [
  { id: 'pending', hint: 'Being submitted, or waiting for you' },
  { id: 'prepared', hint: 'Ready; your browser submits these' },
  { id: 'submitted', hint: 'The job board confirmed them' },
  { id: 'preparing', hint: 'Tailoring the resume and answering the form' },
  { id: 'failed', hint: 'Couldn’t be prepared or submitted' },
  { id: 'skipped', hint: 'Not sent' },
];

const TONE: Record<AutoApplyStatus, string> = {
  preparing: 'bg-surface-2 text-muted',
  prepared: 'bg-cyan-50 text-cyan-800',
  pending: 'bg-amber-50 text-amber-800',
  submitted: 'bg-emerald-50 text-emerald-800',
  failed: 'bg-red-50 text-red-700',
  skipped: 'bg-surface-2 text-faint',
};

function AnswerForm({ id, questions, onDone }: { id: string; questions: FormQuestion[]; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/auto-apply/applications/${id}/answers`, { method: 'POST', body: JSON.stringify({ answers: values }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      <p className="text-xs text-muted">Only you can answer these. Your answers are saved for the same question on other forms.</p>
      {questions.map((q) => (
        <label key={q.key} className="block text-sm">
          <span className="font-medium">{q.label}</span>
          {q.description && <span className="mt-0.5 block text-xs text-muted">{q.description}</span>}
          <div className="mt-1.5">
            {q.type === 'multiselect' ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {q.options.map((o) => {
                  const list = (values[q.key] as string[] | undefined) ?? [];
                  return (
                    <label key={o} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={list.includes(o)}
                        onChange={(e) => setValues({ ...values, [q.key]: e.target.checked ? [...list, o] : list.filter((x) => x !== o) })}
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            ) : q.options.length ? (
              <select value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input !py-2">
                <option value="" disabled>
                  Choose…
                </option>
                {q.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : q.type === 'textarea' ? (
              <textarea rows={3} value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input" />
            ) : (
              <input value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input !py-2" />
            )}
          </div>
        </label>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      <button onClick={submit} disabled={busy} className="btn btn-brand !py-1.5 !text-xs">
        {busy ? <Spinner /> : 'Save answers'}
      </button>
    </div>
  );
}

function Row({ app, onChange }: { app: AutoApplication; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AutoApplicationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsAnswers = app.status === 'pending' && app.reasonCode === 'needs_answers' && app.missing.length > 0;

  useEffect(() => {
    if (open && !detail) api<AutoApplicationDetail>(`/v1/auto-apply/applications/${app.id}`).then(setDetail, () => {});
  }, [open, detail, app.id]);

  async function act(action: 'retry' | 'skip' | 'confirm') {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/auto-apply/applications/${app.id}/${action}`, { method: 'POST', body: '{}' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canRetry = app.status === 'failed' || (app.status === 'skipped' && ['expired', 'removed_by_user'].includes(app.reasonCode ?? '')) ||
    (app.status === 'pending' && ['captcha', 'login_required'].includes(app.reasonCode ?? ''));
  const canSkip = ['preparing', 'prepared', 'failed'].includes(app.status) || (app.status === 'pending' && app.reasonCode !== 'submitting');

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{app.title}</p>
          <p className="text-sm text-muted">
            {app.company}
            {app.score !== null && <> · {app.score}% match</>} · {timeAgo(app.updatedAt)}
          </p>
          {app.reason && (
            <p className={`mt-1.5 flex items-start gap-1.5 text-sm ${app.status === 'failed' ? 'text-danger' : app.status === 'pending' ? 'text-amber-800' : 'text-muted'}`}>
              {app.status !== 'skipped' && <AlertCircle size={14} className="mt-0.5 shrink-0" />} {app.reason}
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${TONE[app.status]}`}>{AUTO_APPLY_STATUS_LABELS[app.status]}</span>
      </div>

      {needsAnswers && <AnswerForm id={app.id} questions={app.missing} onDone={onChange} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {app.status === 'pending' && app.reasonCode === 'unverified' && (
          <button disabled={busy} onClick={() => act('confirm')} className="btn btn-brand !py-1.5 !text-xs">
            I got the confirmation
          </button>
        )}
        {app.status === 'pending' && (app.reasonCode === 'captcha' || app.reasonCode === 'login_required' || app.reasonCode === 'unverified') && (
          <a href={app.applyUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary !py-1.5 !text-xs">
            Open the form <ExternalLink size={13} />
          </a>
        )}
        {canRetry && (
          <button disabled={busy} onClick={() => act('retry')} className="btn btn-secondary !py-1.5 !text-xs">
            <RotateCcw size={13} /> Try again
          </button>
        )}
        {app.listingId && (
          <Link href={`/resume/${app.listingId}`} className="btn btn-ghost !py-1.5 !text-xs">
            <FileText size={13} /> Tailored resume
          </Link>
        )}
        {canSkip && (
          <button disabled={busy} onClick={() => act('skip')} className="btn btn-ghost !py-1.5 !text-xs">
            <Trash2 size={13} /> Don’t send
          </button>
        )}
        <button onClick={() => setOpen(!open)} className="btn btn-ghost ml-auto !py-1.5 !text-xs">
          Details <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {open && (
        <div className="mt-3 grid gap-4 rounded-xl bg-surface-2/60 p-3 text-sm sm:grid-cols-2">
          {!detail ? (
            <Spinner className="text-muted" />
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold tracking-wider text-faint uppercase">Answers</p>
                <dl className="mt-2 space-y-2">
                  {detail.answers.map((a) => (
                    <div key={a.key}>
                      <dt className="text-xs text-muted">{a.label}</dt>
                      <dd className="whitespace-pre-line">
                        {a.value === null ? <span className="text-faint">Left blank</span> : Array.isArray(a.value) ? a.value.join(', ') : a.value}
                        <span className="ml-1.5 text-[10px] text-faint uppercase">{a.source}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wider text-faint uppercase">History</p>
                <ol className="mt-2 space-y-1.5">
                  {detail.events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-16 shrink-0 text-xs text-faint tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Matches the API's page size. */
const PAGE_SIZE = 30;

export function AutoApplyList({ status, onChange }: { status: AutoApplyStatus; onChange: () => void }) {
  const [items, setItems] = useState<AutoApplication[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const r = await api<{ items: AutoApplication[]; total: number }>(`/v1/auto-apply/applications?status=${status}&page=${page}`);
    setItems(r.items);
    setTotal(r.total);
  }, [status, page]);

  useEffect(() => setPage(1), [status]);
  useEffect(() => {
    setItems(null);
    load().catch(() => setItems([]));
  }, [load]);

  // Keep the list current while work is moving through it.
  useEffect(() => {
    if (status !== 'preparing' && status !== 'pending') return;
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [status, load]);

  if (!items) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner className="text-muted" />
      </div>
    );
  }
  if (!items.length) return <p className="p-8 text-center text-sm text-muted">Nothing here yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <Row
            key={a.id}
            app={a}
            onChange={() => {
              load();
              onChange();
            }}
          />
        ))}
      </ul>
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 border-t border-line p-3 text-xs text-muted">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn btn-ghost !text-xs">
            Previous
          </button>
          Page {page} of {Math.ceil(total / PAGE_SIZE)}
          <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)} className="btn btn-ghost !text-xs">
            Next
          </button>
        </div>
      )}
    </>
  );
}
