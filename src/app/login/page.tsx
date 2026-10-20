'use client'

import { useState, useRef, useEffect, Suspense, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { PasswordInput } from '@/components/ui/password-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from '@/components/ui/dialog'
import { isSafeReturnPath } from '@/lib/session-expiry'

/** One company the submitted phone and password are valid in; see /api/auth/login. */
type CompanyChoice = { tenantId: string; companyName: string }

/**
 * `useSearchParams()` opts a page out of static prerendering unless it sits
 * under a Suspense boundary, so the form is wrapped rather than read at this
 * level. The fallback is the page's own background and nothing else: it is on
 * screen for a frame at most, and a spinner that brief reads as a flicker.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-sunken" />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  // Set when the phone and password are valid in more than one company. The
  // second step re-posts the SAME phone and password, which stay in this
  // component's state only — never in the URL or in storage — plus the choice.
  const [companies, setCompanies] = useState<CompanyChoice[] | null>(null)
  const [chosenTenant, setChosenTenant] = useState('')
  const chooseHeadingRef = useRef<HTMLHeadingElement>(null)

  // Move focus to the new question, so a keyboard or screen-reader user is not
  // left on a submit button that has just disappeared.
  useEffect(() => {
    if (companies) chooseHeadingRef.current?.focus()
  }, [companies])

  function backToCredentials() {
    setCompanies(null)
    setChosenTenant('')
    setError('')
  }

  async function signIn(tenantId?: string) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenantId ? { phone, password, tenantId } : { phone, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A 401 on the second step means the credentials no longer hold (the
        // password changed in between), so the choice is moot: back to the
        // form, which is where that message belongs.
        if (tenantId && res.status === 401) backToCredentials()
        setError(data.error || 'Login failed')
      } else if (Array.isArray(data.chooseCompany) && data.chooseCompany.length > 0) {
        // No session yet: the server sets no cookie until a company is chosen.
        setChosenTenant('')
        setCompanies(data.chooseCompany)
      } else {
        // Return the user to the page their session died on. `?next=` is set by
        // whoever sent them here — middleware for a page navigation, the 401
        // handler for a data call — and is checked AGAIN here with the same
        // isSafeReturnPath() those two used, because a query string is
        // typed-in-able and an unchecked one turns this screen into an open
        // redirect: `//evil.example` reads as another host, and the victim has
        // just entered their password on the real site. It survives the
        // company step because it is read from the URL, which that step never
        // changes.
        const next = searchParams.get('next')
        router.push(isSafeReturnPath(next) ? next : '/')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    signIn()
  }

  function handleChooseCompany(e: FormEvent) {
    e.preventDefault()
    if (chosenTenant) signIn(chosenTenant)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken px-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-medium text-lg">R</div>
          <div>
            <h1 className="text-lg font-medium text-text-primary leading-none">RGB Admin</h1>
            <p className="text-xs text-text-muted">SFA Management System</p>
          </div>
        </div>

        {companies ? (
          <form onSubmit={handleChooseCompany} className="space-y-4">
            <fieldset>
              <legend className="sr-only">Company</legend>
              <h2 ref={chooseHeadingRef} tabIndex={-1} className="text-base font-medium text-text-primary mb-1 outline-none">
                Which company do you want to sign in to?
              </h2>
              <p className="text-sm text-text-secondary mb-4">
                Your phone number and password work in more than one company.
              </p>
              <RadioGroup value={chosenTenant} onValueChange={v => setChosenTenant(String(v))} className="gap-2">
                {companies.map(c => (
                  // The whole row is the label, so the 44px row is the touch
                  // target rather than the 16px circle.
                  <label key={c.tenantId}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:bg-surface-control has-data-checked:border-primary has-data-checked:bg-primary-subtle">
                    <RadioGroupItem value={c.tenantId} disabled={loading} />
                    <span className="min-w-0 break-words text-sm text-text-primary">{c.companyName}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {error && <p className="text-sm text-danger bg-danger-bg px-3 py-2 rounded-lg">{error}</p>}
            {/* Section 6.2 fixes the button at 40px; the ::after extends the hit
                area 2px each way to section 9's 44px touch target. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="secondary" size="lg" onClick={backToCredentials} disabled={loading}
                className="relative w-full after:absolute after:inset-x-0 after:-inset-y-0.5 sm:w-auto">
                Back
              </Button>
              <Button type="submit" size="lg" disabled={loading || !chosenTenant}
                className="relative w-full after:absolute after:inset-x-0 after:-inset-y-0.5 sm:w-auto">
                {loading ? 'Signing in…' : 'Continue'}
              </Button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-phone" className="block text-sm font-medium text-text-secondary mb-1">Phone Number</label>
            <input id="login-phone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="9999999999" required
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-text-secondary mb-1">Password</label>
            <PasswordInput id="login-password" name="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <p className="text-sm text-danger bg-danger-bg px-3 py-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        )}

        {!companies && (
          <div className="mt-4 text-center">
            <button onClick={() => setShowForgot(true)}
              className="text-sm text-primary-text hover:underline transition">
              Forgot Password?
            </button>
          </div>
        )}
      </div>

      <ForgotPasswordDialog open={showForgot} onOpenChange={setShowForgot} />
    </div>
  )
}

function ForgotPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  // Reset to the initial step each time the dialog is reopened, so a
  // previous "Email Sent" state is never shown for a new attempt.
  useEffect(() => {
    if (open) {
      setPhone('')
      setLoading(false)
      setSent(false)
      setError('')
    }
  }, [open])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      if (!res.ok) {
        setError((await res.json()).error ?? 'Something went wrong')
      } else {
        setSent(true)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{sent ? 'Email Sent' : 'Reset Password'}</DialogTitle>
          {!sent && (
            <DialogDescription>
              Enter your registered phone number. We&apos;ll send your current credentials and a reset link to your email.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          {sent ? (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-success-bg rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <p className="text-sm text-text-muted mb-5">
                If an account exists for that phone number, an email with your credentials and a reset link has been sent.
              </p>
              <button onClick={() => onOpenChange(false)}
                className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition">
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="forgot-phone" className="block text-sm font-medium text-text-secondary mb-1">Phone Number</label>
                <input id="forgot-phone" name="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="9999999999" required
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
              </div>
              {error && <p className="text-sm text-danger bg-danger-bg px-3 py-2 rounded-lg">{error}</p>}
              <button type="submit" disabled={loading || !phone}
                className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50">
                {loading ? 'Sending…' : 'Send Reset Email'}
              </button>
            </form>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
