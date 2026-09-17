import { CheckIcon, CircleSlashIcon, FilePenIcon, SendIcon } from 'lucide-react'
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
