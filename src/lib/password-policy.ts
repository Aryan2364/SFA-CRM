/**
 * The one rule every route that SETS a password enforces, and every form that
 * collects one mirrors: change-password, reset-password, the Users master
 * (create and edit) and the SuperAdmin company-admin create/change routes.
 *
 * ⚠️ Setting only. Login never checks length: passwords set under the older
 * 6-character minimum must keep working.
 *
 * No server imports, so client pages can share it.
 */

export const MIN_PASSWORD_LENGTH = 8

export const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`

/** True when `password` is too short to be set. Pass the exact value that will be hashed. */
export function passwordTooShort(password: string): boolean {
  return password.length < MIN_PASSWORD_LENGTH
}
