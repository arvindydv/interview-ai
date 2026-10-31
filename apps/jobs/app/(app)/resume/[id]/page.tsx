'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Download, Info } from 'lucide-react';
import type { TailoredResumeRecord } from '@parakeet/shared';
import { Spinner } from '@/components/ui';
import { api, apiFile } from '@/lib/api';

// The candidate's own resume file, tailored to one job: a preview of the file itself, the download,
// and what changed beside it.

/** Marks the bolded skills in a line, the way they appear in the file. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = [...terms].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\w.])((?:${escaped.join('|')})(?:\\.\\w+)*)(?!\\w)`, 'gi');
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded bg-emerald-100 px-0.5 font-semibold text-fg">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function DocxPreview({ file }: { file: Blob }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    import('docx-preview')
      .then(({ renderAsync }) => !cancelled && renderAsync(file, el, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true }))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      el.innerHTML = '';
    };
  }, [file]);
  if (failed) return <p className="card p-6 text-sm text-muted">The preview isn&rsquo;t available. Download the file to see it.</p>;
  return <div ref={ref} className="docx-preview overflow-x-auto rounded-xl" />;
}

export default function TailoredResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [record, setRecord] = useState<TailoredResumeRecord | null | undefined>(undefined);
  const [file, setFile] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ tailored: TailoredResumeRecord | null }>(`/v1/job-feed/${id}/resume`)
      .then(async ({ tailored }) => {
        if (cancelled) return;
        setRecord(tailored);
        if (tailored?.status !== 'ready') return;
        const blob = await apiFile(`/v1/job-feed/${id}/resume/file`);
        if (!cancelled) setFile(blob);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const content = record?.status === 'ready' ? record.content : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/saved" onClick={(e) => history.length > 1 && (e.preventDefault(), history.back())} className="btn btn-ghost -ml-3 !px-3">
            <ArrowLeft size={16} /> Back
          </Link>
          {record && (
            <h1 className="mt-1 text-lg font-semibold tracking-tight">
              Your resume for {record.title} at {record.company}
            </h1>
          )}
        </div>
        {url && record?.fileName && (
          <a href={url} download={record.fileName} className="btn btn-primary">
            <Download size={16} /> Download {content?.format === 'docx' ? 'Word file' : 'PDF'}
          </a>
        )}
      </div>

      {error ? (
        <p className="card p-6 text-sm text-danger">{error}</p>
      ) : record === undefined ? (
        <div className="grid h-64 place-items-center">
          <Spinner className="text-muted" />
        </div>
      ) : !content ? (
        <div className="card p-6 text-sm text-muted">
          {record?.status === 'tailoring'
            ? 'Your resume is still being tailored. Check back in a few seconds.'
            : 'There’s no tailored resume for this job yet. Open the job and choose “Tailor my resume”.'}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {!file ? (
              <div className="grid h-96 place-items-center">
                <Spinner className="text-muted" />
              </div>
            ) : content.format === 'pdf' ? (
              url && <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title="Tailored resume" className="h-[80vh] w-full rounded-xl border border-line bg-white" />
            ) : (
              <DocxPreview file={file} />
            )}
          </div>

          <aside className="space-y-4 text-sm">
            <div className="card p-4">
              <p className="flex items-center gap-1.5 font-semibold">
                <Info size={15} className="text-faint" /> What changed
              </p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted">
                {content.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            {record?.coverLetter && (
              <div className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">Cover letter</p>
                  <button
                    onClick={async () => {
                      const blob = await apiFile(`/v1/job-feed/${id}/cover-letter`);
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = (record.fileName ?? 'Resume.pdf').replace('Resume', 'Cover Letter').replace(/\.docx$/i, '.pdf');
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="btn btn-ghost !px-2 !py-1 !text-xs"
                  >
                    <Download size={13} /> PDF
                  </button>
                </div>
                <p className="mt-2 max-h-72 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-muted">{record.coverLetter}</p>
                <button onClick={() => navigator.clipboard.writeText(record.coverLetter ?? '')} className="btn btn-secondary mt-3 !py-1.5 !text-xs">
                  Copy text
                </button>
              </div>
            )}

            {content.edits.length > 0 && (
              <div className="card p-4">
                <p className="font-semibold">Rewritten lines</p>
                <p className="mt-0.5 text-xs text-muted">Skills in bold on your resume are highlighted.</p>
                <ol className="mt-3 space-y-3">
                  {content.edits.map((e, i) => (
                    <li key={i} className="space-y-1 border-t border-line pt-3 first:border-0 first:pt-0">
                      <p className="text-xs text-faint line-through decoration-faint/50">{e.before}</p>
                      <p className="leading-relaxed">
                        <Highlighted text={e.after} terms={content.bold} />
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {content.matchedKeywords.length > 0 && (
              <div className="card p-4">
                <p className="font-semibold">Matches the job</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {content.matchedKeywords.map((k) => (
                    <span key={k} className="chip">
                      <Check size={12} className="text-brand" /> {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {content.missingKeywords.length > 0 && (
              <div className="card p-4">
                <p className="font-semibold text-warn">Not on your resume</p>
                <p className="mt-1 text-muted">
                  The job asks for these, but your resume doesn&rsquo;t show them, so we left them out. If you do have them,
                  add them to your resume and tailor again.
                </p>
                <p className="mt-2">{content.missingKeywords.join(', ')}</p>
              </div>
            )}
            <p className="px-1 text-xs text-faint">Check every line before you send it.</p>
          </aside>
        </div>
      )}
    </main>
  );
}
