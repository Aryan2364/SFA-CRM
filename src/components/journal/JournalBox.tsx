'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // A failed load leaves the box locked: an empty box that autosaves would
  // overwrite the real entry the load never delivered.
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // The last save failed and is being retried.
  const [saveFailed, setSaveFailed] = useState(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
    Saves are SERIALISED: one request in flight, and the newest text waiting
    behind it — last write wins. The box saves on a 600ms debounce and again
    on blur, and nothing used to stop the second POST leaving while the first
    was still out: the two raced on the server (see the journal route's
    header) and could land in either order, reverting the later text.

    Refs, not state, because the debounce timer's closure would otherwise
    compare against the `savedText` of the render that scheduled it. Each
    queued save carries its own week, so text typed just before the week
    changes still lands on the week it was typed into.
  */
  const savedRef = useRef<{ weekStart: string; text: string }>({ weekStart, text: '' })
  const inFlight = useRef(false)
  const queued = useRef<{ weekStart: string; text: string } | null>(null)
  const currentWeek = useRef(weekStart)
  currentWeek.current = weekStart

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setSaveFailed(false)
    fetch(`/api/journal?weekStart=${weekStart}&kind=${kind}`, { signal: AbortSignal.timeout(20000) })
      .then(async r => {
        if (!r.ok) throw new Error('load failed')
        const rows = await r.json()
        // An error object is not "no entry yet" - only an array is an answer.
        if (!Array.isArray(rows)) throw new Error('unexpected shape')
        return rows as { body: string | null }[]
      })
      .then(rows => {
        if (cancelled) return
        const body = rows[0]?.body ?? ''
        savedRef.current = { weekStart, text: body }
        setText(body)
        setSavedText(body)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, weekStart, attempt])

  function scheduleSave(next: string) {
    setText(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const week = weekStart
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      save(week, next)
    }, 600)
  }

  function save(week: string, value: string) {
    queued.current = { weekStart: week, text: value }
    if (!inFlight.current) void drain()
  }

  async function drain() {
    inFlight.current = true
    setSaving(true)
    try {
      while (queued.current) {
        const next = queued.current
        queued.current = null
        const saved = savedRef.current
        if (saved.weekStart === next.weekStart && saved.text === next.text) continue
        try {
          const res = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekStart: next.weekStart, kind, text: next.text }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || 'Could not save entry')
          savedRef.current = next
          setSaveFailed(false)
          if (next.weekStart === currentWeek.current) setSavedText(next.text)
        } catch {
          // Visible, not silent: the status line says so and the save is
          // retried, unless newer text has already been queued behind it.
          setSaveFailed(true)
          if (!queued.current && next.weekStart === currentWeek.current) {
            if (retryTimer.current) clearTimeout(retryTimer.current)
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null
              save(next.weekStart, next.text)
            }, 5000)
          }
        }
      }
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  function handleBlur() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    save(weekStart, text)
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
          disabled={loading || loadError}
          rows={4}
          className="min-h-[6rem] text-body transition-[height] duration-200"
        />
        {loadError ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-caption text-text-secondary">
            <span>Couldn&apos;t load this entry. Check your connection and try again. Editing is off until it loads.</span>
            <Button variant="secondary" size="sm" onClick={() => setAttempt(a => a + 1)}>Retry</Button>
          </div>
        ) : (
          <div className="mt-1 min-h-4 text-caption text-text-secondary" role={saveFailed ? 'alert' : undefined}>
            {saveFailed
              ? 'Not saved. Retrying…'
              : saving ? 'Saving…' : text !== savedText ? 'Unsaved changes' : text ? 'Saved' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
