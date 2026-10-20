# Account and opportunity sharing — human test plan

Run this once the two sharing tables exist in the **local** database. The SQL is
in the header comment of `src/lib/sharing.ts`; a human creates them (agents may
not run `prisma db push` or create tables). Until the tables exist the app
behaves exactly as before: no "Shared with" cards, no "Shared" badges, and the
members endpoints answer `[]` / 503 "This needs a database update first."

## Setup

- Start the app: `npm run dev:local` (port 3007, local database, demo tenant).
- If the demo data is stale, `npm run dev:seed` rebuilds it (local only, destructive for the demo tenant).
- All demo users use the password **dev1234**.

| Person | Phone | Role | Notes |
|---|---|---|---|
| Ravi Deshmukh | 9000000100 | Administrator | Sees everything |
| Priya Nair | 9000000101 | Sales Manager | Team scope over Amit, Sunita, Imran |
| Amit Kulkarni | 9000000102 | Sales Executive | Own scope; owns Shree Krishna Agencies and Shubham Agro (new) |
| Sunita Patil | 9000000103 | Sales Executive | Own scope; owns Ambika Krushi (new) and its opportunity |
| Imran Shaikh | 9000000104 | Sales Executive | Own scope |

Use a separate browser profile (or private window) per person, so sessions do not overwrite each other.

---

## Scenario 1 — Share an account to VIEW

1. As **Amit**, open Accounts → **Shree Krishna Agencies**.
2. In **Shared with**, choose Sunita, access **Can view**, press **Share**.

**Expect (Amit):** Sunita listed, "Added by Amit Kulkarni on <today>", access picker shows "Can view".

3. As **Sunita**, open Accounts.

**Expect (Sunita):**
- Shree Krishna Agencies is in the list with a **Shared** badge.
- On that row, **Edit** and **Active** are disabled; hovering shows "This account is shared with you to view only."
- If her role could delete, **Delete** would be disabled with "Only the owner, or someone whose team includes the owner, can delete this account."
- The account page opens: badge "Shared with you: view only", contacts and addresses visible. The **Shared with** card is read-only (controls disabled with the reason).
- The Contacts tab shows its two contacts with a **Shared** badge; their Delete (if her role has it) is disabled with a reason. The contact page shows "Shared with you: view only".
- Daily Activity → Add meeting: Shree Krishna is **not** in the account picker (a view share is not for field work).
- Orders: Shree Krishna's orders are listed and open read-only.

## Scenario 2 — Raise to CAN WORK

1. As **Amit**, change Sunita's access to **Can work**.

**Expect (Sunita):**
- The account's badge reads "Shared with you: can work"; Edit and Active are enabled on its row.
- Editing the account and saving works. Changing its **owner** is refused: "Only the owner, or someone whose team includes the owner, can change who owns this account."
- Daily Activity → Add meeting now offers Shree Krishna and its contacts.
- Any opportunity on the account appears in Opportunities with a **Shared** badge, and she can move its stage / mark Won or Lost (as her role allows).
- She still cannot share it onward: the **Share** button is disabled with the reason.

## Scenario 3 — A manager shares a team member's account

1. As **Priya**, open Shree Krishna Agencies.

**Expect:** the **Shared with** card is fully usable (she has `companies.edit` and her team covers Amit). She can add Imran at Can view and remove him again; removal shows an **Undo** toast.

2. As **Imran**, try to open Shree Krishna's address `/parties/companies/<id>` while not shared.

**Expect:** "This company is not here" (a 404, never "no access").

## Scenario 4 — Share ONE opportunity (opportunity-only)

1. As **Sunita**, open Opportunities → **Ambika Krushi (new) — migrated**.
2. In **Shared with**, add **Imran** at **Can work**.

**Expect (Imran):**
- Opportunities lists the Ambika opportunity with a **Shared** badge, and not Sunita's other opportunities.
- On the opportunity page the account name is **plain text** (no link), badge "Shared with you: can work", and a **Log a meeting** button.
- Opening the account page directly, its contacts, or Sunita's other opportunities gives "not here".
- Press **Log a meeting** → a meeting at Ambika Krushi opens; its title is not a link; the opportunity is listed under Open opportunities; "Set next meeting" can be linked to this opportunity.
- On that meeting, **Previous meetings** lists only meetings linked to this opportunity **plus any earlier meeting at Ambika that Imran held himself** — never the rest of the account's history.
- On the Opportunities board, the Ambika card shows **Shared** and can be dragged to another stage.

## Scenario 5 — Downgrade to VIEW, then remove

1. As **Sunita**, change Imran to **Can view**.

**Expect (Imran):**
- Opportunity page: **Edit**, the **⋯** stage menu and every follow-up control are disabled with "This opportunity is shared with you to view only."; **Log a meeting** is gone.
- Opportunities list: the row's **⋯** menu is disabled with the same reason; on the board the card cannot be dragged and its menu is disabled with the reason.

2. As **Sunita**, remove Imran (trash icon). An **Undo** toast appears; let it expire.

**Expect (Imran):** the opportunity is gone from his list and its page says "not here". His own meetings at Ambika are still in his Daily Activity.

## Scenario 6 — The rows are the history

Run against the local database:

```sql
SELECT user_id, access, added_by, created_at, updated_by, updated_at, removed_by, removed_at
  FROM account_members ORDER BY created_at;
SELECT user_id, access, added_by, created_at, updated_by, updated_at, removed_by, removed_at
  FROM deal_members ORDER BY created_at;
```

**Expect:**
- An access change shows as a **closed row with `updated_at` set** (the old level) followed by a **new row** (the new level).
- A removal is a closed row with `removed_at` / `removed_by` and **no** `updated_at`.
- At most one row per (tenant, record, person) has `removed_at IS NULL`.
- Re-adding someone after removal creates a new row.

## Scenario 7 — A shared opportunity shares its meetings too

Decided by Aryan, 2026-10-13: "if an opportunity is shared then meetings against that opportunity should also be shared — else what is the meaning of sharing an opportunity." Covers `src/lib/sharing.ts`'s `canReadVisitViaSharing`, `GET /api/deals/[id]/meetings`, `GET /api/daily-activity/[id]` and its `/history`, and minutes (`GET /api/remarks`) on a meeting.

1. As **Amit**, log a meeting at **Shree Krishna Agencies** (so there is a meeting Amit does NOT hold on the account/opportunity you are about to share).
2. As **Priya** or **Amit**, share the **Ambika Krushi (new) — migrated** opportunity with **Imran** at **Can view** (Scenario 4), and separately have **Sunita** hold a meeting linked to that opportunity (tick it "discussed" from her meeting screen, or ask a human to link one via `deal_meetings`).

**Expect (Imran):**
- Opening the Ambika opportunity, its **Meetings** section lists Sunita's meeting — her name shown as holder, a working link (the row has `can_open: true`).
- Opening that meeting (`/daily-activity/meeting/<id>`) succeeds and shows a **"Shared with you: view only"** badge; **Set next meeting** is disabled with the reason "This meeting is shared with you to view only."; the Minutes composer is replaced by "You can read these notes but not add to them."; "Previous meetings" opens normally.
- Posting a minute, changing next-meeting, or any `PATCH` action (start/stop/delete/update_notes) on that meeting is refused (`403`/`404`) even sent directly, not just hidden in the UI.
- A colleague nothing is shared with (e.g. a fourth Sales Executive with no access to Ambika or Sunita's scope) still gets "not here" opening the same meeting.

3. Repeat with an **account** share instead of an opportunity share: share **Shree Krishna Agencies** with **Sunita** (Scenario 1/2) and have a colleague of Amit's hold a meeting at that account. Sunita's view of the account's opportunities' Meetings sections, and of that meeting directly, should behave identically.

**Expect:** exactly the same shape as above — read access to every meeting linked to an opportunity (or held against a shared account) the viewer may read, never write access, and never anything for a viewer nothing is shared with.

## Scenario 8 — Nothing changes for records nobody shared

As each of the five people, walk Accounts, Contacts, Opportunities (list and board), Orders, Daily Activity and a meeting page for records **nothing** is shared on.

**Expect:** exactly what each person saw before sharing existed — the same rows, no badges, the same buttons enabled and disabled. Reports, dashboards, Missed counts and next-meeting reminders stay **owner-based** and do not include shared records.

---

## Negative checks (any time)

- Sharing with yourself as owner: "The owner already has full access".
- Sharing with a user from another firm, or a deactivated user: "User not found".
- Sharing the same person twice: "This person already has access to this account/opportunity."
- A Can-work member trying to share onward, delete, take ownership, or move an opportunity to another account: refused with a sentence naming who may.
