// Desktop installer links. File names match what `tauri build` produces (see .github/workflows/desktop.yml).
// Point NEXT_PUBLIC_DOWNLOADS_URL at where installers are published, e.g. a GitHub release:
//   https://github.com/<org>/<repo>/releases/download/desktop-v0.1.0

export const DESKTOP_VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION ?? '0.1.0';
export const DOWNLOADS_URL = (process.env.NEXT_PUBLIC_DOWNLOADS_URL ?? '').replace(/\/$/, '');

export type Platform = 'windows' | 'macos' | 'linux';

export interface Installer {
  id: string;
  platform: Platform;
  label: string;
  detail: string;
  file: string;
  /** Shown under Linux options: how to run it after downloading. */
  hint?: string;
}

const v = DESKTOP_VERSION;

export const installers: Installer[] = [
  { id: 'windows', platform: 'windows', label: 'Windows', detail: 'Windows 10 & 11 · 64-bit', file: `Parakeet_${v}_x64-setup.exe` },
  { id: 'macos', platform: 'macos', label: 'macOS', detail: 'Apple Silicon & Intel · macOS 11+', file: `Parakeet_${v}_universal.dmg` },
  {
    id: 'ubuntu',
    platform: 'linux',
    label: 'Ubuntu / Debian',
    detail: '.deb · Ubuntu 22.04+, Debian 12+, Mint, Pop!_OS',
    file: `Parakeet_${v}_amd64.deb`,
    hint: `sudo apt install ./Parakeet_${v}_amd64.deb`,
  },
  {
    id: 'arch',
    platform: 'linux',
    label: 'Arch / Manjaro',
    detail: '.AppImage · runs on any distro',
    file: `Parakeet_${v}_amd64.AppImage`,
    hint: `chmod +x Parakeet_${v}_amd64.AppImage && ./Parakeet_${v}_amd64.AppImage`,
  },
  {
    id: 'fedora',
    platform: 'linux',
    label: 'Fedora / openSUSE',
    detail: '.rpm · Fedora 38+, RHEL 9+',
    file: `Parakeet-${v}-1.x86_64.rpm`,
    hint: `sudo dnf install ./Parakeet-${v}-1.x86_64.rpm`,
  },
];

export function downloadUrl(i: Installer): string | null {
  return DOWNLOADS_URL ? `${DOWNLOADS_URL}/${i.file}` : null;
}

/** Best guess at the visitor's OS, used to highlight the right button. */
export function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}

/** Narrow a Linux visitor to a distro when the browser reveals it (rare; falls back to none). */
export function detectLinuxDistro(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Ubuntu|Debian|Mint/i.test(ua)) return 'ubuntu';
  if (/Fedora|Red Hat|openSUSE/i.test(ua)) return 'fedora';
  if (/Arch|Manjaro/i.test(ua)) return 'arch';
  return null;
}
