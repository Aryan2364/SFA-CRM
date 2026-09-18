import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { denySummaryThreadViolation, resolveRemarkContext } from './_access'
import { isSummaryContext } from './_context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tenantId = getTenantId()

  /*
   * ⚠️ THIS USED TO RETURN THE THREAD TO ANYONE WHO ASKED.
   *
   * It read contextType/contextId straight out of the query string and
   * answered with every matching row in the tenant. POST checked visibility;
   * GET did not — so any signed-in user holding another person's meeting or
   * expense id could read the remarks on it, a manager's comments about them
   * included. `resolveRemarkContext` now runs the same check on both verbs.
   */
  const ctx = await resolveRemarkContext(user, tenantId, {
    contextType: req.nextUrl.searchParams.get('contextType'),
    contextId: req.nextUrl.searchParams.get('contextId'),
    userId: req.nextUrl.searchParams.get('userId'),
    date: req.nextUrl.searchParams.get('date'),
    style: 'query',
  })
  if (ctx instanceof NextResponse) return ctx

  try {
    // `users!author_user_id(id, name)` arrived under the key `users`, and the
    // introspected relation field is also `users`, so no rename is needed here
    // (unlike conversations, which aliased it to `author`).
    const rows = await prisma.contextual_remarks.findMany({
      where: {
        tenant_id: tenantId,
        context_type: ctx.contextType,
        context_id: ctx.contextId,
      },
      include: { users: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    })

    // Get read status for current user
    const remarkIds = rows.map(r => r.id)
    let readSet = new Set<string>()
    if (remarkIds.length > 0) {
      const reads = await prisma.remark_reads.findMany({
        // tenant_id added, unlike the pre-migration query. Both remark_id and
        // user_id are FK-enforced and the ids come from a tenant-scoped query,
        // so this cannot change results — same precedent as the dealers lookup.
        where: { tenant_id: tenantId, user_id: user.userId ?? undefined, remark_id: { in: remarkIds } },
        select: { remark_id: true },
      })
      readSet = new Set(reads.map(r => r.remark_id))
    }

    const data = serialize(rows, 'contextual_remarks') as Record<string, unknown>[]
    const enriched = data.map(r => ({ ...r, is_read: readSet.has(r.id as string) }))
    /*
     * `context_id` is echoed because for a summary the caller never sent one —
     * it was derived here — and the client needs it to mark a remark read and
     * to reply. It is not a secret: holding it grants nothing, because the
     * summary routes refuse a raw contextId (see `_access.ts`).
     */
    return NextResponse.json(enriched, {
      headers: { 'x-remark-context-id': ctx.contextId },
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const payload = await req.json()
  const { context_type, context_id, user_id, date, parent_remark_id, body } = payload

  if (!body?.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }

  const tenantId = getTenantId()

  /*
   * The same resolution and the same visibility check the GET runs. The four
   * hand-rolled owner lookups that used to live here have moved into
   * `_context.ts` — they were missing `deal` entirely, which meant a deal note
   * was written with no authorisation of any kind, and they had no tenant
   * predicate on the lookup either.
   */
  const ctx = await resolveRemarkContext(user, tenantId, {
    contextType: context_type,
    contextId: context_id,
    userId: user_id,
    date,
    style: 'body',
  })
  if (ctx instanceof NextResponse) return ctx

  // §6.5's one comment and one reply, enforced server-side.
  const violation = await denySummaryThreadViolation(
    user,
    tenantId,
    ctx,
    parent_remark_id ?? null
  )
  if (violation) return violation

  let remark
  try {
    const created = await prisma.contextual_remarks.create({
      data: {
        tenant_id: tenantId,
        context_type: ctx.contextType,
        context_id: ctx.contextId,
        parent_remark_id: parent_remark_id ?? null,
        // author_user_id is NOT NULL while SessionUser.userId is nullable. A null
        // hit the not-null constraint under Supabase and produced a 500; the cast
        // keeps that path identical rather than inventing a new guard. Only a
        // SuperAdmin has a null userId, and middleware already blocks SuperAdmin
        // from tenant routes, so it is unreachable in practice.
        author_user_id: user.userId as string,
        body: body.trim(),
      },
      include: { users: { select: { id: true, name: true } } },
    })
    remark = serialize(created, 'contextual_remarks') as Record<string, unknown>
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }

  /*
   * NOTIFICATION FAN-OUT — for the three ORIGINAL contexts only.
   *
   * ⚠️ §9 item 5 is explicit that a manager comment on a summary carries no
   * approval, no resolved/unresolved status and NO NOTIFICATION CHAIN. The
   * team member sees the comment when they open the summary; nothing chases
   * them. The branches below have no case for `daily_summary` or
   * `weekly_summary`, so nothing would fire anyway — this returns early so
   * that stays true by intent rather than by omission, and so adding a branch
   * later has to get past this line.
   *
   * `deal` is also deliberately absent: §4.4 asks for notes on a deal, not for
   * a notification when one is written.
   */
  if (isSummaryContext(ctx.contextType) || ctx.contextType === 'deal') {
    return NextResponse.json({ ...remark, is_read: false }, { status: 201 })
  }

  // Auto-create notification: find the other party
  // Determine context owner (visit user or expense user) to notify
  try {
    let recipientId: string | null = null
    let redirectPath = ''
    let section: 'meeting' | 'expense' | 'weekly_plan' = 'meeting'
    let message = ''

    if (context_type === 'meeting') {
      const visit = await prisma.daily_visits.findUnique({ where: { id: context_id }, select: { user_id: true, visit_date: true } })
      if (visit && visit.user_id !== user.userId) {
        // Manager commenting on subordinate's meeting → notify subordinate
        recipientId = visit.user_id
        redirectPath = `/daily-activity?date=${visit.visit_date}&remarks=${context_id}`
        section = 'meeting'
        message = `New remark on your meeting from ${user.name}`
      } else if (visit && visit.user_id === user.userId) {
        // Subordinate commenting on own meeting → notify manager, redirect to review page
        const me = await prisma.users.findUnique({ where: { id: user.userId ?? '' }, select: { manager_user_id: true } })
        if (me?.manager_user_id) {
          recipientId = me.manager_user_id
          redirectPath = `/review/${user.userId}?tab=activity&remarks=${context_id}`
          section = 'meeting'
          message = `${user.name} added a remark on their meeting`
        }
      }
    } else if (context_type === 'expense') {
      const expense = await prisma.expenses.findUnique({ where: { id: context_id }, select: { user_id: true, expense_date: true } })
      if (expense && expense.user_id !== user.userId) {
        // Manager commenting on subordinate's expense → notify subordinate
        recipientId = expense.user_id
        redirectPath = `/daily-activity?date=${expense.expense_date}&remarks=${context_id}&tab=expenses`
        section = 'expense'
        message = `New remark on your expense from ${user.name}`
      } else if (expense && expense.user_id === user.userId) {
        // Subordinate commenting on own expense → notify manager, redirect to review page
        const me = await prisma.users.findUnique({ where: { id: user.userId ?? '' }, select: { manager_user_id: true } })
        if (me?.manager_user_id) {
          recipientId = me.manager_user_id
          redirectPath = `/review/${user.userId}?tab=expenses&remarks=${context_id}`
          section = 'expense'
          message = `${user.name} added a remark on their expense`
        }
      }
    } else if (context_type === 'weekly_plan_day') {
      const item = await prisma.weekly_plan_items.findUnique({ where: { id: context_id }, select: { weekly_plan_id: true, plan_date: true } })
      if (item) {
        const plan = await prisma.weekly_plans.findUnique({ where: { id: item.weekly_plan_id }, select: { user_id: true } })
        if (plan && plan.user_id !== user.userId) {
          recipientId = plan.user_id
          redirectPath = `/weekly-plan?remarks=${context_id}`
          section = 'weekly_plan'
          message = `New remark on your weekly plan from ${user.name}`
        } else if (plan && plan.user_id === user.userId) {
          const me = await prisma.users.findUnique({ where: { id: user.userId ?? '' }, select: { manager_user_id: true } })
          if (me?.manager_user_id) {
            recipientId = me.manager_user_id
            redirectPath = `/weekly-plan?remarks=${context_id}`
            section = 'weekly_plan'
            message = `${user.name} added a remark on their weekly plan`
          }
        }
      }
    } else if (context_type === 'weekly_plan') {
      // context_id is the weekly_plan.id
      const plan = await prisma.weekly_plans.findUnique({ where: { id: context_id }, select: { user_id: true, week_start_date: true } })
      if (plan && plan.user_id !== user.userId) {
        // Manager commenting on subordinate's plan → notify subordinate
        recipientId = plan.user_id
        redirectPath = `/weekly-plan`
        section = 'weekly_plan'
        message = `New remark on your weekly plan from ${user.name}`
      } else if (plan && plan.user_id === user.userId) {
        // Subordinate commenting → notify manager
        const me = await prisma.users.findUnique({ where: { id: user.userId ?? '' }, select: { manager_user_id: true } })
        if (me?.manager_user_id) {
          recipientId = me.manager_user_id
          redirectPath = `/review/${user.userId}?tab=plans`
          section = 'weekly_plan'
          message = `${user.name} added a remark on their weekly plan`
        }
      }
    }

    if (recipientId) {
      await prisma.notifications.create({
        data: {
          tenant_id: tenantId,
          recipient_id: recipientId,
          actor_id: user.userId,
          section,
          context_type,
          context_id,
          remark_id: remark.id as string,
          redirect_path: redirectPath,
          message,
        },
      })
    }
  } catch {
    // Notification failure is non-fatal
  }

  return NextResponse.json({ ...remark, is_read: false }, { status: 201 })
}
