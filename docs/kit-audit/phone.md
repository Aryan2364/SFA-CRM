# Phone layout audit vs RGB frontend kit (FRONTEND_RULES_PHONE.md §41)

Audited read-only. Most phone files are currently `M` in git status (being edited by other
agents) — marked [HELD] below; apply after those agents finish. Kit: `D:\RGB_Software\kits\frontend-kit`.

## Systemic

1. **This is an explicitly reduced/"deliberately simplified" port of the kit**, documented in the
   files' own comments (phone-shell.tsx, phone-list.tsx, action-bar.tsx). Missing vs §41: no
   BandScope/header-band nesting (§41.4.1), no PageHeader/first-paint contract (§41.4 rule 23), no
   filter/sort bottom sheets or select-mode approvals on lists (§41.5 rules 18-19, §41.6 rules
   14-19), no form drafts (§41.7 rules 12-15), no searchable-select full-height-on-open guarantee
   beyond what's built, no offline/connection install flow (§41.14), no Notifications screen
   (§41.12), no Personal settings screens beyond a bare Profile link (§41.18). This is a known,
   reported gap, not something this audit is discovering fresh — but it means most of §41's
   "checks before done" (§41.20) have not been run at all.
2. **"My work" is renamed/replaced by "Today"** (`src/app/(protected)/today/page.tsx`,
   `src/app/(protected)/layout.tsx` line 67 comment, `docs/phone-plan.md`) — an explicit owner
   decision, documented in code and presumably in plan.md. §41.15 rule 1 requires the first tab to
   be My work, built on the phone list (25/200, filter chips by kind, counts). Today is a bespoke
   dashboard-shaped screen (check-in, "waiting on you", meetings, follow-ups), not that list. Since
   this is a recorded decision rather than an oversight, flagged as a KIT GAP item for owner
   confirmation, not a plain bug.
3. **No Notifications screen or phone push** at all (§41.12). More has no "Notification choices".
   If the product has no notification concept yet this may be fine, but it should be recorded in
   plan.md's phone screen groups (§41.1 rule 1) either way — no evidence it is.
4. **No search action anywhere in the phone app bar** (§41.4 rule 5) and no full-screen search page
   — Ctrl+K equivalent is simply absent on phone.
5. **Personal settings (§41.18)** collapsed into one "Profile" row in More with no Password /
   Notification-choices split, and no per-screen Save-in-action-bar contract to check.

## Per-file findings

- [sev M] `src/app/(protected)/layout.tsx:71-72` [HELD] — every phone screen below a tab root falls back to the *tab's* label as its page title (no PageHeader-style per-page title plumbing beyond `usePhoneAppBar`), and the comment admits this; a screen that forgets to call `usePhoneAppBar` silently shows the wrong title. — kit §41.4 rule 23 — give every non-tab-root route a lint/type-level nudge (or server-rendered PageHeader) to call `usePhoneAppBar`, not just convention.
- [sev M] `src/components/shell/phone-tabs.ts:30-61` [HELD] — first tab is "Today" (href `/today`), not "My work"; also no count badge requirement wired for it the way §41.15 rule 8 describes (My work's own badge, refreshed after every action). `phone-tab-badges.ts` wasn't read in this pass — verify it refreshes Today's count after approve/reject the way rule 8 requires. — kit §41.15 rule 1/8 — confirm in plan.md as an agreed exception, or rename/rebuild as My work.
- [sev L] `src/components/shell/phone-app-bar.tsx:38-46` [HELD] — `PhoneAppBarConfig` has no `search` slot and no way to register the one-of-two-actions-is-search affordance from §41.4 rule 5 for tab-root screens. — §41.4 rule 5 — add if/when search ships; otherwise note as known gap.
- [sev L] `src/components/shell/phone-shell.tsx:118-134` [HELD] — app bar renders at most `resolvedActions` + `resolvedMenu` with no enforced cap; nothing stops a page passing 3+ action nodes (unlike ActionBar's explicit throw at >2). — §41.4 rule 4 (≤2 icon buttons) — add the same runtime guard `action-bar.tsx` has.
- [sev L] `src/components/shell/phone-shell.tsx:84-91` [HELD] — back-target fallback logic (`PHONE_TABS.find(tab => pathname.startsWith(...))`) only resolves one level of nesting; a screen two levels below a tab root with no explicit `usePhoneAppBar({back})` falls back to `/today` rather than its real parent. Low risk since most screens do set `back` explicitly — worth a grep to confirm all non-tab-root pages call `usePhoneAppBar`.
- [sev M] `src/components/ui/phone-list.tsx:18-25` header comment and code — filter/sort bottom sheets, status-chip board view, select-mode and pull-to-refresh's browser-default-disable are partly/fully missing (pull-to-refresh is implemented here at lines 445-501, good; but no `touch-action`/CSS disabling of the browser's own pull-to-refresh is set anywhere visible, so both could double-fire). — §41.5 rules 16, 18-21; §41.6 rules 14-19 — confirm `overscroll-behavior-y: contain` is set globally (check globals.css) so native PTR doesn't double with the custom one.
- [sev L] `src/components/ui/phone-list.tsx:137-163` — scroll-position restore reads `window.scrollY`/`window.scrollTo`, but the list's own scrolling container is `<main>` in phone-shell.tsx (`overflow-y-auto`), not the window — on a real device this restore likely does nothing today since the page itself doesn't scroll, `<main>` does. — §41.5 rule 17 — restore against the actual scrollable ancestor, not `window`.
- [sev M] `src/components/ui/phone-list.tsx:445-501` `usePullToRefresh` — attaches `touchstart`/`touchmove`/`touchend` to `rootRef` (the outer flex column), but that element isn't the scroll container either (`<main>` scrolls); `atTop()` checks `window.scrollY` which per the above is likely always 0 since the window doesn't scroll — pull-to-refresh may trigger on any downward swipe regardless of real scroll position. — §41.5 rule 16 — recheck against the real scroll container once the window-vs-main scroll question above is resolved; likely the same root cause.
- [sev L] `src/components/ui/action-bar.tsx:43-47` — good: explicit throw at >2 buttons enforces §41.6 rule 8. No fix needed, noted as a positive pattern other components should copy (see phone-shell finding above).
- [sev M] `src/components/ui/phone-form.tsx` — `usePhoneFormGuard` has no draft-persistence (no localStorage/sessionStorage save-as-you-type, no "You have an unsaved draft…" banner). — §41.7 rules 12-15 — not built; flag as known gap unless product scoped it out in plan.md.
- [sev L] `src/components/ui/phone-form.tsx:122-123` — `onDiscard` prop is accepted but explicitly unused (`void onDiscard`) with a comment telling the *caller* to wire the back button through `usePhoneFormGuard().requestLeave` itself — easy for a new form page to pass `onDiscard` expecting it to do something and have it silently no-op. — §41.7 rule 3 (unsaved-changes warning on Cancel/back) — verify each `*/new/page.tsx` actually wires its own back arrow through `requestLeave`; otherwise back can leave silently with unsaved changes.
- [sev L] `src/components/ui/picker-sheet.tsx:49` — sheet forces `h-[100dvh]` always (full height) even for a short static list (e.g. 4 stage options) — kit calls for full height specifically for *searchable* lists (§41.8 rule 8); a 4-option `StaticPickerSheetField` taking over the whole screen for "Won/Lost/Open" is heavier than needed, though not wrong per rule 8's "takes full height as a step inside a sheet too" allowance.
- [sev L] `src/components/ui/picker-sheet.tsx` — no "Create new" sheet-of-its-own transition (rule 9's "opens inside the same sheet... never a sheet on top of a sheet") is irrelevant here since Create just calls back via `onCreate` — fine, not a nested-sheet violation.
- [sev L] `src/app/(protected)/more/page.tsx:137-163` — the iPhone install sheet is a hand-rolled `fixed inset-0` div with `role="dialog"`, not built on the shared `sheet.tsx`/bottom-sheet primitive the rest of the app uses (no drag handle, no swipe-to-close, no focus trap via Radix). — kit §41.8 rules 1-5 — rebuild on `Sheet`/`SheetContent` like `picker-sheet.tsx` does, for consistent close behavior (Android back, swipe, focus).
- [sev L] `src/app/(protected)/more/page.tsx:92-102` — rows list has no "Notification choices" or "Password" entries (§41.18 rule 1) and no app-version-at-foot styling issue (that part is fine, line 135). — confirm with owner whether personal settings/notifications are deliberately out of scope for this phase.
- [sev L] `src/app/(protected)/more/page.tsx` — More doesn't render under its own `usePhoneAppBar` (no title override shown in the read excerpt) — likely relies on the tab-root fallback ("More") which is correct per rule, no action needed.
- [sev L] `src/app/(protected)/today/page.tsx:50-116` — multiple independent `fetch` calls on mount with no shared loading-state consolidation; not wrong, but each miss of `.ok` swallows errors into empty arrays with no error banner/retry surfaced to the user (e.g. attendance fetch failing is indistinguishable from "no attendance today"). — kit §6 "no dead ends" fallback — add a retry/error state at least for the most important section (approvals).
- [sev L] `tsconfig.json`, `src/lib/business-date.ts` — modified per git status but out of phone-UI scope; not reviewed here (business-date correctness is covered by project's own date rules, not kit §41).

## KIT GAPS (owner review only)

- The kit's §41.15 ties "My work" tightly to a specific list shape (phone-list-based, cross-module
  queue). This product's "Today" is a richer, more task-oriented home screen (check-in, meetings,
  follow-ups) that arguably serves the same intent better for a field-sales product than a flat
  approvals queue would. Worth deciding once whether §41.15 should gain a documented variant for
  "field rep" products, rather than re-auditing this gap every time.
- §41.5 rule 16 (disable the browser's native pull-to-refresh) and the custom PTR implementation
  assume a window-scrolling page; this codebase's shell scrolls `<main>` instead. The kit doesn't
  call this distinction out explicitly — worth adding a line to the kit about which element must be
  the scroll root when a product's shell differs from the kit's own app-shell.tsx.
- No guidance found in the kit on what "computer-only" means for a product with almost no
  computer-only screens yet (this product seems phone-only-first); confirm with owner whether
  `src/app/(protected)/parties/companies/[id]/edit/` (new, unreviewed here, `??` in git status) is
  meant to render on phone or is desktop-only and needs the §41.11 template.
