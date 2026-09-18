# 02 — Data Model Plan

> ## ✅ RESOLVED — schema verified against live, 18 Sep 01:30. See §8.
>
> The original warning is kept below for the record. **It has been discharged:** §8 records the
> live pre-flight, and the verdict is that the live schema **matches** §1. sfacrm-11 independently
> confirmed it changed no table, column, constraint, index or row.
>
> **Two claims in §1 and §1.4 below are now known to be WRONG — §8.1 corrects them.** In
> particular, **`orders.status` DOES have a CHECK constraint**; the statement at the end of §1.4
> is false. Read §8 before §1.
>
> ---
>
> ## ⚠️ ORIGINAL WARNING (superseded — kept for provenance)
>
> **The current schema recorded here was read while a migration was in progress, and must be
> re-verified against the live database before implementation begins.**
>
> Everything below was read from `prisma/schema.prisma` only. **No database was queried** — the
> read-only constraint barred it. That file is *generated* by `prisma db pull`; it is a snapshot,
> not the database. Its last refresh was commit `e58187a`, **2026-09-14 16:38:57** — four days
> before this plan. A migration running directly against live PostgreSQL would change nothing in
> it.
>
> Verified stable across this run (two readings, different HEADs):
>
> | # | Time | HEAD | `git hash-object prisma/schema.prisma` |
> |---|---|---|---|
> | 1 | 18 Sep 00:36 | `51f4dc0` | `54d1d7c4ad51b35d6effe1e9eae5f2eeb28bd4a8` |
> | 2 | 18 Sep 00:59 | `221f47e` | `54d1d7c4ad51b35d6effe1e9eae5f2eeb28bd4a8` |
>
> So the *file* did not move. Whether the *database* still matches it is **unknown and unknowable
> from here**. See `07-REVISIT-QUEUE.md` R4/R6 and the pre-flight step in
> `08-EXECUTION-SEQUENCE.md`.
>
> **Three things Prisma introspection cannot tell you, which this plan therefore cannot:**
> 1. **CHECK constraints are dropped by `db pull`.** `schema.prisma` carries a
>    *"contains check constraints"* doc comment on nine models but the constraint bodies are not
>    in any file. `role_permissions` is one of them — see §7, this is a blocker.
> 2. **Row counts and value distributions.** Every sizing decision below is shape-based. How many
>    `business_partners` rows carry a `contact_person_name`, how many are `stage='Existing'`, how
>    many are duplicates — all unknown.
> 3. **Values not present in code.** `orders.status` and `business_partners.type`/`stage` are
>    unconstrained text. Live may hold values that appear nowhere in the source.

---

## 1. Current schema — the tables Phases 1-5 touch

35 models. The affected ones, verbatim from `prisma/schema.prisma` at blob
`54d1d7c4`, read 18 Sep 00:59 IST.

### 1.1 `business_partners` (line 10) — **the "Leads" table**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | no | — | **no FK, no index** |
| `type` | text | **no** | — | free text; app-validated against `lead_types.name` |
| `name` | text | **no** | — | the company/party name |
| `distributor_id` | uuid | yes | — | FK → self |
| `mobile_1` | text | yes | — | app enforces 10 digits |
| `mobile_2` | text | yes | — | |
| `address` | text | yes | — | **single free-text address** |
| `description` | text | yes | — | "Description" on the form |
| `state_id` / `district_id` / `taluka_id` / `village_id` | uuid | yes | — | FKs to the geography hierarchy |
| `latitude` / `longitude` | `Decimal(10,7)` | yes | — | **needs `serialize()`** |
| `pincode` | text | yes | — | |
| `gst_number` | text | yes | — | GSTIN regex on PUT only |
| `contact_person_name` | text | yes | — | **the only person-name column** |
| `sub_type` | text | yes | — | **dead — no route, no page reads or writes it** |
| `stage` | text | **no** | `'Existing'` | funnel position **and** type discriminator |
| `temperature` | text | yes | — | Cold/Warm/Hot |
| `next_follow_up_date` | date `@db.Date` | yes | — | in `DATE_ONLY_FIELDS` |
| `is_active` | boolean | no | `true` | |
| `created_at` | timestamptz(6) | no | `now()` | |
| `updated_at` | timestamptz(6) | no | `now()` | ⚠️ **CORRECTED 18 Sep — this said "never written by any route". True at the route level, WRONG in effect.** A trigger maintains it: `set_business_partners_updated_at BEFORE UPDATE ... EXECUTE FUNCTION update_updated_at()`. Two study agents independently inferred it was stale because no route writes it; neither checked for a trigger, and nor did I. **Any reasoning that treats `updated_at` as frozen is wrong.** Separately: P1-T6's owner backfill flattened **all 594 rows to 2026-09-17**, so the original timestamps are destroyed — a real if minor loss, caused by this project's own migration, recorded rather than hidden. Found by B7-Backfill |
| `created_by_user_id` | uuid | yes | — | FK → `users.id`. **Null for every bulk-imported row** |

**Constraints and indexes: none.** No `@@unique`, no `@@index`, not even on `tenant_id`.
Duplicates by name or mobile are expected. **No `email`, no `website`, no `city`, no
`industry`, no owner column.**

### 1.2 The three lead masters — all flat, **no relations at all**

`lead_types` (171), `lead_stages` (152), `lead_temperatures` (162) share:
`id uuid PK`, `tenant_id uuid`, `name text`, `sort_order int default 0`,
`is_active bool default true`, `created_at timestamptz`.
`lead_stages` adds **`is_fixed bool default false`**.

**None has a unique constraint on `(tenant_id, name)`.**
**Nothing FKs to any of them** — `business_partners.type`/`.stage`/`.temperature` store the
*name string*.

Seeded per tenant (`api/superadmin/companies/route.ts:100-127`):
- `lead_types`: Dealer, Distributor, Institution, End Consumer
- `lead_stages`: Prospect(1, **fixed**), Contacted(2), Interested(3), Qualified(4), Proposal(5), Negotiation(6), **Existing(999, fixed)**
- `lead_temperatures`: Cold, Warm, Hot

### 1.3 Everything that points at a partner — **all soft, zero FKs**

**There is not one foreign key pointing at `business_partners` from any other table.**

| Table | Columns | How |
|---|---|---|
| `daily_visits` | `entity_id uuid?`, `entity_name text NOT NULL`, `visit_type text`, `is_new_entity bool` | `entity_id` = partner id, `visit_type` = the **lead-type name string** |
| `orders` | `entity_type text?`, `entity_id uuid?`, `entity_name text?` | `entity_type` = the **lead-type name string** |
| `business_partners` | `distributor_id` | dealer → distributor |

The display name is denormalised alongside every id, so rows survive partner deletion.
`contextual_remarks`/`notifications` use `(context_type, context_id)` but **no remark points at a
partner today** — written context types are `meeting`, `expense`, `weekly_plan_day`,
`weekly_plan`. `weekly_plan_items` has **no party reference at all**.

### 1.4 `orders` (219) / `order_items` (204)

`orders`: `id, tenant_id, user_id, visit_id (unique, FK→daily_visits, onDelete Cascade),
order_date @db.Date, total_amount Decimal(12,2) default 0, created_at, updated_at,
order_source text default 'meeting', entity_type text?, entity_id uuid?, entity_name text?,
status text default 'Confirmed'`

`order_items`: `id, tenant_id, order_id (FK→orders Cascade), product_id (FK→products),
product_name text, qty int default 1, rate Decimal(12,2) default 0,
amount Decimal(12,2) default 0, created_at`

**No discount column, no order number, no status history, no attachments, no notes, no deal link.**
`orders.status` has **no CHECK constraint** (proved: `db pull` emits the check-constraint doc
comment on `order_items`, `role_permissions`, `weekly_plans` and six others, but **not** on `orders`).

### 1.5 `products` hierarchy — three levels, mandatory

`product_categories` → `product_subcategories` (`category_id` NOT NULL) → `products`
(`category_id` **and** `subcategory_id` both NOT NULL, `price Decimal(12,2)` NOT NULL, `sku text?`).
Satisfies §7.2's Product/Category/Sub-Category dimensions and §4.1/§5.5's rate autofill **as-is**.

### 1.6 `users` (399) and the access closure

`users`: `id, tenant_id, name, email, contact, department_id?, designation_id?,
profile text default 'Standard', manager_user_id uuid?, status text default 'Active',
password, password_reset_token?, password_reset_expires?, role_id uuid?, credentials_version int default 1`
`@@unique([tenant_id, contact])`. **`manager_user_id` is a self-FK and has no index.**

`user_visibility`: `id, tenant_id, viewer_user_id (FK Cascade), target_user_id (FK Cascade), created_at`,
`@@unique([viewer_user_id, target_user_id])` (**`tenant_id` not in the key**),
`@@index([tenant_id, viewer_user_id])`.

`role_permissions`: `id, tenant_id, profile text, section text, can_view, can_edit, can_delete,
can_create, data_scope text default 'team'`, `@@unique([tenant_id, profile, section])`.
⚠️ **`profile` holds a ROLE NAME (`roles.name`), not `users.profile`.** ⚠️ **Marked as carrying
CHECK constraints — bodies unknown. See §7.**

### 1.7 `daily_visits` (69) — the Meeting entity, already well-shaped

`id, tenant_id, user_id (FK), visit_date @db.Date, visit_type text, entity_id uuid?,
entity_name text NOT NULL, is_new_entity bool default false, start_time timestamptz?,
end_time timestamptz?, duration_secs int?, latitude/longitude Decimal(10,7)?, address text?,
end_latitude/end_longitude Decimal(10,7)?, end_address text?, status text default 'Pending',
notes text?, created_at, updated_at` + 1:1 `orders`.

**Start/stop times and both location pairs already exist.** No manual-entry marker.

### 1.8 No settings table
No `app_settings`/`tenant_settings`/`system_settings` anywhere. Closest precedent:
`tenant_point_settings` (`tenant_id` **is** the PK).

---

## 2. Target schema after all five phases

New tables (9) and modified tables (5). Naming follows the existing convention: snake_case,
plural, `id uuid PK default gen_random_uuid()`, `tenant_id uuid NOT NULL`, `created_at/updated_at
timestamptz default now()`, soft delete via `is_active boolean`.

### 2.1 Renamed / modified

| Today | Target | Change |
|---|---|---|
| `business_partners` | **`companies`** | rename; + `owner_user_id`, `email`, `website`, `industry_id`, `is_complete`, `completeness_missing` |
| `lead_types` | **`company_types`** | rename only |
| `lead_stages` | **`deal_stages`** | rename; `Existing` row retired (§4) |
| `lead_temperatures` | *(unchanged)* | **kept** — see `09-OPEN-QUESTIONS.md` Q3 |
| `orders` | `orders` | + 6 discount columns; `status` default `'Confirmed'` → `'Draft'`; + `blocked_reason` |
| `order_items` | `order_items` | + 4 discount columns |
| `daily_visits` | `daily_visits` | + `is_manual_entry`, `location_flagged` |
| `weekly_plan_items` | `weekly_plan_items` | + `party_id`, `party_type`, `expected_order_value` |
| `users` | `users` | **no change** — `manager_user_id` already carries the hierarchy |

### 2.2 New tables

| Table | Purpose | Phase | Key columns |
|---|---|---|---|
| `contacts` | the person record | 1 | `name` NOT NULL, `mobile` NOT NULL, `alternate_mobile`, `whatsapp`, `email`, `designation`, `contact_type_id`, `owner_user_id`, `birthday @db.Date`, `anniversary @db.Date`, `notes`, `is_complete`, `is_active` |
| `company_contacts` | **many-to-many** Contact↔Company | 1 | `company_id`, `contact_id`, `is_primary bool`, `@@unique([company_id, contact_id])` |
| `company_addresses` | multiple addresses, one Primary | 1 | `company_id`, `label`, `address_line`, `city text`, `state_id`, `district_id`, `taluka_id`, `village_id`, `pincode`, `latitude/longitude Decimal(10,7)`, `is_primary bool` |
| `contact_types` | master | 1 | standard master shape |
| `industries` | master, pre-loaded | 1 | standard master shape |
| `custom_field_defs` | custom-field definitions | 1 | `entity text` (`company`\|`contact`), `label`, `field_type`, `options jsonb`, `sort_order`, `is_active` |
| `custom_field_values` | custom-field data | 1 | `def_id`, `entity_id`, `value text`, `@@unique([def_id, entity_id])` |
| `deals` | the pipeline | 2 | `name`, `owner_user_id`, `company_id?`, `contact_id?`, `expected_value Decimal(12,2)`, `probability int` (0-100, multiples of 10), `deal_stage_id`, `expected_close_date @db.Date`, `product_id?`, `product_category_id?`, `source`, `remarks`, `outcome text?` (`won`\|`lost`), `reason_for_loss_id?`, `stage_entered_at timestamptz`, `closed_at` |
| `deal_stage_logs` | §4.4 automatic stage history | 2 | `deal_id`, `from_stage_id?`, `to_stage_id`, `changed_by_user_id`, `changed_at`, `days_in_previous_stage int?` |
| `deal_follow_ups` | §4.5 | 2 | `deal_id`, `due_date @db.Date`, `mode text`, `status text` (`done`\|`not_done`), `notes`, `completed_at timestamptz?`, `visit_id uuid?` (pulls Minutes in) |
| `deal_attachments` | §4.8 | 2 | `deal_id`, `file_key text` (R2), `file_name`, `content_type`, `size_bytes`, `uploaded_by_user_id` |
| `reason_for_loss` | master | 2 | standard master shape |
| `deal_meetings` | §5.6 cross-links Deal↔Meeting | 3 | `deal_id`, `visit_id`, `@@unique([deal_id, visit_id])` |
| `weekly_goals` | §5.1 checklist | 3 | `weekly_plan_id`, `text`, `is_done bool`, `sort_order` |
| `tenant_settings` | §8 | 3 | `tenant_id uuid PK`, `auto_checkout_time`, `location_flag_threshold_m int default 500`, `deal_stage_ageing_days int default 15`, `updated_at`, `updated_by_user_id` |
| `journal_entries` | §6.3 | 4 | `user_id`, `week_start @db.Date`, `kind text` (`went_well`\|`improve`), `body text` |
| `saved_reports` | §7.1 | 5 | `user_id`, `name`, `config jsonb` |

**Summary comments, Deal notes and Minutes of the Meeting get NO new table** — they become new
`context_type` values on the existing `contextual_remarks` (see `01-GAP-ANALYSIS.md` C5).

---

## 3. What is a Company? — the decision the migration turns on

**This is the highest-consequence decision in the rebuild.** Stated here because §4's mapping
depends on it; recorded as an assumption in `09-OPEN-QUESTIONS.md` Q8.

`business_partners` holds **all four** of Dealer, Distributor, Institution and End Consumer, and
`/api/leads` returns **all of them**. The Leads page hides non-leads *client-side*. Four screens
share the table.

**Proposed reading — every `business_partners` row becomes a Company.**

Rationale: the seeded `lead_types` values *are* Company Types. §2's table says Lead Type →
**Company Type**, and §3.6 calls Company Type a user-defined master. A Dealer is a company; an
Institution is a company. Nothing is lost and no screen is silently redefined.

Consequences, all of which the plan handles:
- Masters → Dealers / Distributors / Institutions keep working, because their `where` clauses
  (`type: 'Dealer', stage: 'Existing'`) survive the rename untouched.
- The Companies list shows **all** of them, which is correct — it is the Parties list.
- Only rows with `stage != 'Existing'` get a Deal (§4).

**Rejected alternative:** "a Company is only a row with `stage != 'Existing'`". This would strand
every dealer and distributor outside Parties while three Masters screens still edit them, leaving
two contradictory front doors onto one table.

---

## 4. The Lead → Party migration, column by column

**Nothing is deleted. `business_partners` is renamed, not dropped**, so every soft reference in
`orders.entity_id` and `daily_visits.entity_id` keeps resolving.

### 4.1 `business_partners` → `companies`

| Source column | Target | Rule | Risk |
|---|---|---|---|
| `id` | `companies.id` | unchanged — **critical**, soft FKs depend on it | — |
| `tenant_id`, `is_active`, `created_at`, `updated_at` | same | unchanged | `updated_at` is stale everywhere (never written) |
| `name` | `companies.name` | unchanged | ⚠️ may hold a *person's* name for `End Consumer` rows. Undetectable automatically |
| `type` | `companies.type` | unchanged text; later FK to `company_types` | see §6 |
| `stage` | **stays on `companies`** during Phase 1 | source for §4.3 Deal creation; **not** removed | removing it early breaks the Masters `where` clauses |
| `temperature` | unchanged | **kept** pending Q3 | — |
| `mobile_1` | `companies.phone` **and** the Contact's `mobile` | **copied to both** | §3.3 puts a phone on the Company, §3.4 makes Contact Mobile compulsory. Copying is the honest move |
| `mobile_2` | `companies.phone_alt` | unchanged | — |
| `contact_person_name` | → a **`contacts` row** + `company_contacts` link | §4.2 | **the lossy step** |
| `address`, `pincode`, `state_id`, `district_id`, `taluka_id`, `village_id`, `latitude`, `longitude` | → one **`company_addresses`** row, `is_primary = true` | §4.4 | `city` has no source — see Q5 |
| `description` | `companies.notes` | rename | — |
| `gst_number` | unchanged | — | never validated on POST, so live may hold invalid values |
| `next_follow_up_date` | → a **`deal_follow_ups`** row when a Deal is created | §4.3 | dropped for rows with no Deal → Q9 |
| `distributor_id` | unchanged | **kept** pending Q4 | dropping breaks `/api/masters/distributors` |
| `created_by_user_id` | unchanged, **and** backfills `owner_user_id` | §4.5 | null for every bulk-imported row |
| `sub_type` | unchanged (dead column) | leave in place | confirm against live before any drop |
| — | `email`, `website`, `industry_id`, `is_complete`, `completeness_missing` | new, null/derived | — |

### 4.2 `contact_person_name` → `contacts` + `company_contacts`

```
FOR EACH companies row WHERE contact_person_name IS NOT NULL AND trim() <> '':
    INSERT contacts (name = contact_person_name,
                     mobile = mobile_1,            -- may be NULL; see below
                     owner_user_id = created_by_user_id,
                     is_complete = (mobile_1 IS NOT NULL))
    INSERT company_contacts (company_id, contact_id, is_primary = true)
```

**⚠️ DATA-LOSS / INTEGRITY FLAGS**

| # | Case | Effect | Handling |
|---|---|---|---|
| 1 | `contact_person_name` NULL | Company with **zero** Contacts | Legitimate. Not an error |
| 2 | `contact_person_name` set, `mobile_1` NULL | §3.4 makes Contact Mobile **compulsory** — an invalid Contact | Create it anyway with `is_complete = false`. **Do not drop the name.** Report the count |
| 3 | `name` is actually a person (likely for `End Consumer`) | Company named after a human | **Undetectable automatically.** Migrate as-is, flag Incomplete, report — exactly §10's ruling |
| 4 | Duplicate companies by name/mobile | Duplicates carry through | **No dedup in the migration.** §10: "Migrate as-is, flag as Incomplete, report them" |
| 5 | One row = at most one Contact | A company that really had three contacts still gets one | Inherent to the source. Not recoverable |

**Do not attempt to split a `contact_person_name` like "Rajesh / Suresh" into two contacts.**
Heuristic splitting invents data. One name, one contact.

### 4.3 Active leads → Deals

```
FOR EACH companies row WHERE stage NOT IN ('Existing') AND is_active = true:
    INSERT deals (name            = companies.name || ' — migrated',
                  company_id      = companies.id,
                  contact_id      = the linked contact, if exactly one,
                  deal_stage_id   = deal_stages.id WHERE name = companies.stage,
                  owner_user_id   = companies.created_by_user_id,
                  probability     = the stage's default band,
                  stage_entered_at= companies.updated_at ?? created_at,
                  expected_value  = 0)
    IF next_follow_up_date IS NOT NULL:
        INSERT deal_follow_ups (deal_id, due_date = next_follow_up_date,
                                mode = 'Other', status = 'not_done')
```

**⚠️ `stage = 'Existing'` MUST be excluded.** It is a type discriminator, not a funnel position.
Including it opens a bogus Deal against every dealer, distributor and institution in the tenant —
the single worst outcome available in this migration.

⚠️ `companies.stage` is **unconstrained text**. Live may hold values absent from `deal_stages`.
Any row whose `stage` does not resolve → **do not guess**: leave the Deal uncreated and report it.

⚠️ `stage_entered_at` is a **fiction** — `updated_at` is never written, so "days in current stage"
(§4.7) will read as very old for every migrated Deal. Either accept it, or set `stage_entered_at
= migration timestamp` so ageing starts from go-live. **Recommend the latter** and record it (Q10).

### 4.4 Addresses
One `company_addresses` row per company with any address data, `is_primary = true`.
`city` is left **NULL** — there is no source column (Q5).

### 4.5 Owner backfill
`owner_user_id = created_by_user_id`. For bulk-imported rows this is **NULL**. §3.3 wants Owner to
default to the logged-in user — which has no meaning retrospectively. Leave NULL, surface as
"Unassigned", and let it be assigned. **Do not invent an owner.**

---

## 5. Migration steps, in dependency order

Each step is independently reversible. **No step drops a column or a table.** Deletion is
deliberately deferred to a post-Phase-5 cleanup, once the new model has run against real data.

| # | Step | Depends on | Rollback |
|---|---|---|---|
| **0** | **PRE-FLIGHT** — confirm the other migration finished; `\d role_permissions`, `\d business_partners`, `\d orders` against live; diff live against this file; `SELECT status, count(*) FROM orders GROUP BY 1`; `SELECT stage, count(*) FROM business_partners GROUP BY 1` | — | n/a (read-only) |
| 1 | Create the 5 Phase-1 tables: `contacts`, `company_contacts`, `company_addresses`, `contact_types`, `industries` | 0 | `DROP TABLE` — nothing references them yet |
| 2 | Add nullable columns to `business_partners`: `owner_user_id`, `email`, `website`, `industry_id`, `is_complete`, `completeness_missing` | 0 | `DROP COLUMN` — all nullable, nothing reads them |
| 3 | Backfill `owner_user_id = created_by_user_id` | 2 | `UPDATE … SET owner_user_id = NULL` |
| 4 | Backfill `contacts` + `company_contacts` (§4.2) | 1 | `DELETE` both tables' rows |
| 5 | Backfill `company_addresses` (§4.4) | 1 | `DELETE` rows |
| 6 | Compute `is_complete` / `completeness_missing` | 2,5 | recompute or null |
| 7 | Create `custom_field_defs`, `custom_field_values` | 0 | `DROP TABLE` |
| 8 | **Rename** `lead_types`→`company_types`, `lead_stages`→`deal_stages` | 0 | `ALTER … RENAME` back |
| 9 | **Rename** `business_partners`→`companies` | 1-8 | `ALTER TABLE RENAME` back |
| 10 | `npm run prisma:sync` + code cutover to the new names | 8,9 | `git revert`; the DB rename is independently reversible |
| 11 | Add `role_permissions` sections + **backfill a row per `(tenant_id, profile)`** | 0 (A4!) | `DELETE` the new section rows |
| — | *Phase 1 ends here* | | |
| 12 | Create `deals`, `deal_stage_logs`, `deal_follow_ups`, `deal_attachments`, `reason_for_loss` | 9 | `DROP TABLE` |
| 13 | Migrate active leads → Deals (§4.3) | 12 | `DELETE FROM deals` — sources untouched |
| 14 | Add discount columns to `orders`/`order_items`; backfill `gross_amount = total_amount`, discounts `0`, `has_discount = false` | 0 | `DROP COLUMN` |
| 15 | `orders.status`: default `'Confirmed'`→`'Draft'`; map `Confirmed`→`Placed`, `Submitted`→(Q7); **add the CHECK constraint everyone already assumes exists** | 14, Q7 | keep a `status_legacy` copy column for one release |
| 16 | Add `orders.blocked_reason` | 0 | `DROP COLUMN` |
| — | *Phase 2 ends here* | | |
| 17 | `tenant_settings`; `weekly_plan_items` + `party_id`/`party_type`/`expected_order_value`; `weekly_goals`; `daily_visits` + `is_manual_entry`/`location_flagged`; `deal_meetings` | 9,12 | `DROP` |
| 18 | `journal_entries` | 0 | `DROP TABLE` |
| 19 | `saved_reports` | 0 | `DROP TABLE` |

**Step 15 is the only genuinely destructive step.** Everything else adds or renames. Keep
`status_legacy` for one release so the mapping can be audited against real orders.

### 5.1 Rename mechanics
`prisma/schema.prisma` is **generated**, never hand-edited. Every rename is DDL first
(`ALTER TABLE … RENAME TO …`), then `npm run prisma:sync`, then the code cutover. A rename is
metadata-only in PostgreSQL — instant, no table rewrite — and reversible by the inverse `ALTER`.

⚠️ After **any** schema change touching a `@db.Date` or `Decimal` column, `prisma:sync` must
regenerate `src/lib/generated/date-only-fields.ts`. `business_partners.next_follow_up_date` is
registered there today (`date-only-fields.ts:11`); a renamed table **must** be re-registered or
the wire contract silently changes from `"YYYY-MM-DD"` to a full ISO timestamp.

---

## 6. The string-key problem — the subtlest risk in the rebuild

`type`, `stage` and `temperature` are **free text matched to masters by name**. There is no FK, no
cascade, no constraint. Those same strings are copied into `orders.entity_type` and
`daily_visits.visit_type` as denormalised history.

**Consequence: renaming a master *value* orphans history silently.** Rename the Company Type
"Institution" and every historical order labelled `entity_type = 'Institution'` keeps the old
string with nothing to join to.

**Two options, both must be written down rather than chosen silently:**

- **(a) Leave the strings alone.** Phase 1 renames tables and *columns*, never master *values*.
  Cheapest, keeps history intact, but the data stays unconstrained.
- **(b) Normalise to FKs** — add `company_type_id`, backfill by name match, keep the text column as
  a legacy shadow. Correct long-term; a bigger Phase 1; any unmatched string must be reported, not
  guessed.

**Recommendation: (a) for Phase 1, (b) as a Phase 2 task** once Deal Stage already needs
`deal_stage_id` as a real FK. Recorded as Q11.

⚠️ `'Prospect'` and `'Existing'` are hardcoded in **six route files** and are `is_fixed: true`.
Renaming either breaks all five filtered views at once. **Do not rename them in Phase 1.**

---

## 7. Blockers that must be cleared before step 1

| # | Blocker | Why it blocks | How to clear |
|---|---|---|---|
| **B-1** | `role_permissions` CHECK constraint on `section` is **unknown** | If it constrains `section`, step 11 fails at runtime and every new permission silently reads `false` | `\d role_permissions` against live |
| **B-2** | The other migration's completion is unconfirmed | Phase 1 rewrites the same tables | Confirm with Aryan; re-diff the schema |
| **B-3** | `orders.status` live value distribution unknown | No CHECK constraint, so live may hold values absent from the code | `SELECT status, count(*) FROM orders GROUP BY 1` |
| **B-4** | `business_partners.stage` live value distribution unknown | Step 13 must not guess an unresolvable stage | `SELECT stage, count(*) FROM business_partners GROUP BY 1` |
| **B-5** | Row counts entirely unknown | Determines whether client-side pagination survives (A6) | `SELECT count(*)` on `business_partners`, `orders`, `daily_visits` |
| **B-6** | **`contextual_remarks.context_type` CHECK constraint is unknown** | **Gates the whole note-thread reuse strategy.** `schema.prisma:48` marks the table as carrying check constraints, and the code writes only `meeting`, `expense`, `weekly_plan_day`, `weekly_plan`. This plan reuses that table for **Deal Notes (P2-T6), Minutes of the Meeting (P3-T9) and Manager Comments (P4-T7)** — all of which need new `context_type` values. If the constraint enumerates the existing four, **every one of those inserts fails at runtime** | `\d contextual_remarks` |

All six are read-only queries. All six are in the pre-flight step of `08-EXECUTION-SEQUENCE.md`.

⚠️ **B-1 and B-6 are the same failure mode**, and it is the most dangerous one in this codebase: a
CHECK constraint that exists only in the live database, enumerating values that the code has
outgrown. `prisma db pull` **drops CHECK bodies**, so no file in this repo can tell you. Nine
models carry the *"contains check constraints"* marker — `business_partners` is **not** one of
them, but `contextual_remarks`, `role_permissions`, `order_items`, `weekly_plans` and
`daily_visits` all are. **Read every one of those five before planning around it.**

---

# 8. PRE-FLIGHT RESULTS — run 18 Sep 2026 01:30 IST against live

**Verdict: the live schema MATCHES §1 of this file.** `prisma/schema.prisma` is accurate as a
column inventory. Confirmed independently by sfacrm-11, which states it changed **no table,
column, constraint, index, migration or row**, and whose `git hash-object prisma/schema.prisma`
matches the hash read here (`54d1d7c4…`). **R4/R6 and E1/E2 are now CLOSED.**

Connected: PostgreSQL **17.6**, database `postgres`, 5 tenants.

## 8.1 CHECK constraints — the bodies, at last

`prisma db pull` drops these, so they existed in no file. All seven read directly:

| Table | Constraint | Body |
|---|---|---|
| `role_permissions` | `..._section_check` | **23 enumerated values** — `states, districts, talukas, villages, territory_mapping, dealers, distributors, institutions, product_categories, product_subcategories, products, departments, designations, expense_categories, lead_types, lead_stages, lead_temperatures, meetings, expenses, weekly_plan, orders, leads, users` |
| `contextual_remarks` | `..._context_type_check` | **4 values** — `meeting, expense, weekly_plan_day, weekly_plan` |
| `orders` | `..._status_check` | **`Draft, Submitted, Confirmed`** |
| `orders` | `..._entity_type_check` | **`Dealer, Distributor` — ONLY TWO** |
| `orders` | `..._order_source_check` | `meeting, direct` |
| `order_items` | `..._qty_check` / `..._rate_check` | `qty > 0` / `rate >= 0` |
| `daily_visits` | `..._status_check` | `Pending, Active, Completed` |
| `weekly_plans` | `..._status_check` | the 7 values, exactly as documented |
| `business_partners` | `..._sub_type_check` | `Institution, Consumer` |

### ⚠️ Two corrections to earlier documents in this set

1. **`orders.status` DOES have a CHECK constraint.** `01-GAP-ANALYSIS.md` D1 and
   `04-PHASE-2-PLAN.md` P2-T12 stated it did not, and called the comment in `status-badge.tsx`
   false. **That was wrong — the comment is correct.** The error came from inferring absence from
   Prisma's `/// This table contains check constraints` doc comment, which is **not emitted for
   `orders`**. **Prisma's marker is not a reliable signal for the absence of a constraint.** Both
   documents are corrected.
2. **`orders_entity_type_check` allows only `Dealer` and `Distributor`.** Nobody predicted this.
   See §8.4 — it is a live bug and a Phase 1 blocker.

### The three constraints that must be ALTERed before the build

```sql
-- P1-T9: before any new permission section
ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_section_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_section_check
  CHECK (section IN ( …existing 23…, 'companies','contacts','contact_types',
                      'industries','deals','deal_stages','reason_for_loss','system_settings' ));

-- P2-T6: before Deal notes / Minutes / Manager comments
ALTER TABLE contextual_remarks DROP CONSTRAINT contextual_remarks_context_type_check;
ALTER TABLE contextual_remarks ADD CONSTRAINT contextual_remarks_context_type_check
  CHECK (context_type IN ('meeting','expense','weekly_plan_day','weekly_plan',
                          'deal','order','daily_summary','weekly_summary','company','contact'));

-- P2-T12: Draft/Placed
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Draft','Placed'));
```

## 8.2 Data — the migration is far smaller than feared

| Measure | Value |
|---|---|
| `business_partners` | **594** |
| — `stage = 'Prospect'` | **546** |
| — `stage = 'Existing'` | **48** |
| — `type`: Dealer / Distributor / End Consumer / Institution | 373 / 102 / 74 / 45 |
| **with `contact_person_name`** | **47** |
| with a contact name but **no `mobile_1`** | **0** |
| with any address data | 197 |
| with `created_by_user_id` NULL (no owner) | **99** |
| **with a GST number** | **0** |
| duplicate `(tenant, lower(name))` groups | 70 |
| `orders` | **8** — all `Confirmed`, all `entity_type` NULL |
| `daily_visits` | 1127 |
| `users` / `tenants` | 22 / 5 |
| `contextual_remarks` | 16 |
| `role_permissions` | 155 (23 sections × 6-8 roles) |
| `user_visibility` rows / users with a manager | 31 / 14 |

**`type` and `stage` are orthogonal.** Most Dealers are Prospects; only 48 rows of any type are
`Existing`. So Masters → Dealers/Distributors/Institutions together show **48 rows**, while
`/api/leads` returns all 594.

**Every `stage` value resolves to its tenant's `lead_stages` master — zero orphans.** The Phase 2
Deal migration has no unresolvable rows. Note tenant `0000…0001` has an **8th stage, "Agreement
made"**, which the `status-badge` vocabulary does not know (it renders with the fallback icon).

**Resolved by data:**
- **Q9 / data-loss case 2 is empty** — no row has a contact name without a mobile. The Contact
  backfill produces **47 clean contacts**, not 594 messy ones.
- **Q2 (pagination) is not urgent.** 594 rows is well within client-side paging. Revisit at ~5k.
- **Q12 (manual `user_visibility` overrides)** — 31 rows against 14 managed users. Plausible for a
  pure closure but **not proof**; P1-T2 must still compare against a computed walk before
  rebuilding.

## 8.3 ⚠️ NEW BLOCKER — the completeness rule disqualifies 100% of parties

§3.5 makes **Primary Address, City, State, Pincode and GST Number** compulsory before an order can
be Placed. Against live data:

- **`gst_number` is populated on 0 of 594 rows.**
- **`city` does not exist as a column at all.**

So under the rule as written, **every single party is Incomplete and no order can ever be
Placed.** That is business-stopping on day one, and it is not a migration edge case — it is the
rule meeting the data.

**This supersedes and broadens Q5.** It needs Aryan. Proposed default (see `09-OPEN-QUESTIONS.md`
Q5): completeness is **enforced for newly created/edited parties only**; migrated rows are marked
`is_complete = false` with `completeness_missing` populated, and the **order-blocking rule is
switched on separately** once real data has been filled in. That preserves the requirement without
freezing the business.

## 8.4 ⚠️ NEW BLOCKER — `orders.entity_type` accepts only Dealer and Distributor

`CHECK (entity_type = ANY (ARRAY['Dealer','Distributor']))`.

`orders.entity_type` stores the **lead-type name string**. The tenant already has 45 Institutions
and 74 End Consumers. **An order booked against either one violates the constraint and fails at
write time.** It has not surfaced because all 8 existing orders have `entity_type` NULL (nullable,
so the CHECK passes).

Phase 1 makes Company Type a **user-defined master** — so *any* new type breaks order creation.

**Required in Phase 1, not Phase 2:**
```sql
ALTER TABLE orders DROP CONSTRAINT orders_entity_type_check;
```
Replace it with either `CHECK (entity_type IN ('company','contact'))` after the party model lands,
or no constraint at all. **Do not re-enumerate master values in a CHECK** — that is the exact trap
that produced this bug.
