import { useState } from 'react';
import { Camera, Globe, GraduationCap, Mic, ShieldCheck } from 'lucide-react';
import { parakeet as p } from './bridge';
import { LogoMark, Spinner } from './ui';

const rise = (i: number) => ({ '--i': i }) as React.CSSProperties;

const highlights = [
  { icon: Mic, title: 'Live Assist', body: 'For any job: hears each question and shows an answer before the silence gets awkward.' },
  { icon: Camera, title: 'Screenshot Solve', body: 'One hotkey reads a test question, case or problem on screen and answers it.' },
  { icon: GraduationCap, title: 'Practice Mode', body: 'Rehearse with an AI interviewer and get scored.' },
];

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await p.auth.signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid h-full grid-cols-[1.1fr_1fr] overflow-hidden">
      <div className="grain" aria-hidden />

      {/* brand side */}
      <section className="relative isolate flex flex-col justify-between overflow-hidden border-r border-line p-10">
        <div className="aurora -z-10" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="bg-grid absolute inset-0 -z-10" aria-hidden />

        <div className="rise-in flex items-center gap-2.5 font-semibold tracking-tight" style={rise(0)}>
          <LogoMark size={30} /> Parakeet
        </div>

        <div>
          <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em]">
            {['Walk', 'in', 'prepared.'].map((w, i) => (
              <span key={w} className="word-rise mr-[0.22em]" style={rise(i + 1)}>
                {w}
              </span>
            ))}
            <br />
            <span className="word-rise text-gradient pb-[0.1em]" style={rise(4)}>
              Answer with confidence.
            </span>
          </h1>
          <ul className="mt-10 space-y-5">
            {highlights.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rise-in flex gap-4" style={rise(6 + i)}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-accent/15 text-brand ring-1 ring-brand/20">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="rise-in flex items-center gap-2 text-xs text-faint" style={rise(10)}>
          <ShieldCheck size={14} className="text-brand" /> Audio is never stored. Sign-in tokens stay in your OS keychain.
        </p>
      </section>

      {/* sign-in side */}
      <section className="relative flex flex-col items-center justify-center px-10 text-center">
        <div className="glow pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[520px] -translate-x-1/2 -translate-y-1/2 opacity-50" />
        <div className="rise-in w-full max-w-sm" style={rise(3)}>
          <div className="mx-auto grid size-20 place-items-center animate-float">
            <LogoMark size={64} />
          </div>
          <h2 className="mt-7 text-2xl font-semibold tracking-tight">Sign in to Parakeet</h2>
          <p className="mt-2 text-sm text-muted">
            We'll open your browser to sign in securely. You'll be sent straight back here.
          </p>

          <button
            onClick={signIn}
            disabled={busy}
            className="btn btn-primary btn-shine mt-8 w-full py-3.5 text-[15px]"
          >
            {busy ? (
              <>
                <Spinner /> Waiting for your browser…
              </>
            ) : (
              <>
                <Globe size={18} /> Continue in browser
              </>
            )}
          </button>
          {busy && (
            <button onClick={signIn} className="btn btn-ghost mt-2 w-full text-xs">
              Browser didn't open? Try again
            </button>
          )}
          {error && (
            <p className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          )}
          <p className="mt-8 text-xs text-faint">No password is ever typed into this app.</p>
        </div>
      </section>
    </div>
  );
}
