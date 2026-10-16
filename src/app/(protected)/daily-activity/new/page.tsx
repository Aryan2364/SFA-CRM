'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { OTHER_VISIT_TYPE } from '@/components/daily-activity/add-meeting-dialog'
import { toDateStr } from '@/components/daily-activity/types'

/**
 * Log meeting — phone create form for POST /api/daily-activity.
 *
 * Required up front: Account, Visit type. "More details": Opportunity
 * (filtered to the account's open deals), Contact. After save, offers
 * "Set next meeting" (reused from the existing NextMeetingDialog /
 * next-meeting API), then returns to /today.
 *
 * ?account=<id> prefills the account (resolved by name through
 * /api/companies?q=). ?deal=<id> is accepted as a hint but the opportunity
 * picker still only lists that account's own open deals.
 */

const VISIT_TYPE_OPTIONS: PickerOption[] = [
  { id: 'Dealer', label: 'Dealer' },
  { id: 'Distributor', label: 'Distributor' },
  { id: 'Retailer', label: 'Retailer' },
  { id: OTHER_VISIT_TYPE, label: 'Other' },
]

export default function LogMeetingPage() {
  const { layout } = useLayout()
  const router = useRouter()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/daily-activity')
  }, [layout, router])

  if (layout === 'desktop') return null
  return (
    <Suspense fallback={null}>
      <LogMeetingForm />
    </Suspense>
  )
}

function LogMeetingForm() {
  usePhoneAppBar({ title: 'Log meeting', back: '/today' })
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const presetAccountId = searchParams.get('account')
  const presetDealId = searchParams.get('deal')

  const [account, setAccount] = useState<PickerOption | null>(null)
  const [visitType, setVisitType] = useState<PickerOption | null>(null)
  const [deal, setDeal] = useState<PickerOption | null>(null)
  const [contact, setContact] = useState<PickerOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [createdVisitId, setCreatedVisitId] = useState<string | null>(null)

  const changed = !!account || !!visitType || !!deal || !!contact
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  // Prefill account from ?account=
  useEffect(() => {
    if (!presetAccountId || account) return
    ;(async () => {
      try {
        const r = await fetch(`/api/companies/${presetAccountId}`)
        if (!r.ok) return
        const c = await r.json()
        if (c?.id) setAccount({ id: c.id, label: c.name })
      } catch {
        /* best-effort prefill only */
      }
    })()
  }, [presetAccountId, account])

  const fetchAccounts = useCallback(async (q: string): Promise<PickerOption[]> => {
    const r = await fetch(`/api/companies?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    const d = await r.json()
    const rows = Array.isArray(d) ? d : d.rows ?? []
    return rows.map((c: { id: string; name: string; type?: string }) => ({
      id: c.id,
      label: c.name,
      sublabel: c.type || undefined,
    }))
  }, [])

  const fetchDeals = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (!account) return []
      const r = await fetch(`/api/deals?companyId=${account.id}&q=${encodeURIComponent(q)}`)
      if (!r.ok) return []
      const d = await r.json()
      const rows = (Array.isArray(d) ? d : d.rows ?? []) as { id: string; name: string; closed_at?: string | null }[]
      return rows.filter(r2 => !r2.closed_at).map(r2 => ({ id: r2.id, label: r2.name }))
    },
    [account]
  )

  const fetchContacts = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const r = await fetch(`/api/contacts?q=${encodeURIComponent(q)}${account ? `&companyId=${account.id}` : ''}`)
      if (!r.ok) return []
      const d = await r.json()
      const rows = Array.isArray(d) ? d : d.rows ?? []
      return rows.map((c: { id: string; name: string }) => ({ id: c.id, label: c.name }))
    },
    [account]
  )

  useEffect(() => {
    // Clear the opportunity choice if the account changes out from under it.
    setDeal(null)
  }, [account?.id])

  async function save() {
    if (!account) { toast('Choose an account', 'error'); return }
    if (!visitType) { toast('Choose a visit type', 'error'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_type: visitType.id,
          entity_id: account.id,
          entity_name: account.label,
          is_new_entity: false,
          visit_date: toDateStr(new Date()),
          deal_id: deal?.id || presetDealId || undefined,
          contact_id: contact?.id || undefined,
        }),
      })
      if (!r.ok) {
        toast((await r.json()).error ?? 'Could not log the meeting', 'error')
        return
      }
      const created = await r.json()
      toast('Meeting logged', 'success')
      setCreatedVisitId(created.id)
    } finally {
      setSaving(false)
    }
  }

  // After save, offer "Set next meeting" as a sheet, then return to /today.
  if (createdVisitId) {
    return (
      <NextMeetingDialog
        visitId={createdVisitId}
        mode="prompt"
        onClose={() => router.push('/today')}
        onSaved={() => router.push('/today')}
      />
    )
  }

  return (
    <>
      <PhoneForm onSave={save} saving={saving} changed={changed} onDiscard={() => requestLeave(() => router.push('/today'))}>
        <PhoneFormField label="Account">
          <PickerSheetField
            label="Account"
            value={account}
            onChange={setAccount}
            fetchOptions={fetchAccounts}
            onCreate={name => router.push(`/parties/companies/new?name=${encodeURIComponent(name)}`)}
          />
        </PhoneFormField>
        <PhoneFormField label="Visit type">
          <StaticPickerSheetField label="Visit type" value={visitType} onChange={setVisitType} options={VISIT_TYPE_OPTIONS} />
        </PhoneFormField>

        <PhoneFormMore summary="More details">
          <PhoneFormField label="Opportunity" hint={account ? undefined : 'Choose an account first'}>
            <PickerSheetField
              label="Opportunity"
              value={deal}
              onChange={setDeal}
              fetchOptions={fetchDeals}
              disabled={!account}
            />
          </PhoneFormField>
          <PhoneFormField label="Contact">
            <PickerSheetField label="Contact" value={contact} onChange={setContact} fetchOptions={fetchContacts} />
          </PhoneFormField>
        </PhoneFormMore>
      </PhoneForm>
      {warning}
    </>
  )
}
