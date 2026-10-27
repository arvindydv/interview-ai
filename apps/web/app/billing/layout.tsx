import { privateMetadata } from '@/lib/site';

export const metadata = privateMetadata('Plans & billing');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
