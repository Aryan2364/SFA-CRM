'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminUser = { id: string; name: string; email: string | null; contact: string; status: string }

type Company = {
  id: string; name: string; email: string | null; phone: string | null
  address: string | null; gstin: string | null; license_count: number
  payment_status: 'Active' | 'Overdue' | 'Suspended'; payment_due_date: string | null
  is_active: boolean; total_users: number; active_users: number
  adminUsers: AdminUser[]
}

type UsageSummary = {
  total_users: number; active_status: number; inactive_status: number
  actively_using: number; passive: number; low_usage: number
  not_using: number; dormant_enabled: number; adoption_rate: number
  power_users: { id: string; name: string; score_30d: number; classification: string }[]
}

type UserRow = {
  id: string; name: string; contact: string; email: string | null
  status: string; profile: string
  last_login: string | null; logins_7d: number; logins_30d: number
  last_activity: string | null
  activity_score_7d: number; activity_score_30d: number
  meetings_30d: number; meetings_completed_30d: number
  orders_30d: number
  expenses_30d: number; plans_submitted_30d: number; remarks_30d: number
  classification: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  Active: 'bg-green-50 text-green-700',
  Overdue: 'bg-yellow-50 text-yellow-700',
  Suspended: 'bg-red-50 text-red-700',
}

const CLS_STYLES: Record<string, string> = {
  actively_using:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  passive:         'bg-amber-50 text-amber-700 border border-amber-200',
  low_usage:       'bg-blue-50 text-blue-700 border border-blue-200',
  not_using:       'bg-red-50 text-red-600 border border-red-200',
  dormant_enabled: 'bg-gray-100 text-gray-500 border border-gray-300',
}

const CLS_LABELS: Record<string, string> = {
  actively_using: 'Actively Using', passive: 'Passive',
  low_usage: 'Low Usage', not_using: 'Not Using', dormant_enabled: 'Dormant',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)
  if (diff < 1)   return 'Today'
  if (diff < 2)   return 'Yesterday'
  if (diff < 7)   return `${Math.floor(diff)}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoPanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-blue-100/60 transition-colors"
      >
        <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
        </svg>
        <span className="text-sm font-medium text-blue-800 flex-1">How are scores and classifications calculated?</span>
        <svg className={`w-4 h-4 text-blue-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Points system */}
          <div>
            <p className="text-xs font-normal text-blue-700 uppercase tracking-wide mb-2">Activity Score — Weighted Points</p>
            <p className="text-xs text-blue-700 mb-2">Every action a user takes earns points. The <strong>30-day score</strong> is used for ranking and classification.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { action: 'Meeting completed',      pts: 3, icon: '✓' },
                { action: 'Order created',           pts: 3, icon: '🛒' },
                { action: 'Weekly plan submitted',   pts: 2, icon: '📋' },
                { action: 'Meeting created',         pts: 1, icon: '📍' },
                { action: 'Expense logged',          pts: 1, icon: '💸' },
                { action: 'Comment posted',          pts: 1, icon: '💬' },
              ].map(r => (
                <div key={r.action} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-blue-100">
                  <span className="text-sm">{r.icon}</span>
                  <span className="text-xs text-gray-600 flex-1">{r.action}</span>
                  <span className="text-xs font-medium text-blue-700">+{r.pts}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Classification thresholds */}
          <div>
            <p className="text-xs font-normal text-blue-700 uppercase tracking-wide mb-2">Classification Thresholds</p>
            <div className="space-y-2">
              {[
                { cls: 'actively_using',  label: 'Actively Using',   rule: 'Logged in within 7 days AND score ≥ 5 in last 7 days' },
                { cls: 'passive',         label: 'Passive',           rule: 'Logged in within 14 days BUT score < 5 in last 7 days — present but not productive' },
                { cls: 'low_usage',       label: 'Low Usage',         rule: 'Score ≥ 1 in last 30 days but does not meet active/passive criteria' },
                { cls: 'dormant_enabled', label: 'Dormant (Enabled)', rule: 'Account status is Active but no login and no activity in last 30 days — paying seat, zero use' },
                { cls: 'not_using',       label: 'Not Using',         rule: 'No login and no activity in last 30 days, account is Inactive or conditions for other classes not met' },
              ].map(r => (
                <div key={r.cls} className="flex items-start gap-3 bg-white rounded-lg px-3 py-2 border border-blue-100">
                  <span className={`mt-0.5 shrink-0 inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${CLS_STYLES[r.cls]}`}>
                    {r.label}
                  </span>
                  <span className="text-xs text-gray-500 leading-relaxed">{r.rule}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-blue-600 mt-2 italic">Classifications are re-evaluated on every page load. Data reflects the last 30 days.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`text-2xl font-medium ${color}`}>{value}</div>
      <div className="text-xs font-medium text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function ClassBadge({ cls }: { cls: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${CLS_STYLES[cls] ?? 'bg-gray-100 text-gray-500'}`}>
      {CLS_LABELS[cls] ?? cls}
    </span>
  )
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ companyId }: { companyId: string }) {
  const [summary, setSummary]   = useState<UsageSummary | null>(null)
  const [users, setUsers]       = useState<UserRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [filterCls, setFilterCls] = useState('')
  const [sortBy, setSortBy]     = useState('last_login')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [loadingS, setLoadingS] = useState(true)
  const [loadingU, setLoadingU] = useState(true)
  const LIMIT = 20

  useEffect(() => {
    fetch(`/api/superadmin/companies/${companyId}/usage-summary`)
      .then(r => r.json()).then(setSummary).catch(() => {}).finally(() => setLoadingS(false))
  }, [companyId])

  const loadUsers = useCallback(() => {
    setLoadingU(true)
    const q = new URLSearchParams({
      page: String(page), limit: String(LIMIT),
      search, classification: filterCls,
      sort: sortBy, order: sortOrder,
    })
    fetch(`/api/superadmin/companies/${companyId}/users?${q}`)
      .then(r => r.json())
      .then(d => { setUsers(d.items ?? []); setTotal(d.total ?? 0) })
      .catch(() => {})
      .finally(() => setLoadingU(false))
  }, [companyId, page, search, filterCls, sortBy, sortOrder])

  useEffect(() => { loadUsers() }, [loadUsers])

  // reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, filterCls, sortBy, sortOrder])

  function toggleSort(col: string) {
    if (sortBy === col) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortOrder('desc') }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-6">
      <InfoPanel />

      {/* Summary cards */}
      {loadingS ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total Users"      value={summary.total_users} />
            <SummaryCard label="Adoption Rate"    value={`${summary.adoption_rate}%`}
              sub="Actively using" color={summary.adoption_rate >= 60 ? 'text-emerald-600' : summary.adoption_rate >= 30 ? 'text-amber-600' : 'text-red-600'} />
            <SummaryCard label="Actively Using"   value={summary.actively_using}  color="text-emerald-600" />
            <SummaryCard label="Dormant (Enabled)" value={summary.dormant_enabled} color={summary.dormant_enabled > 0 ? 'text-red-600' : 'text-gray-900'}
              sub={summary.dormant_enabled > 0 ? 'Paying but not using' : undefined} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Passive Users"  value={summary.passive}       color="text-amber-600" sub="Logged in, no actions" />
            <SummaryCard label="Low Usage"      value={summary.low_usage}     color="text-blue-600"  sub="Occasional activity" />
            <SummaryCard label="Not Using"      value={summary.not_using}     color="text-red-600"   sub="No login in 30 days" />
            <SummaryCard label="Account Status" value={`${summary.active_status} / ${summary.total_users}`}
              sub={`${summary.inactive_status} inactive`} />
          </div>

          {/* Power Users */}
          {summary.power_users.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Power Users — Top {summary.power_users.length} by Activity (30 days)</h3>
              <div className="space-y-2">
                {summary.power_users.map((u, i) => (
                  <div key={u.id} className="flex items-center gap-3">
                    <span className="w-5 text-xs text-gray-400 font-mono text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{u.name}</span>
                        <ClassBadge cls={u.classification} />
                      </div>
                      <div className="mt-0.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (u.score_30d / (summary.power_users[0]?.score_30d || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-medium text-gray-700 w-12 text-right">{u.score_30d} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Classification breakdown bar */}
          {summary.total_users > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Engagement Breakdown</h3>
              <div className="flex h-4 rounded-full overflow-hidden gap-px">
                {[
                  { key: 'actively_using', count: summary.actively_using,  color: 'bg-emerald-400' },
                  { key: 'passive',        count: summary.passive,          color: 'bg-amber-400'   },
                  { key: 'low_usage',      count: summary.low_usage,        color: 'bg-blue-400'    },
                  { key: 'dormant_enabled',count: summary.dormant_enabled,  color: 'bg-gray-300'    },
                  { key: 'not_using',      count: summary.not_using,        color: 'bg-red-300'     },
                ].filter(s => s.count > 0).map(s => (
                  <div key={s.key} className={`${s.color} transition-all`}
                    style={{ width: `${(s.count / summary.total_users) * 100}%` }}
                    title={`${CLS_LABELS[s.key]}: ${s.count}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {[
                  { key: 'actively_using', color: 'bg-emerald-400' },
                  { key: 'passive',        color: 'bg-amber-400'   },
                  { key: 'low_usage',      color: 'bg-blue-400'    },
                  { key: 'dormant_enabled',color: 'bg-gray-300'    },
                  { key: 'not_using',      color: 'bg-red-300'     },
                ].map(s => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                    <span className="text-xs text-gray-500">{CLS_LABELS[s.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* User table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48">
            <input
              type="text" placeholder="Search name, phone, email…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <select value={filterCls} onChange={e => setFilterCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
            <option value="">All Classifications</option>
            <option value="actively_using">Actively Using</option>
            <option value="passive">Passive</option>
            <option value="low_usage">Low Usage</option>
            <option value="dormant_enabled">Dormant</option>
            <option value="not_using">Not Using</option>
          </select>
          <span className="text-xs text-gray-400">{total} user{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('last_login')}>
                  Last Login {sortBy === 'last_login' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('last_activity')}>
                  Last Action {sortBy === 'last_activity' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="text-right px-4 py-3 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('score_30d')}>
                  Score 30d {sortBy === 'score_30d' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="text-right px-4 py-3">Logins 30d</th>
                <th className="text-right px-4 py-3">Meetings</th>
                <th className="text-right px-4 py-3">Orders</th>
                <th className="text-right px-4 py-3">Expenses</th>
                <th className="text-right px-4 py-3">Plans</th>
                <th className="text-left px-4 py-3">Classification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loadingU ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-gray-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">No users found</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{u.name}</div>
                      <div className="text-xs text-gray-400">{u.contact}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div>{fmtDate(u.last_login)}</div>
                      {u.logins_7d > 0 && <div className="text-xs text-gray-400">{u.logins_7d}x this week</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(u.last_activity)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${u.activity_score_30d >= 20 ? 'text-emerald-600' : u.activity_score_30d >= 5 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {u.activity_score_30d}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{u.logins_30d}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-gray-700">{u.meetings_30d > 0 ? u.meetings_30d : '—'}</div>
                      {u.meetings_completed_30d > 0 && <div className="text-xs text-gray-400">{u.meetings_completed_30d} done</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{u.orders_30d > 0 ? u.orders_30d : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{u.expenses_30d > 0 ? u.expenses_30d : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{u.plans_submitted_30d > 0 ? u.plans_submitted_30d : '—'}</td>
                    <td className="px-4 py-3"><ClassBadge cls={u.classification} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages} · {total} users
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
                Previous
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'settings' | 'analytics'>('settings')
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '', gstin: '',
    license_count: '', payment_status: 'Active', payment_due_date: '',
  })
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null)
  const [revokeSaving, setRevokeSaving] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [showCreateAdmin, setShowCreateAdmin] = useState(false)
  const [createAdminForm, setCreateAdminForm] = useState({ name: '', contact: '', email: '', password: '' })
  const [createAdminError, setCreateAdminError] = useState('')
  const [createAdminSaving, setCreateAdminSaving] = useState(false)

  async function load() {
    const res = await fetch(`/api/superadmin/companies/${id}`)
    if (!res.ok) { router.push('/superadmin/companies'); return }
    const data: Company = await res.json()
    setCompany(data)
    setAdmins(data.adminUsers ?? [])
    setForm({
      name: data.name, email: data.email ?? '', phone: data.phone ?? '',
      address: data.address ?? '', gstin: data.gstin ?? '',
      license_count: String(data.license_count),
      payment_status: data.payment_status, payment_due_date: data.payment_due_date ?? '',
    })
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const F   = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const CAF = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setCreateAdminForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Company name is required'); return }
    setError(''); setSuccess(''); setSaving(true)
    const res = await fetch(`/api/superadmin/companies/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, gstin: form.gstin.trim().toUpperCase() || null,
        license_count: Number(form.license_count), payment_status: form.payment_status,
        payment_due_date: form.payment_due_date || null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error || 'Save failed'); return }
    setCompany(prev => prev ? { ...prev, ...data } : null)
    setSuccess('Changes saved successfully')
    setTimeout(() => setSuccess(''), 3000)
  }

  async function toggleActive() {
    if (!company) return
    if (!company.is_active) {
      const res = await fetch(`/api/superadmin/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: true }) })
      if (res.ok) setCompany(c => c ? { ...c, is_active: true } : c)
    } else { setConfirmDisable(true) }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (!createAdminForm.name.trim()) { setCreateAdminError('Name is required'); return }
    if (!/^\d{10}$/.test(createAdminForm.contact.trim())) { setCreateAdminError('Phone must be exactly 10 digits'); return }
    if (!createAdminForm.password.trim()) { setCreateAdminError('Password is required'); return }
    setCreateAdminError(''); setCreateAdminSaving(true)
    const res = await fetch(`/api/superadmin/companies/${id}/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createAdminForm) })
    const data = await res.json()
    setCreateAdminSaving(false)
    if (!res.ok) { setCreateAdminError(data.error || 'Failed to create admin'); return }
    setShowCreateAdmin(false)
    setCreateAdminForm({ name: '', contact: '', email: '', password: '' })
    await load()
  }

  async function handleRevokeAdmin() {
    if (!revokeTarget) return
    setRevokeSaving(true)
    const res = await fetch(`/api/superadmin/companies/${id}/admins/${revokeTarget.id}`, { method: 'DELETE' })
    setRevokeSaving(false)
    setRevokeTarget(null)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Revoke failed')
      return
    }
    await load()
  }

  async function confirmDisableAction() {
    setConfirmDisable(false)
    const res = await fetch(`/api/superadmin/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: false }) })
    if (res.ok) setCompany(c => c ? { ...c, is_active: false } : c)
  }

  if (loading) return <div className="flex items-center justify-center h-48"><div className="text-sm text-gray-500">Loading…</div></div>
  if (!company) return null

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/superadmin/companies')} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-medium text-gray-900">{company.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[company.payment_status]}`}>{company.payment_status}</span>
            {!company.is_active && <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Disabled</span>}
          </div>
        </div>
      </div>

      {/* Banners */}
      {admins.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <div className="text-sm text-amber-800"><span className="font-medium">No Administrator found.</span> This company has no admin user and cannot log in.</div>
          <button onClick={() => setShowCreateAdmin(true)} className="shrink-0 bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors">Create Admin</button>
        </div>
      )}
      {(!company.is_active || company.payment_status === 'Suspended') && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {!company.is_active ? 'This company is disabled. All users are blocked from logging in.' : "This company's payment is suspended. All users are blocked from logging in."}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{company.total_users}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Users</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className={`text-2xl font-medium ${company.total_users >= company.license_count ? 'text-red-600' : 'text-gray-900'}`}>
            {company.total_users} / {company.license_count}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">License Usage</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-green-600">{company.active_users}</div>
          <div className="text-xs text-gray-500 mt-0.5">Active Users</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {(['settings', 'analytics'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab === 'settings' ? 'Company Settings' : 'Users & Analytics'}
            </button>
          ))}
        </div>
      </div>

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {error   && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          {success && <div className="bg-green-50 text-green-700 text-sm px-3 py-2 rounded-lg">{success}</div>}

          <div>
            <label htmlFor="co-name" className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
            <input id="co-name" name="name" type="text" value={form.name} onChange={F('name')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="co-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="co-email" name="email" type="email" value={form.email} onChange={F('email')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label htmlFor="co-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input id="co-phone" name="phone" type="tel" value={form.phone} onChange={F('phone')} maxLength={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
          <div>
            <label htmlFor="co-address" className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea id="co-address" name="address" value={form.address} onChange={F('address')} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
          <div>
            <label htmlFor="co-gstin" className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
            <input id="co-gstin" name="gstin" type="text" value={form.gstin} onChange={F('gstin')} maxLength={15} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 uppercase" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="co-license-count" className="block text-sm font-medium text-gray-700 mb-1">License Count</label>
              <input id="co-license-count" name="license_count" type="number" value={form.license_count} onChange={F('license_count')} min={1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label htmlFor="co-payment-status" className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
              <select id="co-payment-status" name="payment_status" value={form.payment_status} onChange={F('payment_status')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                <option value="Active">Active</option>
                <option value="Overdue">Overdue</option>
                <option value="Suspended">Suspended</option>
              </select>
            </div>
            <div>
              <label htmlFor="co-due-date" className="block text-sm font-medium text-gray-700 mb-1">Payment Due Date</label>
              <input id="co-due-date" name="payment_due_date" type="date" value={form.payment_due_date} onChange={F('payment_due_date')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>

          {/* Administrators section */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-medium text-gray-900">Administrators</h2>
                <p className="text-xs text-gray-500 mt-0.5">Users with full access to this company</p>
              </div>
              <button type="button" onClick={() => setShowCreateAdmin(true)} className="text-sm font-medium text-gray-900 hover:underline">+ Add Admin</button>
            </div>
            {admins.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No administrators yet.</p>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Name</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Phone</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Email</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {admins.map(a => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{a.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{a.contact}</td>
                        <td className="px-4 py-2.5 text-gray-500">{a.email ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{a.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button type="button" onClick={() => setRevokeTarget(a)} className="text-xs text-red-600 hover:text-red-800 font-medium">Revoke</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={saving} className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={toggleActive}
              className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors ${company.is_active ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-600 hover:bg-green-50'}`}>
              {company.is_active ? 'Disable All Logins' : 'Re-enable Logins'}
            </button>
          </div>
        </form>
      )}

      {/* Analytics tab */}
      {activeTab === 'analytics' && <AnalyticsTab companyId={id} />}

      {/* Create Admin modal */}
      {showCreateAdmin && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-medium text-gray-900 mb-1">Create Admin User</h3>
            <p className="text-xs text-gray-500 mb-4">This user will be the Administrator for {company.name}</p>
            <form onSubmit={handleCreateAdmin} className="space-y-3">
              {createAdminError && <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg">{createAdminError}</div>}
              <div>
                <label htmlFor="ca-name" className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input id="ca-name" name="ca_name" type="text" value={createAdminForm.name} onChange={CAF('name')} placeholder="Admin's full name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label htmlFor="ca-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                <input id="ca-phone" name="ca_contact" type="tel" value={createAdminForm.contact} onChange={CAF('contact')} placeholder="10-digit login phone" maxLength={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label htmlFor="ca-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input id="ca-email" name="ca_email" type="email" value={createAdminForm.email} onChange={CAF('email')} placeholder="admin@company.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label htmlFor="ca-password" className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
                <input id="ca-password" name="ca_password" type="text" value={createAdminForm.password} onChange={CAF('password')} placeholder="Set a strong password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={createAdminSaving} className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50">
                  {createAdminSaving ? 'Creating…' : 'Create Admin'}
                </button>
                <button type="button" onClick={() => { setShowCreateAdmin(false); setCreateAdminError('') }} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke admin confirmation */}
      {revokeTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-medium text-gray-900 mb-2">Revoke Admin Access?</h3>
            <p className="text-sm text-gray-500 mb-1"><strong>{revokeTarget.name}</strong> will lose Administrator access immediately.</p>
            <p className="text-sm text-gray-500 mb-5">They can still log in but will see a &quot;role not configured&quot; screen until the company admin assigns them a role.</p>
            <div className="flex gap-3">
              <button onClick={handleRevokeAdmin} disabled={revokeSaving} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">{revokeSaving ? 'Revoking…' : 'Revoke'}</button>
              <button onClick={() => setRevokeTarget(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm disable dialog */}
      {confirmDisable && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-medium text-gray-900 mb-2">Disable All Logins?</h3>
            <p className="text-sm text-gray-500 mb-5">All users of <strong>{company.name}</strong> will be blocked from logging in immediately.</p>
            <div className="flex gap-3">
              <button onClick={confirmDisableAction} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">Disable</button>
              <button onClick={() => setConfirmDisable(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
