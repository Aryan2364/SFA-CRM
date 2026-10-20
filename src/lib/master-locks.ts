import type { Me } from '@/hooks/useMe'

/**
 * Section 26: an action the user may not perform is shown disabled with a
 * reason, never hidden. Per action: absent → allowed; `null` → not known yet
 * (permissions still loading: disabled, no reason); a string → denied, and the
 * string is the tooltip. The Active toggle and drag-reorder follow `edit`.
 */
export type CrudLocks = { add?: string | null; edit?: string | null; delete?: string | null }

/**
 * Locks for a master screen, read from the real permission map — never a role
 * name. /api/auth/me returns every section true for an Administrator, so they
 * keep every action without the role being named here.
 *
 * `addAction` is whichever action the master's POST route checks: some ask
 * `create`, older ones ask `edit`.
 */
export function masterLocks(
  me: Me | null, section: string, noun: string, addAction: 'create' | 'edit' = 'edit',
): CrudLocks {
  const p = me?.permissions?.[section]
  const lock = (ok: boolean | undefined, reason: string) => (me == null ? null : ok ? undefined : reason)
  return {
    add: addAction === 'create'
      ? lock(p?.create ?? p?.edit, `Only someone who can create ${noun} can add one.`)
      : lock(p?.edit, `Only someone who can edit ${noun} can add one.`),
    edit: lock(p?.edit, `Only someone who can edit ${noun} can change them.`),
    delete: lock(p?.delete, `Only someone who can delete ${noun} can remove them.`),
  }
}
