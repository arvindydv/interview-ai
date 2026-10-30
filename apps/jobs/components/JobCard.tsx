'use client';
import { Bookmark, BookmarkCheck, MapPin } from 'lucide-react';
import { APPLICATION_STATUS_LABELS, type FeedItem } from '@parakeet/shared';
import { AgencyBadge, CompanyLogo, MatchRing, StartupBadge, ViaBadge, matchTone } from './ui';
import { listingFacts, postedAgo } from '@/lib/format';

export function JobCard({
  job,
  selected,
  onSelect,
  onToggleSave,
}: {
  job: FeedItem;
  selected: boolean;
  onSelect: () => void;
  onToggleSave: () => void;
}) {
  const posted = postedAgo(job.postedAt);
  const saved = job.status === 'saved';
  const tracked = job.status && job.status !== 'saved';
  const facts = listingFacts(job).slice(0, 2);

  return (
    <article
      onClick={onSelect}
      className={`group relative min-w-0 cursor-pointer rounded-2xl border bg-surface p-4 transition sm:p-5 ${
        selected
          ? 'border-brand/50 shadow-[0_0_0_3px_rgb(5_150_105_/_0.08),var(--shadow-raised)]'
          : 'border-line shadow-[var(--shadow-card)] hover:border-line-strong hover:shadow-[var(--shadow-raised)]'
      }`}
    >
      <div className="flex gap-4">
        <CompanyLogo company={job.company} website={job.companyWebsite} logo={job.companyLogo} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            {job.company}
            {job.startup && <StartupBadge batch={job.ycBatch} />}
            {job.agency && <AgencyBadge />}
            {job.via && <ViaBadge via={job.via} url={job.viaUrl} />}
          </p>
          <h3 className="mt-0.5 leading-snug font-semibold text-fg">{job.title}</h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
            <MapPin size={14} className="shrink-0 text-faint" />
            <span className="truncate">{job.location || 'Location not listed'}</span>
          </p>
          {(facts.length > 0 || job.salary || tracked || job.closed) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {facts.map((f) => (
                <span key={f} className="chip">
                  {f}
                </span>
              ))}
              {job.salary && <span className="chip !border-brand/20 !bg-brand/5 !text-brand">{job.salary}</span>}
              {tracked && <span className="chip !border-cyan-600/20 !bg-cyan-600/5 !text-cyan-700">{APPLICATION_STATUS_LABELS[job.status!]}</span>}
              {job.closed && <span className="chip !text-warn">Closed</span>}
            </div>
          )}
        </div>
        {job.match && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <MatchRing score={job.match.score} size={50} />
            <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: matchTone(job.match.score).color }}>
              {matchTone(job.match.score).label.split(' ')[0]}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-xs sm:pl-[60px]">
        {job.match && job.match.matchedSkills.length > 0 ? (
          <p className="min-w-0 flex-1 truncate text-muted">
            <span className="font-medium text-fg">{job.match.matchedSkills.length} of your skills</span> ·{' '}
            {job.match.matchedSkills.slice(0, 4).join(', ')}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        {posted && <span className="shrink-0 text-faint">{posted}</span>}
        {!tracked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
              saved ? 'text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
            aria-pressed={saved}
          >
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {saved ? 'Saved' : 'Save'}
          </button>
        )}
      </div>
    </article>
  );
}

export function JobCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex gap-4">
        <div className="skeleton size-11 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
