import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'Applied', robots: { index: false } };

export default function Page() {
  return <FeedView view="applied" />;
}
