import * as React from "react"
import { CircleAlertIcon, InboxIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PermissionTooltip } from "@/components/ui/permission-tooltip"

/**
 * Section 13. There are three empty states, not one, and using the
 * wrong one makes the software look unintelligent - never offer "Add
 * your first record" to someone whose filter simply matched nothing.
 *
 * The variant is the whole point of this component, so it is a closed
 * set rather than free-form props. Each variant fixes its own icon and
 * the shape of its action; the caller supplies the words and the
 * handler. A component that can be used wrongly will be.
 *
 *   nothing-yet   - what would normally be here. Primary: create.
 *   nothing-found - the filters matched no records. Clear filters.
 *   failed        - what went wrong. Retry.
 *
 * Each has three parts: a short heading, one line explaining how to
 * change the situation, and one action. Never a blank area, never the
 * words "No data".
 */
type EmptyStateVariant = "nothing-yet" | "nothing-found" | "failed"

const VARIANTS: Record<
  EmptyStateVariant,
  { icon: React.ReactNode; actionLabel: string; actionVariant: "primary" | "secondary" }
> = {
  "nothing-yet": {
    icon: <InboxIcon />,
    actionLabel: "Create",
    actionVariant: "primary",
  },
  "nothing-found": {
    icon: <SearchIcon />,
    actionLabel: "Clear filters",
    actionVariant: "secondary",
  },
  failed: {
    icon: <CircleAlertIcon />,
    actionLabel: "Try again",
    actionVariant: "secondary",
  },
}

function EmptyState({
  className,
  variant,
  heading,
  children,
  actionLabel,
  onAction,
  actionDisabledReason,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  variant: EmptyStateVariant
  /** Short. "No customers yet", not a sentence. */
  heading: string
  /** One line explaining how to change the situation. */
  children: React.ReactNode
  /**
   * Overrides only the wording. `nothing-yet` should name the record
   * ("New customer"); the other two keep their defaults unless there is
   * a reason.
   */
  actionLabel?: string
  onAction?: () => void
  /**
   * Section 26 for the one action an empty state offers. A string: the
   * user may not take it, so it renders disabled with this reason ("Only
   * someone who can create companies can add them") on a focusable
   * wrapper. `null`: not known yet - disabled with no reason, because
   * "not known yet" is not "not allowed". Absent: the action as always.
   */
  actionDisabledReason?: string | null
}) {
  const spec = VARIANTS[variant]

  return (
    <div
      data-slot="empty-state"
      data-variant={variant}
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {/* Section 23: 22px is the empty-state icon size. */}
      <div
        className="text-text-muted [&_svg:not([class*='size-'])]:size-icon-empty"
        aria-hidden="true"
      >
        {spec.icon}
      </div>
      <p className="text-card-heading font-medium text-text-primary">{heading}</p>
      <p className="max-w-[46ch] text-body text-text-secondary">{children}</p>
      <div className="mt-1">
        <PermissionTooltip
          allowed={typeof actionDisabledReason !== "string"}
          reason={actionDisabledReason ?? ""}
        >
          <Button
            variant={spec.actionVariant}
            size="sm"
            onClick={onAction}
            disabled={actionDisabledReason !== undefined}
          >
            {actionLabel ?? spec.actionLabel}
          </Button>
        </PermissionTooltip>
      </div>
    </div>
  )
}

export { EmptyState, type EmptyStateVariant }
