'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import {
  markAllNotificationsRead,
  refreshNotifications,
  setNotificationRead,
  useNotificationsState,
} from '@/lib/phone-notifications'
import { saveSubscription, turnOffThisPhone, useSubscribed } from '@/lib/push-device'
import { toast } from '@/components/ui/sonner'
import { NotificationsPage, type Notification } from '@/components/templates/notifications-page'
import { PhoneNotificationsSetting } from '@/components/ui/notification-permission-sheet'

/** The anchor More's "Phone notifications" row opens: the on/off block at the foot. */
const SETTING_ID = 'phone-notifications'

/**
 * Phone Notifications - FRONTEND_RULES_PHONE.md 41.12 rules 1 and 6: the
 * list behind the app bar's bell (newest first; tap a row to mark it read
 * and open what it is about; swipe or tap the dot to mark read or unread;
 * "Mark all as read" in the bar's menu), with the phone on/off setting at
 * its foot (rules 2 to 5): ask at a useful moment, never on first open;
 * installing first on iPhone; how to allow them after a no.
 *
 * Phone only. On a computer the bell panel in the top bar is the way in
 * (7.4), so this address returns to the home screen, as /more does.
 */
export default function NotificationsRoute() {
  const { layout } = useLayout()
  const router = useRouter()
  const me = useMe()
  const person = me?.userId
  const { status, items, unread } = useNotificationsState()
  const subscribed = useSubscribed()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (layout === 'desktop') router.replace('/')
  }, [layout, router])

  // Opening the screen is a fresh look (the shell's own refresh is throttled).
  useEffect(() => {
    if (person) void refreshNotifications(person, true)
  }, [person])

  // From More: land on the on/off block, not at the top of a long list.
  useEffect(() => {
    if (status !== 'ready' || window.location.hash !== `#${SETTING_ID}`) return
    document.getElementById(SETTING_ID)?.scrollIntoView({ block: 'end' })
  }, [status, person])

  const notifications = useMemo<Notification[]>(() => {
    const needle = query.trim().toLowerCase()
    return items
      .filter(item => needle === '' || item.message.toLowerCase().includes(needle))
      .map(item => ({
        id: item.id,
        text: item.message,
        at: new Date(item.created_at),
        read: item.is_read,
        href: item.redirect_path,
      }))
  }, [items, query])

  const retry = useCallback(() => {
    if (person) void refreshNotifications(person, true)
  }, [person])
  const refresh = useCallback(async () => {
    if (person) await refreshNotifications(person, true)
  }, [person])

  const changeRead = useCallback((id: string, isRead: boolean) => {
    setNotificationRead(id, isRead).catch(() =>
      toast.error(`Could not mark it as ${isRead ? 'read' : 'unread'}. Check your connection and try again.`)
    )
  }, [])
  const onRead = useCallback((id: string) => changeRead(id, true), [changeRead])
  const onUnread = useCallback((id: string) => changeRead(id, false), [changeRead])
  const onMarkAllRead = useCallback(() => {
    markAllNotificationsRead().catch(() =>
      toast.error('Could not mark them all as read. Check your connection and try again.')
    )
  }, [])

  if (layout === 'desktop') return null

  return (
    <>
      <NotificationsPage
        state={status}
        onRetry={retry}
        notifications={notifications}
        total={notifications.length}
        unread={unread}
        search={{ value: query, onChange: setQuery }}
        onRead={onRead}
        onUnread={onUnread}
        onMarkAllRead={onMarkAllRead}
        onRefresh={refresh}
        parent="/more"
      />
      {person ? (
        <div id={SETTING_ID} className="mt-6 scroll-mb-4">
          <PhoneNotificationsSetting
            person={person}
            installHref="/more"
            subscribed={subscribed}
            onSubscribe={subscription => saveSubscription(person, subscription)}
            onTurnOff={() => turnOffThisPhone(person)}
          />
        </div>
      ) : null}
    </>
  )
}
