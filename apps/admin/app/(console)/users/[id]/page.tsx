'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Ban, BriefcaseBusiness, CircleCheck, FileText, History, Laptop, LogOut, MessageSquareText, NotebookPen,
  RefreshCw, Trash2, UserCog,
} from 'lucide-react';
import { ROUND_TYPES, type AdminUserDetail, type ResumeProfile } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { ago, date, dateTime, int, ms } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';
import { DailyColumns } from '@/components/charts';
import { TurnDrawer, TurnRow, turnHead } from '@/components/turns';
import { Card, Dot, Empty, ErrorNote, Pill, Spinner, Stat, Table } from '@/components/ui';

const roundLabel = (id: string) => ROUND_TYPES.find((r) => r.id === id)?.label ?? id;

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [r, reload] = useAsync(() => adminApi<AdminUserDetail>(`/admin/users/${id}`), [id]);
  const act = useAction();
  const [plan, setPlan] = useState('');
  const [note, setNote] = useState('');
  const [openTurn, setOpenTurn] = useState<string | null>(null);
  const d = r.data;

  useEffect(() => {
    if (d) {
      setPlan(d.user.plan);
      setNote(d.user.adminNote);
    }
  }, [d]);

  if (!d) {
    return r.state === 'error' ? <ErrorNote>{r.error}</ErrorNote> : <Spinner className="text-muted" />;
  }

  const u = d.user;
  const call = (key: string, path: string, init: RequestInit, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    return act.run(key, () => adminApi(path, init)).then((ok) => ok && reload());
  };
  const patch = (key: string, body: object, confirmText?: string) =>
    call(key, `/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, confirmText);

  const deleteUser = async () => {
    const typed = window.prompt(`This permanently deletes ${u.email}: account, resume, interviews, devices and activity.\n\nType the email to confirm.`);
    if (typed?.trim().toLowerCase() !== u.email.toLowerCase()) return;
    if (await act.run('delete', () => adminApi(`/admin/users/${id}`, { method: 'DELETE' }))) router.replace('/users');
  };

  const profile = d.resume?.profile as ResumeProfile | null | undefined;

  return (
    <>
      <Link href="/users" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={15} /> Users
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-gradient text-xl font-semibold uppercase text-bg">
            {u.email[0]}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{u.email}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Pill tone={u.status === 'active' ? 'ok' : 'bad'}>{u.status}</Pill>
              <Pill tone={u.plan === 'free' ? 'neutral' : 'info'}>{u.plan}</Pill>
              {u.online && (
                <Pill tone="ok">
                  <Dot tone="ok" pulse /> live now
                </Pill>
              )}
              <span className="capitalize">{u.authProvider}</span>
              <span>· joined {date(u.createdAt)}</span>
              <span>· signed in {ago(u.lastSignInAt)}</span>
              {!u.emailConfirmedAt && <Pill tone="warn">email unconfirmed</Pill>}
            </div>
            <p className="mt-1 font-mono text-[11px] text-faint">{u.id}</p>
          </div>
        </div>
        <button onClick={reload} className="btn btn-secondary" disabled={r.state === 'loading'}>
          {r.state === 'loading' ? <Spinner /> : <RefreshCw size={15} />} Refresh
        </button>
      </header>

      {act.error && <ErrorNote>{act.error}</ErrorNote>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Questions" value={d.stats.questions} hint={`${d.stats.questionsToday} today · ${d.stats.questions7d} in 7d`} />
        <Stat label="Live sessions" value={d.stats.sessions} />
        <Stat label="Avg. first token" value={ms(d.stats.avgTtftMs)} />
        <Stat label="Input tokens" value={d.stats.tokensIn} />
        <Stat label="Output tokens" value={d.stats.tokensOut} />
        <Stat label="Last active" value={<span className="text-lg">{ago(u.lastActiveAt)}</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Questions per day (30d)" icon={MessageSquareText}>
          <DailyColumns data={d.activity} unit="questions" height={160} />
        </Card>

        <Card title="Account controls" icon={UserCog}>
          <div className="space-y-5">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (plan.trim() && plan.trim() !== u.plan) patch('plan', { plan: plan.trim() });
              }}
            >
              <label className="flex-1">
                <span className="text-xs text-muted">Plan</span>
                <input className="input mt-1 !py-2 !text-sm" list="plans" value={plan} onChange={(e) => setPlan(e.target.value.toLowerCase())} />
                <datalist id="plans">
                  <option value="free" />
                  <option value="pro" />
                  <option value="team" />
                </datalist>
              </label>
              <button className="btn btn-secondary !py-2" disabled={act.busy !== null || !plan.trim() || plan.trim() === u.plan}>
                {act.busy === 'plan' ? <Spinner /> : 'Save'}
              </button>
            </form>

            <div className="grid gap-2 sm:grid-cols-2">
              {u.status === 'active' ? (
                <button
                  className="btn btn-secondary !justify-start text-danger"
                  disabled={act.busy !== null}
                  onClick={() => patch('status', { status: 'suspended' }, `Suspend ${u.email}? They are signed out everywhere, disconnected from live answers and can't sign in again until unsuspended.`)}
                >
                  {act.busy === 'status' ? <Spinner /> : <Ban size={15} />} Suspend
                </button>
              ) : (
                <button className="btn btn-secondary !justify-start text-brand" disabled={act.busy !== null} onClick={() => patch('status', { status: 'active' })}>
                  {act.busy === 'status' ? <Spinner /> : <CircleCheck size={15} />} Unsuspend
                </button>
              )}
              <button
                className="btn btn-secondary !justify-start"
                disabled={act.busy !== null}
                onClick={() => call('signout', `/admin/users/${id}/sign-out`, { method: 'POST' }, `Sign ${u.email} out of every device?`)}
              >
                {act.busy === 'signout' ? <Spinner /> : <LogOut size={15} />} Sign out everywhere
              </button>
            </div>

            <div>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <NotebookPen size={13} /> Internal note (only admins see this)
              </span>
              <textarea className="input mt-1 min-h-20 !text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <button className="btn btn-secondary mt-2 !py-1.5" disabled={act.busy !== null || note === u.adminNote} onClick={() => patch('note', { adminNote: note })}>
                {act.busy === 'note' ? <Spinner /> : 'Save note'}
              </button>
            </div>

            <div className="border-t border-line pt-4">
              <button className="btn btn-ghost !px-2 text-danger hover:!bg-danger/10 hover:!text-danger" disabled={act.busy !== null} onClick={deleteUser}>
                {act.busy === 'delete' ? <Spinner /> : <Trash2 size={15} />} Delete user and all data
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Resume"
          icon={FileText}
          action={
            d.resume && (
              <div className="flex gap-1">
                <button
                  className="btn btn-ghost !px-2 !py-1.5 text-xs"
                  disabled={act.busy !== null}
                  onClick={() => call('reanalyze', `/admin/users/${id}/resume/reanalyze`, { method: 'POST' })}
                >
                  {act.busy === 'reanalyze' ? <Spinner /> : <RefreshCw size={14} />} Re-analyse
                </button>
                <button
                  className="btn btn-ghost !px-2 !py-1.5 text-xs text-danger"
                  disabled={act.busy !== null}
                  onClick={() => call('resume', `/admin/users/${id}/resume`, { method: 'DELETE' }, 'Delete this resume?')}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )
          }
        >
          {!d.resume ? (
            <p className="text-sm text-muted">No resume uploaded.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.resume.fileName}</span>
                <Pill tone={d.resume.status === 'ready' ? 'ok' : d.resume.status === 'failed' ? 'bad' : 'warn'}>{d.resume.status}</Pill>
                <span className="text-xs text-muted">
                  {int(d.resume.charCount)} chars · {ago(d.resume.createdAt)}
                </span>
              </div>
              {d.resume.error && <p className="text-xs text-warn">{d.resume.error}</p>}
              {profile && (
                <div className="space-y-2 rounded-xl border border-line bg-bg p-3">
                  {profile.headline && <p className="font-medium">{profile.headline}</p>}
                  {profile.summary && <p className="text-muted">{profile.summary}</p>}
                  {profile.skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {profile.skills.slice(0, 16).map((s) => (
                        <Pill key={s.name}>{s.name}</Pill>
                      ))}
                    </div>
                  )}
                  <p className="pt-1 text-xs text-faint">
                    {profile.experience?.length ?? 0} roles · {profile.projects?.length ?? 0} projects · {profile.stories?.length ?? 0} STAR stories
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Desktop devices" icon={Laptop}>
          {d.devices.length === 0 ? (
            <p className="text-sm text-muted">The desktop app hasn&apos;t been installed.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.devices.map((dv) => (
                <li key={dv.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate capitalize">
                      {dv.os} <span className="text-muted normal-case">{dv.osVersion}</span>
                    </p>
                    <p className="text-xs text-faint">
                      app {dv.appVersion ?? '?'} · seen {ago(dv.lastSeen)}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost !p-1.5 text-faint hover:!text-danger"
                    aria-label="Remove device"
                    disabled={act.busy !== null}
                    onClick={() => call(`dev-${dv.id}`, `/admin/users/${id}/devices/${dv.id}`, { method: 'DELETE' }, 'Remove this device registration?')}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Interview setups" icon={BriefcaseBusiness} pad={false}>
        {d.interviews.length === 0 ? (
          <Empty>No interview set up.</Empty>
        ) : (
          <Table head={['Field', 'Role', 'Organisation', 'Round', 'Job description', 'Updated', '']}>
            {d.interviews.map((i, idx) => (
              <tr key={i.id}>
                <td className="px-5 py-3">
                  {i.field || <span className="text-faint">–</span>}
                  {idx === 0 && <span className="ml-2"><Pill tone="ok">current</Pill></span>}
                </td>
                <td className="px-5 py-3">{i.role || <span className="text-faint">–</span>}</td>
                <td className="px-5 py-3">{i.company || <span className="text-faint">–</span>}</td>
                <td className="px-5 py-3">{roundLabel(i.roundType)}</td>
                <td className="px-5 py-3 text-muted">{i.jdChars ? `${int(i.jdChars)} chars` : '–'}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted">{ago(i.updatedAt)}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    className="btn btn-ghost !p-1.5 text-faint hover:!text-danger"
                    aria-label="Delete interview"
                    disabled={act.busy !== null}
                    onClick={() => call(`int-${i.id}`, `/admin/users/${id}/interviews/${i.id}`, { method: 'DELETE' }, 'Delete this interview setup?')}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Recent questions"
        icon={MessageSquareText}
        pad={false}
        action={
          <Link href="/activity" className="text-xs text-muted hover:text-fg">
            All activity →
          </Link>
        }
      >
        {d.turns.length === 0 ? (
          <Empty>No questions asked yet.</Empty>
        ) : (
          <Table head={turnHead(false)}>
            {d.turns.map((t) => <TurnRow key={t.id} t={t} showUser={false} onOpen={() => setOpenTurn(t.id)} />)}
          </Table>
        )}
      </Card>

      <Card title="Live sessions" icon={History} pad={false}>
        {d.sessions.length === 0 ? (
          <Empty>No live sessions yet.</Empty>
        ) : (
          <Table head={['Connected', 'Duration', 'Questions', 'Session ID']}>
            {d.sessions.map((s) => {
              const end = s.disconnectedAt ? new Date(s.disconnectedAt).getTime() : null;
              const dur = end ? Math.round((end - new Date(s.connectedAt).getTime()) / 1000) : null;
              return (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-5 py-3">{dateTime(s.connectedAt)}</td>
                  <td className="px-5 py-3 text-muted">
                    {dur === null ? (
                      <span className="inline-flex items-center gap-2">
                        <Dot tone="ok" pulse /> open
                      </span>
                    ) : dur < 60 ? (
                      `${dur}s`
                    ) : (
                      `${Math.round(dur / 60)} min`
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{s.turns}</td>
                  <td className="px-5 py-3 font-mono text-xs text-faint">{s.clientSessionId}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <TurnDrawer id={openTurn} onClose={() => setOpenTurn(null)} />
    </>
  );
}
