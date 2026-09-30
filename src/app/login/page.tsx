'use client'

import { useState, useRef, useEffect, Suspense, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
  const [showPassword, setShowPassword] = useState(false)
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
            <div className="relative">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                className="w-full border border-border rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
              <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition">
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
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
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition">
              Forgot Password?
            </button>
          </div>
        )}
      </div>

      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  )
}

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-(--backdrop)" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-7">
        <button onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-secondary w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-control transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {sent ? (
          <div className="text-center py-2">
            <div className="w-14 h-14 bg-success-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-text-primary mb-1">Email Sent</h3>
            <p className="text-sm text-text-muted mb-5">
              If an account exists for that phone number, an email with your credentials and a reset link has been sent.
            </p>
            <button onClick={onClose}
              className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition">
              Back to Login
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-medium text-text-primary mb-1">Reset Password</h3>
            <p className="text-sm text-text-muted mb-5">
              Enter your registered phone number. We&apos;ll send your current credentials and a reset link to your email.
            </p>
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
          </>
        )}
      </div>
    </div>
  )
}
