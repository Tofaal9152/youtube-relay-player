import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nightfury Stream — Your screen. Your player.',
  description: 'A self-hosted video player with adaptive quality controls and an on-demand streaming relay.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
