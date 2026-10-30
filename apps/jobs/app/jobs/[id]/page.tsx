import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Briefcase, MapPin, Target, Wallet } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgencyBadge, CompanyLogo, ViaBadge } from '@/components/ui';
import { getCompanies, getListing } from '@/lib/publicApi';
import { listingFacts, postedAgo } from '@/lib/format';

// Public job page, for shared links and search engines. Signed-in people open jobs inside the app.

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const listing = await getListing((await params).id);
  if (!listing) return { title: 'Job not found' };
  return {
    title: `${listing.title} at ${listing.company}`,
    description: [listing.company, listing.location, ...listingFacts(listing)].filter(Boolean).join(' · '),
    // Job boards' terms don't allow passing their jobs on to search engines' job listings.
    robots: listing.closed || listing.via ? { index: false } : undefined,
  };
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const [listing, companies] = await Promise.all([getListing(id), getCompanies()]);
  if (!listing) notFound();
  const website = companies.find((c) => c.company === listing.company)?.website ?? null;
  const posted = postedAgo(listing.postedAt);

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 pb-24 sm:px-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Link href="/" className="btn btn-ghost -ml-3 !px-3">
            <ArrowLeft size={16} /> Friday Jobs
          </Link>
          <div className="card mt-3 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <CompanyLogo company={listing.company} website={listing.via ? null : website} logo={listing.companyLogo} size={52} />
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {listing.company}
                  {listing.agency && <AgencyBadge />}
                  {listing.via && <ViaBadge via={listing.via} url={listing.viaUrl} />}
                </p>
                <p className="text-sm text-muted">{posted ? `Posted ${posted}` : 'Recently posted'}</p>
              </div>
            </div>
            <h1 className="mt-5 text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">{listing.title}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
              {listing.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-faint" /> {listing.location}
                </span>
              )}
              {listingFacts(listing).length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Briefcase size={14} className="text-faint" /> {listingFacts(listing).join(' · ')}
                </span>
              )}
              {listing.salary && (
                <span className="flex items-center gap-1.5 font-medium text-brand">
                  <Wallet size={14} /> {listing.salary}
                </span>
              )}
            </div>
            {listing.closed ? (
              <p className="mt-6 rounded-xl border border-warn/20 bg-warn/5 px-4 py-3 text-sm text-warn">
                {listing.via
                  ? `This role is no longer listed on ${listing.via}, so it has probably been filled.`
                  : <>This role is no longer on {listing.company}&rsquo;s careers page, so it has probably been filled.</>}
              </p>
            ) : (
              <div className="mt-6">
                <a
                  href={listing.applyUrl}
                  target="_blank"
                  // Remote-job boards ask for a followed link that sends them the visitor.
                  rel={listing.via ? 'noopener' : 'noopener noreferrer nofollow'}
                  className="btn btn-primary"
                >
                  {listing.via ? `Apply via ${listing.via}` : <>Apply on {listing.company}&rsquo;s site</>} <ArrowUpRight size={16} />
                </a>
                {listing.via && (
                  <p className="mt-3 text-xs text-muted">
                    Found on{' '}
                    <a href={listing.applyUrl} target="_blank" rel="noopener" className="font-medium text-fg underline underline-offset-2">
                      {listing.via}
                    </a>
                    {listing.postedOn && <>, which found it on {listing.postedOn}</>}.
                  </p>
                )}
              </div>
            )}
            <hr className="my-8 border-line" />
            <article
              className="job-description"
              // Sanitised to formatting tags and links when the worker syncs the listing (apps/worker/src/listings/boards.ts).
              dangerouslySetInnerHTML={{ __html: listing.descriptionHtml }}
            />
            {listing.descriptionPartial && (
              <p className="mt-4 text-sm text-muted">
                This is an excerpt.{' '}
                <a href={listing.applyUrl} target="_blank" rel="noopener" className="font-medium text-fg underline underline-offset-2">
                  Read the full posting on {listing.via}
                </a>
                .
              </p>
            )}
          </div>
        </div>

        <aside className="lg:pt-14">
          <div className="card sticky top-20 overflow-hidden">
            <div className="bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-white text-brand shadow-[var(--shadow-card)]">
                <Target size={20} />
              </span>
              <h2 className="mt-4 text-lg font-semibold">How well do you fit?</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Sign in with your Friday account to see your match score for this role, and every other job ranked for you.
              </p>
              <Link href={`/login?${new URLSearchParams({ next: `/search?job=${listing.id}` })}`} className="btn btn-primary mt-5 w-full">
                See my match
              </Link>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
