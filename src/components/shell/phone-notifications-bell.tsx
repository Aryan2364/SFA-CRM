'use client'

import Link from 'next/link'
import { BellIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useNotificationsState } from '@/lib/phone-notifications'
import { useInterceptLeave } from './phone-leave-guard'

/**
 * Phone foundation - FRONTEND_RULES_PHONE.md 41.12 rule 1: the phone's way
 * into its notifications is the bell in the app bar of every tab screen,
 * with the unread count on it, opening the Notifications screen
 * (/notifications). The shell draws it after the screen's own actions, so a
 * screen that puts an action in the bar (Activity's attendance) keeps it
 * and the bell sits beside it.
 *
 * The count is the shared list's (lib/phone-notifications.ts), so marking
 * a row read on the Notifications screen changes the bell at once. White
 * on the primary bar, since a primary badge would vanish into it.
 */
export function PhoneNotificationsBell() {
  const { unread } = useNotificationsState()
  const intercept = useInterceptLeave()
  const count = unread > 99 ? '99+' : unread > 0 ? String(unread) : null
  return (
    <Link
      href="/notifications"
      onClick={event => {
        // A form with unsaved changes asks before the screen opens.
        if (intercept('/notifications')) event.preventDefault()
      }}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
    >
      <BellIcon aria-hidden className="size-[22px]" />
      {count !== null ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-1 right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface text-[12px] font-medium leading-none text-primary tabular-nums',
            count.length > 1 && 'px-[5px]'
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}
