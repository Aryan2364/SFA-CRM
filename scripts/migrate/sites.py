# -*- coding: utf-8 -*-
"""
Per-file site data for the phase-1 migration.

Protection has TWO granularities, and the distinction is load-bearing:

  `protect`        (line, class) -- OCCURRENCE-level. The default. A protected
                   class does not shield its neighbours on the same line, which
                   matters because group C's CATEGORY_COLORS sits within two
                   lines of mapped sites in files 1 and 3.

  `protect_lines`  line -- LINE-level, the whole line untouched. Used where a
                   ternary's branches are one element with two states, because
                   you cannot settle half a state pair. Converting one branch
                   leaves the element half-migrated in a way section 11.8's exit
                   check reads as clean.

Line-level covers two cases:
  - section 11.6 G1's location panels, where :361 is the bg-red-50 mismatch
    branch of the same element whose :362 teal branch G1 defers.
  - every section 11.9 line, where resting and hover are two shades from one
    section 11 row and the token layer has no hover partner to split them onto.

Both are taken from plan-2026-09-16-1522.md.

`exceptions` are section 11.2's 42 sites where text-gray-{500,400,300} means a
price, a status or an instruction and so takes text-secondary, never text-muted.

`white` are the lines where text-white sits on a brand or status fill, per the
section 11.1 addendum. A text-white line NOT listed here stops the run.

`fill` / `hover_fill` are section 11.4's closing rule: a saturated status colour
that is a filled button, not a badge ground, takes bg-<role> and bg-<role>-hover.
"""

DA = 'src/app/(protected)/daily-activity/page.tsx'
CO = 'src/app/superadmin/(dashboard)/companies/[id]/page.tsx'
RV = 'src/app/(protected)/review/[userId]/page.tsx'
OR = 'src/app/(protected)/orders/page.tsx'
WP = 'src/app/(protected)/weekly-plan/page.tsx'
AC = 'src/app/(protected)/settings/access-control/page.tsx'
DB = 'src/app/(protected)/page.tsx'
US = 'src/app/(protected)/masters/users/page.tsx'
TM = 'src/app/(protected)/masters/territory-mapping/[userId]/page.tsx'
LD = 'src/app/(protected)/leads/page.tsx'

SITES = {}

# ---------------------------------------------------------------- file 1: DA
SITES[DA] = dict(
    protect=[
        # G5 coloured shadow
        (217, 'shadow-amber-50'),
        # G4 gradient stops
        (218, 'from-amber-400'), (218, 'to-orange-400'),
        # G6 card status stripe (Completed half; Active half is G4 above)
        (219, 'bg-emerald-400'),
        # G2 "New" entity badge
        (226, 'bg-purple-100'), (226, 'text-purple-700'),
        # G1 teal location panel (:361-:362 are line-level, below)
        (300, 'bg-teal-50'), (300, 'text-teal-700'),
        (353, 'bg-teal-50'), (354, 'text-teal-600'),
        (365, 'text-teal-600'),
        # G6 legend dots (2 series, fixed in code)
        (985, 'bg-green-400'), (986, 'bg-blue-400'),
        # C CATEGORY_COLORS + its fallback
        (1005, 'bg-blue-100'), (1005, 'text-blue-700'),
        (1006, 'bg-orange-100'), (1006, 'text-orange-700'),
        (1007, 'bg-purple-100'), (1007, 'text-purple-700'),
        (1008, 'bg-teal-100'), (1008, 'text-teal-700'),
        (1009, 'bg-yellow-100'), (1009, 'text-yellow-700'),
        (1010, 'bg-gray-100'), (1010, 'text-gray-600'),
        (1067, 'bg-gray-100'), (1067, 'text-gray-600'),
        # G6 Plan / Actual heading accent bars
        (1125, 'bg-blue-500'), (1148, 'bg-emerald-500'),
        # A attendance status dots
        (1250, 'bg-gray-400'), (1250, 'bg-amber-500'), (1250, 'bg-green-500'),
        # G6 pulsing "1 active" dot
        (1565, 'bg-amber-400'),
    ],
    protect_lines=[
        # G1: the mismatch ternary -- :361 bg-red-50 / :362 bg-teal-50 are one
        # element with two states. Section 11.6 G1, corrected 17 Sep.
        361, 362,
        # Section 11.9: hover and resting are two shades from one row
        242, 282, 379, 1280, 1286,
        # :243 is the svg inside the button whose fill is on :242 -- one element
        # across two lines. Converting its text-white to primary-foreground over
        # a raw bg-red-500 half-migrates the element, same rule as the ternary.
        243,
    ],
    exceptions=[1158, 1536],
    white=[131, 138, 236, 341, 642, 764, 927, 1098, 1280, 1286, 1587, 1653],
    # 242 / 1280 / 1286 are section 11.9 lines and are protected in full, so
    # they are NOT listed here -- their hover half has no token to land on.
    fill=[],
    hover_fill=[],
)
