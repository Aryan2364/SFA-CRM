'use client'

import { useState, useRef, useEffect } from 'react'

export interface SelectOption { value: string; label: string }

interface Props {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
}

export default function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className="w-full flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={selected ? 'text-text-primary' : 'text-text-muted'}>{selected?.label ?? placeholder}</span>
        <span className="text-text-muted text-xs ml-2">▼</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-light rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border-light">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm px-2 py-1.5 border border-border-light rounded focus:outline-none focus:ring-1 focus:ring-primary-ring"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {value && (
              <li
                onClick={() => { onChange(''); setOpen(false) }}
                className="px-3 py-2 text-sm text-text-muted hover:bg-surface-sunken cursor-pointer italic"
              >
                — Clear selection —
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">No results</li>
            ) : filtered.map(o => (
              <li
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-primary-subtle ${o.value === value ? 'bg-primary-subtle text-primary font-medium' : 'text-text-secondary'}`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
