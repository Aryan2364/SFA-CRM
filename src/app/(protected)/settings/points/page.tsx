'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'

type ConfigRow = {
  action_type: string; label: string; points: number; cap_per_day: number | null; is_active: boolean
}
type HistoryRow = {
  id: string; action_type: string; label: string
  old_points: number | null; new_points: number
  old_cap_per_day: number | null; new_cap_per_day: number | null
  old_is_active: boolean | null; new_is_active: boolean
  changed_by_name: string | null; changed_at: string
}

const ACTION_ICONS: Record<string, string> = {
  weekly_plan_submitted: '📋',
  weekly_plan_approved: '✅',
  daily_checkin: '🟢',
  daily_checkout: '🔴',
  meeting_logged: '🤝',
  expense_submitted: '💸',
  weekly_streak: '🔥',
}

export default function PointsConfigPage() {
  const me = useMe()
  const { toast } = useToast()
  const [config, setConfig] = useState<ConfigRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [resetPeriod, setResetPeriod] = useState('monthly')
  const [tab, setTab] = useState<'config' | 'history'>('config')
  const [saving, setSaving] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [loading, setLoading] = useState(true)

  const canEdit = me?.role === 'Administrator' || (me?.permissions?.points_config?.edit ?? false)

  useEffect(() => {
    Promise.all([
      fetch('/api/points/config').then(r => r.json()),
      fetch('/api/points/config/history').then(r => r.json()),
      fetch('/api/points/settings').then(r => r.json()),
    ]).then(([cfg, hist, settings]) => {
      setConfig(cfg)
      setHistory(hist)
      setResetPeriod(settings.reset_period ?? 'monthly')
      setLoading(false)
    })
  }, [])

  function updateRow(actionType: string, field: keyof ConfigRow, value: unknown) {
    setConfig(prev => prev.map(r => r.action_type === actionType ? { ...r, [field]: value } : r))
  }

  async function saveConfig() {
    setSaving(true)
    const res = await fetch('/api/points/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (res.ok) {
      toast('Point configuration saved')
      const hist = await fetch('/api/points/config/history').then(r => r.json())
      setHistory(hist)
    } else {
      toast('Failed to save', 'error')
    }
    setSaving(false)
  }

  async function saveResetPeriod() {
    setSavingSettings(true)
    const res = await fetch('/api/points/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_period: resetPeriod }),
    })
    if (res.ok) toast('Settings saved')
    else toast('Failed to save settings', 'error')
    setSavingSettings(false)
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function diffLabel(row: HistoryRow): string[] {
    const changes: string[] = []
    if (row.old_points !== null && row.old_points !== row.new_points)
      changes.push(`Points: ${row.old_points} → ${row.new_points}`)
    if (row.old_cap_per_day !== row.new_cap_per_day)
      changes.push(`Cap/day: ${row.old_cap_per_day ?? 'none'} → ${row.new_cap_per_day ?? 'none'}`)
    if (row.old_is_active !== null && row.old_is_active !== row.new_is_active)
      changes.push(`Active: ${row.old_is_active ? 'Yes' : 'No'} → ${row.new_is_active ? 'Yes' : 'No'}`)
    return changes
  }

  if (loading) return <div className="p-6 text-text-muted text-sm">Loading…</div>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-warning-bg rounded-xl flex items-center justify-center text-xl">⚙️</div>
        <div>
          <h1 className="text-2xl font-medium text-text-primary">Points Configuration</h1>
          <p className="text-sm text-text-muted">Define how points are awarded to your team</p>
        </div>
      </div>

      {/* Reset Period */}
      <div className="bg-surface border border-border-light rounded-xl p-4 shadow-sm mb-5 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-text-secondary">Points Reset Period</p>
          <p className="text-xs text-text-secondary mt-0.5">How often the leaderboard and totals reset</p>
        </div>
        <select value={resetPeriod} onChange={e => setResetPeriod(e.target.value)}
          disabled={!canEdit}
          className="border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface disabled:bg-surface-sunken">
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="never">Never (All Time)</option>
        </select>
        {canEdit && (
          <button onClick={saveResetPeriod} disabled={savingSettings}
            className="px-3 py-2 bg-primary hover:bg-primary-hover text-primary-foreground text-sm rounded-lg font-medium disabled:opacity-40 transition">
            {savingSettings ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-light mb-5">
        {(['config', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition -mb-px ${tab === t ? 'border-primary-border text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {t === 'config' ? 'Point Rules' : 'Change History'}
          </button>
        ))}
      </div>

      {/* Config table */}
      {tab === 'config' && (
        <>
          <div className="space-y-3">
            {config.map(row => (
              <div key={row.action_type}
                className={`bg-surface border rounded-xl px-4 py-3 shadow-sm transition ${row.is_active ? 'border-border-light' : 'border-border-light opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl w-8 text-center">{ACTION_ICONS[row.action_type] ?? '⭐'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{row.label}</p>
                    <p className="text-xs text-text-muted">{row.action_type.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Points input */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-text-secondary whitespace-nowrap">Points</label>
                      <input type="number" min={0} max={100} value={row.points}
                        disabled={!canEdit}
                        onChange={e => updateRow(row.action_type, 'points', Number(e.target.value))}
                        className="w-16 border border-border-light rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken" />
                    </div>
                    {/* Cap per day */}
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-text-secondary whitespace-nowrap">Cap/day</label>
                      <input type="number" min={0} max={99}
                        value={row.cap_per_day ?? ''}
                        placeholder="∞"
                        disabled={!canEdit}
                        onChange={e => updateRow(row.action_type, 'cap_per_day', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-14 border border-border-light rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken" />
                    </div>
                    {/* Active toggle */}
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <div className="relative">
                        <input type="checkbox" className="sr-only" checked={row.is_active} disabled={!canEdit}
                          onChange={e => updateRow(row.action_type, 'is_active', e.target.checked)} />
                        <div className={`w-9 h-5 rounded-full transition ${row.is_active ? 'bg-green-500' : 'bg-gray-300'} ${!canEdit ? 'opacity-50' : ''}`} />
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-surface rounded-full shadow transition-transform ${row.is_active ? 'translate-x-4' : ''}`} />
                      </div>
                      <span className="text-xs text-text-secondary">{row.is_active ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <button onClick={saveConfig} disabled={saving}
              className="mt-5 w-full py-2.5 bg-primary hover:bg-primary-hover text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40 transition">
              {saving ? 'Saving…' : 'Save Point Rules'}
            </button>
          )}
        </>
      )}

      {/* History */}
      {tab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-10">No changes recorded yet.</p>
          ) : history.map(row => (
            <div key={row.id} className="bg-surface border border-border-light rounded-xl px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {ACTION_ICONS[row.action_type] ?? '⭐'} {row.label}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {diffLabel(row).map((d, i) => (
                      <li key={i} className="text-xs text-text-secondary">• {d}</li>
                    ))}
                  </ul>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-text-muted">{row.changed_by_name ?? 'Unknown'}</p>
                  <p className="text-xs text-text-muted">{formatDate(row.changed_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
