"use client"

import * as React from "react"
import { CircleCheckIcon, OctagonXIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { fieldKeyboard } from "@/lib/field-keyboard"
import { useLayout } from "@/lib/layout"
import { emailError, mobileDigits, mobileError } from "@/lib/validation"
import { Banner, BannerDescription } from "@/components/ui/banner"
import { Button } from "@/components/ui/button"
import { InlineFieldError } from "@/components/ui/inline-field-error"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { ChoiceRow } from "@/components/ui/choice-row"
import { Label } from "@/components/ui/label"
import { OtpField } from "@/components/ui/otp-field"
import { PasswordInput } from "@/components/ui/password-input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toast } from "@/components/ui/sonner"
import { formatClock } from "@/components/ui/time-picker"

/**
 * Section 11.7, the sign-in page. One half says what the product is, the
 * other signs people in.
 *
 * Everything the brand panel says is the product's own (section 0.1 item
 * 5), so it arrives as props; the form's words are the system's, kept in
 * SIGN_IN_TEXT below, which a product in another language replaces
 * through `text` from its strings file (37.6 rule 2). The field checks'
 * words are lib/validation.ts's, the kit's one wording for each. The
 * panel's colours all come from the brand block, so a brand swap carries
 * the whole panel.
 *
 * SIGN-IN METHODS (11.7, section 0.1 item 10). `methods` lists the
 * product's methods, the main one first:
 *
 *   - ["email"], the default: email and password, the form below.
 *   - ["phone"]: a mobile number and a password, for a product whose
 *     people are known by their number. The same form, with the mobile
 *     number field of the OTP method (country code fixed at its start)
 *     in place of the email field; onSubmitMobile receives the 10-digit
 *     national number.
 *   - ["otp"]: a mobile number and an OTP sent to it by SMS.
 *   - Any two of them, in either order: the first shows first, with a
 *     standing text link to the other below its button.
 *
 * AFTER THE PASSWORD IS SENT (email and phone methods). onSubmit /
 * onSubmitMobile resolves one of:
 *
 *   - "success": the caller navigates away; the button keeps its loading
 *     state until it does.
 *   - "failure", or { status: "failure", message }: the one danger banner.
 *     `message` is the server's own plain-language reason (a locked
 *     account, a suspended organisation); without it the banner says
 *     text.failure, which never names the field that was wrong.
 *   - { status: "choose", organisations }: the same credentials belong to
 *     more than one organisation. The page shows a "Choose an
 *     organisation" step (a radio list, Continue, and a link back to the
 *     form) and calls onSubmit / onSubmitMobile again with the same
 *     credentials plus `organisationId`. A failure on that second call
 *     returns to the form with the banner. The password stays in memory
 *     only, never in the address or in storage.
 *
 * FORGOT PASSWORD. Give forgotPasswordHref and the page shows a standing
 * link to that address. Give onForgotPassword as well (or alone) and the
 * link stays on the page instead: it opens a step asking for the same
 * identifier as the method (email address, or mobile number), calls
 * onForgotPassword(identifier, method), and answers with the neutral
 * confirmation "If an account exists for that ..." whatever the account
 * (11.7 rule 6). It resolves "sent", or "failure" / { status: "failure",
 * message } for a request that could not be made.
 *
 * The OTP method is not phone-only: on a computer it sits in the right
 * half exactly where the email form does, under the same layout rules.
 *
 * THE OTP SMS (11.7 rule 2), for the product's backend. On Android the
 * page reads the OTP with the browser's own OTP reader (the Web OTP API),
 * which only offers an SMS whose LAST line is the product's domain and the
 * code, in exactly this form:
 *
 *     Your RGB Kit OTP is 482913. It expires in 10 minutes.
 *
 *     @app.example.com #482913
 *
 * "@" and the domain the sign-in page is served from (the host only: no
 * https://, no port, no path), one space, "#" and the code. Any other last
 * line and Android never offers the code; the person types it, and iPhone
 * still offers it from the keyboard (autocomplete="one-time-code").
 *
 * ON PHONE (41.17 rules 1 to 3). The brand panel is a strip across the
 * top holding only the mark and the name, on primary, reaching up behind
 * the phone's status bar and padded by the top safe area (41.13 rules 2
 * and 4). The headline, supporting line and footer are not shown. The form
 * runs the full width of the content area: 16px at the sides plus the side
 * safe areas, and 16px below the strip (41.4 rule 20). Its fields and its
 * 44px button run the full width of the form; held sideways it stays in
 * the centred 600px column (41.13 rule 10). Every phone difference is a
 * `phone:` class or a decision taken when the person acts, so the desktop
 * layout is the one it always was.
 *
 * ENTER (41.7 rule 6, 11.3 rule 6). On a computer Enter in any field signs
 * in (39.2). On phone, Enter in the email field moves to the password field
 * (its key reads Next), and Enter in the password field signs in (its key
 * reads Go): signing in is not a record form, so its last field submits.
 * The mobile number and OTP steps hold one field each, whose Enter key
 * reads Go and submits the step. A field is checked when the person leaves
 * it or presses the button, never before.
 *
 * Nothing takes focus when the page opens (41.7 rule 17). Moving between
 * methods or steps puts focus in the new first field on a computer (39.3),
 * and on the new step's opening line on a phone, which a screen reader
 * reads and which opens no keyboard.
 *
 * STAYING SIGNED IN on a phone (41.17 rule 4) is the session's lifetime,
 * set by the backend: until the person signs out, or 30 days without use.
 * Fingerprint or face unlock (41.17 rule 5) is the store app's.
 */

export type Product = {
  name: string
  /** The product mark, drawn at the 22px icon size beside the name. */
  mark: React.ReactNode
}

export type SignInResult = "success" | "failure"

/** An organisation one person can sign in to, when they belong to several. */
export type Organisation = { id: string; label: string }

/** What sending the password came to; see "AFTER THE PASSWORD IS SENT" above. */
export type SignInOutcome =
  | SignInResult
  /** `message` is the server's plain-language reason; it replaces text.failure. */
  | { status: "failure"; message?: string }
  | { status: "choose"; organisations: readonly Organisation[] }

/** What asking for a password reset came to. Neutral: "sent" for an unknown account too. */
export type ForgotPasswordResult = "sent" | "failure" | { status: "failure"; message?: string }

export type SignInMethod = "email" | "phone" | "otp"

/** What sending an OTP came to. An unregistered number is "sent" too (11.7 rule 6). */
export type SendOtpResult =
  | { status: "sent" }
  /** The server has blocked this number after 5 wrong OTPs (11.7 rule 4). */
  | { status: "blocked"; until: Date }

/** What checking an OTP came to. */
export type VerifyOtpResult =
  /** Signed in: the caller navigates away; the page keeps "Signing in" until it does. */
  | { status: "ok" }
  | { status: "wrong" }
  | { status: "expired" }
  | { status: "blocked"; until: Date }

type BrandProps = {
  product: Product
  /** Eight words or fewer (11.7). */
  headline: string
  /** One phrase inside the headline, shown in on-brand-accent. Only one. */
  highlight?: string
  /** One or two sentences under the headline. */
  supportingLine: string
}

type CommonProps = {
  /** Fixed at the start of the mobile number field. +91 for Indian products. */
  countryCode?: string
  /** The standing link to the forgot-password page; see FORGOT PASSWORD above. */
  forgotPasswordHref?: string
  /**
   * Forgot password on this page instead of a link to another: `identifier`
   * is the email address, or the 10-digit mobile number, as `method` says.
   */
  onForgotPassword?: (identifier: string, method: "email" | "phone") => Promise<ForgotPasswordResult>
}

type EmailMethodProps = {
  /**
   * Resolves "failure" for a wrong email or password, which shows the one
   * failure banner. On "success" the caller navigates away; the button
   * stays in its loading state until it does, so it cannot be pressed twice.
   * `organisationId` is set only on the call that follows a "choose".
   */
  onSubmit: (credentials: {
    email: string
    password: string
    organisationId?: string
  }) => Promise<SignInOutcome>
}

type PhoneMethodProps = {
  /** As onSubmit, for a mobile number: `mobile` is the 10 digits, without the country code. */
  onSubmitMobile: (credentials: {
    mobile: string
    password: string
    organisationId?: string
  }) => Promise<SignInOutcome>
}

type OtpMethodProps = {
  /**
   * Sends an OTP by SMS, in the format above. `mobile` is the full
   * number with its country code, "+919876543210". The server answers
   * "sent" for a number it does not know as well (11.7 rule 6). A request
   * that fails or times out should reject: the page then says it could not
   * send, and the person can try again. Give the request a deadline (14
   * rule 4).
   */
  sendOtp: (mobile: string) => Promise<SendOtpResult>
  /**
   * Checks the OTP. The server counts wrong tries and blocks the number
   * for 15 minutes after the fifth (11.7 rule 4). Rejects on a failed or
   * timed-out request, as sendOtp.
   */
  verifyOtp: (mobile: string, code: string) => Promise<VerifyOtpResult>
  /**
   * The product's OTP length (section 11.7 rule 2), set once here, never
   * per screen. Matches what the backend sends. Every wording below
   * follows it ("Enter the 4-digit OTP"). 6 by default.
   */
  otpLength?: number
}

type Absent<T> = { [K in keyof T]?: never }

type MethodProps = { email: EmailMethodProps; phone: PhoneMethodProps; otp: OtpMethodProps }

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never

/** The props of the methods used, and none of the props of the methods not used. */
type Configured<Used extends SignInMethod> = UnionToIntersection<MethodProps[Used]> &
  Absent<UnionToIntersection<MethodProps[Exclude<SignInMethod, Used>]>>

type SignInPageProps = BrandProps &
  CommonProps & {
    /** The form's words in the product's language (37.6 rule 2); English by default. */
    text?: Partial<SignInText>
  } & (
    | ({ methods?: readonly ["email"] } & Configured<"email">)
    | ({ methods: readonly ["phone"] } & Configured<"phone">)
    | ({ methods: readonly ["otp"] } & Configured<"otp">)
    | ({ methods: readonly ["email", "phone"] | readonly ["phone", "email"] } & Configured<"email" | "phone">)
    | ({ methods: readonly ["email", "otp"] | readonly ["otp", "email"] } & Configured<"email" | "otp">)
    | ({ methods: readonly ["phone", "otp"] | readonly ["otp", "phone"] } & Configured<"phone" | "otp">)
  )

/** The form's words (section 37), for a product in another language (37.6 rule 2). */
type SignInText = {
  title: string
  emailHelper: string
  emailLabel: string
  passwordLabel: string
  forgotPassword: string
  signIn: string
  signingIn: string
  /** 11.7: the failed sign-in banner, never naming which field was wrong. */
  failure: string
  /** The failed sign-in banner of the mobile number and password method. */
  failurePhone: string
  passwordMissing: string
  mobileHelper: string
  mobileLabel: string
  sendOtp: string
  sendingOtp: string
  /** "Enter the 6-digit OTP sent to " - the masked number follows. `digits` is the product's otpLength. */
  otpSentTo: (digits: number) => string
  /** For screen readers, in place of the masked number: "the number ending 421". */
  numberEnding: (lastDigits: string) => string
  changeNumber: string
  otpLabel: string
  /** "Enter the 6-digit OTP from the SMS." */
  otpMissing: (digits: number) => string
  resendOtp: string
  /** "Resend OTP in 0:24" */
  resendOtpIn: (countdown: string) => string
  newOtpSent: string
  wrongOtp: string
  expiredOtp: string
  sendFailed: string
  verifyFailed: string
  /** 11.7 rule 4: says when the person can try again. */
  blocked: (time: string) => string
  useEmail: string
  useMobile: string
  /** The link to the mobile number and password method, from email or OTP. */
  usePhone: string
  chooseTitle: string
  chooseHelper: string
  /** The radio list's name, for screen readers. */
  organisationLabel: string
  organisationMissing: string
  continue: string
  backToSignIn: string
  forgotTitle: string
  forgotHelperEmail: string
  forgotHelperMobile: string
  sendReset: string
  sendingReset: string
  /** 11.7 rule 6: the same words whether or not an account exists. `method` says what was typed. */
  forgotSent: (method: "email" | "phone") => string
  forgotFailed: string
}

const SIGN_IN_TEXT: SignInText = {
  title: "Sign in to your workspace",
  emailHelper: "Use the email address your administrator invited.",
  emailLabel: "Email address",
  passwordLabel: "Password",
  forgotPassword: "Forgot your password?",
  signIn: "Sign in",
  signingIn: "Signing in",
  failure: "The email or password is not right. Check both and try again.",
  failurePhone: "The mobile number or password is not right. Check both and try again.",
  passwordMissing: "Enter your password.",
  mobileHelper: "Use the mobile number your administrator added.",
  mobileLabel: "Mobile number",
  sendOtp: "Send OTP",
  sendingOtp: "Sending OTP",
  otpSentTo: (digits) => `Enter the ${digits}-digit OTP sent to `,
  numberEnding: (lastDigits) => `the number ending ${lastDigits}`,
  changeNumber: "Change number",
  otpLabel: "OTP",
  otpMissing: (digits) => `Enter the ${digits}-digit OTP from the SMS.`,
  resendOtp: "Resend OTP",
  resendOtpIn: (countdown) => `Resend OTP in ${countdown}`,
  newOtpSent: "New OTP sent",
  wrongOtp: "That OTP is not right. Check the SMS and try again.",
  expiredOtp: "This OTP has expired. Send a new one.",
  sendFailed: "We could not send the OTP. Check your connection and try again.",
  verifyFailed: "We could not check the OTP. Check your connection and try again.",
  blocked: (time) => `Too many wrong OTPs were entered for this number. Try again after ${time}.`,
  useEmail: "Use email and password instead",
  useMobile: "Use mobile number instead",
  usePhone: "Use mobile number and password instead",
  chooseTitle: "Choose an organisation",
  chooseHelper: "Your sign-in works in more than one organisation. Choose the one to open.",
  organisationLabel: "Organisation",
  organisationMissing: "Choose an organisation to continue.",
  continue: "Continue",
  backToSignIn: "Back to sign in",
  forgotTitle: "Reset your password",
  forgotHelperEmail: "Enter the email address you sign in with. We will send you the steps to reset your password.",
  forgotHelperMobile: "Enter the mobile number you sign in with. We will send you the steps to reset your password.",
  sendReset: "Send reset steps",
  sendingReset: "Sending",
  forgotSent: (method) =>
    `If an account exists for that ${method === "email" ? "email address" : "mobile number"}, we have sent the steps to reset the password.`,
  forgotFailed: "We could not send the reset steps. Check your connection and try again.",
}

/** Where focus goes when a method or step appears; null on first paint (41.7 rule 17). */
type Arrival = "field" | "intro" | null

/** Splits the headline so the one highlighted phrase can be coloured. */
function Headline({ text, highlight }: { text: string; highlight?: string }) {
  if (process.env.NODE_ENV !== "production") {
    const words = text.trim().split(/\s+/).length
    if (words > 8) {
      console.warn(`[design-system] The sign-in headline has ${words} words. FRONTEND_RULES.md section 11.7: eight or fewer.`)
    }
    if (highlight && !text.includes(highlight)) {
      console.warn(`[design-system] The sign-in highlight "${highlight}" is not part of the headline, so nothing is highlighted (section 11.7).`)
    }
  }
  const at = highlight ? text.indexOf(highlight) : -1
  if (!highlight || at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="text-on-brand-accent">{highlight}</span>
      {text.slice(at + highlight.length)}
    </>
  )
}

/*
 * On phone the strip is the height of the app bar (56px, --spacing-topbar)
 * with the name at the app bar title's size, 20px - 11.7's section heading
 * size - fixed in px like the app bar's, so the strip never grows with the
 * text-size setting (41.4 rule 1). The mark keeps its 22px (41.9 rule 8).
 */
function ProductName({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-2 text-on-brand phone:h-topbar phone:px-4">
      <span aria-hidden="true" className="flex [&_svg]:size-icon-empty">
        {product.mark}
      </span>
      <span className="text-section font-medium phone:min-w-0 phone:truncate phone:text-bar-title">{product.name}</span>
    </div>
  )
}

/**
 * A text control that changes the form in place ("Change number", "Use
 * email and password instead"). 11.7 calls these text links and draws
 * them as standing links (6.6); they go to no other address, so like
 * "Show more" (6.6 rule 5) they are buttons drawn as a standing link - the
 * classes TextLink's standing appearance uses, with the 9 rule 4 tap area.
 * The underline also shows while pressed: on phone the pressed state is
 * the only feedback a tap gets (41.9 rule 1).
 */
function InPlaceLink({ className, ...props }: Omit<React.ComponentProps<"button">, "type">) {
  return (
    <button
      type="button"
      className={cn(
        "tap-area cursor-pointer rounded-sm text-body text-primary-text no-underline decoration-1 underline-offset-2 hover:underline active:underline",
        "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring",
        className
      )}
      {...props}
    />
  )
}

/** The link to the product's other method, centred below the form's button. */
function OtherMethod({ to, onSwitch, t }: { to: SignInMethod; onSwitch: () => void; t: SignInText }) {
  return (
    <div className="mt-6 flex justify-center">
      <InPlaceLink onClick={onSwitch}>
        {to === "email" ? t.useEmail : to === "phone" ? t.usePhone : t.useMobile}
      </InPlaceLink>
    </div>
  )
}

/** Focuses the new first field, or the new opening line, when a method or step appears. */
function useArrivalFocus(
  arrival: Arrival,
  field: React.RefObject<HTMLElement | null>,
  intro: React.RefObject<HTMLElement | null>,
  key?: unknown
) {
  React.useEffect(() => {
    if (arrival === "field") field.current?.focus()
    else if (arrival === "intro") intro.current?.focus()
  }, [arrival, field, intro, key])
}

// ---------------------------------------------------------------------
// Email or mobile number, and password
// ---------------------------------------------------------------------

/** A password method: the person is known by an email address, or by a mobile number. */
type PasswordKind = "email" | "phone"

/** The form, the organisation step, the forgot-password step and its confirmation. */
type PasswordStep = "form" | "choose" | "forgot" | "forgot-sent"

/** The email and phone methods share one form, so they cannot drift apart. */
type PasswordFormProps = {
  kind: PasswordKind
  /** `identifier` is the trimmed email address, or the 10-digit mobile number. */
  onSubmit: (credentials: {
    identifier: string
    password: string
    organisationId?: string
  }) => Promise<SignInOutcome>
  forgotPasswordHref?: string
  onForgotPassword?: CommonProps["onForgotPassword"]
  countryCode: string
  arrival: Arrival
  other?: React.ReactNode
  t: SignInText
}

function PasswordForm({
  kind,
  onSubmit,
  forgotPasswordHref,
  onForgotPassword,
  countryCode,
  arrival,
  other,
  t,
}: PasswordFormProps) {
  const { layout } = useLayout()
  const isPhone = kind === "phone"
  const identifierError = (value: string) => (isPhone ? mobileError(value) : emailError(value))
  const passwordError = (value: string) => (value === "" ? t.passwordMissing : null)
  const [step, setStep] = React.useState<PasswordStep>("form")
  const [stepArrival, setStepArrival] = React.useState<Arrival>(arrival)
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [errors, setErrors] = React.useState<{ identifier?: string | null; password?: string | null }>({})
  /** The failure banner's words; null when there is no failure. */
  const [failed, setFailed] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [organisations, setOrganisations] = React.useState<readonly Organisation[]>([])
  const [organisationId, setOrganisationId] = React.useState("")
  const [organisationErr, setOrganisationErr] = React.useState<string | null>(null)
  const [forgotValue, setForgotValue] = React.useState("")
  const [forgotErr, setForgotErr] = React.useState<string | null>(null)
  const [forgotProblem, setForgotProblem] = React.useState<string | null>(null)
  const [forgotPending, setForgotPending] = React.useState(false)
  const identifierRef = React.useRef<HTMLInputElement>(null)
  const passwordRef = React.useRef<HTMLInputElement>(null)
  const forgotRef = React.useRef<HTMLInputElement>(null)
  /** The opening line of whichever step is showing: the helper, or the step's title. */
  const introRef = React.useRef<HTMLElement>(null)

  useArrivalFocus(stepArrival, step === "forgot" ? forgotRef : identifierRef, introRef, step)

  /** A step that is only a question or a statement takes focus on its opening line, which opens no keyboard. */
  function goTo(next: PasswordStep) {
    setStep(next)
    setStepArrival(next === "choose" || next === "forgot-sent" || layout === "phone" ? "intro" : "field")
  }

  async function send(chosen?: string) {
    setFailed(null)
    setPending(true)
    let outcome: SignInOutcome
    try {
      outcome = await onSubmit({
        identifier: isPhone ? identifier : identifier.trim(),
        password,
        ...(chosen ? { organisationId: chosen } : {}),
      })
    } catch {
      outcome = "failure"
    }
    // Signed in: the button stays loading until the caller has navigated away.
    if (outcome === "success") return
    setPending(false)
    if (typeof outcome === "object" && outcome.status === "choose") {
      setOrganisations(outcome.organisations)
      setOrganisationId("")
      setOrganisationErr(null)
      goTo("choose")
      return
    }
    const message = typeof outcome === "object" && outcome.status === "failure" ? outcome.message : undefined
    setFailed(message || (isPhone ? t.failurePhone : t.failure))
    // The credentials no longer hold (or the choice failed): the form is where that belongs.
    if (chosen) goTo("form")
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const next = { identifier: identifierError(identifier), password: passwordError(password) }
    setErrors(next)
    // 39.3: when a submit fails validation, focus moves to the first field with an error.
    if (next.identifier) return identifierRef.current?.focus()
    if (next.password) return passwordRef.current?.focus()
    void send()
  }

  function submitOrganisation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!organisationId) return setOrganisationErr(t.organisationMissing)
    void send(organisationId)
  }

  function openForgot() {
    setForgotValue(identifier)
    setForgotErr(null)
    setForgotProblem(null)
    goTo("forgot")
  }

  async function submitForgot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (forgotPending || !onForgotPassword) return
    const error = identifierError(forgotValue)
    setForgotErr(error)
    if (error) return forgotRef.current?.focus()
    setForgotProblem(null)
    setForgotPending(true)
    let result: ForgotPasswordResult
    try {
      result = await onForgotPassword(isPhone ? forgotValue : forgotValue.trim(), kind)
    } catch {
      result = "failure"
    }
    setForgotPending(false)
    if (result === "sent") return goTo("forgot-sent")
    setForgotProblem((typeof result === "object" && result.message) || t.forgotFailed)
  }

  function backToForm() {
    setFailed(null)
    goTo("form")
  }

  const backLink = (
    <div className="mt-6 flex justify-center">
      <InPlaceLink onClick={backToForm}>{t.backToSignIn}</InPlaceLink>
    </div>
  )

  if (step === "choose") {
    return (
      <form noValidate onSubmit={submitOrganisation} className="w-full max-w-auth-form phone:max-w-phone-column" aria-describedby="sign-in-helper">
        <h1 ref={introRef as React.RefObject<HTMLHeadingElement>} tabIndex={-1} className="text-page-title font-medium text-text-primary outline-none">
          {t.chooseTitle}
        </h1>
        <p id="sign-in-helper" className="mt-2 text-body text-text-secondary">
          {t.chooseHelper}
        </p>

        <RadioGroup
          aria-label={t.organisationLabel}
          className="mt-8 gap-2"
          value={organisationId}
          onValueChange={(value) => {
            setOrganisationId(String(value))
            setOrganisationErr(null)
          }}
        >
          {organisations.map((organisation) => (
            <ChoiceRow
              key={organisation.id}
              control={<RadioGroupItem value={organisation.id} disabled={pending} />}
              label={organisation.label}
            />
          ))}
        </RadioGroup>
        <InlineFieldError id="sign-in-organisation-error">{organisationErr}</InlineFieldError>

        <Button type="submit" size="lg" className="mt-6 w-full" loading={pending} loadingLabel={t.signingIn}>
          {t.continue}
        </Button>

        {backLink}
      </form>
    )
  }

  if (step === "forgot" || step === "forgot-sent") {
    const sent = step === "forgot-sent"
    return (
      <form noValidate onSubmit={submitForgot} className="w-full max-w-auth-form phone:max-w-phone-column" aria-describedby="sign-in-helper">
        <h1
          ref={sent ? (introRef as React.RefObject<HTMLHeadingElement>) : undefined}
          tabIndex={sent ? -1 : undefined}
          className="text-page-title font-medium text-text-primary outline-none"
        >
          {t.forgotTitle}
        </h1>
        {sent ? (
          // 11.7 rule 6: the same words for a known and an unknown account.
          <>
            <Banner variant="success" className="mt-8">
              <CircleCheckIcon />
              <BannerDescription id="sign-in-helper">{t.forgotSent(kind)}</BannerDescription>
            </Banner>
            <Button type="button" size="lg" className="mt-6 w-full" onClick={backToForm}>
              {t.backToSignIn}
            </Button>
          </>
        ) : (
          <>
            <p ref={introRef as React.RefObject<HTMLParagraphElement>} tabIndex={-1} id="sign-in-helper" className="mt-2 text-body text-text-secondary outline-none">
              {isPhone ? t.forgotHelperMobile : t.forgotHelperEmail}
            </p>

            <div className="mt-8">
              <Label htmlFor="sign-in-forgot" required>
                {isPhone ? t.mobileLabel : t.emailLabel}
              </Label>
              {isPhone ? (
                <InputGroup className="mt-2">
                  <InputGroupAddon>
                    <InputGroupText className="text-body">{countryCode}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    ref={forgotRef}
                    id="sign-in-forgot"
                    name="mobile"
                    {...fieldKeyboard("phone", { last: true, autoComplete: "tel-national" })}
                    enterKeyHint="go"
                    value={forgotValue}
                    aria-invalid={forgotErr ? true : undefined}
                    aria-describedby={forgotErr ? "sign-in-forgot-error" : undefined}
                    onChange={(e) => setForgotValue(mobileDigits(e.target.value, countryCode))}
                    onBlur={() => setForgotErr(identifierError(forgotValue))}
                  />
                </InputGroup>
              ) : (
                <Input
                  ref={forgotRef}
                  id="sign-in-forgot"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  enterKeyHint="go"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="mt-2 max-w-none"
                  value={forgotValue}
                  aria-invalid={forgotErr ? true : undefined}
                  aria-describedby={forgotErr ? "sign-in-forgot-error" : undefined}
                  onChange={(e) => setForgotValue(e.target.value)}
                  onBlur={() => setForgotErr(identifierError(forgotValue))}
                />
              )}
              <InlineFieldError id="sign-in-forgot-error">{forgotErr}</InlineFieldError>
            </div>

            {forgotProblem ? (
              <Banner variant="danger" className="mt-6">
                <OctagonXIcon />
                <BannerDescription>{forgotProblem}</BannerDescription>
              </Banner>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="mt-6 w-full"
              loading={forgotPending}
              loadingLabel={t.sendingReset}
            >
              {t.sendReset}
            </Button>

            {backLink}
          </>
        )}
      </form>
    )
  }

  // 41.7 rule 6: on phone, Enter in the identifier field moves to the
  // password field (the key reads Next) rather than signing in. Leaving
  // checks this field (11.3 rule 6); the password field is not checked
  // until the person leaves it or signs in. On a computer Enter signs in,
  // as before (39.2).
  function identifierEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (layout !== "phone" || e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) passwordRef.current?.focus()
  }

  return (
    <form noValidate onSubmit={submit} className="w-full max-w-auth-form phone:max-w-phone-column" aria-describedby="sign-in-helper">
      <h1 className="text-page-title font-medium text-text-primary">{t.title}</h1>
      {/* tabIndex -1: on phone focus lands here when this method is
          switched to, so no keyboard opens (41.7 rule 17). Never by Tab. */}
      <p ref={introRef as React.RefObject<HTMLParagraphElement>} tabIndex={-1} id="sign-in-helper" className="mt-2 text-body text-text-secondary outline-none">
        {isPhone ? t.mobileHelper : t.emailHelper}
      </p>

      <div className="mt-8">
        <Label htmlFor="sign-in-identifier" required>
          {isPhone ? t.mobileLabel : t.emailLabel}
        </Label>
        {/* 41.17 rule 3: "username" pairs the address or number with the
            password below, so the phone's password manager fills both. */}
        {isPhone ? (
          // 11.7 rule 1: the country code fixed at the start (6.5: the
          // group owns the border; the code is an addon inside it).
          <InputGroup className="mt-2">
            <InputGroupAddon>
              <InputGroupText className="text-body">{countryCode}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              ref={identifierRef}
              id="sign-in-identifier"
              name="mobile"
              {...fieldKeyboard("phone", { autoComplete: "username" })}
              value={identifier}
              aria-invalid={errors.identifier ? true : undefined}
              aria-describedby={errors.identifier ? "sign-in-identifier-error" : undefined}
              onChange={(e) => setIdentifier(mobileDigits(e.target.value, countryCode))}
              onKeyDown={identifierEnter}
              onBlur={() => setErrors((c) => ({ ...c, identifier: identifierError(identifier) }))}
            />
          </InputGroup>
        ) : (
          <Input
            ref={identifierRef}
            id="sign-in-identifier"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            enterKeyHint="next"
            autoCapitalize="none"
            spellCheck={false}
            className="mt-2 max-w-none"
            value={identifier}
            aria-invalid={errors.identifier ? true : undefined}
            aria-describedby={errors.identifier ? "sign-in-identifier-error" : undefined}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={identifierEnter}
            onBlur={() => setErrors((c) => ({ ...c, identifier: identifierError(identifier) }))}
          />
        )}
        <InlineFieldError id="sign-in-identifier-error">{errors.identifier}</InlineFieldError>
      </div>

      <div className="mt-6">
        <Label htmlFor="sign-in-password" required>
          {t.passwordLabel}
        </Label>
        <PasswordInput
          ref={passwordRef}
          id="sign-in-password"
          name="password"
          autoComplete="current-password"
          enterKeyHint="go"
          className="mt-2 max-w-none"
          value={password}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "sign-in-password-error" : undefined}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setErrors((c) => ({ ...c, password: passwordError(password) }))}
        />
        <InlineFieldError id="sign-in-password-error">{errors.password}</InlineFieldError>
        {onForgotPassword || forgotPasswordHref ? (
          <div className="mt-2 flex justify-end">
            {/* 6.6: a standing link - primary-text, body weight, underline on hover. */}
            {onForgotPassword ? (
              <InPlaceLink onClick={openForgot}>{t.forgotPassword}</InPlaceLink>
            ) : (
              <a
                href={forgotPasswordHref}
                className={cn(
                  "tap-area rounded-sm text-body text-primary-text hover:underline",
                  "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
                )}
              >
                {t.forgotPassword}
              </a>
            )}
          </div>
        ) : null}
      </div>

      {failed ? (
        <Banner variant="danger" className="mt-6">
          <OctagonXIcon />
          <BannerDescription>{failed}</BannerDescription>
        </Banner>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        loading={pending}
        loadingLabel={t.signingIn}
      >
        {t.signIn}
      </Button>

      {other}
    </form>
  )
}

// ---------------------------------------------------------------------
// Mobile number and OTP - 11.7 rules 1 to 6
// ---------------------------------------------------------------------

/** 11.7 rule 2: the default OTP length when a product does not set its own. */
const DEFAULT_OTP_LENGTH = 6
/** 11.7 rule 3: "Resend OTP" becomes available 30 seconds after an OTP is sent. */
const RESEND_AFTER_MS = 30_000

/** A no-break space, written as a code so it is never mistaken for a plain one. */
const NBSP = String.fromCharCode(0xa0)

/**
 * "+91 98••• ••421": the first two and last three digits (11.7 rule 2).
 * No-break spaces, so the number never splits across two lines at 320px.
 */
function maskedNumber(countryCode: string, digits: string) {
  return `${countryCode}${NBSP}${digits.slice(0, 2)}•••${NBSP}••${digits.slice(7)}`
}

/** "0:24" */
function countdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/* The Web OTP API is not in TypeScript's DOM types. */
type OtpCredentialRequest = CredentialRequestOptions & { otp: { transport: "sms"[] } }
type OtpCredentialResult = (Credential & { code?: string }) | null

function OtpForm({
  sendOtp,
  verifyOtp,
  countryCode = "+91",
  otpLength = DEFAULT_OTP_LENGTH,
  arrival,
  other,
  t,
}: OtpMethodProps & Pick<CommonProps, "countryCode"> & { arrival: Arrival; other?: React.ReactNode; t: SignInText }) {
  const { layout } = useLayout()
  const otpError = (value: string) => (value.length === otpLength ? null : t.otpMissing(otpLength))
  const [step, setStep] = React.useState<"number" | "code">("number")
  const [stepArrival, setStepArrival] = React.useState<Arrival>(arrival)
  const [mobile, setMobile] = React.useState("")
  const [mobileErr, setMobileErr] = React.useState<string | null>(null)
  const [code, setCode] = React.useState("")
  const [codeErr, setCodeErr] = React.useState<string | null>(null)
  const [codeTouched, setCodeTouched] = React.useState(false)
  /** A failed request (danger banner). */
  const [problem, setProblem] = React.useState<string | null>(null)
  /** The time the server's block ends (11.7 rule 4). */
  const [blockedUntil, setBlockedUntil] = React.useState<number | null>(null)
  const [sending, setSending] = React.useState(false)
  const [verifying, setVerifying] = React.useState(false)
  /** When "Resend OTP" becomes available; null when it is available now. */
  const [resendAt, setResendAt] = React.useState<number | null>(null)
  const [now, setNow] = React.useState(0)
  /** Counts OTPs sent, so the SMS reader starts again for each new one. */
  const [sent, setSent] = React.useState(0)
  const inFlight = React.useRef(false)
  const mobileRef = React.useRef<HTMLInputElement>(null)
  const codeRef = React.useRef<HTMLInputElement>(null)
  const introRef = React.useRef<HTMLParagraphElement>(null)

  const fullNumber = `${countryCode}${mobile}`
  const blocked = blockedUntil !== null
  const secondsLeft = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000))
  const arrivalFor = (): Arrival => (layout === "phone" ? "intro" : "field")

  useArrivalFocus(stepArrival, step === "number" ? mobileRef : codeRef, introRef, step)

  // The countdown (11.7 rule 3), one tick a second until it reaches 0:00.
  React.useEffect(() => {
    if (resendAt === null) return
    const id = window.setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (tick >= resendAt) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [resendAt])

  // The block lifts by itself at the time the message gave, with Resend
  // available at once.
  React.useEffect(() => {
    if (blockedUntil === null) return
    const id = window.setTimeout(() => {
      setBlockedUntil(null)
      setResendAt(null)
      setCodeErr(null)
    }, Math.max(0, blockedUntil - Date.now()))
    return () => window.clearTimeout(id)
  }, [blockedUntil])

  async function send(kind: "first" | "again") {
    if (sending) return
    setProblem(null)
    setSending(true)
    let result: SendOtpResult
    try {
      result = await sendOtp(fullNumber)
    } catch {
      setSending(false)
      setProblem(t.sendFailed)
      return
    }
    setSending(false)
    if (result.status === "blocked") {
      setBlockedUntil(result.until.getTime())
      return
    }
    const sentAt = Date.now()
    setNow(sentAt)
    setResendAt(sentAt + RESEND_AFTER_MS)
    setSent((n) => n + 1)
    setCode("")
    setCodeErr(null)
    setCodeTouched(false)
    if (kind === "first") {
      setStep("code")
      setStepArrival(arrivalFor())
    } else {
      toast.success(t.newOtpSent)
      // The Resend button has just disabled itself under the focus.
      if (layout === "phone") introRef.current?.focus()
      else codeRef.current?.focus()
    }
  }

  async function verify(value: string) {
    if (inFlight.current || blocked) return
    inFlight.current = true
    setProblem(null)
    setCodeErr(null)
    setVerifying(true)
    let result: VerifyOtpResult
    try {
      result = await verifyOtp(fullNumber, value)
    } catch {
      inFlight.current = false
      setVerifying(false)
      setProblem(t.verifyFailed)
      return
    }
    // Signed in: stays "Signing in" until the caller has navigated away.
    if (result.status === "ok") return
    inFlight.current = false
    setVerifying(false)
    if (result.status === "wrong") {
      setCodeErr(t.wrongOtp)
      // Typing the next try replaces the wrong one.
      if (document.activeElement === codeRef.current) codeRef.current?.select()
    } else if (result.status === "expired") {
      setCodeErr(t.expiredOtp)
      // 11.7 rule 5: Resend is available at once.
      setResendAt(null)
    } else {
      setBlockedUntil(result.until.getTime())
    }
  }

  // 11.7 rule 2, Android: the browser's own OTP reader offers the code
  // from the SMS, and once the person allows it the page signs in by
  // itself. It starts again for every OTP sent, and stops on leaving this
  // step or the page. Where the browser has none (iPhone, a computer) the
  // keyboard offers the code instead, through autocomplete.
  // PORT NOTE: the kit (React 19) uses React.useEffectEvent here, which
  // React 18 does not have. A ref holding the latest closure is the standard
  // stand-in: the effect below reads it at call time and so never needs the
  // handler in its dependency array.
  const onSmsCode = React.useRef((smsCode: string) => {
    void smsCode
  })
  onSmsCode.current = (smsCode: string) => {
    setCode(smsCode)
    setCodeTouched(true)
    void verify(smsCode)
  }
  React.useEffect(() => {
    if (step !== "code" || !("OTPCredential" in window)) return
    const controller = new AbortController()
    const request: OtpCredentialRequest = { otp: { transport: ["sms"] }, signal: controller.signal }
    ;(navigator.credentials.get(request) as Promise<OtpCredentialResult>)
      .then((credential) => {
        const smsCode = credential?.code ?? ""
        if (new RegExp(`^\\d{${otpLength}}$`).test(smsCode)) onSmsCode.current(smsCode)
      })
      // Stopped, refused or timed out: the person types the code.
      .catch(() => {})
    return () => controller.abort()
  }, [step, sent, otpLength])

  function submitNumber(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = mobileError(mobile)
    setMobileErr(error)
    if (error) return mobileRef.current?.focus()
    void send("first")
  }

  function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verifying || blocked) return
    const error = otpError(code)
    setCodeErr(error)
    if (error) return codeRef.current?.focus()
    void verify(code)
  }

  function changeNumber() {
    setStep("number")
    setStepArrival(arrivalFor())
    setCodeErr(null)
    setProblem(null)
  }

  // 11.7 rule 4: says when the person can try again, in section 18's h:mm A.
  const banner = blockedUntil !== null ? t.blocked(formatClock(new Date(blockedUntil))) : problem

  const bannerNode = banner ? (
    <Banner variant="danger" className="mt-6">
      <OctagonXIcon />
      <BannerDescription>{banner}</BannerDescription>
    </Banner>
  ) : null

  if (step === "number") {
    return (
      <form noValidate onSubmit={submitNumber} className="w-full max-w-auth-form phone:max-w-phone-column" aria-describedby="sign-in-helper">
        <h1 className="text-page-title font-medium text-text-primary">{t.title}</h1>
        <p ref={introRef} tabIndex={-1} id="sign-in-helper" className="mt-2 text-body text-text-secondary outline-none">
          {t.mobileHelper}
        </p>

        <div className="mt-8">
          <Label htmlFor="sign-in-mobile" required>
            {t.mobileLabel}
          </Label>
          {/* 11.7 rule 1: the country code fixed at the start (6.5: the
              group owns the border; the code is an addon inside it). */}
          <InputGroup className="mt-2">
            <InputGroupAddon>
              <InputGroupText className="text-body">{countryCode}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              ref={mobileRef}
              id="sign-in-mobile"
              name="mobile"
              // 41.7 rule 5: the phone keypad. tel-national: the number
              // without its country code, which the addon already holds
              // (41.17 rule 3). Enter sends the OTP, so it says Go: the
              // step's one field, so Enter submits on phone too.
              {...fieldKeyboard("phone", { autoComplete: "tel-national" })}
              enterKeyHint="go"
              value={mobile}
              aria-invalid={mobileErr ? true : undefined}
              aria-describedby={mobileErr ? "sign-in-mobile-error" : undefined}
              onChange={(e) => {
                setMobile(mobileDigits(e.target.value, countryCode))
                // A block is the server's answer for one number.
                setBlockedUntil(null)
              }}
              onBlur={() => setMobileErr(mobileError(mobile))}
            />
          </InputGroup>
          <InlineFieldError id="sign-in-mobile-error">{mobileErr}</InlineFieldError>
        </div>

        {bannerNode}

        <Button
          type="submit"
          size="lg"
          className="mt-6 w-full"
          loading={sending}
          loadingLabel={t.sendingOtp}
        >
          {t.sendOtp}
        </Button>

        {other}
      </form>
    )
  }

  const resendLabel = secondsLeft > 0 ? t.resendOtpIn(countdown(secondsLeft)) : t.resendOtp

  return (
    <form noValidate onSubmit={submitCode} className="w-full max-w-auth-form phone:max-w-phone-column" aria-describedby="sign-in-helper">
      <h1 className="text-page-title font-medium text-text-primary">{t.title}</h1>
      <p ref={introRef} tabIndex={-1} id="sign-in-helper" className="mt-2 text-body text-text-secondary outline-none">
        {t.otpSentTo(otpLength)}
        <span aria-hidden="true">{maskedNumber(countryCode, mobile)}</span>
        <span className="sr-only">{t.numberEnding(mobile.slice(7))}</span>.
      </p>
      <div className="mt-2">
        <InPlaceLink onClick={changeNumber}>{t.changeNumber}</InPlaceLink>
      </div>

      <div className="mt-8">
        <Label htmlFor="sign-in-otp" required>
          {t.otpLabel}
        </Label>
        {/* 11.7 rule 2: one real input drawn as a row of boxes
            (otp-field.tsx), never one input per box. numbers only;
            one-time-code lets the phone offer the code from the SMS
            (41.17 rule 3). The step's one field: Enter signs in, on
            phone too, so its key reads Go. It signs in by itself once
            the last digit is in. */}
        <OtpField
          ref={codeRef}
          id="sign-in-otp"
          name="otp"
          length={otpLength}
          enterKeyHint="go"
          className="mt-2"
          value={code}
          disabled={blocked}
          readOnly={verifying}
          invalid={!!codeErr}
          aria-describedby={codeErr ? "sign-in-otp-error" : undefined}
          onChange={(digits) => {
            const changed = digits !== code
            setCode(digits)
            setCodeTouched(true)
            if (changed) setCodeErr(null)
          }}
          onComplete={(digits) => {
            // Signs in by itself once the last digit is in.
            void verify(digits)
          }}
          onBlur={() => {
            // 11.3 rule 6, once the person has typed here: focus is put in
            // this field on a computer, and leaving it untouched for
            // "Change number" or "Resend OTP" is not a mistake.
            if (codeTouched && !verifying) setCodeErr((c) => c ?? otpError(code))
          }}
        />
        <InlineFieldError id="sign-in-otp-error">{codeErr}</InlineFieldError>
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={secondsLeft > 0 || verifying || blocked}
            loading={sending}
            loadingLabel={t.sendingOtp}
            onClick={() => void send("again")}
          >
            {resendLabel}
          </Button>
        </div>
      </div>

      {bannerNode}

      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={blocked}
        loading={verifying}
        loadingLabel={t.signingIn}
      >
        {t.signIn}
      </Button>

      {other}
    </form>
  )
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------

/*
 * Phone only. The page sits outside the app shell, where globals.css pads
 * <body> by the four safe areas (stage 2 decision 25). The page takes that
 * space back, so the strip reaches up behind the status bar and the
 * surface runs to every edge, and pads its own parts by the safe areas
 * instead (41.13 rules 2 and 4).
 */
const PHONE_PAGE = "phone:flex phone:-mt-safe-top phone:-mr-safe-right phone:-mb-safe-bottom phone:-ml-safe-left"
const PHONE_STRIP = "phone:pt-safe-top phone:pr-safe-right phone:pb-0 phone:pl-safe-left"
const PHONE_FORM_AREA = [
  "phone:items-start phone:pt-4",
  "phone:pr-[calc(var(--spacing)_*_4_+_var(--safe-right))] phone:pl-[calc(var(--spacing)_*_4_+_var(--safe-left))]",
  "phone:pb-[calc(var(--spacing)_*_8_+_var(--safe-bottom))]",
].join(" ")

function SignInPage(props: SignInPageProps) {
  const { product, headline, highlight, supportingLine } = props
  const t = { ...SIGN_IN_TEXT, ...props.text }
  const methods: readonly SignInMethod[] = props.methods ?? ["email"]
  const { layout } = useLayout()
  const [method, setMethod] = React.useState<SignInMethod>(methods[0])
  const [arrival, setArrival] = React.useState<Arrival>(null)

  const other = methods.find((m) => m !== method)
  const otherNode = other ? (
    <OtherMethod
      to={other}
      t={t}
      onSwitch={() => {
        setMethod(other)
        setArrival(layout === "phone" ? "intro" : "field")
      }}
    />
  ) : null

  const year = new Date().getFullYear()

  return (
    <div data-slot="sign-in-page" className={`flex min-h-full flex-1 flex-col lg:grid lg:grid-cols-2 ${PHONE_PAGE}`}>
      {/* The brand panel. Below 1024px it is a strip holding only the
          mark and the name; the headline and footer need the full half.
          On phone it is always the strip (41.17 rule 1). */}
      <section
        aria-label={product.name}
        className={`relative isolate flex flex-col overflow-hidden bg-linear-to-br from-primary to-primary-pressed px-6 py-4 lg:justify-between lg:p-12 ${PHONE_STRIP}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(var(--on-brand)_1px,transparent_1px),linear-gradient(90deg,var(--on-brand)_1px,transparent_1px)] bg-size-[32px_32px] opacity-(--brand-pattern-opacity)"
        />
        <ProductName product={product} />
        <div className="hidden max-w-md flex-col gap-4 lg:flex phone:hidden">
          {/* Section 3: Display, 40px at 500, on-brand. The only place it is used. */}
          <p className="text-display font-medium text-on-brand">
            <Headline text={headline} highlight={highlight} />
          </p>
          <p className="text-card-heading font-normal text-on-brand-muted">{supportingLine}</p>
        </div>
        <p className="hidden text-meta text-on-brand-muted lg:block phone:hidden">
          © {year} {product.name}
        </p>
      </section>

      <main className={`flex flex-1 items-center justify-center bg-surface px-4 py-12 ${PHONE_FORM_AREA}`}>
        {method === "otp" ? (
          <OtpForm
            sendOtp={props.sendOtp as OtpMethodProps["sendOtp"]}
            verifyOtp={props.verifyOtp as OtpMethodProps["verifyOtp"]}
            countryCode={props.countryCode}
            otpLength={props.otpLength}
            arrival={arrival}
            other={otherNode}
            t={t}
          />
        ) : (
          // keyed by method, so switching between email and mobile number
          // starts the other form afresh rather than carrying its state over.
          <PasswordForm
            key={method}
            kind={method}
            onSubmit={
              method === "phone"
                ? ({ identifier, ...rest }) =>
                    (props.onSubmitMobile as PhoneMethodProps["onSubmitMobile"])({ mobile: identifier, ...rest })
                : ({ identifier, ...rest }) =>
                    (props.onSubmit as EmailMethodProps["onSubmit"])({ email: identifier, ...rest })
            }
            forgotPasswordHref={props.forgotPasswordHref}
            onForgotPassword={props.onForgotPassword}
            countryCode={props.countryCode ?? "+91"}
            arrival={arrival}
            other={otherNode}
            t={t}
          />
        )}
      </main>
    </div>
  )
}

export { SignInPage, SIGN_IN_TEXT }
export type { SignInText }
