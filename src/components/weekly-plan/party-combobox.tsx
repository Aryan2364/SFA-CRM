'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A Company or a Contact, flattened into one selectable list.
 *
 * `weekly_plan_items` stores the choice as the pair (`party_id`, `party_type`),
 * so the type travels with the option rather than being inferred from the id —
 * a Company and a Contact can hold the same uuid in principle, and inferring
 * would silently mislabel one of them on the manager's diff.
 */
export type PartyOption = {
  id: string
  type: 'company' | 'contact'
  name: string
  subtitle: string
}

/**
 * Loads the party list once per mount and shares it across every row.
 *
 * The owner's plan screen builds this same list inline. It is lifted here
 * because the manager's editor needs the identical set — a manager who can only
 * pick from a narrower list would silently drop a line's party on save, which
 * is the exact failure `toItemRows` exists to prevent on the server side.
 */
export function usePartyOptions(enabled: boolean) {
  const [options, setOptions] = useState<PartyOption[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    Promise.all([
      fetch('/api/companies').then(r => (r.ok ? r.json() : [])),
      fetch('/api/contacts').then(r => (r.ok ? r.json() : [])),
    ])
      .then(([companies, contacts]) => {
        if (cancelled) return
        const list: PartyOption[] = []
        if (Array.isArray(companies)) {
          for (const c of companies) {
            list.push({
              id: c.id,
              type: 'company',
              name: c.name ?? '',
              subtitle: c.stage ?? '',
            })
          }
        }
        if (Array.isArray(contacts)) {
          for (const c of contacts) {
            // A Contact can belong to many companies and the list is
            // primary-first, so [0] is the one whose name applies.
            const primary = Array.isArray(c.companies) ? c.companies[0] : null
            list.push({
              id: c.id,
              type: 'contact',
              name: c.name ?? '',
              subtitle: primary?.name ?? '',
            })
          }
        }
        list.sort((a, b) => a.name.localeCompare(b.name))
        setOptions(list)
      })
      .catch(() => {
        // An empty list is the honest answer and still renders a usable row —
        // the field keeps whatever party the line already carries.
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return options
}

/**
 * The party field on one editable line.
 *
 * The menu is absolutely positioned inside the row rather than portalled,
 * because it must scroll WITH the line it belongs to: a portalled menu stays
 * where it was drawn while the dialog body scrolls under it.
 */
export function PartyCombobox({
  value,
  label,
  options,
  disabled,
  onChange,
}: {
  value: string | null
  /** The stored label, shown when the option list has not loaded yet. */
  label: string | null
  options: PartyOption[] | null
  disabled?: boolean
  onChange: (option: PartyOption | null) => void
}) {
  const selected = useMemo(
    () => options?.find(o => o.id === value) ?? null,
    [options, value],
  )
  const shown = selected?.name ?? label ?? ''
  const [query, setQuery] = useState(shown)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(shown)
  }, [shown])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(shown)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [shown])

  const filtered = useMemo(() => {
    const all = options ?? []
    const q = query.trim().toLowerCase()
    if (!q || query === shown) return all
    return all.filter(o => o.name.toLowerCase().includes(q))
  }, [options, query, shown])

  return (
    <div ref={boxRef} className="relative w-full">
      <input
        type="text"
        disabled={disabled}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search company or contact…"
        // 16px below sm: anything smaller makes iOS zoom the page on focus.
        className="w-full rounded-lg border border-border-light px-3 py-2 text-[16px] text-text-primary focus:ring-2 focus:ring-primary-ring focus:outline-none disabled:bg-surface-sunken disabled:text-text-muted sm:text-sm"
      />
      {!disabled && open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-0.5 max-h-56 overflow-y-auto rounded-lg border border-border-light bg-surface shadow-lg">
          {value && (
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(null)
                setQuery('')
                setOpen(false)
              }}
              className="w-full px-3 py-2 text-left text-sm text-text-secondary transition hover:bg-surface-sunken"
            >
              Clear party
            </button>
          )}
          {options === null ? (
            <p className="px-3 py-2 text-sm text-text-muted">Loading parties…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">No parties found</p>
          ) : (
            filtered.slice(0, 200).map(o => (
              <button
                key={`${o.type}:${o.id}`}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onChange(o)
                  setQuery(o.name)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-primary-subtle',
                  o.id === value && 'bg-primary-subtle',
                )}
              >
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
                    o.type === 'company'
                      ? 'bg-primary-subtle text-primary'
                      : 'bg-success-bg text-success',
                  )}
                >
                  {o.type === 'company' ? 'Company' : 'Contact'}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate',
                    o.id === value ? 'font-medium text-primary' : 'text-text-secondary',
                  )}
                >
                  {o.name}
                </span>
                {o.subtitle && (
                  <span className="ml-auto shrink-0 text-xs text-text-muted">{o.subtitle}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
