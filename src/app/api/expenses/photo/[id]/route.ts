import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getDataScope } from '@/lib/permissions'
import { getVisibleUserIds } from '@/lib/visibility'
import { isConfigured, getSignedInlineUrl, receiptKey } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * Serve an expense receipt from the PRIVATE R2 bucket.
 *
 * `[id]` is the photo file name (`<uuid>.jpg`), which is what
 * `/api/expenses/upload` returns and what `expenses.photo_url` stores — see the
 * deviation note in that route for why it is not the expense id.
 *
 * This is a security improvement over what it replaces: the Supabase bucket was
 * PUBLIC, so any receipt was viewable by anyone with the link and no session at
 * all. Access is now authenticated AND authorised, and the R2 key is derived
 * server-side from the owning row rather than being anything the caller supplies.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  // Reject anything that is not a bare `<uuid>.<jpg|png>` before it can reach a
  // key. Without this, `..%2F` style input could walk out of the tenant prefix.
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/i.test(params.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Find the expense this photo belongs to. Tenant-scoped, so a photo id from
  // another tenant resolves to nothing even if someone guesses the uuid.
  const expense = await prisma.expenses.findFirst({
    where: { tenant_id: tid, photo_url: `/api/expenses/photo/${params.id}` },
    select: { user_id: true },
  })
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorise against the REAL permission system — never a hardcoded role.
  // Scope mirrors how every other expense route decides who may see whose data.
  const scope = await getDataScope(user, 'expenses')
  let allowed = false
  if (scope === 'all') {
    allowed = true
  } else if (expense.user_id === user.userId) {
    // 'own' and 'team' both include the caller's own expenses.
    allowed = true
  } else if (scope === 'team' && user.userId) {
    const visibleIds = await getVisibleUserIds(user.userId, tid)
    allowed = visibleIds.includes(expense.user_id)
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
