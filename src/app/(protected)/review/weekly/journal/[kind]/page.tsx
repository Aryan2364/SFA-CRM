'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Kind = 'went_well' | 'improve'

const LABEL: Record<Kind, string> = {
  went_well: 'What Went Well',
  improve: 'Where I Can Improve',
}

const EMPTY_INVITE: Record<Kind, string> = {
  went_well: 'Nothing written yet. Head back to Weekly Review and jot down what went well this week.',
  improve: 'Nothing written yet. Head back to Weekly Review and note what you would do differently.',
}

type Entry = { id: string; week_start: string; body: string | null; updated_at: string }

function fmtWeek(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`)
  const end = new Date(d.getTime() + 6 * 86400000)
  const f = (x: Date) => x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return `Week of ${f(d)} – ${f(end)}`
}

/**
 * §6.3 Logs page — "all past entries, one after another". Reached only
 * through the Logs button on a Weekly Review journal box (§12: no separate
 * menu item). Scoped to the caller's own entries by the API; there is no
 * `userId` here to leak across.
 */
export default function JournalLogsPage({ params }: { params: { kind: string } }) {
  const kind: Kind = params.kind === 'improve' ? 'improve' : 'went_well'
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/journal?mode=all&kind=${kind}`)
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || 'Failed to load entries')
        return body as Entry[]
      })
      .then(rows => setEntries(rows.filter(r => r.body && r.body.trim().length > 0)))
      .catch(err => {
        showToast(err.message, 'error')
        setEntries([])
      })
      .finally(() => setLoading(false))
  }, [kind, showToast])

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-light bg-surface px-4 py-3 sm:px-6">
        <Button variant="ghost" size="icon" onClick={() => router.push('/review/weekly')} aria-label="Back to Weekly Review">
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-page-heading font-semibold text-text-primary">{LABEL[kind]} — Logs</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3">
          {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}

          {!loading && entries && entries.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-body text-text-secondary">{EMPTY_INVITE[kind]}</p>
                <Button variant="secondary" onClick={() => router.push('/review/weekly')}>
                  Go to Weekly Review
                </Button>
              </CardContent>
            </Card>
          )}

          {!loading && entries && entries.map(e => (
            <Card key={e.id}>
              <CardHeader>
                <CardTitle className="text-body font-medium">{fmtWeek(e.week_start)}</CardTitle>
              </CardHeader>
              <CardContent className="py-3">
                <p className="whitespace-pre-wrap text-body text-text-primary">{e.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
