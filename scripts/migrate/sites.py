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
        # G1 teal location panel (:300 :361 :362 are line-level, below)
        (353, 'bg-teal-50'), (354, 'text-teal-600'),
        (365, 'text-teal-600'),
        # G5's shadow sits in a ternary branch; the card's two border states are
        # the other branch of the same element, so both borders stay raw too.
        # bg-white on :217 is OUTSIDE the ternary and converts -- whether
        # line-level reaches it is open-for-author.
        (217, 'border-amber-300'), (217, 'border-gray-200'),
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
        # :300's every palette class is inside the ternary, so line-level and
        # branch-level coincide.
        300, 361, 362,
        # Section 11.9: hover and resting are two shades from one row
        282, 379, 1280, 1286,
        # :1536 -- the active-tab ternary. 11.2 promotes the resting
        # text-gray-500 to secondary, which is where hover:text-gray-700 already
        # lands, so the exception CREATES the collision. Line-level because the
        # branches are the tab's active and inactive states; that also leaves
        # border-blue-600 raw rather than risking the wrong accent token.
        1536,
    ],
    exceptions=[1158, 1536],
    white=[131, 138, 236, 243, 341, 642, 764, 927, 1098, 1280, 1286, 1587, 1653],
    # :242 is a filled DANGER button and 11.4's closing rule resolves it --
    # danger-hover exists (globals.css:97). :1280 success and :1286 warning do
    # not, so they stay in 11.9.
    fill=[(242, 'bg-red-500')],
    hover_fill=[(242, 'bg-red-600')],
)

# ---------------------------------------------------------------- file 2: CO
SITES[CO] = dict(
    protect=[
        # G6 progress-bar fill (magnitude, not status -- section 21's ramp)
        (251, 'bg-emerald-400'),
        # G6 legend dots, 3 categories fixed in code, two copies of the same map
        (269, 'bg-emerald-400'), (270, 'bg-amber-400'), (271, 'bg-blue-400'),
        (282, 'bg-emerald-400'), (283, 'bg-amber-400'), (284, 'bg-blue-400'),
    ],
    protect_lines=[
        # B: the dark-surface hole. bg-gray-900 fill, its text-white foreground
        # and its hover:bg-gray-800 are all one deferred element.
        683, 722,
        # Section 11.9. :553 warning fill and :672 a text pair; :585 is the
        # 11.2-created collision -- the exception promotes text-gray-500 to
        # secondary, where hover:text-gray-700 already lands.
        553, 585, 672,
    ],
    exceptions=[319, 367, 384, 566, 576, 585, 658, 669],
    # :742 and :756 are filled DANGER buttons -- 11.4's closing rule resolves
    # them and their text-white converts with them. :553 is warning and stays.
    white=[742, 756],
    fill=[(742, 'bg-red-600'), (756, 'bg-red-600')],
    hover_fill=[(742, 'bg-red-700'), (756, 'bg-red-700')],
)

# ---------------------------------------------------------------- file 3: RV
SITES[RV] = dict(
    protect=[
        # G4 gradient stops / G6 the Completed stripe whose Active twin is G4
        (355, 'from-amber-400'), (355, 'to-orange-400'), (356, 'bg-emerald-400'),
        # :354's two border branches are one card's two states; bg-white on the
        # same line is outside the ternary and converts (open-for-author item 3)
        (354, 'border-amber-300'), (354, 'border-gray-200'),
        # G1 teal location panel (:383 and :417 are line-level, below)
        (412, 'bg-teal-50'), (413, 'text-teal-600'), (419, 'text-teal-600'),
        # G2 the "New" entity badge
        (360, 'bg-purple-100'), (360, 'text-purple-700'),
    ],
    protect_lines=[
        # C: CATEGORY_COLORS and its fallback. Must match file 1's disposition
        # exactly -- the two maps cannot diverge.
        74, 75, 76, 539,
        # G1: :383 is the location toggle, every class inside the ternary;
        # :417 carries both branches of the mismatch pair on one line.
        383, 417,
        # G2: :290 the purple "Suggest Changes" button -- a seventh weekly-plan
        # state with no status token -- and its text-white.
        290,
        # G2: typeColor, one 3-category map across three lines. :345 is the
        # named site; converting :343 and :344 would half-migrate the set.
        343, 344, 345,
        # Section 11.9
        238, 287, 289, 302, 426,
    ],
    exceptions=[214, 346],
    # :99 :101 brand fills; :288 :306 filled danger buttons
    white=[99, 101, 288, 306],
    fill=[(288, 'bg-red-600'), (306, 'bg-red-600')],
    hover_fill=[(288, 'bg-red-700'), (306, 'bg-red-700')],
)

# ---------------------------------------------------------------- file 4: OR
SITES[OR] = dict(
    protect=[],
    protect_lines=[
        # Section 11.9
        250, 717,
    ],
    # CONVERTED, not deferred: section 11.5's chart tokens, applied by hand
    # because the engine has no chart rule and the branch order is a trap --
    # `direct` is the PURPLE branch and `meeting` is the BLUE one, so blue
    # becomes chart-2, not chart-1. 11.5: "not to be reordered".
    manual=[518, 711],
    exceptions=[233, 262, 300, 306, 317, 331, 339, 429, 526, 685, 686],
    white=[446, 636],       # :250's text-white is on an 11.9 line
    fill=[],
    hover_fill=[],
)

# ---------------------------------------------------------------- file 5: WP
SITES[WP] = dict(
    protect=[],
    protect_lines=[
        # E: the "Plan Edited by Manager" banner -- a condition that persists
        # until resolved (7.1), and 2.4 has no token for a seventh weekly-plan
        # state. :458 is the banner's comment line, inside the same block.
        453, 454, 458,
        # Section 11.9
        386, 436, 469, 486, 493,
    ],
    exceptions=[673, 675],      # 11.2: :673 a status, :675 a price
    white=[515, 646, 704],      # all three on brand fills
    fill=[],
    hover_fill=[],
)

# ---------------------------------------------------------------- file 6: AC
SITES[AC] = dict(
    protect=[
        # G5 the coloured shadow on the org-chart search-match highlight.
        # border-yellow-400 on the same line is its ternary twin and the
        # signal that has to survive if the shadow goes -- both stay.
        (809, 'shadow-yellow-100'), (809, 'border-yellow-400'),
        (809, 'border-blue-700'),
    ],
    protect_lines=[
        # B: the standalone org-chart band. :781 is the bg-gray-500 fill this
        # group argues about and :782 its text-white foreground -- one element
        # across two lines, neither half settled while the ground is open.
        781, 782,
        # D: both avatar palettes and the initials drawn on them. :877 holds
        # five swatches, two of which F used to double-count.
        877, 884,
        # Section 11.9
        275,
    ],
    exceptions=[71, 753],
    white=[295, 371, 399, 812],   # brand fills; :782 and :884 are B and D
    fill=[],
    hover_fill=[],
)
