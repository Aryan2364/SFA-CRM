/**
 * Shared shaping for the Companies routes. Not a route — `route.ts` is the only
 * filename Next.js treats as one, and a `route.ts` is type-checked against a
 * fixed set of allowed exports, so helpers shared by the list and the detail
 * handler live here instead.
 */

/**
 * ⚠️ `companies` has TWO foreign keys to `users` — `created_by_user_id` and
 * `owner_user_id` — so Prisma disambiguates both relations by their @relation
 * name rather than by the model name. `shapeCompany()` renames them to the keys
 * the client reads.
 */
export const COMPANY_INCLUDE = {
  districts: { select: { name: true } },
  talukas: { select: { name: true } },
  villages: { select: { name: true } },
  industries: { select: { id: true, name: true } },
  users_companies_created_by_user_idTousers: { select: { id: true, name: true } },
  users_companies_owner_user_idTousers: { select: { id: true, name: true } },
} as const

/**
 * Rename the two aliased user embeds to `created_by` / `owner`.
 *
 * `created_by` is not new — the old `/api/leads` list aliased
 * `created_by:created_by_user_id(id, name)` and the client still reads that key,
 * so it is preserved exactly. `owner` is the addition.
 *
 * Run this AFTER serialize(), never before: serialize() walks relations by their
 * Prisma field names to find the nested models, so renaming first would leave
 * the embeds' own dates and Decimals unconverted.
 */
export function shapeCompany(row: Record<string, unknown>): Record<string, unknown> {
  const {
    users_companies_created_by_user_idTousers: createdBy,
    users_companies_owner_user_idTousers: owner,
    ...rest
  } = row
  return { ...rest, created_by: createdBy ?? null, owner: owner ?? null }
}
