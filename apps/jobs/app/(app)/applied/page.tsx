import type { Metadata } from 'next';
import { AppliedDashboard } from '@/components/AppliedDashboard';

export const metadata: Metadata = { title: 'Applied jobs', robots: { index: false } };

export default function Page() {
  return <AppliedDashboard />;
}
