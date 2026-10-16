'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.6 rules 2 and 4: the top
 * of a record page on phone — full name, status badges, a meta line, and
 * up to four key facts, two wide. Desktop renders nothing (the desktop
 * record header and summary sidebar carry the same information there).
 *
 * Simplified port of the kit's record-summary.tsx: this file carries only
 * RecordSummary and KeyFacts, not RelatedRows/RelatedRow/ActivityList
 * (those need ShellLink, content-area's BLEED/BLOCK and a formatNumber
 * helper this codebase does not have yet) — see the phone-foundation
 * build report.
 */
const MAX_KEY_FACTS = 4

export type KeyFact = { label: string; value: React.ReactNode }

export function KeyFacts({ facts, className }: { facts: KeyFact[]; className?: string }) {
  if (facts.length > MAX_KEY_FACTS) {
    throw new Error(
      `KeyFacts was given ${facts.length} facts. FRONTEND_RULES_PHONE.md §41.1 rule 6 allows four key facts on a record.`
    )
  }
  const { layout } = useLayout()
  if (layout !== 'phone' || facts.length === 0) return null

  return (
    <dl className={cn('grid grid-cols-2 gap-4', className)}>
      {facts.map(fact => {
        const empty = fact.value === null || fact.value === undefined || fact.value === ''
        return (
          <div key={fact.label} className="flex min-w-0 flex-col gap-1">
            <dt className="text-label text-text-secondary">{fact.label}</dt>
            <dd className={cn('text-body font-medium', empty ? 'text-text-secondary' : 'text-text-primary')}>
              {empty ? 'Not set' : fact.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export function RecordSummary({
  name,
  badges,
  meta,
  facts,
  className,
}: {
  name: string
  badges?: React.ReactNode
  meta?: React.ReactNode
  facts?: KeyFact[]
  className?: string
}) {
  const { layout } = useLayout()
  if (layout !== 'phone') return null

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <p className="text-card-heading font-medium break-words text-text-primary">{name}</p>
      {badges ? <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div> : null}
      {meta ? <p className="mt-2 text-meta break-words text-text-muted">{meta}</p> : null}
      {facts && facts.length > 0 ? <KeyFacts facts={facts} className="mt-4" /> : null}
    </div>
  )
}

export { MAX_KEY_FACTS }
