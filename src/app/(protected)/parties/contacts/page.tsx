'use client'

/**
 * Phone contacts list. No such phone-only route existed before this task
 * (docs/phone-plan.md screen 4: "Contacts list on phone at the existing
 * contacts route if one exists" — none did), so this fills it in. Reached
 * from an account's "Contacts" related row (`?account=<id>`) or, with no
 * query, as a plain contacts list.
 *
 * Desktop already has a Contacts tab at `/parties?tab=contacts`, so a
 * desktop visitor here is redirected there rather than getting a second,
 * unstyled contacts screen.
 *
 * Calls the same `GET /api/contacts` the desktop Contacts tab calls —
 * gated `contacts:view` server-side; nothing new.
 */

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneList, PhoneListRow } from '@/components/ui/phone-list'
import { useMe } from '@/hooks/useMe'

type ContactRow = {
  id: string
  name: string
  mobile: string | null
  designation: string | null
  companies?: { id: string; name: string }[]
}

function PhoneContactsList() {
  usePhoneAppBar({ title: 'Contacts' })
  const searchParams = useSearchParams()
  const accountId = searchParams.get('account') ?? ''
  const me = useMe()
  const canCreate = me ? Boolean(me.permissions?.contacts?.create) : undefined

  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ContactRow[]>([])
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')

  useEffect(() => {
    let live = true
    setState('loading')
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (accountId) params.set('companyId', accountId)
    fetch(`/api/contacts?${params.toString()}`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((d: unknown) => {
        if (!live) return
        setRows(Array.isArray(d) ? (d as ContactRow[]) : [])
        setState('ready')
      })
      .catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [search, accountId])

  return (
    <PhoneList
      state={state}
      noun={{ one: 'contact', many: 'contacts' }}
      rows={rows}
      total={rows.length}
      rowKey={r => r.id}
      renderRow={row => (
        <PhoneListRow
          href={`/parties/contacts/${row.id}`}
          name={row.name}
          facts={row.designation ? [row.designation] : undefined}
          meta={row.mobile ?? undefined}
        />
      )}
      search={{ value: search, onChange: setSearch }}
      add={{
        label: 'Add contact',
        href: accountId ? `/parties/contacts/new?account=${accountId}` : '/parties/contacts/new',
        allowed: me ? canCreate : undefined,
        reason: 'Only someone who can create contacts can add them',
      }}
      empty={
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">No contacts yet</p>
        </div>
      }
    />
  )
}

function ContactsListScreen() {
  const { layout } = useLayout()
  const router = useRouter()

  if (layout === 'desktop') {
    router.replace('/parties?tab=contacts')
    return null
  }

  return <PhoneContactsList />
}

export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsListScreen />
    </Suspense>
  )
}
