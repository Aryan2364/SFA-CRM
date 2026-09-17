import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  FilePenIcon,
  FileTextIcon,
  FlameIcon,
  MessageSquareIcon,
  PhoneIcon,
  PauseIcon,
  SendHorizontalIcon,
  SendIcon,
  SnowflakeIcon,
  TargetIcon,
  ThermometerIcon,
  ThumbsUpIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserPenIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/**
 * THE STATUS VOCABULARY. One map, read by every screen, so that the
 * same word is never given two colours in two places.
 *
 * ---------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * Section 2.4 fixes three status colours and names the words each one
 * carries: success for Paid, Approved, Active, Completed; warning for
 * Pending, Due soon, Needs review; danger for Overdue, Failed,
 * Rejected, Delete. Section 11.1 adds that status is ALWAYS a badge and
 * never plain coloured text, and section 7.2 rule 1 that every one of
 * them carries an icon as well as a colour, because colour alone is
 * invisible to colour-blind users.
 *
 * What section 2.4 cannot do is enumerate every product's words. This
 * product says "Submitted", which is in none of its three lists, so the
 * colour is a JUDGEMENT — and a judgement made twice is made
 * differently. Each entry below therefore records not just the role but
 * whether it is a direct match on section 2.4's fourth column or a
 * mapping by meaning, so the next screen can tell what it is inheriting.
 *
 * ---------------------------------------------------------------------
 * WHY IT IS NOT IN components/ui
 *
 * `components/ui` is the kit's namespace and these words are this
 * product's. `Badge` already does the rendering; what is added here is
 * the vocabulary, which is exactly the part that must not travel back
 * into the kit.
 *
 * Section 4.1's inventory table therefore gains no row. If this file
 * ever moves into the kit, it needs one — the report says so.
 *
 * ---------------------------------------------------------------------
 * ADDING A WORD
 *
 * Add it here, never at the call site. Give it the section 2.4 role its
 * MEANING has, not the one its colour looked nice as, and say which
 * kind of match it is. A word with no honest role is a neutral, not a
 * guess.
 */

/** Which of section 2.4's three roles, or the neutral default. */
export type StatusRole = 'neutral' | 'success' | 'warning' | 'danger'

export type StatusSpec = {
  /** What the badge reads. */
  label: string
  role: StatusRole
  Icon: LucideIcon
  /**
   * `column` — the word appears verbatim in section 2.4's fourth
   *            column, so the role is not a judgement at all.
   * `meaning` — the word does not appear there and the role comes from
   *            what it means. Stated so it can be argued with.
   */
  match: 'column' | 'meaning'
  /** Why, in one line. Read this before reusing the entry elsewhere. */
  reason: string
}

/**
 * ORDERS — `orders.status`, a CHECK-constrained set of three.
 *
 * Draft and Submitted are both absent from section 2.4's fourth column;
 * Confirmed is a near-synonym of its "Completed" but is not the same
 * word, so it is recorded as a mapping too.
 */
export const ORDER_STATUS: Record<string, StatusSpec> = {
  Draft: {
    label: 'Draft',
    role: 'neutral',
    Icon: FilePenIcon,
    match: 'meaning',
    reason:
      'Nothing has happened yet and nothing is owed. Section 7.3 keeps a row neutral until something is genuinely a success or a failure, and a draft is neither.',
  },
  Submitted: {
    label: 'Submitted',
    role: 'warning',
    Icon: SendIcon,
    match: 'meaning',
    reason:
      'Sent and awaiting confirmation, which is section 2.4 warning’s "Pending" and "Needs review". It was primary-subtle before, and section 2.4 is explicit that status never carries the brand.',
  },
  Confirmed: {
    label: 'Confirmed',
    role: 'success',
    Icon: CheckIcon,
    match: 'meaning',
    reason:
      'The end of the road for an order, which is section 2.4 success’s "Completed" under another name. Section 23.1 already maps Confirm to `check`.',
  },
}

/**
 * LEADS — `business_partners.stage`, the six pipeline positions the
 * leads screen carries, and `business_partners.temperature`, three.
 *
 * ---------------------------------------------------------------------
 * WHY EVERY ONE OF THE NINE IS NEUTRAL
 *
 * Section 2.4's three roles all describe an OUTCOME: success is settled
 * and fine, warning is owed or waiting on somebody, danger has gone
 * wrong. A pipeline position is not an outcome — it is where a lead has
 * got to, and nothing about "Negotiation" is a success, a warning or a
 * failure. Neither is a buying temperature: "Hot" is the best thing on
 * the list and section 2.4's only warm colours are the two that mean
 * trouble, so colouring it by its own word would invert its meaning.
 *
 * The rule at the top of this file is that a word with no honest role
 * is a neutral rather than a guess, and applying it honestly nine times
 * leaves nine neutrals.
 *
 * **And section 2.4 does not merely permit that, it prescribes it.** Its
 * closing line reads: "There is deliberately no blue 'information'
 * colour. Neutral grey is used for informational content instead." A
 * pipeline position and a buying temperature ARE informational content —
 * they tell you where something has got to, not that anything has
 * succeeded or failed. So neutral here is not a judgement that survived
 * scrutiny; it is the treatment the section names for exactly this kind
 * of value. Do not reopen these nine on the grounds that they look flat.
 *
 * **What replaces the colour is the icon.** Section 7.2 rule 1 already
 * requires one on every badge, so each of the nine gets a DISTINCT icon
 * and the value is still tellable at a glance without reading. What is
 * missing is an ordinal COLOUR scale to rank them with: the ordering
 * itself is not lost — `lead_stages.sort_order` is a column on the row,
 * so the product knows the sequence — the kit simply has nothing to
 * render a sequence in. Section 2.4 has no information blue, and the
 * only non-status palette is section 21's, which belongs to charts and
 * whose whole rule is that a caller never names a colour. Any future
 * ordinal treatment therefore already has its data source.
 *
 * ---------------------------------------------------------------------
 * KNOWN LIMITATION — these nine keys are not a closed set
 *
 * Unlike `orders.status`, which is CHECK-constrained to three,
 * `lead_stages` and `lead_temperatures` are tenant-scoped MASTER TABLES
 * with a free-text `name` and their own CRUD screens under `/masters/`.
 * A tenant who renames "Qualified" matches none of the keys below and
 * falls through to `UNKNOWN_STATUS`. That is not hypothetical:
 * `business_partners.stage` is `String @default("Existing")`, and
 * "Existing" is in none of the six stage names here, so the column
 * DEFAULT already misses.
 *
 * It matters because of the ruling above. With colour deliberately
 * uniform, the icon is the only thing carrying the distinction — and the
 * icon is precisely what degrades when a tenant edits the master.
 *
 * **This is inherited, not introduced.** The code replaced here keyed by
 * name with the same neutral fall-through
 * (`STAGE_COLORS[v] ?? 'bg-surface-control text-text-secondary'`), so a
 * renamed stage rendered a plain grey chip before and renders a grey
 * badge with a real label now. Behaviour is preserved.
 *
 * Do NOT fix it here: every remedy touches either this file's keying
 * mechanism or the master tables themselves, which is the author's call.
 * Options are logged in `overnight-queue-2026-09-18.md`.
 */
export const LEAD_STAGE: Record<string, StatusSpec> = {
  Prospect: {
    label: 'Prospect',
    role: 'neutral',
    Icon: CircleDashedIcon,
    match: 'meaning',
    reason:
      'The first position: identified and nothing more. Nothing has happened and nothing is owed, which is section 7.3’s neutral.',
  },
  Contacted: {
    label: 'Contacted',
    role: 'neutral',
    Icon: PhoneIcon,
    match: 'meaning',
    reason:
      'An activity that has happened, not an outcome of it. Section 2.4 has no role for "something was done and we are waiting to see".',
  },
  Interested: {
    label: 'Interested',
    role: 'neutral',
    Icon: ThumbsUpIcon,
    match: 'meaning',
    reason:
      'A sentiment expressed by the other side. Encouraging, but nothing is settled, so it is not section 2.4’s success.',
  },
  Qualified: {
    label: 'Qualified',
    role: 'neutral',
    Icon: TargetIcon,
    match: 'meaning',
    reason:
      'The closest of the six to section 2.4 success’s "Approved" — a positive determination that the lead meets the bar. Left neutral all the same: it is a gate passed mid-pipeline, not a settled outcome, and colouring one middle stage green would read as the end of the road while Proposal and Negotiation, which come after it, stayed grey.',
  },
  Proposal: {
    label: 'Proposal',
    role: 'neutral',
    Icon: FileTextIcon,
    match: 'meaning',
    reason:
      'A document is out and the answer is not back. Nearer section 2.4 warning’s "Pending" than anything else, but every open lead is pending by that test, and five amber stages out of six is not a distinction.',
  },
  Negotiation: {
    label: 'Negotiation',
    role: 'neutral',
    Icon: MessageSquareIcon,
    match: 'meaning',
    reason:
      'The last position before the lead stops being one. Still an open conversation, so still no outcome.',
  },
}

/**
 * Buying temperature. An ordinal scale where the GOOD end is the hot
 * one, which is the opposite way round from every colour section 2.4
 * offers — see the block above.
 */
export const LEAD_TEMPERATURE: Record<string, StatusSpec> = {
  Cold: {
    label: 'Cold',
    role: 'neutral',
    Icon: SnowflakeIcon,
    match: 'meaning',
    reason:
      'Low intent. Not a failure — nothing has been lost, the lead simply is not ready — so not section 2.4’s danger.',
  },
  Warm: {
    label: 'Warm',
    role: 'neutral',
    Icon: ThermometerIcon,
    match: 'meaning',
    reason:
      'The middle of the scale. Section 2.4 warning is "Pending, Due soon, Needs review"; a warm lead is none of those, and the shared word is a pun rather than a meaning.',
  },
  Hot: {
    label: 'Hot',
    role: 'neutral',
    Icon: FlameIcon,
    match: 'meaning',
    reason:
      'The best value on the scale. Section 2.4’s warm colours both mean trouble, so giving Hot one would state the opposite of what it means — the inversion is the reason this whole scale stays neutral.',
  },
}

/**
 * The fallback for a word this file has never been told about. Neutral
 * rather than a guessed colour: an unknown status that renders green
 * is worse than one that renders grey, because only one of the two
 * looks like a decision.
 */
export const UNKNOWN_STATUS: StatusSpec = {
  label: 'Unknown',
  role: 'neutral',
  Icon: CircleSlashIcon,
  match: 'meaning',
  reason: 'Not in the vocabulary. Add it here rather than at the call site.',
}

export function statusSpec(
  vocabulary: Record<string, StatusSpec>,
  status: string | null | undefined
): StatusSpec {
  if (!status) return UNKNOWN_STATUS
  return vocabulary[status] ?? { ...UNKNOWN_STATUS, label: status }
}

/**
 * Section 11.1: status is always a badge. Section 7.2 rule 1: with an
 * icon as well as a colour, every time — which is why the icon is not
 * a prop.
 */
export function StatusBadge({
  vocabulary,
  status,
}: {
  vocabulary: Record<string, StatusSpec>
  status: string | null | undefined
}) {
  const spec = statusSpec(vocabulary, status)
  return (
    <Badge variant={spec.role}>
      <spec.Icon />
      {spec.label}
    </Badge>
  )
}

/**
 * USERS — `users.status`, the two values the user administration screen
 * writes: an account is Active or it has been deactivated.
 *
 * Deactivation is not a failure. Section 15.2 makes it the NORMAL, safe
 * alternative to deleting a record anything points at — the action the
 * interface leads with, taken on purpose and reversed on purpose — so
 * the danger colour the old badge used said something the word does not
 * mean. Section 2.4's danger is "Overdue, Failed, Rejected, Delete",
 * and a deactivated account is none of those.
 */
export const USER_STATUS: Record<string, StatusSpec> = {
  Active: {
    label: 'Active',
    role: 'success',
    Icon: UserCheckIcon,
    match: 'column',
    reason:
      'The word appears verbatim in section 2.4’s fourth column, so the role is not a judgement at all: success.',
  },
  Inactive: {
    label: 'Inactive',
    role: 'neutral',
    Icon: UserMinusIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column. It was red before, but section 15.2 makes deactivation the safe, deliberate alternative to deletion rather than a failure, so danger would misstate it — and this file’s own rule is that a word with no honest role is a neutral, not a guess. The icon carries the distinction instead.',
  },
}

/**
 * WEEKLY PLANS — `weekly_plans.status`, a CHECK-constrained set of
 * SEVEN (`weekly_plans_status_check`): Draft, Submitted, Approved,
 * Rejected, On Hold, Edited by Manager, Resubmitted. Taken from the
 * constraint and the routes under `/api/weekly-plans/`, never from the
 * data — three of the seven are legal and reachable and have never yet
 * occurred, so the live table would under-report the vocabulary.
 *
 * Two of the seven — Approved and Rejected — appear verbatim in
 * section 2.4's fourth column, so their roles are not judgements. The
 * other five are mappings, and three of those come out neutral: the
 * plan workflow has seven states and section 2.4 has three roles, so
 * there is no honest colour left for a state that is merely somewhere
 * in the middle of the loop. The icon carries them instead (section
 * 7.2 rule 1 requires one anyway), and each is distinct.
 */
export const WEEKLY_PLAN_STATUS: Record<string, StatusSpec> = {
  Draft: {
    label: 'Draft',
    role: 'neutral',
    Icon: FilePenIcon,
    match: 'meaning',
    reason:
      'Not started in earnest: nothing has been sent and nothing is owed by anyone else. The same word and the same reading as ORDER_STATUS.Draft, kept deliberately identical so one word never has two colours.',
  },
  Submitted: {
    label: 'Submitted',
    role: 'warning',
    Icon: SendIcon,
    match: 'meaning',
    reason:
      'Sent and awaiting a manager’s decision, which is section 2.4 warning’s "Pending" and "Needs review". Identical to ORDER_STATUS.Submitted rather than a second answer to the same question.',
  },
  Resubmitted: {
    label: 'Resubmitted',
    role: 'warning',
    Icon: SendHorizontalIcon,
    match: 'meaning',
    reason:
      'The same act as Submitted, repeated after a rejection or a manager edit — it is waiting on exactly the same person for exactly the same decision, so it takes the same role. The icon is what separates the two.',
  },
  Approved: {
    label: 'Approved',
    role: 'success',
    Icon: CheckIcon,
    match: 'column',
    reason:
      'The word appears verbatim in section 2.4’s fourth column: success. Section 23.1 maps Confirm to `check`.',
  },
  Rejected: {
    label: 'Rejected',
    role: 'danger',
    Icon: CircleXIcon,
    match: 'column',
    reason:
      'The word appears verbatim in section 2.4’s fourth column: danger. `circle-x` rather than the bare `x`, which section 23.1 reserves for Close.',
  },
  'On Hold': {
    label: 'On Hold',
    role: 'neutral',
    Icon: PauseIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column. Warning is arguable — the decision is still outstanding — but a hold is a decision to STOP rather than something due, and Submitted and Resubmitted are already the two amber states that mean "somebody owes an answer now". Neutral rather than a third shade of the same claim; this file’s rule is that a word with no honest role is a neutral.',
  },
  'Edited by Manager': {
    label: 'Edited by Manager',
    role: 'neutral',
    Icon: UserPenIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column. It was purple, and purple is not one of section 2.4’s three roles, so it cannot simply be carried across. The plan has been changed and handed back for the owner to resubmit: nothing has succeeded, nothing has failed, and what is owed is owed by the owner rather than to them. Neutral, with the icon saying who acted.',
  },
}
