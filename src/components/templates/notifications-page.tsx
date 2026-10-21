"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import { EllipsisIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLayout } from "@/lib/layout"
import { INSET_RING } from "@/components/shell/content-area"
import { usePhoneAppBar } from "@/components/shell/phone-app-bar"
import { ShellLink } from "@/components/shell/progress-bar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  PhoneList,
  type Noun,
  type PhoneListSearch,
  type PhoneListState,
} from "@/components/ui/phone-list"
// 41.4 rule 10: the one number for "this close to a side edge", sheet.tsx's.
import { SIDE_EDGE_PX } from "@/components/ui/sheet"

/*
 * PORT NOTE (sfacrm is React 18 with a reduced phone shell; logged in
 * docs/kit-audit/kit-gaps.md). Differences from the kit's file:
 *   - Notification, timeAgo and the "branch" props live here, because
 *     sfacrm has no components/shell/notification-panel.tsx and its
 *     phone-list.tsx has no phoneListBranch / PhoneScreenBranch.
 *   - The app bar comes from usePhoneAppBar() (sfacrm has no PageHeader).
 *   - The status badge is dropped: sfacrm notifications carry no status.
 *   - Rows sit in sfacrm's PhoneList, which bleeds past the shell's 16px
 *     padding itself, so a row pads with px-4 where the kit uses INSET
 *     (the content-area bleed variables are not set in this shell).
 */
type Notification = {
  id: string
  /** What happened, in plain words. */
  text: string
  at: Date
  read: boolean
  /** The item it is about. Clicking the row opens it. */
  href: string
}

type PhoneScreenBranch = {
  state?: PhoneListState
  onRetry?: () => void
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Section 18: "2 hours ago" is allowed in notifications; past a week, the full date. */
function timeAgo(at: Date, now: Date) {
  const diff = Math.max(0, now.getTime() - at.getTime())
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`
  if (diff < MINUTE) return "Just now"
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), "minute")
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour")
  if (diff < 7 * DAY) return plural(Math.floor(diff / DAY), "day")
  const d = String(at.getDate()).padStart(2, "0")
  return `${d} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`
}

/**
 * Section 41.12 rules 1 and 6: Notifications on phone - a screen of its
 * own, as a tab or in More, in place of the bell's panel (7.4).
 *
 * PHONE ONLY. In the desktop layout it renders nothing. On desktop the
 * notifications address is a list page (41.2 rule 5) whose template is
 * not built yet (4.1), so a product keeps its own desktop page there
 * until it is (stage 5, decision 1). The screen chooses its tree with
 * useLayout().
 *
 *   const { layout } = useLayout()
 *   return layout === "phone" ? (
 *     <NotificationsPage
 *       notifications={loaded} total={total} unread={unreadTotal}
 *       search={{ value: query, onChange: setQuery }}
 *       onRead={markRead} onUnread={markUnread} onMarkAllRead={markAllRead}
 *       onLoadMore={loadMore} onRefresh={reload}
 *       parent="/more"
 *     />
 *   ) : (
 *     <DesktopNotifications />
 *   )
 *
 * WHAT IT SHOWS
 *
 *   - The app bar: "Notifications", and on its right the three-dot menu
 *     (an on-brand icon button, 6.3.2) holding "Mark all as read" (41.12
 *     rule 1). On phone the menu is a bottom sheet (41.8). Shown only while
 *     something is unread, as the panel shows its link (7.4).
 *   - The phone list (41.5): the search, the count line, then the rows,
 *     the latest 25 and 25 more as the person scrolls, never more than 200
 *     (41.5 rules 14 and 15), with pull to refresh. Newest first, as the
 *     server sends them: like My work, the template sorts nothing, because
 *     the list arrives 25 at a time.
 *   - Each row follows 7.3 and 7.4: what happened, clamped to two lines
 *     (section 8: notification rows clamp); when, as "2 hours ago"
 *     (section 18 allows it in notifications); the unread dot in primary
 *     and a faint primary-subtle row tint while unread - the only brand on
 *     the row; a status badge only when the event genuinely is a success,
 *     a warning or a failure (7.3), on the time's line, as in the panel.
 *     Everything else is neutral.
 *   - Tapping a row marks it read and opens the item it is about (7.4).
 *   - With no notifications, the panel's one line in text-muted: "You are
 *     all caught up." (7.4).
 *
 * MARKING READ AND UNREAD (41.12 rule 6)
 *
 *   - A sideways swipe on a row marks it read, or unread if it was read.
 *     It is the one swipe on a row (41.5 rule 13), it does nothing else,
 *     and swiping again reverses it, so there is no Undo. The row follows
 *     the finger, then slides out at --duration-fast (5.6: "swipe
 *     dismissal ... follows the finger, then slides out, fast") and is
 *     back in its place in its new state. A swipe that does not go far
 *     enough settles back, at the medium duration, as a sheet does. A
 *     swipe that starts within 24px of a side edge is ignored: that edge
 *     is the phone's back gesture (41.4 rule 10). Touch and pen only; a
 *     mouse on a phone uses the dot.
 *   - The unread dot does the same on a tap: a 44px target (41.9 rule 2,
 *     the phone's control size) labelled "Mark as read" or "Mark as
 *     unread" for screen readers, so nothing depends on the swipe (41.20
 *     check 24). On a read row it is a hollow dot, its outline in the
 *     border token, so the control is never invisible: a filled dot for
 *     unread, a hollow one for read.
 *   - Reduce motion (5.6 rule 3): the row still follows the finger (the
 *     person is moving it), but it does not slide out or settle; it is
 *     simply back in place.
 *
 * WHAT THE CALLER OWNS: the notifications and their read state (onRead,
 * onUnread, onMarkAllRead change it; the template only asks), the true
 * total and unread count, the search text, and loading (onLoadMore,
 * onRefresh), as with any PhoneList. Where `state` can be "failed",
 * `onRetry` is required, so "Try again" always does something (14 rule 3,
 * 26 rule 3).
 *
 * WORDS (37.6 rule 2): NOTIFICATIONS_TEXT below; a product in another
 * language passes its own through `text`. The status badges' labels are
 * the bell panel's (NOTIFICATION_STATUS_BADGE), shared with it.
 */

type NotificationsPageProps = PhoneScreenBranch & {
  /** The notifications loaded so far, newest first: 25, then 25 more each time, up to 200. */
  notifications: Notification[]
  /** The TRUE total under the current search (41.5 rule 14). The loaded count unless given. */
  total?: number
  /**
   * How many are unread in all, loaded or not: shows "Mark all as read"
   * while above 0. The loaded unread count unless given.
   */
  unread?: number
  /** The row was opened, swiped or its dot tapped while unread. */
  onRead: (id: string) => void
  /** The row was swiped, or its dot tapped, while read. */
  onUnread: (id: string) => void
  onMarkAllRead: () => void
  search: PhoneListSearch
  /**
   * The screen this one sits under, where it is not a tab: More (stage 2,
   * decision 16). With a parent the screen has the back arrow and no tab
   * bar (41.4 rules 6 and 11). Leave it out when Notifications is a tab.
   */
  parent?: string
  /*
   * `state`, which branch the list is in (14 rule 3), "ready" unless
   * given; and `onRetry`, the failed branch's Try again, required wherever
   * `state` can be "failed" (PhoneScreenBranch).
   */
  /** Loads the next 25 (41.5 rule 14). */
  onLoadMore?: () => Promise<void>
  /** Pull to refresh (41.5 rule 16). */
  onRefresh?: () => Promise<void>
  /** The screen's words in the product's language (37.6 rule 2); English by default. */
  text?: Partial<NotificationsText>
}

/* ------------------------------------------------------------------
   Words (section 37), in one place for the product's strings file
   (37.6 rule 2), which replaces them through `text`.
   ------------------------------------------------------------------ */

type NotificationsText = {
  /** The app bar's title. */
  title: string
  /** The three-dot menu's name for screen readers. */
  more: string
  markAllRead: string
  /** The dot's name on an unread row. */
  markRead: string
  /** The dot's name on a read row. */
  markUnread: string
  /** Said before an unread row's text, for screen readers. */
  unread: string
  /** 7.4's one line when there are none. */
  caughtUp: string
  /** The count line and the search: "12 notifications", "Search notifications". */
  noun: Noun
}

const NOTIFICATIONS_TEXT: NotificationsText = {
  title: "Notifications",
  more: "More actions",
  markAllRead: "Mark all as read",
  markRead: "Mark as read",
  markUnread: "Mark as unread",
  unread: "Unread: ",
  caughtUp: "You are all caught up.",
  noun: { one: "notification", many: "notifications" },
}

/* ------------------------------------------------------------------
   The swipe - 41.12 rule 6.
   ------------------------------------------------------------------ */

/** A swipe past this share of the row's width marks it. */
const SWIPE_SHARE = 0.35
/** So does a flick faster than this, in px per ms, however short: sheet.tsx's flick speed. */
const FLICK_SPEED = 0.5
/** A click this soon after a swipe is the swipe's own, and opens nothing. */
const CLICK_AFTER_SWIPE_MS = 400

/** A motion token as milliseconds, whichever unit globals.css wrote it in. */
function tokenMs(value: string) {
  const v = value.trim()
  return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000
}

function motionToken(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name)
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Not far enough: back to rest at the medium duration, as a sheet settles (5.6). */
function settle(el: HTMLElement, from: number) {
  el.style.removeProperty("transform")
  if (from === 0 || prefersReducedMotion()) return
  el.animate(
    [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
    {
      duration: tokenMs(motionToken("--duration-medium")),
      easing: motionToken("--ease-enter").trim() || undefined,
    }
  )
}

/**
 * Far enough: slides out the way it was going at --duration-fast with the
 * exit easing (5.6), then the row is marked and is back in its place in
 * its new state, in the same frame (flushSync), so it never shows its old
 * state in place.
 */
function slideOut(el: HTMLElement, from: number, done: () => void) {
  el.style.removeProperty("transform")
  if (prefersReducedMotion()) {
    flushSync(done)
    return
  }
  const to = Math.sign(from) * el.offsetWidth
  const animation = el.animate(
    [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${to}px, 0, 0)` }],
    {
      duration: tokenMs(motionToken("--duration-fast")),
      easing: motionToken("--ease-exit").trim() || undefined,
      fill: "forwards",
    }
  )
  animation.finished.then(
    () => {
      flushSync(done)
      animation.cancel()
    },
    () => {}
  )
}

type Drag = {
  pointer: number
  x: number
  y: number
  lastX: number
  lastT: number
  speed: number
  threshold: number
  dragging: boolean
}

/**
 * The row's sideways swipe. Passive about scrolling: the row takes
 * touch-action pan-y, so the browser still scrolls the page on an upright
 * swipe, and the swipe only starts once the finger has moved the board's
 * tap-or-drag distance (--drag-threshold, 35.6.1) more sideways than up or
 * down. Until then it is a tap. A pointer the browser takes over
 * (pointercancel) settles back and marks nothing.
 */
function useRowSwipe(onSwipe: () => void) {
  const slideRef = React.useRef<HTMLDivElement | null>(null)
  const drag = React.useRef<Drag | null>(null)
  const swipedAt = React.useRef(Number.NEGATIVE_INFINITY)
  const latest = React.useRef(onSwipe)
  React.useLayoutEffect(() => {
    latest.current = onSwipe
  })

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (!event.isPrimary || event.pointerType === "mouse") return
    // 41.4 rule 10: the side edges belong to the phone's back gesture.
    if (event.clientX < SIDE_EDGE_PX || event.clientX > window.innerWidth - SIDE_EDGE_PX) return
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastT: event.timeStamp,
      speed: 0,
      threshold: parseFloat(motionToken("--drag-threshold")) || 0,
      dragging: false,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = slideRef.current
    if (!d || !el || event.pointerId !== d.pointer) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < d.threshold) return
      // Up or down first: a scroll, not a swipe of ours.
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null
        return
      }
      d.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const dt = event.timeStamp - d.lastT
    if (dt > 0) d.speed = (event.clientX - d.lastX) / dt
    d.lastX = event.clientX
    d.lastT = event.timeStamp
    // Section 1 rule 2 forbids inline styles for colour, spacing and
    // typography. This is none of them: it is where the finger is, a
    // runtime measurement only an inline transform can follow (5.6: it
    // follows the finger), as sheet.tsx's swipe does. Removed on release.
    el.style.transform = `translate3d(${dx}px, 0, 0)`
  }

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = slideRef.current
    drag.current = null
    if (!d?.dragging || !el || event.pointerId !== d.pointer) return
    swipedAt.current = performance.now()
    const dx = event.clientX - d.x
    const cancelled = event.type === "pointercancel"
    const far = Math.abs(dx) > el.offsetWidth * SWIPE_SHARE
    const flicked = Math.abs(d.speed) > FLICK_SPEED && Math.sign(d.speed) === Math.sign(dx)
    if (cancelled || dx === 0 || (!far && !flicked)) {
      settle(el, dx)
      return
    }
    slideOut(el, dx, () => latest.current())
  }

  /** The click that ends a swipe neither opens the row nor taps the dot. */
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (performance.now() - swipedAt.current < CLICK_AFTER_SWIPE_MS) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return {
    slideRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
    },
  }
}

/* ------------------------------------------------------------------
   The row - 7.3, 7.4, 41.5 rules 8 to 12, 41.12 rule 6.
   ------------------------------------------------------------------ */

/*
 * Where the dot sits. The row's text starts 32px (space-8) in from the
 * content's edge (INSET's left padding); the dot's 44px button ends there,
 * starting 12px (space-3) outside it, so the 8px dot is centred 10px in
 * from the content's edge, the button never overlaps the text, and a tap
 * on the text is always the row's. The button sits 4px (space-1) from the
 * row's top, which centres the dot on the first line of text.
 */
const TEXT_LEFT = "pl-12"
const DOT_LEFT = "left-1"

/**
 * One notification. The row is the phone list's row geometry - edge to
 * edge on surface, at least 64px, 12px above and below, 16px at the sides
 * plus the safe areas (41.5 rule 8) - built from content-area.tsx's INSET
 * and INSET_RING, as phone-list.tsx builds its own. It cannot be a
 * PhoneListRow: that row is one link, and this one holds a second control,
 * the dot, which may not sit inside a link.
 *
 *   - The whole row is the link to the item (41.5 rule 12, 7.4), through
 *     ShellLink so the loading bar shows (5.6). Opening it marks it read.
 *     Pressed: a surface-control fill; no hover on phone (41.9 rule 1).
 *   - The dot's button lies over the row's left edge, beside the link, not
 *     in it, after it in the page so it is reached after the row.
 *   - The row slides inside a clipped frame, so a swipe never makes the
 *     page scroll sideways (41.20 check 6).
 */
function NotificationRow({
  notification: n,
  now,
  onRead,
  onUnread,
  t,
}: {
  notification: Notification
  now: Date
  onRead: (id: string) => void
  onUnread: (id: string) => void
  t: NotificationsText
}) {
  const toggle = () => (n.read ? onUnread(n.id) : onRead(n.id))
  const { slideRef, handlers } = useRowSwipe(toggle)

  return (
    <div data-slot="notification-row" data-unread={!n.read || undefined} className="overflow-x-clip bg-surface">
      <div ref={slideRef} className="relative touch-pan-y" {...handlers}>
        <ShellLink
          href={n.href}
          onClick={() => {
            if (!n.read) onRead(n.id)
          }}
          className={cn(
            "flex min-h-16 w-full flex-col justify-center gap-1 py-3 text-left",
            "pr-4",
            TEXT_LEFT,
            INSET_RING,
            "transition-[background-color] duration-(--duration-fast)",
            // 7.3: the brand appears only as the unread dot and a faint
            // row tint; everything else is neutral.
            n.read ? "bg-surface" : "bg-primary-subtle/50",
            "active:bg-surface-control"
          )}
        >
          <span className="line-clamp-2 text-body text-text-primary">
            {n.read ? null : <span className="sr-only">{t.unread}</span>}
            {n.text}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {/* Measured from the moment the screen opened: the server's
                and the browser's moment differ by the time between them,
                which can tip "4 minutes" into "5". */}
            <span className="text-meta text-text-muted" suppressHydrationWarning>
              {timeAgo(n.at, now)}
            </span>
          </span>
        </ShellLink>
        <button
          type="button"
          aria-label={n.read ? t.markUnread : t.markRead}
          onClick={toggle}
          className={cn(
            "absolute top-1 flex size-control cursor-pointer items-center justify-center rounded-lg",
            DOT_LEFT,
            "transition-[background-color] duration-(--duration-fast) active:bg-surface-control-pressed",
            INSET_RING
          )}
        >
          {/* Unread: the filled dot in primary (7.3). Read: a hollow dot,
              its outline in the border token, so the control that marks
              it unread is always there to see (41.12 rule 6). */}
          <span
            aria-hidden
            className={cn("size-2 rounded-full", n.read ? "border border-border bg-transparent" : "bg-primary")}
          />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
   The screen.
   ------------------------------------------------------------------ */

const notificationKey = (n: Notification) => n.id

function NotificationsPage(props: NotificationsPageProps) {
  const { layout } = useLayout()
  if (layout !== "phone") return null
  return <NotificationsOnPhone {...props} />
}

function NotificationsOnPhone(props: NotificationsPageProps) {
  const {
    notifications,
    total,
    unread,
    onRead,
    onUnread,
    onMarkAllRead,
    search,
    parent,
    onLoadMore,
    onRefresh,
    text,
  } = props
  const t = { ...NOTIFICATIONS_TEXT, ...text }
  // "2 hours ago" is measured from when the screen opened, and from each
  // reload after that - never from a clock read while rendering.
  const [now, setNow] = React.useState(() => new Date())
  const unreadCount = unread ?? notifications.filter((n) => !n.read).length

  const refresh = React.useMemo(
    () =>
      onRefresh
        ? async () => {
            await onRefresh()
            setNow(new Date())
          }
        : undefined,
    [onRefresh]
  )

  // 41.12 rule 1: "Mark all as read" in the app bar's three-dot menu, an
  // on-brand icon button on the band (6.3.2). The menu is a bottom sheet
  // on phone, titled from the button's label. No tooltip: ellipsis is in
  // the phone icon set (41.9 rule 9).
  // PORT NOTE: memoised, because the app bar keeps what it is given in
  // context and a fresh node every render would loop (phone-app-bar.tsx).
  const menu = React.useMemo(
    () =>
      unreadCount > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={t.more}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
              />
            }
          >
            <EllipsisIcon aria-hidden className="size-[22px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onMarkAllRead}>{t.markAllRead}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined,
    [unreadCount, onMarkAllRead, t.more, t.markAllRead]
  )
  usePhoneAppBar({ title: t.title, back: parent, actions: menu })

  return (
    <>
      <PhoneList
        state={props.state ?? "ready"}
        onRetry={props.onRetry}
        noun={t.noun}
        rows={notifications}
        total={total ?? notifications.length}
        rowKey={notificationKey}
        renderRow={(n) => (
          <NotificationRow notification={n} now={now} onRead={onRead} onUnread={onUnread} t={t} />
        )}
        onLoadMore={onLoadMore}
        onRefresh={refresh}
        search={search}
        empty={
          // 7.4's one line: nothing to create, so no heading or button.
          <p className="py-6 text-body text-text-muted">{t.caughtUp}</p>
        }
      />
    </>
  )
}

export { NotificationsPage, NOTIFICATIONS_TEXT }
export type { NotificationsPageProps, NotificationsText, Notification }
