'use client';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight, Bookmark, BookmarkCheck, Briefcase, Building2, Check, Clock, MapPin, Wallet, X,
} from 'lucide-react';
import {
  APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, type ApplicationStatus, type FeedDetail, type FeedItem,
} from '@parakeet/shared';
import { TailorPanel } from './TailorPanel';
import { AgencyBadge, CompanyLogo, MatchRing, Spinner, StartupBadge, ViaBadge, matchTone } from './ui';
import { api, ApiError } from '@/lib/api';
import { listingFacts, postedAgo } from '@/lib/format';

function Bar({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted tabular-nums">{value}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1 text-xs text-faint">{hint}</p>
    </div>
  );
}

export function JobDetail({
  id,
  fallback,
  onClose,
  onStatus,
}: {
  id: string;
  /** The list's copy, shown while loading and when the listing is gone. */
  fallback?: FeedItem;
  onClose: () => void;
  onStatus: (id: string, status: ApplicationStatus | null) => void;
}) {
  const [job, setJob] = useState<FeedDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askApplied, setAskApplied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setJob(null);
    setMissing(false);
    setAskApplied(false);
    api<FeedDetail>(`/v1/job-feed/${id}`).then(
      (j) => !cancelled && setJob(j),
      (e) => !cancelled && e instanceof ApiError && e.status === 404 && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function setStatus(status: ApplicationStatus | null) {
    setBusy(true);
    try {
      await api(`/v1/job-feed/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      setJob((j) => (j ? { ...j, status } : j));
      onStatus(id, status);
    } finally {
      setBusy(false);
      setAskApplied(false);
    }
  }

  const head = job ?? fallback;
  if (!head) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-muted" />
      </div>
    );
  }
  const status = job?.status ?? fallback?.status ?? null;
  const match = job?.match ?? fallback?.match ?? null;
  const tracked = status && status !== 'saved';
  const posted = postedAgo(head.postedAt);
  const tone = match ? matchTone(match.score) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <CompanyLogo company={head.company} website={head.companyWebsite} logo={head.companyLogo} size={48} />
            <div>
              <p className="flex items-center gap-2 font-medium">
                {head.company}
                {head.startup && <StartupBadge batch={head.ycBatch} />}
                {head.agency && <AgencyBadge />}
                {head.via && <ViaBadge via={head.via} url={head.viaUrl} />}
              </p>
              <p className="text-xs text-muted">{posted ? `Posted ${posted}` : 'Recently posted'}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost !p-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <h2 className="mt-4 text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{head.title}</h2>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
          {head.location && (
            <span className="flex items-center gap-1.5">
              <MapPin size={14} className="text-faint" /> {head.location}
            </span>
          )}
          {listingFacts(head).slice(0, 2).map((f, i) => (
            <span key={f} className="flex items-center gap-1.5">
              {i === 0 ? <Building2 size={14} className="text-faint" /> : <Briefcase size={14} className="text-faint" />} {f}
            </span>
          ))}
          {head.salary && (
            <span className="flex items-center gap-1.5 font-medium text-brand">
              <Wallet size={14} /> {head.salary}
            </span>
          )}
        </div>

        {missing || head.closed ? (
          <p className="mt-5 rounded-xl border border-warn/20 bg-warn/5 px-4 py-3 text-sm text-warn">
            {head.via
              ? `This role is no longer listed on ${head.via}, so it has probably been filled.`
              : <>This role is no longer on {head.company}&rsquo;s careers page, so it has probably been filled.</>}
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {job && (
              <a
                href={job.applyUrl}
                target="_blank"
                // Remote-job boards ask for a followed link that sends them the visitor.
                rel={job.via ? 'noopener' : 'noopener noreferrer nofollow'}
                onClick={() => !tracked && setAskApplied(true)}
                className="btn btn-primary"
              >
                {job.via ? `Apply via ${job.via}` : 'Apply now'} <ArrowUpRight size={16} />
              </a>
            )}
            {!tracked && (
              <button disabled={busy || !job} onClick={() => setStatus(status === 'saved' ? null : 'saved')} className="btn btn-secondary">
                {status === 'saved' ? <BookmarkCheck size={16} className="text-brand" /> : <Bookmark size={16} />}
                {status === 'saved' ? 'Saved' : 'Save'}
              </button>
            )}
            {tracked && (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Status</span>
                <select
                  value={status!}
                  disabled={busy}
                  onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
                  className="input !w-auto !py-2 !pr-8 text-sm"
                >
                  {APPLICATION_STATUSES.filter((s) => s !== 'saved').map((s) => (
                    <option key={s} value={s}>
                      {APPLICATION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {job?.via && (
          <p className="mt-3 text-xs text-muted">
            Found on{' '}
            <a href={job.applyUrl} target="_blank" rel="noopener" className="font-medium text-fg underline underline-offset-2">
              {job.via}
            </a>
            {job.postedOn && <>, which found it on {job.postedOn}</>}. You&rsquo;ll apply through their page.
          </p>
        )}

        {askApplied && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
            <p className="text-sm">
              <span className="font-medium">Did you apply?</span>{' '}
              <span className="text-muted">We&rsquo;ll keep it in Applied so you can track it.</span>
            </p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => setStatus('applied')} className="btn btn-brand !py-1.5 !text-xs">
                <Check size={14} /> Yes, I applied
              </button>
              <button onClick={() => setAskApplied(false)} className="btn btn-ghost !py-1.5 !text-xs">
                Not yet
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
        {match && tone && (
          <section className="rounded-2xl border border-line bg-gradient-to-br from-emerald-50/70 via-white to-cyan-50/50 p-5">
            <div className="flex items-center gap-4">
              <MatchRing score={match.score} size={64} stroke={5} />
              <div>
                <p className="font-semibold" style={{ color: tone.color }}>
                  {tone.label}
                </p>
                <p className="text-sm text-muted">Based on your resume and preferences</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Bar label="Role" value={match.titleScore} hint="Title vs. what you do" />
              <Bar label="Skills" value={match.skillScore} hint={`${match.matchedSkills.length} skills mentioned`} />
              <Bar label="Seniority" value={match.levelScore} hint="Level vs. your experience" />
            </div>
            {match.matchedSkills.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold tracking-wider text-faint uppercase">Your skills in this posting</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {match.matchedSkills.map((s) => (
                    <span key={s} className="chip !border-brand/20 !bg-white !text-fg">
                      <Check size={12} className="text-brand" /> {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {!(missing || head.closed) && job && <TailorPanel id={id} partial={job.descriptionPartial} />}

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock size={15} className="text-faint" /> About the role
          </h3>
          {job ? (
            <>
              <article
                className="job-description"
                // Sanitised to formatting tags and links when the worker syncs the listing (apps/worker/src/listings/boards.ts).
                dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
              />
              {job.descriptionPartial && (
                <p className="mt-3 text-sm text-muted">
                  This is an excerpt.{' '}
                  <a href={job.applyUrl} target="_blank" rel="noopener" className="font-medium text-fg underline underline-offset-2">
                    Read the full posting on {job.via}
                  </a>
                  .
                </p>
              )}
            </>
          ) : missing ? (
            <p className="text-sm text-muted">The description was removed along with the listing.</p>
          ) : (
            <div className="space-y-2.5">
              {[90, 75, 85, 60, 80].map((w) => (
                <div key={w} className="skeleton h-3" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
