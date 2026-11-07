/**
 * Default states and districts for a new firm.
 *
 * The lists are data, not code: they live in `default_states` and
 * `default_districts` (docs/local-db-updates.sql items 12 and 13), linked by
 * default_districts.state_id. Neither carries a tenant_id — they are the one
 * template every firm is created from. When SuperAdmin creates a firm, every
 * active row is copied into that firm's own `states` and `districts`, each
 * district under the firm's copy of its state. After that the firm owns its
 * copy and can rename or deactivate rows like any other master; changing the
 * template never touches an existing firm.
 *
 * Read through raw SQL so the copy is one statement per table, and a database
 * without the tables yet seeds nothing, exactly as before.
 */
import { prisma } from '@/lib/db'

/** Copies the default states, then districts, into `tenantId`. */
export async function seedDefaultLocations(tenantId: string): Promise<{ states: number; districts: number }> {
  // Two statements, not one transaction: a database that has item 12 but not
  // item 13 still gets its states.
  const states = await run('states', () => prisma.$executeRaw`
    INSERT INTO states (tenant_id, name)
    SELECT ${tenantId}::uuid, d.name
      FROM default_states d
     WHERE d.is_active
     ORDER BY d.sort_order, d.name`)
  // The firm's states were copied a moment ago under the same names, so the
  // name is the join from a template state to the firm's own copy.
  const districts = states === 0 ? 0 : await run('districts', () => prisma.$executeRaw`
    INSERT INTO districts (tenant_id, state_id, name)
    SELECT ${tenantId}::uuid, s.id, d.name
      FROM default_districts d
      JOIN default_states ds ON ds.id = d.state_id AND ds.is_active
      JOIN states s ON s.tenant_id = ${tenantId}::uuid AND s.name = ds.name
     WHERE d.is_active
     ORDER BY ds.sort_order, d.name`)
  return { states, districts }
}

// A firm without its default locations is still a working firm — the admin can
// add them on the Masters page — so this never fails firm creation.
async function run(what: string, insert: () => Promise<number>): Promise<number> {
  try {
    return await insert()
  } catch (err) {
    console.error(`[default-locations] could not seed ${what} for a new firm:`, (err as Error)?.message ?? err)
    return 0
  }
}
