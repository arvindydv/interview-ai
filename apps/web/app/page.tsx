import { Fragment } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Banknote, BookOpen, Briefcase, Camera, Check, Code2, Download, EyeOff, FileText, GraduationCap, HeartPulse,
  Landmark, Megaphone, Mic, Sparkles, Users,
} from 'lucide-react';
import { FREE_MINUTES, PLANS, PRICE_PER_MINUTE, formatInr } from '@parakeet/shared';
import { HeroDemo } from '@/components/HeroDemo';
import { DownloadButtons } from '@/components/DownloadButtons';
import {
  CountUp, Faq, Magnetic, NavBar, Reveal, SpotlightGroup, TiltStage, WordRotator,
} from '@/components/landing/motion';
import { Eyebrow, SiteFooter } from '@/components/landing/sections';
import { CloakVisual, ContextVisual, LiveVisual, ScanVisual, ScoreVisual, ShieldOrbit } from '@/components/landing/visuals';
import { JsonLd } from '@/components/JsonLd';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, faqJsonLd, pageMetadata, siteJsonLd } from '@/lib/site';

export const metadata = pageMetadata({ title: DEFAULT_TITLE, absoluteTitle: true, description: DEFAULT_DESCRIPTION, path: '/' });

const features = [
  {
    icon: Mic,
    title: 'Live Assist: real-time interview answers',
    body: 'Hears the interviewer, detects each question and streams an answer-first response to a floating overlay in under a second.',
    visual: LiveVisual,
    span: 'lg:col-span-4',
  },
  {
    icon: Camera,
    title: 'Screenshot Solve for coding rounds',
    body: 'One hotkey captures a coding problem. A full solution with time and space complexity streams in.',
    visual: ScanVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: GraduationCap,
    title: 'AI mock interviews',
    body: 'Practise with an AI interviewer for your role, get scored on every answer and track your readiness over time.',
    visual: ScoreVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: FileText,
    title: 'Built from your resume',
    body: 'Your projects, STAR stories and the job description are loaded in, so answers use your real experience and sound like you.',
    visual: ContextVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: EyeOff,
    title: 'Private on screen share',
    body: 'The overlay is excluded from screen capture on supported systems, so only you can see it.',
    visual: CloakVisual,
    span: 'lg:col-span-2',
  },
];

const steps = [
  { n: '01', title: 'Prepare in 2 minutes', body: 'Upload your resume, paste the job description and pick an answer style. Practise with an AI mock interview if you like.' },
  { n: '02', title: 'Join your interview call', body: 'Zoom, Google Meet, Microsoft Teams or Webex. No bot joins the meeting and no virtual audio driver is needed.' },
  { n: '03', title: 'Answer with confidence', body: 'Answers appear in well under a second, built from your resume. Press a hotkey for a deeper follow-up.' },
];

const roles = [
  'Software Engineering', 'Teaching', 'Finance & Accounting', 'Banking', 'HR & Recruiting', 'Sales & Marketing',
  'Healthcare & Nursing', 'Data & Analytics', 'Product Management', 'Government Jobs', 'Consulting', 'Customer Service',
];
const rounds = [
  'HR interviews', 'Behavioral · STAR', 'Live coding', 'System design', 'Case interviews', 'Phone screens',
  'Panel interviews', 'Demo lessons', 'Hiring manager rounds', 'Campus placements', 'Technical deep dives', 'Final rounds',
];

/** Who it's for: the fields interviews can be set up for (see FIELDS in @parakeet/shared). */
const audiences = [
  { icon: Code2, title: 'Software & IT', body: 'Coding rounds, system design, DSA and technical deep dives, with full solutions from a screenshot.' },
  { icon: Users, title: 'Freshers & campus placements', body: 'HR rounds, "tell me about yourself" and internship interviews, answered from your own projects.' },
  { icon: BookOpen, title: 'Teaching & education', body: 'Subject questions, classroom scenarios and demo-lesson rounds for school and college roles.' },
  { icon: Banknote, title: 'Finance, banking & accounting', body: 'Role-knowledge questions, case scenarios and the numbers behind your experience.' },
  { icon: Megaphone, title: 'Sales, marketing & HR', body: 'Behavioral STAR answers, targets you have hit and how you handle people and pressure.' },
  { icon: HeartPulse, title: 'Healthcare & nursing', body: 'Clinical scenarios, patient-care questions and why you chose the role.' },
  { icon: Landmark, title: 'Government & public sector', body: 'Panel interviews and situational questions, with calm, structured answers.' },
  { icon: Briefcase, title: 'Managers & senior roles', body: 'Leadership, strategy and hiring-manager rounds that draw on your track record.' },
];

const faqs = [
  {
    q: 'What is Friday AI?',
    a: 'Friday AI is a real-time AI interview assistant, also called an interview copilot, for Windows, macOS and Linux. During a live video interview it listens to the interviewer, detects each question and shows a short, personalised answer on a private overlay. It also solves coding problems from a screenshot and runs AI mock interviews so you can practise beforehand.',
  },
  {
    q: 'Is Friday AI free?',
    a: `You get ${FREE_MINUTES} free minutes when you first sign in to the desktop app, with no card needed. After that it is ${formatInr(PRICE_PER_MINUTE * 100)} per minute, or unlimited with a ${formatInr(PLANS.monthly.amount)} monthly or ${formatInr(PLANS.yearly.amount)} yearly plan. Every feature is included on every plan.`,
  },
  {
    q: 'Does it only work for software engineering interviews?',
    a: 'No. Friday AI works for any job: teaching, finance, banking, HR, sales, healthcare, government roles and campus placements, as well as coding, data and system design rounds. Answers are built from your resume and the job description you add, so they fit the role you are interviewing for.',
  },
  {
    q: 'How is Friday AI different from using ChatGPT in an interview?',
    a: 'With ChatGPT you have to type or paste the question. Friday AI hears it on the call and starts answering in under a second, already knows your resume and the job description, and shows the answer on an overlay that is hidden from screen share on supported systems.',
  },
  {
    q: 'Does Friday AI join my meeting as a bot?',
    a: 'No. Friday AI runs on your own computer and listens to the call audio directly. Nothing joins the meeting, and no virtual audio driver is needed.',
  },
  {
    q: 'Can the interviewer see the overlay when I share my screen?',
    a: 'On Windows 10 (2004) and later, and on macOS 14 and earlier, the overlay is excluded from screen capture. macOS 15+ and Linux don’t let apps guarantee this, so we tell you honestly when it isn’t protected.',
  },
  {
    q: 'Is my audio recorded or stored?',
    a: 'Never. Audio is streamed straight to speech-to-text and discarded. Transcripts are only kept if you opt in, and you can delete them in one click.',
  },
  {
    q: 'Which platforms and meeting apps are supported?',
    a: 'The desktop app runs on Windows, macOS and Linux (Ubuntu, Debian, Arch, Fedora), and works with Zoom, Google Meet, Microsoft Teams and Webex.',
  },
  {
    q: 'How fast do answers appear?',
    a: 'The first word lands on screen in under a second. Answers lead with the key point, so you can start talking while the rest streams in.',
  },
  {
    q: 'Can I practise with mock interviews before the real one?',
    a: 'Yes. Practice Mode runs an AI mock interview for the role you are preparing for. You answer each question, get a score and feedback on every answer, and can track how your readiness improves over time.',
  },
];

function Chip({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  return (
    <span aria-hidden={hidden || undefined} className="glass flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm whitespace-nowrap text-muted">
      <Sparkles size={13} className="text-brand" />
      {children}
    </span>
  );
}

export default function Home() {
  const headline = ['The', 'AI', 'interview', 'assistant'];

  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <JsonLd data={siteJsonLd()} />
      <JsonLd data={faqJsonLd(faqs)} />
      <NavBar />

      <main>
        {/* ───────────── hero ───────────── */}
        <header className="relative isolate pt-36 pb-10 sm:pt-44">
          <div className="aurora -z-10" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-b from-transparent to-bg" />

          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <div className="animate-fade-up">
              <Link
                href="/login"
                className="group inline-flex items-center gap-2 rounded-full border border-line-strong bg-white/[0.03] py-1 pr-3 pl-1 text-xs text-muted backdrop-blur transition hover:border-brand/40 hover:text-fg"
              >
                <span className="rounded-full bg-brand-gradient px-2 py-0.5 text-[10px] font-semibold text-[#04120c]">NEW</span>
                First word on screen in under a second
                <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
              </Link>
            </div>

            <h1 className="mx-auto mt-8 max-w-6xl text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-7xl lg:text-[4.75rem]">
              {/* real spaces between the animated words, so search engines and screen readers read a sentence */}
              {headline.map((w, i) => (
                <Fragment key={w}>
                  <span className="word-rise" style={{ '--i': i } as React.CSSProperties}>
                    {w}
                  </span>{' '}
                </Fragment>
              ))}
              <br />
              <span className="word-rise" style={{ '--i': headline.length } as React.CSSProperties}>
                for
              </span>{' '}
              <span className="word-rise" style={{ '--i': headline.length + 1 } as React.CSSProperties}>
                <WordRotator words={['every round', 'HR interviews', 'live coding', 'system design', 'campus placements']} />
              </span>
            </h1>

            <p
              className="rise-in mx-auto mt-7 max-w-2xl text-base text-muted sm:text-lg"
              style={{ '--i': headline.length + 2 } as React.CSSProperties}
            >
              Friday AI listens to your Zoom, Google Meet or Teams interview, detects each question and shows a clear
              answer built from your resume on a private overlay, in under a second.
            </p>

            <div
              className="rise-in mt-10 flex flex-wrap justify-center gap-3"
              style={{ '--i': headline.length + 3 } as React.CSSProperties}
            >
              <Magnetic>
                <Link href="/signup" className="btn btn-primary btn-shine px-7 py-3.5 text-[15px]">
                  Start for free <ArrowRight size={17} />
                </Link>
              </Magnetic>
              <Magnetic strength={0.2}>
                <a href="#download" className="btn btn-secondary px-7 py-3.5 text-[15px] backdrop-blur">
                  <Download size={17} /> Download for desktop
                </a>
              </Magnetic>
            </div>

            <div
              className="rise-in mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-faint"
              style={{ '--i': headline.length + 4 } as React.CSSProperties}
            >
              <span>Works with</span>
              {['Zoom', 'Google Meet', 'Microsoft Teams', 'Webex'].map((app) => (
                <span key={app} className="font-medium text-muted transition hover:text-fg">
                  {app}
                </span>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
            <TiltStage>
              <HeroDemo />
            </TiltStage>
          </div>
        </header>

        {/* ───────────── stats ───────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <div className="glass grid grid-cols-2 overflow-hidden rounded-2xl md:grid-cols-4">
              {[
                { v: <CountUp to={1} from={9} prefix="<" suffix="s" />, l: 'to first word' },
                { v: <CountUp to={3} />, l: 'modes: live, screenshot, practice' },
                { v: <CountUp to={4} />, l: 'meeting apps supported' },
                { v: <CountUp to={0} from={100} />, l: 'audio recordings stored' },
              ].map(({ v, l }, i) => (
                <div
                  key={l}
                  className={`group relative p-7 text-center transition hover:bg-white/[0.02] ${
                    i % 2 ? '' : 'border-r border-line'
                  } ${i < 2 ? 'border-b border-line md:border-b-0' : ''} ${i === 1 ? 'md:border-r' : ''}`}
                >
                  <div className="text-gradient text-4xl font-semibold tracking-tight sm:text-5xl">{v}</div>
                  <div className="mt-2 text-sm text-muted">{l}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ───────────── features (bento) ───────────── */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-32 sm:px-6">
          <Reveal className="text-center">
            <Eyebrow>Features</Eyebrow>
            <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              Everything you need, <span className="text-gradient">right when the question lands</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-muted">
              Real-time answers, coding solutions and AI mock interviews, one hotkey away. Built for the moment your mind
              goes blank.
            </p>
          </Reveal>

          <SpotlightGroup className="mt-16 grid gap-4 lg:grid-cols-6">
            {features.map(({ icon: Icon, title, body, visual: Visual, span }, i) => (
              <Reveal key={title} delay={i * 90} className={span}>
                <div className="spot glass flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] p-6 transition duration-500 hover:-translate-y-1">
                  <div className="mb-6">
                    <Visual />
                  </div>
                  <div className="mt-auto flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
                      <Icon size={19} />
                    </span>
                    <div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </SpotlightGroup>
        </section>

        {/* ───────────── use-case marquee ───────────── */}
        <section className="pb-32">
          <Reveal className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <p className="text-sm text-muted">Built for every role and every round</p>
          </Reveal>
          <div className="mt-8 space-y-3">
            {[roles, rounds].map((row, r) => (
              <div key={r} className="marquee">
                <div className="marquee-track" data-reverse={r ? '' : undefined} style={{ '--dur': `${45 + r * 10}s` } as React.CSSProperties}>
                  {[...row, ...row].map((t, i) => (
                    // the second copy only exists to make the loop seamless
                    <Chip key={i} hidden={i >= row.length}>{t}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ───────────── who it's for ───────────── */}
        <section id="who" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-32 sm:px-6">
          <Reveal className="text-center">
            <Eyebrow>Who it’s for</Eyebrow>
            <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              An AI interview assistant for <span className="text-gradient">every job</span>, not just tech
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-muted">
              Tell Friday the role, the organisation and the job description. Answers use the vocabulary of your field and
              the experience on your resume, whether it’s a coding round or a demo lesson.
            </p>
          </Reveal>
          <SpotlightGroup className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {audiences.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={(i % 4) * 80}>
                <div className="spot glass h-full rounded-[var(--radius-card)] p-5 transition duration-500 hover:-translate-y-1">
                  <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
                    <Icon size={19} />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </Reveal>
            ))}
          </SpotlightGroup>
        </section>

        {/* ───────────── how it works ───────────── */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-32 sm:px-6">
          <Reveal className="text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Ready for your interview in three steps</h2>
          </Reveal>

          <div className="relative mt-16">
            {/* connecting line that draws itself as you scroll */}
            <div className="absolute top-7 right-[16%] left-[16%] hidden h-px bg-line md:block">
              <div className="timeline-fill bg-brand-gradient h-full w-full" />
            </div>
            <div className="grid gap-10 md:grid-cols-3 md:gap-6">
              {steps.map((s, i) => (
                <Reveal key={s.n} delay={i * 150} className="text-center">
                  <div className="relative mx-auto grid size-14 place-items-center rounded-2xl bg-surface-2 ring-1 ring-line-strong">
                    <span className="absolute inset-0 rounded-2xl bg-brand/10 blur-md" />
                    <span className="text-gradient relative font-mono text-lg font-semibold">{s.n}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{s.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────── privacy ───────────── */}
        <section id="privacy" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-32 sm:px-6">
          <Reveal>
            <div className="glass relative grid items-center gap-12 overflow-hidden rounded-[2rem] p-8 md:grid-cols-2 md:p-14">
              <div className="glow pointer-events-none absolute -top-1/2 -right-1/4 -z-10 size-[600px] opacity-60" />
              <div>
                <Eyebrow>Privacy by default</Eyebrow>
                <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em]">
                  Built so <span className="text-gradient">only you</span> see it
                </h2>
                <p className="mt-4 text-muted">
                  Provider keys never touch your computer, audio never touches our servers, and every guarantee is stated
                  honestly per operating system.
                </p>
                <ul className="mt-8 space-y-3.5">
                  {[
                    'Overlay excluded from screen share on Windows 10 2004+ and macOS 14 and earlier',
                    'Audio streamed directly to speech-to-text and never stored',
                    'Session archives are opt-in, with retention you control',
                    'Sign-in tokens encrypted with your OS keychain',
                  ].map((t, i) => (
                    <Reveal as="li" key={t} delay={200 + i * 100} className="flex gap-3 text-sm">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand/15 text-brand ring-1 ring-brand/30">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      {t}
                    </Reveal>
                  ))}
                </ul>
              </div>
              <ShieldOrbit />
            </div>
          </Reveal>
        </section>

        {/* ───────────── FAQ ───────────── */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 pb-32 sm:px-6">
          <Reveal className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em]">Frequently asked questions</h2>
          </Reveal>
          <Reveal delay={120} className="mt-12">
            <Faq items={faqs} />
          </Reveal>
        </section>

        {/* ───────────── CTA ───────────── */}
        <section id="download" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-24 sm:px-6">
          <Reveal>
            <div className="conic-border relative overflow-hidden rounded-[2rem] bg-surface/60 px-6 py-20 text-center sm:py-24">
              <div className="aurora -z-10 opacity-70" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
              <h2 className="mx-auto max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
                Walk into your next interview <span className="text-gradient">prepared</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-muted">
                Download the AI interview assistant for Windows, macOS and Linux (Ubuntu, Debian, Arch, Fedora). Set up
                in minutes, with your first {FREE_MINUTES} minutes free.
              </p>
              <div className="mt-10 flex justify-center">
                <DownloadButtons size="lg" />
              </div>
              <Link href="/signup" className="btn btn-ghost mt-5">
                or create a free account first <ArrowRight size={15} />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
