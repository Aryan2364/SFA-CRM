'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'

import { BottomSheet, BottomSheetOption } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { fmtDate } from '@/lib/format'

/**
 * Phone "Shared with": one row in the related list ("Shared with  3 >") that
 * opens a bottom sheet with the people the account / opportunity is shared
 * with. Same members API and same rules as the desktop SharedWithCard
 * (src/components/sharing/shared-with-card.tsx): the server's `can_share` gates
 * change / remove / add, and people who reach an opportunity through its
 * account are listed read-only ("Shared via account").
 *
 * A phone has no hover, so a person who may not share gets the reason as
 * visible text in the sheet, never a tooltip (FRONTEND_RULES_ACCESS rule 2).
 * Removing is reversible, so it is one tap with an Undo toast, no confirmation.
 */

type Access = 'work' | 'view'
type Member = {
  id: string
  user_id: string
  name: string
  access: Access
  added_by_name: string | null
  created_at: string
  via?: 'deal' | 'account'
}
type Person = { id: string; name: string }

const LABEL: Record<Access, string> = { work: 'Can work', view: 'Can view' }

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body?.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

export function PhoneSharedWith({
  endpoint,
  canShare,
  noun,
}: {
  endpoint: string
  canShare: boolean
  noun: 'account' | 'opportunity'
}) {
  const plural = noun === 'account' ? 'accounts' : 'opportunities'
  const reason = `Only the ${noun}'s owner, or someone who can edit ${plural} and whose team includes the owner, can change who it is shared with.`

  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Person | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) return setFailed(true)
      const body = await res.json()
      setMembers(Array.isArray(body) ? (body as Member[]) : [])
    } catch {
      setFailed(true)
    }
  }, [endpoint])

  const loadPeople = useCallback(async () => {
    if (!canShare) return
    try {
      const res = await fetch(`${endpoint}?candidates=1`, { cache: 'no-store' })
      const body = res.ok ? await res.json() : []
      setPeople(Array.isArray(body) ? (body as Person[]) : [])
    } catch {
      setPeople([])
    }
  }, [endpoint, canShare])

  useEffect(() => {
    void load()
    void loadPeople()
  }, [load, loadPeople])

  async function write(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: { user_id: string; access?: Access },
    failure: string
  ): Promise<boolean> {
    setBusy(true)
    try {
      const url = method === 'DELETE' ? `${endpoint}?user_id=${encodeURIComponent(body.user_id)}` : endpoint
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error(await errorText(res, failure))
        return false
      }
      const next = (await res.json()) as { members?: Member[] }
      if (Array.isArray(next.members)) setMembers(next.members)
      void loadPeople()
      return true
    } catch {
      toast.error(`The connection dropped. ${failure}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function setAccess(member: Member, access: Access) {
    setEditing(null)
    if (access === member.access) return
    if (await write('PATCH', { user_id: member.user_id, access }, 'Their access was not changed.')) {
      toast.success(`${member.name} ${access === 'work' ? 'can now work on' : 'can now only view'} this ${noun}`)
    }
  }

  async function remove(member: Member) {
    setEditing(null)
    if (!(await write('DELETE', { user_id: member.user_id }, 'They still have access.'))) return
    toast.undo(`${member.name} no longer has access`, () => {
      void write('POST', { user_id: member.user_id, access: member.access }, `${member.name} was not added back.`)
    })
  }

  async function share(person: Person, access: Access) {
    closeAdd()
    if (await write('POST', { user_id: person.id, access }, 'Nothing was shared.')) {
      toast.success(`Shared with ${person.name}`)
    }
  }

  function closeAdd() {
    setAdding(false)
    setChosen(null)
    setQuery('')
  }

  const count = members?.length
  const shown = [
    ...(members ?? []).filter(m => m.via === 'account'),
    ...(members ?? []).filter(m => m.via !== 'account'),
  ]
  const matches = (people ?? []).filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left text-body font-medium text-text-primary active:bg-surface-control"
      >
        <span>Shared with</span>
        <span className="flex items-center gap-1 text-text-secondary">
          {count !== undefined ? count : ''}
          <ChevronRightIcon className="size-4" aria-hidden />
        </span>
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Shared with"
        footer={
          <Button className="w-full" disabled={!canShare || busy || people === null} onClick={() => setAdding(true)}>
            Share with someone
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {!canShare ? <p className="text-label text-text-secondary">{reason}</p> : null}
          {failed ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-body text-text-primary">Couldn&apos;t load the list. Nothing has changed.</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : members === null ? (
            <p className="text-body text-text-secondary">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-body text-text-secondary">
              Not shared with anyone. Only the owner, and people whose access covers the owner&rsquo;s records, can
              open this {noun}.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-light">
              {shown.map(m => {
                const changeable = canShare && m.via !== 'account'
                const body = (
                  <>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body text-text-primary">{m.name}</span>
                      <span className="truncate text-label text-text-secondary">
                        {m.via === 'account'
                          ? 'Shared via account'
                          : `Added${m.added_by_name ? ` by ${m.added_by_name}` : ''} on ${fmtDate(m.created_at)}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-label text-text-secondary">
                      {LABEL[m.access]}
                      {changeable ? <ChevronRightIcon className="size-4" aria-hidden /> : null}
                    </span>
                  </>
                )
                return (
                  <li key={m.id}>
                    {changeable ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing(m)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left active:bg-surface-control"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-h-12 items-center justify-between gap-3 py-2">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-label text-text-secondary">
            {noun === 'account'
              ? 'Can work: open the account, its contacts, opportunities and orders, and work on them as their role allows. Can view: read only. Sharing an account includes all its opportunities.'
              : 'Can work: open this opportunity and work on it as their role allows, and log meetings for it. Can view: read only. People added here see this opportunity only, not the rest of the account.'}
          </p>
        </div>
      </BottomSheet>

      <BottomSheet open={editing !== null} onOpenChange={o => !o && setEditing(null)} title={editing?.name ?? ''}>
        {editing ? (
          <div className="flex flex-col">
            {(['work', 'view'] as const).map(a => (
              <BottomSheetOption key={a} selected={editing.access === a} onSelect={() => void setAccess(editing, a)}>
                {LABEL[a]}
              </BottomSheetOption>
            ))}
            <BottomSheetOption onSelect={() => void remove(editing)}>Remove access</BottomSheetOption>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={adding}
        onOpenChange={o => !o && closeAdd()}
        title={chosen ? `Access for ${chosen.name}` : 'Share with someone'}
      >
        {chosen ? (
          <div className="flex flex-col">
            <BottomSheetOption onSelect={() => void share(chosen, 'work')}>{LABEL.work}</BottomSheetOption>
            <BottomSheetOption onSelect={() => void share(chosen, 'view')}>{LABEL.view}</BottomSheetOption>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search people"
              aria-label="Search people"
            />
            {matches.length === 0 ? (
              <p className="text-body text-text-secondary">No one else to add.</p>
            ) : (
              matches.map(p => (
                <BottomSheetOption key={p.id} onSelect={() => setChosen(p)}>
                  {p.name}
                </BottomSheetOption>
              ))
            )}
          </div>
        )}
      </BottomSheet>
    </>
  )
}
