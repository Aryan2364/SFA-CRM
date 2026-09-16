'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewCompanyPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '', gstin: '',
    license_count: '10', payment_due_date: '',
    adminName: '', adminEmail: '', adminPhone: '', adminPassword: '',
  })

  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Company name is required'); return }
    if (!form.adminName.trim()) { setError('Admin name is required'); return }
    if (!form.adminPhone.trim()) { setError('Admin phone is required'); return }
    if (!/^\d{10}$/.test(form.adminPhone.trim())) { setError('Admin phone must be exactly 10 digits'); return }
    if (!form.adminPassword.trim()) { setError('Admin password is required'); return }
    if (Number(form.license_count) < 1) { setError('License count must be at least 1'); return }

    setError('')
    setSaving(true)
    const res = await fetch('/api/superadmin/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        license_count: Number(form.license_count),
        payment_due_date: form.payment_due_date || null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error || 'Failed to create company'); return }
    router.push('/superadmin/companies')
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-medium text-gray-900">Add New Company</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* Company Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-medium text-gray-900">Company Details</h2>
          <div>
            <label htmlFor="new-co-name" className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
            <input id="new-co-name" name="name" type="text" value={form.name} onChange={F('name')} placeholder="e.g. Acme Corp Pvt Ltd" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-co-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="new-co-email" name="email" type="email" value={form.email} onChange={F('email')} placeholder="company@example.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label htmlFor="new-co-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input id="new-co-phone" name="phone" type="tel" value={form.phone} onChange={F('phone')} placeholder="10-digit number" maxLength={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
          <div>
            <label htmlFor="new-co-address" className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea id="new-co-address" name="address" value={form.address} onChange={F('address')} rows={2} placeholder="Company address" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
          <div>
            <label htmlFor="new-co-gstin" className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
            <input id="new-co-gstin" name="gstin" type="text" value={form.gstin} onChange={F('gstin')} placeholder="GST Number (optional)" maxLength={15} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 uppercase" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-co-license-count" className="block text-sm font-medium text-gray-700 mb-1">User License Count</label>
              <input id="new-co-license-count" name="license_count" type="number" value={form.license_count} onChange={F('license_count')} min={1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label htmlFor="new-co-due-date" className="block text-sm font-medium text-gray-700 mb-1">Payment Due Date</label>
              <input id="new-co-due-date" name="payment_due_date" type="date" value={form.payment_due_date} onChange={F('payment_due_date')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
        </div>

        {/* Initial Admin User */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-medium text-gray-900">Initial Admin User</h2>
            <p className="text-xs text-gray-500 mt-0.5">This user will be the Administrator for the company</p>
          </div>
          <div>
            <label htmlFor="new-co-admin-name" className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input id="new-co-admin-name" name="adminName" type="text" value={form.adminName} onChange={F('adminName')} placeholder="Admin's full name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-co-admin-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
              <input id="new-co-admin-phone" name="adminPhone" type="tel" value={form.adminPhone} onChange={F('adminPhone')} placeholder="Login credential" maxLength={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label htmlFor="new-co-admin-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="new-co-admin-email" name="adminEmail" type="email" value={form.adminEmail} onChange={F('adminEmail')} placeholder="admin@company.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
          <div>
            <label htmlFor="new-co-admin-password" className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
            <input id="new-co-admin-password" name="adminPassword" type="text" value={form.adminPassword} onChange={F('adminPassword')} placeholder="Set a strong password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Company'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
