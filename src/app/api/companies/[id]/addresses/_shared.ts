import { SessionUser } from '@/lib/auth'
import { checkPincode, firstError, trimmed } from '@/lib/validation'
import { findScopedCompany } from '../../_access'

/**
 * Shared by `addresses/route.ts` and `addresses/[addressId]/route.ts`.
 *
 * Not a route: Next.js type-checks a `route.ts` against a fixed set of allowed
 * exports, so a helper exported from one fails the build. The Companies routes
 * solve this with `_handlers.ts`; this is the same move under a name that says
 * it is shared rather than that it is the implementation.
 */

/** Everything a caller may set. `is_primary` is handled by each verb. */
export type AddressBody = {
  label?: unknown
  address_line?: unknown
  city?: unknown
  state_id?: unknown
  district_id?: unknown
  taluka_id?: unknown
  village_id?: unknown
  pincode?: unknown
  is_primary?: unknown
}

/**
 * The column set both verbs write, validated.
 *
 * `checkPincode` is the same validator `POST /api/companies` runs, so a pincode
 * the company route would reject is rejected here with the same wording — one
 * rule, not two that drift.
 */
export function addressData(
  body: AddressBody
): { data: Record<string, unknown> } | { error: string } {
  const bad = firstError(checkPincode(body.pincode))
  if (bad) return { error: bad }

  return {
    data: {
      label: trimmed(body.label),
      address_line: trimmed(body.address_line),
      city: trimmed(body.city),
      // Empty string → null: a cleared dropdown must not reach a uuid column as
      // '', which throws instead of clearing the field.
      state_id: body.state_id || null,
      district_id: body.district_id || null,
      taluka_id: body.taluka_id || null,
      village_id: body.village_id || null,
      pincode: trimmed(body.pincode),
    },
  }
}

/**
 * The parent company, under the tenant filter AND the caller's companies scope.
 * Null when it is not ours, or not the caller's to see.
 *
 * Every verb calls this before writing: without it an address could be attached
 * to another tenant's company by guessing its id, and nothing would crash. The
 * scope half is the list's own (§6.6) — see `../../_access.ts`.
 */
export async function findCompany(user: SessionUser, companyId: string, tenantId: string) {
  return findScopedCompany(user, tenantId, companyId)
}

/** The location embeds both verbs return, so a saved row renders immediately. */
export const ADDRESS_INCLUDE = {
  states: { select: { id: true, name: true } },
  districts: { select: { id: true, name: true } },
  talukas: { select: { id: true, name: true } },
  villages: { select: { id: true, name: true } },
} as const

/**
 * The primary first, then oldest first.
 *
 * The same order `GET /api/companies/[id]` embeds addresses in, and the same
 * tie-break `recomputeCompanyCompleteness` resolves "the primary" with
 * (`ORDER BY created_at, id LIMIT 1`). Three places agreeing is the point.
 */
export const ADDRESS_ORDER = [
  { is_primary: 'desc' as const },
  { created_at: 'asc' as const },
  { id: 'asc' as const },
]
