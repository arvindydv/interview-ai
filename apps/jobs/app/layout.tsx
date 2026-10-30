import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3300';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Friday Jobs', template: '%s | Friday Jobs' },
  description: 'Find your next role with Friday Jobs, from the team behind Friday AI.',
  applicationName: 'Friday Jobs',
};

export const viewport: Viewport = { themeColor: '#f6f7f9' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
