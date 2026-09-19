'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExternalLinkIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { Badge } from '@/components/ui/badge'
import { ConversationThreadSheet } from '@/components/conversations/conversation-thread-sheet'
import {
  addressFromParams,
  addressOf,
  isSummaryType,
  threadHref,
  type ConversationAddress,
} from '@/components/conversations/conversation-address'
import { fmtDate } from '@/lib/format'

type Conversation = {
  context_type: string
  /** F29 — the human label, decided once in `api/conversations/_labels.ts`. */
  context_label: string
  context_id: string
  last_remark: string
  last_body: string
  last_author: string
  count: number
  updated_at: string
  unread_count: number
  context_user_id: string | null
  /** Summary contexts only: whose summary, and which period. F32. */
  context_user_name: string | null
  context_period: string | null
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

/**
 * F29 — NO CONTEXT KEY REACHES THIS SCREEN.
 *
 * `daily_summary` and its siblings are storage. The label arrives on the row
 * from `api/conversations/_labels.ts`, which is typed against the context
 * vocabulary, so a newly added type fails the build rather than printing its
 * own key here. This function exists only so that a response from an older
 * deployment, which carries no label, still cannot leak one.
 */
function sectionLabel(conv: Conversation) {
  return conv.context_label || 'Note'
}

/** "Amit Kulkarni · 17 Sep 2026" — who and when, for a summary. */
function subjectLine(conv: Conversation): string | null {
  if (!conv.context_period) return null
  const when = fmtDate(conv.context_period)
  return conv.context_user_name ? `${conv.context_user_name} · ${when}` : when
}

/**
 * The template treats the empty string as "filter not applied", so it is
 * also the key of every picker's "any" option.
 *
 * The section values are the route's, not the column's: `/api/conversations`
 * maps `weekly_plan` onto the `weekly_plan_day` context type it stores, and
 * `summary` onto the two summary types.
 */
const SECTION_OPTIONS: Record<string, string> = {
  '': 'Any section',
  meeting: 'Meetings',
  expense: 'Expenses',
  weekly_plan: 'Weekly Plan',
  summary: 'Summaries',
}

const READ_OPTIONS: Record<string, string> = {
  '': 'Read and unread',
  unread: 'Unread',
  read: 'Read',
}

const SEARCH_HINT =
  'Searches the section, the person, the last author and the message.'

/**
 * The record a conversation is attached to, or `null` when this product has
 * no screen that would show it.
 *
 * F32 — a summary is NOT addressed by its derived id, here either. It is a
 * person and a day, and the review screen takes exactly that pair. `null`
 * means no Source link is drawn: a link that lands on a page with nothing on
 * it is worse than no link, and the thread itself is still one click away.
 */
function sourceHref(conv: Conversation): string | null {
  const isOwnContent = conv.context_user_id === null
  if (conv.context_type === 'daily_summary') {
    if (!conv.context_user_id || !conv.context_period) return null
    return `/review/${conv.context_user_id}?tab=summary&date=${conv.context_period}`
  }
  if (conv.context_type === 'weekly_summary') {
    return '/review/weekly'
  }
  if (conv.context_type === 'meeting') {
    if (isOwnContent) return `/daily-activity?remarks=${conv.context_id}`
    return `/review/${conv.context_user_id}?tab=activity&remarks=${conv.context_id}`
  }
  if (conv.context_type === 'expense') {
    if (isOwnContent) return `/daily-activity?tab=expenses&remarks=${conv.context_id}`
    return `/review/${conv.context_user_id}?tab=expenses&remarks=${conv.context_id}`
  }
  if (
    conv.context_type === 'weekly_plan_day' ||
    conv.context_type === 'weekly_plan'
  ) {
    return `/weekly-plan?remarks=${conv.context_id}`
  }
  if (conv.context_type === 'order') return `/orders?open=${conv.context_id}`
  if (conv.context_type === 'deal') return '/deals'
  return null
}

/**
 * COLUMN CLASSIFICATION — section 10 rule 4 requires every table to declare
 * one, and section 10 rule 2 makes it the alternative to scrolling sideways.
 *
 *   essential          Conversation, Latest message, Unread, Source
 *   hide-below-1024    Author, Remarks
 *   hide-below-768     Updated
 *
 * F31 — THERE IS NO OPEN BUTTON. The Conversation cell IS the way in, and the
 * trap in that change is trading one discoverability problem for another:
 * something that navigates without looking like it navigates is exactly as
 * hidden as a button nobody notices. So it takes the link treatment this
 * product already settled on for the person's name on Team Summary — coloured
 * and underlined on hover, and 44px tall on a phone — and it stays a real
 * `next/link`, so middle-click and open-in-new-tab work.
 *
 * The ROW is deliberately not a click surface. It carries a Source link of
 * its own, and a row-wide click target swallows the controls inside it.
 */
function conversationColumns(): ListColumn<Conversation>[] {
  return [
    {
      id: 'conversation',
      header: 'Conversation',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-40',
      cell: conv => {
        const address = addressOf(conv)
        const subject = subjectLine(conv)
        if (!address) {
          /* No dead end and no lie: the row still says what it is, and says
             why it cannot be opened, rather than offering a link that would
             answer with an empty thread. */
          return (
            <span className="inline-flex min-h-[44px] flex-col justify-center py-2">
              <span className="font-medium text-text-primary">
                {sectionLabel(conv)}
              </span>
              <span className="text-meta text-text-muted">
                Cannot be opened — the record it belongs to is gone
              </span>
            </span>
          )
        }
        return (
          <Link
            href={threadHref(address)}
            scroll={false}
            className="inline-flex min-h-[44px] flex-col justify-center py-2 font-medium text-text-primary hover:text-primary hover:underline"
          >
            {sectionLabel(conv)}
            {subject && (
              <span className="text-meta font-normal text-text-secondary">
                {subject}
              </span>
            )}
          </Link>
        )
      },
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
         badge is the primary one rather than a status colour. */
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
      id: 'source',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control-sm w-20',
      /* The second way out of a row: the record the thread is attached to, as
         opposed to the thread itself. A link, not a button, for the same
         reason the Conversation cell is one. */
      cell: conv => {
        const href = sourceHref(conv)
        if (!href) return <span className="text-text-muted">—</span>
        return (
          <Link
            href={href}
            className="inline-flex min-h-[44px] items-center justify-end gap-1.5 text-text-secondary hover:text-primary hover:underline"
          >
            <ExternalLinkIcon className="h-4 w-4" />
            Source
          </Link>
        )
      },
    },
  ]
}

function sameAddress(a: ConversationAddress, b: ConversationAddress): boolean {
  if (a.kind === 'summary' && b.kind === 'summary') {
    return (
      a.contextType === b.contextType &&
      a.userId === b.userId &&
      a.date === b.date
    )
  }
  if (a.kind === 'row' && b.kind === 'row') {
    return a.contextType === b.contextType && a.contextId === b.contextId
  }
  return false
}

function ConversationsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [users, setUsers] = useState<UserOption[]>([])
  /* Bumped when closing the thread makes the unread counts stale. */
  const [refreshKey, setRefreshKey] = useState(0)
  /* The loaded rows, kept so the open thread can be titled from its row. */
  const [rows, setRows] = useState<Conversation[]>([])

  /*
   * F31/F32 — the open thread lives in the URL, not in component state. That
   * is what lets the way in be a real link rather than a click handler.
   */
  const openAddress: ConversationAddress | null = useMemo(
    () => addressFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )

  const openRow = openAddress
    ? rows.find(r => {
        const a = addressOf(r)
        return a ? sameAddress(a, openAddress) : false
      }) ?? null
    : null

  useEffect(() => {
    fetch('/api/review/summary-cards')
      .then(r => r.json())
      .then((cards: { id: string; name: string }[]) => {
        if (Array.isArray(cards)) setUsers(cards)
      })
      .catch(() => toast('Failed to load user list', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Deliberately NOT memoised: the template holds `load` in a ref and never
   * makes it an effect dependency. No deadline and no catch here either — the
   * template races this against its own timer, so a rejection IS the failed
   * state (section 14 rule 4).
   */
  const load: ListPageProps<Conversation>['load'] = async ({
    search,
    filters,
    signal,
  }) => {
    const p = new URLSearchParams()
    if (filters.section) p.set('section', filters.section)
    if (filters.user) p.set('userId', filters.user)
    if (filters.read) p.set('status', filters.read)
    const query = p.toString()
    const r = await fetch(`/api/conversations${query ? `?${query}` : ''}`, {
      signal,
    })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const all: Conversation[] = Array.isArray(body) ? body : []
    setRows(all)
    if (!search) return all
    const needle = search.toLowerCase()
    return all.filter(
      conv =>
        sectionLabel(conv).toLowerCase().includes(needle) ||
        (conv.context_user_name ?? '').toLowerCase().includes(needle) ||
        conv.last_author.toLowerCase().includes(needle) ||
        conv.last_body.toLowerCase().includes(needle)
    )
  }

  const filters: ListFilter[] = [
    {
      id: 'section',
      label: 'Section',
      kind: 'select',
      options: SECTION_OPTIONS,
    },
    /* The user picker only exists for somebody with reports. Section 16.3: a
       team runs past six names sooner than it does not, so it is searchable. */
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

  const openTitle = openRow
    ? sectionLabel(openRow)
    : openAddress && isSummaryType(openAddress.contextType)
      ? 'Summary comment'
      : 'Conversation'
  const openSubtitle = openRow
    ? (subjectLine(openRow) ?? (openRow.last_author || null))
    : null

  return (
    <>
      <ListPage<Conversation>
        title="Conversations"
        noun={{ one: 'conversation', many: 'conversations' }}
        columns={conversationColumns()}
        rowKey={conv => `${conv.context_type}::${conv.context_id}`}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchHint={SEARCH_HINT}
        /* F30 — with the fixture thread deleted this is what the screen shows,
           so it has to teach rather than report. It says what a conversation
           is and the one action that starts one. */
        emptyYet={{
          heading: 'No conversations yet',
          body:
            'A conversation is the remark thread on one record — a meeting, an expense, a weekly plan day or a daily summary. ' +
            'Open any of those and leave a remark, and the thread appears here with its unread count, ' +
            'so nobody has to go through records to find out who said what.',
          /* The shared empty state always draws its action, so leaving these
             out left a "Create" button that did nothing — and nothing IS
             created here, a conversation begins on a record. So the action
             goes to the screen where the first remark is written. */
          actionLabel: 'Open Daily Activity',
          onAction: () => router.push('/daily-activity'),
        }}
      />

      <ConversationThreadSheet
        address={openAddress}
        title={openTitle}
        subtitle={openSubtitle}
        onClose={() => {
          router.replace('/conversations', { scroll: false })
          setRefreshKey(k => k + 1)
        }}
      />
    </>
  )
}

/**
 * `useSearchParams` makes this screen depend on the request URL, so Next
 * requires a boundary around it — the same shape the review screen uses.
 */
export default function ConversationsPage() {
  return (
    <Suspense fallback={null}>
      <ConversationsInner />
    </Suspense>
  )
}
