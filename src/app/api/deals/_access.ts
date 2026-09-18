import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { scopedUserIds, scopeWhere } from '@/lib/scope'

/**
 * "May this user touch THIS Deal?" — used by every single-Deal route.
 *
 * The list applies §6.6 Self/Team/Company through `scopedUserIds()`; without
 * the same test here, a Sales Executive on `own` scope who cannot SEE another
 * rep's Deal in the list could still fetch it, edit it, drag it to another
 * stage or close it by guessing nothing harder than its id. Four routes need
 * the check, so it is written once.
 *
 * Resolves to the Deal's id when it exists, is in this tenant, and is inside
 * the caller's scope — and to `null` in every other case. The caller returns a
 * plain 404 for `null` rather than distinguishing "no such Deal" from "not
 * yours": telling an unauthorised caller that a row exists is itself a leak.
 */
export async function findScopedDeal(
  user: SessionUser,
  tenantId: string,
  dealId: string
): Promise<{ id: string; stage_entered_at: Date; deal_stage_id: string | null } | null> {
  const ids = await scopedUserIds(user, 'deals')
  // findFirst, not findUnique: `tenant_id` is not part of the primary key, so
  // it has to be in the `where` — a Deal id from another tenant resolves
  // otherwise, and nothing crashes when it does.
  return prisma.deals.findFirst({
    where: {
      id: dealId,
      tenant_id: tenantId,
      ...scopeWhere(ids, 'owner_user_id'),
    },
    select: { id: true, stage_entered_at: true, deal_stage_id: true },
  })
}

export function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
