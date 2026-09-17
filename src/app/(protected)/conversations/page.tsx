'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLinkIcon } from 'lucide-react'

import RemarksPanel from '@/components/ui/RemarksPanel'
import { useToast } from '@/contexts/ToastContext'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Conversation = {
  context_type: string
  context_id: string
  last_remark: string
  last_body: string
  last_author: string
  count: number
  updated_at: string
  unread_count: number
  context_user_id: string | null
}

type UserOption = { id: string; name: string }

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const SECTION_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  expense: 'Expense',
  weekly_plan_day: 'Weekly Plan',
}

function sectionLabel(conv: Conversation) {
  return SECTION_LABELS[conv.context_type] ?? conv.context_type
}

/**
 * The template treats `''` as "filter not applied", so it is also the
 * key of every picker's "any" option.
 *
 * The section values are the route's, not the column's: `/api/conversations`
 * maps `weekly_plan` onto the `weekly_plan_day` context type it stores.
 */
const SECTION_OPTIONS: Record<string, string> = {
  '': 'Any section',
  meeting: 'Meetings',
  expense: 'Expenses',
  weekly_plan: 'Weekly Plan',
}

/**
 * Today's third filter was a three-way `all | unread | read`, and `all`
 * was its default. The template's inactive value IS `''`, so the two
 * collapse into one: no chip, no count, same result.
 */
const READ_OPTIONS: Record<string, string> = {
  '': 'Read and unread',
  unread: 'Unread',
  read: 'Read',
}

/**
 * Section 27.1 asks the search field to carry the list of fields it
 * covers, and asks for any exclusion to be declared. There is nothing to
 * declare: every text a conversation carries — its section, the last
 * author's name and the latest message — is searched, and each one is
 * its own column, so a match is always visible in the row that matched.
 *
 * `/api/conversations` takes no `q`, so the filtering happens over the
 * array `load` returns rather than in the route's `where` clause. That is
 * honest for this screen — the route answers with the caller's whole
 * conversation list, already narrowed by section, user and read state —
 * and it is a real limit worth naming: a list long enough to need server
 * paging would need `q` in the route as well.
 */
const SEARCH_HINT = 'Searches the section, the last author and the message.'

function getRedirectPath(conv: Conversation, currentUserId: string | null) {
  // If the context owner is not the current user, redirect to review page
  const isOwnContent = conv.context_user_id === currentUserId
  if (conv.context_type === 'meeting') {
    if (isOwnContent || !conv.context_user_id) {
      return `/daily-activity?remarks=${conv.context_id}`
    }
    return `/review/${conv.context_user_id}?tab=activity&remarks=${conv.context_id}`
  }
  if (conv.context_type === 'expense') {
    if (isOwnContent || !conv.context_user_id) {
      return `/daily-activity?tab=expenses&remarks=${conv.context_id}`
    }
    return `/review/${conv.context_user_id}?tab=expenses&remarks=${conv.context_id}`
  }
  if (conv.context_type === 'weekly_plan_day') {
    return `/weekly-plan?remarks=${conv.context_id}`
  }
  return '/'
}

/**
 * COLUMN CLASSIFICATION — section 10 rule 4 requires every table to
 * declare one, and section 10 rule 2 makes it the alternative to
 * scrolling sideways.
 *
 *   essential          Section, Latest message, Unread, Actions
 *   hide-below-1024    Author, Remarks
 *   hide-below-768     Updated
 *
 * A conversation IS its latest message and what that message is about,
 * so Section and Latest message stay to the narrowest width. Unread is
 * the reason this screen exists rather than being a view of the remark
 * table — it is what the read filter filters on and what the user came
 * to clear — and Actions is the only route into the thread, so a row
 * without it is a dead end.
 *
 * Author and Remarks go first because they are the two a reader can most
 * afford to lose: the author's name is the first thing the panel's own
 * header shows, and the remark count is a size, not content. Updated
 * survives to 768 because the list is sorted by it, and a recency order
 * with no visible recency reads as no order at all. All three are on the
 * panel or in the sort, so nothing becomes unreachable.
 *
 * Section is NOT a coloured chip. It is a category, and section 2.4 has
 * a colour for success, warning and danger and for nothing else; the
 * `bg-chart-N` this screen used to paint it with is the chart palette,
 * which section 21 says a caller never names. Plain text, consistent
 * with the same decision on leads.
 */
function conversationColumns(
  onOpen: (conv: Conversation) => void,
  onSource: (conv: Conversation) => void
): ListColumn<Conversation>[] {
  return [
    {
      id: 'section',
      header: 'Section',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-20',
      truncate: true,
      cell: sectionLabel,
    },
    {
      id: 'message',
      header: 'Latest message',
      grow: true,
      truncate: true,
      cellClassName: 'text-text-primary',
      skeletonWidth: 'w-64',
      cell: conv => conv.last_body,
    },
    {
      id: 'author',
      header: 'Author',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: conv => conv.last_author || '—',
    },
    {
      id: 'remarks',
      header: 'Remarks',
      tier: 'hide-below-1024',
      numeric: true,
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-10',
      cell: conv => conv.count,
    },
    {
      id: 'unread',
      header: 'Unread',
      numeric: true,
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-10',
      /* Section 7.3: a plain count is neither success nor failure, so the
         badge is the primary one rather than a status colour. Capped at
         9+ exactly as the card feed capped it. */
      cell: conv =>
        conv.unread_count > 0 ? (
          <Badge variant="primary">
            {conv.unread_count > 9 ? '9+' : conv.unread_count}
          </Badge>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      tier: 'hide-below-768',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-16',
      cell: conv => formatRelative(conv.updated_at),
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control-sm w-28',
      /* Two routes out of a row, exactly as the card had: the thread
         itself, and the record the thread is attached to. Open is the
         one the row used to be a click target for — section 11.1 has no
         row click, and orders already settled that a button in the last
         column is how this product opens a record from a list. */
      cell: conv => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="secondary" size="sm" onClick={() => onOpen(conv)}>
            Open
          </Button>
          <Button variant="in-field" size="sm" onClick={() => onSource(conv)}>
            <ExternalLinkIcon />
            Source
          </Button>
        </div>
      ),
    },
  ]
}

export default function ConversationsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [users, setUsers] = useState<UserOption[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  /* Bumped when closing the panel makes the unread counts stale. */
  const [refreshKey, setRefreshKey] = useState(0)

  // Remarks panel for inline reply
  const [remarksPanel, setRemarksPanel] = useState<{
    contextType: 'meeting' | 'expense' | 'weekly_plan_day'
    contextId: string
    title: string
  } | null>(null)

  useEffect(() => {
    // Load subordinates for user filter
    fetch('/api/review/summary-cards').then(r => r.json()).then((cards: { id: string; name: string }[]) => {
      if (Array.isArray(cards)) setUsers(cards)
    }).catch(() => toast('Failed to load user list', 'error'))
    // Load current user id
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d?.userId) setCurrentUserId(d.userId)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Deliberately NOT memoised: the template holds `load` in a ref and
   * never makes it an effect dependency. No deadline and no catch here
   * either — the template races this against its own timer, so a
   * rejection IS the failed state (section 14 rule 4).
   */
  const load: ListPageProps<Conversation>['load'] = async ({ search, filters, signal }) => {
    const p = new URLSearchParams()
    if (filters.section) p.set('section', filters.section)
    if (filters.user) p.set('userId', filters.user)
    if (filters.read) p.set('status', filters.read)
    const query = p.toString()
    const r = await fetch(`/api/conversations${query ? `?${query}` : ''}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: Conversation[] = Array.isArray(body) ? body : []
    if (!search) return rows
    const needle = search.toLowerCase()
    return rows.filter(conv =>
      sectionLabel(conv).toLowerCase().includes(needle) ||
      conv.last_author.toLowerCase().includes(needle) ||
      conv.last_body.toLowerCase().includes(needle)
    )
  }

  const filters: ListFilter[] = [
    { id: 'section', label: 'Section', kind: 'select', options: SECTION_OPTIONS },
    /* The user picker only exists for somebody with reports, exactly as
       before. Section 16.3: a team runs past six names sooner than it
       does not, so it is the searchable kind. */
    ...(users.length > 0
      ? [
          {
            id: 'user',
            label: 'Author',
            kind: 'select' as const,
            searchable: true,
            options: {
              '': 'Anyone',
              ...Object.fromEntries(users.map(u => [u.id, u.name])),
            },
          },
        ]
      : []),
    { id: 'read', label: 'Read state', kind: 'select', options: READ_OPTIONS },
  ]

  function openPanel(conv: Conversation) {
    const ctxType = conv.context_type as 'meeting' | 'expense' | 'weekly_plan_day'
    setRemarksPanel({
      contextType: ctxType,
      contextId: conv.context_id,
      title: `${sectionLabel(conv)} — ${conv.last_author}`,
    })
  }

  return (
    <>
      <ListPage<Conversation>
        title="Conversations"
        noun={{ one: 'conversation', many: 'conversations' }}
        columns={conversationColumns(openPanel, conv =>
          router.push(getRedirectPath(conv, currentUserId))
        )}
        rowKey={conv => `${conv.context_type}::${conv.context_id}`}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchHint={SEARCH_HINT}
        emptyYet={{
          heading: 'No conversations yet',
          body: 'Remarks on meetings, expenses and plans appear here as threads.',
        }}
      />

      {remarksPanel && (
        <RemarksPanel
          isOpen={!!remarksPanel}
          onClose={() => {
            setRemarksPanel(null)
            setRefreshKey(k => k + 1)
          }}
          contextType={remarksPanel.contextType}
          contextId={remarksPanel.contextId}
          contextTitle={remarksPanel.title}
        />
      )}
    </>
  )
}
