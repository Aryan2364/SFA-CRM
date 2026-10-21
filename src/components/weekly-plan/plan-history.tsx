'use client'

import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fmtDateTime } from '@/lib/format'
import type { ItemsDiff } from '@/lib/weekly-plan-diff'
import { ManagerChanges } from './manager-changes'

/**
 * A plan's audit history, for the phone: every action, who took it, the
 * status it moved from and to, the note that came with it, and a manager
 * edit's before/after. Read-only, newest first (the routes order it).
 *
 * On a phone a large dialog is a full-screen layer with the title in the app
 * bar (41.8 rule 10), so the history reads as a screen of its own and Back
 * closes it.
 */
export type HistoryLog = {
  id: string
  action_type: string
  actor_role: string
  timestamp: string
  previous_status: string | null
  new_status: string | null
  comment: string | null
  users?: { name: string } | null
  changes?: ItemsDiff | null
}

export function PlanHistory({ logs }: { logs: HistoryLog[] }) {
  if (logs.length === 0) {
    return <p className="text-body text-text-muted">Nothing has happened yet.</p>
  }
  return (
    <ul className="space-y-4">
      {logs.map(log => (
        <li key={log.id} className="border-l-2 border-border-light pl-3">
          <p className="text-body font-medium text-text-primary">
            {log.action_type}
            <span className="ml-2 text-label font-normal text-text-muted">
              by {log.users?.name ?? log.actor_role}
            </span>
          </p>
          {(log.previous_status || log.new_status) && (
            <p className="text-label text-text-secondary">
              {log.previous_status ?? '—'} &rarr; {log.new_status ?? '—'}
            </p>
          )}
          {log.comment && (
            <p className="mt-0.5 text-label text-text-primary">&ldquo;{log.comment}&rdquo;</p>
          )}
          {log.changes && <ManagerChanges changes={log.changes} className="mt-1" />}
          <p className="mt-0.5 text-label text-text-muted">{fmtDateTime(log.timestamp)}</p>
        </li>
      ))}
    </ul>
  )
}

export function PlanHistoryLayer({
  open,
  onOpenChange,
  logs,
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  logs: HistoryLog[]
  description?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <PlanHistory logs={logs} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
