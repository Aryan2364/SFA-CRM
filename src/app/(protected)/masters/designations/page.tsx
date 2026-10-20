'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function DesignationsPage() {
  return (
    <MasterNamePage
      title="Designations"
      noun={{ one: 'designation', many: 'designations' }}
      apiPath="/api/masters/designations"
      section="designations"
      nameLabel="Designation Name"
      namePlaceholder="Enter designation name"
      deleteMode="hard"
      emptyBody="Designations describe the job titles users hold."
    />
  )
}
