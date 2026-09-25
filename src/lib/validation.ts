/**
 * The field validators that were copy-pasted per route file.
 *
 * `00-CODEBASE-MAP.md` §4 records the old rule — "shared regexes (GSTIN, mobile,
 * pincode) are copy-pasted per file, not imported" — and the cost of it was
 * visible in `/api/leads`: PUT validated GSTIN, POST validated neither GSTIN nor
 * pincode, and the same three regexes were written out in eight route files with
 * eight independently-worded error messages. `03-PHASE-1-PLAN.md` P1-T10.6 asks
 * for one module; this is it.
 *
 * No validation library. `zod` is not a dependency and this does not add one —
 * these are the same early-return checks the routes already hand-wrote, lifted
 * out so POST and PUT cannot drift apart again.
 *
 * Each `check*` returns the error MESSAGE STRING a route puts in `{ error }`, or
 * `null` when the value is acceptable. Every one of them treats an absent or
 * blank value as acceptable: none of these fields is compulsory, and a route
 * that needs a field present says so itself.
 */

/** 15-character GSTIN. Copied verbatim from the eight files that carried it. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

/** Indian mobile number, as every existing route defined it: exactly 10 digits. */
export const MOBILE_RE = /^\d{10}$/

/** Indian PIN code: exactly 6 digits. */
export const PINCODE_RE = /^\d{6}$/

/**
 * Deliberately loose. An address-shaped `x@y.z` check rejects real addresses;
 * the only thing worth catching here is a value that is not an address at all.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `""`, `"   "`, null and undefined all mean "not supplied". */
function blank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/** The trimmed string, or null when the value is blank. */
export function trimmed(value: unknown): string | null {
  return blank(value) ? null : String(value).trim()
}

/** GSTIN is stored upper-case; the trimmed, upper-cased string, or null. */
export function normaliseGstin(value: unknown): string | null {
  const t = trimmed(value)
  return t === null ? null : t.toUpperCase()
}

/** `label` names the field in the message — "Mobile Number 1", "Mobile 1", … */
export function checkMobile(value: unknown, label: string): string | null {
  if (blank(value)) return null
  return MOBILE_RE.test(String(value).trim()) ? null : `${label} must be exactly 10 digits`
}

export function checkPincode(value: unknown, label = 'Pin Code'): string | null {
  if (blank(value)) return null
  return PINCODE_RE.test(String(value).trim()) ? null : `${label} must be exactly 6 digits`
}

export function checkGstin(value: unknown): string | null {
  if (blank(value)) return null
  return GSTIN_RE.test(String(value).trim().toUpperCase())
    ? null
    : 'Please enter a valid GST Number'
}

export function checkEmail(value: unknown, label = 'Email'): string | null {
  if (blank(value)) return null
  return EMAIL_RE.test(String(value).trim()) ? null : `${label} is not a valid email address`
}

/**
 * The first failure among the checks given, or null when all pass.
 *
 * ```ts
 * const bad = firstError(
 *   checkMobile(body.mobile_1, 'Mobile Number 1'),
 *   checkGstin(body.gst_number),
 * )
 * if (bad) return NextResponse.json({ error: bad }, { status: 400 })
 * ```
 *
 * One message, not a list: every route in this codebase answers a 400 with a
 * single `{ error: string }`, and the client renders exactly that string.
 */
export function firstError(...errors: (string | null)[]): string | null {
  return errors.find(e => e !== null) ?? null
}

/**
 * A phone number that may carry a dialling code inline — `+919876543210`.
 *
 * `checkMobile` above is deliberately untouched: every other form in this
 * product still posts bare ten-digit Indian numbers, and loosening the shared
 * check would stop catching a typo on all of them at once. This is the looser
 * rule, applied only where a country-code picker exists (the Contact form and
 * `/api/contacts`), and it still accepts the bare ten digits every existing row
 * holds — see `src/lib/country-codes.ts` for why the code is stored inline.
 *
 * `+91` keeps the strict ten-digit rule, because that is the number this
 * product's users actually mistype. Any other code is checked only for a
 * plausible length, since national number lengths vary from 6 to 14 digits and
 * hard-coding them per country is a table that goes stale.
 */
export function checkPhone(value: unknown, label: string): string | null {
  if (blank(value)) return null
  const raw = String(value).trim()

  if (!raw.startsWith('+')) return checkMobile(raw, label)
  if (raw.startsWith('+91')) {
    return MOBILE_RE.test(raw.slice(3))
      ? null
      : `${label} must be exactly 10 digits after +91`
  }
  return /^\+\d{1,4}\d{6,14}$/.test(raw)
    ? null
    : `${label} is not a valid phone number`
}
