'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity, BriefcaseBusiness, LayoutDashboard, LogOut, Menu, ScrollText, Server, SlidersHorizontal, Users, X,
} from 'lucide-react';
import { getSession, signOut } from '@/lib/api';
import { Logo, LogoMark } from './Logo';

const nav = [
  { href: '/', icon: LayoutDashboard, label: 'Overview' },
  { href: '/users', icon: Users, label: 'Users' },
  { href: '/activity', icon: Activity, label: 'Live activity' },
  { href: '/interviews', icon: BriefcaseBusiness, label: 'Interviews' },
  { href: '/system', icon: Server, label: 'System' },
  { href: '/settings', icon: SlidersHorizontal, label: 'Settings' },
  { href: '/audit', icon: ScrollText, label: 'Audit log' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {nav.map(({ href, icon: Icon, label }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active ? 'bg-white/[0.06] font-medium text-fg ring-1 ring-line' : 'text-muted hover:bg-white/[0.03] hover:text-fg'
            }`}
          >
            <Icon size={17} className={active ? 'text-brand' : ''} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace('/login');
    else setEmail(s.email);
  }, [router]);

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const account = (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="truncate text-xs text-muted">Signed in as</p>
      <p className="truncate text-sm font-medium">{email}</p>
      <button onClick={signOut} className="btn btn-ghost mt-2 w-full !justify-start !px-2 !py-1.5">
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/50 p-4 lg:flex">
        <div className="px-2 py-1.5">
          <Logo />
        </div>
        <div className="mt-8">
          <NavLinks />
        </div>
        <div className="mt-auto">{account}</div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <button onClick={() => setMenuOpen(true)} className="btn btn-ghost !px-2" aria-label="Menu">
            <Menu size={18} />
          </button>
        </div>
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="relative flex h-full w-72 flex-col border-r border-line bg-surface p-4">
              <div className="flex items-center justify-between px-2 py-1.5">
                <Logo />
                <button onClick={() => setMenuOpen(false)} className="btn btn-ghost !p-1.5" aria-label="Close menu">
                  <X size={18} />
                </button>
              </div>
              <div className="mt-6">
                <NavLinks onNavigate={() => setMenuOpen(false)} />
              </div>
              <div className="mt-auto">{account}</div>
            </div>
          </div>
        )}
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
