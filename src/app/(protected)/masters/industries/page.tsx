'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function IndustriesPage() {
  return (
    <MasterNamePage
      title="Industry / Segment"
      noun={{ one: 'industry', many: 'industries' }}
      apiPath="/api/masters/industries"
      section="industries"
      addAction="create"
      nameLabel="Industry / Segment"
      namePlaceholder="e.g. Agriculture, Textiles & Apparel…"
      deleteMode="soft"
      reorder
      includeInactive
      emptyBody="Industries and segments classify accounts and leads."
    />
  )
}
