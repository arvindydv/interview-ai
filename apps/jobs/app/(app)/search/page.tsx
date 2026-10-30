import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'All jobs', robots: { index: false } };

export default function Page() {
  return <FeedView view="all" />;
}
