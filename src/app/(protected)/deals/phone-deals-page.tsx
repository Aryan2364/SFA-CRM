'use client'

/**
 * Opportunities — phone list (docs/phone-plan.md item 6, FRONTEND_RULES_PHONE
 * §41.5 rules 20-22: "board becomes a list of one status at a time").
 *
 * One stage at a time via filter chips, counts from the same `/api/deals`
 * read every stage already needs — no second request per chip. Closed
 * stages (per `stage_type`, src/lib/deal-stage-type.ts) are grouped under a
 * single "Closed" chip rather than one chip per terminal stage, since the
 * kit calls for "open stages, closed ones one tap away" (docs/phone-plan.md).
 *
 * This file is imported ONLY by `page.tsx`'s phone branch; it renders
 * nothing itself if mounted outside a phone layout (PhoneList / PhoneListRow
 * already no-op on desktop, which is belt-and-suspenders here).
 */

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneList, PhoneListRow } from '@/components/ui/phone-list'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { EMPTY, fmtAmount, fmtDate, parseApiDate } from '@/lib/format'

type DealRow = {
  id: string
  name: string
  expected_value: number
  expected_close_date: string | null
  company: { id: string; name: string } | null
  contact: { id: string; name: string } | null
  stage: { id: string; name: string } | null
  outcome: string | null
  next_follow_up: { id: string; due_date: string | null } | null
}

type Stage = { id: string; name: string; sort_order: number; stage_type: 'Open' | 'Closed' | null }

const REQUEST_TIMEOUT_MS = 15000

async function fetchWithDeadline(url: string): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function isOverdue(dueDate: string | null | undefined): boolean {
  const due = parseApiDate(dueDate ?? null)
  if (!due) return false
  return due.getTime() < startOfToday().getTime()
}

/** `useSearchParams` suspends; the boundary keeps the phone branch of
 *  deals/page.tsx (rendered outside its desktop Suspense) buildable. */
export function PhoneDealsPage() {
  return (
    <Suspense fallback={null}>
      <PhoneDealsList />
    </Suspense>
  )
}

function PhoneDealsList() {
  const router = useRouter()
  const { toast } = useToast()
  const me = useMe()
  // Arriving from an account's "Opportunities" row. Narrowed server-side by
  // GET /api/deals?companyId= (scope and sharing still apply); the name is
  // looked up for the chip's label only.
  const accountId = useSearchParams().get('account') ?? ''
  const [accountName, setAccountName] = useState('')
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [rows, setRows] = useState<DealRow[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<string | null>(null) // null = all open, stage id, or 'closed'

  usePhoneAppBar({ title: 'Opportunities' })

  // Matches POST /api/deals (deals:create). Undefined until /me answers.
  const canCreate = me ? Boolean(me.permissions?.deals?.create) : undefined

  useEffect(() => {
    setAccountName('')
    if (!accountId) return
    let live = true
    fetch(`/api/companies/${accountId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d?.name) setAccountName(d.name) })
      .catch(() => { /* the chip falls back to "this account" */ })
    return () => { live = false }
  }, [accountId])

  async function load() {
    setState('loading')
    try {
      const dealsUrl = accountId ? `/api/deals?companyId=${encodeURIComponent(accountId)}` : '/api/deals'
      const [dealsRes, stagesRes] = await Promise.all([
        fetchWithDeadline(dealsUrl),
        fetchWithDeadline('/api/deals/stages'),
      ])
      if (!dealsRes.ok || !stagesRes.ok) throw new Error('failed')
      const deals = (await dealsRes.json()) as DealRow[]
      const stageRows = (await stagesRes.json()) as Stage[]
      setRows(Array.isArray(deals) ? deals : [])
      setStages(Array.isArray(stageRows) ? stageRows : [])
      setState('ready')
    } catch {
      setState('failed')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const openStages = useMemo(() => stages.filter(s => s.stage_type !== 'Closed'), [stages])

  // Closed means the admin marked the stage Closed, OR the deal itself
  // carries a won/lost outcome — a deal can be closed before the
  // `stage_type` column exists at all (readStageTypes degrades to null).
  function isClosed(row: DealRow): boolean {
    if (row.outcome) return true
    const stage = stages.find(s => s.id === row.stage?.id)
    return stage?.stage_type === 'Closed'
  }

  const filtered = useMemo(() => {
    let base = rows
    if (chip === null) base = rows.filter(r => !isClosed(r))
    else if (chip === 'closed') base = rows.filter(isClosed)
    else base = rows.filter(r => r.stage?.id === chip && !isClosed(r))

    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        (r.company?.name ?? r.contact?.name ?? '').toLowerCase().includes(q)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chip, search, stages])

  const closedCount = rows.filter(isClosed).length
  const openCount = rows.length - closedCount

  function renderRow(deal: DealRow) {
    const due = deal.next_follow_up?.due_date ?? null
    const facts = [deal.company?.name ?? deal.contact?.name ?? EMPTY]
    if (deal.stage?.name) facts.push(deal.stage.name)
    return (
      <PhoneListRow
        href={`/deals/${deal.id}`}
        name={deal.name}
        facts={facts}
        amount={fmtAmount(deal.expected_value)}
        meta={
          due
            ? `${isOverdue(due) ? 'Overdue' : 'Next'} ${fmtDate(due)}`
            : deal.expected_close_date
              ? `Expected ${fmtDate(deal.expected_close_date)}`
              : undefined
        }
      />
    )
  }

  return (
    <PhoneList
      state={state}
      onRetry={load}
      onRefresh={load}
      noun={{ one: 'opportunity', many: 'opportunities' }}
      rows={filtered}
      total={filtered.length}
      rowKey={r => r.id}
      renderRow={renderRow}
      search={{ value: search, onChange: setSearch }}
      listKey={accountId ? `deals:account:${accountId}` : undefined}
      activeFilters={
        accountId
          ? [
              {
                key: 'account',
                label: `For ${accountName || 'this account'}`,
                clearLabel: 'Show all opportunities',
                onClear: () => router.replace('/deals'),
              },
            ]
          : undefined
      }
      filters={{
        label: 'Stage',
        value: chip,
        onChange: setChip,
        allLabel: 'Open',
        allCount: openCount,
        chips: [
          ...openStages.map(s => ({
            value: s.id,
            label: s.name,
            count: rows.filter(r => r.stage?.id === s.id && !isClosed(r)).length,
          })),
          { value: 'closed', label: 'Closed', count: closedCount },
        ],
      }}
      empty={
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">
            {accountId ? 'No opportunities for this account yet' : 'No opportunities yet'}
          </p>
          <p className="text-body text-text-muted">Create one to start tracking it.</p>
        </div>
      }
      add={{
        label: 'Create opportunity',
        href: accountId ? `/deals/new?account=${encodeURIComponent(accountId)}` : '/deals/new',
        allowed: canCreate,
        reason: 'Only someone who can create opportunities can add one',
      }}
    />
  )
}
