import { Briefcase } from 'lucide-react';
import { Logo } from '@/components/Logo';

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="glow pointer-events-none absolute inset-0" aria-hidden />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
      </header>
      <main className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pt-24 pb-32 text-center">
        <span className="eyebrow inline-flex items-center gap-1.5">
          <Briefcase size={14} /> Coming soon
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your next role, <span className="text-gradient">found faster</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Friday Jobs is the job board from the team behind Friday AI. Listings are on their way.
        </p>
      </main>
    </div>
  );
}
