import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { businessDate } from '@/lib/business-date'
import { firstForeignTenantRef } from '@/lib/tenant-fk'
import { getDealAccessLevel, meets, widenScope, workSharedDealBranches } from '@/lib/sharing'

export const dynamic = 'force-dynamic'

/**
 * "Set next meeting" — GET/PUT/DELETE `/api/daily-activity/[id]/next-meeting`.
 *
 * Reuses two existing fields rather than adding a column:
 *
 *   - linked to an Opportunity:  a `deal_follow_ups` row (mode 'Meeting',
 *     status 'not_done') on that deal.
 *   - no Opportunity:            `companies.next_follow_up_date` on the
 *     meeting's account.
 *
 * `deal_follow_ups` has no column recording "which meeting set this", and the
 * task deliberately rules out a notes marker (a user can edit notes). So
 * Change/Remove re-find the row the same way GET displays it: the OPEN
 * ('not_done'), mode:'Meeting' follow-up on one of the account's OPEN deals,
 * earliest due date first. This is a property of the ACCOUNT, not of this one
 * visit — exactly like `companies.next_follow_up_date` already is — so two
 * meetings against the same account agree on one "next meeting", which is the
 * only sane reading with no marker column. `visit_id` on the row is reserved
 * for "the meeting that fulfilled a follow-up" (see the stop handler) and is
 * never repurposed to mean "the meeting that scheduled it".
 *
 * SHARING (src/lib/sharing.ts): the opportunities offered here are the
 * caller's own Deals scope PLUS those they may WORK through sharing — every
 * open deal of this account when the account is shared with them at 'work',
 * and any deal shared with them directly at 'work'. A 'view' share is not
 * offered: linking writes a `deal_follow_ups` row. With nothing shared the
 * list is the plain scope, as before. The reminders and Missed counts built
 * from these rows elsewhere stay OWNER-based and are not widened by this.
 */

/** This account's open deals the caller may link a next meeting to. */
async function linkableDealWhere(
  tid: string,
  companyId: string,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  return {
    tenant_id: tid,
    company_id: companyId,
    is_active: true,
    closed_at: null,
    ...widenScope(
      scopeWhere(await scopedUserIds(user, 'deals'), 'owner_user_id'),
      await workSharedDealBranches(user, tid, companyId)
    ),
  }
}

async function reachableVisit(tid: string, visitId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  return prisma.daily_visits.findFirst({
    where: {
      id: visitId,
      tenant_id: tid,
      ...scopeWhere(await scopedUserIds(user, 'meetings')),
    },
    select: { id: true, entity_id: true },
  })
}

/** The account's current managed "next meeting", however it is stored. */
async function currentNextMeeting(tid: string, companyId: string, dealIds: string[]) {
  const followUp = dealIds.length
    ? await prisma.deal_follow_ups.findFirst({
        where: { tenant_id: tid, deal_id: { in: dealIds }, mode: 'Meeting', status: 'not_done' },
        orderBy: [{ due_date: 'asc' }, { created_at: 'desc' }],
        select: { id: true, deal_id: true, due_date: true },
      })
    : null
  if (followUp) return { source: 'deal' as const, follow_up_id: followUp.id, deal_id: followUp.deal_id, due_date: followUp.due_date }

  const company = await prisma.companies.findFirst({
    where: { id: companyId, tenant_id: tid },
    select: { next_follow_up_date: true },
  })
  if (company?.next_follow_up_date) return { source: 'company' as const, due_date: company.next_follow_up_date }

  return null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const visit = await reachableVisit(tid, params.id, user)
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!visit.entity_id) {
      return NextResponse.json({ account_required: true, next_meeting: null, open_deals: [] })
    }

    const canViewDeals = await checkPermission(user, 'deals', 'view')
    const openDeals = canViewDeals
      ? await prisma.deals.findMany({
          where: await linkableDealWhere(tid, visit.entity_id, user),
          select: { id: true, name: true },
          orderBy: { created_at: 'desc' },
        })
      : []

    const current = await currentNextMeeting(tid, visit.entity_id, openDeals.map(d => d.id))
    let dealName: string | null = null
    if (current?.source === 'deal') {
      dealName = openDeals.find(d => d.id === current.deal_id)?.name
        ?? (await prisma.deals.findFirst({ where: { id: current.deal_id, tenant_id: tid }, select: { name: true } }))?.name
        ?? null
    }

    return NextResponse.json({
      account_required: false,
      open_deals: serialize(openDeals, 'deals'),
      next_meeting: current
        ? {
            source: current.source,
            due_date: dateOnlyString(current.due_date),
            deal_id: current.source === 'deal' ? current.deal_id : null,
            deal_name: dealName,
          }
        : null,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'edit')) return forbidden()
  const tid = getTenantId()

  const { due_date, deal_id } = await req.json()
  if (!due_date) return NextResponse.json({ error: 'A date is required' }, { status: 400 })
  // @db.Date columns compare as "YYYY-MM-DD" strings; businessDate() is the
  // server's own IST-aware "today", never the process clock.
  const todayStr = businessDate()
  const dueDateStr = String(due_date).slice(0, 10)
  if (dueDateStr < todayStr) {
    return NextResponse.json({ error: 'The next meeting must be today or later' }, { status: 400 })
  }

  try {
    const visit = await reachableVisit(tid, params.id, user)
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!visit.entity_id) {
      return NextResponse.json({ error: 'This meeting has no account to attach a next meeting to' }, { status: 400 })
    }
    const companyId = visit.entity_id

    const miss = await firstForeignTenantRef([
      { value: deal_id, label: 'Opportunity',
        find: id => prisma.deals.findFirst({ where: { id, tenant_id: tid, company_id: companyId }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    const canViewDeals = await checkPermission(user, 'deals', 'view')
    const openDealIds = canViewDeals
      ? (await prisma.deals.findMany({
          where: await linkableDealWhere(tid, companyId, user),
          select: { id: true },
        })).map(d => d.id)
      : []

    const existing = await currentNextMeeting(tid, companyId, openDealIds)

    if (deal_id) {
      // Linking to an Opportunity writes `deal_follow_ups`, gated exactly like
      // the existing follow-ups POST route.
      if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
      if (!openDealIds.includes(deal_id)) {
        return NextResponse.json({ error: 'That opportunity is not open on this account' }, { status: 400 })
      }
      // The central rule, checked for the one deal being written: owner-scope,
      // or a 'work' member of the deal or its account (src/lib/sharing.ts).
      if (!meets(await getDealAccessLevel(user, tid, deal_id), 'write')) {
        return NextResponse.json({ error: 'That opportunity is not open on this account' }, { status: 400 })
      }

      // Switching FROM the company field TO an opportunity: clear the old
      // representation so the account carries exactly one "next meeting".
      if (existing?.source === 'company') {
        await prisma.companies.update({ where: { id: companyId, tenant_id: tid }, data: { next_follow_up_date: null } })
      }

      const dueDate = new Date(dueDateStr)
      if (existing?.source === 'deal' && existing.deal_id === deal_id) {
        await prisma.deal_follow_ups.update({
          where: { id: existing.follow_up_id, tenant_id: tid },
          data: { due_date: dueDate, updated_at: new Date() },
        })
      } else {
        // Moving to a different deal (or no prior row): drop any stale row on
        // another open deal first, so only one "next meeting" exists at once.
        if (existing?.source === 'deal') {
          await prisma.deal_follow_ups.deleteMany({ where: { id: existing.follow_up_id, tenant_id: tid } })
        }
        await prisma.deal_follow_ups.create({
          data: {
            tenant_id: tid, deal_id, due_date: dueDate, mode: 'Meeting', status: 'not_done',
          },
        })
      }
    } else {
      // No Opportunity: `companies.next_follow_up_date`, gated like the
      // companies PUT route.
      if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
      if (existing?.source === 'deal') {
        await prisma.deal_follow_ups.deleteMany({ where: { id: existing.follow_up_id, tenant_id: tid } })
      }
      await prisma.companies.update({
        where: { id: companyId, tenant_id: tid },
        data: { next_follow_up_date: new Date(dueDateStr) },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'edit')) return forbidden()
  const tid = getTenantId()

  try {
    const visit = await reachableVisit(tid, params.id, user)
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!visit.entity_id) return NextResponse.json({ ok: true })
    const companyId = visit.entity_id

    const canViewDeals = await checkPermission(user, 'deals', 'view')
    const openDealIds = canViewDeals
      ? (await prisma.deals.findMany({
          where: { tenant_id: tid, company_id: companyId, is_active: true, closed_at: null },
          select: { id: true },
        })).map(d => d.id)
      : []
    const existing = await currentNextMeeting(tid, companyId, openDealIds)
    if (!existing) return NextResponse.json({ ok: true })

    if (existing.source === 'deal') {
      if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
      await prisma.deal_follow_ups.deleteMany({ where: { id: existing.follow_up_id, tenant_id: tid } })
    } else {
      if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
      await prisma.companies.update({ where: { id: companyId, tenant_id: tid }, data: { next_follow_up_date: null } })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
