'use client'

import * as React from 'react'
import { CheckIcon, PlusIcon, SearchIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.8 rule 7: select and
 * searchable-select open as bottom sheets on phone. This is the generic
 * version: a field that looks like an input showing the chosen label, and
 * on tap opens a full-height bottom sheet with a search box and 44px rows.
 *
 * Two variants:
 *   - `PickerSheetField` — server search via `fetchOptions`, debounced
 *     300ms (accounts, products, opportunities — anything too long to ship
 *     to the client whole).
 *   - `StaticPickerSheetField` — a fixed, short option list (stages,
 *     statuses) filtered client-side, no network round trip.
 */

const SEARCH_DELAY_MS = 300

export type PickerOption = {
  id: string
  label: string
  sublabel?: string
}

type SheetShellProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}

function PickerSheetShell({ open, onOpenChange, title, children }: SheetShellProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[100dvh] rounded-none">
        <SheetHeader className="shrink-0 border-b border-border-light">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border-light bg-surface px-3">
      <SearchIcon aria-hidden className="size-4 shrink-0 text-text-secondary" />
      <input
        type="search"
        inputMode="search"
        autoFocus
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none"
        style={{ fontSize: 16 }}
      />
    </div>
  )
}

function OptionRow({
  option,
  chosen,
  onSelect,
}: {
  option: PickerOption
  chosen: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-11 w-full items-center justify-between gap-2 px-1 py-2 text-left active:bg-surface-control"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body text-text-primary">{option.label}</span>
        {option.sublabel ? (
          <span className="truncate text-meta text-text-muted">{option.sublabel}</span>
        ) : null}
      </span>
      {chosen ? <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" /> : null}
    </button>
  )
}

function CreateNewRow({ query, onCreate }: { query: string; onCreate: (query: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCreate(query)}
      className="flex min-h-11 w-full items-center gap-2 border-t border-border-light px-1 py-2 text-left text-body font-medium text-primary active:bg-surface-control"
    >
      <PlusIcon aria-hidden className="size-4" />
      {query ? `Create "${query}"` : 'Create new'}
    </button>
  )
}

function FieldButton({
  label,
  placeholder,
  disabled,
  onClick,
}: {
  label: string | undefined
  placeholder: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border-light bg-surface px-3 text-left text-body',
        label ? 'text-text-primary' : 'text-text-muted',
        disabled && 'opacity-60'
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label || placeholder}</span>
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">{children}</div>
}

export type PickerSheetFieldProps = {
  value: PickerOption | null
  onChange: (option: PickerOption) => void
  fetchOptions: (query: string) => Promise<PickerOption[]>
  label: string
  placeholder?: string
  onCreate?: (query: string) => void
  disabled?: boolean
}

/** Server-searched picker: §41.8 rule 7 + debounced search per field spec. */
export function PickerSheetField({
  value,
  onChange,
  fetchOptions,
  label,
  placeholder = 'Select…',
  onCreate,
  disabled,
}: PickerSheetFieldProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<PickerOption[]>([])
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const requestId = React.useRef(0)

  const runSearch = React.useCallback(
    (q: string) => {
      const id = ++requestId.current
      setState('loading')
      fetchOptions(q)
        .then(results => {
          if (requestId.current !== id) return
          setOptions(results)
          setState('ready')
        })
        .catch(() => {
          if (requestId.current !== id) return
          setState('error')
        })
    },
    [fetchOptions]
  )

  React.useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => runSearch(query), query === '' ? 0 : SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, query, runSearch])

  return (
    <>
      <FieldButton label={value?.label} placeholder={placeholder} disabled={disabled} onClick={() => setOpen(true)} />
      <PickerSheetShell open={open} onOpenChange={setOpen} title={label}>
        <SearchBox value={query} onChange={setQuery} placeholder={`Search ${label.toLowerCase()}`} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {state === 'loading' ? (
            <Centered>
              <div className="size-6 animate-spin rounded-full border-2 border-border-light border-t-primary" />
            </Centered>
          ) : state === 'error' ? (
            <Centered>
              <p className="text-body text-text-primary">Could not load results</p>
              <button type="button" className="text-body text-primary" onClick={() => runSearch(query)}>
                Try again
              </button>
            </Centered>
          ) : options.length === 0 ? (
            <Centered>
              <p className="text-body text-text-muted">No matches</p>
            </Centered>
          ) : (
            options.map(option => (
              <OptionRow
                key={option.id}
                option={option}
                chosen={option.id === value?.id}
                onSelect={() => {
                  onChange(option)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
        {onCreate ? <CreateNewRow query={query} onCreate={q => { onCreate(q); setOpen(false) }} /> : null}
      </PickerSheetShell>
    </>
  )
}

export type StaticPickerSheetFieldProps = {
  value: PickerOption | null
  onChange: (option: PickerOption) => void
  options: PickerOption[]
  label: string
  placeholder?: string
  onCreate?: (query: string) => void
  disabled?: boolean
}

/** Client-filtered picker for short, fixed lists (stages, statuses, …). */
export function StaticPickerSheetField({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select…',
  onCreate,
  disabled,
}: StaticPickerSheetFieldProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      o => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q)
    )
  }, [options, query])

  return (
    <>
      <FieldButton label={value?.label} placeholder={placeholder} disabled={disabled} onClick={() => setOpen(true)} />
      <PickerSheetShell open={open} onOpenChange={setOpen} title={label}>
        <SearchBox value={query} onChange={setQuery} placeholder={`Search ${label.toLowerCase()}`} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {filtered.length === 0 ? (
            <Centered>
              <p className="text-body text-text-muted">No matches</p>
            </Centered>
          ) : (
            filtered.map(option => (
              <OptionRow
                key={option.id}
                option={option}
                chosen={option.id === value?.id}
                onSelect={() => {
                  onChange(option)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
        {onCreate ? <CreateNewRow query={query} onCreate={q => { onCreate(q); setOpen(false) }} /> : null}
      </PickerSheetShell>
    </>
  )
}
