import { LockIcon } from 'lucide-react'

import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * The one place a screen says "this did not load".
 *
 * Two outcomes, because they need different offers. Section 13's
 * "something failed" is a retry: the request may well work next time.
 * A 403 is not - it is a condition that stays true until somebody
 * changes the user's access, which is section 7.1's banner, and
 * offering Retry there is a button that is guaranteed to fail.
 *
 * Section 7.2 rule 1: the banner carries an icon as well as a colour.
 * Rule 2: state the cause, then the next action. Rule 3: never show
 * the raw message from the server.
 */
function LoadError({
  forbidden,
  what,
  onRetry,
  className,
}: {
  /** True only for a 403. */
  forbidden: boolean
  /** Lower-case noun phrase: "products", "the team dashboard". */
  what: string
  onRetry?: () => void
  className?: string
}) {
  if (forbidden) {
    return (
      <Banner variant="danger" className={className}>
        <LockIcon />
        <BannerTitle>You don&apos;t have access to this</BannerTitle>
        <BannerDescription>
          Your role cannot view {what}. Ask an administrator to grant access.
        </BannerDescription>
      </Banner>
    )
  }

  return (
    <EmptyState
      variant="failed"
      heading={`Could not load ${what}`}
      onAction={onRetry}
      className={className}
    >
      The request did not finish. Check your connection, then try again.
    </EmptyState>
  )
}

export { LoadError }
