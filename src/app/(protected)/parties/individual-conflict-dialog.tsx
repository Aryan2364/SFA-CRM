'use client'

/**
 * The 409 `POST /api/contacts/[id]/make-individual` answers with when the
 * contact is already the Self contact of another Individual account: "already
 * an Individual account" is not an error to retry, it is a fact with a place
 * to go instead — a styled dialog linking to that account, never a native
 * alert. Shared by the Contact page (where it was first built) and the
 * Contacts tab's row menu, so the two "Make Individual account" actions read
 * and behave identically (global rule 1).
 */

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type IndividualConflict = { message: string; existingAccountId?: string }

export function IndividualConflictDialog({
  conflict,
  onOpenChange,
}: {
  conflict: IndividualConflict | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={conflict !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Already an Individual account</DialogTitle>
          <DialogDescription>{conflict?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Close</Button>} />
          {conflict?.existingAccountId && (
            <Button render={<Link href={`/parties/companies/${conflict.existingAccountId}`} />}>
              Go to that account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
