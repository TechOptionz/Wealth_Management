import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import { APP_NAME, APP_TAGLINE } from '@/shared/config/app-config';
import '@/styles/globals.css';

/**
 * IBM Plex Sans in the weights the design uses: 400 body, 500 labels,
 * 600 headings and figures, plus 400 italic.
 */
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-ibm-plex-sans',
});

export const metadata: Metadata = {
  title: `${APP_NAME} — Wealth & Property Platform`,
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinned to dark after analytica.live, which ships dark only. To follow the OS
  // theme again, set 'light dark' here and drop `data-theme` from <html> below.
  colorScheme: 'dark',
  themeColor: '#08090a',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={ibmPlexSans.variable}>
      <body>{children}</body>
    </html>
  );
}
