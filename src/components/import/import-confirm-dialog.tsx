'use client'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fmtNumber } from '@/lib/format'

/**
 * "Import N rows?" — the confirmation before a commit. It states the
 * consequences (what is written, what is skipped, that nothing is updated)
 * and names the verb on its button. An import adds records rather than
 * destroying any, so the action is primary, not danger.
 */
export function ImportConfirmDialog({ open, onOpenChange, ready, skipped, noun, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ready: number
  skipped: number
  /** Plural record noun, e.g. "location rows". */
  noun: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Import {fmtNumber(ready)} {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            {skipped > 0
              ? `${fmtNumber(skipped)} row${skipped === 1 ? ' has' : 's have'} problems and will be skipped; download them afterwards to fix and re-upload. `
              : ''}
            Rows that already exist are left exactly as they are. The server checks the file again as it imports.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="primary" onClick={onConfirm}>
            Import {fmtNumber(ready)} {noun}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
