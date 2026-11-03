'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useLayout } from '@/lib/layout'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Label } from '@/components/ui/label'
import { PhoneFormField } from '@/components/ui/phone-form'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Account + Contact as two separate fields (docs/accounts-contacts-spec.md
 * §1, §3, §8) - one reusable hook and one component, desktop and phone.
 *
 * Account = who buys. Contact = the person you deal with at it (optional).
 *
 *   const picker = useAccountContactPicker({ value, onChange, allowContactOnly })
 *   <AccountContactFields picker={picker} />
 *
 * The caller owns `value` ({ accountId, contactId }, '' for none) and gets the
 * resolved rows back from the hook (`selectedAccount`, `selectedContact`,
 * `selectedContactAccounts`) to build whatever it saves. Nothing here knows
 * what the value is saved INTO - meetings and the weekly plan both use it.
 *
 * Behaviour, in one place:
 * - Account field: searchable accounts; an Individual one reads "Name - Individual".
 * - Contact field (optional): with no account, every contact in the feed
 *   (subtitle = their primary account); with an account, only that account's
 *   ACTIVE people (subtitle = role) plus "No one specific".
 * - Pick a Company account: the contact list narrows to its people, and a
 *   contact who is not linked to it is cleared.
 * - Pick an Individual account: the contact becomes its Self person and the
 *   field is locked ("the person is the account").
 * - Pick a contact first: one account fills the account field; several narrow
 *   the account field to those accounts and ask - never guessed; none leaves
 *   the contact alone (saved without an account only if `allowContactOnly`).
 */

export type AccountContactValue = { accountId: string; contactId: string }

export type PickerAccount = {
  id: string
  name: string
  type?: string | null
  stage?: string | null
  account_kind?: 'Company' | 'Individual'
}

export type PickerContactAccount = { id: string; name: string; type?: string | null; is_primary?: boolean }

export type PickerContact = {
  id: string
  name: string
  designation?: string | null
  /** Primary first, as `/api/contacts` returns them. */
  companies?: PickerContactAccount[]
}

type LinkRow = {
  contact_id: string
  contact_name: string | null
  role_name: string | null
  is_active: boolean
  is_primary?: boolean
  is_self?: boolean
}

type Load<T> = { state: 'loading' } | { state: 'ready'; rows: T[] } | { state: 'error' } | { state: 'forbidden' }

/** Option id of the "No one specific" row, which clears the contact. */
export const NO_CONTACT_ID = '__no_contact'

const MAX_RESULTS = 50
const TIMEOUT_MS = 15_000

export type UseAccountContactPickerOptions = {
  value: AccountContactValue
  onChange: (next: AccountContactValue) => void
  /** Accounts feed. Meetings pass `/api/business-partners?status=all&mine=1`. */
  accountsUrl?: string
  /** Contacts feed (people with no account chosen). Meetings pass `/api/contacts?mine=1`. */
  contactsUrl?: string
  /** A contact with no account at all may be saved on its own. */
  allowContactOnly?: boolean
  /** Accounts known to the caller that the feed may not list (e.g. a prefill). */
  extraAccounts?: PickerAccount[]
  /** Load only while true (a dialog's `open`). Default true. */
  enabled?: boolean
  /**
   * A contact-only value that was SAVED earlier (an edit dialog). It stays
   * saveable for an `allowContactOnly` caller even if the person has since been
   * linked to an account, or is outside this user's contact feed, and `name` is
   * shown until the feed knows them. A person picked fresh does not get this.
   */
  storedContact?: { id: string; name: string } | null
}

function asRows<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[]
  const rows = (d as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

/** How an account reads in a list. Individuals are always marked; a funnel
 *  stage (Lead...) is shown when there is one. */
export function accountLabel(a: PickerAccount): string {
  const suffix =
    a.account_kind === 'Individual' ? 'Individual' : a.stage && a.stage !== 'Existing' ? a.stage : null
  return suffix ? `${a.name} · ${suffix}` : a.name
}

export function useAccountContactPicker(opts: UseAccountContactPickerOptions) {
  const {
    value,
    accountsUrl = '/api/companies?fields=picker',
    contactsUrl = '/api/contacts',
    allowContactOnly = false,
    extraAccounts,
    enabled = true,
    storedContact = null,
  } = opts

  // The latest value/onChange, so effects can write without re-running on
  // every parent render.
  const latest = useRef({ value, onChange: opts.onChange })
  latest.current = { value, onChange: opts.onChange }
  const emit = useCallback((next: AccountContactValue) => latest.current.onChange(next), [])

  const [accounts, setAccounts] = useState<Load<PickerAccount>>({ state: 'loading' })
  const [accountsReload, setAccountsReload] = useState(0)
  const [contacts, setContacts] = useState<Load<PickerContact>>({ state: 'loading' })
  const [contactsReload, setContactsReload] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    setAccounts({ state: 'loading' })
    fetch(accountsUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async r => {
        if (!live) return
        if (!r.ok) { setAccounts({ state: 'error' }); return }
        setAccounts({ state: 'ready', rows: asRows<PickerAccount>(await r.json()) })
      })
      .catch(() => { if (live) setAccounts({ state: 'error' }) })
    return () => { live = false }
  }, [accountsUrl, enabled, accountsReload])

  useEffect(() => {
    if (!enabled) return
    let live = true
    setContacts({ state: 'loading' })
    fetch(contactsUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async r => {
        if (!live) return
        // No permission to read the contact book is not a fault: the contact
        // field then offers only the chosen account's people.
        if (r.status === 403) { setContacts({ state: 'forbidden' }); return }
        if (!r.ok) { setContacts({ state: 'error' }); return }
        setContacts({ state: 'ready', rows: asRows<PickerContact>(await r.json()) })
      })
      .catch(() => { if (live) setContacts({ state: 'error' }) })
    return () => { live = false }
  }, [contactsUrl, enabled, contactsReload])

  const accountRows = useMemo(() => {
    const rows = accounts.state === 'ready' ? accounts.rows : []
    const extra = (extraAccounts ?? []).filter(e => !rows.some(r => r.id === e.id))
    return [...extra, ...rows]
  }, [accounts, extraAccounts])
  const contactRows = useMemo(() => (contacts.state === 'ready' ? contacts.rows : []), [contacts])

  const selectedAccount = useMemo(
    () => accountRows.find(a => a.id === value.accountId) ?? null,
    [accountRows, value.accountId]
  )
  const individual = selectedAccount?.account_kind === 'Individual'

  // The chosen account's people.
  const [links, setLinks] = useState<{ accountId: string; state: 'loading' | 'ready' | 'error'; rows: LinkRow[] }>({
    accountId: '', state: 'loading', rows: [],
  })
  const [linksReload, setLinksReload] = useState(0)
  useEffect(() => {
    if (!enabled || !value.accountId) return
    let live = true
    const accountId = value.accountId
    setLinks({ accountId, state: 'loading', rows: [] })
    fetch(`/api/companies/${accountId}/links`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: LinkRow[]) => { if (live) setLinks({ accountId, state: 'ready', rows: Array.isArray(rows) ? rows : [] }) })
      .catch(() => { if (live) setLinks({ accountId, state: 'error', rows: [] }) })
    return () => { live = false }
  }, [enabled, value.accountId, linksReload])

  const linksForAccount = links.accountId === value.accountId && !!value.accountId
  const linksReady = linksForAccount && links.state === 'ready'
  const activeLinks = useMemo(
    () => (linksReady ? links.rows.filter(l => l.is_active !== false) : []),
    [linksReady, links.rows]
  )
  const selfLink = useMemo(
    () => (individual ? activeLinks.find(l => l.is_self) ?? activeLinks.find(l => l.is_primary) ?? null : null),
    [individual, activeLinks]
  )

  const selectedContact: PickerContact | null = useMemo(() => {
    if (!value.contactId) return null
    const fromFeed = contactRows.find(c => c.id === value.contactId)
    if (fromFeed) return fromFeed
    const link = activeLinks.find(l => l.contact_id === value.contactId)
    if (link) return { id: link.contact_id, name: link.contact_name ?? '—' }
    if (!value.accountId && storedContact && storedContact.id === value.contactId) {
      return { id: storedContact.id, name: storedContact.name }
    }
    return null
  }, [value.contactId, value.accountId, contactRows, activeLinks, storedContact])

  /** Every account the chosen contact is linked to, primary first. */
  const selectedContactAccounts: PickerContactAccount[] = selectedContact?.companies ?? []

  /** Individual account whose Self person is the chosen contact: contact is locked. */
  const lockedToSelf = !!selfLink && value.contactId === selfLink.contact_id

  // Contact first, several accounts: the account field is narrowed to them.
  const narrowedAccountIds: Set<string> | null =
    !value.accountId && selectedContact && selectedContactAccounts.length > 1
      ? new Set(selectedContactAccounts.map(c => c.id))
      : null
  const accountChoiceRequired = narrowedAccountIds !== null
  const contactOnly =
    !value.accountId && !!selectedContact && contactRows.length > 0 && selectedContactAccounts.length === 0
  /** A saved person-only value being edited: it keeps saving even if they now have accounts. */
  const storedContactOnly =
    allowContactOnly && !value.accountId && !!value.contactId && storedContact?.id === value.contactId
  /** That person has since been linked to an account: offer it, never require it. */
  const suggestAccount = storedContactOnly && selectedContactAccounts.length > 0
  const needsAccount =
    !value.accountId && !!value.contactId && !(allowContactOnly && contactOnly) && !storedContactOnly
  /** True when the pair can be saved: an account, or (if allowed) a person with none. */
  const complete =
    !!value.accountId || (!!value.contactId && allowContactOnly && (contactOnly || storedContactOnly))

  // An Individual's contact is always their Self person.
  useEffect(() => {
    if (!linksReady || !individual || !selfLink || value.contactId) return
    emit({ accountId: value.accountId, contactId: selfLink.contact_id })
  }, [linksReady, individual, selfLink, value.accountId, value.contactId, emit])

  // A contact who is not an active person of the chosen account is cleared.
  useEffect(() => {
    if (!linksReady || !value.contactId) return
    if (activeLinks.some(l => l.contact_id === value.contactId)) return
    emit({ accountId: value.accountId, contactId: '' })
  }, [linksReady, activeLinks, value.accountId, value.contactId, emit])

  const pickAccount = useCallback(
    (id: string) => {
      const v = latest.current.value
      const acc = accountRows.find(a => a.id === id)
      if (!acc) return
      if (acc.account_kind === 'Individual') {
        emit({ accountId: id, contactId: '' }) // the effect fills the Self person
        return
      }
      const contact = contactRows.find(c => c.id === v.contactId)
      // Keep the contact only if the feed says they belong to this account (or
      // does not know them - the links check then decides).
      const stays = !contact || !contact.companies || contact.companies.some(c => c.id === id)
      emit({ accountId: id, contactId: stays ? v.contactId : '' })
    },
    [accountRows, contactRows, emit]
  )

  const pickContact = useCallback(
    (id: string) => {
      const v = latest.current.value
      if (!id || id === NO_CONTACT_ID) { emit({ accountId: v.accountId, contactId: '' }); return }
      if (v.accountId) { emit({ accountId: v.accountId, contactId: id }); return }
      const accs = contactRows.find(c => c.id === id)?.companies ?? []
      emit({ accountId: accs.length === 1 ? accs[0].id : '', contactId: id })
    },
    [contactRows, emit]
  )

  // The account list, narrowed when a contact with several accounts came first.
  const accountOptions: PickerAccount[] = useMemo(
    () => (narrowedAccountIds ? accountRows.filter(a => narrowedAccountIds.has(a.id)) : accountRows),
    // narrowedAccountIds is rebuilt each render; key it on its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountRows, [...(narrowedAccountIds ?? [])].join(',')]
  )

  return {
    value,
    allowContactOnly,
    accountsState: accounts.state,
    contactsState: contacts.state,
    reloadAccounts: () => setAccountsReload(n => n + 1),
    reloadContacts: () => setContactsReload(n => n + 1),
    reloadLinks: () => setLinksReload(n => n + 1),
    accountOptions,
    contactRows,
    /** Active people of the chosen account (empty until loaded / with no account). */
    accountPeople: activeLinks,
    linksState: !value.accountId ? ('idle' as const) : linksForAccount ? links.state : ('loading' as const),
    selectedAccount,
    individual,
    selectedContact,
    selectedContactAccounts,
    lockedToSelf,
    accountChoiceRequired,
    suggestAccount,
    contactOnly,
    needsAccount,
    complete,
    pickAccount,
    pickContact,
  }
}

export type AccountContactPicker = ReturnType<typeof useAccountContactPicker>

export function AccountContactFields({
  picker,
  disabled,
  accountError,
  contactError,
  accountLabelText = 'Account',
  contactLabelText = 'Contact',
  accountRequired,
  accountAction,
  contactOnlyAction,
  idPrefix = 'acf',
}: {
  picker: AccountContactPicker
  disabled?: boolean
  accountError?: string
  contactError?: string
  accountLabelText?: string
  contactLabelText?: string
  /** Show the required asterisk on the account label (phone). */
  accountRequired?: boolean
  /** Sits beside the account label (e.g. "New account"). */
  accountAction?: ReactNode
  /** Shown when the chosen contact has no account and `allowContactOnly` is on
   *  (e.g. "Make Individual account"). */
  contactOnlyAction?: ReactNode
  idPrefix?: string
}) {
  const { layout } = useLayout()
  const phone = layout === 'phone'
  const p = picker
  const hasAccount = !!p.value.accountId

  const contactDisabled = disabled || p.lockedToSelf
  const accountsLoading = p.accountsState === 'loading'

  const accountHint = p.suggestAccount
    ? 'This person now has an account. You can pick one, or keep the line with them alone.'
    : p.accountChoiceRequired
    ? 'This person is linked to more than one account. Pick which one this is for.'
    : p.needsAccount
      ? 'This person is not linked to any account. Pick an account to continue.'
      : null
  const contactHint = p.lockedToSelf
    ? 'Individual account — the person is the account.'
    : p.contactOnly && p.allowContactOnly
      ? 'This person is not linked to any account, so it is saved with them alone.'
      : null

  const accountFeedback = (
    <>
      {accountError ? <p className="text-meta text-danger">{accountError}</p> : null}
      {p.accountsState === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InlineFieldError className="mt-0">The accounts could not be loaded.</InlineFieldError>
          <Button variant="secondary" size="sm" type="button" onClick={p.reloadAccounts}>Try again</Button>
        </div>
      ) : accountHint ? (
        <p className="text-meta text-text-muted">{accountHint}</p>
      ) : null}
    </>
  )
  const contactFeedback = (
    <>
      {contactError ? <p className="text-meta text-danger">{contactError}</p> : null}
      {p.contactsState === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InlineFieldError className="mt-0">
            The contacts could not be loaded{hasAccount ? ', so only this account’s people are listed' : ''}.
          </InlineFieldError>
          <Button variant="secondary" size="sm" type="button" onClick={p.reloadContacts}>Retry</Button>
        </div>
      ) : p.linksState === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InlineFieldError className="mt-0">This account&apos;s people could not be loaded.</InlineFieldError>
          <Button variant="secondary" size="sm" type="button" onClick={p.reloadLinks}>Retry</Button>
        </div>
      ) : contactHint ? (
        <p className="text-meta text-text-muted">{contactHint}</p>
      ) : null}
      {p.contactOnly && p.allowContactOnly ? contactOnlyAction : null}
    </>
  )

  if (phone) {
    return (
      <PhonePair
        p={p}
        disabled={disabled}
        contactDisabled={contactDisabled}
        accountsLoading={accountsLoading}
        accountLabelText={accountLabelText}
        contactLabelText={contactLabelText}
        accountRequired={accountRequired}
        accountAction={accountAction}
        accountFeedback={accountFeedback}
        contactFeedback={contactFeedback}
      />
    )
  }

  // Desktop. Contact options: the account's people, or every contact.
  const contactOptions: Record<string, string> = {}
  if (hasAccount) {
    contactOptions[NO_CONTACT_ID] = 'No one specific'
    for (const l of p.accountPeople) {
      contactOptions[l.contact_id] = l.role_name ? `${l.contact_name ?? '—'} · ${l.role_name}` : l.contact_name ?? '—'
    }
  } else {
    for (const c of p.contactRows) {
      const primary = c.companies?.[0]?.name
      contactOptions[c.id] = primary ? `${c.name} · ${primary}` : c.name
    }
  }
  // The chosen person must always have a label, even before the list loads.
  if (p.value.contactId && !contactOptions[p.value.contactId] && p.selectedContact) {
    contactOptions[p.value.contactId] = p.selectedContact.name
  }
  const accountOptions: Record<string, string> = Object.fromEntries(p.accountOptions.map(a => [a.id, accountLabel(a)]))
  if (p.value.accountId && !accountOptions[p.value.accountId] && p.selectedAccount) {
    accountOptions[p.value.accountId] = accountLabel(p.selectedAccount)
  }

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <Label htmlFor={`${idPrefix}-account`}>{accountLabelText}</Label>
          {accountAction}
        </div>
        {accountsLoading ? (
          <Skeleton className="h-control w-full" />
        ) : (
          <SearchableSelect
            id={`${idPrefix}-account`}
            className="max-w-none"
            options={accountOptions}
            value={p.value.accountId}
            onValueChange={p.pickAccount}
            placeholder={p.accountChoiceRequired ? 'Pick one of this person’s accounts' : 'Search an account'}
            emptyMessage="No account matches that search."
            disabled={disabled}
          />
        )}
        {accountFeedback}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-contact`}>{contactLabelText}</Label>
        {accountsLoading || (p.contactsState === 'loading' && !hasAccount) ? (
          <Skeleton className="h-control w-full" />
        ) : (
          <SearchableSelect
            id={`${idPrefix}-contact`}
            className="max-w-none"
            options={contactOptions}
            value={p.value.contactId}
            onValueChange={p.pickContact}
            placeholder={hasAccount ? 'No one specific' : 'Search a contact (optional)'}
            emptyMessage={hasAccount ? 'No one at this account matches that search.' : 'No contact matches that search.'}
            disabled={contactDisabled}
          />
        )}
        {contactFeedback}
      </div>
    </>
  )
}

function PhonePair({
  p,
  disabled,
  contactDisabled,
  accountsLoading,
  accountLabelText,
  contactLabelText,
  accountRequired,
  accountAction,
  accountFeedback,
  contactFeedback,
}: {
  p: AccountContactPicker
  disabled?: boolean
  contactDisabled?: boolean
  accountsLoading: boolean
  accountLabelText: string
  contactLabelText: string
  accountRequired?: boolean
  accountAction?: ReactNode
  accountFeedback: ReactNode
  contactFeedback: ReactNode
}) {
  const hasAccount = !!p.value.accountId

  const accountValue: PickerOption | null = p.selectedAccount
    ? { id: p.selectedAccount.id, label: accountLabel(p.selectedAccount) }
    : null
  const fetchAccounts = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const needle = q.trim().toLowerCase()
      return p.accountOptions
        .filter(a => !needle || a.name.toLowerCase().includes(needle))
        .slice(0, MAX_RESULTS)
        .map(a => ({ id: a.id, label: accountLabel(a), sublabel: a.type || undefined }))
    },
    [p.accountOptions]
  )

  const contactValue: PickerOption | null = p.selectedContact
    ? { id: p.selectedContact.id, label: p.selectedContact.name }
    : null
  const accountPeople = p.accountPeople
  const contactRows = p.contactRows
  const fetchContacts = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const needle = q.trim().toLowerCase()
      const rows: PickerOption[] = hasAccount
        ? accountPeople.map(l => ({ id: l.contact_id, label: l.contact_name ?? '—', sublabel: l.role_name || undefined }))
        : contactRows.map(c => ({ id: c.id, label: c.name, sublabel: c.companies?.[0]?.name }))
      const hits = rows.filter(o => !needle || o.label.toLowerCase().includes(needle)).slice(0, MAX_RESULTS)
      return hasAccount && !needle ? [{ id: NO_CONTACT_ID, label: 'No one specific' }, ...hits] : hits
    },
    [hasAccount, accountPeople, contactRows]
  )

  return (
    <>
      <PhoneFormField label={accountLabelText} required={accountRequired}>
        {accountsLoading ? (
          <Skeleton className="h-11 w-full" />
        ) : (
          <PickerSheetField
            label={accountLabelText}
            placeholder={p.accountChoiceRequired ? 'Pick one of this person’s accounts' : 'Search an account'}
            value={accountValue}
            onChange={o => p.pickAccount(o.id)}
            fetchOptions={fetchAccounts}
            disabled={disabled}
          />
        )}
        {accountFeedback}
        {accountAction}
      </PhoneFormField>

      <PhoneFormField label={contactLabelText}>
        {accountsLoading || (p.contactsState === 'loading' && !hasAccount) ? (
          <Skeleton className="h-11 w-full" />
        ) : p.lockedToSelf ? (
          <StaticPickerSheetField
            label={contactLabelText}
            value={contactValue}
            onChange={() => {}}
            options={contactValue ? [contactValue] : []}
            disabled
          />
        ) : (
          <PickerSheetField
            label={contactLabelText}
            placeholder={hasAccount ? 'No one specific' : 'Search a contact (optional)'}
            value={contactValue}
            onChange={o => p.pickContact(o.id)}
            fetchOptions={fetchContacts}
            disabled={contactDisabled}
          />
        )}
        {contactFeedback}
      </PhoneFormField>
    </>
  )
}
