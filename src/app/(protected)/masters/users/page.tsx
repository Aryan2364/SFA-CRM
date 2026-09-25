'use client'

import { useState, useEffect } from 'react'
import { PencilIcon, PlusIcon, ScrollTextIcon, UsersIcon } from 'lucide-react'

import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge, USER_STATUS } from '@/components/status-badge'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Dept = { id: string; name: string }
type Desig = { id: string; name: string; department_id: string }
type Role = { id: string; name: string }
type DeactivateSummary = { direct_reports: number; active_meetings: number; pending_plans: number; open_orders: number }
type AuditEntry = { id: string; target_user_name: string; action: string; performed_by_name: string; metadata: Record<string, unknown>; created_at: string }

/**
 * `/api/masters/users` returns the whole row plus two embeds. `roles` is
 * selected with `{ name: true }` only, so `roles.id` is absent on the
 * wire — the edit form has always read it and always got `undefined`
 * for a non-administrator. Typed optional so that stays visible rather
 * than being asserted away; fixing it is a change to the route.
 */
type UserRow = {
  id: string
  name: string
  email: string | null
  contact: string
  status: string | null
  profile: string | null
  department_id: string | null
  designation_id: string | null
  manager_user_id: string | null
  roles: { id?: string; name: string } | null
  manager: { id: string; name: string } | null
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Account created',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  role_changed: 'Role changed',
  name_changed: 'Name changed',
}
const ACTION_COLORS: Record<string, string> = {
  created: 'bg-green-100 text-green-700',
  deactivated: 'bg-red-100 text-red-700',
  reactivated: 'bg-emerald-100 text-emerald-700',
  role_changed: 'bg-blue-100 text-blue-700',
  name_changed: 'bg-gray-100 text-gray-700',
}

/**
 * Section 27.1: the field carries the list of fields it covers, so
 * nobody concludes an account does not exist when they searched a field
 * the box never looked at.
 *
 * `/api/masters/users` matches `q` against `name`, `email` and
 * `contact`. The manager's name is not reachable from there, and role
 * and status are filters instead — this conversion did not change the
 * route, so the hint states what is true today.
 */
const SEARCH_HINT =
  'Searches the name, email address and contact number. Role and status are filters; the manager’s name is not searched.'

/** The label the Role column shows, and the value the Role filter matches. */
function roleLabel(user: UserRow) {
  if (user.profile === 'Administrator') return 'Administrator'
  return user.roles?.name ?? '—'
}

/**
 * COLUMN CLASSIFICATION — section 10 rule 4.
 *
 *   essential          Name, Contact, Role, Status, actions
 *   hide-below-1024    Email, Manager
 *
 * Name grows and truncates: section 8 wants exactly one column taking
 * the table's slack and the identifier is the one that can afford to.
 * Contact is the account's unique key in this tenant (`users_tenant_contact`)
 * and the only way to reach the person, so it is short, essential and
 * never dropped. Role and Status are what this screen exists to
 * administer — who can do what, and whether they can sign in at all —
 * and Status also decides which row action is offered, so a reader who
 * loses it loses the reason the button says what it says. The actions
 * are the only route to Edit and to Deactivate/Reactivate; a control
 * that disappears at 768 is a capability that disappears.
 *
 * Email and Manager go first: both are long text, both are on the edit
 * form, and neither is acted on from the list. Nothing that drops
 * becomes unreachable.
 *
 * Seven columns at 1280, five at 768. Measured at both — see the report
 * for `scrollWidth` against `clientWidth`.
 */
function userColumns({
  canEdit,
  canDelete,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (user: UserRow) => void
  onDeactivate: (user: UserRow) => void
  onReactivate: (user: UserRow) => void
}): ListColumn<UserRow>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: user => user.name,
    },
    {
      id: 'contact',
      header: 'Contact',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-24',
      truncate: true,
      cell: user => user.contact || '—',
    },
    {
      id: 'email',
      header: 'Email',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-40',
      cell: user => user.email ?? '—',
    },
    {
      id: 'role',
      header: 'Role',
      truncate: true,
      skeletonWidth: 'w-24',
      cell: roleLabel,
    },
    {
      id: 'manager',
      header: 'Manager',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: user => user.manager?.name ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-20',
      cell: user => <StatusBadge vocabulary={USER_STATUS} status={user.status} />,
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-28',
      /*
       * Section 15.2: a user account is referenced by every meeting,
       * plan and order it ever touched, so deactivation is the action
       * that is always available and there is no Delete here at all.
       * It is therefore NOT danger-styled — nothing has gone wrong and
       * nothing is destroyed; section 15.1's closing argument is that a
       * red control states a failure that has not happened.
       */
      cell: user => (
        <div className="flex items-center justify-end gap-2">
          {canEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onEdit(user)}
                  />
                }
              >
                <PencilIcon />
                <span className="sr-only">Edit {user.name}</span>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          )}
          {canDelete &&
            (user.status === 'Active' ? (
              <Button variant="secondary" onClick={() => onDeactivate(user)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => onReactivate(user)}>
                Reactivate
              </Button>
            ))}
        </div>
      ),
    },
  ]
}

const INIT = { name: '', email: '', contact: '', password: '', department_id: '', designation_id: '', manager_user_id: '', role_id: '' }

export default function UsersPage() {
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.users?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.users?.delete ?? false)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
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
  /* Bumped when a create, an edit, a deactivation or a reactivation
     makes the list stale. The template's only refetch lever. */
  const [refreshKey, setRefreshKey] = useState(0)

  // Deactivation flow
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null)
  const [deactivateSummary, setDeactivateSummary] = useState<DeactivateSummary | null>(null)
  const [deactivateLoading, setDeactivateLoading] = useState(false)
  const [deactivateSaving, setDeactivateSaving] = useState(false)

  // Reactivation flow
  const [reactivateTarget, setReactivateTarget] = useState<UserRow | null>(null)
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

  const activeUsers = allUsers.filter(u => u.status === 'Active')
  const managerCandidates = activeUsers.filter(u => !(editing && u.id === editing.id))

  function refreshRoles() {
    fetch('/api/masters/roles').then(r => r.json()).then(d => setRoles(Array.isArray(d) ? d : [])).catch(() => {})
  }

  function openAdd() {
    if (atLimit) { setLimitError(true); return }
    refreshRoles()
    setEditing(null); setForm(INIT); setFormError(''); setEmailError(''); setShowPassword(false); setOpen(true)
  }
  function openEdit(row: UserRow) {
    refreshRoles()
    setEditing(row)
    setFormError('')
    setEmailError('')
    setShowPassword(false)
    setForm({
      name: row.name, email: row.email ?? '', contact: row.contact,
      password: '', department_id: row.department_id ?? '', designation_id: row.designation_id ?? '',
      manager_user_id: row.manager_user_id ?? '',
      role_id: row.profile === 'Administrator' ? 'Administrator' : (row.roles?.id ?? ''),
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
      const res = await fetch(editing ? `/api/masters/users/${editing.id}` : '/api/masters/users', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setSaving(false)
      if (!res.ok) { setFormError(data.error ?? 'Save failed. Please try again.'); return }
      setOpen(false)
      setRefreshKey(k => k + 1)
      refreshLists()
    } catch {
      setSaving(false)
      setFormError('Something went wrong. Please try again.')
    }
  }

  // Deactivation
  async function startDeactivate(row: UserRow) {
    setDeactivateTarget(row)
    setDeactivateSummary(null)
    setDeactivateLoading(true)
    try {
      const res = await fetch(`/api/masters/users/${row.id}/deactivation-summary`)
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
    const res = await fetch(`/api/masters/users/${deactivateTarget.id}`, {
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
    setRefreshKey(k => k + 1)
    refreshLists()
  }

  // Reactivation
  function startReactivate(row: UserRow) {
    refreshRoles()
    setReactivateTarget(row)
    setReactivateError('')
    setReactivateForm({
      role_id: row.profile === 'Administrator' ? 'Administrator' : (row.roles?.id ?? ''),
      manager_user_id: row.manager_user_id ?? '',
    })
  }

  async function confirmReactivate() {
    if (!reactivateTarget) return
    setReactivateError('')
    setReactivateSaving(true)
    try {
      const isAdminRole = reactivateForm.role_id === 'Administrator'
      const res = await fetch(`/api/masters/users/${reactivateTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate', profile: isAdminRole ? 'Administrator' : 'Standard', manager_user_id: reactivateForm.manager_user_id || null, role_id: isAdminRole ? null : (reactivateForm.role_id || null) }),
      })
      const data = await res.json()
      setReactivateSaving(false)
      if (!res.ok) { setReactivateError(data.error ?? 'Reactivation failed'); return }
      setReactivateTarget(null)
      setRefreshKey(k => k + 1)
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

  /*
   * Deliberately NOT memoised: the template holds `load` in a ref and
   * never makes it an effect dependency. No deadline and no catch here
   * either — the template races this against its own timer, so a
   * rejection IS the failed state (section 14 rules 3 and 4).
   *
   * `/api/masters/users` takes `q` and `scope` and nothing else, so the
   * two filters narrow the answer here rather than in SQL. The template
   * counts, pages and empty-states off what this returns, so all four
   * behave identically whichever side of the wire they run.
   */
  const load: ListPageProps<UserRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams({ scope: 'manage' })
    if (search) params.set('q', search)
    const r = await fetch(`/api/masters/users?${params.toString()}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: UserRow[] = Array.isArray(body) ? body : []
    return rows.filter(user => {
      if (filters.status && user.status !== filters.status) return false
      if (filters.role && roleLabel(user) !== filters.role) return false
      return true
    })
  }

  const filters: ListFilter[] = [
    {
      id: 'status',
      label: 'Status',
      kind: 'select',
      options: { '': 'Any status', Active: 'Active', Inactive: 'Inactive' },
    },
    {
      id: 'role',
      label: 'Role',
      kind: 'select',
      /* Section 16.3: a tenant's custom roles run past six sooner than
         they do not, and Administrator is always one more. */
      searchable: roles.length > 5,
      options: {
        '': 'Any role',
        Administrator: 'Administrator',
        ...Object.fromEntries(roles.map(r => [r.name, r.name])),
      },
    },
  ]

  const licenseBadge = license?.limit != null ? (
    /* A faithful port of the badge this screen already carried: the
       same two states, and `danger` is the same three tokens it was
       already painted in — not a new section 2.4 judgement. */
    <Badge variant={atLimit ? 'danger' : 'neutral'}>
      <UsersIcon />
      {license.used} / {license.limit} active
    </Badge>
  ) : null

  /*
   * Section 6.1 rules 1 and 2 are what license three things here, and
   * this is the same answer the leads conversion gave to the same
   * question: exactly ONE primary action per screen, everything else
   * secondary, all of it in zone 1's single action slot rather than
   * invented somewhere else on the page. Add user is the primary; the
   * audit log is a secondary way of reading the same records; and the
   * licence badge is meta about them, so it leads the group at badge
   * weight. Section 11.1's "one primary action button on the right" is
   * satisfied: there is one primary, and it is on the right.
   */
  const action =
    licenseBadge || isAdmin || canEdit ? (
      <div className="flex items-center gap-2">
        {licenseBadge}
        {/* Section 26: gated on the same test the route itself applies
            — `/api/masters/users/audit-log` answers 403 to anyone who
            is not an Administrator, so any wider gate here would show a
            control that fails after being clicked. */}
        {isAdmin && (
          <Button variant="secondary" onClick={openAuditLog}>
            <ScrollTextIcon />
            Audit Log
          </Button>
        )}
        {canEdit && (
          <Button onClick={openAdd}>
            <PlusIcon />
            Add user
          </Button>
        )}
      </div>
    ) : undefined

  return (
    <>
      {/*
        OVERNIGHT: §1 rule 11 forbids a back arrow; breadcrumb replaces it. list-page has no breadcrumb zone — see overnight-queue-2026-09-18.md

        `CrudPage` gave this screen `backHref="/masters"`, which renders
        a left-chevron "Back to Masters" link — the control section 1
        rule 11 and section 11.2 both forbid outright. The NAVIGATION is
        not forbidden and must not be dropped: /masters/users is absent
        from the sidebar by design (see shell/nav.ts), so this is the
        only route back. Section 11.2's breadcrumb is the sanctioned
        replacement, and `components/ui/breadcrumb.tsx` already exists.

        It is placed here rather than in the template because section
        11.1 has four zones and none of them is a breadcrumb — that is
        section 11.2's zone 1, on a detail page. Rejected: the `action`
        slot (navigation dressed up as an action) and `toolbarExtra`
        (zone 2, which section 11.6 reserves for the view switcher).

        THE HEIGHT CHAIN. The shell's content box is `h-full` with a
        definite height and `overflow-y-auto`, so a plain block wrapper
        — or the breadcrumb as a bare sibling of a `h-full` ListPage —
        would sum to more than 100% and hand the scroll to the PAGE,
        which is the one thing section 10 does not allow here. This
        wrapper is therefore a flex column of that same definite height:
        the breadcrumb is `shrink-0` and the template is `flex-1
        min-h-0` with its own `h-full` merged away by `cn`, so the
        template's root is sized purely by the remaining space and zone
        3 still owns the only scroll.

        Reasoned from the CSS, NOT verified in a browser — no session
        was available this run. This is the highest-risk unverified
        claim on the screen; see the report.
      */}
      <div className="flex min-h-0 flex-col md:h-full">
        <Breadcrumb className="mb-4 shrink-0">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Users</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <ListPage<UserRow>
          /* `h-auto` is not cosmetic: it is what makes `cn` drop the
             template's own `h-full`, so the root carries no
             `height: 100%` to argue with the flex basis. */
          className="md:h-auto md:min-h-0 md:flex-1"
          title="Users"
          noun={{ one: 'user', many: 'users' }}
          action={action}
          columns={userColumns({
            canEdit,
            canDelete,
            onEdit: openEdit,
            onDeactivate: startDeactivate,
            onReactivate: startReactivate,
          })}
          rowKey={user => user.id}
          filters={filters}
          load={load}
          refreshKey={refreshKey}
          searchHint={SEARCH_HINT}
          emptyYet={{
            heading: 'No users yet',
            body: 'Everyone who can sign in to this workspace is listed here, with the role that decides what they can reach.',
            actionLabel: canEdit ? 'Add user' : undefined,
            onAction: canEdit ? openAdd : undefined,
          }}
        />
      </div>

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
                <h3 className="font-medium text-text-primary">Deactivate {deactivateTarget.name}?</h3>
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
                <h3 className="font-medium text-text-primary">Reactivate {reactivateTarget.name}?</h3>
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
