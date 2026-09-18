import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { parseConfig, normaliseName, type SavedReportConfig } from '../config'

export const dynamic = 'force-dynamic'

/**
 * /api/reports/saved/[id] — rename, overwrite, or delete one saved report.
 *
 * ⚠️ EVERY query carries `tenant_id` AND `user_id`. See the sibling route for
 * why owner-only is the rule and not a default that a manager may widen.
 *
 * A row belonging to someone else answers 404, not 403. A 403 would confirm
 * that a report with that id exists and belongs to another person, which is
 * exactly the fact owner-scoping is there to withhold. To this caller the row
 * genuinely does not exist.
 */

const SELECT = {
  id: true,
  name: true,
  config: true,
  created_at: true,
  updated_at: true,
} as const

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function notFound() {
  return NextResponse.json({ error: 'That saved report no longer exists.' }, { status: 404 })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser()
    if (!user.userId) return unauthorized()
    const tenantId = getTenantId()
    // Prisma throws a P2023 on a malformed UUID rather than returning nothing,
    // which would surface as a 500 for what is only a bad id.
    if (!UUID.test(params.id)) return notFound()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body must be a saved report' }, { status: 400 })
    }
    const input = body as Record<string, unknown>

    const existing = await prisma.saved_reports.findFirst({
      where: { id: params.id, tenant_id: tenantId, user_id: user.userId },
      select: { id: true },
    })
    if (!existing) return notFound()

    const data: { updated_at: Date; name?: string; config?: SavedReportConfig } = {
      updated_at: new Date(),
    }

    if (input.name !== undefined) {
      const named = normaliseName(input.name)
      if ('error' in named) return NextResponse.json({ error: named.error }, { status: 400 })
      const clash = await prisma.saved_reports.findFirst({
        where: {
          tenant_id: tenantId,
          user_id: user.userId,
          name: { equals: named.name, mode: 'insensitive' },
          NOT: { id: params.id },
        },
        select: { id: true },
      })
      if (clash) {
        return NextResponse.json(
          { error: 'You already have a saved report with that name.' },
          { status: 409 }
        )
      }
      data.name = named.name
    }

    if (input.config !== undefined) {
      const parsed = parseConfig(input.config)
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      data.config = parsed.config
    }

    if (data.name === undefined && data.config === undefined) {
      return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
    }

    const row = await prisma.saved_reports.update({
      // The owner predicate is repeated here even though the read above
      // established it: a check-then-act pair is two statements, and the one
      // that WRITES is the one that has to carry the filter.
      where: { id: params.id, tenant_id: tenantId, user_id: user.userId },
      data,
      select: SELECT,
    })

    return NextResponse.json(serialize(row, 'saved_reports'))
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser()
    if (!user.userId) return unauthorized()
    const tenantId = getTenantId()
    if (!UUID.test(params.id)) return notFound()

    // deleteMany, not delete: `delete` takes a unique where, which here is the
    // id alone — the owner predicate would have to be a separate read first,
    // and a check-then-delete is a race. deleteMany takes the whole predicate
    // in the statement, so a row that is not this caller's deletes nothing.
    const result = await prisma.saved_reports.deleteMany({
      where: { id: params.id, tenant_id: tenantId, user_id: user.userId },
    })
    if (result.count === 0) return notFound()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
