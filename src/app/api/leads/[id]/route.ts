/**
 * DEPRECATED ALIAS — see `src/app/api/leads/route.ts`. Delete with P1-T13.
 *
 * GET is new here too: the old `/api/leads/[id]` exported only PUT and DELETE.
 */
export { GET, PUT, DELETE } from '../../companies/[id]/_handlers'

export const dynamic = 'force-dynamic'
