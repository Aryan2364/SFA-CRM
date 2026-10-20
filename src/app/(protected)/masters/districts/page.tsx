'use client'

import { MasterNamePage, type MasterRow } from '@/components/masters/master-name-page'
import type { ListColumn } from '@/components/templates/list-page'

const stateColumn: ListColumn<MasterRow> = {
  id: 'state',
  header: 'State',
  tier: 'hide-below-1024',
  truncate: true,
  cellClassName: 'text-text-secondary',
  cell: row => (row.states as { name: string } | null)?.name ?? '—',
}

export default function DistrictsPage() {
  return (
    <MasterNamePage
      title="Districts"
      noun={{ one: 'district', many: 'districts' }}
      apiPath="/api/masters/districts"
      section="districts"
      nameLabel="District Name"
      namePlaceholder="Enter district name"
      parentField={{ key: 'state_id', label: 'State', fetchUrl: '/api/masters/states' }}
      extraColumns={[stateColumn]}
      deleteMode="hard"
      emptyBody="Districts sit under a state in the location hierarchy."
    />
  )
}
