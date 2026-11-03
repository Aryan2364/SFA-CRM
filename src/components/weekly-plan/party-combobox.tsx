'use client'

import { useEffect, useState } from 'react'

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
      fetch('/api/companies?fields=picker').then(r => (r.ok ? r.json() : [])),
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
