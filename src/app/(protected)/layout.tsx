'use client'

import { useState } from 'react'
import Sidebar from '@/components/ui/Sidebar'
import Header from '@/components/ui/Header'
import { useMe } from '@/hooks/useMe'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const me = useMe()

  // Show "define role" screen for users with no role assigned yet
  if (me !== null && me.role === 'NoRole') {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-sunken px-4">
        <div className="max-w-sm w-full text-center">
          <div className="bg-surface rounded-2xl border border-border-light shadow-sm p-8">
            <div className="w-14 h-14 bg-warning-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-2">Role Not Configured</h2>
            <p className="text-sm text-text-muted mb-6 leading-relaxed">
              Your account does not have a role assigned yet. Please contact your administrator to configure your access.
            </p>
            <a
              href="/api/auth/logout"
              className="inline-block w-full bg-gray-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Sign Out
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-sunken">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-(--backdrop) md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
