'use client'

/**
 * `/parties/companies/[id]/edit` — phone-only "Edit account" screen.
 *
 * No desktop route exists for this (desktop edits an account from the Edit
 * dialog on the Parties list), so a desktop visitor is redirected to the
 * account detail page.
 *
 * It carries the same fields and rules as the desktop Edit dialog and create
 * form: name, account type (the Account Types master, filtered by Applies to),
 * owner (per the caller's data scope), industry, phones, email, website, GST,
 * notes and the lead-status trio, plus the primary address. It writes through
 * the SAME endpoints — `PUT /api/companies/[id]` for the company's own columns
 * and `POST`/`PUT /api/companies/[id]/addresses` for the primary address — so
 * there is exactly one completeness rule and this screen never re-derives it.
 *
 * Query params:
 *   ?next=<path>  where to go after Save (validated by isSafeReturnPath).
 *                 Falls back to this account's own detail page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { format, parse } from 'date-fns'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { DatePicker } from '@/components/ui/date-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useOwnerChoice, usePartyMasters } from '../../../party-masters'
import {
  AccountDetailFields,
  BLANK_DETAILS,
  validateAccountDetails,
  type AccountDetails,
} from '../../../phone-account-fields'
import { isSafeReturnPath } from '@/lib/session-expiry'
import { checkPincode, firstError, normaliseGstin } from '@/lib/validation'

type Address = {
  id: string
  address_line: string | null
  city: string | null
  state_id: string | null
  pincode: string | null
  is_primary: boolean
}

type Company = {
  id: string
  name: string
  type: string | null
  stage: string | null
  temperature: string | null
  account_kind?: 'Company' | 'Individual'
  contact_person_name: string | null
  mobile_1: string | null
  mobile_2: string | null
  landline?: string | null
  email: string | null
  website: string | null
  gst_number: string | null
  description: string | null
  next_follow_up_date: string | null
  owner_user_id: string | null
  owner: { id: string; name: string } | null
  industry_id: string | null
  gst_required_for_orders?: boolean
  addresses: Address[]
  access?: 'owner-scope' | 'work' | 'view'
}

type NamedOption = { id: string; name: string }

type FormValues = {
  name: string
  contact_person_name: string
  details: AccountDetails
  stage: string
  temperature: string
  next_follow_up_date: string
  addressLine: string
  city: string
  stateId: string
  pincode: string
}

function toFormValues(d: Company): FormValues {
  const primary = d.addresses?.find(a => a.is_primary) ?? d.addresses?.[0] ?? null
  return {
    name: d.name ?? '',
    contact_person_name: d.contact_person_name ?? '',
    details: {
      ...BLANK_DETAILS,
      type: d.type ?? '',
      owner_user_id: d.owner_user_id ?? '',
      industry_id: d.industry_id ?? '',
      mobile_1: d.mobile_1 ?? '',
      mobile_2: d.mobile_2 ?? '',
      landline: d.landline ?? '',
      email: d.email ?? '',
      website: d.website ?? '',
      gst_number: d.gst_number ?? '',
      description: d.description ?? '',
    },
    stage: d.stage ?? '',
    temperature: d.temperature ?? '',
    next_follow_up_date: d.next_follow_up_date ?? '',
    addressLine: primary?.address_line ?? '',
    city: primary?.city ?? '',
    stateId: primary?.state_id ?? '',
    pincode: primary?.pincode ?? '',
  }
}

function useActiveList(path: string): NamedOption[] {
  const [rows, setRows] = useState<NamedOption[]>([])
  useEffect(() => {
    let live = true
    fetch(path)
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => { if (live && Array.isArray(d)) setRows(d as NamedOption[]) })
      .catch(() => {})
    return () => { live = false }
  }, [path])
  return rows
}

/** A master's active names, plus the record's own value if that has been deactivated. */
function withCurrent(rows: NamedOption[], current: string): Record<string, string> {
  const out = Object.fromEntries(rows.map(r => [r.name, r.name]))
  if (current && !(current in out)) out[current] = rows.length > 0 ? `${current} (inactive)` : current
  return out
}

function PhoneEditAccount({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const me = useMe()
  const masters = usePartyMasters()
  const ownerChoice = useOwnerChoice('companies')
  const stages = useActiveList('/api/masters/lead-stages?active=true')
  const temps = useActiveList('/api/masters/lead-temperatures?active=true')

  const nextParam = searchParams.get('next')
  const detailHref = `/parties/companies/${id}`
  const next = isSafeReturnPath(nextParam) ? nextParam : detailHref

  const [company, setCompany] = useState<Company | null>(null)
  const [initial, setInitial] = useState<FormValues | null>(null)
  const [form, setForm] = useState<FormValues | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  usePhoneAppBar({ title: 'Edit account', back: next })

  const canEdit = me ? Boolean(me.permissions?.companies?.edit) : undefined

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/companies/${id}`)
      if (r.status === 404) { setNotFound(true); setLoading(false); return }
      if (!r.ok) throw new Error('failed')
      const d: Company = await r.json()
      setCompany(d)
      const values = toFormValues(d)
      setInitial(values)
      setForm(values)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(
    () => (form && initial ? JSON.stringify(form) !== JSON.stringify(initial) : false),
    [form, initial]
  )

  function patch(p: Partial<FormValues>) {
    setForm(f => (f ? { ...f, ...p } : f))
    setErrors({})
  }

  const kind = company?.account_kind ?? 'Company'
  const showGst = kind !== 'Individual' && company?.gst_required_for_orders !== false

  // Owner: the form's value, which starts as the record's owner. Reassigning is
  // the owner's call (the route answers 403 to a shared member), and a rep on
  // `own` scope may only keep themselves, so the field is locked in both cases
  // and the reason is shown as helper text.
  const sharedLock =
    company && company.access && company.access !== 'owner-scope'
      ? 'Only the owner, or someone whose team includes the owner, can change who owns this account.'
      : undefined

  async function save() {
    if (!company || !form || !initial) return
    const fieldErrors: Record<string, string> = {
      ...validateAccountDetails(showGst ? form.details : { ...form.details, gst_number: '' }),
    }
    if (!form.name.trim()) fieldErrors.name = 'Enter the account name.'
    const pin = firstError(checkPincode(form.pincode))
    if (pin) fieldErrors.pincode = pin
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      toast(Object.values(fieldErrors)[0], 'error')
      return
    }
    setErrors({})
    setSaving(true)
    try {
      // 1. The company's own columns — the same set the desktop Edit sends,
      // plus the fields only its create form carries.
      const d = form.details
      const putBody: Record<string, unknown> = {
        name: form.name.trim(),
        type: d.type || null,
        contact_person_name: form.contact_person_name.trim() || null,
        industry_id: d.industry_id || null,
        mobile_1: d.mobile_1.trim() || null,
        mobile_2: d.mobile_2.trim() || null,
        landline: d.landline.trim() || null,
        email: d.email.trim() || null,
        website: d.website.trim() || null,
        description: d.description.trim() || null,
        stage: form.stage || null,
        temperature: form.temperature || null,
        next_follow_up_date: form.next_follow_up_date || null,
      }
      if (showGst) putBody.gst_number = normaliseGstin(d.gst_number)
      const ownerEditable = ownerChoice.state === 'any' && !sharedLock
      if (ownerEditable && d.owner_user_id && d.owner_user_id !== (company.owner_user_id ?? '')) {
        putBody.owner_user_id = d.owner_user_id
      }
      const r = await fetch(`/api/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      })
      const saved = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((saved as { error?: string }).error ?? 'Could not save the account')
      const warning = (saved as { warning?: string }).warning

      // 2. The primary address — company_addresses, not a `companies` column
      // (src/lib/completeness.ts reads four of its five fields off that row).
      const primary = company.addresses?.find(a => a.is_primary) ?? company.addresses?.[0] ?? null
      const addressBody = {
        address_line: form.addressLine.trim() || null,
        city: form.city.trim() || null,
        state_id: form.stateId || null,
        pincode: form.pincode.trim() || null,
        is_primary: true,
      }
      const hasAddressInput = Boolean(
        form.addressLine.trim() || form.city.trim() || form.stateId || form.pincode.trim()
      )
      if (primary) {
        const ar = await fetch(`/api/companies/${id}/addresses/${primary.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addressBody),
        })
        if (!ar.ok) {
          const body = await ar.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not save the address')
        }
      } else if (hasAddressInput) {
        const ar = await fetch(`/api/companies/${id}/addresses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addressBody),
        })
        if (!ar.ok) {
          const body = await ar.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not save the address')
        }
      }

      if (warning) toast(warning, 'warning')
      else toast('Account updated')
      router.push(next)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this account', 'error')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }

  if (notFound || !company || !form) {
    return (
      <EmptyState
        variant="failed"
        heading="This account is not here"
        actionLabel="Go to Accounts"
        onAction={() => router.push('/parties')}
      >
        It may have been deleted, or the link may point at a record in a different firm.
      </EmptyState>
    )
  }

  if (canEdit === false) {
    return (
      <EmptyState variant="failed" heading="You cannot edit accounts">
        Only someone who can edit accounts can change this record. An
        administrator can change access under Settings, Access Control.
      </EmptyState>
    )
  }

  const followUp = form.next_follow_up_date
    ? parse(form.next_follow_up_date, 'yyyy-MM-dd', new Date())
    : undefined

  return (
    <PhoneForm onSave={save} saving={saving} saveLabel="Save" changed={changed}>
      <PhoneFormField label="Account name" required hint={errors.name}>
        <Input
          value={form.name}
          onChange={e => patch({ name: e.target.value })}
          aria-invalid={Boolean(errors.name)}
        />
      </PhoneFormField>

      <PhoneFormField label="Contact person">
        <Input
          value={form.contact_person_name}
          onChange={e => patch({ contact_person_name: e.target.value })}
        />
      </PhoneFormField>

      <AccountDetailFields
        values={form.details}
        onChange={p => patch({ details: { ...form.details, ...p } })}
        errors={errors}
        kind={kind}
        masters={masters}
        ownerChoice={ownerChoice}
        ownerValue={form.details.owner_user_id}
        ownerLock={sharedLock}
        extraOwner={company.owner}
        showGst={showGst}
      />

      <PhoneFormField label="Address line">
        <Input value={form.addressLine} onChange={e => patch({ addressLine: e.target.value })} />
      </PhoneFormField>

      <PhoneFormField label="City">
        <Input value={form.city} onChange={e => patch({ city: e.target.value })} />
      </PhoneFormField>

      <PhoneFormField label="State">
        <SearchableSelect
          options={Object.fromEntries(masters.states.map(s => [s.id, s.name]))}
          value={form.stateId}
          onValueChange={v => patch({ stateId: v })}
          placeholder="Select state"
        />
      </PhoneFormField>

      <PhoneFormField label="Pincode" hint={errors.pincode}>
        <Input
          value={form.pincode}
          onChange={e => patch({ pincode: e.target.value })}
          aria-invalid={Boolean(errors.pincode)}
          inputMode="numeric"
        />
      </PhoneFormField>

      <PhoneFormField label="Stage">
        <SearchableSelect
          options={withCurrent(stages, form.stage)}
          value={form.stage}
          onValueChange={v => patch({ stage: v })}
          placeholder="Select stage…"
        />
      </PhoneFormField>

      <PhoneFormField label="Temperature">
        <SearchableSelect
          options={withCurrent(temps, form.temperature)}
          value={form.temperature}
          onValueChange={v => patch({ temperature: v })}
          placeholder="Select temperature…"
        />
      </PhoneFormField>

      <PhoneFormField label="Next follow-up date">
        <DatePicker
          value={followUp}
          onValueChange={d => patch({ next_follow_up_date: d ? format(d, 'yyyy-MM-dd') : '' })}
        />
      </PhoneFormField>

      {errors.form && <InlineFieldError>{errors.form}</InlineFieldError>}
    </PhoneForm>
  )
}

export default function EditCompanyPage() {
  const router = useRouter()
  const { layout } = useLayout()
  const params = useParams<{ id: string }>()
  const id = params.id

  useEffect(() => {
    if (layout === 'desktop') router.replace(`/parties/companies/${id}`)
  }, [layout, router, id])

  if (layout !== 'phone') return null
  return <PhoneEditAccount id={id} />
}
