# Kit conformance plan (2026-10-16)

Authority: `D:\RGB_Software\kits\frontend-kit` (FRONTEND_RULES.md + _VIEWS / _ACCESS / _PHONE). Read-only.

Audits (read these for the detail):
- `foundation.md` — tokens, shared components, shell, lib
- `records-pages.md` — parties, deals, orders, expenses, conversations, search, points, profile, dashboard
- `admin-pages.md` — masters, settings, access control, review, weekly plans, reports, daily activity, auth, superadmin
- `phone.md` — phone shell, lists, forms, sheets (§41)

Outputs: `changes.md` (every file changed, per wave), `kit-gaps.md` (kit problems/missing pieces for owner review).

## Waves and file ownership

Other sessions were editing the phone shell and several `*/new` pages when this started. Those files are
**held** and not touched until those sessions finish (checked with `git status` before every edit).

| Wave | Owner | Scope |
|---|---|---|
| 1 | foundation agent | `globals.css` tokens; sync `src/components/ui/*` to kit; delete dead legacy components; merge duplicate components; port missing kit components; tri-state permission tooltip; role-name checks in nav |
| 2A | masters agent | 18 masters on legacy `CrudPage`/`useCrud` → kit list-page template (`masters/users` is the exemplar) |
| 2B | records agent | parties, deals, orders, expenses, conversations, search, points, profile, dashboard + their components |
| 2C | admin agent | settings, access control, review, weekly plans, reports, daily activity, login/forgot/reset, superadmin |
| 3 | phone agent | held phone shell/list/form files, after the other sessions finish |
| 4 | verify | tsc, lint, headless-Chrome pass on desktop + phone widths |

Only Wave 1 edits `src/components/ui` and `globals.css`. Wave 2 agents own disjoint page trees.

## Decisions needed from the owner (not taken by agents)
- "Today" replaces the kit's "My work" (§41.15) — confirm and record as a plan exception.
- Access Control screens vs kit §40.1 four-tab structure.
- Everything in `kit-gaps.md`.
