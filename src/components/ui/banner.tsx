"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PHONE_TWO_LINES, Truncate } from "@/components/ui/truncate"
import {
  BANNER_DISMISS_COOKIE,
  decodeBannerDismissals,
  encodeBannerDismissals,
  type BannerDismissals,
} from "@/lib/banner-dismissals-shared"

const YEAR = 60 * 60 * 24 * 365

/**
 * Section 7.1, the banner: a condition that persists until it is
 * resolved. Named Banner, not Alert, because section 7.1 treats
 * banner, inline field error, toast and dialog as four distinct
 * patterns with a decision rule between them - a component called
 * Alert invites picking by feel instead of by the rule.
 *
 * The user can carry on, but it stays true - which is what separates a
 * banner from a toast (temporary) and a dialog (must act). One field
 * being wrong is InlineFieldError, not this.
 *
 * Section 7.2 rule 1: every banner carries an icon as well as a colour.
 * Colour alone is invisible to colour-blind users. Rule 3: no
 * exclamation marks, no "Error:" prefix, and never a raw technical
 * message.
 *
 * `neutral` is the default. There is deliberately no blue information
 * colour in this system (section 2.4) - neutral grey carries it.
 *
 * Section 7.5, the two layouts:
 *
 *   - `layout="line"`, a banner on a page: the icon, one sentence, at
 *     most one action and, where rule 3 allows, BannerClose, on one row.
 *     The sentence truncates (section 8, the tooltip only when it is
 *     cut) and never wraps; phone differs, below. Names go on the page
 *     the action opens.
 *   - `layout="block"` (the default), a banner inside a form or a
 *     dialog, read whole: the stacked title, description and action.
 *
 * Rule 3: only a warning or neutral banner that reports a condition in
 * the data takes BannerClose, with useBannerDismissal remembering the
 * close. A banner that explains why something cannot be done never
 * does.
 *
 * ON PHONE (41.8 rule 15) `layout="line"` changes shape by itself; the
 * caller writes the same banner for both layouts (41.3 rule 4):
 *
 *     [icon]  The sentence, which may run onto a       [x]
 *             second line before it is cut...
 *             Review customers
 *
 *   - the sentence may wrap to two lines, then truncates;
 *   - the action moves to its own line below the sentence, drawn as a
 *     standing text link, still a button (6.6 rule 5);
 *   - the close sits top right.
 *
 * It is a three-column grid, icon | text | close, with no column gap
 * (an empty column then costs nothing): the icon and the close carry
 * their own 12px, the desktop row's gap-3. `layout="block"` is read
 * whole and wraps freely (7.5 rule 2), so it is the same on phone.
 */
const bannerVariants = cva(
  "group/banner relative w-full rounded-lg border px-4 text-left text-body",
  {
    variants: {
      variant: {
        neutral:
          "border-border bg-surface text-text-primary *:[svg]:text-text-secondary",
        success: "border-success-border bg-success-bg text-success",
        warning: "border-warning-border bg-warning-bg text-warning",
        danger: "border-danger-border bg-danger-bg text-danger",
      },
      layout: {
        block: [
          "grid gap-1 py-3",
          "has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3",
          "has-data-[slot=banner-action]:pr-4",
          "*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
        ],
        // One row: icon, sentence, action, close.
        line: [
          "flex items-center gap-3 py-2",
          "*:[svg]:shrink-0 *:[svg:not([class*='size-'])]:size-4",
          // Phone, 41.8 rule 15: the grid described above. 8px between
          // the sentence and its action: tightly related (5.1).
          "phone:grid phone:grid-cols-[auto_minmax(0,1fr)_auto] phone:items-start phone:gap-x-0 phone:gap-y-2",
          // The icon, top left, 12px from the sentence. One line tall
          // (h-lh) rather than 16px, so the 16px glyph sits centred on the
          // sentence's FIRST line, and stays there as the text-size setting
          // grows the line (41.9 rule 7). The svg keeps its 16px width.
          "phone:*:[svg]:col-start-1 phone:*:[svg]:row-start-1 phone:*:[svg]:mr-3",
          "phone:*:[svg:not([class*='size-'])]:h-lh",
        ],
      },
    },
    defaultVariants: {
      variant: "neutral",
      layout: "block",
    },
  }
)

type BannerLayout = NonNullable<VariantProps<typeof bannerVariants>["layout"]>

const BannerLayoutContext = React.createContext<BannerLayout>("block")

function Banner({
  className,
  variant,
  layout,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bannerVariants>) {
  const resolved = layout ?? "block"
  return (
    <BannerLayoutContext.Provider value={resolved}>
      <div
        data-slot="banner"
        data-layout={resolved}
        role="alert"
        className={cn(bannerVariants({ variant, layout: resolved }), className)}
        {...props}
      />
    </BannerLayoutContext.Provider>
  )
}

/**
 * The sentence of a one-line banner: one line, cut with an ellipsis,
 * the full sentence in a tooltip when it is cut (section 8). `wrap` lets
 * it run onto a second line instead, for a one-line banner inside a
 * form or a dialog, which is read whole (section 7.5 rule 2). It is
 * never a list.
 *
 * On phone (41.8 rule 15) two lines, then cut, with no tooltip (41.8
 * rule 16): Truncate's `phoneLines`, or the same clamp on this div when
 * the sentence is not a plain string. Rule 15 is the route 41.8 rule 18
 * names for it, and 7.5 rule 1 keeps the sentence short enough that two
 * lines hold it: the records it counts are on the page its action opens.
 */
function LineText({
  slot,
  wrap,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { slot: string; wrap?: boolean }) {
  const plain = !wrap && typeof children === "string"
  return (
    <div
      data-slot={slot}
      className={cn(
        "min-w-0 flex-1",
        !wrap && "truncate",
        !wrap && !plain && PHONE_TWO_LINES,
        "phone:col-start-2",
        className
      )}
      {...props}
    >
      {plain ? <Truncate phoneLines={2}>{children}</Truncate> : children}
    </div>
  )
}

function BannerTitle({
  className,
  wrap,
  ...props
}: React.ComponentProps<"div"> & { wrap?: boolean }) {
  const layout = React.useContext(BannerLayoutContext)
  if (layout === "line") {
    return (
      <LineText slot="banner-title" wrap={wrap} className={cn("font-medium", className)} {...props} />
    )
  }
  return (
    <div
      data-slot="banner-title"
      className={cn(
        "font-medium group-has-[>svg]/banner:col-start-2",
        className
      )}
      {...props}
    />
  )
}

/**
 * Section 7.2 rule 2: state the cause, then the next action. "Enter a
 * complete email address, like name@company.com", not "Invalid email".
 */
function BannerDescription({
  className,
  wrap,
  ...props
}: React.ComponentProps<"div"> & { wrap?: boolean }) {
  const layout = React.useContext(BannerLayoutContext)
  if (layout === "line") {
    return <LineText slot="banner-description" wrap={wrap} className={className} {...props} />
  }
  return (
    <div
      data-slot="banner-description"
      className={cn(
        "text-body group-has-[>svg]/banner:col-start-2 [&_p:not(:last-child)]:mb-2",
        className
      )}
      {...props}
    />
  )
}

/*
 * 41.8 rule 15: on phone a page banner's action is a button drawn as a
 * standing text link (6.6 rule 5, the standing row of 6.6's table, as
 * TextLink and Clamp's "Show more" draw it). The caller still passes the
 * desktop's <Button size="sm" variant="secondary">, so the same banner
 * serves both layouts (41.3 rule 4); this restyles that button, and only
 * a direct child Button - a TextLink is already a link.
 *
 * Every class beats its button.tsx counterpart on specificity, not on
 * stylesheet order: the child selector adds an attribute, and the state
 * lines (hover, active, disabled) add their pseudo-class as button.tsx's
 * do. So no fill and no border in any state, body size and weight in
 * primary-text, and the height of its line rather than 44px: tap-area,
 * which every Button carries, still grows the TAP area to 44px (9 rule
 * 4, 41.20 check 9). The focus ring is button.tsx's own, primary-ring.
 *
 * Underline on hover, as a standing link, and on press: on phone the
 * pressed state is the only feedback a tap gets (41.9 rule 1), and the
 * underline is the link's own. Hover is inside (hover: hover) already.
 */
const PHONE_ACTION_AS_LINK = [
  "phone:col-start-2 phone:justify-self-start",
  "phone:[&>[data-slot=button]]:h-auto phone:[&>[data-slot=button]]:justify-start phone:[&>[data-slot=button]]:rounded-sm",
  "phone:[&>[data-slot=button]]:border-0 phone:[&>[data-slot=button]]:bg-transparent phone:[&>[data-slot=button]]:px-0",
  "phone:[&>[data-slot=button]]:text-left phone:[&>[data-slot=button]]:text-body phone:[&>[data-slot=button]]:font-normal phone:[&>[data-slot=button]]:text-primary-text",
  // A long label wraps rather than pushing past a 320px screen (41.13 rule 7).
  "phone:[&>[data-slot=button]]:whitespace-normal",
  "phone:[&>[data-slot=button]]:decoration-1 phone:[&>[data-slot=button]]:underline-offset-2",
  "phone:[&>[data-slot=button]]:hover:bg-transparent phone:[&>[data-slot=button]]:hover:underline",
  "phone:[&>[data-slot=button]]:active:bg-transparent phone:[&>[data-slot=button]]:active:underline",
  "phone:[&>[data-slot=button]]:disabled:bg-transparent phone:[&>[data-slot=button]]:disabled:text-text-muted",
].join(" ")

/** Section 13: no dead ends. A banner offers a way forward. */
function BannerAction({ className, ...props }: React.ComponentProps<"div">) {
  const layout = React.useContext(BannerLayoutContext)
  return (
    <div
      data-slot="banner-action"
      className={cn(
        layout === "line"
          ? ["flex shrink-0 items-center gap-2", PHONE_ACTION_AS_LINK]
          : "mt-2 flex items-center gap-2 group-has-[>svg]/banner:col-start-2",
        className
      )}
      {...props}
    />
  )
}

/**
 * Section 7.5 rule 3: the close (x) of a banner that reports a
 * condition in the data. A quiet 36px icon button (sections 6.2 and
 * 6.3) with its hidden label and tooltip; on a touch screen the
 * button's own tap-area grows it to 44px. For `layout="line"`, as the
 * last item of the row.
 *
 * Never on a banner that explains why something cannot be done (rule
 * 4): closing it would leave that unexplained.
 *
 * On phone (41.8 rule 15) it sits top right, 12px from the sentence, in
 * the third column of the grid. The phone's icon button is 44px (41.9
 * rule 2); -my-2 lets it reach 8px into the banner's own padding above
 * and below, so its x lines up with the sentence's first line and a
 * one-line banner does not grow to fit the button. The tooltip does not
 * open on phone (tooltip.tsx); the x needs none (41.9 rule 9) and keeps
 * its screen-reader label.
 */
function BannerClose({
  className,
  label = "Close",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "variant" | "size"> & {
  label?: string
}) {
  const layout = React.useContext(BannerLayoutContext)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            data-slot="banner-close"
            className={cn(
              "shrink-0",
              layout === "line" &&
                "phone:col-start-3 phone:row-start-1 phone:-my-2 phone:ml-3 phone:self-start",
              className
            )}
            {...props}
          />
        }
      >
        <XIcon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------
// Section 7.5 rule 3: remembering a close, per person and per condition
// ---------------------------------------------------------------------

/**
 * One cookie-backed map for the whole app: `"<userId>.<condition>"` to
 * the level it was closed at (lib/banner-dismissals-shared.ts). Kept as
 * a single module-level snapshot, like lib/layout.ts's `current`, so
 * every mounted banner reads the same object reference until it
 * actually changes.
 */
let current: BannerDismissals | null = null
const dismissListeners = new Set<() => void>()

function readCookieDismissals(): BannerDismissals {
  try {
    const prefix = `${BANNER_DISMISS_COOKIE}=`
    const raw = document.cookie
      .split("; ")
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length)
    return decodeBannerDismissals(raw)
  } catch {
    // Storage that cannot be read shows every banner (7.5 rule 3).
    return {}
  }
}

function refreshDismissals() {
  current = readCookieDismissals()
}

function notifyDismissals() {
  refreshDismissals()
  for (const listener of dismissListeners) listener()
}

/**
 * Same-tab writes notify directly (see `dismiss` below); the `focus`
 * event is enough to pick up a close made in another tab, as the
 * owner's decision allows.
 */
function subscribeDismissals(onChange: () => void) {
  dismissListeners.add(onChange)
  window.addEventListener("focus", notifyDismissals)
  return () => {
    dismissListeners.delete(onChange)
    window.removeEventListener("focus", notifyDismissals)
  }
}

function getDismissalsSnapshot(): BannerDismissals {
  if (!current) refreshDismissals()
  return current as BannerDismissals
}

/** The server's read of the cookie (lib/banner-dismissals.server.ts). */
const BannerDismissalsContext = React.createContext<BannerDismissals>({})

/**
 * Mounted once, in the root layout, below LayoutProvider. `initial` is
 * the server's read of the dismissals cookie, so the first paint - and
 * the hydrating render - already match what the person closed: a
 * closed banner is simply not in the HTML, and an open one is there
 * from the start. Nothing below a banner shifts when the page hydrates
 * (section 14 rule 1, 26.4 rule 1).
 *
 * It only provides that initial read; useBannerDismissal reads the
 * live cookie itself after mounting, through useSyncExternalStore, so
 * a close in this tab (or a focus after a close in another) updates
 * every mounted banner from the one shared snapshot above.
 */
function BannerDismissalsProvider({
  initial,
  children,
}: {
  initial: BannerDismissals
  children: React.ReactNode
}): React.ReactNode {
  // No seeding needed: getDismissalsSnapshot reads the cookie itself
  // the first time anything asks, which already matches what the
  // server rendered, since the browser sent that same cookie with the
  // request this page answered.
  return (
    <BannerDismissalsContext.Provider value={initial}>{children}</BannerDismissalsContext.Provider>
  )
}

/**
 * Whether a closable banner is hidden, and how to close it.
 *
 * `userId` is the signed-in person, so a close on a shared computer is
 * that person's alone. `condition` names the condition and what it is
 * about ("over-plan.<projectId>"). `level` is how bad it is now, as a
 * number that rises when it worsens (a count, an amount over).
 *
 * Closing writes the level into the shared cookie under a key holding
 * both. The banner stays hidden only while the current level is at or
 * below the stored one, so it returns the moment the condition gets
 * worse. Every cookie access is in try/catch: a cookie that cannot be
 * read or written shows the banner (write failures hide it for this
 * visit only, through `closedHere`, exactly as before). Without a user
 * id nothing is stored, and the banner shows.
 *
 * The first paint is already right, because `initial` came from the
 * server's own read of the cookie (BannerDismissalsProvider above):
 * open stays open, closed is already absent, and a condition that has
 * worsened past its stored level reopens on that very render. There is
 * no "not known yet" state here, unlike useLayout()'s screen
 * measurement - the server can read a cookie the browser already sent.
 */
function useBannerDismissal({
  userId,
  condition,
  level,
}: {
  userId: string | null | undefined
  condition: string
  level: number
}): { hidden: boolean; dismiss: () => void } {
  const key = userId ? `${userId}.${condition}` : null
  const initial = React.useContext(BannerDismissalsContext)
  const map = React.useSyncExternalStore(
    subscribeDismissals,
    getDismissalsSnapshot,
    () => initial
  )
  // A close that the cookie refused still closes the banner, for this visit.
  const [closedHere, setClosedHere] = React.useState<{
    key: string | null
    level: number
  } | null>(null)

  const stored = key && key in map ? map[key] : null
  const here = closedHere && closedHere.key === key ? closedHere.level : null
  const hidden = (stored !== null && level <= stored) || (here !== null && level <= here)

  const dismiss = React.useCallback(() => {
    setClosedHere({ key, level })
    if (!key) return
    try {
      const { bounded, value } = encodeBannerDismissals({ ...getDismissalsSnapshot(), [key]: level })
      document.cookie = `${BANNER_DISMISS_COOKIE}=${value}; path=/; max-age=${YEAR}; samesite=lax`
      current = bounded
    } catch {
      return
    }
    for (const listener of dismissListeners) listener()
  }, [key, level])

  return { hidden, dismiss }
}

export {
  Banner,
  BannerTitle,
  BannerDescription,
  BannerAction,
  BannerClose,
  BannerDismissalsProvider,
  useBannerDismissal,
}
