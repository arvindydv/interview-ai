import Link from 'next/link';
import {
  ArrowRight, Camera, Check, Download, EyeOff, FileText, GraduationCap, Mic, Sparkles,
} from 'lucide-react';
import { HeroDemo } from '@/components/HeroDemo';
import { DownloadButtons } from '@/components/DownloadButtons';
import {
  CountUp, Faq, Magnetic, NavBar, Reveal, SpotlightGroup, TiltStage, WordRotator,
} from '@/components/landing/motion';
import { Eyebrow, SiteFooter } from '@/components/landing/sections';
import { CloakVisual, ContextVisual, LiveVisual, ScanVisual, ScoreVisual, ShieldOrbit } from '@/components/landing/visuals';

const features = [
  {
    icon: Mic,
    title: 'Live Assist',
    body: 'Hears the interviewer, detects each question and streams an answer-first response to a floating overlay.',
    visual: LiveVisual,
    span: 'lg:col-span-4',
  },
  {
    icon: Camera,
    title: 'Screenshot Solve',
    body: 'One hotkey captures a coding problem. A full solution with complexity analysis streams in.',
    visual: ScanVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: GraduationCap,
    title: 'Practice Mode',
    body: 'Talk to an AI interviewer, get scored on every answer and track your readiness over time.',
    visual: ScoreVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: FileText,
    title: 'Built from your resume',
    body: 'Your projects, STAR stories and the job description are pre-loaded so answers sound like you.',
    visual: ContextVisual,
    span: 'lg:col-span-2',
  },
  {
    icon: EyeOff,
    title: 'Screen-share privacy',
    body: 'The overlay is excluded from screen capture on supported systems, so it stays on your screen only.',
    visual: CloakVisual,
    span: 'lg:col-span-2',
  },
];

const steps = [
  { n: '01', title: 'Prepare in 2 minutes', body: 'Upload your resume, paste the job description and pick an answer style.' },
  { n: '02', title: 'Join your call', body: 'Zoom, Google Meet, Teams or Webex. No bots join the meeting and no virtual audio driver is needed.' },
  { n: '03', title: 'Answer with confidence', body: 'Answers appear in well under a second. Press a hotkey for a deeper follow-up.' },
];

const roles = [
  'Software Engineering', 'System Design', 'Behavioral · STAR', 'Product Management', 'Data Science',
  'Frontend', 'Backend', 'DevOps & SRE', 'Machine Learning', 'Engineering Manager',
];
const rounds = [
  'Phone screens', 'Live coding', 'Take-home reviews', 'Case interviews', 'Hiring manager rounds',
  'Panel interviews', 'Culture fit', 'Technical deep dives', 'Bar raiser', 'Final rounds',
];

const faqs = [
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
];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="glass flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm whitespace-nowrap text-muted">
      <Sparkles size={13} className="text-brand" />
      {children}
    </span>
  );
}

export default function Home() {
  const headline = ['Your', 'real-time', 'AI', 'copilot'];

  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <NavBar />

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

          <h1 className="mx-auto mt-8 max-w-5xl text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-7xl lg:text-[5.25rem]">
            {headline.map((w, i) => (
              <span key={w} className="word-rise mr-[0.22em]" style={{ '--i': i } as React.CSSProperties}>
                {w}
              </span>
            ))}
            <br />
            <span className="word-rise mr-[0.22em]" style={{ '--i': headline.length } as React.CSSProperties}>
              for
            </span>
            <span className="word-rise" style={{ '--i': headline.length + 1 } as React.CSSProperties}>
              <WordRotator words={['every interview', 'system design', 'live coding', 'behavioral rounds']} />
            </span>
          </h1>

          <p
            className="rise-in mx-auto mt-7 max-w-2xl text-base text-muted sm:text-lg"
            style={{ '--i': headline.length + 2 } as React.CSSProperties}
          >
            Friday AI listens to your call, spots each question and shows a clear, personalised answer on a private
            overlay, before the silence gets awkward.
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
            Three modes, one hotkey away. Built for the moment your mind goes blank.
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
                  <Chip key={i}>{t}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────── how it works ───────────── */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-32 sm:px-6">
        <Reveal className="text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Ready in three steps</h2>
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
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em]">Questions, answered</h2>
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
              Available for Windows, macOS and Linux (Ubuntu, Debian, Arch, Fedora). Set up in minutes.
            </p>
            <div className="mt-10 flex justify-center">
              <DownloadButtons size="lg" />
            </div>
            <Link href="/login" className="btn btn-ghost mt-5">
              or create a free account first <ArrowRight size={15} />
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
