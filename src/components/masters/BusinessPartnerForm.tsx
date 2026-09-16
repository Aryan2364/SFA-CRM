'use client'

import { useState, useEffect, useMemo, ReactNode } from 'react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useToast } from '@/contexts/ToastContext'

type LeadStage = { id: string; name: string; sort_order: number; is_fixed: boolean }
type LeadTemp  = { id: string; name: string; sort_order: number }

// ── Types ─────────────────────────────────────────────────────────────────────
type Opt = { value: string; label: string }
type DistrictItem = { id: string; name: string; state_id: string }
type TalukaItem   = { id: string; name: string; district_id: string }
type VillageItem  = { id: string; name: string; taluka_id: string }
type PlaceResolved = { state_id: string; district_id: string; taluka_id: string; village_id: string | null }

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

// ── Shared form shape ─────────────────────────────────────────────────────────
export const EMPTY_BP_FORM = {
  name: '', contact_person_name: '', pincode: '', gst_number: '',
  mobile_1: '', mobile_2: '', place: '', state_id: '', district_id: '',
  taluka_id: '', village_id: '', address: '', description: '',
  latitude: '', longitude: '',
  distributor_id: '',        // dealers only
  sub_type: 'Institution',   // institutions legacy
  type: '',                  // lead type (Institution/End Consumer/Dealer/etc.)
  stage: '',
  temperature: '',
  next_follow_up_date: '',
}
export type BPFormState = typeof EMPTY_BP_FORM

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useBPForm() {
  const { toast } = useToast()
  const [form, setForm] = useState<BPFormState>(EMPTY_BP_FORM)
  const [showMobile2, setShowMobile2] = useState(false)
  const [mobile1Error, setMobile1Error] = useState('')
  const [mobile2Error, setMobile2Error] = useState('')
  const [gstError, setGstError] = useState('')

  const [districts, setDistricts] = useState<DistrictItem[]>([])
  const [talukas,   setTalukas]   = useState<TalukaItem[]>([])
  const [villages,  setVillages]  = useState<VillageItem[]>([])

  useEffect(() => {
    fetch('/api/masters/districts').then(r => r.json()).then(d => setDistricts(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load location data. Please refresh.', 'error'))
    fetch('/api/masters/talukas').then(r => r.json()).then(d => setTalukas(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load location data. Please refresh.', 'error'))
    fetch('/api/masters/villages').then(r => r.json()).then(d => setVillages(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load location data. Please refresh.', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { placeOptions, placeMap } = useMemo(() => {
    const distMap = new Map(districts.map(d => [d.id, d]))
    const taluMap = new Map(talukas.map(t => [t.id, t]))
    const pm = new Map<string, PlaceResolved>()
    const opts: Opt[] = []
    for (const t of talukas) {
      const dist = distMap.get(t.district_id)
      if (!dist) continue
      const val = `t:${t.id}`
      opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${t.name}` })
      pm.set(val, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
    }
    for (const v of villages) {
      const talu = taluMap.get(v.taluka_id)
      const dist = talu ? distMap.get(talu.district_id) : undefined
      if (!talu || !dist) continue
      const val = `v:${v.id}`
      opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${talu.name}, Village: ${v.name}` })
      pm.set(val, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
    }
    return { placeOptions: opts, placeMap: pm }
  }, [districts, talukas, villages])

  function reset(row?: Record<string, unknown>) {
    setMobile1Error(''); setMobile2Error(''); setGstError('')
    if (!row) {
      setForm(EMPTY_BP_FORM)
      setShowMobile2(false)
      return
    }
    const place = row.village_id ? `v:${row.village_id}` : row.taluka_id ? `t:${row.taluka_id}` : ''
    setForm({
      name:                 String(row.name ?? ''),
      contact_person_name:  String(row.contact_person_name ?? ''),
      pincode:              String(row.pincode ?? ''),
      gst_number:           String(row.gst_number ?? ''),
      mobile_1:             String(row.mobile_1 ?? ''),
      mobile_2:             String(row.mobile_2 ?? ''),
      place,
      state_id:             String(row.state_id ?? ''),
      district_id:          String(row.district_id ?? ''),
      taluka_id:            String(row.taluka_id ?? ''),
      village_id:           String(row.village_id ?? ''),
      address:              String(row.address ?? ''),
      description:          String(row.description ?? ''),
      latitude:             String(row.latitude ?? ''),
      longitude:            String(row.longitude ?? ''),
        distributor_id:       String(row.distributor_id ?? ''),
      sub_type:             String(row.sub_type ?? 'Institution'),
      type:                 String(row.type ?? ''),
      stage:                String(row.stage ?? ''),
      temperature:          String(row.temperature ?? ''),
      next_follow_up_date:  String(row.next_follow_up_date ?? ''),
    })
    setShowMobile2(!!row.mobile_2)
  }

  function handlePlaceChange(val: string) {
    const r = placeMap.get(val)
    if (r) setForm(f => ({ ...f, place: val, state_id: r.state_id, district_id: r.district_id, taluka_id: r.taluka_id, village_id: r.village_id ?? '' }))
    else    setForm(f => ({ ...f, place: '', state_id: '', district_id: '', taluka_id: '', village_id: '' }))
  }

  /** Returns false and sets field errors if invalid */
  function validate(): boolean {
    if (form.mobile_1 && !/^\d{10}$/.test(form.mobile_1.trim())) { setMobile1Error('Must be exactly 10 digits'); return false }
    if (form.mobile_2 && !/^\d{10}$/.test(form.mobile_2.trim())) { setMobile2Error('Must be exactly 10 digits'); return false }
    if (form.gst_number && !GSTIN_RE.test(form.gst_number.trim().toUpperCase())) { setGstError('Please enter a valid GST Number'); return false }
    setMobile1Error(''); setMobile2Error(''); setGstError('')
    return true
  }

  /** Build API-ready body (caller adds type-specific fields) */
  function buildBody(): Record<string, unknown> {
    return {
      name:                form.name.trim(),
      contact_person_name: form.contact_person_name.trim() || null,
      pincode:             form.pincode.trim() || null,
      gst_number:          form.gst_number.trim().toUpperCase() || null,
      mobile_1:            form.mobile_1.trim() || null,
      mobile_2:            form.mobile_2.trim() || null,
      state_id:            form.state_id  || null,
      district_id:         form.district_id || null,
      taluka_id:           form.taluka_id || null,
      village_id:          form.village_id || null,
      address:              form.address || null,
      description:          form.description || null,
      latitude:             form.latitude  ? Number(form.latitude)  : null,
      longitude:            form.longitude ? Number(form.longitude) : null,
      stage:                form.stage || null,
      temperature:          form.temperature || null,
      next_follow_up_date:  form.next_follow_up_date || null,
    }
  }

  const F  = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const setF = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  return {
    form, setForm, showMobile2, setShowMobile2,
    mobile1Error, setMobile1Error,
    mobile2Error, setMobile2Error,
    gstError, setGstError,
    placeOptions, handlePlaceChange,
    reset, validate, buildBody,
    F, setF,
  }
}

// ── Shared form JSX ───────────────────────────────────────────────────────────
interface BPFormFieldsProps {
  hook: ReturnType<typeof useBPForm>
  namePlaceholder?: string
  requirePlace?: boolean
  /** Rendered before Account Name (e.g. Category dropdown for Institutions) */
  topSlot?: ReactNode
  /** Rendered after Place (e.g. Distributor selector for Dealers) */
  midSlot?: ReactNode
  /** Show Lead Status section (Stage, Temperature, Next Follow-up) */
  showLeadStatus?: boolean
}

export function BusinessPartnerFormFields({
  hook, namePlaceholder = 'Account name', requirePlace = false, topSlot, midSlot, showLeadStatus = false,
}: BPFormFieldsProps) {
  const { toast } = useToast()
  const {
    form, showMobile2, setShowMobile2, setForm,
    mobile1Error, setMobile1Error,
    mobile2Error, setMobile2Error,
    gstError, setGstError,
    placeOptions, handlePlaceChange, F,
  } = hook

  const [stages, setStages]  = useState<LeadStage[]>([])
  const [temps, setTemps]    = useState<LeadTemp[]>([])
  useEffect(() => {
    if (!showLeadStatus) return
    fetch('/api/masters/lead-stages').then(r => r.json()).then(d => setStages(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead status options.', 'error'))
    fetch('/api/masters/lead-temperatures').then(r => r.json()).then(d => setTemps(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead status options.', 'error'))
  }, [showLeadStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {topSlot}

      <div>
        <label htmlFor="bp-name" className="block text-sm font-medium text-gray-700 mb-1">
          Account Name <span className="text-red-500">*</span>
        </label>
        <input id="bp-name" name="name" type="text" value={form.name} onChange={F('name')} placeholder={namePlaceholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <label htmlFor="bp-contact-person" className="block text-sm font-medium text-gray-700 mb-1">Contact Person Name</label>
        <input id="bp-contact-person" name="contact_person_name" type="text" value={form.contact_person_name} onChange={F('contact_person_name')} placeholder="Contact person name"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-1">
          Place {requirePlace && <span className="text-red-500">*</span>}
        </p>
        <SearchableSelect value={form.place} onChange={handlePlaceChange} options={placeOptions}
          placeholder="Search by district, taluka or village…" />
      </div>

      {midSlot}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="bp-gst" className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
          <input id="bp-gst" name="gst_number" type="text" value={form.gst_number}
            onChange={e => { F('gst_number')(e); setGstError('') }}
            placeholder="GSTIN (15 characters)" maxLength={15}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${gstError ? 'border-red-400' : 'border-gray-300'}`} />
          {gstError && <p className="text-xs text-red-500 mt-1">{gstError}</p>}
        </div>
        <div>
          <label htmlFor="bp-pincode" className="block text-sm font-medium text-gray-700 mb-1">Pin Code</label>
          <input id="bp-pincode" name="pincode" type="text" value={form.pincode} onChange={F('pincode')} placeholder="6-digit pin code" maxLength={6}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="bp-mobile1" className="block text-sm font-medium text-gray-700">Mobile Number 1</label>
          {!showMobile2 && (
            <button type="button" onClick={() => setShowMobile2(true)}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Secondary Contact
            </button>
          )}
        </div>
        <input id="bp-mobile1" name="mobile_1" type="tel" value={form.mobile_1}
          onChange={e => { setForm(f => ({ ...f, mobile_1: e.target.value.replace(/\D/g, '').slice(0, 10) })); setMobile1Error('') }}
          placeholder="10-digit number" maxLength={10}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mobile1Error ? 'border-red-400' : 'border-gray-300'}`} />
        {mobile1Error && <p className="text-xs text-red-500 mt-1">{mobile1Error}</p>}
      </div>

      {showMobile2 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="bp-mobile2" className="block text-sm font-medium text-gray-700">Mobile Number 2</label>
            <button type="button"
              onClick={() => { setShowMobile2(false); setForm(f => ({ ...f, mobile_2: '' })); setMobile2Error('') }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Remove
            </button>
          </div>
          <input id="bp-mobile2" name="mobile_2" type="tel" value={form.mobile_2}
            onChange={e => { setForm(f => ({ ...f, mobile_2: e.target.value.replace(/\D/g, '').slice(0, 10) })); setMobile2Error('') }}
            placeholder="10-digit number" maxLength={10}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mobile2Error ? 'border-red-400' : 'border-gray-300'}`} />
          {mobile2Error && <p className="text-xs text-red-500 mt-1">{mobile2Error}</p>}
        </div>
      )}

      <div>
        <label htmlFor="bp-address" className="block text-sm font-medium text-gray-700 mb-1">Address</label>
        <textarea id="bp-address" name="address" value={form.address} onChange={F('address')} rows={2} placeholder="Address"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      <div>
        <label htmlFor="bp-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea id="bp-description" name="description" value={form.description} onChange={F('description')} rows={2} placeholder="Description"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="bp-latitude" className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
          <input id="bp-latitude" name="latitude" type="number" step="0.0000001" value={form.latitude} onChange={F('latitude')} placeholder="-90 to 90"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label htmlFor="bp-longitude" className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
          <input id="bp-longitude" name="longitude" type="number" step="0.0000001" value={form.longitude} onChange={F('longitude')} placeholder="-180 to 180"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {showLeadStatus && (
        <>
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-normal text-gray-500 uppercase tracking-wider mb-3">Lead Status</p>
          </div>
          <div>
            <label htmlFor="bp-stage" className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
            <select id="bp-stage" name="stage" value={form.stage} onChange={F('stage')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select stage…</option>
              {stages.map(s => <option key={s.id} value={s.name}>{s.name}{s.is_fixed ? ' (fixed)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bp-temperature" className="block text-sm font-medium text-gray-700 mb-1">Temperature</label>
            <select id="bp-temperature" name="temperature" value={form.temperature} onChange={F('temperature')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select temperature…</option>
              {temps.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bp-followup" className="block text-sm font-medium text-gray-700 mb-1">Next Follow-up Date</label>
            <input id="bp-followup" name="next_follow_up_date" type="date" value={form.next_follow_up_date} onChange={F('next_follow_up_date')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </>
      )}
    </>
  )
}
