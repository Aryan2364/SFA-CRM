'use client'

import { useEffect } from 'react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { RemarkThread } from '@/components/remark-thread'
import {
  remarksQuery,
  type ConversationAddress,
} from './conversation-address'

/**
 * The thread a Conversations row opens.
 *
 * ---------------------------------------------------------------------------
 * WHY `RemarkThread` AND NOT `RemarksPanel`
 *
 * `RemarkThread` is the one panel that already speaks BOTH addressing shapes —
 * a row id, and a (person, period) pair for a summary — and it already knows
 * §6.5's one-comment-one-reply limits, so it draws a composer only where the
 * API would accept a post. `RemarksPanel` takes a `contextId` and nothing
 * else, which is precisely the shape that cannot open a summary. Using it here
 * is what made every summary conversation open empty.
 *
 * ---------------------------------------------------------------------------
 * MARKING READ
 *
 * The Unread column and the read filter are the reason this screen exists
 * rather than being a view of the remark table, and they are driven by
 * `remark_reads`. `RemarkThread` does not write that table — it is used on
 * screens where a thread is incidental — so opening a conversation marks its
 * remarks read HERE, from the same GET the panel makes. That is one extra
 * request per open, and it is the cost of not reaching into a shared component
 * this screen does not own.
 */
export function ConversationThreadSheet({
  address,
  title,
  subtitle,
  onClose,
}: {
  address: ConversationAddress | null
  title: string
  subtitle: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!address) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/remarks?${remarksQuery(address)}`)
        if (!r.ok || cancelled) return
        const rows: { id: string; is_read: boolean }[] = await r.json()
        if (cancelled || !Array.isArray(rows)) return
        await Promise.all(
          rows
            .filter(row => !row.is_read)
            .map(row =>
              fetch(`/api/remarks/${row.id}/read`, { method: 'POST' }).catch(
                () => {}
              )
            )
        )
      } catch {
        /* Read tracking is a convenience. A failure here must not break the
           thread the person came to read, and it self-corrects next open. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <Sheet open={!!address} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {subtitle && <SheetDescription>{subtitle}</SheetDescription>}
        </SheetHeader>
        <div className="px-4 pb-6">
          {address?.kind === 'summary' ? (
            <RemarkThread
              contextType={address.contextType}
              userId={address.userId}
              date={address.date}
              title="Comment"
            />
          ) : address ? (
            <RemarkThread
              /* `RemarkThread`'s row union predates the `order` context type
                 that `api/remarks/_context.ts` now carries. Widening a shared
                 component is not this screen's change to make, so the cast is
                 here, named, and provably safe: the API accepts `order` and
                 the panel only ever passes the value through. */
              contextType={
                address.contextType as Exclude<
                  typeof address.contextType,
                  'order'
                >
              }
              contextId={address.contextId}
              title="Remarks"
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
