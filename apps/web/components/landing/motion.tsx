'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, LayoutDashboard, Menu, Plus, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useSessionUser, type SessionUser } from '@/lib/useSession';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades + lifts its children in the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'li' | 'section';
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.setAttribute('data-in', '');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`reveal ${className}`}
      style={{ '--d': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Tracks the cursor over a group of `.spot` cards so each one lights its border where the pointer is. */
export function SpotlightGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.querySelectorAll<HTMLElement>('.spot').forEach((card) => {
          const r = card.getBoundingClientRect();
          card.style.setProperty('--mx', `${e.clientX - r.left}px`);
          card.style.setProperty('--my', `${e.clientY - r.top}px`);
        });
      });
    };
    el.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
    };
  }, []);
  return (
    <div ref={ref} className={`spot-group ${className}`}>
      {children}
    </div>
  );
}

/** Product shot that starts tipped back and stands up as you scroll, then tilts toward the cursor. */
export function TiltStage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let scroll = 0;
    let px = 0;
    let py = 0;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tip = 22 * (1 - scroll);
        const scale = 0.92 + 0.08 * scroll;
        el.style.transform = `perspective(1600px) rotateX(${tip + py * -5}deg) rotateY(${px * 6}deg) scale(${scale})`;
      });
    };
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      // 0 when the card's top is at the bottom of the viewport, 1 once it reaches 25% from the top.
      const p = (window.innerHeight - r.top) / (window.innerHeight * 0.75);
      scroll = Math.min(1, Math.max(0, p));
      apply();
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5;
      py = (e.clientY - r.top) / r.height - 0.5;
      apply();
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      apply();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="transition-transform duration-300 ease-out will-change-transform [transform-style:preserve-3d]"
    >
      {children}
    </div>
  );
}

/** Pulls its child a little toward the cursor, like a magnet. */
export function Magnetic({ children, strength = 0.3 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    const onLeave = () => (el.style.transform = '');
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [strength]);
  return (
    <span ref={ref} className="inline-flex transition-transform duration-300 ease-out">
      {children}
    </span>
  );
}

/** Cycles through words with a blur-and-rise swap. */
export function WordRotator({ words, interval = 2400 }: { words: string[]; interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);
  return (
    <span className="inline-block" aria-live="polite">
      <span key={words[i]} className="word-swap text-gradient pb-[0.12em]">
        {words[i]}
      </span>
    </span>
  );
}

/** Counts from `from` to `to` once visible, easing out. */
export function CountUp({
  to,
  from = 0,
  prefix = '',
  suffix = '',
  duration = 1600,
}: {
  to: number;
  from?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    setValue(from);
    let frame = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(2, -10 * t);
        setValue(Math.round(from + (to - from) * (t === 1 ? 1 : eased)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, from, duration]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {value}
      {suffix}
    </span>
  );
}

const navLinks = [
  ['Features', '/#features'],
  ['How it works', '/#how'],
  ['Pricing', '/pricing'],
  ['Privacy', '/#privacy'],
  ['FAQ', '/#faq'],
];

/** Sign in / Get started for visitors, Dashboard once signed in; nothing while the session loads. */
function AccountButtons({ user, mobile = false }: { user: SessionUser; mobile?: boolean }) {
  if (user === undefined) return null;
  if (user) {
    return (
      <Link
        href="/dashboard"
        className={`btn btn-primary btn-shine ${mobile ? 'col-span-2' : 'hidden sm:inline-flex'}`}
      >
        <LayoutDashboard size={16} /> Dashboard
      </Link>
    );
  }
  return (
    <>
      <Link href="/login" className={mobile ? 'btn btn-secondary' : 'btn btn-ghost hidden sm:inline-flex'}>
        Sign in
      </Link>
      <Link href="/signup" className={`btn btn-primary ${mobile ? '' : 'btn-shine hidden sm:inline-flex'}`}>
        Get started {!mobile && <ArrowRight size={16} />}
      </Link>
    </>
  );
}

/** Full-width bar at the top that condenses into a floating pill once you scroll, with a reading-progress line. */
export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const user = useSessionUser();
  const pathname = usePathname();
  const current = (href: string) => (href === pathname ? 'page' : undefined);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      barRef.current?.style.setProperty('transform', `scaleX(${max > 0 ? window.scrollY / max : 0})`);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <div
        ref={barRef}
        className="bg-brand-gradient fixed inset-x-0 top-0 z-50 h-0.5 origin-left"
        style={{ transform: 'scaleX(0)' }}
      />
      <nav className="fixed inset-x-0 top-0 z-40 px-3 pt-3 transition-all duration-500">
        <div
          className={`mx-auto flex items-center gap-8 rounded-2xl border px-4 transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] sm:px-5 ${
            scrolled
              ? 'h-14 max-w-4xl border-line-strong bg-surface/70 shadow-2xl shadow-black/40 backdrop-blur-xl'
              : 'h-16 max-w-6xl border-transparent bg-transparent'
          }`}
        >
          <Logo />
          <div className="hidden gap-1 text-sm text-muted md:flex">
            {navLinks.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                aria-current={current(href)}
                className="rounded-lg px-3 py-1.5 transition hover:bg-white/5 hover:text-fg aria-[current=page]:bg-white/[0.06] aria-[current=page]:text-fg"
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AccountButtons user={user} />
            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="btn btn-ghost !p-2 md:hidden"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* mobile menu */}
        <div
          className={`mx-auto mt-2 max-w-4xl overflow-hidden rounded-2xl border border-line-strong bg-surface/95 backdrop-blur-xl transition-all duration-300 md:hidden ${
            open ? 'max-h-96 opacity-100' : 'pointer-events-none max-h-0 opacity-0'
          }`}
        >
          <div className="flex flex-col p-2">
            {navLinks.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={current(href)}
                className="rounded-xl px-4 py-3 text-sm text-muted hover:bg-white/5 hover:text-fg aria-[current=page]:text-fg"
              >
                {label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line p-2 pt-3">
              <AccountButtons user={user} mobile />
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}

/** Accordion with smooth height animation (grid-rows trick, no measuring). */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface/40">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
              className="group flex w-full items-center gap-4 px-5 py-5 text-left sm:px-6"
            >
              <span className="flex-1 font-medium transition group-hover:text-fg">{item.q}</span>
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full ring-1 transition-all duration-300 ${
                  isOpen ? 'rotate-45 bg-brand/15 text-brand ring-brand/30' : 'text-muted ring-line-strong'
                }`}
              >
                <Plus size={16} />
              </span>
            </button>
            <div
              className={`grid transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-sm leading-relaxed text-muted sm:px-6">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
