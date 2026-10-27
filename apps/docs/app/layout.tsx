import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { appName } from '@/lib/site';
import './global.css';

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: 'Docs and progress for bike-3d-brew: iPhone bike captures as annotated 3D models in the browser.',
  // The repo is private; the site is public but not meant to be found.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
