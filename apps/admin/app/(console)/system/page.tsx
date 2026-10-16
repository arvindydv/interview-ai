'use client';
import { Activity, Cpu, Layers, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { AdminSystem } from '@parakeet/shared';
import { adminApi, API_URL } from '@/lib/api';
import { dateTime, int } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';
import { Card, Dot, ErrorNote, PageHeader, Pill, Spinner, Stat } from '@/components/ui';

const COUNT_ORDER = ['waiting', 'active', 'delayed', 'completed', 'failed'];

export default function SystemPage() {
  const [r, reload] = useAsync(() => adminApi<AdminSystem>('/admin/system'), []);
  const act = useAction();
  const d = r.data;

  const queueAction = (name: string, op: 'retry-failed' | 'clean-failed') => {
    const msg = op === 'retry-failed' ? `Retry every failed job in "${name}"?` : `Permanently remove every failed job in "${name}"?`;
    if (!window.confirm(msg)) return;
    act.run(`${name}-${op}`, () => adminApi(`/admin/queues/${name}/${op}`, { method: 'POST' })).then((ok) => ok && reload());
  };

  return (
    <>
      <PageHeader
        title="System"
        subtitle={<span className="font-mono text-xs">{API_URL}</span>}
        action={
          <button onClick={reload} className="btn btn-secondary" disabled={r.state === 'loading'}>
            {r.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        }
      />
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {act.error && <ErrorNote>{act.error}</ErrorNote>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="API health"
              value={<span className={d.health.ok ? 'text-brand' : 'text-danger'}>{d.health.ok ? 'Healthy' : 'Degraded'}</span>}
              hint={`version ${d.health.version}`}
            />
            <Stat label="Live connections" value={d.liveConnections} hint="on this API instance" />
            <Stat
              label="AI answers"
              value={<span className={d.llmConfigured ? 'text-brand' : 'text-warn'}>{d.llmConfigured ? 'Connected' : 'Sample mode'}</span>}
              hint={d.llmConfigured ? 'Claude API key set' : 'ANTHROPIC_API_KEY not set'}
            />
            <Stat label="Models" value={<span className="font-mono text-sm">{d.models.fast}</span>} hint={`vision: ${d.models.vision}`} />
          </div>

          <Card title="Dependencies" icon={Activity}>
            <ul className="divide-y divide-line">
              {Object.entries(d.health.checks).map(([name, c]) => (
                <li key={name} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <Dot tone={c.ok ? 'ok' : 'bad'} pulse={c.ok} />
                  <span className="capitalize">{name}</span>
                  <span className="ml-auto font-mono text-xs text-muted">{c.ok ? `${c.latencyMs} ms` : c.error}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
            {d.queues.map((q) => (
              <Card
                key={q.name}
                title={<span className="font-mono">{q.name}</span>}
                icon={Layers}
                action={
                  (q.counts.failed ?? 0) > 0 && (
                    <div className="flex gap-1">
                      <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled={act.busy !== null} onClick={() => queueAction(q.name, 'retry-failed')}>
                        {act.busy === `${q.name}-retry-failed` ? <Spinner /> : <RotateCcw size={13} />} Retry
                      </button>
                      <button className="btn btn-ghost !px-2 !py-1 text-xs text-danger" disabled={act.busy !== null} onClick={() => queueAction(q.name, 'clean-failed')}>
                        <Trash2 size={13} /> Clear
                      </button>
                    </div>
                  )
                }
              >
                {Object.keys(q.counts).length === 0 ? (
                  <p className="text-sm text-danger">Couldn&apos;t read this queue.</p>
                ) : (
                  <dl className="grid grid-cols-5 gap-2 text-center">
                    {COUNT_ORDER.map((k) => (
                      <div key={k} className="rounded-lg bg-white/[0.03] px-1 py-2 ring-1 ring-line">
                        <dd className={`text-lg font-semibold tabular-nums ${k === 'failed' && q.counts[k] ? 'text-danger' : ''}`}>{int(q.counts[k] ?? 0)}</dd>
                        <dt className="text-[10px] text-muted">{k}</dt>
                      </div>
                    ))}
                  </dl>
                )}
                {q.failed.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {q.failed.map((j) => (
                      <li key={j.id} className="rounded-lg border border-danger/20 bg-danger/5 p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono">{j.name}</span>
                          <Pill tone="bad">{j.attemptsMade} attempts</Pill>
                        </div>
                        <p className="mt-1 line-clamp-2 text-muted">{j.failedReason || 'No reason recorded'}</p>
                        <p className="mt-1 text-faint">
                          #{j.id} · {dateTime(new Date(j.timestamp).toISOString())}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>

          <Card title="Worker" icon={Cpu}>
            <p className="text-sm text-muted">
              The worker processes the <span className="font-mono">email</span> (welcome, new-device alerts),{' '}
              <span className="font-mono">profile</span> (resume analysis) and <span className="font-mono">system</span> queues. Jobs piling up in
              &ldquo;waiting&rdquo; usually mean <span className="font-mono">apps/worker</span> isn&apos;t running.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
