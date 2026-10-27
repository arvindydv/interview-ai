import Link from 'next/link';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { NavBar } from '@/components/landing/motion';
import { SiteFooter } from '@/components/landing/sections';

export default function NotFound() {
  return (
    <div className="landing relative overflow-x-clip">
      <div className="grain" aria-hidden />
      <NavBar />

      <main className="relative isolate pt-40 pb-24 sm:pt-48">
        <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-xl px-4 text-center sm:px-6">
          <p className="text-gradient text-7xl font-bold tracking-[-0.05em]">404</p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">This page doesn't exist</h1>
          <p className="mt-3 text-muted">The link may be old or mistyped. Here are some places to go instead.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn btn-primary">
              <ArrowLeft size={16} /> Back to home
            </Link>
            <Link href="/contact" className="btn btn-secondary">
              <LifeBuoy size={16} /> Get help
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
