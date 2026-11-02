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
    background_color: '#fafafa', // zinc-50, the page background
    theme_color: '#fbbf24', // amber-400, the brick badge
    icons: [{ src: '/apple-icon', sizes: '180x180', type: 'image/png' }],
  };
}
