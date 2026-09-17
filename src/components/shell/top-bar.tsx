'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BellIcon,
  LogOutIcon,
  PanelLeftIcon,
  SearchIcon,
  TrophyIcon,
  UserIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidateMeCache, useMe } from '@/hooks/useMe'

/**
 * Section 12.2. Four things and nothing else:
 *
 *   1. the sidebar toggle, at the far left
 *   2. global search
 *   3. the notification bell, with an unread dot in primary
 *   4. the user menu
 *
 * "Page actions belong in the page header, not here. Every extra control
 * in the top bar appears on every screen whether relevant or not."
 *
 * It spans the CONTENT area rather than the window, so it sits inside
 * the content column with the sidebar beside it, not above it.
 *
 * ---------------------------------------------------------------------
 * A TOOLTIP ON A MENU TRIGGER, and why it is wrapped the way it is
 *
 * Section 6.3 wants a tooltip on every icon-only button, and both menu
 * buttons here are icon-only. The obvious composition -
 *
 *   <TooltipTrigger render={<DropdownMenuTrigger render={<Button/>}/>}>
 *
 * - compiles, mounts, and is broken. Section 4.2: Base UI clones the
 * `render` element with a ref, `DropdownMenuTrigger` is a plain function
 * component with no `forwardRef`, and on React 18 a function component
 * never receives one. The ref resolves to null, the tooltip has no
 * anchor, and Base UI's positioner pins it at top:0 left:0 opacity:0
 * while reporting that it is open. Nothing errors and nothing looks
 * wrong until you hover.
 *
 * Measured here: React logs "Function components cannot be given refs.
 * Check the render method of `TooltipTrigger`".
 *
 * So the tooltip anchors to a real `span` instead. A host element always
 * takes a ref, on either React. The menu keeps its own ref on `Button`,
 * which does carry `forwardRef`, so both resolve and neither component
 * in `components/ui` has to change for the shell's sake.
 */

type Notification = {
  id: string
  message: string
  section: string
  redirect_path: string
  is_read: boolean
  created_at: string
}

/*
 * Section 18 allows relative time in notifications and activity feeds,
 * and nowhere else.
 */
function formatRelative(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

type TopBarProps = {
  onToggleSidebar: () => void
  /** Section 23.2: the label carries the action, the icon never moves. */
  toggleLabel: string
  /**
   * Handed in by whatever owns the search results. Until a search screen
   * exists there is nothing to hand in, and the field says so rather
   * than accepting a query it will silently drop.
   */
  onSearch?: (query: string) => void
}

export function TopBar({ onToggleSidebar, toggleLabel, onSearch }: TopBarProps) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border-light bg-surface px-4">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" onClick={onToggleSidebar} />
          }
        >
          <PanelLeftIcon className="size-icon-nav" />
          <span className="sr-only">{toggleLabel}</span>
        </TooltipTrigger>
        <TooltipContent>{toggleLabel}</TooltipContent>
      </Tooltip>

      <GlobalSearch onSearch={onSearch} />

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}

function GlobalSearch({ onSearch }: { onSearch?: (query: string) => void }) {
  const [query, setQuery] = useState('')

  const field = (
    <InputGroup className="w-search max-w-full">
      <InputGroupAddon>
        <SearchIcon className="size-icon" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label="Search"
        placeholder="Search"
        value={query}
        disabled={!onSearch}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && query.trim()) onSearch?.(query.trim())
        }}
      />
    </InputGroup>
  )

  /*
   * A disabled field carries pointer-events-none and can never open a
   * tooltip of its own, which is section 26's mechanic and the reason
   * `PermissionTooltip` exists. The reason here is not a permission, but
   * the shape is identical - a control the user can see, cannot use, and
   * is owed an explanation for - and section 1 rule 3 says to use the
   * component that already does the job rather than write a second one.
   */
  return (
    <PermissionTooltip
      allowed={Boolean(onSearch)}
      reason="Global search arrives with the search screen."
    >
      {field}
    </PermissionTooltip>
  )
}

function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])

  /*
   * Section 14 rule 4: fetch has no timeout of its own, so a stalled
   * request never settles. Without a deadline the poll below would leak
   * a pending request every minute for as long as the tab is open.
   */
  const load = useCallback(async () => {
    const abort = new AbortController()
    const deadline = setTimeout(() => abort.abort(), 10000)
    try {
      const response = await fetch('/api/notifications', {
        signal: abort.signal,
      })
      if (response.ok) setNotifications(await response.json())
    } catch {
      /* The bell keeps whatever it last knew. Section 25: a
         notification is never only in the bell. */
    } finally {
      clearTimeout(deadline)
    }
  }, [])

  useEffect(() => {
    load()
    const poll = setInterval(load, 60000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const unread = notifications.filter(item => !item.is_read).length

  async function open(notification: Notification) {
    if (!notification.is_read) {
      await fetch(`/api/notifications/${notification.id}`, { method: 'PATCH' })
      setNotifications(current =>
        current.map(item =>
          item.id === notification.id ? { ...item, is_read: true } : item
        )
      )
    }
    router.push(notification.redirect_path)
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications(current => current.map(item => ({ ...item, is_read: true })))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<span className="relative inline-flex" />}>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" />}
          >
            <BellIcon className="size-icon-nav" />
            <span className="sr-only">
              {unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            </span>
          </DropdownMenuTrigger>
          {/*
            Section 12.2 asks for an unread DOT in primary, not a count.
            The count is in the screen-reader label above and in the menu
            itself; a number small enough to fit on a 36px button is a
            number nobody reads.
          */}
          {unread > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-primary"
            />
          )}
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-search">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-center text-body text-text-muted">
              Nothing to catch up on.
            </p>
          ) : (
            notifications.map(notification => (
              <DropdownMenuItem
                key={notification.id}
                onClick={() => open(notification)}
                className="h-auto items-start gap-2 py-2"
              >
                {/*
                  Section 7.3: a notification is neutral. The brand
                  colour is the unread dot and nothing else, and a status
                  colour appears only when the item itself is genuinely a
                  success or a failure.

                  A read row keeps the same empty box, so every line of
                  text below sits on one left edge instead of shifting by
                  8px the moment an item is opened.
                */}
                <span
                  aria-hidden
                  className={cn(
                    'mt-2 size-2 shrink-0 rounded-full',
                    !notification.is_read && 'bg-primary'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-body text-text-primary">
                    {notification.message}
                  </span>
                  <span className="mt-1 block text-meta text-text-muted">
                    {notification.section.replace(/_/g, ' ')} ·{' '}
                    {formatRelative(notification.created_at)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        {unread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={markAllRead}>
              Mark all as read
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const router = useRouter()
  const me = useMe()
  const signingOut = useRef(false)

  async function signOut() {
    /* Section 14 rule 2: a control that starts something slow does not
       start it twice. */
    if (signingOut.current) return
    signingOut.current = true
    await fetch('/api/auth/logout', { method: 'POST' })
    invalidateMeCache()
    router.push('/login')
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" />}
          >
            <UserIcon className="size-icon-nav" />
            <span className="sr-only">Account</span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Account</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-body font-medium text-text-primary">
              {me?.name ?? 'Signed in'}
            </span>
            <span className="block truncate text-meta text-text-muted">
              {me?.phone ?? ''}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/*
          My Points is a page about the current user rather than a
          section of the product, which is why it is here and not in the
          sidebar - section 12.1's ceiling counts destinations people
          scan for.
        */}
        <DropdownMenuItem onClick={() => router.push('/points')}>
          <TrophyIcon />
          My Points
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
