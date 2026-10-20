import { EmptyState } from '@/components/ui/empty-state'

/**
 * Kit 11.8 "Page not found" for a missing record or stale link under the
 * app shell. Rendered inside the protected layout, so the sidebar, or on
 * phone the app bar's back arrow and the tab bar, stay on screen. "Go to
 * home" (phone) / "Go to dashboard" (desktop) both open "/", which sends
 * phone users on to Today.
 */
export default function ProtectedNotFound() {
  return <EmptyState variant="not-found" dashboardHref="/" homeHref="/" />
}
