import { cookies, headers } from 'next/headers'

import { LAYOUT_COOKIE, type Layout } from './layout-shared'

/**
 * The server's first guess at the layout (FRONTEND_RULES_PHONE.md §41.2
 * rule 3), so the first paint already carries data-layout and the phone
 * token values apply from the start. The browser confirms once on load and,
 * if the guess was wrong, corrects data-layout and saves the measured
 * answer in the `layout` cookie — from then on this function reads that
 * cookie first and guesses right.
 *
 * The guess itself, absent a saved cookie, reads the two hints a server can
 * see: the Sec-CH-UA-Mobile client hint (Chromium), and the user-agent
 * string where the browser sends no hint (Safari sends neither header
 * reliably on every route, so the UA fallback matters).
 */
export async function getInitialLayout(): Promise<Layout> {
  const cookieStore = await cookies()
  const saved = cookieStore.get(LAYOUT_COOKIE)?.value
  if (saved === 'phone' || saved === 'desktop') return saved

  const headerStore = await headers()
  const mobileHint = headerStore.get('sec-ch-ua-mobile')
  if (mobileHint === '?1') return 'phone'
  if (mobileHint === '?0') return 'desktop'

  const ua = headerStore.get('user-agent') ?? ''
  // A tablet's UA also matches /Mobi/ on some devices, but the measured
  // correction on load (§41.2 rule 3) fixes a wrong guess once; this is
  // only ever the FIRST paint.
  const looksLikePhone = /iPhone|Android.*Mobile|Mobi|Windows Phone/i.test(ua)
  return looksLikePhone ? 'phone' : 'desktop'
}
