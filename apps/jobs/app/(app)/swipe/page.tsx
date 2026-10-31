'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, MapPin, RotateCcw, Wallet, X, Zap } from 'lucide-react';
import type { SwipeCard, SwipeResult } from '@parakeet/shared';
import { CompanyLogo, MatchRing, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { postedAgo } from '@/lib/format';

// Swipe review: matched jobs one at a time. Right sends it to Auto Apply (tailored resume, cover
// letter, answered form), left skips it for good. Drag, tap the buttons, or use ← and →.

/** Pixels a card has to travel to count as a swipe. */
const THRESHOLD = 110;

function Card({ card, onDecide, top }: { card: SwipeCard; onDecide: (d: 'apply' | 'skip') => void; top: boolean }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const posted = postedAgo(card.postedAt);

  const end = () => {
    if (start.current === null) return;
    start.current = null;
    if (Math.abs(dx) > THRESHOLD) onDecide(dx > 0 ? 'apply' : 'skip');
    else setDx(0);
  };

  return (
    <article
      onPointerDown={(e) => {
        if (!top) return;
        start.current = e.clientX;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        transform: `translateX(${dx}px) rotate(${dx / 18}deg)`,
        transition: start.current === null ? 'transform 200ms ease' : 'none',
      }}
      className={`card absolute inset-0 flex touch-none flex-col overflow-hidden p-6 select-none ${top ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none scale-[0.97] opacity-70'}`}
    >
      {top && dx !== 0 && (
        <span
          className={`absolute top-6 rounded-lg border-2 px-3 py-1 text-sm font-bold tracking-wider uppercase ${
            dx > 0 ? 'left-6 border-brand text-brand' : 'right-6 border-danger text-danger'
          }`}
          style={{ opacity: Math.min(1, Math.abs(dx) / THRESHOLD) }}
        >
          {dx > 0 ? 'Apply' : 'Skip'}
        </span>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <CompanyLogo company={card.company} website={card.companyWebsite} logo={card.companyLogo} size={52} />
          <div>
            <p className="font-medium">{card.company}</p>
            <p className="text-xs text-muted">{posted ? `Posted ${posted}` : 'Recently posted'}</p>
          </div>
        </div>
        <MatchRing score={card.score} size={56} stroke={5} />
      </div>
      <h2 className="mt-5 text-xl leading-snug font-semibold tracking-tight">{card.title}</h2>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {card.location && (
          <span className="flex items-center gap-1.5">
            <MapPin size={14} className="text-faint" /> {card.location}
          </span>
        )}
        {card.salary && (
          <span className="flex items-center gap-1.5 font-medium text-brand">
            <Wallet size={14} /> {card.salary}
          </span>
        )}
      </div>
      {card.matchedSkills.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {card.matchedSkills.slice(0, 8).map((s) => (
            <span key={s} className="chip !border-brand/20 !text-fg">
              <Check size={12} className="text-brand" /> {s}
            </span>
          ))}
        </div>
      )}
      <p className="mt-4 line-clamp-[8] flex-1 overflow-hidden text-sm leading-relaxed text-muted">{card.summary}</p>
      <Link href={`/jobs/${card.listingId}`} target="_blank" className="mt-3 text-xs font-medium text-muted underline underline-offset-2" onPointerDown={(e) => e.stopPropagation()}>
        Read the full job
      </Link>
    </article>
  );
}

export default function SwipePage() {
  const [cards, setCards] = useState<SwipeCard[] | null>(null);
  const [usage, setUsage] = useState<{ today: number; limit: number } | null>(null);
  const [last, setLast] = useState<SwipeCard | null>(null);
  const [blocked, setBlocked] = useState<{ kind: 'setup' | 'limit' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ cards: SwipeCard[] }>('/v1/swipe?limit=20');
    setCards(r.cards);
  }, []);
  useEffect(() => {
    load().catch((e) => setBlocked({ kind: 'error', text: (e as Error).message }));
  }, [load]);

  const decide = useCallback(
    async (decision: 'apply' | 'skip') => {
      const card = cards?.[0];
      if (!card || busy) return;
      setBusy(true);
      setBlocked(null);
      try {
        const r = await api<SwipeResult>('/v1/swipe', { method: 'POST', body: JSON.stringify({ listingId: card.listingId, decision }) });
        setUsage({ today: r.today, limit: r.limit });
        setLast(card);
        setCards((c) => c?.slice(1) ?? null);
        if ((cards?.length ?? 0) <= 4) load().catch(() => {});
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        setBlocked({ kind: status === 409 ? 'setup' : status === 429 ? 'limit' : 'error', text: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [cards, busy, load],
  );

  async function undo() {
    if (!last) return;
    await api(`/v1/swipe/${last.listingId}`, { method: 'DELETE' }).catch(() => {});
    setCards((c) => [last, ...(c ?? [])]);
    setLast(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') decide('apply');
      if (e.key === 'ArrowLeft') decide('skip');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  return (
    <div className="mx-auto flex max-w-xl flex-col px-4 pt-8 pb-16 sm:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Swipe</h1>
          <p className="mt-1 text-sm text-muted">Right to apply with Auto Apply, left to skip. Or use the ← → keys.</p>
        </div>
        {usage && (
          <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium tabular-nums text-muted">
            Today {usage.today}/{usage.limit}
          </span>
        )}
      </div>

      {blocked && (
        <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${blocked.kind === 'error' ? 'border-danger/20 bg-danger/5 text-danger' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <p>{blocked.text}</p>
          {blocked.kind === 'setup' && (
            <Link href="/auto-apply" className="btn btn-secondary mt-2 !py-1.5 !text-xs">
              <Zap size={13} /> Set up Auto Apply
            </Link>
          )}
          {blocked.kind === 'limit' && (
            <Link href="/plans" className="btn btn-brand mt-2 !py-1.5 !text-xs">
              See plans
            </Link>
          )}
        </div>
      )}

      <div className="relative mt-6 h-[540px]">
        {cards === null ? (
          <div className="grid h-full place-items-center">
            <Spinner className="text-muted" />
          </div>
        ) : cards.length === 0 ? (
          <div className="card grid h-full place-items-center p-8 text-center text-sm text-muted">
            <div>
              <p className="font-medium text-fg">You&rsquo;re all caught up</p>
              <p className="mt-1">New matches arrive as jobs are posted. Check back later.</p>
            </div>
          </div>
        ) : (
          cards
            .slice(0, 2)
            .reverse()
            .map((c, i, arr) => <Card key={c.listingId} card={c} top={i === arr.length - 1} onDecide={decide} />)
        )}
      </div>

      {cards && cards.length > 0 && (
        <div className="mt-6 flex items-center justify-center gap-5">
          <button disabled={busy} onClick={() => decide('skip')} aria-label="Skip" className="grid size-14 place-items-center rounded-full border border-line-strong bg-surface text-danger shadow-sm transition hover:scale-105">
            <X size={26} />
          </button>
          <button disabled={!last || busy} onClick={undo} aria-label="Undo" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-fg disabled:opacity-40">
            <RotateCcw size={16} />
          </button>
          <button disabled={busy} onClick={() => decide('apply')} aria-label="Apply" className="grid size-14 place-items-center rounded-full bg-brand text-white shadow-sm transition hover:scale-105">
            <Check size={26} />
          </button>
        </div>
      )}
    </div>
  );
}
