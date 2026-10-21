import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'
import { isSummaryContext } from '../remarks/_context'
import { contextLabel } from './_labels'
import { groupKey, resolveSummaryAddresses } from './_summary-address'
import { resolveOwners, visibleGroupKeys } from './_scope'

/**
 * The paged form of `GET /api/conversations` (`?page=&limit=`).
 *
 * The unpaged route downloads every remark in the tenant and groups it in JS.
 * This does the grouping, the unread count and the "latest remark" in SQL, so
 * what reaches Node is one small row per THREAD, and only the page's rows are
 * built into the response. The rules are the unpaged route's, unchanged:
 *
 *   - tenant-scoped on every statement;
 *   - a thread is listed only if `visibleGroupKeys` says the caller may reach
 *     the record it hangs on (the same function, run over the candidate
 *     threads before any are counted or paged - a thread the caller may not
 *     see is absent from `total` as well as from the page);
 *   - `?userId=` narrows to remarks BY that author (count and unread then
 *     cover only those remarks), as before;
 *   - unread = remarks the caller has no `remark_reads` row for.
 *
 * The screen's search, which used to run in the browser over the section label,
 * the person, the last author and the last message, runs here over the same
 * four things.
 */

const SECTION_TYPES: Record<string, string[]> = {
  meeting: ['meeting'],
  expense: ['expense'],
  weekly_plan: ['weekly_plan_day', 'weekly_plan'],
  summary: ['daily_summary', 'weekly_summary'],
}

type GroupRow = {
  context_type: string
  context_id: string
  count: number
  unread: number
  updated_at: Date
}

type LastRow = {
  context_type: string
  context_id: string
  last_remark: string
  last_body: string
  last_author: string | null
}

export async function pagedConversations(
  user: SessionUser,
  tenantId: string,
  opts: {
    section: string
    authorId: string
    status: string
    q: string
    page: number
    limit: number
  }
) {
  const types = opts.section ? (SECTION_TYPES[opts.section] ?? [opts.section]) : null
  const authorCond = opts.authorId ? Prisma.sql`AND r.author_user_id = ${opts.authorId}::uuid` : Prisma.empty
  const typeCond = types ? Prisma.sql`AND r.context_type = ANY(${types}::text[])` : Prisma.empty
  const readUserCond = user.userId ? Prisma.sql`AND rr.user_id = ${user.userId}::uuid` : Prisma.empty

  // One row per thread: remark count, unread count and newest remark time.
  const groupRows = await prisma.$queryRaw<GroupRow[]>(Prisma.sql`
    SELECT r.context_type, r.context_id::text AS context_id,
           count(*)::int AS count,
           (count(*) FILTER (WHERE rr.remark_id IS NULL))::int AS unread,
           max(r.created_at) AS updated_at
      FROM contextual_remarks r
      LEFT JOIN remark_reads rr
             ON rr.remark_id = r.id AND rr.tenant_id = r.tenant_id ${readUserCond}
     WHERE r.tenant_id = ${tenantId}::uuid ${authorCond} ${typeCond}
     GROUP BY r.context_type, r.context_id
  `)

  const groups = groupRows.map(g => ({
    context_type: g.context_type,
    context_id: g.context_id,
    count: g.count,
    unread_count: g.unread,
    updated_at: g.updated_at.toISOString(),
  }))

  // Authorisation, exactly as the unpaged route: owners first (a summary's
  // owner is recovered from its derived id), then the per-section filter.
  const summaryAddresses = await resolveSummaryAddresses(
    tenantId,
    groups.filter(g => isSummaryContext(g.context_type))
  )
  const owners = await resolveOwners(tenantId, groups, summaryAddresses)
  const visible = await visibleGroupKeys(user, groups, owners)

  let list = groups.filter(g => visible.has(groupKey(g.context_type, g.context_id)))
  if (opts.status === 'unread') list = list.filter(g => g.unread_count > 0)
  else if (opts.status === 'read') list = list.filter(g => g.unread_count === 0)

  // Newest first, ties broken on the key so pages never overlap or repeat.
  const byNewest = (a: { updated_at: string; context_type: string; context_id: string }, b: typeof a) =>
    b.updated_at.localeCompare(a.updated_at) ||
    groupKey(a.context_type, a.context_id).localeCompare(groupKey(b.context_type, b.context_id))

  const lastOf = new Map<string, LastRow>()
  const fetchLast = async (pairs: { context_type: string; context_id: string }[]) => {
    if (pairs.length === 0) return
    const values = Prisma.join(pairs.map(p => Prisma.sql`(${p.context_type}, ${p.context_id}::uuid)`))
    const rows = await prisma.$queryRaw<LastRow[]>(Prisma.sql`
      SELECT DISTINCT ON (r.context_type, r.context_id)
             r.context_type, r.context_id::text AS context_id,
             r.id::text AS last_remark, r.body AS last_body, u.name AS last_author
        FROM contextual_remarks r
        LEFT JOIN users u ON u.id = r.author_user_id AND u.tenant_id = r.tenant_id
       WHERE r.tenant_id = ${tenantId}::uuid ${authorCond}
         AND (r.context_type, r.context_id) IN (${values})
       ORDER BY r.context_type, r.context_id, r.created_at DESC, r.id
    `)
    for (const r of rows) lastOf.set(groupKey(r.context_type, r.context_id), r)
  }

  const needle = opts.q.trim().toLowerCase()
  if (needle) {
    // Searching reads the last message and author of every candidate thread,
    // in chunks (bound parameters are capped per statement).
    for (let i = 0; i < list.length; i += 5000) await fetchLast(list.slice(i, i + 5000))
    list = list.filter(g => {
      const key = groupKey(g.context_type, g.context_id)
      const last = lastOf.get(key)
      return (
        contextLabel(g.context_type).toLowerCase().includes(needle) ||
        (summaryAddresses.get(key)?.userName ?? '').toLowerCase().includes(needle) ||
        (last?.last_author ?? '').toLowerCase().includes(needle) ||
        (last?.last_body ?? '').toLowerCase().includes(needle)
      )
    })
  }

  list.sort(byNewest)
  const total = list.length
  const pageGroups = list.slice((opts.page - 1) * opts.limit, opts.page * opts.limit)
  await fetchLast(pageGroups.filter(g => !lastOf.has(groupKey(g.context_type, g.context_id))))

  const rows = pageGroups.map(g => {
    const key = groupKey(g.context_type, g.context_id)
    const address = summaryAddresses.get(key) ?? null
    const last = lastOf.get(key)
    return {
      context_type: g.context_type,
      context_id: g.context_id,
      last_remark: last?.last_remark ?? '',
      last_body: last?.last_body ?? '',
      last_author: last?.last_author ?? '',
      count: g.count,
      updated_at: g.updated_at,
      context_label: contextLabel(g.context_type),
      unread_count: g.unread_count,
      context_user_id: address?.userId ?? owners.get(key) ?? null,
      is_own: (owners.get(key) ?? null) === (user.userId ?? null),
      context_user_name: address?.userName ?? null,
      context_period: address?.period ?? null,
    }
  })

  return { rows, total, page: opts.page, limit: opts.limit }
}
