'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Bookmark, Crown, FileStack, Globe, Layers, LogOut, Menu, Search, Send, Sparkles, Target, UserRound, X, Zap } from 'lucide-react';
import { Logo } from './Logo';
import { Spinner } from './ui';
import { JobsProvider, useJobs } from '@/lib/jobs';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';

const NAV = [
  { href: '/recommended', label: 'Recommended', icon: Sparkles, count: 'recommended' },
  { href: '/swipe', label: 'Swipe', icon: Layers, count: null },
  { href: '/top', label: 'Top matches', icon: Target, count: 'top' },
  { href: '/remote', label: 'Remote jobs', icon: Globe, count: null },
  { href: '/search', label: 'All jobs', icon: Search, count: null },
] as const;

const MINE = [
  { href: '/saved', label: 'Saved', icon: Bookmark, count: 'saved' },
  { href: '/applied', label: 'Applied', icon: Send, count: 'applied' },
  { href: '/auto-apply', label: 'Auto Apply', icon: Zap, count: null },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, count: null },
  { href: '/resumes', label: 'Resumes', icon: FileStack, count: null },
  { href: '/plans', label: 'Plans', icon: Crown, count: null },
] as const;

function NavLink({ href, label, icon: Icon, count, onNavigate }: {
  href: string;
  label: string;
  icon: typeof Sparkles;
  count?: number;
  onNavigate: () => void;
}) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/70 hover:text-fg'
      }`}
    >
      <Icon size={17} className={active ? 'text-brand' : 'text-faint group-hover:text-muted'} />
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${active ? 'bg-white text-fg shadow-sm' : 'text-faint'}`}>
          {count > 999 ? '999+' : count}
        </span>
      )}
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { summary, email } = useJobs();
  const router = useRouter();
  const pathname = usePathname();
  const name = summary?.profile.name ?? email.split('@')[0];
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-6">
        <Link href="/recommended" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        <div className="space-y-0.5">
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">Discover</p>
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} count={n.count ? summary?.counts[n.count] : undefined} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="space-y-0.5">
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">My jobs</p>
          {MINE.map((n) => (
            <NavLink key={n.href} {...n} count={n.count ? summary?.counts[n.count] : undefined} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>

      {summary && (
        <div className="mx-3 mb-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand" />
            </span>
            {summary.openListings.toLocaleString('en-IN')} live jobs · {summary.companies} companies
          </span>
          {summary.lastSyncAt && <span className="mt-1 block text-faint">Updated {timeAgo(summary.lastSyncAt)}</span>}
        </div>
      )}

      <div className="border-t border-line p-3">
        <Link
          href="/profile"
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg p-2 transition hover:bg-surface-2 ${pathname === '/profile' ? 'bg-surface-2' : ''}`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-xs font-semibold text-white">
            {initials || <UserRound size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted">Profile & preferences</span>
          </span>
        </Link>
        <button
          onClick={async () => {
            await supabase().auth.signOut();
            router.replace('/');
          }}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/recommended">
          <Logo />
        </Link>
        <button onClick={() => setOpen(true)} className="btn btn-ghost !p-2" aria-label="Open menu">
          <Menu size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <button onClick={() => setOpen(false)} className="btn btn-ghost absolute top-4 right-3 !p-2" aria-label="Close menu">
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">{children}</div>
    </div>
  );
}

/** Signed-in pages: sends signed-out visitors to sign in, and back here afterwards. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data }) => {
      if (!data.session) return router.replace(`/login?${new URLSearchParams({ next: location.pathname + location.search })}`);
      setEmail(data.session.user.email ?? '');
    });
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/');
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  if (email === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg">
        <Spinner className="text-muted" />
      </div>
    );
  }
  return (
    <JobsProvider email={email}>
      <Shell>{children}</Shell>
    </JobsProvider>
  );
}
