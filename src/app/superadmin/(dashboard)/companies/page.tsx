'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  Active: 'bg-green-50 text-green-700',
  Overdue: 'bg-yellow-50 text-yellow-700',
  Suspended: 'bg-red-50 text-red-700',
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
        <div className="text-sm text-gray-500">Loading companies…</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Companies</h1>
          <p className="text-sm text-gray-500 mt-0.5">{companies.length} registered companies</p>
        </div>
        <button
          onClick={() => router.push('/superadmin/companies/new')}
          className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Company
        </button>
      </div>

      {companies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">No companies yet. Add your first company to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Users</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Payment Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Due Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c, i) => (
                <tr
                  key={c.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${i === companies.length - 1 ? 'border-0' : ''}`}
                  onClick={() => router.push(`/superadmin/companies/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${c.user_count >= c.license_count ? 'text-red-600' : 'text-gray-900'}`}>
                      {c.user_count}
                    </span>
                    <span className="text-gray-400"> / {c.license_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.payment_status]}`}>
                      {c.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.payment_due_date ? new Date(c.payment_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => toggleActive(c)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow ${c.is_active ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/superadmin/companies/${c.id}`) }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Manage
                    </button>
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
