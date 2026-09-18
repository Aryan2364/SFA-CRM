# 04 — Phase 2 Plan: Deals

Source: `REBUILD-PLAN.md` §4. **Phase 1 must be complete** — Deals hang off Companies and Contacts.

## Scope
The Deal entity end to end (fields, list, Kanban, card, notes, logs, follow-ups, closing, ageing,
attachments, filters, pipeline strip), the two new masters, and the Order module change (§4.10).

## Explicit NON-scope
- **Tasks against a Deal** — §9 item 1, deferred. Follow-ups may already cover the need.
- **Configurable Deal Card** — §9 item 3. The layout is fixed, six items. Not a setting, not
  per-user.
- **Discount approval workflow** — §9 item 4. Discounts are *flagged*, never approved.
- Probability editable on the Kanban card — §12, closed. Inside the Deal only.
- Server-side pagination (Q2).

---

## Tasks

### **P2-T1 · AGENTS.md pattern proposal for the board** · M · FIRST, BLOCKS P2-T8

**A process gate, not code.** rgb-kit ships **no kanban, board, or drag-and-drop component**, and
`AGENTS.md` never mentions one. Its §30 requires a pattern the file does not cover be *agreed and
written into AGENTS.md first, then built*. `REBUILD-PLAN.md` §0.4 independently forbids inventing
component patterns.

Write a proposal against `D:\RGB_Software\rgb-kit-v2\AGENTS.md` §30 covering: column layout, card
anatomy, drag affordance, drop target, keyboard alternative, touch behaviour, and the empty-column
state. **Send it to Aryan and wait.** Do not build the Kanban until the pattern is in AGENTS.md.

⚠️ rgb-kit-v2 is a **separate repo** — this run had read-only access to it. Whoever does this needs
write access there, or Aryan applies the patch.

**Acceptance:** a merged AGENTS.md section describing the board pattern.

---

### **P2-T2 · Deal tables** · M · after Phase 1

`02-DATA-MODEL-PLAN.md` step 12: `deals`, `deal_stage_logs`, `deal_follow_ups`,
`deal_attachments`, `reason_for_loss`. Then `npm run prisma:sync`.

⚠️ `deals.expected_value Decimal(12,2)` and every date column must be verified in
`src/lib/generated/date-only-fields.ts` — a `Decimal` JSON-stringifies to a **string** and silently
corrupts totals if `serialize()` is not given the model name.

⚠️ `probability int` must be constrained to multiples of 10 (§4.1: 11 stops, values like 33 or 54
are not allowed). Enforce with a CHECK **and** in the route — `01-GAP-ANALYSIS.md` D1 shows what
happens when everyone assumes a constraint that is not there.

---

### **P2-T3 · The two new masters** · S · after P2-T2

Deal Stage (the re-pointed `deal_stages`, renamed in P1-T8) and Reason for Loss — one `MASTERS`
registry entry each (P1-T3).

⚠️ `deal_stages` still contains the **`Existing`** row (`sort_order 999`, `is_fixed: true`), which
is not a funnel stage. Mark it inactive or exclude it from the Deal Stage picker — but **do not
delete it**; `02-DATA-MODEL-PLAN.md` §6 explains why the string is load-bearing for five filtered
views.

---

### **P2-T4 · Migrate active leads into Deals** · L · after P2-T2

`02-DATA-MODEL-PLAN.md` §4.3, step 13. Script in `scripts/`, idempotent, with `--dry-run`.

**⚠️ `WHERE stage NOT IN ('Existing')` is mandatory.** Without it, a Deal opens against every
dealer, distributor and institution in the tenant — the worst outcome available in this migration.

Report (do not guess): rows whose `stage` has no matching `deal_stages` row; rows with no owner.
Set `stage_entered_at` to the migration timestamp, not `updated_at` — `updated_at` is never
written by any route, so ageing would read as years old for every migrated Deal (Q10).

**Rollback:** `DELETE FROM deals` — sources untouched.

---

### **P2-T5 · Deals API** · L · after P2-T2

`src/app/api/deals/route.ts` (GET, POST), `deals/[id]/route.ts` (GET, PUT, DELETE),
`deals/[id]/stage/route.ts` (PATCH — the Kanban drop target),
`deals/[id]/follow-ups/route.ts`, `deals/[id]/attachments/route.ts`,
`deals/[id]/close/route.ts` (POST — Won/Lost).

Follow `00-CODEBASE-MAP.md` §4 exactly: `requireUser()` → `checkPermission(user,'deals',…)` →
`getTenantId()` → try/catch → `serialize(rows,'deals')` → **bare array**.

The stage PATCH must write a `deal_stage_logs` row with `days_in_previous_stage` computed from
`stage_entered_at`, then reset `stage_entered_at` (§4.4).

`POST .../close` requires Won **or** Lost (§4.6); Lost requires `reason_for_loss_id`.

---

### **P2-T6 · Deal Notes via `contextual_remarks`** · M · after P2-T5

**Do not create a notes table.** `contextual_remarks` is already a tenant-scoped, timestamped,
threaded note primitive keyed by `(context_type, context_id)` with read-tracking
(`remark_reads`) and notification fan-out. Add `'deal'` as a context type in
`src/app/api/remarks/route.ts:68-80` (today it writes only `meeting`, `expense`,
`weekly_plan_day`, `weekly_plan`).

> ⚠️ **BLOCKER — check before writing a line.** `contextual_remarks` is marked at
> `schema.prisma:48` as carrying **CHECK constraints**, and `prisma db pull` drops the bodies, so
> no file in this repo has them. **If `context_type` is constrained to the existing four values,
> this task fails at runtime** — and so do P3-T9 (Minutes) and P4-T7 (Manager Comments), which
> depend on the same reuse.
> `\d contextual_remarks` is pre-flight blocker **B-6**. If constrained: widen the constraint as
> the first step of this task, or **stop and report** — three phases would need re-planning.

§4.4 also requires a note written in a Meeting to be **linkable** to a Deal or an Order — that is
Phase 3 (P3-T9); leave the hook, build it there.

---

### **P2-T7 · Deals list view** · M · after P2-T5

`src/app/(protected)/deals/page.tsx` on `ListPage`. Columns per §4.2 (Name, Company, Phone,
Stage, Value, Probability, Days in Stage, Next Follow-up). One `grow` column only. Ageing shown
here **as well as** on Kanban (§4.7).

All the `list-page` hard rules from `03-PHASE-1-PLAN.md` P1-T13 apply unchanged.

---

### **P2-T8 · Kanban view** · L · after P2-T1 (gate) and P2-T7

Stage columns from `deal_stages`. Drag-and-drop; on drop the stage updates immediately and writes
to Logs (§4.2).

**Deal card — fixed six items, in this order, not configurable (§4.3, §12):**
1. Company Name — largest text on the card
2. Deal Name — smaller, below
3. Expected Value
4. Probability — thin bar + figure, **read-only on the card**
5. Days in Current Stage — warning colour past the limit
6. Next Follow-up Date — warning colour once passed

Owner as a small initials circle, top corner (it matters in the Manager view where many people's
cards share a column).

⚠️ **No probability slider on the card.** §12 closed this: a slider on a draggable card conflicts
with drag-and-drop, especially on a phone.

⚠️ Touch drag on a phone is exactly what A3 (mobile) is unresolved about. Do not start until Q1
has an answer.

---

### **P2-T9 · Follow-ups** · M · after P2-T5

§4.5: multiple per Deal — Due Date, Mode (Meeting/Call/Email/WhatsApp/Other), Status, Notes,
Completed On. The **earliest open** follow-up is what shows on the card. On marking one Done,
**prompt** for the next date — prompt only, never compulsory.

The Meeting→Minutes auto-pull (§4.5) is Phase 3; leave `deal_follow_ups.visit_id` unused here.

---

### **P2-T10 · Pipeline header strip** · S · after P2-T7

Above both views: number of deals, total Estimated Value, Weighted Value (Σ value × probability).
Use `fmtAmount` from `src/lib/format.ts` (P1-T4).

---

### **P2-T11 · Deal attachments** · M · after P2-T5

§4.8. **R2 plumbing already exists** — `src/lib/r2.ts` (`putObject`, `getSignedInlineUrl`,
`receiptKey`), `POST /api/expenses/upload` (JPG/PNG ≤5 MB), and `GET /api/expenses/photo/[id]`
which authorises then **302s to a 300-second signed inline URL**. Copy that shape exactly for
`/api/deals/[id]/attachments`; generalise `receiptKey` to a `dealKey(tenantId, file)`.

⚠️ Quotations and proposals mean **PDF**, not just images — widen the content-type allow-list, and
keep the size cap explicit.
⚠️ **There is no file-upload component** in rgb-kit; AGENTS.md §29 is a rule with no code behind
it. The uploader is built from scratch against §29's bullet list — or proposed via §30 like the
board.

---

### **P2-T12 · Order Draft/Placed** · M · after Phase 1

✅ **CORRECTED against live, 18 Sep 01:30.** `orders.status` **DOES** carry
`CHECK (status IN ('Draft','Submitted','Confirmed'))`. An earlier draft of this task said it did
not and told you to delete `status-badge.tsx`'s comment as false — **do not do that; the comment
is correct.** G8 is withdrawn.

So this task must **ALTER the constraint**, not merely change TypeScript unions:
```sql
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Draft','Placed'));
```
Live data is trivially small: **8 orders, all `Confirmed`** → all become `Placed`. **No row is
`Submitted`**, so Q7 is currently academic for existing data — but the *code* still writes
`Submitted`, so the decision is still needed for future orders.

Files, all of them:
- `src/components/status-badge.tsx` — `ORDER_STATUS` becomes two entries; delete both false
  "CHECK-constrained" claims.
- `src/app/(protected)/orders/page.tsx` — the union `'Draft'|'Submitted'|'Confirmed'` appears
  **six times** (`OrderRow.status`, `CreateOrderModal` state, `handleSave` body, `OrderDetailDrawer`
  props/state, `updateStatus` param), plus two `<select>`s and `STATUS_OPTIONS`.
- `src/app/api/orders/route.ts` — the body type; **the meeting branch must set `status` explicitly**
  instead of inheriting the DB default.
- `src/app/api/orders/[id]/route.ts` — the PATCH body type, **and add real validation** (any string
  is written today).
- `src/app/api/masters/users/[id]/deactivation-summary/route.ts:19` — `notIn: ['Delivered',
  'Cancelled','Rejected']` excludes nothing (G7). Becomes `status: 'Draft'`.
- DB: default `'Confirmed'` → `'Draft'`; add the CHECK constraint; keep `status_legacy` for one
  release.

⚠️ **`'Submitted'` has no home in a two-state model** — Q7. Do not start until it is answered.

§3.5's rule lands here: an Order against an Incomplete Party **stays Draft and cannot be Placed**.
Read `companies.is_complete`; populate `orders.blocked_reason` with what is missing.

---

### **P2-T13 · Discounts** · L · after P2-T12

§4.10. **Zero support exists at any layer** — proved by `grep -rni "discount" src prisma scripts`
returning zero files, and by the complete column lists of all six candidate tables.

Columns per `02-DATA-MODEL-PLAN.md` §2.1 / step 14. `amount` becomes the **net** line total and
`orders.total_amount` stays the **net** payable, so nothing downstream breaks. Backfill
`gross_amount = total_amount`, discounts `0`, `has_discount = false`.

⚠️ **Order totals are computed twice today** — server-side in `POST /api/orders` from
client-supplied `qty`/`rate`, and independently in the browser. Discounts triple that duplicated
arithmetic. **Move the calculation into one shared module** (`src/lib/order-math.ts`) that the
route and the client both import, with the **route as the authority**: it must re-read
`products.price` and recompute rather than trust posted numbers. Otherwise §7.4's "Discount Given
by Sales Person" reports over figures a rep typed.

`has_discount` is **stored, not derived**, so it is indexable and directly serves §7.2's
"Discount Applied (Yes/No)" dimension.

**Acceptance:** an order with a 10% line discount and a flat order discount shows the right gross,
discount and net; it is visibly flagged in the list; a tampered client payload does not change the
stored total.

---

## Parallelism

```
P2-T1 (AGENTS.md gate) ──────────────────── BLOCKS P2-T8
P2-T2 tables ─┬─ P2-T3 masters
              ├─ P2-T4 migrate ──────┐
              └─ P2-T5 API ─┬─ P2-T6 notes
                            ├─ P2-T7 list ─┬─ P2-T8 kanban (also needs T1)
                            │              └─ P2-T10 strip
                            ├─ P2-T9 follow-ups
                            └─ P2-T11 attachments
P2-T12 order states ─ P2-T13 discounts      (independent of the Deal track)
```
**Critical path:** T2 → T5 → T7 → T8 (gated on T1, which should start on day 1).
**Fully parallel track:** T12 → T13.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Kanban built before the AGENTS.md pattern exists | P2-T1 is a hard gate |
| R2 | The Deal migration opens deals against every dealer | `WHERE stage NOT IN ('Existing')`, plus a `--dry-run` count reviewed before the real run |
| R3 | Discount arithmetic diverges between client and server | One shared module; server re-reads `products.price` |
| R4 | `Submitted` orders silently mis-mapped | Q7 answered before P2-T12; `status_legacy` kept one release |
| R5 | Probability accepts 33 | CHECK **and** route validation — do not trust one |
| R6 | Drag-and-drop unusable on a phone | Blocked on Q1 (A3) |
