# -*- coding: utf-8 -*-
"""
Per-file site data for the PHASE-2 migration -- the 41 files holding palette
classes outside phase 1's ten.

Deliberately a separate file from `sites.py`. That one is phase 1's and is not
to be edited from here; the author folds the two together when phase 1 merges.

Measured on `main` at the start of phase 2. 957 occurrences across 41 files
(section 12 says 42; one of its 42 holds no palette class -- the 957 is exact).

  957 = 752 straight row conversions
      +   6 section 11.5 manual (conversations/page.tsx only)
      + 199 deferred, on 94 lines

Granularity follows sites.py exactly, and the distinction is load-bearing:

  `protect`        (line, class) -- OCCURRENCE-level. The default.
  `protect_lines`  line          -- LINE-level, the whole line untouched. Used
                   where a ternary's branches are one element with two states,
                   where a map entry must move as a unit with its siblings, and
                   for every section 11.9 line.

Section 11.9 recurrence in these 41: 14 lines, 28 declarations. Derived with
section 11.2's exceptions applied FIRST (points:84 is created by the exception,
the daily-activity:1536 shape) and with saturated DANGER fills excluded (11.4's
closing rule resolves those; success and warning have no hover token).

`exceptions` are the seven section 11.2 sites that fall in these files.

`white` are the lines where text-white sits on a brand or status fill, per the
section 11.1 addendum. 17 of the 38 text-white occurrences qualify; the other
21 are foreground halves of fills that have no row and are deferred WITH their
grounds -- a fill and the text on it are one decision (11.6 B's reasoning).

`manual` are lines the engine must not touch because they are converted by hand
afterwards -- the section 11.5 chart assignment, which has no engine rule and
whose branch order is not to be reordered.

Classification cleared by the review session (sfacrm-01) on 17 Sep 2026.
Conversion is NOT cleared and no site below has been touched.

LINE ENDINGS -- the engine rewrites them, git never sees it, do not "fix" it.

  Every blob on `main` is LF-only: measured with `git cat-file blob` on all 41,
  zero CR bytes. `core.autocrlf=true` and `.gitattributes` says nothing about
  `*.tsx`, so git normalised on commit as configured.

  The WORKING TREE is mixed -- 24 of the 41 CRLF on disk, 17 LF -- because
  `tokens.py` reads with `io.open(path, encoding='utf-8')` (universal newlines,
  CRLF -> \\n) and writes with `newline=''` (emits \\n verbatim). A CRLF file
  goes in and an LF file comes out. A fresh worktree checks all 41 out as CRLF,
  so after phase 2 every converted file is LF on disk and every fully deferred
  file is still CRLF. That split means nothing.

  It is harmless and that was tested, not assumed: the engine run over an LF
  blob with every line protected returns it byte-identical, and because the
  blobs are already LF a CRLF -> LF rewrite produces no `git diff` at all. The
  line COUNT never moves, so section 11.8's line-for-line check is unaffected.

  Two consequences for the exit check:
    - compare each converted file against its pre-phase blob with line endings
      NORMALISED, so the LF rewrite neither masks a real structural change nor
      is mistaken for one;
    - `grep -c $'\\r'` does NOT count CRs. It counts matching LINES, and in Git
      Bash `$'\\r'` does not reliably expand -- when it fails the pattern is
      empty and matches every line, so the answer is the file's line count.
      Both sessions reported CR counts that were line counts before this was
      caught. Count bytes in Python instead.
"""

# ------------------------------------------------------------------ the files
DEALERS  = 'src/app/(protected)/masters/dealers/page.tsx'
POINTS   = 'src/app/(protected)/points/page.tsx'
IMPORT   = 'src/app/(protected)/masters/import/page.tsx'
BPFORM   = 'src/components/masters/BusinessPartnerForm.tsx'
CONEW    = 'src/app/superadmin/(dashboard)/companies/new/page.tsx'
SPOINTS  = 'src/app/(protected)/settings/points/page.tsx'
LOGIN    = 'src/app/login/page.tsx'
REMARKS  = 'src/components/ui/RemarksPanel.tsx'
COLIST   = 'src/app/superadmin/(dashboard)/companies/page.tsx'
CONV     = 'src/app/(protected)/conversations/page.tsx'
REVIEW   = 'src/app/(protected)/review/page.tsx'
RESETPW  = 'src/app/reset-password/page.tsx'
MASTERS  = 'src/app/(protected)/masters/page.tsx'
HEADER   = 'src/components/ui/Header.tsx'
TERRMAP  = 'src/app/(protected)/masters/territory-mapping/page.tsx'
CRUD     = 'src/components/ui/CrudPage.tsx'
TOAST    = 'src/contexts/ToastContext.tsx'
CALPICK  = 'src/components/ui/CalendarPicker.tsx'
SALOGIN  = 'src/app/superadmin/login/page.tsx'
SIDEBAR  = 'src/components/ui/Sidebar.tsx'
BADGE    = 'src/components/ui/StatusBadge.tsx'
SELECT   = 'src/components/ui/SearchableSelect.tsx'
PRODUCTS = 'src/app/(protected)/masters/products/page.tsx'
USAGE    = 'src/lib/usage-intelligence.ts'
MODAL    = 'src/components/ui/Modal.tsx'
PLAYOUT  = 'src/app/(protected)/layout.tsx'
LEADTEMP = 'src/app/(protected)/masters/lead-temperatures/page.tsx'
SALAYOUT = 'src/app/superadmin/(dashboard)/layout.tsx'
LEADSTG  = 'src/app/(protected)/masters/lead-stages/page.tsx'
TOGGLE   = 'src/components/ui/Toggle.tsx'
ROOTLAY  = 'src/app/layout.tsx'

SITES = {}

# ----------------------------------------------------- dealers -- 67, 16 defer
SITES[DEALERS] = dict(
    protect=[],
    protect_lines=[
        # ROUTED to the author. :191 :197 :202 are ONE segmented filter of two
        # sibling buttons. 11.6 B protects :191's bg-gray-800 fill; 11.4's
        # closing rule would convert :197's bg-amber-500 neighbour. Siblings
        # rendering differently is section 4 rule 2, not a colour question, and
        # each line is also a ternary whose branches are one button's states.
        # :202's `bg-white/20` is a translucent pill ON the amber fill -- the
        # 11.1 bg-white row is not scoped for a white-alpha overlay.
        191, 197, 202,
        # Section 11.9
        224,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------------------ points -- 64, 19 defer
SITES[POINTS] = dict(
    protect=[],
    protect_lines=[
        # Section 11.9 -- CREATED by 11.2's exception. 11.2 promotes the resting
        # text-gray-500 to secondary, which is where hover:text-gray-700 already
        # lands. Same shape as daily-activity:1536. Line-level because the
        # branches are the tab's active and inactive states.
        84,
        # ROUTED. G4 recurrence: from-yellow-400 / to-orange-500 on the Total
        # Points card, and 11 has no gradient row anywhere. :94 and :96 are
        # text-yellow-100 ON that gradient -- foreground halves of a ground
        # with no row, so they defer with it (11.6 B's reasoning). :93 also
        # carries the text-white.
        93, 94, 96,
        # G6. :167 bg-gray-100 track, :168 bg-green-500 fill. This is
        # companies/[id]:251 again to the pixel -- success-bg #dcfce7 on
        # surface-control #f5f5f5 is 1.01:1. Both lines: the track and the fill
        # are one element, and converting the track alone half-migrates it.
        167, 168,
        # ROUTED. Rank medals, four branches across four lines: gold, silver,
        # bronze, rest. The colour is ORDINAL -- not status, not category, not
        # magnitude -- and no row fits ordinal. :188 and :190 also carry
        # text-white on grounds that have no target.
        188, 189, 190, 191,
    ],
    exceptions=[],      # :84 is an 11.2 site but the line is protected in full
    white=[], fill=[], hover_fill=[], manual=[],
)

# --------------------------------------------- import -- 62, all convert clean
SITES[IMPORT] = dict(protect=[], protect_lines=[], exceptions=[],
                     white=[312], fill=[], hover_fill=[], manual=[])

# ------------------------------------------------------ BPForm -- 56, 2 defer
SITES[BPFORM] = dict(
    protect=[], protect_lines=[245],           # section 11.9
    exceptions=[306],                          # 11.2: a section label
    white=[], fill=[], hover_fill=[], manual=[],
)

# ---------------------------------------------- companies/new -- 55, 3 defer
SITES[CONEW] = dict(
    protect=[
        # 11.6 B: the superadmin's dark neutral button, its white foreground and
        # its hover fill -- one element, three occurrences, nothing else on the
        # line. Occurrence-level per sites.py's default.
        (128, 'bg-gray-900'), (128, 'text-white'), (128, 'bg-gray-800'),
    ],
    protect_lines=[], exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# -------------------------------------------- settings/points -- 47, 2 defer
SITES[SPOINTS] = dict(
    protect=[],
    protect_lines=[
        # G6. A hand-rolled switch track where BOTH states vanish:
        # bg-green-500 -> success-bg #dcfce7 and bg-gray-300 -> surface-control
        # #f5f5f5, both on white. Ternary, so line-level. One of three copies
        # (Toggle.tsx:15, companies/page:117) that must answer identically.
        183,
    ],
    exceptions=[119, 162, 170, 186],
    white=[130, 195],                          # both on bg-blue-600 fills
    fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------------------- login -- 43, 2 defer
SITES[LOGIN] = dict(
    protect=[], protect_lines=[83],            # section 11.9
    exceptions=[],
    white=[41, 76, 145, 164],                  # all on bg-blue-600 fills
    fill=[], hover_fill=[], manual=[],
)
#   :124 bg-black/40 is the forgot-password modal scrim -- a dialog backdrop,
#   in scope for the 11.1 addendum row.

# ------------------------------------------------ RemarksPanel -- 43, 7 defer
SITES[REMARKS] = dict(
    protect=[
        # 11.6 D, corrected shape: :232 is text-white on ${getAvatarColor(...)}
        # -- the initials drawn on whichever swatch the key picked. It cannot be
        # decided before the palette it sits on is. Same reasoning that put
        # access-control:884 in D.
        (232, 'text-white'),
    ],
    protect_lines=[
        # 11.6 D: the six-swatch AVATAR palette, one array literal on one line.
        # THREE of the six have no row (purple, teal, rose) and three DO
        # (blue -> primary, emerald -> success-bg, amber -> warning-bg), so
        # occurrence-level protection would convert half a palette. Line-level,
        # exactly as sites.py does for access-control:877.
        41,
    ],
    exceptions=[],
    white=[213],                               # on a bg-blue-600 fill
    fill=[], hover_fill=[], manual=[],
)
#   :133 bg-black/20 is the panel scrim -- a sheet backdrop, in scope.

# ----------------------------------------------- companies list -- 38, 7 defer
SITES[COLIST] = dict(
    protect=[
        (63, 'bg-gray-900'), (63, 'text-white'), (63, 'bg-gray-800'),   # 11.6 B
    ],
    protect_lines=[
        117,        # G6 switch track, copy 2 of 3
        125,        # section 11.9
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ----------------------------------- conversations -- 35, 6 manual, 0 deferred
SITES[CONV] = dict(
    protect=[], protect_lines=[], exceptions=[],
    white=[203],                               # count badge on bg-blue-500
    fill=[], hover_fill=[],
    # Section 11.5, by section 21 position IN DECLARATION ORDER, NOT to be
    # reordered: :41 meeting -> bg-chart-1, :42 expense -> bg-chart-2,
    # :43 weekly_plan_day -> bg-chart-3, each chip foreground taking
    # text-primary-foreground. Converted by hand -- the engine has no chart
    # rule, and on :43 it would stop (purple has no row), which is the safety
    # net working. A declared visible change: pale tints become saturated
    # fills with white text.
    manual=[41, 42, 43],
)

# ------------------------------------------------- review list -- 35, 5 defer
SITES[REVIEW] = dict(
    protect=[],
    protect_lines=[
        # Section 11.9 -- bg-green-600 hover:bg-green-700 on a filled SUCCESS
        # button. danger-hover exists; success-hover does not. Carries a
        # text-white that defers with it.
        133,
        # G6. A two-series legend dot pair, 6px, fixed in code:
        # :143 bg-blue-400 -> bg-primary (visible) and :147 bg-orange-400 ->
        # bg-warning-bg (not). This is daily-activity:1125/:1148 again -- "one
        # bar visible, one not". Both lines, because they are the pair.
        143, 147,
    ],
    exceptions=[127],
    white=[108],                               # avatar on a bg-blue-600 fill
    fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------ reset-password -- 35, all convert
SITES[RESETPW] = dict(protect=[], protect_lines=[], exceptions=[],
                      white=[47, 64, 127], fill=[], hover_fill=[], manual=[])

# ----------------------------------------------- masters index -- 32, 16 defer
SITES[MASTERS] = dict(
    protect=[],
    protect_lines=[
        # ROUTED to the author -- a gap in an APPROVED section, not a phase-2
        # call. Section 11.5 names these twelve lines and assigns bg-chart-1..4
        # in declaration order, and its closing line puts text-primary-foreground
        # on "the chip". These cards have no chip: each is a border, a `/40`
        # ground, a header band and an icon stroke -- four classes, of which
        # 11.5's table reaches only the two `bg-` halves. The 4 border-*-200
        # and 4 text-*-600 have no target. Converting the bg halves alone
        # splits every card, and bg-chart-N/40 is a saturated colour at 40%,
        # not a pale tint. 11.5's headline 30 is 22 with a target and 8 without.
        10, 11, 12,        # 1 Locations    -- blue
        45, 46, 47,        # 2 (violet: 11.5's section-2 card, NOT an F stray)
        71, 72, 73,        # 3             -- purple
        97, 98, 99,        # 4 Organization -- orange
    ],
    exceptions=[],
    white=[149],                               # on a bg-blue-600 fill
    fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------------------ Header -- 30, 8 defer
SITES[HEADER] = dict(
    protect=[],
    protect_lines=[
        # ROUTED. :27 :28 :29 are a SECOND copy of SECTION_COLORS whose
        # declaration order AND keys differ from 11.5's named site:
        #   Header        weekly_plan(purple), meeting(blue), expense(orange)
        #   conversations meeting(blue), expense(orange), weekly_plan_day(purple)
        # 11.5 assigns by declaration order, so mapping this copy the same way
        # gives one category two chart positions -- the exact failure 11.5's
        # "not to be reordered" exists to prevent. Two copies of one map that
        # disagree on both order and key is section 4 rule 2 before it is a
        # colour question, the same shape as 11.6 D's two avatars.
        27, 28, 29,
        # DEFERRED WITH THE SHELL. The bell's unread count, bg-red-500 with
        # text-white. 11.4's background row gives danger-bg #fee2e2 under white
        # text -- 1.06:1 -- and the shape IS the signal (G6). AGENTS.md 12.2
        # says this dot is `primary`, which settles it but changes a rendered
        # colour, and 12.2 is the shell -- phase 5's, not phase 2's.
        103,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# -------------------------------------------- territory-mapping -- 27, 2 defer
SITES[TERRMAP] = dict(protect=[], protect_lines=[77],   # section 11.9
                      exceptions=[], white=[], fill=[], hover_fill=[], manual=[])

# ---------------------------------------------------- CrudPage -- 26, 6 defer
SITES[CRUD] = dict(
    protect=[],
    protect_lines=[
        # Section 11.9. :150 is text-gray-300 hover:text-gray-500 -- 11.1 sends
        # gray-500/400/300 all to text-muted, so the drag handle on EVERY
        # reorderable master table loses its hover.
        150, 169, 180,
    ],
    exceptions=[],
    white=[108],                               # on a bg-blue-600 fill
    fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------------ ToastContext -- 25, 25 defer
SITES[TOAST] = dict(
    protect=[
        # Already recorded in 11.6 G as the one 42-file residue known before
        # phase 2: bg-black/5 on an h-1 toast PROGRESS TRACK, not a backdrop.
        # 11.1's addendum names this exact site as the reason the bg-black row
        # is scoped to dialog, alert-dialog and sheet backdrops only -- a
        # blanket row would paint it as a 40% dialog scrim.
        (39, 'bg-black'),
    ],
    protect_lines=[
        # Section 11.9 on all four, AND G6 on all four. Each line is one toast
        # variant's complete style, so line-level is also the right unit:
        #   11.9  btn: 'text-red-400 hover:text-red-700' -> one token
        #   G6    bar: 'bg-red-500' is an h-1 PROGRESS BAR on a bg-red-50
        #         ground -- bg-danger-bg on bg-danger-bg. The shape is the
        #         signal and there is nothing left of it.
        11, 12, 13, 14,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ---------------------------------------------- CalendarPicker -- 21, 4 defer
SITES[CALPICK] = dict(
    protect=[],
    protect_lines=[
        # G6, and TWO separate elements. `filledDates` is fetched from
        # /api/daily-activity/calendar, so both mean "this day has activity" --
        # binary PRESENCE OF DATA, not a status and not a category.
        #   :130 / :133 -- the 4px dot under a day cell, in its two states:
        #     bg-emerald-500 when the cell is unselected, bg-blue-200 when it
        #     is selected (so it reads against the bg-blue-600 fill). ONE
        #     element, two states. 11.6 G6's closing note exempts
        #     daily-activity:142 / review:102 because blue maps coherently in
        #     BOTH states; emerald does not -- success-bg #dcfce7 is a 4px dot
        #     at 1.10:1 on white.
        130, 133,
        #   :144 / :148 -- the 8px legend swatches, "Has activity" against
        #     "No activity". A two-item legend where the swatch IS the signal:
        #     emerald -> success-bg and gray-200 -> surface-control, 1.10:1 and
        #     1.04:1 on white. Both lines, because they are the pair.
        144, 148,
    ],
    exceptions=[],
    white=[121],                               # selected day cell, bg-blue-600
    fill=[], hover_fill=[], manual=[],
)

# --------------------------------------------- superadmin login -- 20, 5 defer
SITES[SALOGIN] = dict(
    protect=[
        (32, 'bg-gray-900'),                   # 11.6 B: the logo tile
        (33, 'text-white'),                    #   its svg foreground
        (91, 'bg-gray-900'), (91, 'text-white'), (91, 'bg-gray-800'),
    ],
    protect_lines=[], exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ----------------------------------------------- Sidebar -- 20, ALL 20 DEFER
SITES[SIDEBAR] = dict(
    protect=[],
    protect_lines=[
        # NOT ONE OF THESE CONVERTS. The whole shell is a dark GREEN surface:
        # bg-green-900 ground, border-green-800, bg-green-700 active item and
        # logo tile, text-green-100/300/400/500, six text-white, and
        # hover:bg-red-900/30 on logout. Section 11.4 sends every one to
        # success/danger and the sidebar becomes a #dcfce7 near-white panel
        # with #166534 text and white-on-near-white active items.
        #
        # Three documents settle it and none needs a judgement:
        #   11.4's own preamble -- "Every call site still has to be read for
        #     whether it meant the status at all." A dark green shell is not
        #     Approved and a red logout hover is not Rejected.
        #   AGENTS.md 12.1 -- the active item is `primary-subtle` with a 3px
        #     `primary` accent; globals.css:167 sets --sidebar: var(--surface).
        #     The kit's sidebar is a LIGHT surface and this one is not.
        #   Section 6's phase plan -- 12's sidebar is PHASE 5, blocked on
        #     section 4 item 6 (whether components/shell is built here or
        #     inherited). Reconciling the two is a redesign, not a substitution.
        #
        # This is NOT 11.6 B. B is the dark NEUTRAL hole; this is the same hole
        # in another family, and unlike B's sites 11.4's rows reach all of it.
        # The six text-white defer with their grounds for B's reason.
        179, 185, 186, 191, 192, 199, 205, 206, 209, 217, 220, 221, 223,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# --------------------------------------------- StatusBadge -- 20, ALL 20 DEFER
SITES[BADGE] = dict(
    protect=[],
    protect_lines=[
        # ROUTED to the author. ONE status vocabulary, nine entries plus a
        # fallback, shared by every screen that renders a weekly-plan state.
        # Seven entries have tokens. TWO do not, and both are already deferred
        # by name elsewhere:
        #   :7  'Edited by Manager' bg-purple-100 text-purple-700 -- 11.6 E's
        #       OWN element, at a site E does not name (E names page.tsx:93)
        #   :8  'Resubmitted' bg-indigo-100 text-indigo-700 -- 11.6 F's stray,
        #       and E's gap restated: "2.4 has three roles and the workflow has
        #       seven".
        # Converting the other seven leaves an app-wide status vocabulary half
        # in tokens and half in raw palette. Whether the map moves as a unit is
        # group C's question -- "the two maps must not diverge" -- and that is a
        # coherence judgement, not a row lookup.
        2, 3, 4, 5, 6, 7, 8, 9, 10,
        15,                       # the `?? 'bg-gray-100 text-gray-600'` fallback
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ------------------------------------------------ lead-temperatures -- 12, 8
SITES[LEADTEMP] = dict(
    protect=[],
    protect_lines=[
        # ROUTED -- added by this session, not instructed. TEMP_COLORS is a
        # three-step ORDERED scale (Cold / Warm / Hot) with a grey fallback,
        # and `lead_temperatures` is master data with its own CRUD page -- this
        # very file. That is 11.6 C's shape exactly: "the real set is whatever
        # an administrator has created... a seventh category falls to the grey
        # fallback silently today", which C says a colour map cannot decide.
        # It is ALSO 11.5's shape (fixed-in-code test) without being one of
        # 11.5's three named sites -- the same position as 11.6 G2's
        # review:345 typeColor, which G2 defers on exactly that ground.
        # Converting it renders Cold in BRAND indigo (bg-blue-50 ->
        # primary-subtle) in the middle of a semantic ramp.
        10, 11, 12,
        18,                                    # the fallback, same set
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# --------------------------------------- usage-intelligence -- 15, ALL 15 DEFER
SITES[USAGE] = dict(
    protect=[],
    protect_lines=[
        # LEAVE AND DECLARE. CLASSIFICATION_COLORS is a five-step ordered scale
        # (actively_using -> passive -> low_usage -> not_using -> dormant) that
        # would convert to success / warning / BRAND INDIGO / danger / neutral
        # -- brand in the middle of a semantic ramp, and section 21's answer to
        # a single measure across a range is a sequential ramp, not a status
        # token.
        #
        # It also renders NOWHERE. Both CLASSIFICATION_COLORS and
        # CLASSIFICATION_LABELS are exported and imported by nothing; only
        # classifyUser and computeActivityScore are consumed. Their consumer was
        # the endpoint PLAN.md 13.6 records as dead. CLAUDE.md: dead code is
        # "preserved deliberately rather than 'fixed'... Do not treat their
        # failures as regressions."
        17, 18, 19, 20, 21,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ----------------------------------------------------- Modal -- 13, 0 deferred
SITES[MODAL] = dict(protect=[], protect_lines=[], exceptions=[],
                    white=[30], fill=[], hover_fill=[], manual=[])
#   :19 bg-black/50 IS a dialog backdrop and takes the 11.1 addendum row. 11's
#   preamble already declares the alpha normalisation to 40% as an intended
#   visible change.

# ------------------------------------------ (protected)/layout -- 12, 3 defer
SITES[PLAYOUT] = dict(
    protect=[
        # 11.6 B: the "Role Not Configured" sign-out button.
        (29, 'bg-gray-900'), (29, 'text-white'), (29, 'bg-gray-800'),
    ],
    protect_lines=[], exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)
#   :43 bg-black/40 is the mobile sidebar scrim -- a sheet backdrop, in scope
#   for the 11.1 addendum row.

# ------------------------------------------ superadmin layout -- 10, 2 defer
SITES[SALAYOUT] = dict(
    protect=[(17, 'bg-gray-900'), (18, 'text-white')],      # 11.6 B, logo tile
    protect_lines=[], exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ----------------------------------------------------- Toggle -- 3, 2 defer
SITES[TOGGLE] = dict(
    protect=[],
    protect_lines=[
        # G6 switch track, copy 1 of 3. bg-blue-600 -> bg-primary is visible;
        # bg-gray-300 -> surface-control #f5f5f5 on white is not, so the OFF
        # state of every switch in the product disappears. This one arrives
        # through 11.1's NEUTRAL row rather than 11.4's, which G6 documents
        # only for 11.4 -- the same failure through a different row.
        15,
    ],
    exceptions=[], white=[], fill=[], hover_fill=[], manual=[],
)

# ------------------------------------ files with nothing protected and no site
#   50 occurrences between them, all straight row conversions.
for _p in (SELECT, PRODUCTS, LEADSTG, ROOTLAY,
           'src/app/(protected)/masters/districts/page.tsx',
           'src/app/(protected)/masters/product-subcategories/page.tsx',
           'src/app/(protected)/masters/talukas/page.tsx',
           'src/app/(protected)/masters/villages/page.tsx',
           'src/app/(protected)/masters/departments/page.tsx',
           'src/app/(protected)/masters/designations/page.tsx',
           'src/app/(protected)/masters/expense-categories/page.tsx',
           'src/app/(protected)/masters/lead-types/page.tsx',
           'src/app/(protected)/masters/product-categories/page.tsx',
           'src/app/(protected)/masters/states/page.tsx'):
    SITES[_p] = dict(protect=[], protect_lines=[], exceptions=[], white=[],
                     fill=[], hover_fill=[], manual=[])

# SearchableSelect:70 is deliberately NOT protected. `hover:bg-blue-50` and the
# selected branch's `bg-blue-50` are the SAME class, so the dead hover is
# pre-existing -- which section 11.9 excludes by name -- and conversion
# preserves it exactly. The unselected option's real hover also survives
# unchanged. Conceded by the review session on 17 Sep after it had listed the
# site.
