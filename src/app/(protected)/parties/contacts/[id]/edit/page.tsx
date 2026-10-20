'use client'

/**
 * `/parties/contacts/[id]/edit` — phone-only "Edit contact" screen.
 *
 * No desktop route exists for this (the desktop Contact detail page edits
 * through the Parties area's dialog, not a page) — a desktop visitor is
 * redirected to the contact detail page, same ground rule
 * `companies/[id]/edit` uses.
 *
 * Writes through `PUT /api/contacts/[id]` — gated `contacts:edit` — the same
 * endpoint and allow-list the desktop Contact dialog uses, so there is one
 * validation rule and this screen never re-derives it.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { isSafeReturnPath } from '@/lib/session-expiry'
import { checkEmail, checkMobile } from '@/lib/validation'

type Contact = {
  id: string
  name: string
  mobile: string
  whatsapp: string | null
  email: string | null
  designation: string | null
  notes: string | null
}

function PhoneEditContact({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const me = useMe()

  const detailHref = `/parties/contacts/${id}`
  const nextParam = searchParams.get('next')
  const next = isSafeReturnPath(nextParam) ? nextParam : detailHref

  usePhoneAppBar({ title: 'Edit contact', back: next })

  const canEdit = me ? Boolean(me.permissions?.contacts?.edit) : undefined

  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [designation, setDesignation] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    try {
      const res = await fetch(`/api/contacts/${id}`, { cache: 'no-store' })
      if (!res.ok) {
        setNotFound(true)
        return
      }
      const data = (await res.json()) as Contact
      setContact(data)
      setName(data.name ?? '')
      setMobile(data.mobile ?? '')
      setWhatsapp(data.whatsapp ?? '')
      setEmail(data.email ?? '')
      setDesignation(data.designation ?? '')
      setNotes(data.notes ?? '')
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const changed = Boolean(
    contact &&
      (name !== (contact.name ?? '') ||
        mobile !== (contact.mobile ?? '') ||
        whatsapp !== (contact.whatsapp ?? '') ||
        email !== (contact.email ?? '') ||
        designation !== (contact.designation ?? '') ||
        notes !== (contact.notes ?? ''))
  )
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Enter the name.'
    const m = checkMobile(mobile, 'Mobile Number')
    if (mobile.trim() && m) next.mobile = m
    const e = checkEmail(email)
    if (e) next.email = e
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (saving || !contact) return
    if (!validate()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim(),
          designation: designation.trim(),
          notes: notes.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrors({ form: (data as { error?: string }).error ?? 'Could not save this contact.' })
        return
      }
      toast('Contact saved.')
      router.push(next)
    } catch {
      setErrors({ form: 'The connection dropped. Nothing was saved.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }

  if (notFound || !contact) {
    return (
      <EmptyState
        variant="failed"
        heading="This contact is not here"
        actionLabel="Go to Contacts"
        onAction={() => router.push('/parties/contacts')}
      >
        It may have been deleted, or the link may point at a record in a different firm.
      </EmptyState>
    )
  }

  return (
    <PermissionTooltip allowed={canEdit !== false} reason="Only someone who can edit contacts can change this one.">
      <PhoneForm
        saving={saving}
        onSave={save}
        changed={changed}
        onDiscard={() => requestLeave(() => router.push(next))}
      >
        <fieldset disabled={canEdit === false} className="flex flex-col gap-4">
          <PhoneFormField label="Name" required hint={errors.name}>
            <Input value={name} onChange={e => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
          </PhoneFormField>

          <PhoneFormField label="Mobile" hint={errors.mobile}>
            <Input
              type="tel"
              inputMode="numeric"
              value={mobile}
              onChange={e => setMobile(e.target.value)}
              aria-invalid={Boolean(errors.mobile)}
            />
          </PhoneFormField>

          <PhoneFormMore summary="More details">
            <PhoneFormField label="WhatsApp number" hint="Leave blank if same as mobile.">
              <Input type="tel" inputMode="numeric" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
            </PhoneFormField>
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

export default function ContactEditPage() {
  const params = useParams<{ id: string }>()
  const { layout } = useLayout()
  const router = useRouter()
  const id = params?.id ?? ''

  useEffect(() => {
    if (layout === 'desktop') router.replace(`/parties/contacts/${id}`)
  }, [layout, router, id])

  if (layout !== 'phone') return null
  return <PhoneEditContact id={id} />
}
