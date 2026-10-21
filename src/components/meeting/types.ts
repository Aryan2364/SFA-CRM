/**
 * Inside a Meeting (P3-T9, §5.5) — the wire shapes.
 *
 * Read off `src/app/api/daily-activity/[id]/route.ts`. Every money field here
 * is a NUMBER because that route runs `serialize()`: a Prisma `Decimal` becomes
 * a STRING through `JSON.stringify`, and a string that looks like a number adds
 * as `"430" + "780" = "430780"` without anything throwing.
 *
 * These live beside the meeting components rather than in
 * `components/daily-activity/types.ts`: that file is the day screen's
 * vocabulary and is owned by other tasks. Only `Visit` is shared, and it is
 * imported from there rather than copied, so the two cannot drift.
 */

export type NamedRef = { id: string; name: string }

export type MeetingCompany = {
  id: string
  name: string
  type: string | null
  stage: string | null
  mobile_1: string | null
  /** §3.5. An incomplete party's orders cannot leave Draft. */
  is_complete: boolean
  completeness_missing: string | null
  /**
   * False only for someone an opportunity of this account was shared with
   * directly, who may not open the account itself (src/lib/sharing.ts). Absent
   * from an older response; only `false` drops the link.
   */
  can_open?: boolean
}

export type MeetingDeal = {
  id: string
  name: string
  expected_value: number
  probability: number
  expected_close_date: string | null
  stage_entered_at: string
  deal_stage_id: string | null
  deal_stages: (NamedRef & { sort_order: number }) | null
  users: NamedRef | null
}

export type MeetingOrder = {
  id: string
  order_date: string
  status: 'Draft' | 'Placed'
  entity_name: string | null
  total_amount: number
  gross_amount: number
  has_discount: boolean
  /** §3.5's reason, written onto the record rather than only returned. */
  blocked_reason: string | null
  visit_id: string | null
  order_source: string
  users: NamedRef | null
  item_count: number
}

export type VisitOrderLine = {
  id: string
  product_id: string | null
  product_name: string
  qty: number
  rate: number
  amount: number
}

export type VisitOrder = {
  id: string
  status: 'Draft' | 'Placed'
  total_amount: number
  order_items: VisitOrderLine[]
}

/**
 * Everything the screen renders, in one payload.
 *
 * `deals_visible` / `orders_visible` are NOT the same as an empty list, and the
 * screen must not collapse them into one. "This party has no open deals" and
 * "deals are not yours to read" are different facts, and showing the first when
 * the second is true tells somebody their pipeline is empty when it is not.
 */
export type MeetingContext = {
  visit: MeetingVisit
  /**
   * False only when the meeting was reached through sharing rather than the
   * caller's own `meetings` scope (`src/lib/sharing.ts`, Aryan 2026-10-13):
   * the page shows every write control disabled with a reason instead of
   * hiding them, since the holder's name and the record itself are still
   * visible. Every write route re-checks its own scope regardless.
   */
  can_write: boolean
  company: MeetingCompany | null
  discussed_deal_ids: string[]
  deals_visible: boolean
  deals: MeetingDeal[]
  open_deal_count: number
  orders_visible: boolean
  recent_orders: MeetingOrder[]
  order_count: number
  draft_orders: MeetingOrder[]
  visit_order: VisitOrder | null
}

export type MeetingVisit = {
  id: string
  user_id: string
  visit_date: string
  visit_type: string
  entity_id: string | null
  entity_name: string
  status: 'Pending' | 'Active' | 'Completed'
  start_time: string | null
  end_time: string | null
  duration_secs: number | null
  address: string | null
  end_address: string | null
  /** Metres, as the phone reported it at Start / Stop; null until the accuracy columns exist. */
  accuracy_m?: number | null
  end_accuracy_m?: number | null
  notes: string | null
  is_manual_entry: boolean
  location_flagged: boolean
  users: NamedRef | null
}

export type Remark = {
  id: string
  context_type: string
  context_id: string
  body: string
  created_at: string
  updated_at?: string
  author_user_id: string
  edited?: boolean
  can_edit?: boolean
  can_delete?: boolean
  users: NamedRef | null
}

export type Product = { id: string; name: string; price: number }

/**
 * Where a note written on this screen is filed.
 *
 * §5.5 asks for Minutes of the Meeting AND for a note that can be "linked to a
 * specific Deal or Order". Those are one control, not two: the note is always
 * written the same way and the target decides which thread it joins. `meeting`
 * is the default because minutes are the common case and a note nobody
 * retargets belongs to the meeting.
 */
export type NoteTarget =
  | { kind: 'meeting'; id: string; label: string }
  | { kind: 'deal'; id: string; label: string }
  | { kind: 'order'; id: string; label: string }

/** The remark `context_type` each target writes to. */
export const NOTE_CONTEXT: Record<NoteTarget['kind'], string> = {
  meeting: 'meeting',
  deal: 'deal',
  order: 'order',
}
