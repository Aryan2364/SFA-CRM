-- Speed step 3: indexes for the hot queries.
--
-- WHAT THIS IS
--   Pure additions. No table, column or row is changed or deleted. Every statement is
--   idempotent (IF NOT EXISTS), so the file can be re-run safely after a partial failure.
--   Evidence (EXPLAIN before / after on a 5-tenant, ~500k-row throwaway dataset) is in the
--   hand-off report for this change; the query each index serves is named in its comment.
--
-- HOW TO RUN  (read this first)
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block. So:
--     * psql:        psql "<connection string>" -f docs/speed-indexes.sql
--                    (psql runs each statement on its own; do NOT add --single-transaction or -1)
--     * a SQL GUI:   run ONE statement at a time, never "run all in a transaction".
--   CONCURRENTLY takes no write lock: the app keeps reading and writing while an index builds.
--   It does wait for transactions that were open when it started, and it takes longer than a
--   plain CREATE INDEX (two table passes). If a build is cancelled it leaves an INVALID index;
--   the file then needs the leftover dropped first:  DROP INDEX CONCURRENTLY <name>;  and re-run.
--   Before running, run docs/speed-indexes-check.sql (read-only) to see what already exists.
--   Nothing here needs an app restart or a deploy.
--
-- ORDER
--   Section 1 (extension) first, then B-tree indexes (section 2), then trigram GIN (section 3).
--   Section 3 is the slowest to build and the most costly on writes; it can be run in a quiet
--   window or skipped without affecting sections 1 and 2.

-- ---------------------------------------------------------------------------------------------
-- 1. Extension (needed only by section 3). Ships with PostgreSQL ("contrib"); on RDS it is
--    allowed for rds_superuser / the database owner. No-op if already installed.
-- ---------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------------------------
-- 2. B-tree indexes
-- ---------------------------------------------------------------------------------------------

-- daily_visits: one person's day / month / week. Serves GET /api/daily-activity (route.ts:74),
-- /api/daily-activity/calendar (calendar/route.ts:38), /api/review/daily-activity (route.ts:59),
-- /api/review/summary-cards (route.ts:42), /api/dashboard/manager (route.ts:77),
-- src/lib/summary.ts:167, src/lib/weekly-review.ts:168, daily-activity/todos/route.ts:63.
CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_visits_tenant_user_date_idx
  ON daily_visits (tenant_id, user_id, visit_date);

-- daily_visits: every meeting with one account. Serves GET /api/daily-activity?companyId=
-- (route.ts:114), src/lib/missed-todos.ts:93/152/301, src/lib/account-kind.ts:690, the cron
-- reminder check (api/cron/follow-up-reminders/route.ts:131) and the orders-for-account
-- sub-select (api/orders/route.ts, `daily_visits: { is: { entity_id } }`).
CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_visits_tenant_entity_idx
  ON daily_visits (tenant_id, entity_id) WHERE entity_id IS NOT NULL;

-- users: sign-in looks a phone number up across ALL tenants (api/auth/login/route.ts:281,
-- `where: { contact }`). The existing unique index is (tenant_id, contact), which cannot serve a
-- lookup that has no tenant. Tiny table, so a small win until user counts grow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_contact_idx
  ON users (contact);

-- users: every users list is `where tenant_id` (masters/users/route.ts:81, lib/visibility.ts:22,
-- lib/sharing.ts:323, access-control routes) and the deactivation check counts direct reports
-- (masters/users/[id]/deactivation-summary/route.ts:22, masters/users/[id]/route.ts:353).
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_tenant_manager_idx
  ON users (tenant_id, manager_user_id);

-- companies: Parties list under Self / Team scope (api/companies/_handlers.ts:63,
-- `tenant_id` + `owner_user_id IN (...)`), search scope (api/search/_shared.ts:77),
-- daily-activity/todos/route.ts:110, missed-todos.ts:142.
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_tenant_owner_idx
  ON companies (tenant_id, owner_user_id);

-- companies: the 5-minute reminder cron reads every tenant's "next meeting" dates
-- (api/cron/follow-up-reminders/route.ts:106). Partial: only rows that have a date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_next_follow_up_idx
  ON companies (next_follow_up_date) WHERE next_follow_up_date IS NOT NULL AND is_active;

-- contacts: People list under Self / Team scope (api/contacts/_handlers.ts:67, search scope
-- api/search/_shared.ts:129).
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_tenant_owner_idx
  ON contacts (tenant_id, owner_user_id);

-- orders: one person's orders, newest first, with or without a date window
-- (api/orders/route.ts:260, dashboard/manager/route.ts:81, summary.ts:185, weekly-review.ts:176,
-- the order reports in src/lib/reports).
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_tenant_user_date_idx
  ON orders (tenant_id, user_id, order_date);

-- orders: orders raised straight against an account (api/orders/route.ts `entityId` filter,
-- daily-activity/[id]/route.ts:220-233, lib/account-kind.ts:692).
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_tenant_entity_idx
  ON orders (tenant_id, entity_id) WHERE entity_id IS NOT NULL;

-- order_items: the lines of an order (orders/[id]/route.ts:32, daily-activity/[id]/route.ts,
-- orders/route.ts:444 delete-and-rewrite, the _count in the orders list, and the order_items
-- report source in src/lib/reports/sources.ts, which scopes items through their order).
-- This FK column had no index at all, and ON DELETE CASCADE from orders also needs it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_items_order_idx
  ON order_items (order_id);

-- expenses: one person's day / month / range (api/expenses/route.ts:48,
-- expenses/calendar/route.ts:62, review/expenses/route.ts:37, dashboard/manager/route.ts:85,
-- review/summary-cards/route.ts:46, summary.ts:181, weekly-review.ts:183).
CREATE INDEX CONCURRENTLY IF NOT EXISTS expenses_tenant_user_date_idx
  ON expenses (tenant_id, user_id, expense_date);

-- weekly_plans: the approval queue filters a tenant by status (api/weekly-plans/approval/route.ts:90
-- and :110 groupBy status), and the deactivation check counts Submitted plans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_plans_tenant_status_idx
  ON weekly_plans (tenant_id, status);

-- weekly_plan_items: items of a plan (api/weekly-plans/review/route.ts include,
-- api/weekly-plans/day/route.ts:33, api/daily-activity/plan/route.ts:75, the
-- `_count.weekly_plan_items` in the approval list, ON DELETE CASCADE from weekly_plans).
-- This FK column had no index at all.
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_plan_items_plan_idx
  ON weekly_plan_items (weekly_plan_id);

-- weekly_plan_items: items in a date window for a tenant (lib/missed-todos.ts:74 and :263,
-- lib/summary.ts:189/196, lib/weekly-review.ts:161).
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_plan_items_tenant_date_idx
  ON weekly_plan_items (tenant_id, plan_date);

-- weekly_plan_audit_logs: the history of one plan, newest first
-- (api/weekly-plans/[id]/logs/route.ts:40, api/weekly-plans/[id]/route.ts:73).
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_plan_audit_logs_plan_idx
  ON weekly_plan_audit_logs (weekly_plan_id, timestamp DESC);

-- notifications: the inbox is `recipient` newest-first, take 50 (api/notifications/route.ts:13).
-- The existing notifications_recipient (tenant_id, recipient_id, is_read) stays: it serves the
-- unread count and mark-all-read.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_recipient_created_idx
  ON notifications (tenant_id, recipient_id, created_at DESC);

-- contextual_remarks: replies per remark (`_count.other_contextual_remarks` in
-- api/remarks/route.ts:38). Partial: top-level remarks have no parent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS contextual_remarks_parent_idx
  ON contextual_remarks (parent_remark_id) WHERE parent_remark_id IS NOT NULL;

-- Location masters: the cascading pickers filter by parent (api/masters/districts/route.ts:16
-- ?stateId, talukas/route.ts:16 ?districtId, villages/route.ts:16 ?talukaId). The leading
-- tenant_id column also serves the unfiltered `where tenant_id` list that every master has.
CREATE INDEX CONCURRENTLY IF NOT EXISTS districts_tenant_state_idx
  ON districts (tenant_id, state_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS talukas_tenant_district_idx
  ON talukas (tenant_id, district_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS villages_tenant_taluka_idx
  ON villages (tenant_id, taluka_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS states_tenant_idx
  ON states (tenant_id);

-- Other masters: `where tenant_id` lists (the same shape industries / contact_types already
-- index). Tiny tables; included so every master list is a tenant-prefix scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_tenant_category_idx
  ON products (tenant_id, category_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS departments_tenant_idx
  ON departments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS designations_tenant_department_idx
  ON designations (tenant_id, department_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS company_types_tenant_idx
  ON company_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS deal_stages_tenant_idx
  ON deal_stages (tenant_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Trigram GIN indexes for substring search.
--    Prisma `contains` + `mode: 'insensitive'` compiles to ILIKE '%q%', and plain `contains` to
--    LIKE '%q%'; no B-tree can serve either. Each OR-ed search only uses indexes when EVERY branch
--    of the OR has one (Postgres BitmapOr), which is why a search's columns are indexed together.
--    GIN indexes cost the most on writes (see report); run this section in a quiet window.
-- ---------------------------------------------------------------------------------------------

-- Accounts: global search (api/search/_shared.ts:77, branches: name, mobile_1/mobile_2 when the
-- query has digits, gst_number) and the Parties list `?q=` (api/companies/_handlers.ts:63, name).
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_name_trgm_idx
  ON companies USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_mobile_1_trgm_idx
  ON companies USING gin (mobile_1 gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_mobile_2_trgm_idx
  ON companies USING gin (mobile_2 gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_gst_number_trgm_idx
  ON companies USING gin (gst_number gin_trgm_ops);

-- Contacts: global search (api/search/_shared.ts:129; branches name, mobile, alternate_mobile,
-- email) and the People list `?q=` (api/contacts/_handlers.ts:67; name, mobile, alternate_mobile).
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_name_trgm_idx
  ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_mobile_trgm_idx
  ON contacts USING gin (mobile gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_alternate_mobile_trgm_idx
  ON contacts USING gin (alternate_mobile gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_email_trgm_idx
  ON contacts USING gin (email gin_trgm_ops);

-- Opportunities: global search and the list `?q=` (api/search/_shared.ts:171,
-- api/deals/_handlers.ts:88; name). Small table today; cheap, so included.
CREATE INDEX CONCURRENTLY IF NOT EXISTS deals_name_trgm_idx
  ON deals USING gin (name gin_trgm_ops);
