'use client'

/**
 * AccountBriefSheet - a quick read of one account, opened from a list (the
 * phone weekly plan) without leaving it. Phone: the kit bottom sheet. Desktop:
 * the same Sheet component as a right-hand side panel (`useLayout()` decides).
 *
 * Sections load in parallel, each with its own skeleton and inline error with
 * Retry. A section the caller may not view is hidden, read from
 * `useMe().permissions` (the same map /api/auth/me builds from
 * checkPermission), never from a role name. While `me` is unresolved nothing
 * is fetched for the gated sections.
 *
 * OPEN OPPORTUNITY RULE: a deal is open when `outcome` is null AND `closed_at`
 * is null. `deals.outcome` ('won' | 'lost') and `closed_at` are written by the
 * close route and always exist. `deal_stages.stage_type` is deliberately NOT
 * used: it is unpushed on some databases and never reaches the wire then, so
 * relying on it would show every deal as open (or none).
 *
 * `contactId` (no accountId) is the contact-only mode: the person's details
 * only. Meetings are not listed because /api/daily-activity has no contact
 * filter.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { MapPinIcon, PhoneIcon, StarIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PhoneContactActionsSheet } from '@/components/ui/contact-actions'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMe } from '@/hooks/useMe'
import { fmtAmount, fmtDate } from '@/lib/format'

type NamedRef = { id?: string; name: string }

type BriefCompany = {
  id: string
  name: string
  type: string | null
  stage: string | null
  account_kind?: 'Company' | 'Individual'
  mobile_1: string | null
  owner: NamedRef | null
  addresses: {
    is_primary: boolean
    address_line: string | null
    city: string | null
    districts: NamedRef | null
  }[]
}

type BriefPerson = {
  link_id: string
  contact_id: string
  contact_name: string | null
  contact_mobile: string | null
  role_name: string | null
  is_primary: boolean
  is_active: boolean
}

type BriefMeeting = {
  id: string
  visit_date: string
  status: string | null
  notes?: string | null
}

type BriefDeal = {
  id: string
  name: string
  expected_value: number | string | null
  outcome: string | null
  closed_at: string | null
  stage: { name: string } | null
}

type BriefContact = {
  id: string
  name: string
  mobile: string | null
  designation: string | null
  email: string | null
}

export type AccountBriefSheetProps = {
  /** The account to brief. Omit with `contactId` for the contact-only mode. */
  accountId?: string | null
  /** Contact-only mode: a person with no account. */
  contactId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Caller's editable rows (e.g. "Meeting with", "Expected order"), rendered under the header block. */
  headerExtra?: ReactNode
  /** Optional extra content above the footer button. */
  children?: ReactNode
}

type Load<T> = { data: T | null; loading: boolean; failed: boolean }

/** Fetch JSON for one section; `enabled` false keeps it idle. Returns a retry. */
function useSection<T>(url: string | null, enabled: boolean): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ data: null, loading: true, failed: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!url || !enabled) return
    let live = true
    setState({ data: null, loading: true, failed: false })
    fetch(url, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: T) => { if (live) setState({ data: json, loading: false, failed: false }) })
      .catch(() => { if (live) setState({ data: null, loading: false, failed: true }) })
    return () => { live = false }
  }, [url, enabled, attempt])

  const retry = useCallback(() => setAttempt(n => n + 1), [])
  return [state, retry]
}

function Section({
  title,
  state,
  retry,
  skeletonRows = 2,
  empty,
  children,
}: {
  title: string
  state: Load<unknown>
  retry: () => void
  skeletonRows?: number
  empty?: string | null
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-label font-medium text-text-secondary">{title}</h3>
      {state.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : state.failed ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface px-3 py-2">
          <p className="text-body text-text-primary">Couldn&apos;t load {title.toLowerCase()}.</p>
          <Button variant="secondary" size="sm" onClick={retry}>Retry</Button>
        </div>
      ) : empty ? (
        <p className="rounded-lg border border-border-light bg-surface px-3 py-3 text-body text-text-secondary">{empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border-light rounded-lg border border-border-light bg-surface">
          {children}
        </div>
      )}
    </section>
  )
}

const rowClass = 'flex min-h-11 items-center justify-between gap-3 px-3 py-2 active:bg-surface-control'

export function AccountBriefSheet({
  accountId,
  contactId,
  open,
  onOpenChange,
  headerExtra,
  children,
}: AccountBriefSheetProps) {
  const me = useMe()
  const contactOnly = !accountId && !!contactId
  const canCompany = !!me?.permissions?.companies?.view
  const canMeetings = !!me?.permissions?.meetings?.view
  const canDeals = !!me?.permissions?.deals?.view
  const canContacts = !!me?.permissions?.contacts?.view

  const [callOpen, setCallOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)

  const acct = open && accountId ? accountId : null
  const [company, retryCompany] = useSection<BriefCompany>(
    acct ? `/api/companies/${acct}` : null, !!me && canCompany)
  const [people, retryPeople] = useSection<BriefPerson[]>(
    acct ? `/api/companies/${acct}/links` : null, !!me && canCompany)
  const [meetings, retryMeetings] = useSection<BriefMeeting[]>(
    acct ? `/api/daily-activity?companyId=${acct}` : null, !!me && canMeetings)
  const [deals, retryDeals] = useSection<BriefDeal[]>(
    acct ? `/api/deals?companyId=${acct}` : null, !!me && canDeals)
  const [contact, retryContact] = useSection<BriefContact>(
    open && contactOnly ? `/api/contacts/${contactId}` : null, !!me && canContacts)

  const c = company.data
  const addr = c?.addresses?.find(a => a.is_primary) ?? c?.addresses?.[0] ?? null
  const addressLine = addr ? [addr.address_line, addr.city, addr.districts?.name].filter(Boolean).join(', ') : ''

  const activePeople = (people.data ?? [])
    .filter(p => p.is_active)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  // The API order is not guaranteed newest-first; ISO dates sort as text.
  const lastMeetings = [...(meetings.data ?? [])]
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))
    .slice(0, 3)
  const openDeals = (deals.data ?? []).filter(d => d.outcome == null && d.closed_at == null)

  const title = contactOnly ? (contact.data?.name ?? 'Contact') : (c?.name ?? 'Account')
  const subtitle = c
    ? [c.type, c.stage, c.owner?.name, c.account_kind === 'Individual' ? 'Individual' : null]
        .filter(Boolean).join(' · ')
    : ''

  const close = () => onOpenChange(false)

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="md:max-w-md" fullHeight>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 pb-2">
          {contactOnly ? (
            !canContacts && me ? null : (
              <Section title="Details" state={contact} retry={retryContact} skeletonRows={2}>
                <div className="flex flex-col gap-1 px-3 py-3">
                  {contact.data?.designation ? <span className="text-body text-text-primary">{contact.data.designation}</span> : null}
                  {contact.data?.mobile ? (
                    <a href={`tel:${contact.data.mobile}`} className="flex min-h-11 items-center gap-2 text-body font-medium text-primary">
                      <PhoneIcon aria-hidden className="size-4" />{contact.data.mobile}
                    </a>
                  ) : null}
                  {contact.data?.email ? <span className="text-body text-text-primary">{contact.data.email}</span> : null}
                </div>
              </Section>
            )
          ) : (
            <>
              {canCompany ? (
                <div className="flex flex-col gap-2">
                  {company.loading ? (
                    <div className="flex flex-col gap-2" aria-busy="true">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-11 w-full" />
                    </div>
                  ) : company.failed ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface px-3 py-2">
                      <p className="text-body text-text-primary">Couldn&apos;t load the account.</p>
                      <Button variant="secondary" size="sm" onClick={retryCompany}>Retry</Button>
                    </div>
                  ) : (
                    <>
                      {subtitle ? <p className="text-body text-text-primary">{subtitle}</p> : null}
                      {c?.mobile_1 ? (
                        <button type="button" onClick={() => setCallOpen(true)}
                          className="flex min-h-11 items-center gap-2 rounded-lg border border-border-light bg-surface px-3 text-body font-medium text-primary active:bg-surface-control">
                          <PhoneIcon aria-hidden className="size-4" />{c.mobile_1}
                        </button>
                      ) : null}
                      {addressLine ? (
                        <button type="button" onClick={() => setAddressOpen(true)}
                          className="flex min-h-11 items-start gap-2 rounded-lg border border-border-light bg-surface px-3 py-2 text-left text-body text-text-primary active:bg-surface-control">
                          <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />{addressLine}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {headerExtra}

              {canCompany ? (
                <Section title="People" state={people} retry={retryPeople}
                  empty={activePeople.length === 0 ? 'No people on this account yet.' : null}>
                  {activePeople.map(p => (
                    <div key={p.link_id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body text-text-primary">{p.contact_name ?? 'Unnamed'}</span>
                        <span className="truncate text-label text-text-secondary">{p.role_name ?? 'No role'}</span>
                      </span>
                      {p.is_primary ? <Badge><StarIcon />Primary</Badge> : null}
                    </div>
                  ))}
                </Section>
              ) : null}

              {canMeetings ? (
                <Section title="Last meetings" state={meetings} retry={retryMeetings}
                  empty={lastMeetings.length === 0 ? 'No meetings logged yet.' : null}>
                  {lastMeetings.map(m => (
                    <Link key={m.id} href={`/daily-activity/meeting/${m.id}`} className={rowClass} onClick={close}>
                      <span className="truncate text-body text-text-primary">
                        {m.notes?.split('\n').map(l => l.trim()).find(Boolean) || m.status || 'Logged'}
                      </span>
                      <span className="shrink-0 text-label text-text-secondary">{fmtDate(m.visit_date)}</span>
                    </Link>
                  ))}
                </Section>
              ) : null}

              {canDeals ? (
                <Section title="Open opportunities" state={deals} retry={retryDeals}
                  empty={openDeals.length === 0 ? 'No open opportunities.' : null}>
                  {openDeals.map(d => (
                    <Link key={d.id} href={`/deals/${d.id}`} className={rowClass} onClick={close}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body text-text-primary">{d.name}</span>
                        <span className="truncate text-label text-text-secondary">{d.stage?.name ?? 'No stage'}</span>
                      </span>
                      <span className="shrink-0 text-body font-medium text-text-primary">{fmtAmount(d.expected_value)}</span>
                    </Link>
                  ))}
                </Section>
              ) : null}
            </>
          )}
          {children}
        </div>

        {!contactOnly && canCompany ? (
          <SheetFooter>
            <Button className="w-full" render={<Link href={`/parties/companies/${accountId}`} />}>
              Open account
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
    <PhoneContactActionsSheet open={callOpen} onOpenChange={setCallOpen} phone={c?.mobile_1 ?? undefined} />
    <PhoneContactActionsSheet open={addressOpen} onOpenChange={setAddressOpen} address={addressLine || undefined} />
    </>
  )
}
