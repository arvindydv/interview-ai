import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CalendarRange, Check, Timer } from 'lucide-react';
import { FREE_MINUTES, MIN_MINUTES, PLANS, PRICE_PER_MINUTE, formatInr } from '@parakeet/shared';
import { Faq, Magnetic, NavBar, Reveal, SpotlightGroup } from '@/components/landing/motion';
import { Eyebrow, SiteFooter } from '@/components/landing/sections';
import { JsonLd } from '@/components/JsonLd';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, siteJsonLd } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: `Pricing: AI interview assistant plans from ₹${PRICE_PER_MINUTE}/min`,
  description: `Friday AI pricing in INR: ₹${PRICE_PER_MINUTE} per minute, or unlimited real-time interview help for ${formatInr(PLANS.monthly.amount)}/month or ${formatInr(PLANS.yearly.amount)}/year. First ${FREE_MINUTES} minutes free, no card needed.`,
  path: '/pricing',
});

// Rupees. The API charges from the same catalog (@parakeet/shared billing).
const PER_MINUTE = PRICE_PER_MINUTE;
const MONTHLY = PLANS.monthly.amount / 100;
const YEARLY = PLANS.yearly.amount / 100;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const included = [
  'Live Assist with real-time answers',
  'Screenshot Solve for coding problems',
  'Practice Mode with scored mock interviews',
  'Answers built from your resume and job description',
  'Windows, macOS and Linux desktop app',
];

const plans = [
  {
    icon: Timer,
    name: 'Pay per minute',
    price: inr(PER_MINUTE),
    unit: '/ minute',
    blurb: 'For the occasional interview. Only pay for the minutes Friday AI is listening.',
    note: 'Billed by the minute of live session time. No subscription.',
    perks: [`First ${FREE_MINUTES} minutes free`, `Buy any amount from ${MIN_MINUTES} minutes`, 'Minutes never expire'],
    cta: 'Start paying as you go',
    href: '/billing?product=minutes_30',
    featured: false,
  },
  {
    icon: CalendarDays,
    name: 'Monthly',
    price: inr(MONTHLY),
    unit: '/ month',
    blurb: 'For an active job search with several rounds every week.',
    note: `Pays for itself after about ${Math.ceil(MONTHLY / PER_MINUTE)} minutes a month.`,
    perks: ['Unlimited session minutes', 'One-time payment, no auto-renewal'],
    cta: 'Go monthly',
    href: '/billing?product=monthly',
    featured: true,
  },
  {
    icon: CalendarRange,
    name: 'Yearly',
    price: inr(YEARLY),
    unit: '/ year',
    blurb: 'For people who interview all year, or want to stay ready.',
    note: `Works out to ${inr(Math.round(YEARLY / 12))}/month. You save ${inr(MONTHLY * 12 - YEARLY)} a year.`,
    perks: ['Unlimited session minutes', `Save ${Math.round((1 - YEARLY / (MONTHLY * 12)) * 100)}% vs monthly`],
    cta: 'Go yearly',
    href: '/billing?product=yearly',
    featured: false,
  },
];

const faqs = [
  {
    q: 'Is there a free trial?',
    a: `Yes. You get ${FREE_MINUTES} free minutes of live session time when you first sign in to the desktop app, no card needed, so you can try Friday AI on a real call before you pay. It's one free trial per person and per computer.`,
  },
  {
    q: 'What counts as a billable minute?',
    a: 'Only the time a live session is running and Friday AI is listening. Setting up your profile, uploading a resume and browsing the dashboard are always free.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes. You can move from pay per minute to a monthly or yearly plan at any time, and the new plan takes effect right away.',
  },
  {
    q: 'Do I get every feature on every plan?',
    a: 'Yes. Live Assist, Screenshot Solve, Practice Mode and the desktop app are included on all three plans. Plans differ only in how you pay.',
  },
  {
    q: 'Do plans renew automatically?',
    a: 'No. Monthly and yearly plans are one-time payments with nothing to cancel. Your plan runs for the period you paid for, and buying again before it ends adds to the remaining time.',
  },
  {
    q: 'Are prices inclusive of GST?',
    a: 'Prices are shown in Indian rupees. Any applicable taxes are shown at checkout before you pay.',
  },
];

export default function PricingPage() {
  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <JsonLd data={siteJsonLd()} />
      <JsonLd data={faqJsonLd(faqs)} />
      <JsonLd data={breadcrumbJsonLd([['Pricing', '/pricing']])} />
      <NavBar />

      <main>
        {/* ───────────── header ───────────── */}
        <header className="relative isolate pt-36 pb-16 sm:pt-44">
          <div className="aurora -z-10" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-b from-transparent to-bg" />

          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <div className="animate-fade-up">
              <Eyebrow>Pricing</Eyebrow>
            </div>
            <h1 className="rise-in mt-6 text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-6xl">
              Simple pricing for your <span className="text-gradient">AI interview assistant</span>
            </h1>
            <p className="rise-in mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg" style={{ '--i': 1 } as React.CSSProperties}>
              Pay only for the minutes you use, or get unlimited real-time interview help with a monthly or yearly plan.
              Live answers, coding solutions and AI mock interviews are included on every plan. Prices in INR.
            </p>
            <p className="rise-in mt-6 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/[0.06] px-4 py-1.5 text-sm text-brand" style={{ '--i': 2 } as React.CSSProperties}>
              <Check size={14} strokeWidth={3} /> Your first {FREE_MINUTES} minutes are free. No card needed.
            </p>
          </div>
        </header>

        {/* ───────────── plans ───────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6">
          <SpotlightGroup className="grid items-stretch gap-4 lg:grid-cols-3">
            {plans.map(({ icon: Icon, name, price, unit, blurb, note, perks, cta, href, featured }, i) => (
              <Reveal key={name} delay={i * 110}>
                <div
                  className={`spot relative flex h-full flex-col rounded-[var(--radius-card)] p-7 transition duration-500 hover:-translate-y-1 ${
                    featured ? 'conic-border bg-surface/70' : 'glass'
                  }`}
                >
                  {featured && (
                    <span className="absolute -top-3 left-7 rounded-full bg-brand-gradient px-3 py-1 text-[11px] font-semibold text-[#04120c]">
                      Most popular
                    </span>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
                      <Icon size={19} />
                    </span>
                    <h2 className="text-lg font-semibold">{name}</h2>
                  </div>
                  <p className="mt-4 min-h-[3rem] text-sm leading-relaxed text-muted">{blurb}</p>

                  <div className="mt-6 flex items-baseline gap-2">
                    <span className={`text-5xl font-semibold tracking-tight tabular-nums ${featured ? 'text-gradient' : ''}`}>
                      {price}
                    </span>
                    <span className="text-sm text-muted">{unit}</span>
                  </div>
                  <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-faint">{note}</p>

                  <Link
                    href={href}
                    className={`btn mt-6 w-full py-3 ${featured ? 'btn-primary btn-shine' : 'btn-secondary'}`}
                  >
                    {cta} <ArrowRight size={16} />
                  </Link>

                  <ul className="mt-7 space-y-3 border-t border-line pt-6 text-sm">
                    {[...perks, ...included].map((t) => (
                      <li key={t} className="flex gap-3">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand/15 text-brand ring-1 ring-brand/30">
                          <Check size={12} strokeWidth={3} />
                        </span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </SpotlightGroup>
          <Reveal className="mt-6 text-center text-xs text-faint">
            All prices in Indian rupees (INR). Applicable taxes are shown at checkout.
          </Reveal>
        </section>

        {/* ───────────── FAQ ───────────── */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-32 sm:px-6">
          <Reveal className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em]">Billing questions</h2>
          </Reveal>
          <Reveal delay={120} className="mt-12">
            <Faq items={faqs} />
          </Reveal>
        </section>

        {/* ───────────── CTA ───────────── */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <Reveal>
            <div className="conic-border relative overflow-hidden rounded-[2rem] bg-surface/60 px-6 py-20 text-center">
              <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
              <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                Try it on your <span className="text-gradient">next interview</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-muted">
                Create an account in a minute and get {FREE_MINUTES} free minutes in the desktop app. Upgrade whenever it makes sense.
              </p>
              <div className="mt-10 flex justify-center">
                <Magnetic>
                  <Link href="/signup" className="btn btn-primary btn-shine px-7 py-3.5 text-[15px]">
                    Get started <ArrowRight size={17} />
                  </Link>
                </Magnetic>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
