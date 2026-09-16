'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'
type Toast = { id: number; message: string; type: ToastType; duration: number }

const ToastCtx = createContext<{ toast: (msg: string, type?: ToastType) => void }>({ toast: () => {} })

const STYLES: Record<ToastType, { wrap: string; text: string; bar: string; btn: string; icon: string }> = {
  error:   { wrap: 'bg-red-50 border-red-200',    text: 'text-red-800',   bar: 'bg-red-500',   btn: 'text-red-400 hover:text-red-700',   icon: '✕' },
  warning: { wrap: 'bg-amber-50 border-amber-200', text: 'text-amber-800', bar: 'bg-amber-500', btn: 'text-amber-400 hover:text-amber-700', icon: '⚠' },
  success: { wrap: 'bg-green-50 border-green-200', text: 'text-green-800', bar: 'bg-green-500', btn: 'text-green-400 hover:text-green-700', icon: '✓' },
  info:    { wrap: 'bg-blue-50 border-blue-200',   text: 'text-blue-800',  bar: 'bg-blue-500',  btn: 'text-blue-400 hover:text-blue-700',  icon: 'i' },
}

function ToastItem({ t, onClose }: { t: Toast; onClose: () => void }) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), t.duration)
    return () => clearTimeout(timer)
  }, [t.duration])

  const s = STYLES[t.type]

  return (
    <div className={`${s.wrap} border rounded-lg shadow-lg overflow-hidden`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={`${s.text} text-sm font-medium mt-0.5 flex-shrink-0 w-4 text-center`}>{s.icon}</span>
        <p className={`${s.text} text-sm font-medium flex-1 leading-snug`}>{t.message}</p>
        <button
          onClick={onClose}
          className={`${s.btn} text-lg leading-none flex-shrink-0 mt-0.5 transition-colors`}
          aria-label="Dismiss"
        >×</button>
      </div>
      <div className="h-1 bg-black/5">
        <div
          className={`${s.bar} h-full`}
          style={{ animation: `toast-progress ${t.duration}ms linear forwards` }}
        />
      </div>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId.current
    const duration = type === 'error' ? 5000 : type === 'warning' ? 5000 : 3500
    setToasts(prev => [...prev, { id, message, type, duration }])
  }, [])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Fixed top-center — always visible regardless of scroll */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center gap-2 w-full max-w-md px-4 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="w-full pointer-events-auto">
            <ToastItem t={t} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}
