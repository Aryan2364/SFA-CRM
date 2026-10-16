'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { RecordSummary } from '@/components/ui/record-summary'

/**
 * Phone Expenses detail — read-only, full-screen receipt photo. There is no
 * standalone desktop expense record (expenses are rows inside Daily
 * Activity's Expenses tab), so desktop redirects there.
 *
 * Data: the expense is already on the phone (list fetched it), but this
 * screen can be reached directly (deep link/back-forward), so it re-fetches
 * from `GET /api/expenses?from=&to=` for the row's own date and picks it out
 * — there is no single-expense GET route.
 */

type Expense = {
  id: string
  expense_date: string
  category: string
  amount: number
  notes: string | null
  photo_url: string | null
}

function formatAmount(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ExpenseDetailPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const dateHint = searchParams.get('date')
  const [state, setState] = useState<'loading' | 'failed' | 'ready' | 'missing'>('loading')
  const [expense, setExpense] = useState<Expense | null>(null)

  usePhoneAppBar({ title: 'Expense', back: '/expenses' })

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace('/daily-activity')
      return
    }
    let cancelled = false
    async function load() {
      setState('loading')
      try {
        // No single-expense GET route exists. The list page passes the
        // row's own date in `?date=`, which narrows this to one day's rows;
        // without that hint (a direct deep link) it falls back to a wide
        // range, which still only ever returns this user's own rows.
        const from = dateHint ?? '2000-01-01'
        const to = dateHint ?? '2100-01-01'
        const probe = await fetch(`/api/expenses?from=${from}&to=${to}`)
        if (!probe.ok) throw new Error('failed')
        const rows: Expense[] = await probe.json()
        if (cancelled) return
        const found = rows.find(r => r.id === params.id) ?? null
        setExpense(found)
        setState(found ? 'ready' : 'missing')
      } catch {
        if (!cancelled) setState('failed')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [layout, router, params.id, dateHint])

  if (layout === 'desktop') return null

  if (state === 'loading') {
    return <p className="px-1 py-6 text-body text-text-muted">Loading…</p>
  }
  if (state === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">This expense could not be loaded</p>
        <p className="text-body text-text-muted">Check your connection and try again.</p>
      </div>
    )
  }
  if (state === 'missing' || !expense) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">Expense not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <RecordSummary
        name={expense.category}
        meta={formatDateLong(expense.expense_date)}
        facts={[{ label: 'Amount', value: formatAmount(Number(expense.amount)) }]}
      />
      {expense.notes ? (
        <div className="rounded-xl border border-border-light bg-surface p-4">
          <p className="text-label text-text-secondary">Notes</p>
          <p className="mt-1 text-body text-text-primary">{expense.notes}</p>
        </div>
      ) : null}
      {expense.photo_url ? (
        <div className="overflow-hidden rounded-xl border border-border-light bg-surface-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={expense.photo_url} alt="Receipt" className="w-full object-contain" />
        </div>
      ) : (
        <p className="text-body text-text-muted">No receipt photo.</p>
      )}
    </div>
  )
}
