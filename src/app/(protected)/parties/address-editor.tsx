'use client'

/**
 * P1-T16 — the multiple-addresses editor. `REBUILD-PLAN.md` §3.3.
 *
 * "Addresses — multiple, each with Address Line, City, State, Pincode,
 * coordinates, one marked Primary."
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRIMARY IS A RADIO AND NOT A CHECKBOX PER CARD
 *
 * Exactly one address is primary, and the server enforces that — promoting one
 * demotes the rest inside a transaction. A checkbox per card would let the user
 * express "two primaries" or "no primary", and the server would then silently
 * answer with something other than what the form showed. A radio group can only
 * express the states the server can honour.
 *
 * Zero primaries is not reachable either: removing the primary card promotes
 * the first survivor here, which is the same rule
 * `DELETE /api/companies/[id]/addresses/[addressId]` applies on the server.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS HOLDS ROWS IN STATE RATHER THAN SAVING EACH ONE
 *
 * An address needs a `company_id`, and on the new-company form the company does
 * not exist until Next is pressed (§12, no drafts). So the cards are local
 * state and the parent writes them immediately after the company create. On the
 * company page — where the company already exists — the same component can be
 * pointed at a per-row save instead; nothing here assumes which.
 */

import { PlusIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'

import type { DistrictRef, NamedRef, TalukaRef, VillageRef } from './party-masters'

/** One card. `key` is local only — it never reaches the wire. */
export type AddressDraft = {
  key: string
  label: string
  address_line: string
  city: string
  state_id: string
  district_id: string
  taluka_id: string
  village_id: string
  pincode: string
  latitude: string
  longitude: string
  is_primary: boolean
}

let nextKey = 0

export function blankAddress(isPrimary: boolean): AddressDraft {
  nextKey += 1
  return {
    key: `addr-${nextKey}`,
    label: '',
    address_line: '',
    city: '',
    state_id: '',
    district_id: '',
    taluka_id: '',
    village_id: '',
    pincode: '',
    latitude: '',
    longitude: '',
    is_primary: isPrimary,
  }
}

/** The body `POST /api/companies/[id]/addresses` expects. */
export function addressPayload(a: AddressDraft): Record<string, unknown> {
  return {
    label: a.label.trim() || null,
    address_line: a.address_line.trim() || null,
    city: a.city.trim() || null,
    state_id: a.state_id || null,
    district_id: a.district_id || null,
    taluka_id: a.taluka_id || null,
    village_id: a.village_id || null,
    pincode: a.pincode.trim() || null,
    latitude: a.latitude.trim() || null,
    longitude: a.longitude.trim() || null,
    is_primary: a.is_primary,
  }
}

/** True when the user has typed nothing into a card — it is not worth saving. */
export function isEmptyAddress(a: AddressDraft): boolean {
  return !(
    a.label.trim() || a.address_line.trim() || a.city.trim() || a.state_id ||
    a.district_id || a.taluka_id || a.village_id || a.pincode.trim() ||
    a.latitude.trim() || a.longitude.trim()
  )
}

export function AddressEditor({
  addresses,
  onChange,
  masters,
  errors,
}: {
  addresses: AddressDraft[]
  onChange: (next: AddressDraft[]) => void
  masters: {
    states: NamedRef[]
    districts: DistrictRef[]
    talukas: TalukaRef[]
    villages: VillageRef[]
  }
  /** Keyed `${address.key}.${field}` by the parent's validation. */
  errors: Record<string, string>
}) {
  function patch(key: string, changes: Partial<AddressDraft>) {
    onChange(addresses.map(a => (a.key === key ? { ...a, ...changes } : a)))
  }

  /** Choosing a parent invalidates everything below it — clearing is the only
      honest option; a taluka from another district is a contradiction. */
  function setState(key: string, value: string) {
    patch(key, { state_id: value, district_id: '', taluka_id: '', village_id: '' })
  }
  function setDistrict(key: string, value: string) {
    patch(key, { district_id: value, taluka_id: '', village_id: '' })
  }
  function setTaluka(key: string, value: string) {
    patch(key, { taluka_id: value, village_id: '' })
  }

  function makePrimary(key: string) {
    onChange(addresses.map(a => ({ ...a, is_primary: a.key === key })))
  }

  function add() {
    onChange([...addresses, blankAddress(addresses.length === 0)])
  }

  function remove(key: string) {
    const rest = addresses.filter(a => a.key !== key)
    // Never leave the set without a primary — the same promotion the DELETE
    // endpoint performs, so the form and the server agree.
    if (rest.length > 0 && !rest.some(a => a.is_primary)) rest[0].is_primary = true
    onChange(rest)
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses.map((a, index) => (
        <Card key={a.key} className="border-border-light">
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              {/*
                A radio, one group across all cards — see the header note. The
                primary card shows it checked and disabled rather than hidden,
                so every card carries the same control in the same place.
              */}
              <Label className="flex items-center gap-2 text-body text-text-primary">
                <input
                  type="radio"
                  name="primary-address"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={a.is_primary}
                  onChange={() => makePrimary(a.key)}
                  aria-label={`Make address ${index + 1} the primary address`}
                />
                Primary address
              </Label>

              {addresses.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(a.key)}
                  aria-label={`Remove address ${index + 1}`}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor={`${a.key}-label`}>Label</Label>
                <Input
                  id={`${a.key}-label`}
                  className="mt-1.5"
                  value={a.label}
                  onChange={e => patch(a.key, { label: e.target.value })}
                  placeholder="Head office, Warehouse…"
                />
              </div>

              <div className="col-span-12 sm:col-span-8">
                <Label htmlFor={`${a.key}-line`}>Address line</Label>
                <Textarea
                  id={`${a.key}-line`}
                  className="mt-1.5"
                  rows={2}
                  value={a.address_line}
                  onChange={e => patch(a.key, { address_line: e.target.value })}
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-city`}>City</Label>
                <Input
                  id={`${a.key}-city`}
                  className="mt-1.5"
                  value={a.city}
                  onChange={e => patch(a.key, { city: e.target.value })}
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-state`}>State</Label>
                <SearchableSelect
                  id={`${a.key}-state`}
                  className="mt-1.5"
                  options={Object.fromEntries(masters.states.map(s => [s.id, s.name]))}
                  value={a.state_id}
                  onValueChange={v => setState(a.key, v)}
                  placeholder="Select state…"
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-district`}>District</Label>
                <SearchableSelect
                  id={`${a.key}-district`}
                  className="mt-1.5"
                  options={Object.fromEntries(
                    masters.districts
                      .filter(d => !a.state_id || d.state_id === a.state_id)
                      .map(d => [d.id, d.name])
                  )}
                  value={a.district_id}
                  onValueChange={v => setDistrict(a.key, v)}
                  placeholder={a.state_id ? 'Select district…' : 'Select a state first'}
                  disabled={!a.state_id}
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-pincode`}>Pincode</Label>
                <Input
                  id={`${a.key}-pincode`}
                  className="mt-1.5"
                  inputMode="numeric"
                  value={a.pincode}
                  onChange={e => patch(a.key, { pincode: e.target.value })}
                  aria-invalid={Boolean(errors[`${a.key}.pincode`])}
                  placeholder="6 digits"
                />
                <InlineFieldError>{errors[`${a.key}.pincode`]}</InlineFieldError>
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-taluka`}>Taluka</Label>
                <SearchableSelect
                  id={`${a.key}-taluka`}
                  className="mt-1.5"
                  options={Object.fromEntries(
                    masters.talukas
                      .filter(t => !a.district_id || t.district_id === a.district_id)
                      .map(t => [t.id, t.name])
                  )}
                  value={a.taluka_id}
                  onValueChange={v => setTaluka(a.key, v)}
                  placeholder={a.district_id ? 'Select taluka…' : 'Select a district first'}
                  disabled={!a.district_id}
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-village`}>Village</Label>
                <SearchableSelect
                  id={`${a.key}-village`}
                  className="mt-1.5"
                  options={Object.fromEntries(
                    masters.villages
                      .filter(v => !a.taluka_id || v.taluka_id === a.taluka_id)
                      .map(v => [v.id, v.name])
                  )}
                  value={a.village_id}
                  onValueChange={v => patch(a.key, { village_id: v })}
                  placeholder={a.taluka_id ? 'Select village…' : 'Select a taluka first'}
                  disabled={!a.taluka_id}
                />
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-lat`}>Latitude</Label>
                <Input
                  id={`${a.key}-lat`}
                  className="mt-1.5"
                  inputMode="decimal"
                  value={a.latitude}
                  onChange={e => patch(a.key, { latitude: e.target.value })}
                  aria-invalid={Boolean(errors[`${a.key}.latitude`])}
                />
                <InlineFieldError>{errors[`${a.key}.latitude`]}</InlineFieldError>
              </div>

              <div className="col-span-12 sm:col-span-6 lg:col-span-3">
                <Label htmlFor={`${a.key}-lng`}>Longitude</Label>
                <Input
                  id={`${a.key}-lng`}
                  className="mt-1.5"
                  inputMode="decimal"
                  value={a.longitude}
                  onChange={e => patch(a.key, { longitude: e.target.value })}
                  aria-invalid={Boolean(errors[`${a.key}.longitude`])}
                />
                <InlineFieldError>{errors[`${a.key}.longitude`]}</InlineFieldError>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <div>
        <Button variant="secondary" onClick={add}>
          <PlusIcon />
          Add another address
        </Button>
      </div>
    </div>
  )
}
