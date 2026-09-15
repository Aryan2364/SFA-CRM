import { cookies } from 'next/headers'
import { verifySession, COOKIE_NAME } from './session'
import { prisma } from './db'

export type SessionUser = {
  phone: string
  userId: string | null
  name: string
  role: string
  tenantId: string
  cv?: number
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload) return null
  return payload as SessionUser
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  if (user.userId) {
    try {
      // Lookup by primary key, exactly as before. `roles` is a to-one relation,
      // so this is a single object (or null) — not an array (PLAN.md §5.2).
      // A missing row yields `null` here, matching Supabase's .single() error
      // path, which also left `data` null and fell through to 'NoRole'.
      const data = await prisma.users.findUnique({
        where: { id: user.userId },
        select: {
          profile: true,
          status: true,
          roles: { select: { name: true } },
        },
      })

      if (data?.status === 'Inactive') {
        user.role = 'Deactivated'
      } else if (data?.profile === 'Administrator') {
        user.role = 'Administrator'
      } else {
        const roleName = data?.roles?.name
        user.role = roleName ?? 'NoRole'
      }
    } catch {
      // Fall back to session role if DB lookup fails
    }
  }

  return user
}
