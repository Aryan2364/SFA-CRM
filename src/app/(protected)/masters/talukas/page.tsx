'use client'

import { MasterNamePage, type MasterRow } from '@/components/masters/master-name-page'
import type { ListColumn } from '@/components/templates/list-page'

const districtColumn: ListColumn<MasterRow> = {
  id: 'district',
  header: 'District',
  tier: 'hide-below-1024',
  truncate: true,
  cellClassName: 'text-text-secondary',
  cell: row => (row.districts as { name: string } | null)?.name ?? '—',
}

export default function TalukasPage() {
  return (
    <MasterNamePage
      title="Talukas"
      noun={{ one: 'taluka', many: 'talukas' }}
      apiPath="/api/masters/talukas"
      section="talukas"
      nameLabel="Taluka Name"
      namePlaceholder="Enter taluka name"
      parentField={{ key: 'district_id', label: 'District', fetchUrl: '/api/masters/districts' }}
      extraColumns={[districtColumn]}
      deleteMode="hard"
      emptyBody="Talukas sit under a district in the location hierarchy."
    />
  )
}
