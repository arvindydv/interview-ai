import { privateMetadata } from '@/lib/site';

export const metadata = privateMetadata('Signing in');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
