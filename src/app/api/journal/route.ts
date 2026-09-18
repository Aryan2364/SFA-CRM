import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { mondayOf } from '@/lib/weekly-review'

export const dynamic = 'force-dynamic'

/**
 * Journaling — §6.3, P4-T5.
 *
 * A journal entry is personal: it belongs to the user who wrote it, full
 * stop. Every route here scopes strictly to `requireUser().userId` — there is
 * no `?userId=` parameter anywhere in this file, unlike every other review
 * endpoint. Being able to see someone's weekly numbers (Team/Company scope)
 * says nothing about being allowed to read their private reflection on the
 * week, and that includes the Administrator and the person's manager. If a
 * future change wants manager/admin visibility into journals, that is a new
 * decision requiring an explicit, separate permission check — not something
 * this file defaults into by reusing `scopedUserIds`.
 *
 * One entry per (tenant, user, week, kind): `kind` is 'went_well' or
 * 'improve', matching the two boxes on Weekly Review. GET returns both (or
 * one, filtered by history) for a week; POST upserts one box's text so
 * editing never creates a second row for the same week.
 *
 * Week boundary: `mondayOf()` imported from `weekly-review.ts` so a journal
 * entry and the review it sits beside never disagree about which week they
 * are in.
 */

const KINDS = ['went_well', 'improve'] as const
type Kind = (typeof KINDS)[number]

function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v)
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const weekStartParam = req.nextUrl.searchParams.get('weekStart') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam) || Number.isNaN(Date.parse(`${weekStartParam}T00:00:00.000Z`))) {
    return NextResponse.json({ error: 'weekStart must be YYYY-MM-DD' }, { status: 400 })
  }

  const kindParam = req.nextUrl.searchParams.get('kind')
  if (kindParam !== null && !isKind(kindParam)) {
    return NextResponse.json({ error: 'kind must be went_well or improve' }, { status: 400 })
  }

  // 'all' mode (no weekStart-scoping) powers the Logs page: every past entry
  // of one kind, newest first, one after another.
  const mode = req.nextUrl.searchParams.get('mode')

  try {
    const tenantId = getTenantId()
    if (mode === 'all') {
      if (!kindParam) return NextResponse.json({ error: 'kind is required for mode=all' }, { status: 400 })
      const rows = await prisma.journal_entries.findMany({
        where: { tenant_id: tenantId, user_id: user.userId, kind: kindParam },
        orderBy: { week_start: 'desc' },
      })
      return NextResponse.json(serialize(rows, 'journal_entries'))
    }

    const monday = mondayOf(weekStartParam)
    const rows = await prisma.journal_entries.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.userId,
        week_start: new Date(`${monday}T00:00:00.000Z`),
        ...(kindParam ? { kind: kindParam } : {}),
      },
    })
    return NextResponse.json(serialize(rows, 'journal_entries'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { weekStart, kind, text } = body as { weekStart?: string; kind?: string; text?: string }
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(`${weekStart}T00:00:00.000Z`))) {
    return NextResponse.json({ error: 'weekStart must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!isKind(kind)) return NextResponse.json({ error: 'kind must be went_well or improve' }, { status: 400 })
  if (typeof text !== 'string') return NextResponse.json({ error: 'text is required' }, { status: 400 })

  try {
    const tenantId = getTenantId()
    const monday = mondayOf(weekStart)
    const weekDate = new Date(`${monday}T00:00:00.000Z`)

    const existing = await prisma.journal_entries.findFirst({
      where: { tenant_id: tenantId, user_id: user.userId, week_start: weekDate, kind },
    })

    const trimmed = text.trim()

    if (existing) {
      const row = await prisma.journal_entries.update({
        where: { id: existing.id },
        data: { body: trimmed.length ? trimmed : null, updated_at: new Date() },
      })
      return NextResponse.json(serialize(row, 'journal_entries'))
    }

    const row = await prisma.journal_entries.create({
      data: {
        tenant_id: tenantId,
        user_id: user.userId,
        week_start: weekDate,
        kind,
        body: trimmed.length ? trimmed : null,
      },
    })
    return NextResponse.json(serialize(row, 'journal_entries'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
