import { FREE_MINUTES } from '@parakeet/shared';
import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'Sign up free: try the AI interview assistant',
  description: `Create your free Friday AI account and get ${FREE_MINUTES} free minutes of real-time interview help. No card needed. Windows, macOS and Linux.`,
  path: '/signup',
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
