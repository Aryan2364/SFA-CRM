import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { isSummaryContext } from '../remarks/_context'
import { contextLabel } from './_labels'
import { resolveSummaryAddresses, groupKey } from './_summary-address'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const params = req.nextUrl.searchParams
  const section = params.get('section') ?? ''
  const filterUserId = params.get('userId') ?? ''
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''
  const status = params.get('status') ?? 'all'

  const tenantId = getTenantId()

  try {
  // `author:users!author_user_id(id, name)` is an ALIASED embed. Fetch through
  // the real relation field and expose it as `author` — the only key this route
  // and the client ever saw.
  const remarkRows = await prisma.contextual_remarks.findMany({
    where: {
      tenant_id: tenantId,
      ...(filterUserId ? { author_user_id: filterUserId } : {}),
    },
    select: {
      id: true, context_type: true, context_id: true, author_user_id: true,
      body: true, created_at: true, updated_at: true,
      users: { select: { id: true, name: true } },
    },
    orderBy: { created_at: 'desc' },
  })

  // created_at is compared with `>` below and fed into localeCompare() at the
  // bottom. Supabase returned ISO strings; Prisma returns Date objects, so
  // normalise ONCE here. Mixing the two would compare a Date against a string
  // and silently order by "Mon Sep 14 2026 ..." (PLAN.md 5.1).
  const remarks = remarkRows.map(r => ({
    ...r,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at ? r.updated_at.toISOString() : null,
    author: r.users,
  }))

  // Group by (context_type, context_id)
  const groups: Record<string, {
    context_type: string
    context_id: string
    last_remark: string
    last_body: string
    last_author: string
    count: number
    updated_at: string
  }> = {}

  for (const r of remarks) {
    const key = `${r.context_type}::${r.context_id}`
    if (!groups[key]) {
      groups[key] = {
        context_type: r.context_type,
        context_id: r.context_id,
        last_remark: r.id,
        last_body: r.body,
        last_author: r.author?.name ?? '',
        count: 1,
        updated_at: r.created_at,
      }
    } else {
      groups[key].count++
      if (r.created_at > groups[key].updated_at) {
        groups[key].updated_at = r.created_at
        groups[key].last_body = r.body
        groups[key].last_author = r.author?.name ?? ''
      }
    }
  }

  // Look up owner user_id for each context (to build correct redirects)
  const contextIds = Object.values(groups).map(g => ({ type: g.context_type, id: g.context_id }))
  const meetingIds = contextIds.filter(c => c.type === 'meeting').map(c => c.id)
  const expenseIds = contextIds.filter(c => c.type === 'expense').map(c => c.id)

  const ownerMap: Record<string, string> = {}
  if (meetingIds.length > 0) {
    const visits = await prisma.daily_visits.findMany({
      where: { tenant_id: tenantId, id: { in: meetingIds } },
      select: { id: true, user_id: true },
    })
    for (const v of visits) ownerMap[v.id] = v.user_id
  }
  if (expenseIds.length > 0) {
    const exps = await prisma.expenses.findMany({
      where: { tenant_id: tenantId, id: { in: expenseIds } },
      select: { id: true, user_id: true },
    })
    for (const e of exps) ownerMap[e.id] = e.user_id
  }

  // Get unread counts per context for current user
  const remarkIds = remarks.map(r => r.id)
  let readSet = new Set<string>()
  if (remarkIds.length > 0) {
    const reads = await prisma.remark_reads.findMany({
      // tenant_id added, unlike the pre-migration query. Both remark_id and
      // user_id are FK-enforced and the ids come from a tenant-scoped query, so
      // this cannot change results — same precedent as the dealers lookup.
      where: { tenant_id: tenantId, user_id: user.userId ?? undefined, remark_id: { in: remarkIds } },
      select: { remark_id: true },
    })
    readSet = new Set(reads.map(r => r.remark_id))
  }

  const unreadByContext: Record<string, number> = {}
  for (const r of remarks) {
    if (!readSet.has(r.id)) {
      const key = `${r.context_type}::${r.context_id}`
      unreadByContext[key] = (unreadByContext[key] ?? 0) + 1
    }
  }

  /*
   * F32. A summary conversation's `context_id` is derived from (kind, owner,
   * period) and cannot be reversed, and `/api/remarks` refuses a raw id for
   * those types — correctly, see `../remarks/_access.ts`. So the row has to
   * carry the owner and the period instead, or the thread it points at can
   * never be opened and the Source link can never land anywhere. Everything
   * else on the row is unchanged.
   */
  const summaryAddresses = await resolveSummaryAddresses(
    tenantId,
    Object.values(groups).filter(g => isSummaryContext(g.context_type))
  )

  let conversations = Object.values(groups).map(g => {
    const key = groupKey(g.context_type, g.context_id)
    const address = summaryAddresses.get(key) ?? null
    return {
      ...g,
      // F29. The human label is decided in ONE place and travels with the row,
      // so no screen has to know what a context key looks like.
      context_label: contextLabel(g.context_type),
      unread_count: unreadByContext[key] ?? 0,
      context_user_id: address?.userId ?? ownerMap[g.context_id] ?? null,
      /* Both null for every non-summary context — those are addressed by id,
         and a client that sees a period knows it must address by person. */
      context_user_name: address?.userName ?? null,
      context_period: address?.period ?? null,
    }
  })

  // Filter by status
  if (status === 'unread') conversations = conversations.filter(c => c.unread_count > 0)
  else if (status === 'read') conversations = conversations.filter(c => c.unread_count === 0)

  // Filter by section
  if (section) {
    const sectionMap: Record<string, string[]> = {
      meeting: ['meeting'],
      expense: ['expense'],
      weekly_plan: ['weekly_plan_day', 'weekly_plan'],
      summary: ['daily_summary', 'weekly_summary'],
    }
    const types = sectionMap[section] ?? [section]
    conversations = conversations.filter(c => types.includes(c.context_type))
  }

  // updated_at is the ISO string normalised above, so localeCompare behaves
  // exactly as before — this is conversations/route.ts:121, PLAN.md 5.1 in its
  // crash form.
  conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  // Every field here is already a string or a number.
  return NextResponse.json(conversations)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
