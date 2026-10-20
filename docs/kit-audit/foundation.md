# Foundation layer — kit conformance audit

Scope: `src/app/globals.css`, `src/components/ui/*`, `src/components/shell/*`,
`src/components/templates/*` (app has none), `src/lib/format.ts` /
`src/lib/permissions.ts` / `src/lib/install-settings.ts`, plus repo-wide mechanical
sweeps. Kit = `D:\RGB_Software\kits\frontend-kit`. Read-only audit; no source edited.

## HELD — files other agents are currently modifying (do not touch yet, audited anyway)

```
src/app/(protected)/daily-activity/new/page.tsx
src/app/(protected)/deals/new/page.tsx
src/app/(protected)/expenses/new/page.tsx
src/app/(protected)/layout.tsx
src/app/(protected)/more/page.tsx
src/app/(protected)/orders/new/page.tsx
src/app/(protected)/parties/companies/[id]/page.tsx
src/app/(protected)/parties/companies/new/page.tsx
src/app/(protected)/parties/contacts/new/page.tsx
src/app/(protected)/parties/new/page.tsx
src/app/(protected)/today/page.tsx
src/app/api/companies/_handlers.ts
src/app/api/daily-activity/[id]/next-meeting/route.ts
src/components/daily-activity/next-meeting-dialog.tsx
src/components/shell/phone-app-bar.tsx
src/components/shell/phone-shell.tsx
src/components/shell/phone-tabs.ts
src/components/ui/action-bar.tsx
src/components/ui/phone-form.tsx
src/components/ui/phone-list.tsx
src/components/ui/photo-capture.tsx
src/components/ui/picker-sheet.tsx
src/lib/business-date.ts
tsconfig.json
```
Untracked docs/scripts (not UI, not held for audit purposes):
`docs/*`, `overnight-report-2026-09-18.md`, `scripts/backfill-*.mjs`,
`src/app/(protected)/parties/companies/[id]/edit/`, `src/lib/next-meeting-time.ts`.

---

## 1. globals.css

| item | finding | kit section | fix | effort | breaks call sites? |
|---|---|---|---|---|---|
| `--primary*` 6-value brand block | App sets its own brand (#3d3a6e purple family) vs kit's teal sample (#174443). This is **expected/correct** — every product gets its own brand (sec 0.1). Not a defect. | 0.1/2.2 | none | — | no |
| `--primary-text`, `--on-brand-accent`, `--on-brand`, `--on-brand-muted/hover/pressed` | App is **missing all of these** — kit's brand block is 8 tokens deep (adds primary-text, on-brand-accent, and 4 on-brand-* derived tokens); app only has the original 6 (plus two homegrown `--primary-subtle-hover/-pressed` the kit doesn't have). Anything using a header band (sec 36.8) or sign-in accent (11.7) has no token to read. | 0.1, 36.8, 11.7 | add the 6 missing tokens, derive per kit formula using app's own `--primary`/`--primary-foreground` | M | yes — any new header-band/sign-in work will need these; nothing currently consumes them so no live breakage |
| `--chart-3` substitution | Kit flags a CIEDE2000 collision and computes `--chart-3-substitute`; app has plain `--chart-3: #3b5a9a` (the kit's un-substituted default), i.e. app never did the sec 21.1 brand-collision check. | 21.1 | run the CIEDE2000 check against app's actual chart-2/4/5/6 and brand hue; substitute if it collides | S | no (chart usage is sparse — `bar-chart.tsx` only) |
| `--chart-ramp-1..5` | **Missing entirely** in app. Kit derives a single-measure ramp from `--primary-text`/`--primary-subtle`. | 21 | add 5 derived tokens | S | no, unused today |
| `--scroll-track/-thumb/-thumb-hover` | Present in both, but kit derives them from the brand hue (sec 10/0.1 item 6: hue of primary, saturation 12-15%, lightness 95/70/54 fixed); app's values don't match that derivation for its own purple brand (visually closer to the kit's teal sample, i.e. likely copy-pasted rather than derived). | 10, 0.1 item 6 | recompute scrollbar colors from app's actual primary hue | S | no, cosmetic only |
| `--surface-control-hover` | Missing in app (app jumps straight from resting to `--surface-control-pressed`); kit documents hover separately from pressed for field/select/checkbox/radio hover states (sec 6.4 exception). App's `--surface-control-pressed` value (#d4d4d4) is also used as app's "hover," conflating two states. | 2.3, 6.4 | add `--surface-control-hover`, correct pressed value | S | yes — any control currently reading "pressed" color for hover needs re-pointing |
| `--on-danger` | Missing. Kit added this (white, fixed) because `--danger-foreground`/`--primary-foreground` reuse was wrong on a light brand (red text under 4.5:1). App has no equivalent token at all — danger-filled controls likely use `--danger-foreground` or hardcoded white inline. | 2.4, 6.1 | add `--on-danger: #ffffff` | S | check `button.tsx`/`badge.tsx` danger variants for the actual class used today |
| `--h-icon-in-field`, `--field-max`, `--type-*` (7 tokens), `--tap-target`, `--z-*` (6 tokens), `--duration-*` (3), `--progress-delay/-min-visible`, `--menu-max-height`, `--brand-pattern-opacity`, `--drag-threshold`, `--safe-*` (4), `--keyboard-inset`, `--h-tab-bar`, `--h-action-bar`, `--bottom-bar` | **Entire blocks missing** — app's globals.css is ~140 lines shorter than the kit's and stops before the kit's "type scale / z-layers / motion / progress bar / menu height / safe areas / bottom-bar contract" sections. These are consumed by kit shell components (tab-bar, progress-bar, phone layout) that the app has NOT yet adopted (app hand-rolled its own `phone-shell.tsx`, `phone-app-bar.tsx`, `phone-tabs.ts` instead — see §4). | 3, 5.5, 5.6, 16.2, 41.9, 41.13 | this is the root blocker: cannot adopt kit's shell/phone components until these tokens exist | L | yes, by design — this is the prerequisite for retiring the hand-rolled phone shell |
| `@custom-variant phone (...)` | Missing — app has no `data-layout="phone"` variant at all, confirming the phone layout was built as a one-off, not through the kit's phone-layout mechanism (sec 41). | 41 | add variant once phone shell migration is scoped | L | large — touches every phone-specific class in the new phone pages |
| Comment drift / stale references | App's comments still say "AGENTS.md section 2.1" (old kit doc name per user's CLAUDE.md note that AGENTS.md ≈ old rgb-kit-v2) — purely cosmetic/doc-rot, not a token bug. | — | reword comments when editing nearby | S | no |

**Net read on globals.css:** the app's token set is a much older, shallower snapshot of the kit file — it has the sec-2 color tokens but none of sec 3/5/16/41 (type scale, z-layers, motion, phone-layout, safe areas, bottom-bar contract). This matches the fact the app built its own phone shell from scratch rather than through the kit.

---

## 2. components/ui — shared files that exist in both

Diff line-counts (`diff --strip-trailing-cr -w`, kit vs app), largest first:

| file | diff lines | finding | kit section | fix | effort | breaks call sites? |
|---|---|---|---|---|---|---|
| select.tsx | 827 | Near-total rewrite between versions — kit's is a much larger/different implementation (likely added multi-select-adjacent features, phone keyboard handling). App's `select.tsx` + `SearchableSelect.tsx` + `CalendarPicker.tsx` split functionality the kit may consolidate. Needs a side-by-side read before deciding sync vs keep. | 1 rule 3/4 | flag for dedicated follow-up — too large to call from grep alone | L | likely yes — widely imported (`select` is used almost everywhere forms exist) |
| table.tsx | 387 | Large divergence; app's table likely predates kit's sticky-header/sort/responsive-card patterns (sec 2 width rules). `CrudPage.tsx` (19 importers) wraps this — any sync must go through CrudPage first. | 2, 5 | sync after CrudPage decision (§3) | L | yes, via CrudPage |
| dialog.tsx | 299 | Divergence — check whether app's dialog still uses a portal-to-body pattern (sec 7 rule 2) and whether footer/fixed-bottom-bar behavior (sec 41.6/41.7, referenced in the missing `--h-action-bar` token above) is present. Given `--h-action-bar` is missing from globals.css, app's dialog almost certainly lacks the phone action-bar footer contract. | 7, 41.6/41.7 | sync dialog footer handling once bottom-bar tokens land | M | yes — `Modal.tsx` (22 importers) may wrap this; check whether Modal duplicates dialog or is dialog-on-top |
| button.tsx | 240 | Divergence — check variant names/sizes map 1:1 (kit's `icon-sm` reads `--h-icon-in-field`, which app doesn't have — confirms app's button.tsx cannot have that variant correctly sized). | 6.2/6.3.1 | sync after `--h-icon-in-field` token added | M | yes, widely imported |
| card.tsx | 224 | Divergence, moderate. | 1 | review | S/M | some |
| badge.tsx | 86 | Divergence, moderate — check danger/status variants against missing `--on-danger` token. | 2.4 | sync with token fix | S | some |
| install-settings-adjacent lib diff noted below | — | — | — | — | — |
| checkbox.tsx | 49 | Small divergence — likely hover/pressed state names given missing `--surface-control-hover`. | 6.4 | sync with token fix | S | few |
| input.tsx | 37 | Small divergence. | — | review | S | few |
| tabs.tsx | 30 | Small divergence. | — | review | S | few |
| switch.tsx | 16 | Smallest divergence — closest to kit, cheap win to sync first as a template for the others. | — | sync | S | few |
| alert-dialog, avatar, banner, bar-chart, board, breadcrumb, calendar, command, connection-banner, date-picker, dropdown-menu, empty-state, inline-field-error, input-group, label, pagination, password-input, permission-tooltip, phone-list, popover, radio-group, record-summary, searchable-select, section-tabs, separator, sheet, skeleton, sonner, state-matrix-check, textarea, time-picker, tooltip, truncate | not diffed individually (effort budget) | **Every shared file differs** per the task brief — treat the above as representative; assume similar small-to-moderate drift. Flag for a follow-up pass before touching any of them, in priority order: those with the most importers first. | 1 rule 3/4 | triage pass needed | M | TBD |

Recommendation: do NOT attempt to sync `select.tsx`/`table.tsx`/`dialog.tsx` until the token gaps in §1 are closed — all three read tokens (`--field-max`, `--h-action-bar`, `--menu-max-height`) that don't exist in the app yet, so a straight file copy would silently fall back to unstyled defaults.

---

## 3. Kit components the app lacks / app-only components

### Kit components with no app equivalent — hand-rolled check

| kit component | app hand-rolls it? | where | verdict |
|---|---|---|---|
| choice-row | no direct equivalent found | — | gap — flag |
| comment-box | `RemarksPanel.tsx` (4 importers) looks like the closest analog | `src/components/ui/RemarksPanel.tsx` | likely should become `comment-box` — needs read-through before deciding |
| draft-banner | `src/lib/drafts.ts` exists (draft persistence logic) but no banner UI found | — | gap — app has the data layer, not the kit's UI piece |
| header-band | app's page headers use `Header.tsx`/`top-bar.tsx`, not a brand-colored header-band | `src/components/ui/Header.tsx`, `src/components/shell/top-bar.tsx` | gap — ties to missing `--on-brand*` tokens in §1 |
| inline-choice | not found | — | gap |
| keyboard-shortcuts | `src/lib/field-keyboard.ts`, `src/lib/keyboard.ts` exist for phone keyboard handling, not desktop shortcuts | — | gap, low priority (desktop-only kit feature) |
| multi-select | `SearchableSelect.tsx` (7 importers) is single-select only, from a quick signature check | `src/components/ui/SearchableSelect.tsx` | if any screen needs multi-select today it's being faked with checkboxes — worth a grep before building |
| notification-permission-sheet | `src/components/shell` has no `notification-panel.tsx` equivalent; `src/lib/push.ts` exists for the data side | kit has `components/shell/notification-panel.tsx` | gap in shell layer too (§4) |
| otp-field | not found; app's auth flow likely doesn't use OTP yet | — | gap, n/a until OTP login ships |
| repeating-rows | order/weekly-plan line items (`plan-line-dialog.tsx`, order line forms) likely hand-roll repeating rows | `src/components/weekly-plan/plan-line-dialog.tsx`, order forms | probable violation — should audit and likely replace with kit's `repeating-rows` |
| text-link | app likely uses raw `<a>`/`<Link>` with ad hoc classes everywhere instead of a `text-link` primitive | — | gap — mechanical replacement once added |
| view-switcher | no kit-style list/board/calendar switcher found; `board.tsx` exists standalone | `src/components/ui/board.tsx` | gap |
| unsaved-changes | app has `src/lib/drafts.ts` but no kit `unsaved-changes` guard component — risk of silent data loss on nav away | — | gap — worth prioritizing (sec rule "no dead ends" adjacent) |

### App-only components — kit-equivalent and importer counts

| app component | importers | kit equivalent? | recommendation |
|---|---|---|---|
| `CrudPage.tsx` | 19 | no 1:1 kit component; kit's `templates/list-page.tsx` + `table.tsx` + `pagination.tsx` cover the same ground compositionally | **highest-leverage item in this whole audit** — 19 importers means CrudPage IS the master-data pattern. Migrating it to compose kit's `list-page.tsx` template is the single biggest lever, but also the single biggest risk of breakage. Sequence last, after table.tsx/select.tsx are synced. |
| `Modal.tsx` | 22 | kit's `dialog.tsx` (present in both, diverged, see §2) | likely a duplicate wrapper around an older dialog API — audit whether `Modal.tsx` should simply be deleted in favor of `dialog.tsx` once dialog.tsx is synced. 22 importers — do this only after dialog.tsx sync lands. |
| `Header.tsx` | 0 | kit's `shell/page-header.tsx` / `shell/top-bar.tsx` | **0 importers** — dead code, safe to delete outright, no call-site risk. |
| `Sidebar.tsx` | 1 | kit's `shell/sidebar.tsx` (app also separately has `components/shell/sidebar.tsx`) | likely legacy duplicate of the shell sidebar — check the 1 importer and retire. |
| `SearchableSelect.tsx` | 7 | kit's `searchable-select.tsx` (present in both — app has BOTH its own `SearchableSelect.tsx` AND a `searchable-select.tsx` matching the kit's name) | **duplicate-named pair** — `SearchableSelect.tsx` (PascalCase, app-only) vs `searchable-select.tsx` (kebab, shared with kit). Resolve which one is live; the PascalCase one is almost certainly the pre-kit original that should be deleted once its 7 importers move to the kebab-case kit version. |
| `Toggle.tsx` | 0 | kit's `switch.tsx` (present in both) | **0 importers** — dead code, delete. |
| `StatusBadge.tsx` | 5 | kit's `badge.tsx` with a status variant | likely a thin wrapper around badge.tsx for status colors — fold into badge.tsx's variant API once badge.tsx is synced. |
| `CalendarPicker.tsx` | 2 | kit's `calendar.tsx` + `date-picker.tsx` (both present, shared) | low-importer, straightforward to replace. |
| `RemarksPanel.tsx` | 4 | kit's `comment-box.tsx` (app lacks this component, see table above) | candidate replacement target once comment-box is pulled in. |
| `bottom-sheet.tsx` | 2 | kit's `sheet.tsx` (present, shared) + phone layout conventions (sec 41.8) | check if this duplicates `sheet.tsx` for phone or is a legitimate phone-specific need the kit's shared sheet doesn't cover (phone sheets have different bottom-bar offset math per the missing `--bottom-bar` token). |
| `contact-actions.tsx` | 1 | no obvious kit equivalent (call/WhatsApp/email quick actions) | likely a legitimate product-specific component — kit gap, not a violation. |
| `load-error.tsx` | 6 | kit's `templates/error-page.tsx` covers full-page; no small inline retry primitive in kit | kit gap for an inline error/retry pattern — flag. |
| `phone-field.tsx` | 1 | ties into missing `--h-icon-in-field`/phone-layout tokens | part of the hand-rolled phone layer — see §4. |
| `phone-form.tsx` | 7 | kit has no standalone `phone-form`; phone form behavior is supposed to come from `input.tsx`/`input-group.tsx` + the `phone:` variant (missing in app) | part of the phone-shell rebuild — see §4. |
| `photo-capture.tsx` | 1 | no kit equivalent — camera/photo upload is product-specific (expense receipts) | legitimate kit gap. |
| `picker-sheet.tsx` | 6 | overlaps kit's `sheet.tsx` + `command.tsx` (both present, shared) for an options picker | likely should compose `sheet.tsx`, currently doesn't — moderate dedup opportunity. |

---

## 4. shell & templates

**shell** — app has `app-shell.tsx`, `nav.ts`, `phone-app-bar.tsx`, `phone-shell.tsx`, `phone-tab-badges.ts`, `phone-tabs.ts`, `sidebar-storage.ts`, `sidebar.tsx`, `top-bar.tsx`, `use-sidebar.ts`.
Kit has `app-bar.tsx`, `app-shell.tsx`, `content-area.tsx`, `install-sheet.tsx`, `more-screen.tsx`, `notification-panel.tsx`, `page-header.tsx`, `phone-nav.ts`, `phone-only.tsx`, `progress-bar.tsx`, `sidebar.tsx`, `tab-bar.tsx`, `top-bar.tsx`.

- App's entire phone layer (`phone-app-bar.tsx`, `phone-shell.tsx`, `phone-tab-badges.ts`, `phone-tabs.ts`) is **hand-built from scratch** and has no kit counterpart by name — the kit's phone pattern is `app-bar.tsx` + `phone-nav.ts` + `phone-only.tsx` + `tab-bar.tsx`, driven by the `phone:` variant and the bottom-bar token contract (§1). This is the single largest architectural gap in the whole audit: the just-shipped phone layout (commit `0a274ba`) was built in parallel with/before the kit's own phone primitives existed in this app's copy of the kit, so it diverged completely instead of extending it.
- App is missing `content-area.tsx`, `install-sheet.tsx`, `more-screen.tsx` (app has its own `more/page.tsx` instead), `notification-panel.tsx`, `page-header.tsx`, `progress-bar.tsx` outright.
- `install-settings.ts`/`install.ts`/`install-icon.tsx` exist in app's lib but there's no shell `install-sheet.tsx` consuming them in the kit-prescribed way — check if app's own install UI lives elsewhere (`more/page.tsx`?).

**templates** — kit has `computer-only-page.tsx`, `error-page.tsx`, `my-work-page.tsx`, `notifications-page.tsx`, `personal-settings.tsx`, `search-page.tsx`, `sign-in-page.tsx`, `list-page.tsx`. **The app has no `src/components/templates/` directory at all** — zero adoption. Every page in the app was built ad hoc rather than from a kit template. This is consistent with CrudPage (§3) standing in for `list-page.tsx`.

| item | finding | kit section | fix | effort | breaks call sites? |
|---|---|---|---|---|---|
| Phone shell rebuild | App's phone shell is a parallel, non-kit implementation | 41 (all) | full rewrite onto kit's `app-bar`/`tab-bar`/`phone-nav`/`phone-only` + bottom-bar token contract | L | yes — the entire new phone surface (4 recent commits) |
| templates/ missing entirely | No page in the app is built from a kit template | plan-template.md | adopt `list-page.tsx` for CrudPage-backed pages first (highest count), `error-page.tsx` for `load-error.tsx` replacement, `sign-in-page.tsx` for login | L | yes, broad |
| `notification-panel.tsx`, `install-sheet.tsx`, `progress-bar.tsx`, `content-area.tsx`, `page-header.tsx` | Missing from shell | 16 (progress bar), 36 (page header), generic | add once tokens (§1) exist | M | low, these are additive |

---

## 5. lib/format.ts, lib/permissions.ts, lib/install-settings.ts

| file | finding | fix | effort | breaks call sites? |
|---|---|---|---|---|
| `src/lib/format.ts` vs kit | Not diffed in detail this pass (effort budget) — flag for a dedicated follow-up read; format helpers (currency/date/number display) are high-blast-radius if semantics differ. | review | S (read) then TBD | unknown |
| `src/lib/permissions.ts` vs kit `lib/permissions.ts` | 308 diff lines — but this is expected: app's `permissions.ts` is the real RBAC client (reads `role_permissions`, `checkPermission`, `getDataScope` per CLAUDE.md), not a generic kit stub. Kit's version is almost certainly a toy/demo implementation meant to be replaced. **Do not sync this file to the kit** — app's is product logic, kit's is a placeholder. Cross-check against kit's `permissions-shared.ts`/`permission-keys.ts` naming convention only, not logic. | compare naming/shape only | S | no — logic must stay app-owned |
| `src/lib/install-settings.ts` vs kit | 86 diff lines. App's file also showed up in the hex-color sweep (1 hardcoded hex) — check that hex isn't a brand color that duplicates a globals.css token. | review + extract hex to token | S | low |

---

## 6. Repo-wide mechanical sweeps

| sweep | count | top offenders | kit section | note |
|---|---|---|---|---|
| Hardcoded hex/rgb colors outside globals.css | 3 files | `src/lib/install-settings.ts`, `src/app/api/auth/forgot-password/route.ts`, `src/app/(protected)/page.tsx` | 1.1 | low volume — the forgot-password route hex is suspicious (email HTML template color, probably fine to leave inline since email can't read CSS vars, but verify it matches brand) |
| Arbitrary Tailwind values (`[...]`) | 90 occurrences | not broken out by file this pass | 1.9 / 5 | moderate volume — needs a follow-up grep with `-l` and counts per file before prioritizing |
| `window.confirm/alert/prompt` | 3 occurrences | (see grep output — appeared in the "===" sweep but file list was empty, meaning the 3 hits are likely in comments/strings, not live calls) | sec rule (dialogs) | re-verify with `-n` before treating as a violation — may be a false positive from the broad regex |
| Raw `<select>` | ~10 files | `orders/page.tsx`, `parties/page.tsx`, `review/[userId]/page.tsx`, `settings/access-control/page.tsx`, `settings/points/page.tsx`, superadmin companies pages, `couldnt-meet-dialog.tsx`, `next-meeting-dialog.tsx`, `BusinessPartnerForm.tsx`, `option-select.tsx`, `plan-line-dialog.tsx` | raw select/date rule | real volume — these should all route through kit's `select.tsx`/`date-picker.tsx` once synced (§2) |
| Raw `type="date"` | ~7 files (overlaps with select list) | `deals/new/page.tsx`, `expenses/new/page.tsx`, superadmin companies new/[id], dialogs above | same | same fix batch as raw select |
| Hardcoded role checks in UI | 29 hits across 17 files | `src/components/shell/nav.ts`, `src/components/shell/phone-tabs.ts`, `src/components/ui/Sidebar.tsx`, `src/middleware.ts` (expected — edge runtime, no DB), `src/lib/permissions.ts` (expected, it's the source of truth), app pages (`deals/page.tsx`, `masters/page.tsx`, `parties/*`, `points/page.tsx`, `settings/points/page.tsx`) | 26 | real finding — nav/sidebar/phone-tabs gating visibility by role string instead of `checkPermission`/`getDataScope` is exactly the anti-pattern sec 26 forbids ("never gate on a hardcoded role name" per CLAUDE.md too). API routes (`change-password`, `auth/me`, `masters/users/[id]`, `points/leaderboard`, `weekly-plans/_transition`) also hit — those need their own audit pass (outside foundation scope, flag to API-layer auditor). |
| `bg-white` / `text-gray-N` / `bg-gray-N` (dark-mode-breaking) | 17 files | `plan-line-dialog.tsx`, `ui/Toggle.tsx`, `ui/StatusBadge.tsx`, `ui/CalendarPicker.tsx`, `shell/phone-shell.tsx`, all of `superadmin/*` (login, dashboard layout, companies list/new/[id]) | 2/28 | **superadmin section is the worst offender** — it looks like it was never themed with design tokens at all, consistent with SuperAdmin being architecturally separate (per CLAUDE.md). The three app-only components flagged for deletion in §3 (`Toggle.tsx`, `StatusBadge.tsx`) also show up here — one more reason to retire them via the kit versions rather than fix in place. |
| Back-arrow buttons on desktop pages | not swept this pass | 1.11 | flag for follow-up — budget ran out before this grep |

---

## KIT GAPS (for owner review — not to be fixed by editing the kit)

1. **No kit equivalent for photo/camera capture** (`photo-capture.tsx`) — likely a real gap for any product with field photo evidence (expense receipts here).
2. **No kit equivalent for quick contact actions** (call/WhatsApp/email row) — `contact-actions.tsx` — common CRM pattern, worth a kit primitive.
3. **No kit inline error/retry primitive** — kit only has a full-page `error-page.tsx` template; apps need a small inline "couldn't load — retry" block for widgets/sections (`load-error.tsx`, 6 importers, suggests real demand).
4. **No kit "unsaved changes" guard pattern visible in the ui library listing** despite being named in the task's expected-component list — confirm it actually exists in the kit (`unsaved-changes.tsx` was listed as missing from the app, but worth double-checking it is a real, documented component with usage guidance, not a stub).
5. **Bottom-bar/phone-layout token contract (§1) is large and all-or-nothing** — a product can't partially adopt it (tab-bar, action-bar, sheets, toasts all read the same `--bottom-bar` var). The kit doesn't document an incremental adoption path for an app (like this one) that already shipped a non-kit phone layer — that migration guidance is a gap in the kit's own docs, not in this app.
6. **`src/lib/permissions.ts` vs kit's same-named file**: the kit ships a same-named file that is NOT meant to be synced over the app's real RBAC logic, but nothing in the kit's docs flags `lib/permissions.ts` as "replace the shape, never the logic" the way CLAUDE.md does for this repo. Worth the kit adding an explicit note distinguishing its `lib/` demo helpers from files a real app must keep product-owned.

---

## Recommended fix order

1. **globals.css token gaps (§1)** — must land first; almost every other fix (button icon sizing, select field-max, dialog action-bar footer, scrollbar derivation) reads a token that doesn't exist yet. Pure additive, low risk, no call-site breakage.
2. **Dead-code deletions** — `Header.tsx` (0 importers), `Toggle.tsx` (0 importers). Zero risk, do immediately, also removes 2 of the 17 dark-mode offenders.
3. **Small/cheap component syncs** — `switch.tsx`, `tabs.tsx`, `input.tsx`, `checkbox.tsx` (16–49 diff lines) — low risk, builds confidence/pattern for the bigger ones.
4. **Role-hardcoding cleanup in `nav.ts`/`phone-tabs.ts`/`Sidebar.tsx`** — security/correctness issue independent of the kit sync, should not wait on anything above.
5. **Duplicate-named component resolution** — `SearchableSelect.tsx` vs `searchable-select.tsx`, `Modal.tsx` vs `dialog.tsx`, `Sidebar.tsx` (app-only) vs `shell/sidebar.tsx` — resolve which is canonical before syncing the kit side, or the sync will immediately regress the still-live duplicate.
6. **button.tsx / badge.tsx / card.tsx sync** — once §1's icon-in-field and on-danger tokens exist.
7. **dialog.tsx sync**, then fold `Modal.tsx` into it — needs the bottom-bar/action-bar tokens from §1 for the phone footer contract.
8. **select.tsx / table.tsx sync** — largest diffs, highest importer count (via `CrudPage`), do last among the ui/ files and only after 1–7 are stable.
9. **CrudPage → kit `list-page.tsx` template migration** — the single biggest lever (19 importers) and the single biggest regression risk; sequence after table/select are solid, do it page-type by page-type, not in one shot.
10. **Phone shell rebuild onto kit's `app-bar`/`tab-bar`/`phone-nav`/`phone-only`** — largest effort item in the whole audit; this is also currently HELD (another agent is actively changing `phone-shell.tsx`/`phone-app-bar.tsx`/`phone-tabs.ts`) — coordinate before starting, don't duplicate that work.
11. **Raw `<select>`/`type="date"` replacement sweep** and **superadmin dark-mode/token retrofit** — mechanical, can run in parallel with anything above once the target components (select.tsx, date-picker.tsx) are synced.
