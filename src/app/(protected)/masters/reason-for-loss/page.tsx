'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function ReasonForLossPage() {
  return (
    <MasterNamePage
      title="Reason for Loss"
      noun={{ one: 'reason', many: 'reasons' }}
      apiPath="/api/masters/reason-for-loss"
      section="reason_for_loss"
      addAction="create"
      nameLabel="Reason for Loss"
      namePlaceholder="e.g. Price, Competitor, No Budget…"
      deleteMode="soft"
      reorder
      includeInactive
      emptyBody="Reasons for loss are recorded when a deal is closed lost."
    />
  )
}
