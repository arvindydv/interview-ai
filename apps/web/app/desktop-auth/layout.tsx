import { privateMetadata } from '@/lib/site';

export const metadata = privateMetadata('Sign in to the desktop app');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
