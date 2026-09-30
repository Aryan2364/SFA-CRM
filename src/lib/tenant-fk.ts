/**
 * Cross-tenant foreign-key guard.
 *
 * Every FK in `prisma/schema.prisma` references a bare primary key
 * (`references: [id]`), never `(tenant_id, id)`. So PostgreSQL accepts a
 * body-supplied id that belongs to ANOTHER tenant, and any `include` on the
 * written row then reads that tenant's data back out through an unscoped
 * `WHERE id IN (...)`. Until the composite FKs land (PLAN.md §8.2), every id
 * taken from a request body must be looked up in the caller's own tenant before
 * it is written.
 *
 * Guard the VALUES, not just the row: a handler that scopes its `where` to the
 * caller's tenant still leaks if it writes a foreign id into the data.
 *
 * Each check supplies its own `find`, so the `tenant_id` predicate is written
 * at the call site — visible to a reader and to `scripts/audit-tenant-scope.mjs`
 * — rather than hidden behind a model-name string here.
 *
 *   const miss = await firstForeignTenantRef([
 *     { value: body.company_id, label: 'Company',
 *       find: id => prisma.companies.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
 *   ])
 *   if (miss) return NextResponse.json({ error: miss }, { status: 400 })
 */

export type TenantFkCheck = {
  /**
   * The raw value from the request body. `undefined`, `null` and `''` are
   * absent and skipped; a UUID string is checked; anything else is refused.
   */
  value: unknown
  /** Plain-language name of the field, used in the error: "<label> not found". */
  label: string
  /** Look the id up IN THE CALLER'S TENANT. Resolve to null when absent. */
  find: (id: string) => Promise<unknown>
}

// Shape only (8-4-4-4-12 hex), not an RFC version check: seeded ids such as
// `0000000d-…-0001` are valid Postgres uuids without being v4.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A body value as an id, or null when it is absent, null, empty or not a UUID string. */
export function asId(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

/**
 * Runs every supplied check in one round-trip and returns the error message for
 * the first id that does not exist in the caller's tenant, in the order given,
 * or null when all supplied ids are the caller's own. Absent ids are skipped.
 *
 * Anything present that is not a UUID string is "<label> is invalid", checked
 * before any lookup. Skipping it instead would be a bypass: Prisma's update
 * inputs accept `{ "set": "<uuid>" }` and write it exactly like a bare id, so
 * a non-string that is not checked here is still written. A UUID with
 * surrounding whitespace is refused too, since the value checked must be the
 * value the route writes.
 */
export async function firstForeignTenantRef(checks: TenantFkCheck[]): Promise<string | null> {
  const present = (v: unknown) => v !== undefined && v !== null && v !== ''
  for (const c of checks) {
    if (present(c.value) && !asId(c.value)) return `${c.label} is invalid`
  }
  const ids = checks.map(c => asId(c.value))
  const found = await Promise.all(checks.map((c, i) => (ids[i] ? c.find(ids[i] as string) : null)))
  for (let i = 0; i < checks.length; i++) {
    if (ids[i] && !found[i]) return `${checks[i].label} not found`
  }
  return null
}
