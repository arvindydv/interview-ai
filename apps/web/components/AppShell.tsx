'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CreditCard, Download, FileText, GraduationCap, History, Home, LayoutDashboard, LifeBuoy, LogOut, Menu, Mic,
  Settings, Tag, X, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';

type NavItem = { icon: LucideIcon; label: string; href: string };

const workspace: NavItem[] = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: CreditCard, label: 'Plans & billing', href: '/billing' },
];

const soon: { icon: LucideIcon; label: string }[] = [
  { icon: Mic, label: 'Interviews' },
  { icon: FileText, label: 'Resume' },
  { icon: GraduationCap, label: 'Practice' },
  { icon: History, label: 'History' },
  { icon: Settings, label: 'Settings' },
];

const explore: NavItem[] = [
  { icon: Home, label: 'Website', href: '/' },
  { icon: Tag, label: 'Pricing', href: '/pricing' },
  { icon: Download, label: 'Download app', href: '/#download' },
  { icon: LifeBuoy, label: 'Help & contact', href: '/contact' },
];

const legal = [
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Refunds', '/refunds'],
] as const;

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 text-[11px] font-medium tracking-[0.12em] text-faint uppercase">{title}</p>
      <div className="mt-2 space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
        active ? 'bg-white/[0.06] font-medium text-fg ring-1 ring-line' : 'text-muted hover:bg-white/[0.04] hover:text-fg'
      }`}
    >
      <Icon size={17} className={active ? 'text-brand' : ''} />
      {item.label}
    </Link>
  );
}

function SidebarContent({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const name = email.split('@')[0];
  const signOut = () => supabase().auth.signOut().then(() => router.replace('/'));
  return (
    <>
      <nav className="mt-8 flex-1 space-y-7 overflow-y-auto" aria-label="Main">
        <NavGroup title="Workspace">
          {workspace.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} onNavigate={onNavigate} />
          ))}
        </NavGroup>

        <NavGroup title="Coming soon">
          {soon.map(({ icon: Icon, label }) => (
            <div key={label} className="flex cursor-default items-center gap-3 px-3 py-1.5 text-sm text-faint">
              <Icon size={16} />
              {label}
            </div>
          ))}
        </NavGroup>

        <NavGroup title="Explore">
          {explore.map((item) => (
            <NavLink key={item.href} item={item} active={false} onNavigate={onNavigate} />
          ))}
        </NavGroup>
      </nav>

      <div className="mt-6 rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-semibold uppercase text-bg">
            {name[0]}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
        </div>
        <button onClick={signOut} className="btn btn-ghost mt-3 w-full !justify-start !px-2 !py-1.5">
          <LogOut size={15} /> Sign out
        </button>
      </div>

      <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-faint">
        {legal.map(([label, href]) => (
          <Link key={href} href={href} onClick={onNavigate} className="transition hover:text-muted">
            {label}
          </Link>
        ))}
      </p>
    </>
  );
}

/** Signed-in layout: a sidebar on desktop, a top bar with a slide-in menu on mobile. */
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface/50 p-4 md:flex">
        <div className="px-2 py-1.5">
          <Logo />
        </div>
        <SidebarContent email={email} />
      </aside>

      {/* mobile menu */}
      <div className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-bg p-4 transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <Logo />
            <button onClick={() => setOpen(false)} className="btn btn-ghost !p-2" aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
          <SidebarContent email={email} onNavigate={() => setOpen(false)} />
        </aside>
      </div>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-xl md:hidden">
          <Logo />
          <button onClick={() => setOpen(true)} className="btn btn-ghost !p-2" aria-label="Open menu" aria-expanded={open}>
            <Menu size={20} />
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
