# Kit conformance — summary for review (2026-10-16)

Authority: `D:\RGB_Software\kits\frontend-kit`, which was not modified. Full per-file log: `changes.md`. Kit problems for
your review: `kit-gaps.md` (32 entries). Audits: `foundation.md`, `records-pages.md`, `admin-pages.md`, `phone.md`.

**Nothing is committed.** The phone session (sfacrm-15) worked in the same tree, and its phone files now depend
on the synced `ui/*` (e.g. `sheet.tsx`). Committing one side alone leaves HEAD not building, so **one combined
commit** is the simplest option. `npx tsc --noEmit` is clean on the whole tree.

## What changed
- **Foundation:**
  - `globals.css` is a full sync of the kit's file. The brand block and the product rules still in use are kept.
  - It fixes utilities that Tailwind v4 had been silently dropping: the whole `phone:` variant, the safe-area and
    keyboard-inset spacing (phone sheets had been opening off-screen), and the phone type scale, which never applied.
  - 32 `src/components/ui` files are byte-identical to the kit.
  - New from the kit: header-band, text-link, choice-row, view-switcher, inline-choice, multi-select,
    unsaved-changes, otp-field, repeating-rows, draft-banner, and lib/drafts, keyboard and banner-dismissals.
  - Legacy components deleted: Header, Sidebar, CrudPage, useCrud, Toggle, Modal, SearchableSelect.
- **Masters:**
  - All 19 run on the kit list-page template, through the shared `MasterNamePage` or bespoke ListPage pages.
  - Drag/keyboard reorder kept via `reorderable-rows.tsx`. Persistence was re-verified against the API.
- **Admin, planning and auth:**
  - Login, reset and superadmin use the kit password-input. Confirm-password was removed (§32.3).
  - Hand-rolled modals became kit Dialog/AlertDialog.
  - Superadmin was re-themed to tokens, and its tabs became section-tabs.
  - Review tables use the kit table (§34).
  - The old CalendarPicker and StatusBadge were replaced on the weekly-plan and review screens.
  - Unsaved-changes guards were added to three dialogs.
- **Records:**
  - Dashboard: the reject dialog, chart tokens and table now come from the kit.
  - Points: emoji became Lucide icons, the colours became tokens, and both tab bars became kit tabs.
  - The order detail panel is a kit Sheet.
  - The deals create permission is now the tri-state `deals.create`.
  - The weekly-plan dialogs are kit Dialogs.
  - The accounts list moved off the legacy Modal and SearchableSelect.
- **Verified:**
  - tsc and eslint pass on every wave.
  - A regression review against HEAD found and fixed one issue: the Access Control `is_system` swap.
  - The headless-Chrome pass ran at desktop and phone widths: 0 failed requests, no render loops, phone tabs
    navigate, and dialogs open in the viewport.

## Your decisions (see kit-gaps.md)
1. "Today" replaces the kit's "My work" (§41.15). Record it as a plan exception, or change it.
2. Access Control screens vs the kit's §40.1 four-tab structure.
3. The role name 'Administrator' is still compared in the UI because the server short-circuits on it (§26). The fix
   belongs on the server.
4. Kit gaps worth fixing in the kit:
   - The list page has no reorder.
   - EmptyState lost `actionDisabledReason`.
   - Dialog has no `preventDismiss`.
   - The view-switcher can't omit "Card" and stores its choice in localStorage, not the URL.
   - There are no avatar or rank-badge tokens and no segmented control.
   - React 18 vs the kit's React 19 ref-as-prop patterns needed casts.
   - The kit's sheet depends on app-bar and lib/back, which isn't documented.

## Still open
- A React "setState while rendering another component" warning was seen once on /masters/products and
  /masters/users. It could not be reproduced on investigation. It needs the React stack trace.
- Dark mode is not built (kit §28: "structured for, not built"), so pages stay light.
- Done 2026-10-17 (waves 8A–8C, browser-checked):
  - The Company/Individual and person-mode choices are shared components on the kit radio-group/choice-row.
  - profile is conformant: an unsaved-changes guard and the field-max width.
  - comment-box, approval-select, notification-permission-sheet, keyboard-shortcuts, content-area and
    progress-bar are ported. RemarksPanel's composer now uses CommentBox.
  - Two bugs were fixed: the parties/new render-time redirect (an SSR crash) and React 18's `inert` warning in
    comment-box.
- Product follow-ups, not built:
  - Wire KeyboardShortcuts and ProgressProvider into the layout.
  - Phone select-mode approvals with approval-select.
  - A push backend for the notification sheet.
  - The §41.18 two-row phone settings layout.
  - The plan-review main dialog's unsaved guard.
- A Base UI "expected a native <button>" warning appears on the account detail page's actions menu. It was there
  before this work.
- Phone findings in `phone.md` were handed to the phone session. phone-list scroll-restore and pull-to-refresh
  watch `window`, but the page scrolls inside `<main>`.
