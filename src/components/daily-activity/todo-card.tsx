'use client'

import { MessageSquareIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { MeetingToggle } from './meeting-toggle'
import { FollowUpItem, NextMeetingItem } from './types'

/**
 * Daily Activity to-do cards b) and c) (the owner's own task, relayed from
 * the team lead): an open Opportunity follow-up due today, and an account
 * whose own `next_follow_up_date` is today. Both are peers of
 * `PlannedCard` — same rounded-card shell, same `MeetingToggle` for Start —
 * just with a different badge and a different source of the entity to
 * meet. One file for both because neither needs more than a badge label,
 * a heading and a start handler to differ.
 */
export function TodoCard({
  kind,
  heading,
  subheading,
  offered,
  canStart,
  starting,
  onStart,
  onCouldntMeet,
}: {
  kind: 'followup' | 'next-meeting'
  heading: string
  subheading: string[]
  /** The row is the viewer's own and the day is not in the future. `null`
   *  while /me is still loading: drawn disabled, no reason yet — "not
   *  known yet" is not "not allowed". */
  offered: boolean | null
  canStart: boolean | null
  starting: boolean
  onStart: () => void | Promise<void>
  onCouldntMeet: () => void
}) {
  const start = offered === null ? null : canStart

  return (
    <div className="flex flex-col rounded-xl border border-dashed border-border bg-surface transition-colors duration-200 hover:border-primary-border">
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">Next meeting</Badge>
        </div>

        <h3 className="text-card-heading font-medium text-text-primary">{heading}</h3>

        {subheading.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-text-secondary">
            {subheading.map((line, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i === 0 ? <UsersIcon className="size-3.5 text-text-muted" /> : <MessageSquareIcon className="size-3.5 text-text-muted" />}
                {line}
              </span>
            ))}
          </div>
        )}
      </div>

      {offered !== false && (
        <div className="flex items-center gap-2 border-t border-border-light px-4 py-2.5">
          <PermissionTooltip
            allowed={start !== false}
            reason="Only someone who can create and edit meetings can start one"
          >
            <MeetingToggle
              status="Pending"
              busy={starting}
              disabled={start !== true}
              startLabel="Start meeting"
              onStart={onStart}
              onStop={() => {}}
            />
          </PermissionTooltip>
          <Button variant="ghost" size="sm" disabled={start !== true} onClick={onCouldntMeet}>
            Couldn&apos;t meet
          </Button>
        </div>
      )}
    </div>
  )
}
