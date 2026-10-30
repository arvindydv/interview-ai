import type { Metadata } from 'next';
import { FeedView } from '@/components/FeedView';

export const metadata: Metadata = { title: 'Remote jobs', robots: { index: false } };

export default function Page() {
  return (
    <FeedView
      view="all"
      preset={{
        filters: { workplace: ['remote'] },
        title: 'Remote jobs',
        subtitle: 'Work from anywhere: remote roles open to India and worldwide, with your match where there is one.',
      }}
    />
  );
}
