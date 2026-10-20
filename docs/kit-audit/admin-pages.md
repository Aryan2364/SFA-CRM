# Kit Conformance Audit — Masters, Settings, Review, Weekly-Plan, Reports, Daily-Activity, Access

Audited against D:\RGB_Software\kits\frontend-kit (FRONTEND_RULES.md, FRONTEND_RULES_VIEWS.md, FRONTEND_RULES_ACCESS.md).
Phone rendering audited separately; only obvious phone breakage noted here.

## Systemic

1. **Legacy CrudPage/useCrud stack, not the kit list-page template.** 18 of 20 `masters/**` pages render through `src/components/ui/CrudPage.tsx` (raw `<table>`, hand-rolled colours, `Modal`-based Add/Edit, no toolbar zone). Only `masters/users/page.tsx` is fully kit-converted (`ListPage`, `Button`, `Badge`, `Tooltip`, `PermissionTooltip`, `Breadcrumb`) — it is the exemplar to copy. Fix: migrate `CrudPage` callers to `components/templates/list-page.tsx`.
2. **A whole shadow component library duplicates the kit, used across masters + legacy pages:** `Modal.tsx` (vs `dialog.tsx`/`alert-dialog.tsx`), `SearchableSelect.tsx` (vs kit's `searchable-select.tsx`, which has keyboard nav this one lacks), `Toggle.tsx` (vs `switch.tsx`), `StatusBadge.tsx` (vs `badge.tsx`'s 4-colour status system — note there may be a second same-named `status-badge` file too, needs dedup check), `CalendarPicker.tsx` (vs `date-picker.tsx` — calendar-only, no typed entry, violates §20.1 directly), `RemarksPanel.tsx` (vs `sheet.tsx`), `Header.tsx` notification dropdown (hand-built floating div, not portalled, vs `popover.tsx`/`dropdown-menu.tsx`). Kit §4 rules 2–4 ("never build the same thing twice"). This one pattern explains most of the hardcoded-colour and missing-a11y findings below.
3. **Hand-rolled dialogs/modals (`fixed inset-0` divs) recur everywhere a kit `Dialog`/`AlertDialog` should be used instead**, independently of the `Modal.tsx` component: login forgot-password, superadmin Create-Admin/Revoke/Disable, weekly-plan Audit-Log/Request-Reopen, review/[userId] decision confirm. Each reinvents backdrop, close button (often a literal `&times;`, not Lucide `XIcon`), and lacks Escape/focus-trap/unsaved-changes handling the kit component gives for free (§24, §11.3 rule 10).
4. **Password field markup (eye/eye-off SVGs) is copy-pasted verbatim** across login, reset-password, superadmin login instead of the kit's `password-input.tsx` (§32). `reset-password/page.tsx` additionally keeps a confirm-password field, which §32.3 explicitly forbids.
5. **Hardcoded Tailwind palette colours instead of theme tokens** are pervasive in the older/legacy screens (`gray-900`, `blue-600`, `amber-600`, `emerald-50`, `red-600`, avatar-colour arrays, status dots) — kit §1 rule 1 hard prohibition. By contrast, newer files (`settings/system`, `report-table.tsx`, `templates/list-page.tsx`, `weekly-plan` decision flow) are disciplined and token-based, proving the kit is already followed where code was written after kit adoption — this is a retrofit gap, not a kit-awareness gap.
6. **Role-name string comparisons (`=== 'Administrator'`) gate UI** in `access-control/page.tsx` (6 call sites) and `masters/page.t.tsx:147` despite a ready `is_system`/`isAdministrator` boolean sitting on the same data — kit §26 rule 5 and project CLAUDE.md both forbid this. Low-risk, high-value fix.
7. **Native `title=` tooltips** recur in review/[userId]/page.tsx and team-member-table.tsx instead of `Tooltip`/`PermissionTooltip` — §1 rule 5, §19 — and in one case (team-member-table "3+ times" warning) it's the *only* place the info is exposed, so keyboard/touch users can't reach it at all.
8. **Raw `<table>` markup for read-only report/summary tables** recurs in `review/team`, `review/weekly`, `team-member-table.tsx` — no `table.tsx`, no `col-*` width tokens, no §34 sticky-total/frozen-column treatment.
9. **No native `confirm()`/`alert()`/`prompt()` found anywhere audited**, and delete flows consistently use `AlertDialog`. This is a genuine strength to preserve while fixing the above.
10. **`ghost` variant used on text-labelled buttons** ("Add", "Chat", "Audit Log", "This week") in weekly-plan/review — §6.1 rule 5 reserves borderless styling for icon-only buttons or five named exceptions; none apply here.

## Masters (`src/app/(protected)/masters/**`, `useCrud.ts`, legacy `src/components/ui/*`)

- [sev H] src/components/ui/CrudPage.tsx:260-271 — raw `<table>` tree, no `col-*` tokens/sticky band header — kit §10/§11.1/§17.1/§36 — rebuild on `table.tsx`.
- [sev H] src/components/ui/CrudPage.tsx:291-391,778 — rows not clickable (no `TableRowLink`), only text Edit/Delete act — kit §11.1.2 — make the row open-on-click.
- [sev H] src/components/ui/Modal.tsx:1-37 — duplicate dialog implementation used by all 18 legacy masters pages; no unsaved-changes guard on close — kit §4 rule 3, §11.3 rule 10 — switch to kit `Dialog`.
- [sev H] src/components/ui/SearchableSelect.tsx — duplicates kit `searchable-select.tsx`; no keyboard nav (arrows/Enter/Escape/type-ahead), no edge-flip, no 7-row cap — kit §4.1, §16.2, §16.4 — swap to kit component.
- [sev H] src/components/ui/Toggle.tsx:15 — hardcodes `bg-blue-600`/`bg-gray-300` instead of theme tokens; also duplicates `switch.tsx` — kit §1 rule 1, §4.1 — highest-value single fix (brand colour swap won't propagate here otherwise).
- [sev H] src/components/ui/StatusBadge.tsx:1-11 — hardcodes raw colours per status instead of the kit's closed 4-colour status system; duplicates `badge.tsx`; possible second same-named `status-badge` file — kit §2.4, §4 rule 2 — dedup and map to tokens.
- [sev H] src/components/ui/CalendarPicker.tsx — calendar-only, no typed entry — kit §20.1 directly violated — replace with kit `date-picker.tsx`.
- [sev M] src/components/ui/CrudPage.tsx:252-256 — search input outside the four-zone toolbar layout, no Filter/Sort row — kit §11.1 zone 2, §17.
- [sev M] src/components/ui/CrudPage.tsx:396-440 — pagination count text not "1–25 of 148" format — kit §11.1.1.
- [sev M] src/hooks/useCrud.ts:6 — `PAGE_SIZE = 15`, kit default is 25 — kit §11.1 — affects all 18 legacy masters pages.
- [sev M] src/components/ui/Modal.tsx:20,23 — widths don't match kit's 400/560/800px tokens; close button is literal `&times;` not Lucide icon-button — kit §24, §23.
- [sev M] src/components/ui/Header.tsx:103,139 — unread pill hardcodes `bg-red-500`, shows "9+" not kit's "99+"; `SECTION_COLORS` hardcodes palette classes — kit §1 rule 1, §6.8/§23.
- [sev M] src/app/(protected)/masters/page.tsx:147,150,153,169,197 — `me?.role === 'Administrator'` gates section visibility — kit §26 rule 5 / CLAUDE.md — use a derived boolean like `users/page.tsx` does.
- [sev L] src/components/ui/CrudPage.tsx — Add/Edit/Delete buttons are raw styled `<button>`, not `Button` — kit §4/§6.
- [sev L] src/components/ui/CrudPage.tsx — no nothing-yet vs nothing-found empty-state distinction — kit §13.
- [sev L] src/components/ui/Header.tsx:94-162 — notification dropdown not portalled/no z-index token — kit §5.5 rule 4.
- [sev L] src/components/ui/RemarksPanel.tsx — hand-rolled `fixed right-0` panel, not portalled, not `sheet.tsx`; icon buttons not 36×36 — kit §4.1, §5.5, §6.2/6.3. (Otherwise one of the better legacy files — good `PermissionTooltip` use.)
- Positive: CrudPage delete flow uses `AlertDialog` throughout, correct soft-delete messaging (§15.2); `useCrud.ts` never leaks raw error text (§7); `users/page.tsx` is a correct kit-template exemplar.

## Login / Reset-password / Superadmin login (`src/app/login`, `src/app/reset-password`, `src/app/superadmin/login`) — §11.7, §32

- [sev H] src/app/login/page.tsx:202-281 — ForgotPasswordModal hand-rolled overlay instead of kit `Dialog` — kit §4, §24.
- [sev H] src/app/reset-password/page.tsx:105-123 — confirm-password field present; §32.3 explicitly forbids it — remove it, rely on show/hide toggle.
- [sev H] src/app/reset-password/page.tsx:78-120, src/app/login/page.tsx:162-176,264-268, src/app/superadmin/login/page.tsx:60-86 — hand-rolled password input + duplicated eye/eye-off SVGs, 3 copies — kit §1 rule 3, §32 — use `password-input.tsx` everywhere, delete duplicated markup.
- [sev H] src/app/login/page.tsx:189-193 — "Forgot Password?" in raw `text-blue-600`, not a token/kit link — kit §1.1, §6.6.
- [sev M] src/app/login/page.tsx:106-200 — bespoke sign-in markup, not `sign-in-page.tsx` template/brand panel — kit §11.7.
- [sev M] src/app/login/page.tsx:179 — error shown via server-supplied text in a plain `<p>`, not the fixed never-say-which-field-wrong sentence via `banner.tsx` — kit §11.7.
- [sev M] src/app/superadmin/login/page.tsx:32,88-94 — hardcoded `bg-gray-900`/`text-white` — kit §1.1/§2.
- [sev L] src/app/login/page.tsx:156-157 — hand-rolled `<label>`, no asterisk convention — kit §11.3.
- [sev L] src/app/superadmin/login/page.tsx:28-98 — bypasses `sign-in-page.tsx` template entirely — kit §11.7.

## Settings → Access Control (`src/app/(protected)/settings/access-control/page.tsx`) — kit §40

- [sev H] :318,353,370,384,455-457,673 — `selectedRole.name === 'Administrator'` checked 6 times; `Role.is_system` already exists on the type — kit §26 rule 5, §40.3 rule 14 — replace all with `.is_system`.
- [sev H] :445-453,508-519 — role deletion via inline "×" + text Yes/No, not `AlertDialog` naming the record/consequences — kit §15.
- [sev H] :126-128,507-518 — delete not disabled-with-tooltip when people hold the role (should show "N people have this role…" before click) — kit §40.2 rule 6, §26.
- [sev H] :602-660 — entire permission grid hand-rolled (`<table>`, inline SVG ticks, ad hoc switches, raw `<select>` for scope) instead of a permission-grid/checkbox/switch/inline-choice pattern; no "Everything in X" / "Also includes" rows, no frozen Section column — kit §40.3-40.5, §17.1.
- [sev H] :36,467,569-570,797-799,1008,1036,1104 — hardcoded Tailwind colours throughout, including an `AVATAR_COLORS` array — kit §1.1.
- [sev M] :85-115 — tab bar hand-rolled, not `section-tabs.tsx`; **missing the kit's prescribed 4-tab structure (Roles, People, What they can do, History)** — only has Roles & Permissions / Reporting Schema / Org Chart — kit §40.1, §33 — flag to owner: may be deliberate product scope, needs a recorded decision either way (see KIT GAPS).
- [sev M] :496-523 — role list is not a real list page (no People-count column, no Duplicate action, no `TableRowLink`) — kit §40.2.
- [sev M] :825-835,860-869,894-908 — user pickers are hand-rolled filtered button lists, not `SearchableSelect`/multi-select — kit §16.3.
- [sev L] :589 — "Saving…" uses `text-warning`, a status colour, for a transient loading state — kit §2.4.
- [sev L] :805-807 — persistent "All changes saved ✓ / Saving…" status line instead of per-save toast — kit §25 — confirm as an agreed exception or fix.

## Superadmin company pages (`src/app/superadmin/(dashboard)/companies/**`)

- [sev H] companies/page.tsx:61-69 — "Add Company" button + Active/Inactive switch hand-rolled, not `Button`/`Switch`; `bg-gray-900` hardcoded — kit §4,§6,§1.1.
- [sev H] companies/[id]/page.tsx:700-734,737-749,752-763 — three `fixed inset-0` modals (Create Admin / Revoke / Disable) instead of `Dialog`/`AlertDialog` — kit §4,§15,§24.
- [sev H] companies/[id]/page.tsx — nearly every button raw `<button className="bg-gray-900...">`, never `Button` — systemic in this file — kit §4,§6.
- [sev H] companies/[id]/page.tsx:555,587,685,724 — hardcoded colours (`amber-600`, `gray-900`, `gray-500`) — kit §1.1.
- [sev M] companies/page.tsx:117 — Active/Inactive toggle fires immediately with no confirm/undo, inconsistent with the detail page's own confirmed "Disable All Logins" — kit §15,§38.1.
- [sev M] companies/page.tsx:122-128 — redundant "Manage" link duplicates row-click navigation — kit §4 rule 2,§11.1.2.
- [sev M] companies/[id]/page.tsx:583-592 — Settings/Analytics tabs hand-rolled, not `section-tabs.tsx` — kit §33.
- [sev M] companies/[id]/page.tsx:47-51,270-294 — `CLS_STYLES`/chart colours use raw Tailwind instead of status tokens — kit §2.4,§21.
- [sev L] companies/[id]/page.tsx:537-541 — back-arrow button on a desktop page — kit §1 rule 11 — use `Breadcrumb`.
- [sev L] companies/[id]/page.tsx:481-483,527 — inline auto-dismiss banners instead of `sonner.tsx` toast — kit §25.

## src/lib/permissions.ts

- [sev L] :38 — `if (user.role === 'Administrator') return true` — server-side short-circuit by role name; should key off an `is_system` flag so a renamed role doesn't break it — kit §26 rule 5.

## Review / Weekly-plan (`src/app/(protected)/review/**`, `weekly-plan/**`, `weekly-plans/**`)

- [sev H] review/[userId]/page.tsx:6,393-412 — decision confirm uses legacy `Modal` while `plan-review-panel.tsx`'s `DecisionDialog` does the same job correctly via kit `Dialog` — two parallel implementations of the same four-verb flow — kit §4 rules 3-4.
- [sev H] review/[userId]/page.tsx:108-112,449-513 — raw Tailwind colours (`CATEGORY_COLORS`, `border-amber-300`, `bg-teal-50`, etc.) — kit §1 rule 1, §2.4.
- [sev H] weekly-plan/page.tsx:1146-1194 — "Audit Log" and "Request Reopen" are hand-rolled `fixed inset-0 z-50` divs (hardcoded z-index, literal `&times;` close) instead of kit `Dialog` — kit §24, §4 rules 3-4, §23, §5.5 rule 5.
- [sev H] team-member-table.tsx:100-163, review/team/page.tsx:199-286, review/weekly/page.tsx:194-223 — raw `<table>` markup, raw pixel min-widths instead of `col-*` tokens, no §34 sticky-total/frozen-column — kit §34, §17.1.
- [sev M] review/[userId]/page.tsx:126-153,468-513 — hand-drawn inline SVG icons instead of Lucide — kit §23 rule 1.
- [sev M] review/[userId]/page.tsx:148,482,1022; team-member-table.tsx:139-146 — native `title=` tooltips, one case (3+ times warning) is the only place that info is exposed at all — kit §1 rule 5, §19.
- [sev M] review/[userId]/page.tsx:408-410; weekly-plan/page.tsx:1180-1184 — comment/reopen textareas at `text-sm` with no 16px mobile override (iOS zoom) — CLAUDE.md mobile rule, kit §41.
- [sev M] weekly-plan/page.tsx:917-921; weekly-priorities.tsx:93,150; review/team/page.tsx:138,150; review/weekly/page.tsx:150 — `variant="ghost"` on text-labelled buttons — kit §6.1 rule 5.
- [sev M] weekly-plan/page.tsx:941-1009 — four status banners hand-built instead of `banner.tsx` — kit §4 rule 2, §7.1.
- [sev L] review/[userId]/page.tsx:126-153 — week-strip nav buttons raw `<button>`, not kit icon `Button` — kit §6.3.
- [sev L] review/[userId]/page.tsx:405-406 — required field marked "(required)" text, not the asterisk convention — kit §11.3 rule 3.
- [sev L] weekly-priorities.tsx:116-133 — raw `<input type="checkbox">` instead of `checkbox.tsx` — kit §4 rule 3.
- [sev L] weekly-plan/page.tsx:946,987,1003 — "Request Reopen" as bare underlined text button, not a real button — kit §6.1 rule 5.
- Positive: `DecisionDialog`, `ManagerChanges`, `plan-board.tsx`, `plan-line-dialog.tsx`, `review/page.tsx` are well-built against the kit — real `PermissionTooltip` with server-derived `canDecide`/`canReview` (never a role name), optimistic board moves with revert-on-failure, 409 handling, Undo-safe toasts, no native dialogs anywhere in this slice.

## Reports / Daily-activity (`src/app/(protected)/reports/**`, `daily-activity/**`)

- [sev H] couldnt-meet-dialog.tsx:103 — uses legacy `Modal` instead of kit `Dialog`/`AlertDialog` — kit §4 rule 4.
- [sev H] couldnt-meet-dialog.tsx:118-124 — raw `<select>` with hand-rolled classes instead of `select.tsx` — kit §16, §1 rules 1/5.
- [HELD][sev H] next-meeting-dialog.tsx:247-258 — raw `<select>` for "About opportunity" picker instead of `Select`/`SearchableSelect` — kit §16.1-16.3 (file is mid-edit by another agent; re-check once it lands).
- [sev M] couldnt-meet-dialog.tsx:129-132 — raw `<textarea>` instead of `textarea.tsx` — kit §4.1.
- [HELD][sev L] next-meeting-dialog.tsx:301 — width overridden via `className="sm:max-w-md"` instead of the component's `size` prop — kit §24.
- [sev L] couldnt-meet-dialog.tsx:115,128,136 — ad hoc label classes instead of `label.tsx` — kit §4.1.
- [sev M] report-table.tsx:159-182 / reports/page.tsx:593-652 — total row intentionally pinned via the page's sticky section header rather than the table's own sticky `tfoot`, a deliberate departure from kit §34.1's literal wording; works correctly but should be recorded as an exception so a future report page doesn't look inconsistent.
- Positive: report-chart.tsx, date-range-control.tsx, report-headline.tsx, report-presets.tsx, saved-reports.tsx, reports/page.tsx, daily-activity/page.tsx, meeting/[id]/page.tsx, data-health-alert.tsx/popover.tsx, templates/list-page.tsx are all unusually well-aligned with the kit (correct `size` props, §27.4 preset wording, breadcrumbs not back-buttons, three-state `known()`/`PermissionTooltip` pattern, portalled popovers, documented intentional exceptions). No native dialogs, no raw error text found in this slice.
- Not yet reviewed (budget): `add-meeting-dialog.tsx`, `missed-section.tsx`, `visit-card.tsx`, `expenses-tab.tsx` under `src/components/daily-activity/` — check these for the same raw-`<select>`/custom-`Modal` pattern before considering the directory clean. Also not reviewed: `settings/points/page.tsx`, `superadmin/companies/new/page.tsx`, `superadmin/(dashboard)/layout.tsx`.

## KIT GAPS (for owner review — not proposing kit edits)

- Access Control's actual screen set (Roles & Permissions / Reporting Schema / Org Chart) does not match kit §40.1's prescribed 4-tab structure (Roles, People, What they can do, History). "Reporting Schema" and "Org Chart" aren't kit-specified screens at all, and the kit's People/What-they-can-do/History tabs don't exist here. This may be intentional product scope beyond the kit's access template — needs an explicit decision (adopt the kit's 4-tab structure and fold Org Chart/Reporting Schema in some other way, or record this as a permanent, written exception) rather than silent drift.
- Kit §34.1 says the report table's own footer row must be sticky; this codebase instead pins the total via the page's sticky section header (report-table.tsx / reports/page.tsx), by deliberate design per in-file comments. Works fine but is a literal deviation — worth the owner confirming this is the going-forward pattern so it's applied consistently to future report pages instead of re-deriving per page.
- No kit answer found for an avatar-initials colour set (access-control's `AVATAR_COLORS`) — the kit's token system (brand/status) doesn't obviously cover "N distinct but harmonious colours for people initials." Needs either a small dedicated token set agreed in `globals.css` or an explicit decision to keep raw Tailwind here as a named exception.
