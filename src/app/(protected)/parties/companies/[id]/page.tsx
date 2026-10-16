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

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  BuildingIcon,
  EllipsisVerticalIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  TriangleAlertIcon,
  UserIcon,
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  LEAD_STAGE,
  LEAD_TEMPERATURE,
  StatusBadge,
  USER_STATUS,
} from '@/components/status-badge'
import { SharedWithCard } from '@/components/sharing/shared-with-card'
import { useToast } from '@/contexts/ToastContext'
import { useMe, type Me } from '@/hooks/useMe'
import { EMPTY, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { RecordSummary, type KeyFact } from '@/components/ui/record-summary'
import { ActionBar } from '@/components/ui/action-bar'
import { PhoneContactActionsSheet } from '@/components/ui/contact-actions'

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
  landline?: string | null
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

/** `src/lib/account-kind.ts` — the two account kinds, docs/accounts-contacts-spec.md §4. */
type AccountKind = 'Company' | 'Individual'

/**
 * `GET /api/companies/[id]/links` — docs/accounts-contacts-spec.md §2. One row
 * per `company_contacts` link, not per contact: the same person could in
 * principle appear through two links, though the UI never creates that.
 */
type CompanyLink = {
  link_id: string
  contact_id: string
  contact_name: string | null
  contact_mobile: string | null
  role_id: string | null
  role_name: string | null
  is_primary: boolean
  is_active: boolean
  is_self: boolean
}

/** `GET /api/masters/contact-roles` — `src/lib/account-kind.ts` `ContactRole`. */
type ContactRole = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  is_system: boolean
}

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
  /** Absent from an older response; the page defaults to 'Company'. */
  account_kind?: AccountKind
  /** Absent from an older response; only `false` drops GST from the copy. */
  gst_required_for_orders?: boolean
  mobile_1: string | null
  mobile_2: string | null
  /** Null until set, and until the column exists (src/lib/party-landline.ts). */
  landline?: string | null
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
  /**
   * Sharing (src/lib/sharing.ts), decided by the server: how the caller
   * reaches this account, whether they may change its "Shared with" list, and
   * whether sharing exists in this database yet. All absent from an older
   * response; the section renders only when `sharing_available` is true.
   */
  access?: 'owner-scope' | 'work' | 'view'
  can_share?: boolean
  sharing_available?: boolean
}

/**
 * The five from `src/lib/completeness.ts`, in its order. Named here only for
 * the case where the row says it is incomplete and records no field list —
 * which is the state most of the demo data is actually in. The banner then
 * says what has to be true rather than inventing a list.
 */
const COMPANY_REQUIRED_FIELDS =
  'Primary Address, City, State, Pincode and GST Number'
/** The same list for a firm that does not require GST (Settings › System). */
const COMPANY_REQUIRED_FIELDS_NO_GST = 'Primary Address, City, State and Pincode'

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

// ─────────────────────────────────────────────────────────────
// PHONE — Account detail (docs/phone-plan.md screen 2)
// ─────────────────────────────────────────────────────────────

/**
 * Reuses `CompanyDetail`'s own `company`/`links`/`load` state and the same
 * `GET /api/companies/[id]` + `GET /api/companies/[id]/links` calls — no
 * second fetch path to drift from the desktop one.
 */
function PhoneAccountDetail({
  id,
  company,
  error,
  loading,
  load,
  links,
  linksLoading,
  me,
  router,
}: {
  id: string
  company: Company | null
  error: LoadError | null
  loading: boolean
  load: () => Promise<void>
  links: CompanyLink[]
  linksLoading: boolean
  me: Me | null
  router: ReturnType<typeof useRouter>
}) {
  usePhoneAppBar({
    title: company?.name ?? 'Account',
    back: '/parties',
    menu:
      company && me ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More actions"
                className="flex size-10 items-center justify-center rounded-full active:bg-surface-control"
              />
            }
          >
            <EllipsisVerticalIcon aria-hidden className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!(me.permissions?.deals?.create ?? false)}
              onClick={() => router.push(`/deals/new?account=${id}`)}
            >
              New opportunity
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!(me.permissions?.orders?.create ?? false)}
              onClick={() => router.push(`/orders/new?account=${id}`)}
            >
              Place order
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!(me.permissions?.contacts?.create ?? false)}
              onClick={() => router.push(`/parties/contacts/new?account=${id}`)}
            >
              Add contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined,
  })

  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false)
  const [addressSheetOpen, setAddressSheetOpen] = useState(false)

  if (loading) {
    return <CompanySkeleton />
  }

  if (error || !company) {
    const heading =
      error === 'not-found'
        ? 'This account is not here'
        : error === 'forbidden'
          ? 'You cannot open accounts'
          : 'The account could not be loaded'
    return (
      <EmptyState
        variant="failed"
        heading={heading}
        actionLabel={error === 'failed' ? undefined : 'Go to Accounts'}
        onAction={error === 'failed' ? undefined : () => router.push('/parties')}
      >
        {error === 'failed' ? (
          <button type="button" className="text-body text-primary" onClick={() => void load()}>
            Try again
          </button>
        ) : (
          'An administrator can change access under Settings, Access Control.'
        )}
      </EmptyState>
    )
  }

  const primaryAddress = company.addresses?.find(a => a.is_primary) ?? company.addresses?.[0] ?? null
  const addressLine = primaryAddress
    ? [primaryAddress.address_line, primaryAddress.city, primaryAddress.districts?.name]
        .filter(Boolean)
        .join(', ')
    : ''

  const facts: KeyFact[] = [
    { label: 'Owner', value: company.owner?.name ?? null },
    { label: 'Type', value: company.type || (company.account_kind ?? 'Company') },
    { label: 'Next follow-up', value: company.next_follow_up_date ? fmtDate(company.next_follow_up_date) : null },
    { label: 'GST number', value: company.gst_number },
  ]

  const canLogMeeting = me ? Boolean(me.permissions?.meetings?.create) : undefined

  return (
    <div className="flex flex-col gap-5 pb-24">
      <RecordSummary
        name={company.name}
        badges={
          <>
            <StatusBadge vocabulary={USER_STATUS} status={company.is_active ? 'Active' : 'Inactive'} />
            {!company.is_complete ? <Badge variant="warning">Incomplete</Badge> : null}
          </>
        }
        meta={addressLine || undefined}
        facts={facts}
      />

      <div className="flex flex-col gap-2">
        {company.mobile_1 ? (
          <button
            type="button"
            onClick={() => setPhoneSheetOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-border-light bg-surface px-3 text-body font-medium text-primary active:bg-surface-control"
          >
            <PhoneIcon aria-hidden className="size-4" />
            {company.mobile_1}
          </button>
        ) : null}
        {company.email ? (
          <a
            href={`mailto:${company.email}`}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-border-light bg-surface px-3 text-body font-medium text-primary active:bg-surface-control"
          >
            {company.email}
          </a>
        ) : null}
        {addressLine ? (
          <button
            type="button"
            onClick={() => setAddressSheetOpen(true)}
            className="flex min-h-11 items-start gap-2 rounded-lg border border-border-light bg-surface px-3 py-2 text-left text-body text-text-primary active:bg-surface-control"
          >
            <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            {addressLine}
          </button>
        ) : null}
      </div>

      <RelatedRow
        label="Contacts"
        count={linksLoading ? undefined : links.length}
        href={`/parties/contacts?account=${id}`}
      />
      <RelatedRow label="Opportunities" href={`/deals?account=${id}`} />
      <RelatedRow label="Orders" href={`/orders?account=${id}`} />
      {/* No Meetings row: /daily-activity is desktop-only (docs/phone-plan.md,
          Decisions) and no API lists or counts one account's meetings, so a
          row here could only be a dead end. Log meeting below is the way on. */}

      <ActionBar>
        <Button
          className="w-full"
          disabled={canLogMeeting === false}
          onClick={() => router.push(`/daily-activity/new?account=${id}`)}
        >
          Log meeting
        </Button>
      </ActionBar>

      <PhoneContactActionsSheet open={phoneSheetOpen} onOpenChange={setPhoneSheetOpen} phone={company.mobile_1 ?? undefined} />
      <PhoneContactActionsSheet open={addressSheetOpen} onOpenChange={setAddressSheetOpen} address={addressLine || undefined} />
    </div>
  )
}

function RelatedRow({ label, count, href }: { label: string; count?: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between rounded-lg border border-border-light bg-surface px-3 py-2 text-body font-medium text-text-primary active:bg-surface-control"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1 text-text-secondary">
        {count !== undefined ? count : ''}
        <span aria-hidden>›</span>
      </span>
    </Link>
  )
}

function CompanyDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { layout } = useLayout()

  const id = params?.id ?? ''

  const [company, setCompany] = useState<Company | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)

  const { toast } = useToast()
  const me = useMe()
  /* null while not known yet (useMe starts null) — never read as "not
   * allowed"; PermissionTooltip below treats `allowed` as true until the
   * real answer lands, same pattern as deals/page.tsx. */
  const canEditCompanies = me ? Boolean(me.permissions?.companies?.edit) : null
  const canDeleteCompanies = me ? Boolean(me.permissions?.companies?.delete) : null

  const [links, setLinks] = useState<CompanyLink[]>([])
  const [roles, setRoles] = useState<ContactRole[]>([])
  const [linksLoading, setLinksLoading] = useState(true)

  const loadLinks = useCallback(async () => {
    if (!id) return
    setLinksLoading(true)
    try {
      const res = await fetch(`/api/companies/${id}/links`, { cache: 'no-store' })
      if (res.ok) setLinks((await res.json()) as CompanyLink[])
    } catch {
      // The People card below shows its own empty text; nothing to add here.
    } finally {
      setLinksLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  useEffect(() => {
    let live = true
    fetch('/api/masters/contact-roles', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((d: { rows?: ContactRole[] } | null) => {
        if (live && d?.rows) setRoles(d.rows.filter(r => r.is_active))
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  // ⋮ menu dialogs
  const [kindDialogOpen, setKindDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [addPersonOpen, setAddPersonOpen] = useState(false)

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

  if (layout === 'phone') {
    return (
      <PhoneAccountDetail
        id={id}
        company={company}
        error={error}
        loading={loading}
        load={load}
        links={links}
        linksLoading={linksLoading}
        me={me}
        router={router}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* Section 11.2: the breadcrumb is the first element on a detail page. */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={listHref} />}>Accounts</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{company?.name ?? 'Account'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <CompanySkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This account is not here"
              actionLabel="Go to Accounts"
              onAction={() => router.push(listHref)}
            >
              It may have been deleted, or the link may point at a record in a
              different firm. The Accounts list shows everything you can open.
            </EmptyState>
          )}
          {error === 'forbidden' && (
            <EmptyState
              variant="failed"
              heading="You cannot open accounts"
              actionLabel="Go to Accounts"
              onAction={() => router.push(listHref)}
            >
              Your role does not include viewing accounts. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The account could not be loaded"
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-page-title font-medium text-text-primary">
                {company.name}
              </h1>
              {/*
                §4's one ⋮ menu for the record-level actions: change kind and
                delete. Permission-aware per global rule 4 — each item is
                shown, disabled with a tooltip naming who may act, never
                hidden, because a missing menu item cannot be told apart from
                one the user simply isn't allowed to use.
              */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="secondary" size="icon-lg" aria-label="Account actions">
                      <EllipsisVerticalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {/*
                    Tri-state: while `me` is still loading (null), the
                    control is disabled with NO reason — "not known yet" is
                    not "not allowed" (global rule 4). `allowed` only turns
                    false, and the tooltip only appears, once the real
                    answer has landed and says no.
                  */}
                  <PermissionTooltip
                    allowed={canEditCompanies !== false}
                    reason="Only someone who can edit accounts can change its kind."
                  >
                    <DropdownMenuItem
                      disabled={canEditCompanies !== true}
                      onClick={() => setKindDialogOpen(true)}
                    >
                      Change to {(company.account_kind ?? 'Company') === 'Individual' ? 'Company' : 'Individual'}
                    </DropdownMenuItem>
                  </PermissionTooltip>
                  <PermissionTooltip
                    allowed={canDeleteCompanies !== false}
                    reason="Only someone who can delete accounts can delete this one."
                  >
                    <DropdownMenuItem
                      disabled={canDeleteCompanies !== true}
                      variant="danger"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </PermissionTooltip>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
              {/* Company/Individual — global rule 1: near the name, before
                  anything else about the record. */}
              <Badge>
                {(company.account_kind ?? 'Company') === 'Individual' ? (
                  <UserIcon />
                ) : (
                  <BuildingIcon />
                )}
                {company.account_kind ?? 'Company'}
              </Badge>
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
              {/* Shown only to someone who reaches this account because it
                  was shared with them — the owner and their managers never
                  see it, so it marks the exception, not the rule. */}
              {(company.access === 'work' || company.access === 'view') && (
                <Badge>
                  <UsersIcon />
                  {company.access === 'work' ? 'Shared with you: can work' : 'Shared with you: view only'}
                </Badge>
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
                    needs re-checking against the fields a full record requires:{' '}
                    <strong className="font-medium">
                      {company.gst_required_for_orders === false
                        ? COMPANY_REQUIRED_FIELDS_NO_GST
                        : COMPANY_REQUIRED_FIELDS}
                    </strong>.
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
              <PeopleCard
                companyId={company.id}
                kind={company.account_kind ?? 'Company'}
                links={links}
                loading={linksLoading}
                roles={roles}
                canEdit={canEditCompanies}
                onChanged={() => void Promise.all([load(), loadLinks()])}
                onAddPerson={() => setAddPersonOpen(true)}
              />
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
                    {/* Shown like its sibling numbers, dash when blank. The
                        dial string drops the spaces and hyphens it was typed
                        with; the text keeps them. */}
                    <Field label="Landline">
                      {company.landline ? (
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={`tel:${company.landline.replace(/[\s-]/g, '')}`}
                        >
                          {company.landline}
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

              {company.sharing_available && (
                <SharedWithCard
                  endpoint={`/api/companies/${company.id}/members`}
                  canShare={company.can_share === true}
                  noun="account"
                />
              )}

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

          <KindChangeDialog
            open={kindDialogOpen}
            onOpenChange={setKindDialogOpen}
            companyId={company.id}
            currentKind={company.account_kind ?? 'Company'}
            links={links}
            roles={roles}
            onDone={() => { setKindDialogOpen(false); void Promise.all([load(), loadLinks()]) }}
          />

          <DeleteAccountDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            companyId={company.id}
            companyName={company.name}
            isActive={company.is_active}
            onDeleted={() => router.push(listHref)}
            onMadeInactive={() => { setDeleteDialogOpen(false); void load() }}
          />

          <AddPersonDialog
            open={addPersonOpen}
            onOpenChange={setAddPersonOpen}
            companyId={company.id}
            roles={roles}
            existingContactIds={links.map(l => l.contact_id)}
            onAdded={() => { setAddPersonOpen(false); void loadLinks() }}
          />
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
/**
 * docs/accounts-contacts-spec.md §2/§4 — the People section. Reads
 * `/api/companies/[id]/links`, not `company.contacts`: the link carries the
 * role and the Self flag that the plain contacts list does not. For an
 * Individual account the Self person renders first, with its own badge.
 */
function PeopleCard({
  companyId,
  kind,
  links,
  loading,
  roles,
  canEdit,
  onChanged,
  onAddPerson,
}: {
  companyId: string
  kind: AccountKind
  links: CompanyLink[]
  loading: boolean
  roles: ContactRole[]
  /** Tri-state, straight from `useMe()`: null while `/api/auth/me` has not
   *  answered yet. Every control below reads it as "not known yet", never as
   *  "not allowed" — disabled with no reason until it resolves. */
  canEdit: boolean | null
  onChanged: () => void
  onAddPerson: () => void
}) {
  const { toast } = useToast()
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<CompanyLink | null>(null)

  // `allowed` only turns false — and the tooltip only appears — once the
  // real answer says no. `disabled` is the opposite: true unless the real
  // answer explicitly says yes, so a still-loading `null` is disabled with
  // no reason, same as `false`, until it resolves.
  const editAllowed = canEdit !== false
  const editDisabled = canEdit !== true

  const ordered = useMemo(() => {
    const self = links.filter(l => l.is_self)
    const rest = links.filter(l => !l.is_self)
    return [...self, ...rest]
  }, [links])

  const roleOptions = useMemo(
    () => Object.fromEntries(roles.map(r => [r.id, r.name])),
    [roles]
  )

  async function patchLink(link: CompanyLink, data: Record<string, unknown>) {
    setBusyLinkId(link.link_id)
    try {
      const res = await fetch(`/api/companies/${companyId}/links/${link.link_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(body.error ?? 'Could not save that change', 'error')
        return
      }
      onChanged()
    } catch {
      toast('The connection dropped. Nothing was saved.', 'error')
    } finally {
      setBusyLinkId(null)
    }
  }

  async function doRemove(link: CompanyLink) {
    setBusyLinkId(link.link_id)
    try {
      const res = await fetch(`/api/companies/${companyId}/links/${link.link_id}`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(body.error ?? 'Could not remove that person', 'error')
        return
      }
      toast(`${link.contact_name ?? 'Person'} removed`, 'success')
      onChanged()
    } catch {
      toast('The connection dropped. Nothing was removed.', 'error')
    } finally {
      setBusyLinkId(null)
      setRemoveTarget(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="inline-flex items-center gap-2">
          <UsersIcon className="size-icon text-text-secondary" aria-hidden="true" />
          People
          {links.length > 0 && <Badge>{links.length}</Badge>}
        </CardTitle>
        <PermissionTooltip
          allowed={editAllowed}
          reason="Only someone who can edit accounts can add a person."
        >
          <Button variant="secondary" size="sm" disabled={editDisabled} onClick={onAddPerson}>
            <PlusIcon />
            Add person
          </Button>
        </PermissionTooltip>
      </CardHeader>

      {loading ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : ordered.length === 0 ? (
        <CardContent>
          <p className="text-body text-text-secondary">
            No one is linked to this account yet. Add the people you deal with
            here, and the role each one plays.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border-light">
          {ordered.map(link => {
            // The Self link is locked to its role and cannot be removed while
            // the account is an Individual — it IS the individual's own
            // record, not a person playing a role at it.
            const lockedSelf = link.is_self && kind === 'Individual'
            const busy = busyLinkId === link.link_id
            return (
              <li
                key={link.link_id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/parties/contacts/${link.contact_id}`}
                      className="truncate text-body font-medium text-primary outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
                    >
                      {link.contact_name ?? 'Unnamed'}
                    </Link>
                    {link.is_self && <Badge>Self</Badge>}
                    {link.is_primary && <PrimaryMarker />}
                    {!link.is_active && (
                      <StatusBadge vocabulary={USER_STATUS} status="Inactive" />
                    )}
                  </span>
                  <span className="truncate text-label text-text-secondary">
                    {link.contact_mobile || EMPTY}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <PermissionTooltip
                    allowed={editAllowed && !lockedSelf}
                    reason={
                      lockedSelf
                        ? "This is the Individual's own record and can't be changed while the account is an Individual."
                        : 'Only someone who can edit accounts can change a role.'
                    }
                  >
                    <SearchableSelect
                      options={roleOptions}
                      value={link.role_id ?? ''}
                      onValueChange={value => void patchLink(link, { role_id: value || null })}
                      placeholder="No role"
                      disabled={editDisabled || lockedSelf || busy}
                      className="w-44"
                    />
                  </PermissionTooltip>

                  <PermissionTooltip
                    allowed={editAllowed}
                    reason="Only someone who can edit accounts can set the primary person."
                  >
                    <Button
                      variant={link.is_primary ? 'secondary' : 'ghost'}
                      size="icon"
                      aria-label={link.is_primary ? 'Primary contact' : 'Mark as primary'}
                      disabled={editDisabled || busy || link.is_primary}
                      onClick={() => void patchLink(link, { is_primary: true })}
                    >
                      <StarIcon />
                    </Button>
                  </PermissionTooltip>

                  <PermissionTooltip
                    allowed={editAllowed}
                    reason="Only someone who can edit accounts can change who is active."
                  >
                    <Switch
                      checked={link.is_active}
                      disabled={editDisabled || busy}
                      onCheckedChange={checked => void patchLink(link, { is_active: checked })}
                      aria-label={link.is_active ? 'Mark inactive' : 'Mark active'}
                    />
                  </PermissionTooltip>

                  <PermissionTooltip
                    allowed={editAllowed && !lockedSelf}
                    reason={
                      lockedSelf
                        ? "This is the Individual's own record and can't be removed while the account is an Individual."
                        : 'Only someone who can edit accounts can remove a person.'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${link.contact_name ?? 'this person'}`}
                      disabled={editDisabled || lockedSelf || busy}
                      onClick={() => setRemoveTarget(link)}
                    >
                      <TrashIcon />
                    </Button>
                  </PermissionTooltip>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={!!removeTarget} onOpenChange={open => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.contact_name ?? 'this person'}?</DialogTitle>
            <DialogDescription>
              This removes the link between this person and this account. The
              person&rsquo;s own record is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              variant="danger"
              disabled={busyLinkId === removeTarget?.link_id}
              onClick={() => removeTarget && void doRemove(removeTarget)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

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
            No contacts are linked to this account yet. A contact is the person
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
                  'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
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
 * docs/accounts-contacts-spec.md §4 — `POST /api/companies/[id]/kind`. Two
 * different forms behind one dialog, because the question asked is different
 * each direction: Company → Individual needs to know WHO the Self person is;
 * Individual → Company needs to know what ROLE the former Self keeps.
 */
function KindChangeDialog({
  open,
  onOpenChange,
  companyId,
  currentKind,
  links,
  roles,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  currentKind: AccountKind
  links: CompanyLink[]
  roles: ContactRole[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const targetKind: AccountKind = currentKind === 'Individual' ? 'Company' : 'Individual'

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [selfContactId, setSelfContactId] = useState('')
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [formerRoleId, setFormerRoleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('existing')
    setSelfContactId('')
    setNewName('')
    setNewMobile('')
    const defaultRole = roles.find(r => r.name === 'Owner/Proprietor')
    setFormerRoleId(defaultRole?.id ?? '')
    setError(null)
  }, [open, roles])

  const contactOptions = useMemo(
    () => Object.fromEntries(links.map(l => [l.contact_id, l.contact_name ?? l.contact_id])),
    [links]
  )
  const roleOptions = useMemo(
    () => Object.fromEntries(roles.map(r => [r.id, r.name])),
    [roles]
  )

  async function submit() {
    setError(null)
    if (targetKind === 'Individual' && mode === 'existing' && !selfContactId) {
      setError('Choose who the Self person is.')
      return
    }
    if (targetKind === 'Individual' && mode === 'new' && !newName.trim()) {
      setError('Enter the new person’s name.')
      return
    }
    setSaving(true)
    try {
      const body =
        targetKind === 'Individual'
          ? mode === 'existing'
            ? { kind: 'Individual', self_contact_id: selfContactId }
            : { kind: 'Individual', self_new_person: { name: newName.trim(), mobile: newMobile.trim() || undefined } }
          : { kind: 'Company', former_self_role_id: formerRoleId || undefined }
      const res = await fetch(`/api/companies/${companyId}/kind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not change the account kind')
        return
      }
      toast(`Account changed to ${targetKind}`, 'success')
      onDone()
    } catch {
      setError('The connection dropped. Nothing was changed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change to {targetKind}</DialogTitle>
          <DialogDescription>
            {targetKind === 'Individual'
              ? 'Meetings, opportunities and orders on this account stay. Pick who the Self person is.'
              : 'The current Self person stays linked, under the role you choose below.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {targetKind === 'Individual' ? (
            <>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === 'existing' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setMode('existing')}
                >
                  Existing contact
                </Button>
                <Button
                  type="button"
                  variant={mode === 'new' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setMode('new')}
                >
                  New person
                </Button>
              </div>
              {mode === 'existing' ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Self contact</Label>
                  <SearchableSelect
                    options={contactOptions}
                    value={selfContactId}
                    onValueChange={setSelfContactId}
                    placeholder="Choose a linked contact"
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="kind-new-name">Name</Label>
                    <Input id="kind-new-name" value={newName} onChange={e => setNewName(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="kind-new-mobile">Mobile (optional)</Label>
                    <Input id="kind-new-mobile" value={newMobile} onChange={e => setNewMobile(e.target.value)} />
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Role for the former Self person</Label>
              <SearchableSelect
                options={roleOptions}
                value={formerRoleId}
                onValueChange={setFormerRoleId}
                placeholder="Owner/Proprietor"
              />
            </div>
          )}

          {error && <p className="text-label text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : `Change to ${targetKind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * docs/accounts-contacts-spec.md §5 — `DELETE /api/companies/[id]`. A 409
 * means the account has history and cannot be hard-deleted; the dialog then
 * offers "Make inactive" instead, which reuses the same Active/Inactive
 * column the header badge and the Edit form already read (`PUT` with
 * `{ is_active: false }`) rather than inventing a second mechanism.
 */
function DeleteAccountDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  isActive,
  onDeleted,
  onMadeInactive,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  companyName: string
  isActive: boolean
  onDeleted: () => void
  onMadeInactive: () => void
}) {
  const { toast } = useToast()
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBlockedMessage(null)
  }, [open])

  async function doDelete() {
    setBusy(true)
    try {
      const res = await fetch(`/api/companies/${companyId}`, { method: 'DELETE' })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        setBlockedMessage(data.error ?? 'This account has history and cannot be deleted.')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data.error ?? 'Could not delete this account', 'error')
        return
      }
      toast(`${companyName} deleted`, 'success')
      onDeleted()
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function makeInactive() {
    setBusy(true)
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data.error ?? 'Could not mark this account inactive', 'error')
        return
      }
      toast(`${companyName} marked inactive`, 'success')
      onMadeInactive()
    } catch {
      toast('The connection dropped. Nothing was changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{blockedMessage ? 'This account can’t be deleted' : `Delete ${companyName}?`}</DialogTitle>
          <DialogDescription>
            {blockedMessage ??
              'This permanently removes the account and its links to people. This cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          {blockedMessage ? (
            isActive && (
              <Button onClick={() => void makeInactive()} disabled={busy}>
                {busy ? 'Saving…' : 'Make inactive'}
              </Button>
            )
          ) : (
            <Button variant="danger" onClick={() => void doDelete()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * docs/accounts-contacts-spec.md §2 — add a person to this account: search an
 * existing contact, or create one inline, then link it with a role.
 */
function AddPersonDialog({
  open,
  onOpenChange,
  companyId,
  roles,
  existingContactIds,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  roles: ContactRole[]
  existingContactIds: string[]
  onAdded: () => void
}) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string; mobile: string | null }[]>([])
  const [searching, setSearching] = useState(false)
  const [contactId, setContactId] = useState('')
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('existing')
    setQuery('')
    setResults([])
    setContactId('')
    setNewName('')
    setNewMobile('')
    setNewEmail('')
    setRoleId('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open || mode !== 'existing') return
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let live = true
    setSearching(true)
    const timer = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : []))
        .then((rows: { id: string; name: string; mobile: string | null }[]) => {
          if (live) setResults(rows.filter(r => !existingContactIds.includes(r.id)))
        })
        .catch(() => { if (live) setResults([]) })
        .finally(() => { if (live) setSearching(false) })
    }, 300)
    return () => { live = false; clearTimeout(timer) }
  }, [open, mode, query, existingContactIds])

  const roleOptions = useMemo(
    () => Object.fromEntries(roles.map(r => [r.id, r.name])),
    [roles]
  )

  async function submit() {
    setError(null)
    if (mode === 'existing' && !contactId) {
      setError('Pick a contact first.')
      return
    }
    if (mode === 'new' && !newName.trim()) {
      setError('Enter a name.')
      return
    }
    setSaving(true)
    try {
      let linkContactId = contactId
      if (mode === 'new') {
        const createRes = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            mobile: newMobile.trim() || undefined,
            email: newEmail.trim() || undefined,
          }),
        })
        const created = await createRes.json().catch(() => ({}))
        if (!createRes.ok) {
          setError(created.error ?? 'Could not create that person')
          return
        }
        linkContactId = created.id
      }
      const linkRes = await fetch(`/api/companies/${companyId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: linkContactId, role_id: roleId || undefined }),
      })
      const linked = await linkRes.json().catch(() => ({}))
      if (!linkRes.ok) {
        setError(linked.error ?? 'Could not add that person')
        return
      }
      toast(`${mode === 'new' ? newName.trim() : 'Person'} added`, 'success')
      onAdded()
    } catch {
      setError('The connection dropped. Nothing was added.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>Link an existing contact, or create a new one.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'existing' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('existing')}
            >
              Existing contact
            </Button>
            <Button
              type="button"
              variant={mode === 'new' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('new')}
            >
              New person
            </Button>
          </div>

          {mode === 'existing' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-person-search">Search contacts</Label>
              <Input
                id="add-person-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type a name"
              />
              {searching && <p className="text-label text-text-secondary">Searching…</p>}
              {!searching && query.trim().length >= 2 && (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-border-light">
                  {results.length === 0 ? (
                    <li className="px-3 py-2 text-label text-text-secondary">No matches.</li>
                  ) : (
                    results.map(r => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setContactId(r.id)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body hover:bg-surface-control',
                            contactId === r.id && 'bg-primary-subtle'
                          )}
                        >
                          <span>{r.name}</span>
                          <span className="text-label text-text-secondary">{r.mobile ?? EMPTY}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-person-name">Name</Label>
                <Input id="add-person-name" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-person-mobile">Mobile (optional)</Label>
                <Input id="add-person-mobile" value={newMobile} onChange={e => setNewMobile(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-person-email">Email (optional)</Label>
                <Input id="add-person-email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <SearchableSelect
              options={roleOptions}
              value={roleId}
              onValueChange={setRoleId}
              placeholder="No role"
            />
          </div>

          {error && <p className="text-label text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Adding…' : 'Add person'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
