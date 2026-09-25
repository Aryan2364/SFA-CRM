/**
 * Dialling codes for the phone fields.
 *
 * There is no country-code COLUMN anywhere in this schema — `contacts.mobile`,
 * `contacts.alternate_mobile` and `contacts.whatsapp` are single `String`
 * columns, and so is every other phone field in the product. So the code is
 * stored INLINE, E.164 style and with no separator: `+919876543210`. That keeps
 * one value in one column, round-trips through `splitPhone`/`joinPhone` without
 * a second field, and works verbatim in a `tel:` href.
 *
 * Numbers written before this existed are bare ten digits with no `+`.
 * `splitPhone()` reads those as India, which is what they were — the product is
 * Indian and `MOBILE_RE` has always been exactly ten digits.
 */

export type CountryCode = {
  /** The dialling code, `+` included — this is what gets stored. */
  code: string
  /** ISO-3166 alpha-2, only to keep the labels unique and searchable. */
  iso: string
  name: string
}

/** The default, and the only one most of this product's users will ever pick. */
export const DEFAULT_COUNTRY_CODE = '+91'

/**
 * India first, then alphabetical. Not the full ITU list: a picker is a list
 * someone has to read, and these are the countries this business actually
 * dials. Adding one is a one-line change.
 */
export const COUNTRY_CODES: CountryCode[] = [
  { code: '+91', iso: 'IN', name: 'India' },
  { code: '+61', iso: 'AU', name: 'Australia' },
  { code: '+880', iso: 'BD', name: 'Bangladesh' },
  { code: '+975', iso: 'BT', name: 'Bhutan' },
  { code: '+55', iso: 'BR', name: 'Brazil' },
  { code: '+86', iso: 'CN', name: 'China' },
  { code: '+20', iso: 'EG', name: 'Egypt' },
  { code: '+33', iso: 'FR', name: 'France' },
  { code: '+49', iso: 'DE', name: 'Germany' },
  { code: '+852', iso: 'HK', name: 'Hong Kong' },
  { code: '+62', iso: 'ID', name: 'Indonesia' },
  { code: '+98', iso: 'IR', name: 'Iran' },
  { code: '+353', iso: 'IE', name: 'Ireland' },
  { code: '+972', iso: 'IL', name: 'Israel' },
  { code: '+39', iso: 'IT', name: 'Italy' },
  { code: '+81', iso: 'JP', name: 'Japan' },
  { code: '+254', iso: 'KE', name: 'Kenya' },
  { code: '+965', iso: 'KW', name: 'Kuwait' },
  { code: '+60', iso: 'MY', name: 'Malaysia' },
  { code: '+960', iso: 'MV', name: 'Maldives' },
  { code: '+230', iso: 'MU', name: 'Mauritius' },
  { code: '+52', iso: 'MX', name: 'Mexico' },
  { code: '+977', iso: 'NP', name: 'Nepal' },
  { code: '+31', iso: 'NL', name: 'Netherlands' },
  { code: '+64', iso: 'NZ', name: 'New Zealand' },
  { code: '+234', iso: 'NG', name: 'Nigeria' },
  { code: '+968', iso: 'OM', name: 'Oman' },
  { code: '+92', iso: 'PK', name: 'Pakistan' },
  { code: '+63', iso: 'PH', name: 'Philippines' },
  { code: '+974', iso: 'QA', name: 'Qatar' },
  { code: '+7', iso: 'RU', name: 'Russia' },
  { code: '+966', iso: 'SA', name: 'Saudi Arabia' },
  { code: '+65', iso: 'SG', name: 'Singapore' },
  { code: '+27', iso: 'ZA', name: 'South Africa' },
  { code: '+82', iso: 'KR', name: 'South Korea' },
  { code: '+94', iso: 'LK', name: 'Sri Lanka' },
  { code: '+34', iso: 'ES', name: 'Spain' },
  { code: '+41', iso: 'CH', name: 'Switzerland' },
  { code: '+66', iso: 'TH', name: 'Thailand' },
  { code: '+971', iso: 'AE', name: 'United Arab Emirates' },
  { code: '+44', iso: 'GB', name: 'United Kingdom' },
  { code: '+1', iso: 'US', name: 'United States / Canada' },
  { code: '+84', iso: 'VN', name: 'Vietnam' },
]

/**
 * Longest code first, so `+975` (Bhutan) is matched before `+97…` would fall
 * through to a shorter neighbour. Order matters and a `Set` would lose it.
 */
const CODES_BY_LENGTH = [...new Set(COUNTRY_CODES.map(c => c.code))].sort(
  (a, b) => b.length - a.length
)

/**
 * Split a stored value into its dialling code and the national number.
 *
 * A value with no `+` is legacy data: ten bare digits, India. A `+` followed by
 * a code nothing in the list matches keeps the whole string in `number` rather
 * than guessing where the code ends — the user then sees exactly what is
 * stored and can correct it.
 */
export function splitPhone(value: string | null | undefined): {
  code: string
  number: string
} {
  const raw = (value ?? '').trim()
  if (raw === '') return { code: DEFAULT_COUNTRY_CODE, number: '' }
  if (!raw.startsWith('+')) return { code: DEFAULT_COUNTRY_CODE, number: raw }

  const match = CODES_BY_LENGTH.find(code => raw.startsWith(code))
  if (!match) return { code: DEFAULT_COUNTRY_CODE, number: raw }
  return { code: match, number: raw.slice(match.length) }
}

/**
 * The value to store: `+<code><digits>`, or null when there is no number.
 *
 * A code on its own is not a phone number, so a blank national part clears the
 * column instead of writing `"+91"` into it.
 */
export function joinPhone(code: string, number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '')
  if (digits === '') return null
  const cc = code.trim() === '' ? DEFAULT_COUNTRY_CODE : code.trim()
  return `${cc.startsWith('+') ? cc : `+${cc}`}${digits}`
}

/**
 * `+91 India` — what the picker shows, and what its search box matches on.
 *
 * Code FIRST, deliberately. Section 16.2 fixes the menu to the trigger's
 * width, so a long country name truncates at both; putting the code in front
 * means what gets cut is the name that CONFIRMS the choice, never the code
 * that IS it. The full name stays in the string so searching "United" still
 * finds the country the user is thinking of by name.
 */
export function countryCodeLabel(c: CountryCode): string {
  return `${c.code} ${c.name}`
}
