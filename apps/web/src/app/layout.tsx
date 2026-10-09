import type { Metadata, Viewport } from 'next';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/300-italic.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/barlow/300.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './globals.css';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = { title: { default: 'HAAB Training Management Platform', template: '%s | HAAB Training' }, description: 'HAAB Aviation Consultancy Services training management.', robots: { index: false, follow: false }, icons: { icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/icons/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'HAAB Training', statusBarStyle: 'black-translucent' }, formatDetection: { telephone: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0a0c0f' };

// Applies the saved theme before first paint so there is no flash of the wrong one.
const themeScript = `try{var t=localStorage.getItem('haab-theme');if(t==='day'||t==='night')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
