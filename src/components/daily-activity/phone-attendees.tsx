'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { StarIcon, UserPlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChoiceRow } from '@/components/ui/choice-row'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * "Who was there" on the phone Log meeting form: the same question, rules and
 * requests as the attendees block of `add-meeting-dialog.tsx` (§8, Stage 2),
 * laid out for a phone. Shown once an account is resolved, whichever way.
 *
 * - The account's ACTIVE linked contacts (`GET /api/companies/[id]/links`) are
 *   listed; a person picked in "Who did you meet" is ticked and main by default.
 * - "Add someone else" searches the caller's own contacts (`mine=1`) or creates
 *   a person (`POST /api/contacts`), who is then linked to the account
 *   (`POST /api/companies/[id]/links`) with an optional role.
 * - The payload is `[{ contact_id, is_main }]` for the ticked rows; the server
 *   keeps at most one main.
 */

type AccountLink = {
  link_id: string
  contact_id: string
  contact_name: string | null
  role_name: string | null
  is_active: boolean
}

type Candidate = {
  contact_id: string
  name: string
  /** From the account's own link list, vs. added in this form. */
  source: 'linked' | 'added'
  /** Only for an 'added' row: also link them to the account. */
  alsoLink?: boolean
  roleId?: string
  isNewContact?: boolean
}

const NO_ROLE: PickerOption = { id: '', label: 'No role' }

export function useMeetingAttendees(resolvedCompanyId: string, selectedPersonId: string) {
  const { toast } = useToast()
  const [map, setMap] = useState<Map<string, Candidate>>(new Map())
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [mainId, setMainId] = useState<string | null>(null)
  const [linksLoad, setLinksLoad] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    fetch('/api/masters/contact-roles')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: { id: string; name: string; is_system?: boolean; is_active?: boolean }[] }) => {
        if (!live) return
        const rows = Array.isArray(d.rows) ? d.rows : []
        setRoles(rows.filter(r => !r.is_system && r.is_active !== false))
      })
      .catch(() => { if (live) setRoles([]) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!resolvedCompanyId) {
      setMap(new Map()); setTicked(new Set()); setMainId(null); setLinksLoad('idle')
      return
    }
    let live = true
    setLinksLoad('loading')
    fetch(`/api/companies/${resolvedCompanyId}/links`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: AccountLink[]) => {
        if (!live) return
        const next = new Map<string, Candidate>()
        for (const l of rows) {
          if (!l.is_active) continue
          next.set(l.contact_id, { contact_id: l.contact_id, name: l.contact_name ?? '—', source: 'linked' })
        }
        setMap(next)
        setLinksLoad('ready')
        setTicked(prev => {
          const t = new Set(prev)
          if (selectedPersonId && next.has(selectedPersonId)) t.add(selectedPersonId)
          return t
        })
        setMainId(prev => prev ?? (selectedPersonId && next.has(selectedPersonId) ? selectedPersonId : null))
      })
      .catch(() => { if (live) setLinksLoad('error') })
    return () => { live = false }
  }, [resolvedCompanyId, selectedPersonId, reload])

  const rows = useMemo(() => Array.from(map.values()), [map])

  const toggle = useCallback((contactId: string, on: boolean) => {
    setTicked(prev => {
      const t = new Set(prev)
      if (on) t.add(contactId); else t.delete(contactId)
      return t
    })
    setMainId(prev => {
      if (on && !prev) return contactId
      if (!on && prev === contactId) return null
      return prev
    })
  }, [])

  const addExisting = useCallback((contactId: string, name: string) => {
    setMap(prev => {
      const next = new Map(prev)
      if (!next.has(contactId)) next.set(contactId, { contact_id: contactId, name, source: 'added', alsoLink: false, roleId: '' })
      return next
    })
    setTicked(prev => new Set(prev).add(contactId))
    setMainId(prev => prev ?? contactId)
  }, [])

  const createAndAdd = useCallback(async (name: string, mobile: string, roleId: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mobile: mobile.trim() || undefined }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast(d.error || 'Could not create the contact', 'error')
        return false
      }
      const created = await r.json()
      setMap(prev => {
        const next = new Map(prev)
        next.set(created.id, { contact_id: created.id, name: name.trim(), source: 'added', alsoLink: true, roleId, isNewContact: true })
        return next
      })
      setTicked(prev => new Set(prev).add(created.id))
      setMainId(prev => prev ?? created.id)
      if (resolvedCompanyId) {
        const linked = await fetch(`/api/companies/${resolvedCompanyId}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: created.id, role_id: roleId || null }),
        })
        if (!linked.ok) {
          const d = await linked.json().catch(() => ({}))
          toast(d.error || 'The contact was created but could not be linked to the account', 'error')
        }
      }
      return true
    } catch {
      toast('Could not create the contact', 'error')
      return false
    }
  }, [resolvedCompanyId, toast])

  const setAlsoLink = useCallback(async (contactId: string, link: boolean) => {
    const row = map.get(contactId)
    if (!row) return
    setMap(prev => { const next = new Map(prev); next.set(contactId, { ...row, alsoLink: link }); return next })
    if (link && resolvedCompanyId) {
      const r = await fetch(`/api/companies/${resolvedCompanyId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, role_id: row.roleId || null }),
      }).catch(() => null)
      if (!r || !r.ok) {
        const d = r ? await r.json().catch(() => ({})) : {}
        toast(d.error || 'Could not link this person to the account', 'error')
      }
    }
  }, [map, resolvedCompanyId, toast])

  const setRole = useCallback((contactId: string, roleId: string) => {
    setMap(prev => {
      const next = new Map(prev)
      const row = next.get(contactId)
      if (row) next.set(contactId, { ...row, roleId })
      return next
    })
  }, [])

  /** `[{ contact_id, is_main }]` for the ticked rows; empty means send none. */
  const payload = useMemo(
    () => rows.filter(a => ticked.has(a.contact_id)).map(a => ({ contact_id: a.contact_id, is_main: a.contact_id === mainId })),
    [rows, ticked, mainId]
  )

  return {
    rows, ticked, mainId, linksLoad, roles, payload,
    toggle, setMainId, addExisting, createAndAdd, setAlsoLink, setRole,
    retry: () => setReload(n => n + 1),
  }
}

export type MeetingAttendees = ReturnType<typeof useMeetingAttendees>

export function PhoneAttendees({ attendees }: { attendees: MeetingAttendees }) {
  const { rows, ticked, mainId, linksLoad, roles } = attendees
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newRole, setNewRole] = useState<PickerOption>(NO_ROLE)
  const [creating, setCreating] = useState(false)

  const roleOptions = useMemo<PickerOption[]>(() => [NO_ROLE, ...roles.map(r => ({ id: r.id, label: r.name }))], [roles])

  const fetchContacts = useCallback(async (q: string): Promise<PickerOption[]> => {
    const r = await fetch(`/api/contacts?mine=1&q=${encodeURIComponent(q.trim())}`)
    if (!r.ok) throw new Error(String(r.status))
    const d = await r.json()
    const list = (Array.isArray(d) ? d : d.rows ?? []) as { id: string; name: string }[]
    const have = new Set(rows.map(a => a.contact_id))
    return list.filter(c => !have.has(c.id)).map(c => ({ id: c.id, label: c.name }))
  }, [rows])

  async function create() {
    if (!newName.trim() || creating) return
    setCreating(true)
    const ok = await attendees.createAndAdd(newName, newMobile, newRole.id)
    setCreating(false)
    if (ok) {
      setNewName(''); setNewMobile(''); setNewRole(NO_ROLE); setShowAdd(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-light p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Who was there</Label>
        <Button variant="ghost" size="sm" type="button" onClick={() => setShowAdd(v => !v)}>
          <UserPlusIcon />
          Add someone else
        </Button>
      </div>

      {linksLoad === 'loading' ? (
        <Skeleton className="h-12 w-full" />
      ) : linksLoad === 'error' ? (
        <div className="flex flex-col gap-2">
          <InlineFieldError className="mt-0">
            This account&apos;s contacts could not be loaded. You can still add someone by name below.
          </InlineFieldError>
          <Button variant="secondary" size="sm" type="button" onClick={attendees.retry}>Try again</Button>
        </div>
      ) : rows.length === 0 && !showAdd ? (
        <p className="text-meta text-text-muted">
          No contacts are linked to this account yet. Add someone below, or leave this empty for a walk-in.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map(a => {
            const on = ticked.has(a.contact_id)
            const isMain = mainId === a.contact_id
            return (
              <li key={a.contact_id} className="border-b border-border-light last:border-b-0">
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <ChoiceRow
                      control={<Checkbox checked={on} onCheckedChange={v => attendees.toggle(a.contact_id, v === true)} />}
                      label={<span className="truncate">{a.name}{a.isNewContact ? ' (new)' : ''}</span>}
                    />
                  </div>
                  <button
                    type="button"
                    className="flex size-11 shrink-0 items-center justify-center text-text-muted disabled:pointer-events-none disabled:opacity-40"
                    onClick={() => attendees.setMainId(a.contact_id)}
                    disabled={!on}
                    aria-label={isMain ? `${a.name} is the main person` : `Mark ${a.name} as the main person`}
                  >
                    <StarIcon className={isMain ? 'size-5 fill-warning text-warning' : 'size-5'} />
                  </button>
                </div>
                {a.source === 'added' && (
                  <div className="flex flex-col gap-2 pb-2 pl-6">
                    <ChoiceRow
                      control={<Checkbox checked={!!a.alsoLink} onCheckedChange={v => attendees.setAlsoLink(a.contact_id, v === true)} />}
                      label="Also link to this account"
                    />
                    {roles.length > 0 && a.alsoLink && (
                      <StaticPickerSheetField
                        label="Role on this account"
                        value={roleOptions.find(o => o.id === (a.roleId ?? '')) ?? NO_ROLE}
                        onChange={o => attendees.setRole(a.contact_id, o.id)}
                        options={roleOptions}
                      />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {showAdd && (
        <div className="flex flex-col gap-3 rounded-md border border-border-light bg-surface-sunken p-3">
          <div className="flex flex-col gap-1.5">
            <Label>Search an existing contact</Label>
            <PickerSheetField
              label="Contact"
              placeholder="Name or mobile"
              value={null}
              onChange={o => { attendees.addExisting(o.id, o.label); setShowAdd(false) }}
              fetchOptions={fetchContacts}
            />
          </div>
          <p className="text-meta text-text-muted">or create a new person</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="da-new-person-name">Name</Label>
            <Input id="da-new-person-name" className="max-w-none" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" autoComplete="off" enterKeyHint="next" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="da-new-person-mobile">Mobile (optional)</Label>
            <Input
              id="da-new-person-mobile"
              className="max-w-none"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={newMobile}
              onChange={e => setNewMobile(e.target.value)}
              placeholder="10-digit number"
              enterKeyHint="done"
            />
          </div>
          {roles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Role on this account</Label>
              <StaticPickerSheetField label="Role on this account" value={newRole} onChange={setNewRole} options={roleOptions} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setShowAdd(false)}>
              <XIcon />
              Cancel
            </Button>
            <Button type="button" onClick={create} disabled={!newName.trim() || creating}>
              {creating ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
