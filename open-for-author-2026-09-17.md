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

**But G6 itself needs re-deriving, and that IS an amendment.** Phase 2 reached
this from its own 41 files and put it best: **G6's principle is sound and its
derivation is incomplete.** G6 was reasoned from §11.4's *background* row, so it
caught the status-coloured shapes and only those. The identical failure arrives
through two other rows:

| Row | Conversion | Contrast on its ground |
|---|---|---|
| §11.1 neutral | `bg-gray-300` → `bg-surface-control` | **1.04:1** |
| §11.4 badge | `bg-red-300` → `bg-danger-bg` | near-white on white |

That is exactly how the `companies` stacked bar ended up three-raw and
two-converted, and phase 2 hit the same thing independently on three switch
tracks in its own files. **G6 needs re-deriving across all three rows, not just
§11.4's.** Recorded here rather than written into §11.6, which is approved.

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
