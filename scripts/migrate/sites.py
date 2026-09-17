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
        # G6. THE SET HAS FIVE MEMBERS, NOT THREE. This comment read "3
        # categories fixed in code" and the undercount reached the registry as
        # well as the row -- which is why two of five converted, and then why
        # one of the four reverts was missed. The bar is :269-:273 and the
        # legend :282-:286; the two dark-shade members are on the protect_lines
        # below because their raw values had no row-based protection.
        (269, 'bg-emerald-400'), (270, 'bg-amber-400'), (271, 'bg-blue-400'),
        (282, 'bg-emerald-400'), (283, 'bg-amber-400'), (284, 'bg-blue-400'),
    ],
    # G6, corrected after the end-of-phase pass: the stacked usage bar and its
    # legend are ONE five-segment set and the first sweep took three of five.
    # bg-gray-300 and bg-red-300 sit in 11.1 and 11.4 rows, so they converted
    # to surface-control #f5f5f5 and danger-bg #fee2e2 -- both near-white on a
    # white card, leaving two of five segments with no visible presence and two
    # legend dots blank. Exactly G6's own stated failure, in an array literal
    # rather than a ternary.
    protect_lines=[
        # B: the dark-surface hole. bg-gray-900 fill, its text-white foreground
        # and its hover:bg-gray-800 are all one deferred element.
        # 46-50: CLASSIFICATION set, open-for-author. A five-step ORDINAL
        # usage scale, and its live twin in lib/usage-intelligence.ts:17-21 is
        # deferred by phase 2 -- 11.6 C's "the two maps must not diverge"
        # applies across phases as well as within one.
        46, 47, 48, 49, 50,
        # 272-273 and 285-286: the dark-shade members of the G6 usage-bar set,
        # in BOTH literals. Four lines, not three -- :285 was missed on the
        # first revert, leaving the bar's dormant_enabled at bg-gray-300 while
        # its own legend key was bg-surface-control, a legend not matching the
        # thing it labels. Verify this set as a block, never by sampling lines.
        272, 273, 285, 286,
        683, 722,
        # Section 11.9. :553 warning fill and :672 a text pair; :585 is the
        # 11.2-created collision -- the exception promotes text-gray-500 to
        # secondary, where hover:text-gray-700 already lands.
        553, 585, 672,
    ],
    # Sets that must be byte-identical to the pre-phase blob AS A BLOCK.
    # Sampling named lines let a one-line miss through twice.
    # kept as corroboration of the derived spans. The legend read (281, 288)
    # when declared by hand; the walker derived (281, 287) and was right --
    # 288 is a JSX line, not part of the literal.
    blocks=[(45, 51), (268, 274), (281, 287)],
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

# ---------------------------------------------------------------- file 7: DB
SITES[DB] = dict(
    protect=[],
    protect_lines=[
        93,            # E: the "Edited by Manager" chip -- a seventh status
        349, 360,      # 11.9: success fills, no success-hover token
    ],
    # The weekly-plan status map. Six of seven states take 11.4 tokens; the
    # seventh, "Edited by Manager", is E and stays raw because 2.4 has three
    # roles against the workflow's seven. Mixed BY DECLARATION, not by a miss --
    # and no new collision: Submitted and Resubmitted were already identical
    # (bg-blue-100) before conversion and are identical after.
    mixed_ok=[(86, 94)],
    exceptions=[58, 85, 322, 463],
    white=[505],                       # :505 a filled danger button
    fill=[(505, 'bg-red-600')],
    hover_fill=[(505, 'bg-red-700')],
)

# ---------------------------------------------------------------- file 8: US
SITES[US] = dict(
    protect=[],
    protect_lines=[
        # 26-31: ACTION_COLORS. open-for-author. created (bg-green-100) and
        # reactivated (bg-emerald-100) both became 'bg-success-bg text-success'
        # -- two distinct audit actions, one chip. 11.4 routes green and
        # emerald to one role, which is right for a status and wrong for a set
        # that used the two shades to separate two categories.
        27, 28, 29, 30, 31,
        324,                    # B: bg-gray-900 fill and its text-white
        252, 261, 440, 500,     # 11.9
    ],
    exceptions=[422],
    white=[],                   # :324 is B; :440 and :500 are on 11.9 lines
    fill=[],
    hover_fill=[],
)

# ---------------------------------------------------------------- file 9: TM
SITES[TM] = dict(
    protect=[
        # open-for-author item 5: one categorical set across four hierarchy
        # levels, and only the blue has a row. All seven raw.
        (320, 'accent-blue-600'), (356, 'accent-blue-600'),
        (378, 'accent-green-600'), (405, 'accent-green-600'),
        (423, 'accent-purple-600'), (450, 'accent-purple-600'),
        (462, 'accent-orange-500'),
        # G2: the selection UI outside E's named lines
        (440, 'text-purple-600'), (453, 'ring-purple-500'),
    ],
    protect_lines=[
        421, 430,      # E: the territory-mapping selection state
        330, 385,      # 11.9
    ],
    exceptions=[360, 409, 454],
    white=[291, 492, 526],
    fill=[],
    hover_fill=[],
)

# --------------------------------------------------------------- file 10: LD
SITES[LD] = dict(
    protect=[],
    protect_lines=[
        # 12-17: STAGE_COLORS, the whole six-step ordered pipeline.
        # open-for-author. Converting it flattened Proposal (bg-amber-50) and
        # Negotiation (bg-orange-50) onto one identical 'bg-warning-bg
        # text-warning' -- two of six stages rendering the same chip. :14 and
        # :15 were already raw under F, so the map was four tokens and two raw
        # with two of the four colliding. The set goes raw whole.
        12, 13, 16, 17,
        # 21-23: TEMP_COLORS, a three-step Cold/Warm/Hot ramp.
        # open-for-author. Converting it put the product's BRAND at the cold
        # end -- bg-primary-subtle says "primary", not "coldest of three".
        # Its twin at masters/lead-temperatures/page.tsx:9-12 is byte-identical
        # and phase 2 has deferred it; that copy is backed by lead_temperatures
        # master data with a CRUD page and a grey fallback on :18, which is
        # 11.6 C's exact mechanism. The two must not diverge.
        21, 22, 23,
        14, 15,   # F: the cyan and indigo strays in the lead-status map
        29,       # E: the leads type chip -- every type renders the same
                  # purple, so it separates nothing; decoration, not category
        152,      # 11.9
    ],
    # :28-31 is the type-cell renderer: a chip when r.type is set, an em-dash
    # placeholder when it is not. :29 is E and raw; :30's text-gray-400 ->
    # text-text-muted converted. Whether a chip and its empty-state placeholder
    # are "one element with two states" is open-for-author item 3, the same
    # question as bg-white outside a ternary. Converted meanwhile, which is the
    # reversible direction.
    mixed_ok=[(28, 31)],
    exceptions=[],
    white=[233],
    fill=[],
    hover_fill=[],
)
