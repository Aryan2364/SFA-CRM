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
  /**
   * Whether the caller may act on this plan — the server's `canReview`, the
   * rule every manager verb enforces. The status gate is separate.
   */
  canReview: boolean
  /**
   * The version the plan was read at. Every decision and edit sends it back
   * as `expected_version`, so one made from a screen the plan has since moved
   * past is refused with a 409 instead of deciding on content never shown.
   */
  version: string | null
}

/**
 * The statuses a manager's verb may start from — the ONE copy of the rule. The
 * decision routes enforce it (as a conditional write, inside their transaction)
 * and the review panel disables exactly the buttons it refuses, so the screen
 * never offers a decision the server will 409.
 *
 *  - Submitted / Resubmitted: the plan is waiting on the manager.
 *  - On Hold: "I'm thinking about it" — the manager must still be able to
 *    finish the decision later, so every verb except Hold itself leaves it.
 *  - Edited by Manager: approve, reject and edit again — so a manager can fix
 *    a line with "Edit plan" and then approve it, as they always could.
 *    Hold and Suggest stay refused there: the plan is already with its owner
 *    for changes, and parking it or sending it back again says nothing new.
 *    ⚠️ Suggest ALSO lands on Edited by Manager, so this lets a manager
 *    approve a plan they sent back without waiting for the owner's
 *    resubmission. That is deliberate: the manager is the decider, and
 *    approving is them withdrawing their own request. It cannot race the
 *    owner, nor approve a revision the manager never saw: the owner's PUT /
 *    submit and every manager verb claim the status AND the version their
 *    screen was showing (`claimStatus`), so of an owner edit and a manager
 *    decision on the same Edited by Manager plan exactly one commits, and a
 *    decision from a screen loaded before the owner's save 409s.
 *  - Draft, Approved and Rejected are refused: a Draft was never submitted,
 *    and the two decided states are final until the owner asks to reopen.
 *
 * ⚠️ Every string is one of the seven values `weekly_plans.status`'s CHECK
 * constraint permits. Never add one here.
 */
const PENDING = ['Submitted', 'Resubmitted'] as const
const DECIDABLE = [...PENDING, 'On Hold'] as const
/** Approve / reject / edit: also from Edited by Manager — see above. */
const FINISHABLE = [...DECIDABLE, 'Edited by Manager'] as const

/** `edit-by-manager` — the fifth manager verb, not a decision. */
export const EDIT_ALLOWED_FROM: readonly string[] = FINISHABLE

/**
 * Why a manager may not act on this plan at all — `canReview` is false. The
 * only way a caller reaches a plan they can read but not review is a
 * `weekly_plan` scope of Self (Access Control limits them to their own plans);
 * an Administrator and a Team/Company-scope manager in the chain both pass.
 */
export const NOT_REVIEWER_REASON =
  'Your access is limited to your own plans. Ask an administrator to change it in Access Control.'

/**
 * Why a manager verb is refused from `status`, in the owner-facing words the
 * 409 carries and the disabled button's tooltip repeats.
 */
export function notActionableReason(status: string): string {
  switch (status) {
    case 'Draft': return 'This plan has not been submitted yet'
    case 'Approved': return 'This plan has already been approved'
    case 'Rejected': return 'This plan has already been rejected and is back with its owner'
    case 'On Hold': return 'This plan is already on hold'
    // Only Hold and Suggest are refused from here (approve, reject and edit
    // are allowed), so the reason names what those two would repeat.
    case 'Edited by Manager': return 'This plan is already back with its owner for changes'
    default: return 'This plan cannot be changed from its current status'
  }
}

/**
 * The four decisions §5.2 gives a manager, plus the edit.
 *
 * ⚠️ The casing of every string here is load-bearing and is NOT derivable from
 * the database: `suggest` writes the audit action 'Suggest' while moving the
 * plan to the STATUS 'Edited by Manager', and the edit writes the action
 * 'EditByManager' against the same status. The path segments below are the
 * routes' own spelling.
 *
 * `suggest` used to land on 'On Hold' — the one returned-to-manager status the
 * owner CANNOT edit — so the owner was told "make these changes" and given no
 * Save and no Submit. It now returns the plan editable, in the status that
 * already means "your manager sent this back with changes": the owner edits,
 * resubmits (→ 'Resubmitted'), and the manager's queue keeps it under In
 * progress meanwhile, exactly like an edit.
 */
export const DECISIONS = {
  approve: {
    path: 'approve',
    label: 'Approve',
    /** Reject and Suggest 400 without one; the API is the authority, not this. */
    commentRequired: false,
    resultStatus: 'Approved',
    /** The dialog's one line of consequence, and the toast after it lands. */
    outcome: 'It moves to Approved.',
    done: 'Plan approved',
    allowedFrom: FINISHABLE as readonly string[],
  },
  reject: {
    path: 'reject',
    label: 'Reject',
    commentRequired: true,
    resultStatus: 'Rejected',
    outcome: 'It moves to Rejected, and the owner revises and resubmits it.',
    done: 'Plan rejected',
    allowedFrom: FINISHABLE as readonly string[],
  },
  hold: {
    path: 'hold',
    label: 'Hold',
    commentRequired: false,
    resultStatus: 'On Hold',
    outcome: 'It moves to On Hold. You can decide on it later.',
    done: 'Plan put on hold',
    allowedFrom: PENDING as readonly string[],
  },
  suggest: {
    path: 'suggest',
    label: 'Suggest changes',
    commentRequired: true,
    resultStatus: 'Edited by Manager',
    outcome: 'It goes back to the owner to edit and resubmit, with your note.',
    done: 'Changes suggested — the plan is back with its owner',
    allowedFrom: DECIDABLE as readonly string[],
  },
} as const

export type DecisionKey = keyof typeof DECISIONS

/**
 * Why the four decisions, the edit and the reopen answers are unavailable to
 * someone who may not edit weekly plans (`weekly_plan` EDIT, which every one of
 * those routes checks first). Names the permission, never a role.
 */
export const NO_DECIDE_REASON = 'Only someone who can edit weekly plans can decide on one.'
