'use client'

/**
 * Phone screen 3 — create account (docs/phone-plan.md §4). Shared URL
 * contract: `/parties/new`. On desktop there is no such URL — the desktop
 * create flow lives at `/parties/companies/new` (its own two-step form), so
 * this route just redirects a desktop visitor to the Accounts list rather
 * than duplicating that flow.
 *
 * This screen calls the SAME `POST /api/companies` the desktop form calls,
 * with the same body shape (`account_kind`, `self_contact_id` /
 * `self_new_person`, …) and the same 409 handling for "this contact is
 * already Self elsewhere" — no new business rule, just a one-column phone
 * form in front of it (§3.3/§3 in REBUILD-PLAN.md, read off
 * `src/app/(protected)/parties/companies/new/page.tsx`).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/contexts/ToastContext'
import { usePartyMasters } from '../party-masters'
import { checkEmail, checkGstin, checkMobile } from '@/lib/validation'
import { cn } from '@/lib/utils'

type AccountKind = 'Company' | 'Individual'

export default function NewAccountPage() {
  const { layout } = useLayout()
  const router = useRouter()

  if (layout === 'desktop') {
    router.replace('/parties?tab=companies')
    return null
  }

  return <PhoneNewAccount />
}

function PhoneNewAccount() {
  usePhoneAppBar({ title: 'New account', back: '/parties' })
  const router = useRouter()
  const { toast } = useToast()
  const masters = usePartyMasters()

  const [kind, setKind] = useState<AccountKind>('Company')
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [gst, setGst] = useState('')
  const [notes, setNotes] = useState('')
  const [personMode, setPersonMode] = useState<'new' | 'existing'>('new')
  const [personName, setPersonName] = useState('')
  const [personMobile, setPersonMobile] = useState('')
  const [existingContact, setExistingContact] = useState<PickerOption | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [selfConflict, setSelfConflict] = useState<{ existingAccountId: string } | null>(null)

  const changed = Boolean(name || mobile || email || gst || notes || personName || personMobile || existingContact)
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (kind === 'Company' && !name.trim()) next.name = 'Enter the account name.'
    if (kind === 'Individual') {
      if (personMode === 'existing' && !existingContact) next.person = 'Pick an existing contact, or switch to "New person".'
      if (personMode === 'new' && !personName.trim() && !name.trim()) next.person = "Enter the person's name."
      if (personMode === 'new') {
        const pm = checkMobile(personMobile, 'Mobile Number')
        if (pm) next.personMobile = pm
      }
    }
    const m = checkMobile(mobile, 'Mobile Number')
    if (m) next.mobile = m
    const e = checkEmail(email)
    if (e) next.email = e
    const g = checkGstin(gst)
    if (g) next.gst = g
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (saving) return
    if (!validate()) return
    setSaving(true)
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || null,
        account_kind: kind,
        ...(kind === 'Individual' && personMode === 'existing' && existingContact
          ? { self_contact_id: existingContact.id }
          : {}),
        ...(kind === 'Individual' && personMode === 'new'
          ? { self_new_person: { name: personName.trim(), mobile: personMobile.trim() || undefined } }
          : {}),
        mobile_1: mobile.trim() || null,
        email: email.trim() || null,
        gst_number: gst.trim() || null,
        description: notes.trim() || null,
        owner_user_id: masters.currentUserId || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      if (res.status === 409 && (data as { existing_account_id?: string }).existing_account_id) {
        setSelfConflict({ existingAccountId: (data as { existing_account_id: string }).existing_account_id })
        return
      }
      setErrors({ form: (data as { error?: string }).error ?? 'Could not save this account.' })
      return
    }

    const created = data as { id: string; name: string }
    const warning = (data as { warning?: string }).warning
    if (warning) toast(warning, 'warning')
    else toast('Account saved.')
    router.push(`/parties/companies/${created.id}`)
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Account kind"
        className="mb-4 inline-flex rounded-lg border border-border-light bg-surface p-1"
      >
        {(['Company', 'Individual'] as const).map(k => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'min-h-11 flex-1 rounded-md px-4 text-body font-medium transition-colors duration-200',
              kind === k ? 'bg-primary text-text-inverse' : 'text-text-secondary'
            )}
          >
            {k}
          </button>
        ))}
      </div>

      <PhoneForm
        saving={saving}
        onSave={save}
        changed={changed}
        onDiscard={() => requestLeave(() => router.push('/parties'))}
      >
        {kind === 'Individual' ? (
          <>
            <div
              role="radiogroup"
              aria-label="Person"
              className="inline-flex rounded-lg border border-border-light bg-surface p-1"
            >
              {([
                { v: 'new', label: 'New person' },
                { v: 'existing', label: 'Existing contact' },
              ] as const).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  role="radio"
                  aria-checked={personMode === opt.v}
                  onClick={() => setPersonMode(opt.v)}
                  className={cn(
                    'min-h-11 flex-1 rounded-md px-3 text-body font-medium transition-colors duration-200',
                    personMode === opt.v ? 'bg-primary text-text-inverse' : 'text-text-secondary'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {personMode === 'new' ? (
              <>
                <PhoneFormField label="Person's name" hint={errors.person}>
                  <Input value={personName} onChange={e => setPersonName(e.target.value)} aria-invalid={Boolean(errors.person)} />
                </PhoneFormField>
                <PhoneFormField label="Person's mobile" hint={errors.personMobile}>
                  <Input
                    inputMode="numeric"
                    value={personMobile}
                    onChange={e => setPersonMobile(e.target.value)}
                    aria-invalid={Boolean(errors.personMobile)}
                  />
                </PhoneFormField>
              </>
            ) : (
              <PhoneFormField label="Existing contact" hint={errors.person}>
                <PickerSheetField
                  label="Contact"
                  value={existingContact}
                  onChange={setExistingContact}
                  fetchOptions={async q => {
                    const r = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`)
                    if (!r.ok) return []
                    const rows = (await r.json()) as { id: string; name: string; mobile?: string | null }[]
                    return Array.isArray(rows)
                      ? rows.map(c => ({ id: c.id, label: c.name, sublabel: c.mobile ?? undefined }))
                      : []
                  }}
                />
              </PhoneFormField>
            )}
          </>
        ) : null}

        <PhoneFormField label="Account name" hint={errors.name}>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            placeholder={kind === 'Individual' ? "Defaults to the person's name" : 'Registered or trading name'}
          />
        </PhoneFormField>

        <PhoneFormField label="Mobile" hint={errors.mobile}>
          <Input inputMode="numeric" value={mobile} onChange={e => setMobile(e.target.value)} aria-invalid={Boolean(errors.mobile)} />
        </PhoneFormField>

        <PhoneFormMore summary="More details">
          <PhoneFormField label="Email" hint={errors.email}>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} />
          </PhoneFormField>
          <PhoneFormField label="GST number" hint={errors.gst}>
            <Input value={gst} onChange={e => setGst(e.target.value.toUpperCase())} aria-invalid={Boolean(errors.gst)} />
          </PhoneFormField>
          <PhoneFormField label="Notes">
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </PhoneFormField>
        </PhoneFormMore>

        {errors.form ? <p className="text-label text-danger">{errors.form}</p> : null}
      </PhoneForm>
      {warning}

      <Dialog open={selfConflict !== null} onOpenChange={open => { if (!open) setSelfConflict(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already the Self contact elsewhere</DialogTitle>
            <DialogDescription>
              This person is already the Self contact of another account. Open
              that account instead, or go back and pick a different person.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSelfConflict(null)}>Close</Button>
            {selfConflict ? (
              <Button nativeButton={false} render={<Link href={`/parties/companies/${selfConflict.existingAccountId}`} />}>
                Open existing account
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
