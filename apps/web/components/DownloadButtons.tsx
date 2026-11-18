'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, EyeOff, Headphones, Keyboard, Layers, PlayCircle, Terminal, X } from 'lucide-react';
import {
  detectPlatform, downloadUrl, installers, linuxInstallers, type Installer, type Platform,
} from '@/lib/downloads';
import { DesktopFilm } from '@/components/desktop/DesktopFilm';
import { LinuxInstallGuide, UseSteps, WindowsInstallSteps } from '@/components/desktop/InstallGuides';
import { MacInstallSteps } from '@/components/MacInstallGuide';

function AppleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.37 12.62c-.02-2.23 1.82-3.3 1.9-3.35-1.04-1.52-2.65-1.73-3.22-1.75-1.37-.14-2.68.81-3.37.81-.7 0-1.77-.79-2.91-.77-1.5.02-2.88.87-3.65 2.21-1.56 2.7-.4 6.7 1.12 8.9.74 1.07 1.62 2.28 2.78 2.23 1.12-.04 1.54-.72 2.89-.72 1.35 0 1.73.72 2.91.7 1.2-.02 1.96-1.09 2.7-2.17.85-1.24 1.2-2.44 1.22-2.5-.03-.01-2.34-.9-2.37-3.59ZM14.15 6.07c.62-.75 1.03-1.78.92-2.82-.89.04-1.97.59-2.6 1.33-.57.66-1.07 1.72-.94 2.73.99.08 2.01-.5 2.62-1.24Z" />
    </svg>
  );
}

function WindowsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 5.5 10.5 4.4v7.1H3V5.5Zm0 13 7.5 1.1v-7H3v5.9Zm8.4 1.2L21 21v-8.4h-9.6v7.1Zm0-15.4v7.2H21V3l-9.6 1.3Z" />
    </svg>
  );
}

const platformName: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** Where the dialog opened from: a download that just started, or "how it works" with no download. */
export type GuideFor = Installer | 'guide';

/** The three Linux package formats, shown in the page flow under the buttons (no popover to get clipped). */
function LinuxChoices({ onPick, onUnavailable }: { onPick: (i: Installer) => void; onUnavailable: () => void }) {
  return (
    <div id="linux-downloads" className="mt-3 animate-fade-up rounded-xl border border-line-strong bg-surface-2/80 p-1.5 text-left">
      <div className="grid gap-1 sm:grid-cols-3">
        {linuxInstallers.map((i) => {
          const href = downloadUrl(i);
          return (
            <a
              key={i.id}
              href={href ?? '#'}
              download={href ? i.file : undefined}
              onClick={(e) => {
                if (!href) {
                  e.preventDefault();
                  onUnavailable();
                } else onPick(i);
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-white/[0.06]"
            >
              <Download size={15} className="shrink-0 text-brand" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{i.label}</span>
                <span className="block text-xs text-muted">{i.detail}</span>
              </span>
            </a>
          );
        })}
      </div>
      <p className="px-3 pt-1 pb-1 text-[11px] text-faint">64-bit (x86_64) only. Install steps appear after you pick one.</p>
    </div>
  );
}

/** Windows, macOS and Linux installers. The visitor's OS is highlighted. A started download opens the guide dialog. */
export function DownloadButtons({ size = 'md', align = 'center' }: { size?: 'md' | 'lg'; align?: 'center' | 'start' }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [notice, setNotice] = useState(false);
  const [guide, setGuide] = useState<GuideFor | null>(null);
  const [linuxOpen, setLinuxOpen] = useState(false);

  useEffect(() => setPlatform(detectPlatform()), []);

  const pad = size === 'lg' ? 'px-6 py-3' : '';
  const unavailable = () => setNotice(true);
  const win = installers.find((i) => i.id === 'windows')!;
  const mac = installers.find((i) => i.id === 'macos')!;
  // Default to the visitor's OS; without a signal, keep Windows as the most common.
  const primary: Platform = platform ?? 'windows';
  // Let the browser start the download (or open the Store tab) before the dialog takes focus.
  const started = (i: Installer) => setTimeout(() => setGuide(i), 250);

  const link = (i: Installer, icon: React.ReactNode) => {
    const href = downloadUrl(i);
    const store = i.platform === 'windows';
    return (
      <a
        href={href ?? '#'}
        // The Store page opens in a new tab so this page can show the install guide.
        target={store ? '_blank' : undefined}
        rel={store ? 'noopener' : undefined}
        download={href && !store ? i.file : undefined}
        onClick={(e) => {
          if (!href) {
            e.preventDefault();
            unavailable();
          } else started(i);
        }}
        className={`btn ${primary === i.platform ? 'btn-primary' : 'btn-secondary'} ${pad}`}
      >
        {icon} {i.label}
      </a>
    );
  };

  return (
    <div>
      <div className={`flex flex-wrap gap-2 ${align === 'center' ? 'justify-center' : ''}`}>
        {link(win, <WindowsIcon />)}
        {link(mac, <AppleIcon />)}
        <button
          type="button"
          aria-expanded={linuxOpen}
          aria-controls="linux-downloads"
          onClick={() => setLinuxOpen((o) => !o)}
          className={`btn ${primary === 'linux' ? 'btn-primary' : 'btn-secondary'} ${pad}`}
        >
          <Terminal size={16} /> Linux <ChevronDown size={14} className={`transition ${linuxOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {linuxOpen && (
        <LinuxChoices
          onUnavailable={unavailable}
          onPick={(i) => {
            setLinuxOpen(false);
            started(i);
          }}
        />
      )}
      <button
        type="button"
        onClick={() => setGuide('guide')}
        className={`mt-3 flex items-center gap-1.5 text-xs text-muted transition hover:text-fg ${align === 'center' ? 'mx-auto' : ''}`}
      >
        <PlayCircle size={14} className="text-brand" /> Why the desktop app? Watch how it works
      </button>
      {notice && (
        <p className="mt-3 text-xs text-muted">
          Installers aren't published yet. Set <code className="text-fg/80">NEXT_PUBLIC_DOWNLOADS_URL</code> once a release is out.
        </p>
      )}
      <DesktopGuideDialog open={guide !== null} guide={guide ?? 'guide'} onClose={() => setGuide(null)} />
    </div>
  );
}

const reasons = [
  { icon: Headphones, title: 'Hears your interviewer', body: 'Picks up the call’s audio from Zoom, Meet, Teams or Webex. A website can’t hear other apps.' },
  { icon: Layers, title: 'Floats over your call', body: 'Answers sit on top of the meeting window, right where you’re looking.' },
  { icon: EyeOff, title: 'Private on screen share', body: 'Excluded from capture on Windows 10 (2004+) and macOS 14 and earlier.' },
  { icon: Keyboard, title: 'Hotkeys mid-call', body: 'Ask for an answer or solve a coding problem without leaving the call.' },
];

/** Shown when a download starts (install steps for that system) or from "Watch how it works". */
export function DesktopGuideDialog({ open, guide, onClose }: { open: boolean; guide: GuideFor; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const installer = guide === 'guide' ? null : guide;
  const href = installer ? downloadUrl(installer) : null;
  const title = !installer
    ? 'How Friday works in your interview'
    : installer.platform === 'windows'
      ? 'The Microsoft Store is opening'
      : 'Your download has started';

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="desktop-guide-title"
      className="m-auto max-h-[92vh] w-[min(64rem,calc(100vw-1.5rem))] overflow-y-auto rounded-3xl border border-line-strong bg-surface-2 p-0 text-left text-fg shadow-2xl shadow-black/60 backdrop:bg-black/70 backdrop:backdrop-blur-md open:animate-fade-up"
    >
      {open && (
        <div className="p-4 sm:p-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand uppercase">
                {installer ? `Friday AI for ${platformName[installer.platform]}` : 'Friday desktop app'}
              </p>
              <h2 id="desktop-guide-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                {title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {installer
                  ? 'While it installs, watch what the app does in your interview and why it runs on your computer.'
                  : 'Friday’s live help runs in the desktop app, next to your video call. Here’s why, in under 40 seconds.'}
                {href && (
                  <>
                    {' '}
                    <a
                      href={href}
                      target={installer?.platform === 'windows' ? '_blank' : undefined}
                      rel="noopener"
                      download={installer?.platform === 'windows' ? undefined : installer?.file}
                      className="text-brand hover:underline"
                    >
                      {installer?.platform === 'windows' ? 'Store didn’t open?' : 'Download didn’t start?'}
                    </a>
                  </>
                )}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-muted ring-1 ring-line transition hover:bg-white/5 hover:text-fg">
              <X size={16} />
            </button>
          </div>

          <DesktopFilm className="mt-5" />

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-line bg-bg/40 p-5">
              {installer ? (
                <>
                  <h3 className="text-sm font-semibold">Install on {platformName[installer.platform]}</h3>
                  <div className="mt-4">
                    {installer.platform === 'windows' && <WindowsInstallSteps />}
                    {installer.platform === 'macos' && <MacInstallSteps />}
                    {installer.platform === 'linux' && <LinuxInstallGuide initial={installer.id} embedded />}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold">Why it’s a desktop app</h3>
                  <ul className="mt-4 space-y-3">
                    {reasons.map(({ icon: Icon, title: t, body }) => (
                      <li key={t} className="flex gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-2/10 text-brand-2 ring-1 ring-brand-2/25">
                          <Icon size={15} />
                        </span>
                        <div>
                          <p className="text-sm font-medium">{t}</p>
                          <p className="mt-0.5 text-xs text-muted">{body}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section className="rounded-2xl border border-line bg-bg/40 p-5">
              <h3 className="text-sm font-semibold">From sign-up to your first live answer</h3>
              <UseSteps className="mt-4" />
            </section>
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={onClose} className="btn btn-primary">
              Got it
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
