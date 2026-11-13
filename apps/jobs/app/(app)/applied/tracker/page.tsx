import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'Interview tracker', robots: { index: false } };

// The jobs the candidate marked applied, with their interview/offer/rejection status.
export default function Page() {
  return <FeedView view="applied" />;
}
