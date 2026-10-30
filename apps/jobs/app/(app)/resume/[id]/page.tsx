'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Download, Info } from 'lucide-react';
import type { TailoredResume, TailoredResumeRecord } from '@parakeet/shared';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

// A resume tailored to one job, laid out to print (or save as PDF) on A4. Single column and plain
// text so applicant tracking systems read it in order.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid-page">
      <h2 className="border-b border-ink/70 pb-0.5 text-[11px] font-bold tracking-[0.12em] uppercase">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 marker:text-ink/60">
      {items.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  );
}

function ResumeDocument({ r }: { r: TailoredResume }) {
  return (
    <article className="mx-auto w-full max-w-[210mm] bg-white px-[16mm] py-[14mm] text-[10.5pt] leading-snug text-ink shadow-sm ring-1 ring-line print:max-w-none print:p-0 print:shadow-none print:ring-0">
      <header className="text-center">
        {r.name && <h1 className="text-[20pt] font-bold tracking-tight">{r.name}</h1>}
        <p className="mt-0.5 font-medium">{r.headline}</p>
        {r.contact.length > 0 && <p className="mt-1 text-[9.5pt] text-ink/75">{r.contact.join('  ·  ')}</p>}
      </header>

      {r.summary && (
        <Section title="Summary">
          <p>{r.summary}</p>
        </Section>
      )}

      {r.skills.length > 0 && (
        <Section title="Skills">
          <div className="space-y-0.5">
            {r.skills.map((g) => (
              <p key={g.group}>
                <span className="font-semibold">{g.group}:</span> {g.items.join(', ')}
              </p>
            ))}
          </div>
        </Section>
      )}

      {r.experience.length > 0 && (
        <Section title="Experience">
          <div className="space-y-3">
            {r.experience.map((e, i) => (
              <div key={i} className="break-inside-avoid">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p>
                    <span className="font-semibold">{e.title}</span>, {e.company}
                    {e.location && <span className="text-ink/70"> · {e.location}</span>}
                  </p>
                  {e.period && <p className="text-[9.5pt] text-ink/70">{e.period}</p>}
                </div>
                {e.bullets.length > 0 && <Bullets items={e.bullets} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {r.projects.length > 0 && (
        <Section title="Projects">
          <div className="space-y-2.5">
            {r.projects.map((p, i) => (
              <div key={i} className="break-inside-avoid">
                <p>
                  <span className="font-semibold">{p.name}</span>
                  {p.tech.length > 0 && <span className="text-ink/70"> · {p.tech.join(', ')}</span>}
                </p>
                {p.bullets.length > 0 && <Bullets items={p.bullets} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {r.education.length > 0 && (
        <Section title="Education">
          <div className="space-y-1.5">
            {r.education.map((e, i) => (
              <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p>
                  <span className="font-semibold">{e.degree ?? e.school}</span>
                  {e.degree && <>, {e.school}</>}
                  {e.detail && <span className="text-ink/70"> · {e.detail}</span>}
                </p>
                {e.year && <p className="text-[9.5pt] text-ink/70">{e.year}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {r.certifications.length > 0 && (
        <Section title="Certifications">
          <p>{r.certifications.join(' · ')}</p>
        </Section>
      )}
    </article>
  );
}

export default function TailoredResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [record, setRecord] = useState<TailoredResumeRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ tailored: TailoredResumeRecord | null }>(`/v1/job-feed/${id}/resume`).then(
      (r) => setRecord(r.tailored),
      (e) => setError((e as Error).message),
    );
  }, [id]);

  // The browser offers the title as the PDF's file name.
  useEffect(() => {
    const c = record?.content;
    if (!c || !record) return;
    const prev = document.title;
    document.title = [c.name, record.company, 'Resume'].filter(Boolean).join(' - ');
    return () => {
      document.title = prev;
    };
  }, [record]);

  const content = record?.status === 'ready' ? record.content : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 print:p-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
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
        {content && (
          <button onClick={() => window.print()} className="btn btn-primary">
            <Download size={16} /> Download PDF
          </button>
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
        <div className="grid gap-6 lg:grid-cols-[1fr_280px] print:block">
          <ResumeDocument r={content} />
          <aside className="space-y-4 text-sm print:hidden">
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
            <p className="px-1 text-xs text-faint">
              Check every line before you send it. In the print dialog, choose &ldquo;Save as PDF&rdquo; and turn off headers and footers.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}
