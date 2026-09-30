import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser, SessionUser } from '@/lib/auth'
import { checkPermission } from '@/lib/permissions'
import { scopedUserIds } from '@/lib/scope'
import { isConfigured, getSignedInlineUrl, receiptKey } from '@/lib/r2'
import { PHOTO_NAME_RE, PHOTO_PATH_PREFIX, isUploadedBy } from '../../_photo'

export const dynamic = 'force-dynamic'

/**
 * Serve an expense receipt from the PRIVATE R2 bucket.
 *
 * `[id]` is the photo file name (`<uuid>.jpg`), which is what
 * `/api/expenses/upload` returns and what `expenses.photo_url` stores — see the
 * deviation note in that route for why it is not the expense id.
 *
 * This is a security improvement over what it replaces: the old storage bucket was
 * PUBLIC, so any receipt was viewable by anyone with the link and no session at
 * all. Access is now authenticated AND authorised, and the R2 key is derived
 * server-side from the owning row rather than being anything the caller supplies.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  // Reject anything that is not a bare `<uuid>[_<tag>].<jpg|png>` before it
  // can reach a key. Without this, `..%2F` style input could walk out of the
  // tenant prefix.
  if (!PHOTO_NAME_RE.test(params.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // A receipt's own uploader may always open it — `expenses/create` without
  // `view` must not lock someone out of the photo they just attached. A
  // tagged name proves the uploader by itself: its HMAC binds the session
  // tenant and the caller, so no row lookup is needed.
  const ownUpload = !!user.userId && isUploadedBy(params.id, tid, user.userId)
  if (!ownUpload) {
    const denied = await authoriseOtherReader(user, tid, params.id)
    if (denied) return denied
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 500 })
  }

  try {
    // The key is rebuilt from the SESSION tenant and the validated file name;
    // it is never accepted from the client, and never returned to it.
    const url = await getSignedInlineUrl(receiptKey(tid, params.id), params.id, 300)
    // 302 to a freshly signed, short-lived inline url. The UI renders these
    // through a plain <a href>, so a redirect is transparent to it.
    return NextResponse.redirect(url, 302)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

/** Everyone but a tagged name's uploader. `null` means allowed. */
async function authoriseOtherReader(
  user: SessionUser,
  tid: string,
  name: string
): Promise<NextResponse | null> {
  // EVERY expense that references this photo, not the first one. photo_url
  // was once taken from the request body unchecked, so a row can exist that
  // points at somebody else's receipt; authorising against "some row the
  // caller owns" let such a row unlock it. The caller must be able to see the
  // owner of every referencing row — a planted row can then only ever NARROW
  // access, never widen it. `POST /api/expenses` now refuses a photo the
  // caller did not upload, so no new such row can be written.
  // Tenant-scoped, so a photo id from another tenant resolves to nothing.
  const owners = await prisma.expenses.findMany({
    where: { tenant_id: tid, photo_url: `${PHOTO_PATH_PREFIX}${name}` },
    select: { user_id: true },
  })
  if (owners.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A legacy untagged name carries no proof of its uploader, so the rows are
  // the record: when every row referencing it is the caller's, the receipt is
  // the caller's own. New rows can only attach tagged names, so no row can be
  // added now to claim a legacy photo.
  if (user.userId && owners.every(o => o.user_id === user.userId)) return null

  if (!await checkPermission(user, 'expenses', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Authorise against the REAL permission system — never a hardcoded role —
  // through the same `expenses` data scope the list uses.
  const scoped = await scopedUserIds(user, 'expenses')
  if (scoped && !owners.every(o => scoped.includes(o.user_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
