'use client'

import { MasterNamePage, type MasterRow } from '@/components/masters/master-name-page'
import { Badge } from '@/components/ui/badge'

/**
 * Section 2.4: status colour, not a hardcoded hex per value. The kit's
 * badge is a closed 4-colour system (neutral/success/warning/danger) with
 * no "info" or "cold-blue" row, so Cold reads neutral rather than
 * inventing a fifth colour.
 */
const TEMP_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  Cold: 'neutral',
  Warm: 'warning',
  Hot: 'danger',
}

function temperatureCell(row: MasterRow) {
  const name = String(row.name ?? '')
  return <Badge variant={TEMP_VARIANT[name] ?? 'neutral'}>{name}</Badge>
}

export default function LeadTemperaturesPage() {
  return (
    <MasterNamePage
      title="Lead Temperatures"
      noun={{ one: 'temperature', many: 'temperatures' }}
      apiPath="/api/masters/lead-temperatures"
      section="lead_temperatures"
      addAction="create"
      nameLabel="Temperature Name"
      namePlaceholder="e.g. Cold, Warm, Hot…"
      nameColumnHeader="Temperature"
      nameCell={temperatureCell}
      deleteMode="soft"
      reorder
      emptyBody="Lead temperatures describe how warm a lead currently is."
    />
  )
}
