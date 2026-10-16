import Link from 'next/link';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="pk-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#pk-g)" />
      <g fill="#04120c">
        <rect x="8" y="12" width="3" height="8" rx="1.5" />
        <rect x="14.5" y="8" width="3" height="16" rx="1.5" />
        <rect x="21" y="11" width="3" height="10" rx="1.5" />
      </g>
    </svg>
  );
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-semibold tracking-tight">
      <LogoMark />
      <span className="text-[17px]">Parakeet</span>
    </Link>
  );
}
