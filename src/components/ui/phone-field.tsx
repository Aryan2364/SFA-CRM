'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { COUNTRY_CODES, countryCodeLabel } from '@/lib/country-codes'
import { cn } from '@/lib/utils'

/**
 * A phone number input with a dialling-code picker in front of it.
 *
 * The two controls are ONE field, so they sit on one row and share the 36px
 * control height — a code stranded on its own line reads as a separate
 * question. Section 5.1: the gap between them is `space-2`, the token for
 * tightly related items.
 *
 * The picker is `SearchableSelect`, not the plain `Select`: section 16.3 puts
 * a list of more than twenty behind a search box, and typing "United" is
 * faster than scrolling past forty countries to reach the one non-Indian
 * number anybody enters this month.
 *
 * **Width.** The picker is 160px — `--spacing-field-min`, section 17's floor
 * for any field — and does not shrink. Section 16.2 fixes the menu to exactly
 * the trigger's width, so the trigger is what has to be wide enough to read,
 * and that rule is why this does NOT widen the menu instead. The label puts
 * the CODE FIRST ("+91 India"): what truncates at this width is the country
 * name, which confirms the choice, never the code, which IS the choice.
 *
 * Section 17 sizes a bare phone number at span 4. A phone number carrying a
 * code picker does not fit there — 160px of picker plus section 17's own
 * 160px floor for the number is 328px, and span 4 of a Large dialog is about
 * 250px. These fields take span 6, which is also what this form already gave
 * them before the picker existed.
 *
 * The caller holds the two halves as separate state and stores the joined
 * value — see `joinPhone`/`splitPhone` in `src/lib/country-codes.ts`. Keeping
 * them apart in the form is what lets the code survive a half-typed number.
 *
 * `disabled` greys BOTH halves: a code picker that still works while the
 * number beside it is locked invites a change that goes nowhere.
 */
export function PhoneField({
  id,
  code,
  onCodeChange,
  number,
  onNumberChange,
  disabled,
  invalid,
  placeholder,
  className,
}: {
  id: string
  code: string
  onCodeChange: (code: string) => void
  number: string
  onNumberChange: (number: string) => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
}) {
  const options = React.useMemo(
    () => Object.fromEntries(COUNTRY_CODES.map(c => [c.code, countryCodeLabel(c)])),
    []
  )

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div className="w-field-min shrink-0">
        <SearchableSelect
          id={`${id}-code`}
          options={options}
          value={code}
          onValueChange={onCodeChange}
          disabled={disabled}
          placeholder="Code"
          searchPlaceholder="Country or code"
          emptyMessage="No country matches that."
        />
      </div>
      {/* Section 9 rule 3: the half that holds free text must be allowed to
          shrink below its content width, or a long number widens the row. */}
      <Input
        id={id}
        className="min-w-0 flex-1"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={number}
        onChange={e => onNumberChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
      />
    </div>
  )
}
