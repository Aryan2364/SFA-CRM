'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageSquareIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtAmount } from '@/lib/format'
import { AddExpenseDialog } from './add-expense-dialog'
import { Expense } from './types'

/**
 * Expenses for the day in view. There is no separate expenses route in
 * this product — this tab is the whole expenses UI.
 *
 * §5.3 rule 4: the only thing that stops an expense being added is the
 * date being in the future, which the server enforces too. Check-out is
 * not consulted anywhere in this file.
 */
export function ExpensesTab({
  selectedDate,
  isFuture,
  canAdd,
  canDelete,
  expenses,
  loading,
  onReload,
  onOpenRemarks,
}: {
  selectedDate: string
  isFuture: boolean
  canAdd: boolean
  canDelete: boolean
  expenses: Expense[]
  loading: boolean
  onReload: () => void
  onOpenRemarks: (id: string) => void
}) {
  const { toast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null)

  const handleAdd = useCallback(
    async (partial: Partial<Expense>) => {
      const r = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...partial, expense_date: selectedDate }),
      })
      if (!r.ok) { toast((await r.json()).error ?? 'Failed to save the expense', 'error'); return }
      setShowAdd(false)
      onReload()
    },
    [selectedDate, onReload]
  )

  async function confirmDelete() {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    const r = await fetch(`/api/expenses/${target.id}`, { method: 'DELETE' })
    if (!r.ok) { toast('Failed to delete the expense', 'error'); return }
    onReload()
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body text-text-secondary">
          {expenses.length} expense{expenses.length === 1 ? '' : 's'} ·{' '}
          <span className="font-medium tabular-nums text-text-primary">{fmtAmount(total)}</span>
        </span>
        {canAdd && !isFuture && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <PlusIcon />
            Add expense
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : expenses.length === 0 ? (
        <EmptyState
          variant="nothing-yet"
          heading="No expenses on this day"
          actionLabel="Add expense"
          onAction={canAdd && !isFuture ? () => setShowAdd(true) : undefined}
        >
          {isFuture
            ? 'Expenses cannot be claimed for a future date.'
            : 'Travel, food and anything else claimed against this day appears here.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {expenses.map(exp => (
            <div key={exp.id} className="flex flex-col rounded-xl border border-border-light bg-surface">
              <div className="flex flex-1 flex-col gap-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="neutral">{exp.category}</Badge>
                  <span className="text-card-heading font-medium tabular-nums text-text-primary">
                    {fmtAmount(exp.amount)}
                  </span>
                </div>
                {exp.notes && <p className="text-body text-text-secondary">{exp.notes}</p>}
                {exp.photo_url && (
                  <a href={exp.photo_url} target="_blank" rel="noopener noreferrer" className="mt-1">
                    <img
                      src={exp.photo_url}
                      alt="Receipt"
                      className="h-20 w-auto rounded-lg border border-border-light object-cover transition-opacity duration-200 hover:opacity-90"
                    />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 border-t border-border-light px-4 py-2.5">
                <Button size="sm" variant="ghost" aria-label="Remarks" onClick={() => onOpenRemarks(exp.id)}>
                  <MessageSquareIcon />
                </Button>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete expense"
                    className="ml-auto"
                    onClick={() => setPendingDelete(exp)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddExpenseDialog open={showAdd} onOpenChange={setShowAdd} onAdd={handleAdd} />

      {/* A styled confirmation, portalled to body by the kit. The legacy
          screen deleted an expense on a single click with no confirmation
          at all. */}
      <AlertDialog open={!!pendingDelete} onOpenChange={v => { if (!v) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.category} · ${fmtAmount(pendingDelete.amount)} will be removed from this day. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
