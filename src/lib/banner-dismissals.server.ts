import { cookies } from "next/headers"

import { BANNER_DISMISS_COOKIE, decodeBannerDismissals, type BannerDismissals } from "@/lib/banner-dismissals-shared"

/*
 * Server only: next/headers throws if this is ever reached from a
 * client component, which is the guard ("server-only" is not installed,
 * and section 1 rule 10 forbids adding it unasked). Same shape as
 * lib/layout.server.ts's getInitialLayout.
 */

/**
 * The server's first read of every closed banner, for the root layout
 * to hand to BannerDismissalsProvider (components/ui/banner.tsx), so a
 * closed banner is simply absent from the server's own HTML and an open
 * one is already there - neither flashes nor shifts anything below it
 * (section 14 rule 1, 26.4 rule 1).
 */
async function getInitialBannerDismissals(): Promise<BannerDismissals> {
  const raw = (await cookies()).get(BANNER_DISMISS_COOKIE)?.value
  return decodeBannerDismissals(raw)
}

export { getInitialBannerDismissals }
