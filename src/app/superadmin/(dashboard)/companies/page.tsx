'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

type Company = {
  id: string
  name: string
  email: string | null
  phone: string | null
  license_count: number
  payment_status: 'Active' | 'Overdue' | 'Suspended'
  payment_due_date: string | null
  is_active: boolean
  user_count: number
}

const STATUS_STYLES = {
  Active: 'bg-success-bg text-success',
  Overdue: 'bg-warning-bg text-warning',
  Suspended: 'bg-danger-bg text-danger',
}

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const res = await fetch('/api/superadmin/companies')
    if (res.ok) setCompanies(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function toggleActive(c: Company) {
    await fetch(`/api/superadmin/companies/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !c.is_active }),
    })
    setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-sm text-text-muted">Loading companies…</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-text-primary">Companies</h1>
          <p className="text-sm text-text-muted mt-0.5">{companies.length} registered companies</p>
        </div>
        <Button onClick={() => router.push('/superadmin/companies/new')}>
          <PlusIcon />
          Add Company
        </Button>
      </div>

      {companies.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border-light p-12 text-center">
          <p className="text-text-muted text-sm">No companies yet. Add your first company to get started.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border-light overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-surface-sunken">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Company</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Users</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Payment Status</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Due Date</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c, i) => (
                <tr
                  key={c.id}
                  className={`border-b border-border-light hover:bg-surface-sunken cursor-pointer ${i === companies.length - 1 ? 'border-0' : ''}`}
                  onClick={() => router.push(`/superadmin/companies/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{c.name}</div>
                    {c.email && <div className="text-xs text-text-muted">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${c.user_count >= c.license_count ? 'text-danger' : 'text-text-primary'}`}>
                      {c.user_count}
                    </span>
                    <span className="text-text-muted"> / {c.license_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.payment_status]}`}>
                      {c.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {c.payment_due_date ? new Date(c.payment_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {/* Note: this commits immediately, same as the legacy toggle (kit §15/§38.1 would want a
                        confirm/undo); left as-is per the detail page's existing "Disable All Logins" confirm
                        covering the deliberate-disable path, and to avoid changing behavior in this pass. */}
                    <Switch checked={c.is_active} onCheckedChange={() => toggleActive(c)} aria-label={c.is_active ? 'Disable company' : 'Enable company'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="secondary" size="sm"
                      onClick={e => { e.stopPropagation(); router.push(`/superadmin/companies/${c.id}`) }}
                    >
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
