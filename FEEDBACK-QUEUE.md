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

---

## Triaged

_(empty)_

---

## Closed

_(empty)_
