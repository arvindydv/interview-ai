'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, MessageSquarePlus, Quote, Star } from 'lucide-react';
import type { PublicReviews } from '@parakeet/shared';
import { API_URL } from '@/lib/api';
import { Reveal } from '@/components/landing/motion';
import { Eyebrow } from '@/components/landing/sections';

// Real reviews only: written by signed-in users who agreed to publish them, and approved in the
// admin console (GET /v1/reviews). Until there are some, the section invites the first ones.

function Stars({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5 text-warn" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} fill={i <= Math.round(n) ? 'currentColor' : 'none'} className={i <= Math.round(n) ? '' : 'text-line-strong'} />
      ))}
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Reviews() {
  const [data, setData] = useState<PublicReviews | null | undefined>(undefined);

  useEffect(() => {
    fetch(`${API_URL}/v1/reviews`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicReviews>) : null))
      .then(setData, () => setData(null));
  }, []);

  const reviews = data?.reviews ?? [];
  const has = reviews.length > 0;

  return (
    <section id="reviews" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-32 sm:px-6">
      <Reveal className="text-center">
        <Eyebrow>Reviews</Eyebrow>
        <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em]">What candidates say about Friday</h2>
        {has && data?.average != null && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
            <Stars n={data.average} />
            <span>
              <b className="font-semibold text-fg">{data.average.toFixed(1)}</b> out of 5 from {data.count} review{data.count === 1 ? '' : 's'}
            </span>
          </p>
        )}
      </Reveal>

      {has ? (
        // Masonry once there are enough to fill three columns; centred cards before that.
        <div className={`mt-12 ${reviews.length >= 3 ? 'columns-1 gap-4 sm:columns-2 lg:columns-3' : 'flex flex-wrap justify-center gap-4'}`}>
          {reviews.map((r, i) => (
            <Reveal key={r.id} delay={(i % 3) * 90} className={reviews.length >= 3 ? 'mb-4 break-inside-avoid' : 'w-full sm:w-[24rem]'}>
              <figure className="glass relative rounded-2xl p-6">
                <Quote size={28} className="absolute top-5 right-5 text-brand/15" aria-hidden />
                <Stars n={r.rating} />
                <blockquote className="mt-3 text-[15px] leading-relaxed text-fg/90">“{r.message}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-[#04120c]">
                    {initials(r.displayName)}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {r.displayName}
                      <BadgeCheck size={14} className="text-brand" aria-label="Friday user" />
                    </span>
                    {r.role && <span className="block truncate text-xs text-muted">{r.role}</span>}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      ) : (
        data !== undefined && (
          <Reveal delay={100} className="glass mx-auto mt-12 max-w-xl rounded-2xl p-8 text-center">
            <div className="flex justify-center">
              <Stars n={0} size={22} />
            </div>
            <p className="mt-4 font-medium">Reviews from real Friday users will appear here.</p>
            <p className="mt-1.5 text-sm text-muted">Used Friday in an interview or a mock round? Be one of the first to share how it went.</p>
          </Reveal>
        )
      )}

      <Reveal delay={150} className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link href="/feedback" className="btn btn-primary">
          <Star size={16} /> Write a review
        </Link>
        <Link href="/feedback#feedback" className="btn btn-secondary">
          <MessageSquarePlus size={16} /> Send feedback
        </Link>
      </Reveal>
      <p className="mt-4 text-center text-xs text-faint">Every review is from a signed-in Friday user and shown with their permission.</p>
    </section>
  );
}
