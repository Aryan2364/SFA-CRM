# Accounts & Contacts — build spec

Agreed with Aryan, 13 Oct 2026. Replaces the earlier "Individual accounts", "Who did you meet?" and
"contacts mobile" plans.

## Principle

**Account = who buys. Contact = a person you talk to.** Orders and opportunities always attach to an
account, never to a contact. Contacts are the people involved, joined to accounts by a link with a role.

## 1. Accounts

- An account has a **kind**: **Company** or **Individual**. Existing accounts start as Company.
- Both kinds show **the same fields**, GST included. Nothing is hidden by kind.
- **Account name** is the display name and the billing name for both kinds. For a new Individual it is
  pre-filled from the person's name and can be changed (e.g. "Rajesh Patel HUF").
- **Required to create:** name only.
- **Incomplete** (warning badge, data-health alerts): missing mobile, missing address, or — for
  Companies only, while the GST switch is on — missing GST. Missing mobile never blocks an order;
  missing address blocks placing one.
- **GST:** required to place a Company order when the firm's GST switch is on, as today. For
  Individuals there is no GST error, warning or restriction ever. If an Individual has a GST number, it
  prints on orders.
- **Type** (the firm's type list, a master): one list with **Applies to: Company / Individual / Both**.
  The account form offers only types that apply to its kind. Existing values start as Company.
- **Labels:** sidebar "Accounts", tabs "Accounts" and "Contacts", a Company/Individual badge on rows, a
  Kind filter on the list.

## 2. Contacts and links

- **One contact per real person**, never duplicated.
- **Account–contact link** (the existing `company_contacts`, extended): account, contact, **role**,
  **primary** flag, **active** flag. A contact can be linked to any number of accounts, each link with
  its own role.
- **Roles** are a master: **Self** (system, locked, not editable), Owner/Proprietor, Director, Partner,
  Purchase Head, Manager, PA/Secretary, Accountant, Other. All except Self can be renamed, added,
  deactivated.
- **Primary contact:** one per account. For an Individual it starts as Self and can be changed.
- **Inactive links** disappear from pickers but stay in history; the contact itself is unaffected.
- **Required to create a contact:** name only. Mobile is optional; a contact with no mobile is marked
  incomplete.

## 3. Individuals and the Self link

- Every Individual account has **exactly one Self link**, which is **locked**: it cannot be removed or
  given another role while the account is an Individual.
- **A contact can be Self on only one account.**
- **Creating an Individual:** the form asks for the person — either **pick an existing contact** or
  enter a new one (name, optional mobile/email). That contact is linked as Self. The person's name,
  mobile and email live on the contact (one copy); the account holds the buying details.
- **"Make Individual account"** sits in the **⋮ menu** of a contact (not a visible button): it creates
  an Individual account for that person with them as Self. For the PA who later buys personally, this
  keeps all his history in one place.

## 4. Changing kind

- Anyone who can edit the account can change its kind. It changes **the kind field on the same record**,
  so meetings, opportunities, orders and history stay.
- **Company → Individual:** asks which linked contact is Self, or creates one.
- **Individual → Company:** the Self link becomes a normal role, default **Owner/Proprietor**
  (changeable in the same step).

## 5. Deleting

- Anything with **meetings, opportunities or orders** cannot be deleted, only made **inactive**.
- An **account with no history** can be deleted.
- A **contact with no history** can be deleted, with a warning that lists its linked accounts.
- A **Self contact** cannot be deleted. The message says to delete or deactivate the Individual account
  instead.

## 6. Duplicates

- **Same mobile anywhere** (account or contact): warn and offer to open or use the existing record.
- **Same name on the same account:** warn.
- Duplicate checks never block saving.

## 7. Opportunities

- **Account required** when creating or editing an opportunity, plus an optional primary contact chosen
  from that account's linked contacts.
- Old opportunities with no account keep working until someone edits them.

## 8. Meetings (stage 2)

- One search box finds **accounts and people**. Picking a person fills in their account (asks which if
  they have several links; offers "Make Individual account" if they have none).
- Then the **attendees** list: the account's linked contacts first, plus "Add someone else" (any contact
  the rep can see, or a new one). A new person gets "Also link to this account as …" ticked by default;
  an existing person unticked.
- The rep ticks all attendees. A **star** marks the **main person**, defaulting to the first ticked; the
  rep can move it.
- The meetings list shows **"[main person] + N others"**; all attendees show inside the meeting.
- Old meetings stay as they are (their person is stored only as text in the meeting name).

## 9. Privacy with sharing

- A contact reached through a shared account shows only its links to accounts the viewer can access.

## 10. Import

- The accounts import sheet is named **Accounts**; the importer also accepts the old **Leads** sheet
  name, so already-filled files still import.
- The accounts import gets a **Kind** column (Company / Individual), defaulting to Company. Importing an
  Individual's person details is a later stage.

## Build stages

1. **Stage 1 — structure:** account kind; type master Applies to; link role/primary/active; roles
   master; Individual create (new or existing contact); Self rules; kind conversion; delete rules;
   duplicate checks; mobile optional; GST rules by kind; opportunity account required; ⋮ "Make
   Individual account"; labels; import sheet name and Kind column.
2. **Stage 2 — meetings:** the combined picker, attendees with a main person, "+ N others" display.

## Database changes (each run by Aryan, like before)

- `companies.account_kind` (Company / Individual, default Company)
- `company_types.applies_to` (Company / Individual / Both, default Company)
- `company_contacts.role_id`, `company_contacts.is_active`
- new table: contact roles master
- stage 2: new table: meeting attendees

As with GST, Landline and sharing, the code works before these exist; the exact SQL comes with the build.
