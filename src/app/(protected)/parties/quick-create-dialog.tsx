'use client'

/**
 * P1-T17 — Quick Create. `REBUILD-PLAN.md` §3.5.
 *
 * "Name + Mobile only. Nothing else." Two fields, and the record is created and
 * marked Incomplete.
 *
 * ---------------------------------------------------------------------------
 * ONE CREATE PATH, NOT THREE
 *
 * A precedent already exists: Daily Activity's "New Prospect" mode creates a
 * party from name + mobile inline (`src/app/api/daily-activity/route.ts`,
 * `new_prospect` branch → `prisma.companies.create`). That is Phase 3's screen
 * and is not edited here — but this dialog deliberately does NOT add a third
 * way to make a company. It posts to the same `/api/companies` the full form
 * and the Parties list both use, with a shorter body.
 *
 * ⚠️ Note for whoever picks up the Daily Activity screen: its `new_prospect`
 * branch writes `prisma.companies.create` DIRECTLY in the route rather than
 * going through the Companies handler, so it skips that route's validation and
 * never calls `recomputeCompanyCompleteness`. A prospect created there carries
 * the column default for `is_complete` rather than a computed value. Pointing
 * it at the shared handler is a route change, and `src/app/api/**` is not this
 * task's to edit.
 *
 * ---------------------------------------------------------------------------
 * COMPLETENESS IS THE SERVER'S ANSWER
 *
 * `src/lib/completeness.ts` computes `is_complete` / `completeness_missing` on
 * every company write, and `POST /api/companies` returns both. This dialog
 * SHOWS what came back. It does not decide what is missing — a second
 * implementation in the UI would drift from the stored string, and that string
 * is what the list, the filter and `scripts/backfill-parties.mjs` all compare.
 */

import { useEffect, useState } from 'react'

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
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkMobile } from '@/lib/validation'

export type QuickCreated = {
  id: string
  name: string
  is_complete: boolean
  completeness_missing: string | null
}

export function QuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a successful create, so the list behind can refresh. */
  onCreated: (company: QuickCreated) => void
}) {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(''); setMobile(''); setErrors({}); setSaving(false) }
  }, [open])

  /**
   * ⚠️ The creator becomes the owner, and this is NOT cosmetic.
   *
   * `POST /api/companies` leaves `owner_user_id` null when the body omits it,
   * and `GET /api/companies` now scopes on `owner_user_id` (P4-T1). An unowned
   * company therefore belongs to nobody and is invisible to every Self- and
   * Team-scoped user — so a sales executive would Quick Create a company, be
   * told it was created, and not find it in the list they are looking at.
   * Observed exactly that before this was added: "Quickfire Agro Supplies"
   * saved with owner null and never appeared for its creator.
   *
   * The full form defaults Owner to the signed-in user and lets them change
   * it; Quick Create has no fields to spare, so it applies the same default
   * silently. `/api/auth/me` is the only place `userId` is exposed — `useMe()`
   * does not carry it.
   */
  useEffect(() => {
    if (!open) return
    let live = true
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(me => { if (live) setOwnerUserId((me as { userId?: string } | null)?.userId ?? null) })
      .catch(() => { if (live) setOwnerUserId(null) })
    return () => { live = false }
  }, [open])

  async function save() {
    if (saving) return

    /*
     * §3.5 makes BOTH compulsory, which is stricter than the route: `POST
     * /api/companies` requires only `name` — a mobile number is optional there
     * because the full form has other ways to reach a company. Quick Create has
     * none, so a record with neither an address nor a number would be a name
     * and nothing else.
     */
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Enter the company name.'
    if (!mobile.trim()) next.mobile = 'Enter a mobile number.'
    const bad = checkMobile(mobile, 'Mobile Number')
    if (mobile.trim() && bad) next.mobile = bad
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        mobile_1: mobile.trim(),
        ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      setErrors({ form: (data as { error?: string }).error ?? 'Could not save this company.' })
      return
    }

    onCreated(data as QuickCreated)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Section 24: 400px, the confirmation width. Two fields do not need more. */}
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Quick create company</DialogTitle>
          <DialogDescription>
            A name and a number is enough to start. The record is saved as
            Incomplete until the rest is filled in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="qc-name" required>Company name</Label>
            <Input
              id="qc-name"
              className="mt-1.5"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(({ name: _n, form: _f, ...rest }) => rest) }}
              aria-invalid={Boolean(errors.name)}
              placeholder="Registered or trading name"
            />
            <InlineFieldError>{errors.name}</InlineFieldError>
          </div>

          <div>
            <Label htmlFor="qc-mobile" required>Mobile number</Label>
            <Input
              id="qc-mobile"
              className="mt-1.5"
              inputMode="numeric"
              value={mobile}
              onChange={e => { setMobile(e.target.value); setErrors(({ mobile: _m, form: _f, ...rest }) => rest) }}
              aria-invalid={Boolean(errors.mobile)}
              placeholder="10 digits"
            />
            <InlineFieldError>{errors.mobile}</InlineFieldError>
          </div>

          <InlineFieldError>{errors.form}</InlineFieldError>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Create company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
