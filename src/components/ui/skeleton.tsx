import { cn } from "@/lib/utils"

/**
 * Section 14: grey placeholder blocks in the shape of the content that
 * is coming, never a spinning wheel. The layout arrives first, so the
 * page does not jump when the data lands.
 *
 * Section 5.6: a soft, slow pulse - opacity only, so nothing moves - and
 * under reduce motion it stops and the block simply sits there.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-lg bg-surface-control motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
