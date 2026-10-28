'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import {
  DESKTOP_VERSION, detectLinuxDistro, detectPlatform, downloadUrl, installers, type Installer, type Platform,
} from '@/lib/downloads';

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

function LinuxIcon({ size = 16 }: { size?: number }) {
  // Simple Tux silhouette.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2c-2.2 0-3.6 1.8-3.6 4.4 0 1.3.3 2.2-.3 3.4-.8 1.5-2.6 3.6-2.9 6.2-.1 1 .3 1.6.9 1.8-.4.9-.2 2 1.1 2.4 1.4.4 2.6-.4 3.6-.2.9.2 1.6.9 2.6.9h.2c1 0 1.7-.7 2.6-.9 1-.2 2.2.6 3.6.2 1.3-.4 1.5-1.5 1.1-2.4.6-.2 1-.8.9-1.8-.3-2.6-2.1-4.7-2.9-6.2-.6-1.2-.3-2.1-.3-3.4C15.6 3.8 14.2 2 12 2Zm-1.6 4.1c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1Zm3.2 0c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1ZM12 9.2c.9 0 2 .5 2 .9s-1.1 1.1-2 1.1-2-.7-2-1.1.9-.9 2-.9Z" />
    </svg>
  );
}

function InstallerLink({
  installer,
  primary,
  className = '',
  children,
  onUnavailable,
  onStart,
}: {
  installer: Installer;
  primary?: boolean;
  className?: string;
  children: React.ReactNode;
  onUnavailable: () => void;
  onStart?: () => void;
}) {
  const href = downloadUrl(installer);
  return (
    <a
      href={href ?? '#'}
      download={href ? installer.file : undefined}
      onClick={(e) => {
        if (!href) {
          e.preventDefault();
          onUnavailable();
        } else {
          onStart?.();
        }
      }}
      className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} ${className}`}
    >
      {children}
    </a>
  );
}

function CopyHint({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy install command"
      className="mt-2 flex w-full items-center gap-2 rounded-md bg-bg/80 px-2 py-1.5 text-left font-mono text-[11px] text-muted ring-1 ring-line hover:text-fg"
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {copied ? <Check size={12} className="shrink-0 text-brand" /> : <Copy size={12} className="shrink-0" />}
    </button>
  );
}

/** Windows, macOS and a Linux menu (Ubuntu/Debian, Arch/Manjaro, Fedora). The visitor's OS is highlighted. */
export function DownloadButtons({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [distro, setDistro] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [started, setStarted] = useState<Platform | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu is portalled to <body> so cards with overflow-hidden (used for glow effects) can't clip it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    setDistro(detectLinuxDistro());
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const MENU_W = 320;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Right-align with the trigger, but keep a 16px gutter inside the viewport.
      const left = Math.max(16, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 16));
      // Open upward when there isn't room below (e.g. a CTA near the bottom of the page).
      const h = menuRef.current?.offsetHeight ?? 340;
      const fitsBelow = r.bottom + 8 + h <= window.innerHeight - 16;
      const top = fitsBelow || r.top - 8 - h < 16 ? r.bottom + 8 : r.top - 8 - h;
      setPos({ top, left });
    };
    place();
    // Re-place once the menu has rendered and its real height is known.
    const frame = requestAnimationFrame(place);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const pad = size === 'lg' ? 'px-6 py-3' : '';
  const unavailable = () => {
    setOpen(false);
    setNotice(true);
  };
  const win = installers.find((i) => i.id === 'windows')!;
  const mac = installers.find((i) => i.id === 'macos')!;
  const linux = installers.filter((i) => i.platform === 'linux');
  // Default to the visitor's OS; without a signal, keep Windows as the most common.
  const primary: Platform = platform ?? 'windows';

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <InstallerLink installer={win} primary={primary === 'windows'} className={pad} onUnavailable={unavailable} onStart={() => setStarted('windows')}>
          <WindowsIcon /> Windows
        </InstallerLink>
        <InstallerLink installer={mac} primary={primary === 'macos'} className={pad} onUnavailable={unavailable} onStart={() => setStarted('macos')}>
          <AppleIcon /> macOS
        </InstallerLink>

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`btn ${primary === 'linux' ? 'btn-primary' : 'btn-secondary'} ${pad}`}
          >
            <LinuxIcon /> Linux <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && pos && createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left }}
              className="z-50 w-80 max-w-[calc(100vw-2rem)] animate-fade-up rounded-xl border border-line-strong bg-surface p-1.5 text-left shadow-2xl shadow-black/70 [animation-duration:150ms]"
            >
              {linux.map((i) => {
                const href = downloadUrl(i);
                const recommended = distro === i.id;
                return (
                  <div key={i.id} className="rounded-lg p-2.5 hover:bg-white/[0.04]">
                    <a
                      role="menuitem"
                      href={href ?? '#'}
                      download={href ? i.file : undefined}
                      onClick={(e) => {
                        if (!href) {
                          e.preventDefault();
                          unavailable();
                        }
                      }}
                      className="flex items-start gap-3"
                    >
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-fg ring-1 ring-line">
                        <Download size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                          {i.label}
                          {recommended && (
                            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                              Detected
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted">{i.detail}</span>
                      </span>
                    </a>
                    {i.hint && <CopyHint text={i.hint} />}
                  </div>
                );
              })}
              <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">x86_64 · v{DESKTOP_VERSION}</p>
            </div>,
            document.body,
          )}
        </div>
      </div>
      {/* The installers aren't code-signed yet, so the OS warns on first launch. Remove once they are. */}
      {started === 'windows' && (
        <p className="mt-3 text-xs text-muted">
          If Windows shows <span className="text-fg/80">"Windows protected your PC"</span>, click{' '}
          <span className="text-fg/80">More info</span> → <span className="text-fg/80">Run anyway</span>.
        </p>
      )}
      {started === 'macos' && (
        <p className="mt-3 text-xs text-muted">
          If macOS shows <span className="text-fg/80">"Friday AI Not Opened"</span>, click <span className="text-fg/80">Done</span>, then
          open <span className="text-fg/80">System Settings → Privacy &amp; Security</span> and click{' '}
          <span className="text-fg/80">Open Anyway</span>.{' '}
          <a href="#install-macos" className="text-brand hover:underline">All steps</a>
        </p>
      )}
      {notice && (
        <p className="mt-3 text-xs text-muted">
          Installers aren't published yet. Set <code className="text-fg/80">NEXT_PUBLIC_DOWNLOADS_URL</code> once a release is out.
        </p>
      )}
    </div>
  );
}

