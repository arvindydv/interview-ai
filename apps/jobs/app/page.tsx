import Link from 'next/link';
import { connection } from 'next/server';
import {
  ArrowRight, Bookmark, Check, FileText, MapPin, RefreshCw, Search, Send, Sparkles, Target, UserRound, Wand2,
} from 'lucide-react';
import type { ListingSummary } from '@parakeet/shared';
import { Header } from '@/components/Header';
import { CompanyLogo, MatchRing } from '@/components/ui';
import { getCompanies, searchListings } from '@/lib/publicApi';

const STEPS = [
  {
    icon: UserRound,
    title: 'Sign in with Friday',
    body: 'Use your Friday AI account. The resume you already gave Friday comes with you, nothing to fill in twice.',
  },
  {
    icon: Target,
    title: 'Get ranked matches',
    body: 'Every open role is scored against your titles, skills and years of experience, then sorted for you.',
  },
  {
    icon: Send,
    title: 'Apply and track',
    body: 'Apply on the company’s own site, then follow each application from applied to interview to offer.',
  },
];

const FEATURES = [
  { icon: Sparkles, title: 'Recommended', body: 'Fresh roles that fit you, newest first, the moment they go live.' },
  { icon: Target, title: 'Top matches', body: 'The handful of jobs your experience fits best, with the reasons why.' },
  { icon: RefreshCw, title: 'Updated every 30 minutes', body: 'Pulled straight from company careers pages. No reposts, no stale ads.' },
  { icon: Bookmark, title: 'Saved', body: 'Bookmark roles to come back to when you’re ready to apply.' },
  { icon: Send, title: 'Application tracker', body: 'Applied, interviewing, offer: every application in one place.' },
  { icon: Wand2, title: 'AI Apply, coming soon', body: 'A resume tailored to each job description, submitted for you.' },
];

const DEMO_SCORES = [94, 88, 81];

function DemoCard({ job, score }: { job: ListingSummary & { website: string | null }; score: number }) {
  return (
    <div className="flex gap-3.5 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <CompanyLogo company={job.company} website={job.website} size={40} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted">{job.company}</p>
        <p className="truncate text-sm font-semibold">{job.title}</p>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted">
          <MapPin size={12} className="shrink-0" /> {job.location || 'Remote'}
        </p>
      </div>
      <MatchRing score={score} size={44} />
    </div>
  );
}

export default async function Home() {
  // Rendered per request (from cached API data): the API isn't reachable while the image is built.
  await connection();
  const [latest, companies] = await Promise.all([searchListings({ q: 'engineer', location: 'India' }), getCompanies()]);
  const total = companies.reduce((n, c) => n + c.open, 0);
  const website = (company: string) => companies.find((c) => c.company === company)?.website ?? null;
  const demo = latest.items.slice(0, 3).map((j) => ({ ...j, website: website(j.company) }));

  return (
    <div className="min-h-screen bg-bg">
      <Header />

      <section className="relative overflow-hidden">
        <div className="hero-wash absolute inset-0" />
        <div className="dot-grid absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted shadow-[var(--shadow-card)]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              {total.toLocaleString('en-IN')} live jobs from {companies.length} companies
            </span>
            <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl xl:text-[54px]">
              Jobs matched to <span className="text-gradient">your resume</span>, not just keywords.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Friday Jobs reads your experience, ranks every open role by how well you fit, and keeps your applications in
              one place. Built by the team behind Friday AI.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/login" className="btn btn-primary !px-5 !py-3 !text-[15px]">
                Find my matches <ArrowRight size={17} />
              </Link>
              <a href="#how" className="btn btn-secondary !px-5 !py-3 !text-[15px]">
                How it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {['Free with your Friday account', 'Straight from careers pages', 'Updated every 30 min'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check size={15} className="text-brand" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-emerald-200/40 via-cyan-200/30 to-violet-200/40 blur-2xl" />
            <div className="relative rounded-2xl border border-line bg-surface/80 p-3 shadow-[0_30px_80px_-30px_rgb(12_19_34_/_0.35)] backdrop-blur">
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-3">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                <span className="size-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 flex flex-1 items-center gap-2 rounded-md bg-surface-2 px-3 py-1 text-xs text-faint">
                  <Search size={12} /> Recommended for you
                </span>
              </div>
              <div className="space-y-2.5 rounded-xl bg-bg p-3">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-sm font-semibold">Top matches</p>
                  <p className="text-xs text-muted">Based on your resume</p>
                </div>
                {demo.map((job, i) => (
                  <DemoCard key={job.id} job={job} score={DEMO_SCORES[i]} />
                ))}
                <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-violet-800">
                    <Sparkles size={13} /> Why it&rsquo;s a match
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {['TypeScript', 'Node.js', 'PostgreSQL', 'System design'].map((s) => (
                      <span key={s} className="chip !bg-white !text-fg">
                        <Check size={11} className="text-brand" /> {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface py-10">
        <p className="text-center text-xs font-semibold tracking-wider text-faint uppercase">Open roles right now at</p>
        <div className="mx-auto mt-6 flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-5 px-4 sm:px-6">
          {[...companies]
            .sort((a, b) => b.open - a.open)
            .slice(0, 16)
            .map((c) => (
              <span key={c.company} className="flex items-center gap-2 text-sm font-semibold text-muted">
                <CompanyLogo company={c.company} website={c.website} size={26} />
                {c.company}
              </span>
            ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <p className="eyebrow !text-brand">How it works</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">From resume to shortlist in seconds.</h2>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="card relative p-6">
              <span className="absolute top-6 right-6 text-sm font-semibold text-faint tabular-nums">0{i + 1}</span>
              <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-50 to-cyan-50 text-brand">
                <Icon size={20} />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="eyebrow !text-brand">Everything in one place</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">A job search that works for you.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-surface p-7">
                <Icon size={20} className="text-brand" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center sm:px-16">
          <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(16_185_129_/_0.25),transparent_70%)]" />
          <div className="relative">
            <FileText className="mx-auto text-emerald-300" size={28} />
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">See which jobs fit you best.</h2>
            <p className="mx-auto mt-4 max-w-lg text-slate-300">
              Sign in with your Friday account. If your resume is already there, your matches are ready in seconds.
            </p>
            <Link href="/login" className="btn mt-8 bg-white !px-6 !py-3 text-ink hover:bg-slate-100">
              Find my matches <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-faint sm:px-6">
          <span>© {new Date().getFullYear()} Friday AI</span>
          <span>Listings come from each company&rsquo;s public careers page.</span>
        </div>
      </footer>
    </div>
  );
}
