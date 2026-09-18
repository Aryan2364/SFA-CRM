# SFA CRM — Rebuild Plan

**Purpose of this file:** This is the master plan for rebuilding and extending the SFA (Sales Force Automation) CRM software. It is written for an orchestrator agent that will dispatch work to other agents, phase by phase. Every agent working on this project must read this file first.

**Status:** Requirements are finalised. Decisions recorded here have already been debated and closed. Do not re-open them.

---

## 0. Standing Instructions for Every Agent

Read this section before doing anything.

### 0.1 Study before building

This is an existing, working codebase. It is not a greenfield project.

- **Read the repository first.** Understand the current structure, patterns, naming conventions and folder layout before writing code.
- **Study the existing Leads page and its database tables** before starting Phase 1. Phase 1 converts Leads into Companies. It does not build a parallel module.
- **Study the existing Access Control implementation** before touching anything related to permissions. Access Control already exists. Do not build a new one.
- **Study the existing Product Master, Order module and Employee Master.** These already exist and must be reused, not recreated.
- **Read `agent.md` inside rgb-kit v2** before building any screen. rgb-kit v2 is a **separate repository** and must be pointed to. The frontend has already been migrated to it, so it is the source of truth for design.

### 0.2 Tech stack

- **Frontend:** Next.js
- **Backend:** NestJS
- **Database:** PostgreSQL

The frontend has been migrated. Confirm the current state by reading the code rather than assuming.

### 0.3 Local environment

- The application runs locally on port **3007** or **3011**. Detect which one is live.
- Login: `7878038514`
- Password: `Admin@123`

### 0.4 Design direction

- All design direction comes from **rgb-kit v2**. Read its `agent.md` first.
- Do not invent new component patterns. Use what rgb-kit provides.
- Colour contrast and readability matter. Text must be comfortably readable against its background on both desktop and mobile.
- Primary users are field sales people working on phones. Mobile usability is not optional.

### 0.5 Working rules

- **Do not exceed the scope of the phase you are given.** If work starts expanding into another phase, stop and report.
- **Do not build anything listed in Section 9 (Do Not Build Yet).**
- **Where this plan marks an item as "Needs Aryan's input"**, do not stop work. Build a sensible default, clearly mark the decision in your handover notes, and carry on. The list of such items is in Section 10.
- Reuse existing code wherever the functionality already exists. Renaming and extending is preferred over creating new.
- After each phase, leave working, testable software. A phase is not complete if the application is broken.

---

## 1. Context — What This Software Does

A field sales person plans his week, goes out and meets parties, records what happened, books orders, and tracks deals through a pipeline. His manager approves his plan, reviews his summaries and comments on them. The owner sees the whole company.

The complete flow, in order:

1. Companies and Contacts are registered in the system (together called **Parties**)
2. The sales person makes a **Weekly Plan** — whom he will meet, on which day
3. The plan goes to his **Manager for Approval**
4. Approved plan items appear in **Daily Activity**, day by day
5. He starts and stops each **Meeting**, which captures time and location
6. Inside the meeting he records **Minutes of the Meeting**, updates **Deals**, and books **Orders**
7. He records his **Expenses** for the day
8. A **Daily Summary** and a **Weekly Review** are generated
9. The **Manager** sees team summaries and comments on them
10. **Reports** run across everything

---

## 2. Terminology — Enforce This Everywhere

The word **"Lead" is removed from the software entirely.** This is a hard rule. Any leftover reference in code, database, user interface text or comments must be renamed.

| Old term | New term | Meaning |
|---|---|---|
| Lead | **Party** | A Company, or a Contact, or both linked together |
| Lead Type | **Company Type** | Classification of a company — values are user-defined in a master |
| Lead Status | **Deal Stage** | The funnel stage a Deal sits at — values are user-defined in a master |

Additional terms used in this document:

- **Party** — collective name for Companies and Contacts
- **Deal** — a potential Order, tracked through stages
- **Minutes of the Meeting** — the notes recorded inside a meeting
- **Logs** — the historical record of an entity (use this word, not "history")
- **Non-Meeting Time** — working hours not spent in meetings (never use the word "Idle Time")

**All master values are user-defined.** Company Type, Contact Type, Deal Stage, Expense Category, Reason for Loss, Industry/Segment — the examples given in this document are illustrations only. Nothing is hard-coded. Reports must read whatever values exist in the master.

---

## 3. Phase 1 — Foundation: Parties

Everything else sits on this. It must come first.

### 3.1 Migration from Leads

- [ ] Migrate existing Lead records into **Companies**. Nothing is deleted.
- [ ] Where a Lead record carries a person's name and number, that part becomes a **Contact** linked to that Company.
- [ ] Existing **Lead Type** values carry over as **Company Type** values.
- [ ] The **Lead Status** master is re-pointed to Deals as **Deal Stage**. It is not deleted.
- [ ] Active Leads that were in the funnel should open as **Deals** against the migrated Company.
- [ ] **Convert the existing Leads page into the Companies page.** Do not build a parallel module. The two are structurally similar — reuse and refine rather than recreate.
- [ ] Rename tables, columns and routes rather than creating new ones, wherever practical.
- [ ] Remove every remaining reference to "Lead" across the codebase and user interface.

### 3.2 Parties Screen — One Page, Two Tabs

- [ ] A single Parties page with two tabs: **Companies** and **Contacts**
- [ ] Each tab has its own list, search and filters
- [ ] Clicking a Company opens the Company page, which shows its Contacts inside
- [ ] Clicking a Contact opens the Contact page, which shows the Companies it is linked to

### 3.3 Company Form — Two Step

**No drafts.** The Company is saved before contacts can be added.

**Step 1 — Company Details**

| Field | Rule |
|---|---|
| Company Name | Compulsory |
| Company Type | From master. **Not compulsory.** Blank by default |
| Owner | From **Employee Master**. Defaults to the logged-in user. Editable |
| Industry / Segment | Dropdown, pre-loaded list, editable from masters |
| Addresses | Multiple (Address 1, 2, 3). Each with Address Line, City, State, Pincode, Location coordinates. One marked **Primary** |
| Phone Number | |
| Email | |
| Website | |
| GST Number | |
| Notes | |
| Custom Fields | Supported |
| Status | Active / Inactive. Placed at the **end** of the form, not in the main field list |

Pressing **Next** saves the Company and moves to Step 2.

**Step 2 — Contact Persons**

- [ ] The Company is already saved, so it has an ID
- [ ] "Add Contact" opens a window with the Company name pre-filled and locked
- [ ] On save, the window closes and the user returns to the Company page
- [ ] He can add another contact or finish
- [ ] **No draft records are created at any point**

### 3.4 Contact Person Form

| Field | Rule |
|---|---|
| Contact Person Name | Compulsory |
| Companies | Optional. **Multiple Companies can be linked to one Contact** |
| Designation | As printed on the visiting card |
| Contact Type | Optional. From master. (Examples: Decision Maker, Influencer, Technical, Purchase, Gatekeeper) |
| Owner | From Employee Master. Defaults to the Company's Owner. Editable |
| Mobile Number | Compulsory |
| Alternate Number | |
| Email | |
| WhatsApp Number | If different from mobile |
| Birthday | |
| Anniversary | |
| Notes | |
| Custom Fields | Supported |
| Status | Active / Inactive. At the end |

**Consequence to handle:** Because a Contact can belong to more than one Company, selecting a Contact in a Deal cannot always auto-fill the Company. If the Contact has exactly one Company, auto-fill it. If it has more than one, **ask which Company the Deal is for**.

### 3.5 Quick Create and Record Completeness

A sales person standing in front of a customer needs speed, not a long form.

- [ ] **Quick Create** allows a Company or Contact to be created with basic information only: Name, Phone Number, Company
- [ ] Such a record is marked **Incomplete**
- [ ] An Order can be booked against an Incomplete Party
- [ ] But that Order **stays in Draft and cannot be Placed** until the required details are filled
- [ ] Once the Party record is completed, the Order can be processed

**Two levels of compulsory fields:**

- **Quick Create compulsory:** Name, Mobile Number. Nothing else.
- **Full Record compulsory (before an order can be placed):** Primary Address, City, State, Pincode, GST Number

### 3.6 Masters Required in Phase 1

- [ ] **Company Type Master** — user-defined values
- [ ] **Contact Type Master** — user-defined values, keep the list short
- [ ] **Industry / Segment Master** — pre-loaded list, editable

### 3.7 Phase 1 Acceptance

- Existing Lead data is visible as Companies and Contacts, with nothing lost
- The word "Lead" appears nowhere in the application
- Parties page works with both tabs
- Company can be created in two steps; contacts can be added after saving
- A Contact can be linked to two Companies
- Quick Create produces an Incomplete record that is clearly marked

---

## 4. Phase 2 — Deals

### 4.1 Deal Fields

| Field | Rule |
|---|---|
| Deal Name | |
| Owner | The person from our own company managing this Deal. From Employee Master |
| Customer | Select Company (contacts fill automatically) or select Contact (Company fills automatically). A Contact with no Company is acceptable. If the Contact has multiple Companies, ask which one |
| Expected Value | |
| Probability | Slider, 0 to 100, **11 stops at intervals of 10**. Values like 33 or 54 are not allowed |
| Deal Stage | From the Deal Stage master |
| Expected Closing Date | |
| Product / Product Category | From the existing Product Master |
| Source | Where the deal came from — reference, exhibition, cold call, and so on |
| Remarks / Opening Note | |

- [ ] Company and Contact can be created from within the Deal form if they do not exist

### 4.2 Deal Views

- [ ] **List view** — Excel-style table with columns and rows (Name, Phone Number, Stage, Value, and so on)
- [ ] **Kanban view** — Deal Stages become the column headings
- [ ] Deals can be dragged and dropped between stage columns
- [ ] On drop, the stage updates immediately and the change is written to the Deal's **Logs**

### 4.3 Deal Card — Fixed Layout

Six items, in this order. **Not configurable.**

1. **Company Name** — largest text on the card
2. **Deal Name** — smaller, below it
3. **Expected Value**
4. **Probability** — thin bar with the figure alongside, **read-only on the card**
5. **Days in Current Stage** — turns to a warning colour once it crosses the set limit
6. **Next Follow-up Date** — turns to a warning colour if the date has passed

**Owner** appears as a small circle with the person's initials in the top corner. This matters in the Manager's view where cards from many people sit in one column.

**Probability is edited only inside the Deal, never on the card.** A slider on a draggable card conflicts with drag-and-drop, especially on a phone.

### 4.4 Notes and Logs

- [ ] Each Deal has a Notes section
- [ ] Every note is stamped with date and time
- [ ] The Deal keeps automatic **Logs** of stage changes — when it entered each stage and how long it stayed
- [ ] Notes written inside a Meeting about this Deal appear here
- [ ] A note written in a Meeting can be **linked** to a Deal or an Order

### 4.5 Follow-ups

A Deal carries **multiple Follow-ups**, not a single date field.

| Field | Values |
|---|---|
| Due Date | |
| Mode | Meeting / Call / Email / WhatsApp / Other |
| Status | Done / Not Done |
| Notes | What happened |
| Completed On | Date and time |

- [ ] If a Meeting was held against that Deal, its **Minutes of the Meeting are pulled in automatically** against that follow-up, so the user does not type the same thing twice
- [ ] For Call, Email and other modes, the user writes a note and marks it Done
- [ ] The **earliest open Follow-up** is what shows on the Deal Card
- [ ] On marking a follow-up Done, **prompt for the next follow-up date**. Prompt only, not compulsory

### 4.6 Closing a Deal

- [ ] At closing it is compulsory to mark the Deal **Won** or **Lost**
- [ ] If **Won** — it converts into an Order. The software **prompts**: "Do you want to punch the Order for this?" The prompt appears, but punching is not compulsory
- [ ] If **Lost** — a **Reason for Loss** must be captured, from a master

### 4.7 Ageing

- [ ] Show how many days a Deal has been standing at its current stage
- [ ] Visible in **both** List and Kanban views
- [ ] An alert appears once a Deal is stuck beyond the set limit

### 4.8 Other Deal Requirements

- [ ] **Attachments** — quotations, proposals and similar files against a Deal
- [ ] **Filters** on the Deals page: by Owner, by Stage, by Company, by Expected Closing Month
- [ ] **Pipeline Header Strip** above both views showing: total number of deals, total Estimated Value, and Weighted Value (Estimated Value × Probability)

### 4.9 Masters Required in Phase 2

- [ ] **Deal Stage Master** — the re-pointed Lead Status master. User-defined values. (Examples: Prospect, Contacted, Qualified, Quotation Sent, Order Confirmed, Payment Received)
- [ ] **Reason for Loss Master** — user-defined values

### 4.10 Order Module Change

The Orders page as it stands today is otherwise fine. One change is required:

- [ ] An Order must support two states: **Draft** and **Placed**
- [ ] Orders can be created directly, without going through a Deal
- [ ] Product Master carries the Rate
- [ ] **Discounts** can be applied item-wise (on a line) and overall (on the order total)
- [ ] Any order carrying a discount must be **flagged**, so it is visibly different from a clean order

---

## 5. Phase 3 — Planning and Activity

### 5.1 Weekly Plan

- [ ] **Remove Location from this screen completely.** Planning is no longer location-first
- [ ] Add a dropdown listing **Parties** (Companies or Contacts — either can be selected)
- [ ] On selection, the Company Type is fetched from the master and shown **locked (read-only)**. The master value is final and cannot be changed here
- [ ] **Fix the page scroll.** The page currently does not scroll fully. It must scroll top to bottom
- [ ] Against each planned line item, an **optional** field for the Order Value the user hopes to bring from that party. Not compulsory

**Weekly Goal Checklist**

- [ ] Replace the existing free-text description box with a checklist: "What will I try to achieve this week"
- [ ] Show **5 blank rows by default**, with an "Add" option below. No upper limit
- [ ] Points can be ticked on the Weekly Plan screen during the week, and also on the Weekly Review page
- [ ] Both places show the same data — ticking at one place reflects at the other

### 5.2 Weekly Plan Approval (New Screen)

- [ ] Once made, the Plan goes to the Manager for Approval
- [ ] The Manager can modify the Plan — remove items, add items
- [ ] The User must be able to **see what changes his Manager made**
- [ ] The Manager can write Notes on the Plan
- [ ] This needs a dedicated screen on the Manager side

### 5.3 Daily Activity

- [ ] Approved plan items appear automatically for the relevant day. **The manual selection step is removed** — the list is pre-loaded
- [ ] **Check-in** button marks the sales person Present. Update its look and feel so its meaning is clear
- [ ] **Check-out** button closes the day
- [ ] If Check-out is not pressed, the system **auto checks out**. Default **12:00 midnight**
- [ ] The auto check-out time is **not hard-coded** — it is controlled from Settings, system-wide
- [ ] **After Check-out nothing is locked.** Meetings, Orders and Expenses can all still be added
- [ ] The purpose of Check-in and Check-out is **only attendance and working hours**. Nothing else depends on it
- [ ] **Remove the old Plan section** from this screen — Meetings now cover it

### 5.4 Meetings

- [ ] Each planned line item has **one toggle button**: it shows **Start**, and turns into **Stop** after clicking
- [ ] On **Start** — timer begins and Location is captured
- [ ] On **Stop** — timer ends and Location is captured again
- [ ] Each meeting therefore stores a start location and an end location
- [ ] If the two locations are far apart, the system **flags** it. Default threshold **500 metres**, changeable in Settings
- [ ] On flagging, **no action is triggered** — display only

**Unplanned Meetings**

- [ ] A meeting not in the Weekly Plan can be added
- [ ] If the party is not in the system, it can be created from here using **Quick Create**

**Past Meeting Entry**

- [ ] A meeting that happened but was not logged live can be entered later
- [ ] The user **can** type Start and End Time by hand — these are tentative
- [ ] Such entries are marked clearly as **Manually Entered / Tentative**, visibly distinct from system-captured
- [ ] The summary shows a **count** of how many meetings were entered this way

### 5.5 Inside a Meeting

- [ ] **Minutes of the Meeting** — notes on what was discussed. Can be written while the meeting is running or after it ends
- [ ] A section showing the Company's **open Deals** and its **last few Orders** (not all)
- [ ] If the Company has several Deals, the user marks **which Deals were discussed** in this meeting — all, one, or none
- [ ] **Deal Stage can be updated from inside the meeting**, so the user does not have to go to the Deals page
- [ ] A new Deal or a new Order can be created from the meeting page itself
- [ ] Order taking happens **inline**, against the meeting row. Products come from the existing Product Master; the user enters Quantity, the system picks the Rate, and the total Amount is shown
- [ ] If an Order is already drafted for that party and not yet placed, it is visible here
- [ ] **View All** goes to the Orders page with the **Company filter applied automatically**. Other filters remain available
- [ ] A note written here can be **linked** to a specific Deal or Order

### 5.6 Cross-Linking and Navigation

The software must feel seamless.

- [ ] Links to all Meetings held on a Deal appear on that Deal
- [ ] Clicking a Meeting link opens that Meeting page
- [ ] **Breadcrumbs are required**, and Back returns the user to where he came from
- [ ] Works both ways: Meeting → Deal, Deal → Meeting, Meeting → Order, Order → Meeting
- [ ] A Meeting is **not compulsory** for an Order or a Deal. If Meetings exist, links appear; if not, nothing appears

### 5.7 Expenses

- [ ] Logic works exactly as it does today. **No functional change**
- [ ] Look and feel refresh only

---

## 6. Phase 4 — Summaries, Journaling and Manager Views

### 6.1 Daily Summary Sheet

For the selected day:

- [ ] Plan versus Actual — what was planned, what was achieved
- [ ] What was missed, and what extra was done
- [ ] **Total Meeting Time, split into two figures:** time captured by the system timer, and time entered manually
- [ ] **Non-Meeting Time** (use this wording, never "Idle Time")
- [ ] Travelling Time is **not** calculated separately — it is dropped
- [ ] Total Expense, and expense split by Category
- [ ] Order value brought
- [ ] **Locations Covered** — summary of locations captured across the day
- [ ] Count of meetings entered as **Past Meetings**
- [ ] **Location-difference flags** for the day
- [ ] **Deal movement for the day** — how many Deals moved a stage, how many closed Won or Lost
- [ ] **Follow-ups due today that were not done**
- [ ] **Next day's plan preview** — a short strip at the bottom showing tomorrow's planned meetings

**Expense-to-order-value ratio does not appear on the daily sheet.** On a normal prospecting day this ratio looks poor, and showing it daily demoralises the sales person. It belongs in the Weekly Review only.

### 6.2 Weekly Review

Built on all seven days together:

- [ ] Weekly priority points pulled from the Weekly Plan, showing which are ticked and which are open
- [ ] What was planned for the week versus what was achieved
- [ ] Orders brought in
- [ ] Number of meetings done
- [ ] Hours spent in meetings versus hours not in meetings (derived from Check-in and Check-out)
- [ ] The same figures also available day-wise
- [ ] Extra meetings done outside the plan, shown separately
- [ ] New Parties created during the week
- [ ] Day-wise and Category-wise expense break-up
- [ ] Orders split between **Draft** and **Placed**
- [ ] Order break-up by Product Category, Sub-Category and individual Product
- [ ] **Funnel Movement** — how many Deals moved forward in the week, and how many sit at each stage
- [ ] **Not Met** — planned parties against which no meeting was ever started
- [ ] **Expense versus Order Value** for the week
- [ ] Headline numbers: how many to meet, how many met, how much spent, how much order value

### 6.3 Journaling

- [ ] Two boxes inside Weekly Review: **What Went Well** and **Where I Can Improve**
- [ ] Each box has a button that opens its **Logs** page — all past entries, one after another
- [ ] **No separate menu item.** Journaling lives inside Weekly Review and is reached through these buttons

### 6.4 Manager Summary

- [ ] A Manager may have ten or twenty people under him and cannot open each person's summary one by one
- [ ] Build a **Summary of Summaries** page, with **drill-down** into any individual
- [ ] The Manager also sees the same individual screens per team member, unchanged. The Team Summary sits one level above them

### 6.5 Manager Comments

Keep it simple. Resist adding workflow.

- [ ] The Manager can add **one Comment** against a team member's Daily Summary, and one against the Weekly Summary
- [ ] The comment sits against the **whole summary**, not individual sections
- [ ] The team member sees it when he opens that summary and can **reply once**
- [ ] Comment and reply are both stamped with date and time
- [ ] Both stay visible in the **Logs** of that summary
- [ ] **No approval workflow, no resolved/unresolved status, no notification chain**

### 6.6 Access and Data Visibility

**Read Section 0.1 — Access Control already exists. Study it before writing anything.**

Three levels, set on the Employee Master:

1. **Self** — sees only his own Plans, Meetings, Deals, Orders, Expenses and Summaries
2. **Team** — sees his own data plus his team's
3. **Company** — sees everything across the organisation

- [ ] **Team is derived from the existing Manager selection** already present in the Employee Master. No new field is needed
- [ ] **Team means the full chain below**, not just direct reports. If two juniors report to Rakesh and Rakesh reports to Aryan, then Aryan sees Rakesh and both juniors
- [ ] A company-level summary sheet is needed for whoever holds Company rights

**Scope discipline on this item — read carefully:**

- **Phase 1 of access work (build now):** one data filter — Self / Team / Company — applied to every list, summary and report. Written once as a shared rule and reused everywhere. This should be a small piece of work, not a module
- **Phase 2 of access work (deferred):** full access control — role-wise permissions, menu visibility, create/edit/delete rights, approval rights
- **Do not build any access control screens now.** Only the data filter
- **If this work starts growing into a module, it has gone out of scope.** Stop and report

---

## 7. Phase 5 — Reports

### 7.1 Build a Report Engine, Not 41 Screens

- [ ] User picks a **Measure**
- [ ] Picks one or two **Dimensions** to slice by
- [ ] Picks a **Date Range**
- [ ] Applies **Filters**
- [ ] Gets a table, with an option to view it as a chart
- [ ] Can save a combination as a **Saved Report** for repeat use

Then ship the ready-made reports in Section 7.4 as pre-configured combinations that open with settings already filled, so a user who does not want to build anything still gets value on day one.

### 7.2 Dimensions

**Party:** Company, Company Type, Industry / Segment, Contact Person, Contact Type, Party Completeness (Complete / Incomplete)

**Geography:** City, State, Pincode, Captured meeting location

**People:** Sales Person (Owner), Manager / Team

**Product:** Product, Product Category, Product Sub-Category

**Deal:** Deal Stage, Probability band (0–30 / 40–60 / 70–100), Won or Lost, Reason for Loss, Deal Source, Days in current stage (ageing band)

**Order:** Order Status (Draft / Placed), Discount Applied (Yes / No), Order Blocked Reason

**Activity:** Meeting type (Planned / Unplanned / Past Entry), Follow-up Mode, Follow-up Status

**Expense:** Expense Category

**Time:** Day, Week, Month, Quarter, Year

### 7.3 Measures

Order Amount · Order Quantity · Number of Orders · Gross Order Value · Net Order Value · Discount Amount (item-wise) · Discount Amount (overall) · Total Discount · Discount Percentage · Deal Expected Value · Weighted Deal Value · Number of Deals · Number of Meetings · Meeting Hours (system-captured and manual, separately) · Non-Meeting Hours · Working Hours · Expense Amount · Number of Companies and Contacts added · Follow-ups due, done, missed · Planned versus Actual counts

### 7.4 Ready-Made Reports — First Release

Ten reports, chosen because each tells the owner something he cannot see today, at a glance.

1. **Sales Person Performance** — meetings done, orders booked, order value, discount given, conversion rate. One row per person
2. **Top Customers by Order Value** — ranked list of who is paying the most
3. **Pipeline Summary** — number of Deals and total value at each Deal Stage
4. **Reason for Loss Analysis** — why deals are dying, ranked
5. **Deal Ageing** — Deals stuck too long at one stage, oldest first
6. **Plan versus Actual** — planned meetings versus meetings done, by person and period
7. **Discount Given by Sales Person** — total discount and discount percentage per person
8. **Order by Product Category and Sub-Category** — what is selling and what is not
9. **Follow-up Compliance** — follow-ups due, done and missed, by person
10. **Expense versus Order Value** — cost of sales, weekly and monthly

### 7.5 Reports Page Header

- [ ] Four numbers across the top of the Reports page for the selected period: **Order Value, Number of Meetings, Deals Won, Expense**
- [ ] Everything else sits below

If a client logs in, sees those four numbers and closes the app, he has still got value that day.

### 7.6 Reports Built Into the Engine but Not Featured

These work through the engine. Do not put them on the front page.

- Order by Location, Product Demand by Location — need clean address data first
- Conversion Funnel, Average Deal Cycle Time — need months of history before the numbers mean anything
- Attendance, Location Flag, Working Hours Utilisation — these are monitoring reports. Leading with them makes the sales team see the software as a spying tool, and adoption dies. Let the Manager find them himself

### 7.7 Data Health — Show as Alerts, Not Reports

- **Incomplete Parties** — Companies and Contacts with missing required details, and what is missing
- **Pending Draft Orders** — Draft orders not processed, with the reason each is stuck
- **Parties Without Any Deal**
- **Deals Without Follow-up**
- **Contacts Without Company**

An owner does not open a report to learn his data is incomplete. He should be told on the relevant screen itself.

---

## 8. Settings Required

- [ ] **Auto Check-out time** — default 12:00 midnight, system-wide, not hard-coded
- [ ] **Location difference flag threshold** — default 500 metres
- [ ] **Deal stage ageing limit** — the number of days after which a stuck Deal shows an alert

---

## 9. Do Not Build Yet

Explicitly out of scope. Do not build these, and do not leave placeholders for them.

1. **Tasks against a Deal** — deferred to a later session. Follow-ups may already cover the need
2. **Full Access Control** — role-wise permissions, menu visibility, create/edit/delete rights. Phase 2 work
3. **Configurable Deal Card** — the card layout is fixed. If a client demands it later, it would be a company-level setting, never per-user
4. **Discount approval workflow** — discounts are flagged, not approved. Approval is a possible later addition
5. **Manager comment workflow** — no approval, no resolved status, no notifications

---

## 10. Items Needing Aryan's Input — Do Not Stop Work

Build a sensible default, flag the decision clearly in your handover notes, and continue.

| Item | Default to use |
|---|---|
| Deal stage ageing limit — how many days before a Deal is flagged as stuck | 15 days, settable |
| Follow-up overdue warning — how many days before the date turns to warning colour | Same day it becomes overdue |
| Industry / Segment master — the pre-loaded list of values | Build a reasonable general list; Aryan will refine it |
| Contact Type master — the starting values | Decision Maker, Influencer, Technical, Purchase, Gatekeeper. Keep the list short |
| Probability bands for reporting | 0–30, 40–60, 70–100 |
| Expense categories — whether the existing list is adequate | Use whatever exists today; do not change |
| Whether Company Type should also apply to a Contact with no Company | Leave blank; do not force a value |
| Migration edge cases — Leads with no company name, or duplicates | Migrate as-is, flag as Incomplete, report them |
| Chart types for each ready-made report | Choose what suits the data; Aryan will review |
| Where the Reports menu sits in navigation | Top-level menu item |

---

## 11. Phase Order and Dependencies

```
Phase 1 — Parties (Lead migration, Companies, Contacts, masters)
    │  everything depends on this
    ▼
Phase 2 — Deals (pipeline, follow-ups, order states, discounts)
    │
    ▼
Phase 3 — Planning and Activity (Weekly Plan, Approval, Daily Activity, Meetings)
    │
    ▼
Phase 4 — Summaries (Daily, Weekly, Journaling, Manager views, access filter)
    │
    ▼
Phase 5 — Reports (engine + ten ready-made reports)
```

Phase 1 must complete before anything else starts. Phases 2 and 3 can partly overlap if resources allow, but Deals must exist before Meetings can update Deal stages.

---

## 12. Decisions Already Closed — Do Not Re-open

- The word "Lead" is removed. Party, Company Type and Deal Stage replace it
- No draft records. Company is saved before contacts are added
- A Contact can be linked to multiple Companies
- Parties screen is one page with two tabs, not two menu items
- Deal Card layout is fixed, six items, not configurable
- Probability is edited inside the Deal only, never on the Kanban card
- Journaling has no separate menu item
- Team access means the full chain below, not direct reports only
- Manager comments are one per summary, with one reply. No workflow
- Existing Leads are migrated, not deleted. The Leads page is converted, not rebuilt
- Travelling Time is dropped. The term is Non-Meeting Time
- Check-out does not lock the day

---

**End of plan.**
