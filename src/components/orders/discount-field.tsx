'use client'

import { cn } from '@/lib/utils'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import type { DiscountType } from '@/lib/order-math'

/**
 * F18, the half about the currency symbol — "None / ₹ / ₹0.00 … this section
 * is poorly made".
 *
 * What he was looking at was three controls saying one thing:
 *
 *   [ None ▾ ]  [ ₹ ]  ₹0.00
 *
 * a dropdown whose third option existed only to disable the box beside it, a
 * box whose placeholder was a bare rupee sign, and a computed figure that was
 * ₹0.00 precisely because the dropdown said None. Two of those three are the
 * absence of a discount rendered twice.
 *
 * It collapses to one field. The unit is a two-state toggle inside the field,
 * where a unit belongs; the value is the field; and "no discount" is what an
 * empty field means, not a third option in a menu. The computed amount is
 * rendered by the caller ONLY when it is non-zero, so nothing reads ₹0.00 at
 * rest.
 *
 * ---------------------------------------------------------------------------
 * THE STORED SHAPE DOES NOT CHANGE
 *
 * `order_items.discount_type` is still `'none' | 'percent' | 'amount'` and a
 * line with no discount is still written as `'none'`. This control has no
 * "none" state of its own to send — `toDiscount()` below derives it, so an
 * empty field posts `('none', 0)` exactly as the old dropdown did. Without
 * that, every clean line would be stored as a 0% discount: `orderTotals`
 * would still compute zero, `has_discount` would still be false, and the
 * discount column in §7.4's report would quietly gain a thousand rows that
 * are not discounts.
 */

/** The unit the user picked. Not `DiscountType` — this has no "none". */
export type DiscountUnit = 'percent' | 'amount'

/**
 * The pair the API and `order-math` want, from the pair the field holds.
 * An empty or zero value is the absence of a discount whatever unit is
 * showing, so it is `'none'`.
 */
export function toDiscount(
  unit: DiscountUnit,
  value: number
): { discount_type: DiscountType; discount_value: number } {
  return value > 0
    ? { discount_type: unit, discount_value: value }
    : { discount_type: 'none', discount_value: 0 }
}

export function DiscountField({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string
  /** For screen readers — the visible label is the column heading. */
  label: string
  unit: DiscountUnit
  value: number
  onChange: (next: { unit: DiscountUnit; value: number }) => void
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        placeholder="No discount"
        /* 16px on mobile so iOS does not zoom the dialog on focus. */
        className="text-base sm:text-body"
        value={value === 0 ? '' : value}
        onChange={e => {
          const n = Number(e.target.value)
          onChange({ unit, value: Number.isFinite(n) && n > 0 ? n : 0 })
        }}
      />
      <InputGroupAddon align="inline-end" className="gap-0.5">
        {(['percent', 'amount'] as const).map(u => (
          <InputGroupButton
            key={u}
            size="icon-xs"
            aria-pressed={unit === u}
            aria-label={
              u === 'percent'
                ? `${label} as a percentage`
                : `${label} as a rupee amount`
            }
            onClick={() => onChange({ unit: u, value })}
            className={cn(
              'tabular-nums',
              unit === u && 'bg-primary-subtle text-primary-pressed'
            )}
          >
            {u === 'percent' ? '%' : '₹'}
          </InputGroupButton>
        ))}
      </InputGroupAddon>
    </InputGroup>
  )
}
