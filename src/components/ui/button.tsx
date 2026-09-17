import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Section 6.
 * Four levels: primary, secondary, ghost, danger, plus `in-field`.
 * Exactly one primary button per screen or per dialog; everything
 * else is secondary. Ghost is allowed only for icon-only buttons
 * inside a toolbar, which is why it still carries a fill and a
 * border - a button the user cannot see is a button is broken.
 *
 * `in-field` is section 6.3.1: an icon button INSIDE an input, a
 * select or any other bordered field. It is the one variant with no
 * fill and no border, because the field around it already is the
 * visible container and a bordered button inside a bordered input
 * draws a box inside a box. It is NOT a general-purpose quiet button
 * - used anywhere else it is exactly the invisible control section
 * 6.1 rule 4 forbids. Same shape as the calendar day cell: a control
 * nested inside another container does not bring its own border.
 *
 * Height is fixed at 36 / 32 / 40. Width grows with the label,
 * height never does, so two buttons on different screens are always
 * the same height.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-1",
    "rounded-lg border whitespace-nowrap transition-colors select-none",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring",
    "disabled:pointer-events-none disabled:cursor-default",
    "disabled:border-border-light disabled:bg-surface-sunken disabled:text-text-muted",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary font-medium text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:border-primary-pressed active:bg-primary-pressed",
        secondary:
          "border-border bg-surface text-text-primary hover:bg-surface-control active:bg-surface-control-pressed",
        ghost:
          "border-border bg-surface-control text-text-primary hover:border-border-strong hover:bg-surface-control-hover active:border-border-strong active:bg-surface-control-pressed",
        danger:
          "border-danger bg-danger font-medium text-primary-foreground hover:border-danger-hover hover:bg-danger-hover active:border-danger-pressed active:bg-danger-pressed",
        /*
         * Section 6.3.1. All four states plus focus, moved from the
         * border to the background:
         *   resting  - nothing; the field is the container
         *   hover    - a surface-control tint behind the icon
         *   pressed  - the pressed tint
         *   disabled - reduced contrast, and the base already removes
         *              the pointer; its fill and border are overridden
         *              back to nothing here
         *   focus    - the primary-ring outline at offset 0, so it
         *              hugs the icon INSIDE the field rather than
         *              straddling the field's own border
         *
         * The focus ring is the only cue a keyboard user gets that the
         * icon is what Enter will press. It is never removed.
         */
        "in-field": [
          "border-transparent bg-transparent text-text-secondary",
          "hover:bg-surface-control hover:text-text-primary",
          "active:bg-surface-control-pressed active:text-text-primary",
          "disabled:border-transparent disabled:bg-transparent disabled:text-text-muted",
          "focus-visible:outline-offset-0",
        ].join(" "),
      },
      size: {
        default: "h-control px-4 text-body",
        sm: "h-control-sm px-3 text-label",
        lg: "h-control-lg px-4 text-body",
        icon: "size-control p-0",
        "icon-sm": "size-control-sm p-0",
        "icon-lg": "size-control-lg p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

/**
 * `forwardRef` IS LOAD-BEARING. It is not tidiness and it is not
 * optional, and removing it breaks this kit on React 18 while leaving
 * every test on React 19 green.
 *
 * Every Base UI trigger that takes `render={<Button/>}` - Tooltip,
 * Popover, Menu, Sheet, Dialog, AlertDialog, and this kit's own
 * `AlertDialogCancel` - ends up in Base UI's `evaluateRenderProp`,
 * which does `cloneElement(render, {...props, ref})`.
 *
 *   React 19: `ref` is an ordinary prop on a function component, so the
 *             spread below would carry it through even without this.
 *   React 18: `ref` is a RESERVED key on the element. A function
 *             component never receives it, the ref resolves to null,
 *             and React warns "Function components cannot be given
 *             refs".
 *
 * What a null ref costs is not a crash, which is why it survived so
 * long: the popup still MOUNTS. It just has no anchor element to
 * position against, so Base UI's positioner pins it at top:0 left:0
 * with opacity:0 - invisible, while `aria-expanded` says "true". The
 * tooltip does not appear at all, and dialogs mount without moving
 * focus into themselves. Measured on React 18.3.1 before this ref
 * existed; see `react-compat-harness`.
 *
 * The declared element type is `HTMLButtonElement` because that is what
 * this renders by default. A caller using `render` to become something
 * else (`render={<Link/>}`) narrows it at the call site.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "default", ...props },
    ref
  ) {
    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
)

export { Button, buttonVariants }
