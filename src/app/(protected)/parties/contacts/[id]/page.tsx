'use client'

/**
 * P1-T15 — the Contact detail page. `REBUILD-PLAN.md` §3.2 / §3.4.
 *
 * §3.2: "Clicking a Contact opens the Contact page, which shows the Companies
 * it is linked to." **Plural.** That is the whole reason this page exists: a
 * Contact belongs to MANY Companies (§3.4), and until now nothing in the
 * product ever showed that — the Parties list shows one company per row, and
 * the Company page shows its own contacts in the other direction. A person who
 * buys for three dealers is only visible as one person HERE.
 *
 * So the Companies card is a LIST, not a field, even when it holds one entry,
 * and it sits in the wide column. The §3.4 consequence — a Deal cannot
 * auto-fill the Company when a Contact has more than one — is a Phase 2 screen,
 * but the count this page shows is the thing that will make it make sense.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ON `templates/list-page.tsx`
 *
 * Same reason as the Company page: that template is a list screen. It declares
 * `h-full`, divides a definite height between four zones and gives zone 3 the
 * only scrollbar. A detail page wants the opposite — it grows and the page
 * scrolls. `AppShell`'s content wrapper is already `h-full overflow-y-auto`, so
 * this page is plain flow content inside it.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACK ARROW
 *
 * AGENTS.md §1 rule 11: a back button does something different depending on how
 * the user arrived, which is what makes people feel lost. The breadcrumb
 * replaces it and reflects the structure of the software, not the history. Its
 * SHAPE is fixed ("Parties › <this contact>") while its href carries the list's
 * own query string when the list handed one over as `?from=`, so returning to
 * the list keeps the filters. Anything that is not a relative path under
 * `/parties` is ignored — a crafted `from` cannot turn the breadcrumb into an
 * off-site link. Identical rule to `parties/companies/[id]`.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  BuildingIcon,
  CakeIcon,
  HeartIcon,
  PhoneIcon,
  StarIcon,
} from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { LEAD_STAGE, StatusBadge, USER_STATUS } from '@/components/status-badge'
import { EMPTY, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// The wire shape
//
// Read off `src/app/api/contacts/[id]/_handlers.ts` and `../_shape.ts`: a bare
// object, no envelope, with the contact's own columns plus three embeds —
// `contact_types`, `owner` (renamed from the `users` relation) and `companies`.
//
// `companies` carries exactly what `shapeContact()` flattens out of the join
// rows: the company's `id`/`name`/`type`/`stage`, plus `is_primary` and
// `link_id`, which belong to the LINK and not to the person. A contact can be
// the primary contact at one company and not at another, which is why
// `is_primary` is here and not a column on `contacts`. Already sorted primary
// first, then alphabetical.
// ─────────────────────────────────────────────────────────────

type NamedRef = { id?: string; name: string }

type LinkedCompany = {
  id: string
  name: string
  type: string | null
  stage: string | null
  /** Of the link, not of the person. */
  is_primary: boolean
  link_id: string
}

type Contact = {
  id: string
  name: string
  mobile: string
  alternate_mobile: string | null
  whatsapp: string | null
  email: string | null
  designation: string | null
  birthday: string | null
  anniversary: string | null
  notes: string | null
  is_active: boolean
  created_at: string | null
  contact_types: NamedRef | null
  owner: NamedRef | null
  companies: LinkedCompany[]
}

/** A failed load, told apart so the empty state can say the right thing. */
type LoadError = 'not-found' | 'forbidden' | 'failed'

// ─────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────

/**
 * One label/value pair in a details card. The label is the quiet half and the
 * value the loud one — global rule 1, and §2.3's `text-secondary` is the
 * lightest thing allowed to carry a label. Same component the Company page
 * defines; both are four lines of markup and neither is worth a shared file
 * until a third page wants it.
 */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-text-primary">{children}</dd>
    </div>
  )
}

/** `—` for absent, never a blank cell and never "null". */
function orEmpty(value: string | null | undefined) {
  return value && value.trim() !== '' ? value : EMPTY
}

/**
 * A phone number as a tap-to-call link — field sales read this page standing in
 * front of the customer. `min-h-11` is the 44px touch minimum; an anchor that
 * only wraps ten digits is a 20px target on a phone.
 */
function PhoneValue({ number }: { number: string | null }) {
  if (!number || number.trim() === '') return <>{EMPTY}</>
  return (
    <a
      className={cn(
        'inline-flex min-h-11 items-center text-primary hover:text-primary-hover',
        'rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
      )}
      href={`tel:${number}`}
    >
      {number}
    </a>
  )
}

/**
 * "Primary" is a MARKER, not a status: it says which of several links is the
 * one the system reads, and it is on no axis `status-badge.tsx` carries. So it
 * is the kit `Badge` directly — the same component that file renders through.
 */
function PrimaryMarker() {
  return (
    <Badge>
      <StarIcon />
      Primary
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────

function ContactDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = params?.id ?? ''

  const [contact, setContact] = useState<Contact | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)

  /*
   * Where the breadcrumb's first level points. A relative path under `/parties`
   * only: `//evil.example` and `https://…` are both rejected, so a link the
   * user did not choose cannot be smuggled in through the URL.
   */
  const from = searchParams.get('from')
  const listHref =
    from && from.startsWith('/parties') && !from.startsWith('//') ? from : '/parties'

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${id}`, { cache: 'no-store' })
      if (res.status === 404) {
        setError('not-found')
        return
      }
      if (res.status === 403) {
        setError('forbidden')
        return
      }
      if (!res.ok) {
        setError('failed')
        return
      }
      setContact((await res.json()) as Contact)
    } catch {
      setError('failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const companies = contact?.companies ?? []

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* Section 11.2: the breadcrumb is the first element on a detail page. */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={listHref} />}>Parties</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{contact?.name ?? 'Contact'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <ContactSkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This contact is not here"
              actionLabel="Go to Parties"
              onAction={() => router.push(listHref)}
            >
              It may have been deleted, or the link may point at a record in a
              different account. The Parties list shows everything you can open.
            </EmptyState>
          )}
          {error === 'forbidden' && (
            <EmptyState
              variant="failed"
              heading="You cannot open contacts"
              actionLabel="Go to Parties"
              onAction={() => router.push(listHref)}
            >
              Your role does not include viewing contacts. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The contact could not be loaded"
              onAction={() => void load()}
            >
              The connection dropped while fetching it. Nothing has changed.
            </EmptyState>
          )}
        </div>
      )}

      {!loading && !error && contact && (
        <>
          {/*
            Global rule 1 and the header rule for this task: the Contact Name is
            the largest text and comes first; the designation and the company
            COUNT sit below it, smaller.

            The count is written here and nowhere else. The Companies card below
            could carry the same number as a badge on its title — the Company
            page's Contacts card does — but global rule 4 is "say it once", and
            of the two places this is the one the task pins down. It is also the
            more useful one: "Linked to 3 companies" read next to the name is
            the §3.4 fact; a bare "3" on a card the user is already looking at
            is not.

            `flex-wrap` rather than a fixed row — on a phone the meta items wrap
            to as many lines as they need instead of shrinking.
          */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <h1 className="text-page-title font-medium text-text-primary">
                {contact.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
                <span>{orEmpty(contact.designation)}</span>
                <span aria-hidden="true" className="text-text-muted">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BuildingIcon className="size-icon shrink-0" aria-hidden="true" />
                  {companies.length === 0
                    ? 'No company linked'
                    : `Linked to ${companies.length} ${
                        companies.length === 1 ? 'company' : 'companies'
                      }`}
                </span>
                {/*
                  §3.4's Status field is Active/Inactive. `status-badge.tsx` has
                  no CONTACT_STATUS, and that file is owned by another agent
                  this run — it is read here, never edited. USER_STATUS is the
                  product's one Active/Inactive vocabulary and it fits a contact
                  better than it fits anything else: its roles are the ones a
                  person's status takes, and its two icons are person-shaped,
                  which a contact IS. No new vocabulary is needed.
                */}
                <StatusBadge
                  vocabulary={USER_STATUS}
                  status={contact.is_active ? 'Active' : 'Inactive'}
                />
              </div>
            </div>

            {/*
              Global rule 4: the action sits next to what it controls, and this
              page has exactly one — the number in the header is the number you
              ring. Full width on a phone, shrink-wrapped beside the name above
              `sm`.
            */}
            {contact.mobile && (
              <Button
                size="lg"
                className="w-full sm:w-auto sm:shrink-0"
                render={<a href={`tel:${contact.mobile}`} />}
              >
                <PhoneIcon />
                Call {contact.mobile}
              </Button>
            )}
          </header>

          {/*
            Global rule 2: the content uses the width it is given. One column on
            a phone, two from 1024 up, with the companies — the reason the page
            exists — in the wider half and the field values beside them.
          */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <CompaniesCard companies={companies} />

              {contact.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-body text-text-primary">
                      {contact.notes}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Designation">
                      {orEmpty(contact.designation)}
                    </Field>
                    <Field label="Contact type">
                      {orEmpty(contact.contact_types?.name)}
                    </Field>
                    <Field label="Owner">{orEmpty(contact.owner?.name)}</Field>
                    <Field label="Mobile number">
                      <PhoneValue number={contact.mobile} />
                    </Field>
                    <Field label="Alternate number">
                      <PhoneValue number={contact.alternate_mobile} />
                    </Field>
                    {/*
                      §3.4: "WhatsApp Number — if different from mobile." When
                      it is the same number the row says nothing new, so the
                      field says that rather than printing the digits twice
                      (global rule 4).
                    */}
                    <Field label="WhatsApp number">
                      {contact.whatsapp && contact.whatsapp === contact.mobile ? (
                        <span className="text-text-secondary">Same as mobile</span>
                      ) : (
                        <PhoneValue number={contact.whatsapp} />
                      )}
                    </Field>
                    <Field label="Email">
                      {contact.email ? (
                        <a
                          className={cn(
                            'inline-flex min-h-11 items-center text-primary hover:text-primary-hover',
                            'rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
                          )}
                          href={`mailto:${contact.email}`}
                        >
                          {contact.email}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    {/*
                      Both are `@db.Date`. `fmtDate` goes through
                      `parseApiDate`, which reads "YYYY-MM-DD" by its parts — a
                      birthday must not slip to the previous day because the
                      browser is west of UTC.
                    */}
                    <Field label="Birthday">
                      <span className="inline-flex items-center gap-1.5">
                        <CakeIcon
                          className="size-icon shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                        {fmtDate(contact.birthday)}
                      </span>
                    </Field>
                    <Field label="Anniversary">
                      <span className="inline-flex items-center gap-1.5">
                        <HeartIcon
                          className="size-icon shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                        {fmtDate(contact.anniversary)}
                      </span>
                    </Field>
                    <Field label="Created">{fmtDate(contact.created_at)}</Field>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * §3.2 and §3.4, and the reason this page was written: **the Companies a
 * Contact is linked to, plural, as a list.**
 *
 * One entry or five, it renders the same way — a list that happens to hold one
 * row, never a "Company:" field. Each row navigates to that company's page
 * (P1-T14). `is_primary` is a property of the link, so the marker sits on the
 * row and not on the person.
 */
function CompaniesCard({ companies }: { companies: LinkedCompany[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BuildingIcon className="size-icon text-text-secondary" aria-hidden="true" />
          Companies
        </CardTitle>
      </CardHeader>

      {companies.length === 0 ? (
        <EmptyState variant="nothing-yet" heading="No company linked">
          A contact does not have to belong to a company — §3.4 makes the link
          optional — but linking one is what puts this person on that company&apos;s
          page and lets a deal find them.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border-light">
          {companies.map(company => (
            <li key={company.link_id} className="px-4 py-3">
              <Link
                href={`/parties/companies/${company.id}`}
                className={cn(
                  'flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-lg py-1',
                  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body font-medium text-primary">
                    {company.name}
                  </span>
                  {company.is_primary && <PrimaryMarker />}
                  {company.stage && (
                    <StatusBadge vocabulary={LEAD_STAGE} status={company.stage} />
                  )}
                </span>
                <span className="truncate text-label text-text-secondary">
                  {orEmpty(company.type)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * §14: grey blocks in the shape of what is coming, never a spinning wheel, so
 * the page does not jump when the data lands. The shapes match the real layout
 * — title, meta row, two columns.
 */
function ContactSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Skeleton className="h-56 w-full lg:col-span-2" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}

/**
 * `useSearchParams` has to sit under a Suspense boundary in the App Router, or
 * the route opts the whole page out of static rendering at build time. Same
 * shape as `parties/companies/[id]` and `review/[userId]`.
 */
export default function ContactDetailPage() {
  return (
    <Suspense fallback={<ContactSkeleton />}>
      <ContactDetail />
    </Suspense>
  )
}
