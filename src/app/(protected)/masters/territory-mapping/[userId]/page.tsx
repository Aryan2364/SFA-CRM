'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

type State = { id: string; name: string }
type District = { id: string; name: string; state_id: string }
type Taluka = { id: string; name: string; district_id: string }
type Village = { id: string; name: string; taluka_id: string }
type UserInfo = { id: string; name: string; contact: string }

export default function TerritoryCanvasPage() {
  const params = useParams()
  const userId = params.userId as string
  const { toast } = useToast()
  const router = useRouter()

  const [user, setUser] = useState<UserInfo | null>(null)
  const [states, setStates] = useState<State[]>([])
  const [stateSearch, setStateSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)
  const [savedSummary, setSavedSummary] = useState({ states: 0, districts: 0, talukas: 0, villages: 0 })

  // Selected IDs (the authoritative truth)
  const [stateIds, setStateIds] = useState<Set<string>>(new Set())
  const [districtIds, setDistrictIds] = useState<Set<string>>(new Set())
  const [talukaIds, setTalukaIds] = useState<Set<string>>(new Set())
  const [villageIds, setVillageIds] = useState<Set<string>>(new Set())

  // Lazy loaded data cache
  const [districtsByState, setDistrictsByState] = useState<Map<string, District[]>>(new Map())
  const [talukasByDistrict, setTalukasByDistrict] = useState<Map<string, Taluka[]>>(new Map())
  const [villagesByTaluka, setVillagesByTaluka] = useState<Map<string, Village[]>>(new Map())

  // Expand/collapse state (independent of selection)
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set())
  const [expandedDistricts, setExpandedDistricts] = useState<Set<string>>(new Set())
  const [expandedTalukas, setExpandedTalukas] = useState<Set<string>>(new Set())

  // Search per branch
  const [dSearch, setDSearch] = useState<Record<string, string>>({})
  const [tSearch, setTSearch] = useState<Record<string, string>>({})
  const [vSearch, setVSearch] = useState<Record<string, string>>({})

  // NOTE: APIs expect camelCase query params: stateId, districtId, talukaId
  const loadDistricts = useCallback(async (stateId: string) => {
    if (districtsByState.has(stateId)) return
    const r = await fetch(`/api/masters/districts?stateId=${stateId}`)
    const d = await r.json()
    setDistrictsByState(prev => new Map(prev).set(stateId, Array.isArray(d) ? d : []))
  }, [districtsByState])

  const loadTalukas = useCallback(async (districtId: string) => {
    if (talukasByDistrict.has(districtId)) return
    const r = await fetch(`/api/masters/talukas?districtId=${districtId}`)
    const d = await r.json()
    setTalukasByDistrict(prev => new Map(prev).set(districtId, Array.isArray(d) ? d : []))
  }, [talukasByDistrict])

  const loadVillages = useCallback(async (talukaId: string) => {
    if (villagesByTaluka.has(talukaId)) return
    const r = await fetch(`/api/masters/villages?talukaId=${talukaId}`)
    const d = await r.json()
    setVillagesByTaluka(prev => new Map(prev).set(talukaId, Array.isArray(d) ? d : []))
  }, [villagesByTaluka])

  useEffect(() => {
    async function init() {
      setLoading(true)
      const [statesRes, mappingRes] = await Promise.all([
        fetch('/api/masters/states').then(r => r.json()),
        fetch(`/api/masters/territory-mapping/${userId}`).then(r => r.json()),
      ])
      const stateList: State[] = Array.isArray(statesRes) ? statesRes : []
      setStates(stateList)
      setUser(mappingRes.user ?? null)

      const sIds = new Set<string>(mappingRes.state_ids ?? [])
      const dIds = new Set<string>(mappingRes.district_ids ?? [])
      const tIds = new Set<string>(mappingRes.taluka_ids ?? [])
      const vIds = new Set<string>(mappingRes.village_ids ?? [])
      setStateIds(sIds)
      setDistrictIds(dIds)
      setTalukaIds(tIds)
      setVillageIds(vIds)

      // Pre-load districts for saved states (correct param: stateId)
      const districtData = new Map<string, District[]>()
      await Promise.all([...sIds].map(async sId => {
        const r = await fetch(`/api/masters/districts?stateId=${sId}`)
        const d = await r.json()
        districtData.set(sId, Array.isArray(d) ? d : [])
      }))
      setDistrictsByState(districtData)

      // Pre-load talukas for saved districts (correct param: districtId)
      const talukaData = new Map<string, Taluka[]>()
      await Promise.all([...dIds].map(async dId => {
        const r = await fetch(`/api/masters/talukas?districtId=${dId}`)
        const d = await r.json()
        talukaData.set(dId, Array.isArray(d) ? d : [])
      }))
      setTalukasByDistrict(talukaData)

      // Pre-load villages for saved talukas (correct param: talukaId)
      const villageData = new Map<string, Village[]>()
      await Promise.all([...tIds].map(async tId => {
        const r = await fetch(`/api/masters/villages?talukaId=${tId}`)
        const d = await r.json()
        villageData.set(tId, Array.isArray(d) ? d : [])
      }))
      setVillagesByTaluka(villageData)

      // Auto-expand saved state/district/taluka rows
      setExpandedStates(new Set(sIds))
      setExpandedDistricts(new Set(dIds))
      setExpandedTalukas(new Set(tIds))

      setLoading(false)
    }
    init()
  }, [userId])

  // Toggle state SELECTION (checkbox)
  async function handleStateCheck(stateId: string) {
    const next = new Set(stateIds)
    if (next.has(stateId)) {
      next.delete(stateId)
      // Collapse when deselected
      setExpandedStates(prev => { const s = new Set(prev); s.delete(stateId); return s })
    } else {
      next.add(stateId)
      await loadDistricts(stateId)
      // Auto-expand on selection
      setExpandedStates(prev => new Set(prev).add(stateId))
    }
    setStateIds(next)
  }

  // Toggle state EXPAND (arrow button — independent of selection)
  function handleStateExpand(stateId: string) {
    setExpandedStates(prev => {
      const s = new Set(prev)
      s.has(stateId) ? s.delete(stateId) : s.add(stateId)
      return s
    })
  }

  async function handleDistrictToggle(district: District) {
    const next = new Set(districtIds)
    if (next.has(district.id)) {
      next.delete(district.id)
      setExpandedDistricts(prev => { const s = new Set(prev); s.delete(district.id); return s })
    } else {
      next.add(district.id)
      await loadTalukas(district.id)
      setExpandedDistricts(prev => new Set(prev).add(district.id))
    }
    setDistrictIds(next)
  }

  async function handleTalukaToggle(taluka: Taluka) {
    const next = new Set(talukaIds)
    if (next.has(taluka.id)) {
      next.delete(taluka.id)
      setExpandedTalukas(prev => { const s = new Set(prev); s.delete(taluka.id); return s })
    } else {
      next.add(taluka.id)
      await loadVillages(taluka.id)
      setExpandedTalukas(prev => new Set(prev).add(taluka.id))
    }
    setTalukaIds(next)
  }

  function handleVillageToggle(villageId: string) {
    const next = new Set(villageIds)
    if (next.has(villageId)) { next.delete(villageId) } else { next.add(villageId) }
    setVillageIds(next)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const r = await fetch(`/api/masters/territory-mapping/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_ids: [...stateIds],
          district_ids: [...districtIds],
          taluka_ids: [...talukaIds],
          village_ids: [...villageIds],
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast(err.error ?? 'Save failed', 'error')
      } else {
        // Reload from DB to confirm persistence visually
        const confirmed = await fetch(`/api/masters/territory-mapping/${userId}`).then(res => res.json())
        const sIds = new Set<string>(confirmed.state_ids ?? [])
        const dIds = new Set<string>(confirmed.district_ids ?? [])
        const tIds = new Set<string>(confirmed.taluka_ids ?? [])
        const vIds = new Set<string>(confirmed.village_ids ?? [])
        setStateIds(sIds)
        setDistrictIds(dIds)
        setTalukaIds(tIds)
        setVillageIds(vIds)
        setExpandedStates(new Set(sIds))
        setExpandedDistricts(new Set(dIds))
        setExpandedTalukas(new Set(tIds))
        setSavedSummary({ states: sIds.size, districts: dIds.size, talukas: tIds.size, villages: vIds.size })
        setShowSuccess(true)
      }
    } catch {
      toast('Network error — save failed', 'error')
    }
    setSaving(false)
  }

  const filteredStates = states.filter(s => s.name.toLowerCase().includes(stateSearch.toLowerCase()))

  function allDistrictsSelected(stateId: string) {
    const districts = districtsByState.get(stateId) ?? []
    return districts.length > 0 && districts.every(d => districtIds.has(d.id))
  }
  function toggleAllDistricts(stateId: string) {
    const districts = districtsByState.get(stateId) ?? []
    const next = new Set(districtIds)
    if (allDistrictsSelected(stateId)) {
      districts.forEach(d => { next.delete(d.id); setExpandedDistricts(prev => { const s = new Set(prev); s.delete(d.id); return s }) })
    } else {
      districts.forEach(d => { next.add(d.id); loadTalukas(d.id) })
    }
    setDistrictIds(next)
  }

  function allTalukasSelected(districtId: string) {
    const talukas = talukasByDistrict.get(districtId) ?? []
    return talukas.length > 0 && talukas.every(t => talukaIds.has(t.id))
  }
  function toggleAllTalukas(districtId: string) {
    const talukas = talukasByDistrict.get(districtId) ?? []
    const next = new Set(talukaIds)
    if (allTalukasSelected(districtId)) {
      talukas.forEach(t => { next.delete(t.id); setExpandedTalukas(prev => { const s = new Set(prev); s.delete(t.id); return s }) })
    } else {
      talukas.forEach(t => { next.add(t.id); loadVillages(t.id) })
    }
    setTalukaIds(next)
  }

  function allVillagesSelected(talukaId: string) {
    const villages = villagesByTaluka.get(talukaId) ?? []
    return villages.length > 0 && villages.every(v => villageIds.has(v.id))
  }
  function toggleAllVillages(talukaId: string) {
    const villages = villagesByTaluka.get(talukaId) ?? []
    const next = new Set(villageIds)
    if (allVillagesSelected(talukaId)) {
      villages.forEach(v => next.delete(v.id))
    } else {
      villages.forEach(v => next.add(v.id))
    }
    setVillageIds(next)
  }

  const totalSelected = stateIds.size + districtIds.size + talukaIds.size + villageIds.size

  if (loading) return <div className="text-center py-16 text-gray-400">Loading territory data…</div>

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <a href="/masters/territory-mapping" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            Back to Territory Mapping
          </a>
          <h2 className="text-xl font-medium text-gray-800">{user?.name ?? 'User'} — Territory</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalSelected > 0
              ? `${stateIds.size} states · ${districtIds.size} districts · ${talukaIds.size} talukas · ${villageIds.size} villages selected`
              : 'No territory assigned yet'}
          </p>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl disabled:opacity-50 transition shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          {saving ? 'Saving…' : 'Save Territory'}
        </button>
      </div>

      {/* State search */}
      <div className="mb-4">
        <input type="text" placeholder="Search states…" value={stateSearch} onChange={e => setStateSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Tree */}
      <div className="space-y-2">
        {filteredStates.map(state => {
          const isStateSelected = stateIds.has(state.id)
          const isStateExpanded = expandedStates.has(state.id)
          const districts = districtsByState.get(state.id) ?? []
          const activeDistricts = districts.filter(d => districtIds.has(d.id))

          return (
            <div key={state.id} className={`rounded-xl border overflow-hidden ${isStateSelected ? 'border-blue-300' : 'border-gray-200'}`}>
              {/* State row — checkbox and expand are SEPARATE controls */}
              <div className={`flex items-center gap-2 px-4 py-3 ${isStateSelected ? 'bg-blue-50' : 'bg-white'}`}>
                {/* Checkbox — toggles selection only */}
                <input
                  type="checkbox"
                  checked={isStateSelected}
                  onChange={() => handleStateCheck(state.id)}
                  className="w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0"
                />

                {/* State name + expand button — positioned NEXT TO name */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="font-medium text-gray-800 truncate">{state.name}</span>
                  {/* Expand/collapse button next to the name */}
                  {isStateSelected && (
                    <button
                      onClick={() => handleStateExpand(state.id)}
                      className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700 text-xs font-medium bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded transition shrink-0"
                      title={isStateExpanded ? 'Collapse' : 'Expand districts'}
                    >
                      <svg className={`w-3 h-3 transition-transform ${isStateExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Summary chip */}
                {isStateSelected && districts.length > 0 && (
                  <span className="text-xs text-blue-600 font-medium shrink-0">{activeDistricts.length}/{districts.length} dist.</span>
                )}
                {isStateSelected && districts.length === 0 && (
                  <span className="text-xs text-gray-400 shrink-0">No districts</span>
                )}
              </div>

              {/* Districts — only shown when selected AND expanded */}
              {isStateSelected && isStateExpanded && districts.length > 0 && (
                <div className="border-t border-gray-100 bg-gray-50/50">
                  {/* District search + select all */}
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                    <input type="checkbox" checked={allDistrictsSelected(state.id)}
                      onChange={() => toggleAllDistricts(state.id)}
                      className="w-4 h-4 rounded accent-blue-600" title="Select all districts" />
                    <input type="text" placeholder="Search districts…" value={dSearch[state.id] ?? ''}
                      onChange={e => setDSearch(p => ({ ...p, [state.id]: e.target.value }))}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    <span className="text-xs text-gray-400 shrink-0">{activeDistricts.length} sel.</span>
                  </div>

                  {/* District list */}
                  <div className="divide-y divide-gray-50">
                    {districts
                      .filter(d => d.name.toLowerCase().includes((dSearch[state.id] ?? '').toLowerCase()))
                      .map(district => {
                        const isDistSelected = districtIds.has(district.id)
                        const isExpanded = expandedDistricts.has(district.id)
                        const talukas = talukasByDistrict.get(district.id) ?? []
                        const activeTalukas = talukas.filter(t => talukaIds.has(t.id))

                        return (
                          <div key={district.id}>
                            {/* District row */}
                            <div className={`flex items-center gap-2 px-6 py-2.5 ${isDistSelected ? 'bg-green-50' : 'bg-white hover:bg-gray-50'}`}>
                              <input type="checkbox" checked={isDistSelected} onChange={() => handleDistrictToggle(district)}
                                className="w-4 h-4 rounded accent-green-600 cursor-pointer shrink-0" />
                              {/* District name + expand button next to name */}
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className={`text-sm truncate ${isDistSelected ? 'text-gray-800 font-medium' : 'text-gray-600'}`}>{district.name}</span>
                                {isDistSelected && talukas.length > 0 && (
                                  <button
                                    onClick={() => setExpandedDistricts(prev => { const s = new Set(prev); isExpanded ? s.delete(district.id) : s.add(district.id); return s })}
                                    className="flex items-center gap-0.5 text-green-600 hover:text-green-700 text-xs bg-green-100 hover:bg-green-200 px-1.5 py-0.5 rounded transition shrink-0"
                                    title={isExpanded ? 'Collapse' : 'Expand talukas'}
                                  >
                                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {isDistSelected && talukas.length > 0 && (
                                <span className="text-xs text-green-600 shrink-0">{activeTalukas.length}/{talukas.length} tal.</span>
                              )}
                            </div>

                            {/* Talukas */}
                            {isDistSelected && isExpanded && (
                              <div className="border-t border-gray-50 bg-green-50/30">
                                <div className="flex items-center gap-2 px-8 py-2 border-b border-gray-100">
                                  <input type="checkbox" checked={allTalukasSelected(district.id)}
                                    onChange={() => toggleAllTalukas(district.id)}
                                    className="w-4 h-4 rounded accent-green-600" title="Select all talukas" />
                                  <input type="text" placeholder="Search talukas…" value={tSearch[district.id] ?? ''}
                                    onChange={e => setTSearch(p => ({ ...p, [district.id]: e.target.value }))}
                                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white" />
                                  <span className="text-xs text-gray-400 shrink-0">{activeTalukas.length} sel.</span>
                                </div>
                                {talukas
                                  .filter(t => t.name.toLowerCase().includes((tSearch[district.id] ?? '').toLowerCase()))
                                  .map(taluka => {
                                    const isTalSelected = talukaIds.has(taluka.id)
                                    const isTalExpanded = expandedTalukas.has(taluka.id)
                                    const villages = villagesByTaluka.get(taluka.id) ?? []
                                    const activeVillages = villages.filter(v => villageIds.has(v.id))

                                    return (
                                      <div key={taluka.id}>
                                        <div className={`flex items-center gap-2 px-10 py-2 ${isTalSelected ? 'bg-purple-50' : 'bg-white hover:bg-gray-50'}`}>
                                          <input type="checkbox" checked={isTalSelected} onChange={() => handleTalukaToggle(taluka)}
                                            className="w-3.5 h-3.5 rounded accent-purple-600 cursor-pointer shrink-0" />
                                          {/* Taluka name + expand button next to name */}
                                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                            <span className={`text-sm truncate ${isTalSelected ? 'text-gray-800' : 'text-gray-600'}`}>{taluka.name}</span>
                                            {isTalSelected && villages.length > 0 && (
                                              <button
                                                onClick={() => setExpandedTalukas(prev => { const s = new Set(prev); isTalExpanded ? s.delete(taluka.id) : s.add(taluka.id); return s })}
                                                className="flex items-center gap-0.5 text-purple-600 hover:text-purple-700 text-xs bg-purple-100 hover:bg-purple-200 px-1.5 py-0.5 rounded transition shrink-0"
                                                title={isTalExpanded ? 'Collapse' : 'Expand villages'}
                                              >
                                                <svg className={`w-3 h-3 transition-transform ${isTalExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                                </svg>
                                              </button>
                                            )}
                                          </div>
                                          {isTalSelected && villages.length > 0 && (
                                            <span className="text-xs text-purple-600 shrink-0">{activeVillages.length}/{villages.length} vil.</span>
                                          )}
                                        </div>

                                        {/* Villages */}
                                        {isTalSelected && isTalExpanded && (
                                          <div className="border-t border-gray-50">
                                            <div className="flex items-center gap-2 px-12 py-2 border-b border-gray-100">
                                              <input type="checkbox" checked={allVillagesSelected(taluka.id)}
                                                onChange={() => toggleAllVillages(taluka.id)}
                                                className="w-3.5 h-3.5 rounded accent-purple-600" title="Select all villages" />
                                              <input type="text" placeholder="Search villages…" value={vSearch[taluka.id] ?? ''}
                                                onChange={e => setVSearch(p => ({ ...p, [taluka.id]: e.target.value }))}
                                                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white" />
                                              <span className="text-xs text-gray-400 shrink-0">{activeVillages.length} sel.</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-1 px-12 py-2">
                                              {villages
                                                .filter(v => v.name.toLowerCase().includes((vSearch[taluka.id] ?? '').toLowerCase()))
                                                .map(village => (
                                                  <label key={village.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                                                    <input type="checkbox" checked={villageIds.has(village.id)} onChange={() => handleVillageToggle(village.id)}
                                                      className="w-3.5 h-3.5 rounded accent-orange-500" />
                                                    <span className="text-xs text-gray-700">{village.name}</span>
                                                  </label>
                                                ))}
                                              {villages.length === 0 && <span className="text-xs text-gray-400 col-span-2 py-2">No villages found</span>}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {filteredStates.length === 0 && (
          <div className="text-center py-8 text-gray-400">No states match your search.</div>
        )}
      </div>

      {/* Bottom save button */}
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-3 rounded-xl disabled:opacity-50 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          {saving ? 'Saving…' : 'Save Territory'}
        </button>
      </div>

      {/* ── Success Dialog ── */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
            {/* Check icon */}
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>

            <h3 className="text-lg font-medium text-gray-900 mb-1">Territory Saved</h3>
            <p className="text-sm text-gray-500 mb-1">
              Territory for <span className="font-medium text-gray-700">{user?.name}</span> has been updated successfully.
            </p>
            <p className="text-xs text-gray-400 mb-6">
              {savedSummary.states} state{savedSummary.states !== 1 ? 's' : ''} · {savedSummary.districts} district{savedSummary.districts !== 1 ? 's' : ''} · {savedSummary.talukas} taluka{savedSummary.talukas !== 1 ? 's' : ''} · {savedSummary.villages} village{savedSummary.villages !== 1 ? 's' : ''}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => router.push('/masters/territory-mapping')}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                ← Go Back
              </button>
              <button
                onClick={() => setShowSuccess(false)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition">
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
