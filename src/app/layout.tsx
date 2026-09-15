import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from '@/contexts/ToastContext'

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
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
