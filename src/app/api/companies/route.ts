/**
 * `GET /api/companies` (list) and `POST /api/companies` (create).
 *
 * The implementation is in `_handlers.ts`, not here, because `/api/leads`
 * serves the same two handlers while the old Leads screen is alive (P1-T13
 * retires it). A `route.ts` must not be imported by another `route.ts` — Next
 * compiles each one as its own server entry — so the shared code lives in a
 * plain module and both routes re-export from it.
 */
export { GET, POST } from './_handlers'

export const dynamic = 'force-dynamic'
