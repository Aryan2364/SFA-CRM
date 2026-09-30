import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Receipt photo names, and the proof of who uploaded one.
 *
 * ⚠️ `expenses.photo_url` arrives in the BODY of `POST /api/expenses`, and the
 * photo route used to authorise a read by finding an expense whose photo_url
 * matched and checking that row's owner. So a caller who learned another
 * user's photo name could file an expense of their own pointing at it, and the
 * photo route would then find THEIR row and hand them the receipt. The value
 * the read was authorised against was whatever the client said.
 *
 * The upload route is the only party that knows who uploaded an object, and
 * the object is uploaded BEFORE the expense exists (see the note in
 * `upload/route.ts`), so there is no row to record it in. Instead the name
 * carries the proof: `<uuid>_<tag>.<ext>`, where `tag` is an HMAC over the
 * tenant, the uploader and the uuid, keyed by SESSION_SECRET. The expense
 * route recomputes it for the CALLER and refuses a photo_url that does not
 * match — so only the user who uploaded an object can attach it, and only in
 * their own tenant. Nothing about the R2 key layout changes (`receiptKey` takes
 * the name as-is), and the stored value stays an app-relative path.
 *
 * Names from before the tag existed (`<uuid>.<ext>`) still READ, so existing
 * receipts keep working; they can no longer be ATTACHED to a new expense.
 */

export const PHOTO_PATH_PREFIX = '/api/expenses/photo/'

/** A photo name the read route will serve: legacy or tagged. */
export const PHOTO_NAME_RE = /^[0-9a-f-]{36}(_[0-9a-f]{32})?\.(jpg|png)$/i

/** A photo name that may be attached to a new expense: tagged only. */
const ATTACHABLE_RE = /^([0-9a-f-]{36})_([0-9a-f]{32})\.(jpg|png)$/i

function tagFor(tenantId: string, userId: string, uuid: string): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET env var is not set')
  return createHmac('sha256', secret)
    .update(`expense-receipt:${tenantId}:${userId}:${uuid.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

/** The object name the upload route stores under, bound to its uploader. */
export function photoNameFor(tenantId: string, userId: string, uuid: string, ext: 'jpg' | 'png'): string {
  return `${uuid}_${tagFor(tenantId, userId, uuid)}.${ext}`
}

/**
 * True when `photoUrl` is exactly `/api/expenses/photo/<name>` for a name this
 * user uploaded in this tenant. Anything else — another user's photo, a legacy
 * untagged name, an R2 address, an absolute or `javascript:` URL — is false.
 */
export function isOwnPhotoUrl(photoUrl: unknown, tenantId: string, userId: string): boolean {
  if (typeof photoUrl !== 'string' || !photoUrl.startsWith(PHOTO_PATH_PREFIX)) return false
  return isUploadedBy(photoUrl.slice(PHOTO_PATH_PREFIX.length), tenantId, userId)
}

/**
 * True when `name` is a TAGGED photo name this user uploaded in this tenant.
 * A legacy untagged name carries no proof and is always false here.
 */
export function isUploadedBy(name: string, tenantId: string, userId: string): boolean {
  const m = ATTACHABLE_RE.exec(name)
  if (!m) return false
  const expected = Buffer.from(tagFor(tenantId, userId, m[1]))
  const given = Buffer.from(m[2].toLowerCase())
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * A stored photo_url safe to hand to an `<a href>` / `<img src>`, or null.
 * Only an app photo path passes; any absolute URL yields null.
 */
export function safePhotoUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null
  if (!photoUrl.startsWith(PHOTO_PATH_PREFIX)) return null
  return PHOTO_NAME_RE.test(photoUrl.slice(PHOTO_PATH_PREFIX.length)) ? photoUrl : null
}
