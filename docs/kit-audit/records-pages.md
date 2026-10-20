# Kit conformance audit — Parties, Deals, Orders, Expenses, Conversations, Search, Points, Profile, Dashboard

Kit: `D:\RGB_Software\kits\frontend-kit\FRONTEND_RULES.md` (+ FRONTEND_RULES_VIEWS.md). Paths relative to `D:\RGB_Software\SFACRM\src` unless noted.
`[HELD]` = file shows modified ("M") in `git status` at audit time — another agent is mid-edit; line numbers there may shift.

## Systemic (patterns repeated across 3+ files — fix centrally)

- **[H] Hardcoded role checks instead of permissions.** `me?.role === 'Administrator' || …` gates actions in `parties/page.tsx:493,504,1160,1173,1682`; `parties/contacts/[id]/page.tsx:304,306`; `deals/page.tsx:671,686`; also in shell code outside this slice (`components/shell/nav.ts:135`, `phone-tabs.ts:27`, `components/ui/Sidebar.tsx:153`). Kit §26 rule 5, §26.3 rule 3. Fix: drop the role clause everywhere and gate on the permission alone; if an Administrator needs implicit full access, grant it via `/api/auth/me`'s permission set, not a role string in the UI.
- **[H] `permission-tooltip.tsx` cannot express "not known yet".** `src/components/ui/permission-tooltip.tsx` types `allowed: boolean`, but kit §26.1 requires tri-state `true | false | undefined` (undefined = no reason shown while loading). Every caller hand-rolls a workaround; `parties/contacts/new/page.tsx:48,116,123` gets it wrong and shows "Only someone who can create contacts…" to everyone while `me` is still loading. Fix: port the kit's `permission-tooltip.tsx` with the required tri-state prop; callers then pass `me ? can : undefined`.
- **[H] Hand-rolled modals/drawers instead of kit overlays.** `parties/page.tsx:898-926` (Edit account, via legacy `components/ui/Modal.tsx`), `orders/page.tsx:148-161` (OrderDetailDrawer), dashboard `page.tsx:646-663` (Reject Plan) all build `fixed inset-0` + manual backdrop divs instead of `components/ui/dialog.tsx` / `sheet.tsx` / `alert-dialog.tsx`. None honour Escape-to-close, focus trap, or focus return (§39.3); none use a section-36 header band. Kit §1 rules 3–4, §24, §5.5. Fix: rebuild each on the matching kit primitive (dialog lg for Edit account, sheet side="right" for the order drawer, alert-dialog for Reject Plan), then retire `Modal.tsx`.
- **[H] Hardcoded hex/Tailwind colours bypassing design tokens.** Worst in `points/page.tsx` (`bg-gradient-to-br from-yellow-400 to-orange-500`, `bg-gray-100`, `text-gray-900`, `bg-green-500`, medal colours) and dashboard `page.tsx` (Recharts hex fills `#3b82f6 #e5e7eb #22c55e #eab308 #ef4444 #d1d5db`, axis `fill:'#6b7280'`, `bg-green-600`, `bg-purple-100 text-purple-700` in PlanBadge); also `orders/page.tsx` reusing chart tokens `bg-chart-1`/`bg-chart-2` as a generic category badge. Kit §1 rule 1 (hex only in globals.css), §2.4 (closed status-colour set), §28 (dark-mode tokens). None of this survives a brand swap or a dark theme. Fix: route through status/brand tokens; route charts through `bar-chart.tsx` (CategoryBarChart), which the kit mandates as the only Recharts wrapper and which the caller cannot recolour.
- **[H] Emoji used as icons.** `points/page.tsx` (🏆📋✅🟢🔴🤝💸🔥🎯🥇🥈🥉 throughout). Kit §23 "Never use emoji as icons." Fix: map each `action_type`/rank to a Lucide icon.
- **[M] Raw SVG / unicode glyphs instead of Lucide.** `orders/page.tsx` drawer close button (raw `<svg>` X path, no sr label), dashboard week-nav chevrons and "all clear" check (raw `<svg>`), dashboard Team Performance table sort glyphs (`↕ ↑ ↓` unicode). Kit §23 "Lucide only, never mix icon sets", §6.3 (icon buttons need a hidden text label). Fix: swap in `XIcon`/`ChevronLeftIcon`/`ChevronRightIcon`/`ArrowUpDownIcon` from the icon map, each with `<span className="sr-only">`.
- **[M] No unsaved-changes guard anywhere.** No `unsaved-changes.tsx` exists in the app; `parties/new`, `parties/contacts/new`, `parties/companies/new`, `parties/companies/[id]/edit`, `deal-dialog`, `contact-dialog`, `quick-create-dialog`, the Edit-account modal, and the dashboard's follow-ups dialog all let a filled form navigate away silently. Kit §11.3 rule 10, §4.1 (`unsaved-changes.tsx` row). Fix: port the kit's `unsaved-changes.tsx` (`useUnsavedChanges`) and wire into each form/dialog.
- **[M] Delete/irreversible confirmations don't follow §15/§24.** Button copy is generic ("Confirm delete" in `parties/page.tsx:1527`, `parties/contacts/[id]/page.tsx:746`); the contact confirm is a plain `Dialog` that closes on Escape/backdrop; dashboard's Reject Plan and `deal-status.tsx`'s Won/Lost close confirmation are hand-rolled and also closable via Escape/backdrop despite being irreversible. Kit §15 rule 3, §24 rule 3. Fix: `alert-dialog.tsx` everywhere an action cannot be undone, with the action named in the button ("Delete contact", "Reject plan").
- **[M] Hand-rolled tab/segmented controls instead of `tabs.tsx`/`section-tabs.tsx`/`view-switcher.tsx`.** `deals/page.tsx:541-578` List/Board switcher (ghost buttons with a primary-subtle override, no `useListView` memory); `points/page.tsx:105-112` period selector and `:143-150` Activity/Breakdown/Leaderboard switch — two independently-styled tab-like widgets on one screen, violating §33.3 (sibling tabs must look/behave identically) by definition since they're not even siblings of the same component. `companies/new/page.tsx:643-698` Account-kind/Person-mode custom `role="radio"` button groups. Kit §1 rule 3, §4 rule 2, §33. Fix: port `view-switcher.tsx` for list/board; use `tabs.tsx`/`section-tabs.tsx` for the points tab bars; use `radio-group.tsx` for binary choices (flagged as a KIT GAP — no segmented-control component exists).
- **[L] Native browser-default controls.** Native `<select>` in the Edit-account modal (`parties/page.tsx:906-922`); native `title=` tooltips (`parties/page.tsx:386-391`, `orders/page.tsx:459-466`); raw `<input type="radio">` in `address-editor.tsx:159-169`. Kit §1 rule 5. Fix: `SearchableSelect`/`Select`, `tooltip.tsx`, `radio-group.tsx` respectively.
- **[L] Generic, record-less toast copy.** "Updated successfully" / "Created successfully" / "Deleted successfully" (`parties/page.tsx:613,629,650,1240,1278`). Kit §37.2, §7.2. Fix: name the record ("Acme Traders updated").

## app/(protected)/parties/page.tsx

- [H] :898-926 — Edit account uses legacy `components/ui/Modal.tsx` (no portal §5.5 r4; hardcoded z-50 §5.5 r5; `rounded-2xl`/`shadow-2xl` §5.3/§5.4; raw `&times;` close, no Escape handling §24 r2; hand-styled buttons §6; no band header §36). Fix: `dialog.tsx` size lg + `DialogFooter`; retire `Modal.tsx` (its only caller here).
- [H] :906-922 — native `<select>` for Account type inside that modal, list can exceed 6 options. §16.3, §1 r5. Fix: `SearchableSelect`.
- [M] :436,446,461,472 — row Edit/Delete use filled secondary/danger icon buttons; should be quiet ghost (§6.3). The Contacts tab (peer, :1111) uses a ⋮ `DropdownMenu` for the same job — siblings behave differently (§11.1.2). Fix: one ⋮ `DropdownMenu` per row on both tabs.
- [M] :386-391 — native `title=` on "missing fields" line. §1 r5, §8. Fix: `Truncate` (resolve the noted hydration issue in list-page.tsx rather than falling back to `title`).
- [M] :843,849,867,1425 — `allowed={!createKnown || canCreate}` workaround, symptom of the permission-tooltip boolean typing (Systemic). Fix after port: `allowed={me ? canCreate : undefined}`.
- [M] :1478-1498 — blocked-delete dialog (size sm) shows the server's raw `data.error` string. Confirm route wording follows §7.2 (cause, then next action); offer Deactivate as primary where applicable. §15.1.
- [L] :276,387 — arbitrary widths `xl:max-w-[320px]`, `max-w-40` instead of col-* tokens. §17.1.
- [L] :387 — `text-xs` is not a kit type token. §3. Fix: `text-meta`.
- [L] :574,1323 — "Failed to load account types"/"…contact types" toasts with no next step. §7.2 r2. Fix: name a next step ("Reload the page to filter by type.").
- [L] :1645-1650 — hand-rolled phone empty state with no action. §13, §4.1. Fix: `EmptyState` nothing-yet.

## app/(protected)/parties/new/page.tsx [HELD]

- [M] [HELD] :262-280 — second hand-built "Already the Self contact elsewhere" dialog duplicates `individual-conflict-dialog.tsx` and omits `size="sm"` (renders 560px). §1 r4, §24. Fix: render `IndividualConflictDialog`.
- [L] [HELD] :258 — form error as a raw `<p className="text-danger">`, no icon. §7.2 r1. Fix: `InlineFieldError` or a stacked `Banner`.

## app/(protected)/parties/contacts/new/page.tsx [HELD]

- [H] [HELD] :48,116,123 — `canCreate = me ? … : false` then `allowed={canCreate}`: shows the "who may do it" reason to everyone while `me` is loading. §26.1 r2, r4. Fix: `allowed={me ? canCreate : undefined}` after the tooltip port; interim: `allowed={me === null || canCreate}` and keep the fieldset disabled while `me` is null.

## app/(protected)/parties/address-editor.tsx

- [M] :159-169 — raw `<input type="radio">` with `accent-[var(--color-primary)]`. §1 r3/r5, §4.1. Fix: `RadioGroup` spanning all cards.

## app/(protected)/parties/quick-create-dialog.tsx

- [L] :97-105 — fetches `/api/auth/me` directly for `userId` instead of a shared `useMe()`. §4 r2. Fix: add `userId` to `useMe()`.

## app/(protected)/parties/contact-dialog.tsx

- No findings (size lg for a ~10-field form — see KIT GAPS #1).

## app/(protected)/parties/contacts/page.tsx, contacts/[id]/page.tsx, individual-conflict-dialog.tsx

- `contacts/[id]`: only the Systemic role-bypass and "Confirm delete" issues apply; otherwise the reference implementation (breadcrumb, skeleton/failed/not-found branches, per-action gating).
- `contacts/page.tsx` (phone-only; desktop redirects) and `individual-conflict-dialog.tsx`: no findings.

## app/(protected)/parties/companies/new/page.tsx [HELD]

- [M] [HELD] :643-665,673-698 — Account kind / Person mode are custom `<button role="radio">` groups. §1 r3, §4.1. Fix: `radio-group.tsx` or `Select` for 2 options.
- [M] [HELD] :~1007 — Cancel `router.push`es away from a filled Step 1 with no warning (Systemic unsaved-changes gap).

## app/(protected)/parties/companies/[id]/page.tsx [HELD]

- [L] [HELD] :818-827 — Active/Inactive badge borrows the USER_STATUS vocabulary. §2.4 (map defined once per meaning). Fix: add a COMPANY_STATUS entry to `status-badge.tsx`.
- Delete/Make-inactive dialog, PeopleCard permission wrappers, breadcrumb are conformant. Last ~130 lines (AddPersonDialog tail) not reviewed line-by-line.

## app/(protected)/parties/companies/[id]/edit/page.tsx (phone-only)

- [M] :123-125 — validation error sets `setErrors({form})` AND fires a toast. §7.1 (never a toast for a field error). Fix: drop the toast; attach GSTIN/pincode errors to their own fields.
- [L] :283 — returns null while the desktop redirect runs — blank frame. §14 r1. Fix: render a skeleton or redirect server-side via `redirectOnDesktop`.

## app/(protected)/deals/page.tsx

- [M] :541-578 — hand-built List/Board switcher (Systemic). Fix: port `view-switcher.tsx`.
- [M] :670-672,686 — `canCreate` falls back to `deals.create ?? deals.edit`; if create is absent and edit is true the button enables but `POST /api/deals` (checks `deals.create`) refuses it — UI gates on the wrong action. §26 r3; CLAUDE.md UI/API action parity rule. Fix: `me ? Boolean(me.permissions?.deals?.create) : undefined`.
- [L] :1061-1063 — empty-state Create action is hidden rather than disabled+tooltip for users who cannot create. §26 (individual action → disabled+reason, not hidden). Fix: pass `actionDisabledReason` to `EmptyState` as `parties/page.tsx:893` already does.

## app/(protected)/deals/new/page.tsx [HELD] (phone-only)

- [M] [HELD] :176-177 — extra borderless "← Back" text button duplicating the app bar's own `back: '/deals'` (:67). §6.1 r5, §41.4, §23. Fix: delete it.

## app/(protected)/deals/[id]/page.tsx, deal-dialog.tsx

- No findings of substance.

## components/deals/*

- [L] follow-ups-section.tsx:732-739,773 — Cancel/"Not now" are plain onClick `Button`s, not `DialogClose`, unlike siblings. §4 r2. Fix: `<DialogClose render={<Button variant="secondary">…</Button>} />`.
- [L] deal-status.tsx:~440 — Won/Lost close confirmation is a plain `Dialog` (Escape/backdrop close an irreversible action) — see Systemic and KIT GAPS #2.
- [L] deal-meetings-section.tsx — returns null for loading/failed/empty; a failed load is invisible. §14 r3. Fix: show a one-line failed state with Retry.

## components/sharing/*

- `shared-with-card.tsx`: no findings — server-decided `canShare`, `PermissionTooltip` used correctly, Undo on remove, skeleton/failed-with-Retry states.

## app/(protected)/orders/page.tsx (desktop list + drawer)

- [H] :148-161 — `OrderDetailDrawer` is a hand-rolled fixed-backdrop/fixed-panel sheet, not `sheet.tsx`/`dialog.tsx` (Systemic). No Escape, no focus trap/return. §4 r3, §24, §39.3.
- [H] :158-160 — close button is a raw `<svg>` X with no sr label. §23, §6.3. Fix: `Button variant="ghost" size="icon"` + `XIcon` + `sr-only` label.
- [M] :180-182,479-489 — Direct/Meeting badge hardcodes `bg-chart-1`/`bg-chart-2` in two separate places instead of one shared badge variant. §4 r2, §21 (chart tokens misused for a non-chart badge).
- [M] :459-466 — Draft "blocked reason" uses native `title=`. §1 r5, §19. Fix: `tooltip.tsx`.
- [M] :491-500 — dedicated "View" button column instead of row-opens-record; the entity-name cell (:396-402) is plain text, not even a link — no keyboard/open-in-new-tab path. §11.1.2. Fix: `TableRowLink` on the entity cell, whole row clickable, drop the redundant View button (keep ⋮ only for extra actions).
- [L] :217-236 — status picker uses hardcoded `w-40` instead of a field-width token. §17.

## app/(protected)/orders/new/page.tsx [HELD] (phone-only)

- [HELD][L] :302-304 — Remove-line icon button has `aria-label` but no hover tooltip (§6.3); likely moot since tooltips don't open on phone (§19) — flagged for completeness only.
- Otherwise compliant: `PhoneForm`/`PickerSheetField`/`PermissionTooltip` with correct "not known yet" handling.

## app/(protected)/orders/[id]/page.tsx

- Phone-only (desktop redirects to the drawer); compliant (RecordSummary, StatusBadge, ⋮ DropdownMenu). No findings.

## app/(protected)/expenses/page.tsx, expenses/new/page.tsx [HELD], expenses/[id]/page.tsx

- All phone-only (desktop redirects to `/daily-activity`) — out of this slice's desktop scope, but noting:
- [HELD][M] expenses/new/page.tsx:127-133 — "← Back" uses a literal "←" glyph instead of Lucide `chevron-left`. §23.1.
- [L] expenses/new/page.tsx:149-158,162-168 — Amount/Date inputs use `style={{fontSize:16}}` inline to dodge iOS zoom. §1 r2 (inline typography styles forbidden outside the documented exception). Fix: a Tailwind type-scale class via the `cn()` extension instead of inline style.

## app/(protected)/conversations/page.tsx

- Compliant: deliberate (and justified) departure from row-opens-record for threads vs. source records, real `next/link`s, declared column tiers, searchable filter.
- [L] :276 — `ExternalLinkIcon` used for an internal "Source" link that opens in the same tab; that icon is reserved for links to another website (§6.6 r3). §23.1 one-meaning-one-icon.

## app/(protected)/search/page.tsx

- Compliant: Suspense boundary, `EmptyState` variants, `Skeleton`, abort/stale-response handling, `PaginationBar`.
- [L] :68 — page wraps itself in its own `max-w-[1600px]` container duplicating the shell's content-area cap (§12.3). §4 r2. Fix: rely on the shell's existing width cap.

## app/(protected)/points/page.tsx

- [H] :14-22,99,159,189,223 — emoji as icons throughout (Systemic). Fix: map each `action_type`/rank to a Lucide icon (see KIT GAPS #3 for rank-medal colour).
- [H] :99-112,121,195-196,217-222 — pervasive hardcoded Tailwind colours (gradient, gray-*, green-500, medal colours) (Systemic). §1 r1, §2.
- [M] :105-112 — period selector is a hand-rolled button group, not `tabs.tsx`/`section-tabs.tsx`. §4 r2, §33.
- [M] :143-150 — Activity/Breakdown/Leaderboard switch is a second, differently-styled tab bar on the same screen as the period control — two non-identical tab widgets on one page. §33.3.
- [M] — the page has no page-title/template structure matching any of the kit's six page shapes (closest to a dashboard, §11.4, but mixes a KPI row with undeclared tab panels). Worth classifying before more ad hoc styling accrues.
- [L] :99 — trophy emoji sits inside a token-based `bg-warning-bg` chip, mixing token background with non-token emoji foreground.

## app/(protected)/profile/page.tsx

- Compliant: `Card`/`CardHeader`/`CardTitle`, `Label` with required asterisk, `PasswordInput` (the one password field, §32), `InlineFieldError` (never a toast, §7.1), `Banner` for form-level failure, correct focus/remount (`formKey`) hiding a revealed password after save. No findings.

## app/(protected)/page.tsx — Dashboard

- [H] :646-663 — "Reject Plan" modal is a hand-rolled `fixed inset-0` overlay, not `alert-dialog.tsx` (Systemic). This is exactly the destructive/must-act case the kit built alert-dialog for. §1 r3, §15, §24.
- [H] :650-652 — reject-reason `<textarea>` is raw HTML, not `components/ui/textarea.tsx`; ad hoc `focus:ring-2 focus:ring-danger` instead of token-driven invalid state.
- [H] :385-396,487-497,605-611 — Recharts styling and status-segment colours are hardcoded hex instead of chart-colour tokens (FRONTEND_RULES_VIEWS.md §21) and instead of `bar-chart.tsx`/CategoryBarChart, the kit's one Recharts wrapper. §4.1.
- [H] :330-340 — week-nav chevrons are raw inline `<svg>` paths, not Lucide `ChevronLeftIcon`/`ChevronRightIcon`. §23.
- [M] :97-112 — `PlanBadge` implements its own status→colour map (`bg-purple-100 text-purple-700` for "Edited by Manager" — purple has no defined status meaning) duplicating `components/status-badge.tsx` instead of extending it. §4 r2/r4, §2.4 closed set. See KIT GAPS #2.
- [M] :455-462,444-451 — Approve/Reject/Accept/Decline are raw `<button>`s with inline Tailwind (`bg-green-600 hover:bg-green-700`) instead of `button.tsx` variants. §6.1/§6.2.
- [M] :548-634 — Team Performance table is a raw `<table>`, not `components/ui/table.tsx` — no sticky-header band, no col-* width tokens; sort chevrons are unicode `↕ ↑ ↓` not Lucide icons (row click-to-open is correctly implemented). §17.1, §36, §23.
- [M] :264-276 — three shortcut "cards" use `onClick` on a bare `<div>` with `cursor-pointer` — not keyboard-reachable, no focus ring. §39.1, §6.4. Fix: `next/link` cards or a real `<button>`.
- [L] :1-10 — no breadcrumb; "Dashboard"/greeting heading uses ad hoc `text-xl` rather than the 30px/500 page-title token. §3.
- [L] :35-40 — `greeting()` reads `new Date().getHours()` client-side — fine (not the server business-date rule), flagged only to confirm it is never reused server-side.

## app/(protected)/error.tsx

- Compliant: `EmptyState` "failed" variant, no raw error text/stack shown, logs to console only. §7.2 r3. No findings.

## components/orders, components/conversations, components/meeting, components/import, components/journal

- Grepped for native dialogs (`confirm()`/`alert()`), raw hex colours, and raw grey/status Tailwind classes across all five directories — zero matches. Not full-read line-by-line; a follow-up pass is recommended if these are in active development (unverified: field widths, column tiers, tooltip usage).

## KIT GAPS (for owner review only — not proposals to edit the kit)

1. §24 ties `lg` (800px) to "tabs or a table." There is no bucket for a long, single-step, two-column form such as `contact-dialog` (~10 fields); `md` is too narrow and `lg` is off-label.
2. §15/§24 do not say which primitive handles an irreversible confirmation that must also collect input (Won/Lost needs a reason + stage; Reject Plan needs a reason). `alert-dialog.tsx` has no form body, and `dialog.tsx` closes on Escape/backdrop.
3. §13 has no carve-out for an optional sub-section that would be noise on most records (deal meetings) — unclear whether "render nothing when empty" is allowed, and what the failed branch should then do.
4. §11.3 rule 3 (red asterisk) covers hard validation only; there is no convention for a field optional to save but required later by a business rule (GSTIN/pincode needed before an order leaves Draft).
5. No segmented-control component exists for a binary choice (Company/Individual was reinvented 3 times in this slice); the kit offers `radio-group`/`select` but the owner should decide which is canonical.
6. No token exists for a "gold/silver/bronze" leaderboard rank badge (`points/page.tsx`); §2.4's closed status set and §21's chart colours don't cover gamification UI.
7. `weekly_plans.status`'s workflow has 7 statuses (plus 13 audit action types per CLAUDE.md) but the kit's status-colour set is 4 buckets (success/warning/danger/neutral) — unclear how "Edited by Manager"/"Resubmitted" should map, if at all.
8. §33 assumes one tab bar per screen; `points/page.tsx` wants both a period toggle and a section switch — the kit has no distinct "period toggle" component separate from `inline-choice.tsx` or `date-picker.tsx`'s range presets.
</content_truncated_for_brevity_omitted>
