'use client';
import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { USE_STEPS } from '@/components/desktop/useSteps';
import { linuxInstallers, type Installer } from '@/lib/downloads';

// Install help for Linux (all three package formats) and the four steps every new user follows, on
// every platform. macOS's Gatekeeper steps live in components/MacInstallGuide.tsx.

function Command({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group flex items-start gap-2 rounded-lg bg-bg/80 py-2 pr-2 pl-3 font-mono text-[12px] leading-relaxed ring-1 ring-line">
      <span className="select-none text-brand">$</span>
      <code className="min-w-0 flex-1 break-all text-fg/90">{cmd}</code>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        aria-label="Copy command"
        className="grid size-6 shrink-0 place-items-center rounded-md text-faint transition hover:bg-white/5 hover:text-fg"
      >
        {copied ? <Check size={13} className="text-brand" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

const linuxSteps: Record<string, { title: string; cmds: (file: string) => string[]; note?: string }> = {
  'linux-deb': {
    title: 'Ubuntu, Debian, Mint, Pop!_OS',
    cmds: (f) => [`cd ~/Downloads`, `sudo apt install ./${f}`],
    note: 'apt also installs what Friday needs to hear your call (pulseaudio-utils).',
  },
  'linux-rpm': {
    title: 'Fedora, RHEL, openSUSE',
    cmds: (f) => [`cd ~/Downloads`, `sudo dnf install ./${f}`],
    note: 'On openSUSE, use sudo zypper install instead of sudo dnf install.',
  },
  'linux-appimage': {
    title: 'Any distro (Arch, Manjaro…)',
    cmds: (f) => [`cd ~/Downloads`, `chmod +x ${f}`, `./${f}`],
    note: 'Friday hears your call through parec. If it’s missing, install pulseaudio-utils (Debian, Ubuntu, Fedora) or libpulse (Arch, Manjaro).',
  },
};

/** Step-by-step Linux install, one tab per package format. */
export function LinuxInstallGuide({
  initial = 'linux-deb',
  compact = false,
  embedded = false,
}: {
  initial?: string;
  /** Folded behind a summary line (dashboard). */
  compact?: boolean;
  /** Just the steps, for a container that has its own heading (download dialog). */
  embedded?: boolean;
}) {
  const [tab, setTab] = useState(initial);
  const installer = linuxInstallers.find((i) => i.id === tab) ?? linuxInstallers[0];
  const step = linuxSteps[installer.id];
  const body = (
    <>
      <div role="tablist" aria-label="Package format" className="flex gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-line">
        {linuxInstallers.map((i: Installer) => (
          <button
            key={i.id}
            role="tab"
            type="button"
            aria-selected={i.id === tab}
            onClick={() => setTab(i.id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              i.id === tab ? 'bg-brand/15 text-brand ring-1 ring-brand/30' : 'text-muted hover:text-fg'
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">{step.title}</p>
      <ol className="mt-2 space-y-2.5 text-sm text-muted">
        <li className="flex gap-3">
          <Num n={1} />
          <span className="pt-0.5">
            Download <b className="font-medium text-fg/90">{installer.file}</b>.
          </span>
        </li>
        <li className="flex gap-3">
          <Num n={2} />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <span>Open a terminal and run:</span>
            {step.cmds(installer.file).map((c) => (
              <Command key={c} cmd={c} />
            ))}
          </div>
        </li>
        <li className="flex gap-3">
          <Num n={3} />
          <span className="pt-0.5">
            {installer.id === 'linux-appimage' ? 'Friday AI opens.' : 'Open Friday AI from your app menu.'} Sign in with your
            Friday account.
          </span>
        </li>
      </ol>
      {step.note && <p className="mt-3 text-xs text-faint">{step.note}</p>}
      <p className="mt-3 rounded-lg border border-warn/25 bg-warn/[0.07] px-3 py-2 text-xs text-muted">
        <b className="font-medium text-fg/90">On Linux:</b> the overlay can’t be hidden from screen sharing. Share a single window or
        tab, not your whole screen. Hotkeys may not work on some Wayland desktops; the overlay’s buttons always do. 64-bit (x86_64) only.
      </p>
    </>
  );

  if (embedded) return body;
  if (compact) {
    return (
      <details id="install-linux" className="group max-w-md rounded-xl border border-line bg-white/[0.02] p-4 text-left">
        <summary className="cursor-pointer list-none text-sm font-medium text-fg marker:hidden">
          Installing on Linux? <span className="text-muted group-open:hidden">Show the steps</span>
        </summary>
        <div className="mt-4">{body}</div>
      </details>
    );
  }
  return (
    <div id="install-linux" className="scroll-mt-24 rounded-2xl border border-line bg-bg/40 p-6 text-left">
      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Terminal size={18} className="text-brand" /> How to install Friday AI on Linux
      </h3>
      <div className="mt-5">{body}</div>
    </div>
  );
}

function Num({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-xs font-semibold text-fg ring-1 ring-line">{n}</span>
  );
}

/** Steps for Windows (Microsoft Store). */
export function WindowsInstallSteps() {
  return (
    <ol className="space-y-2.5 text-sm text-muted [&_b]:font-medium [&_b]:text-fg/90">
      {[
        <>
          The <b>Microsoft Store</b> opens on Friday AI. Click <b>Get</b> (or <b>Install</b>).
        </>,
        <>
          When it finishes, click <b>Open</b>, or find <b>Friday AI</b> in the Start menu.
        </>,
        <>Sign in with your Friday account.</>,
      ].map((s, i) => (
        <li key={i} className="flex gap-3">
          <Num n={i + 1} />
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}


/** The four steps from sign-up to a live answer, as a numbered list. */
export function UseSteps({ className = '' }: { className?: string }) {
  return (
    <ol className={`space-y-3 ${className}`}>
      {USE_STEPS.map(({ icon: Icon, title, body }, i) => (
        <li key={title} className="flex gap-3">
          <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/25">
            <Icon size={15} />
            <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-surface-2 text-[9px] font-bold text-fg ring-1 ring-line">
              {i + 1}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-muted">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

