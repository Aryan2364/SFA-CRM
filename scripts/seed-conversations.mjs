#!/usr/bin/env node
/**
 * Seeds demo `contextual_remarks` threads into the DEV demo tenant so the
 * Conversations screen has believable content to show clients.
 *
 * Points at SCRATCH_DATABASE_URL — the LOCAL PostgreSQL instance — and
 * refuses any non-local host, same guard as every other script in this
 * directory. It never reads or touches DATABASE_URL (live Supabase).
 *
 * Idempotent: every row this script writes carries a deterministic id
 * (UUIDv5 over a stable seed key), so re-running it upserts the same rows
 * instead of duplicating them. `--dry-run` prints what would be written
 * without touching the database. `--clear` deletes exactly the rows this
 * script owns (by their deterministic ids) and nothing else.
 *
 * Usage:
 *   node scripts/seed-conversations.mjs            # seed (idempotent)
 *   node scripts/seed-conversations.mjs --dry-run   # preview only
 *   node scripts/seed-conversations.mjs --clear     # delete seeded rows
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const raw = readEnv('SCRATCH_DATABASE_URL')
if (!raw) {
  console.error('SCRATCH_DATABASE_URL is not set (env or .env.local).')
  process.exit(1)
}

// Hard guard: this script writes rows. It must never see a hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  process.exit(1)
}
const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')
const CLEAR = process.argv.includes('--clear')

const url = new URL(raw)
url.searchParams.delete('sslmode')
url.searchParams.delete('connection_limit')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 5 }) })

const TENANT = '0000000d-0000-4000-8000-000000000001'

// -----------------------------------------------------------------------
// Deterministic ids — this is what makes the script idempotent.
// -----------------------------------------------------------------------

// Fixed namespace for this script's own remark ids. Never reuse the app's
// SUMMARY_NAMESPACE — that one derives context_id, this one derives the
// remark row id itself, a different value with a different purpose.
const SEED_NAMESPACE = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function uuidv5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Force plain ASCII: normalise smart quotes/dashes that could sneak in from
// database-sourced strings (deal/entity names), and fail loudly on anything
// else non-ASCII rather than write it silently.
function sanitizeAscii(s) {
  const normalised = s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
  const bad = [...normalised].filter(ch => ch.charCodeAt(0) > 127)
  if (bad.length > 0) {
    throw new Error(`Non-ASCII character(s) ${JSON.stringify(bad)} in body: ${normalised.slice(0, 80)}`)
  }
  return normalised
}

function remarkId(seedKey) {
  return uuidv5(`seed-conversation:${seedKey}`, SEED_NAMESPACE)
}

// Same derivation as src/app/api/remarks/_context.ts — must match exactly or
// the thread will not open.
const SUMMARY_NAMESPACE = '6f1d3c22-0f1a-4a3e-9c5b-2f7d8a41e0b3'
function summaryContextId(kind, userId, period) {
  return uuidv5(`${kind}:${userId}:${period}`, SUMMARY_NAMESPACE)
}

// -----------------------------------------------------------------------
// Users (from scripts/seed-dev.mjs — fixed ids, so no lookup needed for these)
// -----------------------------------------------------------------------
const RAVI = '0000000d-0000-4000-8000-000000000101' // admin
const PRIYA = '0000000d-0000-4000-8000-000000000102' // sales manager
const AMIT = '0000000d-0000-4000-8000-000000000103' // rep
const SUNITA = '0000000d-0000-4000-8000-000000000104' // rep
const IMRAN = '0000000d-0000-4000-8000-000000000105' // rep

function daysAgo(n, hour = 10, minute = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hour, minute, 0, 0)
  return d
}

async function main() {
  // ---- Discover real context rows (never invent ids) ----
  const deals = await prisma.deals.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, name: true, owner_user_id: true },
    orderBy: { id: 'asc' },
  })
  const orders = await prisma.orders.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, user_id: true, entity_name: true },
    orderBy: { id: 'asc' },
  })
  const visits = await prisma.daily_visits.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, user_id: true, entity_name: true },
    orderBy: { id: 'asc' },
  })
  const weeklyPlans = await prisma.weekly_plans.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, user_id: true, week_start_date: true },
    orderBy: { id: 'asc' },
  })
  const weeklyPlanItems = await prisma.weekly_plan_items.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, weekly_plan_id: true },
    orderBy: { id: 'asc' },
  })
  const expenses = await prisma.expenses.findMany({
    where: { tenant_id: TENANT },
    select: { id: true, user_id: true },
    orderBy: { id: 'asc' },
  })

  if (deals.length === 0 || orders.length === 0 || visits.length === 0) {
    console.error('Demo tenant is missing deals/orders/visits — run `npm run dev:seed` first.')
    process.exit(1)
  }

  const dealByOwner = id => deals.find(d => d.owner_user_id === id) ?? deals[0]
  const orderByOwner = id => orders.find(o => o.user_id === id) ?? orders[0]
  const visitByOwner = id => visits.find(v => v.user_id === id) ?? visits[0]
  const wpByOwner = id => weeklyPlans.find(w => w.user_id === id) ?? weeklyPlans[0]
  const wpItemFor = planId => weeklyPlanItems.find(i => i.weekly_plan_id === planId) ?? weeklyPlanItems[0]
  const expenseByOwner = id => expenses.find(e => e.user_id === id) ?? expenses[0]

  const amitDeal = dealByOwner(AMIT)
  const sunitaDeal = dealByOwner(SUNITA)
  const imranDeal = dealByOwner(IMRAN)
  const sunitaOrder = orderByOwner(SUNITA)
  const imranOrder = orderByOwner(IMRAN)
  const amitVisit = visitByOwner(AMIT)
  const sunitaVisit = visitByOwner(SUNITA)
  const amitPlan = wpByOwner(AMIT)
  const amitExpense = expenseByOwner(AMIT)
  const imranExpense = expenseByOwner(IMRAN)

  // day helper: week_start_date -> YYYY-MM-DD
  const toDay = d => d.toISOString().slice(0, 10)

  // ---- Build the thread list -------------------------------------------------
  // Each "thread" is a list of remarks. `read` marks which author/recipient
  // combination should have a remark_reads row (so the screen shows both
  // read and unread states). context_id_fn lets summary threads compute
  // their id lazily (they need the owner + period, not a row lookup).

  const threads = []

  // 1) Deal note — competitor pricing, multi-message, not limited to one reply.
  threads.push({
    key: 'deal-competitor-pricing',
    context_type: 'deal',
    context_id: amitDeal.id,
    messages: [
      {
        key: 'm1',
        author: AMIT,
        body: `Visited ${amitDeal.name.replace(/\s*\(new\)\s*[-–—]\s*migrated/i, '').replace(/[–—]/g, '-')} again today. Owner mentioned Bharat Agro is quoting 8% below our list price on the same NPK grade. He is not ready to switch yet but wanted to see if we can match.`,
        at: daysAgo(12, 11, 15),
      },
      {
        key: 'm2',
        author: PRIYA,
        body: `Do not match on price directly. Offer the extended credit terms instead (45 days vs their 30) and remind him about the free soil-testing camp next month. Let me know how he responds.`,
        at: daysAgo(11, 9, 30),
      },
      {
        key: 'm3',
        author: AMIT,
        body: `Told him about the credit terms and the soil-testing camp. He is interested in the camp but still comparing prices with two other dealers before committing. Following up next week.`,
        at: daysAgo(10, 16, 45),
      },
    ],
  })

  // 2) Manager asks for outcome, executive replies — meeting minutes style.
  threads.push({
    key: 'meeting-outcome-request',
    context_type: 'meeting',
    context_id: amitVisit.id,
    messages: [
      {
        key: 'm1',
        author: PRIYA,
        body: `This visit is marked complete but the outcome field is blank. Please add what was actually discussed and whether an order is expected.`,
        at: daysAgo(9, 18, 0),
      },
      {
        key: 'm2',
        author: AMIT,
        body: `Sorry, updating now. Discussed the new pesticide line and pricing for the monsoon season. He wants a sample batch before placing a full order - should reach him again in about 10 days.`,
        at: daysAgo(9, 18, 40),
      },
    ],
  })

  // 3) Query on an expense.
  threads.push({
    key: 'expense-query',
    context_type: 'expense',
    context_id: amitExpense.id,
    messages: [
      {
        key: 'm1',
        author: PRIYA,
        body: `This travel claim is higher than your usual route to this territory. Was there a detour, or is this two visits combined into one claim?`,
        at: daysAgo(7, 10, 5),
      },
      {
        key: 'm2',
        author: AMIT,
        body: `Combined two visits on the same day since both dealers are on the same road - Sardar Krishi Kendra in the morning and Shree Krishna Agencies in the afternoon. Can split the claim if that is preferred.`,
        at: daysAgo(7, 14, 20),
      },
    ],
  })

  // 4) Minutes on a meeting — Sunita's visit.
  threads.push({
    key: 'meeting-minutes-sunita',
    context_type: 'meeting',
    context_id: sunitaVisit.id,
    messages: [
      {
        key: 'm1',
        author: SUNITA,
        body: `Meeting minutes: met the purchase head, walked through the new seed catalogue, and left samples of the hybrid maize variety. He asked for a formal quotation for a 50-bag trial order.`,
        at: daysAgo(6, 12, 0),
      },
      {
        key: 'm2',
        author: PRIYA,
        body: `Good. Send the quotation by tomorrow and copy me so I can track the trial order separately.`,
        at: daysAgo(6, 15, 30),
      },
      {
        key: 'm3',
        author: SUNITA,
        body: `Quotation sent this morning. He confirmed receipt and said he will revert by Friday.`,
        at: daysAgo(5, 9, 10),
      },
    ],
  })

  // 5) Order note — delivery timing.
  threads.push({
    key: 'order-note-sunita',
    context_type: 'order',
    context_id: sunitaOrder.id,
    messages: [
      {
        key: 'm1',
        author: SUNITA,
        body: `Order for ${sunitaOrder.entity_name} confirmed. Customer specifically asked for delivery before the 20th because of the sowing window - please flag this to logistics.`,
        at: daysAgo(4, 11, 0),
      },
      {
        key: 'm2',
        author: RAVI,
        body: `Flagged to the warehouse team. They confirmed dispatch by the 18th, which gives two days of buffer.`,
        at: daysAgo(3, 17, 0),
      },
    ],
  })

  // 6) Deal note on a second deal, different rep, shorter thread.
  threads.push({
    key: 'deal-note-imran',
    context_type: 'deal',
    context_id: imranDeal.id,
    messages: [
      {
        key: 'm1',
        author: IMRAN,
        body: `Owner is close to signing but wants the deal_stage moved to negotiation before he commits verbally - mostly wants to see it reflected on our side too.`,
        at: daysAgo(2, 10, 30),
      },
    ],
  })

  // 7) Order note on Imran's order.
  threads.push({
    key: 'order-note-imran',
    context_type: 'order',
    context_id: imranOrder.id,
    messages: [
      {
        key: 'm1',
        author: IMRAN,
        body: `Customer requested an extra 10 units at the last minute - added to the order before dispatch, invoice updated accordingly.`,
        at: daysAgo(1, 13, 0),
      },
    ],
  })

  // 8) Weekly plan day comment — manager asks about a specific day's plan.
  if (amitPlan) {
    const item = wpItemFor(amitPlan.id)
    threads.push({
      key: 'weekly-plan-day-amit',
      context_type: 'weekly_plan_day',
      context_id: item.id,
      messages: [
        {
          key: 'm1',
          author: PRIYA,
          body: `Tuesday's plan only has one dealer visit listed. Can you add a second stop in the same area so the day is not underused?`,
          at: daysAgo(8, 9, 0),
        },
        {
          key: 'm2',
          author: AMIT,
          body: `Added a distributor visit in the same taluka right after. Updated the plan.`,
          at: daysAgo(8, 12, 15),
        },
      ],
    })

    // 9) Weekly plan (whole-week) comment.
    threads.push({
      key: 'weekly-plan-amit',
      context_type: 'weekly_plan',
      context_id: amitPlan.id,
      messages: [
        {
          key: 'm1',
          author: PRIYA,
          body: `Approved for this week. Good mix of new and existing accounts - keep the Institution visit on Thursday, that one matters for the quarter.`,
          at: daysAgo(13, 8, 45),
        },
      ],
    })
  }

  // 10) Daily summary — one manager comment + one reply, per §6.5.
  {
    const period = toDay(daysAgo(3))
    threads.push({
      key: 'daily-summary-sunita',
      context_type: 'daily_summary',
      context_id_fn: () => summaryContextId('daily_summary', SUNITA, period),
      messages: [
        {
          key: 'm1',
          author: PRIYA,
          body: `Three visits logged today but no order attached to any of them. Was that intentional, or did an order get missed on entry?`,
          at: daysAgo(3, 19, 0),
        },
        {
          key: 'm2',
          author: SUNITA,
          body: `No orders today, all three were relationship visits ahead of the trial-order quotation I sent. Expect the order to come through later this week.`,
          at: daysAgo(3, 19, 20),
        },
      ],
    })
  }

  // 11) Weekly summary — one comment + one reply.
  {
    const period = toDay(daysAgo(14))
    threads.push({
      key: 'weekly-summary-amit',
      context_type: 'weekly_summary',
      context_id_fn: () => summaryContextId('weekly_summary', AMIT, period),
      messages: [
        {
          key: 'm1',
          author: PRIYA,
          body: `Strong week - highest visit count on the team and two new leads opened. Keep this pace into next week, especially around the Green Field Traders account.`,
          at: daysAgo(14, 20, 0),
        },
        {
          key: 'm2',
          author: AMIT,
          body: `Thanks. Green Field Traders is the priority for next week, planning two follow-up visits already.`,
          at: daysAgo(13, 8, 0),
        },
      ],
    })
  }

  // 12) Another daily summary, unread, for Imran — manager comment only (no reply yet).
  {
    const period = toDay(daysAgo(1))
    threads.push({
      key: 'daily-summary-imran',
      context_type: 'daily_summary',
      context_id_fn: () => summaryContextId('daily_summary', IMRAN, period),
      messages: [
        {
          key: 'm1',
          author: PRIYA,
          body: `Good coverage today. One thing to check: the expense claim logged this afternoon does not have a photo attached - please upload it when you get a chance.`,
          at: daysAgo(1, 21, 0),
        },
      ],
    })
  }

  // 13) Expense query on Imran's expense, unread by Priya.
  threads.push({
    key: 'expense-query-imran',
    context_type: 'expense',
    context_id: imranExpense.id,
    messages: [
      {
        key: 'm1',
        author: IMRAN,
        body: `Uploading the receipt photo now, it did not attach the first time because of a weak signal at the dealer's shop.`,
        at: daysAgo(0, 9, 0),
      },
    ],
  })

  return threads
}

async function run() {
  const threads = await main()

  // Resolve context ids for the ones that need a derivation.
  for (const t of threads) {
    if (t.context_id_fn) t.context_id = t.context_id_fn()
  }

  const rows = []
  for (const t of threads) {
    let parentId = null
    for (const m of t.messages) {
      const id = remarkId(`${t.key}:${m.key}`)
      rows.push({
        id,
        tenant_id: TENANT,
        context_type: t.context_type,
        context_id: t.context_id,
        parent_remark_id: parentId,
        author_user_id: m.author,
        // Safety net: any interpolated field (deal/order/entity names read
        // from the database) could carry a non-ASCII dash or similar. Force
        // plain ASCII punctuation so no U+FFFD or smart-typography sneaks in.
        body: sanitizeAscii(m.body),
        created_at: m.at,
        updated_at: m.at,
        threadKey: t.key,
      })
      parentId = id
    }
  }

  // Mark some remarks as read by specific users, to mix read/unread threads.
  // Leave the newest remarks (0, 1 days ago) and the last item of each
  // thread's summary unread so the list shows both states.
  const readMarks = []
  for (const r of rows) {
    if (r.threadKey === 'expense-query-imran') continue // unread
    if (r.threadKey === 'daily-summary-imran') continue // unread
    // Mark read by Priya (manager) for threads she is not the sole author of.
    readMarks.push({ remark: r, user: PRIYA })
  }

  console.log(`Prepared ${rows.length} remarks across ${threads.length} threads.`)
  if (DRY_RUN) {
    for (const r of rows) {
      console.log(`  [${r.threadKey}] ${r.context_type}/${r.context_id} <- ${r.author_user_id}: ${r.body.slice(0, 60)}...`)
    }
    console.log('Dry run only — nothing written.')
    await prisma.$disconnect()
    return
  }

  if (CLEAR) {
    const ids = rows.map(r => r.id)
    const delReads = await prisma.remark_reads.deleteMany({ where: { remark_id: { in: ids } } })
    const delRemarks = await prisma.contextual_remarks.deleteMany({ where: { id: { in: ids } } })
    console.log(`Deleted ${delRemarks.count} remarks and ${delReads.count} read-marks.`)
    await prisma.$disconnect()
    return
  }

  for (const r of rows) {
    await prisma.contextual_remarks.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        tenant_id: r.tenant_id,
        context_type: r.context_type,
        context_id: r.context_id,
        parent_remark_id: r.parent_remark_id,
        author_user_id: r.author_user_id,
        body: r.body,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
      update: {
        context_type: r.context_type,
        context_id: r.context_id,
        parent_remark_id: r.parent_remark_id,
        author_user_id: r.author_user_id,
        body: r.body,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    })
  }

  for (const { remark, user } of readMarks) {
    await prisma.remark_reads.upsert({
      where: { remark_id_user_id: { remark_id: remark.id, user_id: user } },
      create: { tenant_id: TENANT, remark_id: remark.id, user_id: user },
      update: {},
    })
  }

  console.log(`Wrote ${rows.length} remarks and ${readMarks.length} read-marks.`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
