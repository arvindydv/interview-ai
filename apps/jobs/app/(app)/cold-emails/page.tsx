'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Mail, Unplug } from 'lucide-react';
import type { ColdEmail, ColdEmailStatus, GmailStatus } from '@parakeet/shared';
import { Spinner, matchTone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { GMAIL_RESULT, connectGmail, gmailStatus } from '@/lib/gmail';

// Cold emails the user has written and sent (each is written from a job's page), and the Gmail they're
// sent from.

const STATUS: Record<ColdEmailStatus, { label: string; className: string }> = {
  drafting: { label: 'Writing…', className: 'text-sky-700 bg-sky-50 border-sky-200' },
  ready: { label: 'Draft', className: 'text-muted bg-surface-2 border-line' },
  sent: { label: 'Sent', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failed: { label: 'Failed', className: 'text-danger bg-danger/5 border-danger/20' },
};

function GmailCard({ gmail, onChange }: { gmail: GmailStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await connectGmail('/cold-emails');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't connect Gmail.");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/cold-email/gmail', { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't disconnect Gmail. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-4 p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-sky-100 text-sky-700">
        <Mail size={18} />
      </span>
      <div className="min-w-0 flex-1">
        {gmail.email ? (
          <>
            <p className="font-medium">Sending from {gmail.email}</p>
            <p className="text-sm text-muted">
              {gmail.sentToday} of {gmail.dailyLimit} sent today. Friday can send email for you, never read it.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">Connect your Gmail</p>
            <p className="text-sm text-muted">
              {gmail.available
                ? 'Cold emails go from your own address, so recruiters reply to you. Friday can send email for you, never read it.'
                : 'Sending from Gmail isn’t available yet.'}
            </p>
          </>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      {gmail.email ? (
        <button disabled={busy} onClick={disconnect} className="btn btn-ghost !text-xs">
          {busy ? <Spinner /> : <Unplug size={14} />} Disconnect
        </button>
      ) : (
        gmail.available && (
          <button disabled={busy} onClick={connect} className="btn btn-brand !text-xs">
            {busy ? <Spinner /> : <Mail size={14} />} Connect Gmail
          </button>
        )
      )}
    </div>
  );
}

function ColdEmails() {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [items, setItems] = useState<ColdEmail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = resultKey ? GMAIL_RESULT[resultKey] : null;

  const loadGmail = () =>
    gmailStatus().then(
      ({ status, result }) => {
        setGmail(status);
        if (result) setResultKey(result);
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    loadGmail();
    api<{ items: ColdEmail[] }>('/v1/cold-emails').then((r) => setItems(r.items), (e: Error) => setError(e.message));
  }, []);

  const sent = items?.filter((i) => i.status === 'sent').length ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Cold emails</h1>
      <p className="mt-1 text-muted">
        Email a company&rsquo;s recruiter about a job, with your resume tailored to it attached. Open any job and use
        &ldquo;Cold email the hiring team&rdquo;.
      </p>

      {result && (
        <p className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-warn/20 bg-warn/5 text-warn'}`}>
          {result.ok && <CheckCircle2 size={16} />} {result.text}
        </p>
      )}

      <div className="mt-6">{gmail ? <GmailCard gmail={gmail} onChange={loadGmail} /> : <div className="skeleton h-20" />}</div>

      <h2 className="mt-8 mb-3 text-sm font-semibold">
        Your emails {items && <span className="font-normal text-muted">· {sent} sent</span>}
      </h2>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!items ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          No cold emails yet.{' '}
          <Link href="/top" className="font-medium text-fg underline underline-offset-2">
            Find a top match
          </Link>{' '}
          and write your first one.
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((e) => {
            const tone = e.matchScore !== null ? matchTone(e.matchScore) : null;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.listingId ? (
                      <Link href={`/search?job=${e.listingId}`} className="hover:underline">
                        {e.title}
                      </Link>
                    ) : (
                      e.title
                    )}{' '}
                    <span className="font-normal text-muted">at {e.company}</span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {e.status === 'sent' ? `To ${e.toName ? `${e.toName} · ` : ''}${e.to}` : e.error || e.subject || 'No recipient yet'}
                    {' · '}
                    {timeAgo(e.sentAt ?? e.updatedAt)}
                  </p>
                </div>
                {tone && (
                  <span className="text-xs font-semibold tabular-nums" style={{ color: tone.color }}>
                    {e.matchScore}% match
                  </span>
                )}
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[e.status].className}`}>{STATUS[e.status].label}</span>
                {e.gmailUrl && (
                  <a href={e.gmailUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !p-1.5" aria-label="Open in Gmail">
                    <ArrowUpRight size={15} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ColdEmailsPage() {
  return <ColdEmails />;
}
