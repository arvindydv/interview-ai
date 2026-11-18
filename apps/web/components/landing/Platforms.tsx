import { AudioLines, Check, Code2, Globe, MonitorSmartphone, Users, Video } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { Reveal, SpotlightGroup } from '@/components/landing/motion';
import { Eyebrow } from '@/components/landing/sections';

// Friday hears the interviewer through the computer's sound output (WASAPI loopback, Core Audio
// taps, PulseAudio/PipeWire monitor: see apps/desktop/src-tauri/src/audio.rs), so it works with any
// meeting app, in a browser or installed, without plugins. Brand colours only tint generic icons;
// these are not the companies' logos.

const css = (v: Record<string, string>) => v as React.CSSProperties;

const meetingApps = [
  { name: 'Google Meet', where: 'In Chrome, Edge or any browser', icon: Video, color: '#00AC47' },
  { name: 'Zoom', where: 'Desktop app or browser', icon: Video, color: '#0B5CFF' },
  { name: 'Microsoft Teams', where: 'Desktop app or browser', icon: Users, color: '#5B5FC7' },
  { name: 'Webex', where: 'Desktop app or browser', icon: AudioLines, color: '#00A0D1' },
];

const moreApps = [
  'Skype', 'Slack huddles', 'GoTo Meeting', 'Amazon Chime', 'Jitsi Meet', 'Whereby', 'Discord', 'Zoho Meeting',
  'Lark', 'RingCentral', 'WhatsApp calls', 'Phone calls on your laptop',
];

const codingApps = ['HackerRank', 'LeetCode', 'CoderPad', 'CodeSignal', 'HackerEarth', 'Codility', 'Google Docs', 'Any shared editor'];

function Pill({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  return (
    <span
      aria-hidden={hidden || undefined}
      className="glass flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm whitespace-nowrap text-muted"
    >
      <Check size={13} className="text-brand" />
      {children}
    </span>
  );
}

/** Landing section: the meeting and coding platforms Friday works with. */
export function Platforms() {
  return (
    <section id="platforms" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-32 sm:px-6">
      <Reveal className="text-center">
        <Eyebrow>Works where you interview</Eyebrow>
        <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Every major meeting app. <span className="text-gradient">Nothing to install in them.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-muted">
          Friday listens to your computer’s sound, not to the meeting itself. So it works with any call you can hear: no bot joins, no
          plugin and no virtual audio driver to set up.
        </p>
      </Reveal>

      {/* hub: Friday in the middle, connected to each app */}
      <Reveal delay={120} className="relative mt-14">
        <div className="glow pointer-events-none absolute -inset-x-10 -inset-y-10 -z-10 opacity-80" aria-hidden />
        <SpotlightGroup className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-6">
          <div className="grid gap-4 lg:order-1">
            {meetingApps.slice(0, 2).map((app, i) => (
              <AppCard key={app.name} app={app} delay={i * 0.4} />
            ))}
          </div>

          <div className="relative mx-auto hidden size-56 place-items-center lg:order-2 lg:grid" aria-hidden>
            {[0, 1.2, 2.4].map((d) => (
              <span key={d} className="ripple absolute inset-6 rounded-full ring-1 ring-brand/40" style={css({ '--d': `${d}s` })} />
            ))}
            <span className="orbit absolute inset-0 rounded-full border border-dashed border-line-strong" style={css({ '--dur': '40s' })} />
            <div className="conic-border relative grid size-28 place-items-center rounded-[2rem] bg-surface shadow-2xl shadow-black/40">
              <LogoMark size={56} />
            </div>
            <span className="absolute -bottom-2 rounded-full bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand ring-1 ring-brand/30">
              Listening to system audio
            </span>
          </div>

          <div className="grid gap-4 lg:order-3">
            {meetingApps.slice(2).map((app, i) => (
              <AppCard key={app.name} app={app} delay={0.8 + i * 0.4} />
            ))}
          </div>
        </SpotlightGroup>
      </Reveal>

      {/* everything else that plays sound */}
      <Reveal delay={100} className="mt-14 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          <MonitorSmartphone size={16} className="text-brand-2" /> And any other call that plays on your computer
        </p>
      </Reveal>
      <div className="marquee mt-5">
        <div className="marquee-track" style={css({ '--dur': '50s' })}>
          {[...moreApps, ...moreApps].map((t, i) => (
            <Pill key={i} hidden={i >= moreApps.length}>
              {t}
            </Pill>
          ))}
        </div>
      </div>

      {/* coding rounds */}
      <Reveal delay={100} className="glass mt-10 flex flex-col items-center gap-5 rounded-2xl p-6 sm:flex-row sm:p-7">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/25">
          <Code2 size={22} />
        </span>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="font-semibold">Coding rounds on any platform</p>
          <p className="mt-1 text-sm text-muted">
            Screenshot Solve reads whatever is on your screen, so it works in every online editor and assessment.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 sm:max-w-sm sm:justify-end">
          {codingApps.map((c) => (
            <span key={c} className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-xs text-muted ring-1 ring-line">
              {c}
            </span>
          ))}
        </div>
      </Reveal>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-faint">
        <Globe size={12} /> Product names are trademarks of their owners. Friday isn’t affiliated with or endorsed by them.
      </p>
    </section>
  );
}

function AppCard({
  app,
  delay,
}: {
  app: (typeof meetingApps)[number];
  delay: number;
}) {
  const Icon = app.icon;
  return (
    <div className="spot glass relative flex items-center gap-4 overflow-hidden rounded-2xl p-5">
      <span
        className="grid size-14 shrink-0 place-items-center rounded-2xl text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${app.color}, color-mix(in srgb, ${app.color} 60%, #000))` }}
      >
        <Icon size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold tracking-tight">{app.name}</p>
        <p className="text-sm text-muted">{app.where}</p>
      </div>
      <span className="flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-brand/25">
        <span className="size-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: `${delay}s` }} /> Supported
      </span>
    </div>
  );
}
