// Desktop installer links. File names match what `tauri build` produces (see .github/workflows/desktop.yml).
// Point NEXT_PUBLIC_DOWNLOADS_URL at where installers are published: the downloads CDN (infra/downloads.tf),
//   https://<id>.cloudfront.net/desktop/v0.1.0
// or a GitHub release (slow from many Indian ISPs): https://github.com/<org>/<repo>/releases/download/desktop-v0.1.0

export const DESKTOP_VERSION = process.env.NEXT_PUBLIC_DESKTOP_VERSION ?? '0.1.0';
export const DOWNLOADS_URL = (process.env.NEXT_PUBLIC_DOWNLOADS_URL ?? '').replace(/\/$/, '');

// The website offers Windows and macOS only (the desktop workflow still builds Linux packages).
export type Platform = 'windows' | 'macos';

export interface Installer {
  id: string;
  platform: Platform;
  label: string;
  detail: string;
  file: string;
}

const v = DESKTOP_VERSION;
/**
 * Tauri names installers after `productName` in apps/desktop/src-tauri/tauri.conf.json ("Friday AI"); GitHub
 * Releases and the CDN upload (desktop.yml) both replace the space with a dot.
 */
const name = 'Friday.AI';

export const installers: Installer[] = [
  { id: 'windows', platform: 'windows', label: 'Windows', detail: 'Windows 10 & 11 · 64-bit', file: `${name}_${v}_x64-setup.exe` },
  { id: 'macos', platform: 'macos', label: 'macOS', detail: 'Apple Silicon & Intel · macOS 11+', file: `${name}_${v}_universal.dmg` },
];

export function downloadUrl(i: Installer): string | null {
  if (!DOWNLOADS_URL) return null;
  return `${DOWNLOADS_URL}/${encodeURIComponent(i.file)}`;
}

/** Best guess at the visitor's OS, used to highlight the right button. */
export function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'macos';
  return null;
}
