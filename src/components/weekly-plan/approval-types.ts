import type { ItemsDiff } from '@/lib/weekly-plan-diff'

/** One row of `GET /api/weekly-plans/approval`. */
export type QueueRow = {
  id: string
  user_id: string
  week_start_date: string
  week_end_date: string
  status: string
  submitted_at: string | null
  last_status_changed_at: string | null
  manager_comment: string | null
  reopen_requested: boolean
  reopen_request_message: string | null
  owner: { id: string; name: string; contact: string } | null
  item_count: number
}

export type QueueResponse = {
  rows: QueueRow[]
  counts: { awaiting: number; in_progress: number; decided: number }
  scope: 'own' | 'team' | 'all'
  /**
   * Whether this caller holds `weekly_plan` EDIT. Computed by the server from
   * `role_permissions`, never inferred from a role name on the client — the
   * four decision verbs all gate on exactly this, so a screen that guessed
   * would show buttons that 403.
   */
  canDecide: boolean
}

/** One line of a plan, as `GET /api/weekly-plans/[id]` returns it. */
export type PlanItem = {
  id: string
  plan_date: string
  party_id: string | null
  party_type: string | null
  party_label: string | null
  new_dealers_goal: number | null
  existing_dealers_goal: number | null
  others_goal: number | null
  expected_order_value: number | null
  notes: string | null
  from_place: string | null
  to_place: string | null
  mode_of_travel: string | null
}

export type PlanLog = {
  id: string
  action_type: string
  actor_role: string
  timestamp: string
  previous_status: string | null
  new_status: string | null
  comment: string | null
  users?: { name: string } | null
  /** Parsed by the API. Null for every action that recorded no before/after. */
  changes: ItemsDiff | null
}

export type PlanDetail = {
  id: string
  user_id: string
  week_start_date: string
  week_end_date: string
  status: string
  submitted_at: string | null
  manager_comment: string | null
  reopen_requested: boolean
  reopen_request_message: string | null
  day_notes: Record<string, string> | null
  owner: { id: string; name: string; contact: string } | null
  weekly_plan_items: PlanItem[]
  weekly_goals: { id: string; text: string; is_done: boolean; sort_order: number }[]
  logs: PlanLog[]
}

/**
 * The four decisions §5.2 gives a manager, plus the edit.
 *
 * ⚠️ The casing of every string here is load-bearing and is NOT derivable from
 * the database: `suggest` writes the audit action 'Suggest' while moving the
 * plan to the STATUS 'On Hold', and the edit writes the action 'EditByManager'
 * against the status 'Edited by Manager'. The path segments below are the
 * routes' own spelling.
 */
export const DECISIONS = {
  approve: {
    path: 'approve',
    label: 'Approve',
    /** Reject and Suggest 400 without one; the API is the authority, not this. */
    commentRequired: false,
    resultStatus: 'Approved',
  },
  reject: {
    path: 'reject',
    label: 'Reject',
    commentRequired: true,
    resultStatus: 'Rejected',
  },
  hold: {
    path: 'hold',
    label: 'Hold',
    commentRequired: false,
    resultStatus: 'On Hold',
  },
  suggest: {
    path: 'suggest',
    label: 'Suggest changes',
    commentRequired: true,
    resultStatus: 'On Hold',
  },
} as const

export type DecisionKey = keyof typeof DECISIONS
