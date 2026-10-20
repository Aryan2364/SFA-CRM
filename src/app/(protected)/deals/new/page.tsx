'use client'

/**
 * Phone "Create opportunity" — docs/phone-plan.md item 6. `POST /api/deals`
 * (gated `deals:create`): `name` and `company_id` required (2026-10-13 spec,
 * see `src/app/api/deals/_handlers.ts`/`deal-dialog.tsx`), stage usable only
 * at create time. Everything else — contact, value, probability, close
 * date, source, remarks — is optional. No "More details" disclosure
 * (owner decision, kept consistent with `/orders/new`): every optional
 * field shows inline, in the order it is most often filled in.
 *
 * Desktop has no standalone create URL (the list's own dialog,
 * `deal-dialog.tsx`, is what desktop uses), so a desktop visit here
 * redirects to the Deals list, same pattern as `/expenses/new`.
 *
 * `?account=<id>` prefills the account, per the shared URL contract — a
 * caller arriving from an account's detail screen does not have to search
 * for the account they just came from.
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'

type CompanyRow = { id: string; name: string }
type Stage = { id: string; name: string; stage_type: 'Open' | 'Closed' | null }

const REQUEST_TIMEOUT_MS = 15000

async function fetchWithDeadline(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

export default function NewDealPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const accountPrefillId = searchParams.get('account')

  const [name, setName] = useState('')
  const [account, setAccount] = useState<PickerOption | null>(null)
  const [stage, setStage] = useState<PickerOption | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [value, setValue] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [contact, setContact] = useState<PickerOption | null>(null)
  const [source, setSource] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = Boolean(name || account || value || closeDate || contact || source || remarks)
  const { warning } = usePhoneFormGuard(changed)

  usePhoneAppBar({ title: 'Create opportunity', back: '/deals' })

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace('/deals')
      return
    }
    fetchWithDeadline('/api/deals/stages')
      .then(r => (r.ok ? r.json() : []))
      .then(rows => setStages(Array.isArray(rows) ? rows : []))
      .catch(() => setStages([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, router])

  // Prefill the account from ?account=, read directly by id — same call as
  // `/parties/contacts/new`. A company outside the caller's scope is a 404,
  // which leaves the picker empty.
  useEffect(() => {
    if (!accountPrefillId || account) return
    let live = true
    fetchWithDeadline(`/api/companies/${encodeURIComponent(accountPrefillId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: CompanyRow | null) => {
        if (live && d) setAccount({ id: d.id, label: d.name })
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountPrefillId])

  if (layout === 'desktop') return null

  const openStages = stages.filter(s => s.stage_type !== 'Closed')

  async function searchCompanies(q: string): Promise<PickerOption[]> {
    const res = await fetchWithDeadline(`/api/companies?q=${encodeURIComponent(q)}`)
    if (!res.ok) throw new Error('failed')
    const rows = (await res.json()) as CompanyRow[]
    return Array.isArray(rows) ? rows.map(r => ({ id: r.id, label: r.name })) : []
  }

  async function searchContacts(q: string): Promise<PickerOption[]> {
    const query = account ? `?companyId=${account.id}&q=${encodeURIComponent(q)}` : `?q=${encodeURIComponent(q)}`
    const res = await fetchWithDeadline(`/api/contacts${query}`)
    if (!res.ok) throw new Error('failed')
    const rows = (await res.json()) as CompanyRow[]
    return Array.isArray(rows) ? rows.map(r => ({ id: r.id, label: r.name })) : []
  }

  async function save() {
    if (saving) return
    setError(null)
    if (!name.trim()) {
      setError('Enter a name for this opportunity.')
      return
    }
    if (!account) {
      setError('Choose the account this opportunity is for.')
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
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company_id: account.id,
          contact_id: contact?.id || null,
          deal_stage_id: stage?.id || null,
          expected_value: value.trim() || null,
          expected_close_date: closeDate || null,
          source: source.trim() || null,
          remarks: remarks.trim() || null,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !body.id) {
        setError(
          body.error ??
            (res.status === 403
              ? 'Only someone who can create opportunities can save this. Ask an administrator for access.'
              : 'Could not save this opportunity.')
        )
        return
      }
      toast('Opportunity created.', 'success')
      router.push(`/deals/${body.id}`)
    } catch {
      setError('The connection dropped. Nothing has been saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-body text-danger">{error}</p> : null}

      <PhoneForm saving={saving} onSave={save} changed={changed} saveLabel="Save opportunity">
        <PhoneFormField label="Opportunity name" required>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="What is being sold"
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Account" required>
          <PickerSheetField
            label="Account"
            placeholder="Choose the account"
            value={account}
            onChange={option => {
              setAccount(option)
              setContact(null)
            }}
            fetchOptions={searchCompanies}
          />
        </PhoneFormField>

        <PhoneFormField label="Stage">
          <StaticPickerSheetField
            label="Stage"
            placeholder="No stage yet"
            value={stage}
            onChange={setStage}
            options={openStages.map(s => ({ id: s.id, label: s.name }))}
          />
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
          <Input
            type="date"
            value={closeDate}
            onChange={e => setCloseDate(e.target.value)}
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Source">
          <Input
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="Where this opportunity came from"
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Remarks">
          <Textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="Optional"
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>
      </PhoneForm>
      {warning}
    </div>
  )
}
