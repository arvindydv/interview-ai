'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BadgeCheck, Lock, Mail, Sparkles, Target } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { OtpInput } from '@/components/OtpInput';
import { Spinner } from '@/components/ui';
import { useCaptcha } from '@/lib/captcha';
import { safeNext } from '@/lib/safeNext';
import { WEB_URL, supabase } from '@/lib/supabase';

// Sign in with an existing Friday account (same Supabase project as the main site). New accounts are
// created on the main site, which also handles password resets.

const RESEND_COOLDOWN_S = 60;

function friendlyError(message: string, email: string) {
  if (/expired or is invalid|otp_expired|invalid.*token/i.test(message)) {
    return `That code didn't match. Use the code from the most recent email sent to ${email}.`;
  }
  if (/invalid login credentials/i.test(message)) {
    return "Wrong email or password. If you've only signed in with a code before, use that instead.";
  }
  if (/signups? not allowed|user not found/i.test(message)) {
    return 'No Friday account uses this email yet. Create one first, then come back.';
  }
  if (/email not confirmed/i.test(message)) return 'Confirm your email on the Friday site first, then sign in here.';
  if (/rate limit|too many|security purposes/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your connection and try again.";
  return message;
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const captcha = useCaptcha();
  const [step, setStep] = useState<'password' | 'email' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const verifying = useRef(false);

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => (data.session ? router.replace(next) : setChecking(false)));
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError((e as Error).message, email));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  }

  const signInWithPassword = () =>
    run(async () => {
      const { error } = await supabase().auth.signInWithPassword({ email, password, options: { captchaToken: captcha.require() } });
      if (error) throw error;
      router.replace(next);
    });

  const sendCode = () =>
    run(async () => {
      const { error } = await supabase().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, captchaToken: captcha.require() },
      });
      if (error) throw error;
      setCode('');
      setAttempt((a) => a + 1);
      setResendIn(RESEND_COOLDOWN_S);
      setStep('code');
    });

  const verifyCode = (token = code) => {
    if (verifying.current || token.length < 6) return;
    verifying.current = true;
    return run(async () => {
      try {
        const { error } = await supabase().auth.verifyOtp({ email, token, type: 'email' });
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

  if (checking) return <Spinner className="text-muted" />;

  return (
    <div className="w-full max-w-[380px]">
      {step === 'password' && (
        <>
          <h1 className="text-[28px] font-semibold tracking-tight">Sign in to Friday Jobs</h1>
          <p className="mt-2 text-muted">Use your Friday AI account. Your resume comes with you.</p>
          <form
            className="mt-8 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              signInWithPassword();
            }}
          >
            <label className="relative block">
              <Mail size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input !pl-10" />
            </label>
            <label className="relative block">
              <Lock size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="input !pl-10" />
            </label>
            <div className="text-right">
              <a href={`${WEB_URL}/login`} className="text-sm text-muted hover:text-fg">
                Forgot password?
              </a>
            </div>
            <button disabled={busy} className="btn btn-primary w-full !py-3">
              {busy ? <Spinner /> : <>Sign in <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={() => { setError(null); setStep('email'); }} className="btn btn-secondary w-full !py-3">
            <Mail size={16} /> Email me a sign-in code
          </button>
          <p className="mt-8 text-center text-sm text-muted">
            New to Friday?{' '}
            <a href={`${WEB_URL}/signup`} className="font-medium text-brand hover:underline">
              Create a free account
            </a>
          </p>
        </>
      )}

      {step === 'email' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
        >
          <button type="button" onClick={() => { setError(null); setStep('password'); }} className="btn btn-ghost -ml-3 mb-6 !px-3">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-[28px] font-semibold tracking-tight">Sign in with a code</h1>
          <p className="mt-2 text-muted">We&rsquo;ll email a 6-digit code to your Friday account address.</p>
          <div className="mt-8 space-y-3">
            <label className="relative block">
              <Mail size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input !pl-10" />
            </label>
            <button disabled={busy} className="btn btn-primary w-full !py-3">
              {busy ? <Spinner /> : <>Send code <ArrowRight size={16} /></>}
            </button>
          </div>
        </form>
      )}

      {step === 'code' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifyCode();
          }}
        >
          <button type="button" onClick={() => { setError(null); setStep('email'); }} className="btn btn-ghost -ml-3 mb-6 !px-3">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-[28px] font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-muted">
            We sent a 6-digit code to <span className="font-medium text-fg">{email}</span>
          </p>
          <div className="mt-8">
            <OtpInput key={attempt} value={code} onChange={setCode} onComplete={verifyCode} disabled={busy} />
          </div>
          <button disabled={busy || code.length < 6} className="btn btn-primary mt-6 w-full !py-3">
            {busy ? <Spinner /> : 'Verify and continue'}
          </button>
          <p className="mt-5 text-center text-sm text-muted">
            Didn&rsquo;t get it?{' '}
            {resendIn > 0 ? (
              <span className="text-faint">Resend in {resendIn}s</span>
            ) : (
              <button type="button" onClick={sendCode} disabled={busy} className="font-medium text-brand hover:underline">
                Send a new code
              </button>
            )}
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {captcha.element}
    </div>
  );
}

const POINTS = [
  { icon: Target, title: 'Matched to your resume', body: 'Every job is scored against your skills, titles and experience.' },
  { icon: Sparkles, title: 'Fresh every 30 minutes', body: 'Straight from company careers pages, so nothing is stale.' },
  { icon: BadgeCheck, title: 'Track every application', body: 'Save roles, mark them applied and follow them through to the offer.' },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-6 py-7 sm:px-12">
        <Link href="/" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <Suspense>
            <SignIn />
          </Suspense>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-line bg-bg lg:flex lg:flex-col lg:justify-center lg:p-16">
        <div className="hero-wash absolute inset-0" />
        <div className="dot-grid absolute inset-0" />
        <div className="relative max-w-md">
          <p className="eyebrow !text-brand">Friday Jobs</p>
          <h2 className="mt-4 text-4xl leading-tight font-semibold tracking-tight">
            The jobs that fit you, <span className="text-gradient">ranked for you</span>.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="card grid size-10 shrink-0 place-items-center text-brand">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
