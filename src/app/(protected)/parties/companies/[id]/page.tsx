'use client'

/**
 * P1-T14 — the Company detail page. `REBUILD-PLAN.md` §3.2/§3.3.
 *
 * Nothing like it existed: the Parties area had a list and an edit dialog and
 * no page for one record. §3.2 is the reason it has to exist — "clicking a
 * Company opens the Company page, which shows its Contacts inside" — so the
 * contacts are not a link to somewhere else, they are on this page.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ON `templates/list-page.tsx`
 *
 * That template is a list screen: it declares `h-full`, divides a definite
 * height between four zones and gives zone 3 the only scrollbar. A detail page
 * wants the opposite — it grows and the page scrolls. `AppShell`'s content
 * wrapper is already both (`h-full overflow-y-auto`), so this page is plain
 * flow content inside it and the 24px bottom padding stays at the end of the
 * scroll rather than stranded at the fold.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACK ARROW
 *
 * AGENTS.md §1 rule 11: a back button does something different depending on
 * how the user arrived, which is what makes people feel lost. The breadcrumb
 * replaces it and reflects the structure of the software, not the history.
 *
 * P1-T14 also asks that Back return the user to the list *with their filters
 * intact*, and those two are only compatible one way: the breadcrumb's SHAPE
 * is fixed ("Parties › <this company>", the same two levels every time) while
 * its href carries the list's own query string when the list handed one over.
 * The list page passes it as `?from=<encoded relative path>`; anything that is
 * not a relative path under `/parties` is ignored and the plain `/parties` is
 * used, so a crafted `from` cannot turn a breadcrumb into an off-site link.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  BuildingIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  TriangleAlertIcon,
  UsersIcon,
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
import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LEAD_STAGE,
  LEAD_TEMPERATURE,
  StatusBadge,
  USER_STATUS,
} from '@/components/status-badge'
import { EMPTY, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// The wire shape
//
// Read off `src/app/api/companies/[id]/_handlers.ts` and its `_shape.ts`: a
// bare object, no envelope, with `contacts` and `addresses` alongside the
// company's own columns. `is_primary` on a contact belongs to the LINK row
// (`company_contacts`), not to the person — a contact may be primary at one
// company and not at another (§3.4).
// ─────────────────────────────────────────────────────────────

type NamedRef = { id?: string; name: string }

type CompanyContact = {
  id: string
  name: string
  mobile: string
  alternate_mobile: string | null
  whatsapp: string | null
  email: string | null
  designation: string | null
  is_active: boolean
  contact_types: NamedRef | null
  /** Of the link, not of the person. */
  is_primary: boolean
  link_id: string
}

type CompanyAddress = {
  id: string
  label: string | null
  address_line: string | null
  city: string | null
  pincode: string | null
  is_primary: boolean
  states: NamedRef | null
  districts: NamedRef | null
  talukas: NamedRef | null
  villages: NamedRef | null
}

/**
 * Not returned by `GET /api/companies/[id]` today — there is no custom-fields
 * route anywhere under `src/app/api/`. Typed and rendered conditionally so the
 * §3.3 "Custom Fields: Supported" row appears the day the API carries it,
 * without this page having to be reopened. See the report.
 */
type CustomFieldValue = { id: string; label: string; value: string | null }

type Company = {
  id: string
  name: string
  type: string | null
  sub_type: string | null
  stage: string | null
  temperature: string | null
  is_active: boolean
  is_complete: boolean
  completeness_missing: string | null
  mobile_1: string | null
  mobile_2: string | null
  email: string | null
  website: string | null
  gst_number: string | null
  contact_person_name: string | null
  description: string | null
  next_follow_up_date: string | null
  created_at: string | null
  industries: NamedRef | null
  owner: NamedRef | null
  created_by: NamedRef | null
  contacts: CompanyContact[]
  addresses: CompanyAddress[]
  custom_fields?: CustomFieldValue[]
}

/**
 * The five from `src/lib/completeness.ts`, in its order. Named here only for
 * the case where the row says it is incomplete and records no field list —
 * which is the state most of the demo data is actually in. The banner then
 * says what has to be true rather than inventing a list.
 */
const COMPANY_REQUIRED_FIELDS =
  'Primary Address, City, State, Pincode and GST Number'

/** A failed load, told apart so the empty state can say the right thing. */
type LoadError = 'not-found' | 'forbidden' | 'failed'

// ─────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────

/**
 * One label/value pair in a details card. The label is the quiet half and the
 * value the loud one — global rule 1, and §2.3's `text-secondary` is the
 * lightest thing allowed to carry a label.
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
 * "Primary" is a MARKER, not a status: it says which of several rows is the
 * one the system reads, and it is not on any axis `status-badge.tsx` carries.
 * So it is the kit `Badge` directly — the same component that file renders
 * through — rather than a word added to the status vocabulary.
 */
function PrimaryMarker() {
  return (
    <Badge>
      <StarIcon />
      Primary
    </Badge>
  )
}

/**
 * A tap-to-call target. Field sales work standing in front of the customer;
 * `h-control-lg` is 40px and the `py` around it takes the row past the 44px
 * touch minimum.
 */
function CallButton({ mobile, name }: { mobile: string; name: string }) {
  return (
    <Button
      variant="secondary"
      size="icon-lg"
      aria-label={`Call ${name} on ${mobile}`}
      render={<a href={`tel:${mobile}`} />}
    >
      <PhoneIcon />
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────

function CompanyDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = params?.id ?? ''

  const [company, setCompany] = useState<Company | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)

  /*
   * Where the breadcrumb's first level points. A relative path under
   * `/parties` only: `//evil.example` and `https://…` are both rejected, so a
   * link the user did not choose cannot be smuggled in through the URL.
   */
  const from = searchParams.get('from')
  const listHref =
    from && from.startsWith('/parties') && !from.startsWith('//') ? from : '/parties'

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${id}`, { cache: 'no-store' })
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
      setCompany((await res.json()) as Company)
    } catch {
      setError('failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const missing = (company?.completeness_missing ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

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
            <BreadcrumbPage>{company?.name ?? 'Company'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <CompanySkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This company is not here"
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
              heading="You cannot open companies"
              actionLabel="Go to Parties"
              onAction={() => router.push(listHref)}
            >
              Your role does not include viewing companies. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The company could not be loaded"
              onAction={() => void load()}
            >
              The connection dropped while fetching it. Nothing has changed.
            </EmptyState>
          )}
        </div>
      )}

      {!loading && !error && company && (
        <>
          {/*
            Global rule 1 and §3.3: the Company Name is the largest text and
            comes first; type, owner and status sit below it and smaller.
            `flex-wrap` rather than a fixed row — on a phone the four meta
            items wrap to as many lines as they need instead of shrinking.
          */}
          <header className="flex flex-col gap-3">
            <h1 className="text-page-title font-medium text-text-primary">
              {company.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <BuildingIcon className="size-icon shrink-0" aria-hidden="true" />
                {orEmpty(company.type)}
                {company.sub_type ? ` · ${company.sub_type}` : ''}
              </span>
              <span aria-hidden="true" className="text-text-muted">
                ·
              </span>
              <span>Owner: {orEmpty(company.owner?.name)}</span>
              {/*
                §3.3's Status field is Active/Inactive. `status-badge.tsx` has
                no COMPANY_STATUS, and that file is shared — adding a word to
                it is its owner's call, not this screen's. USER_STATUS is the
                one Active/Inactive vocabulary in the product and its roles are
                the ones a company's would take (Active success, Inactive
                neutral); only its two icons are person-shaped. Flagged to the
                lead; a COMPANY_STATUS entry is a one-line change here.
              */}
              <StatusBadge
                vocabulary={USER_STATUS}
                status={company.is_active ? 'Active' : 'Inactive'}
              />
              {company.stage && (
                <StatusBadge vocabulary={LEAD_STAGE} status={company.stage} />
              )}
              {company.temperature && (
                <StatusBadge
                  vocabulary={LEAD_TEMPERATURE}
                  status={company.temperature}
                />
              )}
            </div>
          </header>

          {/*
            §7.1's banner, not a toast: the user can carry on, but it stays
            true until somebody fills the fields in. §3.5 supplies the
            consequence, which is the part that makes it worth reading.

            Two shapes, because the data has two states. When the row records
            what is missing, the banner names exactly that. When it says
            `is_complete: false` and records nothing — which is most of the
            seeded data — it says so plainly instead of naming fields that may
            in fact be filled.
          */}
          {!company.is_complete && (
            <Banner variant="warning">
              <TriangleAlertIcon />
              <BannerTitle>This company record is incomplete</BannerTitle>
              <BannerDescription>
                {missing.length > 0 ? (
                  <>
                    Still missing: <strong className="font-medium">{missing.join(', ')}</strong>.
                    An order can be booked against it, but the order stays in
                    Draft and cannot be placed until these are filled in.
                  </>
                ) : (
                  <>
                    No individual field is recorded as missing, so the record
                    needs re-checking against the five a full record requires:{' '}
                    <strong className="font-medium">{COMPANY_REQUIRED_FIELDS}</strong>.
                    Until it is marked complete, an order against it stays in
                    Draft and cannot be placed.
                  </>
                )}
              </BannerDescription>
            </Banner>
          )}

          {/*
            Global rule 2: the content uses the width it is given. One column
            on a phone, two from 1024 up, with the record's own people and
            places in the wider half and its field values beside them.
          */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <ContactsCard contacts={company.contacts ?? []} />
              <AddressesCard addresses={company.addresses ?? []} />
              {company.custom_fields && company.custom_fields.length > 0 && (
                <CustomFieldsCard fields={company.custom_fields} />
              )}
            </div>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Industry / Segment">
                      {orEmpty(company.industries?.name)}
                    </Field>
                    <Field label="Phone number">
                      {company.mobile_1 ? (
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={`tel:${company.mobile_1}`}
                        >
                          {company.mobile_1}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    <Field label="Alternate number">
                      {company.mobile_2 ? (
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={`tel:${company.mobile_2}`}
                        >
                          {company.mobile_2}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    <Field label="Email">
                      {company.email ? (
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={`mailto:${company.email}`}
                        >
                          {company.email}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    <Field label="Website">
                      {company.website ? (
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={company.website}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {company.website}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    <Field label="GST number">{orEmpty(company.gst_number)}</Field>
                    <Field label="Next follow-up">
                      {fmtDate(company.next_follow_up_date)}
                    </Field>
                    <Field label="Created">
                      {fmtDate(company.created_at)}
                      {company.created_by?.name
                        ? ` by ${company.created_by.name}`
                        : ''}
                    </Field>
                  </dl>
                </CardContent>
              </Card>

              {company.description && (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-body text-text-primary">
                      {company.description}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * §3.2, the reason this page exists: the Company's Contacts are ON it, not one
 * navigation away. Each row opens the Contact (P1-T15), which may not be built
 * yet — the link is written against the structure regardless, because that is
 * the address that page will have.
 */
function ContactsCard({ contacts }: { contacts: CompanyContact[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <UsersIcon className="size-icon text-text-secondary" aria-hidden="true" />
          Contacts
          {contacts.length > 0 && <Badge>{contacts.length}</Badge>}
        </CardTitle>
      </CardHeader>

      {contacts.length === 0 ? (
        /*
         * Deliberately NOT `EmptyState`. Every one of its variants renders a
         * Button, and the only action that belongs here — "Add contact" — is
         * P1-T16's two-step form, which does not exist yet. Global rule 4 is
         * that a control the user cannot actually use is not shown, and a
         * "Create" button wired to nothing is exactly that. This is a card
         * with a sentence in it, not a list screen's empty data area; when
         * the form lands, this becomes `EmptyState variant="nothing-yet"`
         * with a real `onAction`.
         */
        <CardContent>
          <p className="text-body text-text-secondary">
            No contacts are linked to this company yet. A contact is the person
            you deal with here — the name, the number and what they decide.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border-light">
          {contacts.map(contact => (
            <li
              key={contact.link_id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <Link
                href={`/parties/contacts/${contact.id}`}
                className={cn(
                  'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg py-1',
                  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body font-medium text-primary">
                    {contact.name}
                  </span>
                  {contact.is_primary && <PrimaryMarker />}
                  {!contact.is_active && (
                    <StatusBadge vocabulary={USER_STATUS} status="Inactive" />
                  )}
                </span>
                <span className="truncate text-label text-text-secondary">
                  {[
                    contact.designation,
                    contact.contact_types?.name,
                    contact.mobile,
                  ]
                    .filter(Boolean)
                    .join(' · ') || EMPTY}
                </span>
              </Link>
              {/*
                Outside the Link, never inside it: an anchor inside an anchor
                is invalid markup and the browser closes the outer one early.
              */}
              {contact.mobile && (
                <CallButton mobile={contact.mobile} name={contact.name} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * §3.3: multiple addresses, one of them marked Primary. The API already sorts
 * `is_primary desc, created_at asc`, so the primary one is first and the badge
 * confirms which row the rest of the system reads.
 */
function AddressesCard({ addresses }: { addresses: CompanyAddress[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <MapPinIcon className="size-icon text-text-secondary" aria-hidden="true" />
          Addresses
          {addresses.length > 0 && <Badge>{addresses.length}</Badge>}
        </CardTitle>
      </CardHeader>

      {addresses.length === 0 ? (
        /* Same reasoning as the contacts card above. */
        <CardContent>
          <p className="text-body text-text-secondary">
            No address recorded. A company needs a primary address with a city,
            a state and a pincode before an order against it can be placed.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border-light">
          {addresses.map(address => {
            /*
             * City, village, taluka, district and state are five separate
             * columns that frequently hold the same word — the seeded rows
             * have city "Pune" AND district "Pune" — and a place line reading
             * "Pune, Lonikand, Haveli, Pune, Maharashtra" says Pune twice.
             * Global rule 4: say it once. Case-insensitive, first occurrence
             * wins, so the order stays narrowest-to-widest.
             */
            const seen = new Set<string>()
            const place = [
              address.city,
              address.villages?.name,
              address.talukas?.name,
              address.districts?.name,
              address.states?.name,
            ]
              .filter((part): part is string => Boolean(part && part.trim()))
              .filter(part => {
                const key = part.trim().toLowerCase()
                if (seen.has(key)) return false
                seen.add(key)
                return true
              })
              .join(', ')

            return (
              <li key={address.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium text-text-primary">
                    {orEmpty(address.label)}
                  </span>
                  {address.is_primary && <PrimaryMarker />}
                </span>
                <span className="text-body text-text-primary">
                  {orEmpty(address.address_line)}
                </span>
                <span className="text-label text-text-secondary">
                  {place || EMPTY}
                  {address.pincode ? ` — ${address.pincode}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** §3.3's "Custom Fields: Supported". Rendered only when the payload has any. */
function CustomFieldsCard({ fields }: { fields: CustomFieldValue[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map(field => (
            <Field key={field.id} label={field.label}>
              {orEmpty(field.value)}
            </Field>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

/**
 * §14: grey blocks in the shape of what is coming, never a spinning wheel, so
 * the page does not jump when the data lands. The shapes match the real
 * layout — title, meta row, two columns.
 */
function CompanySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}

/**
 * `useSearchParams` has to sit under a Suspense boundary in the App Router, or
 * the route opts the whole page out of static rendering at build time. Same
 * shape as `review/[userId]`.
 */
export default function CompanyDetailPage() {
  return (
    <Suspense fallback={<CompanySkeleton />}>
      <CompanyDetail />
    </Suspense>
  )
}
