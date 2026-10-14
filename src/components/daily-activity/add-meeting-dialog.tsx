'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, Building2Icon, HistoryIcon, PlusIcon, StarIcon, UserIcon, UserPlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SearchableSelect,
  type SearchableSelectGroup,
} from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { Entity, PlannedItem, Visit } from './types'

/**
 * ONE meeting form (F5), for a meeting happening now and for one that
 * already happened.
 *
 * WHAT THIS REPLACES
 *
 * Two buttons in the page header and two dialogs: this one and
 * `manual-meeting-dialog.tsx`, which is gone. The two forms asked for
 * the same party in the same way and differed only in whether they also
 * asked for a Start and an End. That is a toggle, not a second screen,
 * and it was costing a button's worth of header room that F4 wanted for
 * check-in/check-out.
 *
 * ⚠️ MERGING THE FORMS DOES NOT MERGE THE PROVENANCE. A past entry still
 * posts `is_manual_entry: true`, still sends NO coordinates (this file
 * never calls `getPosition()`, in either mode), and is still marked
 * Manually Entered · Tentative on the card once saved. A typed time must
 * never be able to pass as a captured one; the toggle changes what the
 * form asks for, never what the record claims about itself.
 *
 * F6 — THE SELECTORS ARE GONE, AND WHAT THAT MEANS FOR `visit_type`
 *
 * The form used to open with a "Type" select (Dealer / Distributor /
 * Institution, from `company_types`) and a three-way "Record" selector
 * (Existing / Lead / New). Between them they chose which parties the
 * dropdown listed, and the Type select ALSO wrote
 * `daily_visits.visit_type` — a join key with no foreign key behind it.
 * Deleting the control without deciding what it wrote would have
 * silently changed what gets stored.
 *
 * What is written now: the selected party's OWN `companies.type`, which
 * `/api/business-partners?status=all` returns. That is the same rule the
 * page already used when starting a meeting from an approved plan line
 * (`party_visit_type || party_type || OTHER_VISIT_TYPE`), so the two paths
 * agree. A party with no type is logged as `'Other'` — never as a guessed
 * `'Dealer'`, which used to be the hidden fallback and silently counted
 * untyped parties as dealer visits.
 *
 * For a brand-new lead there is no party to read a type from, so the
 * create panel keeps a Lead type field. It is not the selector Aryan
 * removed: that one filtered the meeting, this one types a permanent
 * master record. It is OPTIONAL: a blank one creates the company with a
 * blank type (as `POST /api/companies` does) and logs the meeting as
 * `'Other'`, rather than making the user guess a type to get past it.
 *
 * F26 — every field in this form carries `max-w-none`. The kit caps a
 * bare field at `--spacing-field-max` (480px), which is right on a wide
 * page and wrong inside a 526px dialog body: the capped fields stopped
 * 46px short of the right edge that the toggle panel and the time-picker
 * grid reach, and the form read as ragged. `max-w-none` is the pattern
 * the order dialogs already use for this. Every field now shares one
 * left and one right edge at every width.
 *
 * F7 — the dropdown is labelled "Lead" here because F6 asked for it on
 * THIS form. That is a local relabel, not the repo-wide Lead/Party
 * decision, which is still Aryan's to make.
 *
 * WHO THE MEETING WAS WITH — ONE QUESTION, ONE DROPDOWN
 *
 * A meeting is with a person as often as with a company, so the form has
 * to be able to name either. It used to do that with THREE modes: pick a
 * Lead and then optionally one of its contacts, or leave the Lead path
 * entirely through a ghost link into a separate person-first panel.
 *
 * That was wrong, and the reason is worth keeping: the user does not
 * think "am I in lead mode or contact mode", they think "I met Ramesh".
 * A mode switch makes them answer a question about the software before
 * they can answer the question about their day, and the person-first
 * panel in particular was reachable only by reading a link at the bottom
 * of the form — so the commonest way to log a meeting with someone who
 * belongs to no company was the hardest one to find.
 *
 * There is now ONE field. It lists leads/companies and contacts together,
 * in two headed groups with an icon each, so a person is never mistaken
 * for a company — at rest on the trigger as well as in the open menu
 * (`SearchableSelect`'s grouped variant, kit §16.3 and §4 rule 4). One
 * pick sets the target. The only remaining mode is `create`, which is a
 * different verb — it makes a master record — not a different way of
 * answering the same question.
 *
 * ⚠️ WHAT GETS STORED — UNCHANGED BY THE ABOVE.
 *
 * `entity_id` STILL MEANS THE COMPANY, always. Five places read it as a
 * `companies.id` — `/api/orders`, `/api/daily-activity/[id]`,
 * `src/lib/summary.ts`, `src/lib/reports/sources.ts` and
 * `src/lib/weekly-review.ts` — and none of them changed. A contact who
 * belongs to a company keeps that company there. Only a contact with NO
 * company leaves it null, which all five already handle (the audit is
 * written out in `src/lib/visit-contact.ts`).
 *
 * `contact_id` is the structured half and is additive. `entity_name` goes
 * on carrying "Person · Company" as text, which is what makes the meeting
 * read correctly on every surface — the visit card, the Deal's Meetings
 * section, the day summary, the remarks panel title, the points ledger —
 * including before the column is pushed.
 *
 * ⚠️ `daily_visits.contact_id` IS DECLARED BUT NOT YET PUSHED. Nothing here
 * or on the server touches it through Prisma's model API; see
 * `src/lib/visit-contact.ts` for the raw-SQL accessors and for why every
 * Prisma read of `daily_visits` now carries an explicit `select`.
 */

/** `TimeValue` (12-hour, as the kit models it) to "HH:MM" on a 24-hour clock. */
function to24h(v: TimeValue | undefined): string | null {
  if (!v) return null
  let h = v.hour % 12
  if (v.meridiem === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${String(v.minute).padStart(2, '0')}`
}

/** One company a contact belongs to, as `/api/contacts` shapes it. */
type ContactCompany = { id: string; name: string; type?: string | null; is_primary?: boolean }

/**
 * One pickable person. A Contact belongs to MANY Companies (REBUILD-PLAN
 * §3.4), so `companies` is always an array and may be empty.
 */
type LeadContact = {
  id: string
  name: string
  designation?: string | null
  companies?: ContactCompany[]
}

/**
 * Which question the form is asking.
 *
 * `target` is the whole of "who did you meet" — one dropdown over companies
 * and people together. `create` is the new-lead panel, a different verb: it
 * writes a permanent master record rather than naming an existing one.
 */
type Mode = 'target' | 'create'

/**
 * The picker's option values are namespaced, because a company id and a
 * contact id are both bare uuids and one field now holds both. The prefix is
 * what tells `handleAdd` which column the id belongs in — and getting that
 * wrong would write a contact id into `entity_id`, which is the single most
 * damaging thing this form can do (Orders, Deals and every report join
 * through it).
 */
const COMPANY_PREFIX = 'c:'
const CONTACT_PREFIX = 'p:'

/**
 * `visit_type` for a meeting with a person who belongs to no company.
 *
 * Every other meeting takes the party's own `companies.type`; with no company
 * there is none to take. Checked rather than assumed: the local database has
 * NO check constraint on `daily_visits.visit_type` (the
 * `daily_visits_visit_type_check` that once pinned it to Dealer/Distributor is
 * dropped in the old schema file), so a new value inserts cleanly.
 *
 * It surfaces in reports as its own "Company Type" bucket rather than
 * mislabelling the meeting as a Dealer visit — see `reports/dimensions.ts`,
 * where that dimension falls back to the `visit_type` snapshot.
 */
const STANDALONE_VISIT_TYPE = 'Contact'

/**
 * `visit_type` for a meeting with a company that has no type — an untyped
 * party, or a new lead saved with the Lead type left blank. `POST
 * /api/daily-activity` needs a non-empty value, and `'Other'` says what is
 * true (no type) where the old `'Dealer'` fallback claimed something false.
 * It shows as a neutral badge on the card like every other type.
 */
export const OTHER_VISIT_TYPE = 'Other'

/** The Lead type select's "Not set" option. A sentinel, because an empty
 *  string cannot be told apart from "no value" by the select. */
const NO_LEAD_TYPE = '__none'

/**
 * Kit §16.3 — past six options a dropdown needs a search box, which is
 * what `SearchableSelect` is; at or below six it is still a `Select`.
 *
 * The "who did you meet" picker is always the searchable one: it holds every
 * party AND every contact, which is far past six in any real tenant. This
 * constant governs only the follow-up "Which company?", whose list is one
 * person's companies and is usually two.
 */
const SEARCHABLE_ABOVE = 6

/** Kit §14.4 — the browser's `fetch` has no timeout of its own, so a
 *  stalled request would never settle and the error branch below could
 *  never run. Every request gets a deadline at the point it is made. */
const CONTACTS_TIMEOUT_MS = 15_000

/**
 * Kit §13 and §14.3 — "nothing yet", "something failed" and "still
 * loading" are three states, not one boolean. Collapsing a failed read
 * into an empty list tells the user this Lead has no contacts, which is
 * a different and false statement.
 *
 * `forbidden` is the fourth: §26 says an area the user has no access to
 * is HIDDEN, not shown broken, so a 403 from `/api/contacts` removes the
 * question rather than reporting it as a fault.
 */
type ContactsLoad =
  | { state: 'loading' }
  | { state: 'ready'; contacts: LeadContact[] }
  | { state: 'error' }
  | { state: 'forbidden' }

export type MeetingDraft = Partial<Visit> & {
  /** `daily_visits.contact_id` — the person met, when one was named. */
  contact_id?: string | null
  weekly_plan_item_id?: string | null
  /** Opportunity follow-up (`deal_follow_ups`) this meeting is logged for,
   *  when the dialog was opened from a follow-up to-do card with no
   *  company on its deal (see `planned-card.tsx` / `page.tsx`). */
  deal_follow_up_id?: string | null
  is_manual_entry?: true
  manual_start_time?: string
  manual_end_time?: string
  /** Accounts & Contacts, Stage 2 (§8): everyone present at the meeting,
   *  beyond the one account it is filed against. Optional — every flow that
   *  predates this feature sends none, and the server treats an empty/absent
   *  array as a no-op. */
  attendees?: { contact_id: string; is_main: boolean }[]
}

/** One active link on the resolved account — `GET /api/companies/[id]/links`,
 *  filtered to `is_active`. */
type AccountLink = {
  link_id: string
  contact_id: string
  contact_name: string | null
  role_name: string | null
  is_active: boolean
}

/** One attendee row in the picker, whichever of the three ways it got there. */
type AttendeeCandidate = {
  contact_id: string
  name: string
  /** From the account's own link list, vs. added in this dialog. */
  source: 'linked' | 'added'
  /** Only for an 'added' row: offer to link them to the account too. */
  alsoLink?: boolean
  roleId?: string
  isNewContact?: boolean
}

export function AddMeetingDialog({
  open,
  onOpenChange,
  planItem,
  followUpId,
  visitDate,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  planItem?: PlannedItem | null
  /** Set when the dialog was opened from a follow-up to-do card whose deal
   *  has no company — there is nothing to auto-start, so Start opens this
   *  dialog instead, and the submitted meeting still links back to the
   *  follow-up that started it. */
  followUpId?: string | null
  /** "YYYY-MM-DD" — the day already selected on the screen. */
  visitDate: string
  onAdd: (v: MeetingDraft) => Promise<void> | void
}) {
  const { toast } = useToast()

  /** F5 — the one toggle that turns this into a past entry. */
  const [isPast, setIsPast] = useState(false)
  /**
   * Which question the form is asking. `target` — one dropdown over companies
   * and people — is the default and the only way to name an existing party.
   * `create` is the new-lead panel and is one click away from it.
   */
  const [mode, setMode] = useState<Mode>('target')
  const creating = mode === 'create'
  const [saving, setSaving] = useState(false)

  const [entities, setEntities] = useState<Entity[]>([])
  const [entLoading, setEntLoading] = useState(false)

  /**
   * The one answer to "who did you meet": `c:<company id>` or
   * `p:<contact id>`, or empty.
   */
  const [target, setTarget] = useState('')
  /** Which of the person's companies, asked only when there is a real choice. */
  const [personCompanyId, setPersonCompanyId] = useState('')

  /* Every active contact. Loaded with the parties rather than per party:
     the picker holds both kinds at once, so there is no earlier answer to
     narrow the list by. */
  const [peopleLoad, setPeopleLoad] = useState<ContactsLoad>({ state: 'ready', contacts: [] })
  /** Bumped by Retry, which is the §13 "something failed" action. */
  const [peopleReload, setPeopleReload] = useState(0)
  /* Memoised, not a bare ternary: a fresh `[]` on every render would make
     the option memos below recompute every time, which is the one thing a
     memo exists not to do. */
  const people = useMemo(
    () => (peopleLoad.state === 'ready' ? peopleLoad.contacts : []),
    [peopleLoad]
  )

  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  /* A new tenant starts with no lead types. The field is optional, so that
     blocks nothing; `ready` is what separates "there are none" - said inline
     as help, with where to add them - from "still loading" or "failed". */
  const [leadTypesState, setLeadTypesState] = useState<'loading' | 'ready' | 'error'>('loading')
  const me = useMe()
  const noLeadTypes = leadTypesState === 'ready' && leadTypes.length === 0

  const [npName, setNpName] = useState('')
  const [npMobile, setNpMobile] = useState('')
  const [npPlace, setNpPlace] = useState('')
  const [npType, setNpType] = useState('')
  const [placeOptions, setPlaceOptions] = useState<Record<string, string>>({})
  const [placeMap, setPlaceMap] = useState<
    Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>
  >(new Map())

  const [startTime, setStartTime] = useState<TimeValue | undefined>(undefined)
  const [endTime, setEndTime] = useState<TimeValue | undefined>(undefined)
  const [fieldError, setFieldError] = useState<{ start?: string; end?: string }>({})

  /*
   * Attendees (§8, Stage 2) — who, beyond the account itself, was at the
   * meeting. Shown once an account is resolved, whether picked directly or
   * auto-filled/chosen from a person pick.
   */
  const [attendeeMap, setAttendeeMap] = useState<Map<string, AttendeeCandidate>>(new Map())
  const [tickedIds, setTickedIds] = useState<Set<string>>(new Set())
  const [mainId, setMainId] = useState<string | null>(null)
  const [linksLoad, setLinksLoad] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [contactRoles, setContactRoles] = useState<{ id: string; name: string }[]>([])
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<{ id: string; name: string }[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newRoleId, setNewRoleId] = useState('')
  const [makingIndividual, setMakingIndividual] = useState(false)
  const [individualMadeFor, setIndividualMadeFor] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setIsPast(false)
    setMode('target')
    setTarget('')
    setPersonCompanyId('')
    setNpName('')
    setNpMobile('')
    setNpPlace('')
    setNpType('')
    setStartTime(undefined)
    setEndTime(undefined)
    setFieldError({})
    setAttendeeMap(new Map())
    setTickedIds(new Set())
    setMainId(null)
    setLinksLoad('idle')
    setShowAddPerson(false)
    setAddQuery('')
    setAddResults([])
    setNewName('')
    setNewMobile('')
    setNewRoleId('')
    setIndividualMadeFor(null)

    fetch('/api/masters/contact-roles')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: { id: string; name: string; is_system?: boolean; is_active?: boolean }[] }) => {
        const rows = Array.isArray(d.rows) ? d.rows : []
        setContactRoles(rows.filter(r => !r.is_system && r.is_active !== false))
      })
      .catch(() => setContactRoles([]))

    setEntLoading(true)
    // One list. No stage filter, no type filter — F6 removed both
    // questions, so the form offers every active party at once. `mine=1`:
    // only the caller's own (Daily Activity is for entering your own work).
    fetch('/api/business-partners?status=all&mine=1')
      .then(r => (r.ok ? r.json() : []))
      .then((d: Entity[]) => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => { setEntLoading(false); toast('Failed to load leads', 'error') })

    setLeadTypesState('loading')
    fetch('/api/masters/lead-types?active=true')
      .then(r => {
        if (!r.ok) throw new Error(`lead types ${r.status}`)
        return r.json()
      })
      .then((d: { id: string; name: string }[]) => {
        setLeadTypes(Array.isArray(d) ? d : [])
        setLeadTypesState('ready')
      })
      .catch(() => { setLeadTypesState('error'); toast('Failed to load lead types', 'error') })
  }, [open])

  /*
   * Every active contact the caller owns (`mine=1`) — the people half of
   * the one picker.
   *
   * `/api/contacts` enforces `contacts:view` and the caller's data scope
   * itself. A rep who may log meetings but may not read the contact book gets
   * a 403, which §26 answers by HIDING the Contacts group — the permission is
   * never re-decided in the browser, and the meeting is still loggable against
   * a company. A 403 is NOT a fault and must never be reported as one.
   *
   * A 403 and a 500 are deliberately not the same branch: one is "this is not
   * yours to see", the other is "this broke and can be retried". Neither is
   * "there are no contacts", which is a third and different statement.
   *
   * `live` guards the race between a Retry and the request it replaces.
   */
  useEffect(() => {
    if (!open) { setPeopleLoad({ state: 'ready', contacts: [] }); return }
    let live = true
    setPeopleLoad({ state: 'loading' })
    fetch('/api/contacts?mine=1', { signal: AbortSignal.timeout(CONTACTS_TIMEOUT_MS) })
      .then(async r => {
        if (!live) return
        if (r.status === 403) { setPeopleLoad({ state: 'forbidden' }); return }
        if (!r.ok) { setPeopleLoad({ state: 'error' }); return }
        const d = (await r.json()) as LeadContact[]
        if (live) setPeopleLoad({ state: 'ready', contacts: Array.isArray(d) ? d : [] })
      })
      .catch(() => { if (live) setPeopleLoad({ state: 'error' }) })
    return () => { live = false }
  }, [open, peopleReload])

  /* A different person may have a different number of companies, so the
     follow-up answer never survives a change of target. */
  useEffect(() => { setPersonCompanyId('') }, [target])


  /* Location masters are only needed by the create panel, so they load
     when it opens rather than on every meeting. */
  useEffect(() => {
    if (!creating || placeMap.size > 0) return
    Promise.all([
      fetch('/api/masters/districts').then(r => r.json()),
      fetch('/api/masters/talukas').then(r => r.json()),
      fetch('/api/masters/villages').then(r => r.json()),
    ])
      .then(([districts, talukas, villages]) => {
        const distMap = new Map(districts.map((d: { id: string }) => [d.id, d]))
        const taluMap = new Map(talukas.map((t: { id: string }) => [t.id, t]))
        const opts: Record<string, string> = {}
        const pm = new Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>()
        for (const t of talukas as { id: string; name: string; district_id: string }[]) {
          const dist = distMap.get(t.district_id) as { id: string; name: string; state_id: string } | undefined
          if (!dist) continue
          opts[`t:${t.id}`] = `${dist.name} · ${t.name}`
          pm.set(`t:${t.id}`, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
        }
        for (const v of villages as { id: string; name: string; taluka_id: string }[]) {
          const talu = taluMap.get(v.taluka_id) as { id: string; name: string; district_id: string } | undefined
          const dist = talu ? (distMap.get(talu.district_id) as { id: string; name: string; state_id: string } | undefined) : undefined
          if (!talu || !dist) continue
          opts[`v:${v.id}`] = `${dist.name} · ${talu.name} · ${v.name}`
          pm.set(`v:${v.id}`, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
        }
        setPlaceOptions(opts)
        setPlaceMap(pm)
      })
      .catch(() => toast('Failed to load location data', 'error'))
  }, [creating, placeMap.size])

  /* A party that is still in the funnel is marked in the list, so one
     dropdown does not lose the Lead/Existing distinction the removed
     selector used to carry — it just stops asking about it up front. */
  const entityOptions: Record<string, string> = useMemo(
    () =>
      Object.fromEntries(
        entities.map(e => {
          // docs/accounts-contacts-spec.md §1: an Individual account always
          // reads "Name · Individual" in a picker so it is never mistaken for
          // a Company. The stage marker (Lead vs Existing) still wins when it
          // applies — Individuals skip the funnel, so the two never collide.
          const suffix =
            e.account_kind === 'Individual'
              ? 'Individual'
              : e.stage && e.stage !== 'Existing'
                ? e.stage
                : null
          return [`${COMPANY_PREFIX}${e.id}`, suffix ? `${e.name} · ${suffix}` : e.name]
        })
      ),
    [entities]
  )

  /** Every active contact, labelled so two people with one name are distinct. */
  const personOptions: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {}
    for (const c of people) {
      const company = c.companies?.[0]?.name
      const parts = [c.designation, company].filter(Boolean).join(' · ')
      out[`${CONTACT_PREFIX}${c.id}`] = parts ? `${c.name} · ${parts}` : c.name
    }
    return out
  }, [people])

  /**
   * The one list, in two headed groups.
   *
   * Companies first: they are the commoner answer and the one the screen has
   * always led with. The Contacts group is absent entirely when the caller may
   * not read the contact book (§26 hides an area) and when the read failed —
   * in the second case the message below the field says so, because an absent
   * group and an empty one must not read the same.
   */
  const targetGroups = useMemo(() => {
    const groups: SearchableSelectGroup[] = [
      { heading: 'Leads & companies', icon: <Building2Icon />, options: entityOptions },
    ]
    if (peopleLoad.state === 'ready' && Object.keys(personOptions).length > 0) {
      groups.push({ heading: 'Contacts', icon: <UserIcon />, options: personOptions })
    }
    return groups
  }, [entityOptions, personOptions, peopleLoad.state])

  const selectedCompanyId = target.startsWith(COMPANY_PREFIX)
    ? target.slice(COMPANY_PREFIX.length)
    : ''
  const selectedPersonId = target.startsWith(CONTACT_PREFIX)
    ? target.slice(CONTACT_PREFIX.length)
    : ''

  /** The companies the chosen person belongs to. Primary first — the API sorts
   *  them that way — so `[0]` is the right answer whenever there is one. */
  const personCompanies: ContactCompany[] = useMemo(
    () => (selectedPersonId ? people.find(c => c.id === selectedPersonId)?.companies ?? [] : []),
    [people, selectedPersonId]
  )

  const personCompanyOptions: Record<string, string> = useMemo(
    () => Object.fromEntries(personCompanies.map(c => [c.id, c.name])),
    [personCompanies]
  )

  /*
   * REBUILD-PLAN §3.4's consequence, applied here: a Contact may belong to
   * many Companies, and with more than one there is NO single right answer, so
   * the form asks instead of guessing. Guessing would write the wrong
   * `entity_id`, which is what Orders, Deals and every report join through.
   *
   * With exactly one company the question has one answer and is not asked.
   * With none there is no company at all and `entity_id` stays null.
   */
  const mustPickCompany = personCompanies.length > 1
  const chosenPersonCompany: ContactCompany | null =
    personCompanies.length === 0
      ? null
      : personCompanies.length === 1
        ? personCompanies[0]
        : personCompanies.find(c => c.id === personCompanyId) ?? null

  /**
   * The account the ATTENDEES step is scoped to: the company picked
   * directly, or the one a person-pick resolved to (auto-filled with one
   * link, or chosen among several). `null` with no company at all — a
   * standalone person, or a brand-new lead, has no linked contacts to offer
   * and the step does not show.
   */
  const resolvedCompanyId = selectedCompanyId || chosenPersonCompany?.id || individualMadeFor || ''

  /*
   * Attendees: load the resolved account's ACTIVE linked contacts, and seed
   * the picked person (when the "who did you meet" field named one) as
   * ticked and main by default — they were the reason the step opened.
   */
  useEffect(() => {
    if (!resolvedCompanyId) { setAttendeeMap(new Map()); setTickedIds(new Set()); setMainId(null); setLinksLoad('idle'); return }
    let live = true
    setLinksLoad('loading')
    fetch(`/api/companies/${resolvedCompanyId}/links`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: AccountLink[]) => {
        if (!live) return
        const map = new Map<string, AttendeeCandidate>()
        for (const l of rows) {
          if (!l.is_active) continue
          map.set(l.contact_id, { contact_id: l.contact_id, name: l.contact_name ?? '—', source: 'linked' })
        }
        setAttendeeMap(map)
        setLinksLoad('ready')
        setTickedIds(prev => {
          const next = new Set(prev)
          if (selectedPersonId && map.has(selectedPersonId)) next.add(selectedPersonId)
          return next
        })
        setMainId(prev => prev ?? (selectedPersonId && map.has(selectedPersonId) ? selectedPersonId : null))
      })
      .catch(() => { if (live) setLinksLoad('error') })
    return () => { live = false }
  }, [resolvedCompanyId, selectedPersonId])

  /* "Add someone else" — search any contact the caller can see, debounced
     300ms (kit §14.4's own figure for a live-filtering field). */
  useEffect(() => {
    if (!showAddPerson || addQuery.trim().length < 2) { setAddResults([]); return }
    let live = true
    setAddSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/contacts?mine=1&q=${encodeURIComponent(addQuery.trim())}`)
        .then(r => (r.ok ? r.json() : []))
        .then((d: { id: string; name: string }[]) => { if (live) setAddResults(Array.isArray(d) ? d : []) })
        .catch(() => { if (live) setAddResults([]) })
        .finally(() => { if (live) setAddSearching(false) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [showAddPerson, addQuery])

  function toggleAttendee(contactId: string, ticked: boolean) {
    setTickedIds(prev => {
      const next = new Set(prev)
      if (ticked) next.add(contactId); else next.delete(contactId)
      return next
    })
    setMainId(prev => {
      if (ticked && !prev) return contactId
      if (!ticked && prev === contactId) return null
      return prev
    })
  }

  function addExistingAttendee(contactId: string, name: string) {
    setAttendeeMap(prev => {
      const next = new Map(prev)
      if (!next.has(contactId)) next.set(contactId, { contact_id: contactId, name, source: 'added', alsoLink: false, roleId: '' })
      return next
    })
    setTickedIds(prev => new Set(prev).add(contactId))
    setMainId(prev => prev ?? contactId)
    setShowAddPerson(false)
    setAddQuery('')
    setAddResults([])
  }

  async function createAndAddAttendee() {
    if (!newName.trim()) return
    try {
      const r = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), mobile: newMobile.trim() || undefined }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast(d.error || 'Could not create the contact', 'error'); return }
      const created = await r.json()
      setAttendeeMap(prev => {
        const next = new Map(prev)
        next.set(created.id, {
          contact_id: created.id, name: newName.trim(), source: 'added',
          alsoLink: true, roleId: newRoleId, isNewContact: true,
        })
        return next
      })
      setTickedIds(prev => new Set(prev).add(created.id))
      setMainId(prev => prev ?? created.id)
      if (resolvedCompanyId) {
        const linked = await fetch(`/api/companies/${resolvedCompanyId}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: created.id, role_id: newRoleId || null }),
        })
        if (!linked.ok) {
          const d = await linked.json().catch(() => ({}))
          toast(d.error || 'The contact was created but could not be linked to the account', 'error')
        }
      }
      setNewName('')
      setNewMobile('')
      setNewRoleId('')
      setShowAddPerson(false)
    } catch {
      toast('Could not create the contact', 'error')
    }
  }

  async function toggleAlsoLink(contactId: string, link: boolean) {
    const row = attendeeMap.get(contactId)
    if (!row) return
    setAttendeeMap(prev => { const next = new Map(prev); next.set(contactId, { ...row, alsoLink: link }); return next })
    if (link && resolvedCompanyId) {
      const r = await fetch(`/api/companies/${resolvedCompanyId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, role_id: row.roleId || null }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast(d.error || 'Could not link this person to the account', 'error')
      }
    }
  }

  /** §3's "Make Individual account" — offered when a picked person has no
   *  company link at all, as the alternative to logging them standalone. */
  async function handleMakeIndividual() {
    if (!selectedPersonId || makingIndividual) return
    setMakingIndividual(true)
    try {
      const r = await fetch(`/api/contacts/${selectedPersonId}/make-individual`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.error || 'Could not create an Individual account', 'error'); return }
      setIndividualMadeFor(d.id)
      toast('Individual account created', 'success')
    } catch {
      toast('Could not create an Individual account', 'error')
    } finally {
      setMakingIndividual(false)
    }
  }

  const attendeeRows = Array.from(attendeeMap.values())

  const timesOk = !isPast || (!!startTime && !!endTime)
  const canAdd =
    mode === 'create'
      ? !!npName.trim() && timesOk
      : !!target && (!mustPickCompany || !!personCompanyId) && timesOk

  async function handleAdd() {
    if (!canAdd || saving) return

    let manual: { is_manual_entry: true; manual_start_time: string; manual_end_time: string } | Record<string, never> = {}
    if (isPast) {
      const s = to24h(startTime)
      const e = to24h(endTime)
      const errs: { start?: string; end?: string } = {}
      if (!s) errs.start = 'Enter a start time'
      if (!e) errs.end = 'Enter an end time'
      const sIso = s ? new Date(`${visitDate}T${s}:00`).toISOString() : null
      const eIso = e ? new Date(`${visitDate}T${e}:00`).toISOString() : null
      if (sIso && eIso && eIso <= sIso) errs.end = 'End time must be after start time'
      setFieldError(errs)
      if (Object.keys(errs).length > 0 || !sIso || !eIso) return
      manual = { is_manual_entry: true, manual_start_time: sIso, manual_end_time: eIso }
    }

    const planLink = planItem ? { weekly_plan_item_id: planItem.id } : {}
    const followUpLink = followUpId ? { deal_follow_up_id: followUpId } : {}
    // Attendees (§8, Stage 2): ticked rows only, at most one main — the
    // server also enforces this (pickMain, src/lib/meeting-attendees.ts), so
    // a stray double-main here is harmless either way.
    const attendeesPayload = attendeeRows
      .filter(a => tickedIds.has(a.contact_id))
      .map(a => ({ contact_id: a.contact_id, is_main: a.contact_id === mainId }))
    const attendeesLink = attendeesPayload.length > 0 ? { attendees: attendeesPayload } : {}
    setSaving(true)
    if (creating) {
      const r = placeMap.get(npPlace)
      await onAdd({
        ...planLink,
        ...followUpLink,
        ...manual,
        // Blank type: the company is created untyped and the meeting is 'Other'.
        visit_type: npType || OTHER_VISIT_TYPE,
        new_prospect: {
          name: npName.trim(),
          type: npType || null,
          mobile_1: npMobile.trim() || null,
          state_id: r?.state_id ?? null,
          district_id: r?.district_id ?? null,
          taluka_id: r?.taluka_id ?? null,
          village_id: r?.village_id ?? null,
        },
      })
    } else if (selectedPersonId) {
      /*
       * A PERSON was picked. The company they belong to, when they have one,
       * still goes in `entity_id` exactly as a company pick writes it, so
       * Orders, Deals, the day summary and every report join carry on
       * unchanged.
       *
       * With NO company `entity_id` is null. That was checked against all five
       * consumers rather than assumed — see the note in
       * `src/lib/visit-contact.ts` — and every one of them already handles it.
       */
      const person = people.find(c => c.id === selectedPersonId)
      const company = chosenPersonCompany
      await onAdd({
        ...planLink,
        ...followUpLink,
        ...manual,
        ...attendeesLink,
        /* With a company, the same rule a company pick uses — the party's own
           type, and 'Other' for a party whose type is blank.
           STANDALONE_VISIT_TYPE is only for a meeting with NO company. */
        visit_type: company ? company.type || OTHER_VISIT_TYPE : STANDALONE_VISIT_TYPE,
        entity_id: company?.id ?? null,
        entity_name: company ? `${person?.name ?? ''} · ${company.name}` : person?.name ?? '',
        contact_id: selectedPersonId,
        is_new_entity: false,
      })
    } else {
      const selected = entities.find(e => e.id === selectedCompanyId)
      await onAdd({
        ...planLink,
        ...followUpLink,
        ...manual,
        ...attendeesLink,
        // F6: the party's own type, not a type the user was made to pick.
        visit_type: selected?.type || OTHER_VISIT_TYPE,
        // The COMPANY's id, always — a contact id must never be written here.
        entity_id: selectedCompanyId,
        entity_name: selected?.name ?? '',
        // No person was named, so the structured half is empty. Picking the
        // person instead is the other branch above; there is no longer a
        // second field that could set this one alongside a company pick.
        contact_id: null,
        is_new_entity: false,
      })
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPast && <HistoryIcon className="size-4 text-warning" />}
            {isPast ? 'Log a past meeting' : 'Log a meeting'}
          </DialogTitle>
          <DialogDescription>
            {planItem
              ? `On the planned line ${[planItem.from_place, planItem.to_place].filter(Boolean).join(' → ') || 'for this day'}.`
              : followUpId
                ? 'For a follow-up whose Opportunity has no account on file.'
                : isPast
                ? 'For a meeting that already happened but was not logged live.'
                : 'For a visit that was not on the approved plan.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* F5 — the toggle, at the top, because it changes what the
              rest of the form asks for. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border-light bg-surface-sunken px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="da-past-toggle" className="cursor-pointer">
                This meeting already happened
              </Label>
              <p className="mt-0.5 text-meta text-text-secondary">
                {isPast
                  ? 'Its times are typed by hand, so it is saved as Manually Entered · Tentative with no location.'
                  : 'Leave this off to time the meeting live and capture its location.'}
              </p>
            </div>
            <Switch
              id="da-past-toggle"
              aria-label="This meeting already happened"
              checked={isPast}
              onCheckedChange={v => { setIsPast(Boolean(v)); setFieldError({}) }}
            />
          </div>

          {mode === 'target' ? (
            <>
              {/*
                ONE question, ONE field. Leads/companies and contacts sit in
                the same picker, in two headed groups with an icon each, so a
                person is never mistaken for a company — on the closed trigger
                as well as in the open menu. Kit §16.3: this list is far past
                six options in any real tenant, so it is always the searchable
                picker and never a plain `Select`.
              */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="da-target">Who did you meet</Label>
                  {/* The action sits next to the control it extends. */}
                  <Button variant="ghost" size="sm" type="button" onClick={() => setMode('create')}>
                    <PlusIcon />
                    Create new lead
                  </Button>
                </div>
                {entLoading || peopleLoad.state === 'loading' ? (
                  /* Kit §14 — a skeleton in the shape of the control that is
                     coming, never a spinner and never a line of text the field
                     then jumps over. */
                  <Skeleton className="h-control w-full" />
                ) : (
                  <SearchableSelect
                    id="da-target"
                    className="max-w-none"
                    groups={targetGroups}
                    value={target}
                    onValueChange={setTarget}
                    placeholder="Search a lead, company or person"
                    emptyMessage="Nothing matches that search."
                  />
                )}
                {/*
                  Kit §14.3 — a failed read does not share a branch with an
                  empty one. "The contacts could not be loaded" and "there are
                  no contacts" are different statements and only one of them is
                  ever true. §26's answer to no permission is to remove the
                  question, not to report a fault, so `forbidden` says nothing
                  about contacts at all: the group is simply not offered and
                  the meeting is logged against a company.
                */}
                {peopleLoad.state === 'error' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <InlineFieldError className="mt-0">
                      The contacts could not be loaded, so only leads and companies are listed
                      here. The meeting can still be logged against one.
                    </InlineFieldError>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => setPeopleReload(n => n + 1)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  /* Kit §2.3 — helper text is `text-muted`. */
                  /* The list holds only the caller's own parties (`mine=1`),
                     so "none" is a normal state for a new rep, and the way
                     forward is the Create new lead action beside the label. */
                  <p className="text-meta text-text-muted">
                    {entities.length === 0 && people.length === 0
                      ? 'You have no leads or companies of your own yet. Use Create new lead to add the one you met.'
                      : people.length > 0
                        ? 'Pick your company, or the person you met.'
                        : 'Pick the company you met.'}
                  </p>
                )}
              </div>

              {/*
                The multi-company question, asked INLINE and only when there is
                a real choice — not as a mode and not as a panel.

                REBUILD-PLAN §3.4: a Contact may belong to many Companies, and
                with more than one there is NO single right answer, so the form
                asks rather than guessing. A guess would write the wrong
                `entity_id`, which Orders, Deals and every report join through.
                With exactly one company the question has one answer and is not
                asked; with none there is no company and `entity_id` stays null.
              */}
              {mustPickCompany && (
                <div className="space-y-1.5">
                  <Label htmlFor="da-person-company">Which company?</Label>
                  {personCompanies.length > SEARCHABLE_ABOVE ? (
                    <SearchableSelect
                      id="da-person-company"
                      className="max-w-none"
                      options={personCompanyOptions}
                      value={personCompanyId}
                      onValueChange={setPersonCompanyId}
                      placeholder="Search by name"
                      emptyMessage="No company matches that search."
                    />
                  ) : (
                    <Select value={personCompanyId} onValueChange={v => setPersonCompanyId(String(v))}>
                      <SelectTrigger id="da-person-company" className="w-full max-w-none">
                        <SelectValue placeholder="Select the company" />
                      </SelectTrigger>
                      <SelectContent>
                        {personCompanies.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-meta text-text-muted">
                    This person is linked to more than one company, so the meeting has to say
                    which one it was with.
                  </p>
                </div>
              )}

              {!!selectedPersonId && personCompanies.length === 0 && !individualMadeFor && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-light bg-surface-sunken px-3 py-2.5">
                  <p className="text-meta text-text-muted">
                    This person is not linked to any company, so the meeting is logged against
                    them alone. You can make them their own account instead.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={handleMakeIndividual}
                    disabled={makingIndividual}
                  >
                    {makingIndividual ? 'Creating…' : 'Make Individual account'}
                  </Button>
                </div>
              )}

              {/*
                ATTENDEES (§8, Stage 2) — shown once an account is resolved,
                whichever way: a company picked directly, a person's single
                linked company auto-filled, one chosen among several, or a
                brand-new Individual account just created above. Zero
                attendees is always allowed — nothing here is required.
              */}
              {!!resolvedCompanyId && (
                <div className="space-y-2 rounded-lg border border-border-light p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Who was there</Label>
                    <Button variant="ghost" size="sm" type="button" onClick={() => setShowAddPerson(v => !v)}>
                      <UserPlusIcon />
                      Add someone else
                    </Button>
                  </div>

                  {linksLoad === 'loading' ? (
                    <Skeleton className="h-10 w-full" />
                  ) : linksLoad === 'error' ? (
                    <InlineFieldError className="mt-0">
                      This account&apos;s contacts could not be loaded. You can still add someone
                      by name below.
                    </InlineFieldError>
                  ) : attendeeRows.length === 0 && !showAddPerson ? (
                    <p className="text-meta text-text-muted">
                      No contacts are linked to this account yet. Add someone below, or leave this
                      empty for a walk-in.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {attendeeRows.map(a => {
                        const ticked = tickedIds.has(a.contact_id)
                        const isMain = mainId === a.contact_id
                        return (
                          <li key={a.contact_id} className="space-y-1.5 rounded-md border border-border-light px-2.5 py-2">
                            <div className="flex items-center gap-2.5">
                              <Checkbox
                                checked={ticked}
                                onCheckedChange={v => toggleAttendee(a.contact_id, v === true)}
                                aria-label={`Attended: ${a.name}`}
                              />
                              <button
                                type="button"
                                className="flex min-h-11 items-center text-text-muted hover:text-warning disabled:pointer-events-none disabled:opacity-40"
                                onClick={() => setMainId(a.contact_id)}
                                disabled={!ticked}
                                aria-label={isMain ? `${a.name} is the main person` : `Mark ${a.name} as the main person`}
                                title={isMain ? 'Main person' : 'Mark as main'}
                              >
                                <StarIcon className={isMain ? 'size-4 fill-warning text-warning' : 'size-4'} />
                              </button>
                              <span className="min-w-0 flex-1 truncate text-label text-text-primary">{a.name}</span>
                              {a.isNewContact && <span className="text-meta text-text-muted">New</span>}
                            </div>
                            {a.source === 'added' && (
                              <label className="ml-[3.75rem] flex items-center gap-2 text-meta text-text-secondary">
                                <Checkbox
                                  checked={!!a.alsoLink}
                                  onCheckedChange={v => toggleAlsoLink(a.contact_id, v === true)}
                                />
                                Also link to this account
                                {contactRoles.length > 0 && a.alsoLink && (
                                  <Select
                                    items={{ '': 'No role', ...Object.fromEntries(contactRoles.map(r => [r.id, r.name])) }}
                                    value={a.roleId || ''}
                                    onValueChange={v => setAttendeeMap(prev => {
                                      const next = new Map(prev)
                                      const row = next.get(a.contact_id)
                                      if (row) next.set(a.contact_id, { ...row, roleId: String(v ?? '') })
                                      return next
                                    })}
                                  >
                                    <SelectTrigger className="h-8 w-36 max-w-36 text-meta">
                                      <SelectValue placeholder="No role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="">No role</SelectItem>
                                      {contactRoles.map(r => (
                                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </label>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {showAddPerson && (
                    <div className="space-y-2 rounded-md border border-border-light bg-surface-sunken p-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="da-add-search">Search an existing contact</Label>
                        <Input
                          id="da-add-search"
                          className="max-w-none"
                          value={addQuery}
                          onChange={e => setAddQuery(e.target.value)}
                          placeholder="Name or mobile"
                        />
                        {addSearching && <p className="text-meta text-text-muted">Searching…</p>}
                        {addResults.length > 0 && (
                          <ul className="divide-y divide-border-light overflow-hidden rounded-md border border-border-light">
                            {addResults
                              .filter(r => !attendeeMap.has(r.id))
                              .map(r => (
                                <li key={r.id}>
                                  <button
                                    type="button"
                                    className="flex min-h-11 w-full items-center px-2.5 text-left text-label text-text-primary hover:bg-surface-control"
                                    onClick={() => addExistingAttendee(r.id, r.name)}
                                  >
                                    {r.name}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                      <p className="text-meta text-text-muted">— or create a new person —</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="da-new-person-name">Name</Label>
                          <Input id="da-new-person-name" className="max-w-none" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" />
                        </div>
                        <div className="space-y-1.5">
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
                          />
                        </div>
                      </div>
                      {contactRoles.length > 0 && (
                        <div className="space-y-1.5">
                          <Label htmlFor="da-new-person-role">Role on this account</Label>
                          <Select
                            items={{ '': 'No role', ...Object.fromEntries(contactRoles.map(r => [r.id, r.name])) }}
                            value={newRoleId}
                            onValueChange={v => setNewRoleId(String(v ?? ''))}
                          >
                            <SelectTrigger id="da-new-person-role" className="w-full max-w-none">
                              <SelectValue placeholder="No role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">No role</SelectItem>
                              {contactRoles.map(r => (
                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" type="button" onClick={() => setShowAddPerson(false)}>
                          <XIcon />
                          Cancel
                        </Button>
                        <Button size="sm" type="button" onClick={createAndAddAttendee} disabled={!newName.trim()}>
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4 rounded-lg border border-border-light p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-label font-medium text-text-primary">New lead</p>
                <Button variant="ghost" size="sm" type="button" onClick={() => setMode('target')}>
                  <ArrowLeftIcon />
                  Pick an existing lead
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-name">Name</Label>
                <Input id="da-np-name" className="max-w-none" value={npName} onChange={e => setNpName(e.target.value)} placeholder="Lead name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-mobile">Mobile</Label>
                <Input
                  id="da-np-mobile"
                  className="max-w-none"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={npMobile}
                  onChange={e => setNpMobile(e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-place">Place</Label>
                <SearchableSelect
                  id="da-np-place"
                  className="max-w-none"
                  options={placeOptions}
                  value={npPlace}
                  onValueChange={setNpPlace}
                  placeholder="District, taluka or village"
                  emptyMessage="No place matches that search."
                />
              </div>
              {/* Not the selector F6 removed: this one types a permanent
                  master record, and there is no party to read it from.
                  Optional: "Not set" saves the lead untyped and logs the
                  meeting as 'Other'. */}
              <div className="space-y-1.5">
                <Label htmlFor="da-np-type">Lead type</Label>
                <Select
                  items={{ [NO_LEAD_TYPE]: 'Not set', ...Object.fromEntries(leadTypes.map(t => [t.name, t.name])) }}
                  value={npType || NO_LEAD_TYPE}
                  onValueChange={v => setNpType(v === NO_LEAD_TYPE ? '' : String(v ?? ''))}
                >
                  <SelectTrigger id="da-np-type" className="w-full max-w-none">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LEAD_TYPE}>Not set</SelectItem>
                    {leadTypes.map(t => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Kit §2.3 — helper text, not an error: nothing here blocks. */}
                <p className="text-meta text-text-muted">
                  {noLeadTypes ? (
                    me?.permissions?.lead_types?.view ? (
                      <>
                        Optional. No lead types have been set up yet; add them in{' '}
                        <Link
                          href="/masters/lead-types"
                          className="text-primary underline underline-offset-2 outline-none hover:text-primary-hover focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
                        >
                          Masters → Lead Types
                        </Link>
                        . Without one, the meeting is logged as Other.
                      </>
                    ) : (
                      'Optional. No lead types have been set up yet (an administrator can add them in Masters → Lead Types). Without one, the meeting is logged as Other.'
                    )
                  ) : (
                    'Optional. Without one, the meeting is logged as Other.'
                  )}
                </p>
              </div>
            </div>
          )}

          {/* F8 — the kit's TimePicker (§20.2), not `<input type="time">`,
              which renders the operating system's own widget and matches
              nothing else in the app. */}
          {isPast && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="da-manual-start">Start time</Label>
                  <TimePicker
                    id="da-manual-start"
                    className="max-w-none"
                    value={startTime}
                    onValueChange={v => { setStartTime(v); setFieldError(f => ({ ...f, start: undefined })) }}
                    invalid={!!fieldError.start}
                  />
                  {fieldError.start && <p className="text-meta text-danger">{fieldError.start}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="da-manual-end">End time</Label>
                  <TimePicker
                    id="da-manual-end"
                    className="max-w-none"
                    value={endTime}
                    onValueChange={v => { setEndTime(v); setFieldError(f => ({ ...f, end: undefined })) }}
                    invalid={!!fieldError.end}
                  />
                  {fieldError.end && <p className="text-meta text-danger">{fieldError.end}</p>}
                </div>
              </div>
              <p className="text-meta text-text-muted">
                These times are tentative — typed from memory, not captured live.
              </p>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!canAdd || saving}>
            {saving ? 'Saving…' : isPast ? 'Add past meeting' : 'Add meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
