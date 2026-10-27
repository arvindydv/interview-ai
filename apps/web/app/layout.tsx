import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { themeBootScript } from '@/lib/themeScript';

export const metadata: Metadata = {
  title: 'Friday AI: Real-Time AI Interview Assistant',
  description: 'Live answers during interviews, one-hotkey coding solutions and AI mock interviews.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by themeBootScript, so React's value may differ on hydration.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
