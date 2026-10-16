'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ActionBar } from '@/components/ui/action-bar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.7: a one-column form
 * whose Save lives in the fixed bottom ActionBar (which is itself
 * keyboard-aware — see action-bar.tsx), with an optional "More details"
 * disclosure and an unsaved-changes guard on the page's own back control.
 *
 * Usage:
 *
 *   <PhoneForm
 *     saving={saving}
 *     onSave={handleSave}
 *     saveLabel="Save"
 *     changed={isChanged(values, saved)}
 *     onDiscard={() => router.push(backHref)}
 *   >
 *     <PhoneFormField label="Name"><Input .../></PhoneFormField>
 *     <PhoneFormField label="Phone"><PhoneInput .../></PhoneFormField>
 *     <PhoneFormMore summary="More details">
 *       <PhoneFormField label="Notes"><Textarea .../></PhoneFormField>
 *     </PhoneFormMore>
 *   </PhoneForm>
 *
 * This is a reduced port of the kit's unsaved-changes.tsx: it guards only
 * this form's own Cancel/back action (passed in as `onDiscard`, called
 * only after the user confirms), not every same-origin link on the page.
 * A page with its own back button should route it through `requestLeave`
 * (returned by `usePhoneFormGuard`) instead of navigating directly.
 */
export function usePhoneFormGuard(changed: boolean) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const pendingAction = React.useRef<(() => void) | null>(null)

  const requestLeave = React.useCallback(
    (leave: () => void) => {
      if (!changed) {
        leave()
        return
      }
      pendingAction.current = leave
      setConfirmOpen(true)
    },
    [changed]
  )

  // The one browser-native exception this guard still allows (no site can
  // style the tab-close/reload warning).
  React.useEffect(() => {
    if (!changed) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [changed])

  const dialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>What you have filled in will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              pendingAction.current?.()
              pendingAction.current = null
            }}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { requestLeave, warning: dialog }
}

export function PhoneForm({
  children,
  onSave,
  saving,
  saveLabel = 'Save',
  secondary,
  changed = false,
  onDiscard,
  className,
}: {
  children: React.ReactNode
  onSave: () => void
  saving?: boolean
  saveLabel?: string
  /** Optional second button, shown before Save (§41.6 rule 8: secondary first). */
  secondary?: React.ReactNode
  /** Drives the unsaved-changes guard on `onDiscard`. */
  changed?: boolean
  /** Called (after confirmation, if `changed`) when the page's back control fires. */
  onDiscard?: () => void
  className?: string
}) {
  const { warning } = usePhoneFormGuard(changed)
  void onDiscard // the page's own back/cancel handler should call usePhoneFormGuard().requestLeave itself

  return (
    <div className={cn('flex flex-col gap-4 pb-24', className)}>
      {children}
      <ActionBar>
        {secondary}
        <Button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="w-full"
        >
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </ActionBar>
      {warning}
    </div>
  )
}

/** One label + control row. 16px inputs / 44px targets are the control's own job (input.tsx). */
export function PhoneFormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-label font-medium text-text-secondary">{label}</label>
      {children}
      {hint ? <p className="text-meta text-text-muted">{hint}</p> : null}
    </div>
  )
}

/** §41.7's optional disclosure for secondary fields, collapsed by default. */
export function PhoneFormMore({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-lg border border-border-light bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-body font-medium text-text-primary">
        {summary}
        <span className="text-text-secondary transition-transform duration-200 group-open:rotate-180">⌄</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border-light p-3">{children}</div>
    </details>
  )
}
