import { NextRequest, NextResponse } from 'next/server'
import { dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser, SessionUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { asId } from '@/lib/tenant-fk'
import {
  SHARING_UNAVAILABLE,
  addDealMember,
  canShareDeal,
  changeDealMember,
  isMemberAccess,
  listCompanyMembers,
  listDealMembers,
  memberUserProblem,
  removeDealMember,
  shareCandidates,
  type MemberRow,
  type MemberWrite,
} from '@/lib/sharing'
import { findScopedDeal, notFound } from '../../_access'

export const dynamic = 'force-dynamic'

/**
 * `/api/deals/[id]/members` — the opportunity's "Shared with" list.
 *
 *   GET                            → [{ id, user_id, name, access, added_by,
 *                                       added_by_name, created_at, via }]
 *   GET    ?candidates=1           → [{ id, name }] (sharers only, else 403)
 *   POST   { user_id, access }     → 201 { ok: true, members: [...] }
 *   PATCH  { user_id, access }     → 200 { ok: true, members: [...] }
 *   DELETE ?user_id=… (or body)    → 200 { ok: true, members: [...] }
 *
 * `via` is 'deal' for a person this opportunity was shared with directly
 * (`deal_members` — opportunity-only sharing) and 'account' for someone who
 * reaches it because its ACCOUNT is shared with them (`account_members`).
 * 'account' rows are read-only here: PATCH and DELETE act on `deal_members`
 * only, and the account's own list is where those are changed.
 *
 * Reading needs `deals.view` and read access to the deal (404 otherwise).
 * Changing needs `canShareDeal`: the owner, or `deals.edit` with the owner
 * inside the caller's `deals` scope (403 otherwise). The person must be an
 * ACTIVE user of this tenant and not the deal's owner.
 *
 * Until `deal_members` / `account_members` exist: GET answers `[]` (or only the
 * half that exists) and every write answers 503 "This needs a database update
 * first."
 */

type Loaded = { id: string; owner_user_id: string | null; company_id: string | null; tid: string; user: SessionUser }

async function load(params: { id: string }): Promise<Loaded | NextResponse> {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()
  const deal = await findScopedDeal(user, tid, params.id, 'read')
  if (!deal) return notFound()
  return { id: deal.id, owner_user_id: deal.owner_user_id, company_id: deal.company_id, tid, user }
}

async function loadForShare(params: { id: string }): Promise<Loaded | NextResponse> {
  const loaded = await load(params)
  if (loaded instanceof NextResponse) return loaded
  if (!loaded.user.userId) return forbidden()
  if (!await canShareDeal(loaded.user, { owner_user_id: loaded.owner_user_id })) {
    return NextResponse.json(
      { error: "Only the opportunity's owner, or someone who can edit opportunities and whose team includes the owner, can change who it is shared with." },
      { status: 403 }
    )
  }
  return loaded
}

type ListedMember = MemberRow & { via: 'deal' | 'account' }

async function members(loaded: Loaded): Promise<ListedMember[]> {
  const [direct, viaAccount] = await Promise.all([
    listDealMembers(loaded.tid, loaded.id),
    loaded.company_id ? listCompanyMembers(loaded.tid, loaded.company_id) : Promise.resolve([] as MemberRow[]),
  ])
  return [
    ...viaAccount.map(m => ({ ...m, via: 'account' as const })),
    ...direct.map(m => ({ ...m, via: 'deal' as const })),
  ]
}

async function answer(result: MemberWrite, loaded: Loaded, status = 200) {
  if (result === 'unavailable') return NextResponse.json({ error: SHARING_UNAVAILABLE }, { status: 503 })
  if (result === 'exists') return NextResponse.json({ error: 'This person already has access to this opportunity.' }, { status: 409 })
  if (result === 'not-found') return NextResponse.json({ error: 'This person is not on the list.' }, { status: 404 })
  return NextResponse.json({ ok: true, members: await members(loaded) }, { status })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // `?candidates=1` — the people this opportunity could be shared with
    // directly: [{ id, name }], minus the owner and anyone already listed
    // (directly or via the account). Only for someone who may share it.
    if (req.nextUrl.searchParams.get('candidates') === '1') {
      const loaded = await loadForShare(params)
      if (loaded instanceof NextResponse) return loaded
      const current = await members(loaded)
      return NextResponse.json(await shareCandidates(loaded.tid, loaded.owner_user_id, current.map(m => m.user_id)))
    }
    const loaded = await load(params)
    if (loaded instanceof NextResponse) return loaded
    return NextResponse.json(await members(loaded))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const loaded = await loadForShare(params)
    if (loaded instanceof NextResponse) return loaded
    const body = await readBody(req)
    if (!isMemberAccess(body.access)) {
      return NextResponse.json({ error: "Access must be 'work' or 'view'" }, { status: 400 })
    }
    const problem = await memberUserProblem(loaded.tid, body.user_id, loaded.owner_user_id)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const result = await addDealMember(loaded.tid, loaded.id, body.user_id as string, body.access, loaded.user.userId!)
    return answer(result, loaded, 201)
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const loaded = await loadForShare(params)
    if (loaded instanceof NextResponse) return loaded
    const body = await readBody(req)
    if (!isMemberAccess(body.access)) {
      return NextResponse.json({ error: "Access must be 'work' or 'view'" }, { status: 400 })
    }
    const userId = asId(body.user_id)
    if (!userId) return NextResponse.json({ error: 'Choose a person' }, { status: 400 })
    const result = await changeDealMember(loaded.tid, loaded.id, userId, body.access, loaded.user.userId!)
    return answer(result, loaded)
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const loaded = await loadForShare(params)
    if (loaded instanceof NextResponse) return loaded
    const fromQuery = req.nextUrl.searchParams.get('user_id')
    const userId = asId(fromQuery ?? (await readBody(req)).user_id)
    if (!userId) return NextResponse.json({ error: 'Choose a person' }, { status: 400 })
    const result = await removeDealMember(loaded.tid, loaded.id, userId, loaded.user.userId!)
    return answer(result, loaded)
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
