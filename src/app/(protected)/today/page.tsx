'use client'

import { Children, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { setPhoneTabBadge } from '@/components/shell/phone-tab-badges'
import { PhoneListRow } from '@/components/ui/phone-list'
import { ActionBar } from '@/components/ui/action-bar'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import {
  attendanceState,
  ATTENDANCE_SENTENCE,
  formatTime,
  getPosition,
  reverseGeocode,
  toDateStr,
  type AttendanceRecord,
  type FollowUpItem,
  type MissedTodo,
  type NextMeetingItem,
  type Visit,
} from '@/components/daily-activity/types'

/**
 * Today — phone home (owner decision: this product's "My work", §41.15).
 *
 * Sections, top to bottom: check-in/out, "Waiting on you" (weekly-plan
 * approvals, only for a role that can see that queue), today's meetings,
 * follow-ups due/overdue. Primary action is "+ Log meeting" in the bottom
 * action bar, which opens /daily-activity/new.
 */

type ApprovalRow = { id: string; user_id: string; user_name?: string; week_start?: string; status: string }

export default function TodayPage() {
  const { layout } = useLayout()
  const router = useRouter()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/')
  }, [layout, router])

  if (layout === 'desktop') return null
  return <TodayPhone />
}

function TodayPhone() {
  usePhoneAppBar({ title: 'Today' })
  const me = useMe()
  const { toast } = useToast()
  const router = useRouter()
  const today = toDateStr(new Date())

  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [marking, setMarking] = useState(false)

  const [visits, setVisits] = useState<Visit[]>([])
  const [visitsLoading, setVisitsLoading] = useState(true)

  const [followUps, setFollowUps] = useState<FollowUpItem[]>([])
  const [nextMeetings, setNextMeetings] = useState<NextMeetingItem[]>([])
  const [missed, setMissed] = useState<MissedTodo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)

  const [approvals, setApprovals] = useState<ApprovalRow[]>([])
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  // Which permission answer the current `approvals` were loaded under, so
  // the tab count is not published from the pre-`me` empty list.
  const [approvalsLoadedFor, setApprovalsLoadedFor] = useState<boolean | null>(null)

  const perms = me?.permissions
  const canMarkAttendance = !!perms?.meetings?.view
  const canLogMeeting = !!perms?.meetings?.create
  const canViewApprovals = !!perms?.weekly_plan?.view

  const loadAttendance = useCallback(async () => {
    setAttendanceLoading(true)
    try {
      const r = await fetch(`/api/attendance?date=${today}`)
      setAttendance(r.ok ? await r.json() : null)
    } catch {
      setAttendance(null)
    }
    setAttendanceLoading(false)
  }, [today])

  const loadVisits = useCallback(async () => {
    setVisitsLoading(true)
    try {
      const r = await fetch(`/api/daily-activity?date=${today}`)
      setVisits(r.ok ? await r.json() : [])
    } catch {
      setVisits([])
    }
    setVisitsLoading(false)
  }, [today])

  const loadTodos = useCallback(async () => {
    setTodosLoading(true)
    try {
      const r = await fetch(`/api/daily-activity/todos?date=${today}`)
      const d = r.ok ? await r.json() : { followups: [], nextMeetings: [], missed: [] }
      setFollowUps(Array.isArray(d.followups) ? d.followups : [])
      setNextMeetings(Array.isArray(d.nextMeetings) ? d.nextMeetings : [])
      setMissed(Array.isArray(d.missed) ? d.missed : [])
    } catch {
      setFollowUps([])
      setNextMeetings([])
      setMissed([])
    }
    setTodosLoading(false)
  }, [today])

  const loadApprovals = useCallback(async () => {
    if (!canViewApprovals) { setApprovals([]); setApprovalsLoading(false); setApprovalsLoadedFor(false); return }
    setApprovalsLoading(true)
    try {
      const r = await fetch('/api/weekly-plans/approval?queue=awaiting')
      const d = r.ok ? await r.json() : { rows: [] }
      setApprovals(Array.isArray(d.rows) ? d.rows : [])
    } catch {
      setApprovals([])
    }
    setApprovalsLoading(false)
    setApprovalsLoadedFor(true)
  }, [canViewApprovals])

  useEffect(() => { void loadAttendance() }, [loadAttendance])
  useEffect(() => { void loadVisits() }, [loadVisits])
  useEffect(() => { void loadTodos() }, [loadTodos])
  useEffect(() => { void loadApprovals() }, [loadApprovals])

  const state = attendanceState(today, attendance)

  async function markAttendance(action: 'check-in' | 'check-out') {
    if (marking) return
    setMarking(true)
    const pos = await getPosition()
    if (pos && 'denied' in pos) {
      toast('Location is blocked — allow it in your browser to check in/out', 'error')
      setMarking(false)
      return
    }
    let address: string | null = null
    let latitude: number | null = null
    let longitude: number | null = null
    if (pos) {
      latitude = pos.latitude
      longitude = pos.longitude
      address = await reverseGeocode(pos.latitude, pos.longitude)
    }
    try {
      const r = await fetch(`/api/attendance/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude, address }),
      })
      if (!r.ok) {
        toast((await r.json()).error ?? 'Could not record attendance', 'error')
      } else {
        await loadAttendance()
      }
    } finally {
      setMarking(false)
    }
  }

  // Follow-ups: overdue (missed) first, then due today, soonest first —
  // "due" here means due today since /todos already scopes to `today`.
  const overdueCount = missed.length
  const dueCount = followUps.length + nextMeetings.length

  // §41.15 rule 8: the Today tab carries the count of what is waiting on
  // this person — approvals in their queue plus overdue follow-ups — from
  // the data this screen already loads. Recomputed whenever either list is
  // (re)loaded, so it refreshes each time Today opens and after any action
  // here that reloads them. Published only once both have settled (and
  // `me` is known, since the approvals load depends on it), so a half-
  // loaded screen never shows a low count.
  const waitingCount = approvals.length + overdueCount
  const countSettled =
    !!me && !approvalsLoading && approvalsLoadedFor === canViewApprovals && !todosLoading
  useEffect(() => {
    if (!countSettled || !me) return
    setPhoneTabBadge('/today', me.userId, waitingCount)
  }, [countSettled, me, waitingCount])

  const nothingWaiting =
    !attendanceLoading && !visitsLoading && !todosLoading && !approvalsLoading &&
    visits.length === 0 && approvals.length === 0 && dueCount === 0 && overdueCount === 0

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Check-in / check-out */}
      <section className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-4">
        <p className="text-body font-medium text-text-primary">Attendance</p>
        {attendanceLoading ? (
          <p className="text-body text-text-muted">Loading…</p>
        ) : (
          <>
            <p className="text-body text-text-secondary">{ATTENDANCE_SENTENCE[state]}</p>
            {attendance?.check_in_time && (
              <p className="text-meta text-text-muted">
                Checked in {formatTime(attendance.check_in_time)}
                {attendance.check_in_address ? ` · ${attendance.check_in_address}` : ''}
                {attendance.check_out_time ? ` · checked out ${formatTime(attendance.check_out_time)}` : ''}
              </p>
            )}
            <PermissionTooltip allowed={!me || canMarkAttendance} reason="Only someone who can view meetings can mark attendance">
              {!attendance?.check_in_time ? (
                <Button
                  size="sm"
                  disabled={marking || !canMarkAttendance}
                  onClick={() => void markAttendance('check-in')}
                  className="mt-1 min-h-11 w-full"
                >
                  {marking ? 'Checking in…' : 'Check in'}
                </Button>
              ) : !attendance?.check_out_time ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={marking || !canMarkAttendance}
                  onClick={() => void markAttendance('check-out')}
                  className="mt-1 min-h-11 w-full"
                >
                  {marking ? 'Checking out…' : 'Check out'}
                </Button>
              ) : null}
            </PermissionTooltip>
          </>
        )}
      </section>

      {/* Waiting on you — weekly plan approvals */}
      {canViewApprovals && (approvalsLoading || approvals.length > 0) && (
        <Section title="Waiting on you" loading={approvalsLoading}>
          {approvals.map(a => (
            <li key={a.id}>
              <PhoneListRow
                href="/weekly-plan"
                name={a.user_name ?? 'Weekly plan'}
                facts={[a.status]}
                meta={a.week_start}
              />
            </li>
          ))}
        </Section>
      )}

      {/* Today's meetings */}
      <Section title="Today's meetings" loading={visitsLoading} emptyText="No meetings logged yet today.">
        {visits.map(v => (
          <li key={v.id}>
            <PhoneListRow
              href={`/daily-activity?date=${today}&remarks=${v.id}`}
              name={v.entity_name}
              facts={[v.visit_type, v.status]}
              meta={v.start_time ? formatTime(v.start_time) : undefined}
            />
          </li>
        ))}
      </Section>

      {/* Follow-ups: overdue first, then due today soonest-first */}
      <Section title="Follow-ups" loading={todosLoading} emptyText="Nothing due or overdue.">
        {missed.map(m => (
          <li key={`missed-${m.kind}-${m.id}`}>
            <PhoneListRow
              href={m.party_id ? `/parties/companies/${m.party_id}` : '/daily-activity'}
              name={m.party_name}
              facts={[`Overdue · was due ${m.original_date}`]}
              meta={m.label}
            />
          </li>
        ))}
        {followUps.map(f => (
          <li key={`fu-${f.id}`}>
            <PhoneListRow
              href={f.company_id ? `/parties/companies/${f.company_id}` : `/deals/${f.deal_id}`}
              name={f.company_name ?? f.deal_name}
              facts={[`Due today · ${f.deal_name}`]}
            />
          </li>
        ))}
        {nextMeetings.map(n => (
          <li key={`nm-${n.id}`}>
            <PhoneListRow
              href={`/parties/companies/${n.id}`}
              name={n.name}
              facts={['Due today']}
            />
          </li>
        ))}
      </Section>

      {nothingWaiting && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">Nothing waiting right now</p>
          <p className="text-body text-text-muted">Check in and log a meeting when you&apos;re ready.</p>
        </div>
      )}

      <ActionBar>
        <PermissionTooltip allowed={!me || canLogMeeting} reason="Only someone who can create meetings can log one">
          <Button className="w-full" disabled={!canLogMeeting} onClick={() => router.push('/daily-activity/new')}>
            + Log meeting
          </Button>
        </PermissionTooltip>
      </ActionBar>
    </div>
  )
}

function Section({
  title,
  loading,
  emptyText,
  children,
}: {
  title: string
  loading: boolean
  emptyText?: string
  children: React.ReactNode
}) {
  const hasRows = Children.toArray(children).length > 0
  return (
    <section className="flex flex-col gap-2">
      <p className="text-label font-medium text-text-secondary">{title}</p>
      {loading ? (
        <p className="text-body text-text-muted">Loading…</p>
      ) : !hasRows && emptyText ? (
        <p className="text-body text-text-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
          {children}
        </ul>
      )}
    </section>
  )
}
