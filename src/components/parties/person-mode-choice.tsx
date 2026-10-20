'use client'

/**
 * "Pick existing contact" | "New person" — the exclusive choice of how the
 * Self person on an Individual account gets picked. Reused in three places
 * that each phrase and order the two options slightly differently (the
 * two-step Company form, its phone equivalent, and the Change account kind
 * dialog), so labels and order are props rather than baked in; the control
 * and behaviour are built once. Same rationale as `AccountKindChoice`:
 * `radio-group.tsx` is the kit's only exclusive-choice component.
 */

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ChoiceRow } from '@/components/ui/choice-row'

export type PersonMode = 'existing' | 'new'

export function PersonModeChoice({
  value,
  onChange,
  existingLabel = 'Existing contact',
  newLabel = 'New person',
  order = ['existing', 'new'],
  className,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: PersonMode
  onChange: (mode: PersonMode) => void
  existingLabel?: string
  newLabel?: string
  /** Display order of the two options; the choice itself is unaffected. */
  order?: PersonMode[]
  className?: string
  /** id of an external <Label>/<p> this group is labelled by. */
  'aria-labelledby'?: string
}) {
  const labels: Record<PersonMode, string> = { existing: existingLabel, new: newLabel }
  return (
    <RadioGroup
      value={value}
      onValueChange={v => onChange(v === 'new' ? 'new' : 'existing')}
      aria-label={ariaLabelledBy ? undefined : 'Person'}
      aria-labelledby={ariaLabelledBy}
      className={className}
    >
      {order.map(mode => (
        <ChoiceRow key={mode} control={<RadioGroupItem value={mode} />} label={labels[mode]} />
      ))}
    </RadioGroup>
  )
}
