'use client'

/**
 * Phone discount control: one number field plus its unit (% or ₹), the same
 * value pair the desktop `DiscountField` holds (`unit`, `value`), so
 * `toDiscount()` turns either into the `(discount_type, discount_value)` the
 * order routes take, and an empty field is "no discount" on both.
 *
 * Not a reuse of the desktop control itself: its unit toggle is two 24px
 * buttons inside the input, below the phone's 44px touch target. The unit
 * here is the kit's Select, which is a bottom sheet on a phone.
 */

import { Input } from '@/components/ui/input'
import { OptionSelect } from '@/components/orders/option-select'
import type { DiscountUnit } from '@/components/orders/discount-field'

const UNIT_OPTIONS: Record<string, string> = { percent: '%', amount: '₹ amount' }

export function PhoneDiscountField({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string
  /** For screen readers; the visible label sits above the field. */
  label: string
  unit: DiscountUnit
  value: number
  onChange: (next: { unit: DiscountUnit; value: number }) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        placeholder="No discount"
        className="min-w-0 flex-1"
        value={value === 0 ? '' : value}
        onChange={e => {
          const n = Number(e.target.value)
          onChange({ unit, value: Number.isFinite(n) && n > 0 ? n : 0 })
        }}
      />
      <div className="w-32 shrink-0">
        <OptionSelect
          id={`${id}-unit`}
          options={UNIT_OPTIONS}
          value={unit}
          onValueChange={v => onChange({ unit: v === 'amount' ? 'amount' : 'percent', value })}
          className="max-w-none"
        />
      </div>
    </div>
  )
}
