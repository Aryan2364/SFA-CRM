# Phone screen plan (for owner approval — kit 41.1 rule 5)

Draft only. Nothing here is built. Each screen's three-group sort below must be
agreed before any phone work starts (41.1 rules 1–5). Kit source: `D:\RGB_Software\kits\frontend-kit\FRONTEND_RULES_PHONE.md`
sections 41.1, 41.5–41.7, 41.15–41.16.

## Tab bar (41.4 rule 15, 41.15)

| Tab | Screen | Notes |
|---|---|---|
| 1 | **Today** | Product's home; replaces "My work" as tab 1 per owner's decision — see Open Q1 |
| 2 | **Accounts** | `/parties/companies`, list (41.5) |
| 3 | **Opportunities** | `/deals`, list as a board-on-phone (41.5 rules 20–22) |
| 4 | **Orders** | `/orders`, list |
| 5 | **More** | Expenses, Profile, Install app, Sign out (41.4 rule 15, 41.18) |

5 tabs = kit's maximum (41.4 rule 13). No room for a 6th without cutting one.

---

## 1. Today (home)

Tasks: check-in/out, see today's visits & next meetings, see follow-ups due, log a meeting fast.

**On the screen**
- Check-in / Check-out button (state-dependent, one primary action) — `POST /api/attendance/check-in`, `POST /api/attendance/check-out`. Body: `latitude, longitude, address` (all read from phone GPS, kit 41.16 rules 9–11; API itself does not enforce required/optional — no validation found beyond destructuring, see Open Q2).
- "+ Log" floating action (41.5 rule 7) → opens meeting/visit log form.
- Today's visits — list of up to a few rows (meetings already logged today), each 3 lines max (41.5 rule 10).
- Follow-ups due today — `companies.next_follow_up_date` / `deal_follow_ups` rows due today.
- Next meetings — from `deal_follow_ups` (mode "Meeting") and `companies.next_follow_up_date`.

**One tap away**
- Row → opens the meeting/visit/account/opportunity record.
- "Show more" on follow-ups/visits once the short list is exceeded.

**Computer only**
- Full daily-activity calendar (`/daily-activity` desktop calendar view), weekly plan editing, team attendance view (`dashboard/manager`).

**APIs feeding this screen**
| Data | Route | Permission |
|---|---|---|
| Check-in/out | `POST /api/attendance/check-in`, `/check-out` | **confirmed: no `checkPermission` call at all** — gated only by `requireUser()`; always acts on the caller's own row, by construction not by permission (see Open Q2) |
| Today's attendance status | `GET /api/attendance` | `meetings:view` |
| Today's visits/meetings | `GET /api/daily-activity` | `meetings:view` |
| Follow-ups due | `GET /api/deals/[id]/follow-ups` (per-deal) — no single "due today across all deals" endpoint found; `GET /api/dashboard/stats` aggregates some counts | `deals:view` / varies |
| Dashboard counts | `GET /api/dashboard/stats` | gated per-section via `checkPermission(user, section, 'view')`, see file comment: route previously ran with NO auth check at all until fixed |
| Notifications | `GET /api/notifications` | **confirmed: no `checkPermission`** — `requireUser()` only; filters to `recipient_id = user.userId`, which is itself sufficient scoping |

`GET /api/dashboard/stats` returns tenant-wide reference counts (states, districts, users, products, weekly plans) gated per-metric, not a "today" feed — it does **not** supply today's meetings/expenses/orders. A real Today screen needs separate calls: `GET /api/attendance` (today's status, `meetings:view`), `GET /api/daily-activity` (today's visits, `meetings:view`), and whatever per-account follow-up/next-meeting queries are needed — no single aggregator exists yet.

---

## 2. Log a meeting/visit + Set next meeting

Primary record-creation task. API: `POST /api/daily-activity` — gated `meetings:create`.

**Fields (from `src/app/api/daily-activity/route.ts`)**
| Field | Required? | Notes |
|---|---|---|
| `visit_type` | **Required** | e.g. meeting type |
| `entity_id` / `entity_name` / `is_new_entity` | one of these effectively required | the account being visited; `new_prospect.name` required if creating inline |
| `visit_date` | Optional | defaults to business-date "today"; future dates rejected |
| `is_manual_entry`, `manual_start_time`, `manual_end_time` | Required together | only for a past/offline entry; both start+end required if manual |
| `contact_id` | Optional | |
| `deal_id` | Optional | tag the visit to an Opportunity — see Open Q4 |
| `deal_follow_up_id` | Optional | marks a follow-up as fulfilled by this visit |
| `weekly_plan_item_id` | Optional | ties visit to a planned call |
| `attendees` | Optional | |
| `new_prospect` | Optional | `{name (required if used), mobile?}` — creates a bare account inline |

Live check-in/out (GPS) is a separate flow (`/api/attendance/check-in`/`check-out`), not part of this POST — see Open Q5 on how "log a meeting" and "check-in" relate.

**Confirmed: "Set next meeting" already exists as its own flow on desktop**, decoupled from the log-meeting form — `NextMeetingDialog` (`src/components/daily-activity/next-meeting-dialog.tsx`), opened automatically after "Stop" or manually from a completed meeting's card. Fields: `due_date` (required, date picker) and `deal_id` (optional, select among the account's open Opportunities). Posts to `/api/daily-activity/[id]/next-meeting`, writing to `deal_follow_ups` if a deal is chosen, else `companies.next_follow_up_date`. The phone screen should reuse this exact two-field shape, not invent a new one.

**On the screen**
- Account picker (existing account, or quick "new prospect": name + mobile only, matching `QuickCreateDialog`'s "two fields" pattern).
- Visit type (select, bottom sheet, 41.7 rule 7).
- Save (one primary action, action bar).
- "More details" disclosure (41.7 kit does not name a disclosure pattern explicitly for this — treat optional fields below as "More details" is a product decision, see Open Q6): contact, tie to an Opportunity, notes.

**One tap away**
- "Set next meeting" after saving (per Proposed extras below) → `GET/PUT/DELETE /api/daily-activity/[id]/next-meeting`, gated same as the visit's account/deal scope. Writes either a `deal_follow_ups` row (mode "Meeting") when tied to an Opportunity, or `companies.next_follow_up_date` when not.
- Attendees, weekly-plan link, manual start/end time entry (for a forgotten live check-in).

**Computer only**
- Bulk attendee management, the visit history/audit screen (`/api/daily-activity/[id]/history`), "couldn't meet" bulk flow (`/api/daily-activity/couldnt-meet`).

---

## 3. Add expense

API: `POST /api/expenses` — gated `expenses:create`. Photo: `POST /api/expenses/upload` — gated `expenses:create`.

**Fields (`src/app/api/expenses/route.ts`)**
| Field | Required? |
|---|---|
| `expense_date` | **Required** — string "YYYY-MM-DD", must be ≤ today (business date) |
| `category` | **Required** |
| `amount` | **Required** — number > 0, ≤ 9,999,999,999.99 (Decimal 12,2) |
| `notes` | Optional |
| `photo_url` | Optional — if present, must pass an HMAC check tying it to this tenant+user (`isOwnPhotoUrl`), else 400 |

Upload (`POST /api/expenses/upload`, multipart form-data): `file` required, must be image/jpeg/jpg/png, ≤5MB. Returns `{url}` keyed by a photo id (not the expense id — a documented deviation from the original plan).

**On the screen**
- Category (select sheet), Amount, Date (phone picker), Save — one column, one primary action.
- "Take photo" / choose photo (41.7 rule 9).

**One tap away**
- Notes field ("More details").
- Past expenses list / photo viewer.

**Computer only**
- Expense calendar/report view (`/api/expenses/calendar`), approval workflows if any (not found in routes read — see Open Q7).

---

## 4. Create account (Accounts = Company/Individual, `/api/companies`)

**Important correction**: Accounts map to `/api/companies`, not `/api/business-partners` — the latter is a narrow `{id, name}` picker reused by the old "business partner" naming in the meeting modal (its own doc comment says so explicitly), and still gates on `companies:view`. Create goes through `POST /api/companies`, gated `companies:create`.

**Fields (`src/app/api/companies/_handlers.ts`)**
| Field | Required? | Notes |
|---|---|---|
| `account_kind` | Optional | `'Company'` (default) or `'Individual'` |
| `name` | **Required for Company.** For Individual, required *unless* `self_contact_id` or `self_new_person.name` is given | |
| `self_contact_id` | Individual only, one-of with `self_new_person` | links an existing contact as "Self"; 409 if that contact is already Self elsewhere (→ individual-conflict-dialog.tsx shows `existing_account_id`) |
| `self_new_person.name` | Individual only, required if no `self_contact_id` | |
| `self_new_person.mobile`, `.email` | Optional | validated if present |
| `type` | Optional | must match the type master's "applies to" Company/Individual/Both |
| `mobile_1`, `mobile_2` | Optional | validated format |
| `gst_number`, `pincode`, `email`, `landline` | Optional | validated format |
| `contact_person_name`, `address`, `description`, `website`, `industry_id` | Optional | |
| `state_id`, `district_id`, `taluka_id`, `village_id` | Optional | FK-checked against tenant |
| `temperature`, `next_follow_up_date` | Optional | |
| `owner_user_id` | Optional | defaults to creator; must be inside caller's own scope or 403 |

**On the screen (minimum, matching `QuickCreateDialog`'s philosophy: "Name + Mobile only")**
- Kind toggle (Company/Individual) if the phone screen offers both — see Open Q8.
- Name, Mobile — Save. Record is created `is_complete: false` with `completeness_missing` shown.

**One tap away**
- "More details" sheet/screen: type, GST, address hierarchy, email, industry, owner, temperature, next follow-up.
- Individual-conflict resolution (409 response → sheet offering "Go to existing account").

**Computer only**
- Bulk import/template/parse (`/api/companies/bulk-*`), links/members management, addresses sub-resource beyond the primary one.

---

## 5. Create contact

API: `POST /api/contacts` — gated `contacts:create`.

**Fields (`src/app/api/contacts/_handlers.ts`)**
| Field | Required? |
|---|---|
| `name` | **Required**, non-empty |
| `mobile` | Optional, format-checked, stored as `''` if blank |
| `alternate_mobile`, `whatsapp` | Optional, format-checked |
| `email` | Optional, format-checked |
| `designation` | Optional |
| `contact_type_id` | Optional FK |
| `owner_user_id` | Optional — explicit value must be in caller's `contacts` scope (403 otherwise); else inherited from the sole linked company's owner if in-scope, else the creator |
| `birthday`, `anniversary` | Optional dates |
| `notes` | Optional |
| `company_ids` | Optional array of FK ids (many-to-many via `company_contacts`), all tenant-checked |
| `primary_company_id` | Optional, must be among `company_ids` |
| `is_active` | Optional bool |
| `landline` | Optional, format-checked |

**On the screen**: Name, Mobile, which account it belongs to (`company_ids`/`primary_company_id`) — Save.
**One tap away**: email, alternate mobile/WhatsApp, designation, birthday/anniversary, notes, "make individual" (`/api/contacts/[id]/make-individual`).
**Computer only**: bulk contact tools if any, contact de-dup tooling.

---

## 6. Create opportunity + move stage

Create: `POST /api/deals` — gated `deals:create`. Fields: `name` (**required**), `company_id` (**required** — as of the 2026-10-13 spec; caller needs ≥'read' access via sharing), `contact_id` (optional, must be linked to `company_id`), `owner_user_id` (optional, defaults to caller), `expected_value` (optional, validated), `probability` (optional, validated, DB CHECK also backs it), `deal_stage_id` (optional FK — **only usable at create time**), `expected_close_date` (optional), `product_id`/`product_category_id` (optional FK), `source`, `remarks` (optional).

**Confirmed on `deal-dialog.tsx`:** a Stage field is shown but is write-only on create and explicitly inert on edit — a code comment states the stage is changed only from the opportunity's own menu, which is what keeps its stage history (`deal_stage_logs`). So the phone create form may offer an initial stage picker, but the edit/record screen must never expose stage as an editable field — only "Move to" (41.5 rule 22).

Move stage: `PATCH /api/deals/[id]/stage` — gated `deals:edit` (not `create`; a read-only role must not be able to drag a card). Body: `{ deal_stage_id }` **required**. Server re-derives `stage_entered_at` and writes a `deal_stage_logs` row atomically; dropping on the same column is a no-op (no log, no clock reset).

Stages master: `GET /api/deals/stages`.

**On the screen**
- Name, Account (required) — Save. (No stage picker on create, per kit's board-on-phone move pattern and the existing desktop dialog.)
- Board-on-phone list (41.5 rules 20–22): status chips above rows, "Move to" per record/sheet — no drag on phone.

**One tap away**
- Value, close date, contact, follow-ups, attachments, members — all "More details" / related-record rows (41.6 rule 5).
- "Move to" stage sheet.

**Computer only**
- Full Kanban drag board, bulk member management, attachment management beyond viewing.

---

## 7. Place order

API: `POST /api/orders` — gated `orders:create`.

**Fields (`src/app/api/orders/route.ts`)**
| Field | Required? | Notes |
|---|---|---|
| `items` | **Required**, non-empty array | server re-prices every line from authoritative rates — client-sent `rate`/discount amounts are never trusted |
| `items[].product_id` | Optional FK | if given, server overrides `rate`/`product_name` from the products master — posted values discarded |
| `items[].product_name` | Required only if no `product_id` | ignored otherwise |
| `items[].qty` | **Required**, integer, 1–1,000,000 | |
| `items[].rate` | Optional | only used/validated when no `product_id`; ≥0, within Decimal(12,2) |
| `items[].discount_type`, `.discount_value` | Optional | value ≥0 |
| `order_discount_type`, `order_discount_value` | Optional | value must be ≥ 0 if present |
| `visit_id` | Optional | ties the order to a logged meeting; triggers the "meeting-based flow": `order_date` **required** in this branch; visit must be in caller's `meetings` scope; editing an existing order already on that visit also needs `orders:edit` |
| `entity_id`/`entity_name` | **Confirmed required in the direct (non-meeting) branch** — error "entity_name and order_date are required" | |

GST: `src/lib/gst-setting.ts` (`getGstRequiredForOrders(tenantId)` — firm-wide switch, read via raw SQL since the column may not exist yet; **defaults to required if the column is missing**) combined with `src/lib/gst-policy.ts` (`effectivelyComplete`, `effectiveMissing`, `effectiveBlockedReason`) decide whether a Company-kind account's missing GSTIN blocks the order (`placementBlock()` — an incomplete party keeps the order Draft/blocked). GST is required only when the switch is on **and** the account kind is `'Company'` — Individual accounts are never GST-blocked. GSTIN format validation always applies to any GSTIN that is entered, regardless of the switch.

**On the screen**
- Account/visit context (often arrives from "Log a meeting" → "Add order"), product picker with qty, Save.
- GST-blocked banner if the party is incomplete and GST is required (inline error, no dead end — kit rule 6: "no dead ends").

**One tap away**
- Order discount, line-level discount details, order history for the account.

**Computer only**
- Team orders view (`/api/orders/team`), bulk pricing/discount administration.

---

## Proposed extras (need owner OK)

| Extra | Supported by | Gap |
|---|---|---|
| GPS visit check-in | `POST /api/attendance/check-in` already takes `latitude/longitude/address` | None — phone just needs to read GPS and call it (kit 41.16 rules 9–11) |
| Receipt photo shrink before upload | Kit requires client-side shrink to ≤1600px long side (41.16 rule 4) | Not implemented anywhere server or client-side found; must be built in the phone upload component before calling `/api/expenses/upload` |
| Next meeting after logging a meeting | `GET/PUT/DELETE /api/daily-activity/[id]/next-meeting` already exists | None — just chain the two calls in the phone flow |
| Tap to call/WhatsApp/directions | Kit 41.16 rule 17 — contact actions sheet | No server support needed; purely client (tel:/wa.me/maps links) off existing mobile/address fields |
| Reorder last order | No endpoint found that duplicates/clones an order | **Missing** — needs either a new endpoint or client-side read of the last order's items, then POST a new order with those items |
| Weekly plan view (read-only) | `GET /api/daily-activity/plan` exists | Confirm it supports a read-only, scoped-to-self query; likely usable as-is |
| Business-card scan | N/A | New package/feature, explicitly deferred per the task description |

---

## Open questions

1. Kit 41.15 says tab 1 is always **My work** (approvals/tasks waiting on the person); this product has named tab 1 **Today** instead, which is a field-sales home screen (check-in, visits, follow-ups), not an approvals queue. Decide: is "Today" this product's version of My work (per 41.15, redefined for field sales), or does the product need both My work and Today, which would break the 5-tab/41.4 limit? Blocks: Today's screen contract and whether approvals (e.g. weekly plan approvals) need their own tab/list instead of living in More.
2. **Confirmed, needs an owner decision, not just research:** `/api/attendance/check-in` and `/check-out` call no `checkPermission` at all — any authenticated user can check themselves in/out, gated only by `requireUser()`. Is this intentional (attendance is a basic self-action every role has) or should it be gated on a `meetings`/`attendance` action like every other write in the app? Blocks: whether Today's check-in button needs a permission-aware disabled state.
3. **Confirmed:** `/api/notifications` GET has no `checkPermission` — it relies solely on filtering to `recipient_id = user.userId`, which is self-scoping by construction. Likely fine as-is; flagging for owner awareness only, not blocking.
4. Can "Log a meeting" be filed against just an Account, or must it eventually be tied to an Opportunity? **Confirmed from the API:** `deal_id` is optional in `POST /api/daily-activity`, so Account-only logging already works server-side — this is a build decision (show the Opportunity field at all on the quick phone form, or push it to "More details"), not an API gap.
5. How do "Log a meeting" and live GPS check-in/out relate on phone? No linking field exists between `attendance` rows and `daily_visits` besides the manual-entry path (`is_manual_entry`/`manual_start_time`/`manual_end_time`). Decide: are check-in/out and visit-logging always two separate taps on Today, or should "+ Log" implicitly assume the rep is already checked in?
6. Confirm whether field reps have `expenses:create` by default in the seeded/typical role-permission config — if not, the Expenses tile in More needs a hidden-not-shown state for those roles (kit 41.1: permission-aware).
7. **Confirmed:** no expense approval/review endpoint exists in `src/app/api/expenses/*` — "Add expense" is create-and-done with no workflow to design around.
8. Does the phone's "Create account" screen expose the Company/Individual kind choice up front, or default to Company (the more common field-sales case) with Individual one tap away? Affects the minimal-fields screen design.
9. ~~Contact field list~~ — resolved; full field list captured above from `_handlers.ts`.
10. ~~Order-date requirement~~ — resolved; confirmed required in both the meeting-based and direct branches.

---

## Decisions (owner approved 2026-10-14)

- **Today is this product's "My work".** Kit 41.15 makes tab 1 "My work"; for field sales that screen is Today (check-in, today's meetings, follow-ups and next meetings due). No separate My work tab. Resolves Open Q1.
- **Check-in is not required before logging a meeting.** Check-in/out and "Log meeting" stay two independent actions. Resolves Open Q5.
- **Opportunity (deal) is optional on a meeting.** A meeting can be logged against an account alone; `deal_id` stays optional, as the API already allows. Resolves Open Q4.
- **The account creation form asks Company/Individual at the very top, defaulting to Company.** Resolves Open Q8.
- **"Reorder" copies the last order client-side (no new API).** The phone reads the last order's lines and pre-fills a new order, which is saved through the existing `POST /api/orders` (the server re-prices every line). Closes the "Reorder last order" gap under Proposed extras.
- **`/daily-activity` full screen stays desktop-only.** It has no phone list view. Phone reaches meetings through Today and `/daily-activity/new`. The account detail page has no "Meetings" row, because no API lists or counts one account's meetings.
- **30-day phone sessions: approved by the owner 2026-10-20, built.** A sign-in from a phone (`getRequestLayout()`: layout cookie, then Sec-CH-UA-Mobile, then UA) lasts `PHONE_SESSION_MAX_AGE_DAYS` (default 30); desktop and SuperAdmin keep `SESSION_MAX_AGE_DAYS` (default 7).

### Phone screens that exist

These were checked against `src/app/(protected)/` on 2026-10-14. Each one has a phone layout: a `useLayout()` phone branch, a phone-only page, or `usePhoneAppBar` on a shared page.

| URL | Screen | Notes |
|---|---|---|
| `/today` | Today (tab 1) | Phone-only. Desktop redirects to `/` |
| `/parties` | Accounts list (tab 2) | `PhoneAccountsList`, with Company/Individual chips |
| `/parties/new` | New account | Phone-only. Desktop redirects to `/parties?tab=companies` |
| `/parties/companies/[id]` | Account detail | `PhoneAccountDetail` |
| `/parties/contacts` | Contacts list | Honours `?account=` |
| `/parties/contacts/new` | New contact | Phone-only. Honours `?account=` |
| `/deals` | Opportunities list (tab 3) | `phone-deals-page.tsx`, with stage chips. Honours `?account=` and shows a "For <account>" chip with an × |
| `/deals/new` | New opportunity | Phone-only. Honours `?account=` |
| `/deals/[id]` | Opportunity detail | `phone-deal-detail.tsx` |
| `/orders` | Orders list (tab 4) | `PhoneOrdersList`, with status chips. Honours `?account=` and shows a "For <account>" chip with an × |
| `/orders/new` | New order | Phone-only. Honours `?account=`. Desktop redirects to `/orders` |
| `/orders/[id]` | Order detail | Phone-only. Desktop redirects to `/orders?open=<id>` |
| `/expenses` | Expenses list | Phone-only. Opened from More |
| `/expenses/new` | Add expense | Phone-only |
| `/expenses/[id]` | Expense detail | Phone-only. Desktop redirects to `/daily-activity` |
| `/daily-activity/new` | Log meeting | Phone-only. Desktop redirects to `/daily-activity` |
| `/weekly-plan` | Weekly plan | `phone-weekly-plan.tsx`. Opened from More |
| `/more` | More (tab 5) | Phone-only. Desktop redirects to `/` |
| `/profile` | Profile | Shared page that registers a phone app bar (back to More) |

These have **no** phone layout and render the desktop screen on a phone:

- `/parties/contacts/[id]`, which the contacts list rows open.
- `/parties/companies/new`. Phone creates accounts at `/parties/new`.
- `/daily-activity`. Desktop-only by decision, see above.
