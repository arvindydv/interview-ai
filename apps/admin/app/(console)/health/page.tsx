'use client';
import { AlertTriangle, Cpu, HeartPulse, ListChecks, RefreshCw, TimerReset } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { ago, int } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { Card, Dot, ErrorNote, PageHeader, Pill, Spinner, Stat, Table } from '@/components/ui';

// Kept in step with apps/api/src/routes/admin/workerHealth.ts.
interface WorkerHealth {
  at: string;
  workers: { host: string; pid: number; startedAt: string; at: string; queues: string[]; rssMb: number }[];
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number }[];
  recentFailures: { queue: string; name: string; id: string | null; reason: string; at: string | null; attempts: number }[];
  stuck: { preparing: number; submitting: number; oldestPreparingMin: number | null; oldestSubmittingMin: number | null };
  schedulers: { autoApplyTickAt: string | null; listingsSyncAt: string | null; listingsSyncFailures24h: number; retentionAt: string | null };
  alerts: { level: 'warning' | 'critical'; message: string }[];
}

export default function WorkerHealthPage() {
  const [r, reload] = useAsync(() => adminApi<WorkerHealth>('/admin/worker-health'), []);
  const d = r.data;
  return (
    <>
      <PageHeader
        title="Worker health"
        subtitle="The always-on pipeline: worker processes, queues, stuck applications and schedulers"
        action={
          <button onClick={reload} className="btn btn-secondary" disabled={r.state === 'loading'}>
            {r.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        }
      />
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {d && (
        <div className="mt-6 grid gap-6">
          {d.alerts.length > 0 && (
            <Card title="Alerts" icon={AlertTriangle}>
              <ul className="grid gap-2 text-sm">
                {d.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Pill tone={a.level === 'critical' ? 'bad' : 'warn'}>{a.level}</Pill> {a.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Worker processes" value={d.workers.length} hint={d.workers.length ? `last beat ${ago(d.workers[0].at)}` : 'none running'} />
            <Stat label="Stuck preparing" value={d.stuck.preparing} hint={d.stuck.oldestPreparingMin != null ? `oldest ${d.stuck.oldestPreparingMin} min` : undefined} />
            <Stat label="Submissions past lease" value={d.stuck.submitting} hint={d.stuck.oldestSubmittingMin != null ? `oldest ${d.stuck.oldestSubmittingMin} min` : undefined} />
            <Stat label="Sync failures, 24h" value={d.schedulers.listingsSyncFailures24h} />
          </div>
          <Card title="Worker processes" icon={HeartPulse} pad={false}>
            <Table head={['Host', 'PID', 'Started', 'Last beat', 'Memory', 'Queues']}>
              {d.workers.map((w) => (
                <tr key={`${w.host}:${w.pid}`}>
                  <td className="px-5 py-2.5"><span className="flex items-center gap-2"><Dot tone="ok" pulse /> {w.host}</span></td>
                  <td className="px-5 py-2.5 tabular-nums">{w.pid}</td>
                  <td className="px-5 py-2.5 text-muted">{ago(w.startedAt)}</td>
                  <td className="px-5 py-2.5 text-muted">{ago(w.at)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{int(w.rssMb)} MB</td>
                  <td className="px-5 py-2.5 text-xs text-muted">{w.queues.join(', ')}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Queues" icon={ListChecks} pad={false}>
            <Table head={['Queue', 'Waiting', 'Active', 'Delayed', 'Failed', 'Completed']}>
              {d.queues.map((q) => (
                <tr key={q.name}>
                  <td className="px-5 py-2.5 font-medium">{q.name}</td>
                  <td className="px-5 py-2.5 tabular-nums">{int(q.waiting)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{int(q.active)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{int(q.delayed)}</td>
                  <td className={`px-5 py-2.5 tabular-nums ${q.failed ? 'text-danger' : ''}`}>{int(q.failed)}</td>
                  <td className="px-5 py-2.5 tabular-nums text-muted">{int(q.completed)}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Schedulers" icon={TimerReset}>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">Auto Apply planned</dt><dd>{d.schedulers.autoApplyTickAt ? ago(d.schedulers.autoApplyTickAt) : '—'}</dd></div>
              <div><dt className="text-muted">Listings synced</dt><dd>{d.schedulers.listingsSyncAt ? ago(d.schedulers.listingsSyncAt) : '—'}</dd></div>
              <div><dt className="text-muted">Retention ran</dt><dd>{d.schedulers.retentionAt ? ago(d.schedulers.retentionAt) : '—'}</dd></div>
            </dl>
          </Card>
          <Card title="Recent failures" icon={Cpu} pad={false}>
            <Table head={['When', 'Queue', 'Job', 'Attempts', 'Reason']}>
              {d.recentFailures.map((f, i) => (
                <tr key={`${f.queue}:${f.id ?? i}`} className="align-top">
                  <td className="px-5 py-2.5 text-muted">{f.at ? ago(f.at) : '—'}</td>
                  <td className="px-5 py-2.5">{f.queue}</td>
                  <td className="px-5 py-2.5">{f.name}</td>
                  <td className="px-5 py-2.5 tabular-nums">{f.attempts}</td>
                  <td className="max-w-[480px] px-5 py-2.5 text-xs text-muted">{f.reason}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
