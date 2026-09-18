'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ClipboardListIcon,
  MapIcon,
  MapPinIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDuration, formatTime, Visit } from './types'

/**
 * One meeting. Lifted out of the 1685-line page with its behaviour
 * intact, so that P3-T7 has a single file to put the start/stop toggle
 * in and P3-T9 a single file to hang the inside-a-meeting state on.
 *
 * ⚠️ Deliberately NOT built here: the toggle (P3-T7). Start and Stop are
 * still two buttons in two states, exactly as they were.
 *
 * §5.3 rule 4: nothing on this card consults attendance. A completed
 * check-out does not disable the order button, the notes field or the
 * delete action, and there is no `disabled` here that depends on the
 * working day being open.
 */
export function VisitCard({
  visit,
  showOwner,
  ownerName,
  canEdit,
  canDelete,
  onStart,
  onStop,
  onDelete,
  onOrderEntry,
  onRemarks,
  onNotesUpdate,
}: {
  visit: Visit
  /** True when the list spans more than one person (Team/Company scope). */
  showOwner: boolean
  ownerName?: string | null
  canEdit: boolean
  canDelete: boolean
  onStart: (id: string) => void
  onStop: (id: string) => void
  onDelete: (visit: Visit) => void
  onOrderEntry: (visit: Visit) => void
  onRemarks: (visit: Visit) => void
  onNotesUpdate: (id: string, notes: string) => Promise<void>
}) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesText, setNotesText] = useState(visit.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  useEffect(() => {
    if (visit.status === 'Active' && visit.start_time) {
      const update = () => setElapsed(Math.floor((Date.now() - new Date(visit.start_time!).getTime()) / 1000))
      update()
      intervalRef.current = setInterval(update, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setElapsed(visit.duration_secs ?? 0)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [visit.status, visit.start_time, visit.duration_secs])

  const statusVariant = visit.status === 'Active' ? 'warning' : visit.status === 'Completed' ? 'success' : 'neutral'

  // Both positions were captured, and they are far enough apart to be
  // two different places. Nulls are normal here: on a geolocation timeout the
  // meeting starts anyway with no coordinates (P3-T7's note).
  const moved =
    visit.latitude != null && visit.end_latitude != null &&
    (Math.abs(visit.latitude - visit.end_latitude) > 0.001 ||
      Math.abs((visit.longitude ?? 0) - (visit.end_longitude ?? 0)) > 0.001)

  return (
    <div
      className={[
        'flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors duration-200',
        visit.status === 'Active' ? 'border-warning-border' : 'border-border-light',
      ].join(' ')}
    >
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant}>{visit.status}</Badge>
              <Badge variant="neutral">{visit.visit_type}</Badge>
              {visit.is_new_entity && <Badge variant="neutral">New</Badge>}
              {visit.weekly_plan_item_id && <Badge variant="neutral">From plan</Badge>}
              {showOwner && ownerName && <span className="text-meta text-text-muted">{ownerName}</span>}
            </div>
            <h3 className="mt-1.5 truncate text-card-heading font-medium text-text-primary">{visit.entity_name}</h3>
          </div>

          {canEdit && visit.status === 'Pending' && (
            <Button size="sm" onClick={() => onStart(visit.id)} className="shrink-0">
              <PlayIcon />
              Start
            </Button>
          )}
          {canEdit && visit.status === 'Active' && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Button size="sm" variant="danger" onClick={() => onStop(visit.id)}>
                <SquareIcon />
                Stop
              </Button>
              <span className="text-meta tabular-nums text-warning">{formatDuration(elapsed)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-text-secondary">
          {visit.start_time && <span>Started {formatTime(visit.start_time)}</span>}
          {visit.end_time && <span>Ended {formatTime(visit.end_time)}</span>}
          {visit.status === 'Completed' && visit.duration_secs != null && (
            <span className="tabular-nums">{formatDuration(visit.duration_secs)}</span>
          )}
        </div>
      </div>

      {/* One action row, grouped, next to the meeting they act on. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border-light px-4 py-2.5">
        {(visit.status === 'Active' || visit.status === 'Completed') && (
          <Button size="sm" variant="secondary" onClick={() => onOrderEntry(visit)}>
            <ClipboardListIcon />
            Order
          </Button>
        )}
        {canEdit && visit.status === 'Completed' && (
          <Button size="sm" variant="secondary" onClick={() => setNotesOpen(o => !o)}>
            <PencilIcon />
            {visit.notes ? 'Notes ✓' : 'Notes'}
          </Button>
        )}
        {visit.latitude != null && (
          <Button size="sm" variant="secondary" onClick={() => setLocationOpen(o => !o)}>
            <MapPinIcon />
            Location
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onRemarks(visit)} aria-label="Remarks">
          <MessageSquareIcon />
        </Button>
        {canDelete && visit.status === 'Pending' && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(visit)} aria-label="Delete meeting" className="ml-auto">
            <Trash2Icon />
          </Button>
        )}
      </div>

      {visit.status === 'Completed' && notesOpen && (
        <div className="border-t border-border-light px-4 py-3">
          <p className="mb-1.5 text-label font-medium text-text-secondary">Meeting notes</p>
          <Textarea
            rows={4}
            value={notesText}
            onChange={e => setNotesText(e.target.value)}
            placeholder="What was discussed, and what happens next…"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              disabled={notesSaving}
              onClick={async () => {
                setNotesSaving(true)
                await onNotesUpdate(visit.id, notesText)
                setNotesSaving(false)
                setNotesOpen(false)
              }}
            >
              {notesSaving ? 'Saving…' : 'Save notes'}
            </Button>
          </div>
        </div>
      )}

      {locationOpen && visit.latitude != null && (
        <div className="space-y-2 border-t border-border-light px-4 py-3">
          <div className="rounded-lg bg-surface-sunken px-3 py-2">
            <p className="text-meta uppercase text-text-muted">Start location</p>
            <p className="text-body text-text-secondary">{visit.address ?? `${visit.latitude}, ${visit.longitude}`}</p>
          </div>
          {visit.end_latitude != null && (
            <div className={`rounded-lg px-3 py-2 ${moved ? 'border border-danger-border bg-danger-bg' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2">
                <p className="text-meta uppercase text-text-muted">End location</p>
                {moved && <Badge variant="danger">Moved</Badge>}
              </div>
              <p className="text-body text-text-secondary">
                {visit.end_address ?? `${visit.end_latitude}, ${visit.end_longitude}`}
              </p>
            </div>
          )}
          {visit.status === 'Active' && visit.end_latitude == null && (
            <p className="text-body text-text-muted">End location is captured when the meeting is stopped.</p>
          )}
          <Button size="sm" variant="secondary" onClick={() => setMapOpen(o => !o)}>
            <MapIcon />
            {mapOpen ? 'Hide map' : 'Show map'}
          </Button>
          {mapOpen && (
            <div className="overflow-hidden rounded-lg border border-border-light">
              <iframe
                src={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}&z=15&output=embed`}
                className="h-48 w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Meeting start location"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
