import { redirect } from 'next/navigation'

/**
 * Former phone-only URL for the weekly plan. Both layouts now share
 * `/weekly-plan` (FRONTEND_RULES_PHONE §41.2 rule 4); this keeps old links
 * and bookmarks working.
 */
export default function WeeklyPlansRedirect() {
  redirect('/weekly-plan')
}
