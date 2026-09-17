# Open for the author — 17 Sep 2026

Questions the documents do not settle, raised during phase 1. Each site named
here is **left untouched** and the worker has moved on. Nothing blocks.

Opened by the review session (sfacrm-01). Read-only: this file records
questions, it does not answer them.

---

## 1. §11's rows flatten hover into resting on 52 lines

**Status: RATIFIED 17 Sep 2026. Closed as a product question, reopened as a KIT
finding — see the closing note.** 59 declarations, 52 distinct lines, 41 of them
in the ten phase-1 files.

`AGENTS.md` §6.4, first line: *"Every interactive element defines four states:
resting, hover, pressed, disabled. **Hover changes the background.** Pressed
changes it further."*

Several §11 rows collapse two palette shades onto one token. Where a call site
used those two shades to express resting versus hover, the hover becomes a no-op
after conversion — the element renders identically in both states.

```
daily-activity:282, :379
  before  text-blue-600 hover:text-blue-700  bg-blue-50 hover:bg-blue-100
  after   text-primary  hover:text-primary   bg-primary-subtle hover:bg-primary-subtle
```

Both halves come from rows that are correct in isolation: §11.3 maps
`bg-blue-50/100/200` → `bg-primary-subtle` and `text-blue-500/600/700/800` →
`text-primary`. Neither row is wrong. The loss only appears where one element
uses two shades from the same row.

By affected row:

| Row | Declarations |
|---|---|
| `bg-primary-subtle` / `text-primary` | 23 |
| status background (`bg-*-bg`) | 20 |
| status text (`text-*`) | 12 |
| `border-primary-border` | 2 |
| `bg-surface-control`, `bg-primary-pressed` | 2 |

**§11.3 already saw this shape once and fixed it there only.** It split
`hover:bg-primary-hover` out of the `bg-blue-700` row with the note *"a hover is
not a pressed state (§6.4), so the hover half is split out here."* The same
argument applies to the five rows above and no split was made for them.

**Why this is not a lookup.** The tokens do not exist. `globals.css` declares
`primary-hover`, `primary-pressed`, `surface-control-hover`,
`surface-control-pressed`, `danger-hover`, `danger-pressed` — and nothing else
in that shape. There is **no `primary-subtle-hover`, no `success-hover`, no
`warning-hover`**. §11.4's closing rule names hover and pressed states for the
danger button alone; a filled success or warning button has no hover token at
all (`daily-activity:1280` `bg-green-600 hover:bg-green-700`, `:1286`
`bg-amber-500 hover:bg-amber-600`).

Answering this means either adding tokens to the system or accepting that these
elements lose a state. Both are yours.

**Three shapes are mixed in the 52 and may want different answers:**

1. **Subtle-fill controls** — `bg-primary-subtle hover:bg-primary-subtle`. Needs
   a `primary-subtle-hover`, or the hover moves to another property.
2. **Filled status buttons** — §11.4's closing rule covers danger; success and
   warning have no hover or pressed token.
3. **Text-only hovers** — `text-primary hover:text-primary`. §6.4 says hover
   changes the *background*, so an element whose only hover was a text-colour
   shift may never have complied. Whether it gains a background or keeps a
   flattened text hover is a design call.

Full list: the review session holds it and will paste it on request.

### Ratified — 17 Sep 2026

The 52 lines stay untouched in full, both halves, protected in `sites.py` as a
phase-1 residue **distinct from A–G**: a row defect, not an element-identity
question, and §11.6's preamble is explicit that it contains only the latter. The
worker was caught mid-edit filing it as a group H inside §11.6 and redirected to
its own section.

**The gap is the kit's, not this product's.** §6.4 requires four states on every
interactive element; `globals.css` can express hover for `primary`,
`surface-control` and `danger` only. `primary-subtle` has no hover partner, and
`success` and `warning` have none at all — so a filled success or warning button
cannot satisfy §6.4 with the tokens that exist. §11.3 split
`hover:bg-primary-hover` out of one row and could not do the same for five
others for exactly that reason. Recorded in the plan as a KIT finding, in the
shape of §4 item 7, for the author to take to `rgb-kit-v2` after this phase.
Neither session invents a token; neither edits the kit from here.

---

## 2. §11.6 G6 was added to an APPROVED section without you

**Status: RATIFIED 17 Sep 2026. Stands as committed.**

Commit `e85a6c0`, "Add section 11.6 G6: fourteen occurrences whose row does not
fit", was written by the working session on its own judgement. It is plan-only
and changes no code.

What it does:

- Adds a seventh group, G6, deferring 14 occurrences that §11.4 currently maps.
- Moves the approved mapped figure **2,349 → 2,335**.
- Moves the UNMAPPED headline **86 → 100**.

**The reasoning looks sound.** Its case is that §11.4's background row was
measured against a badge ground, where the token sits behind dark text and the
text carries the signal; where the shape *is* the signal — a dot, a stripe, a
bar, a legend swatch — `success-bg` at 1.10:1 on `surface` has nothing left.
That is the same argument §11.6 A already makes for the attendance dots, and it
is the kind of thing only reading the call site can find.

**It is still an amendment to an approved section, made by the session doing the
work, reducing the approved figure.** §11.7 says it twice: *"An approved number
that changes silently is not an approved number."* This one did not change
silently — the commit message states the arithmetic openly — but it changed
without you.

I have not asked for it to be reverted. Reverting an amendment to an approved
section is itself amending one, and that is not mine either. It stands in the
tree awaiting your ratification, and the worker has been told to route any
further amendment here rather than commit it.

### Ratified — 17 Sep 2026

**2,349 → 2,335 stands, G 38 → 52, headline 100.** The reasoning holds: a
background role measured against a badge ground has nothing left where the shape
is the signal, and 1.10:1 on white is not a signal.

The process correction was delivered to the worker once and is not being raised
again. The rule it broke is not about whether an amendment is *good*: an
approved section that changes without the person who approved it seeing it
produces a good amendment and a bad one that look identical until someone reads
the diff. It binds the review session equally — I route amendments, I do not
commit them.

---

## 3. `daily-activity:217` — does "line-level" reach outside the ternary?

**Status: OPEN. One line, one occurrence. Left as committed meanwhile.**

```
{`bg-white rounded-2xl border overflow-hidden transition-all ${
   visit.status === 'Active' ? 'border-amber-300 shadow-md shadow-amber-50'
                             : 'border-gray-200'}`}
```

Your rule: *"G is line-level where a ternary's branches are one element,
occurrence-level elsewhere."* G5 protects `shadow-amber-50` inside the Active
branch, and the two branches are the Active and non-Active states of one card —
so the branches are protected and `border-amber-300` and `border-gray-200`
revert. I have instructed that much, because it follows under any reading.

`bg-white` is the open question. It sits **outside** the ternary, in the static
part of the template literal. "Line-level" read literally covers it;
"the ternary's branches" read literally does not. It is currently converted to
`bg-surface`.

This will recur — a static prefix plus a stateful ternary is the commonest
className shape in this codebase — so the general answer is worth more than the
site.

---

## 4. `daily-activity:1536` — §33.3 settles the tab hover, but visibly

**Status: OPEN. Site protected as §11.9 meanwhile, so nothing renders wrong.**

```
old: 'border-transparent text-gray-500 hover:text-gray-700'
```

`AGENTS.md` §33.3: *"Resting tabs are `text-secondary` and go `text-primary` on
hover."* That settles the site outright — `text-text-secondary
hover:text-primary` — and resolves the collapse §11.2's exception creates here.

I have not instructed it, because it changes a resting tab's hover from dark
grey to indigo, and that is a fourth visible change. The site is protected as a
§11.9 hover-collapse line meanwhile, which is correct but leaves two raw palette
classes in the residue.

Note this is not only about one line: §33.3 describes the whole tab bar, and
applying it properly is a §33 job rather than a colour one. If the answer is
"yes, §33.3 governs", it may belong to phase 9 rather than here.

---

## 5. Recorded, not open — decisions already made

Listed so the sections above are not read as the whole of what came up.

- **§11.5's thirty chip conversions** are an expected visible change. Decided by
  you; the visible-changes line now names three, not two.
- **The G1 ternary halves** at `daily-activity:361` and `review/[userId]:417` —
  both branches untouched in full. Decided by you; G is line-level where a
  ternary's branches are one element, occurrence-level elsewhere.
- **§11.1's border-gray row** 221 → 233, **§11.6 F** 8 → 6, and §11.7's restated
  basis — decided by you, transcribed by the worker.

---

## Item 3 — does line-level protection reach outside the ternary?

Raised 17 Sep 2026 by the converting session, during file 1.

`daily-activity:217`:

```
<div className={`bg-white rounded-2xl border overflow-hidden transition-all ${
  visit.status === 'Active' ? 'border-amber-300 shadow-md shadow-amber-50'
                            : 'border-gray-200'}`}>
```

`shadow-amber-50` is §11.6 G5 and `border-amber-300` / `border-gray-200` are the
two branches of the same element, so all three stay raw under the ternary rule.
**`bg-white` is on the same line but OUTSIDE the ternary**, in the static part of
the template literal.

Read narrowly, the rule protects the ternary and `bg-white` converts to
`bg-surface`. Read broadly, "line-level" means the line and it stays raw.
**Converted meanwhile**, which is the reversible direction — if the rule is read
broadly it reverts with the rest.

This recurs: the same shape is in `review/[userId]:354` and anywhere a card's
static classes share a line with its state ternary.

## Item 4 — §11.1's active-tab row against §11.3's generic border row

Raised 17 Sep 2026 by the converting session; the reviewer raised the token half
of it independently.

`daily-activity:1536` is an active-tab accent:

```
${activeTab === t.id ? 'border-blue-600 text-blue-600'
                     : 'border-transparent text-gray-500 hover:text-gray-700'}
```

Two rows reach `border-blue-600`. §11.3's generic row sends every
`border-blue-*` to `border-primary-border`. §11.1 has a row that names this
element type — `border-gray-900` → `border-primary`, count 1, noted "active tab
accent, §33.3" — and AGENTS.md §33.3 requires "a **2px** `primary` accent along
its bottom edge". `border-primary-border` is `#D2D0E4`, a border tint, not an
accent, so applying §11.3 here leaves this codebase's two active-tab accents
rendering different colours.

**The site is left raw in full and is not converted either way**, because it is
also an §11.9 collision (§11.2 promotes the resting `text-gray-500` to
`text-secondary`, which is where `hover:text-gray-700` already lands) and the
ternary's branches are one element. Leaving it raw is a declared deferral;
writing the wrong token would be a defect. **Which row governs an element that two
rows both reach is an §11 question, not a conversion one.**

Related, and also the author's: §33.3 says "Resting tabs are `text-secondary` and
go `text-primary` on hover", which would settle the hover half outright — but
that changes a hover colour visibly, so it is outside the three declared changes.

## Item 5 — territory-mapping's four-level checkbox accent hierarchy

Raised 17 Sep 2026 by the converting session, during file 9.

`masters/territory-mapping/[userId]` colours its checkboxes by hierarchy level:

```
:320 :356  accent-blue-600     district  -- HAS a row (11.3 -> accent-primary)
:378 :405  accent-green-600    taluka    -- G3, no row
:423 :450  accent-purple-600   village   -- E / G2, no row
:462       accent-orange-500             -- G3, no row
```

**One categorical set across four levels, and only the first level has a row.**
Applying §11.3 to the blue alone paints level 1 in brand indigo while levels 2,
3 and 4 stay raw — half-migrating a categorical set, which is the shape the
one-element rule exists to stop, and which §11.8's exit check would read as clean
because the blue would be correctly converted and the rest correctly declared.

G3 already argues these are "categorical by hierarchy level, not status" and that
`accent-` is not reachable by the token layer the way the four mapped prefixes
are. That argument covers the blue exactly as much as the green.

**All seven left raw.** Whether `accent-blue-600` keeps its §11.3 row when it is
one level of a categorical hierarchy is an §11 question, not a conversion one.

---

## Item 6 — ordered and categorical sets flattened onto status tokens

Raised 17 Sep 2026 by the review session's end-of-phase pass; reverted and
recorded by the converting session. **Three sets, all reverted to raw, none
decided here.**

**The shape is one thing seen three times.** Each is a set whose members use
*different shades of the same or adjacent hue families to separate categories*.
§11.4 routes those shades to one role, because for a status that is exactly
right — `green-100` and `emerald-100` are both "success". For a set that used
the two shades to mean two different things, it destroys the distinction. This
is §11.6 G6's argument arriving through a map literal instead of a dot.

### 6a. `leads/page.tsx:12-17` — `STAGE_COLORS`, a six-step ordered pipeline

Prospect → Contacted → Interested → Qualified → Proposal → Negotiation.

**Proposal (`bg-amber-50`) and Negotiation (`bg-orange-50`) both became the
byte-identical string `'bg-warning-bg text-warning'`** — two of six stages
rendering as the same chip. `Interested` and `Qualified` are already raw under
§11.6 F, so the map was four tokens and two raw with two of the four colliding.

§11.5 names this case: "Colour that separates one category from another and
means nothing in itself has a vocabulary already." Whether an *ordered* pipeline
is categorical (§21's palette, capped at six — this is exactly six) or ordinal
(§21's sequential ramp) is the question. **The whole map is raw.**

### 6b. `masters/users/page.tsx:26-31` — `ACTION_COLORS`, an audit-action set

**`created` (`bg-green-100`) and `reactivated` (`bg-emerald-100`) both became
`'bg-success-bg text-success'`** — two distinct audit actions, one chip. Whole
map raw.

### 6c. `companies/[id]/page.tsx:46-50` — `CLS_STYLES`, and it diverges from phase 2

A five-step **ordinal** usage scale: actively_using → passive → low_usage →
not_using → dormant_enabled. Converted to success / warning / primary / danger /
surface-control — four status roles and the brand, for a scale that measures
degree rather than state.

**Its live twin is `lib/usage-intelligence.ts:17-21`, which phase 2 deferred**
on the grounds that it is ordinal and no row fits ordinal. §11.6 C's reason —
"the two maps must not diverge" — applies across phases as well as within one.
**Raw, and it must be settled together with phase 2's copy.**

### 6d. `leads/page.tsx:21-23` — `TEMP_COLORS`, a three-step ramp with the brand at one end

Found by phase 2 from the opposite direction. Cold → Warm → Hot is an **ordered
temperature ramp**, not three statuses.

```
Cold: bg-blue-50  text-blue-700   ->  bg-primary-subtle text-primary
Warm: bg-amber-50 text-amber-700  ->  bg-warning-bg     text-warning
Hot:  bg-red-50   text-red-700    ->  bg-danger-bg      text-danger
```

**The cold end rendered in the product's brand colour**, which says "primary",
not "coldest of three" — the second time in this one file that a category set
wore status tokens.

It is also §11.6 C's two-copies problem across the phase boundary. The twin at
`masters/lead-temperatures/page.tsx:9-12` is **byte-identical** to the pre-phase
original, and it is backed by `lead_temperatures` master data with its own CRUD
page and a `?? 'bg-gray-100 text-gray-600'` fallback on `:18` — C's exact
mechanism, a seventh category falling to grey silently. Phase 2 has deferred its
side. **Raw, and settled with that copy.**

### Also fixed, and it had a home already

`companies/[id]:272-273` and `:286-287` are **not** part of this item. The
stacked usage bar and its legend are one five-segment set; §11.6 G6 correctly
took `bg-emerald-400`, `bg-amber-400` and `bg-blue-400` and **missed two**,
because `bg-gray-300` and `bg-red-300` sit in §11.1 and §11.4 rows the G6 sweep
did not cross-check. They converted to `surface-control` `#f5f5f5` and
`danger-bg` `#fee2e2` — both near-white on a white card, so two of five bar
segments had no visible presence and two legend dots went blank. **Placed in G6
with their three siblings**, not routed here.

**But G6 itself needs re-deriving, and that IS an amendment.** G6 was reasoned
from §11.4's *background* row, so it caught the status-coloured shapes and only
those. The identical failure arrives through §11.1's neutral row and §11.4's
badge row as well. Measured on white, before → after:

| Row | Conversion | Contrast on white |
|---|---|---|
| §11.1 neutral | `bg-gray-300` `#d1d5db` → `bg-surface-control` `#f5f5f5` | **1.47:1 → 1.09:1** |
| §11.4 badge | `bg-red-300` `#fca5a5` → `bg-danger-bg` `#fee2e2` | **1.90:1 → 1.22:1** |
| §11.4 background | `bg-emerald-400` → `bg-success-bg` `#dcfce7` | 1.92:1 → **1.10:1** |

**Rather than re-derive G6 row by row, phase 2's sentence removes the need to:
WHERE THE SHAPE IS THE SIGNAL, NO PALE TOKEN CARRIES IT, WHICHEVER ROW DELIVERED
IT.** That is the rule; the rows are just three ways of arriving at it.

Recorded here rather than written into §11.6, which is approved. **Note the
consequence for anyone re-running the sweep:** G6 is now a 16-occurrence list
known to be derived from one of three possible rows. A sweep against §11.4 alone
reproduces the original 14 and concludes the group is complete.

*(An earlier draft of this table quoted 1.04:1 for `surface-control`. That figure
is `surface-control` on `surface-sunken`, not on white. Corrected after
independent recomputation with the WCAG relative-luminance formula; no
disposition changes, since 1.09:1 is no more a signal than 1.04:1 was.)*

### How the miss happened, twice, and the check that stops it

`sites.py`'s note on the `companies` site read **"legend dots, 3 categories fixed
in code"**. The code declares **five**. The undercount reached the protection
registry as well as the row — which is why two of five converted, and then why
the first revert put back three of four and left `:285` behind, leaving the bar's
`dormant_enabled` at `bg-gray-300` while its own legend key was
`bg-surface-control`: a legend not matching the thing it labels, which is worse
than the original defect, where at least the two agreed.

**When a set is the unit, verify the set.** `scripts/migrate/verify.py` now takes
a `blocks` declaration — line ranges that must be byte-identical to the pre-phase
blob *as a block* — and both usage-bar literals and `CLS_STYLES` are declared
under it. Sampling named lines is what let this through twice.

## Item 7 — two plan counts drifted, and one §11.3 row that must not be applied

**Counts.** §11.6 G1 records 20 and measures **22**. §11.9 records 34 lines / 80
declarations, which counts the *collapsing* declarations only — the residue
actually left on those lines is **91**, because leaving a line untouched in full
also strands its non-collapsing classes (mostly `text-white`). Both figures move
again after item 6's reverts. Neither changes any site's disposition. Recorded
rather than edited, because both live in approved sections.

**A row that must not be applied.** §11.3 maps `accent-blue-600` →
`accent-primary`, 2 occurrences, and both are at
`territory-mapping:320` and `:356` — levels 1 of the four-level checkbox
hierarchy in item 5. The row is correct in general and wrong there. Item 5 has
the reasoning; this is the note that the row itself needs a carve-out or the
next sweep re-applies it.

---

# PHASE 2 — the remaining 41 files

Raised 17 Sep 2026 by the phase-2 converting session, during the pre-flight,
before any file was touched. Every site named here is **left untouched** and the
worker has moved on. Nothing blocks.

Scope: 957 palette occurrences across 41 files, measured on `main` with §12's
method. §12 says "the remaining 42 files"; one of its 42 holds no palette class,
so the 957 is exact and the file count is 41. The classification was cleared by
the review session (sfacrm-01) on 17 Sep; **conversion was not**, and none of it
has run.

    957 = 752 straight row conversions
        +   6 §11.5 manual (conversations/page.tsx only)
        + 199 deferred, on 94 lines

The deferral registry is `scripts/migrate/sites-phase2.py` — deliberately a
separate file from phase 1's `sites.py`, which is not edited from here. It
validates against `main`: every protected occurrence exists at its line, every
`white` line carries a `text-white`, every `exceptions` line carries a grey text
shade, and the three counts above reconcile to 957 with nothing left over.

### What has been proved before conversion, and what has not

The whole phase was run as a **dry run** in a scratch tree staged from `main` via
`git cat-file blob` and written out as CRLF, which is what a fresh worktree under
`core.autocrlf=true` produces. Three results:

1. **The registry is complete.** `tokens.py` raised `Unmapped` on **nothing**.
   No occurrence in the 41 is left for the engine to guess at — which is the
   property that matters, because the engine stopping is the only thing between
   a missing row and a silently wrong token. 752 mapped by row, 6 applied by
   hand, 199 left raw.
2. **§11.8's exit check passes on all 41** — every protected site byte-identical
   to its pre-phase blob, no palette class outside the declared groups, and
   line-for-line with the blob with line endings normalised. Residue **199**,
   exactly as declared.
3. **No set in these 41 files is half-converted**, and the extent of every set
   was **derived, not declared**. Phase 1's `scripts/migrate/literals.py` walks
   the source for the enclosing object/array literal of each palette line; armed
   against this registry it finds **23 literals holding 65 palette lines, and
   every one is uniform** — wholly deferred or wholly converted. Zero mixed, so
   nothing in phase 2 needs a `mixed_ok` acknowledgement. That includes every
   set this document argues about: `StatusBadge`'s nine entries (literal 1–11),
   `usage-intelligence`'s five (16–22), `ToastContext`'s four (10–15),
   `Header`'s three (26–30), `lead-temperatures`' three (9–13) plus its fallback,
   `conversations`' three (40–44), `masters/page`'s four cards (7–41, 42–67,
   68–93, 94–119) and `points`' four-branch medal ternary (187–192).

   **Zero mixed literals is a weaker claim than it sounds, and should be read
   narrowly.** It says every set is internally *consistent* — no literal is half
   in tokens and half raw. It says nothing about whether any of them is
   *correctly disposed*. `StatusBadge`'s literal is uniform because all nine
   entries are deferred; whether it should be deferred at all is **P1**, still
   open. Uniformity is a property of the registry. Correctness is still the
   eleven items below. This is §15's *"coverage can be derived; disposition
   cannot"* observed from phase 2's side: the walker removed the whole class of
   miss where a set is half-converted, and moved none of the eleven.

   Two by-products of deriving rather than declaring, both of which would
   otherwise have been typed and could therefore have been typed wrong:
   **`masters/page`'s unit is each card object, not the `SECTIONS` array** —
   which is the right granularity for P4 — and **`dealers:187–208` is one
   literal containing all three of P7's sibling lines**, so "those three are one
   control" stops being an argument and becomes a derivation.

**What none of that proves is that the mapping is right — and §15 is now the
statement of why.** The registry check verifies that the engine raises
`Unmapped` on nothing; §15: *"None of them can see a row applied where it does
not belong… A wrong token is indistinguishable from a right one to every check
this phase owns."* That argument is not restated here, because §15 makes it
better and from five defects' worth of evidence rather than from one phase's
dry run. Two consequences specific to phase 2:

- **The three results above are all completeness results.** Nothing in them
  reaches disposition. §15's corollary is the exact line: *"Coverage can be
  derived; disposition cannot."* The literal walker is the derived-coverage half
  and the eleven items below are the half it cannot do.
- **§15 says the open items are "this phase's real output, not its leftovers."**
  That is why they are worth answering before 37 commits land, and the cost
  asymmetry is one-sided: re-running the dry run is cheap now that it exists,
  re-doing 37 commits is not, and P1, P4 and P8 could each change which sites
  are protected.

*(First attempt at result 3 passed vacuously — it was run against the dry run's
**output**, where the converted lines hold no palette class any more, so "mixed"
could never be observed. That is the failure `literals.py`'s own docstring names:
"its incompleteness looks identical to success." It now stages pristine content
and asserts 957 palette classes are present before it will report a verdict.)*

Two things phase 1 never had to weigh, and both changed how this was read:

- **Nine of the 41 are shared components** (`CrudPage`, `SearchableSelect`,
  `StatusBadge`, `Modal`, `Header`, `Sidebar`, `Toggle`, `CalendarPicker`,
  `RemarksPanel`) plus `contexts/ToastContext`. A wrong token in one renders on
  every screen, not one, so those were read ahead of the per-file counts. Six
  of the nine open items below are in them.
- **Phase 2 is a colour pass and consolidates nothing.** Several of these files
  duplicate each other and several duplicate a kit component (§14). That is a
  different job and is not attempted here. But it is *why* four of these items
  cannot be answered as colour questions: the duplicate has to be resolved
  before the colour can be.

§11.6 G3 (`accent-` on a status family) and G5 (coloured shadows) **do not
recur** — there is no `accent-` and no `shadow-` palette class anywhere in the
41. Prefixes present: `text` 488, `bg` 239, `border` 158, `ring` 69, `from` 1,
`to` 1, `divide` 1.

---

## P1. `components/ui/StatusBadge.tsx` — one status vocabulary, seven entries with tokens and two without

**Status: OPEN. All 20 occurrences left raw, in full. 10 lines.**

```
:2   Draft:               'bg-gray-100 text-gray-600'      -> surface-control / secondary
:3   Submitted:           'bg-blue-100 text-blue-700'      -> primary-subtle / primary
:4   Approved:            'bg-green-100 text-green-700'    -> success-bg / success
:5   Rejected:            'bg-red-100 text-red-700'        -> danger-bg / danger
:6   'On Hold':           'bg-yellow-100 text-yellow-700'  -> warning-bg / warning
:7   'Edited by Manager': 'bg-purple-100 text-purple-700'  -> NO ROW
:8   Resubmitted:         'bg-indigo-100 text-indigo-700'  -> NO ROW
:9   Active:              'bg-green-100 text-green-700'    -> success-bg / success
:10  Inactive:            'bg-red-100 text-red-700'        -> danger-bg / danger
:15  fallback             'bg-gray-100 text-gray-600'      -> surface-control / secondary
```

The two without a row are **already deferred by name elsewhere, at sites these
groups do not list**:

- `:7` is **§11.6 E's own element**. E names `(protected)/page.tsx:93` for the
  "Edited by Manager" chip and describes it as *"a weekly-plan status, one of
  seven; §2.4 has no token for it"*. This is that chip in the shared component
  every screen actually renders it through.
- `:8` is **§11.6 F's** `bg-indigo-100 text-indigo-700`, which F does name here.
  It is also E's gap restated: "Resubmitted" is an eighth weekly-plan state, and
  §2.4 has three roles.

**The question is not what the two become.** It is whether the other seven move
without them. Converting seven leaves one shared, app-wide status vocabulary
half in tokens and half in raw palette — and unlike the phase-1 analogues, this
map is not local to a screen. §11.6 C's argument is the closest precedent
("settled… together, because the two maps must not diverge"), and `sites.py`
implements C at line level for exactly that reason. But C's sites were two
copies of one map; this is one map with a hole in it, which C does not address.

A coherence judgement, not a row lookup. Both readings are defensible and
whichever is taken should be written down, because the same shape is waiting in
`lead-temperatures` (P5) and `ToastContext`.

**Phase 1 has already answered this shape once, and the answer was "the set goes
raw whole".** `leads/page.tsx:11–18`, `STAGE_COLORS`, is a six-step lead pipeline
in which `:14` and `:15` were already raw under §11.6 F. `sites.py`'s own note on
it:

> *"Converting it flattened Proposal (`bg-amber-50`) and Negotiation
> (`bg-orange-50`) onto one identical `bg-warning-bg text-warning` — two of six
> stages rendering the same chip. `:14` and `:15` were already raw under F, so
> the map was four tokens and two raw with two of the four colliding. The set
> goes raw whole."*

That is this item's argument, arrived at independently, on a map with the same
defect structure — some entries tokenised, some deferred by F, and the tokenised
ones colliding with each other. It is **not** binding here: `STAGE_COLORS` had a
collision among its converted entries and `StatusBadge` does not, so the
precedent covers the stronger case and leaves the weaker one open. But it is the
closest thing to a decided instance, it was cleared rather than reverted under
protest, and it points at taking the whole map.

`StatusBadge` differs from it in one way that cuts the other direction and should
be weighed: `STAGE_COLORS` is local to one screen, and `StatusBadge` is the
component every screen renders a weekly-plan state through, so leaving it whole
leaves 20 palette classes in the residue of a shared component rather than of a
page.

---

## P2. `components/ui/Sidebar.tsx` — the dark green shell, 20 occurrences, and §11.4's rows reach every one

**Status: DECIDED by the review session against the documents — all 20 defer,
not one converts. Recorded here because it is the largest single deferral in
phase 2 and because the *question underneath it* is still open.**

```
:179  bg-green-900  border-green-800     the aside itself
:185  bg-green-700                       logo tile
:186  text-white                           its icon
:191  text-white                         "RGB SFA"
:192  text-green-300                     tenant name
:199  text-green-500                     "Navigation" section label
:205  bg-green-700  text-white           active nav item
:206  text-green-100  hover:bg-green-800  hover:text-white   resting nav item
:209  text-white / text-green-400        the item icon, both states
:217  border-green-800                   footer divider
:220  text-white                         user name
:221  text-green-300                     user phone
:223  text-green-300  hover:text-red-400  hover:bg-red-900/30   logout
```

Converted mechanically, §11.4 sends all of it to success and danger: the sidebar
becomes a `#dcfce7` near-white panel with `#166534` text, and the active item
renders white on near-white. Three documents settle that it must not:

1. **§11.4's own preamble** — *"Every call site still has to be read for whether
   it meant the status at all."* A dark green shell is not Approved and a red
   logout hover is not Rejected. The row disclaims itself here.
2. **AGENTS.md §12.1** — *"Active item: `primary-subtle` background, body strong
   weight, and a 3px accent bar in `primary` on its left edge."* And
   `globals.css:167` sets `--sidebar: var(--surface)`. **The kit's sidebar is a
   light surface; this product's is a dark green shell.**
3. **§6's phase plan** — §12's sidebar belongs to **Phase 5**, which is blocked
   on §4 item 6 (whether `components/shell` is built here or inherited).

**What is open is not the deferral, it is the hole.** This is **not** §11.6 B. B
is the dark *neutral* hole — `bg-gray-900`/`800` fills with no dark surface
token — and B's sites have **no row at all**, which is why they are safe. These
have rows, and the rows are wrong. It is the same hole in another family, and it
is the one place in the product where a §11.4 row would destroy a whole screen
rather than one element. B asks the kit for a dark surface token *or* a rule that
dark fills are outside the system; this asks the same question about a brand-ish
surface that is not the brand — the product's `--primary` is indigo `#3d3a6e`,
so the sidebar green is an orphan.

Same reasoning attaches **`components/ui/Header.tsx:103`**, the notification
bell's unread count (`bg-red-500 text-white`, which §11.4 would render at
1.22:1). AGENTS.md §12.2 — *"Notification bell with unread dot in `primary`"* —
settles it outright, but that changes a rendered colour from red to indigo and
§12.2 is the shell. Phase 5's, with the sidebar.

---

## P3. `components/ui/Header.tsx:26–29` — a second copy of §11.5's own map, reordered and rekeyed

**Status: OPEN. 6 occurrences left raw. The review session instructed that it
must not be mapped by declaration order; what it becomes instead is yours.**

```
Header.tsx:26-29                       conversations/page.tsx:40-43   (§11.5's named site)
  weekly_plan:  purple    -> chart-1     meeting:          blue    -> chart-1
  meeting:      blue      -> chart-2     expense:          orange  -> chart-2
  expense:      orange    -> chart-3     weekly_plan_day:  purple  -> chart-3
```

§11.5: *"The assignment is by §21 position and is not to be reordered. Position 1
before position 2, and so on, **in the order the categories are declared**. A
category that changes colour because somebody re-sorted a map is the failure
this is meant to prevent."*

Mapping this copy by its own declaration order produces **exactly that failure**:
a meeting is chart-1 in the conversations list and chart-2 in the header, and the
weekly-plan chip swaps with it. The rule that protects the named site destroys
the unnamed one.

**The two copies disagree on the keys as well as the order** — `weekly_plan`
here, `weekly_plan_day` there. Two copies of one map that differ in both is §4
rule 2 before it is a colour question, and it is the same shape as §11.6 D's two
avatar implementations: *"the same person is a different colour in the remarks
panel than in the org chart"*, here *the same activity type is a different colour
in the header than in the list*. D's answer was one component, one key, then a
palette. The parallel answer here would be one map, imported twice — at which
point §11.5's named site covers both and this item disappears.

---

## P4. `masters/page.tsx` — §11.5 assigns 8 of these 16 and is silent on the other 8

**Status: OPEN. A gap in an APPROVED section, so not a phase-2 call. All 16 left
raw across 12 lines.**

§11.5's table: *"Masters section cards, `masters/page.tsx:10-12, 45-47, 71-73,
97-99` — 4, fixed in code — sections 1–4 → `bg-chart-1` … `bg-chart-4`, in
declaration order."* Its closing line: *"The chip foreground on each takes
`text-primary-foreground`."*

**These cards have no chip.** Each is four classes in three roles:

```
:10  color:     'border-blue-200 bg-blue-50/40'    a card border + a 40%-alpha ground
:11  headerBg:  'bg-blue-50'                       a header band
:12  iconColor: 'text-blue-600'                    an icon stroke
```

§11.5's `bg-chart-N` reaches the two `bg-` halves of each card — 8 of the 16.
The **4 `border-*-200` and 4 `text-*-600` have no target**: there is no
`border-chart-N`, `text-primary-foreground` is not an icon stroke on a pale card,
and converting the `bg-` halves alone splits every one of the four cards.

Two further facts worth having before answering:

- `bg-chart-N` is a **saturated** colour. `bg-blue-50/40` is a 4%-ish tint;
  `bg-chart-1/40` is indigo at 40%. The alpha suffix survives conversion, so
  these four card grounds become strong tints, not pale ones — a visible change
  that §11's three declared changes do not describe. (§11.5's chip conversions
  *are* declared; these are not chips.)
- **§11.5's headline of 30 is 22 with a target and 8 without.** The 30
  reconciles exactly — `conversations` 6 + `orders:518/:711` 8 + `masters` 16 —
  so the count is right and the coverage is not.

`conversations/page.tsx:41–43` is unaffected and **is** being converted, by hand,
as §11.5's manual case: it has real chips with real foregrounds, so the closing
line lands. The purple on `:43` also has no row at all, which means the engine
stops there rather than guessing — the safety net working as designed.

---

## P5. `masters/lead-temperatures/page.tsx:9–12` — an ordered scale that is also master data

**Status: OPEN. 8 occurrences left raw across 4 lines. Added by the converting
session; not instructed, and flagged as such.**

```
const TEMP_COLORS = { Cold: 'bg-blue-50 text-blue-700',
                      Warm: 'bg-amber-50 text-amber-700',
                      Hot:  'bg-red-50 text-red-700' }
:18  const cls = TEMP_COLORS[v] ?? 'bg-gray-100 text-gray-600'
```

Two of §11.6's existing arguments both reach it, and they point the same way:

- **§11.6 C.** `lead_temperatures` is master data with its own CRUD page — *this
  very file*. C's words: *"the real set is whatever an administrator has
  created… a seventh category falls to the grey fallback silently today. §21
  caps at six and answers a seventh by grouping the smallest into 'Other', which
  is a decision about the data and cannot be made by a colour map."* The `??`
  fallback on `:18` is that exact mechanism.
- **§11.6 G2.** It passes §11.5's stated test (categories fixed in code) without
  being one of §11.5's three named sites — the identical position G2 records for
  `review:345`'s `typeColor`: *"Adding it is a §11.5 decision, not a phase-1
  one."*

And converted under the rows as they stand, **Cold renders in brand indigo**
(`bg-blue-50` → `primary-subtle`, `text-blue-700` → `text-primary`) in the middle
of a Cold/Warm/Hot ramp — a scale whose first step is the brand and whose other
two are warning and danger.

**This is not hypothetical: the identical map exists twice, and phase 1 has
already converted the other copy.** `leads/page.tsx:20–23` declares the same
three keys with byte-identical class strings:

```
lead-temperatures/page.tsx:10-12        leads/page.tsx:21-23
  Cold: 'bg-blue-50 text-blue-700'        Cold: 'bg-blue-50 text-blue-700'
  Warm: 'bg-amber-50 text-amber-700'      Warm: 'bg-amber-50 text-amber-700'
  Hot:  'bg-red-50 text-red-700'          Hot:  'bg-red-50 text-red-700'
```

`leads` is a phase-1 file and `sites.py`'s `LD` entry protects `:12–:17`
(`STAGE_COLORS`), `:14`/`:15` (F), `:29` (E) and `:152` (§11.9) — **`:20–23` is
in none of them**, so `Cold` is brand indigo on a shipped screen today. Verified
against `main` and against `sites.py` directly, not inferred. Routed to phase 1
by the review session as a defect on this reasoning.

**Which makes this §11.6 C's shape twice over.** C's operative sentence is
*"settled… together, because the two maps must not diverge"* — and these are two
copies of one master-data-backed map in two files, exactly as C's own two
`CATEGORY_COLORS` copies were. Whatever `TEMP_COLORS` becomes, it has to become
it in both places or the same lead temperature renders one colour in the leads
list and another in its own master screen. **The single-file version of this item
understates it; the answer has to cover both copies, and §4 rule 2 says there
should only be one.**

---

## P6. `points/page.tsx:187–191` — the rank medals are ordinal, and no row is

**Status: OPEN. 8 occurrences left raw across 4 lines.**

```
entry.rank === 1 ? 'bg-yellow-400 text-white' :
entry.rank === 2 ? 'bg-gray-300 text-gray-700' :
entry.rank === 3 ? 'bg-orange-400 text-white' :
                   'bg-gray-100 text-gray-500'
```

Gold, silver, bronze, rest — rendered behind 🥇🥈🥉. The colour carries **rank
order**: not status (nothing is approved or overdue), not category (the four are
ordered, not parallel), and not magnitude (§21's ramp is for a measure across a
range, and rank 1 is not "more" of anything). §11 has rows for status, brand,
neutral and categorical, and **ordinal is a fifth kind it does not have.**

Converted, §11.4 puts gold and bronze on `warning-bg` — **the same token, so
first and third place become indistinguishable** — under `text-white` at 1.11:1,
while silver and fourth place both land on the neutral scale. Four ranks render
as two colours, one of them invisible.

**The collapse half of that is a defect phase 1 has already found and fixed, and
this is its only recurrence in the 41.** `bg-yellow-400` and `bg-orange-400` are
distinct categories that §11.4's warning family maps to one token — the same
failure `sites.py` records at `leads/page.tsx:16`/`:17`, where *"Proposal
(`bg-amber-50`) and Negotiation (`bg-orange-50`)"* flattened *"onto one identical
`bg-warning-bg text-warning` — two of six stages rendering the same chip."*
§11.4 collapses three hues into `warning` (amber + yellow + orange) and two into
`success` (green + emerald), so **any set that distinguishes two members of one
family loses that distinction on conversion.** Worth stating as a general
property of §11.4's rows rather than as two incidents: the rows are correct for
a single status and lossy for a set. I swept the 41 for it — `points:188`/`:190`
is the only other instance; every other multi-entry set in these files draws one
member per family.

One element, four states, four lines. Line-level in full per the ternary rule.

Related and in the same file: **`:93–96`**, the Total Points gradient card,
`from-yellow-400 to-orange-500`. A straight **§11.6 G4** recurrence — §11 has no
gradient row and §2 is flat fills — with one addition G4 did not have to handle:
`:94` and `:96` are **`text-yellow-100` sitting on that gradient**. They *do*
have a row (`text-warning`), and their ground does not. Deferred together, on
§11.6 B's stated reasoning that a fill and the text on it are one decision.

---

## P7. `masters/dealers/page.tsx:191, :197, :202` — sibling buttons that would split

**Status: OPEN. 16 occurrences left raw across 4 lines (`:224` is the file's
§11.9 line and is separate).**

```
:191  !showUnassigned ? 'bg-gray-800 text-white'   : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
:197   showUnassigned ? 'bg-amber-500 text-white'  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
:202   showUnassigned ? 'bg-white/20 text-white'   : 'bg-amber-100 text-amber-700'
```

Two buttons of one segmented filter — "All (n)" and "Unassigned (n)" — with
identical resting styles and differently-coloured active fills.

- `:191`'s active fill is `bg-gray-800`, a **§11.6 B** site: no row, deferred.
- `:197`'s active fill is `bg-amber-500`, which **§11.4's closing rule reaches**:
  a saturated status colour that is a filled button, not a badge ground, takes
  `bg-<role>` — and `--warning` exists.

So the mechanical answer converts one of two siblings and leaves its neighbour
raw. **Global rule 1: "Treat parallel items identically — sibling tabs/rows/
buttons get the same style."** §4 rule 2 is the same point structurally. This is
the ternary-split shape one level up: not two branches of one element, but two
elements that are peers, and §11.6's line-level rule does not reach across lines.

`:202` adds a third thing the rows do not scope: **`bg-white/20`** is a
translucent pill *on* the amber fill, not a surface. §11.1's `bg-white` row is
unconditional and would give `bg-surface/20`, which is only legible while its
ground stays amber — so it is tied to `:197`'s answer, not independent of it.

---

## P8. §11.6 G6's principle is sound and its DERIVATION is incomplete — two more rows reach the same failure

**Status: OPEN, and the only item here with a live defect on a converted
screen.** G6 is ratified and nothing below asks to reopen it. What is wrong is
its coverage, not its argument.

G6 was reasoned from **§11.4's background row alone**: *"§11.4's rows carry a
role — text, background, border — and the background role was measured against a
badge ground, where the token sits behind dark text and the text carries the
signal… Where the shape IS the signal — a dot, a stripe, a bar, a legend swatch —
the same token has nothing left."* That is right, and the shapes it names are the
right shapes. But the failure is a property of **any pale token under a
shape-carrying element**, and two other rows deliver one:

| Row | Renders today | on white | Becomes | on white |
|---|---|---|---|---|
| §11.1 neutrals | `bg-gray-300` `#d1d5db` | **1.47:1** | `surface-control` `#f5f5f5` | **1.09:1** |
| §11.1 neutrals | `bg-gray-200` `#e5e7eb` | 1.24:1 | `surface-control` `#f5f5f5` | **1.09:1** |
| §11.4 background, **300-level** | `bg-red-300` `#fca5a5` | **1.90:1** | `danger-bg` `#fee2e2` | **1.22:1** |
| §11.4 background (G6's own) | `bg-green-500` `#22c55e` | 2.28:1 | `success-bg` `#dcfce7` | 1.10:1 |

Computed with the WCAG relative-luminance formula; the method reproduces G6's
own three published figures exactly (`success-bg` 1.10:1 on `surface` and 1.01:1
on `surface-control`, `warning-bg` 1.11:1 on `surface`), which is how I know it
agrees with whatever G6 used.

**The live instance, in a phase-1 file already converted:**
`companies/[id]:268–273` is the Engagement Breakdown stacked bar and `:281–287`
its legend — **one set of five classifications, declared twice**:

```
actively_using  bg-emerald-400   <- G6 protected
passive         bg-amber-400     <- G6 protected
low_usage       bg-blue-400      <- G6 protected
dormant_enabled bg-gray-300      -> bg-surface-control  #f5f5f5   CONVERTED
not_using       bg-red-300       -> bg-danger-bg        #fee2e2   CONVERTED
```

G6 caught three of five and missed two, and it missed them **because of where
they arrive from**: the two it missed come through §11.1's neutral row and
§11.4's 300-level background row rather than the saturated-fill path G6 was
derived against. Two of five segments of an `h-4` bar, and two of five 10px
legend dots, are now near-white on a white card. `sites.py`'s note on the site
reads *"legend dots, 3 categories fixed in code"* — **the code declares five**,
which is the same undercount from the other end.

**Phase 2's three switch tracks are the same defect, found from the opposite
direction** — `Toggle.tsx:15`, `settings/points:183`, `companies/page:117`, where
`bg-gray-300` → `surface-control` makes the OFF state of every switch in the
product disappear, and on two of the three `bg-green-500` → `success-bg` takes
the ON state with it. So does `CalendarPicker:148`, the "No activity" legend
swatch (`bg-gray-200`). Those are deferred here. The `companies/[id]` pair is
not, and is with phase 1.

**And the gap survived the fix, which is the strongest argument in this item.**
*Reported by the review session, 17 Sep; not verified by this session, which is
barred from reading phase 1's branch.* Phase 1's revert of the `companies/[id]`
site was applied to the lines that had been **named** rather than to a diff of
the whole literal, and took three of the four converted segments — the bar's two
and the legend's `not_using`. **The legend's `dormant_enabled` at `:285` was
left as `bg-surface-control`**, so the bar segment renders `bg-gray-300` while
its own legend key renders near-white: a legend that does not match the thing it
labels, which is a worse state than before the revert. It was found by diffing
the literal after a line citation in this item was corrected from `:283–287` to
`:285`/`:286`. *Also reported and not verified here: `:285` has since been
corrected to `bg-gray-300` in the working tree, uncommitted, as a one-line
content change.*

That is the same undercount a fourth time — in §11.4's row, in G6's derivation,
in `sites.py`'s *"3 categories fixed in code"* note, and now in the fix. All four
share one cause: **the set was reasoned about through the sites someone had
already written down, rather than through the literal in the file.** Which is
the case for the sentence below being in G6 rather than in a per-site list.

**What is being asked.** Not a token — a sentence in G6 saying the principle is
role-and-shape, not family-and-shade: *where the shape is the signal, no pale
token carries it, whichever row delivered it.* Written that way, G6 catches
`bg-gray-300` under a bar and `bg-red-300` under a dot without anyone having to
re-derive it per row. Written as it is, it catches the saturated status fills and
nothing else, and the next person to sweep a stacked bar loses the same two
segments.

Two things this is deliberately **not**:

- not an argument that `bg-gray-300` → `bg-surface-control` is a wrong row. It is
  right for a control fill, which is what it was measured for. This is §11.0's
  and G6's shared point — a token used outside the role it was measured for —
  arriving through a third door.
- not a claim that every `bg-gray-300` in the 41 is affected. It is not: the
  sweep found the three switch tracks and one legend swatch, and the remaining
  `bg-gray-300` sites are control fills where the row is correct. **The test is
  the element, not the class**, which is why this is worth one sentence in G6
  rather than a row change.

---

## P9. Recorded, not open — decided against the documents, no author input needed

Listed so the sections above are not read as the whole of what the pre-flight
found.

- **§11.6 G grows with phase 2, as §11.6 G itself says it would**: *"G is the ten
  files only. The remaining 42 files have not been read in context yet and will
  add to this group as their phases run."* Eight G6-shaped recurrences were
  placed by the converting session under G6's ratified principle — the shape is
  the signal, and a background token measured against a badge ground has nothing
  left. Sites: `Toggle.tsx:15`, `settings/points:183`, `companies/page:117`
  (three copies of one switch track, where **both** states vanish —
  `bg-gray-300` 1.47:1 → `surface-control` 1.09:1, and `bg-green-500` 2.28:1 →
  `success-bg` 1.10:1, both on white); `points:167–168` (a progress bar that is
  `companies/[id]:251` again to the pixel, 1.01:1); `review/page:143`+`:147` (a
  two-series legend dot pair that splits one-visible-one-not, exactly
  `daily-activity:1125`/`:1148`); `CalendarPicker:130`/`:133` (the "has activity"
  dot in its unselected and selected states) and `:144`/`:148` (its two-item
  legend). Three of those eight — the switch tracks — and `CalendarPicker:148`
  arrive through §11.1's *neutral* row rather than §11.4's, which is **P8** and
  not a footnote to this bullet.
- **`CalendarPicker:130`/`:133` is the exception to G6's own exception.** G6's
  closing note exempts `daily-activity:142` and `review/[userId]:102` because
  `bg-blue-500` → `primary` and `bg-blue-200` → `primary-subtle` read coherently
  in both states. This is the same element with `bg-emerald-500` in the
  unselected state, and emerald does not: a 4px dot at `#dcfce7` on white. The
  note's reasoning does not carry across the family.
- **`lib/usage-intelligence.ts:17–21`** — `CLASSIFICATION_COLORS`, a five-step
  ordered scale (actively_using → passive → low_usage → not_using → dormant)
  that would convert to success / warning / **brand indigo** / danger / neutral.
  Left and declared, because it also renders **nowhere**: both
  `CLASSIFICATION_COLORS` and `CLASSIFICATION_LABELS` are exported and imported
  by nothing, and their consumer was the endpoint `PLAN.md` §13.6 records as
  dead. CLAUDE.md: dead code is *"preserved deliberately rather than 'fixed'…
  Do not treat their failures as regressions."*
  **It is the third copy of that palette, and the three disagree.** The same five
  classifications are declared at `companies/[id]:269–273` and again at `:282–286`
  (P8's live instance) at the 300/400 level, and here at the 50 level:
  `bg-emerald-50` against `bg-emerald-400`, `bg-red-50` against `bg-red-300`, and
  so on. So whoever settles P8's bar settles the shades for a set that exists in
  two files and three literals — §4 rule 2 again, and worth knowing before the
  bar is fixed in isolation.
- **`contexts/ToastContext.tsx:39`**, `bg-black/5` on an `h-1` progress track —
  already named in §11.6 G and in §11.1's addendum as the reason the `bg-black`
  row is scoped to dialog, alert-dialog and sheet backdrops only. Unchanged.
  Lines `:11–:14` defer as well, on two grounds at once: §11.9 (`btn:` collapses
  to one token) and G6 (`bar:` is an `h-1` progress bar of `bg-*-500` on a
  `bg-*-50` ground, so `danger-bg` on `danger-bg`).
- **The four remaining `bg-black` sites in these files are in scope and convert**
  — `login:124` (forgot-password modal scrim), `RemarksPanel:133` (panel scrim),
  `Modal:19`, `(protected)/layout:43` (mobile sidebar scrim). All are dialog or
  sheet backdrops, which is what §11.1's addendum scopes the row to. For the
  arithmetic: §11.7's "19 mapped as backdrops" is the ten files' 19 exactly, so
  these four sit **beside** that figure rather than inside it, and
  `ToastContext:39` adds one to its UNMAPPED 29. No decision, just a count that
  moves.
- **The CRLF/LF split phase 2 leaves in the working tree means nothing, and must
  not be "fixed".** Recorded once, here, so it is not read as a defect later.
  Every blob on `main` is LF-only — measured with `git cat-file blob` on all 41,
  zero CR bytes — because `core.autocrlf=true` and `.gitattributes` says nothing
  about `*.tsx`. But `tokens.py` reads with universal newlines and writes with
  `newline=''`, so **a CRLF file goes in and an LF file comes out**. A fresh
  worktree checks all 41 out as CRLF, so after phase 2 every converted file is
  LF on disk and every fully-deferred file is still CRLF. Harmless, and tested
  rather than assumed: the engine over an LF blob with every line protected
  returns it byte-identical, and since the blobs are already LF the rewrite
  produces no `git diff` and cannot move a line count, so §11.8's line-for-line
  check is unaffected. **Normalising line endings in a colour phase would be
  exactly the structure-moved change §11.8 forbids**, and would put every line
  of 24 files into a diff whose whole purpose is to be readable — so if it is
  ever proposed it is routed, not done. The exit check compares each converted
  file to its pre-phase blob **with line endings normalised**, so the rewrite
  neither masks a real structural change nor is mistaken for one.
  *Method note, because it cost both sessions a wrong conclusion:* `grep -c
  $'\r'` does **not** count CRs — it counts matching lines, and in Git Bash
  `$'\r'` does not reliably expand, so the pattern silently becomes empty,
  matches every line, and returns the file's line count as a believable wrong
  answer. Both sessions reported line counts as CR counts before it was caught.
  Count bytes in Python against `git cat-file blob` — **not** `git show
  rev:path`, which applies working-tree conversion and would have hidden it.
- **`components/ui/SearchableSelect.tsx:70` is NOT an §11.9 line**, and the
  review session conceded it after listing it. `hover:bg-blue-50` and the
  selected branch's `bg-blue-50` are the **same class**, so the dead hover is
  pre-existing — which §11.9 excludes by name — and conversion preserves it
  exactly. The unselected option's real hover also survives unchanged.

---

## P10. Two corrections to approved text, neither changing an outcome

Raised because an approved section stating a wrong reason is a thing the next
reader will rely on.

1. **§11.2 files `points/page.tsx:84` under "Prices and quantities".** The line
   is a period-filter segmented tab:
   `${period === p.value ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`.
   Not a price, not a quantity. The **exception's outcome still holds** —
   AGENTS.md §33.3 puts resting tabs at `text-secondary` — but the reason is
   wrong, and the exception is what *creates* an §11.9 collision here (promoting
   the resting half to secondary lands it on `hover:text-gray-700`'s token).
   That is the `daily-activity:1536` shape, and it is item 4 of the 17 Sep list
   recurring in phase 2. Two more in the same list are mis-bucketed without
   changing anything: `settings/points:119` is filed under prices and is a helper
   line (*"How often the leaderboard and totals reset"*) — §2.3 lists helpers as
   a legitimate `text-muted` use, so this one arguably should not be an exception
   at all; and `BusinessPartnerForm:306` is filed under statuses and is a section
   label reading the words "Lead Status".
2. **`analyse.py`'s §11.9 detector cannot see a template literal's static
   part.** Its `SEG` regex matches `'…'` and `"…"` only, so a class written
   outside the `${…}` — `` `… hover:bg-blue-50 ${cond ? 'a' : 'b'}` `` — is
   invisible to it. It costs nothing on these 41 (a whole-line pass adds no
   lines), but **`daily-activity:217` is exactly that shape** and is open item 3,
   so the tool cannot check the site the open question is about. A whole-line
   pass is kept alongside the segment pass in phase 2.

---

## P11. Verified against the plan and found correct — reported so they are not re-checked

- **§11.5's "30 occurrences" is exact**: `conversations:41–43` 6 +
  `orders:518`/`:711` 8 + `masters/page` 16.
- **§11.7's "67 white/black in the ten files" is right**, once read as *"with no
  row"*: `text-white` 48 + `bg-black` 19 = 67, `bg-white`'s 97 excluded because
  §11.1 already gave it a row. 61 mapped / 6 UNMAPPED follows. The same
  accounting on the 41 gives 43 with no row — `text-white` 38 + `bg-black` 5 —
  of which 21 are deferred with their grounds.
- **§11.7's structural facts reproduce on `main`** at the start of phase 2:
  white/black 247 (`bg-white` 137, `text-white` 86, `bg-black` 24), families
  2,445, the ten phase-1 files 1,735, these 41 files 957 — which is §12's stated
  957 to the occurrence.
- **Every §11.6 A–G and §11.9 line number that falls in these 41 lands where the
  plan says it does**, checked individually against `main`: B's seven sites, D at
  `RemarksPanel:41`, F at `StatusBadge:8`, G at `ToastContext:39`, §11.5's three
  named sites, and all seven §11.2 exception lines.
- **`scripts/migrate/sites.py` ∩ these 41 files is empty**, asserted in code
  against all ten of its file constants. No phase-1 protected site is reachable
  from phase 2.

---

## P12. `superadmin/companies/page.tsx:20` — §2.4 names Overdue under danger, and it renders warning

**Status: OPEN. Left exactly as committed. Found by the review session at the
end of phase 2, by reading the call site against §2.4 rather than against the
row.**

```
before   Overdue: 'bg-yellow-50 text-yellow-700'
after    Overdue: 'bg-warning-bg text-warning'
```

`AGENTS.md` §2.4, verbatim:

| Meaning | Text | Background | Used for |
|---------|------|------------|----------|
| success | `#166534` | `#DCFCE7` | Paid, Approved, Active, Completed |
| warning | `#92400E` | `#FEF3C7` | Pending, Due soon, Needs review |
| danger  | `#991B1B` | `#FEE2E2` | **Overdue**, Failed, Rejected, Delete |

**§2.4 names Overdue under danger. This renders it warning.**

**No row was misapplied.** The source was `bg-yellow-50 text-yellow-700`, §11.4's
row sends the yellow family to `warning`, and the row did exactly what it says.
**The pre-existing code was already off-spec against §2.4 and the mechanical
mapping preserved the mis-assignment faithfully** — it converted a wrong colour
into the correctly-tokenised form of the same wrong colour.

This is §11.4's own caveat landing: *"Every call site still has to be read for
whether it meant the status at all."* This one meant a status. It meant the
wrong one, and it meant it before phase 2 touched it.

It is also the exact class §15 says nothing mechanical can catch, found the way
§15 says it has to be — by reading the call site against the rule rather than the
row. No check in this phase could have flagged it: the occurrence is gone, the
token is valid, the set moved as a unit, the line count held.

**Not changed, because the remedy is a fourth visible change.** Amber to red on
a live status chip is outside the three §11 declares, so it is the author's. The
other two entries in the same map:

- `Active: 'bg-success-bg text-success'` — **correct**, §2.4 lists Active under
  success.
- `Suspended: 'bg-danger-bg text-danger'` — not listed in §2.4 either way, and
  defensible.

Worth deciding once rather than per site: §2.4's fourth column is a **list of
words**, and this is the first time a word in it has disagreed with the colour a
screen actually used. Whether that column is normative — so that any chip whose
label appears in it takes that role regardless of what the code did — is a
question about §2.4, not about this file.

---

## P13. `components/ui/CalendarPicker.tsx:121–133` — the ground converted and the indicator on it did not

**Status: OPEN, and it is a ruling rather than a lookup, because two rules in
§11.6 reach it and point opposite ways. Left as committed.**

The day cell and the dot drawn on it, after phase 2:

```
:121   isSelected  ? 'bg-primary text-primary-foreground'     CONVERTED
:123   isToday     ? 'bg-primary-subtle text-primary'         CONVERTED
:124               : 'hover:bg-surface-control text-text-secondary'   CONVERTED
:130   isFilled && !isSelected   <span ... bg-emerald-500 />  DEFERRED (G6)
:133   isFilled &&  isSelected   <span ... bg-blue-200   />   DEFERRED (G6)
```

**Before**, the pair was a `bg-blue-600` cell carrying a `bg-blue-200` dot — one
family, visibly related. **After**, it is a `#3D3A6E` indigo ground carrying a
raw Tailwind `blue-200` dot, and the two no longer relate to each other at all.

**The two rules, both of which apply:**

- **§11.6 B's principle** — *"a fill and the text on it are one decision"* — and
  a fill and the indicator drawn on it is the same argument. On that reading the
  ground should have deferred with the dots.
- **§11.6 G6 reasoned about this exact shape once and exempted it.** Its closing
  note: *"Not in this group: `daily-activity:142` and `review/[userId]:102`. The
  day-cell 'has activity' dot is `bg-blue-500`, going `bg-blue-200` when the cell
  is selected. `bg-primary` on white and `bg-primary-subtle` on the primary fill
  is coherent in both states, so it maps normally."* On that reading `:133`
  should have converted to `bg-primary-subtle` and the pair would be coherent.

**Why `:133` did not convert, and why that was not a free choice.** `:130` and
`:133` are the same indicator in its two states. `:130` is `bg-emerald-500`,
which G6 defers because `success-bg` is a 4px dot at 1.10:1 on white — G6's
exemption was written for a **blue** dot in both states and does not carry to an
emerald one. Converting `:133` alone would have split a state pair, which is the
half-migration the line-level rule exists to stop. So the choice was: split the
pair, or leave the ground unrelated to the dot on it. **Phase 2 took the second,
because the first is forbidden by a rule and the second is not.**

Three ways out, none of them phase 2's to take:

1. Convert `:133` only — coherent ground and dot, at the cost of a split state
   pair. Requires G6's exemption to be read as overriding the state-pair rule.
2. Defer the day-cell ternary as well — everything stays raw and related, at the
   cost of deferring three lines that convert cleanly and are not a G6 shape.
3. Settle what the "has activity" indicator *is* — it is presence-of-data, not
   status and not category — and give the whole element one vocabulary. This is
   the real answer and it is a screen decision.

Related and already recorded: the same file's legend at `:144`/`:148` is a
two-item swatch pair under G6 for the same reason as `:130`.
