'use client'

import { useEffect, useState } from 'react'
import { UploadIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Expense } from './types'

/**
 * The expenses UI lives inside Daily Activity — there is no separate
 * expenses route — so this dialog is part of P3-T5's surface.
 *
 * The receipt goes to R2 through `/api/expenses/upload` BEFORE the
 * expense row is written, because `expenses.photo_url` stores the
 * app-relative read path and the row cannot be written without it.
 * The bucket is private; the photo is read back through
 * `/api/expenses/photo/[id]`, never from an R2 address.
 */
export function AddExpenseDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAdd: (e: Partial<Expense>) => Promise<void> | void
}) {
  const { toast } = useToast()
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!open) return
    fetch('/api/masters/expense-categories')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCategories(d) })
      .catch(() => toast('Failed to load expense categories', 'error'))
  }, [open])

  // Reset between openings, so a cancelled entry does not come back.
  useEffect(() => {
    if (open) return
    setCategory(''); setAmount(''); setNotes('')
    setPhotoFile(null); setPhotoError(null)
    setPhotoPreview(p => { if (p) URL.revokeObjectURL(p); return null })
  }, [open])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoError(null)
    if (!file) { setPhotoFile(null); setPhotoPreview(null); return }
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      setPhotoError('Only JPG and PNG files are allowed.')
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('The photo must be 5 MB or less.')
      e.target.value = ''
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleSubmit() {
    if (!category || !amount || Number(amount) <= 0) return
    setSubmitting(true)
    let photo_url: string | null = null
    if (photoFile) {
      const fd = new FormData()
      fd.append('file', photoFile)
      const r = await fetch('/api/expenses/upload', { method: 'POST', body: fd })
      if (!r.ok) {
        setPhotoError((await r.json()).error ?? 'The upload failed.')
        setSubmitting(false)
        return
      }
      photo_url = (await r.json()).url
    }
    await onAdd({ category, amount: Number(amount), notes: notes || null, photo_url })
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>Claimed against the day currently in view.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="da-exp-category">Category</Label>
            <Select value={category} onValueChange={v => setCategory(String(v))}>
              <SelectTrigger id="da-exp-category" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="da-exp-amount">Amount (₹)</Label>
            <Input
              id="da-exp-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="da-exp-notes">Notes</Label>
            <Input id="da-exp-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional description" />
          </div>

          <div className="space-y-1.5">
            <Label>Receipt photo</Label>
            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Receipt preview"
                  className="max-h-48 w-full rounded-lg border border-border-light bg-surface-sunken object-contain"
                />
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-2 right-2"
                  aria-label="Remove photo"
                  onClick={() => {
                    setPhotoFile(null)
                    setPhotoError(null)
                    setPhotoPreview(p => { if (p) URL.revokeObjectURL(p); return null })
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            ) : (
              <label className="flex min-h-11 cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-text-muted transition-colors duration-200 hover:border-primary-border">
                <UploadIcon className="size-5" />
                <span className="text-body">JPG or PNG, up to 5 MB</span>
                <input type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handleFileChange} />
              </label>
            )}
            {photoError && <p className="text-body text-danger">{photoError}</p>}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!category || !amount || Number(amount) <= 0 || submitting}>
            {submitting ? 'Saving…' : 'Add expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
