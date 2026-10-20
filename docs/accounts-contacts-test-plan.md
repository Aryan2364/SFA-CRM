# Accounts & Contacts (Stage 1) — manual test plan

For a human to run **after** the migration SQL in `src/lib/account-kind.ts`'s header comment has
actually been applied to a real database (local or RDS). Until then, `account_kind`,
`company_types.applies_to`, `company_contacts.role_id`/`is_active`/`is_self`, and `contact_roles`
do not exist, and every route in this feature degrades to a safe default or a 503 — see
"Part A" below for that pre-migration state, which can be re-tested at any time without the
migration.

Run everything as at least two of: admin (9000000100), manager (9000000101), executive
(9000000102), password `dev1234` on the local demo tenant, unless a step says otherwise.

## Part A — before the migration (columns/tables absent)

Current state as of 2026-10-13. Re-run this section any time the migration has NOT yet landed.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| A1 | Contact-roles read | GET `/api/masters/contact-roles` | 200, `{ rows: [], available: false }`, not 500 |
| A2 | Contact-roles write | POST `/api/masters/contact-roles` `{name:"Owner"}` | 503 `"This needs a database update first."` |
| A3 | Kind change | POST `/api/companies/[id]/kind` `{kind:"Individual", self_contact_id:"<uuid>"}` | 503 same message |
| A4 | Make individual | POST `/api/contacts/[id]/make-individual` | 503 same message |
| A5 | Link add (base) | POST `/api/companies/[id]/links` `{contact_id:"<uuid>"}` with a real contact id | **201** — the base link is created via existing columns; role/active/self silently no-op. Do not expect 503 here. |
| A6 | Link add (bad id) | Same, with a non-UUID `contact_id` | 400/500 from Postgres UUID cast — expected, not a bug |
| A7 | Contact create, no mobile | POST `/api/contacts` `{name:"X"}` | 201; `is_complete:false`, `completeness_missing` includes `"Mobile Number"` |
| A8 | Company read reflects default kind | GET `/api/companies/[id]` on any existing company | `account_kind` is absent or `"Company"` (default), never `"Individual"` |
| A9 | Deal create, missing required fields | POST `/api/deals` `{}` or without an account | 400, never a 500, never a deal created without an account |
| A10 | Bulk import, Kind column, column absent | Import an Accounts sheet with a `Kind` column set to `Individual` for some rows | Rows import successfully (status `created`); `account_kind` write silently no-ops (verify no 500, no "partially failed" status) |
| A11 | Duplicates endpoint | GET `/api/parties/duplicates?mobile=<existing>` | 200, not 500 |
| A12 | lead-types list | GET `/api/masters/lead-types` | 200; `applies_to` absent or defaulted, list still renders |
| A13 | Baseline diff | Compare GET responses (companies/contacts/deals/orders/daily-activity/masters list+detail) between the pre-Stage-1 commit and the current working tree, for 3 users | Only expected differences: mobile optional on contact create; contact/company completeness including "Mobile Number"; Individual-kind defaults (`account_kind:"Company"`, `applies_to:"Company"`, `is_self:false`) appearing as new, always-default fields; fields from unrelated in-flight features (sharing, to-dos) — classify and ignore those. Anything else is a bug — file it with the exact field and both responses. |

## Part B — after the migration (columns/tables present)

Apply exactly the SQL in `src/lib/account-kind.ts`'s header comment (and nothing else) to the
target database before running this section. **Never apply it to production directly** — stage
it on a scratch/probe copy first (see "Probe DB" note below), and only a human runs the real
migration against RDS per DEPLOYMENT.md.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| B1 | contact_roles seeds | First GET `/api/masters/contact-roles` on a tenant with no rows yet | Seeds a default list including a `Self` role (`is_system:true`) |
| B2 | Self role locked | Try to rename, deactivate, or delete the `Self` role via `/api/masters/contact-roles/[id]` | All three refused with a clear message naming it as the system Self role |
| B3 | Self unique per account | Link a second contact as `Self` on an account that already has one | 409, app-level message naming the conflict |
| B4 | Self unique per contact | Link a contact as `Self` on two different accounts | 409 with `existing_account_id` (or equivalent) pointing at the first account |
| B5 | Self uniqueness at the DB level | Attempt two near-simultaneous raw SQL inserts racing `company_contacts_one_self_per_account_uq` / `..._per_contact_uq` | Postgres itself rejects the second insert (unique violation), independent of the app-level check |
| B6 | Self link immutable while Individual | Try to remove or re-role the Self link on an account currently kind=Individual | Refused |
| B7 | make-individual, new person | POST `/api/contacts/[id]/make-individual` is really `/api/companies/[id]/kind` with `self_new_person` — create a brand-new person as Self | Account becomes Individual, new contact created and linked as Self |
| B8 | make-individual, existing contact | Same with `self_contact_id` pointing at an existing contact not already Self elsewhere | Succeeds |
| B9 | make-individual, contact already Self elsewhere | Same, but the contact is already Self on another account | 409 with `existing_account_id` |
| B10 | Kind change Individual -> Company | POST `/api/companies/[id]/kind` `{kind:"Company"}` on a current Individual | Self link's role moves to a normal role (default Owner/Proprietor, or `former_self_role_id` if supplied); link is no longer `is_self` |
| B11 | Kind change Company -> Individual -> Company round-trip | B7/B8 then B10 | Account ends up Company again, same Self contact now holds the default non-Self role |
| B12 | Link role/primary | POST/PATCH links to set `role_id` and `is_primary` | Exactly one `is_primary:true` link per account at a time; setting a new primary un-sets the old one |
| B13 | Inactive links excluded from pickers | Deactivate a link, then check whatever endpoint feeds the contact picker for that account | Inactive link does not appear as a selectable contact for that account |
| B14 | Delete account/contact WITH history | Try to delete an account or contact that has daily_visits/deals/orders | 409, does not delete |
| B15 | Delete account/contact with none | Try to delete one with zero history | Succeeds, cascades its links |
| B16 | Contact delete dry-run | Call the delete-dry-run step for a contact linked to accounts | Returns `linked_accounts` listing them |
| B17 | Delete a Self contact | Try to delete a contact that is currently Self on an account | Refused with the documented message |
| B18 | Duplicates by mobile | GET `/api/parties/duplicates?mobile=<x>` where two contacts share a mobile | Both returned |
| B19 | Duplicates by name on same account | Two contacts with the same name linked to the same account | Flagged as a duplicate pair |
| B20 | company_types.applies_to filtering | Try to assign a company type whose `applies_to` doesn't match the account's kind (e.g. an Individual-only type on a Company account) | 400 |
| B21 | GST — Individual order, no GST | Place an order for an Individual account with no GSTIN, GST-required switch ON | Succeeds, no GST error |
| B22 | GST — Company order, switch ON, no GST | Same for a Company account | Blocked with the GST-missing message |
| B23 | GST — missing mobile never blocks placement | Either kind, account has no mobile but otherwise complete | Order places successfully; verify the actual stored `companies.is_complete` (not the display-only derived value) still reads true / unaffected by mobile |
| B24 | Bulk import writes account_kind | Import an Accounts sheet with `Kind=Individual` | `account_kind` column in the DB is actually `Individual` for those rows (query directly) |
| B25 (optional/time-permitting) | Contact sharing privacy | A contact shared with restricted visibility — confirm a viewer without access to one of its linked accounts cannot see that account through the contact's detail/links | No leak of the other account's identity/data |

### Probe DB note (how to stage Part B without touching production or the real local DB)

```
CREATE DATABASE sfacrm_s1probe TEMPLATE sfacrm_local;
-- if blocked by open connections to sfacrm_local, dump/restore instead:
--   pg_dump sfacrm_local | psql sfacrm_s1probe
```

Apply exactly the SQL block from `src/lib/account-kind.ts`'s header comment to `sfacrm_s1probe`
— nothing more, nothing less, so the test matches exactly what the real migration will do. Point
a disposable dev server's `SCRATCH_DATABASE_URL`/`DATABASE_URL` override at `sfacrm_s1probe`
(never at `sfacrm_local` or RDS) to run the HTTP checks above. `DROP DATABASE sfacrm_s1probe;`
when finished.

## Known pre-existing degradations to treat as correct, not bugs

- `companies/[id]/links` POST succeeds (201) even before the migration — it creates the base
  link via existing columns and silently skips the role/active/self update. Do not expect a 503
  here.
- A non-UUID id in a request body causes a Postgres cast error (400/500) before any of this
  feature's own guards run — expected, not specific to Stage 1.
