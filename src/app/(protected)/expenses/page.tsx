'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReceiptIcon } from 'lucide-react'

import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneList, PhoneListRow, type PhoneListState } from '@/components/ui/phone-list'

/**
 * Phone Expenses list — docs/phone-plan.md §3. There is no standalone
 * expenses page on desktop; expenses live inside Daily Activity's Expenses
 * tab, so a desktop hit on this new phone-only URL redirects there.
 *
 * Data: `GET /api/expenses?from=&to=` (gated `expenses:view`), extended for
 * this screen to accept a date range — see the comment in
 * src/app/api/expenses/route.ts. Permission-aware: the whole screen is
 * reached only from the More row, which is itself hidden without
 * `expenses:view` (see more/page.tsx).
 */

type Expense = {
  id: string
  expense_date: string
  category: string
  amount: number
  notes: string | null
  photo_url: string | null
}

type RangeKey = 'week' | 'month'

function todayLocal(): string {
  // Client-side only: the rep's own phone clock, in their own local time —
  // not the server-clock rule in CLAUDE.md, which is about server code.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return toStr(d)
}

function startOfMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(1)
  return toStr(d)
}

function toStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatAmount(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function ExpensesPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const me = useMe()

  const [range, setRange] = useState<RangeKey>('week')
  const [search, setSearch] = useState('')
  const [state, setState] = useState<PhoneListState>('loading')
  const [rows, setRows] = useState<Expense[]>([])
  // Counts for the chip the user is NOT currently viewing (§41.5 rules 20-21
  // want a real count on every chip, not just the active one) — fetched
  // separately since the main list only ever holds one range at a time.
  const [otherCount, setOtherCount] = useState(0)

  const today = useMemo(() => todayLocal(), [])
  const weekStart = useMemo(() => startOfWeek(today), [today])
  const monthStart = useMemo(() => startOfMonth(today), [today])

  usePhoneAppBar({ title: 'Expenses', back: '/more' })

  const load = useCallback(async () => {
    setState('loading')
    try {
      const from = range === 'week' ? weekStart : monthStart
      const res = await fetch(`/api/expenses?from=${from}&to=${today}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
      setState('ready')
    } catch {
      setState('failed')
    }
  }, [range, weekStart, monthStart, today])

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace('/daily-activity')
      return
    }
    void load()
  }, [layout, router, load])

  // Background-only: the chip for the range NOT being viewed still needs a
  // real count, not a misleading 0.
  useEffect(() => {
    if (layout === 'desktop') return
    const otherFrom = range === 'week' ? monthStart : weekStart
    fetch(`/api/expenses?from=${otherFrom}&to=${today}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => setOtherCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setOtherCount(0))
  }, [layout, range, weekStart, monthStart, today])

  if (layout === 'desktop') return null

  const filtered = search.trim()
    ? rows.filter(r => r.category.toLowerCase().includes(search.trim().toLowerCase()))
    : rows

  const weekTotal = rows.reduce((sum, r) => sum + Number(r.amount), 0)

  // Matches POST /api/expenses (expenses:create). Undefined until /me answers.
  const canCreate = me ? Boolean(me.permissions?.expenses?.create) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
        <p className="text-label text-text-secondary">
          {range === 'week' ? 'This week' : 'This month'}
        </p>
        <p className="text-card-heading font-medium text-text-primary">{formatAmount(weekTotal)}</p>
      </div>

      <PhoneList
        state={state}
        onRetry={load}
        onRefresh={load}
        noun={{ one: 'expense', many: 'expenses' }}
        rows={filtered}
        total={filtered.length}
        rowKey={r => r.id}
        search={{ value: search, onChange: setSearch }}
        filters={{
          label: 'Period',
          value: range,
          onChange: value => setRange((value as RangeKey) ?? 'week'),
          chips: [
            { value: 'week', label: 'This week', count: range === 'week' ? rows.length : otherCount },
            { value: 'month', label: 'This month', count: range === 'month' ? rows.length : otherCount },
          ],
        }}
        add={{
          label: 'Add expense',
          href: '/expenses/new',
          allowed: canCreate,
          reason: 'Only someone who can create expenses can add one',
        }}
        empty={
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ReceiptIcon className="size-8 text-text-muted" aria-hidden />
            <p className="text-body font-medium text-text-primary">No expenses yet</p>
            <p className="text-body text-text-muted">Tap + to add one.</p>
          </div>
        }
        renderRow={r => (
          <PhoneListRow
            href={`/expenses/${r.id}?date=${r.expense_date}`}
            name={r.category}
            amount={formatAmount(Number(r.amount))}
            facts={[formatDate(r.expense_date)]}
            meta={r.photo_url ? 'Receipt attached' : undefined}
          />
        )}
      />
    </div>
  )
}
