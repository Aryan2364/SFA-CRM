'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

type Remark = {
  id: string
  context_type: string
  context_id: string
  parent_remark_id: string | null
  author_user_id: string
  body: string
  created_at: string
  is_read: boolean
  users: { id: string; name: string } | null
}

interface RemarksPanelProps {
  isOpen: boolean
  onClose: () => void
  contextType: 'meeting' | 'expense' | 'weekly_plan_day' | 'weekly_plan'
  contextId: string
  contextTitle: string
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-teal-500', 'bg-rose-500',
]

function getAvatarColor(userId: string) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash + userId.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[hash]
}

export default function RemarksPanel({ isOpen, onClose, contextType, contextId, contextTitle }: RemarksPanelProps) {
  const { toast } = useToast()
  const [remarks, setRemarks] = useState<Remark[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<Remark | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!contextId) return
    setLoading(true)
    const r = await fetch(`/api/remarks?contextType=${contextType}&contextId=${contextId}`)
    if (r.ok) {
      const data: Remark[] = await r.json()
      setRemarks(data)
      // Mark unread remarks as read
      const unread = data.filter(r => !r.is_read)
      for (const remark of unread) {
        fetch(`/api/remarks/${remark.id}/read`, { method: 'POST' }).catch(() => {})
      }
    }
    setLoading(false)
  }, [contextType, contextId])

  useEffect(() => {
    if (isOpen && contextId) {
      load()
    }
  }, [isOpen, contextId, load])

  useEffect(() => {
    if (!loading && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [loading, remarks.length])

  async function handleSend() {
    if (!body.trim()) return
    setSending(true)
    const r = await fetch('/api/remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_type: contextType,
        context_id: contextId,
        parent_remark_id: replyTo?.id ?? null,
        body: body.trim(),
      }),
    })
    if (!r.ok) {
      toast((await r.json()).error ?? 'Failed to send', 'error')
    } else {
      setBody('')
      setReplyTo(null)
      load()
    }
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  // Build thread structure: top-level remarks + their replies
  const topLevel = remarks.filter(r => !r.parent_remark_id)
  const repliesMap: Record<string, Remark[]> = {}
  for (const r of remarks) {
    if (r.parent_remark_id) {
      if (!repliesMap[r.parent_remark_id]) repliesMap[r.parent_remark_id] = []
      repliesMap[r.parent_remark_id].push(r)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-screen w-full sm:w-96 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            <div className="min-w-0">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-normal">Remarks</p>
              <p className="text-sm font-medium text-gray-800 truncate">{contextTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Remarks list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading remarks...</div>
          ) : topLevel.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">No remarks yet</p>
              <p className="text-xs text-gray-300 mt-1">Start the conversation</p>
            </div>
          ) : (
            topLevel.map(remark => (
              <div key={remark.id}>
                <RemarkBubble remark={remark} onReply={() => { setReplyTo(remark); textareaRef.current?.focus() }} />
                {/* Replies */}
                {(repliesMap[remark.id] ?? []).length > 0 && (
                  <div className="ml-8 mt-2 space-y-2 border-l-2 border-gray-100 pl-3">
                    {(repliesMap[remark.id] ?? []).map(reply => (
                      <RemarkBubble key={reply.id} remark={reply} isReply />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Reply indicator */}
        {replyTo && (
          <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-blue-600 font-medium">Replying to {replyTo.users?.name ?? 'Unknown'}</p>
              <p className="text-xs text-gray-500 truncate">{replyTo.body}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="shrink-0 ml-2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Compose */}
        <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a remark... (Ctrl+Enter to send)"
              rows={2}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button onClick={handleSend} disabled={sending || !body.trim()}
              className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function RemarkBubble({ remark, onReply, isReply }: { remark: Remark; onReply?: () => void; isReply?: boolean }) {
  const name = remark.users?.name ?? 'Unknown'
  const userId = remark.author_user_id

  return (
    <div className={`flex items-start gap-2.5 ${isReply ? '' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0 ${getAvatarColor(userId)}`}>
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-medium text-gray-800">{name}</span>
          <span className="text-[10px] text-gray-400">{formatRelativeTime(remark.created_at)}</span>
          {!remark.is_read && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
          )}
        </div>
        <div className="bg-gray-50 rounded-xl rounded-tl-none px-3 py-2">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{remark.body}</p>
        </div>
        {onReply && (
          <button onClick={onReply} className="mt-1 text-[10px] text-gray-400 hover:text-blue-500 transition">
            Reply
          </button>
        )}
      </div>
    </div>
  )
}
