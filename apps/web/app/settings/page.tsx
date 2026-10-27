'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check, Copy, CreditCard, Database, Download, History, KeyRound, Laptop, LogOut, Monitor, ShieldCheck, Trash2, TriangleAlert,
  User, UserX, type LucideIcon,
} from 'lucide-react';
import { HISTORY_RETENTIONS, planLabel, type AccountSettings, type HistoryRetention, type Me } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { company } from '@/lib/company';
import { supabase } from '@/lib/supabase';
import { useRequireSession } from '@/lib/useSession';
import { relative } from '@/lib/interviews';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Toaster, toast } from '@/components/overlay';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'privacy', label: 'Privacy & history', icon: ShieldCheck },
  { id: 'devices', label: 'Devices', icon: Laptop },
  { id: 'data', label: 'Your data', icon: Database },
];

const osName = (os: string) => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[os.toLowerCase()] ?? os;

export default function SettingsPage() {
  const email = useRequireSession();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<HistoryRetention | null>(null);
  const [confirm, setConfirm] = useState<'history' | 'data' | { device: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!email) return;
    Promise.all([api<Me>('/v1/me'), api<AccountSettings>('/v1/settings')]).then(
      ([m, s]) => {
        setMe(m);
        setSettings(s);
      },
      (e) => setLoadError(errorText(e)),
    );
  }, [email]);

  useEffect(() => {
    if (settings && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [settings]);

  const setRetention = async (id: HistoryRetention) => {
    if (!settings || id === settings.historyRetention) return;
    const before = settings.historyRetention;
    setSaving(id);
    setSettings({ ...settings, historyRetention: id });
    try {
      setSettings(await api<AccountSettings>('/v1/settings', { method: 'PATCH', body: JSON.stringify({ historyRetention: id }) }));
      toast(
        id === 'off'
          ? 'History is off. Saved questions and answers are being deleted.'
          : id === 'forever'
            ? 'History is kept until you delete it.'
            : `History is now kept for ${HISTORY_RETENTIONS.find((r) => r.id === id)!.label}. Older text is being deleted.`,
      );
    } catch (e) {
      setSettings((s) => (s ? { ...s, historyRetention: before } : s));
      toast(errorText(e), { tone: 'bad' });
    }
    setSaving(null);
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await api<object>('/v1/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `friday-ai-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Your data is downloading.');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setExporting(false);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'history') {
        await api('/v1/history', { method: 'DELETE' });
        toast('All history deleted.');
      } else if (confirm === 'data') {
        await api('/v1/data', { method: 'DELETE' });
        toast('Your interviews, resume, practice and history are deleted.');
      } else {
        await api(`/v1/devices/${confirm.device}`, { method: 'DELETE' });
        setSettings((s) => (s ? { ...s, devices: s.devices.filter((d) => d.id !== confirm.device) } : s));
        toast('Device removed.');
      }
      setConfirm(null);
      setTyped('');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setBusy(false);
  };

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const deleteAccountHref = `mailto:${company.email}?${new URLSearchParams({
    subject: 'Delete my Friday AI account',
    body: `Please delete my Friday AI account and all data linked to it.\n\nAccount email: ${email}\nUser ID: ${me?.id ?? ''}`,
  })
    .toString()
    .replace(/\+/g, '%20')}`;

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="animate-fade-up">
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1.5 text-sm text-muted">Your account, what Friday keeps, and your data.</p>
        </header>

        {loadError && <p className="mt-6 text-sm text-danger">Couldn&apos;t load your settings: {loadError}</p>}

        <div className="mt-8 grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav className="hidden lg:block" aria-label="Settings sections">
            <ul className="sticky top-8 space-y-0.5">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <a href={`#${id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/[0.04] hover:text-fg">
                    <Icon size={15} /> {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {!me || !settings ? (
            !loadError && (
              <div className="space-y-6">
                {[0, 1, 2].map((n) => (
                  <div key={n} className="glass h-48 animate-pulse rounded-[var(--radius-card)]" />
                ))}
              </div>
            )
          ) : (
            <div className="min-w-0 space-y-6">
              {/* account */}
              <Section id="account" icon={User} title="Account">
                <dl className="divide-y divide-line text-sm">
                  <Row label="Email">{me.email}</Row>
                  <Row label="Sign-in">
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound size={13} className="text-faint" />{' '}
                      {{ email: 'Email code', google: 'Google' }[me.authProvider] ?? me.authProvider}
                    </span>
                  </Row>
                  <Row label="Plan">
                    <span className="flex items-center gap-3">
                      {planLabel(me.plan)}
                      {me.planExpiresAt && <span className="text-xs text-muted">until {new Date(me.planExpiresAt).toLocaleDateString('en-IN')}</span>}
                      <Link href="/billing" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                        <CreditCard size={12} /> Manage
                      </Link>
                    </span>
                  </Row>
                  <Row label="Member since">{new Date(me.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</Row>
                  <Row label="User ID">
                    <CopyText text={me.id} />
                  </Row>
                </dl>
                <button
                  onClick={() => supabase().auth.signOut().then(() => router.replace('/'))}
                  className="btn btn-secondary mt-5 !py-2 text-sm"
                >
                  <LogOut size={15} /> Sign out
                </button>
              </Section>

              {/* privacy */}
              <Section
                id="privacy"
                icon={ShieldCheck}
                title="Privacy & history"
                text="How long Friday keeps the questions and answers from your live interviews. Usage time is always kept, for billing."
              >
                <div role="radiogroup" aria-label="Keep history" className="grid gap-2 sm:grid-cols-2">
                  {HISTORY_RETENTIONS.map((r) => {
                    const on = settings.historyRetention === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setRetention(r.id)}
                        disabled={Boolean(saving)}
                        className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-60 ${
                          on ? 'border-brand/50 bg-brand/[0.07]' : 'border-line hover:border-line-strong hover:bg-white/[0.03]'
                        } ${r.id === 'forever' ? 'sm:col-span-2' : ''}`}
                      >
                        <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ring-1 ${on ? 'ring-brand' : 'ring-line-strong'}`}>
                          {saving === r.id ? <Spinner className="!size-3 !border" /> : on && <span className="size-2 rounded-full bg-brand" />}
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{r.label}</span>
                          <span className="block text-xs text-muted">{r.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <ul className="mt-5 space-y-2 text-xs text-muted">
                  <li className="flex gap-2">
                    <Check size={13} className="mt-0.5 shrink-0 text-brand" /> Audio is never recorded or stored. Screenshots are
                    only counted, never kept.
                  </li>
                  <li className="flex gap-2">
                    <Check size={13} className="mt-0.5 shrink-0 text-brand" /> A shorter period also applies to what&apos;s already
                    saved, within the hour.
                  </li>
                  <li className="flex gap-2">
                    <Check size={13} className="mt-0.5 shrink-0 text-brand" /> Our AI providers process questions to answer them,
                    under their own API data policies. See the{' '}
                    <Link href="/privacy" className="text-brand hover:underline">
                      privacy policy
                    </Link>
                    .
                  </li>
                </ul>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
                  <Link href="/history" className="btn btn-secondary !py-2 text-sm">
                    <History size={15} /> Open history
                  </Link>
                  <button onClick={() => setConfirm('history')} className="btn btn-ghost !py-2 text-sm hover:!text-danger">
                    <Trash2 size={15} /> Delete all history
                  </button>
                </div>
              </Section>

              {/* devices */}
              <Section id="devices" icon={Laptop} title="Devices" text="Computers where the desktop app is signed in to this account.">
                {settings.devices.length === 0 ? (
                  <p className="text-sm text-muted">
                    No devices yet.{' '}
                    <Link href="/#download" className="text-brand hover:underline">
                      Get the desktop app
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {settings.devices.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-muted ring-1 ring-line">
                          <Monitor size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {osName(d.os)} {d.osVersion && <span className="font-normal text-muted">{d.osVersion}</span>}
                          </p>
                          <p className="text-xs text-muted">
                            {d.appVersion ? `App ${d.appVersion} · ` : ''}Last active {relative(d.lastSeen)}
                          </p>
                        </div>
                        <button onClick={() => setConfirm({ device: d.id })} className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* data */}
              <Section id="data" icon={Database} title="Your data" text="Under the Digital Personal Data Protection Act, 2023, you can get a copy of your data or have it deleted.">
                <div className="space-y-3">
                  <ActionRow
                    icon={Download}
                    title="Download your data"
                    text="Account, interviews, resume, practice, history and payments, as one JSON file."
                    action={
                      <button onClick={exportData} disabled={exporting} className="btn btn-secondary !py-2 text-sm">
                        {exporting ? <Spinner className="!size-4" /> : <Download size={15} />} Download
                      </button>
                    }
                  />
                  <ActionRow
                    danger
                    icon={TriangleAlert}
                    title="Delete all my data"
                    text="Interviews, resume, practice sessions and history. Your account, plan and minutes stay."
                    action={
                      <button onClick={() => setConfirm('data')} className="btn !py-2 text-sm text-danger ring-1 ring-danger/30 hover:bg-danger/10">
                        <Trash2 size={15} /> Delete data
                      </button>
                    }
                  />
                  <ActionRow
                    danger
                    icon={UserX}
                    title="Delete account"
                    text={`Closes your account and deletes everything linked to it within 30 days. Payment records are kept as tax law requires.`}
                    action={
                      <a href={deleteAccountHref} className="btn !py-2 text-sm text-danger ring-1 ring-danger/30 hover:bg-danger/10">
                        Request deletion
                      </a>
                    }
                  />
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'history'}
        title="Delete all history?"
        text="Every saved question, answer and summary is deleted. Your usage and minutes are not affected."
        confirmLabel={busy ? 'Deleting…' : 'Delete history'}
        danger
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={typeof confirm === 'object' && confirm !== null}
        title="Remove this device?"
        text="It disappears from this list. If the app is still signed in there, it shows up again next time it's used. To sign it out, sign out in the app."
        confirmLabel="Remove"
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'data'}
        title="Delete all your data?"
        text={
          <>
            <span className="block">This deletes your interviews, resume, practice sessions and history. It can&apos;t be undone.</span>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs">
                Type <span className="font-mono text-fg">DELETE</span> to confirm
              </span>
              <TypedConfirm value={typed} onChange={setTyped} />
            </label>
          </>
        }
        confirmLabel={busy ? 'Deleting…' : 'Delete everything'}
        danger
        busy={busy || typed !== 'DELETE'}
        onConfirm={runConfirm}
        onCancel={() => {
          setConfirm(null);
          setTyped('');
        }}
      />
      <Toaster />
    </AppShell>
  );
}

function TypedConfirm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="input !py-2 font-mono" />;
}

function Section({ id, icon: Icon, title, text, children }: { id: string; icon: LucideIcon; title: string; text?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass scroll-mt-8 rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
          <Icon size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {text && <p className="mt-0.5 text-xs text-muted">{text}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className="inline-flex max-w-full items-center gap-1.5 truncate font-mono text-xs text-muted hover:text-fg"
      title="Copy"
    >
      <span className="truncate">{text}</span>
      {done ? <Check size={12} className="shrink-0 text-brand" /> : <Copy size={12} className="shrink-0" />}
    </button>
  );
}

function ActionRow({
  icon: Icon,
  title,
  text,
  action,
  danger,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-xl border p-4 ${danger ? 'border-danger/20 bg-danger/[0.03]' : 'border-line bg-bg/30'}`}>
      <Icon size={18} className={`shrink-0 ${danger ? 'text-danger' : 'text-muted'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{text}</p>
      </div>
      {action}
    </div>
  );
}
