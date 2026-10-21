'use client'

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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

/**
 * The owner's two confirmations, written once for the desktop page and the
 * phone screen. Moved out of the desktop page unchanged in wording and
 * behaviour; the only addition is `size`, because the kit turns a small
 * dialog into a bottom sheet on a phone (41.8 rule 10) and the phone passes
 * "sm" for the one-field reopen request.
 */

/** Saving would delete lines that have no party — say so first. */
export function PartylessSaveDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: {
  open: boolean
  count: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? 'One line has no party' : `${count} lines have no party`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            A planned line is stored against a party, so saving removes{' '}
            {count === 1 ? 'it' : 'them'} from the plan. Open{' '}
            {count === 1 ? 'the card' : 'each card'} and choose a
            party to keep {count === 1 ? 'it' : 'them'}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Save without {count === 1 ? 'it' : 'them'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Item 7: Request Reopen. */
export function RequestReopenDialog({
  open,
  onOpenChange,
  message,
  onMessageChange,
  sending,
  onSend,
  size = 'md',
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  message: string
  onMessageChange: (value: string) => void
  sending: boolean
  onSend: () => void
  size?: 'sm' | 'md'
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>Request Plan Reopen</DialogTitle>
        </DialogHeader>
        <p className="px-6 text-xs text-text-muted phone:px-0">
          Explain why you need to edit this plan. Your manager will be notified.
        </p>
        <div className="px-6 py-2 phone:px-0">
          <Textarea
            value={message}
            onChange={e => onMessageChange(e.target.value)}
            rows={4}
            placeholder="Reason for reopen request…"
            className="resize-none text-[16px] sm:text-sm"
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
          <Button onClick={onSend} disabled={sending || !message.trim()}>
            {sending ? 'Sending…' : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
