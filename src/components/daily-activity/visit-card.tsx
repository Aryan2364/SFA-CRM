'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ClipboardListIcon,
  HistoryIcon,
  MapIcon,
  MapPinIcon,
  MessageSquareIcon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Truncate } from '@/components/ui/truncate'
import { MeetingToggle } from './meeting-toggle'
import { formatDuration, formatTime, Visit } from './types'

/**
 * One meeting. Lifted out of the 1685-line page with its behaviour
 * intact, so that P3-T7 has a single file to put the start/stop toggle
 * in and P3-T9 a single file to hang the inside-a-meeting state on.
 *
 * P3-T7 landed the toggle: Start and Stop are now ONE button — see
 * `meeting-toggle.tsx` for why that has to be a single node rather than
 * two `&&` branches — and the location flag shown below is the one the
 * SERVER decided on stop, not a box drawn in degrees in the browser.
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
  onStart: (id: string) => void | Promise<void>
  onStop: (id: string) => void | Promise<void>
  onDelete: (visit: Visit) => void
  onOrderEntry: (visit: Visit) => void
  onRemarks: (visit: Visit) => void
  onNotesUpdate: (id: string, notes: string) => Promise<void>
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesText, setNotesText] = useState(visit.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  const statusVariant = visit.status === 'Active' ? 'warning' : visit.status === 'Completed' ? 'success' : 'neutral'

  /*
   * §5.4's flag, as the SERVER decided it on stop — a Haversine distance in
   * metres against the tenant's configured threshold (default 500 m,
   * changeable in Settings), stored on the row.
   *
   * This card used to recompute it here as
   * `|dlat| > 0.001 || |dlng| > 0.001`: degrees rather than metres, a square
   * rather than a circle, a different real distance at every latitude, and a
   * threshold no setting could change. See `src/lib/geo.ts` for the full
   * autopsy. Reading the stored boolean is also what keeps the rep's card and
   * the reviewer's screen from disagreeing about the same meeting.
   *
   * ⚠️ Nulls are NORMAL — on a geolocation timeout a meeting is stopped with
   * no end fix at all — and an unknown distance is NOT flagged. Unknown is not
   * evidence, and flagging it would train people to ignore the flag.
   *
   * ⚠️ DISPLAY ONLY. §5.4 triggers no action: nothing below is disabled by it,
   * no confirmation is asked, nobody is notified.
   */
  const locationFlagged = visit.location_flagged === true

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
              {/*
                P3-T10, folded in by P3-T11. A hand-typed meeting is marked
                INSIDE the card, beside the badges that describe the same
                meeting, rather than on a ribbon the page drew around it —
                the page's wrapper could not survive the card being used
                anywhere else, and this fact belongs to the meeting.

                Colour is never the only signal (kit rule): the icon carries
                it for anyone who cannot tell the warning tint from neutral.
              */}
              {visit.is_manual_entry && (
                <Badge variant="warning" className="gap-1">
                  <HistoryIcon className="size-3" />
                  Manually Entered · Tentative
                </Badge>
              )}
              {showOwner && ownerName && <span className="text-meta text-text-muted">{ownerName}</span>}
            </div>
            {/*
              Kit §8: a truncated list row shows its full text as a
              tooltip, and `Truncate` is the one component that does it —
              a bare `truncate` class cuts the name and offers no way to
              read the rest. It matters more since the meeting form
              learned to name the person met: this line now reads
              "Ramesh Kumar · ACME Traders" and reaches the edge on a
              narrow card where the company name alone did not.
            */}
            <h3 className="mt-1.5 text-card-heading font-medium text-text-primary">
              <Truncate>{visit.entity_name}</Truncate>
            </h3>
          </div>

          {/* ONE button. `canEdit` is the real permission plus ownership —
              a manager reads the team's day and does not drive someone
              else's stopwatch, so they are shown no toggle at all rather
              than a disabled one. */}
          {canEdit && (
            <MeetingToggle
              status={visit.status}
              startTime={visit.start_time}
              durationSecs={visit.duration_secs}
              onStart={() => onStart(visit.id)}
              onStop={() => onStop(visit.id)}
            />
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
        {/*
          P3-T11 §5.6. The only way INTO the meeting page, and the reason it
          leads the row: everything else here acts on the meeting from the
          outside, while this opens the record itself — the Deals discussed,
          the Orders taken and the minutes. It is shown for every meeting,
          including a Pending one: the page renders the party's pipeline
          whether or not the stopwatch has been started, so there is no
          state in which the link is a dead end.
        */}
        <Button
          size="sm"
          variant="secondary"
          /* Base UI asserts on a button that renders as something else: an
             anchor has no native button semantics, and saying so is what
             stops it being submitted as one. `pagination.tsx` does the same
             for the same reason. Without it this logs an error on every
             card, which is how it was caught. */
          nativeButton={false}
          render={<Link href={`/daily-activity/meeting/${visit.id}`} />}
        >
          <SquareArrowOutUpRightIcon />
          Open meeting
        </Button>
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
            <div className={`rounded-lg px-3 py-2 ${locationFlagged ? 'border border-danger-border bg-danger-bg' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2">
                <p className="text-meta uppercase text-text-muted">End location</p>
                {locationFlagged && <Badge variant="danger">Far from start</Badge>}
              </div>
              <p className="text-body text-text-secondary">
                {visit.end_address ?? `${visit.end_latitude}, ${visit.end_longitude}`}
              </p>
              {locationFlagged && (
                <p className="mt-1 text-meta text-text-muted">
                  Further from the start than this tenant allows. Noted for review only.
                </p>
              )}
            </div>
          )}
          {visit.status === 'Completed' && visit.end_latitude == null && (
            <p className="text-body text-text-muted">
              No end location was captured. Nothing is flagged from a missing fix.
            </p>
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
