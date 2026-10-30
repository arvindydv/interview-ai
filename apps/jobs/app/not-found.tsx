import Link from 'next/link';
import { Header } from '@/components/Header';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main className="mx-auto max-w-xl px-4 pt-28 text-center sm:px-6">
        <p className="text-sm font-semibold text-brand">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page isn&rsquo;t here</h1>
        <p className="mt-3 text-muted">If it was a job, it may have been filled and taken down by the company.</p>
        <Link href="/" className="btn btn-primary mt-8">
          Back to Friday Jobs
        </Link>
      </main>
    </div>
  );
}
