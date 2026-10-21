'use client';
import { useEffect, useState } from 'react';
import { Mic, Sparkles, Zap } from 'lucide-react';

const QUESTION = 'How would you design a rate limiter for a public API?';
const ANSWER =
  'Use a token bucket per API key, stored in Redis. Each request atomically takes a token with a Lua script; buckets refill at a fixed rate, so short bursts are allowed while the average stays capped. Return 429 with a Retry-After header when empty.';

// Self-playing mock of the overlay so visitors see the product in action.
export function HeroDemo() {
  const [chars, setChars] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setChars((c) => (c > ANSWER.length + 60 ? 0 : c + 3)), 30);
    return () => clearInterval(id);
  }, []);
  const shown = ANSWER.slice(0, chars);
  const streaming = chars < ANSWER.length;

  return (
    <div className="relative mx-auto w-full max-w-5xl animate-fade-up text-left [animation-delay:200ms]">
      <div className="absolute -inset-x-10 -inset-y-16 -z-10 glow" />
      <div className="glass overflow-hidden rounded-2xl shadow-2xl shadow-black/50">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 hidden text-xs text-muted sm:inline">Technical interview · System design</span>
          <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-danger">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" /> REC 24:13
          </span>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1.3fr_1fr] md:p-6">
          {/* fake video tiles */}
          <div className="grid grid-cols-2 gap-3">
            {['Interviewer', 'You'].map((name, i) => (
              <div
                key={name}
                className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-surface-3 to-surface ring-1 ring-line"
              >
                <div className="absolute inset-0 grid place-items-center">
                  <div
                    className={`grid size-14 place-items-center rounded-full text-lg font-semibold ${
                      i ? 'bg-accent/20 text-accent' : 'bg-brand-2/15 text-brand-2'
                    }`}
                  >
                    {i ? 'Y' : 'S'}
                  </div>
                </div>
                <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 text-[11px]">
                  {!i && <Mic size={11} className="text-brand" />} {name}
                </span>
              </div>
            ))}
            <div className="col-span-2 rounded-xl bg-surface/80 p-3 text-sm ring-1 ring-line">
              <p className="eyebrow mb-1.5 !text-[10px]">Live transcript</p>
              <p className="text-muted">
                <span className="font-medium text-brand-2">Interviewer:</span> Great. Next one…{' '}
                <span className="rounded bg-brand/15 px-1 text-fg">{QUESTION}</span>
              </p>
            </div>
          </div>

          {/* the overlay */}
          <div className="relative flex flex-col rounded-xl bg-bg/90 p-4 ring-1 ring-brand/30 shadow-glow">
            <div className="mb-3 flex items-center gap-2 text-xs">
              <Sparkles size={14} className="text-brand" />
              <span className="font-semibold">Friday AI</span>
              <span className="ml-auto flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-brand">
                <Zap size={11} /> 0.62s
              </span>
            </div>
            <p className="min-h-36 text-sm leading-relaxed text-fg/90">
              {shown}
              {streaming && <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-caret bg-brand" />}
            </p>
            <div className="mt-3 flex gap-1.5 text-[11px] text-faint">
              <kbd className="rounded bg-white/5 px-1.5 py-0.5 ring-1 ring-line">⌘ ⇧ Space</kbd> hide
              <kbd className="ml-2 rounded bg-white/5 px-1.5 py-0.5 ring-1 ring-line">⌘ ⇧ D</kbd> go deeper
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
