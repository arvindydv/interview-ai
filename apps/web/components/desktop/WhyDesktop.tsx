import { EyeOff, Headphones, Keyboard, Layers } from 'lucide-react';
import { DownloadButtons } from '@/components/DownloadButtons';
import { DesktopFilm } from '@/components/desktop/DesktopFilm';
import { USE_STEPS } from '@/components/desktop/useSteps';
import { Reveal } from '@/components/landing/motion';
import { Eyebrow } from '@/components/landing/sections';

const reasons = [
  {
    icon: Headphones,
    title: 'It can hear your interviewer',
    body: 'Your interview runs in Zoom, Meet, Teams or Webex. Only an app on your computer can hear that call. A website can’t.',
  },
  {
    icon: Layers,
    title: 'Answers float over the call',
    body: 'The overlay stays on top of the meeting window, right where you’re looking. No tab switching mid-answer.',
  },
  {
    icon: EyeOff,
    title: 'Private when you share',
    body: 'The overlay is excluded from screen capture on Windows 10 (2004+) and macOS 14 and earlier.',
  },
  {
    icon: Keyboard,
    title: 'Hotkeys that work mid-call',
    body: 'Ctrl + Enter for an answer, Ctrl + Shift + Enter to solve a coding problem, without leaving the call.',
  },
];

/** Landing section: what the desktop app does in an interview, why it must be a desktop app, and how to start. */
export function WhyDesktop() {
  return (
    <section id="why-desktop" className="relative mx-auto max-w-6xl scroll-mt-24 px-4 pt-32 sm:px-6">
      <Reveal className="text-center">
        <Eyebrow>Watch how it works</Eyebrow>
        <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Prepare on the web. <span className="text-gradient">Get live help on desktop.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-muted">
          Your resume, mock interviews and plans live here. During the real interview, the{' '}
          <b className="font-medium text-fg">desktop app</b> works alongside your video call: it hears each question and shows a clear
          answer on a private overlay, in under a second.
        </p>
      </Reveal>

      <Reveal delay={150} className="relative mt-12">
        <div className="glow pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10" aria-hidden />
        <DesktopFilm />
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {reasons.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 90} className="glass rounded-2xl p-5">
            <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/25">
              <Icon size={18} />
            </span>
            <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
            <p className="mt-1.5 text-sm text-muted">{body}</p>
          </Reveal>
        ))}
      </div>

      <Reveal delay={100} className="conic-border relative mt-10 overflow-hidden rounded-[1.75rem] bg-surface/60 p-6 sm:p-10">
        <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h3 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">How to use Friday</h3>
            <ol className="mt-6 grid gap-5 sm:grid-cols-2">
              {USE_STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3.5">
                  <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-[#04120c] shadow-glow">
                    <Icon size={18} />
                    <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-fg ring-1 ring-line-strong">
                      {i + 1}
                    </span>
                  </span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="mt-1 text-sm text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Get the desktop app</p>
            <p className="mt-1 text-xs text-muted">Windows 10 & 11 · macOS 11+ · Linux (deb, rpm, AppImage)</p>
            <div className="mt-5">
              <DownloadButtons size="lg" />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
