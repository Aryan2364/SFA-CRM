import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireUser } from '@/lib/auth'
import { getTenantId } from '@/lib/tenant'
import { isConfigured, putObject, receiptKey } from '@/lib/r2'

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png']
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

export async function POST(req: NextRequest) {
  await requireUser()

  const form = await req.formData()
  const file = form.get('file') as File | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type))
    return NextResponse.json({ error: 'Only JPG and PNG files are allowed' }, { status: 400 })
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: 'Photo must be 5 MB or less' }, { status: 400 })

  if (!isConfigured())
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 500 })

  const tenantId = getTenantId()
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  // The photo's own id. The tenant half of the key is taken from the session,
  // never from the request, so one tenant cannot write into another's prefix.
  const photoFile = `${randomUUID()}.${ext}`

  try {
    await putObject(receiptKey(tenantId, photoFile), Buffer.from(await file.arrayBuffer()), file.type)
  } catch (err) {
    // Errors-as-values, as before — this route never throws to the client.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Response contract unchanged: { url }, read at
  // src/app/(protected)/daily-activity/page.tsx:701.
  //
  // DEVIATION FROM PLAN.md §7, and the reason for it. The plan specifies
  // `/api/expenses/photo/<expenseId>`, but the client uploads the photo BEFORE
  // the expense exists — handleSubmit() uploads, reads `url`, and only then
  // calls onAdd() to create the expense with that photo_url. There is no expense
  // id to return here, this route has no way to create one (it never sees the
  // category or amount), and reordering the client would be a UI change, which
  // rule 2.1 forbids.
  //
  // So the url is keyed by the PHOTO id instead. The intent of §7 is preserved
  // exactly: the value is app-relative, never an R2 address, no bucket or
  // account is exposed, and the reader still authorises per-expense and derives
  // the real key server-side from the owning row's tenant_id.
  return NextResponse.json({ url: `/api/expenses/photo/${photoFile}` })
}
