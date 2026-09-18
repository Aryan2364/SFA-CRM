'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import StatusBadge from '@/components/ui/StatusBadge'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import CalendarPicker from '@/components/ui/CalendarPicker'
import RemarksPanel from '@/components/ui/RemarksPanel'

// ---- Helpers ----
function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
function formatWeekRange(monday: Date) {
  const sun = addDays(monday, 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`
  return `${fmt(monday)} – ${fmt(sun)}`
}
function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
function getWeekDates(baseDate: Date): Date[] {
  const d = getMondayOf(baseDate)
  return Array.from({ length: 7 }, (_, i) => { const r = new Date(d); r.setDate(d.getDate() + i); return r })
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---- Types ----
type Plan = {
  id: string; status: string; submitted_at: string | null; manager_comment: string | null
  reopen_requested: boolean; reopen_request_message: string | null
  week_start_date: string; week_end_date: string;
  weekly_plan_items: { plan_date: string; from_place: string; existing_dealers_goal: number; new_dealers_goal: number; notes: string }[]
  day_notes?: Record<string, string>
  users: { id: string; name: string; contact: string }
}

type Visit = {
  id: string; visit_type: string; entity_name: string; is_new_entity: boolean
  status: string; start_time: string | null; end_time: string | null; duration_secs: number | null
  notes: string | null
  latitude: number | null; longitude: number | null; address: string | null
  end_latitude: number | null; end_longitude: number | null; end_address: string | null
  /* §5.4: computed server-side when the visit is stopped, against the tenant's
     configured threshold in metres. Not recomputed here — see ReviewVisitCard. */
  location_flagged: boolean
}

type Expense = {
  id: string; category: string; amount: number; notes: string | null; expense_date: string; photo_url: string | null
}

type RemarksState = { contextType: 'meeting' | 'expense' | 'weekly_plan'; contextId: string; title: string } | null

const CATEGORY_COLORS: Record<string, string> = {
  Travel: 'bg-blue-100 text-blue-700', Food: 'bg-orange-100 text-orange-700',
  Accommodation: 'bg-purple-100 text-purple-700', Phone: 'bg-teal-100 text-teal-700',
  Stationary: 'bg-yellow-100 text-yellow-700', Miscellaneous: 'bg-gray-100 text-gray-600',
}

// ---- Week Strip (read-only variant) ----
function WeekStrip({ selectedDate, onSelectDate, onPrevWeek, onNextWeek, calendarApiBase }: {
  selectedDate: string; onSelectDate: (d: string) => void; onPrevWeek: () => void; onNextWeek: () => void
  calendarApiBase?: string
}) {
  const todayStr = toDateStr(new Date())
  const selDate = new Date(selectedDate + 'T00:00:00')
  const weekDates = getWeekDates(selDate)
  const [showCalendar, setShowCalendar] = useState(false)
  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-1 bg-surface rounded-2xl border border-border-light px-2 py-2 shadow-sm">
        <button onClick={onPrevWeek} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div className="flex-1 flex items-center justify-between gap-0.5">
          {weekDates.map((d, i) => {
            const ds = toDateStr(d); const isSelected = ds === selectedDate; const isToday = ds === todayStr
            return (
              <button key={ds} onClick={() => onSelectDate(ds)}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl flex-1 transition relative ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-sunken text-text-secondary'}`}>
                <span className={`text-[10px] font-normal uppercase tracking-wide ${isSelected ? 'text-primary-foreground' : 'text-text-muted'}`}>{DAY_LABELS[i]}</span>
                <span className={`text-sm font-medium ${isSelected ? 'text-primary-foreground' : isToday ? 'text-primary' : 'text-text-secondary'}`}>{d.getDate()}</span>
                {isToday && <span className={`w-1.5 h-1.5 rounded-full absolute bottom-1 ${isSelected ? 'bg-primary-subtle' : 'bg-primary'}`} />}
              </button>
            )
          })}
        </div>
        <button onClick={onNextWeek} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
        <button
          onClick={() => setShowCalendar(v => !v)}
          className={`p-1.5 rounded-lg transition shrink-0 ${showCalendar ? 'bg-primary-subtle text-primary' : 'hover:bg-surface-control text-text-muted'}`}
          title="Open calendar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        </button>
      </div>
      {showCalendar && (
        <CalendarPicker
          selectedDate={selectedDate}
          onSelectDate={d => { onSelectDate(d); setShowCalendar(false) }}
          onClose={() => setShowCalendar(false)}
          calendarApiBase={calendarApiBase}
        />
      )}
    </div>
  )
}

// ---- Weekly Plans Tab ----
function WeeklyPlansTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'weekly_plan'; contextId: string; title: string }) => void }) {
  const { toast } = useToast()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterWeek, setFilterWeek] = useState('')
  const [selected, setSelected] = useState<Plan | null>(null)
  const [commentModal, setCommentModal] = useState<{ action: string; planId: string } | null>(null)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)

  const weekOptions = useMemo(() => {
    const opts: string[] = []
    const cur = getMondayOf(new Date())
    for (let i = 11; i >= 0; i--) opts.push(toDateStr(addDays(cur, -7 * i)))
    return opts
  }, [])

  const loadPlans = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ userId })
    if (filterStatus) p.set('status', filterStatus)
    if (filterWeek) p.set('weekStart', filterWeek)
    const r = await fetch(`/api/weekly-plans/review?${p}`)
    const d = await r.json()
    setPlans(Array.isArray(d) ? d : [])
    setLoading(false)
  }, [userId, filterStatus, filterWeek])

  useEffect(() => { loadPlans() }, [loadPlans])

  async function action(planId: string, type: string, body: Record<string, unknown> = {}) {
    setActing(true)
    const r = await fetch(`/api/weekly-plans/${planId}/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) { toast(d.error, 'error') } else { toast(`Done`); loadPlans(); setSelected(null); setCommentModal(null) }
    setActing(false)
  }

  const STATUS_OPTS = ['', 'Submitted', 'Approved', 'Rejected', 'On Hold', 'Edited by Manager', 'Resubmitted']

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring">
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring">
          <option value="">All weeks</option>
          {weekOptions.map(w => <option key={w} value={w}>{formatWeekRange(new Date(w + 'T00:00:00'))}</option>)}
        </select>
      </div>

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : plans.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No plans found.</div>
      ) : (
        <div className="bg-surface rounded-xl border border-border-light overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken border-b border-border-light">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Week</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Submitted</th>
                <th className="px-4 py-3 text-right font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id} className="border-t border-border-light hover:bg-surface-sunken">
                  <td className="px-4 py-3 text-xs text-text-secondary">{formatWeekRange(new Date(p.week_start_date + 'T00:00:00'))}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      {p.reopen_requested && (
                        <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-warning-bg text-warning">Reopen Req.</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{p.submitted_at ? new Date(p.submitted_at).toLocaleString('en-IN') : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setSelected(p)} className="text-primary hover:underline text-xs font-medium">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plan Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => setSelected(null)} />
          <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <div>
                <h3 className="font-medium text-text-primary">Week of {selected.week_start_date}</h3>
                <div className="flex items-center gap-2 mt-1"><StatusBadge status={selected.status} /></div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelected(null); onOpenRemarks({ contextType: 'weekly_plan', contextId: selected.id, title: `Weekly Plan — Week of ${selected.week_start_date}` }) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                  Chat
                </button>
                <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-secondary text-xl">&times;</button>
              </div>
            </div>
            {selected.manager_comment && (
              <div className="mx-6 mt-4 bg-warning-bg border border-warning-border rounded-lg px-3 py-2 text-sm text-warning">
                Comment: {selected.manager_comment}
              </div>
            )}
            <div className="overflow-x-auto px-6 py-4 flex-1 overflow-y-auto space-y-4">
              <table className="w-full text-xs">
                <thead className="bg-surface-sunken"><tr>{['Date', 'Place', 'Dist.', 'Dealer', 'Others'].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-text-secondary">{h}</th>)}</tr></thead>
                <tbody>
                  {selected.weekly_plan_items.sort((a, b) => a.plan_date.localeCompare(b.plan_date)).map((item, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-3 py-2 font-medium">{formatDayHeader(item.plan_date)}</td>
                      <td className="px-3 py-2">{item.from_place || '—'}</td>
                      <td className="px-3 py-2">{item.existing_dealers_goal}</td>
                      <td className="px-3 py-2">{item.new_dealers_goal}</td>
                      <td className="px-3 py-2">{item.notes || '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Day Focus / Remarks */}
              {selected.day_notes && Object.entries(selected.day_notes).filter(([, v]) => v?.trim()).length > 0 && (
                <div className="border border-border-light rounded-lg overflow-hidden">
                  <div className="bg-surface-sunken px-3 py-2 text-xs font-normal text-text-secondary uppercase tracking-wide">Day Focus / Remarks</div>
                  {Object.entries(selected.day_notes)
                    .filter(([, v]) => v?.trim())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, note]) => (
                      <div key={date} className="px-3 py-2 border-t border-border-light flex gap-3 text-xs">
                        <span className="font-medium text-text-secondary whitespace-nowrap">{formatDayHeader(date)}</span>
                        <span className="text-text-secondary">{note}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            {['Submitted', 'Resubmitted', 'On Hold'].includes(selected.status) && (
              <div className="px-6 py-4 border-t border-border-light flex flex-wrap gap-2">
                <button disabled={acting} onClick={() => { setCommentModal({ action: 'approve', planId: selected.id }); setComment('') }} className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">Approve</button>
                <button disabled={acting} onClick={() => { setCommentModal({ action: 'reject', planId: selected.id }); setComment('') }} className="bg-danger hover:bg-danger-hover text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">Reject</button>
                <button disabled={acting} onClick={() => { setCommentModal({ action: 'hold', planId: selected.id }); setComment('') }} className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">Hold</button>
                <button disabled={acting} onClick={() => { setCommentModal({ action: 'suggest', planId: selected.id }); setComment('') }} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">Suggest Changes</button>
              </div>
            )}
            {/* Item 8: Accept / Decline reopen request */}
            {selected.reopen_requested && (
              <div className="px-6 py-4 border-t border-border-light bg-warning-bg">
                <p className="text-xs font-medium text-warning mb-1">Reopen Request</p>
                {selected.reopen_request_message && (
                  <p className="text-xs text-warning mb-3 bg-surface rounded-lg px-3 py-2 border border-warning-border">{selected.reopen_request_message}</p>
                )}
                <div className="flex gap-2">
                  <button disabled={acting} onClick={() => action(selected.id, 'accept-reopen')}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
                    Accept (Allow Edit)
                  </button>
                  <button disabled={acting} onClick={() => action(selected.id, 'decline-reopen')}
                    className="bg-danger hover:bg-danger-hover text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        title={commentModal?.action === 'approve' ? 'Approve Plan' : commentModal?.action === 'reject' ? 'Reject Plan' : commentModal?.action === 'hold' ? 'Put On Hold' : 'Suggest Changes'}
        isOpen={!!commentModal} onClose={() => setCommentModal(null)}
        onSave={() => { if (commentModal) action(commentModal.planId, commentModal.action, { comment }) }}
        isSaving={acting} saveLabel="Confirm">
        <div>
          <label htmlFor="review-comment" className="block text-sm font-medium text-text-secondary mb-1">
            Comment {commentModal?.action === 'reject' || commentModal?.action === 'suggest' ? '(required)' : '(optional)'}
          </label>
          <textarea id="review-comment" name="comment" value={comment} onChange={e => setComment(e.target.value)} rows={3}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring resize-none"
            placeholder={commentModal?.action === 'approve' ? 'Add an optional note for approval…' : 'Enter your comment…'} />
        </div>
      </Modal>
    </div>
  )
}

// ---- Review Visit Card (read-only) ----
function ReviewVisitCard({ v, onOpenRemarks }: {
  v: Visit; onOpenRemarks: (ctx: { contextType: 'meeting'; contextId: string; title: string }) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  const typeColor = (t: string) =>
    t === 'Dealer' ? 'bg-blue-100 text-blue-700' :
    t === 'Distributor' ? 'bg-green-100 text-green-700' :
    'bg-purple-100 text-purple-700'
  const statusColor = (s: string) => s === 'Active' ? 'bg-warning-bg text-warning' : s === 'Completed' ? 'bg-success-bg text-success' : 'bg-surface-control text-text-secondary'

  const hasNotes = !!v.notes?.trim()
  const hasLocation = v.latitude != null
  /*
   * §5.4, P3-T8. This was a hardcoded distance check computed here in the
   * browser:
   *
   *   Math.abs(lat - end_lat) > 0.001 || Math.abs(lng - end_lng) > 0.001
   *
   * which was degrees rather than metres, a square rather than a circle, and a
   * different real distance at every latitude — and it was not the tenant's
   * configured threshold, because it could not be: the setting did not exist.
   * It is now a real Haversine in metres, computed server-side against
   * `getTenantSettings().location_flag_threshold_m` and stored on the row when
   * the visit is stopped, so the rep's screen and the reviewer's screen cannot
   * disagree and an older flag stays as it was judged at the time.
   *
   * A visit whose start or end location is missing is NOT flagged — unknown is
   * not the same as clean, but it is not evidence of anything either.
   *
   * ⚠️ Display only. §5.4 triggers no action from this.
   */
  const endMismatch = v.location_flagged

  return (
    <div className={`bg-surface rounded-2xl border overflow-hidden ${v.status === 'Active' ? 'border-amber-300' : 'border-gray-200'}`}>
      {v.status === 'Active' && <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400 animate-pulse" />}
      {v.status === 'Completed' && <div className="h-1 bg-emerald-400" />}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${typeColor(v.visit_type)}`}>{v.visit_type}</span>
          {v.is_new_entity && <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">New</span>}
          <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${statusColor(v.status)}`}>{v.status}</span>
        </div>
        <p className="font-medium text-text-primary">{v.entity_name}</p>
        <div className="flex gap-4 mt-2 text-xs text-text-muted">
          {v.start_time && <span>Started {new Date(v.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          {v.end_time && <span>Ended {new Date(v.end_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          {v.status === 'Completed' && v.duration_secs != null && <span className="text-success font-medium">{formatDuration(v.duration_secs)}</span>}
        </div>

        {/* Action row */}
        <div className="mt-2 pt-2 border-t border-border-light flex items-center gap-2">
          {hasNotes && (
            <button onClick={() => setNotesOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${notesOpen ? 'bg-warning-bg text-warning' : 'text-text-muted hover:text-warning hover:bg-warning-bg'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Notes
            </button>
          )}
          {hasLocation && (
            <button onClick={() => setLocationOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${locationOpen ? 'bg-teal-50 text-teal-700' : 'text-gray-500 hover:text-teal-700 hover:bg-teal-50'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              Location
            </button>
          )}
          <button onClick={() => onOpenRemarks({ contextType: 'meeting', contextId: v.id, title: v.entity_name })}
            className="ml-auto p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-subtle transition" title="Remarks">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          </button>
        </div>

        {/* Meeting Notes (read-only) */}
        {notesOpen && hasNotes && (
          <div className="mt-3 pt-3 border-t border-border-light">
            <p className="text-xs font-normal text-text-muted uppercase tracking-wide mb-2">Meeting Notes</p>
            <p className="text-sm text-text-primary whitespace-pre-wrap bg-warning-bg rounded-xl px-3 py-2.5">{v.notes}</p>
          </div>
        )}

        {/* Location (read-only) */}
        {locationOpen && hasLocation && (
          <div className="mt-3 pt-3 border-t border-border-light">
            <p className="text-xs font-normal text-text-muted uppercase tracking-wide mb-2">Location Details</p>
            <div className="space-y-2">
              <div className="bg-teal-50 rounded-lg px-3 py-2">
                <p className="text-[10px] font-normal text-teal-600 uppercase mb-0.5">Start Location</p>
                <p className="text-xs text-text-secondary">{v.address ?? `${v.latitude}, ${v.longitude}`}</p>
              </div>
              {v.end_latitude != null && (
                <div className={`rounded-lg px-3 py-2 ${endMismatch ? 'bg-red-50 border border-red-200' : 'bg-teal-50'}`}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-normal text-teal-600 uppercase mb-0.5">End Location</p>
                    {endMismatch && <span className="text-[10px] font-normal text-danger bg-danger-bg px-1.5 py-0.5 rounded-full">Mismatch</span>}
                  </div>
                  <p className="text-xs text-text-secondary">{v.end_address ?? `${v.end_latitude}, ${v.end_longitude}`}</p>
                </div>
              )}
              <button onClick={() => setMapOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                </svg>
                {mapOpen ? 'Hide Map' : 'View on Google Maps'}
              </button>
              {mapOpen && (
                <div className="rounded-xl overflow-hidden border border-border-light">
                  <iframe
                    src={`https://www.google.com/maps?q=${v.latitude},${v.longitude}&z=15&output=embed`}
                    className="w-full h-48" loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Meeting start location" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Daily Activity Tab ----
function DailyActivityTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'meeting'; contextId: string; title: string }) => void }) {
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [weekOffset, setWeekOffset] = useState(0)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)

  function getWeekStart(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  useEffect(() => {
    setLoading(true)
    fetch(`/api/review/daily-activity?userId=${userId}&date=${selectedDate}`)
      .then(r => r.json()).then(d => { setVisits(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [userId, selectedDate])

  return (
    <div>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => { const o = weekOffset - 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        onNextWeek={() => { const o = weekOffset + 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        calendarApiBase={`/api/daily-activity/calendar?userId=${userId}`}
      />

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : visits.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No meetings on this day.</div>
      ) : (
        <div className="space-y-3">
          {visits.map(v => <ReviewVisitCard key={v.id} v={v} onOpenRemarks={onOpenRemarks} />)}
        </div>
      )}
    </div>
  )
}

// ---- Expenses Tab ----
function ExpensesTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'expense'; contextId: string; title: string }) => void }) {
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [weekOffset, setWeekOffset] = useState(0)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  function getWeekStart(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  useEffect(() => {
    setLoading(true)
    fetch(`/api/review/expenses?userId=${userId}&date=${selectedDate}`)
      .then(r => r.json()).then(d => { setExpenses(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [userId, selectedDate])

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => { const o = weekOffset - 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        onNextWeek={() => { const o = weekOffset + 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        calendarApiBase={`/api/expenses/calendar?userId=${userId}`}
      />

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : expenses.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No expenses on this day.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-4 py-3 bg-surface-sunken rounded-xl text-sm">
            <span className="text-text-secondary">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</span>
            <span className="font-medium text-text-primary">Total: ₹{total.toFixed(0)}</span>
          </div>
          {expenses.map(exp => (
            <div key={exp.id} className="bg-surface rounded-2xl border border-border-light px-5 py-4">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${CATEGORY_COLORS[exp.category] ?? 'bg-gray-100 text-gray-600'}`}>{exp.category}</span>
                <span className="text-base font-medium text-text-primary ml-auto">₹{Number(exp.amount).toFixed(0)}</span>
              </div>
              {exp.notes && <p className="text-sm text-text-muted mt-1.5">{exp.notes}</p>}
              {exp.photo_url && (
                <a href={exp.photo_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                  <img src={exp.photo_url} alt="Receipt" className="h-20 w-auto rounded-lg border border-border-light object-cover hover:opacity-90 transition" />
                </a>
              )}
              <div className="mt-2 pt-2 border-t border-border-light flex justify-end">
                <button onClick={() => onOpenRemarks({ contextType: 'expense', contextId: exp.id, title: `${exp.category} — ₹${Number(exp.amount).toFixed(0)}` })}
                  className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-subtle transition" title="Remarks">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Main Page (inner — uses useSearchParams) ----
function ReviewUserInner() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const userId = params.userId as string

  const [userName, setUserName] = useState('')
  const [userLevel, setUserLevel] = useState('')
  const initialTab = (searchParams.get('tab') as 'plans' | 'activity' | 'expenses') ?? 'plans'
  const [tab, setTab] = useState<'plans' | 'activity' | 'expenses'>(initialTab)
  const [meLoaded, setMeLoaded] = useState(false)

  // Remarks panel state
  const [remarksPanel, setRemarksPanel] = useState<RemarksState>(null)

  // Deep link: auto-open remarks from URL
  const initialRemarks = searchParams.get('remarks')
  useEffect(() => {
    if (initialRemarks) {
      const ctxType = tab === 'expenses' ? 'expense' : 'meeting'
      setRemarksPanel({ contextType: ctxType as 'meeting' | 'expense', contextId: initialRemarks, title: 'Remarks' })
    }
  }, [initialRemarks, tab])

  useEffect(() => {
    fetch('/api/review/summary-cards').then(r => r.json()).then((cards: { id: string; name: string; level: string }[]) => {
      const found = cards.find((c) => c.id === userId)
      if (found) { setUserName(found.name); setUserLevel(found.level) }
      setMeLoaded(true)
    }).catch(() => setMeLoaded(true))
  }, [userId])

  const TABS = [
    { id: 'plans', label: 'Weekly Plans' },
    { id: 'activity', label: 'Daily Activity' },
    { id: 'expenses', label: 'Expenses' },
  ] as const

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Back + Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push('/review')} className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h2 className="text-xl font-medium text-text-primary">{userName || 'Team Member'}</h2>
          {userLevel && <p className="text-xs text-text-muted">{userLevel}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-border-light">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`pb-3 px-3 text-sm font-medium border-b-2 transition ${tab === t.id ? 'border-primary-border text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {meLoaded && (
        <>
          {tab === 'plans' && <WeeklyPlansTab userId={userId} onOpenRemarks={setRemarksPanel} />}
          {tab === 'activity' && <DailyActivityTab userId={userId} onOpenRemarks={setRemarksPanel} />}
          {tab === 'expenses' && <ExpensesTab userId={userId} onOpenRemarks={setRemarksPanel} />}
        </>
      )}

      {/* Remarks Panel */}
      {remarksPanel && (
        <RemarksPanel
          isOpen={!!remarksPanel}
          onClose={() => setRemarksPanel(null)}
          contextType={remarksPanel.contextType}
          contextId={remarksPanel.contextId}
          contextTitle={remarksPanel.title}
        />
      )}
    </div>
  )
}

export default function ReviewUserPage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-text-muted">Loading...</div>}>
      <ReviewUserInner />
    </Suspense>
  )
}
