import type { MetadataRoute } from 'next'

import { APP_NAME, APP_SHORT_NAME, INSTALL_COLOURS } from '@/lib/install-settings'

/**
 * The installable PWA manifest (FRONTEND_RULES_PHONE.md §41.12 rules 7-9).
 * Served at /manifest.webmanifest by Next's app/manifest.ts convention,
 * replacing the stale static public/site.webmanifest (empty icons, the
 * kit's old teal theme colour).
 *
 * Icons reuse the app's existing 192/512 PNGs (public/android-chrome-*),
 * which are already drawn at the right pixel sizes — no new asset
 * generation needed. The "maskable" purpose reuses the same 512 icon: it
 * is not redrawn with safe-area padding, which is a real gap against
 * §41.12 rule 9 (see report).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: 'RGB Software SFA Admin Panel',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: INSTALL_COLOURS.background,
    theme_color: INSTALL_COLOURS.theme,
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
