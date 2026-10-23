import { useId } from 'react';

export function LogoMark({ size = 32 }: { size?: number }) {
  // Unique per instance: a gradient defined inside a hidden (display: none) copy doesn't paint.
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#047857" />
          <stop offset="1" stopColor="#155e75" />
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="31" height="31" rx="8" fill="#0b1411" stroke={`url(#${id}g)`} strokeOpacity=".35" />
      {/* One ribbon folded twice into a slanted F; the darker triangles are the folds' shadows on the stem. */}
      <g transform="translate(3.4 0) skewX(-10)">
        <path d="M8 6h5.6v20.5a1.2 1.2 0 0 1-1.2 1.2H9.2A1.2 1.2 0 0 1 8 26.5z" fill={`url(#${id}g)`} />
        <path d="M8 6h5.6l-5.6 5.6z" fill={`url(#${id}s)`} />
        <path d="M13.6 6h11.2a.8.8 0 0 1 .6 1.3l-3.4 4.3H8z" fill={`url(#${id}g)`} />
        <path d="M8 14.2h5.6l-5.6 5z" fill={`url(#${id}s)`} />
        <path d="M13.6 14.2h6.6a.8.8 0 0 1 .6 1.3l-2.9 3.7H8z" fill={`url(#${id}g)`} />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <LogoMark />
      <span className="text-[17px]">Friday AI</span>
      <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30">
        Admin
      </span>
    </span>
  );
}
