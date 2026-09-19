'use client'

/**
 * P1-T16 Step 2 — the Add Contact dialog. `REBUILD-PLAN.md` §3.4.
 *
 * "Add Contact opens a dialog with the Company name pre-filled and locked. On
 * save the dialog closes and the user is back on the Company page, able to add
 * another or finish."
 *
 * The company is LOCKED rather than merely pre-filled: this dialog is reached
 * from one company's page, so the company is context, not a choice. A contact
 * that should belong somewhere else is created from that company's page — or
 * linked to a second company afterwards, which §3.4's many-to-many allows and
 * this dialog deliberately does not try to do in one step.
 *
 * ⚠️ Uses `ui/dialog.tsx`, not the legacy `Modal.tsx` that the Parties list's
 * own Add/Edit dialog still uses. Nothing here migrates that one.
 *
 * The write is `POST /api/contacts` with `company_ids: [companyId]` — the same
 * endpoint the Contacts tab uses. There is no second create path.
 *
 * F22: the Contacts tab itself has no company to lock to — there is no "one
 * company's page" this dialog was opened from. `companyId`/`companyName`
 * become optional for that caller, which instead passes `companies` (every
 * company the picker offers) and gets a `SearchableSelect` in the same slot
 * the locked `Input` occupies everywhere else. Which company owns a contact
 * still has to be a real choice made before saving — `validate()` requires
 * one when there is no fixed `companyId`.
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
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { checkEmail, checkMobile } from '@/lib/validation'

import type { NamedRef, UserRef } from './party-masters'

export type CreatedContact = { id: string; name: string; mobile: string }

const BLANK = {
  name: '',
  mobile: '',
  alternate_mobile: '',
  whatsapp: '',
  email: '',
  designation: '',
  contact_type_id: '',
  owner_user_id: '',
  notes: '',
}

export function ContactDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  companies,
  contactTypes,
  users,
  markPrimary,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit together with `companyName` and pass `companies` instead to let
   *  the user pick — see the F22 note above. */
  companyId?: string
  /** Shown in the locked field. This is the whole point of the dialog. */
  companyName?: string
  /** Picker options when `companyId` is not fixed. Ignored otherwise. */
  companies?: NamedRef[]
  contactTypes: NamedRef[]
  users: UserRef[]
  /**
   * Whether this contact's link should be flagged `is_primary`.
   *
   * ⚠️ `company_contacts.is_primary` is read TWO ways in this codebase and they
   * disagree:
   *   - `POST /api/contacts` SETS it from `primary_company_id`, i.e. "which of
   *     this contact's companies is their primary one" (_handlers.ts:134).
   *   - The company page READS it as "which of this company's contacts is the
   *     primary contact" — it renders a Primary badge and sorts
   *     `is_primary desc` (`companies/[id]/page.tsx`, `_shape.ts:72`).
   *
   * Sending it for every contact satisfies the first reading and breaks the
   * second: two contacts, each with one company, both come back flagged and the
   * company page shows TWO Primary badges. Observed, not theorised.
   *
   * So the caller decides, and passes true only for a company's FIRST contact —
   * which is true under both readings at once.
   */
  markPrimary?: boolean
  onCreated: (contact: CreatedContact) => void
}) {
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [pickedCompanyId, setPickedCompanyId] = useState('')

  // A dialog that reopens holding the last contact's details would silently
  // create a duplicate on a double save. Reset on every open, not on close —
  // closing mid-animation would otherwise blank the fields in view.
  useEffect(() => {
    if (open) { setForm(BLANK); setErrors({}); setSaving(false); setPickedCompanyId('') }
  }, [open])

  /* Setting a field clears its error — a message that outlived the problem
     tells the user the form still objects when it no longer does. Re-validated
     on the next save, not per keystroke. */
  const set = (key: keyof typeof BLANK) => (value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => {
      if (!(key in e) && !('form' in e)) return e
      const { [key as string]: _cleared, form: _formError, ...rest } = e
      return rest
    })
  }

  /**
   * The same `src/lib/validation.ts` the route runs, so the message the user
   * reads inline is the message the server would have returned. §3.4's two
   * compulsory fields — Name and Mobile — are checked here as well because the
   * route answers them with a 400 and a toast, which §7.1 forbids for a
   * field-level error.
   */
  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = 'Enter the contact person’s name.'
    if (!form.mobile.trim()) next.mobile = 'Enter a mobile number.'
    if (!companyId && !pickedCompanyId) next.company = 'Select a company.'

    const mobile = checkMobile(form.mobile, 'Mobile Number')
    if (form.mobile.trim() && mobile) next.mobile = mobile
    const alt = checkMobile(form.alternate_mobile, 'Alternate Number')
    if (alt) next.alternate_mobile = alt
    const wa = checkMobile(form.whatsapp, 'WhatsApp Number')
    if (wa) next.whatsapp = wa
    const email = checkEmail(form.email)
    if (email) next.email = email

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    const targetCompanyId = companyId ?? pickedCompanyId

    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        alternate_mobile: form.alternate_mobile.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        designation: form.designation.trim() || null,
        contact_type_id: form.contact_type_id || null,
        owner_user_id: form.owner_user_id || null,
        notes: form.notes.trim() || null,
        // §3.4 is plural on the wire even when it is one company here.
        company_ids: [targetCompanyId],
        ...(markPrimary ? { primary_company_id: targetCompanyId } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      // A server-side field message belongs on the field, not in a toast.
      setErrors({ form: (data as { error?: string }).error ?? 'Could not save this contact.' })
      return
    }

    const created = data as CreatedContact
    onCreated({ id: created.id, name: created.name, mobile: created.mobile })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add contact person</DialogTitle>
          <DialogDescription>
            {companyId
              ? <>This person is linked to {companyName}. Name and mobile number are
                required; everything else can be filled in later.</>
              : 'Name, mobile number and company are required; everything else can be filled in later.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-4">
          {companyId ? (
            /*
              Locked, not hidden. The user has to be able to SEE which company
              they are adding a person to — a hidden field would make the
              dialog identical whichever company it was opened from.
            */
            <div className="col-span-12">
              <Label htmlFor="cd-company">Company</Label>
              <Input
                id="cd-company"
                className="mt-1.5"
                value={companyName}
                readOnly
                disabled
                aria-describedby="cd-company-hint"
              />
              <p id="cd-company-hint" className="mt-1.5 text-label text-text-muted">
                Fixed — this contact is being added to this company.
              </p>
            </div>
          ) : (
            /* No single company owns this dialog from the Contacts tab —
               the user chooses which one this contact belongs to. */
            <div className="col-span-12">
              <Label htmlFor="cd-company-picker" required>Company</Label>
              <SearchableSelect
                id="cd-company-picker"
                className="mt-1.5"
                options={Object.fromEntries((companies ?? []).map(c => [c.id, c.name]))}
                value={pickedCompanyId}
                onValueChange={value => {
                  setPickedCompanyId(value)
                  setErrors(e => { const { company: _c, ...rest } = e; return rest })
                }}
                placeholder="Select the company this contact belongs to…"
              />
              <InlineFieldError>{errors.company}</InlineFieldError>
            </div>
          )}

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-name" required>Contact person name</Label>
            <Input
              id="cd-name"
              className="mt-1.5"
              value={form.name}
              onChange={e => set('name')(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              placeholder="Full name"
            />
            <InlineFieldError>{errors.name}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-mobile" required>Mobile number</Label>
            <Input
              id="cd-mobile"
              className="mt-1.5"
              inputMode="numeric"
              value={form.mobile}
              onChange={e => set('mobile')(e.target.value)}
              aria-invalid={Boolean(errors.mobile)}
              placeholder="10 digits"
            />
            <InlineFieldError>{errors.mobile}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-alt">Alternate number</Label>
            <Input
              id="cd-alt"
              className="mt-1.5"
              inputMode="numeric"
              value={form.alternate_mobile}
              onChange={e => set('alternate_mobile')(e.target.value)}
              aria-invalid={Boolean(errors.alternate_mobile)}
            />
            <InlineFieldError>{errors.alternate_mobile}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-whatsapp">WhatsApp number</Label>
            <Input
              id="cd-whatsapp"
              className="mt-1.5"
              inputMode="numeric"
              value={form.whatsapp}
              onChange={e => set('whatsapp')(e.target.value)}
              aria-invalid={Boolean(errors.whatsapp)}
            />
            <InlineFieldError>{errors.whatsapp}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-email">Email</Label>
            <Input
              id="cd-email"
              className="mt-1.5"
              type="email"
              value={form.email}
              onChange={e => set('email')(e.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
            <InlineFieldError>{errors.email}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-designation">Designation</Label>
            <Input
              id="cd-designation"
              className="mt-1.5"
              value={form.designation}
              onChange={e => set('designation')(e.target.value)}
            />
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-type">Contact type</Label>
            <SearchableSelect
              id="cd-type"
              className="mt-1.5"
              options={Object.fromEntries(contactTypes.map(t => [t.id, t.name]))}
              value={form.contact_type_id}
              onValueChange={set('contact_type_id')}
              placeholder="Select type…"
            />
          </div>

          {/*
            §3.4: "Owner — From Employee Master. Defaults to the Company's
            Owner." Left BLANK here on purpose: the route already applies that
            default when a contact is created against exactly one company, so
            sending an explicit value would override the rule rather than use
            it. Setting it here is the override.
          */}
          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="cd-owner">Owner</Label>
            <SearchableSelect
              id="cd-owner"
              className="mt-1.5"
              options={Object.fromEntries(users.map(u => [u.id, u.name]))}
              value={form.owner_user_id}
              onValueChange={set('owner_user_id')}
              placeholder="Same as the company’s owner"
            />
          </div>

          <div className="col-span-12">
            <Label htmlFor="cd-notes">Notes</Label>
            <Textarea
              id="cd-notes"
              className="mt-1.5"
              rows={3}
              value={form.notes}
              onChange={e => set('notes')(e.target.value)}
            />
          </div>

          {errors.form ? (
            <div className="col-span-12">
              <InlineFieldError>{errors.form}</InlineFieldError>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
