'use client';
import { BarChart3, Cpu, Filter, Laptop, MessageSquareText, RefreshCw, UserPlus, Users } from 'lucide-react';
import type { AdminOverview } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { change, compact, int, ms, pct } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { BarList, DailyColumns, Funnel } from '@/components/charts';
import { Card, Dot, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui';

const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);

export default function OverviewPage() {
  const [r, reload] = useAsync(() => adminApi<AdminOverview>('/admin/overview'), []);
  const d = r.data;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Users, live interview activity and AI usage. Days are UTC."
        action={
          <button onClick={reload} className="btn btn-secondary" disabled={r.state === 'loading'}>
            {r.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
        }
      />
      {r.state === 'error' && <ErrorNote>{r.error}</ErrorNote>}
      {!d ? (
        r.state === 'loading' && <Spinner className="text-muted" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total users" value={d.kpis.totalUsers} hint={`${d.kpis.suspendedUsers} suspended`} />
            <Stat label="New users (7d)" value={d.kpis.newUsers7d} delta={change(d.kpis.newUsers7d, d.kpis.newUsersPrev7d)} />
            <Stat
              label="Live now"
              value={
                <span className="flex items-center gap-2">
                  {d.kpis.liveNow}
                  <Dot tone={d.kpis.liveNow ? 'ok' : 'neutral'} pulse={d.kpis.liveNow > 0} />
                </span>
              }
              hint="users connected to live answers"
            />
            <Stat label="Active users" value={d.kpis.activeToday} hint={`today · ${d.kpis.active7d} in 7d · ${d.kpis.active30d} in 30d`} />
            <Stat label="Questions today" value={d.kpis.questionsToday} hint={`${compact(d.kpis.questions7d)} in the last 7 days`} />
            <Stat label="Questions (7d)" value={d.kpis.questions7d} delta={change(d.kpis.questions7d, d.kpis.questionsPrev7d)} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Questions answered per day" icon={MessageSquareText} action={<span className="text-xs text-muted">{int(sum(d.series.questions))} in 30 days</span>}>
              <DailyColumns data={d.series.questions} unit="questions" />
            </Card>
            <Card title="Active users per day" icon={Users} action={<span className="text-xs text-muted">used live answers</span>}>
              <DailyColumns data={d.series.activeUsers} unit="active users" />
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Card title="Sign-ups per day" icon={UserPlus} action={<span className="text-xs text-muted">{int(sum(d.series.signups))} in 30 days</span>}>
              <DailyColumns data={d.series.signups} unit="sign-ups" />
            </Card>
            <Card title="Activation funnel" icon={Filter} action={<span className="text-xs text-muted">all time</span>}>
              <Funnel steps={d.funnel} />
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Input tokens (30d)" value={d.kpis.tokensIn30d} />
            <Stat label="Output tokens (30d)" value={d.kpis.tokensOut30d} />
            <Stat label="Avg. time to first token (7d)" value={ms(d.kpis.avgTtftMs7d)} />
            <Stat label="Answer error rate (7d)" value={pct(d.kpis.errorRate7d)} />
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Interview fields" icon={BarChart3} action={<span className="text-xs text-muted">current per user</span>}>
              <BarList items={d.breakdowns.fields} empty="No interviews set up yet" />
            </Card>
            <Card title="Interview rounds" icon={BarChart3}>
              <BarList items={d.breakdowns.rounds} empty="No interviews set up yet" />
            </Card>
            <Card title="Plans" icon={Users}>
              <BarList items={d.breakdowns.plans} />
            </Card>
            <Card title="Desktop OS" icon={Laptop} action={<span className="text-xs text-muted">installs</span>}>
              <BarList items={d.breakdowns.os} empty="No desktop installs yet" />
            </Card>
            <Card title="Models used (30d)" icon={Cpu}>
              <BarList items={d.breakdowns.models} empty="No answers yet" />
            </Card>
            <Card title="Answer outcomes (30d)" icon={MessageSquareText}>
              <BarList items={d.breakdowns.turnStatus} empty="No answers yet" />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
