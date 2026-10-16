'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, PhoneFormMore, usePhoneFormGuard } from '@/components/ui/phone-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { PhotoCapture, uploadExpensePhoto, type CapturedPhoto } from '@/components/ui/photo-capture'

/**
 * Phone "Add expense" — docs/phone-plan.md §3. `POST /api/expenses`
 * (gated `expenses:create`), fields per `src/app/api/expenses/route.ts`:
 * required `expense_date` (defaults to today, must be <= today),
 * `category`, `amount`; optional `notes`, `photo_url`.
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

  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState<PickerOption | null>(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = Boolean(category || amount || notes || photos.length > 0 || date !== todayLocal())
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  usePhoneAppBar({
    title: 'Add expense',
    back: '/expenses',
  })

  useEffect(() => {
    if (layout === 'desktop') {
      router.replace('/daily-activity')
      return
    }
    fetch('/api/masters/expense-categories')
      .then(r => r.json())
      .then(data => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
  }, [layout, router])

  if (layout === 'desktop') return null

  function goBack() {
    requestLeave(() => router.push('/expenses'))
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
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_date: date,
          category: category.label,
          amount: amountNum,
          notes: notes.trim() || undefined,
          photo_url: photoUrl,
        }),
      })
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}))
        setError(failure.error ?? 'Could not save the expense. Try again.')
        return
      }
      toast('Expense saved.', 'success')
      router.push('/expenses')
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

      {error ? <p className="text-body text-danger">{error}</p> : null}

      <PhoneForm saving={saving} onSave={save} changed={changed}>
        <PhoneFormField label="Category">
          <StaticPickerSheetField
            label="Category"
            placeholder="Select category"
            value={category}
            onChange={setCategory}
            options={categories.map(c => ({ id: c.id, label: c.name }))}
          />
        </PhoneFormField>

        <PhoneFormField label="Amount">
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

        <PhoneFormField label="Date">
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
