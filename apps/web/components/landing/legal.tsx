import Link from 'next/link';
import { NavBar } from '@/components/landing/motion';
import { Eyebrow, SiteFooter } from '@/components/landing/sections';
import { company, LEGAL_UPDATED } from '@/lib/company';

/** Page shell shared by the legal pages: site nav, header, a sticky contents list and the footer. */
export function LegalPage({
  eyebrow,
  title,
  intro,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: React.ReactNode;
  /** [id, heading] of each <LegalSection>, in order, for the contents list. */
  sections: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <NavBar />

      <main>
        <header className="relative isolate pt-36 pb-14 sm:pt-44">
          <div className="aurora -z-10" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-b from-transparent to-bg" />

          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <div className="animate-fade-up">
              <Eyebrow>{eyebrow}</Eyebrow>
            </div>
            <h1 className="rise-in mt-6 text-[2.4rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-6xl">
              {title}
            </h1>
            <div className="rise-in mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg" style={{ '--i': 1 } as React.CSSProperties}>
              {intro}
            </div>
            <p className="rise-in mt-6 text-xs text-faint" style={{ '--i': 2 } as React.CSSProperties}>
              Last updated {LEGAL_UPDATED}
            </p>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-28 sm:px-6 lg:grid-cols-[220px_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-28 text-sm" aria-label="On this page">
              <p className="eyebrow">On this page</p>
              <ol className="mt-4 space-y-2 border-l border-line">
                {sections.map(([id, heading]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="-ml-px block border-l border-transparent pl-4 text-muted transition hover:border-brand hover:text-fg">
                      {heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="glass rounded-[var(--radius-card)] p-6 sm:p-10">
            <div className="space-y-12">{children}</div>
            <LegalContact />
          </article>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted [&_a]:text-brand [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_strong]:font-medium [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-brand">
        {children}
      </div>
    </section>
  );
}

/** Closing block on every policy: who to write to. */
function LegalContact() {
  return (
    <div className="mt-12 rounded-2xl border border-line bg-surface/40 p-5 text-sm text-muted sm:p-6">
      <p className="font-medium text-fg">Questions about this policy?</p>
      <p className="mt-2">
        Write to <a className="text-brand" href={`mailto:${company.email}`}>{company.email}</a> or see all the ways to
        reach us on the{' '}
        <Link href="/contact" className="text-brand">
          contact page
        </Link>
        . {company.brand} is operated by {company.legalName}.
      </p>
    </div>
  );
}
