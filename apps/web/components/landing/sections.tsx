import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { FooterAccountLinks } from '@/components/landing/FooterAccountLinks';

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/[0.06] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">
      <span className="size-1 rounded-full bg-brand shadow-[0_0_8px_2px] shadow-brand/60" />
      {children}
    </span>
  );
}

const productLinks = [
  ['Features', '/#features'],
  ['Who it’s for', '/#who'],
  ['How it works', '/#how'],
  ['Pricing', '/pricing'],
  ['Privacy', '/#privacy'],
  ['Download', '/#download'],
];

export const legalLinks = [
  ['Terms & Conditions', '/terms'],
  ['Privacy Policy', '/privacy'],
  ['Refund & Cancellation', '/refunds'],
  ['Contact us', '/contact'],
] as const;

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 pb-8 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] sm:px-6">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">
            Friday AI is the real-time AI interview assistant that helps you answer every interview question with
            clarity, built from your own resume.
          </p>
        </div>
        <div>
          <p className="eyebrow">Product</p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {productLinks.map(([l, h]) => (
              <li key={h}>
                <Link href={h} className="transition hover:text-fg">{l}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Account</p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            <FooterAccountLinks />
          </ul>
        </div>
        <div>
          <p className="eyebrow">Legal</p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {legalLinks.map(([l, h]) => (
              <li key={h}>
                <Link href={h} className="transition hover:text-fg">{l}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none mx-auto max-w-6xl px-4 text-center text-[22vw] leading-[0.8] font-bold tracking-[-0.06em] select-none sm:px-6 lg:text-[15rem]"
        style={{
          // --color-white turns to ink in light mode (globals.css), so the wordmark stays visible there too.
          background: 'linear-gradient(180deg, color-mix(in oklab, var(--color-white) 9%, transparent), transparent 85%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        Friday AI
      </div>
      <div className="mx-auto max-w-6xl border-t border-line px-4 py-6 text-center text-xs text-faint sm:px-6">
        © {new Date().getFullYear()} Friday AI. All rights reserved.
      </div>
    </footer>
  );
}
