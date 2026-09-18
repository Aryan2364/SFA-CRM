import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { isConfigured, putObject, dealKey } from '@/lib/r2'
import { findScopedDeal, notFound } from '../../_access'
import {
  ALLOWED_TYPES,
  ALLOWED_LABEL,
  MAX_SIZE,
  MAX_SIZE_LABEL,
  safeFileName,
  UUID_RE,
  invalidId,
} from './_shape'

export const dynamic = 'force-dynamic'

/**
 * Attachments against a Deal (§4.8) — quotations, proposals and similar files.
 *
 * The shape is `/api/expenses/upload` plus `/api/expenses/photo/[id]`, copied
 * deliberately rather than re-invented, with three differences that the Deal
 * case forces:
 *
 * 1. **PDF is in the allow-list.** A quotation is a PDF far more often than it
 *    is a phone photo, and the cap is 10 MB rather than 5 for the same reason.
 * 2. **Upload and row-creation are one request.** The expense flow uploads
 *    before the expense exists, so its upload route can only return a url. Here
 *    the Deal already exists — it is in the path — so the object and the
 *    `deal_attachments` row are written together and a single 201 carries the
 *    row back. There is no window in which an object sits in R2 with no row
 *    pointing at it that the UI knows about.
 * 3. **The url is a row id, not a file name.** `/api/expenses/photo/<file>` has
 *    to find its owner by matching `photo_url` as a string. This collection has
 *    a real primary key, so the read route addresses the row directly and the
 *    stored `file_key` never appears in a url at all.
 *
 * What is NOT different, and must not become different: the bucket is private,
 * the value handed to the client is app-relative, the R2 key is rebuilt
 * server-side from the SESSION tenant, and every query carries `tenant_id`.
 */

/** The row as the client sees it. `url` is app-relative — never an R2 address. */
function toRow(
  a: {
    id: string
    deal_id: string
    file_name: string
    content_type: string | null
    size_bytes: bigint | null
    uploaded_by_user_id: string | null
    created_at: Date
  },
  uploaderName: string | null
) {
  return {
    ...(serialize(
      {
        id: a.id,
        deal_id: a.deal_id,
        file_name: a.file_name,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
        uploaded_by_user_id: a.uploaded_by_user_id,
        created_at: a.created_at,
      },
      'deal_attachments'
    ) as Record<string, unknown>),
    uploaded_by_name: uploaderName,
    // §29 gives every file row a download link. This is that link, and it is
    // the ONLY address of the object the client is ever given: it authorises on
    // every fetch and 302s to a url that expires in five minutes.
    url: `/api/deals/${a.deal_id}/attachments/${a.id}`,
  }
}

/** `file_key` is never selected into a response — it is an R2 key, internal. */
const LIST_SELECT = {
  id: true,
  deal_id: true,
  file_name: true,
  content_type: true,
  size_bytes: true,
  uploaded_by_user_id: true,
  created_at: true,
} as const

/** Uploader display names, in one query rather than one per row. */
async function uploaderNames(tenantId: string, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))]
  if (unique.length === 0) return new Map<string, string>()
  const users = await prisma.users.findMany({
    where: { id: { in: unique }, tenant_id: tenantId },
    select: { id: true, name: true },
  })
  return new Map(users.map(u => [u.id, u.name]))
}

/** GET — every attachment on the Deal, newest first. Bare array. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()
  // A malformed Deal id would reach Postgres as a failed uuid cast and come
  // back as a 500 quoting the query. It is a 400 with a sentence — see
  // `invalidId` for why this one is not a 404.
  if (!UUID_RE.test(params.id)) return invalidId('deal')

  try {
    // Scope first. A Sales Executive on `own` who cannot see another rep's Deal
    // must not be able to read its quotations by guessing the Deal id, and
    // `findScopedDeal` is the one place that test is written.
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    const rows = await prisma.deal_attachments.findMany({
      where: { deal_id: deal.id, tenant_id: tid },
      select: LIST_SELECT,
      orderBy: { created_at: 'desc' },
    })
    const names = await uploaderNames(tid, rows.map(r => r.uploaded_by_user_id))
    return NextResponse.json(
      rows.map(r => toRow(r, r.uploaded_by_user_id ? names.get(r.uploaded_by_user_id) ?? null : null))
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * POST — upload one file against the Deal. `multipart/form-data`, field `file`.
 *
 * Gated on `deals:edit`, not `deals:create`: attaching a quotation changes an
 * existing Deal, and a caller who may not edit the Deal may not add to it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
  const tid = getTenantId()
  // Same screen as the GET above, and the same 400 for the same reason.
  if (!UUID_RE.test(params.id)) return invalidId('deal')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    // A body that is not multipart throws inside Next's parser. That is a
    // client mistake, so it answers 400 rather than reaching the 500 handler.
    return NextResponse.json({ error: 'Expected a multipart/form-data body' }, { status: 400 })
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: `Only ${ALLOWED_LABEL} files are allowed` },
      { status: 400 }
    )
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File must be ${MAX_SIZE_LABEL} or less` },
      { status: 400 }
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 500 })
  }

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // The object's own name, generated HERE. Nothing the caller sent is part of
    // the key — not the file name, not the tenant. `file.name` survives only as
    // a display label in `file_name`.
    const fileKey = `${randomUUID()}.${ext}`
    const displayName = safeFileName(file.name || `attachment.${ext}`)

    // Bytes first. If the row were written first and the put then failed, the
    // list would show a file that cannot be fetched — a dead end §6 forbids.
    // This way a failed put leaves nothing behind but an orphan object, which
    // is invisible and harmless.
    await putObject(
      dealKey(tid, fileKey),
      Buffer.from(await file.arrayBuffer()),
      file.type
    )

    const created = await prisma.deal_attachments.create({
      data: {
        tenant_id: tid,
        deal_id: deal.id,
        file_key: fileKey,
        file_name: displayName,
        content_type: file.type,
        size_bytes: BigInt(file.size),
        uploaded_by_user_id: user.userId ?? null,
      },
      select: LIST_SELECT,
    })

    const names = await uploaderNames(tid, [created.uploaded_by_user_id])
    return NextResponse.json(
      toRow(
        created,
        created.uploaded_by_user_id ? names.get(created.uploaded_by_user_id) ?? null : null
      ),
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
