/**
 * Phone foundation (FRONTEND_RULES_PHONE.md §41.2 rule 2).
 *
 * The names src/lib/layout.ts (the browser) and src/lib/layout.server.ts
 * (the server's first guess) must agree on, written once. No "use client"
 * here on purpose: a "use client" module's exports reach a server module as
 * a client reference rather than the value itself, which would break the
 * server guess reading the cookie name.
 */

export type Layout = 'phone' | 'desktop'

/** §9, by viewport width: >=1280, 1024-1279, 768-1023, <768. */
export type WidthBand = 'desktop' | 'laptop' | 'tablet' | 'narrow'

/** The cookie the server reads before any hint (§41.2 rule 3). */
export const LAYOUT_COOKIE = 'layout'

/** §41.2 rule 1: a touch-first screen whose shorter side is under this is a phone. */
export const PHONE_SHORT_SIDE = 600
