import type { Metadata } from 'next'

import { OfflineScreen } from './offline-screen'

/**
 * The offline screen - section 41.14 rules 9 and 10.
 *
 * public/sw.js caches this page when it installs and answers a navigation
 * with it when there is no connection, so the installed app opens offline
 * to this and never to the browser's error page. Prerendered once at build
 * time (force-static): nothing about the signed-in person is in it, and
 * its HTML changes exactly when a release is built, which is how
 * lib/service-worker.ts names releases.
 *
 * PORT NOTE: the kit builds this from connection-banner.tsx's
 * OfflineScreen, which sfacrm's simplified connection banner does not have;
 * offline-screen.tsx is the same screen (app bar with the product name,
 * the offline banner, "Try again").
 */
export const dynamic = 'force-static'

export const metadata: Metadata = { title: 'You are offline' }

export default function OfflinePage() {
  return <OfflineScreen />
}
