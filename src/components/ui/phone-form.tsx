'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

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
import { whenLayersSettled } from '@/components/ui/sheet'
import { useRegisterLeaveGuard } from '@/components/shell/phone-leave-guard'

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
 * Reduced port of the kit's unsaved-changes.tsx. The phone shell's back arrow
 * and tab bar are guarded automatically (phone-leave-guard.tsx); a page's own
 * Cancel should route through `requestLeave`. The browser's own Back (Android
 * back) is not caught, as in the kit: a guard that traps it is worse than the loss.
 */
export function usePhoneFormGuard(changed: boolean) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const pendingAction = React.useRef<(() => void) | null>(null)
  // Leave chosen: runs once the dialog has closed and its history entry is gone.
  const afterClose = React.useRef<(() => void) | null>(null)
  const changedRef = React.useRef(changed)
  React.useEffect(() => {
    changedRef.current = changed
  })

  const requestLeave = React.useCallback(
    (leave: () => void) => {
      if (!changedRef.current) {
        leave()
        return
      }
      pendingAction.current = leave
      setConfirmOpen(true)
    },
    []
  )

  // Registered with the phone shell, so its back arrow and tab bar ask first
  // without the page having to route them through requestLeave.
  useRegisterLeaveGuard(href => {
    if (!changedRef.current) return false
    pendingAction.current = () => router.push(href)
    setConfirmOpen(true)
    return true
  })

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
    <AlertDialog
      open={confirmOpen}
      onOpenChange={next => {
        if (!next) {
          setConfirmOpen(false)
          pendingAction.current = null
        }
      }}
      onOpenChangeComplete={isOpen => {
        const leave = afterClose.current
        if (isOpen || !leave) return
        afterClose.current = null
        // The warning holds a history entry on phone; leave only after it has gone.
        void whenLayersSettled().then(leave)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>What you have filled in will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              afterClose.current = pendingAction.current
              pendingAction.current = null
              setConfirmOpen(false)
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
  // The shell's back arrow and tab bar are guarded through the registry in
  // usePhoneFormGuard; the page's own Cancel should use requestLeave. onDiscard
  // is kept for call-site compatibility.
  void onDiscard

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

/**
 * One label + control row. 16px inputs / 44px targets are the control's own
 * job (input.tsx). `required` draws the same red asterisk the desktop
 * `Label` component draws (FRONTEND_RULES.md §11.3) — pass it whenever the
 * API route this field feeds actually requires the value.
 */
export function PhoneFormField({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-label font-medium text-text-secondary">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">*</span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="text-meta text-text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * Previously an optional disclosure ("More details") that hid secondary
 * fields behind a tap. The owner does not want fields hidden behind a
 * button, so this now just renders its children inline — kept as a
 * pass-through wrapper (rather than deleted) so every existing call site
 * (`<PhoneFormMore summary="More details">…</PhoneFormMore>`) keeps working
 * unchanged while showing all its fields directly, no toggle.
 */
export function PhoneFormMore({
  children,
}: {
  summary?: string
  children: React.ReactNode
}) {
  return <div className="flex flex-col gap-4">{children}</div>
}
