import { EmptyState } from '@/components/ui/empty-state'

/**
 * Root 404: a wrong or stale URL outside the app shell (signed-out pages, or
 * a path no route group claims). "/" sends a signed-in phone user to Today
 * and a signed-out user to sign-in. Inside the shell, (protected)/not-found.tsx
 * keeps the navigation on screen.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <EmptyState variant="not-found" dashboardHref="/" homeHref="/" />
    </div>
  )
}
