'use client'

/**
 * The Create Deal dialog — REBUILD-PLAN.md §4.1.
 *
 * F-DEALS-CREATE: the Deals screen had no create affordance at all. `POST
 * /api/deals` existed and worked, `checkPermission(user, 'deals', 'create')`
 * gated it, and nothing on the client ever called it — so the only way a Deal
 * could come into being was through another entity. This dialog is that
 * missing path from the list: the header's button and the empty state's button
 * both open this one component.
 *
 * ⚠️ NOT a second copy of `components/meeting/new-deal-dialog.tsx`, and that
 * one is not extended to cover this. That dialog is deliberately four fields
 * with the company FIXED to the meeting's party — its own note says "the Deals
 * screen is where a Deal is filled in properly", which is this screen. Giving
 * it a company picker would let somebody standing in one shop file a deal
 * against another by a mis-tap, which is the exact thing it was written to
 * prevent. Two dialogs, one endpoint, no second create path on the server.
 *
 * ⚠️ Uses `ui/dialog.tsx`, the same primitive `parties/contact-dialog.tsx` and
 * `meeting/new-deal-dialog.tsx` use, not the legacy `Modal.tsx`.
 *
 * §4.1: `name` is the only compulsory field, and **company and contact are
 * both optional and independent** — a Contact with no Company is acceptable,
 * so neither is required here and "at least one of them" is not invented.
 * The route says the same thing; this file only says it earlier, so the user
 * reads a sentence instead of a 400.
 */

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'

export type NamedRow = { id: string; name: string }

/** What `POST /api/deals` answers with, narrowed to what the caller uses. */
export type CreatedDeal = { id: string; name: string }

/**
 * Section 14 rule 4: every request carries a deadline at the point it is
 * made. `fetch` has none of its own, so a stalled save never settles, the
 * button sits on "Saving…" for ever and the failed branch — which exists and
 * is correct — simply never runs. Matches the deadline the Deals list and its
 * board move already use.
 */
const REQUEST_TIMEOUT_MS = 15000

async function fetchWithDeadline(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

const BLANK = {
  name: '',
  company_id: '',
  contact_id: '',
  deal_stage_id: '',
  owner_user_id: '',
  expected_value: '',
  probability: '',
  source: '',
  remarks: '',
}

/**
 * `@db.Date` on the wire is "YYYY-MM-DD" and nothing else.
 *
 * Built from the LOCAL parts, never `toISOString()` — east of UTC that returns
 * the previous day for any date the user picked, which is the quietest way to
 * get an expected close date that is one day early for half the world.
 */
function dateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * §4.1's probability is a MULTIPLE OF TEN, and `checkProbability()` in
 * `api/deals/_shape.ts` rejects everything else with a 400 — so this is a
 * picker, not a number box. A free-text field here would let the user type 45,
 * look correct, and be refused on save for a rule nothing on screen stated.
 */
const PROBABILITY_OPTIONS: Record<string, string> = {
  '': 'Not set',
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [String(i * 10), `${i * 10}%`])
  ),
}

/** The "leave this empty" row every optional picker needs — without it a
 *  selection made by mistake cannot be undone without reopening the dialog. */
function withClearOption(rows: NamedRow[], clearLabel: string): Record<string, string> {
  return { '': clearLabel, ...Object.fromEntries(rows.map(r => [r.id, r.name])) }
}

export function DealDialog({
  open,
  onOpenChange,
  companies,
  stages,
  team,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already fetched by the screen for its own filters — not re-read here. */
  companies: NamedRow[]
  stages: NamedRow[]
  /** The users this caller may own a Deal on behalf of. Empty for a user with
   *  no team, in which case the picker is not offered and the route's own
   *  default (the creator) applies. */
  team: NamedRow[]
  onCreated: (deal: CreatedDeal) => void
}) {
  const [form, setForm] = useState(BLANK)
  const [closeDate, setCloseDate] = useState<Date | undefined>(undefined)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [contacts, setContacts] = useState<NamedRow[]>([])

  /* Reset on every OPEN, not on close: a dialog that reopens still holding the
     last Deal's details creates a duplicate on the next save, and blanking on
     close would empty the fields while they are still on screen. */
  useEffect(() => {
    if (open) {
      setForm(BLANK)
      setCloseDate(undefined)
      setErrors({})
      setSaving(false)
    }
  }, [open])

  /*
   * The contact picker narrows to the chosen company, and lists everyone the
   * caller can see when no company is chosen — §4.1 allows a Deal against a
   * Contact alone, so an empty company must not empty this picker.
   *
   * A failed read costs this one picker and nothing else (§26): the list goes
   * empty, the field below says so in place of its options, and the Deal still
   * saves without a contact.
   */
  useEffect(() => {
    if (!open) return
    let live = true
    const query = form.company_id ? `?companyId=${encodeURIComponent(form.company_id)}` : ''
    fetchWithDeadline(`/api/contacts${query}`)
      .then(async r => (r.ok ? ((await r.json()) as NamedRow[]) : []))
      .then(rows => live && setContacts(Array.isArray(rows) ? rows : []))
      .catch(() => live && setContacts([]))
    return () => {
      live = false
    }
  }, [open, form.company_id])

  /* Setting a field clears its error — a message that outlived the problem
     tells the user the form still objects when it no longer does. */
  const set = (key: keyof typeof BLANK) => (value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => {
      if (!(key in e) && !('form' in e)) return e
      const { [key as string]: _cleared, form: _formError, ...rest } = e
      return rest
    })
  }

  /**
   * Section 7.1: a problem about one field is an inline field error, never a
   * toast — the user has to remember which field was wrong after a toast
   * vanishes. Section 7.2 rule 2: state the cause, then the next action.
   *
   * These are the same rules `POST /api/deals` enforces, checked here so the
   * message lands on the field. The route still enforces both.
   */
  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = 'Enter a name for this deal.'

    if (form.expected_value.trim()) {
      const value = Number(form.expected_value)
      if (!Number.isFinite(value) || value < 0) {
        next.expected_value = 'Enter the expected value as a number, like 125000.'
      }
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    let res: Response
    try {
      res = await fetchWithDeadline('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          company_id: form.company_id || null,
          contact_id: form.contact_id || null,
          deal_stage_id: form.deal_stage_id || null,
          // Left blank the route owns the default — the creator. Sending an
          // explicit value here is the override, not the rule.
          owner_user_id: form.owner_user_id || null,
          expected_value: form.expected_value.trim() || null,
          probability: form.probability.trim() || null,
          expected_close_date: closeDate ? dateOnly(closeDate) : null,
          source: form.source.trim() || null,
          remarks: form.remarks.trim() || null,
        }),
      })
    } catch {
      // §14: a request that failed or ran past its deadline is a state this
      // form renders, never an unhandled rejection reaching the user as an
      // error overlay. The wording says what happened to their data.
      setSaving(false)
      setErrors({ form: 'The connection dropped. Nothing has been saved.' })
      return
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string }
    setSaving(false)

    if (!res.ok) {
      setErrors({
        form:
          data.error ??
          (res.status === 403
            ? 'Only someone who can create deals can save this. Ask an administrator for access.'
            : 'Could not save this deal.'),
      })
      return
    }

    onCreated({ id: data.id ?? '', name: data.name ?? form.name.trim() })
    onOpenChange(false)
  }

  return (
    /*
     * Section 24: three widths only, and `md` (560px) is the one for a short
     * form — `lg` is reserved for a dialog holding tabs or a table. The body
     * is assembled by `DialogContent` itself, so the header and footer stay
     * pinned and only the fields scroll once the dialog reaches 80vh.
     */
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create deal</DialogTitle>
          <DialogDescription>
            Only the deal name is required. A deal can be linked to a company, a
            contact, or neither — everything else can be filled in later.
          </DialogDescription>
        </DialogHeader>

        {/*
          Section 17: a 12-column form grid, and a field is as wide as the data
          it holds. Names take 6, a short dropdown or a date takes 4, notes take
          12 — a full-width box under every field is the thing that rule exists
          to stop. Everything collapses to 12 below `sm`, per section 9.
        */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="dd-name" required>Deal name</Label>
            <Input
              id="dd-name"
              className="mt-1.5"
              value={form.name}
              onChange={e => set('name')(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              placeholder="What is being sold"
              autoFocus
            />
            <InlineFieldError>{errors.name}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="dd-company">Company</Label>
            <SearchableSelect
              id="dd-company"
              className="mt-1.5"
              options={withClearOption(companies, 'No company')}
              value={form.company_id}
              onValueChange={value => {
                // Changing the company re-reads the contacts, so a contact
                // that belonged to the old company is dropped rather than
                // left selected against a company it has no link to.
                setForm(f => ({ ...f, company_id: value, contact_id: '' }))
              }}
              placeholder="No company"
            />
          </div>

          <div className="col-span-12 sm:col-span-6">
            <Label htmlFor="dd-contact">Contact</Label>
            <SearchableSelect
              id="dd-contact"
              className="mt-1.5"
              options={withClearOption(contacts, 'No contact')}
              value={form.contact_id}
              onValueChange={set('contact_id')}
              placeholder={
                contacts.length === 0
                  ? form.company_id
                    ? 'No contacts at this company'
                    : 'No contacts available'
                  : 'No contact'
              }
              disabled={contacts.length === 0}
            />
          </div>

          {/* §26: a picker with one option is not a choice. A user with no
              team never sees it, and the route owns the default. */}
          {team.length > 1 ? (
            <div className="col-span-12 sm:col-span-6">
              <Label htmlFor="dd-owner">Owner</Label>
              <SearchableSelect
                id="dd-owner"
                className="mt-1.5"
                options={withClearOption(team, 'Me')}
                value={form.owner_user_id}
                onValueChange={set('owner_user_id')}
                placeholder="Me"
              />
            </div>
          ) : null}

          <div className="col-span-12 sm:col-span-4">
            <Label htmlFor="dd-stage">Stage</Label>
            <SearchableSelect
              id="dd-stage"
              className="mt-1.5"
              options={withClearOption(stages, 'No stage yet')}
              value={form.deal_stage_id}
              onValueChange={set('deal_stage_id')}
              placeholder="No stage yet"
            />
          </div>

          <div className="col-span-12 sm:col-span-4">
            <Label htmlFor="dd-probability">Probability</Label>
            <SearchableSelect
              id="dd-probability"
              className="mt-1.5"
              options={PROBABILITY_OPTIONS}
              value={form.probability}
              onValueChange={set('probability')}
              placeholder="Not set"
            />
          </div>

          {/* §20.1: a date field is 4 columns, typeable as well as selectable. */}
          <div className="col-span-12 sm:col-span-4">
            <Label htmlFor="dd-close">Expected closing date</Label>
            <DatePicker
              id="dd-close"
              className="mt-1.5"
              value={closeDate}
              onValueChange={setCloseDate}
            />
          </div>

          {/* §17: an amount is 3 columns, but the 160px floor is the binding
              constraint at this width, so it takes 4 like its neighbours. */}
          <div className="col-span-12 sm:col-span-4">
            <Label htmlFor="dd-value">Expected value</Label>
            <Input
              id="dd-value"
              className="mt-1.5 text-right tabular-nums"
              inputMode="decimal"
              value={form.expected_value}
              onChange={e => set('expected_value')(e.target.value)}
              aria-invalid={Boolean(errors.expected_value)}
              placeholder="0"
            />
            <InlineFieldError>{errors.expected_value}</InlineFieldError>
          </div>

          <div className="col-span-12 sm:col-span-8">
            <Label htmlFor="dd-source">Source</Label>
            <Input
              id="dd-source"
              className="mt-1.5"
              value={form.source}
              onChange={e => set('source')(e.target.value)}
              placeholder="Where this deal came from"
            />
          </div>

          <div className="col-span-12">
            <Label htmlFor="dd-remarks">Remarks</Label>
            <Textarea
              id="dd-remarks"
              className="mt-1.5"
              rows={3}
              value={form.remarks}
              onChange={e => set('remarks')(e.target.value)}
            />
          </div>

          {/* §7.1: a failure that belongs to no single field is shown in the
              form, next to the button that caused it — never as a raw overlay
              and never only as a toast that scrolls away. Same treatment the
              follow-up dialogs on the Deal page already use. */}
          {errors.form ? (
            <InlineFieldError className="col-span-12">{errors.form}</InlineFieldError>
          ) : null}
        </div>

        {/* §6.1 rule 1: exactly one primary per dialog. §14 rule 2: the save
            button carries its own loading state and is disabled while it
            works, so three clicks cannot become three deals. */}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Create deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
