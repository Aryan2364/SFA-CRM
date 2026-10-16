'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  BellIcon,
  CalendarDaysIcon,
  ContactIcon,
  HandshakeIcon,
  LogOutIcon,
  PanelLeftIcon,
  SearchIcon,
  ShoppingCartIcon,
  TrophyIcon,
  UserIcon,
  UserRoundSearchIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { getRecentItems, recordRecentItem } from '@/lib/recent-items'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
}

export function TopBar({ onToggleSidebar, toggleLabel }: TopBarProps) {
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

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}

type SearchResult = {
  type: 'account' | 'contact' | 'opportunity' | 'order' | 'meeting'
  id: string
  title: string
  subtitle: string | null
  href: string
}

const SEARCH_GROUPS: { type: SearchResult['type']; heading: string; icon: ReactNode }[] = [
  { type: 'account', heading: 'Accounts', icon: <UserRoundSearchIcon /> },
  { type: 'contact', heading: 'Contacts', icon: <ContactIcon /> },
  { type: 'opportunity', heading: 'Opportunities', icon: <HandshakeIcon /> },
  { type: 'order', heading: 'Orders', icon: <ShoppingCartIcon /> },
  { type: 'meeting', heading: 'Meetings', icon: <CalendarDaysIcon /> },
]

const SEE_ALL_VALUE = '__see-all__'

/**
 * Section 12.2's global search. The field itself is a trigger — clicking or
 * focusing it, or pressing Ctrl/Cmd+K from anywhere (section 39.5), opens
 * `CommandDialog`, which brings its own layout and scroller (section 24
 * rule 6). Typing debounces ~250ms against `GET /api/search`, cmdk's own
 * client-side filtering is off (`shouldFilter={false}`) because the server
 * already decided what matches and under what scope.
 *
 * Empty and focused: "Recent" — the last few records this user opened
 * (src/lib/recent-items.ts), re-checked against `/api/search/recent` so a
 * record the caller lost access to since never shows. Typed: results, plus a
 * fixed "See all results" row that opens `/search?q=`, the type-paged full
 * results page — the dropdown's own 5-per-type cap is never the end of the
 * road. `highlighted` controls cmdk's own highlight (same mechanism
 * `usePhoneHighlight` in command.tsx already uses on phone): it starts empty
 * so Enter right after typing, before any arrow key, opens "See all" rather
 * than guessing which row the caller meant.
 */
function GlobalSearch() {
  const router = useRouter()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState('')
  // cmdk reasserts its own "first row" highlight through `onValueChange`
  // itself — not just on a keypress — so clearing `highlighted` once in
  // `CommandInput`'s `onValueChange` is not enough; cmdk immediately reports
  // its own guess back and overwrites it. `movedByKeys` is the same gate
  // `usePhoneHighlight` in command.tsx already uses for the identical
  // problem on phone: until an arrow/Home/End key actually moves the
  // highlight, cmdk's own `onValueChange` reports are ignored and `value`
  // stays `''`, so cmdk itself has nothing selected and Enter has nothing to
  // activate — which is what lets Enter fall through to "See all results".
  const [movedByKeys, setMovedByKeys] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [recents, setRecents] = useState<SearchResult[]>([])

  const openSearch = useCallback(() => {
    setOpen(true)
    setHighlighted('')
    setMovedByKeys(false)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  // Recent: loaded once per open, from localStorage, then re-checked against
  // the server. Not query-dependent — it only ever shows while the box is
  // still empty.
  useEffect(() => {
    if (!open || !me?.userId) return
    const local = getRecentItems(me.userId)
    if (local.length === 0) {
      setRecents([])
      return
    }
    const abort = new AbortController()
    const items = local.map(r => `${r.type}:${r.id}`).join(',')
    fetch(`/api/search/recent?items=${encodeURIComponent(items)}`, { signal: abort.signal })
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(body => {
        const byKey = new Map((body.results ?? []).map((r: SearchResult) => [`${r.type}:${r.id}`, r]))
        // Server order is unspecified; keep the caller's own openedAt order
        // and drop anything the server didn't hand back (gone or out of scope).
        setRecents(local.map(r => byKey.get(`${r.type}:${r.id}`)).filter((r): r is SearchResult => !!r))
      })
      .catch(() => {
        /* Recent just stays empty — never a raw error for a convenience list. */
      })
    return () => abort.abort()
  }, [open, me?.userId])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setSearched(false)
      return
    }
    setLoading(true)
    const abort = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: abort.signal,
        })
        if (response.ok) {
          const body = await response.json()
          setResults(body.results ?? [])
        }
      } catch {
        /* A failed search leaves the dropdown exactly as it was — stale
           results, never a raw error overlay (section 6 rule 6). */
      } finally {
        setLoading(false)
        setSearched(true)
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [open, query])

  const select = useCallback(
    (row: SearchResult) => {
      setOpen(false)
      setQuery('')
      if (me?.userId) recordRecentItem(me.userId, row)
      router.push(row.href)
    },
    [router, me?.userId]
  )

  const seeAll = useCallback(
    (q: string) => {
      setOpen(false)
      setQuery('')
      router.push(`/search?q=${encodeURIComponent(q)}`)
    },
    [router]
  )

  const trimmed = query.trim()

  return (
    <>
      <InputGroup
        className="w-search max-w-full cursor-pointer"
        onClick={() => openSearch()}
      >
        <InputGroupAddon>
          <SearchIcon className="size-icon" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search"
          placeholder="Search"
          readOnly
          className="cursor-pointer"
          onFocus={() => openSearch()}
        />
      </InputGroup>

      <CommandDialog
        open={open}
        onOpenChange={next => (next ? openSearch() : setOpen(false))}
        title="Search"
        description="Search accounts, contacts, opportunities, orders and meetings"
      >
        <Command
          shouldFilter={false}
          value={movedByKeys ? highlighted : ''}
          onValueChange={v => {
            if (movedByKeys) setHighlighted(v)
          }}
        >
          <CommandInput
            autoFocus
            value={query}
            onValueChange={v => {
              setQuery(v)
              setHighlighted('')
              setMovedByKeys(false)
            }}
            onKeyDown={event => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                setMovedByKeys(true)
                return
              }
              // Controlling cmdk's `value` was not enough on its own — cmdk
              // still resolves an Enter to its own idea of "the first row"
              // even with `value=""` and no key having moved the highlight
              // (measured: Enter right after typing opened the top account,
              // not "See all"). So Enter is intercepted here directly,
              // before it ever reaches cmdk's own handler, whenever the
              // highlight has not been moved by an arrow key yet.
              if (event.key === 'Enter' && !movedByKeys && trimmed.length >= 2) {
                event.preventDefault()
                event.stopPropagation()
                seeAll(trimmed)
              }
            }}
            placeholder="Search accounts, contacts, opportunities, orders, meetings…"
          />
          <CommandList>
            {trimmed.length < 2 ? (
              recents.length > 0 ? (
                <CommandGroup heading="Recent">
                  {recents.map(row => (
                    <SearchRow key={`recent-${row.type}-${row.id}`} row={row} onSelect={() => select(row)} />
                  ))}
                </CommandGroup>
              ) : (
                <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
              )
            ) : loading ? (
              <CommandEmpty>Searching…</CommandEmpty>
            ) : (
              <>
                {results.length === 0 && searched && (
                  <p className="px-3 py-6 text-center text-body text-text-muted">
                    No results for &ldquo;{trimmed}&rdquo;
                  </p>
                )}
                {SEARCH_GROUPS.map(group => {
                  const rows = results.filter(r => r.type === group.type)
                  if (rows.length === 0) return null
                  return (
                    <CommandGroup key={group.type} heading={group.heading}>
                      {rows.map(row => (
                        <SearchRow key={`${row.type}-${row.id}`} row={row} onSelect={() => select(row)} />
                      ))}
                    </CommandGroup>
                  )
                })}
                <CommandGroup>
                  <CommandItem value={SEE_ALL_VALUE} onSelect={() => seeAll(trimmed)}>
                    <SearchIcon />
                    <span>See all results for &ldquo;{trimmed}&rdquo;</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

function SearchRow({ row, onSelect }: { row: SearchResult; onSelect: () => void }) {
  const group = SEARCH_GROUPS.find(g => g.type === row.type)
  return (
    <CommandItem value={`${row.type}-${row.id}`} onSelect={onSelect}>
      {group?.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{row.title}</span>
        {row.subtitle && <span className="truncate text-meta text-text-muted">{row.subtitle}</span>}
      </span>
    </CommandItem>
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
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          <UserIcon />
          My profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
