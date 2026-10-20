'use client'

import * as React from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

/**
 * Phone — FRONTEND_RULES_PHONE.md §41.8: the bottom sheet for choices,
 * menus, confirmations and a single short form.
 *
 * Rebuilt on `SheetContent side="bottom"` plus its `SheetHeader` /
 * `SheetBody` / `SheetFooter` parts, which already give this everything
 * it used to hand-roll: the drag handle and swipe-to-close (rule 3/5), the
 * 90%-height-then-scroll body (rule 4), the close button on the header
 * band (rule 6), safe-area padding, and — the actual reason for the
 * rebuild — Android back closing the sheet through `onOpenChange` via
 * `useLayerHistory`'s history-entry bookkeeping inside `SheetContent`,
 * which this file's own hand-rolled pointer-drag version never wired up.
 * A second, independent drag handler here would now double-fire against
 * `SheetContent`'s own drag zone, so it is gone.
 */
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <SheetBody className={bodyClassName}>{children}</SheetBody>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
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
