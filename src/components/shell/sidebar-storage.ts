/**
 * Where the sidebar's open-or-collapsed choice lives.
 *
 * Section 12.1: "The user's open or collapsed choice is saved and
 * restored next visit."
 *
 * This file is the ONLY thing in the shell that knows where that choice
 * is kept. `use-sidebar` asks for it and hands it back; it never names a
 * storage mechanism, so moving the preference to a cookie, or onto the
 * user record so it follows them between machines, is a change to this
 * file and to nothing else.
 *
 * Three states, not two. `null` means the user has never expressed a
 * choice, which is different from having chosen "collapsed" - the first
 * takes section 9's width-derived default, the second overrides it.
 */

const STORAGE_KEY = 'rgb-sfa:sidebar-expanded'

/** The stored choice, or `null` if the user has never made one. */
export function readSidebarPreference(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return null
  } catch {
    /*
     * A private window, cleared site data, or a browser set to block
     * site data THROWS on access rather than returning null. "No
     * preference" is a valid answer and the shell renders correctly on
     * it; a crash on first paint is not.
     */
    return null
  }
}

/** Record the user's choice for next visit. Best effort. */
export function writeSidebarPreference(expanded: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, expanded ? 'true' : 'false')
  } catch {
    /*
     * Storage full or blocked. The choice still holds for this visit -
     * it lives in the store in `use-sidebar` - it simply will not be
     * there next time. Failing to persist a preference is not worth
     * taking the page down for.
     */
  }
}
