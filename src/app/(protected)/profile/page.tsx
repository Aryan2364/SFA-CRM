'use client'

import { useState } from 'react'
import { OctagonXIcon } from 'lucide-react'

import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/contexts/ToastContext'
import { invalidateMeCache, useMe } from '@/hooks/useMe'
// The same minimum /api/auth/change-password enforces.
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

/**
 * The signed-in user's own account: who they are, read-only, and a change of
 * their own password.
 *
 * There is no confirm-password field. Section 32 of the kit rules it out: the
 * visibility toggle is what makes a confirmation unnecessary.
 */

type PasswordField = 'currentPassword' | 'newPassword'

/** One label/value pair. The label is the quiet half, the value the loud one. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-text-primary">{children}</dd>
    </div>
  )
}

export default function ProfilePage() {
  const me = useMe()
  // Phone foundation §41.18: the screen below More owns the app bar, with
  // a back target to More. On desktop PhoneShell is not mounted, so this is
  // a no-op there.
  usePhoneAppBar({ title: 'Profile', back: '/more' })

  return (
    <div className="space-y-6">
      <h1 className="text-page-title font-medium text-text-primary">My profile</h1>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            {me === null ? (
              <div className="space-y-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-4">
                <Field label="Name">{me.name}</Field>
                <Field label="Phone number">{me.phone}</Field>
                <Field label="Role">{me.role}</Field>
              </dl>
            )}
          </CardContent>
        </Card>

        <ChangePasswordCard />
      </div>
    </div>
  )
}

function ChangePasswordCard() {
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PasswordField, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /* Bumped on success to remount the fields, so a password the user revealed
     is hidden again rather than left showing (section 32). */
  const [formKey, setFormKey] = useState(0)

  /*
   * Section 11.3 rule 10: this form records an action with no natural
   * noun (nothing exists to save until it is submitted), so it is a
   * "create" form — "Leave this form?" / "What you have filled in will
   * be lost." Leaving via a link, the phone back arrow, or the tab close
   * while either field holds anything asks first.
   */
  const unsaved = useUnsavedChanges({
    changed: currentPassword !== '' || newPassword !== '',
    noun: 'form',
    mode: 'create',
  })

  function newPasswordError(value: string) {
    return value.length > 0 && value.length < MIN_PASSWORD_LENGTH
      ? `Enter at least ${MIN_PASSWORD_LENGTH} characters.`
      : undefined
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return

    const errors: Partial<Record<PasswordField, string>> = {}
    if (!currentPassword) errors.currentPassword = 'Enter your current password.'
    if (!newPassword) errors.newPassword = 'Enter a new password.'
    else errors.newPassword = newPasswordError(newPassword)
    setFieldErrors(errors)
    setFormError(null)
    if (errors.currentPassword || errors.newPassword) return

    setSaving(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (res.ok) {
        setCurrentPassword('')
        setNewPassword('')
        setFormKey(key => key + 1)
        invalidateMeCache()
        toast('Password changed. Other devices have been signed out.', 'success')
        return
      }
      const failure = await res.json().catch(() => ({}))
      const message: string = failure.error ?? 'Your password could not be changed. Try again.'
      if (failure.field === 'currentPassword' || failure.field === 'newPassword') {
        setFieldErrors({ [failure.field]: message })
      } else {
        setFormError(message)
      }
    } catch {
      setFormError('Your password could not be changed. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="min-w-0">
      {unsaved.warning}
      <form key={formKey} onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError && (
            <Banner variant="danger">
              <OctagonXIcon />
              <BannerTitle>Your password was not changed</BannerTitle>
              <BannerDescription>{formError}</BannerDescription>
            </Banner>
          )}

          {/* Section 17 rule 2: a single-line field never exceeds 480px —
              except on phone, where section 41.7 rule 1 drops the cap and
              every field runs the full content width. */}
          <div className="max-w-field-max">
            <Label htmlFor="current-password" required>
              Current password
            </Label>
            {/* 16px text on phones only, so iOS does not zoom into the field. */}
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              className="mt-1.5 max-sm:[&_input]:text-base"
              value={currentPassword}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.currentPassword)}
              onChange={event => {
                setCurrentPassword(event.target.value)
                setFieldErrors(errors => ({ ...errors, currentPassword: undefined }))
              }}
            />
            <InlineFieldError>{fieldErrors.currentPassword}</InlineFieldError>
          </div>

          <div className="max-w-field-max">
            <Label htmlFor="new-password" required>
              New password
            </Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              className="mt-1.5 max-sm:[&_input]:text-base"
              value={newPassword}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.newPassword)}
              onChange={event => {
                setNewPassword(event.target.value)
                setFieldErrors(errors => ({ ...errors, newPassword: undefined }))
              }}
              onBlur={() =>
                setFieldErrors(errors => ({ ...errors, newPassword: newPasswordError(newPassword) }))
              }
            />
            <p className="mt-1.5 text-label text-text-secondary">
              At least {MIN_PASSWORD_LENGTH} characters. Every other device signed in to your
              account will be signed out.
            </p>
            <InlineFieldError>{fieldErrors.newPassword}</InlineFieldError>
          </div>
        </CardContent>
        <CardFooter>
          {/* Full width on phone (§41.7: Save fixed/full-width at the bottom
              of a one-column form); reverts to an inline button on desktop. */}
          <Button type="submit" disabled={saving} className="w-full sm:w-auto">
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
