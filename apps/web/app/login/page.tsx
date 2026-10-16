'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Laptop, Mail } from 'lucide-react';
import { handoffSupabase, isAllowedDesktopRedirect, supabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';
import { OtpInput } from '@/components/OtpInput';
import { Spinner } from '@/components/ui';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const RESEND_COOLDOWN_S = 30;

/** Turns Supabase Auth errors into guidance the user can act on. */
function friendlyError(message: string, email: string) {
  if (/expired or is invalid|otp_expired|invalid.*token/i.test(message)) {
    return `That code didn't match. Use the code from the most recent email sent to ${email}. Each new code replaces the previous one.`;
  }
  if (/rate limit|too many|security purposes/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your connection and try again.";
  return message;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect');
  const state = params.get('state') ?? '';
  const desktop = isAllowedDesktopRedirect(redirect);
  const client = desktop ? handoffSupabase() : supabase();
  const next = desktop
    ? `/desktop-auth?${new URLSearchParams({ redirect: redirect!, state })}`
    : '/dashboard';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Remounts the code boxes (clearing them and focusing the first) after a failed attempt.
  const [attempt, setAttempt] = useState(0);
  // Each new code invalidates the previous one, so resending is rate-limited to avoid replacing a
  // code the user is about to type.
  const [resendIn, setResendIn] = useState(0);
  const verifying = useRef(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError((e as Error).message, email));
    } finally {
      setBusy(false);
    }
  }

  const callbackUrl = () =>
    `${location.origin}/auth/callback?${new URLSearchParams({ next, handoff: desktop ? '1' : '' })}`;

  const sendCode = () =>
    run(async () => {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      setCode('');
      setAttempt((a) => a + 1);
      setResendIn(RESEND_COOLDOWN_S);
      if (step === 'code') setNotice(`New code sent. Codes from earlier emails no longer work.`);
      setStep('code');
    });

  const verifyCode = (token = code) => {
    // Auto-submit on the 6th digit and a manual Enter/click can race; only one request may run.
    if (verifying.current || token.length < 6) return;
    verifying.current = true;
    return run(async () => {
      try {
        const { error } = await client.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
        if (error) {
          setCode('');
          setAttempt((a) => a + 1);
          throw error;
        }
        router.replace(next);
      } finally {
        verifying.current = false;
      }
    });
  };

  const google = () =>
    run(async () => {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl() } });
      if (error) throw error;
    });

  return (
    <div className="w-full max-w-[400px] animate-fade-up">
      {desktop && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-brand/25 bg-brand/[0.07] p-3 text-sm">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
            <Laptop size={18} />
          </span>
          <span className="text-fg/90">Signing in the desktop app. You'll be sent back to it automatically.</span>
        </div>
      )}

      {step === 'email' ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted">Sign in or create an account. No password needed.</p>

          <button onClick={google} disabled={busy} className="btn btn-secondary mt-8 w-full py-3">
            <GoogleIcon /> Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />or continue with email<span className="h-px flex-1 bg-line" />
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <div className="relative">
              <Mail size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input !pl-10"
                placeholder="you@example.com"
              />
            </div>
            <button disabled={busy} className="btn btn-primary w-full py-3">
              {busy ? <Spinner /> : <>Continue with email <ArrowRight size={16} /></>}
            </button>
          </form>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifyCode();
          }}
        >
          <button type="button" onClick={() => setStep('email')} className="btn btn-ghost -ml-3 mb-6 !px-3">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-muted">
            We sent a 6-digit code to <span className="font-medium text-fg">{email}</span>
          </p>
          <div className="mt-8">
            <OtpInput key={attempt} value={code} onChange={setCode} onComplete={verifyCode} disabled={busy} />
          </div>
          <button disabled={busy || code.length < 6} className="btn btn-primary mt-6 w-full py-3">
            {busy ? <Spinner /> : 'Verify and sign in'}
          </button>
          <p className="mt-5 text-center text-sm text-muted">
            Didn't get it? Check spam, or{' '}
            {resendIn > 0 ? (
              <span className="text-faint">resend in {resendIn}s</span>
            ) : (
              <button type="button" onClick={sendCode} disabled={busy} className="font-medium text-brand hover:underline">
                send a new code
              </button>
            )}
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-5 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-sm text-brand">{notice}</p>
      )}

      <p className="mt-10 text-xs text-faint">
        By continuing you agree to the Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-l border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="absolute inset-0 bg-grid" />
      <div className="absolute -right-20 -bottom-20 size-[600px] glow" />
      <div className="relative">
        <p className="eyebrow !text-brand">Real-time interview assistant</p>
        <h2 className="mt-4 max-w-md text-4xl font-semibold leading-tight tracking-tight">
          Answers on screen <span className="text-gradient">before the pause</span> gets awkward.
        </h2>
      </div>
      <div className="relative glass max-w-md animate-float rounded-2xl p-5 shadow-glow">
        <p className="text-xs text-muted">Interviewer asked</p>
        <p className="mt-1 text-sm font-medium">"Tell me about a time you disagreed with your manager."</p>
        <div className="my-4 h-px bg-line" />
        <p className="text-sm leading-relaxed text-fg/85">
          <span className="font-semibold text-brand">Situation:</span> At Acme, my manager wanted to ship without load
          testing. <span className="font-semibold text-brand">Action:</span> I proposed a 2-day canary…
        </p>
      </div>
      <ul className="relative space-y-2.5 text-sm text-muted">
        {['Live answers in under a second', 'Personalised from your resume', 'Hidden from screen share'].map((t) => (
          <li key={t} className="flex items-center gap-2.5">
            <Check size={15} className="text-brand" /> {t}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-12">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
      <BrandPanel />
    </main>
  );
}
