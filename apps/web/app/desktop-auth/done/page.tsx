import { CheckCircle2, XCircle } from 'lucide-react';
import { LogoMark } from '@/components/Logo';

// Where the desktop app's loopback listener sends the browser after desktop sign-in, so the tab
// ends on this site instead of a 127.0.0.1 URL.
export default async function DesktopAuthDonePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const failed = (await searchParams).error === 'expired';
  return (
    <main className="relative grid min-h-screen place-items-center px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid" />
      <div className="glass w-full max-w-md animate-fade-up rounded-3xl p-10 text-center">
        {failed ? (
          <>
            <XCircle className="mx-auto text-danger" size={44} />
            <h1 className="mt-5 text-xl font-semibold">This sign-in link has expired</h1>
            <p className="mt-2 text-sm text-muted">Click Sign in in the Friday AI app to start again.</p>
          </>
        ) : (
          <>
            <div className="relative mx-auto w-fit">
              <div className="absolute -inset-6 glow" />
              <LogoMark size={56} />
            </div>
            <h1 className="mt-6 text-xl font-semibold">You're signed in to Friday AI</h1>
            <p className="mt-2 text-sm text-muted">
              <CheckCircle2 size={14} className="mr-1 inline text-brand" />
              You can close this tab and go back to the app.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
