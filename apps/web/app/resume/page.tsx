'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Award, Briefcase, FileSearch, FileText, MoreHorizontal, RefreshCw, ShieldCheck, Sparkles, Target,
  Trash2, Upload, X,
} from 'lucide-react';
import type { Resume, ResumeProfile } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { relative } from '@/lib/interviews';
import { ACCEPT, fileProblem, formatBytes, normalize, profileStrength, toUpload } from '@/lib/resume';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';
import { ReadinessList, ReadinessRing } from '@/components/interviews/parts';
import { Education, Experience, Identity, Projects, Skills, Stories } from '@/components/resume/ProfileView';

const POLL_MS = 2500;
const POLL_FOR_MS = 4 * 60_000;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

type Confirm = { kind: 'delete' } | { kind: 'reanalyze' } | { kind: 'replace'; file: File };

export default function ResumePage() {
  const email = useRequireSession();
  const [resume, setResume] = useState<Resume | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api<{ resume: Resume | null }>('/v1/resume').then(
        (r) => {
          setResume(r.resume);
          setLoadError(null);
        },
        (e) => setLoadError(errorText(e)),
      ),
    [],
  );

  useEffect(() => {
    if (email) load();
  }, [email, load]);

  // Follow the analysis while the worker runs.
  const parsing = resume?.status === 'parsing';
  useEffect(() => {
    if (!parsing) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) return clearInterval(t);
      api<{ resume: Resume | null }>('/v1/resume').then(
        (r) => {
          setResume(r.resume);
          if (r.resume?.status === 'ready' && r.resume.profile) toast('Your resume is analysed.');
        },
        () => {},
      );
    }, POLL_MS);
    return () => clearInterval(t);
  }, [parsing]);

  const upload = async (file: File) => {
    const problem = fileProblem(file);
    if (problem) return toast(problem, { tone: 'bad' });
    setUploading(file);
    try {
      const r = await api<{ resume: Resume }>('/v1/resume', { method: 'POST', body: JSON.stringify(await toUpload(file)) });
      setResume(r.resume);
      toast(`Read ${r.resume.charCount.toLocaleString()} characters from ${file.name}.`);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    } finally {
      setUploading(null);
      if (picker.current) picker.current.value = '';
    }
  };

  // Replacing throws away hand-made corrections, so ask first.
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (resume?.profileEditedAt) setConfirm({ kind: 'replace', file });
    else upload(file);
  };

  // Drop a file anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => hasFile(e) && (depth++, setDragging(true));
    const leave = (e: DragEvent) => hasFile(e) && --depth <= 0 && (depth = 0, setDragging(false));
    const over = (e: DragEvent) => hasFile(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      pickRef.current(e.dataTransfer?.files[0]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const saveProfile = async (next: ResumeProfile, message: string) => {
    const before = resume;
    setResume((r) => (r ? { ...r, profile: next, profileEditedAt: new Date().toISOString() } : r));
    try {
      const r = await api<{ resume: Resume }>('/v1/resume/profile', { method: 'PUT', body: JSON.stringify(next) });
      setResume(r.resume);
      if (message) toast(message);
      return true;
    } catch (e) {
      setResume(before);
      toast(errorText(e), { tone: 'bad' });
      return false;
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    if (confirm.kind === 'replace') {
      setConfirm(null);
      return upload(confirm.file);
    }
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await api('/v1/resume', { method: 'DELETE' });
        setResume(null);
        toast('Resume deleted.');
      } else {
        const r = await api<{ resume: Resume }>('/v1/resume/reanalyze', { method: 'POST' });
        setResume(r.resume);
      }
      setConfirm(null);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const showText = async () => {
    try {
      setText((await api<{ text: string }>('/v1/resume/text')).text);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const profile = resume?.profile ? normalize(resume.profile) : null;
  const editable = Boolean(resume && !parsing && !uploading);

  return (
    <AppShell email={email}>
      <input ref={picker} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Resume</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Friday answers with your real experience, projects and numbers. One resume, shared by all your{' '}
              <Link href="/interviews" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-brand">
                interviews
              </Link>
              .
            </p>
          </div>
        </header>

        {loadError && resume === undefined && (
          <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] p-5 text-sm">
            <p className="text-danger">Couldn&apos;t load your resume: {loadError}</p>
            <button onClick={load} className="btn btn-secondary !py-1.5">Try again</button>
          </div>
        )}

        {resume === undefined && !loadError && <div className="glass h-64 animate-pulse rounded-[var(--radius-card)]" />}

        {resume === null && <Dropzone uploading={uploading} onBrowse={() => picker.current?.click()} />}

        {resume && (
          <>
            <FileBar
              resume={resume}
              uploading={uploading}
              onReplace={() => picker.current?.click()}
              onShowText={showText}
              onReanalyze={() => setConfirm({ kind: 'reanalyze' })}
              onDelete={() => setConfirm({ kind: 'delete' })}
            />

            {parsing && <Analysing />}

            {!parsing && resume.error && (
              <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3 text-sm">
                <AlertTriangle size={18} className="mt-px shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-warn">{resume.status === 'failed' ? 'The analysis didn’t finish' : 'Detailed analysis is off'}</p>
                  <p className="mt-0.5 text-muted">
                    {resume.error} {profile ? 'Your previous profile is kept.' : 'Friday still reads the full text of your resume for every answer.'}
                  </p>
                </div>
                {resume.status === 'failed' && (
                  <button onClick={() => setConfirm({ kind: 'reanalyze' })} className="btn btn-secondary shrink-0 !py-1.5 text-xs">
                    <RefreshCw size={13} /> Try again
                  </button>
                )}
              </div>
            )}

            {profile && (
              <div className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] ${parsing ? 'pointer-events-none opacity-40 blur-[1px]' : ''}`}>
                <div className="min-w-0 space-y-6">
                  <Identity profile={profile} editable={editable} save={saveProfile} />
                  <Stories profile={profile} editable={editable} save={saveProfile} />
                  <Experience profile={profile} />
                  <Projects profile={profile} />
                </div>
                <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
                  <Strength profile={profile} />
                  <Skills profile={profile} editable={editable} save={saveProfile} />
                  <Education profile={profile} />
                </aside>
              </div>
            )}
          </>
        )}

        <p className="flex items-center justify-center gap-2 pt-2 text-center text-xs text-faint">
          <ShieldCheck size={14} /> We keep only the text read from your resume, never the file itself. Delete it any time.
        </p>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-bg/80 p-6 backdrop-blur-sm">
          <div className="grid w-full max-w-lg place-items-center rounded-3xl border-2 border-dashed border-brand/60 bg-brand/[0.04] px-8 py-16 text-center">
            <Upload size={28} className="text-brand" />
            <p className="mt-3 text-lg font-semibold">Drop to {resume ? 'replace your' : 'upload your'} resume</p>
            <p className="mt-1 text-sm text-muted">PDF, DOCX or TXT, up to 5 MB</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title="Delete your resume?"
        text="Friday will stop using it in answers, and the profile and stories made from it are removed."
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        danger
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'reanalyze'}
        title="Analyse your resume again?"
        text={
          resume?.profileEditedAt
            ? 'Friday rebuilds your profile from the resume. Changes you made by hand will be replaced.'
            : 'Friday rebuilds your profile, skills and stories from the resume. It takes about a minute.'
        }
        confirmLabel="Analyse again"
        danger={Boolean(resume?.profileEditedAt)}
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'replace'}
        title="Replace your resume?"
        text="The new file gets a fresh profile. Changes you made by hand to the current one will be lost."
        confirmLabel="Replace"
        danger
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <TextDialog text={text} onClose={() => setText(null)} />
      <Toaster />
    </AppShell>
  );
}

// ---- upload --------------------------------------------------------------------------------------

function Dropzone({ uploading, onBrowse }: { uploading: File | null; onBrowse: () => void }) {
  const gets = [
    { icon: Briefcase, title: 'Experience', text: 'Roles and achievements, every number kept' },
    { icon: Target, title: 'Skills', text: 'Tools, methods and subject knowledge' },
    { icon: Award, title: 'STAR stories', text: 'Ready answers for “Tell me about a time…”' },
  ];
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="aurora -z-10 opacity-40">
        <span />
        <span />
        <span />
      </div>
      <div className="absolute inset-0 -z-10 bg-grid" />
      <div className="px-6 py-12 text-center sm:px-12 sm:py-14">
        <button
          onClick={onBrowse}
          disabled={Boolean(uploading)}
          className="group mx-auto grid w-full max-w-xl place-items-center rounded-3xl border-2 border-dashed border-line-strong bg-bg/50 px-6 py-12 backdrop-blur transition hover:border-brand/50 hover:bg-brand/[0.03] focus-visible:border-brand focus-visible:outline-none"
        >
          {uploading ? (
            <>
              <Spinner className="size-7 text-brand" />
              <p className="mt-4 font-semibold">Reading {uploading.name}…</p>
              <p className="mt-1 text-sm text-muted">{formatBytes(uploading.size)}</p>
            </>
          ) : (
            <>
              <span className="grid size-14 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/25 transition group-hover:scale-105">
                <Upload size={24} />
              </span>
              <p className="mt-4 text-lg font-semibold">Upload your resume</p>
              <p className="mt-1 text-sm text-muted">
                Drag and drop, or <span className="text-brand">browse</span>. PDF, DOCX or TXT, up to 5 MB.
              </p>
            </>
          )}
        </button>

        <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
          {gets.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-line bg-bg/50 p-4 text-left backdrop-blur">
              <Icon size={16} className="text-brand" />
              <p className="mt-2 text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs text-muted">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FileBar({
  resume,
  uploading,
  onReplace,
  onShowText,
  onReanalyze,
  onDelete,
}: {
  resume: Resume;
  uploading: File | null;
  onReplace: () => void;
  onShowText: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
}) {
  const parsing = resume.status === 'parsing';
  const status = uploading
    ? { label: 'Uploading', tone: 'bg-brand-2/10 text-brand-2 ring-brand-2/25' }
    : parsing
      ? { label: 'Analysing', tone: 'bg-brand-2/10 text-brand-2 ring-brand-2/25' }
      : resume.status === 'failed'
        ? { label: 'Analysis failed', tone: 'bg-warn/10 text-warn ring-warn/25' }
        : resume.profileEditedAt
          ? { label: 'Edited by you', tone: 'bg-accent/10 text-accent ring-accent/25' }
          : { label: 'Ready', tone: 'bg-brand/10 text-brand ring-brand/25' };
  const ext = resume.fileName.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE';
  return (
    <section className="glass flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] p-4 sm:p-5 animate-fade-up">
      <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-white/5 ring-1 ring-line-strong">
        <FileText size={22} className="text-muted" />
        <span className="absolute -right-1.5 -bottom-1.5 rounded bg-brand-gradient px-1 text-[9px] font-bold text-bg">{ext}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{uploading?.name ?? resume.fileName}</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${status.tone}`}>
            {(uploading || parsing) && <Spinner className="!size-2.5 !border" />}
            {status.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          Uploaded {relative(resume.createdAt)} · {resume.charCount.toLocaleString()} characters read
          {resume.profileEditedAt && <> · edited {relative(resume.profileEditedAt)}</>}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onShowText} className="btn btn-ghost hidden !px-3 !py-2 text-xs sm:inline-flex">
          <FileSearch size={15} /> What Friday reads
        </button>
        <button onClick={onReplace} disabled={Boolean(uploading) || parsing} className="btn btn-secondary !px-3 !py-2 text-xs">
          <Upload size={15} /> Replace
        </button>
        <Menu
          label="More resume actions"
          trigger={<MoreHorizontal size={18} />}
          items={[
            { label: 'What Friday reads', icon: FileSearch, onSelect: onShowText },
            { label: 'Analyse again', icon: RefreshCw, onSelect: onReanalyze, disabled: parsing || Boolean(uploading) },
            'divider',
            { label: 'Delete resume', icon: Trash2, onSelect: onDelete, danger: true, disabled: Boolean(uploading) },
          ]}
        />
      </div>
    </section>
  );
}

// ---- analysis ------------------------------------------------------------------------------------

const STEPS = ['Reading your experience', 'Collecting skills and tools', 'Finding results and numbers', 'Writing your STAR stories'];

function Analysing() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-brand-2/25 p-6 animate-fade-up" aria-live="polite">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute -top-24 -right-24 -z-10 size-96 glow" />
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative mx-auto h-28 w-22 shrink-0 overflow-hidden rounded-lg border border-line-strong bg-bg/60 p-2.5 sm:mx-0">
          {[90, 70, 80, 55, 85, 60, 75].map((w, n) => (
            <div key={n} className="mb-1.5 h-1.5 rounded-full bg-white/10" style={{ width: `${w}%` }} />
          ))}
          <div className="scan-line" />
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-2 font-semibold">
            <Sparkles size={16} className="text-brand" /> Analysing your resume
          </p>
          <p className="mt-0.5 text-sm text-muted">Usually under a minute. You can leave this page; it carries on.</p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {STEPS.map((s, n) => (
              <li key={s} className={`flex items-center gap-2 text-sm transition ${n <= step ? 'text-fg' : 'text-faint'}`}>
                {n < step ? (
                  <span className="grid size-4 place-items-center rounded-full bg-brand text-[10px] text-bg">✓</span>
                ) : n === step ? (
                  <Spinner className="!size-4 text-brand" />
                ) : (
                  <span className="size-4 rounded-full ring-1 ring-line-strong" />
                )}
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Strength({ profile }: { profile: ResumeProfile }) {
  const { score, items } = profileStrength(profile);
  const scrollTo = (key: string) =>
    document.getElementById({ summary: 'summary', skills: 'skills', stories: 'stories' }[key] ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <section className="glass rounded-[var(--radius-card)] p-5 animate-fade-up">
      <div className="flex items-center gap-4">
        <ReadinessRing score={score} size={68} stroke={6} label="Profile strength" />
        <div>
          <p className="text-sm font-semibold">{score === 100 ? 'Interview-ready' : score >= 70 ? 'Strong profile' : 'Profile strength'}</p>
          <p className="mt-0.5 text-xs text-muted">What Friday can draw on when it answers for you.</p>
        </div>
      </div>
      <div className="-mx-2 mt-4">
        <ReadinessList items={items} onFix={scrollTo} />
      </div>
    </section>
  );
}

function TextDialog({ text, onClose }: { text: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (text !== null && !d.open) d.showModal();
    if (text === null && d.open) d.close();
  }, [text]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[85vh] open:flex w-[min(48rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line-strong bg-surface-2 p-0 text-fg shadow-2xl shadow-black/60 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line p-5">
        <div>
          <h2 className="font-semibold">What Friday reads</h2>
          <p className="mt-0.5 text-xs text-muted">
            The text taken from your file. If something is missing or garbled here, export the resume again as a PDF with
            selectable text, or as DOCX.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost !p-1.5">
          <X size={18} />
        </button>
      </header>
      <pre className="flex-1 overflow-auto p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg/85">{text}</pre>
    </dialog>
  );
}
