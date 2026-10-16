'use client'

import * as React from 'react'
import { CheckIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

/**
 * Phone — FRONTEND_RULES_PHONE.md §41.8: the bottom sheet for choices,
 * menus, confirmations and a single short form, built on sheet.tsx with
 * side="bottom" (rule 1).
 *
 *   - Full width, 12px radius on the top corners only, over the backdrop
 *     (rule 2), with a 32x4px drag handle (rule 3).
 *   - Grows with its content up to 90% of the screen minus the top safe
 *     area; beyond that the body scrolls while header and footer stay put
 *     (rule 4).
 *   - Closes on the backdrop, Android back (base-ui's dialog), its close
 *     button, or a swipe down that starts on the handle or the header —
 *     never in the scrolling body (rule 5).
 *   - Footer buttons share its full width, primary on the right, plus the
 *     bottom safe area (rule 6).
 *   - The sheet takes focus itself, never a field, so the keyboard stays
 *     shut until a field is tapped (rule 19).
 *
 * `BottomSheetOption` is a 48px list/menu row; the selected one is
 * primary-subtle with a tick (rule 7).
 *
 *   <BottomSheet open={open} onOpenChange={setOpen} title="Move to stage">
 *     {stages.map(s => (
 *       <BottomSheetOption key={s.id} selected={s.id === current} onSelect={() => move(s)}>
 *         {s.name}
 *       </BottomSheetOption>
 *     ))}
 *   </BottomSheet>
 */

/** A swipe further than this closes the sheet; anything less springs back. */
const SWIPE_CLOSE_PX = 80
/** §41.4 rule 10: swipes starting this close to a side edge belong to the phone. */
const EDGE_PX = 24

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  bodyClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons, secondary first; they share the footer's width. */
  footer?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
}) {
  const frameRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ startY: number; dy: number } | null>(null)

  function popup(): HTMLElement | null {
    return frameRef.current?.parentElement ?? null
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.clientX < EDGE_PX || event.clientX > window.innerWidth - EDGE_PX) return
    drag.current = { startY: event.clientY, dy: 0 }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return
    const dy = Math.max(0, event.clientY - drag.current.startY)
    drag.current.dy = dy
    const el = popup()
    if (el) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    }
  }

  function onPointerEnd() {
    if (!drag.current) return
    const { dy } = drag.current
    drag.current = null
    const el = popup()
    if (el) {
      el.style.transition = ''
      el.style.transform = ''
    }
    if (dy > SWIPE_CLOSE_PX) onOpenChange(false)
  }

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        initialFocus={frameRef}
        className="max-h-[calc(90dvh-var(--safe-top))] gap-0 rounded-t-xl p-0 outline-none"
      >
        <div ref={frameRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          <div className="shrink-0 touch-none" {...dragHandlers}>
            <div className="flex justify-center pt-2 pb-1">
              <span aria-hidden className="h-1 w-8 rounded-full bg-border" />
            </div>
            <div className="flex items-start gap-2 border-b border-border-light py-2 pr-2 pl-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
                <SheetTitle>{title}</SheetTitle>
                {description ? <SheetDescription>{description}</SheetDescription> : null}
              </div>
              <SheetClose
                aria-label="Close"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary active:bg-surface-control"
              >
                <XIcon aria-hidden className="size-5" />
              </SheetClose>
            </div>
          </div>

          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              footer ? 'p-4' : 'p-2 pb-[calc(var(--safe-bottom)+8px)]',
              bodyClassName
            )}
          >
            {children}
          </div>

          {footer ? (
            <div className="flex shrink-0 gap-2 border-t border-border-light px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] [&>*]:min-w-0 [&>*]:flex-1">
              {footer}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function BottomSheetOption({
  selected = false,
  disabled = false,
  onSelect,
  children,
}: {
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-body text-text-primary active:bg-surface-control',
        selected && 'bg-primary-subtle font-medium',
        disabled && !selected && 'text-text-muted'
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <CheckIcon aria-label="Current" className="size-4 shrink-0 text-primary" /> : null}
    </button>
  )
}
