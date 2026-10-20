'use client'

/**
 * Phone "Edit opportunity" — round 2 item 1. `PUT /api/deals/[id]` (gated
 * `deals:edit`, see `src/app/api/deals/[id]/_handlers.ts`), limited to the
 * fields the owner asked for on phone: name, expected value, expected close
 * date, contact. Account/stage/owner are deliberately left alone here —
 * stage moves through "Move to stage" on the detail screen, and account/
 * owner changes are an owner-scope-only desktop action (see the PUT route's
 * comment on `found.access !== 'owner-scope'`).
 *
 * Desktop has no standalone edit URL (the list's own dialog is what desktop
 * uses), so a desktop visit here redirects to the Deal's record page.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'

type Deal = {
  id: string
  name: string
  expected_value: number
  expected_close_date: string | null
  company_id: string | null
  contact: { id: string; name: string } | null
}

type ContactRow = { id: string; name: string }

export default function EditDealPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [contact, setContact] = useState<PickerOption | null>(null)
  const [initial, setInitial] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  usePhoneAppBar({ title: 'Edit opportunity', back: `/deals/${params.id}` })

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace(`/deals/${params.id}`)
      return
    }
    let live = true
    fetch(`/api/deals/${params.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Deal) => {
        if (!live) return
        setCompanyId(d.company_id)
        setName(d.name)
        setValue(d.expected_value ? String(d.expected_value) : '')
        setCloseDate(d.expected_close_date ?? '')
        setContact(d.contact ? { id: d.contact.id, label: d.contact.name } : null)
        setInitial(JSON.stringify({ name: d.name, value: d.expected_value, closeDate: d.expected_close_date, contact: d.contact?.id ?? null }))
        setLoading(false)
      })
      .catch(() => {
        if (live) { setFailed(true); setLoading(false) }
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, router, params.id])

  const changed = !loading && JSON.stringify({ name, value: value.trim() ? Number(value) : 0, closeDate: closeDate || null, contact: contact?.id ?? null }) !== initial
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  if (layout === 'desktop') return null

  async function searchContacts(q: string): Promise<PickerOption[]> {
    const query = companyId ? `?companyId=${companyId}&q=${encodeURIComponent(q)}` : `?q=${encodeURIComponent(q)}`
    const res = await fetch(`/api/contacts${query}`)
    if (!res.ok) throw new Error('failed')
    const rows = (await res.json()) as ContactRow[]
    return Array.isArray(rows) ? rows.map(r => ({ id: r.id, label: r.name })) : []
  }

  async function save() {
    if (saving) return
    setError(null)
    if (!name.trim()) {
      setError('Enter a name for this opportunity.')
      return
    }
    if (value.trim()) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) {
        setError('Enter the expected value as a number.')
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/deals/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company_id: companyId,
          contact_id: contact?.id || null,
          expected_value: value.trim() || null,
          expected_close_date: closeDate || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not save these changes.')
        return
      }
      toast('Opportunity updated.', 'success')
      router.push(`/deals/${params.id}`)
    } catch {
      setError('The connection dropped. Nothing has been saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="px-1 py-6 text-body text-text-muted">Loading…</div>
  }
  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">This opportunity could not be loaded</p>
        <button type="button" onClick={() => router.push(`/deals/${params.id}`)} className="text-body text-primary">
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-body text-danger">{error}</p> : null}
      <PhoneForm saving={saving} onSave={save} changed={changed} saveLabel="Save changes">
        <PhoneFormField label="Opportunity name" required>
          <Input value={name} onChange={e => setName(e.target.value)} style={{ fontSize: 16 }} />
        </PhoneFormField>

        <PhoneFormField label="Expected value">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="0"
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Expected closing date">
          <Input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={{ fontSize: 16 }} />
        </PhoneFormField>

        <PhoneFormField label="Contact">
          <PickerSheetField
            label="Contact"
            placeholder="No contact"
            value={contact}
            onChange={setContact}
            fetchOptions={searchContacts}
          />
        </PhoneFormField>
      </PhoneForm>
      {warning}
    </div>
  )
}
