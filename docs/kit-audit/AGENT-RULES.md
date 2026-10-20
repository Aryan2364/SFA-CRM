# Rules for every kit-conformance agent

1. **The kit is the authority and is read-only:** `D:\RGB_Software\kits\frontend-kit`. Read `FRONTEND_RULES.md`
   completely before editing (plus `_VIEWS`, `_ACCESS`, `_PHONE` when your screens need them). Use
   `components/ui`, `components/templates`, `app/kitchen-sink/page.tsx` as the reference for how things look.
   Never edit anything under the kit. If the kit is silent or seems wrong, do not invent: follow the
   nearest kit rule, and append to `docs/kit-audit/kit-gaps.md`:
   `- [area] problem — kit file/section — what the app did meanwhile`.
2. **Project rules:** read `D:\RGB_Software\SFACRM\CLAUDE.md`. Permissions come from the real permission
   system (`/api/auth/me` + existing client helpers; server `checkPermission`/`getDataScope`) — never a
   hard-coded role name. UI gates each control on the exact action its API route checks. Whole area with
   no access → hidden; individual action not allowed → shown disabled inside `PermissionTooltip` with a
   "who may do it" reason; not known yet → disabled with no reason (`allowed={undefined}`).
3. **Concurrency — other sessions edit this tree at the same time.** At start run `git status --short`.
   A modified/untracked file is **held** unless it is listed in `docs/kit-audit/changes.md` (ours).
   Never edit a held file; re-check `git status` before editing each file and skip it if someone else
   has started on it. The phone session (sfacrm-15) owns: `src/components/shell/phone-*`,
   `src/components/ui/{phone-list,phone-form,picker-sheet,bottom-sheet,action-bar,record-summary,contact-actions,photo-capture,connection-banner}.tsx`,
   `src/lib/layout*.ts`, `src/lib/use-keyboard-inset.ts`, `(protected)/layout.tsx`, `today`, `more`,
   `expenses/**`, `daily-activity/new`, `deals/new`, `deals/page.tsx`, `deals/[id]/**`, `orders/new`,
   `orders/page.tsx`, `orders/[id]`, `parties/new`, `parties/page.tsx`, `parties/contacts/**`,
   `parties/companies/**`, `weekly-plan/page.tsx`, `weekly-plan/phone-weekly-plan.tsx` — skip all of these.
4. **Only the foundation agent edits `src/components/ui/*`, `src/components/shell/*` (non-phone),
   `src/app/globals.css` and shared `src/lib/*`.** Page agents use components as they are. If a page needs
   something a shared component lacks, log it in `changes.md` under "Needs from foundation" and do the
   closest kit-correct thing without editing the component.
5. Never `git add`/`commit`/`checkout`/`reset`/`stash`/`restore`. Never revert a file to HEAD. No backup copies.
6. Verify with `npx tsc --noEmit -p .` (must end clean — if it fails only in files you don't own, note it
   and move on) and `npx eslint <your files>`. Do not run `next build` or start/stop a dev server.
7. Behaviour must not regress: keep every feature, API call, validation and permission gate working.
   This is a conformance pass, not a redesign — no new product features.
8. **Log** every file you change in `docs/kit-audit/changes.md` under your wave heading, one line + why,
   plus what you skipped (held / too risky) so a later pass can finish it.
