'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

/**
 * The manager edit's own confirmation. Separate from `DecisionDialog` because
 * this one states what is about to happen to the LINES — the four decisions
 * change a status, this rewrites the owner's week. Moved out of
 * `PlanReviewPanel` unchanged so the phone review screen asks the same thing.
 * It is a small dialog, so on a phone the kit makes it a bottom sheet.
 */
export function SaveEditDialog({
  open,
  ownerName,
  note,
  busy,
  onNoteChange,
  onClose,
  onSave,
}: {
  open: boolean
  ownerName: string
  note: string
  busy: boolean
  onNoteChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const noteUnsaved = useUnsavedChanges({
    changed: note.trim().length > 0,
    noun: 'note',
    mode: 'create',
  })

  return (
    <Dialog
      open={open}
      onOpenChange={noteUnsaved.guard(next => {
        if (!next && !busy) onClose()
      })}
    >
      {noteUnsaved.warning}
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save changes to this plan</DialogTitle>
          <DialogDescription>
            {`The plan moves to Edited by Manager and ${ownerName} is notified. They will see exactly which lines you changed. You can still approve or reject it afterwards.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor="edit-note">Note to {ownerName} (optional)</Label>
          <Textarea
            id="edit-note"
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            rows={3}
            autoFocus
            className="mt-1.5 text-[16px] sm:text-body"
            placeholder="Why you changed the plan."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
