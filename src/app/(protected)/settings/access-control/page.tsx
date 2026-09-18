'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { invalidateMeCache } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import {
  OPERATION_SECTIONS,
  POINTS_SECTIONS,
  mastersInGroup,
  type MasterGroup,
} from '@/lib/masters-registry'
import type { OperationSection } from '@/lib/permissions'

type UserEntry = { id: string; name: string }
type VisibilityEntry = { id: string; target_user_id: string; name: string }
type OrgUser = { id: string; name: string; role: string; manager_user_id: string | null }
type OrgNode = { id: string; name: string; role: string; children: OrgNode[] }
type Role = { id: string; name: string; is_system: boolean }
type SectionPerms = { view: boolean; create: boolean; edit: boolean; delete: boolean; data_scope: string }
type PermMap = Record<string, SectionPerms>

// ─────────────────────────────────────────────────────────────────
// Page root — Suspense required for useSearchParams in Next.js 14
// ─────────────────────────────────────────────────────────────────
export default function AccessControlPage() {
  return (
    <Suspense>
      <AccessControlContent />
    </Suspense>
  )
}

function AccessControlContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = searchParams.get('tab') ?? 'schema'
  const preselected = searchParams.get('selectedUser') ?? null

  const setTab = (t: string) => {
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', t)
    p.delete('selectedUser')
    router.push(`/settings/access-control?${p}`)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-text-primary">Access Control</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Configure roles, permissions, and who can view which users
        </p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border-light">
        <TabButton active={tab === 'roles'} onClick={() => setTab('roles')}>Roles &amp; Permissions</TabButton>
        <TabButton active={tab === 'schema'} onClick={() => setTab('schema')}>Reporting Schema</TabButton>
        <TabButton active={tab === 'chart'} onClick={() => setTab('chart')}>Org Chart</TabButton>
      </div>

      {tab === 'roles' ? (
        <RolesPermissions />
      ) : tab === 'schema' ? (
        <ReportingSchema preselectedUserId={preselected} />
      ) : (
        <OrgChart />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-primary-border text-primary' : 'border-transparent text-text-secondary hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// Roles & Permissions Tab
// ─────────────────────────────────────────────────────────────────
type PermSectionDef = { key: string; label: string; isOperation?: boolean }
type PermGroup = { group: string; module: string; sections: PermSectionDef[] }

/**
 * The Masters Module half of the matrix is DERIVED from src/lib/masters-registry.ts.
 *
 * It used to be a literal, and the literal omitted dealers, distributors and
 * institutions — which meant no administrator could ever grant those three
 * permissions, because this table is the only place the toggle exists. The
 * registry is now the only list, so a master cannot be added without its row
 * appearing here.
 *
 * distributors and institutions have no screen yet (P1-T18), but their APIs are
 * live and do check the permission, so the toggle is real and belongs here.
 *
 * Group headings live here rather than in the registry: this table and the
 * Masters page group the same masters under different headings, in a different
 * order. `group` in the registry is an id; this is its label.
 */
const MASTER_GROUP_LABELS: { group: MasterGroup; label: string }[] = [
  { group: 'locations',         label: 'Locations' },
  { group: 'business_partners', label: 'Business Partners' },
  { group: 'products',          label: 'Products' },
  { group: 'organisation',      label: 'Organisation' },
  { group: 'lead_config',       label: 'Lead Configuration' },
]

/**
 * The Operations Module half is DERIVED from OPERATION_SECTIONS, the same way
 * the Masters half is derived from MASTERS.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A `Record<OperationSection, …>` AND NOT A LIST
 *
 * It used to be a hand-written list of six, and three sections that every
 * route enforces — `companies`, `contacts` and `deals` — were never added to
 * it. The effect is not a missing row on a screen: **this table is the only
 * place the toggle exists**, so those three permissions could be held in
 * `role_permissions` and checked on every request, and no administrator could
 * grant or revoke any of them. It was invisible because the three were
 * backfilled from each role's `leads` grant when they were introduced, so
 * every EXISTING role happened to have sensible values. A NEW role got
 * nothing for all three, with no way to give it anything.
 *
 * A `Record` keyed by the `OperationSection` union is what stops that
 * recurring. TypeScript requires an entry for every member of the union and
 * rejects a key that is not in it, so:
 *
 *   - adding a section to OPERATION_SECTIONS without labelling it here is a
 *     COMPILE ERROR, not a silently missing toggle;
 *   - a stale key left here after a section is removed is also a compile
 *     error, rather than a toggle that writes a section no route reads.
 *
 * Both directions are checked by `tsc`, which is the only check that runs
 * without anybody remembering to look.
 *
 * ---------------------------------------------------------------------------
 * `isOperation` IS NOT DECORATION
 *
 * It renders the Data Scope column: `true` gives the own/team/all select,
 * `false` renders "—". It must be `true` exactly when the section's routes
 * actually read `data_scope`. All three new sections do — `companies`,
 * `contacts` and `deals` each go through `scopedUserIds()` in
 * `src/lib/scope.ts` — so all three get a real select. `system_settings` does
 * not and keeps its dash: `tenant_settings` holds one row per tenant, so there
 * is no own/team/all to choose between.
 */
const OPERATION_GROUPS = [
  { id: 'daily_operations', module: 'Operations Module', label: 'Daily Operations' },
  { id: 'parties_pipeline', module: 'Operations Module', label: 'Parties & Pipeline' },
  { id: 'configuration',    module: 'Settings Module',   label: 'Configuration' },
] as const

type OperationGroupId = typeof OPERATION_GROUPS[number]['id']

type OperationRow = {
  label: string
  group: OperationGroupId
  /** Does this section's data_scope actually do anything? See above. */
  isOperation: boolean
}

const OPERATION_ROWS: Record<OperationSection, OperationRow> = {
  meetings:    { label: 'Meetings',       group: 'daily_operations', isOperation: true },
  expenses:    { label: 'Expenses',       group: 'daily_operations', isOperation: true },
  weekly_plan: { label: 'Weekly Plan',    group: 'daily_operations', isOperation: true },
  orders:      { label: 'Orders',         group: 'daily_operations', isOperation: true },
  /*
   * `leads` is the LEGACY key. `companies` replaced it as the Party section and
   * the three new rows below were backfilled from this one's grants, so a
   * tenant that has never been touched since shows the same values in both
   * places. It is left in Daily Operations, where administrators are used to
   * finding it, rather than moved down to Parties & Pipeline where it now
   * arguably belongs — moving a row is a change to muscle memory for no
   * functional gain. Retiring the key is its own task; until then it is still
   * read by `/api/business-partners` and must stay grantable.
   */
  leads:       { label: 'Leads',          group: 'daily_operations', isOperation: true },
  users:       { label: 'Users (Master)', group: 'daily_operations', isOperation: true },

  /* Added here at the same time as this Record. Each is enforced by its routes
     and scoped by `src/lib/scope.ts`; none was grantable before. */
  companies:   { label: 'Companies',      group: 'parties_pipeline', isOperation: true },
  contacts:    { label: 'Contacts',       group: 'parties_pipeline', isOperation: true },
  deals:       { label: 'Deals',          group: 'parties_pipeline', isOperation: true },

  system_settings: { label: 'System Settings', group: 'configuration', isOperation: false },
}

const PERM_GROUPS: PermGroup[] = [
  ...MASTER_GROUP_LABELS.map(({ group, label }) => ({
    module: 'Masters Module',
    group: label,
    sections: mastersInGroup(group).map(m => ({ key: m.key, label: m.label })),
  })),
  /* Driven off OPERATION_SECTIONS itself, so the ORDER of the rows within a
     group follows the registry and a section cannot be dropped by being
     forgotten in a second list. */
  ...OPERATION_GROUPS.map(({ id, module, label }) => ({
    module,
    group: label,
    sections: OPERATION_SECTIONS
      .filter(key => OPERATION_ROWS[key].group === id)
      .map(key => ({
        key,
        label: OPERATION_ROWS[key].label,
        isOperation: OPERATION_ROWS[key].isOperation,
      })),
  })),
  {
    /*
     * ⚠️ THESE TWO BEHAVE DIFFERENTLY IN DEV AND IN PRODUCTION. Do not "fix"
     * either one against what you observe locally.
     *
     * `leaderboard` and `points_config` are deliberately kept OUT of
     * ALL_SECTIONS (see POINTS_SECTIONS in src/lib/masters-registry.ts) on the
     * grounds that production's `role_permissions_section_check` constraint
     * does not list them, so an INSERT for either fails there.
     *
     * **The local database has no CHECK constraint on `role_permissions`
     * at all** — Prisma does not model CHECKs, so `db push` never created one,
     * exactly as with `orders.status`. Toggling either of these locally
     * therefore returns 200 and writes a row, which is the OPPOSITE of what it
     * does in production. Verified: a PUT for `leaderboard` inserted a row on
     * localhost. So local success here is not evidence the toggle works, and
     * local behaviour must not be used to justify promoting these two into
     * ALL_SECTIONS.
     *
     * They are the mirror-image of the bug the Record above fixes: a toggle
     * that renders for a section the store may reject, rather than a section
     * with no toggle at all. They are rendered because they were rendered
     * before and `/api/auth/me` still reports them; removing them would drop
     * two capabilities from the screen without delivering the constraint
     * change that is the actual fix. Derived from POINTS_SECTIONS rather than
     * retyped so the two lists cannot disagree about which keys are in this
     * state.
     */
    module: 'Points Module',
    group: 'Gamification',
    sections: POINTS_SECTIONS.map(key => ({
      key,
      label: key === 'leaderboard' ? 'Leaderboard (View Team/All)' : 'Points Configuration',
      isOperation: false,
    })),
  },
]

const EMPTY_PERMS: SectionPerms = { view: false, create: false, edit: false, delete: false, data_scope: 'own' }

function RolesPermissions() {
  const { toast } = useToast()
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [perms, setPerms] = useState<PermMap>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showNewRole, setShowNewRole] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const loadRoles = useCallback(async () => {
    const r = await fetch('/api/settings/roles')
    const data = await r.json()
    const list: Role[] = Array.isArray(data) ? data : []
    setRoles(list)
    if (list.length > 0 && !selectedRole) setSelectedRole(list[0])
  }, [selectedRole])

  useEffect(() => { loadRoles() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedRole) return
    if (selectedRole.name === 'Administrator') {
      const all: PermMap = {}
      for (const g of PERM_GROUPS) for (const s of g.sections) all[s.key] = { view: true, create: true, edit: true, delete: true, data_scope: 'all' }
      setPerms(all)
      return
    }
    fetch(`/api/settings/role-permissions?profile=${encodeURIComponent(selectedRole.name)}`)
      .then(r => r.json())
      .then((d: PermMap) => setPerms(d))
  }, [selectedRole])

  async function toggle(section: string, action: keyof Omit<SectionPerms, 'data_scope'>, value: boolean) {
    if (!selectedRole || selectedRole.name === 'Administrator') return
    const current = perms[section] ?? EMPTY_PERMS
    let next = { ...current, [action]: value }
    // Cascade: enabling create/edit/delete → enable view
    if ((action === 'create' || action === 'edit' || action === 'delete') && value) next.view = true
    // Cascade: disabling view → disable all others
    if (action === 'view' && !value) { next.create = false; next.edit = false; next.delete = false }

    setPerms(p => ({ ...p, [section]: next }))
    setSaving(section)
    await savePerms(section, next)
    setSaving(null)
    invalidateMeCache()
  }

  async function toggleAll(section: string, allOn: boolean) {
    if (!selectedRole || selectedRole.name === 'Administrator') return
    const current = perms[section] ?? EMPTY_PERMS
    const next: SectionPerms = allOn
      ? { ...current, view: true, create: true, edit: true, delete: true }
      : { ...current, view: false, create: false, edit: false, delete: false }
    setPerms(p => ({ ...p, [section]: next }))
    setSaving(section)
    await savePerms(section, next)
    setSaving(null)
    invalidateMeCache()
  }

  async function setScope(section: string, data_scope: string) {
    if (!selectedRole || selectedRole.name === 'Administrator') return
    const current = perms[section] ?? EMPTY_PERMS
    const next = { ...current, data_scope }
    setPerms(p => ({ ...p, [section]: next }))
    setSaving(section)
    await savePerms(section, next)
    setSaving(null)
  }

  async function savePerms(section: string, p: SectionPerms) {
    await fetch('/api/settings/role-permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: selectedRole!.name,
        section,
        can_view: p.view,
        can_create: p.create,
        can_edit: p.edit,
        can_delete: p.delete,
        data_scope: p.data_scope,
      }),
    })
  }

  async function handleCreateRole() {
    if (!newRoleName.trim()) return
    setCreating(true)
    const r = await fetch('/api/settings/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRoleName.trim() }),
    })
    const data = await r.json()
    setCreating(false)
    if (!r.ok) { toast(data.error ?? 'Failed to create role', 'error'); return }
    setNewRoleName('')
    setShowNewRole(false)
    const newRole: Role = { id: data.id, name: data.name, is_system: false }
    setRoles(prev => [...prev, newRole])
    setSelectedRole(newRole)
  }

  async function handleDeleteRole(role: Role) {
    if (role.is_system) return
    const r = await fetch(`/api/settings/roles/${role.id}`, { method: 'DELETE' })
    const data = await r.json()
    if (!r.ok) { toast(data.error ?? 'Failed to delete role', 'error'); return }
    setDeleteConfirm(null)
    setRoles(prev => prev.filter(ro => ro.id !== role.id))
    if (selectedRole?.id === role.id) setSelectedRole(roles.find(ro => ro.is_system) ?? null)
  }

  const isAdmin = selectedRole?.name === 'Administrator'

  return (
    <div className="flex gap-6">
      {/* Left: Role list */}
      <div className="w-56 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-normal text-text-muted uppercase tracking-wide">Roles</span>
          <button
            onClick={() => setShowNewRole(v => !v)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + New
          </button>
        </div>

        {showNewRole && (
          <div className="mb-3 flex gap-1">
            <input
              type="text"
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
              placeholder="Role name"
              className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring"
              autoFocus
            />
            <button
              onClick={handleCreateRole}
              disabled={creating}
              className="text-xs bg-primary text-primary-foreground px-2 py-1.5 rounded-lg hover:bg-primary-hover disabled:opacity-50"
            >
              {creating ? '…' : 'Add'}
            </button>
          </div>
        )}

        <div className="space-y-1">
          {roles.map(role => (
            <div
              key={role.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer group ${
                selectedRole?.id === role.id ? 'bg-primary-subtle text-primary' : 'hover:bg-surface-sunken text-text-secondary'
              }`}
              onClick={() => { setSelectedRole(role); setDeleteConfirm(null) }}
            >
              <span className="flex-1 text-sm font-medium truncate">{role.name}</span>
              {role.is_system && (
                <span className="text-[10px] bg-surface-control text-text-muted px-1.5 py-0.5 rounded-full">System</span>
              )}
              {!role.is_system && selectedRole?.id === role.id && (
                deleteConfirm === role.id ? (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDeleteRole(role)} className="text-[10px] text-danger font-medium">Yes</button>
                    <button onClick={() => setDeleteConfirm(null)} className="text-[10px] text-text-muted">No</button>
                  </div>
                ) : (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirm(role.id) }}
                    className="text-text-muted hover:text-danger text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete role"
                  >×</button>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Permissions table */}
      <div className="flex-1">
        {!selectedRole && (
          <p className="text-sm text-text-muted py-8 text-center">Select a role to configure permissions</p>
        )}
        {selectedRole && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-sm font-medium text-text-primary">{selectedRole.name} — Permissions</h2>
              {isAdmin && (
                <span className="text-xs text-text-muted bg-surface-control px-2 py-0.5 rounded-full">
                  Administrator always has full access
                </span>
              )}
            </div>

            <div className="bg-surface border border-border-light rounded-xl overflow-auto max-h-[calc(100vh-280px)]">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken border-b border-border-light sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-text-secondary w-48">Section</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-10">All</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary">View</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary">Create</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary">Edit</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary">Delete</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary">Data Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {PERM_GROUPS.map((g, gi) => {
                    const prevModule = gi > 0 ? PERM_GROUPS[gi - 1].module : null
                    const showModuleSep = g.module !== prevModule
                    return (
                    <>
                      {showModuleSep && (
                        <tr key={`mod-${g.module}`} className="bg-primary border-t-2 border-primary-border">
                          <td colSpan={7} className="px-4 py-2 text-xs font-normal text-primary-foreground uppercase tracking-wider">
                            {g.module}
                          </td>
                        </tr>
                      )}
                      <tr key={g.group} className="bg-surface-sunken border-t border-border-light">
                        <td colSpan={7} className="px-4 py-1.5 text-xs font-normal text-text-muted uppercase tracking-wide pl-6">
                          {g.group}
                        </td>
                      </tr>
                      {g.sections.map(s => {
                        const p = perms[s.key] ?? EMPTY_PERMS
                        const allOn = p.view && p.create && p.edit && p.delete
                        const noneOn = !p.view && !p.create && !p.edit && !p.delete
                        const partial = !allOn && !noneOn
                        return (
                          <tr key={s.key} className="border-t border-border-light">
                            <td className="px-4 py-2.5 text-text-secondary pl-10">
                              {s.label}
                              {saving === s.key && <span className="ml-2 text-xs text-warning">Saving…</span>}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                onClick={() => toggleAll(s.key, !allOn)}
                                disabled={isAdmin}
                                title={allOn ? 'Deselect all' : partial ? 'Select all' : 'Select all'}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition-colors focus:outline-none disabled:cursor-default ${
                                  allOn
                                    ? 'bg-primary border-primary-border text-primary-foreground'
                                    : partial
                                    ? 'bg-primary-subtle border-primary-border text-primary'
                                    : 'bg-surface border-border hover:border-primary-border'
                                }`}
                              >
                                {allOn && (
                                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                                {partial && (
                                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                                    <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                  </svg>
                                )}
                              </button>
                            </td>
                            {(['view', 'create', 'edit', 'delete'] as const).map(action => (
                              <td key={action} className="px-3 py-2.5 text-center">
                                <button
                                  onClick={() => toggle(s.key, action, !p[action])}
                                  disabled={isAdmin}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:cursor-default ${
                                    p[action] ? 'bg-primary' : 'bg-surface-control'
                                  }`}
                                >
                                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow transition-transform ${
                                    p[action] ? 'translate-x-4' : 'translate-x-0.5'
                                  }`} />
                                </button>
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-center">
                              {!s.isOperation ? (
                                <span className="text-xs text-text-muted">—</span>
                              ) : isAdmin ? (
                                <span className="text-xs text-text-muted">All</span>
                              ) : (
                                <select
                                  value={p.data_scope}
                                  onChange={e => setScope(s.key, e.target.value)}
                                  className="text-xs border border-border-light rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-ring bg-surface"
                                >
                                  <option value="own">Own</option>
                                  <option value="team">Team</option>
                                  <option value="all">All</option>
                                </select>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 space-y-1">
              {isAdmin ? (
                <p className="text-xs text-text-muted">Administrator always has full access. Permissions cannot be restricted.</p>
              ) : (
                <>
                  <p className="text-xs text-text-muted">Changes take effect on the user&apos;s next API request (no re-login needed).</p>
                  <p className="text-xs text-text-muted">Access Control is always Administrator-only and is not configurable.</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Reporting Schema Tab
// ─────────────────────────────────────────────────────────────────
function ReportingSchema({ preselectedUserId }: { preselectedUserId: string | null }) {
  const { toast } = useToast()
  const [allUsers, setAllUsers] = useState<UserEntry[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null)
  const [visibility, setVisibility] = useState<VisibilityEntry[]>([])
  const [loadingVis, setLoadingVis] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [importing, setImporting] = useState(false)
  const [saved, setSaved] = useState(true)
  const [importMsg, setImportMsg] = useState('')

  const loadUsers = useCallback((preselect: string | null) => {
    fetch('/api/masters/users')
      .then(r => r.json())
      .then((data: { id: string; name: string }[]) => {
        const users: UserEntry[] = (data ?? []).map(u => ({
          id: u.id,
          name: u.name,
        }))
        setAllUsers(users)
        if (preselect) {
          const found = users.find(u => u.id === preselect)
          if (found) setSelectedUser(found)
        }
      })
  }, [])

  useEffect(() => {
    // Auto-sync visibility from manager hierarchy on mount, then load users
    fetch('/api/access-control/visibility/bulk-import', { method: 'POST' })
      .finally(() => loadUsers(preselectedUserId))
  }, [preselectedUserId, loadUsers])

  const loadVisibility = useCallback(async (userId: string) => {
    setLoadingVis(true)
    const r = await fetch(`/api/access-control/visibility?viewerId=${userId}`)
    const data = await r.json()
    setVisibility(Array.isArray(data) ? data : [])
    setLoadingVis(false)
  }, [])

  useEffect(() => {
    if (selectedUser) loadVisibility(selectedUser.id)
  }, [selectedUser, loadVisibility])

  const handleAddUser = async (targetUser: UserEntry) => {
    if (!selectedUser) return
    setSaved(false)
    const r = await fetch('/api/access-control/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewerId: selectedUser.id, targetId: targetUser.id }),
    })
    if (r.ok) {
      await loadVisibility(selectedUser.id)
      setAddSearch('')
    } else {
      const data = await r.json()
      toast(data.error ?? 'Failed to update visibility', 'error')
    }
    setSaved(true)
  }

  const handleRemove = async (entry: VisibilityEntry) => {
    if (!selectedUser) return
    setSaved(false)
    setVisibility(v => v.filter(e => e.id !== entry.id))
    const r = await fetch(`/api/access-control/visibility?id=${entry.id}`, { method: 'DELETE' })
    if (!r.ok) {
      const data = await r.json()
      toast(data.error ?? 'Failed to update visibility', 'error')
    }
    setSaved(true)
  }

  const handleImport = async () => {
    setImporting(true)
    setImportMsg('')
    const r = await fetch('/api/access-control/visibility/bulk-import', { method: 'POST' })
    const data = await r.json()
    setImporting(false)
    if (!r.ok) { toast(data.error ?? 'Sync failed', 'error'); return }
    setImportMsg(`Synced ${data.inserted ?? 0} rules from hierarchy`)
    loadUsers(null)
    if (selectedUser) loadVisibility(selectedUser.id)
    setTimeout(() => setImportMsg(''), 4000)
  }

  const visibleTargetIds = new Set(visibility.map(v => v.target_user_id))
  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase())
  )
  const addCandidates = allUsers.filter(
    u =>
      u.id !== selectedUser?.id &&
      !visibleTargetIds.has(u.id) &&
      u.name.toLowerCase().includes(addSearch.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={importing}
            className="text-sm px-3 py-1.5 border border-border rounded-lg hover:bg-surface-sunken disabled:opacity-50 transition-colors"
          >
            {importing ? 'Syncing...' : '⬇ Sync from Hierarchy'}
          </button>
          {importMsg && <span className="text-xs text-success">{importMsg}</span>}
        </div>
        <span className={`text-xs ${saved ? 'text-success' : 'text-warning'}`}>
          {saved ? 'All changes saved ✓' : 'Saving...'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 h-[600px]">
        {/* Left panel */}
        <div className="border border-border-light rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border-light bg-surface-sunken">
            <p className="text-xs font-normal text-text-muted uppercase tracking-wide mb-2">Select User</p>
            <input
              type="text"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by name..."
              className="w-full text-sm border border-border-light rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border-light">
            {filteredUsers.map(u => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-surface-sunken transition-colors ${
                  selectedUser?.id === u.id ? 'bg-primary-subtle' : ''
                }`}
              >
                <Avatar name={u.name} />
                <span className="text-sm font-medium flex-1 truncate">{u.name}</span>
                {selectedUser?.id === u.id && <span className="text-primary text-xs font-medium">●</span>}
              </button>
            ))}
            {filteredUsers.length === 0 && (
              <p className="text-sm text-text-muted text-center py-8">No users found</p>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="border border-border-light rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border-light bg-surface-sunken">
            <p className="text-xs font-normal text-text-muted uppercase tracking-wide mb-2">
              Can View &amp; Interact With
            </p>
            {selectedUser && (
              <div className="relative">
                <input
                  type="text"
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  placeholder="Search to add users..."
                  className="w-full text-sm border border-border-light rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring"
                />
                {addSearch && addCandidates.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 bg-surface border border-border-light rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {addCandidates.map(u => (
                      <button
                        key={u.id}
                        onClick={() => handleAddUser(u)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-sunken flex items-center gap-2 text-sm"
                      >
                        <Avatar name={u.name} />
                        <span className="flex-1">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {addSearch && addCandidates.length === 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 bg-surface border border-border-light rounded-lg shadow mt-1 px-3 py-2 text-sm text-text-muted">
                    No users to add
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!selectedUser && (
              <p className="text-sm text-text-muted text-center py-12 px-4">
                ← Select a user to configure their visibility
              </p>
            )}
            {selectedUser && loadingVis && (
              <p className="text-sm text-text-muted text-center py-12">Loading...</p>
            )}
            {selectedUser && !loadingVis && visibility.length === 0 && (
              <p className="text-sm text-text-muted text-center py-12 px-4">
                No users configured. Add users above or sync from hierarchy.
              </p>
            )}
            {selectedUser && !loadingVis && visibility.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-2 py-2 hover:bg-surface-sunken rounded-lg group"
              >
                <span className="text-success text-xs">✓</span>
                <Avatar name={entry.name} />
                <span className="text-sm font-medium flex-1 truncate">{entry.name}</span>
                <button
                  onClick={() => handleRemove(entry)}
                  className="text-text-muted group-hover:text-danger hover:text-danger text-base leading-none ml-1 transition-colors"
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Org Chart Tab
// ─────────────────────────────────────────────────────────────────
function buildOrgTree(users: OrgUser[]): { roots: OrgNode[]; standalone: OrgUser[] } {
  const map = new Map<string, OrgNode>()
  for (const u of users) map.set(u.id, { id: u.id, name: u.name, role: u.role, children: [] })

  const childIds = new Set<string>()
  for (const u of users) {
    if (u.manager_user_id && map.has(u.manager_user_id)) {
      map.get(u.manager_user_id)!.children.push(map.get(u.id)!)
      childIds.add(u.id)
    }
  }

  const roots: OrgNode[] = []
  const standalone: OrgUser[] = []
  for (const u of users) {
    if (!childIds.has(u.id)) {
      const node = map.get(u.id)!
      if (node.children.length > 0) roots.push(node)
      else standalone.push(u)
    }
  }
  return { roots, standalone }
}

function nodeContains(node: OrgNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q) || node.role.toLowerCase().includes(q)) return true
  return node.children.some(c => nodeContains(c, q))
}

function OrgChart() {
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/access-control/org-chart')
      .then(r => r.json())
      .then(d => { setUsers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const { roots, standalone } = buildOrgTree(users)
  const q = search.toLowerCase()
  const filteredRoots = q ? roots.filter(n => nodeContains(n, q)) : roots
  const filteredStandalone = q ? standalone.filter(u => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)) : standalone

  if (loading) return <p className="text-sm text-text-muted py-8 text-center">Loading org chart...</p>
  if (users.length === 0) return <p className="text-sm text-text-secondary py-8 text-center">No active users found.</p>

  return (
    <div>
      <div className="mb-5">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or role..."
          className="text-sm border border-border-light rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring w-64" />
      </div>

      {/* Scrollable canvas */}
      <div className="overflow-auto pb-8">
        <div className="inline-flex flex-col items-center gap-0 min-w-full">
          {filteredRoots.map(root => (
            <OrgNodeCard key={root.id} node={root} highlight={q} />
          ))}
        </div>
      </div>

      {/* Standalone users */}
      {filteredStandalone.length > 0 && (
        <div className="mt-8 pt-6 border-t border-dashed border-border-light">
          <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-4">
            Standalone — not in any reporting chain
          </p>
          <div className="flex flex-wrap gap-3">
            {filteredStandalone.map(u => (
              <div key={u.id} className="w-36 rounded-lg overflow-hidden border border-border-light shadow-sm opacity-75">
                <div className="bg-gray-500 px-3 py-1.5 text-center">
                  <p className="text-[11px] font-medium text-white truncate">{u.role || 'No Role'}</p>
                </div>
                <div className="bg-surface px-3 py-2 text-center">
                  <p className="text-xs text-text-secondary font-medium truncate">{u.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {q && filteredRoots.length === 0 && filteredStandalone.length === 0 && (
        <p className="text-sm text-text-muted py-4 text-center">No users match &ldquo;{search}&rdquo;</p>
      )}
    </div>
  )
}

function OrgNodeCard({ node, highlight }: { node: OrgNode; highlight: string }) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isMatch = highlight && (node.name.toLowerCase().includes(highlight) || node.role.toLowerCase().includes(highlight))

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div className={`w-40 rounded-lg overflow-hidden shadow-sm border-2 transition-all ${
        isMatch ? 'border-yellow-400 shadow-yellow-100' : 'border-blue-700'
      }`}>
        <div className="bg-primary-pressed px-3 py-2 text-center">
          <p className="text-[11px] font-medium text-primary-foreground leading-tight truncate">{node.role || 'No Role'}</p>
        </div>
        <div className="bg-surface px-3 py-2.5 text-center border-t border-primary-border">
          <p className="text-xs font-medium text-text-primary truncate">{node.name}</p>
        </div>
      </div>

      {/* Connector + toggle + children */}
      {hasChildren && (
        <>
          {/* Line down from card */}
          <div className="w-px h-4 bg-surface-control" />

          {/* Collapse toggle */}
          <button
            onClick={() => setOpen(o => !o)}
            className="w-5 h-5 rounded-full border border-border bg-surface flex items-center justify-center text-text-muted text-xs hover:border-primary-border hover:text-primary transition-colors z-10 leading-none"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? '−' : '+'}
          </button>

          {open && (
            <>
              {/* Line down from toggle to children row */}
              <div className="w-px h-4 bg-surface-control" />

              {/* Children row */}
              <div className="flex items-start">
                {node.children.map((child, idx) => {
                  const isFirst = idx === 0
                  const isLast = idx === node.children.length - 1
                  const isOnly = node.children.length === 1
                  return (
                    <div key={child.id} className="flex flex-col items-center px-3">
                      {/* Top connector per child */}
                      <div className="relative w-full h-4 flex items-end justify-center">
                        {/* Vertical drop */}
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-px h-4 bg-surface-control" />
                        {/* Horizontal left half */}
                        {!isOnly && !isFirst && (
                          <div className="absolute top-0 right-1/2 left-0 h-px bg-surface-control" />
                        )}
                        {/* Horizontal right half */}
                        {!isOnly && !isLast && (
                          <div className="absolute top-0 left-1/2 right-0 h-px bg-surface-control" />
                        )}
                      </div>
                      <OrgNodeCard node={child} highlight={highlight} />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Shared UI primitives
// ─────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500',
]

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
  return (
    <div className={`w-6 h-6 ${color} rounded-full flex items-center justify-center text-white text-[10px] font-medium flex-shrink-0`}>
      {initials}
    </div>
  )
}

