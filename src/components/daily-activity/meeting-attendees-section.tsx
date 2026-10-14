'use client'

import { useEffect, useState } from 'react'
import { StarIcon, UserPlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'

type AttendeeRow = { id: string; contact_id: string; name: string; is_main: boolean }

const EDIT_REASON = 'Only the person who logged this meeting, or someone who can edit meetings, can change its attendees'

/**
 * Accounts & Contacts, Stage 2 (§8) — the meeting page's attendee list.
 *
 * The LIST itself is one area, visible to everyone who can open the meeting
 * at all (the page already 404s an unreachable one) — never hidden. Editing
 * (add, remove, move the star) is an individual ACTION within that area, so
 * per the global permission-aware UI rule it is shown, DISABLED, with a
 * tooltip naming who may do it (`PermissionTooltip`, the same pattern
 * `NextMeetingDialog`'s trigger and the "Shared with you" controls already
 * use on this page) — never hidden outright.
 *
 * `canEdit` is three-state:
 *   `null`   not known yet (the permission/ownership check, via `useMe()`,
 *            has not resolved) — controls render disabled with NO reason: a
 *            wrong "you may not" would be shown before the answer is in.
 *   `false`  known, and this viewer may not edit — disabled + tooltip.
 *   `true`   the owner (or someone in scope) with `meetings.edit` — enabled.
 */
export function MeetingAttendeesSection({ visitId, canEdit }: { visitId: string; canEdit: boolean | null }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<AttendeeRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)

  const editKnown = canEdit !== null
  const canEditNow = canEdit === true
  // While loading: disabled, no tooltip. Known and denied: disabled + reason.
  // Known and allowed: PermissionTooltip renders children untouched.
  const allowed = !editKnown || canEditNow

  useEffect(() => {
    let live = true
    setState('loading')
    fetch(`/api/daily-activity/${visitId}/attendees`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { attendees: AttendeeRow[] }) => { if (live) { setRows(d.attendees ?? []); setState('ready') } })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [visitId])

  useEffect(() => {
    if (!adding || query.trim().length < 2) { setResults([]); return }
    let live = true
    const t = setTimeout(() => {
      fetch(`/api/contacts?mine=1&q=${encodeURIComponent(query.trim())}`)
        .then(r => (r.ok ? r.json() : []))
        .then((d: { id: string; name: string }[]) => { if (live) setResults(Array.isArray(d) ? d : []) })
        .catch(() => { if (live) setResults([]) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [adding, query])

  async function save(next: { contact_id: string; is_main: boolean }[]) {
    setBusy(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/attendees`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.error || 'Could not update attendees', 'error'); return }
      setRows(d.attendees ?? [])
    } catch {
      toast('Could not update attendees', 'error')
    } finally {
      setBusy(false)
    }
  }

  function addContact(contactId: string, name: string) {
    if (rows.some(r => r.contact_id === contactId)) { setAdding(false); setQuery(''); setResults([]); return }
    const next = [...rows.map(r => ({ contact_id: r.contact_id, is_main: r.is_main })), { contact_id: contactId, is_main: rows.length === 0 }]
    setAdding(false)
    setQuery('')
    setResults([])
    void save(next)
    // Optimistic row so the name shows immediately while the PATCH lands.
    setRows(prev => [...prev, { id: contactId, contact_id: contactId, name, is_main: prev.length === 0 }])
  }

  function removeContact(contactId: string) {
    const next = rows
      .filter(r => r.contact_id !== contactId)
      .map(r => ({ contact_id: r.contact_id, is_main: r.is_main }))
    void save(next)
  }

  function makeMain(contactId: string) {
    const next = rows.map(r => ({ contact_id: r.contact_id, is_main: r.contact_id === contactId }))
    void save(next)
  }

  if (state === 'loading') return <Skeleton className="h-10 w-full" />
  if (state === 'error') {
    // A read failure here is not worth a dead-end banner on an otherwise
    // working page; the rest of the meeting still loads fine.
    return null
  }

  return (
    <div className="space-y-2 rounded-lg border border-border-light p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-medium text-text-primary">Attendees</h2>
        <PermissionTooltip allowed={allowed} reason={EDIT_REASON}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setAdding(v => !v)}
            disabled={!canEditNow}
          >
            <UserPlusIcon />
            Add
          </Button>
        </PermissionTooltip>
      </div>

      {rows.length === 0 ? (
        <p className="text-meta text-text-muted">No attendees recorded for this meeting.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(r => (
            <li key={r.contact_id} className="flex items-center gap-2.5">
              <PermissionTooltip allowed={allowed} reason={EDIT_REASON}>
                <button
                  type="button"
                  className="flex min-h-11 items-center text-text-muted hover:text-warning disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => makeMain(r.contact_id)}
                  disabled={!canEditNow || busy}
                  aria-label={r.is_main ? `${r.name} is the main person` : `Mark ${r.name} as the main person`}
                  title={r.is_main ? 'Main person' : 'Mark as main'}
                >
                  <StarIcon className={r.is_main ? 'size-4 fill-warning text-warning' : 'size-4'} />
                </button>
              </PermissionTooltip>
              <span className="min-w-0 flex-1 truncate text-body text-text-primary">{r.name}</span>
              <PermissionTooltip allowed={allowed} reason={EDIT_REASON}>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface-control hover:text-danger disabled:pointer-events-none disabled:opacity-40 sm:size-8"
                  onClick={() => removeContact(r.contact_id)}
                  disabled={!canEditNow || busy}
                  aria-label={`Remove ${r.name}`}
                >
                  <XIcon className="size-4" />
                </button>
              </PermissionTooltip>
            </li>
          ))}
        </ul>
      )}

      {canEditNow && adding && (
        <div className="space-y-1.5 rounded-md border border-border-light bg-surface-sunken p-2.5">
          <Input
            className="max-w-none"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search a contact by name or mobile"
            autoFocus
          />
          {results.length > 0 && (
            <ul className="divide-y divide-border-light overflow-hidden rounded-md border border-border-light">
              {results.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-2.5 text-left text-label text-text-primary hover:bg-surface-control"
                    onClick={() => addContact(r.id, r.name)}
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
