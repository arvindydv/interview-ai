import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'Recommended', robots: { index: false } };

export default function Page() {
  return <FeedView view="recommended" />;
}
