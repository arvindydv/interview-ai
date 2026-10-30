import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'Top matches', robots: { index: false } };

export default function Page() {
  return <FeedView view="top" />;
}
