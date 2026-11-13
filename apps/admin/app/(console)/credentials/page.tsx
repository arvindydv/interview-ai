'use client';
import { useState } from 'react';
import { Ban, KeyRound, Plus, RefreshCw, ShieldCheck, Target } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { ago, int } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Card, Drawer, Empty, ErrorNote, PageHeader, Pill, Spinner, Stat, Table, selectCls } from '@/components/ui';

// Employer ATS credentials for authorized API submission (apps/api/src/routes/admin/atsCredentials.ts).
// A credential is an API key an employer (or an ATS partner) issued to Friday with written permission;
// without one, that employer's jobs go to the candidate's browser or Assisted Apply. Secrets are
// write-only: encrypted on the way in, never shown again.

interface Credential {
  id: string;
  provider: string;
  board: string;
  grantedBy: string;
  agreementRef: string;
  verifiedAt: string | null;
  lastError: string | null;
  revokedAt: string | null;
  createdAt: string;
  dailyCap: number;
  sentToday: number;
  openListings: number;
  connectorImplemented: boolean;
}

interface TargetBoard {
  provider: string;
  board: string;
  company: string;
  openListings: number;
  indiaTech: number;
  indiaTech30d: number;
  eligibleMatches: number;
  connectorImplemented: boolean;
  credential: 'active' | 'flagged' | 'revoked' | null;
}

const PROVIDERS: { id: string; label: string; secretHint: string }[] = [
  { id: 'greenhouse', label: 'Greenhouse', secretHint: 'Job Board API key (Greenhouse → Configure → Dev Center → API Credential Management, type “Job Board”)' },
  { id: 'lever', label: 'Lever', secretHint: 'Postings API key from the employer’s Lever account (Settings → Integrations and API)' },
  { id: 'ashby', label: 'Ashby', secretHint: 'Ashby API key with the candidatesWrite permission' },
  { id: 'smartrecruiters', label: 'SmartRecruiters', secretHint: 'X-SmartToken from the employer, or our partner key' },
  { id: 'workable', label: 'Workable', secretHint: 'Employer API access token with the r_jobs and w_candidates scopes. If their Workable subdomain differs from the board, enter {"apiKey": "…", "subdomain": "…"}' },
  { id: 'teamtailor', label: 'Teamtailor', secretHint: 'Employer admin API key (no connector yet: stored, not used)' },
];
const label = (p: string) => PROVIDERS.find((x) => x.id === p)?.label ?? p;

function status(c: Credential) {
  if (c.revokedAt) return <Pill>revoked</Pill>;
  if (c.lastError) return <Pill tone="bad">refused</Pill>;
  if (!c.connectorImplemented) return <Pill tone="warn">no connector</Pill>;
  if (c.verifiedAt) return <Pill tone="ok">verified</Pill>;
  return <Pill tone="info">active</Pill>;
}

const EMPTY_FORM = { provider: 'greenhouse', board: '', secret: '', grantedBy: '', agreementRef: '', dailyCap: 10 };

export default function CredentialsPage() {
  const [creds, reloadCreds] = useAsync(() => adminApi<Credential[]>('/admin/ats-credentials'), []);
  const [targets, reloadTargets] = useAsync(() => adminApi<TargetBoard[]>('/admin/ats-credentials/targets?limit=40'), []);
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = () => {
    reloadCreds();
    reloadTargets();
  };
  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(done);
      reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const active = (creds.data ?? []).filter((c) => !c.revokedAt);
  const usable = active.filter((c) => !c.lastError && c.connectorImplemented);
  const unlocked = usable.reduce((n, c) => n + c.openListings, 0);
  const t = targets.data ?? [];
  const top10 = t.slice(0, 10).reduce((n, b) => n + b.indiaTech, 0);

  return (
    <>
      <PageHeader
        title="Employer credentials"
        subtitle="Authorized API submission: an employer’s key, with their written permission, lets Friday send applications to their jobs while candidates’ laptops are off"
        action={
          <div className="flex gap-2">
            <button onClick={reload} className="btn btn-secondary" disabled={creds.state === 'loading'}>
              {creds.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
            </button>
            <button onClick={() => setForm({ ...EMPTY_FORM })} className="btn btn-primary">
              <Plus size={15} /> Add credential
            </button>
          </div>
        }
      />
      {creds.state === 'error' && <ErrorNote>{creds.error}</ErrorNote>}
      {targets.state === 'error' && <ErrorNote>{targets.error}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <p className="mt-4 text-sm text-brand">{note}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Usable credentials" value={usable.length} hint={`${active.length - usable.length} refused or without a connector`} />
        <Stat label="Open jobs they unlock" value={int(unlocked)} hint="sent through the employer’s API" />
        <Stat label="Boards that could be unlocked" value={t.filter((b) => !b.credential).length} hint="with India tech jobs open" />
        <Stat label="India tech jobs on the top 10" value={int(top10)} hint="if those 10 employers granted a key" />
      </div>

      <Card title="Credentials" icon={KeyRound} pad={false} className="mt-6">
        {creds.data && !creds.data.length ? (
          <div className="px-5 pb-5">
            <Empty>No employer credentials yet. Every job goes to the candidate’s browser or Assisted Apply until one is added.</Empty>
          </div>
        ) : (
          <Table head={['Employer board', 'Status', 'Granted by', 'Agreement', 'Today / daily cap', 'Open jobs', 'Added', '']}>
            {(creds.data ?? []).map((c) => (
              <tr key={c.id} className={c.revokedAt ? 'opacity-50' : ''}>
                <td className="px-5 py-2.5">
                  <p className="font-medium">{c.board}</p>
                  <p className="text-xs text-muted">{label(c.provider)}</p>
                </td>
                <td className="px-5 py-2.5">
                  {status(c)}
                  {c.lastError && <p className="mt-1 max-w-64 truncate text-xs text-danger" title={c.lastError}>{c.lastError}</p>}
                </td>
                <td className="px-5 py-2.5">{c.grantedBy}</td>
                <td className="max-w-48 truncate px-5 py-2.5 text-muted" title={c.agreementRef}>{c.agreementRef}</td>
                <td className="px-5 py-2.5 tabular-nums">
                  {c.sentToday} / {c.dailyCap}
                  {!c.revokedAt && (
                    <button
                      className="ml-2 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
                      disabled={busy !== null}
                      onClick={() => {
                        const v = window.prompt(`Applications a day ${c.board} agreed to receive (1–1000):`, String(c.dailyCap));
                        const n = Number(v);
                        if (v !== null && Number.isInteger(n) && n >= 1 && n <= 1000) {
                          void run(`c${c.id}`, () => adminApi(`/admin/ats-credentials/${c.id}`, { method: 'PATCH', body: JSON.stringify({ dailyCap: n }) }), `Daily cap set to ${n}.`);
                        }
                      }}
                    >
                      change
                    </button>
                  )}
                </td>
                <td className="px-5 py-2.5 tabular-nums">{int(c.openListings)}</td>
                <td className="px-5 py-2.5 text-muted">{ago(c.createdAt)}</td>
                <td className="px-5 py-2.5">
                  {!c.revokedAt && (
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-secondary !py-1.5 !text-xs"
                        disabled={busy !== null}
                        title="A read-only check by the worker; never a test submission"
                        onClick={() => run(`v${c.id}`, () => adminApi(`/admin/ats-credentials/${c.id}/verify`, { method: 'POST' }), 'Check queued; refresh in a minute.')}
                      >
                        {busy === `v${c.id}` ? <Spinner /> : <ShieldCheck size={14} />} Check
                      </button>
                      <button
                        className="btn btn-secondary !py-1.5 !text-xs text-danger"
                        disabled={busy !== null}
                        onClick={() =>
                          window.confirm(`Revoke the ${label(c.provider)} credential for ${c.board}? Its jobs go back to candidates’ browsers and Assisted Apply.`) &&
                          run(`r${c.id}`, () => adminApi(`/admin/ats-credentials/${c.id}`, { method: 'DELETE' }), 'Revoked.')
                        }
                      >
                        {busy === `r${c.id}` ? <Spinner /> : <Ban size={14} />} Revoke
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Where a credential would unlock the most" icon={Target} pad={false} className="mt-6">
        <p className="px-5 pb-3 text-sm text-muted">
          Employer boards ranked by open India tech jobs. Ask these employers (or the ATS’s partner programme) for API access; nothing is sent to a
          board without one.
        </p>
        <Table head={['Employer', 'ATS', 'India tech jobs', 'Last 30 days', 'Eligible matches', 'Connector', '']}>
          {t.map((b) => (
            <tr key={`${b.provider}:${b.board}`}>
              <td className="px-5 py-2.5">
                <p className="font-medium">{b.company}</p>
                <p className="text-xs text-muted">{b.board}</p>
              </td>
              <td className="px-5 py-2.5">{label(b.provider)}</td>
              <td className="px-5 py-2.5 tabular-nums">{int(b.indiaTech)}</td>
              <td className="px-5 py-2.5 tabular-nums">{int(b.indiaTech30d)}</td>
              <td className="px-5 py-2.5 tabular-nums">{int(b.eligibleMatches)}</td>
              <td className="px-5 py-2.5">{b.connectorImplemented ? <Pill tone="ok">ready</Pill> : <Pill tone="warn">not built</Pill>}</td>
              <td className="px-5 py-2.5 text-right">
                {b.credential === 'active' ? (
                  <Pill tone="ok">has credential</Pill>
                ) : (
                  <button
                    className="btn btn-secondary !py-1.5 !text-xs"
                    onClick={() => setForm({ ...EMPTY_FORM, provider: b.provider, board: b.board, grantedBy: b.company })}
                  >
                    <Plus size={14} /> Add
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Drawer open={form !== null} onClose={() => setForm(null)} title="Add an employer credential">
        {form && (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run('add', () => adminApi('/admin/ats-credentials', { method: 'POST', body: JSON.stringify(form) }), `Saved the ${label(form.provider)} credential for ${form.board}.`);
              if (ok) setForm(null);
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium">ATS</span>
              <select className={selectCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Board</span>
              <input className="input" required maxLength={200} value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value })} list="boards" placeholder="The board token as in its job URLs, e.g. okta" />
              <datalist id="boards">
                {t.filter((b) => b.provider === form.provider).map((b) => (
                  <option key={b.board} value={b.board}>{b.company}</option>
                ))}
              </datalist>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">API key</span>
              <input className="input" type="password" autoComplete="off" required minLength={8} maxLength={4000} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
              <span className="text-xs text-muted">{PROVIDERS.find((p) => p.id === form.provider)?.secretHint}. Stored encrypted; it can’t be viewed again.</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Granted by</span>
              <input className="input" required minLength={2} maxLength={200} value={form.grantedBy} onChange={(e) => setForm({ ...form, grantedBy: e.target.value })} placeholder="Employer or partner, and the person who approved it" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Written permission</span>
              <input className="input" required minLength={3} maxLength={500} value={form.agreementRef} onChange={(e) => setForm({ ...form, agreementRef: e.target.value })} placeholder="Link or reference to the signed agreement or email" />
              <span className="text-xs text-muted">Required. Applications go out in candidates’ names on this employer’s system: keep proof that they allowed it.</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Daily cap</span>
              <input className="input" type="number" required min={1} max={1000} value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })} />
              <span className="text-xs text-muted">Applications a day this employer agreed to receive. Start low; raise it once they’re happy with the quality.</span>
            </label>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy !== null}>{busy === 'add' ? <Spinner /> : 'Save credential'}</button>
            </div>
          </form>
        )}
      </Drawer>
    </>
  );
}
