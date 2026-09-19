# Feedback queue — Aryan's walkthrough

Observations collected while Aryan uses the app, to be triaged and fixed **in one pass**
rather than one at a time. Nothing here is acted on until he says go.

**Status key:** `OPEN` recorded, untouched · `TRIAGED` understood and sized · `FIXED` done and
verified · `WONTFIX` deliberately declined, with the reason.

**How to read this file if you are picking the work up:** an entry is what Aryan *observed*, in
his words where possible. The diagnosis underneath it is mine and may be wrong — verify before
building. Where an entry turns out to be a duplicate of something already recorded in
`07-REVISIT-QUEUE.md`, say so rather than fixing it twice.

Environment while testing: local only, `node scripts/dev-local.mjs 3010`, database
`sfacrm_local`. Logins `9000000100` administrator, `9000000101` manager, `9000000102` executive,
all password `dev1234`.

---

## Round 1 — Daily Activity, 18/19 Sep

Aryan's overall verdict on this page: **"overall good work on this page."** The items below are
corrections within something that basically works.

### F1 · Elapsed time showed a NEGATIVE duration · OPEN · **bug, highest priority in this round**

> "-1h -1m as soon as I pressed check-in it show me this after In 11:44 pm in same line I don't
> know why then now it show this 0h 2m so far"

Immediately after check-in the worked-time read `-1h -1m`, on the same line as `In 11:44 pm`. It
later corrected itself to `0h 2m so far`.

*Diagnosis, unverified:* a clock-offset bug. The check-in timestamp and the "now" it is measured
against are not in the same frame, so the first render subtracts a future time. This machine runs
IST while the app's storage is UTC — a 5h30m skew that `07-REVISIT-QUEUE.md` and the handoff both
flag as systemic and pre-existing. **But 5h30m does not equal 1h1m**, so the plain skew is not a
complete explanation and this must not be hand-waved as "the known timezone thing". Reproduce it
before fixing. Note it self-corrected, which points at the *first* render rather than the stored
value.

⚠️ Do not "fix" the machine-wide IST/UTC skew as part of this. That is explicitly out of bounds
in feature code.

### F2 · Show an address, not raw coordinates · OPEN · **small, the plumbing already exists**

> "26.2404, 72.9848 these cordinates are useful but for system people only understand place like
> these might be area let me know if you can put what address is this(if its too much work please
> let me know)"

*Answer to his question: it is not too much work.* P3-T7 already built
`src/app/api/daily-activity/reverse-geocode/route.ts` — a server-side reverse geocode with an
identifying user agent, a 1.1s serial gap, a 24h cache, a 6s abort, and a null address on failure
so an outage never breaks a page. The attendance card just is not calling it.

Keep the coordinates available somewhere (they are the evidence), but lead with the place name.
Must degrade honestly: when the lookup returns null, show the coordinates rather than a blank or
a guess.

### F3 · A future date is reported as "Absent" · OPEN · **wrong, and easy**

> "future date says this Absent / No attendance was recorded on this day. where as how can it be
> absent."

Correct — absence is a statement about the past. A day that has not happened cannot have had
attendance recorded. Needs a third state alongside Present and Absent for "not yet", and the
distinction should hold anywhere attendance is summarised, not only on this card.

### F4 · The attendance block eats the top of the screen · OPEN · **layout, his main complaint**

> "this section is taking lot of space on the top where as it can be a button somewhere so that
> lot of space is saved on screen and this sections \[the Mon 14 / Tue 15 … day strip] can come on
> top"
>
> "since everthing above Meetings / Expenses / Summary is fixed it leave very less vertical space
> to scroll so only very small window is there to see the list"

The whole block — `Present / Day closed / In 11:44 pm / Out 11:49 pm / 0h 4m worked / coordinates
/ "Working hours are closed. Meetings, orders and expenses can still be added for this day."` —
is pinned above the tabs, so the list below it gets a very short scroll window.

Wanted: collapse that block to a compact control, promote the weekday strip to the top.

He explicitly absolved the current design — *"its not your fault earlier design was that only so
I know why it here and its ok nothing wrong just change now."*

⚠️ The sentence "Meetings, orders and expenses can still be added for this day" is load-bearing
and must survive in some form. It exists because §12 closed the decision that **check-out locks
nothing**, and users assume the opposite.

### F5 · One button for both kinds of meeting · OPEN

> "log a past meeting and log a meeting can both be one button and when clicked a form on top can
> have main fomr of log a meeting but inside there can be toggle log a past meet so same form
> structure uses both so that we space one button space. and might be at that place we can put
> checkin-check out."

One button opening one form, with a toggle inside switching it to past entry. The freed space is
where he wants check-in/check-out to live — so F4 and F5 are one layout change, not two.

⚠️ Whatever the form becomes, a past entry must stay **visibly distinct** once saved, and must
still write `is_manual_entry = true` with **null coordinates**. The provenance rule matters more
than the form: a typed time must never be able to pass as a captured one.

### F6 · Drop the entity-type selector from the meeting forms · OPEN

> "in new meeting form we won't need existing , lead or new remove that section and rather than
> that dealer drop down will only come and with a button +create new lead. the heading dealer will
> change to lead of the drop-down in form. same for log a past meet, type record both gone. and
> heading change from dealer to lead."

Remove the Existing / Lead / New selector and the Type/Record selectors. Leave one dropdown
labelled **Lead**, plus a **+ create new lead** action.

⚠️ **Check what the removed selector actually fed before deleting it.** `orders.entity_type` and
`daily_visits.visit_type` are join keys holding values like `Prospect`, `Existing`, `Dealer`, with
**no foreign key behind them**. If that selector was writing `visit_type`, removing it silently
changes what gets stored. Removing the *control* may be right while still writing a sensible
default. Establish this first.

### F7 · "Lead" is the wanted label — ties to the parked terminology decision · OPEN · **needs Aryan**

F6 asks for the dropdown heading to read **Lead**, and for **+ create new lead**. That is
consistent with his partner's instruction to keep "Lead" and change "Party", and it is the first
concrete instance of that choice landing in a screen.

**Do not treat this as the decision itself.** P1-T19 is on hold in `08-EXECUTION-SEQUENCE.md` and
the code currently holds both words (~285 "Lead", ~205 "Party"). Relabelling two dropdowns is
safe and local; a repo-wide sweep is not, and is still his call. Worth asking him whether F6 means
"Lead" everywhere now, or just on these two forms for the moment.

### F8 · Date and time inputs are raw OS controls · OPEN · **my miss, and he is right about it**

> "start time and end time don't have components its not right it uses raw os design which is not
> acceptable. change that. if you didn't got component you should have asked me."

He is correct, and the criticism lands on my briefing rather than on the agent. The manual-entry
brief said "hand-typed Start/End times" and specified no component, so the agent used native
`<input type="time">`, which renders as the operating system's own widget and matches nothing else
in the app.

The kit has `date-picker.tsx`, and `src/components/reports/date-range-control.tsx` is a working
example of building on it. Check `D:\RGB_Software\rgb-kit-v2\AGENTS.md` §20.1 and §27.4 for
whether a time control is specified; if it is not, that is a §30 question to raise with him rather
than a component to invent — **which is exactly what he is telling us to do: ask.**

## Round 2 — Weekly Plan, 19 Sep

A structural rework, not corrections. Aryan is redesigning the screen.

### F9 · The plan becomes a seven-column board, Mon to Sun · OPEN · **the core change**

> "I need a 7 column table with heading mon, tue, till sun and in that there will cards where I
> can plan"

With: a week changer above; **each column scrolling on its own** when its list grows; **horizontal
scroll** when the seven do not fit the screen; a **plus button on each column heading**; and a
**count of line items** on each heading. Desktop view as described.

**This very likely needs no new component.** `src/components/ui/board.tsx` already exists, built
for the Deals Kanban and proven against the database. What it owns is close to an exact match for
what he is describing:

| He asked for | `board.tsx` already does |
|---|---|
| 7 columns | `MAX_COLUMNS = 7`, and it throws past that |
| per-column scroll | 25 cards a column, then Load more (§35.7) |
| count on the heading | header states the TRUE total, never the rendered count |
| horizontal scroll | board view handles the overflow |

The seven-column cap has been an open worry (`HANDOFF.md` Decision B) precisely because
`deal_stages` is user-editable and could exceed it. **Weekly Plan is the one case where seven is
fixed forever**, so the constraint that was a problem for Deals is a perfect fit here.

Verify that against the real component before promising it. But start from "reuse the board",
not "build a grid".

### F10 · Standing offer: he will add missing components to rgb-kit v2 · OPEN · **process, remember this**

> "I don't want to deviate from rgb-kit as this theme is good so if you don't get component tell i
> will get it done in rgb-kit v2"

This is the answer to the §30 gate, from the person who owns the decision. **The rule is now: if
the kit lacks a component, tell Aryan and he will have it built. Do not invent one locally, and do
not silently use a raw HTML control.**

Directly related to **F8**, where a native `<input type="time">` was used because no component was
specified. He made the same point there: *"if you didn't got component you should have asked me."*
Twice in two rounds. Treat it as standing.

### F11 · Remove "Day Focus / Remarks" from each day · OPEN

> "we don't want this Day Focus / Remarks on each day"

### F12 · Remove the Dist / Dealer / Others counts from each line · OPEN · **closes an open decision**

> "we don't need this \"Dist. Dealer Others\" in each line item"

**This answers `HANDOFF.md` Decision C**, which read: *"Do the Dist/Dealer/Others counts survive
§5.1? A plan row is now one party, not a place, which arguably retires them. Preserved to keep the
choice open."* They are retired. Record the decision as closed by Aryan on 19 Sep, and check
whether anything downstream reads those counts before deleting them.

### F13 · Card contents, and the add-party form · OPEN

> "card can have firm name and in next line type and next to it might be expected or agenda of the
> meet (for this we can make add party thing as form only with selection of party name and agenda
> of the meet( optional))"

Card: **firm name**, then **type**, with the **agenda** beside it. Add-party becomes a form with a
party selector and an **optional** agenda.

⚠️ This is significant beyond the visual. **All 54 seeded `weekly_plan_items` currently have
`party_id = NULL`**, which is why "Not Met", the ticked/open split and the planned-versus-met
headline read zero everywhere in Weekly Review and the Team Summary. A plan row that is built
around choosing a party is exactly what makes those figures real. Flag to Aryan that this fix
lights up several numbers elsewhere.

Agenda is a new field — check whether `weekly_plan_items` has a column for it before assuming one.

### F14 · Where does "Upcoming week I want to Achieve" go · OPEN · **he is undecided, needs a proposal**

> "Now I am confused where will we put this section Upcoming week I want to Achieve we might put
> this in end small vertical space with full width and internal scrolling can be thought."

His own suggestion, held loosely: at the end, full width, short, scrolling internally. He is
thinking aloud rather than instructing — worth coming back with a recommendation rather than just
implementing the first idea.

⚠️ Do not lose it in the redesign. It is §5.1's weekly priority points, and **Weekly Review reads
the same data** — its ticked-versus-open list is driven by these. Whatever happens to the UI, the
data has to keep flowing to that screen.

### F15 · This reworks work already shipped · OPEN · **scope note, not his words**

P3-T3 (Weekly Plan screen rework) is already built and committed, and P3-T4 built the manager
approval screen on top of it. A seven-column board is a second rework of the same screen.

Before building: check what the approval screen consumes from the plan screen, so the redesign
does not quietly break the manager's view of it. The two were written to share the plan's shape.


## Round 3 — Orders, Parties, Deals, Masters, 19 Sep

### F16 · Create Order uses a raw OS dropdown · OPEN · **same fault as F8**

> "Order page crate order page is again having raw os for drop-down which is not acceptable. based
> on the rgb-kit fix it. previous screens are not having this issue in with drop-down list."

He is right that this is isolated — the other screens use the kit's `Select` / `SearchableSelect`.
Third time in three rounds that a raw control has been used where a kit component exists. Per
**F10**, if something is genuinely missing, ask him.

### F17 · Drop "record type" on the order form · OPEN · **same shape as F6**

> "record type is not need rather than that simple heading with drop down and create new lead
> button"

Identical treatment to F6, and the same warning applies: **check what that selector writes before
removing it.** `orders.entity_type` is a join key with no foreign key behind it.

### F18 · The order line-item row is badly built · OPEN

> "Product / Qty / Rate / Discount / Total / Select product... / Or type name... / 1 / 0 / None /
> rupee / rupee 0.00 -- this section is poorly made its design has be working again"

"Select product…" and "Or type name…" sitting side by side is two competing inputs for one field.
A bare currency symbol next to a formatted amount says the same thing twice. Needs redesign, not
patching.

⚠️ **Behaviour must not change while restyling it.** Pricing is server-authoritative: the browser
sends a quantity, the server reads the rate from `products.price`. That was proven by posting a
forged rate and having it ignored. Any redesign keeps that property.

### F19 · Headings sit below content on Parties and Deals · OPEN

> "parties and deals page have heading below something which is not acceptable heading are always
> meant to on top of the page no matter what"

A page title belongs at the top, above alerts and toolbars. Likely caused by **F20** — the
data-health banners were inserted above the heading rather than below it.

### F20 · The data-health banners are far too tall · OPEN · **first real look at these**

> "7 parties are incomplete / Missing a primary address, city, state, pincode or GST number — an
> order against one stays in Draft. / 15 parties have no deal / Nothing in the pipeline is tied to
> these parties yet. — are so big in terms of vertical width that it doesn't looks good"

This is the visual pass nobody had done — these banners were verified server-side only and had
never been looked at. His reaction is the answer.

Two stacked two-line banners above the list is too much. The counts and the explanations are both
right; the format is wrong. Consider one compact line with the detail on demand.

⚠️ Keep **what** is missing. §7.7 explicitly requires that an incomplete party says which fields
are absent — a bare count was the thing that requirement existed to prevent. Shrink the
presentation, not the information.

### F21 · "Parties" becomes "Leads" · OPEN · **third signal — Aryan should now settle P1-T19**

> "change parties to leads"

With **F6** and **F7**, that is three separate requests pointing the same way, plus his partner's
original instruction. The direction is not in doubt any more; only the scope is.

**Ask him directly: rename everywhere now, or screen by screen as he meets it?** Renaming one page
is safe. The repo holds ~285 "Lead" and ~205 "Party", and P1-T19 is a sweep over all of it.
⚠️ Whichever he picks: **do not rename master VALUES** (`Prospect`, `Existing`, `Dealer`) — they
are join keys in `orders.entity_type` and `daily_visits.visit_type` with no foreign key behind
them.

### F22 · The Contacts tab has no create button · OPEN · **missing function, not styling**

> "contact tab doesn't even have create contact button"

### F23 · Remove location masters and territory mapping · **FIXED (planning half)** · ⚠️ **TWO READINGS, ONE IS DESTRUCTIVE — ASK BEFORE TOUCHING**

> "In masters we don't need this section of location and that territory mapping so we can delete
> its entire logic as we were using it for weekly planning where we used to say in x location i
> will do y meetings but now we are directly saying to whom we are going to meet so remove it."

His reasoning is sound and the intent is clear. But "location" covers two different things here,
and I checked the database:

**Safe to remove — this is what he is describing:**
- `user_territory_mappings` table and the `masters/territory-mapping` page
- `weekly_plan_items.from_place`, `.to_place`, `.mode_of_travel` — the "from X to Y" planning model
- `.new_dealers_goal`, `.existing_dealers_goal`, `.others_goal` — the counts **F12** retires

**NOT safe to remove — deleting these breaks live data:**
- `states`, `districts`, `talukas`, `villages`. **Eleven foreign keys point at them**, from
  `companies` and `company_addresses` (`state_id`, `district_id`, `taluka_id`, `village_id`), plus
  the hierarchy's own internal links.
- **City, state and pincode drive the completeness rule** — the very gate quoted in F20's banner,
  and the reason an order against an incomplete party stays in Draft. Removing the address
  hierarchy would break party completeness and the order gate with it.

So: retire location as a **planning** concept, keep it as an **address** concept. Confirm that
reading with him before deleting anything. The masters pages for states/districts/talukas/villages
are a separate question from the territory mapping — he may want those hidden rather than deleted.

### F24 · Review shows the lead, not the location · OPEN · **follows from F23**

> "based on this location thing review will also change as now since the person is filling lead
> name in plan that only will be visible in review."

Correct and consequential. Anything rendering `from_place` / `to_place` moves to showing the
party. This touches Weekly Review and the Team Summary, both committed today.

Related to **F13**: plan rows gain a party, which is what makes "Not Met" and planned-versus-met
real. Note `weekly_plan_items` has `party_id`, `party_type` and `expected_order_value` already,
**but no agenda column** — F13's optional agenda needs one, or a decision to reuse `notes`.

---

## Triaged

_(empty)_

---

## Closed

_(empty)_

---

## Closed detail

### F23 — fixed 19 Sep, as the narrow reading

Territory mapping removed from UI, API and the masters registry. The address hierarchy was left
entirely alone, which was the point of scoping it this way.

Verified after the change: `/api/masters/territory-mapping` 404s, `states` and `districts` still
return 200, and company completeness is unchanged at **13 complete of 20** with all 20 still
carrying a `state_id`. That last number is the regression that mattered — completeness is what
holds an order against an incomplete party in Draft.

**Still outstanding, for Aryan:** the table itself was not dropped, because an agent may not run
DDL. Nothing in the app reads it now.

```sql
DROP TABLE user_territory_mappings;
```

Self-contained: no other table has a foreign key into it. Two seed scripts still write rows to it,
harmlessly, and would need a line removed when the table goes.
