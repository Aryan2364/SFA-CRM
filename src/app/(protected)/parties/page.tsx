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
import { PencilIcon, PlusIcon, Trash2Icon, UploadIcon, ZapIcon } from 'lucide-react'

import Modal from '@/components/ui/Modal'
import { QuickCreateDialog } from './quick-create-dialog'
import { useMe, type Me } from '@/hooks/useMe'
import { useBPForm, BusinessPartnerFormFields } from '@/components/masters/BusinessPartnerForm'
import { useToast } from '@/contexts/ToastContext'
import { RECORD_COMPLETENESS, StatusBadge } from '@/components/status-badge'
import { DataHealthAlert, QuickFilterChip } from '@/components/alerts/data-health-alert'
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
import { Button } from '@/components/ui/button'
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
}

type ContactRow = {
  id: string
  name: string
  mobile: string
  designation: string | null
  is_active: boolean
  contact_types: NamedRef | null
  companies: { id: string; name: string }[]
}

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
  'Searches the company name. Type, status and completeness are filters.'
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
      className: 'max-w-field-min',
      skeletonWidth: 'w-40',
      cell: row => (
        <NameLink
          href={`/parties/companies/${row.id}?from=${backTo(COMPANIES)}`}
          name={row.name}
        />
      ),
    },
    {
      id: 'type',
      header: 'Company Type',
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
      cell: row => (
        <Switch
          aria-label={`Active — ${row.name}`}
          checked={Boolean(row.is_active)}
          disabled={!canEdit}
          onCheckedChange={
            canEdit ? value => onToggleActive(row, value) : undefined
          }
        />
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-20',
      cell: row => (
        <div className="flex items-center justify-end gap-2">
          {canEdit && (
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
          {canDelete && (
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

// ── Template download (server-side, returns .xlsx with dropdowns) ─────────────
async function downloadTemplate(onError: (msg: string) => void) {
  try {
    const res = await fetch('/api/companies/bulk-template')
    if (!res.ok) { onError('Failed to generate template'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'companies_template.xlsx'; a.click()
    URL.revokeObjectURL(url)
  } catch {
    onError('Failed to download template')
  }
}

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────
function BulkUploadModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]           = useState<Record<string, string>[]>([])
  const [fileName, setFileName]   = useState('')
  const [parsing, setParsing]     = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<{ inserted: number; errors: { row: number; message: string }[] } | null>(null)

  function reset() { setRows([]); setFileName(''); setResult(null); if (fileRef.current) fileRef.current.value = '' }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setRows([])
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/companies/bulk-parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { toast(data.error ?? 'Failed to read file', 'error'); return }
      if (!data.rows?.length) { toast('No data rows found in file', 'error'); return }
      setRows(data.rows)
    } catch {
      toast('Failed to read file', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)
    try {
      // The route still reads the payload key `leads` — it is the same handler
      // the `/api/leads` alias re-exported and renaming its body is P1-T19's,
      // not this task's.
      const res = await fetch('/api/companies/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: rows }),
      })
      const data = await res.json()
      setResult(data)
      if (data.inserted > 0) {
        toast(`${data.inserted} compan${data.inserted > 1 ? 'ies' : 'y'} imported successfully`, 'success')
        onDone()
      }
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--backdrop) px-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h3 className="text-base font-medium text-text-primary">Bulk Upload Companies</h3>
          <button onClick={() => { reset(); onClose() }} className="text-text-muted hover:text-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Step 1 */}
          <div>
            <p className="text-sm font-medium text-text-secondary mb-2">Step 1 — Download the template</p>
            <button onClick={() => downloadTemplate(msg => toast(msg, 'error'))}
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-lg px-4 py-2 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download Excel Template (.xlsx)
            </button>
            <p className="text-xs text-text-muted mt-1">Template includes dropdowns for Type, State, District, Taluka, Stage and Temperature — populated from your masters.</p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="text-sm font-medium text-text-secondary mb-2">Step 2 — Upload filled file</p>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary-border hover:bg-primary-subtle transition">
              {parsing ? (
                <span className="text-sm text-primary">Reading file…</span>
              ) : (
                <>
                  <svg className="w-6 h-6 text-text-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                  <span className="text-sm text-text-muted">{fileName ? fileName : 'Click to select .xlsx file'}</span>
                  <span className="text-xs text-text-muted mt-0.5">Only the first sheet is imported</span>
                </>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
          </div>

          {/* Preview */}
          {rows.length > 0 && !result && (
            <div>
              <p className="text-sm font-medium text-text-secondary mb-2">Preview — {rows.length} row{rows.length > 1 ? 's' : ''} detected</p>
              <div className="overflow-x-auto rounded-lg border border-border-light max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-surface-sunken sticky top-0">
                    <tr>{['Name', 'Type', 'Mobile 1', 'State', 'District', 'Temperature'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-text-secondary whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border-light">
                        <td className="px-3 py-2 text-text-secondary">{r.name || <span className="text-danger">{EMPTY}</span>}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.type || <span className="text-danger">{EMPTY}</span>}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.mobile_1 || EMPTY}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.state || EMPTY}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.district || EMPTY}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.temperature || EMPTY}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <p className="text-xs text-text-muted mt-1">Showing first 50 of {rows.length} rows.</p>}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-success-bg border border-success-border rounded-lg">
                <svg className="w-5 h-5 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-success font-medium">{result.inserted} compan{result.inserted !== 1 ? 'ies' : 'y'} imported successfully</p>
              </div>
              {result.errors.length > 0 && (
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-danger mb-2">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-danger">Row {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-light flex justify-end gap-3">
          <button onClick={() => { reset(); onClose() }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-light rounded-lg">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={rows.length === 0 || importing}
              className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition">
              {importing ? 'Importing…' : `Import ${rows.length > 0 ? rows.length + ' Companies' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CompaniesTab({ me, sectionTabs }: { me: Me | null; sectionTabs: ReactNode }) {
  const { toast } = useToast()
  const router = useRouter()
  const isAdmin = me?.role === 'Administrator'
  // G1: `companies`, the section that exists. `business` never did.
  const canEdit   = isAdmin || (me?.permissions?.companies?.edit   ?? false)
  const canDelete = isAdmin || (me?.permissions?.companies?.delete ?? false)

  const bp = useBPForm()
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving]     = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [deleting, setDeleting] = useState<CompanyRow | null>(null)
  const savingRef               = useRef(false)
  const [companyTypes, setCompanyTypes] = useState<NamedRef[]>([])
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
      .catch(() => toast('Failed to load company types', 'error'))
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
    toast(editing ? 'Updated successfully' : 'Created successfully')
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
      id: 'type',
      label: 'Company Type',
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
      <div className="flex h-full min-h-0 flex-col">
        {onlyIncomplete ? (
          <QuickFilterChip
            label="Showing incomplete parties only"
            onClear={() => { setOnlyIncomplete(false); setRefreshKey(k => k + 1) }}
          />
        ) : (
          <DataHealthAlert
            count={incompleteCount}
            title={`${incompleteCount} ${incompleteCount === 1 ? 'party is' : 'parties are'} incomplete`}
            description="Missing a primary address, city, state, pincode or GST number — an order against one stays in Draft."
            actionLabel="View incomplete"
            onAction={() => { setOnlyIncomplete(true); setRefreshKey(k => k + 1) }}
          />
        )}
        {onlyNoDeal ? (
          <QuickFilterChip
            label="Showing parties without a deal"
            onClear={() => { setOnlyNoDeal(false); setRefreshKey(k => k + 1) }}
          />
        ) : (
          <DataHealthAlert
            count={noDealCount}
            title={`${noDealCount} ${noDealCount === 1 ? 'party has' : 'parties have'} no deal`}
            description="Nothing in the pipeline is tied to these parties yet."
            actionLabel="View"
            onAction={() => { setOnlyNoDeal(true); setRefreshKey(k => k + 1) }}
          />
        )}
      <ListPage<CompanyRow>
        className="h-auto min-h-0 flex-1"
        title="Parties"
        noun={{ one: 'company', many: 'companies' }}
        sectionTabs={sectionTabs}
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
        action={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                <UploadIcon />
                Bulk Upload
              </Button>
              <Button variant="secondary" onClick={() => setQuickOpen(true)}>
                <ZapIcon />
                Quick create
              </Button>
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
              <Button onClick={() => router.push('/parties/companies/new')}>
                <PlusIcon />
                Add company
              </Button>
            </div>
          ) : undefined
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
        searchPlaceholder="Search companies"
        searchHint={COMPANY_SEARCH_HINT}
        emptyYet={{
          heading: 'No companies yet',
          body: 'Every organisation this tenant sells to — prospects, dealers, distributors and institutions — is listed here.',
          actionLabel: canEdit ? 'Add company' : undefined,
          onAction: canEdit ? () => router.push('/parties/companies/new') : undefined,
        }}
      />
      </div>

      <Modal title="Edit company" isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        <BusinessPartnerFormFields
          hook={bp}
          namePlaceholder="Company name"
          showLeadStatus
          topSlot={
            <div>
              <label htmlFor="company-type" className="block text-sm font-medium text-text-secondary mb-1">Company Type</label>
              <select id="company-type" name="type" value={bp.form.type} onChange={bp.F('type')}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                <option value="">Select type…</option>
                {companyTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
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
              This removes the company permanently. A company that is already
              referenced cannot be deleted — deactivate it instead, which keeps
              its history and takes it out of new entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete company
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkUploadModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={() => setRefreshKey(k => k + 1)}
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
  onDelete,
}: {
  canDelete: boolean
  onDelete: (row: ContactRow) => void
}): ListColumn<ContactRow>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      grow: true,
      skeletonWidth: 'w-40',
      cell: row => (
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
      header: 'Companies',
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
       * Delete only. `DELETE /api/contacts/[id]` is a SOFT delete, so it is the
       * deactivation section 15.2 asks for under another name. There is no Edit
       * here because there is no contact form yet — P1-T16 builds it, and a
       * pencil that opens nothing is worse than no pencil. Editing a contact
       * today happens on its own page.
       */
      cell: row => (
        <div className="flex items-center justify-end gap-2">
          {canDelete && (
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

function ContactsTab({ me, sectionTabs }: { me: Me | null; sectionTabs: ReactNode }) {
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  // G1 again: the contacts tab reads the `contacts` section, not `companies`
  // and certainly not `business`.
  const canDelete = isAdmin || (me?.permissions?.contacts?.delete ?? false)

  const [contactTypes, setContactTypes] = useState<NamedRef[]>([])
  const [deleting, setDeleting] = useState<ContactRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

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

  async function confirmDelete() {
    const row = deleting
    if (!row) return
    setDeleting(null)
    const res = await fetch(`/api/contacts/${row.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast((data as { error?: string }).error ?? 'Delete failed', 'error')
      return
    }
    toast('Deleted successfully')
    setRefreshKey(k => k + 1)
  }

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
      label: 'Company link',
      kind: 'select',
      options: {
        '': 'Any',
        linked: 'Linked to a company',
        unlinked: 'Not linked to any company',
      },
    },
  ]

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {onlyUnlinked ? (
          <QuickFilterChip
            label="Showing contacts without a company"
            onClear={() => { setOnlyUnlinked(false); setRefreshKey(k => k + 1) }}
          />
        ) : (
          <DataHealthAlert
            count={unlinkedCount}
            title={`${unlinkedCount} ${unlinkedCount === 1 ? 'contact is' : 'contacts are'} not linked to any company`}
            description="A contact belongs to no party until it is linked from a company's own page."
            actionLabel="View"
            onAction={() => { setOnlyUnlinked(true); setRefreshKey(k => k + 1) }}
          />
        )}
      <ListPage<ContactRow>
        className="h-auto min-h-0 flex-1"
        title="Parties"
        noun={{ one: 'contact', many: 'contacts' }}
        sectionTabs={sectionTabs}
        /*
         * No Add button on this tab, and that is not an omission: §3.3 step 2
         * creates a contact from the company it belongs to, and the two-step
         * form that does it is P1-T16. A primary action that opens nothing
         * would be the worse answer.
         */
        columns={contactColumns({ canDelete, onDelete: setDeleting })}
        rowKey={row => row.id}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchPlaceholder="Search contacts"
        searchHint={CONTACT_SEARCH_HINT}
        emptyYet={{
          heading: 'No contacts yet',
          body: 'The people at those companies live here. A contact is added from the company page it belongs to, and may be linked to more than one company.',
        }}
      />
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The contact is withdrawn from the list and from every company it
              is linked to. The record itself is kept, so anything already
              referring to this person still reads correctly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete contact
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// THE PAGE
// ══════════════════════════════════════════════════════════════

function PartiesScreen() {
  const me = useMe()
  const searchParams = useSearchParams()

  /*
   * Section 26: a whole area the user has no access to is hidden rather than
   * disabled, and that reaches a tab as much as a sidebar entry. While `me` is
   * still loading both tabs are shown — the tab bar is chrome, and removing one
   * a moment after it appeared is a worse flicker than showing it — and the
   * routes enforce the permission regardless of what this renders.
   */
  const allowed: SectionTab[] = [
    { value: COMPANIES, label: 'Companies' },
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
