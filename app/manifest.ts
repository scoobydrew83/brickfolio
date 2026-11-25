import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/brand';

// Lets the dashboard be added to a phone's home screen and open without browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#e3eaf0', // --canvas, the page background (app/globals.css)
    theme_color: '#14212b', // --header, as viewport.themeColor in app/layout.tsx
    icons: [{ src: '/apple-icon', sizes: '180x180', type: 'image/png' }],
    // Long-press the home-screen icon to open the scanner straight away (it also works offline once opened).
    shortcuts: [{ name: 'Scan barcodes', short_name: 'Scan', url: '/scan', icons: [{ src: '/apple-icon', sizes: '180x180', type: 'image/png' }] }],
  };
}
