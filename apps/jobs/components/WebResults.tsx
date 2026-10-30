'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Globe, MapPin } from 'lucide-react';
import { elsewhereLinks, type WebJobPage } from '@parakeet/shared';
import { AgencyBadge, Spinner } from './ui';
import { api } from '@/lib/api';
import { postedAgo } from '@/lib/format';

/**
 * Below a search: Careerjet's results that Friday Jobs doesn't hold (fetched live, as its terms ask),
 * then the same search on job sites that offer no API, opened on their own pages. Key it by the search
 * so a new one starts from the first page.
 */
export function WebResults({ q, location, internship }: { q: string; location?: string; internship: boolean }) {
  const [data, setData] = useState<WebJobPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = new URLSearchParams({ q, page: String(page), ...(location ? { location } : {}) });
    api<WebJobPage>(`/v1/job-feed/web?${query}`)
      .then(
        (d) => !cancelled && setData((prev) => (page > 1 && prev ? { ...d, items: [...prev.items, ...d.items] } : d)),
        () => !cancelled && setData(null),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [q, location, page]);

  const items = data?.items ?? [];

  return (
    <section className="mt-10 space-y-6">
      {(loading || items.length > 0) && data?.available !== false && (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <Globe size={16} className="text-faint" /> More from across the web
            </h2>
            <a href="https://www.careerjet.co.in" target="_blank" rel="noopener" className="text-xs text-muted hover:text-fg">
              Jobs by Careerjet
            </a>
          </div>
          <div className="grid gap-2">
            {items.map((j) => (
              <a
                key={j.url}
                href={j.url}
                target="_blank"
                // Careerjet's tracked link; it counts the visit.
                rel="noopener"
                className="group rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-muted">
                  {j.company}
                  {j.agency && <AgencyBadge />}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-fg">
                  {j.title} <ArrowUpRight size={14} className="text-faint group-hover:text-fg" />
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {j.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} className="text-faint" /> {j.location}
                    </span>
                  )}
                  {j.salary && <span className="text-brand">{j.salary}</span>}
                  {postedAgo(j.postedAt) && <span className="text-faint">{postedAgo(j.postedAt)}</span>}
                </p>
                {j.snippet && <p className="mt-2 line-clamp-2 text-sm text-muted">{j.snippet}</p>}
              </a>
            ))}
          </div>
          {loading ? (
            <div className="grid h-16 place-items-center">
              <Spinner className="text-muted" />
            </div>
          ) : (
            data && page < 10 && data.items.length > 0 && page * 20 < data.total && (
              <button onClick={() => setPage((p) => p + 1)} className="btn btn-secondary mt-3 w-full">
                Show more
              </button>
            )
          )}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
        <p className="text-sm font-medium">Search “{q}” on other job sites</p>
        <p className="mt-0.5 text-xs text-muted">These sites don&rsquo;t share their listings, so the search opens on their own page.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {elsewhereLinks(q, location, internship).map((l) => (
            <a key={l.site} href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary !py-1.5 text-sm">
              {l.site} <ArrowUpRight size={14} />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
