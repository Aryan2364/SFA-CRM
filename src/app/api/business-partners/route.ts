import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Lightweight endpoint for meeting modal entity lookup
// GET /api/business-partners?type=Dealer&status=existing|lead
export async function GET(req: NextRequest) {
  await requireUser()
  const type   = req.nextUrl.searchParams.get('type') ?? ''
  const status = req.nextUrl.searchParams.get('status') ?? 'existing'
  try {
    const data = await prisma.companies.findMany({
      where: {
        tenant_id: getTenantId(),
        is_active: true,
        ...(type ? { type } : {}),
        // .neq('stage', 'Existing') -> { not: 'Existing' }
        stage: status === 'lead' ? { not: 'Existing' } : 'Existing',
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    // Ids and names only — nothing to serialise.
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
