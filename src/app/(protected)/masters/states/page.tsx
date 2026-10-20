'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function StatesPage() {
  return (
    <MasterNamePage
      title="States"
      noun={{ one: 'state', many: 'states' }}
      apiPath="/api/masters/states"
      section="states"
      nameLabel="State Name"
      namePlaceholder="Enter state name"
      deleteMode="hard"
      emptyBody="States are the top of the location hierarchy: states, districts, talukas, villages."
    />
  )
}
