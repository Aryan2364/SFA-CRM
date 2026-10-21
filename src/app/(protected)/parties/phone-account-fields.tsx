'use client'

/**
 * The account fields the phone "New account" and "Edit account" screens share,
 * so the two cannot drift from each other or from the desktop form
 * (`parties/companies/new/page.tsx`, and the Edit dialog on `parties/page.tsx`).
 *
 * Nothing here invents a rule: the validators are the same `src/lib/validation`
 * functions (with the same labels) that `POST`/`PUT /api/companies` run, the
 * Account type list is the Account Types master filtered by its Applies to
 * (`/api/masters/lead-types?active=true`), and Owner follows `useOwnerChoice`.
 */

import { useEffect, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PhoneFormField } from '@/components/ui/phone-form'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { checkEmail, checkGstin, checkLandline, checkMobile } from '@/lib/validation'
import type { OwnerChoice, PartyMasters } from './party-masters'

export type AccountKind = 'Company' | 'Individual'

/** `GET /api/masters/lead-types` row, narrowed to what the picker needs. */
export type AccountTypeOption = {
  id: string
  name: string
  applies_to?: 'Company' | 'Individual' | 'Both'
}

export type AccountDetails = {
  type: string
  owner_user_id: string
  industry_id: string
  mobile_1: string
  mobile_2: string
  landline: string
  email: string
  website: string
  gst_number: string
  description: string
}

export const BLANK_DETAILS: AccountDetails = {
  type: '',
  owner_user_id: '',
  industry_id: '',
  mobile_1: '',
  mobile_2: '',
  landline: '',
  email: '',
  website: '',
  gst_number: '',
  description: '',
}

/** Active account types, once. The list is short and shared by both screens. */
export function useAccountTypes(): AccountTypeOption[] {
  const [options, setOptions] = useState<AccountTypeOption[]>([])
  useEffect(() => {
    let live = true
    fetch('/api/masters/lead-types?active=true')
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => { if (live && Array.isArray(d)) setOptions(d as AccountTypeOption[]) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return options
}

/**
 * The types that apply to this kind. The type already on the record stays
 * listed even when it is deactivated or no longer applies, so it never reads
 * as unset (the desktop Edit dialog does the same).
 */
export function visibleAccountTypes(
  all: AccountTypeOption[],
  kind: AccountKind,
  current: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of all) {
    if (!t.applies_to || t.applies_to === 'Both' || t.applies_to === kind) out[t.name] = t.name
  }
  if (current && !(current in out)) out[current] = `${current} (inactive)`
  return out
}

/** The server's own checks, with its own labels, so the message matches a 400. */
export function validateAccountDetails(d: AccountDetails): Record<string, string> {
  const next: Record<string, string> = {}
  const m1 = checkMobile(d.mobile_1, 'Mobile Number 1')
  if (m1) next.mobile_1 = m1
  const m2 = checkMobile(d.mobile_2, 'Mobile Number 2')
  if (m2) next.mobile_2 = m2
  const land = checkLandline(d.landline)
  if (land) next.landline = land
  const gst = checkGstin(d.gst_number)
  if (gst) next.gst_number = gst
  const email = checkEmail(d.email)
  if (email) next.email = email
  return next
}

/**
 * Account type, Owner, Industry, phones, email, website, GST and notes.
 * `ownerLock` overrides Owner's helper text (the edit screen uses it when the
 * caller is a shared member who may not reassign); otherwise the owner field
 * follows the section's data scope.
 */
export function AccountDetailFields({
  values,
  onChange,
  errors,
  kind,
  masters,
  ownerChoice,
  ownerValue,
  ownerLock,
  showGst = true,
  gstHint,
  clearStaleType = false,
  extraOwner,
}: {
  values: AccountDetails
  onChange: (patch: Partial<AccountDetails>) => void
  errors: Record<string, string>
  kind: AccountKind
  masters: PartyMasters
  ownerChoice: OwnerChoice
  /** What Owner shows: the form value, or the creator's own id as the fallback. */
  ownerValue: string
  ownerLock?: string
  showGst?: boolean
  gstHint?: string
  clearStaleType?: boolean
  extraOwner?: { id: string; name: string } | null
}) {
  const types = useAccountTypes()
  const typeOptions = useMemo(
    () => visibleAccountTypes(types, kind, values.type),
    [types, kind, values.type]
  )
  // New account only: a type that stops applying when the kind is switched is
  // cleared rather than submitted (the desktop form does the same). On Edit the
  // record's own type stays, shown as inactive if it no longer applies.
  useEffect(() => {
    if (!clearStaleType || !values.type || !types.length) return
    const ok = types.some(
      t => t.name === values.type && (!t.applies_to || t.applies_to === 'Both' || t.applies_to === kind)
    )
    if (!ok) onChange({ type: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, types])

  const ownerLocked = Boolean(ownerLock) || ownerChoice.state !== 'any'
  const ownerNote = ownerLock ?? (ownerChoice.state === 'self' ? ownerChoice.message : undefined)

  return (
    <>
      <PhoneFormField label={kind === 'Individual' ? 'Type' : 'Account type'} hint="Optional.">
        <SearchableSelect
          options={typeOptions}
          value={values.type}
          onValueChange={v => onChange({ type: v })}
          placeholder="Not set"
        />
      </PhoneFormField>

      <PhoneFormField label="Owner" hint={ownerNote}>
        <SearchableSelect
          options={{
            // The record's current owner stays listed even if now inactive.
            ...(extraOwner ? { [extraOwner.id]: extraOwner.name } : {}),
            ...Object.fromEntries(masters.users.map(u => [u.id, u.name])),
          }}
          value={ownerValue}
          onValueChange={v => onChange({ owner_user_id: v })}
          placeholder="Select an employee…"
          disabled={ownerLocked}
        />
      </PhoneFormField>

      <PhoneFormField label="Industry / segment">
        <SearchableSelect
          options={Object.fromEntries(masters.industries.map(i => [i.id, i.name]))}
          value={values.industry_id}
          onValueChange={v => onChange({ industry_id: v })}
          placeholder="Select industry…"
        />
      </PhoneFormField>

      <PhoneFormField label="Phone" hint={errors.mobile_1}>
        <Input
          type="tel"
          inputMode="numeric"
          value={values.mobile_1}
          onChange={e => onChange({ mobile_1: e.target.value })}
          aria-invalid={Boolean(errors.mobile_1)}
          placeholder="10 digits"
        />
      </PhoneFormField>

      <PhoneFormField label="Alternate phone" hint={errors.mobile_2}>
        <Input
          type="tel"
          inputMode="numeric"
          value={values.mobile_2}
          onChange={e => onChange({ mobile_2: e.target.value })}
          aria-invalid={Boolean(errors.mobile_2)}
        />
      </PhoneFormField>

      <PhoneFormField label="Landline" hint={errors.landline}>
        <Input
          type="tel"
          inputMode="tel"
          value={values.landline}
          onChange={e => onChange({ landline: e.target.value })}
          aria-invalid={Boolean(errors.landline)}
          placeholder="022 2654 1234"
        />
      </PhoneFormField>

      <PhoneFormField label="Email" hint={errors.email}>
        <Input
          type="email"
          value={values.email}
          onChange={e => onChange({ email: e.target.value })}
          aria-invalid={Boolean(errors.email)}
        />
      </PhoneFormField>

      <PhoneFormField label="Website">
        <Input
          value={values.website}
          onChange={e => onChange({ website: e.target.value })}
          placeholder="example.com"
          autoCapitalize="none"
        />
      </PhoneFormField>

      {showGst ? (
        <PhoneFormField label="GST number" hint={errors.gst_number ?? gstHint}>
          <Input
            value={values.gst_number}
            onChange={e => onChange({ gst_number: e.target.value.toUpperCase() })}
            aria-invalid={Boolean(errors.gst_number)}
            placeholder="15 characters"
          />
        </PhoneFormField>
      ) : null}

      <PhoneFormField label="Notes">
        <Textarea rows={3} value={values.description} onChange={e => onChange({ description: e.target.value })} />
      </PhoneFormField>
    </>
  )
}
