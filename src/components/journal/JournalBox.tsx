'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/contexts/ToastContext'

type Kind = 'went_well' | 'improve'

const LABEL: Record<Kind, string> = {
  went_well: 'What Went Well',
  improve: 'Where I Can Improve',
}

const PLACEHOLDER: Record<Kind, string> = {
  went_well: 'What went well this week? Write it down before it slips.',
  improve: 'What would you do differently next week?',
}

/**
 * §6.3 — one of the two boxes inside Weekly Review. Loads and saves the
 * caller's own entry for `kind`/`weekStart` (the API scopes to the session
 * user, so there is nothing to pass beyond that). Saves in place — no full
 * reload, no delete-then-recreate — and the "Logs" button is the only way to
 * this kind's past entries (§12: no separate menu item).
 */
export function JournalBox({ kind, weekStart }: { kind: Kind; weekStart: string }) {
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/journal?weekStart=${weekStart}&kind=${kind}`)
      .then(r => r.json())
      .then((rows: { body: string | null }[]) => {
        if (cancelled) return
        const body = rows[0]?.body ?? ''
        setText(body)
        setSavedText(body)
      })
      .catch(() => { if (!cancelled) showToast('Could not load journal entry', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, weekStart])

  function scheduleSave(next: string) {
    setText(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(next), 600)
  }

  async function save(value: string) {
    if (value === savedText) return
    setSaving(true)
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, kind, text: value }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      setSavedText(value)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save entry', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleBlur() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    save(text)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{LABEL[kind]}</CardTitle>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push(`/review/weekly/journal/${kind}`)}
        >
          Logs
        </Button>
      </CardHeader>
      <CardContent className="py-4">
        <Textarea
          value={text}
          onChange={e => scheduleSave(e.target.value)}
          onBlur={handleBlur}
          placeholder={loading ? 'Loading…' : PLACEHOLDER[kind]}
          disabled={loading}
          rows={4}
          className="min-h-[6rem] text-body transition-[height] duration-200"
        />
        <div className="mt-1 h-4 text-caption text-text-secondary">
          {saving ? 'Saving…' : text !== savedText ? 'Unsaved changes' : text ? 'Saved' : ''}
        </div>
      </CardContent>
    </Card>
  )
}
