'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function ContactTypesPage() {
  return (
    <MasterNamePage
      title="Contact Types"
      noun={{ one: 'contact type', many: 'contact types' }}
      apiPath="/api/masters/contact-types"
      section="contact_types"
      addAction="create"
      nameLabel="Contact Type"
      namePlaceholder="e.g. Decision Maker, Influencer…"
      deleteMode="soft"
      reorder
      includeInactive
      emptyBody="Contact types describe the role a contact plays at an account."
    />
  )
}
