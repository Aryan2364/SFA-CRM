/**
 * The install settings - FRONTEND_RULES_PHONE.md §41.12 rule 9.
 *
 * THE ONE PLACE OUTSIDE globals.css THAT HOLDS A COLOUR VALUE. The web app
 * manifest, the theme-color tag and the drawn app icons are read by the
 * phone and the browser, not through CSS, so they cannot read a token. The
 * colours below are copies, by hand, of tokens in src/app/globals.css:
 *
 *   THEME      = --primary             (theme colour; the status bar)
 *   BACKGROUND = --surface             (background colour; splash screen)
 *   ON_THEME   = --primary-foreground  (mark drawn on the icon)
 *
 * Edited together, in the same commit, whenever those tokens change.
 */

/** The app's name under its icon and in the phone's app list. */
export const APP_NAME = 'RGB SFA'

/** 12 characters or fewer (§41.12 rule 9). */
export const APP_SHORT_NAME = 'RGB SFA'

export const INSTALL_COLOURS = {
  /** = --primary in globals.css. */
  theme: '#3d3a6e',
  /** = --surface in globals.css. */
  background: '#ffffff',
  /** = --primary-foreground in globals.css. */
  onTheme: '#ffffff',
} as const

/**
 * §41.13 rule 4: on iPhone, a dark brand uses "black-translucent" (primary
 * shows behind light icons); a light brand uses "default". SFACRM's
 * #3d3a6e is dark.
 */
export const IPHONE_STATUS_BAR: 'black-translucent' | 'default' = 'black-translucent'
