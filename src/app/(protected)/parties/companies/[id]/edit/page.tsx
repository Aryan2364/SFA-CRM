'use client'

/**
 * `/parties/companies/[id]/edit` — phone-only "Edit account" screen.
 *
 * No desktop route exists for this (the desktop Company detail page has no
 * edit affordance at all today — see `../page.tsx`), so a desktop visitor is
 * redirected to the account detail page (ground rule: new phone-only route
 * with no desktop equivalent -> redirect to the matching desktop page).
 *
 * Built to close a dead end: a rep who creates an account on the phone with
 * only Name + Mobile (`/parties/new`) has no way to add the GST number or
 * address `POST /api/orders`'s completeness gate requires
 * (`src/lib/completeness.ts`, `placementBlock` in `src/app/api/orders/route.ts`).
 * This screen is that way back in — it writes through the SAME endpoints the
 * desktop create flow uses (`PUT /api/companies/[id]` for the company's own
 * columns, `POST`/`PUT /api/companies/[id]/addresses` for the primary address),
 * so there is exactly one completeness rule and this screen never re-derives it.
 *
 * Query params:
 *   ?next=<path>  where to go after Save (validated by isSafeReturnPath).
 *                 Falls back to this account's own detail page.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { usePartyMasters } from '../../../party-masters'
import { isSafeReturnPath } from '@/lib/session-expiry'
import {
  checkGstin,
  checkPincode,
  firstError,
  normaliseGstin,
} from '@/lib/validation'

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
  account_kind?: 'Company' | 'Individual'
  gst_number: string | null
  gst_required_for_orders?: boolean
  addresses: Address[]
  access?: string
}

function PhoneEditAccount({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const me = useMe()
  const masters = usePartyMasters()

  const nextParam = searchParams.get('next')
  const detailHref = `/parties/companies/${id}`
  const next = isSafeReturnPath(nextParam) ? nextParam : detailHref

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)

  const [gstNumber, setGstNumber] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [city, setCity] = useState('')
  const [stateId, setStateId] = useState('')
  const [pincode, setPincode] = useState('')
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
      setGstNumber(d.gst_number ?? '')
      const primary = d.addresses?.find(a => a.is_primary) ?? d.addresses?.[0] ?? null
      setAddressLine(primary?.address_line ?? '')
      setCity(primary?.city ?? '')
      setStateId(primary?.state_id ?? '')
      setPincode(primary?.pincode ?? '')
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const showGst = company?.account_kind !== 'Individual' && company?.gst_required_for_orders !== false

  async function save() {
    if (!company) return
    const bad = firstError(
      showGst ? checkGstin(gstNumber) : null,
      checkPincode(pincode)
    )
    if (bad) {
      setErrors({ form: bad })
      toast(bad, 'error')
      return
    }
    setErrors({})
    setSaving(true)
    try {
      // 1. The company's own columns (GST number).
      const putBody: Record<string, unknown> = {}
      if (showGst) putBody.gst_number = normaliseGstin(gstNumber)
      if (Object.keys(putBody).length > 0) {
        const r = await fetch(`/api/companies/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(putBody),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not save the GST number')
        }
      }

      // 2. The primary address — company_addresses, not a `companies` column
      // (src/lib/completeness.ts reads four of its five fields off that row).
      const primary = company.addresses?.find(a => a.is_primary) ?? company.addresses?.[0] ?? null
      const addressBody = {
        address_line: addressLine.trim() || null,
        city: city.trim() || null,
        state_id: stateId || null,
        pincode: pincode.trim() || null,
        is_primary: true,
      }
      const hasAddressInput = Boolean(addressLine.trim() || city.trim() || stateId || pincode.trim())
      if (primary) {
        const r = await fetch(`/api/companies/${id}/addresses/${primary.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addressBody),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not save the address')
        }
      } else if (hasAddressInput) {
        const r = await fetch(`/api/companies/${id}/addresses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addressBody),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not save the address')
        }
      }

      toast('Account updated')
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

  if (notFound || !company) {
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

  return (
    <PhoneForm
      onSave={save}
      saving={saving}
      saveLabel="Save"
      changed
    >
      <PhoneFormField label="Account">
        <Input value={company.name} disabled />
      </PhoneFormField>

      {showGst && (
        <PhoneFormField label="GST Number">
          <Input
            value={gstNumber}
            onChange={e => setGstNumber(e.target.value.toUpperCase())}
            aria-invalid={Boolean(errors.form)}
            placeholder="22AAAAA0000A1Z5"
          />
        </PhoneFormField>
      )}

      <PhoneFormField label="Address line">
        <Input value={addressLine} onChange={e => setAddressLine(e.target.value)} />
      </PhoneFormField>

      <PhoneFormField label="City">
        <Input value={city} onChange={e => setCity(e.target.value)} />
      </PhoneFormField>

      <PhoneFormField label="State">
        <SearchableSelect
          options={Object.fromEntries(masters.states.map(s => [s.id, s.name]))}
          value={stateId}
          onValueChange={setStateId}
          placeholder="Select state"
        />
      </PhoneFormField>

      <PhoneFormField label="Pincode">
        <Input
          value={pincode}
          onChange={e => setPincode(e.target.value)}
          aria-invalid={Boolean(errors.form)}
          inputMode="numeric"
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
