'use client';
import { AlertTriangle, Building2, Cable, Database, Gauge, Globe2, RefreshCw, ShieldCheck, Tags } from 'lucide-react';
import {
  CONNECTOR_STATUS_LABELS, TECH_CATEGORIES,
  type ConnectorCapabilities, type ConnectorHealth, type ConnectorStatus, type ListingsAnalytics, type Permission,
} from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { ago, int, pct } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { BarList, DailyColumns } from '@/components/charts';
import { Card, Dot, ErrorNote, PageHeader, Pill, Spinner, Stat, Table } from '@/components/ui';

const CATEGORY_LABEL = Object.fromEntries(TECH_CATEGORIES.map((c) => [c.id, c.label])) as Record<string, string>;
const ELIGIBILITY_LABEL: Record<string, string> = {
  india: 'In India', remote_india: 'Remote, India', remote_global: 'Remote, worldwide', remote_apac: 'Remote, APAC (likely)',
  remote_unspecified: 'Remote, region not stated', remote_other: 'Remote, other countries', elsewhere: 'On-site abroad', unknown: 'No location',
};
const PERMISSION_TONE: Record<Permission, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  explicit: 'ok', documented: 'ok', unverified: 'warn', agreement: 'bad', no: 'bad',
};

const CONNECTOR_TONE: Record<ConnectorStatus, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  active: 'ok', personal_use_only: 'warn', assisted_only: 'neutral', blocked_pending_agreement: 'bad', access_restricted: 'bad',
};
const CAPS: [keyof ConnectorCapabilities, string][] = [
  ['discoverJobs', 'discover'], ['submitApplications', 'submit'], ['verifySubmission', 'verify'], ['supportsCloudExecution', 'cloud'],
  ['requiresUserInteraction', 'needs user'], ['requiresPartnership', 'partnership'],
];

/** The application connector registry: what each channel can do (permitted, not just possible) and its health. */
function Connectors() {
  const [r] = useAsync(() => adminApi<ConnectorHealth[]>('/admin/connectors'), []);
  return (
    <Card title="Application connectors" icon={Cable}>
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {r.data && (
        <Table head={['Connector', 'Status', 'Capabilities', 'Discovery', 'Submission', 'Last sync', 'Submitted (30d)', 'To do more']}>
          {r.data.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="px-5 py-2.5 font-medium">{c.name}</td>
              <td className="px-5 py-2.5"><Pill tone={CONNECTOR_TONE[c.status]}>{CONNECTOR_STATUS_LABELS[c.status]}</Pill></td>
              <td className="px-5 py-2.5">
                <span className="flex flex-wrap gap-1">
                  {CAPS.filter(([k]) => c.capabilities[k]).map(([k, label]) => <Pill key={k} tone="neutral">{label}</Pill>)}
                </span>
              </td>
              <td className="max-w-[220px] px-5 py-2.5 text-xs text-muted">{c.discovery}</td>
              <td className="max-w-[260px] px-5 py-2.5 text-xs text-muted" title={c.restrictions.join('\n')}>{c.submission}</td>
              <td className="px-5 py-2.5 text-xs text-muted">
                {c.lastSyncAt ? ago(c.lastSyncAt) : '—'}
                {c.syncFailures24h > 0 && <span className="text-danger"> · {c.syncFailures24h} failed</span>}
              </td>
              <td className="px-5 py-2.5 tabular-nums">{int(c.submissions30d)}{c.lastSubmissionAt && <span className="text-xs text-faint"> · {ago(c.lastSubmissionAt)}</span>}</td>
              <td className="max-w-[240px] px-5 py-2.5 text-xs text-muted">{c.unlock ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export default function JobsAnalyticsPage() {
  const [r, reload] = useAsync(() => adminApi<ListingsAnalytics>('/admin/jobs-analytics'), []);
  const d = r.data;

  return (
    <>
      <PageHeader
        title="Jobs sources"
        subtitle="Friday Jobs listings: what's collected, what's genuinely new, and each source's health"
        action={
          <button onClick={reload} className="btn btn-secondary" disabled={r.state === 'loading'}>
            {r.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        }
      />
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="New tech jobs open to India, 24h" value={d.totals.newTechIndia24h} hint={`${int(d.totals.new24h)} new jobs of any kind`} />
            <Stat label="Published by employers, 24h" value={d.totals.publishedTechIndia24h} hint="tech, open to India, unique" />
            <Stat label="Open tech jobs open to India" value={d.totals.techIndia} hint={`${pct(d.totals.techPct)} of unique jobs are tech`} />
            <Stat label="Open jobs" value={d.totals.open} hint={`${pct(d.totals.duplicatePct)} duplicates · ${int(d.totals.collected)} collected`} />
            <Stat label="Direct employer links" value={d.totals.directEmployer} hint="unique, on the employer's own ATS" />
            <Stat label="Closed or expired, 7d" value={d.totals.expired7d} />
            <Stat label="Companies" value={d.totals.companies} hint="with open unique jobs" />
            <Stat
              label="Cost per 1,000 new"
              value={d.cost.usdPer1000New === null ? '—' : `$${d.cost.usdPer1000New.toFixed(2)}`}
              hint={
                d.cost.infraMonthlyUsd === null && d.cost.apiMonthlyUsd === null
                  ? 'set JOBS_INFRA_MONTHLY_USD to compute'
                  : `${int(d.cost.newTechIndia30d)} new tech/India in 30d`
              }
            />
          </div>

          <Connectors />

          <Card title="Genuinely new tech jobs open to India, per day" icon={Gauge}>
            <DailyColumns data={d.newPerDay} unit="jobs" />
            <p className="mt-2 text-xs text-faint">From the sync log: a source&apos;s first sync is a backfill and isn&apos;t counted; duplicates of other sources&apos; jobs aren&apos;t either.</p>
          </Card>

          <Card title="Sources" icon={Database}>
            <Table head={['Source', 'Boards', 'Open', 'Tech · India', 'New 24h', 'Published 24h', 'Syncs 24h', 'Requests 24h', 'Last success', 'Terms']}>
              {d.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-2">
                      <Dot tone={p.failing || p.failedRuns24h ? 'warn' : p.runs24h ? 'ok' : 'neutral'} />
                      <span className="font-mono">{p.provider}</span>
                      {p.policy.productionBlocked && <Pill tone="bad">blocked in prod</Pill>}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">
                    {p.enabled}/{p.sources}
                    {p.failing > 0 && <span className="text-warn"> · {p.failing} failing</span>}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{int(p.open)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{int(p.techIndia)}</td>
                  <td className="px-5 py-2.5 tabular-nums">
                    {int(p.newTechIndia24h)} <span className="text-faint">/ {int(p.new24h)}</span>
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{int(p.publishedTechIndia24h)}</td>
                  <td className="px-5 py-2.5 tabular-nums">
                    {p.runs24h}
                    {p.failedRuns24h > 0 && <span className="text-danger"> ({p.failedRuns24h} failed)</span>}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{int(p.httpRequests24h)}</td>
                  <td className="px-5 py-2.5 text-muted">{p.lastSuccessAt ? ago(p.lastSuccessAt) : '—'}</td>
                  <td className="px-5 py-2.5">
                    <span className="flex gap-1" title={`${p.policy.notes}${p.policy.productionBlocked ? `\n\nBlocked: ${p.policy.productionBlocked}` : ''}`}>
                      {(['ingest', 'store', 'display', 'ai', 'autoApply'] as const).map((k) => (
                        <Pill key={k} tone={PERMISSION_TONE[p.policy[k]]}>
                          {k === 'autoApply' ? 'apply' : k}
                        </Pill>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 px-5 text-xs text-faint">
              New 24h: tech jobs open to India / all kinds. Terms: green = allowed (explicit or a documented public API), amber = unverified, red = needs an agreement or prohibited. Hover for details.
            </p>
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Tech roles (open, unique)" icon={Tags}>
              <BarList items={d.byCategory.map((c) => ({ label: `${CATEGORY_LABEL[c.category] ?? c.category} · ${int(c.india)} India`, value: c.open }))} />
            </Card>
            <Card title="Eligibility for candidates in India" icon={Globe2}>
              <BarList items={d.byEligibility.map((e) => ({ label: ELIGIBILITY_LABEL[e.eligibility] ?? e.eligibility, value: e.open }))} />
            </Card>
            <Card title="How candidates may apply" icon={ShieldCheck}>
              <BarList
                items={[
                  { label: 'Assisted (prepared, candidate submits)', value: d.applyModes.assisted },
                  { label: 'Direct link only (source terms)', value: d.applyModes.direct },
                  { label: 'Native, through an authorised ATS integration', value: d.applyModes.native },
                ]}
              />
              <p className="mt-3 text-xs text-faint">Open tech jobs open to India. Native submission needs the employer&apos;s own ATS key; none is held yet.</p>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Top companies (tech, open to India)" icon={Building2}>
              <BarList items={d.topCompanies.map((c) => ({ label: `${c.company}${c.new7d ? ` · ${c.new7d} new this week` : ''}`, value: c.techIndia }))} />
            </Card>
            <Card title={`Failing sources (${d.failures.length})`} icon={AlertTriangle}>
              {d.failures.length === 0 ? (
                <p className="text-sm text-muted">Every enabled source synced on its last attempt.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.failures.map((f) => (
                    <li key={`${f.provider}:${f.board}`} className="py-2 first:pt-0">
                      <span className="font-medium">{f.company}</span> <span className="font-mono text-xs text-muted">{f.provider}:{f.board}</span>
                      <p className="line-clamp-1 text-xs text-danger">{f.error}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
