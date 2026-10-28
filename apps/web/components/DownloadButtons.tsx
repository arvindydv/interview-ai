'use client';
import { useEffect, useState } from 'react';
import { detectPlatform, downloadUrl, installers, type Installer, type Platform } from '@/lib/downloads';

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
      download={href && installer.platform !== 'windows' ? installer.file : undefined}
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

/** Windows and macOS installers. The visitor's OS is highlighted. */
export function DownloadButtons({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [notice, setNotice] = useState(false);
  const [started, setStarted] = useState<Platform | null>(null);

  useEffect(() => setPlatform(detectPlatform()), []);

  const pad = size === 'lg' ? 'px-6 py-3' : '';
  const unavailable = () => setNotice(true);
  const win = installers.find((i) => i.id === 'windows')!;
  const mac = installers.find((i) => i.id === 'macos')!;
  // Default to the visitor's OS; without a signal, keep Windows as the most common.
  const primary: Platform = platform ?? 'windows';

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <InstallerLink installer={win} primary={primary === 'windows'} className={pad} onUnavailable={unavailable} >
          <WindowsIcon /> Windows
        </InstallerLink>
        <InstallerLink installer={mac} primary={primary === 'macos'} className={pad} onUnavailable={unavailable} onStart={() => setStarted('macos')}>
          <AppleIcon /> macOS
        </InstallerLink>
      </div>
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

