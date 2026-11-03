'use client'

import { useEffect, useState } from 'react'

import { AccountBriefSheet } from '@/components/parties/account-brief-sheet'
import {
  AccountContactFields,
  NO_CONTACT_ID,
  useAccountContactPicker,
  type AccountContactValue,
} from '@/components/parties/account-contact-fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PhoneFormField } from '@/components/ui/phone-form'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { PlanEntry } from '@/components/weekly-plan/plan-model'

/** "Tue 28": the day as the pills write it. */
export function shortDay(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${d.getDate()}`
}

/**
 * The compact "Add to Tue 28" sheet: an account first, a person optional, and
 * one Add button. No Type and no expected value here; those live on the line.
 */
export function AddLineSheet({
  open,
  onOpenChange,
  dayShort,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dayShort: string
  /** Returns true when the line was added (false: refused, toast already shown). */
  onAdd: (value: AccountContactValue, name: string, contactName: string) => boolean
}) {
  const [value, setValue] = useState<AccountContactValue>({ accountId: '', contactId: '' })
  const picker = useAccountContactPicker({ value, onChange: setValue, allowContactOnly: true, enabled: open })

  useEffect(() => {
    if (open) setValue({ accountId: '', contactId: '' })
  }, [open])

  function submit() {
    if (!picker.complete) return
    const name = picker.selectedAccount?.name ?? picker.selectedContact?.name ?? 'line'
    if (onAdd(value, name, picker.selectedContact?.name ?? '')) onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Add to {dayShort}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 pb-2">
          <AccountContactFields picker={picker} accountRequired idPrefix="plan-add" />
        </div>
        <SheetFooter>
          <Button className="w-full" onClick={submit} disabled={!picker.complete}>Add</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export type BriefLineState = { date: string; entry: PlanEntry } | null

/**
 * A line's brief: the account (or the person) in the shared brief sheet, with
 * the line's own rows - who the meeting is with, the expected order, the day -
 * editable while the plan is a draft and plain text once it is not.
 */
export function LineBrief({
  line,
  canEdit,
  dayOptions,
  onClose,
  onPerson,
  onExpected,
  onMoveDay,
  partyName,
}: {
  line: BriefLineState
  canEdit: boolean
  dayOptions: [string, string][]
  onClose: () => void
  onPerson: (lineId: string, accountId: string, contactId: string, contactName?: string) => boolean
  onExpected: (lineId: string, raw: string) => void
  onMoveDay: (lineId: string, toDay: string) => Promise<void>
  partyName: (id: string) => string
}) {
  const entry = line?.entry
  // A party with no type (a legacy line) is an account.
  const isAccount = entry?.partyType === 'company' || (!entry?.partyType && !!entry?.partyId)
  const accountId = isAccount ? entry!.partyId : ''
  const contactId = isAccount ? (entry!.contactId ?? '') : ''

  const picker = useAccountContactPicker({
    value: { accountId, contactId },
    onChange: next => {
      if (entry && isAccount && next.contactId !== contactId) {
        onPerson(entry.id, accountId, next.contactId, picker.accountPeople.find(l => l.contact_id === next.contactId)?.contact_name ?? undefined)
      }
    },
    enabled: !!line && isAccount,
  })

  const people: PickerOption[] = picker.accountPeople.map(l => ({
    id: l.contact_id, label: l.contact_name ?? '—', sublabel: l.role_name || undefined,
  }))
  // The entry's own name first (it came from the account's people), then the
  // people list, then the contact feed.
  const personName = entry?.contactName
    || (contactId ? people.find(o => o.id === contactId)?.label : '')
    || (contactId ? partyName(contactId) : '')
  const personValue: PickerOption | null = contactId ? { id: contactId, label: personName || 'Person' } : null
  const expected = entry?.expectedOrderValue ?? ''

  const extra = line && entry ? (
    <div className="flex flex-col gap-4">
      {isAccount && (
        <PhoneFormField label="Meeting with">
          {canEdit && !picker.lockedToSelf ? (
            <PickerSheetField
              label="Meeting with"
              placeholder="No one specific"
              value={personValue}
              onChange={o => onPerson(entry.id, accountId, o.id === NO_CONTACT_ID ? '' : o.id, o.id === NO_CONTACT_ID ? '' : o.label)}
              fetchOptions={async q => {
                const needle = q.trim().toLowerCase()
                const hits = people.filter(o => !needle || o.label.toLowerCase().includes(needle))
                return needle ? hits : [{ id: NO_CONTACT_ID, label: 'No one specific' }, ...hits]
              }}
            />
          ) : (
            <p className="text-body text-text-primary">{personName || 'No one specific'}</p>
          )}
        </PhoneFormField>
      )}

      <PhoneFormField label="Expected order (₹)">
        {canEdit ? (
          <input
            type="text"
            inputMode="decimal"
            value={expected}
            onChange={e => onExpected(entry.id, e.target.value)}
            placeholder="Optional"
            aria-label="Expected order (₹)"
            className="min-h-11 w-full rounded-lg border border-border-light bg-surface px-3 text-[16px] text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary-ring focus:outline-none"
          />
        ) : (
          <p className="text-body text-text-primary">
            {expected.trim() ? `₹${Number(expected).toLocaleString('en-IN')}` : 'Not set'}
          </p>
        )}
      </PhoneFormField>

      <div className="flex flex-col gap-1.5">
        <Label>Day</Label>
        {canEdit ? (
          <Select value={line.date} onValueChange={v => { if (v && v !== line.date) void onMoveDay(entry.id, v) }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a day">
                {(value: string | null) => dayOptions.find(([v]) => v === value)?.[1] ?? 'Pick a day'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {dayOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-body text-text-primary">
            {dayOptions.find(([v]) => v === line.date)?.[1] ?? line.date}
          </p>
        )}
      </div>
    </div>
  ) : null

  return (
    <AccountBriefSheet
      accountId={isAccount ? accountId : null}
      contactId={!isAccount && entry?.partyId ? entry.partyId : null}
      open={!!line}
      onOpenChange={o => { if (!o) onClose() }}
      headerExtra={extra}
    />
  )
}
