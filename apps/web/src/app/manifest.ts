import type { MetadataRoute } from 'next';

/** Lets people install the platform on a phone's home screen. It then opens full screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HAAB Training Platform',
    short_name: 'HAAB Training',
    description: 'Training management for HAAB Aviation Consultancy Services.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0c0f',
    theme_color: '#0a0c0f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
