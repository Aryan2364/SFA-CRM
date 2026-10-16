'use client'

/**
 * P1-T13 — the Parties page. `REBUILD-PLAN.md` §3.2.
 *
 * This file IS the old `src/app/(protected)/leads/page.tsx`, moved and
 * converted rather than replaced: the Companies tab is that screen, retargeted
 * from the deprecated `/api/leads/*` aliases onto `/api/companies/*`, and the
 * Contacts tab is the second half §3.2 asks for.
 *
 * ---------------------------------------------------------------------------
 * ONE PAGE, TWO TABS, AND WHY THE TAB IS IN THE URL
 *
 * §3.2: "A single Parties page with two tabs: Companies and Contacts. Each tab
 * has its own list, search and filters." Each tab is therefore its own
 * `ListPage` — its own `load`, its own `filters`, its own search box and its
 * own pagination — and only the active one is mounted. Switching tabs does not
 * carry the other tab's search across, because the two searches are not the
 * same question.
 *
 * `section-tabs.tsx` keeps the active tab in the query string (`?tab=…`) and
 * REPLACES the history entry when it changes. Both detail pages read `?from=`
 * and point their breadcrumb's first level at it, so a row opened from the
 * Contacts tab returns to the Contacts tab.
 *
 * ---------------------------------------------------------------------------
 * THE HEIGHT CHAIN
 *
 * The tab bar goes in `ListPage`'s `sectionTabs` slot (zone 1a), NOT above the
 * template. That is the whole reason the slot exists: the template wraps it in
 * `shrink-0` itself, so zone 3 keeps the remainder of the window and the page
 * body still does not scroll. Nothing here is wrapped in a plain `div`, and no
 * prop was added to `list-page`.
 *
 * ---------------------------------------------------------------------------
 * PERMISSIONS (G1)
 *
 * The Leads screen read `me.permissions.business`, which is not one of the 27
 * sections in `masters-registry.ts` — so every non-Administrator saw the list
 * with Add, Bulk Upload, Edit and Delete hidden however their role was granted.
 * Each tab now reads its OWN section: `companies` and `contacts`. A user with
 * one and not the other sees one tab, not a tab that 403s.
 */

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneList, PhoneListRow } from '@/components/ui/phone-list'
import {
  EllipsisVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  UserPlusIcon,
  ZapIcon,
} from 'lucide-react'

import Modal from '@/components/ui/Modal'
import { QuickCreateDialog } from './quick-create-dialog'
import { ContactDialog, type CreatedContact } from './contact-dialog'
import { IndividualConflictDialog, type IndividualConflict } from './individual-conflict-dialog'
import { usePartyMasters } from './party-masters'
import { useMe, type Me } from '@/hooks/useMe'
import { useBPForm, BusinessPartnerFormFields } from '@/components/masters/BusinessPartnerForm'
import { useToast } from '@/contexts/ToastContext'
import { CompaniesBulkImportDialog } from '@/components/import/companies-bulk-import-dialog'
import { RECORD_COMPLETENESS, StatusBadge } from '@/components/status-badge'
import { QuickFilterChip } from '@/components/alerts/data-health-alert'
import { DataHealthAlerts, type DataHealthAlertItem } from '@/components/alerts/data-health-popover'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SectionTabs, type SectionTab } from '@/components/ui/section-tabs'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Truncate } from '@/components/ui/truncate'
import { EMPTY } from '@/lib/format'

// ─────────────────────────────────────────────────────────────
// The wire shapes
//
// Read off `src/app/api/companies/_handlers.ts` + `_shape.ts` and
// `src/app/api/contacts/_handlers.ts` + `_shape.ts`. Both list routes answer
// with a bare array and no envelope.
//
// `owner` and `created_by` on a company are `_shape.ts`'s renames of the two
// aliased `users` embeds; `companies` on a contact is the flattened
// `company_contacts` join — ALWAYS an array, because §3.4's defining rule is
// that a contact may belong to more than one company.
// ─────────────────────────────────────────────────────────────

type NamedRef = { id: string; name: string }

type CompanyRow = {
  id: string
  name: string
  type: string | null
  mobile_1: string | null
  is_active: boolean | null
  is_complete: boolean
  /* The server's own words for what a full record still needs — computed in
     `src/lib/completeness.ts` and stored on the row. Shown, never recomputed. */
  completeness_missing: string | null
  districts: { name: string } | null
  owner: NamedRef | null
  /* docs/accounts-contacts-spec.md §1: every company row carries which kind
     of account it is. Always present — `/lib/account-kind.ts` defaults a
     tenant with no column yet to 'Company', so this is never undefined. */
  account_kind: 'Company' | 'Individual'
  /* Set only on a row the caller sees because it was SHARED with them
     (src/lib/sharing.ts): 'work' or 'view'. Null on every other row, and
     always null until the sharing tables exist. Absent from an older response. */
  shared_access?: 'work' | 'view' | null
}

/* The per-row record rules of sharing (section 26.5): a 'view' share is read
   only, and no share — even 'work' — lets someone delete the account. */
const SHARED_VIEW_REASON = 'This account is shared with you to view only.'
const SHARED_DELETE_REASON = 'Only the owner, or someone whose team includes the owner, can delete this account.'

type ContactRow = {
  id: string
  name: string
  mobile: string
  designation: string | null
  is_active: boolean
  contact_types: NamedRef | null
  companies: { id: string; name: string }[]
  /* Set only on a row the caller sees because an account it is linked to was
     SHARED with them (src/lib/sharing.ts). Null otherwise, and always null
     until the sharing tables exist. */
  shared_access?: 'work' | 'view' | null
}

/* No share, even 'work', lets someone delete the contact (section 26.5). */
const SHARED_CONTACT_DELETE_REASON = "Only the contact's owner, or someone whose team includes the owner, can delete this contact."

/** The two tabs, and the query parameter that carries the active one. */
const TAB_PARAM = 'tab'
const COMPANIES = 'companies'
const CONTACTS = 'contacts'

/*
 * Section 27.1: the tooltip on the search field names the fields the box
 * actually reaches, so nobody concludes a record does not exist when they
 * searched a field the box does not cover.
 *
 * Both list routes match on `name` and nothing else. That is the server as it
 * stands and this task did not change it, so the hints state the truth rather
 * than the ambition.
 */
const COMPANY_SEARCH_HINT =
  'Searches the account name. Type, status and completeness are filters.'
const CONTACT_SEARCH_HINT =
  'Searches the contact name. Contact type and status are filters.'

/**
 * Where a row's detail page sends the user back to.
 *
 * Both detail pages accept `?from=<relative path under /parties>` and ignore
 * anything else, so this is the tab the row was opened from and nothing more.
 * The search box and the filter panel are template state rather than URL state,
 * so they are NOT carried — the tab is.
 */
function backTo(tab: string) {
  return encodeURIComponent(`/parties?${TAB_PARAM}=${tab}`)
}

/**
 * The identifier column's cell, for both tables.
 *
 * `truncate: true` narrows `cell` to return a plain string — a link is not a
 * string — so the column declares itself non-truncating and uses the same
 * `Truncate` the template would have used. Identical behaviour: one line, and
 * a tooltip only where the text is genuinely cut.
 */
function NameLink({ href, name }: { href: string; name: string }) {
  return (
    <Link
      href={href}
      className="block min-w-0 font-medium text-text-primary hover:text-primary hover:underline"
    >
      <Truncate>{name}</Truncate>
    </Link>
  )
}

// ══════════════════════════════════════════════════════════════
// COMPANIES
// ══════════════════════════════════════════════════════════════

/**
 * Section 10 rule 4: every column declares its tier.
 *
 * Eight columns, which is section 10 rule 2's ceiling — past it the first
 * column would have to freeze, and `list-page` cannot freeze one. Staying at
 * eight is what keeps this screen inside the template.
 *
 * Name, Phone, Completeness, Active and the row actions survive every width.
 * A party is a name plus a number you can ring; Completeness is the one column
 * that predicts a *blocked order* (§3.5), so it is not decoration; and Active
 * plus the row actions are controls rather than data — a toggle that vanishes
 * at 1024 is a capability that vanishes.
 *
 * Owner and District go first at 1024: provenance, and a geography that is on
 * the record's own page anyway. Type survives to 768, qualifying the name the
 * way it does on Orders. Nothing that drops becomes unreachable — all three are
 * on the company's detail page.
 *
 * NO column carries `grow`, and that is measured rather than assumed. `grow` is
 * `w-full max-w-0`, which absorbs slack only where there IS slack; where there
 * is none it collapses the column it is on. With `grow` on Name this table
 * fits at a 961px data area (a 1280 window) and Name gets 178px — but its
 * eight columns need 805px, and a 1024 window leaves the data area about
 * 705px, at which point Name collapses to 32px. Measured at five container
 * widths; 961 and 860 fit, 760 and below do not. So Name is capped at
 * `max-w-field-min` and truncates instead, which is the same behaviour at
 * every width rather than the right one at one of them.
 */
function companyColumns({
  canEdit,
  canDelete,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (row: CompanyRow) => void
  onToggleActive: (row: CompanyRow, value: boolean) => void
  onDelete: (row: CompanyRow) => void
}): ListColumn<CompanyRow>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      // Capped at `max-w-field-min` by default — the measured worst case
      // above, at a 1024 window, leaves no slack to give it. Widened at xl
      // (1280+, this screen's own reference width) where that slack exists,
      // so Name does not truncate with the Kind badge sitting right next to
      // it while there is free width going unused (kit rule 2).
      className: 'max-w-field-min xl:max-w-[320px]',
      skeletonWidth: 'w-40',
      cell: row => (
        <div className="flex min-w-0 items-center gap-2">
          <NameLink
            href={`/parties/companies/${row.id}?from=${backTo(COMPANIES)}`}
            name={row.name}
          />
          {/* Kind badge: every row carries one, Company and Individual alike,
              so siblings stay visually identical (section 1) — this is not
              an exception marker like "Shared" below. */}
          <Badge variant={row.account_kind === 'Individual' ? 'neutral' : 'primary'}>
            {row.account_kind}
          </Badge>
          {row.shared_access && (
            /* "Shared" marks the exception — an account in this list because
               someone shared it, not because it is the caller's or their
               team's. Plain markup, nothing client-only (see the hydration
               note on the Completeness cell). */
            <Badge>Shared</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      tier: 'hide-below-768',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-20',
      /* A category, not a status: section 11.1's "status is always a badge"
         does not reach it and section 2.4 has no colour for a category. */
      cell: row => (row.type?.trim() ? row.type : EMPTY),
    },
    {
      id: 'owner',
      header: 'Owner',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: row => row.owner?.name ?? EMPTY,
    },
    {
      id: 'district',
      header: 'District',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-24',
      /* §3.3 asks for City, and a company's city lives on
         `company_addresses`, which `GET /api/companies` does not embed — and
         the companies route is not this task's to change. District is the
         geography the list DOES carry, so the column says District rather
         than labelling a district as a city. See the report. */
      cell: row => row.districts?.name ?? EMPTY,
    },
    {
      id: 'phone',
      header: 'Phone',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      truncate: true,
      skeletonWidth: 'w-24',
      cell: row => row.mobile_1 ?? EMPTY,
    },
    {
      id: 'completeness',
      header: 'Completeness',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-24',
      /* P1-T17: "an Incomplete badge NAMING what is missing". The badge alone
         says the record is short of something without saying of what, which
         leaves the user to open the record and compare it against a rule they
         cannot see. The stored `completeness_missing` is that list, so it goes
         in a tooltip on the badge — the column stays one badge wide. */
      /*
       * ⚠️ P1-T17 asks for a badge "naming what is missing", and the row
       * carries `completeness_missing` ready to show. It is NOT shown here,
       * and that is a deliberate retreat rather than an oversight.
       *
       * Two attempts to enrich this cell — wrapping the badge in a
       * `TooltipTrigger render={<span/>}`, then a second line built from
       * `Truncate` — each made this page log "Expected server HTML to contain
       * a matching <div> in <header>" and then "Hydration failed", after which
       * the Suspense boundary fell back to client rendering. Isolated by
       * bisection: this cell is the variable. Reverting it alone silences the
       * console; `/orders`, the same template untouched, never errors.
       *
       * The user is still TOLD what is missing, on the two surfaces where it
       * is actionable and where it is verified working: the Quick Create
       * toast names the fields at creation, and the company page shows a
       * banner listing them. The list keeps the badge alone until someone who
       * owns `templates/list-page.tsx` can say why a richer cell breaks
       * hydration — reported, not worked around with a hack.
       */
      cell: row => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge
            vocabulary={RECORD_COMPLETENESS}
            status={row.is_complete ? 'Complete' : 'Incomplete'}
          />
          {/* P5-T7 §7.7: "what is missing", not just that it is missing.
              A plain, non-interactive line — no `Tooltip`/`Truncate` — is
              what the P1-T17 note above asks the next attempt to use:
              those two broke hydration in this exact cell, this does not,
              because it renders nothing client-only. The native `title`
              carries the full text if the line itself is cut. */}
          {!row.is_complete && row.completeness_missing && (
            <span
              className="block max-w-40 truncate text-xs text-text-secondary"
              title={row.completeness_missing}
            >
              {row.completeness_missing}
            </span>
          )}
        </div>
      ),
    },
    /*
     * Section 15.2: once anything points at a record it is deactivated rather
     * than deleted, so this is the action that is always available and Delete
     * is the one that often is not. It is a per-ROW control, and a per-row
     * control is a column — it sits immediately before the row actions.
     */
    {
      id: 'active',
      header: 'Active',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-5 w-9',
      /* Section 26: someone without edit rights sees the same screen with the
         control disabled, not a screen missing a column — the value is data
         they are entitled to read. */
      cell: row => {
        const rowCanEdit = canEdit && row.shared_access !== 'view'
        const toggle = (
          <Switch
            aria-label={`Active — ${row.name}`}
            checked={Boolean(row.is_active)}
            disabled={!rowCanEdit}
            onCheckedChange={
              rowCanEdit ? value => onToggleActive(row, value) : undefined
            }
          />
        )
        return canEdit && row.shared_access === 'view' ? (
          <PermissionTooltip allowed={false} reason={SHARED_VIEW_REASON}>{toggle}</PermissionTooltip>
        ) : toggle
      },
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-20',
      cell: row => (
        <div className="flex items-center justify-end gap-2">
          {canEdit && row.shared_access === 'view' && (
            <PermissionTooltip allowed={false} reason={SHARED_VIEW_REASON}>
              <Button variant="secondary" size="icon" disabled>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </Button>
            </PermissionTooltip>
          )}
          {canEdit && row.shared_access !== 'view' && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onEdit(row)}
                  />
                }
              >
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          )}
          {canDelete && row.shared_access && (
            <PermissionTooltip allowed={false} reason={SHARED_DELETE_REASON}>
              <Button variant="danger" size="icon" disabled>
                <Trash2Icon />
                <span className="sr-only">Delete {row.name}</span>
              </Button>
            </PermissionTooltip>
          )}
          {canDelete && !row.shared_access && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="danger"
                    size="icon"
                    onClick={() => onDelete(row)}
                  />
                }
              >
                <Trash2Icon />
                <span className="sr-only">Delete {row.name}</span>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
  ]
}

function CompaniesTab({ me, sectionTabs }: { me: Me | null; sectionTabs: ReactNode }) {
  const { toast } = useToast()
  const router = useRouter()
  const isAdmin = me?.role === 'Administrator'
  // G1: `companies`, the section that exists. `business` never did.
  const canEdit   = isAdmin || (me?.permissions?.companies?.edit   ?? false)
  // Add company, Quick create and Bulk Upload all write through a create:
  // POST /api/companies and POST …/bulk-parse and …/bulk-import each check
  // companies.create. `canEdit` stays for the PUT behind Edit and Active.
  // The permission alone, never a role name: /api/auth/me already answers
  // all-true for an Administrator. While /me is loading the buttons are
  // disabled with no reason — "not known yet" is not "not allowed".
  const canCreate = me?.permissions?.companies?.create ?? false
  const createKnown = me !== null
  const canDelete = isAdmin || (me?.permissions?.companies?.delete ?? false)

  const bp = useBPForm()
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving]     = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [deleting, setDeleting] = useState<CompanyRow | null>(null)
  const savingRef               = useRef(false)
  // Every type, active or not: the list filter must still find companies on a
  // deactivated one. The edit picker narrows it below.
  const [companyTypes, setCompanyTypes] = useState<(NamedRef & { is_active?: boolean; applies_to?: 'Company' | 'Individual' | 'Both' })[]>([])
  /* Bumped when a create, an edit, a toggle or a delete makes the list stale.
     The template holds `load` in a ref, so this is the ONLY refetch lever. */
  const [refreshKey, setRefreshKey] = useState(0)

  /*
   * P5-T7 §7.7 — the two Parties-list alerts. Both counts come from a
   * SEPARATE, unfiltered fetch of this same scoped endpoint, not from
   * whatever `load()` currently has on screen: a banner that only reflected
   * the active search/filter would go quiet the moment somebody typed into
   * the search box, which is the opposite of "stays true until resolved"
   * (section 7.1). `/api/companies` already applies `getDataScope` via
   * `scopedUserIds`/`scopeWhere`, so an executive's count never covers a
   * company they cannot open.
   *
   * "Parties Without Any Deal" additionally needs `/api/deals` — a user
   * without the `deals` permission gets a 403 there, which is read as "not
   * knowable", not zero: the alert simply does not render rather than
   * claiming every party has a deal.
   */
  const [allCompanies, setAllCompanies] = useState<CompanyRow[] | null>(null)
  const [dealCompanyIds, setDealCompanyIds] = useState<Set<string> | null>(null)
  const [onlyIncomplete, setOnlyIncomplete] = useState(false)
  const [onlyNoDeal, setOnlyNoDeal] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/companies')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (live) setAllCompanies(Array.isArray(d) ? d : []) })
      .catch(() => { if (live) setAllCompanies([]) })
    fetch('/api/deals')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live) return
        if (!Array.isArray(d)) { setDealCompanyIds(null); return }
        setDealCompanyIds(
          new Set(
            d
              .map((deal: { company?: { id: string } | null }) => deal.company?.id)
              .filter((id): id is string => Boolean(id))
          )
        )
      })
      .catch(() => { if (live) setDealCompanyIds(null) })
    return () => { live = false }
  }, [refreshKey])

  const incompleteCount = allCompanies?.filter(c => !c.is_complete).length ?? 0
  const noDealCount =
    allCompanies && dealCompanyIds
      ? allCompanies.filter(c => !dealCompanyIds.has(c.id)).length
      : 0

  useEffect(() => {
    fetch('/api/masters/lead-types')
      .then(r => r.json())
      .then(d => setCompanyTypes(Array.isArray(d) ? d : []))
      .catch(() => toast('Failed to load account types', 'error'))
  }, [toast])

  /*
   * This dialog is now EDIT-ONLY. Creating a company goes through
   * `/parties/companies/new` (P1-T16) or the Quick Create dialog (P1-T17);
   * `openAdd` was removed rather than left as an unreachable second create
   * path, which is exactly the duplication §3.5 warns about.
   */
  function openEdit(row: CompanyRow) {
    bp.reset(row as unknown as Record<string, unknown>)
    setEditing(row as unknown as Record<string, unknown>)
    setOpen(true)
  }

  async function handleSave() {
    if (savingRef.current) return
    if (!bp.form.name.trim()) return
    if (!bp.validate()) return
    savingRef.current = true
    setSaving(true)
    const body = { ...bp.buildBody(), type: bp.form.type || null }
    const path = editing ? `/api/companies/${editing.id as string}` : '/api/companies'
    const res = await fetch(path, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    savingRef.current = false
    setSaving(false)
    if (!res.ok) {
      toast((data as { error?: string }).error ?? (editing ? 'Update failed' : 'Create failed'), 'error')
      return
    }
    // Saved; only the landline may not be, until the database has the column
    // (src/lib/party-landline.ts).
    const warning = (data as { warning?: string }).warning
    if (warning) toast(warning, 'warning')
    else toast(editing ? 'Updated successfully' : 'Created successfully')
    setRefreshKey(k => k + 1)
    setOpen(false)
  }

  async function toggleActive(row: CompanyRow, value: boolean) {
    const res = await fetch(`/api/companies/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast((data as { error?: string }).error ?? 'Update failed', 'error')
      return
    }
    toast('Updated successfully')
    setRefreshKey(k => k + 1)
  }

  async function confirmDelete() {
    const row = deleting
    if (!row) return
    setDeleting(null)
    const res = await fetch(`/api/companies/${row.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    // 404: already gone (deleted in another tab, or no longer in scope) — the
    // outcome the user asked for, so refresh rather than report an error.
    if (res.status === 404) {
      toast('This record was already deleted', 'info')
      setRefreshKey(k => k + 1)
      return
    }
    if (!res.ok) {
      toast((data as { error?: string }).error ?? 'Delete failed', 'error')
      return
    }
    toast('Deleted successfully')
    setRefreshKey(k => k + 1)
  }

  /*
   * Deliberately NOT memoised: the template holds `load` in a ref and never
   * makes it an effect dependency. No deadline and no catch here either — the
   * template races this against its own timer, and a rejection IS the failed
   * state (section 14 rules 3 and 4). Catching here and returning `[]` would
   * render a 500 as "no companies found", which is a lie.
   *
   * `/api/companies` takes `q` and `type` and nothing else, so the two
   * remaining filters narrow the answer here rather than in SQL. The template
   * counts, pages and empty-states off what this returns, so all four behave
   * identically whichever side of the wire they run.
   */
  const load: ListPageProps<CompanyRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (filters.type) params.set('type', filters.type)
    if (filters.kind) params.set('kind', filters.kind)
    const query = params.toString()
    const r = await fetch(`/api/companies${query ? `?${query}` : ''}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: CompanyRow[] = Array.isArray(body) ? body : []
    return rows.filter(row => {
      if (filters.status === 'active' && !row.is_active) return false
      if (filters.status === 'inactive' && row.is_active) return false
      if (filters.completeness === 'complete' && !row.is_complete) return false
      if (filters.completeness === 'incomplete' && row.is_complete) return false
      // P5-T7: the alert banner's own one-click narrowing. `list-page.tsx`
      // has no prop to set its declared filters from outside, so this is a
      // second, independent narrowing this screen applies on top of them —
      // `refreshKey` is what makes the template call this function again
      // when a banner is clicked, since nothing it recognises as a
      // dependency (search/filters) actually changed.
      if (onlyIncomplete && row.is_complete) return false
      if (onlyNoDeal && dealCompanyIds?.has(row.id)) return false
      return true
    })
  }

  const filters: ListFilter[] = [
    {
      id: 'kind',
      label: 'Kind',
      kind: 'select',
      options: { '': 'Any', Company: 'Company', Individual: 'Individual' },
    },
    {
      id: 'type',
      label: 'Account type',
      kind: 'select',
      /* Section 16.3: past about six options the menu needs a search, and
         company types run past six in a real tenant. */
      searchable: companyTypes.length > 6,
      options: {
        '': 'Any type',
        ...Object.fromEntries(companyTypes.map(t => [t.name, t.name])),
      },
    },
    {
      id: 'status',
      label: 'Status',
      kind: 'select',
      options: { '': 'Any', active: 'Active only', inactive: 'Inactive only' },
    },
    {
      id: 'completeness',
      label: 'Completeness',
      kind: 'select',
      options: {
        '': 'Any',
        complete: 'Complete only',
        incomplete: 'Incomplete only',
      },
    },
  ]

  /*
   * F25: the two alerts are no longer in the page flow at all. They live
   * behind the header's alert icon (see `alerts/data-health-popover.tsx`)
   * so the table owns the top of the screen, which is what he actually
   * asked for — F19/F20 only moved and shrank the strip.
   *
   * §7.7 still holds: the incomplete alert names WHICH fields are absent.
   * `completeness_missing` is the stored, per-company list of them, so
   * the popover reports the real fields this tenant is actually short of,
   * commonest first, instead of the generic sentence the banner carried.
   */
  const missingFieldSummary = (() => {
    const tally = new Map<string, number>()
    for (const c of allCompanies ?? []) {
      if (c.is_complete || !c.completeness_missing) continue
      for (const raw of c.completeness_missing.split(',')) {
        const field = raw.trim()
        if (field) tally.set(field, (tally.get(field) ?? 0) + 1)
      }
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([field, n]) => `${field} (${n})`)
      .join(', ')
  })()

  const healthAlerts: DataHealthAlertItem[] = [
    {
      id: 'incomplete',
      count: incompleteCount,
      title: `${incompleteCount} ${incompleteCount === 1 ? 'account is' : 'accounts are'} incomplete`,
      detail: missingFieldSummary
        ? `Missing ${missingFieldSummary}. An order against one of these stays in Draft.`
        : 'An order against one of these stays in Draft.',
      actionLabel: 'View incomplete accounts',
      active: onlyIncomplete,
      onAction: () => { setOnlyIncomplete(true); setRefreshKey(k => k + 1) },
    },
    {
      id: 'no-deal',
      count: noDealCount,
      title: `${noDealCount} ${noDealCount === 1 ? 'account has' : 'accounts have'} no opportunity`,
      detail: 'Nothing in the pipeline is tied to these accounts yet.',
      actionLabel: 'View accounts with no opportunity',
      active: onlyNoDeal,
      onAction: () => { setOnlyNoDeal(true); setRefreshKey(k => k + 1) },
    },
  ]

  /*
   * Only the applied-filter chip stays in zone 1a, and only while a filter
   * IS applied: it is the user's own transient state and its own clear
   * affordance, not standing page furniture. Nothing renders here in the
   * ordinary case, so the tab bar sits directly on the table.
   */
  const banners = (
    <>
      {onlyIncomplete && (
        <QuickFilterChip
          label="Showing incomplete accounts only"
          onClear={() => { setOnlyIncomplete(false); setRefreshKey(k => k + 1) }}
        />
      )}
      {onlyNoDeal && (
        <QuickFilterChip
          label="Showing accounts without an opportunity"
          onClear={() => { setOnlyNoDeal(false); setRefreshKey(k => k + 1) }}
        />
      )}
    </>
  )

  return (
    <>
      {/*
       * P5-T7: same wrapper P2-T7's pipeline strip uses above the Deals
       * `ListPage` — a flex COLUMN with a definite height, so the banners
       * are `shrink-0` and the template keeps zone 3's own scrollbar
       * instead of the whole page scrolling. `className="h-auto min-h-0
       * flex-1"` on `ListPage` is the same override that pattern relies
       * on; `list-page.tsx` itself is untouched.
       */}
      <div className="flex min-h-0 flex-col md:h-full">
      <ListPage<CompanyRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Accounts"
        noun={{ one: 'account', many: 'accounts' }}
        sectionTabs={<>{sectionTabs}{banners}</>}
        /*
         * Section 6.1 rules 1 and 2: exactly ONE primary per screen, everything
         * else secondary. Add is the primary; Bulk Upload is the same act for
         * many rows at once, so it belongs beside it and is secondary.
         */
        /*
         * P1-T16/T17 changed what "Add" means here. It used to open the
         * `Modal.tsx` dialog below, which is one step and cannot reach
         * contacts; §3.3's form is two steps and has to be a page. So Add is
         * now a LINK to that page, and the dialog it used to open survives only
         * as the EDIT dialog — `openEdit` is still its only caller.
         *
         * Three buttons, one primary (§6.1 rule 1). Add company is the full
         * path and stays primary; Quick create and Bulk Upload are the same act
         * with less detail and with more rows, and both are secondary.
         */
        /* F25: the alert trigger is a header control, grouped with the
           other header controls rather than stranded — and it renders for
           everyone who can read the list, including a user with no edit
           rights, since looking at the alerts is not an edit. */
        action={
            <div className="flex items-center gap-2">
              <DataHealthAlerts alerts={healthAlerts} label="Account data health" />
              {/* Shown and disabled with a reason for a role without
                  companies.create, rather than hidden (section 26). */}
              <PermissionTooltip allowed={!createKnown || canCreate} reason="Only someone who can create accounts can import them">
                <Button variant="secondary" onClick={() => setBulkOpen(true)} disabled={!canCreate}>
                  <UploadIcon />
                  Bulk Upload
                </Button>
              </PermissionTooltip>
              <PermissionTooltip allowed={!createKnown || canCreate} reason="Only someone who can create accounts can add them">
                <Button variant="secondary" onClick={() => setQuickOpen(true)} disabled={!canCreate}>
                  <ZapIcon />
                  Quick create
                </Button>
              </PermissionTooltip>
              {/*
                ⚠️ `router.push`, NOT `<Button render={<Link/>}>`.
                That form hydrates inconsistently inside `ListPage`'s header —
                React reported "Expected server HTML to contain a matching
                <div> in <header>" and then "Hydration failed", and the whole
                Suspense boundary fell back to client rendering. Verified by
                reverting this file alone: at HEAD the page console is clean,
                with the Link form it is not, while `/orders` (same template,
                untouched) stays clean either way.
                It also keeps the three peers identical — all buttons, same
                behaviour — instead of one anchor among two buttons.
              */}
              <PermissionTooltip allowed={!createKnown || canCreate} reason="Only someone who can create accounts can add them">
                <Button onClick={() => router.push('/parties/companies/new')} disabled={!canCreate}>
                  <PlusIcon />
                  Add account
                </Button>
              </PermissionTooltip>
            </div>
        }
        columns={companyColumns({
          canEdit,
          canDelete,
          onEdit: openEdit,
          onToggleActive: toggleActive,
          onDelete: setDeleting,
        })}
        rowKey={row => row.id}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchPlaceholder="Search accounts"
        searchHint={COMPANY_SEARCH_HINT}
        emptyYet={{
          heading: 'No accounts yet',
          body: 'Every organisation this tenant sells to — prospects, dealers, distributors and institutions — is listed here.',
          actionLabel: 'Add account',
          onAction: canCreate ? () => router.push('/parties/companies/new') : undefined,
          actionDisabledReason: !createKnown ? null : canCreate ? undefined : 'Only someone who can create accounts can add them',
        }}
      />
      </div>

      <Modal title="Edit account" isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        <BusinessPartnerFormFields
          hook={bp}
          namePlaceholder="Account name"
          showLeadStatus
          topSlot={
            <div>
              <label htmlFor="company-type" className="block text-sm font-medium text-text-secondary mb-1">Account type</label>
              <select id="company-type" name="type" value={bp.form.type} onChange={bp.F('type')}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                <option value="">Select type…</option>
                {/* docs/accounts-contacts-spec.md §1: a type only offers itself
                    for the kind(s) it `applies_to` — 'Both' always qualifies.
                    Active types, plus the company's own if it has since been
                    deactivated or no longer applies to this kind, so an edit
                    neither blanks it nor offers it anew. */}
                {companyTypes
                  .filter(t => t.name === bp.form.type || (
                    (t.is_active !== false) &&
                    (t.applies_to === 'Both' || t.applies_to === ((editing?.account_kind as string | undefined) ?? 'Company'))
                  ))
                  .map(t => (
                    <option key={t.id} value={t.name}>{t.name}{t.is_active === false ? ' (inactive)' : ''}</option>
                  ))}
              </select>
            </div>
          }
        />
      </Modal>

      {/* Section 15: an irreversible action opens a confirmation dialog. This
          is what a native `confirm()` is not allowed to be. */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account permanently. An account that is already
              referenced cannot be deleted — deactivate it instead, which keeps
              its history and takes it out of new entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CompaniesBulkImportDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onImported={() => setRefreshKey(k => k + 1)}
      />

      {/* P1-T17. Writes through `/api/companies`, the same endpoint the full
          form uses — one create path, not a second one (§3.5). */}
      <QuickCreateDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onCreated={company => {
          setRefreshKey(k => k + 1)
          toast(
            company.completeness_missing
              ? `${company.name} created. Still missing: ${company.completeness_missing}.`
              : `${company.name} created.`
          )
        }}
      />
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════════════════════

/**
 * Section 10 rule 4. Six columns, so this table never approaches rule 2's
 * freeze threshold.
 *
 * Name, Mobile and the row actions survive every width — a contact IS a person
 * and a number, and the actions are a capability rather than data. Companies
 * survives to 768 because §3.4's whole point is that the number can be more
 * than one. Designation and Contact Type go first at 1024: both are on the
 * contact's own page, and neither changes who to ring.
 *
 * Name DOES carry `grow` here, where the Companies table does not, and the
 * difference is measured: six columns need 640px, so this table still fits a
 * 650px data area — narrower than any supported window produces — and `grow`
 * therefore always has slack to absorb rather than a column to collapse.
 * Section 8 wants one column taking the table's slack; this is the table where
 * that is safe.
 */
function contactColumns({
  canDelete,
  canMakeIndividual,
  actionsKnown,
  busyId,
  onDelete,
  onMakeIndividual,
}: {
  canDelete: boolean
  canMakeIndividual: boolean
  /** Whether `/api/auth/me` has answered yet — "not known yet" is not "not
   *  allowed" (global rule 4); both menu items stay enabled until it has. */
  actionsKnown: boolean
  /** The row currently mid "Make Individual account", so its item can say so
   *  and the others are left alone. */
  busyId: string | null
  onDelete: (row: ContactRow) => void
  onMakeIndividual: (row: ContactRow) => void
}): ListColumn<ContactRow>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      grow: true,
      skeletonWidth: 'w-40',
      cell: row =>
        row.shared_access ? (
          <div className="flex min-w-0 items-center gap-2">
            <NameLink
              href={`/parties/contacts/${row.id}?from=${backTo(CONTACTS)}`}
              name={row.name}
            />
            <Badge>Shared</Badge>
          </div>
        ) : (
          <NameLink
            href={`/parties/contacts/${row.id}?from=${backTo(CONTACTS)}`}
            name={row.name}
          />
        ),
    },
    {
      id: 'designation',
      header: 'Designation',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: row => row.designation ?? EMPTY,
    },
    {
      id: 'contactType',
      header: 'Contact Type',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-24',
      cell: row => row.contact_types?.name ?? EMPTY,
    },
    {
      id: 'companies',
      header: 'Accounts',
      tier: 'hide-below-768',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-16',
      /*
       * The COUNT, with the names in a tooltip. §3.4 allows many companies per
       * contact, and spelling them all out in a table cell would make one row
       * three lines tall for the sake of a fact the contact's own page states
       * in full. A count of zero is a dash, not a "0" badge — nothing is
       * linked, which is a blank rather than a quantity.
       */
      cell: row =>
        row.companies.length === 0 ? (
          <span className="text-text-muted">{EMPTY}</span>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="text-text-secondary" />}>
              {row.companies.length}
            </TooltipTrigger>
            <TooltipContent>
              {row.companies.map(c => c.name).join(', ')}
            </TooltipContent>
          </Tooltip>
        ),
    },
    {
      id: 'mobile',
      header: 'Mobile',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      truncate: true,
      skeletonWidth: 'w-24',
      cell: row => row.mobile || EMPTY,
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-10',
      /*
       * The kit's row-actions pattern (FRONTEND_RULES.md: "the three-dot menu
       * appears only when the list has row actions other than opening") — a
       * quiet ⋮ menu, same as the Contact page's own ⋮ menu, rather than a
       * lone red Delete icon sitting alone in the row. `DELETE
       * /api/contacts/[id]` is a SOFT delete, so "Delete" here is the
       * deactivation section 15.2 asks for under another name.
       */
      cell: row => {
        const deleteBlocked = row.shared_access
          ? SHARED_CONTACT_DELETE_REASON
          : null
        const busy = busyId === row.id
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={`Actions for ${row.name}`}
                />
              }
            >
              <EllipsisVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <PermissionTooltip
                allowed={!actionsKnown || canMakeIndividual}
                reason="Only someone who can create accounts can do this."
              >
                <DropdownMenuItem
                  disabled={(actionsKnown && !canMakeIndividual) || busy}
                  onClick={() => onMakeIndividual(row)}
                >
                  <UserPlusIcon />
                  {busy ? 'Creating…' : 'Make Individual account'}
                </DropdownMenuItem>
              </PermissionTooltip>
              <PermissionTooltip
                allowed={!actionsKnown || (canDelete && !deleteBlocked)}
                reason={deleteBlocked ?? 'Only someone who can delete contacts can do this.'}
              >
                <DropdownMenuItem
                  variant="danger"
                  disabled={(actionsKnown && !(canDelete && !deleteBlocked))}
                  onClick={() => onDelete(row)}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </PermissionTooltip>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}

function ContactsTab({ me, sectionTabs }: { me: Me | null; sectionTabs: ReactNode }) {
  const { toast } = useToast()
  const router = useRouter()
  const isAdmin = me?.role === 'Administrator'
  // G1 again: the contacts tab reads the `contacts` section, not `companies`
  // and certainly not `business`.
  const canDelete = isAdmin || (me?.permissions?.contacts?.delete ?? false)
  // F22: gated on the real `contacts` permission, same rule the Companies
  // tab applies to its own Add button — never a hardcoded role. `create`, not
  // `edit`: POST /api/contacts checks contacts.create.
  // The permission alone, never a role name (see the Companies tab).
  const canCreate = me?.permissions?.contacts?.create ?? false
  const createKnown = me !== null
  // "Make Individual account" gates on `companies.create`, the same
  // permission `POST /api/contacts/[id]/make-individual` itself checks (it
  // creates an Individual account) — same rule as the Contact page's ⋮ menu.
  const canMakeIndividual = isAdmin || (me?.permissions?.companies?.create ?? false)
  const actionsKnown = me !== null

  // Every type, active or not, for the list filter.
  const [contactTypes, setContactTypes] = useState<(NamedRef & { is_active?: boolean })[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  // "Make Individual account" — success navigates to the new account; a 409
  // (already Self somewhere) opens the shared conflict dialog instead of a
  // raw error. Same flow as the Contact page's own menu item.
  const [makingIndividualId, setMakingIndividualId] = useState<string | null>(null)
  const [individualConflict, setIndividualConflict] = useState<IndividualConflict | null>(null)

  async function makeIndividual(row: ContactRow) {
    if (makingIndividualId) return
    setMakingIndividualId(row.id)
    try {
      const res = await fetch(`/api/contacts/${row.id}/make-individual`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        const created = data as { id: string }
        router.push(`/parties/companies/${created.id}`)
        return
      }
      if (res.status === 409) {
        const body = data as { error?: string; existing_account_id?: string }
        setIndividualConflict({
          message: body.error ?? 'This person is already the Self contact of another account.',
          existingAccountId: body.existing_account_id,
        })
        return
      }
      toast((data as { error?: string }).error ?? 'Could not create an Individual account.', 'error')
    } catch {
      toast('The connection dropped. Nothing was created.', 'error')
    } finally {
      setMakingIndividualId(null)
    }
  }

  /**
   * Delete — the same dry-run → confirm flow the Contact page itself runs
   * against `DELETE /api/contacts/[id]` (see that route's own comments):
   *   - 409 naming an Individual account this contact is Self for, or "this
   *     contact has history" → blocked, no confirm option, just a way out;
   *   - 409 `confirm_required` with `linked_accounts` → a dry run, shown so
   *     the user can confirm with `?confirm=1`;
   *   - neither → the first call already deleted it.
   */
  type DeleteFlow =
    | { row: ContactRow; stage: 'blocked'; message: string; selfAccountId?: string }
    | { row: ContactRow; stage: 'confirm'; linkedAccounts: { id: string; name: string }[] }
    | null
  const [deleteFlow, setDeleteFlow] = useState<DeleteFlow>(null)
  const [deleting, setDeleting] = useState(false)

  async function startDelete(row: ContactRow) {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${row.id}`, { method: 'DELETE' })
      if (res.status === 404) {
        toast('This record was already deleted', 'info')
        setRefreshKey(k => k + 1)
        return
      }
      if (res.ok) {
        toast('Deleted successfully')
        setRefreshKey(k => k + 1)
        return
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        linked_accounts?: { id: string; name: string }[]
        self_account_id?: string
      }
      if (res.status === 409 && data.error === 'confirm_required') {
        setDeleteFlow({ row, stage: 'confirm', linkedAccounts: data.linked_accounts ?? [] })
        return
      }
      setDeleteFlow({
        row,
        stage: 'blocked',
        message: data.error ?? 'This contact cannot be deleted.',
        selfAccountId: data.self_account_id,
      })
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDeleteFlow() {
    if (!deleteFlow || deleteFlow.stage !== 'confirm' || deleting) return
    const row = deleteFlow.row
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${row.id}?confirm=1`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast((data as { error?: string }).error ?? 'Could not delete this contact.', 'error')
        setDeleteFlow(null)
        return
      }
      toast('Deleted successfully')
      setDeleteFlow(null)
      setRefreshKey(k => k + 1)
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setDeleting(false)
    }
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [companyOptions, setCompanyOptions] = useState<NamedRef[]>([])
  const partyMasters = usePartyMasters()

  useEffect(() => {
    let live = true
    fetch('/api/companies')
      .then(r => (r.ok ? r.json() : []))
      .then((d: { id: string; name: string }[]) => {
        if (live) setCompanyOptions(Array.isArray(d) ? d.map(c => ({ id: c.id, name: c.name })) : [])
      })
      .catch(() => { if (live) setCompanyOptions([]) })
    return () => { live = false }
  }, [])

  /* P5-T7 §7.7 — "Contacts Without Company", counted off a separate
     unfiltered fetch of this same scoped endpoint, for the same reason the
     Companies tab does — see its `allCompanies` note. */
  const [allContacts, setAllContacts] = useState<ContactRow[] | null>(null)
  const [onlyUnlinked, setOnlyUnlinked] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/contacts?active=all')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (live) setAllContacts(Array.isArray(d) ? d : []) })
      .catch(() => { if (live) setAllContacts([]) })
    return () => { live = false }
  }, [refreshKey])

  const unlinkedCount = allContacts?.filter(c => c.companies.length === 0).length ?? 0

  useEffect(() => {
    fetch('/api/masters/contact-types')
      .then(r => r.json())
      .then(d => setContactTypes(Array.isArray(d) ? d : []))
      .catch(() => toast('Failed to load contact types', 'error'))
  }, [toast])

  /*
   * Not memoised, no catch — see the Companies tab's `load` for why both of
   * those are deliberate.
   *
   * `active=all` on every request: the route defaults to active-only, and a
   * list whose Status filter cannot reach the inactive rows is a filter that
   * lies. The narrowing happens here instead, off the full set.
   */
  const load: ListPageProps<ContactRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams({ active: 'all' })
    if (search) params.set('q', search)
    const r = await fetch(`/api/contacts?${params.toString()}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: ContactRow[] = Array.isArray(body) ? body : []
    return rows.filter(row => {
      if (filters.contactType && row.contact_types?.id !== filters.contactType) return false
      if (filters.status === 'active' && !row.is_active) return false
      if (filters.status === 'inactive' && row.is_active) return false
      if (filters.linked === 'linked' && row.companies.length === 0) return false
      if (filters.linked === 'unlinked' && row.companies.length > 0) return false
      // P5-T7: the alert banner's one-click narrowing — see the Companies
      // tab's `load` for why this is a second filter rather than a prop on
      // `list-page.tsx`.
      if (onlyUnlinked && row.companies.length > 0) return false
      return true
    })
  }

  const filters: ListFilter[] = [
    {
      id: 'contactType',
      label: 'Contact Type',
      kind: 'select',
      searchable: contactTypes.length > 6,
      options: {
        '': 'Any type',
        ...Object.fromEntries(contactTypes.map(t => [t.id, t.name])),
      },
    },
    {
      id: 'status',
      label: 'Status',
      kind: 'select',
      options: { '': 'Any', active: 'Active only', inactive: 'Inactive only' },
    },
    {
      id: 'linked',
      label: 'Account link',
      kind: 'select',
      options: {
        '': 'Any',
        linked: 'Linked to an account',
        unlinked: 'Not linked to any account',
      },
    },
  ]

  /* F25 — same move as the Companies tab: the alert is behind the header
     icon, and only the applied-filter chip is ever in the page flow. The
     two tabs are peers and must behave identically. */
  const healthAlerts: DataHealthAlertItem[] = [
    {
      id: 'unlinked',
      count: unlinkedCount,
      title: `${unlinkedCount} ${unlinkedCount === 1 ? 'contact is' : 'contacts are'} not linked to any account`,
      detail: "Missing an account link — a contact belongs to no account until it is linked from an account's own page.",
      actionLabel: 'View unlinked contacts',
      active: onlyUnlinked,
      onAction: () => { setOnlyUnlinked(true); setRefreshKey(k => k + 1) },
    },
  ]

  const banners = onlyUnlinked ? (
    <QuickFilterChip
      label="Showing contacts without an account"
      onClear={() => { setOnlyUnlinked(false); setRefreshKey(k => k + 1) }}
    />
  ) : null

  return (
    <>
      <div className="flex min-h-0 flex-col md:h-full">
      <ListPage<ContactRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Accounts"
        noun={{ one: 'contact', many: 'contacts' }}
        sectionTabs={<>{sectionTabs}{banners}</>}
        /*
         * F22: "contact tab doesn't even have create contact button" — a
         * missing function, not a styling gap. `ContactDialog` already
         * existed (built for §3.4 step 2, opened from a company's own
         * page) but nothing on THIS tab mounted it. It is reused here in
         * its picker mode (see contact-dialog.tsx) rather than adding a
         * second create path.
         */
        action={
          <div className="flex items-center gap-2">
            <DataHealthAlerts alerts={healthAlerts} label="Contact data health" />
            <PermissionTooltip allowed={!createKnown || canCreate} reason="Only someone who can create contacts can add them">
              <Button onClick={() => setCreateOpen(true)} disabled={!canCreate}>
                <PlusIcon />
                Add contact
              </Button>
            </PermissionTooltip>
          </div>
        }
        columns={contactColumns({
          canDelete,
          canMakeIndividual,
          actionsKnown,
          busyId: makingIndividualId,
          onDelete: row => void startDelete(row),
          onMakeIndividual: row => void makeIndividual(row),
        })}
        rowKey={row => row.id}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchPlaceholder="Search contacts"
        searchHint={CONTACT_SEARCH_HINT}
        emptyYet={{
          heading: 'No contacts yet',
          body: 'The people at those accounts live here. Add one directly, or from the account page it belongs to — a contact may be linked to more than one account.',
          actionLabel: 'Add contact',
          onAction: canCreate ? () => setCreateOpen(true) : undefined,
          actionDisabledReason: !createKnown ? null : canCreate ? undefined : 'Only someone who can create contacts can add them',
        }}
      />
      </div>

      <ContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companyOptions}
        contactTypes={partyMasters.contactTypes.length ? partyMasters.contactTypes : contactTypes.filter(t => t.is_active !== false)}
        users={partyMasters.users}
        onCreated={contact => {
          setCreateOpen(false)
          setRefreshKey(k => k + 1)
          toast(`${contact.name} created.`)
        }}
      />

      <IndividualConflictDialog
        conflict={individualConflict}
        onOpenChange={open => { if (!open) setIndividualConflict(null) }}
      />

      {/* Deletion is BLOCKED, not just warned about — same as the Contact
          page — so this carries no confirm option, only a way out (and a
          link to the Self account when that is the reason). */}
      <Dialog
        open={deleteFlow?.stage === 'blocked'}
        onOpenChange={open => { if (!open) setDeleteFlow(null) }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>This contact cannot be deleted</DialogTitle>
            <DialogDescription>
              {deleteFlow?.stage === 'blocked' ? deleteFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Close</Button>} />
            {deleteFlow?.stage === 'blocked' && deleteFlow.selfAccountId ? (
              <Button render={<Link href={`/parties/companies/${deleteFlow.selfAccountId}`} />}>
                Go to that account
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The dry-run 409: list what this delete will unlink, then let the
          user actually confirm it — same flow as the Contact page. */}
      <Dialog
        open={deleteFlow?.stage === 'confirm'}
        onOpenChange={open => { if (!open) setDeleteFlow(null) }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteFlow?.row.name}?</DialogTitle>
            <DialogDescription>
              This also removes {deleteFlow?.row.name} from the account{
                deleteFlow?.stage === 'confirm' && deleteFlow.linkedAccounts.length === 1 ? '' : 's'
              } below. The contact is deactivated, not erased.
            </DialogDescription>
          </DialogHeader>
          {deleteFlow?.stage === 'confirm' && deleteFlow.linkedAccounts.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-border-light bg-surface-control px-3 py-2">
              {deleteFlow.linkedAccounts.map(a => (
                <li key={a.id} className="text-body text-text-primary">
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button variant="danger" onClick={() => void confirmDeleteFlow()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// PHONE — Accounts list (docs/phone-plan.md screen 1)
// ══════════════════════════════════════════════════════════════

/**
 * Phone's Accounts tab root. Reuses the same `GET /api/companies` the
 * desktop Companies tab calls — no new route. Company/Individual chips with
 * counts come from one unfiltered fetch, same approach as `allCompanies`
 * above (cheap at this tenant's scale; re-fetched on every search/filter
 * change would not be, which is why search/kind still narrow server-side).
 */
function PhoneAccountsList({ me }: { me: Me | null }) {
  usePhoneAppBar({ title: 'Accounts' })
  const router = useRouter()
  const canCreate = me?.permissions?.companies?.create ?? false
  const createKnown = me !== null

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<string | null>(null)
  const [rows, setRows] = useState<CompanyRow[]>([])
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [counts, setCounts] = useState<{ company: number; individual: number; total: number }>({
    company: 0,
    individual: 0,
    total: 0,
  })

  const load = useRef(async () => {})
  load.current = async () => {
    setState('loading')
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (kind) params.set('kind', kind)
      const r = await fetch(`/api/companies?${params.toString()}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = await r.json()
      setRows(Array.isArray(body) ? body : [])
      setState('ready')
    } catch {
      setState('failed')
    }
  }

  useEffect(() => {
    void load.current()
  }, [search, kind])

  // Counts for the filter chips — one unfiltered fetch, independent of the
  // search/kind-filtered list above.
  useEffect(() => {
    let live = true
    fetch('/api/companies', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => {
        if (!live || !Array.isArray(d)) return
        const all = d as CompanyRow[]
        setCounts({
          total: all.length,
          company: all.filter(c => (c.account_kind ?? 'Company') === 'Company').length,
          individual: all.filter(c => c.account_kind === 'Individual').length,
        })
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  function renderRow(row: CompanyRow) {
    const facts = [row.type || row.account_kind || 'Company', row.districts?.name].filter(
      (v): v is string => Boolean(v)
    )
    return (
      <PhoneListRow
        href={`/parties/companies/${row.id}`}
        name={row.name}
        facts={facts}
        meta={row.mobile_1 ?? undefined}
      />
    )
  }

  return (
    <PhoneList
      state={state}
      onRetry={() => void load.current()}
      onRefresh={() => load.current()}
      noun={{ one: 'account', many: 'accounts' }}
      rows={rows}
      total={rows.length}
      rowKey={r => r.id}
      renderRow={renderRow}
      search={{ value: search, onChange: setSearch }}
      filters={{
        label: 'Kind',
        value: kind,
        onChange: setKind,
        allLabel: 'All',
        allCount: counts.total,
        chips: [
          { value: 'Company', label: 'Company', count: counts.company },
          { value: 'Individual', label: 'Individual', count: counts.individual },
        ],
      }}
      add={{
        label: 'Add account',
        href: '/parties/new',
        allowed: createKnown ? canCreate : undefined,
        reason: 'Only someone who can create accounts can add them',
      }}
      empty={
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">No accounts yet</p>
          <p className="text-body text-text-muted">Add the first one to get started.</p>
        </div>
      }
    />
  )
}

// ══════════════════════════════════════════════════════════════
// THE PAGE
// ══════════════════════════════════════════════════════════════

function PartiesScreen() {
  const me = useMe()
  const searchParams = useSearchParams()
  const { layout } = useLayout()

  // Phone: a single Accounts list (§41.5). Contacts has no phone tab of its
  // own here — reached from an account's "Contacts" related row instead
  // (docs/phone-plan.md screen 2), so the phone branch never needs the
  // Companies/Contacts tab switch below.
  if (layout === 'phone') return <PhoneAccountsList me={me} />

  /*
   * Section 26: a whole area the user has no access to is hidden rather than
   * disabled, and that reaches a tab as much as a sidebar entry. While `me` is
   * still loading both tabs are shown — the tab bar is chrome, and removing one
   * a moment after it appeared is a worse flicker than showing it — and the
   * routes enforce the permission regardless of what this renders.
   */
  const allowed: SectionTab[] = [
    { value: COMPANIES, label: 'Accounts' },
    { value: CONTACTS, label: 'Contacts' },
  ].filter(tab => {
    if (!me) return true
    if (me.role === 'Administrator') return true
    return me.permissions?.[tab.value]?.view ?? false
  })

  const requested = searchParams.get(TAB_PARAM) ?? ''
  const active = allowed.some(t => t.value === requested)
    ? requested
    : (allowed[0]?.value ?? COMPANIES)

  /* One tab is not a tab bar — it is a label with nothing to choose. */
  const sectionTabs =
    allowed.length > 1 ? (
      <SectionTabs tabs={allowed} value={active} param={TAB_PARAM} />
    ) : undefined

  /*
   * Only the active tab is mounted, so each tab's search, filters and page
   * number are its own and neither leaks into the other. Switching back starts
   * that tab's list fresh, which is the honest reading of "each tab has its own
   * search and filters".
   */
  return active === CONTACTS ? (
    <ContactsTab me={me} sectionTabs={sectionTabs} />
  ) : (
    <CompaniesTab me={me} sectionTabs={sectionTabs} />
  )
}

/**
 * `useSearchParams` has to sit under a Suspense boundary in the App Router, or
 * the route opts the whole page out of static rendering without saying so.
 * Same shape as the two detail pages.
 */
export default function PartiesPage() {
  return (
    <Suspense fallback={null}>
      <PartiesScreen />
    </Suspense>
  )
}
