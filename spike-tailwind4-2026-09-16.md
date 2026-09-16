# Spike — Tailwind 4: can we copy the kit's components instead of rebuilding them?

Branch `spike/tailwind-4`, cut from `f54b62a`. **Discarded whichever way this lands.**
Nothing here is migration work. No colour migration started, no components built,
no drift fixed.

Run 16 Sep 2026 against `D:\RGB_Software\rgb-kit-v2` (read-only; the kit was not modified).

**Answer in one line:** upgrade — 31 of 31 copy unmodified, and the React-18 blocker
the active plan assumes does not exist.

---

## THE HEADLINE CORRECTION

`plan-2026-09-16-1522.md` §3 item 5 says the kit's components "are shadcn over Radix on
React 19" and therefore "port as specifications, not as files." **Both halves are wrong.**

- **There is no Radix.** The kit uses `@base-ui/react`. Zero of its 39 components import
  `@radix-ui/*`. (The `@radix-ui/*` packages present in the kit's `node_modules` are
  transitive dependencies of `cmdk`, reached by no kit source file.)
- **React 18 is not excluded by anything.** Peer ranges read from the kit's own
  `node_modules`, not inferred:

  | Package | Version | Declared `react` peer range | Accepts 18 |
  |---|---|---|---|
  | `@base-ui/react` | 1.7.0 | `^17 \|\| ^18 \|\| ^19` | **yes** |
  | `cmdk` | 1.1.1 | `^18 \|\| ^19 \|\| ^19.0.0-rc` | **yes** |
  | `sonner` | 2.0.8 | `^18.0.0 \|\| ^19.0.0 \|\| ^19.0.0-rc` | **yes** |
  | `recharts` | 3.10.1 | `^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` | **yes** |
  | `lucide-react` | 1.35.0 | `^16.5.1 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` | **yes** |
  | `react-day-picker` | 10.0.1 | `>=16.8.0` | **yes** |
  | `next-themes` | 0.4.6 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | **yes** |
  | `class-variance-authority`, `tailwind-merge`, `clsx`, `date-fns` | — | no react peer | n/a |

  `@base-ui/react` also declares `"@types/react": "^17 || ^18 || ^19"`.

All eleven installed into this repo against **React 18.3.1 / react-dom 18.3.1 /
@types/react 18.3.28** with **zero peer conflicts** — npm 7+ fails an install on an
unsatisfiable peer by default, and it did not.

**Consequence: React is not what stands between this product and the kit's components.
Tailwind 3 is.** That reverses the plan's Phase 2 cost entirely.

---

## 1. Does Tailwind 4 build at all here?

**Yes.** `next build` completed, exit 0, all 36 existing routes emitted.

Baseline first: the repo built clean on Tailwind 3.4.1 before anything was touched, so
the comparison is like for like.

What it took — four changes, no application code:

1. `npm install -D tailwindcss@4 @tailwindcss/postcss@4` → **tailwindcss 4.3.3**
2. `postcss.config.js` — replaced the `tailwindcss` + `autoprefixer` plugin pair with
   the single `'@tailwindcss/postcss'` entry. **autoprefixer removed**; v4 does that
   itself through Lightning CSS.
3. `src/app/globals.css` — `@tailwind base/components/utilities` → `@import "tailwindcss"`,
   plus an `@theme` block holding 21 token declarations (7 brand per the active plan §3,
   8 neutral and 6 status per `AGENTS.md` §2.3 and §2.4).
4. `tailwind.config.ts` — **left in place and now unused.** v4 does not read it without an
   explicit `@config` directive, and none was added. Nothing was lost: the file is 13
   lines with an empty `theme.extend`.

**Zero edits to any of the 51 existing `.tsx` files were required to make the build pass.**

The tokens do reach utilities: the stylesheet emits `--color-primary:#3d3a6e` and a
working `.bg-primary`, and the legacy palette (`bg-gray-50`, `ring-blue-500`,
`text-gray-400`, …) continues to emit alongside it.

---

## 2. Of the 31 components, how many copy?

# **31 COPY · 0 REBUILD**

No component required a single edit, so none of the classifications (a) React 19-only API,
(b) Radix peer range, (c) Tailwind 4 syntax, (d) other were used.

### Method

- Copied **all 39** kit components plus `lib/utils.ts` into `src/components/ui/` and
  `src/lib/`, byte-for-byte (`cmp` verified). All 39 were copied, not just the 31, so a
  component could not fail merely because a sibling it imports was absent.
- **One file deliberately not copied: `pagination.tsx`.** It collides case-insensitively
  with this repo's existing `Pagination.tsx` and would have destroyed it — the same
  filesystem hazard as `plan.md`/`PLAN.md`. `pagination` is not one of the 31 and nothing
  in the 31 imports it. So **38 files copied**.
- `npx tsc --noEmit` → **0 errors**, with all 48 files confirmed present in the compiler
  program via `--listFiles`.
- **The type check was proved before it was trusted** (`AGENTS.md` §6.4): a deliberate
  type error injected into `button.tsx` was reported at the right file and line, then
  reverted byte-identical. A check only ever seen passing has not been tested.
- Type-checking is not bundling, so a harness page importing all 38 modules forced them
  through SWC and webpack. **First attempt was worthless and said so**: the directory was
  named `__spike_compile_all`, and Next treats `_`-prefixed folders as private — it was
  never routed and never bundled, while the build still reported success. Renamed to
  `spike-compile-all`, the route appears in the build output at **158 kB / 347 kB First
  Load**, and compilation is real.

### Per-component result

`LOC` is the kit file's line count. `External deps` lists non-React imports beyond
`@/lib/utils` and sibling kit components.

| Component | LOC | External deps | Result |
|---|---|---|---|
| `button` | 104 | @base-ui/react/button, class-variance-authority | COPY |
| `input` | 47 | @base-ui/react/input | COPY |
| `label` | 46 | none | COPY |
| `select` | 300 | @base-ui/react/select, lucide-react | COPY |
| `table` | 168 | none | COPY |
| `card` | 98 | none | COPY |
| `checkbox` | 54 | @base-ui/react/checkbox, lucide-react | COPY |
| `radio-group` | 60 | @base-ui/react/radio, @base-ui/react/radio-group | COPY |
| `textarea` | 38 | none | COPY |
| `tooltip` | 78 | @base-ui/react/tooltip | COPY |
| `permission-tooltip` | 76 | none | COPY |
| `empty-state` | 100 | lucide-react | COPY |
| `skeleton` | 18 | none | COPY |
| `banner` | 110 | class-variance-authority | COPY |
| `inline-field-error` | 43 | none | COPY |
| `alert-dialog` | 213 | @base-ui/react/alert-dialog | COPY |
| `dropdown-menu` | 290 | @base-ui/react/menu, lucide-react | COPY |
| `popover` | 97 | @base-ui/react/popover | COPY |
| `breadcrumb` | 132 | @base-ui/react/merge-props, use-render, lucide-react | COPY |
| `avatar` | 109 | @base-ui/react/avatar | COPY |
| `separator` | 26 | @base-ui/react/separator | COPY |
| `tabs` | 69 | @base-ui/react/tabs | COPY |
| `section-tabs` | 90 | next/navigation | COPY |
| `truncate` | 138 | none | COPY |
| `password-input` | 109 | lucide-react | COPY |
| `time-picker` | 227 | lucide-react | COPY |
| `input-group` | 158 | class-variance-authority | COPY |
| `command` | 196 | cmdk, lucide-react | COPY |
| `sonner` | 105 | lucide-react, sonner | COPY |
| `bar-chart` | 267 | recharts | COPY |
| `state-matrix-check` | 146 | none | COPY |

Total: **3,671 lines that do not have to be written.**

### The caveat that decides how big the win really is

**Compiling is not rendering, and the difference is measured.** Of the classes these
components reference, **43 do not resolve** against the spike's 21-token `@theme`. (52
were flagged; 9 are extraction artefacts — truncated arbitrary variants such as
`[&_svg:not([class*=`, `group/…` group names, and sonner's `bottom-right` prop value.)
**34 of the 38 copied components** use at least one.

They are not bugs in the components. They are tokens the components expect
`globals.css` to declare — **the kit's `globals.css` carries 203 token declarations; this
spike wrote 21.** Representative, with the number of components affected:

| Unresolved | Components | What it is |
|---|---|---|
| `text-body` | 17 | type scale (`AGENTS.md` §3) |
| `text-label` | 12 | type scale |
| `border-border` | 9 | neutral token |
| `h-control` | 9 | the §6.2 fixed 36px control height |
| `text-card-heading` | 7 | type scale — deliberately named to avoid the `--text-card`/`--color-card` collision §4.1 records |
| `bg-surface-control-pressed` | 7 | §6.3 state fill |
| `border-border-strong` | 6 | neutral token |
| `text-meta`, `max-w-field-max` | 5 each | type scale; §17 field cap |
| `max-h-menu-max` | 4 | §16.2 menu height |
| `h-control-sm/-lg`, `size-control*` | 1–3 | §6.2 sizes |
| `bg-chart-1` … `bg-chart-6` | 1 each | §21 categorical palette |
| `border-danger/success/warning-border` | 2–3 | §2.4 status borders |

**So the work moves rather than disappearing: from writing 31 components to porting one
stylesheet.** That is still a large net win, and it is a different and far more contained
job — one file, reviewable in one sitting, against 3,671 lines of component logic.

`lib/utils.ts` copies unmodified too, and it matters: its `cn()` is `extendTailwindMerge`
taught the type-scale names (`text-page-title`, `text-section`, `text-card-heading`,
`text-body`, `text-label`, `text-meta`) and the text-colour names. Without it, per §4.1,
`cn("text-label", "text-text-secondary")` classifies both as colours and silently drops
the font size.

---

## 3. What does v4 break in the existing 51 files?

(51 tracked `.tsx`, separated from the copied kit files by `git ls-files`.)

### Group A — lands on the raw palette classes: **effectively zero cost**

| Measure | Count |
|---|---|
| Palette colour utility occurrences | **2,423** |
| …of which `ring-<palette>` | 142 |
| …of which `border-<palette>` | 429 |
| `bg-opacity-*` / `text-opacity-*` / `border-opacity-*` (removed in v4) | **0** |
| Utilities renamed or removed by v4 | **0** |

v4 keeps every one of these class names. The palette moved to OKLCH — the stylesheet now
emits `.bg-gray-500{background-color:var(--color-gray-500)}` with
`--color-gray-500:oklch(55.1% .027 264.364)` — so rendered values shift imperceptibly,
against classes the token migration deletes anyway. **Nothing to do here.**

### Group B — the real cost: **50 sites change appearance, 159 more need attention**

| Change | Count | Effect |
|---|---|---|
| bare `border` / `border-x` with **no** border colour | **14 sites, 6 files** | v3's preflight defaulted border-color to `gray-200`; v4 uses `currentColor`. **Silently changes colour.** |
| `shadow-sm` | **26** | v4's `shadow-sm` is v3's `shadow`. **Renders heavier.** |
| bare `shadow` | **10** | v3's `shadow` is v4's `shadow-sm`. **Renders heavier.** |
| `outline-none` | **144** | v3 emitted `outline: 2px solid transparent; outline-offset: 2px`; v4 emits `outline-style: none`. Visually identical, **forced-colors behaviour differs**. |
| `flex-shrink-*` / `flex-grow-*` | **15** | Deprecated for `shrink-*`/`grow-*`. Still work. |
| bare `ring` / `ring-N` with **no** ring colour | **0** | v4's ring default change (3px→1px, blue-500→currentColor) **cannot bite** — every ring here names its colour. |
| `divide-x/y` with no divide colour | **0** | Same — non-issue. |
| `shadow-md/lg/xl/2xl` | 37 | Names unchanged. |

The 14 bare-border sites, in full:

```
src/app/(protected)/daily-activity/page.tsx:510, 639, 711, 843
src/app/(protected)/masters/page.tsx:162
src/app/(protected)/orders/page.tsx:218, 487, 489, 539
src/app/(protected)/review/[userId]/page.tsx:230, 286, 295
src/app/(protected)/weekly-plan/page.tsx:663
src/contexts/ToastContext.tsx:29
```

**Group B total: 209 sites, of which only 50 (14 + 36) actually change how a screen
looks.** The 144 `outline-none` are a semantic change with no visual one, and the 15
deprecations still compile.

Note the **390 half-step spacing values are not a v4 cost.** 362 of them (`py-2.5`,
`gap-1.5`, `w-3.5`, …) are in Tailwind 3's default scale and already resolved. They are
an `AGENTS.md` §5.1 violation under either version. Only the 28 below are new.

---

## 4. Does `w-4.5` / `h-4.5` resolve under v4?

# **Yes — and it must not arrive this way.**

v4's dynamic spacing scale emits them where v3 emitted nothing:

```css
.w-4\.5{width:calc(var(--spacing) * 4.5)}
.h-4\.5{height:calc(var(--spacing) * 4.5)}
--spacing: .25rem
```

4.5 × 4px = **18px**.

All **28 occurrences** sit in `src/app/(protected)/masters/page.tsx`, every one on an
`<svg className="w-4.5 h-4.5">` — the section icons on the masters index. Today they
compile to nothing and those SVGs fall back to their intrinsic size.

**Flipping the PostCSS plugin would resize 28 icons on a production screen, with no
diff touching that file and nothing in the build output mentioning it.**

The sharp edge: 18px is a *legal* size — `AGENTS.md` §23 allows exactly 16px, 18px and
22px, and 18px is the navigation/toolbar size. So the change would very likely look
*correct*, which is precisely why it would go unnoticed and unreviewed. It would be a
design decision made by a build config. Whoever does the upgrade rewrites these 28 to an
explicit size **in the same commit as the PostCSS change**, or deletes them first on
Tailwind 3 where their removal is visibly a no-op.

v4 resolves 31 distinct half-step utilities in total; 30 already resolved under v3.
`w-4.5`/`h-4.5` is the only newly-live one.

---

## RECOMMENDATION

**Upgrade to Tailwind 4: it converts Phase 2 from writing 31 components (3,671 lines) into
porting one 203-token stylesheet, the React-18 blocker in the active plan does not exist,
and the total v4 breakage in existing screens is 50 visible sites — provided the 28
`w-4.5`/`h-4.5` icons are fixed in the same commit as the PostCSS change.**

---

## What was changed on this branch (all discarded)

```
package.json / package-lock.json  tailwindcss 3.4.1 -> 4.3.3, +@tailwindcss/postcss,
                                  +@base-ui/react, cmdk, sonner, lucide-react, date-fns,
                                  react-day-picker, next-themes, cva, clsx,
                                  tailwind-merge; recharts 3.7.0 -> 3.10.1
postcss.config.js                 v4 plugin, autoprefixer dropped
src/app/globals.css               @import + @theme (21 tokens)
src/lib/utils.ts                  NEW — copied from kit
src/components/ui/*.tsx           NEW — 38 files copied from kit
src/app/(protected)/spike-compile-all/page.tsx   NEW — compile harness
```

`tailwind.config.ts` untouched. No existing `.tsx` modified. `PLAN.md` untouched.
`src/components/ui/Pagination.tsx` untouched and verified so.
