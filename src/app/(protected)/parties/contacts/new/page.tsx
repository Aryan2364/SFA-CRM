'use client'

/**
 * Phone screen 4 — create contact (docs/phone-plan.md §5). Shared URL
 * contract: `/parties/contacts/new`, with `?account=<id>` prefilling the
 * account picker (e.g. from the account detail screen's "Add contact"
 * action). Desktop has no such URL today — contacts are created from the
 * Contacts tab's dialog or a company's "Add contact" — so desktop visitors
 * are redirected to the Contacts tab rather than duplicating that dialog.
 *
 * Calls the same `POST /api/contacts` the desktop `ContactDialog` calls
 * (gated `contacts:create`, confirmed in `src/app/api/contacts/_handlers.ts`).
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { checkEmail, checkMobile } from '@/lib/validation'

export default function NewContactPage() {
  const { layout } = useLayout()
  const router = useRouter()

  if (layout === 'desktop') {
    router.replace('/parties?tab=contacts')
    return null
  }

  return <PhoneNewContact />
}

function PhoneNewContact() {
  usePhoneAppBar({ title: 'New contact', back: '/parties' })
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const me = useMe()

  const canCreate = me ? Boolean(me.permissions?.contacts?.create) : false

  const accountId = searchParams.get('account') ?? ''
  const [account, setAccount] = useState<PickerOption | null>(null)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [designation, setDesignation] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Prefill the account picker from ?account=<id>, same contract every
  // phone screen's "new" URL honours.
  useEffect(() => {
    if (!accountId) return
    let live = true
    fetch(`/api/companies/${accountId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { id: string; name: string } | null) => {
        if (live && d) setAccount({ id: d.id, label: d.name })
      })
      .catch(() => {})
    return () => { live = false }
  }, [accountId])

  const changed = Boolean(name || mobile || email || designation || notes || account)
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Enter the name.'
    const m = checkMobile(mobile, 'Mobile Number')
    if (m) next.mobile = m
    const e = checkEmail(email)
    if (e) next.email = e
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (saving) return
    if (!validate()) return
    setSaving(true)
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim() || undefined,
          email: email.trim() || undefined,
          designation: designation.trim() || undefined,
          notes: notes.trim() || undefined,
          ...(account ? { company_ids: [account.id], primary_company_id: account.id } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrors({ form: (data as { error?: string }).error ?? 'Could not save this contact.' })
        return
      }
      toast('Contact saved.')
      const created = data as { id: string }
      router.push(account ? `/parties/companies/${account.id}` : `/parties/contacts/${created.id}`)
    } catch {
      setErrors({ form: 'The connection dropped. Nothing was saved.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <PermissionTooltip allowed={canCreate} reason="Only someone who can create contacts can add one.">
      <PhoneForm
        saving={saving}
        onSave={save}
        changed={changed}
        onDiscard={() => requestLeave(() => router.push('/parties'))}
      >
        <fieldset disabled={canCreate === false} className="flex flex-col gap-4">
          <PhoneFormField label="Account" hint="Optional — link this contact to an account.">
            <PickerSheetField
              label="Account"
              value={account}
              onChange={setAccount}
              fetchOptions={async q => {
                const r = await fetch(`/api/companies?q=${encodeURIComponent(q)}`)
                if (!r.ok) return []
                const rows = (await r.json()) as { id: string; name: string }[]
                return Array.isArray(rows) ? rows.map(c => ({ id: c.id, label: c.name })) : []
              }}
            />
          </PhoneFormField>

          <PhoneFormField label="Name" required hint={errors.name}>
            <Input value={name} onChange={e => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
          </PhoneFormField>

          <PhoneFormField label="Mobile" hint={errors.mobile}>
            <Input type="tel" inputMode="numeric" value={mobile} onChange={e => setMobile(e.target.value)} aria-invalid={Boolean(errors.mobile)} />
          </PhoneFormField>

          <PhoneFormMore summary="More details">
            <PhoneFormField label="Email" hint={errors.email}>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} />
            </PhoneFormField>
            <PhoneFormField label="Designation">
              <Input value={designation} onChange={e => setDesignation(e.target.value)} />
            </PhoneFormField>
            <PhoneFormField label="Notes">
              <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
            </PhoneFormField>
          </PhoneFormMore>

          {errors.form ? <p className="text-label text-danger">{errors.form}</p> : null}
        </fieldset>
      </PhoneForm>
      {warning}
    </PermissionTooltip>
  )
}
