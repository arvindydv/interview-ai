'use client';
import { useState } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

const LOGO_TINTS = ['#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#b45309', '#0369a1', '#4d7c0f', '#9f1239'];

/** The company's logo (from the source, else its website's favicon), or its initial on a colour from the name. */
export function CompanyLogo({
  company,
  website,
  logo = null,
  size = 44,
}: {
  company: string;
  website: string | null;
  logo?: string | null;
  size?: number;
}) {
  const sources = [logo, website && `https://www.google.com/s2/favicons?domain=${encodeURIComponent(website)}&sz=128`].filter(
    (s): s is string => Boolean(s),
  );
  const [failed, setFailed] = useState(0);
  const tint = LOGO_TINTS[[...company].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % LOGO_TINTS.length];
  const box = { width: size, height: size };
  const src = sources[failed];
  if (src) {
    return (
      <span style={box} className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- third-party logos, sized by us */}
        <img
          key={src}
          src={src}
          alt=""
          width={src === logo ? size : size * 0.62}
          height={src === logo ? size : size * 0.62}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={src === logo ? 'size-full object-contain' : undefined}
          onError={() => setFailed((f) => f + 1)}
          onLoad={(e) => e.currentTarget.naturalWidth <= 16 && setFailed((f) => f + 1)}
        />
      </span>
    );
  }
  return (
    <span
      style={{ ...box, background: tint, fontSize: size * 0.42 }}
      className="grid shrink-0 place-items-center rounded-xl font-semibold text-white"
      aria-hidden
    >
      {company.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

/** Credit for a job from a job board, linked to the board as their terms ask. */
export function ViaBadge({ via, url }: { via: string; url?: string | null }) {
  const className = 'inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted';
  return url ? (
    <a href={url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className={`${className} hover:text-fg`}>
      via {via}
    </a>
  ) : (
    <span className={className}>via {via}</span>
  );
}

/** A recruitment agency's posting, not the employer's own. */
export function AgencyBadge() {
  return (
    <span
      title="Posted by a recruitment agency on behalf of an employer"
      className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
    >
      Recruiter
    </span>
  );
}

export function matchTone(score: number) {
  if (score >= 80) return { label: 'Strong match', color: '#059669' };
  if (score >= 60) return { label: 'Good match', color: '#0891b2' };
  return { label: 'Fair match', color: '#94a3b8' };
}

export function MatchRing({ score, size = 52, stroke = 4 }: { score: number; size?: number; stroke?: number }) {
  const { color } = matchTone(score);
  return (
    <span
      className="match-ring shrink-0"
      style={{ width: size, height: size, ['--score' as string]: score, ['--ring' as string]: color }}
      aria-label={`${score}% match`}
    >
      <span style={{ width: size - stroke * 2, height: size - stroke * 2 }}>
        <span className="font-semibold tabular-nums" style={{ fontSize: size * (score === 100 ? 0.23 : 0.27), color }}>
          {score}%
        </span>
      </span>
    </span>
  );
}

const YC_SEASONS: Record<string, string> = { Winter: 'W', Summer: 'S', Fall: 'F', Spring: 'X' };

/** "YC S21" for Y Combinator companies, "Startup" for other startups. */
export function StartupBadge({ batch }: { batch: string | null }) {
  const [season, year] = batch?.split(' ') ?? [];
  const yc = season && year && YC_SEASONS[season] ? `YC ${YC_SEASONS[season]}${year.slice(-2)}` : null;
  return yc ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#fb651e]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#c2410c]">
      <span className="grid size-3 place-items-center rounded-[3px] bg-[#fb651e] text-[8px] leading-none text-white">Y</span>
      {yc}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">Startup</span>
  );
}
