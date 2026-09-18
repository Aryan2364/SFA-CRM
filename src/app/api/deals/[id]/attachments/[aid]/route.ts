import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { isConfigured, getSignedInlineUrl, dealKey } from '@/lib/r2'
import { findScopedDeal, notFound } from '../../../_access'
import { FILE_KEY_RE, UUID_RE, safeFileName, invalidId } from '../_shape'

export const dynamic = 'force-dynamic'

/**
 * One Deal attachment: fetch it, or remove it.
 *
 * `GET` mirrors `/api/expenses/photo/[id]` exactly — authorise, then 302 to a
 * 300-second signed inline url. The bucket stays private and the client never
 * learns an R2 address; all it ever holds is this app-relative path, which
 * re-authorises on every single fetch.
 */

/** Find the attachment, but only through a Deal this caller may actually see. */
async function findScoped(
  user: Awaited<ReturnType<typeof requireUser>>,
  tid: string,
  dealId: string,
  attachmentId: string
) {
  // `dealId` and `attachmentId` are both screened by the caller before they get
  // here, so that a segment which cannot be an id answers 400 while a segment
  // that simply resolves to nothing answers 404. Collapsing both into `null`
  // here would make the two indistinguishable again.
  const deal = await findScopedDeal(user, tid, dealId)
  if (!deal) return null
  // Scoped to the Deal AND the tenant, not looked up by `aid` alone: checking
  // the Deal and then fetching by id would let any attachment in the database
  // be pulled through a Deal the caller does happen to own.
  return prisma.deal_attachments.findFirst({
    where: { id: attachmentId, deal_id: deal.id, tenant_id: tid },
    select: { id: true, file_key: true, file_name: true },
  })
}

/** GET — 302 to a short-lived signed inline url for the stored object. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; aid: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()
  // Before Prisma sees either segment. A value that cannot be a uuid reaches
  // Postgres as a failed cast, and the throw came back to the client as a bare
  // 500 quoting the query — the bug this route was reopened to fix.
  if (!UUID_RE.test(params.id)) return invalidId('deal')
  if (!UUID_RE.test(params.aid)) return invalidId('attachment')

  try {
    const attachment = await findScoped(user, tid, params.id, params.aid)
    // A plain 404 either way. Telling an unauthorised caller that a row exists
    // is itself a leak, so "no such attachment" and "not yours" look identical.
    if (!attachment) return notFound()

    // The stored key is validated before it can reach R2. It is written only by
    // the POST above, which generates it, but a column is a column: a value
    // like `../receipts/<other tenant>/x.jpg` arriving by any future path would
    // otherwise walk straight out of this tenant's prefix.
    if (!FILE_KEY_RE.test(attachment.file_key)) return notFound()

    if (!isConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured.' }, { status: 500 })
    }

    // Key rebuilt from the SESSION tenant and the validated file name. It is
    // never accepted from the caller and never returned to them.
    const url = await getSignedInlineUrl(
      dealKey(tid, attachment.file_key),
      safeFileName(attachment.file_name),
      300
    )
    return NextResponse.redirect(url, 302)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * DELETE — remove an attachment from the Deal.
 *
 * Gated on `deals:delete`, the same gate `follow-ups/[fid]` uses, so the two
 * child collections of a Deal cannot disagree about who may remove a row.
 *
 * The R2 object is deliberately NOT deleted. The row is the only thing that can
 * address it — the key never appears in a url and a fresh signed url can only
 * be minted through the route above, which needs the row — so removing the row
 * makes the object unreachable. Deleting the bytes as well would turn a
 * mis-click into permanent loss of a customer's signed quotation, and the same
 * credentials reach two other products' buckets (see `src/lib/r2.ts`), so an
 * unnecessary delete call is the wrong reflex to build in here.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; aid: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'delete')) return forbidden()
  const tid = getTenantId()
  // Same screens as the GET above, for the same reason.
  if (!UUID_RE.test(params.id)) return invalidId('deal')
  if (!UUID_RE.test(params.aid)) return invalidId('attachment')

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // deleteMany(), not delete(): a no-match stays silent instead of throwing
    // P2025 and becoming a 500 (PLAN.md §8.4).
    const { count } = await prisma.deal_attachments.deleteMany({
      where: { id: params.aid, deal_id: deal.id, tenant_id: tid },
    })
    if (count === 0) return notFound()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
