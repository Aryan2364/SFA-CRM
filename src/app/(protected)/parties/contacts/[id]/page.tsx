'use client'

/**
 * P1-T15 — the Contact detail page. `REBUILD-PLAN.md` §3.2 / §3.4.
 *
 * §3.2: "Clicking a Contact opens the Contact page, which shows the Companies
 * it is linked to." **Plural.** That is the whole reason this page exists: a
 * Contact belongs to MANY Companies (§3.4), and until now nothing in the
 * product ever showed that — the Parties list shows one company per row, and
 * the Company page shows its own contacts in the other direction. A person who
 * buys for three dealers is only visible as one person HERE.
 *
 * So the Companies card is a LIST, not a field, even when it holds one entry,
 * and it sits in the wide column. The §3.4 consequence — a Deal cannot
 * auto-fill the Company when a Contact has more than one — is a Phase 2 screen,
 * but the count this page shows is the thing that will make it make sense.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ON `templates/list-page.tsx`
 *
 * Same reason as the Company page: that template is a list screen. It declares
 * `h-full`, divides a definite height between four zones and gives zone 3 the
 * only scrollbar. A detail page wants the opposite — it grows and the page
 * scrolls. `AppShell`'s content wrapper is already `h-full overflow-y-auto`, so
 * this page is plain flow content inside it.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACK ARROW
 *
 * AGENTS.md §1 rule 11: a back button does something different depending on how
 * the user arrived, which is what makes people feel lost. The breadcrumb
 * replaces it and reflects the structure of the software, not the history. Its
 * SHAPE is fixed ("Parties › <this contact>") while its href carries the list's
 * own query string when the list handed one over as `?from=`, so returning to
 * the list keeps the filters. Anything that is not a relative path under
 * `/parties` is ignored — a crafted `from` cannot turn the breadcrumb into an
 * off-site link. Identical rule to `parties/companies/[id]`.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  BuildingIcon,
  CakeIcon,
  EllipsisIcon,
  HeartIcon,
  PhoneIcon,
  StarIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { LEAD_STAGE, StatusBadge, USER_STATUS } from '@/components/status-badge'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { EMPTY, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { IndividualConflictDialog, type IndividualConflict } from '../../individual-conflict-dialog'

// ─────────────────────────────────────────────────────────────
// The wire shape
//
// Read off `src/app/api/contacts/[id]/_handlers.ts` and `../_shape.ts`: a bare
// object, no envelope, with the contact's own columns plus three embeds —
// `contact_types`, `owner` (renamed from the `users` relation) and `companies`.
//
// `companies` carries exactly what `shapeContact()` flattens out of the join
// rows: the company's `id`/`name`/`type`/`stage`, plus `is_primary` and
// `link_id`, which belong to the LINK and not to the person. A contact can be
// the primary contact at one company and not at another, which is why
// `is_primary` is here and not a column on `contacts`. Already sorted primary
// first, then alphabetical.
// ─────────────────────────────────────────────────────────────

type NamedRef = { id?: string; name: string }

type LinkedCompany = {
  id: string
  name: string
  type: string | null
  stage: string | null
  /** Of the link, not of the person. */
  is_primary: boolean
  link_id: string
  /**
   * False only for someone who reaches this contact through a SHARED account
   * and may not open this other account (src/lib/sharing.ts). Absent from an
   * older response; only `false` drops the link.
   */
  can_open?: boolean
}

type Contact = {
  id: string
  name: string
  mobile: string
  alternate_mobile: string | null
  /** Null until set, and until the column exists (src/lib/party-landline.ts). */
  landline?: string | null
  whatsapp: string | null
  email: string | null
  designation: string | null
  birthday: string | null
  anniversary: string | null
  notes: string | null
  is_active: boolean
  created_at: string | null
  contact_types: NamedRef | null
  owner: NamedRef | null
  companies: LinkedCompany[]
  /**
   * docs/accounts-contacts-spec.md §2: a contact with no mobile is marked
   * incomplete. Computed read-time by `shapeContact()`
   * (src/app/api/contacts/_shape.ts) — `completeness_missing` is a single
   * string naming the one field the spec tracks ("Mobile Number"), not an
   * array; this page reads it as the route actually returns it.
   */
  is_complete: boolean
  completeness_missing: string | null
  /**
   * How the caller reaches this contact, decided by the server: through their
   * own scope, or because an account it belongs to was shared with them at
   * 'work' or 'view' (src/lib/sharing.ts). This page has no write controls of
   * its own (the contact is changed from the Accounts list), so a 'view' share
   * needs nothing disabled here; it is SAID, so the reader knows.
   */
  access?: 'owner-scope' | 'work' | 'view'
}

/** A failed load, told apart so the empty state can say the right thing. */
type LoadError = 'not-found' | 'forbidden' | 'failed'

// ─────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────

/**
 * One label/value pair in a details card. The label is the quiet half and the
 * value the loud one — global rule 1, and §2.3's `text-secondary` is the
 * lightest thing allowed to carry a label. Same component the Company page
 * defines; both are four lines of markup and neither is worth a shared file
 * until a third page wants it.
 */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-text-primary">{children}</dd>
    </div>
  )
}

/** `—` for absent, never a blank cell and never "null". */
function orEmpty(value: string | null | undefined) {
  return value && value.trim() !== '' ? value : EMPTY
}

/**
 * A phone number as a tap-to-call link — field sales read this page standing in
 * front of the customer. `min-h-11` is the 44px touch minimum; an anchor that
 * only wraps ten digits is a 20px target on a phone.
 */
function PhoneValue({ number }: { number: string | null }) {
  if (!number || number.trim() === '') return <>{EMPTY}</>
  return (
    <a
      className={cn(
        'inline-flex min-h-11 items-center text-primary hover:text-primary-hover',
        'rounded-lg outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
      )}
      // The dial string drops spaces and hyphens a landline is typed with;
      // the text keeps them.
      href={`tel:${number.replace(/[\s-]/g, '')}`}
    >
      {number}
    </a>
  )
}

/**
 * "Primary" is a MARKER, not a status: it says which of several links is the
 * one the system reads, and it is on no axis `status-badge.tsx` carries. So it
 * is the kit `Badge` directly — the same component that file renders through.
 */
function PrimaryMarker() {
  return (
    <Badge>
      <StarIcon />
      Primary
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────

function ContactDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const id = params?.id ?? ''

  const [contact, setContact] = useState<Contact | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)

  /*
   * Where the breadcrumb's first level points. A relative path under `/parties`
   * only: `//evil.example` and `https://…` are both rejected, so a link the
   * user did not choose cannot be smuggled in through the URL.
   */
  const from = searchParams.get('from')
  const listHref =
    from && from.startsWith('/parties') && !from.startsWith('//') ? from : '/parties'

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/${id}`, { cache: 'no-store' })
      if (res.status === 404) {
        setError('not-found')
        return
      }
      if (res.status === 403) {
        setError('forbidden')
        return
      }
      if (!res.ok) {
        setError('failed')
        return
      }
      setContact((await res.json()) as Contact)
    } catch {
      setError('failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const companies = contact?.companies ?? []

  /*
   * §26: real permissions, never a hardcoded role — read the same way
   * `deals/page.tsx` and `deal-status.tsx` do. `me === null` is "not known
   * yet" (section 26.1), not "not allowed", so every gate below treats it as
   * allowed-for-now and `PermissionTooltip` only attaches a reason once the
   * answer has actually landed.
   *
   * "Make Individual account" POSTs to `/api/contacts/[id]/make-individual`,
   * which checks `companies.create` (it creates an Individual account) plus
   * read access to the contact — so the gate here is `companies.create`, not
   * `contacts.edit`. Delete is gated on `contacts.delete`, what
   * `DELETE /api/contacts/[id]` itself checks.
   */
  const me = useMe()
  const canMakeIndividual =
    me?.role === 'Administrator' || (me?.permissions?.companies?.create ?? false)
  const canDeleteContact =
    me?.role === 'Administrator' || (me?.permissions?.contacts?.delete ?? false)

  const { toast } = useToast()

  // "Make Individual account" — success navigates straight to the new
  // account; a 409 (already Self somewhere) opens a styled dialog linking to
  // the existing one instead of a raw error.
  const [makingIndividual, setMakingIndividual] = useState(false)
  const [individualConflict, setIndividualConflict] = useState<IndividualConflict | null>(null)

  async function makeIndividual() {
    if (!id || makingIndividual) return
    setMakingIndividual(true)
    try {
      const res = await fetch(`/api/contacts/${id}/make-individual`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        const created = data as { id: string }
        router.push(`/parties/companies/${created.id}`)
        return
      }
      if (res.status === 409) {
        const body = data as { error?: string; existing_account_id?: string }
        setIndividualConflict({
          message: body.error ?? 'This person is already the Self contact of another account.',
          existingAccountId: body.existing_account_id,
        })
        return
      }
      toast((data as { error?: string }).error ?? 'Could not create an Individual account.', 'error')
    } catch {
      toast('The connection dropped. Nothing was created.', 'error')
    } finally {
      setMakingIndividual(false)
    }
  }

  /**
   * Delete, per `DELETE /api/contacts/[id]` (see the route's own comments):
   *   - 409 naming an Individual account this contact is Self for → blocked,
   *     no confirm option — deletion is refused, not just warned about.
   *   - 409 "this contact has history" → the same blocked shape; the message
   *     IS the reason, nothing to list.
   *   - 409 `confirm_required` with `linked_accounts` → a dry run; show them
   *     and let the user confirm with `?confirm=1`.
   *   - No linked accounts and no block → the first call already deletes it.
   */
  type DeleteState =
    | { stage: 'blocked'; message: string; selfAccountId?: string }
    | { stage: 'confirm'; linkedAccounts: { id: string; name: string }[] }
    | null
  const [deleteState, setDeleteState] = useState<DeleteState>(null)
  const [deleting, setDeleting] = useState(false)

  async function startDelete() {
    if (!id || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast('Contact deleted.', 'success')
        router.push(listHref)
        return
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        linked_accounts?: { id: string; name: string }[]
        self_account_id?: string
      }
      if (res.status === 409 && data.error === 'confirm_required') {
        setDeleteState({ stage: 'confirm', linkedAccounts: data.linked_accounts ?? [] })
        return
      }
      setDeleteState({
        stage: 'blocked',
        message: data.error ?? 'This contact cannot be deleted.',
        selfAccountId: data.self_account_id,
      })
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDelete() {
    if (!id || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${id}?confirm=1`, { method: 'DELETE' })
      if (res.ok) {
        toast('Contact deleted.', 'success')
        setDeleteState(null)
        router.push(listHref)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      toast(data.error ?? 'Could not delete this contact.', 'error')
      setDeleteState(null)
    } catch {
      toast('The connection dropped. Nothing was deleted.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* Section 11.2: the breadcrumb is the first element on a detail page. */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={listHref} />}>Accounts</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{contact?.name ?? 'Contact'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <ContactSkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This contact is not here"
              actionLabel="Go to Accounts"
              onAction={() => router.push(listHref)}
            >
              It may have been deleted, or the link may point at a record in a
              different firm. The Accounts list shows everything you can open.
            </EmptyState>
          )}
          {error === 'forbidden' && (
            <EmptyState
              variant="failed"
              heading="You cannot open contacts"
              actionLabel="Go to Accounts"
              onAction={() => router.push(listHref)}
            >
              Your role does not include viewing contacts. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The contact could not be loaded"
              onAction={() => void load()}
            >
              The connection dropped while fetching it. Nothing has changed.
            </EmptyState>
          )}
        </div>
      )}

      {!loading && !error && contact && (
        <>
          {/*
            Global rule 1 and the header rule for this task: the Contact Name is
            the largest text and comes first; the designation and the company
            COUNT sit below it, smaller.

            The count is written here and nowhere else. The Companies card below
            could carry the same number as a badge on its title — the Company
            page's Contacts card does — but global rule 4 is "say it once", and
            of the two places this is the one the task pins down. It is also the
            more useful one: "Linked to 3 companies" read next to the name is
            the §3.4 fact; a bare "3" on a card the user is already looking at
            is not.

            `flex-wrap` rather than a fixed row — on a phone the meta items wrap
            to as many lines as they need instead of shrinking.
          */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <h1 className="text-page-title font-medium text-text-primary">
                {contact.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
                <span>{orEmpty(contact.designation)}</span>
                <span aria-hidden="true" className="text-text-muted">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BuildingIcon className="size-icon shrink-0" aria-hidden="true" />
                  {companies.length === 0
                    ? 'No company linked'
                    : `Linked to ${companies.length} ${
                        companies.length === 1 ? 'company' : 'companies'
                      }`}
                </span>
                {/*
                  §3.4's Status field is Active/Inactive. `status-badge.tsx` has
                  no CONTACT_STATUS, and that file is owned by another agent
                  this run — it is read here, never edited. USER_STATUS is the
                  product's one Active/Inactive vocabulary and it fits a contact
                  better than it fits anything else: its roles are the ones a
                  person's status takes, and its two icons are person-shaped,
                  which a contact IS. No new vocabulary is needed.
                */}
                <StatusBadge
                  vocabulary={USER_STATUS}
                  status={contact.is_active ? 'Active' : 'Inactive'}
                />
                {(contact.access === 'work' || contact.access === 'view') && (
                  <Badge>
                    {contact.access === 'work'
                      ? 'Shared with you: can work'
                      : 'Shared with you: view only'}
                  </Badge>
                )}
                {/*
                  docs/accounts-contacts-spec.md §2: a contact missing its
                  mobile is Incomplete, read-time from `completeness_missing`
                  rather than re-derived here (global rule: say it once, and
                  the server owns what "complete" means).
                */}
                {!contact.is_complete && (
                  <Badge variant="warning">
                    Incomplete{contact.completeness_missing ? `: ${contact.completeness_missing}` : ''}
                  </Badge>
                )}
              </div>
            </div>

            {/*
              Global rule 4: actions sit next to what they control, grouped on
              one row. The number in the header is the number you ring; the
              ⋮ menu holds everything else (section 11.2) — Make Individual
              account and Delete — gated on the real permission each route
              checks, never a hardcoded role. Full width on a phone.
            */}
            <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
              {contact.mobile && (
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  render={<a href={`tel:${contact.mobile}`} />}
                >
                  <PhoneIcon />
                  Call {contact.mobile}
                </Button>
              )}
              <ContactActionsMenu
                contactName={contact.name}
                canMakeIndividual={me === null || canMakeIndividual}
                makeIndividualKnown={me !== null}
                canDelete={me === null || canDeleteContact}
                deleteKnown={me !== null}
                makingIndividual={makingIndividual}
                deleting={deleting}
                onMakeIndividual={() => void makeIndividual()}
                onDelete={() => void startDelete()}
              />
            </div>
          </header>

          {/*
            Global rule 2: the content uses the width it is given. One column on
            a phone, two from 1024 up, with the companies — the reason the page
            exists — in the wider half and the field values beside them.
          */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <CompaniesCard companies={companies} />

              {contact.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-body text-text-primary">
                      {contact.notes}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Designation">
                      {orEmpty(contact.designation)}
                    </Field>
                    <Field label="Contact type">
                      {orEmpty(contact.contact_types?.name)}
                    </Field>
                    <Field label="Owner">{orEmpty(contact.owner?.name)}</Field>
                    <Field label="Mobile number">
                      <PhoneValue number={contact.mobile} />
                    </Field>
                    <Field label="Alternate number">
                      <PhoneValue number={contact.alternate_mobile} />
                    </Field>
                    <Field label="Landline">
                      <PhoneValue number={contact.landline ?? null} />
                    </Field>
                    {/*
                      §3.4: "WhatsApp Number — if different from mobile." When
                      it is the same number the row says nothing new, so the
                      field says that rather than printing the digits twice
                      (global rule 4).
                    */}
                    <Field label="WhatsApp number">
                      {contact.whatsapp && contact.whatsapp === contact.mobile ? (
                        <span className="text-text-secondary">Same as mobile</span>
                      ) : (
                        <PhoneValue number={contact.whatsapp} />
                      )}
                    </Field>
                    <Field label="Email">
                      {contact.email ? (
                        <a
                          className={cn(
                            'inline-flex min-h-11 items-center text-primary hover:text-primary-hover',
                            'rounded-lg outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
                          )}
                          href={`mailto:${contact.email}`}
                        >
                          {contact.email}
                        </a>
                      ) : (
                        EMPTY
                      )}
                    </Field>
                    {/*
                      Both are `@db.Date`. `fmtDate` goes through
                      `parseApiDate`, which reads "YYYY-MM-DD" by its parts — a
                      birthday must not slip to the previous day because the
                      browser is west of UTC.
                    */}
                    <Field label="Birthday">
                      <span className="inline-flex items-center gap-1.5">
                        <CakeIcon
                          className="size-icon shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                        {fmtDate(contact.birthday)}
                      </span>
                    </Field>
                    <Field label="Anniversary">
                      <span className="inline-flex items-center gap-1.5">
                        <HeartIcon
                          className="size-icon shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                        {fmtDate(contact.anniversary)}
                      </span>
                    </Field>
                    <Field label="Created">{fmtDate(contact.created_at)}</Field>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Section 7's rule for a dialog overlay: native confirm()/alert() are
          never used — both outcomes of these two actions are styled dialogs. */}
      <IndividualConflictDialog
        conflict={individualConflict}
        onOpenChange={open => { if (!open) setIndividualConflict(null) }}
      />

      {/* Deletion is BLOCKED, not just warned about, so this carries no
          confirm option — only a way out. When the block is "already Self
          elsewhere", a link to that account is the way out that matters. */}
      <Dialog
        open={deleteState?.stage === 'blocked'}
        onOpenChange={open => { if (!open) setDeleteState(null) }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>This contact cannot be deleted</DialogTitle>
            <DialogDescription>
              {deleteState?.stage === 'blocked' ? deleteState.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Close</Button>} />
            {deleteState?.stage === 'blocked' && deleteState.selfAccountId ? (
              <Button render={<Link href={`/parties/companies/${deleteState.selfAccountId}`} />}>
                Go to that account
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The dry-run 409: list what this delete will unlink, then let the
          user actually confirm it. */}
      <Dialog
        open={deleteState?.stage === 'confirm'}
        onOpenChange={open => { if (!open) setDeleteState(null) }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {contact?.name}?</DialogTitle>
            <DialogDescription>
              This also removes {contact?.name} from the account{
                deleteState?.stage === 'confirm' && deleteState.linkedAccounts.length === 1 ? '' : 's'
              } below. The contact is deactivated, not erased.
            </DialogDescription>
          </DialogHeader>
          {deleteState?.stage === 'confirm' && deleteState.linkedAccounts.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-border-light bg-surface-control px-3 py-2">
              {deleteState.linkedAccounts.map(a => (
                <li key={a.id} className="text-body text-text-primary">
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The ⋮ menu (section 11.2): Make Individual account and Delete, each gated
 * on the exact permission its route checks (see `ContactDetail` above) and
 * disabled-with-a-reason rather than hidden, per the kit.
 */
function ContactActionsMenu({
  contactName,
  canMakeIndividual,
  makeIndividualKnown,
  canDelete,
  deleteKnown,
  makingIndividual,
  deleting,
  onMakeIndividual,
  onDelete,
}: {
  contactName: string
  canMakeIndividual: boolean
  /** Whether the permission check has actually landed yet (section 26.1). */
  makeIndividualKnown: boolean
  canDelete: boolean
  deleteKnown: boolean
  makingIndividual: boolean
  deleting: boolean
  onMakeIndividual: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Actions for ${contactName}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <PermissionTooltip
          allowed={!makeIndividualKnown || canMakeIndividual}
          reason="Only someone who can create accounts can do this."
        >
          <DropdownMenuItem
            className="max-sm:h-11"
            disabled={makeIndividualKnown && !canMakeIndividual || makingIndividual}
            onClick={onMakeIndividual}
          >
            <UserPlusIcon />
            {makingIndividual ? 'Creating…' : 'Make Individual account'}
          </DropdownMenuItem>
        </PermissionTooltip>
        <PermissionTooltip
          allowed={!deleteKnown || canDelete}
          reason="Only someone who can delete contacts can do this."
        >
          <DropdownMenuItem
            className="max-sm:h-11"
            variant="danger"
            disabled={deleteKnown && !canDelete || deleting}
            onClick={onDelete}
          >
            <Trash2Icon />
            {deleting ? 'Checking…' : 'Delete'}
          </DropdownMenuItem>
        </PermissionTooltip>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * §3.2 and §3.4, and the reason this page was written: **the Companies a
 * Contact is linked to, plural, as a list.**
 *
 * One entry or five, it renders the same way — a list that happens to hold one
 * row, never a "Company:" field. Each row navigates to that company's page
 * (P1-T14). `is_primary` is a property of the link, so the marker sits on the
 * row and not on the person.
 */
function CompaniesCard({ companies }: { companies: LinkedCompany[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BuildingIcon className="size-icon text-text-secondary" aria-hidden="true" />
          Companies
        </CardTitle>
      </CardHeader>

      {companies.length === 0 ? (
        <EmptyState variant="nothing-yet" heading="No company linked">
          A contact does not have to belong to a company — §3.4 makes the link
          optional — but linking one is what puts this person on that company&apos;s
          page and lets an opportunity find them.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border-light">
          {companies.map(company => {
            const body = (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'truncate text-body font-medium',
                      company.can_open === false ? 'text-text-primary' : 'text-primary'
                    )}
                  >
                    {company.name}
                  </span>
                  {company.is_primary && <PrimaryMarker />}
                  {company.stage && (
                    <StatusBadge vocabulary={LEAD_STAGE} status={company.stage} />
                  )}
                </span>
                <span className="truncate text-label text-text-secondary">
                  {orEmpty(company.type)}
                </span>
              </>
            )
            return (
              <li key={company.link_id} className="px-4 py-3">
                {/* An account the caller may not open is plain text, not a
                    link to a page that would 404 (section 6.6 rule 4). */}
                {company.can_open === false ? (
                  <div className="flex min-h-11 min-w-0 flex-col justify-center gap-1 py-1">{body}</div>
                ) : (
                  <Link
                    href={`/parties/companies/${company.id}`}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-lg py-1',
                      'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
                    )}
                  >
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/**
 * §14: grey blocks in the shape of what is coming, never a spinning wheel, so
 * the page does not jump when the data lands. The shapes match the real layout
 * — title, meta row, two columns.
 */
function ContactSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Skeleton className="h-56 w-full lg:col-span-2" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}

/**
 * `useSearchParams` has to sit under a Suspense boundary in the App Router, or
 * the route opts the whole page out of static rendering at build time. Same
 * shape as `parties/companies/[id]` and `review/[userId]`.
 */
export default function ContactDetailPage() {
  return (
    <Suspense fallback={<ContactSkeleton />}>
      <ContactDetail />
    </Suspense>
  )
}
