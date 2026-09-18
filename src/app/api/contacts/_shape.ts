import { prisma } from '@/lib/db'

/**
 * Shared shaping for the Contacts routes. Not a route — `route.ts` is the only
 * filename Next.js treats as one and it is type-checked against a fixed set of
 * allowed exports, so the helpers the list and the detail handler both need live
 * here. Mirrors `../companies/_shape.ts`.
 */

/**
 * ⚠️ `company_contacts`' relation to `companies` is still called
 * `business_partners` — the TABLE was renamed at commit `a1d43e0`, the Prisma
 * relation FIELD was not. `prisma db pull` regenerates that name from the FK,
 * so renaming it here would be undone by the next sync. `shapeContact()`
 * translates it at the edge instead.
 *
 * `users` is the contact's OWNER (`owner_user_id`). `contacts` has exactly one
 * FK to `users`, so Prisma does not disambiguate it the way it does on
 * `companies` — the field is the plain model name.
 */
export const CONTACT_INCLUDE = {
  contact_types: { select: { id: true, name: true } },
  users: { select: { id: true, name: true } },
  company_contacts: {
    select: {
      id: true,
      is_primary: true,
      business_partners: { select: { id: true, name: true, type: true, stage: true } },
    },
  },
} as const

type ContactLink = {
  id: string
  is_primary: boolean
  business_partners: Record<string, unknown> | null
}

/**
 * Flatten the join rows into a `companies` array and rename `users` to `owner`.
 *
 * **A Contact belongs to MANY Companies (REBUILD-PLAN.md §3.4)** — this key is
 * always an array, even when it holds one element, and the Contact page (§3.2)
 * renders all of them. `is_primary` is a property of the LINK, not of the
 * person, so it is folded into each entry along with `link_id`, exactly as
 * `/api/companies/[id]` does in the other direction.
 *
 * Run this AFTER serialize(), never before: serialize() walks relations by their
 * Prisma field names to find the nested models, so renaming first would leave
 * `birthday`/`anniversary` and the embeds' own values unconverted.
 */
export function shapeContact(row: Record<string, unknown>): Record<string, unknown> {
  const { company_contacts, users, ...rest } = row as Record<string, unknown> & {
    company_contacts?: ContactLink[]
    users?: Record<string, unknown> | null
  }

  const links = company_contacts ?? []
  return {
    ...rest,
    owner: users ?? null,
    // Primary first, then alphabetical. Sorted here rather than in the query
    // because an `orderBy` inside a shared `as const` include is a readonly
    // tuple, which Prisma's generated argument types reject.
    companies: links
      .map((cc): Record<string, unknown> => ({
        ...(cc.business_partners ?? {}),
        is_primary: cc.is_primary,
        link_id: cc.id,
      }))
      .sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
        return String(a.name ?? '').localeCompare(String(b.name ?? ''))
      }),
  }
}

/**
 * Resolve the `company_ids` a write supplied: confirm every one is a company in
 * THIS tenant, and hand back their owners so POST can apply §3.4's default.
 *
 * Returns an error MESSAGE when the list is unusable, so the caller answers the
 * single-string 400 every other route answers.
 */
export function readCompanyIds(value: unknown): { ids: string[] } | { error: string } {
  if (value === undefined || value === null) return { ids: [] }
  if (!Array.isArray(value)) return { error: 'company_ids must be an array of company ids' }

  const ids: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.trim() === '')
      return { error: 'company_ids must be an array of company ids' }
    const id = raw.trim()
    // The same company twice would violate company_contacts' UNIQUE
    // (company_id, contact_id) and surface as a 500; de-duplicate instead.
    if (!ids.includes(id)) ids.push(id)
  }
  return { ids }
}

/**
 * The companies behind those ids, **scoped to this tenant**, or an error message
 * when one of them is not a company this tenant can see.
 *
 * This check is not cosmetic: `company_contacts.company_id` has no tenant
 * predicate of its own, so without it a caller could link one of their contacts
 * to another tenant's company by posting its id, and the row would be accepted.
 * A short list is returned with each company's `owner_user_id` because §3.4's
 * "Owner defaults to the Company's Owner" needs it.
 */
export async function loadCompanies(
  ids: string[],
  tenantId: string
): Promise<{ companies: { id: string; owner_user_id: string | null }[] } | { error: string }> {
  if (ids.length === 0) return { companies: [] }

  const companies = await prisma.companies.findMany({
    where: { id: { in: ids }, tenant_id: tenantId },
    select: { id: true, owner_user_id: true },
  })
  if (companies.length !== ids.length)
    return { error: 'One or more of the companies selected could not be found' }

  return { companies }
}
