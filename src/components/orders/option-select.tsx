'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'

/**
 * F16 — "Order page create order page is again having raw os for drop-down
 * which is not acceptable. based on the rgb-kit fix it."
 *
 * The order form had six `<select>` elements. A native `<select>` paints the
 * operating system's menu, which is why it looks like nothing else in the
 * product on Windows and cannot carry the kit's selected-vs-hovered rule at
 * all. The fix is the kit — but WHICH kit component depends on how long the
 * list is, and that is the decision that keeps getting made wrong:
 *
 *   §16.3 — "More than 6 options: the menu gets a search box fixed at the
 *   top. More than about 20 options: it should not be a dropdown at all."
 *
 * Every list on this form is variable-length. Products, parties and the team
 * roster are all tenant data: six on the demo tenant, four hundred on a real
 * one. A caller that picks `Select` because the list is short today ships a
 * scroll-hunt to the tenant that has more, and `Select`'s own development
 * warning only fires on the machine of whoever happens to open that tenant.
 *
 * So the choice is made from the data rather than by the caller. Past six
 * entries this renders `SearchableSelect`, at six or fewer the plain
 * `Select`; both use the same trigger, so the control does not visibly
 * change shape when a tenant's product master crosses the line.
 */

/** §16.3's number. Named so the rule is greppable, not a bare `6`. */
export const SEARCHABLE_THRESHOLD = 6

export function OptionSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search',
  emptyMessage = 'Nothing matches that search.',
  disabled,
  className,
}: {
  id?: string
  /** value → label. */
  options: Record<string, string>
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}) {
  const entries = Object.entries(options)

  if (entries.length > SEARCHABLE_THRESHOLD) {
    return (
      <SearchableSelect
        id={id}
        options={options}
        value={value}
        onValueChange={onValueChange}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        disabled={disabled}
        className={className}
      />
    )
  }

  return (
    <Select
      items={options}
      value={value}
      onValueChange={v => onValueChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {entries.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
