'use client'

import { useState, useEffect, ReactNode } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import StatusBadge from '@/components/ui/StatusBadge'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'

type Dept = { id: string; name: string }
type Desig = { id: string; name: string; department_id: string }
type UserRow = { id: string; name: string }
type Role = { id: string; name: string }
type DeactivateSummary = { direct_reports: number; active_meetings: number; pending_plans: number; open_orders: number }
type AuditEntry = { id: string; target_user_name: string; action: string; performed_by_name: string; metadata: Record<string, unknown>; created_at: string }

const ACTION_LABELS: Record<string, string> = {
  created: 'Account created',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  role_changed: 'Role changed',
  name_changed: 'Name changed',
}
const ACTION_COLORS: Record<string, string> = {
  created: 'bg-success-bg text-success',
  deactivated: 'bg-danger-bg text-danger',
  reactivated: 'bg-success-bg text-success',
  role_changed: 'bg-primary-subtle text-primary',
  name_changed: 'bg-surface-control text-text-secondary',
}

const COLS: Column[] = [
  { key: 'name', label: 'Name' },
  { key: 'contact', label: 'Contact' },
  { key: 'email', label: 'Email' },
  { key: 'role_display', label: 'Role', render: r => r.profile === 'Administrator' ? 'Administrator' : (r.roles as { name: string } | null)?.name ?? '—' },
  { key: 'manager', label: 'Manager', render: r => (r.manager as { name: string } | null)?.name ?? '—' },
  { key: 'status', label: 'Status', render: r => <StatusBadge status={String(r.status)} /> },
]

const INIT = { name: '', email: '', contact: '', password: '', department_id: '', designation_id: '', manager_user_id: '', role_id: '' }

export default function UsersPage() {
  const crud = useCrud('/api/masters/users', { scope: 'manage' })
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.users?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.users?.delete ?? false)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState(INIT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [depts, setDepts] = useState<Dept[]>([])
  const [allDesigs, setAllDesigs] = useState<Desig[]>([])
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [license, setLicense] = useState<{ used: number; limit: number | null } | null>(null)
  const [limitError, setLimitError] = useState(false)

  // Deactivation flow
  const [deactivateTarget, setDeactivateTarget] = useState<Record<string, unknown> | null>(null)
  const [deactivateSummary, setDeactivateSummary] = useState<DeactivateSummary | null>(null)
  const [deactivateLoading, setDeactivateLoading] = useState(false)
  const [deactivateSaving, setDeactivateSaving] = useState(false)

  // Reactivation flow
  const [reactivateTarget, setReactivateTarget] = useState<Record<string, unknown> | null>(null)
  const [reactivateForm, setReactivateForm] = useState({ role_id: '', manager_user_id: '' })
  const [reactivateError, setReactivateError] = useState('')
  const [reactivateSaving, setReactivateSaving] = useState(false)

  // Audit log
  const [showAudit, setShowAudit] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  function refreshLists() {
    fetch('/api/masters/users').then(r => r.json()).then(d => setAllUsers(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load user data. Please refresh.', 'error'))
    fetch('/api/masters/users/license').then(r => r.json()).then(setLicense).catch(() => toast('Failed to load user data. Please refresh.', 'error'))
  }

  useEffect(() => {
    fetch('/api/masters/departments').then(r => r.json()).then(d => setDepts(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load user data. Please refresh.', 'error'))
    fetch('/api/masters/designations').then(r => r.json()).then(d => setAllDesigs(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load user data. Please refresh.', 'error'))
    fetch('/api/masters/roles').then(r => r.json()).then(d => setRoles(Array.isArray(d) ? d : [])).catch(() => {})
    refreshLists()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const atLimit = license !== null && license.limit !== null && license.used >= license.limit

  const activeUsers = allUsers.filter(u => (u as unknown as Record<string, unknown>).status === 'Active')
  const managerCandidates = activeUsers.filter(u => {
    if (editing && u.id === (editing.id as string)) return false
    return true
  })


  function refreshRoles() {
    fetch('/api/masters/roles').then(r => r.json()).then(d => setRoles(Array.isArray(d) ? d : [])).catch(() => {})
  }

  function openAdd() {
    if (atLimit) { setLimitError(true); return }
    refreshRoles()
    setEditing(null); setForm(INIT); setFormError(''); setEmailError(''); setShowPassword(false); setOpen(true)
  }
  function openEdit(row: Record<string, unknown>) {
    refreshRoles()
    setEditing(row)
    setFormError('')
    setEmailError('')
    setShowPassword(false)
    setForm({
      name: String(row.name), email: String(row.email ?? ''), contact: String(row.contact),
      password: '', department_id: String(row.department_id ?? ''), designation_id: String(row.designation_id ?? ''),
      manager_user_id: String(row.manager_user_id ?? ''),
      role_id: String(row.profile) === 'Administrator' ? 'Administrator' : String((row.roles as { id: string } | null)?.id ?? ''),
    })
    setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    setEmailError('')
    if (!form.name.trim()) { setFormError('Full name is required'); return }
    if (!form.email.trim()) { setFormError('Email is required'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setEmailError('Please enter a valid email address'); return }
    if (!form.contact.trim()) { setFormError('Contact number is required'); return }
    if (!/^\d{10}$/.test(form.contact.trim())) { setFormError('Contact number must be exactly 10 digits'); return }
    if (!form.role_id) { setFormError('Role is required'); return }
    if (!editing && !form.password.trim()) { setFormError('Password is required for new users'); return }
    setSaving(true)
    const isAdminRole = form.role_id === 'Administrator'
    const body: Record<string, unknown> = { name: form.name.trim(), email: form.email.trim(), contact: form.contact.trim(), department_id: form.department_id || null, designation_id: form.designation_id || null, profile: isAdminRole ? 'Administrator' : 'Standard', manager_user_id: form.manager_user_id || null, role_id: isAdminRole ? null : (form.role_id || null) }
    if (!editing || form.password.trim()) body.password = form.password.trim()
    try {
      const res = await fetch(editing ? `/api/masters/users/${editing.id as string}` : '/api/masters/users', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setSaving(false)
      if (!res.ok) { setFormError(data.error ?? 'Save failed. Please try again.'); return }
      setOpen(false)
      crud.refetch()
      refreshLists()
    } catch {
      setSaving(false)
      setFormError('Something went wrong. Please try again.')
    }
  }

  // Deactivation
  async function startDeactivate(row: Record<string, unknown>) {
    setDeactivateTarget(row)
    setDeactivateSummary(null)
    setDeactivateLoading(true)
    try {
      const res = await fetch(`/api/masters/users/${row.id as string}/deactivation-summary`)
      if (res.ok) setDeactivateSummary(await res.json())
      else toast('Failed to load deactivation summary', 'error')
    } catch {
      toast('Failed to load deactivation summary', 'error')
    }
    setDeactivateLoading(false)
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    setDeactivateSaving(true)
    const res = await fetch(`/api/masters/users/${deactivateTarget.id as string}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate' }),
    })
    setDeactivateSaving(false)
    if (!res.ok) {
      try { const d = await res.json(); toast(d.error ?? 'Deactivation failed', 'error') }
      catch { toast('Deactivation failed', 'error') }
    }
    setDeactivateTarget(null)
    setDeactivateSummary(null)
    crud.refetch()
    refreshLists()
  }

  // Reactivation
  function startReactivate(row: Record<string, unknown>) {
    refreshRoles()
    setReactivateTarget(row)
    setReactivateError('')
    setReactivateForm({
      role_id: String(row.profile) === 'Administrator' ? 'Administrator' : String((row.roles as { id: string } | null)?.id ?? ''),
      manager_user_id: String(row.manager_user_id ?? ''),
    })
  }

  async function confirmReactivate() {
    if (!reactivateTarget) return
    setReactivateError('')
    setReactivateSaving(true)
    try {
      const isAdminRole = reactivateForm.role_id === 'Administrator'
      const res = await fetch(`/api/masters/users/${reactivateTarget.id as string}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate', profile: isAdminRole ? 'Administrator' : 'Standard', manager_user_id: reactivateForm.manager_user_id || null, role_id: isAdminRole ? null : (reactivateForm.role_id || null) }),
      })
      const data = await res.json()
      setReactivateSaving(false)
      if (!res.ok) { setReactivateError(data.error ?? 'Reactivation failed'); return }
      setReactivateTarget(null)
      crud.refetch()
      refreshLists()
    } catch {
      setReactivateSaving(false)
      setReactivateError('Something went wrong. Please try again.')
    }
  }

  // Audit log
  async function openAuditLog() {
    setShowAudit(true)
    setAuditLoading(true)
    try {
      const res = await fetch('/api/masters/users/audit-log')
      if (res.ok) { const d = await res.json(); setAuditLogs(Array.isArray(d) ? d : []) }
      else toast('Failed to load audit log', 'error')
    } catch {
      toast('Failed to load audit log', 'error')
    }
    setAuditLoading(false)
  }

  const setF = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  // Row actions: Deactivate for Active users, Reactivate for Inactive users
  function renderRowActions(row: Record<string, unknown>): ReactNode {
    if (!canDelete) return null
    if (row.status === 'Active') {
      return (
        <button
          onClick={() => startDeactivate(row)}
          className="text-amber-600 hover:text-amber-800 text-xs font-medium"
        >
          Deactivate
        </button>
      )
    }
    return (
      <button
        onClick={() => startReactivate(row)}
        className="text-emerald-600 hover:text-emerald-800 text-xs font-medium"
      >
        Reactivate
      </button>
    )
  }

  const licenseBadge = license?.limit != null ? (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${
      atLimit ? 'bg-danger-bg text-danger border-danger-border' : 'bg-surface-control text-text-secondary border-border-light'
    }`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
      {license.used} / {license.limit} Active
    </span>
  ) : null

  const headerExtra = (
    <div className="flex items-center gap-2">
      {licenseBadge}
      {isAdmin && (
        <button
          onClick={openAuditLog}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border border-border-light bg-surface text-text-secondary hover:bg-surface-sunken transition"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
          Audit Log
        </button>
      )}
    </div>
  )

  return (
    <>
      <CrudPage title="Users" headerExtra={headerExtra} backHref="/masters" columns={COLS} rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        showActive={false}
        rowActions={canDelete ? renderRowActions : undefined} />

      {/* License limit error popup */}
      {limitError && (
        <div className="fixed inset-0 bg-(--backdrop) flex items-center justify-center z-50 px-4">
          <div className="bg-surface rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-danger-bg rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-text-primary mb-1">User Limit Reached</h3>
                <p className="text-sm text-text-secondary">
                  Active user limit reached ({license?.used}/{license?.limit}). To add more users, please contact{' '}
                  <span className="font-medium text-text-primary">My Prosys Support team</span> to upgrade your plan.
                </p>
              </div>
            </div>
            <button onClick={() => setLimitError(false)} className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">Close</button>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal title={editing ? 'Edit User' : 'Add User'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        {formError && (
          <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3 -mt-2">{formError}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label htmlFor="user-name" className="block text-sm font-medium text-text-secondary mb-1">Full Name <span className="text-danger">*</span></label>
            <input id="user-name" name="name" type="text" value={form.name} onChange={e => setF('name')(e.target.value)} placeholder="Full name" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label htmlFor="user-email" className="block text-sm font-medium text-text-secondary mb-1">Email <span className="text-danger">*</span></label>
            <input id="user-email" name="email" type="email" value={form.email} onChange={e => { setF('email')(e.target.value); setEmailError('') }} placeholder="email@example.com"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring ${emailError ? 'border-danger-border' : 'border-border'}`} />
            {emailError && <p className="text-xs text-danger mt-1">{emailError}</p>}
          </div>
          <div>
            <label htmlFor="user-contact" className="block text-sm font-medium text-text-secondary mb-1">Contact <span className="text-danger">*</span></label>
            <input id="user-contact" name="contact" type="tel" value={form.contact}
              onChange={e => setF('contact')(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile" maxLength={10}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label htmlFor="user-password" className="block text-sm font-medium text-text-secondary mb-1">
              Password {editing ? <span className="text-text-muted font-normal">(leave blank to keep current)</span> : <span className="text-danger">*</span>}
            </label>
            <div className="relative">
              <input id="user-password" name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setF('password')(e.target.value)} placeholder={editing ? 'Enter new password to change' : 'Set login password'} className="w-full border border-border rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition" tabIndex={-1}>
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <p className="block text-sm font-medium text-text-secondary mb-1">Department</p>
            <SearchableSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v, designation_id: '' }))} options={depts.map(d => ({ value: d.id, label: d.name }))} placeholder="Select dept…" />
          </div>
          <div>
            <p className="block text-sm font-medium text-text-secondary mb-1">Designation</p>
            <SearchableSelect value={form.designation_id} onChange={setF('designation_id')} options={allDesigs.map(d => ({ value: d.id, label: d.name }))} placeholder="Select desig…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Role <span className="text-danger">*</span></label>
            <SearchableSelect
              value={form.role_id}
              onChange={setF('role_id')}
              options={[{ value: 'Administrator', label: 'Administrator' }, ...roles.map(r => ({ value: r.id, label: r.name }))]}
              placeholder="Select role…"
            />
            {roles.length === 0 && <p className="text-xs text-warning mt-1">No custom roles yet. Create them in Settings → Access Control → Roles &amp; Permissions.</p>}
          </div>
          <div className="col-span-2">
            <p className="block text-sm font-medium text-text-secondary mb-1">Manager</p>
            <SearchableSelect value={form.manager_user_id} onChange={setF('manager_user_id')} options={managerCandidates.map(u => ({ value: u.id, label: u.name }))} placeholder="Select manager…" />
          </div>
        </div>
      </Modal>

      {/* Deactivation Warning Modal */}
      {deactivateTarget && (
        <div className="fixed inset-0 bg-(--backdrop) flex items-center justify-center z-50 px-4">
          <div className="bg-surface rounded-2xl shadow-xl p-6 max-w-md w-full">
            <div className="flex items-start gap-3 mb-5">
              <div className="flex-shrink-0 w-10 h-10 bg-warning-bg rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Deactivate {String(deactivateTarget.name)}?</h3>
                <p className="text-sm text-text-muted mt-0.5">This user will immediately lose login access. Their data stays intact.</p>
              </div>
            </div>

            {deactivateLoading ? (
              <div className="bg-surface-sunken rounded-xl p-4 text-sm text-text-muted text-center">Loading linked records…</div>
            ) : deactivateSummary ? (
              <div className="bg-warning-bg border border-warning-border rounded-xl p-4 mb-5">
                <p className="text-xs font-normal text-warning uppercase tracking-wide mb-3">Linked Records</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Direct reports', value: deactivateSummary.direct_reports },
                    { label: 'Active meetings', value: deactivateSummary.active_meetings },
                    { label: 'Pending plans', value: deactivateSummary.pending_plans },
                    { label: 'Open orders', value: deactivateSummary.open_orders },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between bg-surface rounded-lg px-3 py-2 border border-warning-border">
                      <span className="text-xs text-text-secondary">{label}</span>
                      <span className={`text-sm font-medium ${value > 0 ? 'text-warning' : 'text-text-secondary'}`}>{value}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-warning mt-3">Records remain accessible for Admin review and redistribution.</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                onClick={() => { setDeactivateTarget(null); setDeactivateSummary(null) }}
                className="flex-1 border border-border-light text-text-secondary py-2 rounded-lg text-sm font-medium hover:bg-surface-sunken transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeactivate}
                disabled={deactivateSaving}
                className="flex-1 bg-amber-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition"
              >
                {deactivateSaving ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivation Confirmation Modal */}
      {reactivateTarget && (
        <div className="fixed inset-0 bg-(--backdrop) flex items-center justify-center z-50 px-4">
          <div className="bg-surface rounded-2xl shadow-xl p-6 max-w-md w-full">
            <div className="flex items-start gap-3 mb-5">
              <div className="flex-shrink-0 w-10 h-10 bg-success-bg rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-text-primary">Reactivate {String(reactivateTarget.name)}?</h3>
                <p className="text-sm text-text-muted mt-0.5">Review and confirm the user&apos;s role and manager before reactivating.</p>
              </div>
            </div>

            {reactivateError && (
              <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3 mb-4">{reactivateError}</div>
            )}

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Role</label>
                <SearchableSelect
                  value={reactivateForm.role_id}
                  onChange={v => setReactivateForm(f => ({ ...f, role_id: v }))}
                  options={[{ value: 'Administrator', label: 'Administrator' }, ...roles.map(r => ({ value: r.id, label: r.name }))]}
                  placeholder="Select role…"
                />
              </div>
              <div>
                <p className="block text-sm font-medium text-text-secondary mb-1">Reporting Manager</p>
                <SearchableSelect
                  value={reactivateForm.manager_user_id}
                  onChange={v => setReactivateForm(f => ({ ...f, manager_user_id: v }))}
                  options={activeUsers.filter(u => u.id !== reactivateTarget.id).map(u => ({ value: u.id, label: u.name }))}
                  placeholder="Select manager…"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setReactivateTarget(null)}
                className="flex-1 border border-border-light text-text-secondary py-2 rounded-lg text-sm font-medium hover:bg-surface-sunken transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmReactivate}
                disabled={reactivateSaving}
                className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {reactivateSaving ? 'Reactivating…' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Modal */}
      {showAudit && (
        <div className="fixed inset-0 bg-(--backdrop) flex items-center justify-center z-50 px-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <h3 className="font-medium text-text-primary">User Account Audit Log</h3>
              <button onClick={() => setShowAudit(false)} className="text-text-muted hover:text-text-secondary transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {auditLoading ? (
                <p className="text-sm text-text-muted text-center py-8">Loading…</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No audit entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b border-border-light last:border-0">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 ${ACTION_COLORS[entry.action] ?? 'bg-surface-control text-text-secondary'}`}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary font-medium">{entry.target_user_name}</p>
                        {entry.action === 'role_changed' && Boolean(entry.metadata.from) && (
                          <p className="text-xs text-text-muted">{String(entry.metadata.from)} → {String(entry.metadata.to)}</p>
                        )}
                        {entry.action === 'name_changed' && Boolean(entry.metadata.from) && (
                          <p className="text-xs text-text-muted">{String(entry.metadata.from)} → {String(entry.metadata.to)}</p>
                        )}
                        <p className="text-xs text-text-muted mt-0.5">by {entry.performed_by_name}</p>
                      </div>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
