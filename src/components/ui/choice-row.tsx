"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/**
 * A tick box, radio or switch with its label, as one row.
 *
 *   <ChoiceRow control={<Switch />} label="Email the customer when it ships" />
 *   <RadioGroup aria-labelledby="delivery-label" className="flex flex-col gap-2">
 *     <ChoiceRow control={<RadioGroupItem value="standard" />} label="Standard" />
 *     <ChoiceRow control={<RadioGroupItem value="express" />} label="Express" />
 *   </RadioGroup>
 *
 * `control` is a Checkbox, RadioGroupItem or Switch with no id of its
 * own needed: the row gives it one (or keeps the one it has) and points
 * the label at it. Its state, value and handlers stay on the control.
 *
 * ON THE COMPUTER it is exactly what the kit's forms write by hand today:
 *
 *   <div className="flex items-center gap-2">
 *     <Switch id="…" />
 *     <Label htmlFor="…">Email the customer when it ships</Label>
 *   </div>
 *
 * The same elements, classes and sizes, so nothing moves. Clicking the
 * label changes the control, as it always has (the label's htmlFor).
 * `description`, where given, sits under the label in meta style.
 *
 * ON PHONE (41.7 rule 10) the whole row is the tap target: the row itself
 * is the <label>, at least 48px tall (min-h-12) and the full width, so a
 * tap anywhere on it, the words included, changes the control. Base UI's
 * own click on the control cancels the label's, so a tap on the control
 * itself still changes it once, not twice. Because the row's label also
 * holds the description, the control is named by the label text alone
 * (aria-labelledby) and described by the description (aria-describedby).
 * Rows stacked one under another never share a tap area, so they need no
 * gap between them (41.9 rule 4).
 *
 * On phone a disabled control's words turn text-muted and the row loses
 * its pointer; on the computer the label behaves as Label always has.
 * data-slot="choice-row" is the only addition to the computer's markup,
 * and it draws nothing.
 */

type ControlProps = {
  id?: string
  disabled?: boolean
  "aria-labelledby"?: string
  "aria-describedby"?: string
}

function ChoiceRow({
  control,
  label,
  description,
  required = false,
  className,
}: {
  /** <Checkbox />, <RadioGroupItem value="…" /> or <Switch />. */
  control: React.ReactElement<ControlProps>
  label: React.ReactNode
  /** One line under the label, where the choice needs explaining. */
  description?: React.ReactNode
  /** The red asterisk of section 11.3 rule 3, as Label draws it. */
  required?: boolean
  className?: string
}) {
  const { layout } = useLayout()
  const generated = React.useId()
  const id = control.props.id ?? generated
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  const disabled = control.props.disabled === true
  const describedBy =
    [control.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined

  if (layout !== "phone") {
    const field = React.cloneElement(control, { id, "aria-describedby": describedBy })
    const name = (
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
    )
    return (
      <div data-slot="choice-row" className={cn("flex items-center gap-2", className)}>
        {field}
        {description ? (
          <div className="flex min-w-0 flex-col gap-1">
            {name}
            <p id={descriptionId} className="text-meta text-text-muted">
              {description}
            </p>
          </div>
        ) : (
          name
        )}
      </div>
    )
  }

  const field = React.cloneElement(control, {
    id,
    "aria-labelledby": control.props["aria-labelledby"] ?? labelId,
    "aria-describedby": describedBy,
  })
  return (
    <label
      htmlFor={id}
      data-slot="choice-row"
      className={cn(
        "flex min-h-12 w-full items-center gap-3 py-2 select-none",
        disabled ? "cursor-default" : "cursor-pointer",
        className
      )}
    >
      {field}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Label's own look (section 3 rule 2), on a span: a label
            cannot sit inside another. */}
        <span
          id={labelId}
          className={cn(
            "flex items-center gap-1 text-label text-text-secondary",
            disabled && "text-text-muted"
          )}
        >
          {label}
          {required && (
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          )}
        </span>
        {description ? (
          <span id={descriptionId} className="text-meta text-text-muted">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { ChoiceRow }
