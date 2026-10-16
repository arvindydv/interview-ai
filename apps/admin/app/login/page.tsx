'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { getSession, login } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getSession()) router.replace('/');
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div className="absolute inset-0 -z-10 bg-grid" />
      <div className="absolute top-1/4 left-1/2 -z-10 size-[520px] -translate-x-1/2 glow" />
      <form onSubmit={submit} className="glass w-full max-w-sm rounded-[var(--radius-card)] p-7 animate-fade-up">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">Admin sign-in</h1>
        <p className="mt-1 text-sm text-muted">Use the credentials set in the API&apos;s environment.</p>

        <label className="mt-6 block text-xs font-medium text-muted" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" autoComplete="username" required className="input mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label className="mt-4 block text-xs font-medium text-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="input mt-1.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={busy} className="btn btn-primary mt-6 w-full">
          {busy ? <Spinner /> : <Lock size={15} />} Sign in
        </button>
      </form>
    </div>
  );
}
