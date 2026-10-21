'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Boxes } from 'lucide-react'

import {
  SignInPage,
  type ForgotPasswordResult,
  type SignInOutcome,
  type SignInText,
} from '@/components/templates/sign-in-page'
import { APP_NAME } from '@/lib/install-settings'
import { isSafeReturnPath } from '@/lib/session-expiry'

/**
 * The sign-in page (kit section 11.7): the kit's template, with the product's
 * brand and two fetch calls. Sign-in is a mobile number and a password.
 *
 * `useSearchParams()` opts a page out of static prerendering unless it sits
 * under a Suspense boundary, so the page is wrapped rather than read at this
 * level. The fallback is the page's own background and nothing else: it is on
 * screen for a frame at most, and a spinner that brief reads as a flicker.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <LoginForm />
    </Suspense>
  )
}

/** This product calls an organisation a company; the template's words say organisation. */
const TEXT: Partial<SignInText> = {
  chooseTitle: 'Choose a company',
  chooseHelper: 'Your mobile number and password work in more than one company. Choose the one to open.',
  organisationLabel: 'Company',
  organisationMissing: 'Choose a company to continue.',
  forgotHelperMobile:
    "Enter your registered mobile number. We'll send your current credentials and a reset link to your email.",
  forgotSent: () =>
    'If an account exists for that mobile number, an email with your credentials and a reset link has been sent.',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  async function signIn({
    mobile,
    password,
    organisationId,
  }: {
    mobile: string
    password: string
    organisationId?: string
  }): Promise<SignInOutcome> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The second call re-posts the SAME phone and password, which stay in
        // the template's state only (never in the URL or in storage), plus the
        // chosen company.
        body: JSON.stringify(
          organisationId ? { phone: mobile, password, tenantId: organisationId } : { phone: mobile, password },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { status: 'failure', message: data.error || 'Login failed' }
      if (Array.isArray(data.chooseCompany) && data.chooseCompany.length > 0) {
        // No session yet: the server sets no cookie until a company is chosen.
        return {
          status: 'choose',
          organisations: data.chooseCompany.map((c: { tenantId: string; companyName: string }) => ({
            id: c.tenantId,
            label: c.companyName,
          })),
        }
      }
      // Return the user to the page their session died on. `?next=` is set by
      // whoever sent them here — middleware for a page navigation, the 401
      // handler for a data call — and is checked AGAIN here with the same
      // isSafeReturnPath() those two used, because a query string is
      // typed-in-able and an unchecked one turns this screen into an open
      // redirect: `//evil.example` reads as another host, and the victim has
      // just entered their password on the real site. It survives the company
      // step because it is read from the URL, which that step never changes.
      const next = searchParams.get('next')
      router.push(isSafeReturnPath(next) ? next : '/')
      return 'success'
    } catch {
      return { status: 'failure', message: 'Network error. Please try again.' }
    }
  }

  async function forgotPassword(mobile: string): Promise<ForgotPasswordResult> {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: mobile }),
      })
      if (res.ok) return 'sent'
      const data = await res.json().catch(() => ({}))
      return { status: 'failure', message: data.error || 'Something went wrong' }
    } catch {
      return { status: 'failure', message: 'Network error. Please try again.' }
    }
  }

  // The template fills its parent (min-h-full, flex-1): the kit's root layout
  // gives the page a full-height flex column, this product's does not, so the
  // login route supplies one.
  return (
    <div className="flex min-h-dvh flex-col">
      <SignInPage
        product={{ name: APP_NAME, mark: <Boxes /> }}
        headline="Your field team, in one place"
        highlight="in one place"
        supportingLine="Plan visits, log orders and expenses, and keep every account up to date."
        methods={['phone']}
        onSubmitMobile={signIn}
        onForgotPassword={forgotPassword}
        text={TEXT}
      />
    </div>
  )
}
