'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useMe } from '@/hooks/useMe'

type UserRow = { id: string; name: string; contact: string; district_summary: string; has_mapping: boolean }

export default function TerritoryMappingPage() {
  const me = useMe()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.territory_mapping?.edit ?? false)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/masters/territory-mapping')
      .then(r => r.json())
      .then(d => { setUsers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.contact.includes(search)
  )

  return (
    <div>
      <a href="/masters" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary mb-4">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        Back to Masters
      </a>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-medium text-text-primary">Territory Mapping</h2>
          <p className="text-sm text-text-muted mt-0.5">Assign geographical territories to users</p>
        </div>
      </div>

      <div className="mb-3">
        <input type="text" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary-ring" />
      </div>

      <div className="bg-surface rounded-xl border border-border-light overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken border-b border-border-light">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">User</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Contact</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Mapped Districts</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-12 text-text-muted">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-12 text-text-muted">No users found.</td></tr>
            ) : filtered.map(user => (
              <tr key={user.id} className="border-t border-border-light hover:bg-surface-sunken">
                <td className="px-4 py-3 font-medium text-text-primary">{user.name}</td>
                <td className="px-4 py-3 text-text-secondary">{user.contact}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {user.district_summary ? (
                    <span>{user.district_summary}</span>
                  ) : (
                    <span className="text-text-muted text-xs italic">Not mapped</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {canEdit ? (
                    <Link href={`/masters/territory-mapping/${user.id}`}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                      {user.has_mapping ? 'Edit Territory' : 'Assign Territory'}
                    </Link>
                  ) : user.has_mapping ? (
                    <Link href={`/masters/territory-mapping/${user.id}`}
                      className="text-text-muted hover:text-text-secondary text-xs font-medium">
                      View Territory
                    </Link>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
