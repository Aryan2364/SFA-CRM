'use client'

import { useEffect, useState } from 'react'

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
import { DECISIONS, type DecisionKey } from './approval-types'

/**
 * The one confirmation for all four manager decisions.
 *
 * §5.2 gives the manager a Note on the plan, and three of the four verbs carry
 * it as their `comment`. Two of them REQUIRE it — `reject` and `suggest` return
 * 400 without one — so the field is marked required and the submit button is
 * disabled until it has text, rather than letting the request go and rendering
 * the API's 400 as a toast.
 *
 * It is a `Dialog`, which base-ui renders through a portal to `<body>`: no
 * ancestor's transform or overflow can clip it, and it sits above the top bar.
 * Nothing on this screen uses `confirm()` or `prompt()`.
 */
export function DecisionDialog({
  decision,
  ownerName,
  busy,
  onConfirm,
  onClose,
}: {
  /** `null` closes it. The key also chooses the wording and the button colour. */
  decision: DecisionKey | null
  ownerName: string
  busy: boolean
  onConfirm: (comment: string) => void
  onClose: () => void
}) {
  const [comment, setComment] = useState('')

  // Clear between openings so a comment typed for a Hold is not submitted as
  // the reason for a Reject.
  useEffect(() => {
    if (decision) setComment('')
  }, [decision])

  const spec = decision ? DECISIONS[decision] : null
  const needsComment = spec?.commentRequired ?? false
  const ready = !needsComment || comment.trim().length > 0

  return (
    <Dialog
      open={decision !== null}
      onOpenChange={open => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{spec?.label ?? ''}</DialogTitle>
          <DialogDescription>
            {spec
              ? `${spec.label} the weekly plan for ${ownerName}. It moves to ${spec.resultStatus}.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor="decision-comment">
            Note to {ownerName}
            {needsComment ? '' : ' (optional)'}
          </Label>
          <Textarea
            id="decision-comment"
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            autoFocus
            // 16px on mobile — anything smaller makes iOS zoom the page on focus.
            className="mt-1.5 text-[16px] sm:text-body"
            placeholder={
              needsComment
                ? 'Say what needs to change. This is required.'
                : 'Anything the plan owner should know.'
            }
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={decision === 'reject' ? 'danger' : 'primary'}
            onClick={() => onConfirm(comment.trim())}
            disabled={!ready || busy}
          >
            {busy ? 'Working…' : spec?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
