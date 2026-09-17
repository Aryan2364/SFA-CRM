# Running log — 17 Sep 2026, phase 1

Review session (sfacrm-01) overseeing two working sessions:

| Phase | Session | Branch | Scope |
|---|---|---|---|
| **P1** | sfacrm-25 | `screens/phase-1-ten-files` | the ten §12 files, 1,735 occurrences |
| **P2** | sfacrm-2b | `screens/phase-2-remaining` *(not yet created)* | the remaining 41 files, 957 occurrences |

One line per exchange: what was reported, what was instructed, which section it
came from. Read-only: I instruct and verify, I do not write code or commit.

**Rows 1–27 below are P1.** P2 starts at row 28.

| # | Reported / observed | Instructed | Source |
|---|---|---|---|
| 1 | — (contact) | Identified as reviewer; stated what I answer from the documents and what routes to open-for-author | role brief |
| 2 | §11.1 border-gray row reads 221, tree has 233 | Correct the row to 233, mapping unchanged, all three shades `border-border-light` written in full | §11.1 row; §11.0; §11.7's bare-border note |
| 3 | §11.6 F double-counts two of D's swatches | Correct F to 6 and the headline to distinct; no site's disposition changes | §11.6 D table names rose and pink |
| 4 | `bg-blue-100 text-blue-700` has four dispositions by call site | Convert by file and line, never by class string; group C untouched in files 1 and 3 | §11.5 table; §11.6 C |
| 5 | §11.5 turns pale chips into saturated fills | Expected, not a defect; visible-changes line now names three | author; §11.5 closing line |
| 6 | Verified `a55ad4a` against items 2–5 | Accepted — transcription accurate, headline arithmetic consistent | diff read |
| 7 | `e85a6c0` added §11.6 G6 unilaterally, moving approved 2,349 → 2,335 | Not reverted; recorded in open-for-author §2 for ratification; no further amendment without routing | §11.7 "an approved number that changes silently is not an approved number" |
| 8 | daily-activity conversion appeared in the working tree, then was reverted to its exact pre-phase blob | No instruction — worker self-corrected before I could act | verified `git hash-object` = recorded baseline |
| 9 | While it existed, that diff was line-for-line (1,686 → 1,686) and every A–G site in the file was untouched | Recorded as the standard to hold to | §11.6 A–G |
| 10 | §11's rows flatten hover into resting on 52 lines, 41 in the ten files | Leave all 52 untouched, record, move on — the tokens do not exist | `AGENTS.md` §6.4; `globals.css` token set |
| 11 | Ternary branches split across G and a mapped row | Both branches untouched in full at `daily-activity:361` and `review:417`; G is line-level for ternary branches | author's ruling |
| 12 | `sites.py` states "protection is per SITE, not per line" | Amend to carry the ternary exception before any source file moves | author's ruling, item 11 |
| 13 | Author ratified both open items | Relayed: G6 stands at 2,349 → 2,335, G 52, headline 100; the 52 hover lines stay untouched | author |
| 14 | Worker's in-progress §11.8 draft says "every §11.6 **A–H** site", filing the hover residue as a group H | Redirected: it gets its own section, not a letter in §11.6, and §11.8 reverts to A–G | §11.6 preamble — "None of these is a colour question. Each one is an element whose identity has to be decided" |
| 15 | The hover gap is the kit's, not this product's | Record as a KIT finding in the shape of §4 item 7, for the author to take to rgb-kit-v2 after the phase; do not edit the kit from here | `AGENTS.md` §6.4 against `globals.css`'s token set |
| 16 | `e85a6c0` amended an approved section by commit | Process correction sent once: route amendments, do not commit them — binds me equally | author |
| 17 | Worker's §11.8 draft read in progress: byte-identical protected sites, empty remainder, line-for-line with the pre-phase blob | Accepted as written; line-for-line is now the phase standard | §11.8 as drafted |
| 18 | Ten source files still byte-identical to baseline; worker doing the plan commit first | No instruction — order being followed | `git hash-object` × 10 |
| 19 | `12d5d73` converts file 1: 363 → 55, 1,686 lines both sides, group arithmetic reconciles | Accepted the bulk; four defects returned as a follow-up commit | verified against pre-phase blob, not the report |
| 20 | `:1536` active tab accent written `border-primary-border` | Write `border-primary` | `AGENTS.md` §33.3 "a 2px `primary` accent"; §11.1's own `border-gray-900` → `border-primary` row for the sibling site |
| 21 | `:1536` resting/hover both became `text-text-secondary` | Add to §11.9, leave raw; detector must apply §11.2's exceptions before testing collision | §11.2 (site is in its status list) + §6.4 |
| 22 | `:300` ternary — one branch converted, four teals left | Revert; every palette class on the line is inside the ternary, so line-level and branch-level coincide | author's ternary rule |
| 23 | `:217` ternary branches converted around a G5 shadow | Revert both branches; `bg-white` outside the ternary routed to open-for-author §3 | author's ternary rule |
| 24 | Worker protected `:243` (white on the `:242` danger fill) and asked me to confirm | Reversed: both convert. `:242` is a filled danger button and `danger-hover` exists | §11.4 closing rule; `globals.css:97`, `:324` |
| 25 | Hover counts disagreed — mine 52/59 and 41 in the ten, its 53/126 and 34 | Conceded mine; sent my corrected list for a site-by-site diff | two errors of my own, below |
| 26 | Worker claimed `12d5d73` was "on its own, nothing else in it" | Noted: it also carries `sites.py`, `tokens.py`, `verify.py`. Not asked to split — the claim was the problem, not the commit | verified `--name-only` |
| 27 | Author changed the pace | Instructed: run all ten straight through, commit per file, no review between; one pass at the end | author |

## Corrections to my own findings

- **Encoding damage — withdrawn.** I reported a mangled `·` at
  `daily-activity:265`. That was my console re-encoding the file through cp1252,
  not the file. Verified: zero lines with changed non-ASCII characters.
- **Hover count — wrong twice, and the worker's was better founded.** My
  ten-file figure of 41 came from matching file paths on substrings, which swept
  in `companies/page.tsx`, `companies/new` and `review/page.tsx` — none of them
  in the ten. And my repo-wide 59/52 counted every saturated status fill as a
  collapse, including the red ones that §11.4's closing rule resolves through
  `danger-hover`. Corrected: 45 lines / 51 declarations repo-wide, 32 lines in
  the ten. The worker derived its number independently before seeing mine, which
  is the only reason the error surfaced — worth keeping as a habit.

## Change of pace — 17 Sep 2026

Per-commit review retired mid-phase at the author's instruction; the worker runs
all ten straight through and I make one pass at the end. During the run I answer
lookups only. The end pass is: protected sites untouched, undeclared survivors,
scope bleed, tokens semantically wrong for the element, and the screens opened
against the three declared visible changes. **Count reconciliation against §11.7
is retired and I will not run it.**

## Baselines I hold, measured before any work

- 2,692 palette occurrences repo-wide on §12's method; 247 white/black; 2,445
  otherwise. Reproduces §12's per-file table to the occurrence.
- Line-level snapshot of every §11.6 A–G site, and the ten files' blob hashes.
- Expected residue in the ten files after phase 1 — recomputed as groups move.
  103 at the phase-1 amendment (A 3, B 11, C 28, D 6, E 13, F 4, G 38). G1's two
  ternary halves add 4. G6's 14 add however many of them fall inside the ten,
  which I will take from the plan once it is committed rather than assume. The
  hover residue is counted separately and is not part of A–G.
  **I do not treat this as an arithmetic gate** — §11.8 verifies an empty
  remainder, not a matching total. The figure is a sanity check on my own reading.
