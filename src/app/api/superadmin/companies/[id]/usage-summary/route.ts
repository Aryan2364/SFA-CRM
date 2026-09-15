import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { classifyUser, computeActivityScore } from '@/lib/usage-intelligence'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tid = params.id
  const now = new Date()
  const ago30Date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ago7Date  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000)
  // The comparison helpers below work on ISO STRINGS, as they did under
  // Supabase, so keep string copies of both cut-offs.
  const ago30 = ago30Date.toISOString()
  const ago7  = ago7Date.toISOString()

  try {
  // Parallel fetch all needed data.
  //
  // NOTE: `user_login_logs` is NOT queried. That table does not exist in the
  // database (PLAN.md 13.1), so the Supabase call failed and `loginLogs` came
  // back null — `loginLogs ?? []` then meant this route still answered 200 with
  // every login metric at zero. An empty array preserves that exactly. This is
  // the graceful-degradation counterpart of the hard 500 in ../users.
  const loginLogs: { user_id: string; logged_in_at: string }[] = []
  const [users, visitRows, orderRows, expenseRows, remarkRows, planLogRows] = await Promise.all([
    prisma.users.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, status: true } }),
    prisma.daily_visits.findMany({ where: { tenant_id: tid, created_at: { gte: ago30Date } }, select: { user_id: true, created_at: true, status: true } }),
    prisma.orders.findMany({ where: { tenant_id: tid, created_at: { gte: ago30Date } }, select: { user_id: true, created_at: true } }),
    prisma.expenses.findMany({ where: { tenant_id: tid, created_at: { gte: ago30Date } }, select: { user_id: true, created_at: true } }),
    prisma.contextual_remarks.findMany({ where: { tenant_id: tid, created_at: { gte: ago30Date } }, select: { author_user_id: true, created_at: true } }),
    prisma.weekly_plan_audit_logs.findMany({ where: { tenant_id: tid, action_type: 'submit', timestamp: { gte: ago30Date } }, select: { actor_user_id: true, timestamp: true } }),
  ])

  // Every timestamp below is compared against the ISO cut-off strings, so
  // normalise the Date objects once (PLAN.md 5.1).
  const visits = visitRows.map(v => ({ ...v, created_at: v.created_at.toISOString() }))
  const orders = orderRows.map(o => ({ ...o, created_at: o.created_at.toISOString() }))
  const expenses = expenseRows.map(e => ({ ...e, created_at: e.created_at.toISOString() }))
  const remarks = remarkRows.map(r => ({ ...r, created_at: r.created_at.toISOString() }))
  const planLogs = planLogRows.map(p => ({ ...p, timestamp: p.timestamp.toISOString() }))

  const allUsers = users

  // Build per-user metric maps
  const loginsByUser = new Map<string, string[]>()
  for (const l of loginLogs) {
    const arr = loginsByUser.get(l.user_id) ?? []
    arr.push(l.logged_in_at)
    loginsByUser.set(l.user_id, arr)
  }

  const activityByUser = new Map<string, { ts: string; weight: number }[]>()
  const addActivity = (uid: string, ts: string, weight: number) => {
    const arr = activityByUser.get(uid) ?? []
    arr.push({ ts, weight })
    activityByUser.set(uid, arr)
  }
  for (const v of visits) addActivity(v.user_id, v.created_at, v.status === 'Completed' ? 3 : 1)
  for (const o of orders) addActivity(o.user_id, o.created_at, 3)
  for (const e of expenses) addActivity(e.user_id, e.created_at, 1)
  for (const r of remarks) addActivity(r.author_user_id ?? '', r.created_at, 1)
  for (const p of planLogs) addActivity(p.actor_user_id ?? '', p.timestamp, 2)

  // Compute per-user classification
  const classMap = new Map<string, string>()
  const scoreMap = new Map<string, number>()
  for (const u of allUsers) {
    const logins = loginsByUser.get(u.id) ?? []
    const activities = activityByUser.get(u.id) ?? []
    const lastLogin = logins.length > 0 ? new Date(Math.max(...logins.map(l => new Date(l).getTime()))) : null
    const score30 = computeActivityScore(activities, ago30)
    const score7  = computeActivityScore(activities, ago7)
    const logins7 = logins.filter(l => l >= ago7).length
    classMap.set(u.id, classifyUser({ status: u.status, lastLogin, score7d: score7, score30d: score30, logins7d: logins7 }))
    scoreMap.set(u.id, score30)
  }

  // Aggregate
  const counts = { actively_using: 0, passive: 0, low_usage: 0, not_using: 0, dormant_enabled: 0 }
  for (const [, cls] of classMap) {
    if (cls in counts) counts[cls as keyof typeof counts]++
  }

  const activeStatus  = allUsers.filter(u => u.status === 'Active').length
  const inactiveStatus = allUsers.filter(u => u.status !== 'Active').length
  const adoptionRate  = allUsers.length > 0 ? Math.round((counts.actively_using / allUsers.length) * 100) : 0

  // Power users: top 10 by score_30d
  const powerUsers = allUsers
    .map(u => ({ id: u.id, name: u.name, score_30d: scoreMap.get(u.id) ?? 0, classification: classMap.get(u.id) ?? 'not_using' }))
    .filter(u => u.score_30d > 0)
    .sort((a, b) => b.score_30d - a.score_30d)
    .slice(0, 10)

  return NextResponse.json({
    total_users:      allUsers.length,
    active_status:    activeStatus,
    inactive_status:  inactiveStatus,
    actively_using:   counts.actively_using,
    passive:          counts.passive,
    low_usage:        counts.low_usage,
    not_using:        counts.not_using,
    dormant_enabled:  counts.dormant_enabled,
    adoption_rate:    adoptionRate,
    power_users:      powerUsers,
  })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
