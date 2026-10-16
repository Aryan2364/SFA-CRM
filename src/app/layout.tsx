import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { ToastProvider } from '@/contexts/ToastContext'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getInitialLayout } from '@/lib/layout.server'
import { LayoutProvider } from '@/lib/layout'
import { APP_NAME, IPHONE_STATUS_BAR } from '@/lib/install-settings'

/**
 * Phone foundation: §41.12 rule 8 — the install tags (the manifest link,
 * theme-color, the iPhone web-app tags) are sent only when the server
 * guesses phone. generateMetadata() (not the static `metadata` export)
 * is what lets this depend on the per-request guess.
 */
export async function generateMetadata(): Promise<Metadata> {
  const layout = await getInitialLayout()
  const phone = layout === 'phone'

  return {
    title: 'RGB SFA Admin',
    description: 'RGB Software SFA Admin Panel',
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    },
    ...(phone
      ? {
          manifest: '/manifest.webmanifest',
          appleWebApp: {
            capable: true,
            title: APP_NAME,
            statusBarStyle: IPHONE_STATUS_BAR,
          },
        }
      : {}),
  }
}

export async function generateViewport() {
  const layout = await getInitialLayout()
  const phone = layout === 'phone'
  return phone
    ? {
        width: 'device-width',
        initialScale: 1,
        // §41.13 rule 1: the viewport covers the whole screen so the safe-area
        // insets are available; §41.9 rule 7: zooming is never blocked.
        viewportFit: 'cover' as const,
        // §41.13 rule 6: Android shrinks the layout viewport for the keyboard.
        interactiveWidget: 'resizes-content' as const,
      }
    : { width: 'device-width', initialScale: 1 }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initial = await getInitialLayout()

  return (
    <html lang="en" data-layout={initial} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-surface-sunken text-text-primary antialiased">
        {/* Section 19: tooltips open after ~400ms on hover and immediately on
            keyboard focus. Base UI needs the provider above every Tooltip, so
            it sits at the root rather than per screen.
            ToastProvider is this product's existing toast system; Toaster is
            the kit's section 25 one. Both are mounted while the screens still
            use the old one - the toast consolidation is screen-phase work. */}
        <LayoutProvider initial={initial}>
          <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
          <Toaster />
        </LayoutProvider>
      </body>
    </html>
  )
}
