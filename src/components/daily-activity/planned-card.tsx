'use client'

import { MapPinIcon, RouteIcon, TargetIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtAmount } from '@/lib/format'
import { MeetingToggle } from './meeting-toggle'
import { PlannedItem } from './types'

/**
 * §5.3 rule 1 — an APPROVED weekly-plan line, standing in the meetings
 * list for the day it was planned for, before anything has been done
 * about it.
 *
 * This is what replaces the manual selection step. The old screen asked
 * the user to open a dialog, pick a lead type, pick Existing/Lead/New,
 * then search a dropdown for the party — for a meeting their own
 * approved plan already named. Where the plan names a party, the card's
 * primary action starts that meeting directly and stamps it with
 * `weekly_plan_item_id`, so the planned line and the meeting are one row
 * from then on.
 *
 * ⚠️ `weekly_plan_items.party_id` is nullable, and is NULL on every row
 * in the seeded database. A line with no party is a ROUTE line: from →
 * to, a travel mode and dealer counts to hit. There is no one to meet on
 * it, so it renders as the day's context with a secondary action that
 * opens the meeting dialog already attached to the line — the only case
 * where a selection step survives, because there is genuinely nothing to
 * select it from.
 *
 * §5.3 rule 2 — this card is why the Plan tab is gone. The plan is not a
 * separate screen to go and read; it is the top of the list of what to
 * do today.
 */
export function PlannedCard({
  item,
  showOwner,
  canStart,
  starting,
  onStart,
  onAddMeeting,
}: {
  item: PlannedItem
  /** True when the list spans more than one person (Team/Company scope). */
  showOwner: boolean
  canStart: boolean
  starting: boolean
  onStart: (item: PlannedItem) => void | Promise<void>
  onAddMeeting: (item: PlannedItem) => void
}) {
  const route = [item.from_place, item.to_place].filter(Boolean).join(' → ')
  const goals: string[] = []
  if (item.new_dealers_goal) goals.push(`${item.new_dealers_goal} new`)
  if (item.existing_dealers_goal) goals.push(`${item.existing_dealers_goal} existing`)
  if (item.others_goal) goals.push(`${item.others_goal} other`)

  return (
    <div className="flex flex-col rounded-xl border border-dashed border-border bg-surface transition-colors duration-200 hover:border-primary-border">
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">Planned</Badge>
          {item.party_name && item.party_type && <Badge variant="neutral">{item.party_type}</Badge>}
          {showOwner && <span className="text-meta text-text-muted">{item.user_name}</span>}
        </div>

        {/* The identifier leads: who to meet if the plan says, otherwise
            the route, which is the only thing this line actually is. */}
        <h3 className="text-card-heading font-medium text-text-primary">
          {item.party_name ?? (route || '—')}
        </h3>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-text-secondary">
          {item.party_name && route && (
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon className="size-3.5 text-text-muted" />
              {route}
            </span>
          )}
          {!item.party_name && item.mode_of_travel && (
            <span className="inline-flex items-center gap-1.5">
              <RouteIcon className="size-3.5 text-text-muted" />
              {item.mode_of_travel}
            </span>
          )}
          {goals.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <TargetIcon className="size-3.5 text-text-muted" />
              {goals.join(' · ')}
            </span>
          )}
          {item.expected_order_value != null && (
            <span className="tabular-nums">Expected {fmtAmount(item.expected_order_value)}</span>
          )}
        </div>

        {item.notes && <p className="text-body text-text-secondary">{item.notes}</p>}
      </div>

      {canStart && (
        <div className="flex items-center gap-2 border-t border-border-light px-4 py-2.5">
          {item.party_id && item.party_name ? (
            /* §5.4's one toggle, the same component the meeting card uses,
               so a planned line and the meeting it becomes offer the same
               control rather than two buttons that merely look alike. The
               line is always Pending here: the moment it starts, a meeting
               carries its id and this card gives way to that meeting's own
               card (see `openPlanned` on the page). */
            <MeetingToggle
              status="Pending"
              busy={starting}
              startLabel="Start meeting"
              onStart={() => onStart(item)}
              onStop={() => {}}
            />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onAddMeeting(item)}>
              Log a meeting on this line
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
