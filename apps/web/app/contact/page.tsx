import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Clock, Mail, MapPin, Phone } from 'lucide-react';
import { NavBar, Reveal, SpotlightGroup } from '@/components/landing/motion';
import { Eyebrow, legalLinks, SiteFooter } from '@/components/landing/sections';
import { company } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Contact us · Friday AI',
  description: 'Get help with your Friday AI account, billing, refunds or privacy.',
};

const channels = [
  {
    icon: Mail,
    label: 'Email',
    value: company.email,
    href: `mailto:${company.email}`,
    note: `Best for support, billing and refunds. We reply within ${company.responseDays} working days.`,
  },
  {
    icon: Phone,
    label: 'Phone',
    value: company.phone,
    href: `tel:${company.phone.replace(/[^\d+]/g, '')}`,
    note: company.supportHours,
  },
  {
    icon: MapPin,
    label: 'Address',
    value: company.address.join(', '),
    href: null,
    note: `${company.brand} is operated by ${company.legalName}.`,
  },
];

const topics = [
  ['Billing and refunds', 'Include your Razorpay payment ID (pay_…) so we can find the payment quickly.'],
  ['Account and sign-in', 'Write from the email address you use to sign in to Friday AI.'],
  ['Privacy and data requests', 'Ask for a copy of your data, a correction or account deletion.'],
  ['Bugs and app problems', 'Tell us your operating system, app version and what happened.'],
];

export default function ContactPage() {
  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <NavBar />

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
            <Eyebrow>Contact</Eyebrow>
          </div>
          <h1 className="rise-in mt-6 text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-6xl">
            We&rsquo;re here to <span className="text-gradient">help</span>
          </h1>
          <p className="rise-in mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg" style={{ '--i': 1 } as React.CSSProperties}>
            Questions about your account, a payment or how {company.brand} works? Get in touch and a real person will
            reply.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <SpotlightGroup className="grid items-stretch gap-4 md:grid-cols-3">
          {channels.map(({ icon: Icon, label, value, href, note }, i) => (
            <Reveal key={label} delay={i * 110}>
              <div className="spot glass flex h-full flex-col rounded-[var(--radius-card)] p-7 transition duration-500 hover:-translate-y-1">
                <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
                  <Icon size={19} />
                </span>
                <p className="eyebrow mt-6">{label}</p>
                {href ? (
                  <a href={href} className="mt-2 text-lg font-semibold break-words transition hover:text-brand">
                    {value}
                  </a>
                ) : (
                  <p className="mt-2 text-lg font-semibold">{value}</p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-muted">{note}</p>
              </div>
            </Reveal>
          ))}
        </SpotlightGroup>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-24 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <Reveal>
          <div className="glass h-full rounded-[var(--radius-card)] p-7 sm:p-9">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">What to include</h2>
            <p className="mt-2 text-sm text-muted">A few details help us sort things out in a single reply.</p>
            <ul className="mt-7 divide-y divide-line">
              {topics.map(([t, d]) => (
                <li key={t} className="py-4 first:pt-0 last:pb-0">
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-sm text-muted">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="glass flex h-full flex-col rounded-[var(--radius-card)] p-7 sm:p-9">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
              <Clock size={19} />
            </span>
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Grievance Officer</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              For complaints under the IT Rules, 2021 or the Digital Personal Data Protection Act, 2023, write to{' '}
              <strong className="font-medium text-fg">{company.grievanceOfficer}</strong> at{' '}
              <a href={`mailto:${company.email}`} className="text-brand">
                {company.email}
              </a>
              . We acknowledge complaints within 24 hours and try to resolve them within 15 days.
            </p>
            <div className="mt-auto pt-8">
              <p className="eyebrow">Policies</p>
              <ul className="mt-3 space-y-2 text-sm">
                {legalLinks
                  .filter(([, h]) => h !== '/contact')
                  .map(([l, h]) => (
                    <li key={h}>
                      <Link href={h} className="group inline-flex items-center gap-1.5 text-muted transition hover:text-fg">
                        {l} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
