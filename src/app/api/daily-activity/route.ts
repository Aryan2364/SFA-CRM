import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint } from '@/lib/points'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  // `meetings` exists in role_permissions and drives nav visibility, but no
  // route enforced it before P4-T1. A scope filter without a permission check
  // is half a fix.
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  // Was hard-wired `user_id: user.userId` — Self for everyone, so a Team-scoped
  // manager could not see their team at all.
  const ids = intersectScope(
    await scopedUserIds(user, 'meetings'),
    req.nextUrl.searchParams.get('userId')
  )
  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        // visit_date is @db.Date.
        visit_date: new Date(date),
      },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json(serialize(data, 'daily_visits'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const { visit_type, entity_id, entity_name, is_new_entity, visit_date, new_prospect } = await req.json()
  if (!visit_type) return NextResponse.json({ error: 'visit_type is required' }, { status: 400 })
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const effectiveDate = visit_date ?? todayStr
  if (effectiveDate > todayStr) return NextResponse.json({ error: 'Cannot create meetings for future dates' }, { status: 400 })
  const tid = getTenantId()
  const visitDate = new Date(effectiveDate)

  try {
    // New Prospect mode: create business_partner first, then link visit
    if (new_prospect) {
      if (!new_prospect.name?.trim()) return NextResponse.json({ error: 'Prospect name is required' }, { status: 400 })
      const bp = await prisma.companies.create({
        data: {
          tenant_id: tid,
          type: visit_type,
          stage: 'Prospect',
          name: new_prospect.name.trim(),
          mobile_1: new_prospect.mobile_1?.trim() || null,
          state_id: new_prospect.state_id || null,
          district_id: new_prospect.district_id || null,
          taluka_id: new_prospect.taluka_id || null,
          village_id: new_prospect.village_id || null,
          created_by_user_id: user.userId || null,
        },
      })
      const data = await prisma.daily_visits.create({
        data: {
          tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
          visit_type, entity_id: bp.id, entity_name: bp.name, is_new_entity: true, status: 'Pending',
        },
      })
      void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${bp.name} on ${effectiveDate}` })
      return NextResponse.json(serialize(data, 'daily_visits'), { status: 201 })
    }

    if (!entity_name?.trim()) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 })
    const data = await prisma.daily_visits.create({
      data: {
        tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
        visit_type, entity_id: entity_id || null, entity_name: entity_name.trim(),
        is_new_entity: is_new_entity ?? false, status: 'Pending',
      },
    })
    void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${entity_name.trim()} on ${effectiveDate}` })
    return NextResponse.json(serialize(data, 'daily_visits'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
