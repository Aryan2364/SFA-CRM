'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT, passwordTooShort } from '@/lib/password-policy'
import { PasswordInput } from '@/components/ui/password-input'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) setError('Invalid reset link. Please request a new one.')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (passwordTooShort(password)) { setError(PASSWORD_TOO_SHORT); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API still carries a confirmPassword check server-side; with a
        // single password field on this page, the value confirms itself.
        body: JSON.stringify({ token, password, confirmPassword: password }),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'Something went wrong'); return }
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-sunken p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-medium text-lg">R</div>
          <div>
            <h1 className="text-lg font-medium text-text-primary leading-none">RGB Admin</h1>
            <p className="text-xs text-text-muted">SFA Management System</p>
          </div>
        </div>

        {success ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-success-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-1">Password Updated</h2>
            <p className="text-sm text-text-muted mb-6">Your password has been changed successfully.</p>
            <button onClick={() => router.push('/login')}
              className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition">
              Back to Login
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-medium text-text-primary mb-1">Set New Password</h2>
            <p className="text-sm text-text-muted mb-6">Enter your new password below.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-password" className="block text-sm font-medium text-text-secondary mb-1">New Password</label>
                <PasswordInput
                  id="reset-password"
                  name="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
                  required
                  disabled={!token}
                />
              </div>

              {error && <p className="text-sm text-danger bg-danger-bg px-3 py-2 rounded-lg">{error}</p>}

              <button type="submit" disabled={loading || !token || !password}
                className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50">
                {loading ? 'Saving…' : 'Save New Password'}
              </button>

              <button type="button" onClick={() => router.push('/login')}
                className="w-full text-sm text-text-muted hover:text-text-secondary transition text-center">
                ← Back to Login
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-text-muted">Loading…</div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
