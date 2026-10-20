'use client'

import { MasterNamePage, type MasterRow } from '@/components/masters/master-name-page'
import type { ListColumn } from '@/components/templates/list-page'

const talukaColumn: ListColumn<MasterRow> = {
  id: 'taluka',
  header: 'Taluka',
  tier: 'hide-below-1024',
  truncate: true,
  cellClassName: 'text-text-secondary',
  cell: row => (row.talukas as { name: string } | null)?.name ?? '—',
}

export default function VillagesPage() {
  return (
    <MasterNamePage
      title="Villages"
      noun={{ one: 'village', many: 'villages' }}
      apiPath="/api/masters/villages"
      section="villages"
      nameLabel="Village Name"
      namePlaceholder="Enter village name"
      parentField={{ key: 'taluka_id', label: 'Taluka', fetchUrl: '/api/masters/talukas' }}
      extraColumns={[talukaColumn]}
      deleteMode="hard"
      emptyBody="Villages sit under a taluka in the location hierarchy."
    />
  )
}
