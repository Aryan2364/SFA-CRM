'use client'

/**
 * Company | Individual — the exclusive account-kind choice, built once and
 * shared by every form that asks it (parties/companies/new on desktop,
 * parties/new on phone). `radio-group.tsx` is the kit's only component for
 * an exclusive choice (FRONTEND_RULES.md's component table: "Exclusive
 * choice. Round, so it is never confused with a tick box."); the kit ships
 * no segmented/pill control, so this follows the nearest kit rule rather
 * than inventing one (see docs/kit-audit/kit-gaps.md). `ChoiceRow` renders
 * the phone-optimised 48px tap row automatically via `useLayout()` — no
 * separate phone branch needed here.
 *
 * Company is the default everywhere; switching never clears anything
 * already typed on the rest of the form — callers own that, this component
 * only renders the choice and reports the new value.
 */

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ChoiceRow } from '@/components/ui/choice-row'

export type AccountKind = 'Company' | 'Individual'

export function AccountKindChoice({
  value,
  onChange,
  className,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: AccountKind
  onChange: (kind: AccountKind) => void
  className?: string
  /** id of an external <Label>/<p> this group is labelled by. */
  'aria-labelledby'?: string
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={v => onChange(v === 'Individual' ? 'Individual' : 'Company')}
      aria-label={ariaLabelledBy ? undefined : 'Account kind'}
      aria-labelledby={ariaLabelledBy}
      className={className}
    >
      {(['Company', 'Individual'] as const).map(k => (
        <ChoiceRow key={k} control={<RadioGroupItem value={k} />} label={k} />
      ))}
    </RadioGroup>
  )
}
