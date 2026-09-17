'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Notification = {
  id: string
  message: string
  section: string
  redirect_path: string
  is_read: boolean
  created_at: string
  actor: { name: string } | null
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const SECTION_COLORS: Record<string, string> = {
  weekly_plan: 'bg-purple-100 text-purple-700',
  meeting: 'bg-blue-100 text-blue-700',
  expense: 'bg-orange-100 text-orange-700',
}

interface HeaderProps { onToggleSidebar: () => void }

export default function Header({ onToggleSidebar }: HeaderProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadNotifications = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (r.ok) setNotifications(await r.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadNotifications()
    // Poll every 60s
    const interval = setInterval(loadNotifications, 60000)
    // Also reload on window focus
    const onFocus = () => loadNotifications()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus) }
  }, [loadNotifications])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showDropdown])

  const unreadCount = notifications.filter(n => !n.is_read).length

  async function markRead(notif: Notification) {
    if (!notif.is_read) {
      await fetch(`/api/notifications/${notif.id}`, { method: 'PATCH' })
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
    }
    setShowDropdown(false)
    router.push(notif.redirect_path)
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  return (
    <header className="h-14 bg-surface border-b border-border-light flex items-center justify-between px-4 shrink-0">
      <button onClick={onToggleSidebar} className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
      </button>

      {/* Notification bell */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(v => !v)}
          className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition relative"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <div className="absolute right-0 top-full mt-1 w-80 bg-surface rounded-2xl border border-border-light shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
              <h3 className="text-sm font-medium text-text-primary">Notifications</h3>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline font-medium">
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">No notifications</div>
              ) : (
                notifications.map(notif => (
                  <button
                    key={notif.id}
                    onClick={() => markRead(notif)}
                    className={`w-full text-left px-4 py-3 border-b border-border-light hover:bg-surface-sunken transition ${!notif.is_read ? 'bg-primary-subtle/40' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {!notif.is_read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      )}
                      <div className={`flex-1 min-w-0 ${notif.is_read ? 'pl-3.5' : ''}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full ${SECTION_COLORS[notif.section] ?? 'bg-surface-control text-text-secondary'}`}>
                            {notif.section.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] text-text-muted ml-auto">{formatRelative(notif.created_at)}</span>
                        </div>
                        <p className="text-xs text-text-secondary line-clamp-2">{notif.message}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div className="px-4 py-2 border-t border-border-light text-center">
                <button onClick={() => { setShowDropdown(false); router.push('/conversations') }}
                  className="text-xs text-primary hover:underline font-medium">
                  View all conversations
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
