/**
 * DEPRECATED ALIAS — `/api/leads` is `/api/companies`.
 *
 * P1-T10 moved the implementation to `src/app/api/companies/`. This file stays
 * until P1-T13 converts `src/app/(protected)/leads/page.tsx` into the Parties
 * page: that screen is the only caller left, it belongs to a different task,
 * and deleting these routes now would 500 it.
 *
 * It re-exports the handlers rather than duplicating them, so there is exactly
 * one implementation and one permission check — `'companies'`, not `'leads'`.
 * Delete this directory with P1-T13.
 */
export { GET, POST } from '../companies/_handlers'

export const dynamic = 'force-dynamic'
