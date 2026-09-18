import {
  CheckIcon,
  CircleCheckIcon,
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
  TagIcon,
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
 * product says "Submitted" and "Placed", which are in none of its three
 * lists, so the colour is a JUDGEMENT — and a judgement made twice is made
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
 * ORDERS — `orders.status`, CHECK-constrained to TWO: `Draft` and
 * `Placed` (`orders_status_check`).
 *
 * It used to be a CHECK-constrained set of three — Draft, Submitted,
 * Confirmed — and comments in this file said so. REBUILD-PLAN §4.10
 * replaced that with two states, and the constraint was altered with
 * it: `Confirmed` became `Placed`, and `Submitted` became `Draft`,
 * because §7.7 wants Draft to be the "stuck, needs processing" bucket
 * and awaiting-confirmation is what that meant. The legal vocabulary is
 * `src/lib/order-math.ts`'s `ORDER_STATUSES`, which the routes validate
 * against; this map only decides how the two words LOOK.
 *
 * Neither word appears in section 2.4's fourth column, so both roles
 * are mappings by meaning.
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
  Placed: {
    label: 'Placed',
    role: 'success',
    Icon: CheckIcon,
    match: 'meaning',
    reason:
      'The end of the road for an order under §4.10’s two-state model — the order is real and committed, which is section 2.4 success’s "Completed" under another name. It inherits Confirmed’s role and Confirmed’s glyph, because it is the same position renamed and one position must not change colour when it changes word. Section 23.1 already maps Confirm to `check`.',
  },
}

/**
 * Carried by an order whose line or order-level discount is non-zero —
 * `orders.has_discount`, REBUILD-PLAN §4.10's requirement that a
 * discounted order be "visibly different from a clean order".
 *
 * NOT a status: it does not say where the order has got to and it is
 * orthogonal to Draft/Placed — either state can carry it. It lives here
 * anyway because it is a badge on the same row as the status badge, and
 * a word rendered next to the vocabulary has to be decided by the
 * vocabulary or the two will drift apart.
 *
 * Warning rather than success or danger. A discount is not a failure,
 * and it is not an achievement either — it is money given away on
 * somebody's authority, which is the thing §7.4 reports on per sales
 * person. Section 2.4 warning's "Needs review" is exactly that reading.
 *
 * A clean order gets NO badge. `has_discount = false` is the ordinary
 * case on every row, and a grey "No discount" chip on 34 rows out of 34
 * is noise that would hide the one row that matters.
 */
export const DISCOUNT_FLAG: StatusSpec = {
  label: 'Discount',
  role: 'warning',
  Icon: TagIcon,
  match: 'meaning',
  reason:
    'Absent from section 2.4’s fourth column. Money has been given away and §7.4 makes that a thing a manager reviews per sales person, which is warning’s "Needs review". Not danger: a discount is authorised, not a failure.',
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
 * Unlike `orders.status`, which is CHECK-constrained to the two words
 * above, `lead_stages` and `lead_temperatures` are tenant-scoped MASTER TABLES
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
  return <SpecBadge spec={statusSpec(vocabulary, status)} />
}

/**
 * The same rendering for a spec that is not keyed by a column value —
 * `DISCOUNT_FLAG`, which is decided by a boolean rather than looked up
 * by a word. Split out so the flag cannot end up styled by hand at the
 * call site and drift from the status badge beside it.
 */
export function SpecBadge({ spec }: { spec: StatusSpec }) {
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
 * COMPANIES and CONTACTS — `companies.is_active` / `contacts.is_active`,
 * rendered as the word the forms use: Active or Inactive.
 *
 * The same two words and the same two ROLES as USER_STATUS, which is
 * why this is not a rename of it but a sibling: the roles agree, the
 * GLYPHS must not. USER_STATUS's icons are a person with a tick and a
 * person with a minus, which is exactly right for an account and wrong
 * for an organisation — a company is not a person, and the Parties
 * screens were borrowing that vocabulary for want of their own. Two
 * screens import USER_STATUS by name, so it stays as it is.
 *
 * The glyphs here are neutral: a circle with a tick and a circle with a
 * slash. Section 7.2 rule 1 requires an icon as well as a colour, and
 * `circle-slash` reads as "switched out of use" rather than as a
 * failure, which is what section 15.2 says deactivation is.
 */
export const COMPANY_STATUS: Record<string, StatusSpec> = {
  Active: {
    label: 'Active',
    role: 'success',
    Icon: CircleCheckIcon,
    match: 'column',
    reason:
      'The word appears verbatim in section 2.4’s fourth column, so the role is not a judgement at all: success.',
  },
  Inactive: {
    label: 'Inactive',
    role: 'neutral',
    Icon: CircleSlashIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column. Section 15.2 makes deactivation the safe, deliberate alternative to deletion rather than a failure, so danger would misstate it, and this file’s rule is that a word with no honest role is a neutral rather than a guess. The same reading as USER_STATUS.Inactive, deliberately identical so one word never has two colours.',
  },
}

/**
 * RECORD COMPLETENESS — `companies.is_complete` / `contacts.is_complete`,
 * the derived flag `src/lib/completeness.ts` writes. Two words, from a
 * boolean: Complete or Incomplete.
 *
 * It is a status in the sense section 11.1 means — a state of the
 * record that decides what can be done with it — because REBUILD-PLAN
 * §3.5 hangs a consequence on it: an order booked against an incomplete
 * party stays in Draft and cannot be placed. So it is a badge, not
 * coloured text, and not a badge invented at the call site.
 *
 * Incomplete is WARNING rather than danger. Nothing has failed and
 * nothing is overdue; something is owed before the record can be used
 * to its full extent, which is section 2.4 warning’s "Pending" /
 * "Needs review" reading.
 */
export const RECORD_COMPLETENESS: Record<string, StatusSpec> = {
  Complete: {
    label: 'Complete',
    role: 'success',
    Icon: CircleCheckIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column, but it is the same reading as "Completed", which is in it: every field a usable record needs is filled and nothing is owed.',
  },
  Incomplete: {
    label: 'Incomplete',
    role: 'warning',
    Icon: CircleDashedIcon,
    match: 'meaning',
    reason:
      'Absent from section 2.4’s fourth column. Nothing has failed, so danger would overstate it; something is owed before an order against this party can leave Draft (REBUILD-PLAN §3.5), which is warning’s "Pending" and "Needs review". `circle-dashed` says the outline is there and the filling is not.',
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
      'Sent and awaiting a manager’s decision, which is section 2.4 warning’s "Pending" and "Needs review". `orders.status` carried the same word with the same role until §4.10 reduced it to two states; this is the surviving Submitted, and its role is unchanged by that.',
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
