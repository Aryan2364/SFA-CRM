'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { loadList } from '@/lib/load-list'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { PhotoCapture, uploadExpensePhoto, type CapturedPhoto } from '@/components/ui/photo-capture'

/**
 * Phone "Add expense" — docs/phone-plan.md §3. `POST /api/expenses`
 * (gated `expenses:create`), fields per `src/app/api/expenses/route.ts`:
 * required `expense_date` (defaults to today, must be <= today),
 * `category`, `amount`; optional `notes`, `photo_url`.
 *
 * `?date=YYYY-MM-DD` prefills the date — Daily Activity's Expenses tab
 * passes the day it is already looking at, so adding from there does not
 * silently file against today instead.
 *
 * `?id=<uuid>` switches this same screen into "Edit expense" (round 2):
 * loads the row through the same date-scoped probe the detail screen uses
 * (there is no single-expense GET), then saves through `PUT
 * /api/expenses/[id]` instead of POST.
 *
 * There is no standalone desktop equivalent — expenses are added from
 * Daily Activity's Expenses tab — so desktop visits of this phone-only
 * URL redirect there.
 */

type Category = { id: string; name: string }

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function NewExpensePage() {
  const { layout } = useLayout()
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const editId = searchParams.get('id')
  const dateParam = searchParams.get('date')

  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState<PickerOption | null>(null)
  // A failed category load is its own state, not an empty picker.
  const [catFailed, setCatFailed] = useState(false)
  const [catTry, setCatTry] = useState(0)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dateParam ?? todayLocal())
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editId))
  const [savedOnce, setSavedOnce] = useState(false)

  const changed = Boolean(category || amount || notes || photos.length > 0 || date !== (dateParam ?? todayLocal()))
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  usePhoneAppBar({
    title: editId ? 'Edit expense' : 'Add expense',
    back: editId ? `/expenses/${editId}` : '/expenses',
  })

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace('/daily-activity')
      return
    }
    let live = true
    setCatFailed(false)
    loadList<Category>('/api/masters/expense-categories').then(res => {
      if (!live) return
      if (res.ok) setCategories(res.data)
      else setCatFailed(true)
    })
    return () => { live = false }
  }, [layout, router, catTry])

  // Edit mode: load the existing row through the same date-scoped probe the
  // detail screen uses (there is no single-expense GET route).
  useEffect(() => {
    if (!editId) return
    let live = true
    const from = dateParam ?? '2000-01-01'
    const to = dateParam ?? '2100-01-01'
    fetch(`/api/expenses?from=${from}&to=${to}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows: { id: string; expense_date: string; category: string; amount: number; notes: string | null }[]) => {
        if (!live) return
        const row = rows.find(r => r.id === editId)
        if (!row) {
          setError('This expense could not be found.')
          return
        }
        setCategory({ id: row.category, label: row.category })
        setAmount(String(row.amount))
        setDate(row.expense_date)
        setNotes(row.notes ?? '')
      })
      .catch(() => setError('This expense could not be loaded.'))
      .finally(() => { if (live) setLoadingExisting(false) })
    return () => { live = false }
  }, [editId, dateParam])

  if (layout === 'desktop') return null

  function goBack() {
    requestLeave(() => router.push(editId ? `/expenses/${editId}` : '/expenses'))
  }

  async function save() {
    if (saving) return
    setError(null)
    if (!category) {
      setError('Choose a category.')
      return
    }
    const amountNum = Number(amount)
    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }
    if (!date) {
      setError('Choose a date.')
      return
    }
    const uploading = photos.some(p => p.status === 'uploading')
    if (uploading) {
      setError('Wait for the photo to finish uploading.')
      return
    }
    const photoUrl = photos.find(p => p.status === 'done')?.url ?? null

    setSaving(true)
    try {
      const res = await fetch(editId ? `/api/expenses/${editId}` : '/api/expenses', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_date: date,
          category: category.label,
          amount: amountNum,
          notes: notes.trim() || undefined,
          ...(editId ? {} : { photo_url: photoUrl }),
        }),
      })
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}))
        setError(failure.error ?? 'Could not save the expense. Try again.')
        return
      }
      if (editId) {
        toast('Expense updated.', 'success')
        router.push(`/expenses/${editId}`)
        return
      }
      toast('Expense saved.', 'success')
      setSavedOnce(true)
      setCategory(null)
      setAmount('')
      setNotes('')
      setPhotos([])
    } catch {
      setError('Could not save the expense. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={goBack}
        className="self-start text-body text-primary"
      >
        ← Back
      </button>

      {savedOnce && !editId ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-success-border bg-success-bg px-3 py-2">
          <p className="text-body text-success">Expense saved.</p>
          <Button variant="secondary" onClick={() => router.push('/expenses')}>
            Done
          </Button>
        </div>
      ) : null}

      {loadingExisting ? <p className="text-body text-text-muted">Loading…</p> : null}
      {error ? <p className="text-body text-danger">{error}</p> : null}

      <PhoneForm saving={saving} onSave={save} changed={changed}>
        <PhoneFormField label="Category" required>
          <StaticPickerSheetField
            label="Category"
            placeholder="Select category"
            value={category}
            onChange={setCategory}
            options={categories.map(c => ({ id: c.id, label: c.name }))}
          />
          {catFailed ? (
            <div className="mt-2 flex items-center gap-3">
              <p className="text-label text-danger">Couldn&apos;t load categories.</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCatTry(n => n + 1)}>
                Retry
              </Button>
            </div>
          ) : null}
        </PhoneFormField>

        <PhoneFormField label="Amount" required>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Date" required>
          <Input
            type="date"
            value={date}
            max={todayLocal()}
            onChange={e => setDate(e.target.value)}
            style={{ fontSize: 16 }}
          />
        </PhoneFormField>

        <PhoneFormField label="Receipt">
          <PhotoCapture photos={photos} onChange={setPhotos} upload={uploadExpensePhoto} label="Receipt" max={1} />
        </PhoneFormField>

        <PhoneFormMore summary="More details">
          <PhoneFormField label="Notes">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes"
              style={{ fontSize: 16 }}
            />
          </PhoneFormField>
        </PhoneFormMore>
      </PhoneForm>
      {warning}
    </div>
  )
}
