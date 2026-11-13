'use client';
import { useEffect, useState } from 'react';
import { Link2Off, ShieldCheck, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

// Connected accounts and Friday Jobs data (apps/api/src/routes/account.ts). Friday never stores a
// password for another site: Gmail is an encrypted OAuth token, the extension has its own device token.

interface Connections {
  gmail: { email: string; connectedAt: string } | null;
  devices: { id: string; name: string; connectedAt: string; lastSeenAt: string | null }[];
  botSessions: { platform: string; status: string; connectedAt: string }[];
}

const PLATFORM: Record<string, string> = { linkedin: 'LinkedIn', indeed: 'Indeed', naukri: 'Naukri' };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function AccountPrivacy() {
  const [c, setC] = useState<Connections | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleted, setDeleted] = useState(false);

  const load = () => api<Connections>('/v1/account/connections').then(setC).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const disconnect = (kind: 'gmail' | 'devices' | 'bot') => run(kind, () => api(`/v1/account/connections/${kind}`, { method: 'DELETE' }));
  const deleteAll = () =>
    run('delete', async () => {
      await api('/v1/account/jobs-data/delete', { method: 'POST', body: JSON.stringify({ confirm }) });
      setDeleted(true);
      setConfirm('');
    });

  const rows: { key: 'gmail' | 'devices' | 'bot'; label: string; detail: string | null }[] = c
    ? [
        { key: 'gmail', label: 'Gmail (cold emails)', detail: c.gmail ? `${c.gmail.email} · since ${day(c.gmail.connectedAt)}` : null },
        {
          key: 'devices',
          label: 'Friday extension',
          detail: c.devices.length ? c.devices.map((d) => d.name).join(', ') : null,
        },
        {
          key: 'bot',
          label: 'Platform sessions (experimental)',
          detail: c.botSessions.length ? c.botSessions.map((s) => PLATFORM[s.platform] ?? s.platform).join(', ') : null,
        },
      ]
    : [];

  return (
    <section className="card mt-6 p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-brand">
          <ShieldCheck size={20} />
        </span>
        <div>
          <h2 className="font-semibold">Connected accounts &amp; data</h2>
          <p className="text-sm text-muted">Friday never stores your password for another site. Disconnect anything at any time.</p>
        </div>
      </div>

      {!c ? (
        <div className="mt-5 grid place-items-center py-4">{error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="text-muted" />}</div>
      ) : (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="truncate text-sm text-muted">{r.detail ?? 'Not connected'}</p>
              </div>
              {r.detail && (
                <button onClick={() => disconnect(r.key)} disabled={busy !== null} className="btn btn-secondary">
                  {busy === r.key ? <Spinner /> : <><Link2Off size={14} /> Disconnect</>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Delete my Friday Jobs data</h3>
        <p className="mt-1 text-sm text-muted">
          Removes your applications, tailored resumes, answers, matches and connections from Friday. Applications already sent stay with the
          employers. Your main resume and interview history are kept.
        </p>
        {deleted ? (
          <p className="mt-3 text-sm text-brand">Your Friday Jobs data was deleted.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="h-10 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none focus:border-danger/50 sm:max-w-60"
            />
            <button onClick={deleteAll} disabled={confirm !== 'DELETE' || busy !== null} className="btn btn-secondary text-danger">
              {busy === 'delete' ? <Spinner /> : <><Trash2 size={14} /> Delete</>}
            </button>
          </div>
        )}
        {error && c && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </section>
  );
}
