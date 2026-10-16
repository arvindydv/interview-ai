'use client';
import Link from 'next/link';
import { ImageIcon } from 'lucide-react';
import type { AdminTurn, TurnStatus } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { ago, dateTime, int, ms } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Drawer, ErrorNote, Pill, Spinner, type Tone } from './ui';

const statusTone: Record<TurnStatus, Tone> = { done: 'ok', error: 'bad', cancelled: 'neutral', blocked: 'warn' };

export function TurnStatusPill({ status, code }: { status: TurnStatus; code?: string | null }) {
  return (
    <Pill tone={statusTone[status]}>
      {status}
      {code && status !== 'done' ? ` · ${code}` : ''}
    </Pill>
  );
}

/** One question row: when, who, what was asked, the context and the outcome. */
export function TurnRow({ t, onOpen, showUser = true }: { t: AdminTurn; onOpen: () => void; showUser?: boolean }) {
  const target = [t.role, t.company].filter(Boolean).join(' at ');
  return (
    <tr className="cursor-pointer align-top transition hover:bg-white/[0.02]" onClick={onOpen}>
      <td className="whitespace-nowrap px-5 py-3 text-xs text-muted" title={dateTime(t.createdAt)}>
        {ago(t.createdAt)}
      </td>
      {showUser && (
        <td className="max-w-[200px] truncate px-5 py-3">
          <Link href={`/users/${t.userId}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand">
            {t.userEmail}
          </Link>
        </td>
      )}
      <td className="max-w-[360px] px-5 py-3">
        <p className="line-clamp-2">
          {t.imageCount > 0 && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-xs text-accent">
              <ImageIcon size={12} />
              {t.imageCount}
            </span>
          )}
          {t.question || <span className="text-faint">(screenshot only)</span>}
        </p>
        {target && <p className="mt-0.5 truncate text-xs text-faint">{target}</p>}
      </td>
      <td className="whitespace-nowrap px-5 py-3">
        <TurnStatusPill status={t.status} code={t.errorCode} />
      </td>
      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted">{t.model ?? '–'}</td>
      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted">{ms(t.ttftMs)}</td>
      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted">{int(t.tokensIn + t.tokensOut)}</td>
    </tr>
  );
}

export const turnHead = (showUser = true) => [
  'When',
  ...(showUser ? ['User'] : []),
  'Question',
  'Outcome',
  'Model',
  <span key="ttft" className="block text-right">First token</span>,
  <span key="tok" className="block text-right">Tokens</span>,
];

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

export function TurnDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [r] = useAsync(() => (id ? adminApi<AdminTurn>(`/admin/activity/${id}`) : Promise.resolve(null)), [id]);
  // Don't show the previously opened turn while the next one loads.
  const t = r.data?.id === id ? r.data : null;
  return (
    <Drawer open={id !== null} onClose={onClose} title="Question detail">
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {!t ? (
        <Spinner className="text-muted" />
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Meta label="User">
              <Link href={`/users/${t.userId}`} className="hover:text-brand" onClick={onClose}>
                {t.userEmail}
              </Link>
            </Meta>
            <Meta label="When">{dateTime(t.createdAt)}</Meta>
            <Meta label="Outcome">
              <TurnStatusPill status={t.status} code={t.errorCode} />
            </Meta>
            <Meta label="Model">
              <span className="font-mono text-xs">{t.model ?? '–'}</span> {t.tier && <span className="text-muted">({t.tier})</span>}
            </Meta>
            <Meta label="First token / total">
              {ms(t.ttftMs)} / {ms(t.durationMs)}
            </Meta>
            <Meta label="Tokens in / out">
              {int(t.tokensIn)} / {int(t.tokensOut)}
            </Meta>
            <Meta label="Field">{t.field || '–'}</Meta>
            <Meta label="Target">{[t.role, t.company].filter(Boolean).join(' at ') || '–'}</Meta>
            <Meta label="Context">
              {t.hasResume ? 'Resume' : 'No resume'}
              {t.imageCount ? ` · ${t.imageCount} screenshot${t.imageCount > 1 ? 's' : ''}` : ''}
            </Meta>
          </dl>
          <section>
            <h3 className="eyebrow">Question</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 text-sm">
              {t.question || <span className="text-faint">(screenshot only, images are not stored)</span>}
            </p>
          </section>
          <section>
            <h3 className="eyebrow">Answer</h3>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-line bg-bg p-4 font-sans text-sm leading-relaxed">
              {t.answer || <span className="text-faint">(no answer text)</span>}
            </pre>
          </section>
        </div>
      )}
    </Drawer>
  );
}
