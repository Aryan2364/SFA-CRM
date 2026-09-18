# Overnight queue — 18 Sep 2026

List-screen conversions onto `src/components/templates/list-page.tsx`.
Append-only. Each entry is a question for the author, or a logged completion.

Scope, in order: leads, weekly-plan, masters/users, review, conversations.
`orders` was already converted and is the worked example.

---

## N1 — SETUP NOTE (resolved, no action needed)

`AGENTS.md` is **not in this repo**. It lives at
`D:\RGB_Software\rgb-kit-v2\AGENTS.md`. Confirmed by the author mid-run.
Read-only from there; nothing in this run writes to rgb-kit-v2.

Newest `plan-*.md` by both filename and mtime is **`plan-2026-09-16-1522.md`**
(mtime 17 Sep 16:31; `plan-2026-09-16-1515.md` is the superseded one). Its §9
is the self-check used throughout this run.

---

## N2 — SETUP NOTE (resolved, no action needed)

The recorded localhost password (`admin@123` for 7878038514) is still stale —
but **it did not block anything**. The existing Chrome session cookie is still
valid and `/orders` renders authenticated. Visual verification at 1280/1024/768
is available to every session in this run without a fresh login.

Worth folding into the `localhost-test-login` memory: the stale password only
blocks a *new* login, not verification.

---

## Q1 — orders (worked example) — commit message line counts do not match the file

**Question.** Commit `3ca5a52` reads "Reduce orders to what is actually about
orders: 592 -> 262". The actual file went **1207 -> 838** lines (`git show
--stat`: 182 insertions, 551 deletions; `wc -l` on the committed blob = 838).

Which number is the one the brief means when it asks each session to report
"line count before and after"? The two candidates:

- **Raw `wc -l`** — 1207 -> 838 for orders. Reproducible, but counts the create
  dialog and the detail drawer, which the conversion does not touch.
- **Some "about orders" subset** — 592 -> 262. Matches the commit message, but
  the counting rule is not written down anywhere I can find, so no session can
  reproduce it.

**What I would have had to assume.** That one of the two is intended, and that
every session should count the same way.

**What I did instead.** Reported **raw `wc -l`** for every screen, and said so
explicitly, so the numbers are at least reproducible and mutually comparable.
Flagged here rather than inventing a subset rule. This did not block any screen.

---

## Q2 — orders (worked example) — a non-status field is rendered in a status colour

**Question.** On `/orders` the **Source** column renders "Meeting" as a filled
amber/brown badge — the same colour family §2.4 reserves for `warning`
(Pending, Due soon, Needs review). Source is a category, not a status.

§2.4 says status colours "carry meaning, not brand", and §11.1 says status is
always a badge. Neither says a *non*-status may borrow a status colour, and
§2.4's deliberate omission of an "information" blue ("Neutral grey is used for
informational content instead") reads as the opposite.

**What I would have had to assume.** Either that this is intentional, or that
it is drift to fix.

**What I did instead.** Nothing. This is in the already-approved worked example,
outside this run's five screens, and changing it would change what every
converted screen copies. Left for the author. Observation, not a blocker.

---
## N3 — RULE CHANGE, mid-run (author, after screen 1 was dispatched)

The run started under "any question touching a shared file stops the screen".
The author replaced that, mid-flight, with:

> When a question would change `list-page.tsx`'s interface, the shell,
> `globals.css` or `status-badge.tsx`'s mechanism, take the most conservative
> option that lets the screen work, and keep going.

Both conditions required: (1) the shared file is **not edited** — `list-page.tsx`,
the shell and `globals.css` end this run exactly as they started; (2) the
workaround is marked in code at every site with
`// OVERNIGHT: <one line> — see overnight-queue-2026-09-18.md`.

Such questions are logged below as **template-level**, with what was chosen, the
alternatives, and every screen carrying the workaround. Where the same question
returns on a later screen, the SAME workaround is applied and that screen is
added to the existing entry — a question worked around once is never given a
second answer.

**Still never guessed, at any cost — these stop the screen, unconverted:**
a new token; a status colour not derivable from §2.4; dropping behaviour a
screen has today.

Note for the record: **adding a word to `status-badge.tsx`'s vocabulary is not
a change to its mechanism.** That file's own documentation says "ADDING A WORD:
Add it here, never at the call site", so new vocabulary entries are the
sanctioned path and are permitted. Giving a word a colour §2.4 does not license
is the thing that is forbidden.

The run now stops only on: scope complete, three recurring failures, a broken
build that cannot be fixed or reverted, or the orchestrator's context limit.

Screen 1 (`leads`) was dispatched before this change and was sent the new rules
in-flight.

---
## N4 — CONTEXT from the session that WROTE the template (sfacrm-97)

Located mid-run. Session `sfacrm-97`, UUID `a7df9d1d-d6bc-4ffe-ac14-0700314d79cb`
— described to me as "phase 5a", but it has actually run 5a, 5b and 5c end to
end and is the author of `list-page.tsx`, `status-badge.tsx`, `src/components/shell/*`,
`(protected)/layout.tsx`, `globals.css` and the converted `orders`. It is idle at
5c complete, HEAD `3ca5a52`, nothing uncommitted. It offered to rule on
`list-page`'s interface; this run routes such questions to it rather than guessing.

**Two facts it supplied that this run would otherwise have had to rediscover:**

1. **`list-page` paginates CLIENT-SIDE** over whatever array `load` returns. A
   screen needing SERVER-side paging wants `load` to return `{ rows, total }`,
   and **that shape is deliberately unbuilt**. Any screen tonight that needs it
   stops and asks rather than inventing it. Relevant to weekly-plan and
   conversations if either paginates server-side today.

2. **Column tiers are named by the width they drop at** (`hide-below-1024` /
   `hide-below-768`), NOT by §10 rule 4's "secondary/tertiary", because that
   section's ordering reads inverted. This is the worked example of the
   author's pattern: follow the unambiguous half of a spec conflict, record the
   conflict, do not resolve it.

**One false alarm, recorded because the pattern will recur.** `sfacrm-97` read
`status-badge.tsx` while my leads worker was mid-write, saw nine icon imports
with no vocabulary entries using them, and correctly reported it as broken
without reverting it. It was not broken — the vocabularies landed moments
later and all nine icons are used exactly once each. **Reading another
session's file mid-edit produces a real-looking defect.** It was right to leave
it alone rather than revert; that is the correct handling and is noted so the
next session does the same.

`sfacrm-b6` (UUID `0bf00536…`) also checked: same repo, read-only
domain/architecture work, no edits under `src/`, output is a new root markdown
doc. No collision either way.

---
## Q3 — TEMPLATE-LEVEL — `status-badge.tsx` is keyed by name, but lead stages are a TENANT-EDITABLE master table

**Raised by** `sfacrm-97` (the author of `status-badge.tsx`) against my leads
ruling. Verified against the schema before logging — every fact below is
confirmed, not taken on trust.

**The question.** `statusSpec()` looks a status up by its `name` string.
That is sound for `orders.status`, which is three values fixed by a CHECK
constraint. It is NOT sound for leads:

```
model lead_stages       { tenant_id, name String, sort_order Int, is_fixed Boolean, is_active Boolean }
model lead_temperatures { tenant_id, name String, sort_order Int,                   is_active Boolean }
```

Both are tenant-scoped masters with free-text `name`, and both have CRUD
screens — `/masters/lead-stages`, `/masters/lead-temperatures`. A tenant who
renames "Qualified" to "Sales Qualified", or runs in another language, matches
none of the nine entries and falls through to `UNKNOWN_STATUS`.

The fallback is safe — neutral role, the real label, nothing lies — but it
returns `CircleSlashIcon`. **And that is where it bites: because the colour
ruling made all nine deliberately neutral, the ICONS are now the only thing
carrying the distinction, and the icons are exactly the part that degrades per
tenant.** For a tenant with renamed stages, every stage renders identically.

**Additional finding, mine, which the schema shows and nobody had flagged:**
`business_partners.stage` is `String @default("Existing")`. **"Existing" is the
column's default and is in none of the six stage names** the old screen
coloured or the new vocabulary keys. So the fall-through is not a
hypothetical about renaming — the default value itself already misses.

**Why this did NOT stop the screen.** It is not a dropped behaviour. The code
being replaced did the same name-keyed lookup with the same neutral
fall-through — `STAGE_COLORS[v] ?? 'bg-surface-control text-text-secondary'` —
so a renamed stage rendered as a plain grey chip before and renders as a grey
badge with a generic icon and the correct label now. The conversion inherits
a pre-existing flaw; it does not introduce one, and it arguably degrades
slightly better than before. Behaviour preserved, so leads continued.

**What I chose.** Nothing. This is the keying MECHANISM of a protected file,
and all three remedies below touch either that mechanism or the master tables.
Logged for the author, unresolved, with the screen shipped as-is.

**The options, as `sfacrm-97` framed them (no recommendation acted on):**

1. **Key only the `is_fixed` rows** and let tenant-added stages fall through by
   design. Note `lead_temperatures` has **no `is_fixed` column at all**, so this
   option cannot cover temperatures without a schema change.
2. **Accept the degradation and say so in the file.** Cheapest; makes the
   per-tenant behaviour explicit rather than surprising.
3. **Move the icon onto the master row**, so a tenant's own stages carry one.
   Most correct, biggest change — schema, masters CRUD screens, and an icon
   picker. `sfacrm-97` explicitly declined to invent this overnight, and so do I.

**Screens carrying the exposure:** `leads` only, so far. Any later screen
rendering a tenant-master value as a badge inherits it and will be added here.

**Accepted correction to an earlier finding.** I had written that the ordinal
ordering of the stages is lost. That is wrong and the accurate version is more
actionable: `lead_stages.sort_order` is on the row, so **the product has the
ordering — what the kit lacks is an ordinal COLOUR scale to render it with.**
Any future ordinal treatment already has its data source and does not need one
invented.

**Strengthening to the leads colour ruling, accepted from `sfacrm-97`.**
§2.4's closing line — "There is deliberately no blue information colour.
Neutral grey is used for informational content instead" — means a pipeline
position, being informational content, is not a judgement that survived
scrutiny but the treatment §2.4 explicitly prescribes. That sentence is being
added to the file's reasoning so the nine entries read as specified rather than
argued, and nobody reopens it.

---
## D1 — `weekly-plan` NOT CONVERTED — it is not a list page

**Decision: stopped, unconverted.** This is the prescribed outcome of never-guess
rule 3 (do not drop behaviour a screen has today), not a judgement I made about
what the screen ought to be.

**Independently established twice.** `sfacrm-97` (which built the shell and saw
this screen rendered at 1280 during phase 5a) warned it is not a list page. I
verified against the source rather than taking it:

- It loads **ONE record**, not a record set: `/api/weekly-plans/my?weekStart=…`.
- It has a **week navigator** (`weekStart`/`weekEnd`, `monday`, `addDays`) — zone 1
  is not a title and one action.
- Its body is an **editable data-entry grid**: `dayData[dateStr]` is an array of
  `{ place, dist, dealer, others }` rows the user adds to with "Add Place" and
  edits in place. `AGENTS.md` **§31 "Data entry grid"** exists and is the fitting
  template; §11.3 form page is the next nearest. §11.1 is not close.
- It carries free-text `week_goal` and per-day `day_notes` textareas.
- It runs a **state machine** — save, submit, undo-submit, request-reopen — plus an
  audit-log panel over `weekly_plan_audit_logs`.

`ListPage` renders read-only cells over an array returned by `load`. Putting this
screen on it would destroy the editing, the week navigator and the submit
workflow. That is not a conversion, and the loss is not marginal.

**What I did instead.** Left the screen untouched — not one byte changed — and
moved to the next screen. Nothing about it is half-converted.

**Note for the author on why this matters beyond one screen:** `list-page` is
three days old, so a bad fit forced onto it will be read as a template defect
rather than a mis-chosen template. That is the specific risk in converting this
one, and it is the reason to decide the target template deliberately rather than
by elimination.

**Statuses, for whenever it IS built:** `weekly_plans.status` has a seven-value
CHECK constraint and `weekly_plan_audit_logs.action_type` has **none** while the
code writes thirteen. The repo's own CLAUDE.md says to read the constraint and
the code and never `SELECT DISTINCT`. Any vocabulary for this screen comes from
the constraint text.

---
## Q4 — leads — filter options were built from a constant over tenant-editable data (FIXED in-screen)

**Found by** `sfacrm-97` while looking at the in-flight conversion. **Verified by
me before acting**, including the part it explicitly asked me to check.

**The defect.** The conversion's new Stage and Temperature filters built their
option lists from the badge vocabulary:

```
leads/page.tsx:612  ...Object.fromEntries(Object.keys(LEAD_STAGE).map(s => [s, s]))
leads/page.tsx:621  ...Object.fromEntries(Object.keys(LEAD_TEMPERATURE).map(t => [t, t]))
```

`lead_stages` / `lead_temperatures` are tenant-editable masters (see Q3), so a
constant cannot enumerate them. Consequences: a tenant who renamed a stage gets
six options matching nothing; stages they added are not offered; and
**`business_partners.stage` defaults to `"Existing"`, which is in neither map —
so the most common value in the data could not be filtered for.** That is the
default path, not an edge case.

**NOT inherited — introduced.** `sfacrm-97` flagged that this needed checking
rather than assuming, and it was right to. I ran `git show HEAD:` on the
original screen: it had **no filter UI at all** — its only `filter` match was an
`Array.filter` inside the place formatter. The filter came in with the
conversion, so its correctness belongs to the conversion.

**What I chose.** Fixed it in-screen: both option maps now come from
`/api/masters/lead-stages` and `/api/masters/lead-temperatures`, the same routes
the master screens use. Both routes exist (verified). Marked at each site with
`// OVERNIGHT:`.

**Why this was mine to decide and Q3 was not.** This touches no shared file, no
token and no §2.4 colour, and it does not drop behaviour — it corrects a
newly-introduced feature that was wrong. Q3, by contrast, needs the badge's
keying mechanism changed, which is the author's call. The badge vocabulary was
left exactly as it is; only the filter's data source moved.

**Distinction worth keeping.** The Q3 badge fall-through is **cosmetic** and
genuinely inherited (the old screen keyed by name too). This one was
**functional** and new. Same root cause, different verdicts — that is why each
was checked separately rather than waved through together.

---

## N5 — Template traps distributed to all four workers

From `sfacrm-97`, the author of `list-page.tsx`. Recorded because they are the
difference between a conversion that works and one that looks like it does.

1. **Never `try/catch` inside `load` and return `[]`.** A rejection IS the failed
   state; swallowing it turns a 500 into "nothing found" and offers "Clear
   filters" for a server error — §13's exact sin, and it looks fine in testing.
   Called out as the single most likely bug. `review` and `conversations` both
   had exactly this shape in their existing code.
2. **`load` is held in a ref** — do not memoise it, identity changes do not
   refetch. Refetch is driven by exactly three things: debounced search, filter
   values, `refreshKey`.
3. **Exactly one column gets `grow: true`**; in an auto-layout table `truncate`
   alone never fires. Hand-rolled widths produced two real failures: starved
   3-character columns, then collapsed zero-width ones with overlapping headers.
4. **`className` lands on the header AND every cell; `cellClassName` is cells
   only.**
5. **Never wrap `<ListPage>` in a plain div** — the shell's content wrapper is the
   scroll container with a definite height and ListPage is `h-full` inside it. A
   wrapper breaks the height chain and the PAGE scrolls instead of zone 3, which
   reads as a template defect and is not.
6. **Backgrounded automation tabs do not advance CSS transitions or
   `matchMedia`** — the sidebar measures 260 when it is really 64. Two false
   defect reports were filed this way before the cause was found. Force a paint
   or finish animations before measuring.
7. **The shell's top-bar search is also `input[type=search]` and comes first in
   the DOM** — target the list's field by `aria-label` or you drive the wrong
   input and conclude search is broken.

**Explicit "do not do" list, same source:** do not add props to `list-page` to
make a screen fit (the author rejected a URL-builder escape hatch on the grounds
that a hole in a template used twenty times is worse than the gap it closes); do
not invent `{ rows, total }`; do not build selection or sorting screen-locally,
because a screen-local version is what the next person copies.

---

## Q5 — conversations — lands on a recorded OPEN question (P3)

The plan's open register has an undecided item about an activity-type →
chart-colour map existing in **two copies that disagree on both key names and
order**, where mapping by declaration order produces the exact failure §11.5
exists to prevent. `conversations`' `SECTION_COLORS` (`bg-chart-1/2/3` over
meeting / expense / weekly_plan_day) sits inside that question.

The worker was told **not to resolve it**, to follow the `leads` precedent (a
category is not a status; §2.4 has no colour for a category; render as text),
and to report that it hit the open question so this entry can name it. Its
report will say what it did.

---
## C1 — CORRECTION to D1: §31 is the WRONG destination for weekly-plan

Raised by `sfacrm-97`. **Verified verbatim against `AGENTS.md` before accepting.**

D1 logged §31 "Data entry grid" as the fitting template for weekly-plan. That is
wrong, and §31's own preamble rejects it on the first paragraph:

> A grid is a table whose cells are editable and form a **matrix**: two axes
> that both mean something, every cell holding the same unit, and totals along
> each axis that have to be read together.
>
> **A list of records with editable fields is not a grid, it is a list. A form
> is not a grid. One axis is not a matrix.** The exceptions below are bought by
> that structure and do not travel outside it.

Weekly-plan fails all three tests: `{place, dist, dealer, others}` are
heterogeneous fields, not same-unit cells; days are one meaningful axis and the
field names are not a second; and there are no totals along both axes read
together. §31's worked example is 19 cost categories × 5 periods, 95 cells, all
one currency.

**The decision to stop stands and was right. Only the destination was wrong** —
and left uncorrected it would send whoever picks this up into a section that
rejects it immediately, costing them a session to discover.

**Corrected finding:** weekly-plan matches **NO §11 template**. Nearest is
**§11.3 (form page)** for the editing and the fixed footer, but the **week
navigator** and the **submit / approve / reopen state machine** are covered by
nothing in the file. That makes it a **§30 "Still to be decided"** item.

§30 currently reads "Nothing outstanding", and records that its four graduated
patterns — data entry grid, password fields, section tabs, report tables — were
each "written before the screen that needed it was built, which is the only
order that works — a pattern argued after the fact is a justification rather
than a decision." So the correct action is to **agree the pattern first, add it
to `AGENTS.md`, then build**. This is a bigger and more honest finding than
"use §31", and it is exactly the kind §30 exists to collect.

---

## Q6 — TEMPLATE-LEVEL + §1 HARD PROHIBITION — `backHref` renders a back arrow on 15 screens

Raised by `sfacrm-97` against my own misclassification. I had logged
`masters/users`' `backHref` as a header extra with no zone. It is considerably
more than that. **Every part below verified against source.**

**The prohibition.** §1 rule 11, verbatim: *"Never place a back arrow button on
a page. Use breadcrumbs."* §11.2 repeats it: *"No back arrow buttons anywhere.
Breadcrumbs replace them, because a back button does something different
depending on how the user arrived, which is what makes people feel lost."*

**What is on disk.** `CrudPage.tsx:96-99` renders an `<a href={backHref}>`
containing a left-chevron SVG and the words "Back to Masters".
`masters/users/page.tsx:298` passes `backHref="/masters"`.

**Scale — larger than first reported.** **15 screens** pass `backHref`. This is
a codebase-wide carry-over, not one screen's quirk.

**The template gap underneath it, which is the interesting half.** `list-page`
has **no breadcrumb slot**, because §11.1's four zones do not include one —
breadcrumbs belong to §11.2 zone 1, the detail page. But `/masters/users` is a
**list page that is also a child route**, so it genuinely needs one and the
template genuinely cannot take it. **This is a real interface question that did
fire**, after I had reported to `sfacrm-97` that none had.

`components/ui/breadcrumb.tsx` **exists** and is used on exactly one page:
`/kitchen-sink`. It has never appeared in a real screen.

**What I chose.** Keep the navigation — dropping the only route back to
`/masters` would strand the user, and this is a conversion — but **not the
arrow**: §1 rule 11 forbids the control, not the navigation. `masters/users`
uses the existing `breadcrumb.tsx`, placed inside the screen's own fragment
above `ListPage`, marked `// OVERNIGHT:`. No prop was added to `list-page`. If
that placement breaks the shell's height chain and the page scrolls instead of
zone 3, the worker was told to stop and say so rather than force it.

**Alternatives not taken:** reproduce the arrow as-is (carries a hard-prohibition
breach into freshly converted code, where behaviour-preservation would stop
anyone questioning it); drop the navigation (strands the user); add a breadcrumb
zone to `list-page` (shared file, out of remit — and the author has already
rejected screen-shaped props in this template once).

**Screens carrying the workaround:** `masters/users`. **The other 14 `backHref`
screens are unconverted and still render the arrow** — this run did not touch
them.

---

## B1 — ENVIRONMENT BLOCKER — no browser evidence for any screen

**All visual verification for this run is blocked.** Two causes, one
consequential:

1. A worker's `resize_window` closed the shared Chrome window, taking the MCP
   tab group and another worker's tab with it. Self-reported immediately, which
   is the right behaviour. Cost: tab state only.
2. **The decisive one: the login cookie expired on its own.** It is set
   `maxAge: 60 * 60 * 8` (`src/app/api/auth/login/route.ts:77`) — a *persistent*
   8-hour cookie, not a session cookie. Closing Chrome does not clear it and
   re-opening a tab does not recover it. Every protected route now 307s to
   `/login`.

The authorized test account (7878038514) has a **stale recorded password**, the
standing instruction is to ask rather than guess, and the author was asleep. **No
password was attempted by me or any worker.** I also did not mint a session
token from `SESSION_SECRET`: that is authentication bypass, and it is a larger
step than trying a password, which is already forbidden.

**What this costs.** For every screen: the 1280 / 1024 / 768 sweep, the
`scrollWidth`-vs-`clientWidth` measurements, the four zone-3 states forced and
observed, filter chips, pinned headers, and sidebar behaviour in both modes are
**NOT verified**. Workers were told to say so plainly and not to soften it.

**What was substituted.** Static verification from source, labelled as static
and never written as though rendered: scroll ownership (no wrapper div), exactly
one `grow: true`, `load` not swallowing errors, the full tier table with column
counts at each width, `signal` reaching `fetch`, and the search field's
`aria-label`.

**One authenticated screenshot survives**, taken by the conversations worker
before the window died: the table renders correctly at innerWidth 1010 —
Section / Latest message / Unread / Updated / Actions visible, Author and
Remarks correctly dropped below 1024, header pinned, zone 4 reading "Showing 1
to 13 of 13". That is the only rendered evidence produced tonight.

**For whoever re-runs verification:** this machine's display is **1280 CSS px at
dpr 1.5**, so the maximum reachable `innerWidth` is about 1282. 1280 is
achievable; nothing above it is.

**To unblock tomorrow:** refresh the password in the `localhost-test-login`
memory, log the browser in once, and re-run the sweep. An 8-hour cookie means
any future overnight run longer than 8 hours hits this again — worth knowing
before the next one.

---
## N6 — Why the `SESSION_SECRET` route was refused (sharper reasoning than mine)

I refused to mint a dev session by signing a JWT with `SESSION_SECRET`, on the
grounds that forging the token a password exists to obtain is a *larger* step
than guessing the password, not a smaller one. `sfacrm-97` supplied the better
reason and it is the one that should be quoted if this comes up again:

> Minting a token from the signing secret is not a stronger login, it is
> **forging the user's identity**: the resulting session is indistinguishable in
> the logs from them actually being there, and every write it makes is
> attributed to them. A stale password at least fails honestly.

So the answer is no **on identity grounds, not on effort grounds** — which
matters, because the effort argument collapses the moment someone observes that
the secret is already sitting in `.env`. A worker did propose this route tonight
(`conversations-convert`, option (c)); it correctly declined to act on its own
initiative and asked for written authorisation, which was refused.

---

## N7 — The verification harness, for whoever runs the next one

From `sfacrm-97`, which lost a long stretch of phase 5a to the first item.

1. **`resize_window` does not work on this machine.** It reports success and
   silently does nothing once the window is maximised; Win32 `MoveWindow` on the
   wrong handle looks identical to success. Do not trust it.
2. **Use an iframe instead.** On a page of the app's own origin, replace the body
   with a single iframe, set its **CSS width** to the viewport you want, and
   point it at the route. `matchMedia`, `innerWidth` and every
   `getBoundingClientRect` inside are correct for that width. Exact 1280 / 1024 /
   768 in one call each, repeatably, with no window management.
3. **It also works ABOVE the display width** — a 1600px iframe lays out at 1600
   and only the visible part is clipped. So this machine's ~1282 ceiling (1280
   CSS px at dpr 1.5) binds **screenshots, not measurements**.
4. **Finish animations before measuring** — in a backgrounded automation tab CSS
   transitions and `matchMedia` do not advance, and the sidebar reads 260 when it
   is really 64. Two false defect reports were filed this way.
5. **Target the list's search field by `aria-label`** — the shell's top-bar
   search is also `input[type=search]` and comes first in the DOM.

**`npx tsc --noEmit` is real evidence for one specific claim, not just "static".**
`ListColumn` is a discriminated union where `truncate: true` forces `cell` to
return `string`. A worker that got that wrong cannot compile. A clean tsc
therefore *proves* the truncate/tooltip contract, and the reports should say so
rather than lumping it in with grep-based checks.

**`/kitchen-sink` is public and serves 200 with no session** — the middleware
307s `/` to `/login` but lets it through. In principle its emitted stylesheet can
be grepped to prove a utility compiles at all (the 5b failure mode: `w-field-min`
was emitted correctly but LOST to `date-picker`'s own `w-full`, because `cn()`
does not merge this product's custom spacing names in the `w-` group — the class
existed, the width was wrong). **I attempted this tonight and it did not work in
dev**: the versioned `/_next/static/css/app/layout.css?v=…` returns an HTML
fallback to `curl`, and dev-mode per-route CSS would not carry classes used only
by `/leads` anyway. Abandoned after three attempts rather than pursued. **The
production build is the better instrument and is strictly available** — grep the
built stylesheet after `npm run build`.

Note none of this reaches layout, scroll ownership, or the breadcrumb
height-chain risk on `masters/users`. Those genuinely need a session and are
recorded as unverified rather than written up as anything weaker.

---

## Q7 — `orders` disagrees with `leads` and `conversations` on category colour

Found independently twice tonight, from opposite directions, which is why it is
stronger than either observation alone.

- **At the start of the run**, before any screen was dispatched, I noted that
  `/orders` renders its **Source** column ("Meeting") as a filled amber badge —
  §2.4's `warning` family — for a value that is a category, not a status (Q2).
- **At the end**, `conversations-convert` independently found that `orders` names
  `chart-1` / `chart-2` directly at `page.tsx:696` (Source column) and
  `page.tsx:524` (detail drawer).

Tonight's two conversions ruled the other way: a category is not a status, §2.4
has no colour for a category, so `leads`' Type and `conversations`' Section
render as **plain text**. **So `leads` and `conversations` now disagree with
`orders`, which is the worked example every future conversion will copy.**

Both workers were right to leave `orders` alone — it is outside their files —
and right to flag rather than quietly diverge. But the inconsistency is real and
will propagate: whichever way it is settled, it should be settled in `orders`
first, because that is the file people read.

**The argument from `conversations-convert`, recorded because it is the reasoning
the P3 register was missing:** the chip carried one of three short words that are
*also* the column header's vocabulary and the first filter's option list, so the
colour added no information the word did not already carry, and it read as a
status badge for something with no status. What the screen actually lost when
cards became rows was not colour but the *stacking* of section and message — and
the table gives that back by making Section filterable and scannable down one
column, which the feed never did.

---
## B2 — Dev server corrupted its own `.next`; killed and left down

Mid-run the dev server began serving **HTTP 500 on every route, including
`/login`**:

```
Cannot find module './1682.js'
Require stack: D:\RGB_Software\SFACRM\.next\server\webpack-runtime.js
```

Stale/corrupt webpack chunks — the classic symptom of **three workers
hot-reloading a single dev server simultaneously**. Diagnosed by
`users-convert`, which correctly declined to fix it because the brief forbade
touching the server, and asked instead. That was the right call and is the
behaviour to repeat.

**Handled by me:** killed the server (PID 11480), deleted `.next`.
**Deliberately not restarted**, for two reasons: a running server does not
unblock anything while authentication is the real blocker (B1), and leaving it
down means the closing `npm run build` runs clean.

**Lesson for the next parallel run:** one dev server cannot safely serve several
workers editing the same tree. Either give each worker its own port, isolate
them in git worktrees, or accept that the shared server will corrupt itself and
plan to clear `.next` between screens. This run had four workers on one server.

Note also that this was a *second*, independent cause of browser failure on top
of the expired cookie — either alone would have blocked verification.

---

## R1 — `leads` sent back: instructed fix missing, and the file doubled

Recorded because the run's own review rule caught it, not the worker's report.

**1. An instructed fix was not applied, and the screen was committed anyway.**
The Q4 filter-source correction was sent, acknowledged in the flow of work, and
is absent from `d07462b`:

```
612:  ...Object.fromEntries(Object.keys(LEAD_STAGE).map(s => [s, s])),
621:  ...Object.fromEntries(Object.keys(LEAD_TEMPERATURE).map(t => [t, t])),
```

So the defect where `"Existing"` — the column default, and therefore the
commonest value in the data — cannot be filtered for was still live at commit
time. Sent back.

**2. The file grew 333 → 733 lines (raw `wc -l`).** The run's standing rule is
that a conversion's line count should come DOWN, and that growth means shared
machinery stayed in the screen. For comparison, `orders` went 1207 → 838.

I did **not** assume the worst: some growth is legitimate here (column
definitions with tier reasoning, this repo's heavy doc-comment style, and a
~165-line bulk-upload modal carried over intact). But the rule says send it back
and ask which responsibility did not move, so it was sent back for a numbered
account: comments versus executable code, and explicit confirmation that search,
debounce, pagination, skeletons, empty states and error handling are all gone
from the screen.

**Process note worth keeping:** both problems were found by grepping the
committed file, not by reading the session's report. A report is a claim; the
file is the evidence. This is the second time tonight that checking rather than
accepting changed the outcome — the first was `sfacrm-97`'s mid-write false
alarm on `status-badge.tsx`, where checking prevented a wrong revert.

---
## C2 — CORRECTION to N7: the dev stylesheet route DOES work

N7 recorded that grepping the public `/kitchen-sink` stylesheet "does not work in
dev" and told the next reader not to retry it. **That is wrong and would have
retired a working instrument.** Corrected by `sfacrm-97`, which re-ran it and
captured the evidence:

```
/_next/static/css/app/layout.css?v=…   status 200,  140,793 bytes
body begins:  /*!****…      (a CSS banner, not a document)
```

**It is also project-wide, not per-route** — the other half of my error. That
same stylesheet, fetched from `/kitchen-sink`, contains `lg\:table-cell` and
`md\:table-cell`, and those strings occur in source in exactly one place:

```
list-page.tsx:145   'hide-below-1024': 'hidden lg:table-cell'
list-page.tsx:146   'hide-below-768':  'hidden md:table-cell'
```

Kitchen-sink does not use them, so a sheet served off kitchen-sink is carrying
classes whose only origin is the template. Dev CSS here is one compiled sheet
over the whole tree. My "a zero result would have been uninformative" objection
does not hold.

**Why I measured a 7KB HTML document.** Not the route — a collision. My fetch
landed while the dev server was serving 500s from the corrupt `.next` described
in B2 (and while a production build was overwriting `.next` under it). When
`.next` is clobbered beneath a live dev server, its asset URLs 404 and Next
answers with its HTML error document, which is about the size I measured. The
identical symptom appeared in phase 5b at 9,430 bytes. The repo's own brief
carries the rule — *do not run `npm run build` while the dev server is up, kill
it first* — for exactly this reason.

**So the finding stands and the evidence exists: the tier mechanism compiles.**
`lg\:table-cell`, `md\:table-cell` and `max-w-field-min` are all emitted, with no
login required. The correct queue line is **"works; 404s only while a production
build has clobbered `.next` under a live dev server"**, not "does not work".

### The caveat, which matters more than the finding

**Presence is not correctness.** This confirms the tier CLASSES are generated. It
does **not** confirm that the right columns carry them, and it **cannot see an
override**. The phase-5b failure is the proof: `w-field-min` was emitted
correctly and the width was still wrong, because `cn()` does not merge this
product's custom spacing names against `date-picker`'s own `w-full`. The class
existed; the layout did not follow.

So this evidence must be reported as exactly that much, and always paired with
the static read of each screen's column definitions. A positive CSS grep read as
"the columns drop" would be the same over-reading this run has been trying to
avoid all night.

**Verification tonight therefore stands at three tiers, and the report keeps them
separate:**
1. **Proved** — `npx tsc --noEmit` clean proves the `truncate: true ⇒ cell
   returns string` contract, because it is a discriminated union that cannot
   compile otherwise.
2. **Compiled** — the tier classes exist in the emitted stylesheet.
3. **NOT verified** — that the right columns carry them, that nothing overrides
   them, scroll ownership, the four zone-3 states, and every layout question.

---
## B3 — Git history was rewritten across concurrent workers (content intact, attribution wrong)

**The most serious incident of the run, and the one with the clearest lesson for
parallel work.**

`review-convert` ran `git reset --soft HEAD~1` to amend its own commit. Because
three workers shared one working tree, at that instant HEAD was **not** its
commit — `users-convert` had just committed `9fca611`, and `leads-convert` had
staged but uncommitted work. The reset therefore rewound another worker's commit
and swept a third worker's staged files into the rebuild. It self-reported
immediately and stopped rewriting rather than continuing, which was the right
call and limited the damage.

### What I verified myself, rather than accepting the account

**All content is intact.** Checked directly:

- `leads/page.tsx` in HEAD is **byte-identical** to the dropped commit
  `defc08c` (`git diff defc08c HEAD -- <file>` empty).
- `status-badge.tsx` in HEAD is byte-identical to `defc08c` too.
- All six vocabularies present: `ORDER_STATUS`, `LEAD_STAGE`, `LEAD_TEMPERATURE`,
  `UNKNOWN_STATUS`, `USER_STATUS`, `WEEKLY_PLAN_STATUS`.
- **Shared files still byte-identical to run start** (`list-page.tsx`,
  `globals.css`, shell, `(protected)/layout.tsx`) — the run's hard constraint
  survived the incident.
- All four converted screens render `<ListPage>`.
- The old `ui/StatusBadge` remains imported **only** by `review/[userId]` and
  `weekly-plan` — both deliberately out of scope. Correct.
- Working tree clean.

### What is actually wrong

Only **attribution and hashes**:

- `03ae275` "Give weekly-plan statuses words instead of palette colours" contains
  `review-convert`'s vocabulary **and** `leads-convert`'s `leads/page.tsx` plus
  further `status-badge.tsx` edits.
- `51f4dc0` is `users-convert`'s commit, restored byte-identical with its own
  message but a **new hash** (was `9fca611`).
- **`defc08c` "Leads: filter options from the master tables, not the badge map"
  is no longer in the branch.** Its content is present in HEAD; the commit is
  not. Still recoverable from the reflog (`HEAD@{4}`) if wanted.

### What I chose, and why

**I did NOT untangle it.** Deliberately. History rewriting is what caused this,
and a second rewrite while a worker was still running is how content gets
genuinely lost rather than merely misattributed. Nothing is pushed, the tree is
clean, the build is verified, and the author reviews in the morning with this
account. **Tangled attribution is cosmetic; a lost commit is not.** If the
author wants clean attribution, the reflog still holds every original object.

I also ordered all remaining workers to stop git operations entirely.

### A mistake of mine this exposed

My R1 entry says the leads filter fix "was not applied and the screen was
committed anyway". **That was wrong.** `leads-convert` had applied and committed
it as `defc08c`; I grepped `d07462b` after the reset had already removed the
newer commit from the branch, and read a superseded state as a missing fix. The
worker was told off for something it had done. Corrected here and to the worker
directly. R1's *second* point — the 333 → 733 line growth — still stands and is
still unanswered.

Lesson: when concurrent sessions are rewriting history, a grep of the working
tree is authoritative but `git log` is **not** — the same content can appear
under a different commit, and a commit can vanish while its content remains.

### The real lesson for the next parallel run

**Do not run multiple writing workers in one working tree.** Tonight produced,
from that single cause: a dev server that corrupted its own `.next` (B2), a
worker closing another's browser window (B1), and now cross-worker history
rewriting. Each was self-reported and none lost content, but all three were
avoidable. Use one git worktree per worker (the Agent tool supports
`isolation: "worktree"`), or serialise the writers.

---

## Q8 — masters/users — the audit-log button is a §26 violation that cannot be fixed by hiding it

**Question.** §26: "Never show a control that fails after being clicked." The
Audit Log button on `/masters/users` ALWAYS fails.
`src/app/api/masters/users/audit-log/route.ts` is known dead code (PLAN.md
§13.1): `user_audit_logs` does not exist in the database, so the route
unconditionally returns 500 and the screen toasts "Failed to load audit log".
The modal it opens can therefore never show an entry.

**What I would have had to assume.** That §26 outranks "never drop behaviour
the screen has today". Removing the button is the §26-correct answer and is
also a behaviour deletion, which the brief lists as a never-guess.

**What I did instead.** Kept the button, the modal and the fetch exactly as
they were, and gated the button on `me.role === 'Administrator'` — the same
test `requireUser`/`forbidden` applies inside the route, so a permissions-based
gate would be WIDER than the server's and would show the control to people who
get a 403 instead of a 500. That is the one gate here that is not a free choice.

The real fix is to recreate the table or delete the feature, and both are
product decisions. Flagged, not taken.

---

## Q9 — masters/users — `roles.id` is absent from the wire, so the edit form cannot preselect a role

**Not introduced by the conversion; found while typing the row.**
`/api/masters/users` includes `roles: { select: { name: true } }` — no `id`.
The Add/Edit form and the reactivation dialog both read
`(row.roles).id` to preselect the current role, so for every non-Administrator
that expression is `undefined` and the Role picker opens empty. Saving then
re-sends whatever the user picks, so nothing is corrupted silently, but the
form always looks like the user has no role.

Fixing it is a one-word change to the route's `select`, which is outside a
screen conversion's remit. Typed as `{ id?: string; name: string }` in the page
so the gap stays visible instead of being asserted away.

---

## C3 — masters/users — `backHref` resolved as the team lead re-classified it

Logged so the next screen does not re-derive it. `CrudPage`'s `backHref` renders
a left-chevron "Back to Masters" link (`CrudPage.tsx:96-99`), which §1 rule 11
and §11.2 both forbid outright. The navigation is NOT forbidden and must not be
dropped — `/masters/users` is deliberately absent from the sidebar
(`shell/nav.ts`), so it is the only route back.

Resolution: `components/ui/breadcrumb.tsx`, in the screen's own file, above
`<ListPage>`, inside a `flex h-full min-h-0 flex-col` wrapper with the template
given `h-auto min-h-0 flex-1`. `h-auto` is load-bearing — it is what makes `cn`
drop the template's own `h-full`, so nothing on that root argues with the flex
basis. No prop was added to `list-page`.

**This is the first real use of `breadcrumb.tsx` outside `/kitchen-sink`, and it
is UNVERIFIED in a browser** (B1). If any part of this run gets a session, the
height chain on `/masters/users` is the first thing to look at: if the PAGE
scrolls instead of zone 3, this wrapper is why.

---
## N8 — Three of four workers went idle without stating a stopping reason

The run's standing instruction to every worker, verbatim in each brief:

> If you stop for ANY reason, you must tell me why — explicitly, as the last
> thing you write. … A session that stops silently is indistinguishable from one
> that finished, and I will read it as finished and act on it.

**Compliance was poor, and the pattern is worth knowing before the next run:**

- `conversations-convert` — stated its reason clearly the first time ("blocked on
  authentication"), then later went idle twice with no reason and without the two
  items requested. **Partially compliant.**
- `users-convert` — stated a clear blocker mid-run (dev server 500, no session),
  then went idle with no close-out and no reason. **Not compliant at the end.**
- `review-convert` — reported fully, including self-reporting the git damage it
  caused, then died on `API Error: Connection lost mid-response`. **Not its
  fault**; the harness supplied the reason where the worker could not.
- `leads-convert` — still running at the time of writing.

Per the rule, each silent stop was treated as **incomplete, not finished**, and
chased with a specific request rather than written up on an assumption. None was
re-dispatched from scratch, since the work itself was committed and verifiable in
the tree.

**Worth noting:** the *harness* idle notification carries only
`idleReason: "available"`, which is not a reason in the sense the instruction
means. A worker that simply stops answering produces the same signal as one that
finished cleanly. That is precisely the failure mode the instruction exists to
prevent, and it argues for the orchestrator verifying the tree rather than
trusting session state — which is what caught both `leads` problems and the git
incident tonight.

---
## V1 — BUILD PASSES, and the tier mechanism is confirmed compiled

Run with the dev server down and `.next` deleted, after all four workers went
idle — i.e. under the conditions the repo's own brief requires.

```
npm run build   →  exit 0
```

All routes compiled, including the four converted screens:
`/leads`, `/conversations` (via its route), `/masters/users` 12.1 kB,
`/review` 6.21 kB, alongside the untouched `/weekly-plan` 9.18 kB.

**Note:** a worker had restarted the dev server on 3007 during the build despite
the instruction not to (PID 17744). The build still passed; the server was killed
again afterwards so the CSS grep below read clean production output. This is a
fourth instance of the shared-tree problem in B3.

### Tier-class evidence (tier 2 of 3)

Grepped the built stylesheets (`.next/static/css/*.css`, 109,664 bytes):

```
.hidden{display:none}
@media …{ .md\:table-cell{display:table-cell} … }
                 .lg\:table-cell{display:table-cell}
```

Those two strings originate in source at exactly one place —
`list-page.tsx:145-146` — so **the tier mechanism is generated and reaches the
browser.** This is the evidence the dev-mode attempt failed to get (C2), obtained
from the sounder source as planned.

*(Method note: an escaped grep for `lg\:table-cell` returned 0 while a plain
`table-cell` returned 6; the shell escaping was wrong, not the CSS. A
context grep settled it. Recorded because a zero from a bad pattern reads
exactly like a real absence — the same over-reading this run has been guarding
against all night.)*

### What this does NOT prove — the caveat stands above the finding

**Presence is not correctness.** This confirms the tier CLASSES exist. It does
**not** confirm the right columns carry them, and it **cannot see an override** —
the phase-5b precedent being `w-field-min`, emitted correctly while the width was
still wrong, because `cn()` does not merge this product's custom spacing names
against `date-picker`'s `w-full`.

### Verification finally stands at three tiers, kept separate in the report

1. **PROVED** — `npm run build` exit 0, and `tsc` clean proves the
   `truncate: true ⇒ cell returns string` contract (a discriminated union that
   cannot compile otherwise).
2. **COMPILED** — the tier classes exist in the production stylesheet.
3. **NOT VERIFIED** — that the right columns carry them; that nothing overrides
   them; scroll ownership (including the `masters/users` breadcrumb and the
   `review` banner, the two highest-risk items); the four zone-3 states; filter
   chips; pinned headers; sidebar modes. All blocked by B1.

**The repo is left building.** That was the run's hard floor and it holds.

---
## A1 — `masters/users` ACCEPTED (verified, not taken on trust)

Close-out delivered in full against all 11 requested items, with a stated
stopping reason. The strongest report of the run. **I verified its load-bearing
claims rather than accepting them:**

- `221f47e` **is** in history (it flagged it might have been rewound; it was not).
- Scroll ownership: `<ListPage>` is in a fragment, not a plain div — line 518 `<>`,
  breadcrumb and template sharing one flex column at 551-552, five modals as
  siblings. Confirmed by reading the file.
- Exactly one `grow: true`. Confirmed.
- `cn` **is** `extendTailwindMerge` (`src/lib/utils.ts`), so the `h-auto` argument
  is structurally sound.
- The shell content box is `mx-auto h-full max-w-content-max overflow-y-auto p-6`,
  as claimed.
- It said "CrudPage is no longer imported" while one occurrence remained — **the
  occurrence is inside an explanatory comment at line 522, not an import.** No
  import exists; the §1 rule 11 chevron is not rendered here. Claim accurate.

**Its Q8 role-gate decision is sound and I checked the premise.** It gated the
Audit Log button on `me.role === 'Administrator'`, knowingly against the project
rule "never gate on a hardcoded role name". Verified:
`model user_audit_logs` does **not** exist in `prisma/schema.prisma` (0 hits);
PLAN.md records it as absent; and `api/masters/users/audit-log/route.ts:21`
itself does `if (user.role !== 'Administrator') return forbidden()`. So the
server's own gate IS a role name, and a permissions-based gate would be **wider**
than the server's — showing the control to people who would get a 403. Matching
the server exactly is the narrower, correct choice. Deliberate, marked, queued:
the "a workaround is acceptable, a silent workaround is not" pattern, correctly
applied.

**Its honesty on the riskiest item is the thing to imitate.** On the breadcrumb's
effect on the height chain it wrote: *"I cannot rule it out statically beyond
that, and I am not going to pretend otherwise… NOTHING was observed. This is the
highest-risk unverified item on my screen. If the PAGE scrolls instead of zone 3
on any future run, that wrapper is the first and only place to look."* It then
reduced its own exposure by choosing `h-auto` deliberately — shrinking the
argument from "flex basis beats height:100%" to "there is no height to beat".

Line count 556 → 843, accounted for as comment rather than code: five modals
carried over byte-for-byte, plus the column classification, the load contract and
the breadcrumb rationale. §9: 8 palette hits, all inside untouched dialog code,
down from 10. `tsc` and `eslint` clean; `status-badge.tsx` 0 across all eight
checks.

---
## A2 — `leads` ACCEPTED, and Q10 — `list-page` has no frozen-column support

`leads-convert` went idle **three times without answering and without stating a
reason** (N8). Rather than ping a fourth time I answered the outstanding
questions myself by inspection, which is more reliable than an unresponsive
worker. Everything below I measured or read directly.

### The line growth — answered, and the honest answer is not "just comments"

Raw `wc -l`: **333 → 755** (not 733; it grew further after my earlier check).

```
BEFORE  total 333 | blank 25 | comment-only   3 | code 305
AFTER   total 755 | blank 32 | comment-only 104 | code 619
```

**Comments explain only 101 of the 422 added lines. Code doubled, 305 → 619.**
That is worth the author's attention and I am not going to file it under
"documentation".

But it is **not** template machinery left in the screen. Verified — all zero:
`setTimeout`, `debounce`, `useDebounce`, `totalPages`, `Skeleton`,
`animate-pulse`, `isLoading`, "No results". Pagination, debounce, skeletons and
the empty states all genuinely moved to the template.

Where the code actually went:
- `leadColumns` ~34 → ~202 lines. Ten columns with per-column tier reasoning,
  plus the frozen-column work below.
- The page component ~89 → ~271 lines. **The screen gained four filters it never
  had** (Type, Stage, Temperature, Active), the option maps for three of them
  loaded from master tables, and client-side application of the three the API
  does not serve.
- `BulkUploadModal` ~165 lines, carried over essentially unchanged.

So: the screen does materially more than it did. Growth is explained, not
excused.

`load` is clean — `if (!r.ok) throw new Error(String(r.status))`, no try/catch,
`signal` passed. The ten `catch` hits are all in modals or sidecar master
fetches, none in `load`. The one `slice(` is the carried-over bulk-upload
preview. `<ListPage>` sits in a fragment at 648-753, no wrapper div.

### Bulk Upload — the precedent held

Both buttons live in zone 1's single `action` slot as
`<div className="flex items-center gap-2">`: **Bulk Upload as `variant="secondary"`,
Add lead as the one primary**, the whole cluster gated on `canEdit`. Exactly one
primary, on the right — §6.1 rule 1 and §11.1 satisfied. Marked at line 668.
`masters/users` independently arrived at the identical shape for its licence
badge and Audit Log button, so **the question asked once tonight got one answer,
not two.**

---

## Q10 — TEMPLATE-LEVEL — `list-page` cannot freeze a column, and puts no `group` on `tr`

The largest template gap found tonight, alongside Q6's missing breadcrumb zone.

**§10 rule 2** permits sideways scroll only for "a genuinely wide table, such as
a ledger with more than eight columns at desktop width, **and then the first
column must be frozen**". `leads` has **ten** columns at 1280 — past that
threshold — and the worker recorded that it scrolls sideways at every supported
width. So freezing is mandatory, and `ListColumn` has no capability for it.

**What the screen does instead**, marked with three `// OVERNIGHT:` comments:

```
className:     'sticky left-0 z-20 border-r border-border-light'
cellClassName: 'bg-surface [tr:hover_&]:bg-surface-sunken font-medium text-text-primary'
```

Three distinct template capabilities are being stood in for:

1. **Freezing itself** — `sticky left-0 z-20` hand-rolled in a screen.
2. **The cell background** — `thead` carries `bg-surface-sunken` across the full
   width and scrolls under the frozen cell, but a body row carries none, so the
   cell must bring its own `bg-surface` or rows show through as they scroll.
3. **The row hover** — re-stated as `[tr:hover_&]:bg-surface-sunken` **because
   the template puts no `group` on `tr`**, so there is no `group-hover` to use.

**`grow` is deliberately NOT set on this screen** — the only one of the four
where that is true, and the reasoning is a real finding about the template:
`grow`'s `w-full max-w-0` only takes slack **when there is slack**, and on a
table that already overflows it collapses the identifier instead — **measured at
32px** before it was removed. (That measurement predates the browser blocker and
is the only other rendered observation the run produced besides the conversations
screenshot.)

So the template's "exactly one `grow`" guidance holds for tables that fit and
inverts for tables that do not. That is worth writing into `list-page`'s own
doc-comments whichever way the author resolves the rest.

**This is precisely what `sfacrm-97` warned against** — "do not build selection
or sorting screen-locally, because a screen-local version is the thing the next
person copies". Freezing was not on its list, but it is the same category. The
workaround is marked at all three sites, so tomorrow's fix is a grep. It should
not be copied to a second screen before the author rules.

---
## V2 — VERIFICATION COMPLETED (author logged in, morning of 18 Sep)

B1 is **resolved**. The author logged the browser in, so the sweep that was
blocked all night was run. `resize_window` was avoided per N7; measurements were
taken in a same-origin iframe at exact CSS widths, with `requestAnimationFrame`
avoided (it does not fire in a backgrounded tab and hung the first attempt).

### Scroll ownership — the run's biggest risk, and it is CLEAN

`PAGE_scrolls: false` on **all four screens at every width tested**. Exactly one
vertical scroller per screen: the zone-3 data area.

| Screen | width | page scrolls | zone 3 (sh/ch) | cols |
|---|---|---|---|---|
| leads | 1280 | **no** | 1552 / 230 | 10 |
| leads | 1024 | **no** | 1304 / 501 | 10 |
| leads | 768 | **no** | 1552 / 501 | **8** |
| masters/users | 1280 | **no** | 521 / 497 | 7 |
| masters/users | 768 | **no** | 764 / 475 | **5** |
| review | 1280 / 768 | **no** | fits | 5 |
| conversations | 1280 | **no** | 772 / 511 | 7 |
| conversations | 768 | **no** | 772 / 511 | **5** |

**Both high-risk items cleared.** `masters/users`' breadcrumb and `review`'s
banner — the two things flagged as most likely to break the height chain — did
**not**. The `h-auto` reasoning held in practice.

### Tier dropping works

leads 10 → 8 (Place, Created By drop below 1024); masters/users 7 → 5 (Email,
Manager); conversations 7 → 5 (Author, Remarks). All exactly as declared. Note
10 columns remain at *exactly* 1024 because `lg:` is min-width 1024 — the tier
name means "hide below 1024", so 1024 itself shows them. Correct, not a defect.

### Frozen first column (Q10) works

`tbody td` computes `position: sticky; left: 0px; background: rgb(255,255,255)`
on leads, at 1280, 1024 and 768. Horizontal scroll confirmed at every width
(1280: sw 1177 / cw 961), so §10 rule 2's freeze requirement is both triggered
and satisfied. The screen-local workaround behaves correctly — **it still needs
the author's ruling on whether it belongs in the template.**

### Pinned headers

`thead` is `position: sticky; top: 0`. Scrolled zone 3 by 600px; header held at
y=204, identical to the zone top. §11.1 satisfied.

### All four zone-3 states forced and seen

1. **Loading** — skeleton rows in the table's own shape, captured on first paint.
2. **Nothing found** — searched `zzzzqqqnomatch`: *"No leads match
   'zzzzqqqnomatch'"*, body *"Nothing matches that search. Clearing it brings
   every lead back."*, **Clear filters** button, meta line *"0 results for…"*.
   §27.1 satisfied — it names what was searched, and does **not** offer "add your
   first lead".
3. **Failed** — forced by overriding `fetch` to reject on `/api/leads`:
   *"Leads could not be loaded"*, *"The server did not answer. Check your
   connection, then try again."*, **Try again** button. **This is the one
   `sfacrm-97` called the most likely bug of the night, and it is correct** — a
   genuinely separate branch, not a skeleton and not "nothing found". §14 rule 3
   satisfied. Restoring `fetch` and clicking Try again recovered the list.
4. **Nothing yet** — not reachable on a tenant with 593 leads; the "nothing
   found" and "failed" branches prove the three-branch structure.

### Filters (§27.3) work end-to-end

Filter opens a **panel**, not scattered controls: Type, Stage, Temperature,
Active, with **Clear all**. Selecting Stage = Existing produced a removable chip
**"Stage: Existing ×"** below the toolbar, a **count badge "1"** on the Filter
button, and narrowed the list 593 → 48. Clear all removed the chip and restored
593. Stage has a search box inside the menu, per §16.3.

### Q4's fix is PROVEN with live data

The Stage dropdown now lists exactly the tenant's master table:

```
dropdown:     Agreement made, Prospect, Contacted, Interested,
              Qualified, Proposal, Negotiation, Existing
master table: Agreement made, Prospect, Contacted, Interested,
              Qualified, Proposal, Negotiation, Existing
```

Eight options against the six the hardcoded vocabulary held. **"Agreement made"
and "Existing" exist only because the fix landed** — and filtering Stage =
Existing returns **48 real leads that were unreachable before**. The defect was
real, not theoretical.

### Q3 confirmed live, and it is cosmetic as logged

"Existing" renders as a badge with the generic fallback icon and its correct
label, because it is in the master table but not the badge vocabulary. Nothing
lies; the icon is simply generic. Exactly as predicted. Still the author's call.

### One observation outside scope

The sidebar measured **260px at 1024** rather than collapsing to an icon rail
(§9 laptop row); at 768 it is correctly 0. This is **shell behaviour, not
migration work** — the shell was not touched by this run and is byte-identical.
It may be the stored sidebar preference overriding the breakpoint rather than a
defect. Flagged, not chased.

## Q11 — DATA LOSS in `weekly-plan`: the "Others" value is saved but never restored

Found during a read-only study of `weekly-plan/page.tsx` requested by
`sfacrm-b6`. **Not part of the conversion scope — this screen was never
touched** — but it is a live bug in current production code.

```
write  (line 92):  notes: entry.others > 0 ? String(entry.others) : ''
read   (line 74):  others: 0        // hardcoded, unconditional
```

`planItemsToDayData` never reads `notes` back. A user types Others = 5, saves,
reloads the week, and sees 0 — while `"5"` sits in `weekly_plan_items.notes`.
**User input is silently lost on every round-trip**, and `notes` is carrying a
number rather than notes.

Not verified against live rows (that needs a DB read), but the code path is
unambiguous. Relevant to any rework: `notes` cannot be treated as free text, and
a planned "Order Value per line item" field must get a real column rather than
joining `others` in `notes`.

Two adjacent mapping oddities in the same function (lines 64-95):
`dist` → `existing_dealers_goal` (name/meaning mismatch), and **`to_place` and
`mode_of_travel` are always written `null`** — already dead from the UI's side.

---

## C4 — CORRECTION from `sfacrm-b6`: `orders.status` DOES have a CHECK constraint

One of its study agents inferred the constraint did not exist, from the absence
of Prisma's `/// contains check constraints` doc-comment above `model orders`.
**The marker is not emitted there even though the CHECK exists**
(`'Draft','Submitted','Confirmed'`). It had recorded `status-badge.tsx`'s comment
as false and has corrected its own gap analysis.

No action here — `status-badge.tsx`'s description is accurate. Logged because the
missing marker is a trap: **absence of the Prisma doc-comment is not evidence
that a CHECK constraint is absent.** Read the constraint, as the repo's own
CLAUDE.md already instructs.

---

## Q12 — Q3 is worse than cosmetic: `orders.entity_type` has a write path that cannot succeed

From `sfacrm-b6`'s live database pre-flight, extending Q3.

`orders.entity_type` carries `CHECK (entity_type IN ('Dealer','Distributor'))` —
two values — while the tenant holds **45 Institutions and 74 End Consumers**. An
order booked against either **fails at write time**. It has never surfaced
because all 8 existing orders have `entity_type` NULL.

So the tenant-editable-master problem in Q3 is not only about badge rendering.
**One of the same values is a live, broken write path.** Q3's three options
should be read with that in mind: whatever is chosen has to cover writes, not
just display.

---

## Q13 — `list-page` has no reorder capability either (4 more screens)

Found while listing the `backHref` screens. Four `/masters/*` screens pass
**`onReorder`** to `CrudPage`: `expense-categories`, `lead-stages`,
`lead-temperatures`, `lead-types`.

`list-page` has no reorder support, so those four cannot be converted without a
second template capability alongside Q10's column freeze. None of this run's
five screens used reorder, which is why it did not surface earlier.

Note these are the same masters whose rows feed the `leads` filter options
(Q4) — they are ordered by `sort_order`, which is also the ordering Q3 notes the
kit has no colour scale to render.

---
## V3 — Q11 QUANTIFIED against the live database (by `sfacrm-b6`)

Q11 logged the Others data-loss bug as an unambiguous code path, explicitly
unverified against rows. `sfacrm-b6` ran the counts:

```
weekly_plan_items total                  455
notes NOT NULL / non-empty                78
notes matching '^[0-9]+$'  (lost Others)  78   <-- 100% of non-empty notes
to_place populated                         0
mode_of_travel populated                   0
```

**78 rows of user input have been silently discarded.** And the unexpected part:
**every single non-empty `notes` value is a number — the column has never once
held an actual note.**

That makes the fix *cleaner* than feared rather than worse: there is no genuine
free text to disambiguate, so all 78 values can be moved to a proper numeric
column mechanically. It also settles that `notes` must not be reused for the
planned per-line order value.

`to_place` = 0 and `mode_of_travel` = 0 confirm the read: **"remove Location
completely" is nearly free** — only the `place` picker is live and nothing reads
the other two, so no read path breaks.

Scroller confirmed at `weekly-plan/page.tsx:504`
(`flex-1 overflow-y-auto space-y-4 pb-4`). The one-line removal is now the
planned fix, with lines 136 (place-picker dropdown) and 667 (audit-log modal)
recorded as legitimate and to be kept.

---

## N9 — Q13 (the reorder gap) changed a downstream build decision

Worth recording because of how nearly it was missed. Q13 came out of a grep run
for a different purpose — listing the `backHref` screens — and the `onReorder`
column was almost discarded alongside a genuinely useless "extras" count that
had matched plain `import` statements.

`sfacrm-b6` was about to build two new masters (Contact Type, Industry/Segment)
on `list-page`, modelled on `lead-types` — one of the four screens that passes
`onReorder`. Since `list-page` has no reorder capability, **those two screens
would have silently lost row ordering**, with `sort_order` present in the table
and nothing able to change it.

They now stay on `CrudPage`, and the reorder gap is recorded as a template
question rather than being solved screen-locally.

Two of this run's findings were caught before shipping as bugs into new screens:
this one, and the **`grow` inversion** (Q10 — `w-full max-w-0` collapses the
identifier on a table that already overflows, measured at 32px). Both were
incidental observations rather than answers to anything asked.

---
