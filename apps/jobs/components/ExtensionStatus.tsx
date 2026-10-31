'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Puzzle, X } from 'lucide-react';
import type { AutoApplyDevice } from '@parakeet/shared';
import { Spinner } from './ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

// The Friday extension, which submits prepared applications: whether it's installed in this browser
// (it marks the page, see apps/extension/src/session.js) and which browsers are connected.

const EXTENSION_URL = process.env.NEXT_PUBLIC_EXTENSION_URL ?? '';
/** A browser not heard from in this long isn't sending anything. */
const ACTIVE_MS = 24 * 3600_000;

function useExtension() {
  const [state, setState] = useState<{ installed: boolean; deviceId: string | null } | null>(null);
  useEffect(() => {
    const read = () => {
      const d = document.documentElement.dataset;
      setState({ installed: Boolean(d.fridayExtension), deviceId: d.fridayDevice ?? null });
    };
    read();
    // The extension marks the page once it has loaded and connected.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-friday-extension', 'data-friday-device'] });
    return () => observer.disconnect();
  }, []);
  return state;
}

export function ExtensionStatus({ devices, enabled, prepared, onChange }: {
  devices: AutoApplyDevice[];
  enabled: boolean;
  /** Applications ready to send. */
  prepared: number;
  onChange: () => void;
}) {
  const ext = useExtension();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = devices.filter((d) => d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ACTIVE_MS);
  const thisOne = ext?.deviceId ? devices.find((d) => d.id === ext.deviceId) : undefined;

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/v1/auto-apply/devices/${id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-line p-4 text-sm">
      <div className="flex items-start gap-3">
        <Puzzle size={18} className="mt-0.5 shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Friday extension for Chrome</p>
          <p className="mt-0.5 text-muted">
            It sends the applications Friday&rsquo;s servers can&rsquo;t (CAPTCHAs, sign-ins, Workday) whenever your browser is
            open, or all of them if you chose only your browser, and stops for you when a job board asks for a check.
          </p>

          {ext === null ? null : !ext.installed ? (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 font-medium text-amber-800">
                <AlertCircle size={15} /> Not installed in this browser
              </p>
              {EXTENSION_URL ? (
                <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="btn btn-brand mt-2 !py-1.5 !text-xs">
                  Add to Chrome
                </a>
              ) : (
                <p className="mt-1 text-xs text-muted">Install the Friday extension, then come back to this page; it connects on its own.</p>
              )}
            </div>
          ) : thisOne ? (
            <p className="mt-3 flex items-center gap-1.5 font-medium text-brand">
              <CheckCircle2 size={15} /> Installed and connected. Press Start in the extension to begin sending.
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-muted">
              <Spinner /> Installed; connecting… If this doesn’t change, open the extension and press Connect.
            </p>
          )}

          {enabled && prepared > 0 && active.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              {prepared} application{prepared === 1 ? ' is' : 's are'} ready, but no browser has picked anything up in the last day.
              Open Chrome with the extension and press Start.
            </p>
          )}

          {devices.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {d.name}
                      {d.id === thisOne?.id && <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand uppercase">This browser</span>}
                    </p>
                    <p className="text-xs text-muted">{d.lastSeenAt ? `Last active ${timeAgo(d.lastSeenAt)}` : `Connected ${timeAgo(d.createdAt)}`}</p>
                  </div>
                  {d.id === thisOne?.id ? (
                    <span className="text-xs text-faint">Pause or disconnect it from the extension</span>
                  ) : (
                    <button
                      onClick={() => remove(d.id)}
                      disabled={busy === d.id}
                      className="btn btn-ghost !p-1.5"
                      aria-label={`Disconnect ${d.name}`}
                      title="Disconnect: it stops sending applications"
                    >
                      {busy === d.id ? <Spinner /> : <X size={15} />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
