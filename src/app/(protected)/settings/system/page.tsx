'use client'

import { useState, useEffect } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
/* NOT '@/lib/settings' — that module imports prisma, and a client component
   importing it drags pg/fs into the browser bundle and the page 500s with
   "Module not found: Can't resolve 'fs'". tsc does not catch it. */
import {
  TENANT_SETTINGS_LIMITS,
  type TenantSettings,
} from '@/lib/settings-shared'

/**
 * System Settings — 05-PHASE-3-PLAN.md P3-T1 step 6.
 *
 * Three tenant-wide values that three background behaviours read through
 * `getTenantSettings()`. Nothing here is per-user, which is why the screen is a
 * single form and not a table.
 *
 * No `backHref` and no back arrow: §1 rule 11 forbids one, because a back
 * button does something different depending on how the user arrived. The
 * breadcrumb is the sanctioned replacement (§11.2) and is the same every time.
 *
 * The limits come from `src/lib/settings.ts`, the same module the PUT route
 * validates against, so the screen cannot offer a value the server rejects.
 */

/** Minutes past midnight -> the TimePicker's 12-hour shape. */
function minutesToTimeValue(minutes: number): TimeValue {
  const hour24 = Math.floor(minutes / 60)
  return {
    hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: minutes % 60,
    meridiem: hour24 >= 12 ? 'PM' : 'AM',
  }
}

/** The inverse. 12 AM -> 0, 12 PM -> 720. */
function timeValueToMinutes(value: TimeValue): number {
  const hour24 = (value.hour % 12) + (value.meridiem === 'PM' ? 12 : 0)
  return hour24 * 60 + value.minute
}

type NumericField = 'location_flag_threshold_m' | 'deal_stage_ageing_days'

export default function SystemSettingsPage() {
  const me = useMe()
  const { toast } = useToast()

  const [settings, setSettings] = useState<TenantSettings | null>(null)
  /* The two integers are held as strings while editing. Holding them as numbers
     means clearing the field produces NaN, and the user cannot delete the last
     digit to type a new one without the input fighting them. */
  const [threshold, setThreshold] = useState('')
  const [ageing, setAgeing] = useState('')
  const [checkoutTime, setCheckoutTime] = useState<TimeValue | undefined>()
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /* The real permission, not a role name. /api/auth/me returns every section
     true for Administrator, so this covers that case without naming the role. */
  const canEdit = me?.permissions?.system_settings?.edit ?? false

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/system')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not load settings.')
        }
        return r.json() as Promise<TenantSettings>
      })
      .then(data => {
        if (cancelled) return
        setSettings(data)
        setThreshold(String(data.location_flag_threshold_m))
        setAgeing(String(data.deal_stage_ageing_days))
        setCheckoutTime(minutesToTimeValue(data.auto_checkout_minutes))
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Validates one integer field against the shared limits. */
  function fieldError(field: NumericField, raw: string): string | null {
    const { min, max } = TENANT_SETTINGS_LIMITS[field]
    if (raw.trim() === '') return 'Enter a value.'
    if (!/^\d+$/.test(raw.trim())) return 'Enter a whole number, with no decimal point.'
    const n = Number(raw)
    if (n < min || n > max) return `Enter a number between ${min} and ${max}.`
    return null
  }

  const thresholdError = settings ? fieldError('location_flag_threshold_m', threshold) : null
  const ageingError = settings ? fieldError('deal_stage_ageing_days', ageing) : null
  const timeError = settings && !checkoutTime ? 'Enter a time, for example 12:00 AM.' : null
  const hasError = Boolean(thresholdError || ageingError || timeError)

  /* Whether anything actually changed. A Save that would rewrite the stored
     values is disabled rather than pretending to do work. */
  const dirty =
    settings !== null &&
    checkoutTime !== undefined &&
    !hasError &&
    (timeValueToMinutes(checkoutTime) !== settings.auto_checkout_minutes ||
      Number(threshold) !== settings.location_flag_threshold_m ||
      Number(ageing) !== settings.deal_stage_ageing_days)

  async function save() {
    if (!checkoutTime || hasError) return
    setSaving(true)
    const body: TenantSettings = {
      auto_checkout_minutes: timeValueToMinutes(checkoutTime),
      location_flag_threshold_m: Number(threshold),
      deal_stage_ageing_days: Number(ageing),
    }
    const res = await fetch('/api/settings/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setSettings(body)
      toast('System settings saved')
    } else {
      /* §7.2: say what went wrong, not "Error". The route returns a sentence
         for a 400 and dbErrorMessage() for a 500. */
      const failure = await res.json().catch(() => ({ error: null }))
      toast(failure.error ?? 'Could not save settings. Try again.', 'error')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>System Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-page-title font-medium text-text-primary">
          System Settings
        </h1>
        <p className="mt-1 text-label text-text-secondary">
          Values that apply to everyone in the organisation.
        </p>
      </div>

      {loadError ? (
        /* No dead ends: a failed load offers the way forward rather than an
           empty screen. */
        <div className="rounded-xl border border-border-light bg-surface p-6">
          <p className="text-body text-text-primary">{loadError}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : settings === null ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {/* Auto check-out */}
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <Label htmlFor="auto-checkout">Auto check-out time</Label>
              <p className="mt-1 mb-2 text-label text-text-secondary">
                Anyone still checked in at this time is checked out
                automatically. Midnight is the default.
              </p>
              <TimePicker
                id="auto-checkout"
                value={checkoutTime}
                onValueChange={setCheckoutTime}
                disabled={!canEdit}
                invalid={Boolean(timeError)}
                placeholder="12:00 AM"
              />
              <InlineFieldError>{timeError}</InlineFieldError>
            </div>

            {/* Location flag distance */}
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <Label htmlFor="location-threshold">
                Location flag distance (metres)
              </Label>
              <p className="mt-1 mb-2 text-label text-text-secondary">
                A meeting logged further than this from the party&rsquo;s saved
                address is flagged for review. Flagging only marks the meeting;
                nothing is blocked.
              </p>
              {/* The width is on a wrapper, not the Input. Input's own base
                  class is `max-w-field-max` (480px), and tailwind-merge does
                  not recognise that custom token as a max-w utility, so a
                  `max-w-*` passed in className does NOT replace it — both
                  survive and the field renders full width. Sizing the parent
                  sidesteps the merge entirely. */}
              <div className="w-40">
                <Input
                  id="location-threshold"
                  inputMode="numeric"
                  value={threshold}
                  disabled={!canEdit}
                  aria-invalid={Boolean(thresholdError)}
                  onChange={e => setThreshold(e.target.value)}
                />
              </div>
              <InlineFieldError>{thresholdError}</InlineFieldError>
            </div>

            {/* Deal stage ageing */}
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <Label htmlFor="deal-ageing">Deal stage ageing (days)</Label>
              <p className="mt-1 mb-2 text-label text-text-secondary">
                A deal sitting in the same stage for longer than this reads as
                ageing on the pipeline.
              </p>
              <div className="w-40">
                <Input
                  id="deal-ageing"
                  inputMode="numeric"
                  value={ageing}
                  disabled={!canEdit}
                  aria-invalid={Boolean(ageingError)}
                  onChange={e => setAgeing(e.target.value)}
                />
              </div>
              <InlineFieldError>{ageingError}</InlineFieldError>
            </div>
          </div>

          {/* The control is only rendered for someone who may use it. A viewer
              without edit sees the values, disabled, and no Save button. */}
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {dirty && (
                <span className="text-label text-text-secondary">
                  You have unsaved changes.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
