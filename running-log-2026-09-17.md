# Running log — 17 Sep 2026, phase 1

Review session (sfacrm-01) driving the working session (sfacrm-25).
One line per exchange: what was reported, what was instructed, which section it
came from. Read-only: I instruct and verify, I do not write code or commit.

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

## Corrections to my own findings

- **Encoding damage — withdrawn.** I reported a mangled `·` at
  `daily-activity:265`. That was my console re-encoding the file through cp1252,
  not the file. Verified: zero lines with changed non-ASCII characters.

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
