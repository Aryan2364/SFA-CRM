'use client'

import { useState, useEffect, useMemo } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const PAGE_SIZE = 15

const COLS: Column[] = [
  { key: 'name', label: 'Name' },
  { key: 'place', label: 'Place', render: r => {
    const dist = (r.districts as { name: string } | null)?.name
    const talu = (r.talukas as { name: string } | null)?.name
    const vill = (r.villages as { name: string } | null)?.name
    if (!dist) return <span className="text-text-muted">—</span>
    return <span>{[`District: ${dist}`, talu && `Taluka: ${talu}`, vill && `Village: ${vill}`].filter(Boolean).join(', ')}</span>
  }},
  { key: 'distributor', label: 'Distributor', render: r => {
    const name = (r.distributors as { name: string } | null)?.name
    if (!name) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-bg text-warning border border-warning-border">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
        Unassigned
      </span>
    )
    return <span className="text-sm text-text-secondary">{name}</span>
  }},
]

type Opt = { value: string; label: string }
type DistrictItem = { id: string; name: string; state_id: string }
type TalukaItem = { id: string; name: string; district_id: string }
type VillageItem = { id: string; name: string; taluka_id: string }
type PlaceResolved = { state_id: string; district_id: string; taluka_id: string; village_id: string | null }

const EMPTY_FORM = { name: '', place: '', state_id: '', district_id: '', taluka_id: '', village_id: '', distributor_id: '', phone: '', address: '', description: '', latitude: '', longitude: '' }
const EMPTY_DIST_FORM = { name: '', place: '', state_id: '', district_id: '', taluka_id: '', village_id: '', phone: '', address: '', description: '', latitude: '', longitude: '' }

export default function DealersPage() {
  const crud = useCrud('/api/masters/dealers')
  const me = useMe()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.dealers?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.dealers?.delete ?? false)

  // ── Unassigned filter ───────────────────────────────────────────────────────
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [filterPage, setFilterPage] = useState(1)

  const unassignedRows = useMemo(() => crud.allRows.filter(r => !r.distributor_id), [crud.allRows])
  const unassignedPageRows = useMemo(() => unassignedRows.slice((filterPage - 1) * PAGE_SIZE, filterPage * PAGE_SIZE), [unassignedRows, filterPage])
  const unassignedTotalPages = Math.max(1, Math.ceil(unassignedRows.length / PAGE_SIZE))

  const displayRows = showUnassigned ? unassignedPageRows : crud.rows
  const displayPage = showUnassigned ? filterPage : crud.page
  const displayTotalPages = showUnassigned ? unassignedTotalPages : crud.totalPages
  const displayOnPage = showUnassigned ? setFilterPage : crud.setPage
  const displayCount = showUnassigned ? unassignedRows.length : crud.allRows.length

  // ── Dealer modal ────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [phoneError, setPhoneError] = useState('')
  const [saving, setSaving] = useState(false)

  // ── New-Distributor nested modal ────────────────────────────────────────────
  const [newDistOpen, setNewDistOpen] = useState(false)
  const [newDistForm, setNewDistForm] = useState(EMPTY_DIST_FORM)
  const [newDistPhoneError, setNewDistPhoneError] = useState('')
  const [newDistSaving, setNewDistSaving] = useState(false)

  // ── Reference data ──────────────────────────────────────────────────────────
  const [districts, setDistricts] = useState<DistrictItem[]>([])
  const [talukas, setTalukas] = useState<TalukaItem[]>([])
  const [villages, setVillages] = useState<VillageItem[]>([])
  const [distributors, setDistributors] = useState<Opt[]>([])

  useEffect(() => {
    fetch('/api/masters/districts').then(r => r.json()).then(setDistricts)
    fetch('/api/masters/talukas').then(r => r.json()).then(setTalukas)
    fetch('/api/masters/villages').then(r => r.json()).then(setVillages)
    fetch('/api/masters/distributors').then(r => r.json()).then((d: DistrictItem[]) => setDistributors(d.map(x => ({ value: x.id, label: x.name }))))
  }, [])

  const { placeOptions, placeMap } = useMemo(() => {
    const distMap = new Map(districts.map(d => [d.id, d]))
    const taluMap = new Map(talukas.map(t => [t.id, t]))
    const placeMap = new Map<string, PlaceResolved>()
    const opts: Opt[] = []
    for (const t of talukas) {
      const dist = distMap.get(t.district_id)
      if (!dist) continue
      const val = `t:${t.id}`
      opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${t.name}` })
      placeMap.set(val, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
    }
    for (const v of villages) {
      const talu = taluMap.get(v.taluka_id)
      const dist = talu ? distMap.get(talu.district_id) : undefined
      if (!talu || !dist) continue
      const val = `v:${v.id}`
      opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${talu.name}, Village: ${v.name}` })
      placeMap.set(val, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
    }
    return { placeOptions: opts, placeMap }
  }, [districts, talukas, villages])

  // ── Dealer modal handlers ───────────────────────────────────────────────────
  function openAdd() { setEditing(null); setForm(EMPTY_FORM); setPhoneError(''); setOpen(true) }

  function openEdit(row: Record<string, unknown>) {
    setEditing(row)
    const place = row.village_id ? `v:${row.village_id}` : row.taluka_id ? `t:${row.taluka_id}` : ''
    setForm({ name: String(row.name), place, state_id: String(row.state_id ?? ''), district_id: String(row.district_id ?? ''), taluka_id: String(row.taluka_id ?? ''), village_id: String(row.village_id ?? ''), distributor_id: String(row.distributor_id ?? ''), phone: String(row.phone ?? ''), address: String(row.address ?? ''), description: String(row.description ?? ''), latitude: String(row.latitude ?? ''), longitude: String(row.longitude ?? '') })
    setPhoneError('')
    setOpen(true)
  }

  function handlePlaceChange(val: string) {
    const r = placeMap.get(val)
    if (r) setForm(f => ({ ...f, place: val, state_id: r.state_id, district_id: r.district_id, taluka_id: r.taluka_id, village_id: r.village_id ?? '' }))
    else setForm(f => ({ ...f, place: '', state_id: '', district_id: '', taluka_id: '', village_id: '' }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.taluka_id) return
    if (form.phone && !/^\d{10}$/.test(form.phone.trim())) { setPhoneError('Phone must be exactly 10 digits'); return }
    setPhoneError(''); setSaving(true)
    const body = { name: form.name.trim(), state_id: form.state_id, district_id: form.district_id, taluka_id: form.taluka_id, village_id: form.village_id || null, distributor_id: form.distributor_id || null, phone: form.phone.trim() || null, address: form.address || null, description: form.description || null, latitude: form.latitude ? Number(form.latitude) : null, longitude: form.longitude ? Number(form.longitude) : null }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  const setF = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  // ── New-Distributor modal handlers ──────────────────────────────────────────
  function openNewDist() {
    setNewDistForm(EMPTY_DIST_FORM)
    setNewDistPhoneError('')
    setNewDistOpen(true)
  }

  function handleNewDistPlaceChange(val: string) {
    const r = placeMap.get(val)
    if (r) setNewDistForm(f => ({ ...f, place: val, state_id: r.state_id, district_id: r.district_id, taluka_id: r.taluka_id, village_id: r.village_id ?? '' }))
    else setNewDistForm(f => ({ ...f, place: '', state_id: '', district_id: '', taluka_id: '', village_id: '' }))
  }

  async function handleNewDistSave() {
    if (!newDistForm.name.trim()) return
    if (newDistForm.phone && !/^\d{10}$/.test(newDistForm.phone.trim())) { setNewDistPhoneError('Phone must be exactly 10 digits'); return }
    setNewDistPhoneError(''); setNewDistSaving(true)
    const res = await fetch('/api/masters/distributors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDistForm.name.trim(), phone: newDistForm.phone.trim() || null, address: newDistForm.address || null, description: newDistForm.description || null, state_id: newDistForm.state_id || null, district_id: newDistForm.district_id || null, taluka_id: newDistForm.taluka_id || null, village_id: newDistForm.village_id || null, latitude: newDistForm.latitude ? Number(newDistForm.latitude) : null, longitude: newDistForm.longitude ? Number(newDistForm.longitude) : null }),
    })
    setNewDistSaving(false)
    if (res.ok) {
      const created = await res.json()
      setDistributors(prev => [...prev, { value: created.id, label: created.name }].sort((a, b) => a.label.localeCompare(b.label)))
      setForm(f => ({ ...f, distributor_id: created.id }))
      setNewDistOpen(false)
    }
  }

  const NDF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setNewDistForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <>
      <CrudPage
        title="Dealers" backHref="/masters" columns={COLS}
        rows={displayRows} allRowsCount={displayCount}
        isLoading={crud.isLoading} search={crud.search}
        onSearchChange={v => { crud.setSearch(v); setFilterPage(1) }}
        page={displayPage} totalPages={displayTotalPages} onPage={displayOnPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onToggleActive={canEdit ? (r, v) => crud.update(r.id as string, { is_active: v }) : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined}
        filterBar={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowUnassigned(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!showUnassigned ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              All <span className="ml-1 opacity-70">({crud.allRows.length})</span>
            </button>
            <button
              onClick={() => { setShowUnassigned(true); setFilterPage(1) }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showUnassigned ? 'bg-amber-500 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
              Unassigned
              {unassignedRows.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${showUnassigned ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                  {unassignedRows.length}
                </span>
              )}
            </button>
          </div>
        }
      />

      {/* ── Dealer modal ── */}
      <Modal title={editing ? 'Edit Dealer' : 'Add Dealer'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Dealer Business Name <span className="text-danger">*</span></label>
          <input type="text" value={form.name} onChange={F('name')} placeholder="Dealer Business name" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Place <span className="text-danger">*</span></label>
          <SearchableSelect value={form.place} onChange={handlePlaceChange} options={placeOptions} placeholder="Search by district, taluka or village…" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-text-secondary">Distributor</label>
            <button type="button" onClick={openNewDist} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              New Distributor
            </button>
          </div>
          <SearchableSelect value={form.distributor_id} onChange={setF('distributor_id')} options={distributors} placeholder="Select distributor…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Phone Number</label>
          <input type="tel" value={form.phone} onChange={e => { F('phone')(e); setPhoneError('') }} placeholder="10-digit number" maxLength={10} className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring ${phoneError ? 'border-danger-border' : 'border-border'}`} />
          {phoneError && <p className="text-xs text-danger mt-1">{phoneError}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Address</label>
          <textarea value={form.address} onChange={F('address')} rows={2} placeholder="Address" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring resize-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
          <textarea value={form.description} onChange={F('description')} rows={2} placeholder="Description" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Latitude</label>
            <input type="number" step="0.0000001" value={form.latitude} onChange={F('latitude')} placeholder="-90 to 90" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Longitude</label>
            <input type="number" step="0.0000001" value={form.longitude} onChange={F('longitude')} placeholder="-180 to 180" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
        </div>

        {/* ── Nested: New Distributor modal (renders inside dealer modal children, floats above via fixed positioning) ── */}
        <Modal title="New Distributor" isOpen={newDistOpen} onClose={() => setNewDistOpen(false)} onSave={handleNewDistSave} isSaving={newDistSaving} saveLabel="Create & Select" size="lg">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name <span className="text-danger">*</span></label>
            <input type="text" value={newDistForm.name} onChange={NDF('name')} placeholder="Distributor Business name" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Place</label>
            <SearchableSelect value={newDistForm.place} onChange={handleNewDistPlaceChange} options={placeOptions} placeholder="Search by district, taluka or village…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Phone Number</label>
            <input type="tel" value={newDistForm.phone} onChange={e => { NDF('phone')(e); setNewDistPhoneError('') }} placeholder="10-digit number" maxLength={10} className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring ${newDistPhoneError ? 'border-danger-border' : 'border-border'}`} />
            {newDistPhoneError && <p className="text-xs text-danger mt-1">{newDistPhoneError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Address</label>
            <textarea value={newDistForm.address} onChange={NDF('address')} rows={2} placeholder="Address" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
            <textarea value={newDistForm.description} onChange={NDF('description')} rows={2} placeholder="Description" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Latitude</label>
              <input type="number" step="0.0000001" value={newDistForm.latitude} onChange={NDF('latitude')} placeholder="-90 to 90" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Longitude</label>
              <input type="number" step="0.0000001" value={newDistForm.longitude} onChange={NDF('longitude')} placeholder="-180 to 180" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
            </div>
          </div>
        </Modal>
      </Modal>
    </>
  )
}
