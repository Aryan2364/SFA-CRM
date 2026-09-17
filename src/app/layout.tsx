import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { ToastProvider } from '@/contexts/ToastContext'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export const metadata: Metadata = {
  title: 'RGB SFA Admin',
  description: 'RGB Software SFA Admin Panel',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    other: [
      { rel: 'manifest', url: '/site.webmanifest' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-surface-sunken text-text-primary antialiased">
        {/* Section 19: tooltips open after ~400ms on hover and immediately on
            keyboard focus. Base UI needs the provider above every Tooltip, so
            it sits at the root rather than per screen.
            ToastProvider is this product's existing toast system; Toaster is
            the kit's section 25 one. Both are mounted while the screens still
            use the old one - the toast consolidation is screen-phase work. */}
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  )
}
