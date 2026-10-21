'use client'

/**
 * P1-T16 / P1-T17 — the master lists the two-step Company form, the Add Contact
 * dialog and Quick Create all read.
 *
 * One module because all three surfaces need the same lists and each was
 * otherwise going to grow its own `useEffect` + `fetch` + error toast. The
 * Leads-era form did exactly that (`useBPForm` fetches districts, talukas and
 * villages itself), and that is why a failed master fetch there is reported
 * three times on one screen.
 *
 * Every list is READ-ONLY reference data. Nothing here writes, so there is no
 * permission question — a user who can reach the form can read the masters the
 * form's dropdowns are built from.
 */

import { useEffect, useRef, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'

export type NamedRef = { id: string; name: string }

/** `/api/masters/users` rows, narrowed to what an Owner dropdown needs. */
export type UserRef = NamedRef & { contact: string | null; status: string | null }

/**
 * States and districts are small and load once. Talukas and villages are NOT
 * loaded here: villages run to tens of thousands of rows, so `useLocationLists`
 * below fetches talukas for the chosen district and villages for the chosen
 * taluka, on demand, through the masters' own `?districtId=` / `?talukaId=`.
 */
export type DistrictRef = NamedRef & { state_id: string | null }
export type TalukaRef = NamedRef & { district_id: string | null }
export type VillageRef = NamedRef & { taluka_id: string | null }

export type PartyMasters = {
  companyTypes: NamedRef[]
  industries: NamedRef[]
  contactTypes: NamedRef[]
  states: NamedRef[]
  districts: DistrictRef[]
  users: UserRef[]
  /** The signed-in user's `users.id`, for defaulting Owner. Null until loaded. */
  currentUserId: string | null
  loading: boolean
}

const EMPTY: PartyMasters = {
  companyTypes: [],
  industries: [],
  contactTypes: [],
  states: [],
  districts: [],
  users: [],
  currentUserId: null,
  loading: true,
}

async function getList<T>(path: string): Promise<T[]> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(path)
  const data: unknown = await res.json()
  return Array.isArray(data) ? (data as T[]) : []
}

/**
 * ⚠️ `useMe()` does NOT carry `userId` — its `Me` type is name, phone, role,
 * tenantName, hasSubordinates and permissions. `/api/auth/me` DOES return it.
 * Reading the route directly here is deliberate: widening the shared `Me` type
 * would change a hook eleven other screens depend on, to serve one default on
 * one form.
 */
export function usePartyMasters(): PartyMasters {
  const { toast } = useToast()
  const [state, setState] = useState<PartyMasters>(EMPTY)

  useEffect(() => {
    let live = true

    async function load() {
      try {
        const [
          companyTypes, industries, contactTypes,
          states, districts, users, me,
        ] = await Promise.all([
          // `lead-types` is the Company Type master — P1-T18 renames the route
          // to `company-types`; until it does, this is where the values are.
          // Pick lists for new entry: active values only. Every consumer is a
          // create flow, so there is no current value that could be blanked.
          getList<NamedRef>('/api/masters/lead-types?active=true'),
          getList<NamedRef>('/api/masters/industries?active=true'),
          getList<NamedRef>('/api/masters/contact-types?active=true'),
          getList<NamedRef>('/api/masters/states'),
          getList<DistrictRef>('/api/masters/districts'),
          getList<UserRef>('/api/masters/users'),
          fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)),
        ])
        if (!live) return
        setState({
          companyTypes, industries, contactTypes,
          states, districts,
          // Only an Active employee can be handed a new record to own. An
          // Inactive one still appears on records they already own — this is
          // the pick list, not a filter on history.
          users: users.filter(u => u.status !== 'Inactive'),
          currentUserId: (me as { userId?: string } | null)?.userId ?? null,
          loading: false,
        })
      } catch {
        if (!live) return
        // Section 7.1: one message for one failure. The form still renders and
        // the compulsory field (Name) does not depend on any of these lists.
        toast('Could not load the dropdown lists. Refresh to try again.', 'error')
        setState(s => ({ ...s, loading: false }))
      }
    }

    void load()
    return () => { live = false }
  }, [toast])

  return state
}

/**
 * Who the signed-in user may name as a record's Owner — the client half of
 * `ownerOutsideScope()` in `src/app/api/companies/_access.ts`, which is the
 * real gate (a 403 there; this only keeps the form from offering a choice the
 * route refuses).
 *
 * Read from the section's DATA SCOPE on `useMe()`'s permission map, never
 * from a role name:
 *   - `loading` — `me` has not landed. The field is disabled with no reason:
 *     "not known yet" is not "not allowed".
 *   - `self`    — `own` scope, or no scope on the wire. The field is locked
 *     to the user, with the reason as helper text.
 *   - `any`     — `team` or `all` scope. The full picker; the route still
 *     refuses a team-scope owner outside the team.
 */
export type OwnerChoice =
  | { state: 'loading' }
  | { state: 'self'; userId: string; message: string }
  | { state: 'any' }

export function useOwnerChoice(section: 'companies' | 'contacts'): OwnerChoice {
  const me = useMe()
  if (!me) return { state: 'loading' }
  // `scope` is getDataScope()'s answer, carried by `/api/auth/me`.
  // Only an explicit wider scope opens the picker; a missing one (a section
  // with no entry, or a response from before `scope` existed) locks to self,
  // the safe side — the route's 403 is the real gate either way.
  const scope = me.permissions[section]?.scope
  if (scope === 'team' || scope === 'all') return { state: 'any' }
  const noun = section === 'companies' ? 'accounts' : 'contacts'
  return {
    state: 'self',
    userId: me.userId,
    message: `You can only assign ${noun} to yourself.`,
  }
}

/**
 * Talukas of a district and villages of a taluka, fetched when something on
 * screen first needs them and remembered for the life of the component.
 * `wanted` is the districts and talukas currently chosen (one pair per address
 * card); the lookups return `[]` until the list has arrived.
 */
export function useLocationLists(wanted: { district_id: string; taluka_id: string }[]) {
  const [talukas, setTalukas] = useState<Record<string, TalukaRef[]>>({})
  const [villages, setVillages] = useState<Record<string, VillageRef[]>>({})
  const asked = useRef(new Set<string>())

  const districtKey = wanted.map(w => w.district_id).filter(Boolean).join(',')
  const talukaKey = wanted.map(w => w.taluka_id).filter(Boolean).join(',')

  useEffect(() => {
    for (const id of new Set(districtKey ? districtKey.split(',') : [])) {
      const k = `d:${id}`
      if (asked.current.has(k)) continue
      asked.current.add(k)
      getList<TalukaRef>(`/api/masters/talukas?districtId=${encodeURIComponent(id)}`)
        .then(rows => setTalukas(m => ({ ...m, [id]: rows })))
        .catch(() => { asked.current.delete(k) })
    }
  }, [districtKey])

  useEffect(() => {
    for (const id of new Set(talukaKey ? talukaKey.split(',') : [])) {
      const k = `t:${id}`
      if (asked.current.has(k)) continue
      asked.current.add(k)
      getList<VillageRef>(`/api/masters/villages?talukaId=${encodeURIComponent(id)}`)
        .then(rows => setVillages(m => ({ ...m, [id]: rows })))
        .catch(() => { asked.current.delete(k) })
    }
  }, [talukaKey])

  return {
    talukasOf: (districtId: string): TalukaRef[] => talukas[districtId] ?? [],
    villagesOf: (talukaId: string): VillageRef[] => villages[talukaId] ?? [],
  }
}
