import { cn } from "@/lib/utils"

/**
 * Section 14: grey placeholder blocks in the shape of the content that
 * is coming, never a spinning wheel. The layout arrives first, so the
 * page does not jump when the data lands.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-lg bg-surface-control", className)}
      {...props}
    />
  )
}

export { Skeleton }
