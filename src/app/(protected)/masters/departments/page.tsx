'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function DepartmentsPage() {
  return (
    <MasterNamePage
      title="Departments"
      noun={{ one: 'department', many: 'departments' }}
      apiPath="/api/masters/departments"
      section="departments"
      nameLabel="Department Name"
      namePlaceholder="Enter department name"
      deleteMode="hard"
      emptyBody="Departments group designations and users for reporting."
    />
  )
}
