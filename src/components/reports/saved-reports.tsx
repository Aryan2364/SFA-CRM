'use client'

import * as React from 'react'
import {
  BookmarkIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'

/**
 * REBUILD-PLAN.md §7.1, P5-T3 — Saved Reports.
 *
 * "Can save a combination as a Saved Report for repeat use."
 *
 * ---------------------------------------------------------------------------
 * ⚠️ IMPORTS NOTHING FROM `@/lib/**` EXCEPT `cn`. DO NOT ADD ONE.
 *
 * Same rule, same reason as `types.ts`: this is a `'use client'` component, and
 * `@/app/api/reports/saved/config` — where the server's copy of these types
 * lives — imports the report registries, which import Prisma and `pg`. One
 * import pulls the data layer into the browser bundle and breaks every route in
 * the app with a clean `tsc --noEmit`. The config type below is a hand-written
 * copy of the wire shape, which is the contract anyway.
 * ---------------------------------------------------------------------------
 *
 * WHAT IS STORED IS THE PRESET, NOT THE DATES.
 *
 * A report saved as "Last 30 days" and opened in December means December's last
 * thirty days. So a non-custom range stores only its preset key and is
 * re-resolved at open time; `custom` is the one preset that stores literal
 * dates. Enforced on the server too — see `config.ts`.
 *
 * SCOPED TO THEIR OWNER. The list endpoint filters on `user_id` as well as
 * `tenant_id`, with no §6.6 widening for a manager or an Administrator. A saved
 * report is a personal shortcut, not a record about a person.
 */

export type SavedPresetKey =
  | 'today'
  | 'yesterday'
  | 'last_7'
  | 'last_30'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'this_fy'
  | 'custom'

export type SavedRange =
  | { preset: Exclude<SavedPresetKey, 'custom'>; from?: undefined; to?: undefined }
  | { preset: 'custom'; from: string; to: string }

export type SavedReportConfig = {
  measure: string
  dimensions: string[]
  range: SavedRange
  filters: Record<string, string>
}

export type SavedReport = {
  id: string
  name: string
  config: SavedReportConfig
  created_at: string
  updated_at: string
}

/**
 * Why a saved report cannot be opened, or `null` when it can.
 *
 * A config can outlive the thing it names: a measure is dropped from the
 * registry, or a permission is withdrawn and `/api/reports/meta` stops offering
 * it. The row is NOT deleted for the person — a silent disappearance is worse
 * than a broken shortcut, and a withdrawn permission may be restored tomorrow.
 * It is shown, disabled, with the reason in plain words and Delete still
 * available, which is the way forward out of the state.
 */
export type UnavailableReason = string | null

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

export function SavedReports({
  currentConfig,
  activeId,
  activeName,
  edited,
  onOpen,
  onActiveChange,
  unavailableReason,
  describeConfig,
}: {
  /** The builder's current combination, or null while meta is still loading. */
  currentConfig: SavedReportConfig | null
  /** The saved report the builder is currently showing, if any. */
  activeId: string | null
  activeName: string | null
  /** True once the builder has been changed since that saved report opened. */
  edited: boolean
  onOpen: (report: SavedReport) => void
  onActiveChange: (report: SavedReport | null) => void
  unavailableReason: (config: SavedReportConfig) => UnavailableReason
  /** "Order Amount by Salesperson · Last 30 days", built from the live meta. */
  describeConfig: (config: SavedReportConfig) => string
}) {
  const { toast } = useToast()

  const [reports, setReports] = React.useState<SavedReport[] | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  /** null = closed. 'new' = save the current combination. Otherwise a rename. */
  const [naming, setNaming] = React.useState<'new' | SavedReport | null>(null)
  const [deleting, setDeleting] = React.useState<SavedReport | null>(null)

  const load = React.useCallback(() => {
    setListError(null)
    fetch('/api/reports/saved')
      .then(async res => {
        if (!res.ok) throw new Error(await readError(res, 'Saved reports could not be loaded.'))
        return (await res.json()) as SavedReport[]
      })
      .then(setReports)
      .catch((err: Error) => {
        setReports([])
        setListError(err.message)
      })
  }, [])

  React.useEffect(load, [load])

  /**
   * Replace one row IN PLACE, keyed by id, and keep the list in name order.
   * Never refetch the whole list after a rename: a refetch swaps every node,
   * which is the flicker the global rules forbid, and it would also lose a
   * scroll position mid-edit.
   */
  const upsert = React.useCallback((row: SavedReport) => {
    setReports(prev => {
      const list = prev ? [...prev] : []
      const at = list.findIndex(r => r.id === row.id)
      if (at >= 0) list[at] = row
      else list.push(row)
      return list.sort((a, b) => a.name.localeCompare(b.name))
    })
  }, [])

  async function save(name: string, target: 'new' | SavedReport) {
    if (!currentConfig && target === 'new') return
    const isRename = target !== 'new'

    const res = await fetch(
      isRename ? `/api/reports/saved/${target.id}` : '/api/reports/saved',
      {
        method: isRename ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isRename ? { name } : { name, config: currentConfig }),
      }
    )
    if (!res.ok) throw new Error(await readError(res, 'The report could not be saved.'))

    const row = (await res.json()) as SavedReport
    upsert(row)
    if (!isRename) onActiveChange(row)
    else if (activeId === row.id) onActiveChange(row)
    toast(isRename ? 'Renamed.' : `Saved as “${row.name}”.`)
  }

  /** Overwrite the open saved report with what is on screen now. */
  async function update(target: SavedReport) {
    if (!currentConfig) return
    const res = await fetch(`/api/reports/saved/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: currentConfig }),
    })
    if (!res.ok) {
      toast(await readError(res, 'The report could not be updated.'), 'error')
      return
    }
    const row = (await res.json()) as SavedReport
    upsert(row)
    onActiveChange(row)
    toast(`Updated “${row.name}”.`)
  }

  async function remove(target: SavedReport) {
    const res = await fetch(`/api/reports/saved/${target.id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      toast(await readError(res, 'The report could not be deleted.'), 'error')
      return
    }
    setReports(prev => (prev ?? []).filter(r => r.id !== target.id))
    if (activeId === target.id) onActiveChange(null)
    setDeleting(null)
    toast(`Deleted “${target.name}”.`)
  }

  const count = reports?.length ?? 0
  const activeReport = reports?.find(r => r.id === activeId) ?? null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-0">
              <BookmarkIcon aria-hidden="true" />
              <span className="max-w-40 truncate">
                {activeName ?? 'Saved reports'}
              </span>
              {count > 0 && !activeName ? (
                <span className="rounded-full bg-surface-sunken px-1.5 text-meta text-text-secondary">
                  {count}
                </span>
              ) : null}
            </Button>
          }
        />
        <PopoverContent align="end" className="w-80 gap-2 p-2">
          {reports === null ? (
            <p className="px-2 py-3 text-label text-text-secondary">Loading…</p>
          ) : count === 0 ? (
            // No dead end: the empty state carries the action that fills it.
            <div className="flex flex-col gap-2 p-2">
              <p className="text-label font-medium text-text-primary">
                No saved reports yet
              </p>
              <p className="text-meta text-text-secondary">
                {listError ??
                  'Set up a report the way you want it, then save the combination here to come back to it.'}
              </p>
              {listError ? (
                <Button variant="secondary" size="sm" onClick={load}>
                  Try again
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!currentConfig}
                  onClick={() => {
                    setOpen(false)
                    setNaming('new')
                  }}
                >
                  Save this report
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {reports.map(report => {
                const reason = unavailableReason(report.config)
                const isActive = report.id === activeId
                return (
                  <li key={report.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      disabled={reason !== null}
                      title={reason ?? undefined}
                      onClick={() => {
                        setOpen(false)
                        onOpen(report)
                      }}
                      className={cn(
                        'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1.5 text-left transition-colors',
                        reason
                          ? 'cursor-default'
                          : 'hover:bg-surface-sunken',
                        isActive && 'bg-primary-subtle'
                      )}
                    >
                      <span className="flex items-center gap-1.5 truncate text-label font-medium text-text-primary">
                        {isActive && (
                          <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary-pressed" />
                        )}
                        {reason && (
                          <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
                        )}
                        <span className="truncate">{report.name}</span>
                      </span>
                      <span className="truncate text-meta text-text-secondary">
                        {reason ?? describeConfig(report.config)}
                      </span>
                    </button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="min-h-11 min-w-11 shrink-0 self-center sm:min-h-9 sm:min-w-9"
                      aria-label={`Rename ${report.name}`}
                      onClick={() => {
                        setOpen(false)
                        setNaming(report)
                      }}
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="min-h-11 min-w-11 shrink-0 self-center sm:min-h-9 sm:min-w-9"
                      aria-label={`Delete ${report.name}`}
                      onClick={() => {
                        setOpen(false)
                        setDeleting(report)
                      }}
                    >
                      <TrashIcon aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {/* Overwrite sits beside Save, not inside the naming dialog, because it
          acts on a report that is already named — asking for the name again
          would be asking a question whose answer is already on the button. */}
      {activeReport && edited && (
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 sm:min-h-0"
          disabled={!currentConfig}
          onClick={() => update(activeReport)}
        >
          Update
        </Button>
      )}

      <Button
        size="sm"
        className="min-h-11 sm:min-h-0"
        disabled={!currentConfig}
        onClick={() => setNaming('new')}
      >
        {activeReport && edited ? 'Save as new' : 'Save'}
      </Button>

      <NameDialog
        target={naming}
        onClose={() => setNaming(null)}
        onSubmit={save}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => {
          if (!o) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved combination from your list. The data it
              reports on is not affected, and you can build and save the same
              combination again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => deleting && remove(deleting)}
            >
              Delete saved report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * The name dialog, for both "save this" and "rename that".
 *
 * ⚠️ NO `prompt()`. The global rule, and a native prompt could not show the
 * duplicate-name error the server returns anyway — it has nowhere to put it.
 * The error lands under the field, beside what is wrong.
 */
function NameDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: 'new' | SavedReport | null
  onClose: () => void
  onSubmit: (name: string, target: 'new' | SavedReport) => Promise<void>
}) {
  const isRename = target !== null && target !== 'new'
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Reset every time the dialog opens, so a failed save is not re-opened with
  // the previous attempt's error still under the field.
  const openedFor = React.useRef<string | null>(null)
  const key = target === null ? null : target === 'new' ? 'new' : target.id
  if (openedFor.current !== key) {
    openedFor.current = key
    if (target !== null) {
      setName(isRename ? (target as SavedReport).name : '')
      setError(null)
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (target === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name, target)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={o => {
        if (!o) onClose()
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isRename ? 'Rename saved report' : 'Save this report'}</DialogTitle>
          <DialogDescription>
            {isRename
              ? 'Only the name changes. The measure, breakdown and date range stay as they were saved.'
              : 'The measure, breakdown, filters and date range are saved together. A range like “Last 30 days” stays relative, so it always means the last thirty days when you open it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody>
            <label className="text-label text-text-secondary" htmlFor="saved-report-name">
              Name
            </label>
            <Input
              id="saved-report-name"
              autoFocus
              value={name}
              maxLength={80}
              aria-invalid={error !== null}
              placeholder="Monthly orders by salesperson"
              // 16px on a phone, or iOS zooms the whole page on focus.
              className="mt-1 max-w-full text-base sm:text-body"
              onChange={e => {
                setName(e.target.value)
                setError(null)
              }}
            />
            {error && <p className="mt-1 text-label text-danger">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? 'Saving…' : isRename ? 'Rename' : 'Save report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
