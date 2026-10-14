import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser, SessionUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { asId } from '@/lib/tenant-fk'
import {
  SHARING_UNAVAILABLE,
  addCompanyMember,
  canShareCompany,
  changeCompanyMember,
  isMemberAccess,
  listCompanyMembers,
  memberUserProblem,
  removeCompanyMember,
  shareCandidates,
  type MemberWrite,
} from '@/lib/sharing'
import { findScopedCompany } from '../../_access'

export const dynamic = 'force-dynamic'

/**
 * `/api/companies/[id]/members` — the account's "Shared with" list.
 *
 *   GET                            → [{ id, user_id, name, access, added_by,
 *                                       added_by_name, created_at }]
 *   GET    ?candidates=1           → [{ id, name }] (sharers only, else 403)
 *   POST   { user_id, access }     → 201 { ok: true, members: [...] }
 *   PATCH  { user_id, access }     → 200 { ok: true, members: [...] }
 *   DELETE ?user_id=… (or body)    → 200 { ok: true, members: [...] }
 *
 * The model, the storage and the rules live in src/lib/sharing.ts; this route
 * only applies them:
 *
 *   - Reading the list needs `companies.view` and read access to the account
 *     (owner-scope or any membership). Anyone else gets a 404, as on
 *     `GET /api/companies/[id]` — the account's existence is not confirmed.
 *   - Changing it needs `canShareCompany`: the owner, or `companies.edit` with
 *     the owner inside the caller's `companies` scope. Otherwise 403.
 *   - The person must be an ACTIVE user of this tenant and not the owner.
 *   - `access` is 'work' or 'view'.
 *
 * Until `account_members` exists: GET answers `[]` and every write answers
 * 503 "This needs a database update first." — the account itself is untouched.
 *
 * Writes answer the refreshed list so the page can render it without a second
 * round trip.
 */

type Loaded = { id: string; owner_user_id: string | null; tid: string; user: SessionUser }

/** The account, in this tenant, readable by the caller — or the response to send. */
async function load(params: { id: string }): Promise<Loaded | NextResponse> {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const tid = getTenantId()
  const found = await findScopedCompany(user, tid, params.id, 'read')
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = await prisma.companies.findFirst({
    where: { id: found.id, tenant_id: tid },
    select: { id: true, owner_user_id: true },
  })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return { ...row, tid, user }
}

/** `load` plus the share permission, for every write. */
async function loadForShare(params: { id: string }): Promise<Loaded | NextResponse> {
  const loaded = await load(params)
  if (loaded instanceof NextResponse) return loaded
  if (!loaded.user.userId) return forbidden()
  if (!await canShareCompany(loaded.user, { owner_user_id: loaded.owner_user_id })) {
    return NextResponse.json(
      { error: "Only the account's owner, or someone who can edit accounts and whose team includes the owner, can change who it is shared with." },
      { status: 403 }
    )
  }
  return loaded
}

async function answer(result: MemberWrite, loaded: Loaded, status = 200) {
  if (result === 'unavailable') return NextResponse.json({ error: SHARING_UNAVAILABLE }, { status: 503 })
  if (result === 'exists') return NextResponse.json({ error: 'This person already has access to this account.' }, { status: 409 })
  if (result === 'not-found') return NextResponse.json({ error: 'This person is not on the list.' }, { status: 404 })
  return NextResponse.json({ ok: true, members: await listCompanyMembers(loaded.tid, loaded.id) }, { status })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // `?candidates=1` — the people this account could be shared with, for the
    // "Share" picker: [{ id, name }]. Only for someone who may share it.
    if (req.nextUrl.searchParams.get('candidates') === '1') {
      const loaded = await loadForShare(params)
      if (loaded instanceof NextResponse) return loaded
      const current = await listCompanyMembers(loaded.tid, loaded.id)
      return NextResponse.json(await shareCandidates(loaded.tid, loaded.owner_user_id, current.map(m => m.user_id)))
    }
    const loaded = await load(params)
    if (loaded instanceof NextResponse) return loaded
    return NextResponse.json(await listCompanyMembers(loaded.tid, loaded.id))
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
    const result = await addCompanyMember(loaded.tid, loaded.id, body.user_id as string, body.access, loaded.user.userId!)
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
    const result = await changeCompanyMember(loaded.tid, loaded.id, userId, body.access, loaded.user.userId!)
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
    const result = await removeCompanyMember(loaded.tid, loaded.id, userId, loaded.user.userId!)
    return answer(result, loaded)
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
