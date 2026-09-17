# -*- coding: utf-8 -*-
"""
Per-file site data for the phase-1 migration.

`protect` entries are (line, class) pairs taken from plan-2026-09-16-1522.md
section 11.6 A-G. Protection is per SITE, not per line: a protected class does
not shield its neighbours on the same line, which matters because group C's
CATEGORY_COLORS sits within two lines of mapped sites in files 1 and 3.

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
        # G1 teal location panel
        (300, 'bg-teal-50'), (300, 'text-teal-700'),
        (353, 'bg-teal-50'), (354, 'text-teal-600'),
        (362, 'bg-teal-50'), (365, 'text-teal-600'),
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
    exceptions=[1158, 1536],
    white=[131, 138, 236, 243, 341, 642, 764, 927, 1098, 1280, 1286, 1587, 1653],
    fill=[(242, 'bg-red-500'), (1280, 'bg-green-600'), (1286, 'bg-amber-500')],
    hover_fill=[(242, 'bg-red-600'), (1280, 'bg-green-700'), (1286, 'bg-amber-600')],
)
