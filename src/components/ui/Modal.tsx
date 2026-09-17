import { ReactNode } from 'react'

interface ModalProps {
  title: string
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  isSaving?: boolean
  saveLabel?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export default function Modal({ title, isOpen, onClose, onSave, isSaving, saveLabel = 'Save', children, size = 'md' }: ModalProps) {
  if (!isOpen) return null
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-(--backdrop)" onClick={onClose} />
      <div className={`relative bg-surface rounded-2xl shadow-2xl w-full ${widths[size]} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h3 className="text-base font-medium text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-4 flex-1">{children}</div>
        <div className="px-6 py-4 border-t border-border-light flex justify-end gap-3">
          <button onClick={onClose} className="text-sm font-medium text-text-secondary hover:text-text-primary px-4 py-2 rounded-lg border border-border-light transition">
            Cancel
          </button>
          <button onClick={onSave} disabled={isSaving} className="text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2 rounded-lg transition disabled:opacity-50">
            {isSaving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
