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

import { useEffect, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'

export type NamedRef = { id: string; name: string }

/** `/api/masters/users` rows, narrowed to what an Owner dropdown needs. */
export type UserRef = NamedRef & { contact: string | null; status: string | null }

/**
 * The location masters are one fetch each and then filtered client-side by
 * parent, exactly as `useBPForm` does — the endpoints take no parent filter, so
 * a per-parent fetch would be the same payload plus a round trip.
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
  talukas: TalukaRef[]
  villages: VillageRef[]
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
  talukas: [],
  villages: [],
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
          states, districts, talukas, villages, users, me,
        ] = await Promise.all([
          // `lead-types` is the Company Type master — P1-T18 renames the route
          // to `company-types`; until it does, this is where the values are.
          getList<NamedRef>('/api/masters/lead-types'),
          getList<NamedRef>('/api/masters/industries'),
          getList<NamedRef>('/api/masters/contact-types'),
          getList<NamedRef>('/api/masters/states'),
          getList<DistrictRef>('/api/masters/districts'),
          getList<TalukaRef>('/api/masters/talukas'),
          getList<VillageRef>('/api/masters/villages'),
          getList<UserRef>('/api/masters/users'),
          fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)),
        ])
        if (!live) return
        setState({
          companyTypes, industries, contactTypes,
          states, districts, talukas, villages,
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
