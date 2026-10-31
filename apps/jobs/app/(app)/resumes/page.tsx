'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { JobResume, JobResumeList } from '@parakeet/shared';
import { ResumeUploadButton, fileProblem, toUpload } from '@/components/ResumeUpload';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

// Resumes for different roles ("Frontend", "Backend", "Full Stack"…). Each job is tailored from the one
// whose roles fit its title best, otherwise from the main resume. The plan sets how many.

const splitRoles = (s: string) => s.split(',').map((r) => r.trim()).filter(Boolean).slice(0, 10);

function ResumeRow({ r, onChange }: { r: JobResume; onChange: () => void }) {
  const [roles, setRoles] = useState(r.targetRoles.join(', '));
  const [busy, setBusy] = useState(false);
  const dirty = roles !== r.targetRoles.join(', ');
  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
        <FileText size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{r.name}</p>
        <p className="truncate text-xs text-muted">
          {r.fileName}
          {r.status === 'parsing' && ' · analysing…'}
          {r.error && ` · ${r.error}`}
        </p>
        <input
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
          placeholder="Roles it's for, comma separated"
          className="input mt-2 !py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2">
        {dirty && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api(`/v1/job-resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ name: r.name, targetRoles: splitRoles(roles) }) }).catch(() => {});
              setBusy(false);
              onChange();
            }}
            className="btn btn-brand !py-1.5 !text-xs"
          >
            Save
          </button>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api(`/v1/job-resumes/${r.id}`, { method: 'DELETE' }).catch(() => {});
            onChange();
          }}
          className="btn btn-ghost !p-2"
          aria-label={`Delete ${r.name}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

export default function ResumesPage() {
  const [data, setData] = useState<JobResumeList | null>(null);
  const [name, setName] = useState('');
  const [roles, setRoles] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => api<JobResumeList>('/v1/job-resumes').then(setData);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);
  // Keep the "analysing" state current.
  useEffect(() => {
    if (!data?.items.some((r) => r.status === 'parsing')) return;
    const t = setTimeout(() => load().catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [data]);

  async function add(file: File | undefined) {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError('Upload a PDF or Word file, so Friday can keep its design.');
    setBusy(true);
    setError(null);
    try {
      await api('/v1/job-resumes', { method: 'POST', body: JSON.stringify({ name: name.trim(), targetRoles: splitRoles(roles), ...(await toUpload(file)) }) });
      setName('');
      setRoles('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  if (!data) return <div className="grid min-h-[60vh] place-items-center">{error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="text-muted" />}</div>;
  const used = (data.main ? 1 : 0) + data.items.length;
  const room = used < data.limit;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Resumes</h1>
      <p className="mt-1 text-muted">
        Keep a resume for each kind of role. Each job is tailored from the one whose roles fit its title, otherwise from your main resume.
      </p>

      <section className="card mt-6">
        <div className="flex items-center justify-between border-b border-line p-4">
          <p className="text-sm font-medium">
            {used} of {data.limit} resume{data.limit === 1 ? '' : 's'}
          </p>
          {!room && (
            <Link href="/plans" className="text-sm font-medium text-brand underline underline-offset-2">
              Get more with a plan
            </Link>
          )}
        </div>
        <ul className="divide-y divide-line">
          <li className="flex flex-wrap items-center gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-brand">
              <FileText size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Main resume</p>
              <p className="truncate text-xs text-muted">{data.main ? data.main.fileName : 'Not uploaded yet'} · used for any job no other resume fits</p>
            </div>
            <ResumeUploadButton label={data.main ? 'Replace' : 'Upload'} className="btn btn-secondary !py-1.5 !text-xs" />
          </li>
          {data.items.map((r) => (
            <ResumeRow key={r.id} r={r} onChange={() => load()} />
          ))}
        </ul>
      </section>

      {room && (
        <section className="card mt-6 space-y-4 p-5">
          <h2 className="font-semibold">Add a resume for another role</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend" className="input mt-1.5" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Roles it&rsquo;s for</span>
              <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Backend Engineer, Node.js Developer" className="input mt-1.5" />
            </label>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <input ref={input} type="file" accept=".pdf,.docx" hidden onChange={(e) => add(e.target.files?.[0])} />
          <button disabled={busy || !name.trim() || !roles.trim()} onClick={() => input.current?.click()} className="btn btn-primary">
            {busy ? <Spinner /> : <><Plus size={16} /> Upload PDF or Word file</>}
          </button>
        </section>
      )}
    </div>
  );
}
