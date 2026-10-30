import Link from 'next/link';
import { AuthButtons } from './AuthButtons';
import { Logo } from './Logo';

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Link href="/" aria-label="Friday Jobs home">
          <Logo />
        </Link>
        <AuthButtons />
      </div>
    </header>
  );
}
