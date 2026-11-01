import { privateMetadata } from '@/lib/site';

export const metadata = privateMetadata('Partner dashboard');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
