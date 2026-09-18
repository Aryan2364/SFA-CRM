import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * Reason for Loss master (§4.9, P2-T3).
 *
 * User-defined values, read by the close-a-Deal form — `POST
 * /api/deals/[id]/close` refuses a `lost` outcome without one.
 */

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (the close dialog needs
  // it). Managing the master still requires create/edit permission below.
  await requireUser()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  try {
    const data = await prisma.reason_for_loss.findMany({
      where: {
        tenant_id: getTenantId(),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'reason_for_loss'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'reason_for_loss', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.reason_for_loss.create({
      data: { tenant_id: getTenantId(), name: name.trim(), sort_order: sort_order ?? 0 },
    })
    return NextResponse.json(serialize(data, 'reason_for_loss'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
