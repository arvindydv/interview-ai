import { privateMetadata } from '@/lib/site';

export const metadata = privateMetadata('History');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
