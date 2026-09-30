import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { mondayOf } from '@/lib/weekly-review'
import { businessDate } from '@/lib/business-date'

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
 * ⚠️ "One entry" is enforced HERE, not by the database: `journal_entries` has
 * no unique constraint on (tenant_id, user_id, week_start, kind). The box
 * autosaves on a debounce AND on blur, and two tabs can save at once, so a
 * plain find-then-create raced into duplicate rows — and with no `orderBy`,
 * which one the box then showed was Postgres's choice, so the user's later
 * text could silently revert. Three things now hold the line:
 *  - POST takes a transaction-scoped advisory lock on the key, so two saves
 *    of the same box serialise instead of both seeing "no row" and creating;
 *  - POST writes to the NEWEST row for the key and deletes any older ones in
 *    the same transaction, so a duplicate already in the table heals on the
 *    next save;
 *  - every read orders newest-first and keeps one row per key, so the text
 *    shown is always the last one written.
 * A `@@unique([tenant_id, user_id, week_start, kind])` would make the lock
 * unnecessary; it needs the existing duplicates cleaned first.
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

/** Newest first: the row the last save wrote. `id` breaks a same-instant tie. */
const NEWEST = [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }] as const

/**
 * One row per (week, kind), keeping the first seen — with `NEWEST` ordering,
 * the latest text. Hides duplicates written before POST serialised; the next
 * save of that box deletes them for good.
 */
function newestPerKey<T extends { week_start: Date; kind: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    const key = `${dateOnlyString(r.week_start)} ${r.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const weekStartParam = req.nextUrl.searchParams.get('weekStart') ?? businessDate()
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
        orderBy: [{ week_start: 'desc' }, ...NEWEST],
      })
      return NextResponse.json(serialize(newestPerKey(rows), 'journal_entries'))
    }

    const monday = mondayOf(weekStartParam)
    const rows = await prisma.journal_entries.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.userId,
        week_start: new Date(`${monday}T00:00:00.000Z`),
        ...(kindParam ? { kind: kindParam } : {}),
      },
      orderBy: [...NEWEST],
    })
    return NextResponse.json(serialize(newestPerKey(rows), 'journal_entries'))
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

    const trimmed = text.trim()
    const bodyValue = trimmed.length ? trimmed : null
    const userId = user.userId

    const row = await prisma.$transaction(async tx => {
      // Serialise every save of this one box — see the header. The lock is
      // released at commit; it touches no table, so it holds no row lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('journal_entries'), hashtext(${`${tenantId}:${userId}:${monday}:${kind}`}))`

      const existing = await tx.journal_entries.findMany({
        where: { tenant_id: tenantId, user_id: userId, week_start: weekDate, kind },
        orderBy: [...NEWEST],
        select: { id: true },
      })

      if (existing.length === 0) {
        return tx.journal_entries.create({
          data: { tenant_id: tenantId, user_id: userId, week_start: weekDate, kind, body: bodyValue },
        })
      }

      const [newest, ...older] = existing
      if (older.length) {
        await tx.journal_entries.deleteMany({
          where: { tenant_id: tenantId, user_id: userId, id: { in: older.map(r => r.id) } },
        })
      }
      return tx.journal_entries.update({
        where: { id: newest.id },
        data: { body: bodyValue, updated_at: new Date() },
      })
    })
    return NextResponse.json(serialize(row, 'journal_entries'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
