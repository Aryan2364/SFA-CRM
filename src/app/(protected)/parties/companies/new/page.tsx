'use client'

/**
 * P1-T16 — the two-step Company form. `REBUILD-PLAN.md` §3.3 / §3.4 / §12.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO STEPS AND NOT ONE FORM WITH A CONTACTS SECTION
 *
 * §12 closes this: **no drafts**. A contact needs a `company_id` to exist at
 * all (`company_contacts` is the join and it is NOT NULL on both sides), so the
 * only way to collect contacts in the same submit would be to hold them in
 * memory and write them after the company — which is a draft in everything but
 * name, and loses the lot if the second write fails.
 *
 * So Step 1 SAVES. Pressing Next is a real `POST /api/companies`, and the id it
 * returns is what Step 2 is for. The user is past the point of no return by
 * design: after Next there is a real company, and abandoning Step 2 leaves that
 * company with no contacts — which is a legitimate record, not an orphan.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PAGE AND NOT A DIALOG
 *
 * The Parties list still opens its Add/Edit dialog for a quick edit, and Quick
 * Create is a dialog because it is two fields. This is neither: §3.3's field
 * list is ~15 fields plus an address plus a status, and a two-step flow inside
 * an 80vh-capped dialog would scroll its own body while the step indicator
 * scrolled away with it. A detail page is also where Step 2 has to land.
 *
 * `AppShell`'s content wrapper is already `h-full overflow-y-auto`, so this is
 * plain flow content — the same choice `parties/companies/[id]/page.tsx` made
 * and for the same reason.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACK ARROW
 *
 * AGENTS.md §1 rule 11. The breadcrumb states where this sits in the software
 * ("Parties › New company"), which is stable, rather than where the user came
 * from, which is not. No `backHref` is passed to anything.
 *
 * ---------------------------------------------------------------------------
 * ADDRESSES
 *
 * §3.3's multiple addresses with one marked Primary, saved through
 * `POST /api/companies/[id]/addresses` — a route that did not exist until
 * P1-T16. `company_addresses` was created by the data-model task, backfilled by
 * a script and read by the Company page, but NOTHING in the application wrote
 * it. That mattered because `src/lib/completeness.ts` takes four of its five
 * required fields from the company's PRIMARY row there: with no write path a
 * company created in this form could never become Complete however carefully it
 * was filled in, and §3.5's rule that an order against an incomplete party
 * stays in Draft could never be satisfied.
 *
 * The addresses are written AFTER the company create, because a
 * `company_addresses` row needs a `company_id` and there is no draft company to
 * hang one off (§12). `AddressEditor` therefore holds the cards in local state
 * and this page writes them once the id exists.
 *
 * ⚠️ The primary address is also MIRRORED onto the legacy flat columns on
 * `companies` — see the note at the create call. Both are written on purpose;
 * retiring the flat ones is a separate task with its own readers to update.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/contexts/ToastContext'
import { checkEmail, checkGstin, checkLandline, checkMobile, checkPincode } from '@/lib/validation'
import { cn } from '@/lib/utils'

import {
  AddressEditor,
  addressPayload,
  blankAddress,
  isEmptyAddress,
  type AddressDraft,
} from '../../address-editor'
import { ContactDialog, type CreatedContact } from '../../contact-dialog'
import { useOwnerChoice, usePartyMasters } from '../../party-masters'

/** What `POST /api/companies` answers with, narrowed to what Step 2 needs. */
type CreatedCompany = {
  id: string
  name: string
  is_complete: boolean
  completeness_missing: string | null
}

/** Account Kind — spec §1. Company is the default everywhere. */
type AccountKind = 'Company' | 'Individual'

/** `GET /api/masters/lead-types` row, narrowed to what the Type filter needs. */
type TypeOption = { id: string; name: string; applies_to?: 'Company' | 'Individual' | 'Both' }

/** `GET /api/contacts?q=` row, narrowed to what the person picker needs. */
type ContactSearchResult = { id: string; name: string; mobile?: string | null }

/**
 * `GET /api/companies/[id]/links` — the same shape the Company page's
 * `PeopleCard` reads. Step 2 lists from here rather than from the contacts
 * this form itself created, because an Individual account's Self link is
 * written by the create route (`self_contact_id` / `self_new_person`), not by
 * this dialog — so a brand-new Individual already has a person on it before
 * "Add contact" is ever opened, and that person has to show up too.
 */
type CompanyLink = {
  link_id: string
  contact_id: string
  contact_name: string | null
  contact_mobile: string | null
  is_primary: boolean
  is_active: boolean
  is_self: boolean
}

/** `GET /api/parties/duplicates` row. */
type DuplicateMatch = { kind: 'account' | 'contact'; id: string; name: string; reason: 'mobile' | 'name' }

const BLANK = {
  name: '',
  type: '',
  industry_id: '',
  owner_user_id: '',
  mobile_1: '',
  mobile_2: '',
  landline: '',
  email: '',
  website: '',
  gst_number: '',
  description: '',
  is_active: true,
}

type FormState = typeof BLANK

export default function NewCompanyPage() {
  const router = useRouter()
  const { toast } = useToast()
  const masters = usePartyMasters()

  const [form, setForm] = useState<FormState>(BLANK)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  /** Null while on Step 1. Set by a successful Next, which is what advances. */
  /* One empty card to start, already primary — §3.3 wants an address, and an
     empty section with only an "Add" button reads as if none is expected. */
  const [addresses, setAddresses] = useState<AddressDraft[]>(() => [blankAddress(true)])
  const [company, setCompany] = useState<CreatedCompany | null>(null)
  const [contactOpen, setContactOpen] = useState(false)

  // Step 2's People list — fetched from the same `links` route the Company
  // page reads, not held in local state, so a Self link written by the
  // create call (Individual kind) shows up even though this form never
  // created that contact itself.
  const [links, setLinks] = useState<CompanyLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)

  // ── Account Kind (spec §1) ─────────────────────────────────────────────
  // Company is the default. Switching kind never clears already-typed field
  // values — `form`, `addresses` etc. are untouched by this setter.
  const [kind, setKind] = useState<AccountKind>('Company')

  // The Type master's `applies_to` is not on `usePartyMasters()`'s
  // `companyTypes` (that hook only carries `{id, name}`), so it is fetched
  // here, once, rather than widening a hook ten other screens share for one
  // field on this form.
  const [typeOptions, setTypeOptions] = useState<TypeOption[]>([])
  useEffect(() => {
    let live = true
    fetch('/api/masters/lead-types?active=true')
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => { if (live && Array.isArray(d)) setTypeOptions(d as TypeOption[]) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  const visibleTypeOptions = typeOptions.filter(t => !t.applies_to || t.applies_to === 'Both' || t.applies_to === kind)
  // The currently-picked type may no longer apply once the kind changes
  // (e.g. a Company-only type with Individual now selected) — cleared rather
  // than silently submitted as a type that does not apply to this kind.
  useEffect(() => {
    if (form.type && typeOptions.length && !visibleTypeOptions.some(t => t.name === form.type)) {
      setForm(f => ({ ...f, type: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, typeOptions])

  // ── Individual: the Person step (spec §3) ────────────────────────────────
  // Either an existing contact is picked, or a new person's name/mobile/email
  // is entered — never both. `personMode` is which half of that choice is
  // showing; it has no effect on the Company kind.
  const [personMode, setPersonMode] = useState<'existing' | 'new'>('new')
  const [personSearch, setPersonSearch] = useState('')
  const [personResults, setPersonResults] = useState<ContactSearchResult[]>([])
  const [personSearching, setPersonSearching] = useState(false)
  const [selfContact, setSelfContact] = useState<ContactSearchResult | null>(null)
  const [newPerson, setNewPerson] = useState({ name: '', mobile: '', email: '' })
  // Whether the Account Name field still tracks the person's name
  // automatically. True until the user types into Account Name directly, at
  // which point their edit wins and the two fields stop following each other.
  const nameAutoFollow = useRef(true)

  useEffect(() => {
    if (kind !== 'Individual' || personMode !== 'existing') return
    if (!personSearch.trim()) { setPersonResults([]); return }
    let live = true
    setPersonSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(personSearch.trim())}`)
        .then(r => (r.ok ? r.json() : []))
        .then((d: unknown) => { if (live) setPersonResults(Array.isArray(d) ? (d as ContactSearchResult[]) : []) })
        .catch(() => { if (live) setPersonResults([]) })
        .finally(() => { if (live) setPersonSearching(false) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [kind, personMode, personSearch])

  function pickSelfContact(c: ContactSearchResult) {
    setSelfContact(c)
    setPersonSearch('')
    setPersonResults([])
    if (nameAutoFollow.current) setForm(f => ({ ...f, name: c.name }))
  }

  function setNewPersonName(name: string) {
    setNewPerson(p => ({ ...p, name }))
    if (nameAutoFollow.current) setForm(f => ({ ...f, name }))
  }

  function setAccountName(name: string) {
    nameAutoFollow.current = false
    set('name')(name)
  }

  // ── Live duplicate warning (spec §6) — advisory only, never blocks saving.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const duplicateMobile = kind === 'Individual' ? (selfContact ? '' : newPerson.mobile) || form.mobile_1 : form.mobile_1
  const duplicateName = kind === 'Individual' ? (selfContact?.name || newPerson.name || form.name) : form.name
  useEffect(() => {
    const mobile = duplicateMobile.trim()
    const name = duplicateName.trim()
    if (!mobile && !name) { setDuplicates([]); return }
    let live = true
    const t = setTimeout(() => {
      const params = new URLSearchParams()
      if (mobile) params.set('mobile', mobile)
      if (name) params.set('name', name)
      fetch(`/api/parties/duplicates?${params.toString()}`)
        .then(r => (r.ok ? r.json() : []))
        .then((d: unknown) => { if (live) setDuplicates(Array.isArray(d) ? (d as DuplicateMatch[]) : []) })
        .catch(() => { if (live) setDuplicates([]) })
    }, 450)
    return () => { live = false; clearTimeout(t) }
  }, [duplicateMobile, duplicateName])

  // 409 from the create — the chosen contact is already Self elsewhere
  // (spec §3's conflict). Shown as a styled dialog, never a native alert.
  const [selfConflict, setSelfConflict] = useState<{ existingAccountId: string } | null>(null)

  const loadLinks = useCallback(async () => {
    if (!company) return
    setLinksLoading(true)
    try {
      const res = await fetch(`/api/companies/${company.id}/links`, { cache: 'no-store' })
      if (res.ok) setLinks((await res.json()) as CompanyLink[])
    } catch {
      // The empty state below covers a failed load; nothing to add here.
    } finally {
      setLinksLoading(false)
    }
  }, [company])

  useEffect(() => {
    if (company) void loadLinks()
  }, [company, loadLinks])

  // Owner defaults to the signed-in user and stays editable (§3.3). Applied as
  // a fallback at render rather than in an effect, so it cannot race the
  // masters fetch and cannot overwrite a choice the user already made.
  //
  // Staff on `own` scope see only the companies they own, so for them Owner is
  // locked to themselves: another owner would make the company vanish from
  // their list the moment it saved — and Step 2's address writes, which reach
  // the company by id under that same scope, then failed against it. The route
  // refuses it too (403); this keeps the form from offering it.
  const ownerChoice = useOwnerChoice('companies')
  const ownerValue =
    ownerChoice.state === 'self'
      ? ownerChoice.userId
      : form.owner_user_id || masters.currentUserId || ''

  /**
   * Every field setter also clears that field's error.
   *
   * Without this the message outlives the problem: type a name into a field
   * that was flagged empty and "Enter the company name." sits under it, in
   * danger red, next to a filled box. §7.2 rule 2 wants the message to state
   * what to do next — a message that is no longer true states nothing, and the
   * user cannot tell whether the form still objects.
   *
   * Cleared on change rather than re-validated on change: re-running the
   * validators per keystroke would flag a half-typed mobile number as too
   * short while the user is still typing it. The next submit re-validates.
   */
  function set<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => {
      setForm(f => ({ ...f, [key]: value }))
      setErrors(e => {
        if (!(key in e) && !('form' in e)) return e
        const { [key as string]: _cleared, form: _formError, ...rest } = e
        return rest
      })
    }
  }

  /**
   * The same validators the route runs (`src/lib/validation.ts`), so an inline
   * message here matches the 400 the server would have sent.
   *
   * ⚠️ Company Type is deliberately NOT checked. §3.3 inverts the old rule —
   * the Leads route 400'd without a type; the Companies route accepts a blank
   * one and stores `''`. Blank is the default and it is valid.
   */
  function validate(): boolean {
    const next: Record<string, string> = {}
    // Name is the only required field for either kind (spec §1) — except for
    // Individual, where it may be left blank as long as a person is chosen or
    // typed; the server defaults the account name from the person's name.
    if (kind === 'Company' && !form.name.trim()) {
      next.name = 'Enter the account name.'
    }
    if (kind === 'Individual') {
      if (personMode === 'existing' && !selfContact) {
        next.person = 'Pick an existing contact, or switch to "New person".'
      }
      if (personMode === 'new' && !newPerson.name.trim() && !form.name.trim()) {
        next.person = "Enter the person's name."
      }
      if (personMode === 'new') {
        const pm = checkMobile(newPerson.mobile, 'Mobile Number')
        if (pm) next.person_mobile = pm
        const pe = checkEmail(newPerson.email)
        if (pe) next.person_email = pe
      }
    }

    const m1 = checkMobile(form.mobile_1, 'Mobile Number 1')
    if (m1) next.mobile_1 = m1
    const m2 = checkMobile(form.mobile_2, 'Mobile Number 2')
    if (m2) next.mobile_2 = m2
    const land = checkLandline(form.landline)
    if (land) next.landline = land
    const gst = checkGstin(form.gst_number)
    if (gst) next.gst_number = gst
    const email = checkEmail(form.email)
    if (email) next.email = email

    /*
     * Each address card validates under its own key, `${key}.${field}`, so the
     * message lands on the card the user typed into rather than on the first
     * one. Empty cards are skipped — an untouched "Add another address" card is
     * not an error, it simply is not saved.
     */
    for (const a of addresses) {
      if (isEmptyAddress(a)) continue
      const pin = checkPincode(a.pincode)
      if (pin) next[`${a.key}.pincode`] = pin
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  /** Step 1's Next: a real create. There is no draft (§12). */
  async function saveAndContinue() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    // Cards the user never typed into are not addresses. The primary is the
    // flagged one among what is left; with every card empty there is none.
    const realAddresses = addresses.filter(a => !isEmptyAddress(a))
    const primaryAddress = realAddresses.find(a => a.is_primary) ?? realAddresses[0]

    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim() || null,
        account_kind: kind,
        // Exactly one of these, and only for Individual — never both.
        ...(kind === 'Individual' && personMode === 'existing' && selfContact
          ? { self_contact_id: selfContact.id }
          : {}),
        ...(kind === 'Individual' && personMode === 'new'
          ? {
              self_new_person: {
                name: newPerson.name.trim(),
                mobile: newPerson.mobile.trim() || undefined,
                email: newPerson.email.trim() || undefined,
              },
            }
          : {}),
        // Blank stays blank — the route stores '' for "no type".
        type: form.type || null,
        industry_id: form.industry_id || null,
        owner_user_id: ownerValue || null,
        mobile_1: form.mobile_1.trim() || null,
        mobile_2: form.mobile_2.trim() || null,
        landline: form.landline.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        gst_number: form.gst_number.trim() || null,
        description: form.description.trim() || null,
        /*
         * ⚠️ The primary address is MIRRORED onto the company row as well as
         * written to `company_addresses`.
         *
         * `companies` still carries the legacy flat address columns, and
         * screens read them today — the Parties list's District column is
         * `row.districts.name`, off `companies.district_id`. Writing only the
         * new table would blank that column for every company created here
         * while leaving the seeded ones populated, which reads as a broken
         * list rather than as a migration in progress.
         *
         * So both are written and the new table is the one completeness and
         * the Company page read. De-duplicating them means retiring the flat
         * columns across every reader, which is its own task — recorded, not
         * smuggled in here.
         */
        ...(primaryAddress
          ? {
              address: primaryAddress.address_line.trim() || null,
              pincode: primaryAddress.pincode.trim() || null,
              state_id: primaryAddress.state_id || null,
              district_id: primaryAddress.district_id || null,
              taluka_id: primaryAddress.taluka_id || null,
              village_id: primaryAddress.village_id || null,
            }
          : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setSaving(false)
      // 409: the chosen contact is already Self elsewhere (spec §3). A styled
      // dialog with a link to the existing account, never a native alert.
      if (res.status === 409 && (data as { existing_account_id?: string }).existing_account_id) {
        setSelfConflict({ existingAccountId: (data as { existing_account_id: string }).existing_account_id })
        return
      }
      setErrors({ form: (data as { error?: string }).error ?? 'Could not save this account.' })
      return
    }

    const created = data as CreatedCompany
    // The company is saved; only its landline may not be, until the database
    // has the column (src/lib/party-landline.ts).
    const landlineWarning = (data as { warning?: string }).warning

    /*
     * Status is its own write, and only when it is not the default.
     *
     * §3.3 puts Status at the END of the form, and `POST /api/companies` has no
     * `is_active` in its body — the column defaults to true. So an Active
     * company needs no second call, and an Inactive one is a PUT immediately
     * after. A failure here leaves a real, Active company rather than nothing,
     * which is why it is reported and not rolled back: there is no draft to
     * roll back to.
     */
    if (!form.is_active) {
      const flip = await fetch(`/api/companies/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })
      if (!flip.ok) toast('Account saved, but it could not be set to Inactive.', 'error')
    }

    /*
     * The addresses, once the company has an id.
     *
     * Sequential rather than `Promise.all`: each POST may demote the current
     * primary, and two of those racing could leave two rows flagged or none.
     * The server settles the flag inside a transaction per request; issuing
     * them one at a time is what keeps the sequence of transactions coherent.
     *
     * A failure here does NOT roll the company back — there is no draft to roll
     * back to (§12), and a company with some of its addresses is a real record
     * the user can finish on the company page. It is reported rather than
     * swallowed, naming how many were saved.
     */
    let savedAddresses = 0
    for (const a of realAddresses) {
      const r = await fetch(`/api/companies/${created.id}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addressPayload(a)),
      })
      if (r.ok) savedAddresses += 1
    }
    if (savedAddresses < realAddresses.length) {
      toast(
        `Account saved, but ${realAddresses.length - savedAddresses} of ${realAddresses.length} addresses could not be. Add them from the account page.`,
        'error'
      )
    }

    /*
     * Re-read the company: `is_complete` and `completeness_missing` on the
     * create response were computed BEFORE the addresses existed, so the banner
     * on Step 2 would name fields the user has just filled in. The server
     * recomputes on every address write; this picks up that answer rather than
     * guessing at it.
     */
    let finalCompany = created
    if (savedAddresses > 0) {
      const fresh = await fetch(`/api/companies/${created.id}`)
      if (fresh.ok) {
        const row = await fresh.json().catch(() => null) as CreatedCompany | null
        if (row) finalCompany = { ...created, ...row }
      }
    }

    setSaving(false)
    setCompany(finalCompany)
    if (landlineWarning) toast(landlineWarning, 'warning')
    else toast('Account saved. Add its contact people next.')
  }

  const stepTwo = company !== null

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/parties?tab=companies" />}>
              Accounts
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{stepTwo ? company.name : 'New account'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-h1 text-text-primary">
        {stepTwo ? company.name : 'New account'}
      </h1>

      {/*
        The step indicator. Two steps, and the second is only reachable by
        saving the first — so Step 1 reads "Done" once passed rather than
        offering a way back that would imply the save could be undone. Editing
        the company after it exists is the company page's job, not this form's.
      */}
      <ol className="mt-4 mb-6 flex items-center gap-3 text-label">
        <StepChip n={1} label="Account details" state={stepTwo ? 'done' : 'current'} />
        <span className="h-px w-8 bg-border" aria-hidden />
        <StepChip n={2} label="Contact people" state={stepTwo ? 'current' : 'upcoming'} />
      </ol>

      {/*
        The duplicate warning (spec §6): advisory only, visible on both steps
        while it has something to show, never a reason this form cannot save.
      */}
      {!stepTwo && duplicates.length > 0 ? (
        <Banner variant="warning" className="mb-4">
          <BannerTitle>Possible duplicate</BannerTitle>
          <BannerDescription>
            <ul className="mt-1 space-y-1">
              {duplicates.map(d => (
                <li key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-3">
                  <span>
                    {d.name} — same {d.reason === 'mobile' ? 'mobile number' : 'name'} as an existing{' '}
                    {d.kind === 'account' ? 'account' : 'contact'}
                  </span>
                  <Link
                    href={d.kind === 'account' ? `/parties/companies/${d.id}` : `/parties/contacts/${d.id}`}
                    className="shrink-0 font-medium text-primary underline underline-offset-2"
                  >
                    Open existing
                  </Link>
                </li>
              ))}
            </ul>
          </BannerDescription>
        </Banner>
      ) : null}

      {stepTwo ? (
        <StepTwo
          company={company}
          links={links}
          linksLoading={linksLoading}
          masters={masters}
          contactOpen={contactOpen}
          setContactOpen={setContactOpen}
          onCreated={() => {
            void loadLinks()
            toast('Contact added.')
          }}
          onFinish={() => router.push(`/parties/companies/${company.id}?from=%2Fparties%3Ftab%3Dcompanies`)}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Account kind</CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                Company | Individual — spec §1, Company default. A two-button
                segmented control (the kit ships no dedicated component for
                one); switching never clears anything already typed below.
              */}
              <div
                role="radiogroup"
                aria-label="Account kind"
                className="inline-flex rounded-lg border border-border bg-surface-secondary p-1"
              >
                {(['Company', 'Individual'] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'min-h-11 rounded-md px-4 text-body font-medium transition-colors duration-200',
                      kind === k
                        ? 'bg-primary text-text-inverse'
                        : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {kind === 'Individual' ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Person</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  role="radiogroup"
                  aria-label="Person"
                  className="mb-4 inline-flex rounded-lg border border-border bg-surface-secondary p-1"
                >
                  {([
                    { v: 'existing', label: 'Pick existing contact' },
                    { v: 'new', label: 'New person' },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      role="radio"
                      aria-checked={personMode === opt.v}
                      onClick={() => { setPersonMode(opt.v); setErrors(e => { const { person: _p, ...rest } = e; return rest }) }}
                      className={cn(
                        'min-h-11 rounded-md px-4 text-body font-medium transition-colors duration-200',
                        personMode === opt.v
                          ? 'bg-primary text-text-inverse'
                          : 'text-text-secondary hover:text-text-primary'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {personMode === 'existing' ? (
                  <div>
                    <Label htmlFor="person-search">Search contacts</Label>
                    <div className="relative mt-1.5">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                      <Input
                        id="person-search"
                        className="pl-9"
                        value={selfContact ? selfContact.name : personSearch}
                        onChange={e => { setSelfContact(null); setPersonSearch(e.target.value) }}
                        placeholder="Search by name or mobile…"
                        aria-invalid={Boolean(errors.person)}
                      />
                    </div>
                    <InlineFieldError>{errors.person}</InlineFieldError>

                    {!selfContact && personSearch.trim() && (
                      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                        {personSearching ? (
                          <p className="px-3 py-2 text-label text-text-muted">Searching…</p>
                        ) : personResults.length === 0 ? (
                          <p className="px-3 py-2 text-label text-text-muted">No contacts found.</p>
                        ) : (
                          <ul className="divide-y divide-border-light">
                            {personResults.map(c => (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => pickSelfContact(c)}
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-secondary"
                                >
                                  <span className="text-text-primary">{c.name}</span>
                                  {c.mobile ? <span className="text-text-muted">{c.mobile}</span> : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {selfContact ? (
                      <p className="mt-1.5 text-label text-text-muted">
                        Selected: {selfContact.name}
                        {selfContact.mobile ? ` · ${selfContact.mobile}` : ''}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 sm:col-span-6">
                      <Label htmlFor="person-name" required>Person&apos;s name</Label>
                      <Input
                        id="person-name"
                        className="mt-1.5"
                        value={newPerson.name}
                        onChange={e => setNewPersonName(e.target.value)}
                        aria-invalid={Boolean(errors.person)}
                        placeholder="Full name"
                      />
                      <InlineFieldError>{errors.person}</InlineFieldError>
                    </div>
                    <div className="col-span-12 sm:col-span-6">
                      <Label htmlFor="person-mobile">Mobile number</Label>
                      <Input
                        id="person-mobile"
                        className="mt-1.5"
                        inputMode="numeric"
                        value={newPerson.mobile}
                        onChange={e => setNewPerson(p => ({ ...p, mobile: e.target.value }))}
                        aria-invalid={Boolean(errors.person_mobile)}
                        placeholder="10 digits"
                      />
                      <InlineFieldError>{errors.person_mobile}</InlineFieldError>
                    </div>
                    <div className="col-span-12 sm:col-span-6">
                      <Label htmlFor="person-email">Email</Label>
                      <Input
                        id="person-email"
                        className="mt-1.5"
                        type="email"
                        value={newPerson.email}
                        onChange={e => setNewPerson(p => ({ ...p, email: e.target.value }))}
                        aria-invalid={Boolean(errors.person_email)}
                      />
                      <InlineFieldError>{errors.person_email}</InlineFieldError>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Account details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-name" required>Account name</Label>
                  <Input
                    id="co-name"
                    className="mt-1.5"
                    value={form.name}
                    onChange={e => setAccountName(e.target.value)}
                    aria-invalid={Boolean(errors.name)}
                    placeholder={kind === 'Individual' ? "Defaults to the person's name" : 'Registered or trading name'}
                  />
                  <InlineFieldError>{errors.name}</InlineFieldError>
                </div>

                {/* Not compulsory, blank by default — §3.3 inverts the old rule.
                    Filtered to the types that apply to the current kind. */}
                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-type">{kind === 'Individual' ? 'Type' : 'Account type'}</Label>
                  <SearchableSelect
                    id="co-type"
                    className="mt-1.5"
                    options={Object.fromEntries(visibleTypeOptions.map(t => [t.name, t.name]))}
                    value={form.type}
                    onValueChange={set('type')}
                    placeholder="Not set"
                  />
                  <p className="mt-1.5 text-label text-text-muted">Optional.</p>
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-owner">Owner</Label>
                  <SearchableSelect
                    id="co-owner"
                    className="mt-1.5"
                    options={Object.fromEntries(masters.users.map(u => [u.id, u.name]))}
                    value={ownerValue}
                    onValueChange={set('owner_user_id')}
                    placeholder="Select an employee…"
                    disabled={ownerChoice.state !== 'any'}
                  />
                  {/* §26 — a locked field says why, as helper text. While the
                      scope is still loading it is disabled with no reason. */}
                  {ownerChoice.state === 'self' && (
                    <p className="mt-1.5 text-label text-text-muted">{ownerChoice.message}</p>
                  )}
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-industry">Industry / segment</Label>
                  <SearchableSelect
                    id="co-industry"
                    className="mt-1.5"
                    options={Object.fromEntries(masters.industries.map(i => [i.id, i.name]))}
                    value={form.industry_id}
                    onValueChange={set('industry_id')}
                    placeholder="Select industry…"
                  />
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-mobile1">Phone</Label>
                  <Input
                    id="co-mobile1"
                    className="mt-1.5"
                    inputMode="numeric"
                    value={form.mobile_1}
                    onChange={e => set('mobile_1')(e.target.value)}
                    aria-invalid={Boolean(errors.mobile_1)}
                    placeholder="10 digits"
                  />
                  <InlineFieldError>{errors.mobile_1}</InlineFieldError>
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-mobile2">Alternate phone</Label>
                  <Input
                    id="co-mobile2"
                    className="mt-1.5"
                    inputMode="numeric"
                    value={form.mobile_2}
                    onChange={e => set('mobile_2')(e.target.value)}
                    aria-invalid={Boolean(errors.mobile_2)}
                  />
                  <InlineFieldError>{errors.mobile_2}</InlineFieldError>
                </div>

                {/* Its own field, not the alternate mobile: a landline has an
                    STD code and a looser check (src/lib/party-landline.ts). */}
                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-landline">Landline</Label>
                  <Input
                    id="co-landline"
                    className="mt-1.5"
                    type="tel"
                    inputMode="tel"
                    value={form.landline}
                    onChange={e => set('landline')(e.target.value)}
                    aria-invalid={Boolean(errors.landline)}
                    placeholder="022 2654 1234"
                  />
                  <InlineFieldError>{errors.landline}</InlineFieldError>
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-email">Email</Label>
                  <Input
                    id="co-email"
                    className="mt-1.5"
                    type="email"
                    value={form.email}
                    onChange={e => set('email')(e.target.value)}
                    aria-invalid={Boolean(errors.email)}
                  />
                  <InlineFieldError>{errors.email}</InlineFieldError>
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-website">Website</Label>
                  <Input
                    id="co-website"
                    className="mt-1.5"
                    value={form.website}
                    onChange={e => set('website')(e.target.value)}
                    placeholder="example.com"
                  />
                </div>

                <div className="col-span-12 sm:col-span-6">
                  <Label htmlFor="co-gst">GST number</Label>
                  <Input
                    id="co-gst"
                    className="mt-1.5"
                    value={form.gst_number}
                    onChange={e => set('gst_number')(e.target.value.toUpperCase())}
                    aria-invalid={Boolean(errors.gst_number)}
                    placeholder="15 characters"
                  />
                  <InlineFieldError>{errors.gst_number}</InlineFieldError>
                </div>

                <div className="col-span-12">
                  <Label htmlFor="co-notes">Notes</Label>
                  <Textarea
                    id="co-notes"
                    className="mt-1.5"
                    rows={3}
                    value={form.description}
                    onChange={e => set('description')(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                §3.3's multiple addresses with one marked Primary, saved through
                `POST /api/companies/[id]/addresses` — the route built for
                P1-T16 because nothing in the app wrote `company_addresses`
                before it. The primary row is what
                `src/lib/completeness.ts` reads four of its five required fields
                from, so this section is what lets a company reach Complete at
                all.
              */}
              <AddressEditor
                addresses={addresses}
                onChange={setAddresses}
                masters={masters}
                errors={errors}
              />
            </CardContent>
          </Card>

          {/*
            §3.3: Status goes at the END, not among the fields. It is not a
            property of the company the way its phone number is — it is what the
            record is FOR, and a new company is Active unless someone says
            otherwise.
          */}
          <Card className="mt-4">
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <Label htmlFor="co-active" className="text-body text-text-primary">
                  Active
                </Label>
                <p className="mt-1 text-label text-text-muted">
                  An inactive account keeps its history but is out of new entry.
                </p>
              </div>
              <Switch
                id="co-active"
                checked={form.is_active}
                onCheckedChange={v => set('is_active')(Boolean(v))}
              />
            </CardContent>
          </Card>

          {errors.form ? <InlineFieldError className="mt-4">{errors.form}</InlineFieldError> : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            {/* Same reason as the Parties header's Add button: the
                `render={<Link/>}` form is avoided on Button here. */}
            <Button variant="secondary" onClick={() => router.push('/parties?tab=companies')}>
              Cancel
            </Button>
            <Button onClick={saveAndContinue} disabled={saving}>
              {saving ? 'Saving…' : 'Save and add contacts'}
            </Button>
          </div>
        </>
      )}

      {/*
        The create's 409: the chosen existing contact is already Self on
        another account (spec §3). A styled dialog, never a native alert, with
        a link to the account that already holds them.
      */}
      <Dialog open={selfConflict !== null} onOpenChange={open => { if (!open) setSelfConflict(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already the Self contact elsewhere</DialogTitle>
            <DialogDescription>
              This person is already the Self contact of another account. Open
              that account instead, or go back and pick a different person.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSelfConflict(null)}>Close</Button>
            {selfConflict ? (
              <Button
                nativeButton={false}
                render={<Link href={`/parties/companies/${selfConflict.existingAccountId}`} />}
              >
                Open existing account
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One chip in the step indicator. */
function StepChip({
  n,
  label,
  state,
}: {
  n: number
  label: string
  state: 'done' | 'current' | 'upcoming'
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-label font-medium',
          state === 'done' && 'bg-success text-text-inverse',
          state === 'current' && 'bg-primary text-text-inverse',
          state === 'upcoming' && 'border border-border text-text-muted'
        )}
        aria-hidden
      >
        {state === 'done' ? <CheckIcon className="h-3.5 w-3.5" /> : n}
      </span>
      <span className={state === 'upcoming' ? 'text-text-muted' : 'text-text-primary'}>
        {label}
      </span>
    </li>
  )
}

/**
 * Step 2. The company already exists — this step adds people to it, and
 * "Finish" is navigation, not a save.
 */
function StepTwo({
  company,
  links,
  linksLoading,
  masters,
  contactOpen,
  setContactOpen,
  onCreated,
  onFinish,
}: {
  company: CreatedCompany
  links: CompanyLink[]
  linksLoading: boolean
  masters: ReturnType<typeof usePartyMasters>
  contactOpen: boolean
  setContactOpen: (open: boolean) => void
  onCreated: () => void
  onFinish: () => void
}) {
  // Self first, same ordering the Company page's PeopleCard uses — an
  // Individual account's own person is not just another row in the list.
  const ordered = [...links].sort((a, b) => (b.is_self ? 1 : 0) - (a.is_self ? 1 : 0))
  return (
    <>
      {/*
        The completeness result, stated plainly. This is the server's answer
        (`is_complete` / `completeness_missing` off the create response), never
        recomputed here — §3.5 puts that rule in `src/lib/completeness.ts` and
        two implementations would drift.
      */}
      {!company.is_complete && company.completeness_missing ? (
        <Banner variant="warning" className="mb-4">
          <BannerTitle>Saved, and marked Incomplete</BannerTitle>
          <BannerDescription>
            Still missing: {company.completeness_missing}. The account is usable
            now; these fields are what a full record needs.
          </BannerDescription>
        </Banner>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Contact people</CardTitle>
          <Button variant="secondary" onClick={() => setContactOpen(true)}>
            <PlusIcon />
            Add contact
          </Button>
        </CardHeader>
        <CardContent>
          {linksLoading ? (
            <p className="text-body text-text-secondary">Loading…</p>
          ) : ordered.length === 0 ? (
            <EmptyState
              variant="nothing-yet"
              heading="No contact people yet"
              actionLabel="Add contact"
              onAction={() => setContactOpen(true)}
            >
              Add the people you deal with at this account, or finish now and
              add them later from the account page.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border-light">
              {ordered.map(link => (
                <li key={link.link_id} className="flex items-center justify-between gap-4 py-3">
                  <span className="flex flex-wrap items-center gap-2 text-text-primary">
                    {link.contact_name ?? 'Unnamed'}
                    {link.is_self && <Badge>Self</Badge>}
                  </span>
                  <span className="text-text-secondary">{link.contact_mobile ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-2">
        <p className="text-label text-text-muted">
          <TriangleAlertIcon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          {company.name} is already saved. Leaving now keeps it.
        </p>
        <Button onClick={onFinish}>Finish</Button>
      </div>

      <ContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        companyId={company.id}
        companyName={company.name}
        contactTypes={masters.contactTypes}
        users={masters.users}
        /* The company is brand new, so an empty list IS "no contacts yet" and
           the first person added is the company's primary contact. An
           Individual's Self link does not count — it is not a "contact
           person" the primary marker is choosing between. */
        markPrimary={links.filter(l => !l.is_self).length === 0}
        onCreated={onCreated}
      />
    </>
  )
}
