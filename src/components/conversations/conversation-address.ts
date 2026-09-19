/**
 * HOW A CONVERSATION IS ADDRESSED — F32, on the client side.
 *
 * `/api/remarks` takes two different shapes on the wire, and which one it
 * takes is decided by the context type:
 *
 *   ordinary:  ?contextType=meeting&contextId=<uuid>
 *   summary:   ?contextType=daily_summary&userId=<uuid>&date=YYYY-MM-DD
 *
 * A summary's `context_id` is derived and the API refuses it — correctly, it
 * cannot be reversed to find whose summary it is, so accepting one would be an
 * authorisation bypass. `/api/conversations` groups on that derived id, which
 * is why every summary thread on this screen used to open empty.
 *
 * The union below makes the two shapes the only two things a caller can hold,
 * and `addressOf()` is the single place a row turns into one. A row whose
 * owner and period could not be recovered has NO address, and the screen shows
 * it without a way in rather than with one that always fails.
 *
 * ⚠️ The API's casing trap: the GET reads camelCase from the query string and
 * the POST reads snake_case from the body. Both spellings appear below on
 * purpose; neither is a typo.
 */

export const SUMMARY_TYPES = ['daily_summary', 'weekly_summary'] as const

export type SummaryType = (typeof SUMMARY_TYPES)[number]
export type RowType =
  | 'meeting'
  | 'expense'
  | 'weekly_plan'
  | 'weekly_plan_day'
  | 'deal'
  | 'order'

export type ConversationAddress =
  | { kind: 'row'; contextType: RowType; contextId: string }
  | { kind: 'summary'; contextType: SummaryType; userId: string; date: string }

export function isSummaryType(v: string): v is SummaryType {
  return (SUMMARY_TYPES as readonly string[]).includes(v)
}

export type AddressableRow = {
  context_type: string
  context_id: string
  context_user_id: string | null
  context_period: string | null
}

/** `null` when the row cannot be addressed — see the note above. */
export function addressOf(row: AddressableRow): ConversationAddress | null {
  if (isSummaryType(row.context_type)) {
    if (!row.context_user_id || !row.context_period) return null
    return {
      kind: 'summary',
      contextType: row.context_type,
      userId: row.context_user_id,
      date: row.context_period,
    }
  }
  if (!row.context_id) return null
  return {
    kind: 'row',
    contextType: row.context_type as RowType,
    contextId: row.context_id,
  }
}

/** The query string `/api/remarks` GET expects, for either shape. */
export function remarksQuery(address: ConversationAddress): string {
  return address.kind === 'summary'
    ? `contextType=${address.contextType}&userId=${address.userId}&date=${address.date}`
    : `contextType=${address.contextType}&contextId=${address.contextId}`
}

/**
 * The address, encoded into this screen's own URL, so opening a thread is a
 * real navigation: middle-click, open-in-new-tab and the back button all work,
 * and a thread can be linked to.
 */
export function threadHref(address: ConversationAddress): string {
  const p = new URLSearchParams({ thread: address.contextType })
  if (address.kind === 'summary') {
    p.set('user', address.userId)
    p.set('date', address.date)
  } else {
    p.set('id', address.contextId)
  }
  return `/conversations?${p.toString()}`
}

/** The inverse of `threadHref`, for a page load that arrives with one. */
export function addressFromParams(
  params: URLSearchParams
): ConversationAddress | null {
  const type = params.get('thread')
  if (!type) return null
  if (isSummaryType(type)) {
    const userId = params.get('user')
    const date = params.get('date')
    if (!userId || !date) return null
    return { kind: 'summary', contextType: type, userId, date }
  }
  const id = params.get('id')
  if (!id) return null
  return { kind: 'row', contextType: type as RowType, contextId: id }
}
