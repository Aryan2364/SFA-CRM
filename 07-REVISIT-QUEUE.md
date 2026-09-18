# 07 — Revisit Queue

Areas deferred because they were in flux while this plan was written. A deferred area is a
**known** gap; a skipped area is an **unknown** one. Only the first is acceptable.

Worked in passes. Anything still unsettled at the end of the run is promoted to
`09-OPEN-QUESTIONS.md` as **"not studied — still in flux at end of run"**, with a statement of
what is therefore unplanned.

---

## Baseline stamps — what "moving" means tonight

| Reading | Time | Value |
|---|---|---|
| Run start | 18 Sep 2026 00:35 | HEAD `6e2cec6` |
| Stamp 1 | 00:49:05 | HEAD `ecc8614` |
| Stamp 2 | **00:59:31** | HEAD **`221f47e`** |
| `prisma/schema.prisma` sha256 (first 16) | 00:59:31 | `d17eee95ad2cc9b2` |
| `prisma/schema.prisma` **mtime** | 00:59:31 | **2026-09-15 10:35:55** — three days old |

### Finding that shapes this whole queue

**The concurrent agent is not editing `prisma/schema.prisma`.** Its mtime is three days old and
its hash was stable across the run. Every commit observed tonight touched **frontend files only**:

```
6e2cec6 00:41:20  Put conversations on list-page
d07462b 00:46:24  Put leads on list-page               src/app/(protected)/leads/page.tsx, status-badge.tsx
8dfb88e 00:48:38  Give weekly-plan statuses words…     src/app/(protected)/review/page.tsx, status-badge.tsx
ecc8614 00:49:04  (follow-up)
03ae275 00:51:42  Give weekly-plan statuses words…
e53d43a 00:51:42  Put review on list-page
51f4dc0 00:51:42  Put users on list-page
221f47e 00:57:58  Say why the breadcrumb is there…
```

That matches `overnight-queue-2026-09-18.md`'s declared scope exactly: **leads, weekly-plan,
masters/users, review, conversations**, with `orders` as the worked example. As of 00:57 all five
appear to have landed.

**The caveat that matters.** `prisma/schema.prisma` is *generated* by `prisma db pull`. A
migration running directly against the **live database** would change nothing in this file. So:

- **What I can assert:** the schema *file* did not move tonight.
- **What I cannot assert:** that the live database still matches it. The file is a **3-day-old
  snapshot** (15 Sep 10:35).
- I could not refresh it — `prisma db pull` is a write-class command and is barred under the
  read-only constraint, as is any DB query.

⇒ **Every table shape in `02-DATA-MODEL-PLAN.md` is provisional and must be re-verified against
the live database before Phase 1 begins.** This is the reason for the mandatory pre-flight step
at the top of `08-EXECUTION-SEQUENCE.md`.

---

## Queue

### R1 — Leads page frontend · DEFERRED → **SETTLED**
- **What:** `src/app/(protected)/leads/page.tsx`, the Phase 1 critical file.
- **Seen:** rewritten at 00:46:24 by commit `d07462b` (+544 lines) onto the shared
  `list-page` template, together with `src/components/status-badge.tsx` (+134).
- **Why deferred:** read in progress by Agent C while the file was being replaced; line-level
  findings would have been stale on arrival.
- **Resolution:** Agent C re-anchored onto the *structural* description (which `list-page` props
  the screen passes) rather than line numbers. Settled as of `221f47e`; no further commits to
  this file after 00:46.
- **Residual risk:** low. Re-confirm at pre-flight with `git log -- "src/app/(protected)/leads/page.tsx"`.

### R2 — Weekly-plan and Review pages · DEFERRED → **SETTLED**
- **What:** `src/app/(protected)/weekly-plan/*`, `src/app/(protected)/review/page.tsx`.
- **Seen:** touched three times between 00:48 and 00:51 (`8dfb88e`, `03ae275`, `e53d43a`).
- **Why deferred:** in the conversion run's active scope; frontend readings would be stale.
- **Resolution:** Agent F redirected onto backend/database findings for these areas, which the
  churn cannot affect. Frontend detail for both is **provisional**.
- **Residual risk:** medium *for Phase 3/4 screen tasks only*. Re-read both page files at the
  start of Phase 3. Does not block Phase 1 or 2.

### R3 — `masters/users` page · DEFERRED → **SETTLED**
- **What:** `src/app/(protected)/masters/users/page.tsx` — the Employee Master UI, where the
  Manager relationship is set. Phase 4's access filter depends on it.
- **Seen:** modified in the working tree at 00:49, committed at 00:51:42 (`51f4dc0`).
- **Why deferred:** dirty working tree mid-read.
- **Resolution:** Agent D's findings are about the **API and the `user_visibility` cascade**, not
  the page, so they survive. The page's *form field list* is provisional.
- **Residual risk:** low. Phase 4 touches the filter, not this form.

### R4 — Live database vs `prisma/schema.prisma` · **OPEN — CANNOT BE SETTLED IN THIS RUN**
- **What:** whether the live DB still matches the 15 Sep schema snapshot.
- **Why deferred:** every means of checking (`prisma db pull`, any query, `npm run smoke`) is
  barred by the read-only constraint. Aryan reports a data migration in progress.
- **Cannot be resolved tonight.** Promoted to `09-OPEN-QUESTIONS.md`.
- **What is therefore unplanned:** nothing is unplanned, but **every column list in
  `02-DATA-MODEL-PLAN.md` carries a re-verify flag**, and Phase 1 must not start until the
  pre-flight step in `08-EXECUTION-SEQUENCE.md` confirms the match.

### R5 — `src/components/status-badge.tsx` · DEFERRED → **SETTLED**
- **What:** the shared status vocabulary. Phase 1 (Party Incomplete), Phase 2 (Deal Stage,
  Order Draft/Placed) and Phase 3 (meeting flags) all need new badges here.
- **Seen:** rewritten **twice** tonight — `d07462b` (+134) and `8dfb88e` (+110).
- **Why deferred:** two rewrites inside four minutes.
- **Resolution:** stable since 00:48. Agent B documents the final shape.
- **Residual risk:** low, but this file is the single highest-traffic shared file in the rebuild
  — re-read it before the first badge is added.

### R6 — Whether a DB-level migration is running at all · **OPEN — UNRESOLVED CONFLICT**
- **What:** Aryan states a data migration is running with write access across the software. The
  observable evidence is a **frontend list-page conversion run**, and a schema file untouched for
  three days.
- **Two readings, both recorded, neither chosen:**
  1. The "migration" Aryan means **is** the rgb-kit/list-page conversion run
     (`overnight-queue-2026-09-18.md`), which is frontend-only. Evidence: every commit tonight.
  2. A **separate** DB-level migration is running that leaves no trace in git. Evidence: Aryan's
     own statement. Invisible to a read-only inspection.
- **Why it matters:** under reading 1, Phase 1 may start on the schema as documented. Under
  reading 2, the Leads tables may have changed and Phase 1 would collide with in-flight writes.
- **Promoted to `09-OPEN-QUESTIONS.md`.** The pre-flight step covers both readings safely.

---

## Final pass — 18 Sep 2026 01:17 IST

**Repo state:** HEAD `221f47e`, unchanged since **00:57:58 — 20 minutes of no commits**.
`prisma/schema.prisma` hash `d17eee95ad2cc9b2`, **identical to the 00:59 reading**.

**Decisive new evidence: the other run published its own report** at
`overnight-report-2026-09-18.md`, opening with *"Why this run ended: scope complete."* It states:

| Screen | Before → After | Commit | Status |
|---|---|---|---|
| `leads` | 333 → 755 | `d07462b`, `03ae275` | converted |
| `conversations` | 243 → 354 | `6e2cec6` | converted |
| `masters/users` | 556 → 843 | `51f4dc0`, `221f47e` | converted |
| `review` | 169 → 293 | `e53d43a`, `03ae275` | converted |
| **`weekly-plan`** | 740 → 740 | — | **deliberately NOT converted** |

And: *"`list-page.tsx`, `src/app/globals.css`, `src/components/shell/*` and
`(protected)/layout.tsx` are **byte-identical to run start**."*

**Two consequences that changed the plans:**
1. **`weekly-plan` is unconverted and is a §30 "still to be decided" item** — it matches no
   AGENTS.md §11 template, and §31 was considered and explicitly rejected. `05-PHASE-3-PLAN.md`
   P3-T3 was rewritten: **do not put it on `list-page`**, and raise the pattern gate early. This
   is a **third** §30 gate alongside the Kanban and the report table.
2. **11 `// OVERNIGHT:` workaround markers** were left in the converted screens (9 `leads`,
   1 `masters/users`, 1 `review`). Added to `08-EXECUTION-SEQUENCE.md` as a task-zero chore.

| Item | Status at end of run |
|---|---|
| R1 Leads page | **SETTLED** — converted, `d07462b`; no commits for 20 min |
| R2 Weekly-plan / Review | **SETTLED** — `review` converted; **`weekly-plan` confirmed untouched** and re-planned |
| R3 masters/users page | **SETTLED** — converted, `51f4dc0`/`221f47e` |
| R4 Live DB vs schema file | **OPEN** → `09-OPEN-QUESTIONS.md` E2. Unknowable read-only; covered by the pre-flight |
| R5 status-badge.tsx | **SETTLED** — stable since 00:51 |
| R6 Is a DB migration running | **OPEN** → `09-OPEN-QUESTIONS.md` E1. The frontend run is now *provably* finished, so **if a DB migration is also running it is a separate process**, and the pre-flight is the only way to know |

**Nothing is left in the queue as "still in flux".** The two open items are open because they are
**unanswerable without live database access**, not because they were skipped.

## R-14 — a malformed UUID reaches `POST /api/deals` as a bare 500

Found 18 Sep while verifying the board. A `company_id` carrying a stray `\r` produced
**HTTP 500 with an empty body** — no `{"error":…}` at all, so the client has nothing to show and
the toast has nothing to say. The route validates `name` and `probability` but passes ids straight
to Prisma, and `dbErrorMessage()` evidently returns nothing for that error class.

A bad id is a 400 with a sentence, not a 500 with silence. Likely the same in every route that
accepts an id in a body. Low severity, wide surface — worth one sweep rather than one fix.

## R-15 — two review routes deny a user their own data · **RESOLVED 18 Sep (P3-T5)**

Found 18 Sep by the orchestrator session, while the build fleet was down. Reproduced against
`sfacrm_local` on :3010 as **Amit Kulkarni** (`9000000102`, role *Sales Executive*, scope `own`),
asking for **his own** `userId` on `2026-09-17`:

| Route | Gate | Result |
|---|---|---|
| `GET /api/review/daily-activity` | `canView()` | **403** |
| `GET /api/review/expenses` | `canView()` | **403** |
| `GET /api/review/daily-summary` | `scopedUserIds` + `intersectScope` | **200** |

**Root cause, confirmed in the database:** `user_visibility` holds **8 rows and zero self rows**
(`select count(*) where viewer_user_id = target_user_id` → `0`). `canView()` is a bare existence
check on that table, so `canView(me, me)` is **false for every user in the system**. Any route
gating on it denies a user their own data unless the caller remembers an `ownerId === user.userId`
special case — and neither of these two routes does.

`canView()` also ignores `role_permissions.data_scope` entirely, so it is wrong in the other
direction too: a Self-scoped role sitting above someone in the hierarchy still reads downward.
Both failure modes are already written up in `src/app/api/remarks/_access.ts`, which chose
`scopedUserIds` + `intersectScope` for exactly these reasons, as did `daily-summary`.

**`expenses` is new.** The handoff flagged `daily-activity` versus `daily-summary` as "two routes
on the same page disagreeing". It is three routes, and `expenses` was not previously reported.

**Not fixed here, deliberately.** P3-T5 reworks Daily Activity (1685 lines) and owns these files;
a blind swap of the gate would collide with that task and change who can read what on a screen
nobody is currently looking at. The decision belongs with whoever takes P3-T5, and it should be
made deliberately rather than inherited from whichever helper the route happens to call.

⚠️ Do **not** "fix" this by adding self rows to `user_visibility`. That table is the manager
closure; seeding it with self rows would silently widen every other `canView()` caller, including
the nine weekly-plan routes that gate transitions on it.

### R-15 resolution

Fixed by P3-T5, which owns these files. Both `daily-activity` and `expenses` now gate on
`checkPermission` + `scopedUserIds`/`intersectScope` — the composition `daily-summary`,
`remarks/_access.ts` and Weekly Review already used. Verified: the executive reads his own day
at 200 on all three routes, is still refused a peer at 403 on both, and the manager still reads
downward at 200. The fix opened self-view **without** widening peer access, which was the risk.

Rejected alternative: a `userId === user.userId` special case. It clears the 403 and leaves
`canView()`'s blindness to `data_scope` in place, so the next caller repeats the bug.

`user_visibility` was not touched, as warned.
