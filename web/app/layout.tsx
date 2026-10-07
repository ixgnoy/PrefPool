import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Parkinsans, Pixelify_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { Header } from '@/components/Header';
import { DevStrip } from '@/components/DevTrace';
import { WebAgentRunner } from '@/components/WebAgentRunner';
import { StillSea } from '@/components/StillSea';

const pixel = Pixelify_Sans({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-pixelify' });
const ui = Parkinsans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-ui', adjustFontFallback: false }); // Next has no fallback metrics for it
// Departure Mono (OFL, app/fonts/DepartureMono-LICENSE.txt): pixel-grid mono for every number and address.
const mono = localFont({ src: './fonts/DepartureMono-Regular.woff2', variable: '--font-num', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'PrefPool', template: '%s · PrefPool' },
  description: 'Your agent answers. You get paid.',
};

const THEME_SCRIPT = `try{if(JSON.parse(localStorage.getItem('cf.theme'))==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${pixel.variable} ${ui.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <StoreProvider>
          <StillSea />
          <Header />
          <DevStrip />
          <WebAgentRunner />
          <main className="mx-auto w-full max-w-[clamp(1280px,90vw,2200px)] px-4 pb-28 pt-6 sm:px-8 sm:pt-8">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
