import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FilePenIcon,
  FileTextIcon,
  FlameIcon,
  MessageSquareIcon,
  PhoneIcon,
  SendIcon,
  SnowflakeIcon,
  TargetIcon,
  ThermometerIcon,
  ThumbsUpIcon,
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
 * leaves nine neutrals. That is a real loss: the screen previously
 * carried nine distinct colours, and stage and temperature are both
 * ordinal scales that a colour reads faster than a word.
 *
 * **What replaces the colour is the icon.** Section 7.2 rule 1 already
 * requires one on every badge, so each of the nine gets a DISTINCT icon
 * and the value is still tellable at a glance without reading. What is
 * gone is the ordering — six greys do not rank themselves the way six
 * hues did.
 *
 * Section 2.4 is explicit that there is no information blue, and the
 * only non-status palette in the kit is section 21's, which belongs to
 * charts and whose whole rule is that a caller never names a colour. So
 * an ordinal categorical scale is something this kit does not have, and
 * inventing one here is exactly what must not happen in a screen. The
 * report raises it.
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

