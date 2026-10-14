'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2Icon, UserPlusIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtDate } from '@/lib/format'

/**
 * "Shared with" — the people an account or an opportunity is shared with,
 * beside its owner (src/lib/sharing.ts holds the model; this only renders it).
 *
 * One component for both pages (section 4 rule 2): the account page passes
 * `/api/companies/[id]/members`, the opportunity page `/api/deals/[id]/members`.
 * On the opportunity, people who reach it because its ACCOUNT is shared come
 * back tagged `via: 'account'` and are shown as "Shared via account", read-only
 * here — they are changed on the account.
 *
 * `canShare` is the server's answer for THIS record (section 26.5): the owner,
 * or someone who can edit these records and whose team includes the owner. The
 * page never works it out. Without it every control stays on screen, disabled,
 * with that sentence as its reason (section 26 rule 2).
 *
 * Removing someone is reversible — they can be added back — so it is one click
 * with an Undo toast, not a confirmation (sections 15 rule 1, 38.1).
 *
 * The page renders this only once the server says sharing is available
 * (`sharing_available`), so until the tables exist the screens are unchanged.
 */

export type MemberAccess = 'work' | 'view'

type Member = {
  id: string
  user_id: string
  name: string
  access: MemberAccess
  added_by_name: string | null
  created_at: string
  via?: 'deal' | 'account'
}

type Person = { id: string; name: string }

const ACCESS_LABEL: Record<MemberAccess, string> = {
  work: 'Can work',
  view: 'Can view',
}

/** A refusal's own sentence when the route sent one; never raw text. */
async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body?.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

export function SharedWithCard({
  endpoint,
  canShare,
  noun,
}: {
  /** `/api/companies/<id>/members` or `/api/deals/<id>/members`. */
  endpoint: string
  /** The server's `can_share` for this record. */
  canShare: boolean
  noun: 'account' | 'opportunity'
}) {
  const plural = noun === 'account' ? 'accounts' : 'opportunities'
  const shareReason = `Only the ${noun}'s owner, or someone who can edit ${plural} and whose team includes the owner, can change who it is shared with.`

  const [members, setMembers] = useState<Member[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [pick, setPick] = useState('')
  const [pickAccess, setPickAccess] = useState<MemberAccess>('work')
  const [busy, setBusy] = useState(false)

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
      if (!res.ok) return setPeople([])
      const body = await res.json()
      setPeople(Array.isArray(body) ? (body as Person[]) : [])
    } catch {
      setPeople([])
    }
  }, [endpoint, canShare])

  useEffect(() => {
    void load()
    void loadPeople()
  }, [load, loadPeople])

  /** One write; on success the route answers the refreshed list. */
  async function write(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: { user_id: string; access?: MemberAccess },
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

  async function add() {
    const person = people?.find(p => p.id === pick)
    if (!person) return
    if (await write('POST', { user_id: person.id, access: pickAccess }, 'Nothing was shared.')) {
      setPick('')
      toast.success(`Shared with ${person.name}`)
    }
  }

  async function change(member: Member, access: MemberAccess) {
    if (access === member.access) return
    if (await write('PATCH', { user_id: member.user_id, access }, 'Their access was not changed.')) {
      toast.success(`${member.name} ${access === 'work' ? 'can now work on' : 'can now only view'} this ${noun}`)
    }
  }

  async function remove(member: Member) {
    if (!(await write('DELETE', { user_id: member.user_id }, 'They still have access.'))) return
    toast.undo(`${member.name} no longer has access`, () => {
      void write('POST', { user_id: member.user_id, access: member.access }, `${member.name} was not added back.`)
    })
  }

  const direct = (members ?? []).filter(m => m.via !== 'account')
  const viaAccount = (members ?? []).filter(m => m.via === 'account')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <UsersIcon className="size-icon text-text-secondary" aria-hidden="true" />
          Shared with
          {members && members.length > 0 && <Badge>{members.length}</Badge>}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {failed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body text-text-secondary">
              The list of people could not be loaded. Nothing has changed.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : members === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-body text-text-secondary">
            Not shared with anyone. Only the owner, and people whose access covers the
            owner&rsquo;s records, can open this {noun}.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-light">
            {[...viaAccount, ...direct].map(member => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium text-text-primary">{member.name}</span>
                  <span className="text-meta text-text-muted">
                    {member.via === 'account'
                      ? 'Shared via account'
                      : `Added${member.added_by_name ? ` by ${member.added_by_name}` : ''} on ${fmtDate(member.created_at)}`}
                  </span>
                </div>

                {canShare && member.via !== 'account' ? (
                  <Select
                    items={ACCESS_LABEL}
                    value={member.access}
                    onValueChange={(value: unknown) => void change(member, value as MemberAccess)}
                    disabled={busy}
                  >
                    <SelectTrigger className="w-40" aria-label={`Access for ${member.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="work">{ACCESS_LABEL.work}</SelectItem>
                      <SelectItem value="view">{ACCESS_LABEL.view}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge>{ACCESS_LABEL[member.access]}</Badge>
                )}

                {member.via === 'account' ? null : canShare ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button
                        variant="in-field"
                        size="icon-sm"
                        aria-label={`Remove ${member.name}`}
                        disabled={busy}
                        onClick={() => void remove(member)}
                      >
                        <Trash2Icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Remove access</TooltipContent>
                  </Tooltip>
                ) : (
                  <PermissionTooltip allowed={false} reason={shareReason}>
                    <Button variant="in-field" size="icon-sm" aria-label={`Remove ${member.name}`} disabled>
                      <Trash2Icon />
                    </Button>
                  </PermissionTooltip>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* The add row sits under the list it adds to (global rule 4), and
            stays on screen, disabled with its reason, for someone who may not
            share (section 26 rule 2). */}
        {!failed && (
          /* Two rows, not one: the card usually sits in a page's narrow side
             column, where a person picker, an access picker and a button on
             one line squeeze the name to nothing. The person gets the full
             width; access and the button share the line under it. */
          <div className="flex flex-col gap-3 border-t border-border-light pt-4">
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${noun}-share-person`}>Share with</Label>
              <SearchableSelect
                id={`${noun}-share-person`}
                options={Object.fromEntries((people ?? []).map(p => [p.id, p.name]))}
                value={pick}
                onValueChange={setPick}
                placeholder="Choose a person"
                searchPlaceholder="Search people"
                emptyMessage="No one else to add."
                disabled={!canShare || busy || people === null}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${noun}-share-access`}>Access</Label>
                <Select
                  items={ACCESS_LABEL}
                  value={pickAccess}
                  onValueChange={(value: unknown) => setPickAccess((value as MemberAccess) ?? 'work')}
                  disabled={!canShare || busy}
                >
                  <SelectTrigger id={`${noun}-share-access`} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="work">{ACCESS_LABEL.work}</SelectItem>
                    <SelectItem value="view">{ACCESS_LABEL.view}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <PermissionTooltip allowed={canShare} reason={shareReason}>
                <Button variant="secondary" disabled={!canShare || busy || !pick} onClick={() => void add()}>
                  <UserPlusIcon />
                  Share
                </Button>
              </PermissionTooltip>
            </div>
          </div>
        )}

        <p className="text-meta text-text-muted">
          {noun === 'account'
            ? 'Can work: open the account, its contacts, opportunities and orders, and work on them as their role allows. Can view: read only. Sharing an account includes all its opportunities.'
            : 'Can work: open this opportunity and work on it as their role allows, and log meetings for it. Can view: read only. People added here see this opportunity only, not the rest of the account.'}
        </p>
      </CardContent>
    </Card>
  )
}
