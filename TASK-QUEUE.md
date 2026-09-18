# Live Task Queue — SFA CRM Rebuild

Updated by the orchestrator as tasks move. **Status:** `QUEUED` → `RUNNING` → `REPORTED` →
`ACCEPTED` / `FAILED`. A task is ACCEPTED only when its report survives being read against the
code.

---

## Pre-build gates — ALL GREEN ✅

| Gate | Status |
|---|---|
| Planning deliverables written | ✅ 11 files, 3,310+ lines |
| sfacrm-11 change summary obtained | ✅ **Confirmed: no DB changes.** Range `3ca5a52..221f47e`, 5 files |
| Live schema verified against `02-DATA-MODEL-PLAN.md` | ✅ **Matches.** See §8 of that file |
| **Database backup** | ✅ `D:\RGB_Software\backups\sfacrm-prephase1-20260918-013808.dump` (801 KB, `pg_restore -l` verified, 74 tables with data) |
| **Code restore point** | ✅ git tag `pre-phase1-2026-09-18` → `221f47e` |
| App runs + reachable | ✅ port **3007** (PID 6248) |

### Restore procedure if Phase 1 goes wrong
```bash
git reset --hard pre-phase1-2026-09-18
pg_restore --clean --if-exists -d "$DATABASE_URL" \
  "D:/RGB_Software/backups/sfacrm-prephase1-20260918-013808.dump"
```

---

## 🛑 HAZARD — `npm run scratch:push` targets PRODUCTION. Do not run it.

Found by B1-Visibility, confirmed independently 18 Sep.

```
package.json:14  "scratch:push": "prisma db push --schema prisma/schema.prisma
                                  --skip-generate --accept-data-loss"

prisma/schema.prisma   datasource db { provider = "postgresql" }      <- no url
prisma.config.ts       url: process.env['DATABASE_URL'] ?? ''         <- THE LIVE DATABASE
```

**Despite its name it reads `DATABASE_URL`, not `SCRATCH_DATABASE_URL`, and it carries
`--accept-data-loss`.** `scripts/seed-scratch.mjs` refuses any non-localhost host
(`LOCAL = new Set(['localhost','127.0.0.1','::1'])`, line 31-33). The push has no guard at all.

**This nearly happened.** The orchestrator's own brief for the scratch re-parent test told B1 to
run `npm run scratch:push`. It declined, reasoned about where the URL would resolve from, and ran
a single targeted `ALTER TABLE user_visibility ADD COLUMN IF NOT EXISTS is_manual ...` against a
hostname-guarded localhost connection instead. **An agent following that instruction literally
would have pushed the schema over production with data loss accepted.**

**Until this is fixed: `scratch:push` is banned in every brief.** To bring scratch up to date, use
targeted DDL behind an explicit `localhost` assertion, as B1 did.

**Proposed fix** (small, not yet scheduled — it is outside REBUILD-PLAN's scope and is flagged
rather than taken): give `scratch:push` the same host guard `seed-scratch.mjs` already has, e.g.
route it through a wrapper script that asserts localhost before shelling out to `prisma db push`.

---

## Agent-behaviour pattern — observed across the build, actionable

**A silent idle means unfinished work. Treat it as a failed task by default.**

### ⚠️⚠️ SECOND CORRECTION — the "three failures" were a guardrail, not carelessness

I logged three separate task failures for "wrote the code, skipped the verification" on the scratch
push (B3's constraints step, B1's scratch test, B5's push ×2). **That attribution was wrong.**

**Prisma refuses to run `db push` when it detects it was invoked by Claude Code**, by design:

> `Error: Prisma Migrate detected that it was invoked by Claude Code.` … *"As an AI agent, you are
> forbidden from performing this action without an explicit consent and review by the user."*

**No agent could have completed that step.** It needs `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`
set to the user's own words of consent. My three-strikes rule fired on a wall none of them could
climb, and I read a guardrail as negligence. B1 in particular had *already* worked around it
correctly with a targeted, host-guarded `ALTER` and told me so.

Resolved 18 Sep with explicit user consent: push succeeded, drift closed
(`is_complete` present, 0 tables missing), production verified untouched (22 / 594 / 29).
`scratch:seed` now succeeds where it died with P2022.

**Remaining, logged not fixed:** `npm run test:write` needs a dev server on port 3012
(`npm run dev:scratch`). **Not started** — a second `next dev` shares the same `.next` directory as
the server on 3007, which is exactly the corruption sfacrm-11 hit running parallel dev servers.
The write-path layer is therefore *restorable on demand* rather than *running*: stop the 3007
server, `npm run dev:scratch`, then `npm run test:write`.

**Lesson worth keeping:** before recording a repeated agent failure, check whether the action is
possible for an agent at all. Two of my three "verification was skipped" findings were real
(B3's constraints did need re-dispatching, and that was genuine); this one was not.

---

⚠️ **Corrected 18 Sep.** B1 states it ended every session with a stated reason, including the
pure-waiting ones, and that any missing report was lost in transit rather than skipped. That is
consistent with what I saw: I received bare idle notifications with no content, and B1's reports —
when they did arrive — were the most detailed of the run. **So "silent idle" here means "no report
reached the orchestrator", which is not the same as "the agent said nothing."** The table below
records delivery failures, not necessarily agent failures, and the distinction matters because
the corrective action differs: a missing report means verify independently, not re-brief.

| Agent | Idles with no report received | What was actually outstanding |
|---|---|---|
| B2-Format | 2 | Work was complete both times; verified from the diff |
| B3-Schema | 1 | **Step 5 of 6 entirely skipped** — the three CHECK constraints everything else was blocked on. A real gap |
| B1-Visibility | 1 | Scratch re-parent test not started — but the cause was a genuine blocker it had no way to flag: the scratch schema predated `is_manual`, and the documented way to fix that (`scratch:push`) points at production. **Now complete and passing** |

Against that: **every agent that stopped deliberately and said why produced something valuable.**
B1 stopped three times on purpose (the closure discrepancy, the upsert/P2002 pair, the DELETE
scope question) and each one changed a decision. B2 stopped once on purpose and turned a
formatting chore into a money-display bug fix.

**So the rule is not "agents are unreliable" — it is that the *silent* stop is the unreliable
signal.** A stated stop has been right 100% of the time in this run; a silent stop has hidden
outstanding work 50% of the time and has never once been a clean finish that merely forgot to
mention it.

Operational consequence, already in force: **verify every completion against the database and the
code before accepting it.** Three of the four accepted tasks so far were verified by re-running
their acceptance criteria independently, and that is how B3's missing step was caught.

---

## Collision policy — learned from sfacrm-11's run

sfacrm-11 ran four writing agents in one working tree and hit **three collisions in one night**: a
closed browser window, a dev server that corrupted its own `.next` and served 500s everywhere, and
a `git reset --soft` that rewound another agent's commit.

**Rules for every build agent:**
1. Two agents that could touch the same file **never** run together.
2. **Schema migrations run alone**, one at a time, in dependency order.
3. No build agent runs `npm run dev`, deletes `.next`, or runs any state-changing git command
   (`commit`, `reset`, `checkout`, `stash`, `rebase`). The orchestrator commits.
4. No build agent drives the browser. Verification that needs a browser is a separate,
   serialised step.
5. Each brief names the files the agent may touch **and** the files it must not.

---

## Phase 1 — Parties

| # | Task | Status | Agent | Files owned | Depends | Blocks |
|---|---|---|---|---|---|---|
| P1-T1 | Pre-flight verification | ✅ **ACCEPTED** | orchestrator | — | — | all |
| P1-T4 | `src/lib/format.ts` | ✅ **ACCEPTED** — commit `f83feed` | B2-Format | `src/lib/format.ts` (new), `orders/page.tsx`, `review/page.tsx` | — | — |
| P1-T2a | `user_visibility.is_manual` + backfill | ✅ **ACCEPTED** — in `d941eb5` | B3-Schema | DB | T1 | T2b |
| P1-T2b | `rebuildVisibility` + upsert fix + DELETE guard + 3 call sites | ✅ **ACCEPTED** — commit `5eb6dbd`. **Acceptance test passed on scratch, and the OLD code was reproduced failing it** | B1-Visibility | `src/lib/visibility.ts`, `api/masters/users/route.ts`, `api/masters/users/[id]/route.ts`, `api/access-control/visibility/route.ts`, `.../bulk-import/route.ts` | T2a | P4-T1 |
| P1-T5+T6 | Schema: 7 tables, 6 columns, `is_manual`, 3 CHECK replacements | ✅ **ACCEPTED** — commit `d941eb5` (step 5 required a re-dispatch) | B3-Schema | DB + `prisma/schema.prisma` | T1 | T7, T9, T10, T11 |
| P1-T3 | Master registry consolidation | ⚪ QUEUED | — | `src/lib/masters-registry.ts` (new) + 9 consumers | T1 | T9, T18 |
| P1-T7 | Backfill Contacts + Addresses | ⚪ QUEUED | — | `scripts/` | T5+T6 | T8 |
| P1-T8 | Rename tables | ⚪ QUEUED | — | DB + schema + cutover | T7 | T10, T11 |
| P1-T9 | Permission sections + backfill | ⚪ QUEUED | — | DB + registry | T3, T5 | T10, T11 |
| P1-T10 | `/api/leads` → `/api/companies` | ⚪ QUEUED | — | `api/companies/*` | T8, T9 | T13, T14 |
| P1-T11 | `/api/contacts` | ⚪ QUEUED | — | `api/contacts/*` | T5, T9 | T13, T15 |
| P1-T12 | Collapse `/api/business-partners` | ⚪ QUEUED | — | `api/business-partners/route.ts` | T10 | — |
| P1-T13 | Parties page, two tabs | ⚪ QUEUED | — | `(protected)/parties/page.tsx` | T10, T11 | T16 |
| P1-T14 | Company detail page | ⚪ QUEUED | — | `(protected)/parties/companies/[id]/` | T10 | T16 |
| P1-T15 | Contact detail page | ⚪ QUEUED | — | `(protected)/parties/contacts/[id]/` | T11 | — |
| P1-T16 | Two-step Company form | ⚪ QUEUED | — | new form component | T14 | T17 |
| P1-T17 | Quick Create | ⚪ QUEUED | — | shared create fn | T16 | — |
| P1-T18 | Contact Type + Industry masters | ⚪ QUEUED | — | 2 master pages + routes | T3, T5 | — |
| P1-T19 | Eliminate the word "Lead" | ⚪ QUEUED | — | repo-wide | T13-T18 | phase close |

**Phases 2-5:** queued behind Phase 1 completion. See `04`/`05`/`06`/`06A` plans.

---

## Decisions taken and logged (not escalated)

| # | Decision | Basis |
|---|---|---|
| D1 | Every `business_partners` row becomes a Company | `02-DATA-MODEL-PLAN.md` §3; Q8 |
| D2 | `stage='Existing'` (48 rows) gets **no** Deal | §4.3 |
| D3 | Client-side pagination retained | 594 rows — Q2 not urgent |
| D4 | `temperature`, `distributor_id`, `sub_type` all **kept** | Behaviour is preserved; Q3/Q4 |
| D5 | Parties tables capped at **8 columns** | Avoids the unresolved column-freeze question |
| D6 | `orders_entity_type_check` **dropped in Phase 1** | It already breaks Institution/End Consumer orders |
| D7 | **`user_visibility` backfill: rows 3+4 `is_manual=false`, rows 1+2 `is_manual=true`** | B1-Visibility disproved my "deliberate batch grant" reading. The 6-row batch at `03-26 11:55:58.357459` is *exactly* the transitive closure of a then-current tree; cascades write one TARGET with many viewers (see the 04-13 pair), only `bulk-import` writes many targets at one microsecond; and `POST /api/access-control/visibility` is a single `upsert` (route.ts:59) that cannot batch. So `Abhishek->RGB SFA` and `Prashant->RGB SFA` are **stale cascade output — a live leak**, and marking them manual would have made a self-healing bug permanent. Rows 1+2 are unresolvable singles → preserved **and escalated**, not silently kept |
| D8 | **Orders/review adopt §18 formatting (2 decimals, `-₹500.00`, `Sep` not `Sept`)** | The 0-decimal local `fmtAmount` rounds — `₹1,234.50` displayed as `₹1,235`. A money-display bug, and orders is the worked example others copy. Phase 2's discounts produce non-round numbers constantly. Display change is deliberate, not a regression |
| D9 | New masters stay on **`CrudPage`**, not `list-page` | `list-page` has no reorder/selection/sort API; `sort_order` is part of the master shape |
| D10 | Parties tables capped at **8 columns** | Avoids the unresolved column-freeze question (sfacrm-11 Q10) |

## Escalated — needs Aryan, does not block the current wave

| # | Item | Why |
|---|---|---|
| **E-A** | **Completeness rule disqualifies 100% of parties** — 0 of 594 have a GST number, and `city` does not exist | Under §3.5 as written, no order could ever be Placed. `02-DATA-MODEL-PLAN.md` §8.3 |
| E-B | Q1 mobile — 768 is the narrowest supported width | Affects every screen; blocks P2-T8 |
| E-C | Q7 `Submitted` orders | Academic for existing data (0 rows) but the code still writes it |
| E-D | Column freeze past 8 columns (sfacrm-11 Q10) | Sidestepped by D10 for now |
| **E-E** | **Two `user_visibility` rows need the Nuetech administrator's confirmation:** is `Abhishek` meant to see `Prashant Kottur` (his own manager), and is `RGB SFA` meant to see `Dinakar`? | Unresolvable from data — each is a lone insert, equally consistent with a manual grant or a one-deep cascade. Preserved as `is_manual=true` so nothing is destroyed. **If the answer is "never intended", they are a visibility leak** and the fix is a one-line DELETE |
| **E-F** | **The Others fix will surface numbers users do not remember entering** | 78 rows are the *surviving* writes; every save wrote the value while the UI discarded it. After the fix those reappear — including on old, already-approved plans. A correctness improvement that will read as data appearing from nowhere. Wants a release note, not a silent landing (raised by sfacrm-11) |
| **E-G** | rgb-kit's intended `format.ts` takes money as **bigint paise** and needs `tsconfig` `target: ES2020` (ES2017 today) | Not implemented — this app serialises `Decimal`→`number` everywhere, so adopting it would touch every money call site. A genuine divergence from the kit, flagged rather than silently taken |
| E-H | `toLocaleDateString('en-IN',{month:'short'})` renders **"Sept"** across the remaining screens | Consistency debt. Fixed in orders + review only; not swept |

---

## Release notes owed — user-visible changes made deliberately

Written down so each reads as a decision, not an accident, when someone notices.

| Change | Detail |
|---|---|
| **Amounts now show two decimals on TWO screens** | Orders and Review. Verified from the commit diff: both local `fmtAmount` were behaviourally identical (`maximumFractionDigits: 0`), so both were rounding. `₹1,234.50` had been displaying as `₹1,235`. Negative amounts move from `₹-500` to `-₹500.00` |
| **A latent date bug was fixed in passing** | Orders' local `fmtDate` called `new Date("2026-09-18")` on a date-only string — UTC midnight, which renders as the 17th in any negative-offset timezone. Masked only because production runs UTC. `parseApiDate` now parses by parts. **Confirmed live on two surfaces:** `orders/page.tsx:492` (detail drawer) and `:630` (list column), both rendering `order_date`, which is `@db.Date` and therefore arrives as exactly the `"YYYY-MM-DD"` string that triggered it |
| **Month abbreviation changes on those two screens** | `Sept` → `Sep`, per AGENTS.md §18. Every other screen still renders `Sept` (E-H) |
| **Others values will reappear** (Phase 3) | See E-F. 78 rows of previously-discarded input become visible, including on approved plans |
