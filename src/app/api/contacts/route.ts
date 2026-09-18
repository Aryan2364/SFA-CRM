/**
 * `GET /api/contacts` (list) and `POST /api/contacts` (create).
 *
 * The implementation is in `_handlers.ts` for the same reason `/api/companies`
 * splits: a `route.ts` is type-checked against a fixed set of allowed exports,
 * so anything shared with the `[id]` handlers lives in a plain module beside it.
 */
export { GET, POST } from './_handlers'

export const dynamic = 'force-dynamic'
