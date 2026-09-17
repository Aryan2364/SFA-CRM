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

## 3. Recorded, not open — decisions already made

Listed so the sections above are not read as the whole of what came up.

- **§11.5's thirty chip conversions** are an expected visible change. Decided by
  you; the visible-changes line now names three, not two.
- **The G1 ternary halves** at `daily-activity:361` and `review/[userId]:417` —
  both branches untouched in full. Decided by you; G is line-level where a
  ternary's branches are one element, occurrence-level elsewhere.
- **§11.1's border-gray row** 221 → 233, **§11.6 F** 8 → 6, and §11.7's restated
  basis — decided by you, transcribed by the worker.
