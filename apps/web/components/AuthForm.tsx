'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CircleCheck, Eye, EyeOff, Laptop, Lock, Mail, User } from 'lucide-react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { FREE_MINUTES } from '@parakeet/shared';
import { company } from '@/lib/company';
import { safeNext } from '@/lib/safeNext';
import { handoffSupabase, isAllowedDesktopRedirect, supabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';
import { OtpInput } from '@/components/OtpInput';
import { Spinner } from '@/components/ui';
import { useCaptcha } from '@/lib/captcha';
import { API_URL } from '@/lib/api';
import { noteSignIn } from '@/lib/meta';

// Matches `max_frequency` in supabase/config.toml; resending sooner is rejected by Supabase.
const RESEND_COOLDOWN_S = 60;
export const MIN_PASSWORD_LENGTH = 8;

export type AuthMode = 'signin' | 'signup';

/**
 * Which screen of the flow is showing.
 * - `password`: email + password (sign in or sign up, per `mode`)
 * - `email`: email only, to receive a one-time sign-in code
 * - `forgot`: email only, to receive a password-reset code
 * - `code`: enter the 6-digit code sent for `codeType`
 * - `reset`: choose a new password after a recovery code was verified
 * - `verified`: sign-up email confirmed; shown briefly before continuing to the dashboard
 */
type Step = 'password' | 'email' | 'forgot' | 'code' | 'reset' | 'verified';

// How long the "Email verified" confirmation stays up before redirecting.
const VERIFIED_REDIRECT_MS = 1200;

/**
 * Whether a new account may use this address (temporary inboxes may not; see the API's
 * lib/freeTrial.ts). If the check can't be reached, sign-up isn't blocked over it.
 */
async function checkEmail(email: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/email-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return res.ok ? await res.json() : { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Turns Supabase Auth errors into guidance the user can act on. */
function friendlyError(message: string, email: string) {
  if (/expired or is invalid|otp_expired|invalid.*token/i.test(message)) {
    return `That code didn't match. Use the code from the most recent email sent to ${email}. Each new code replaces the previous one.`;
  }
  if (/invalid login credentials/i.test(message)) {
    return "Wrong email or password. If you've only signed in with a code before, use that, or reset your password to set one.";
  }
  if (/already registered|already been registered|user already exists/i.test(message)) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (/weak|pwned|leaked/i.test(message)) return 'That password is too easy to guess. Please choose a stronger one.';
  if (/same.*password|different from the old/i.test(message)) return 'Choose a password different from your current one.';
  if (/rate limit|too many|security purposes/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your connection and try again.";
  return message;
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
      <input
        type={show ? 'text' : 'password'}
        required
        autoFocus={autoFocus}
        minLength={autoComplete === 'new-password' ? MIN_PASSWORD_LENGTH : undefined}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input !pr-11 !pl-10"
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-faint transition hover:text-fg"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function NameInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <User size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
      <input
        id="name"
        type="text"
        required
        autoFocus={autoFocus}
        autoComplete="name"
        maxLength={80}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input !pl-10"
        placeholder="Full name"
      />
    </div>
  );
}

function EmailInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Mail size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
      <input
        id="email"
        type="email"
        required
        autoFocus={autoFocus}
        autoComplete="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input !pl-10"
        placeholder="you@example.com"
      />
    </div>
  );
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect');
  const state = params.get('state') ?? '';
  const desktop = isAllowedDesktopRedirect(redirect);
  const client = desktop ? handoffSupabase() : supabase();
  const next = desktop
    ? `/desktop-auth?${new URLSearchParams({ redirect: redirect!, state })}`
    : safeNext(params.get('next'));
  // Switching between sign in and sign up must keep the desktop handoff params.
  const query = params.toString() ? `?${params}` : '';
  const signup = mode === 'signup';

  const captcha = useCaptcha();
  const [step, setStep] = useState<Step>('password');
  const [codeType, setCodeType] = useState<EmailOtpType>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Remounts the code boxes (clearing them and focusing the first) after a failed attempt.
  const [attempt, setAttempt] = useState(0);
  // Each new code invalidates the previous one, so resending is rate-limited to avoid replacing a
  // code the user is about to type.
  const [resendIn, setResendIn] = useState(0);
  const verifying = useRef(false);

  // Already signed in on the website: skip the form and continue to `next` (the dashboard by
  // default). Desktop sign-in still shows the form, because it mints its own session for the app
  // (see handoffSupabase).
  const [checkingSession, setCheckingSession] = useState(!desktop);
  useEffect(() => {
    if (desktop) return;
    supabase()
      .auth.getSession()
      .then(({ data }) => (data.session ? router.replace(next) : setCheckingSession(false)));
    // Only on arrival: signing in from this form redirects by itself.
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
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError((e as Error).message, email));
    } finally {
      // Captcha tokens are single use.
      captcha.reset();
      setBusy(false);
    }
  }

  function goTo(s: Step) {
    setError(null);
    setNotice(null);
    setStep(s);
  }

  const callbackUrl = () =>
    `${location.origin}/auth/callback?${new URLSearchParams({ next, handoff: desktop ? '1' : '' })}`;

  /** Moves to the code screen after an email with a code of `type` has been sent. */
  function awaitCode(type: EmailOtpType, resent: boolean) {
    setCodeType(type);
    setCode('');
    setAttempt((a) => a + 1);
    setResendIn(RESEND_COOLDOWN_S);
    if (resent) setNotice('New code sent. Codes from earlier emails no longer work.');
    setStep('code');
  }

  const sendSignInCode = (resent = false) =>
    run(async () => {
      // Existing accounts can always sign in; a temporary inbox can't create a new one.
      const check = await checkEmail(email);
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: check.ok, emailRedirectTo: callbackUrl(), captchaToken: captcha.require() },
      });
      if (error && !check.ok && /signups? not allowed|not found/i.test(error.message)) throw new Error(check.message);
      if (error) throw error;
      awaitCode('email', resent);
    });

  const sendResetCode = (resent = false) =>
    run(async () => {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(), captchaToken: captcha.require() });
      if (error) throw error;
      awaitCode('recovery', resent);
    });

  const resendConfirmation = (resent = false) =>
    run(async () => {
      const { error } = await client.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: callbackUrl(), captchaToken: captcha.require() },
      });
      if (error) throw error;
      awaitCode('signup', resent);
    });

  const resendCode = () => {
    if (codeType === 'recovery') return sendResetCode(true);
    if (codeType === 'signup') return resendConfirmation(true);
    return sendSignInCode(true);
  };

  const submitPassword = () =>
    run(async () => {
      if (signup) {
        if (!name.trim()) throw new Error('Please enter your name.');
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`Your password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        if (password !== confirmPassword) throw new Error("The passwords don't match.");
        const check = await checkEmail(email);
        if (!check.ok) throw new Error(check.message);
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl(), data: { full_name: name.trim() }, captchaToken: captcha.require() },
        });
        if (error) throw error;
        // A session here means the project auto-confirms emails, so no code was sent and the
        // address is unverified. Never continue in that state: it would let any email sign up.
        if (data.session) {
          await client.auth.signOut();
          throw new Error(
            'Email verification is turned off on the server, so we can’t confirm your address. Please contact support.',
          );
        }
        // With email confirmations on, signing up an existing address returns a user with no
        // identities instead of an error (so addresses can't be enumerated).
        if (data.user && data.user.identities?.length === 0) {
          throw new Error('User already registered');
        }
        awaitCode('signup', false);
        return;
      }
      const { error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: captcha.require() } });
      if (error) {
        if (/email not confirmed/i.test(error.message)) {
          // With captcha on, the sign-in used up the token, so the code is sent from the next screen.
          if (captcha.enabled) {
            awaitCode('signup', false);
            setResendIn(0);
            setNotice('Confirm your email to finish signing in. Press “Resend code” to get a code.');
            return;
          }
          const { error: resendError } = await client.auth.resend({ type: 'signup', email });
          if (resendError) throw resendError;
          awaitCode('signup', false);
          setNotice('Confirm your email to finish signing in. We just sent you a code.');
          return;
        }
        throw error;
      }
      router.replace(next);
    });

  const verifyCode = (token = code) => {
    // Auto-submit on the 6th digit and a manual Enter/click can race; only one request may run.
    if (verifying.current || token.length < 6) return;
    verifying.current = true;
    return run(async () => {
      try {
        const { data, error } = await client.auth.verifyOtp({ email, token: token.trim(), type: codeType });
        if (error) {
          setCode('');
          setAttempt((a) => a + 1);
          throw error;
        }
        // A sign-up code, or a sign-in code that created the account, counts as a registration.
        if (data.user) noteSignIn(data.user);
        if (codeType === 'recovery') {
          setPassword('');
          setStep('reset');
          return;
        }
        if (codeType === 'signup') {
          setStep('verified');
          setTimeout(() => router.replace(next), VERIFIED_REDIRECT_MS);
          return;
        }
        router.replace(next);
      } finally {
        verifying.current = false;
      }
    });
  };

  const setNewPassword = () =>
    run(async () => {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      router.replace(next);
    });

  const backButton = (to: Step) => (
    <button type="button" onClick={() => goTo(to)} className="btn btn-ghost -ml-3 mb-6 !px-3">
      <ArrowLeft size={16} /> Back
    </button>
  );

  if (checkingSession) return <Spinner className="text-muted" />;

  const codeHeading = {
    email: 'Check your email',
    signup: 'Confirm your email',
    recovery: 'Reset your password',
  }[codeType as 'email' | 'signup' | 'recovery'];

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

      {step === 'password' && (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-muted">
            {signup ? `Get ${FREE_MINUTES} free minutes in the desktop app. No card required.` : `Sign in to continue to ${company.brand}.`}
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword();
            }}
          >
            {signup && <NameInput value={name} onChange={setName} autoFocus />}
            <EmailInput value={email} onChange={setEmail} autoFocus={!signup} />
            <div>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={signup ? 'new-password' : 'current-password'}
                placeholder={signup ? `Password (${MIN_PASSWORD_LENGTH}+ characters)` : 'Password'}
              />
              {signup && (
                <div className="mt-4">
                  <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                  />
                </div>
              )}
              {!signup && (
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => goTo('forgot')}
                    className="text-sm text-muted transition hover:text-fg"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
            <button disabled={busy} className="btn btn-primary w-full py-3">
              {busy ? <Spinner /> : <>{signup ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></>}
            </button>
          </form>

          <button
            type="button"
            onClick={() => goTo('email')}
            className="mt-4 w-full text-center text-sm text-muted transition hover:text-fg"
          >
            Email me a one-time code instead
          </button>

          <p className="mt-8 text-center text-sm text-muted">
            {signup ? 'Already have an account? ' : "Don't have an account? "}
            <Link href={`${signup ? '/login' : '/signup'}${query}`} className="font-medium text-brand hover:underline">
              {signup ? 'Sign in' : 'Sign up'}
            </Link>
          </p>
        </>
      )}

      {(step === 'email' || step === 'forgot') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 'forgot') sendResetCode();
            else sendSignInCode();
          }}
        >
          {backButton('password')}
          <h1 className="text-3xl font-semibold tracking-tight">
            {step === 'forgot' ? 'Forgot your password?' : 'Sign in with a code'}
          </h1>
          <p className="mt-2 text-muted">
            {step === 'forgot'
              ? "Enter your email and we'll send a code to set a new password."
              : "We'll email you a 6-digit code. No password needed."}
          </p>
          <div className="mt-8 space-y-4">
            <EmailInput value={email} onChange={setEmail} autoFocus />
            <button disabled={busy} className="btn btn-primary w-full py-3">
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
          {backButton(codeType === 'recovery' ? 'forgot' : codeType === 'email' ? 'email' : 'password')}
          <h1 className="text-3xl font-semibold tracking-tight">{codeHeading}</h1>
          <p className="mt-2 text-muted">
            We sent a 6-digit code to <span className="font-medium text-fg">{email}</span>
          </p>
          <div className="mt-8">
            <OtpInput key={attempt} value={code} onChange={setCode} onComplete={verifyCode} disabled={busy} />
          </div>
          <button disabled={busy || code.length < 6} className="btn btn-primary mt-6 w-full py-3">
            {busy ? <Spinner /> : codeType === 'recovery' ? 'Verify code' : 'Verify and continue'}
          </button>
          <p className="mt-5 text-center text-sm text-muted">
            Didn't get it? Check spam, or{' '}
            {resendIn > 0 ? (
              <span className="text-faint">resend in {resendIn}s</span>
            ) : (
              <button type="button" onClick={resendCode} disabled={busy} className="font-medium text-brand hover:underline">
                send a new code
              </button>
            )}
          </p>
        </form>
      )}

      {step === 'verified' && (
        <div role="status" className="flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-full bg-brand/15 text-brand">
            <CircleCheck size={28} />
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Email verified</h1>
          <p className="mt-2 text-muted">
            Your account is ready. Taking you to {desktop ? 'the app' : 'your dashboard'}…
          </p>
          <Spinner className="mt-6 text-brand" />
        </div>
      )}

      {step === 'reset' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setNewPassword();
          }}
        >
          <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-2 text-muted">
            For <span className="font-medium text-fg">{email}</span>
          </p>
          <div className="mt-8 space-y-4">
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
              autoFocus
            />
            <button disabled={busy} className="btn btn-primary w-full py-3">
              {busy ? <Spinner /> : 'Save password and continue'}
            </button>
          </div>
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
        By continuing you agree to the{' '}
        <Link href="/terms" className="underline hover:text-muted">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline hover:text-muted">
          Privacy Policy
        </Link>
        .
      </p>
      {captcha.element}
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

/** Full-page layout shared by /login and /signup. */
export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-12">{children}</div>
      </div>
      <BrandPanel />
    </main>
  );
}
