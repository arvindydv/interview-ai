'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, FileText, RotateCcw, Sparkles, Upload } from 'lucide-react';
import type { TailoredResumeRecord } from '@parakeet/shared';
import { Spinner } from './ui';
import { api, ApiError } from '@/lib/api';
import { useJobs } from '@/lib/jobs';

const POLL_MS = 3000;

/** "Tailor my resume" for one job: starts tailoring, waits for it, and links to the result. */
export function TailorPanel({ id, partial }: { id: string; partial: boolean }) {
  const { summary } = useJobs();
  const [tailored, setTailored] = useState<TailoredResumeRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTailored((await api<{ tailored: TailoredResumeRecord | null }>(`/v1/job-feed/${id}/resume`)).tailored);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setTailored(undefined);
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    if (tailored?.status !== 'tailoring') return;
    const t = setTimeout(load, POLL_MS);
    return () => clearTimeout(t);
  }, [tailored, load]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setTailored((await api<{ tailored: TailoredResumeRecord }>(`/v1/job-feed/${id}/resume`, { method: 'POST' })).tailored);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start tailoring. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const resumeStatus = summary?.profile.resumeStatus ?? null;
  const content = tailored?.status === 'ready' ? tailored.content : null;

  return (
    <section className="rounded-2xl border border-violet-200/70 bg-violet-50/50 p-4">
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Resume tailored to this job</p>
          <p className="mt-0.5 text-muted">
            Friday rewords your own resume around this job&rsquo;s requirements and puts the matching skills in bold.
            Your design stays the same, and nothing is added that isn&rsquo;t already in it.
          </p>

          {tailored === undefined && !error ? (
            <div className="mt-3 skeleton h-8 w-40" />
          ) : resumeStatus === null ? (
            <Link href="/profile" className="btn btn-secondary mt-3 !py-1.5 !text-xs">
              <Upload size={14} /> Upload your resume first
            </Link>
          ) : tailored?.status === 'tailoring' ? (
            <p className="mt-3 flex items-center gap-2 font-medium text-violet-700">
              <Spinner /> Tailoring your resume… about half a minute
            </p>
          ) : content ? (
            <div className="mt-3 space-y-3">
              {content.matchedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {content.matchedKeywords.slice(0, 10).map((k) => (
                    <span key={k} className="chip !border-brand/20 !bg-white !text-fg">
                      <Check size={12} className="text-brand" /> {k}
                    </span>
                  ))}
                </div>
              )}
              {content.missingKeywords.length > 0 && (
                <p className="text-xs text-muted">
                  <span className="font-medium text-warn">Not on your resume:</span> {content.missingKeywords.join(', ')}. We
                  didn&rsquo;t add these; mention them only if you have them.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Link href={`/resume/${id}`} className="btn btn-brand !py-1.5 !text-xs">
                  <FileText size={14} /> View &amp; download
                </Link>
                <button disabled={busy} onClick={start} className="btn btn-ghost !py-1.5 !text-xs">
                  <RotateCcw size={14} /> Tailor again
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {tailored?.status === 'failed' && tailored.error && (
                <p className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertCircle size={13} /> {tailored.error}
                  {/again as a PDF or Word file/.test(tailored.error) && (
                    <Link href="/profile" className="font-medium underline underline-offset-2">
                      Upload it
                    </Link>
                  )}
                </p>
              )}
              {resumeStatus === 'parsing' && <p className="text-xs text-muted">Your resume is still being analysed.</p>}
              {partial && (
                <p className="text-xs text-muted">This listing only has an excerpt of the job description, so tailoring will be lighter.</p>
              )}
              <button disabled={busy || resumeStatus === 'parsing'} onClick={start} className="btn btn-brand !py-1.5 !text-xs">
                {busy ? <Spinner /> : <Sparkles size={14} />} {tailored?.status === 'failed' ? 'Try again' : 'Tailor my resume'}
              </button>
            </div>
          )}
          {error && (
            <p className="mt-2 text-xs text-danger">
              {error}{' '}
              {/again as a PDF or Word file/.test(error) && (
                <Link href="/profile" className="font-medium underline underline-offset-2">
                  Upload it
                </Link>
              )}
            </p>
          )}

          <p className="mt-3 border-t border-violet-200/60 pt-2.5 text-xs text-muted">
            <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 uppercase">Soon</span>
            AI Apply: Friday submits the application for you with this resume.
          </p>
        </div>
      </div>
    </section>
  );
}
