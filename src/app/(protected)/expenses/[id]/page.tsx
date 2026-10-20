'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { EllipsisVerticalIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { RecordSummary } from '@/components/ui/record-summary'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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
  user_id: string
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
  const { toast } = useToast()
  const me = useMe()
  const [state, setState] = useState<'loading' | 'failed' | 'ready' | 'missing'>('loading')
  const [expense, setExpense] = useState<Expense | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Edit and delete are owner-only (api/expenses/[id]): a manager who can see
  // a team member's expense here may read it but not change it.
  const isOwn: boolean | null = me && expense ? expense.user_id === me.userId : null
  const canEdit: boolean | null = me ? Boolean(me.permissions?.expenses?.edit) && isOwn === true : null
  const canDelete: boolean | null = me ? Boolean(me.permissions?.expenses?.delete) && isOwn === true : null

  const menu = useMemo(() => {
    if (state !== 'ready') return undefined
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More actions"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
            />
          }
        >
          <EllipsisVerticalIcon aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            className="h-11"
            disabled={canEdit !== true}
            onClick={() => router.push(`/expenses/new?id=${params.id}${dateHint ? `&date=${dateHint}` : ''}`)}
          >
            <PencilIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-11 text-danger"
            disabled={canDelete !== true}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
          {isOwn === false ? (
            <p className="px-2 py-1.5 text-label text-text-muted">
              Only the person who added this expense can change it.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, canEdit, canDelete, isOwn, params.id, dateHint, router])

  usePhoneAppBar({ title: 'Expense', back: '/expenses', menu })

  async function remove() {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/expenses/${params.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(body.error ?? 'Could not delete this expense.', 'error')
        return
      }
      toast('Expense deleted.', 'success')
      router.push('/expenses')
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
