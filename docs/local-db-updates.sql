-- Pending database changes, for the LOCAL database (sfacrm_local) first.
-- Every statement is safe to re-run (IF NOT EXISTS). Nothing here deletes data.
-- Run the same file on RDS only after the combined test passes locally.

-- 1. GST switch and Landline (already applied on RDS on 13 Oct; local still needs them)
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS gst_required_for_orders BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS landline TEXT;
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS landline TEXT;

-- 2. Won/Lost: which opportunity stages are closed outcomes
ALTER TABLE deal_stages ADD COLUMN IF NOT EXISTS stage_type TEXT NOT NULL DEFAULT 'Open';

-- 3. Couldn't meet: reasons master and to-do outcomes
CREATE TABLE IF NOT EXISTS todo_unmet_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS todo_unmet_reasons_tenant_idx ON todo_unmet_reasons (tenant_id);

CREATE TABLE IF NOT EXISTS todo_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  todo_kind text NOT NULL CHECK (todo_kind IN ('plan','followup','next_meeting')), todo_ref text NOT NULL,
  party_id uuid NULL, due_date date NOT NULL,
  outcome text NOT NULL DEFAULT 'couldnt_meet' CHECK (outcome = 'couldnt_meet'),
  reason_id uuid NULL, note text NULL, new_date date NULL,
  latitude double precision NULL, longitude double precision NULL, address text NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS todo_outcomes_tenant_user_due_idx ON todo_outcomes (tenant_id, user_id, due_date);
CREATE INDEX IF NOT EXISTS todo_outcomes_tenant_party_idx ON todo_outcomes (tenant_id, party_id);

-- 4. Account and opportunity sharing
CREATE TABLE IF NOT EXISTS account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
  user_id uuid NOT NULL, access text NOT NULL CHECK (access IN ('work','view')),
  added_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL, updated_at timestamptz NULL, removed_by uuid NULL, removed_at timestamptz NULL);
CREATE UNIQUE INDEX IF NOT EXISTS account_members_active_uq
  ON account_members (tenant_id, company_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS account_members_user_idx
  ON account_members (tenant_id, user_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS deal_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, deal_id uuid NOT NULL,
  user_id uuid NOT NULL, access text NOT NULL CHECK (access IN ('work','view')),
  added_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL, updated_at timestamptz NULL, removed_by uuid NULL, removed_at timestamptz NULL);
CREATE UNIQUE INDEX IF NOT EXISTS deal_members_active_uq
  ON deal_members (tenant_id, deal_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS deal_members_user_idx
  ON deal_members (tenant_id, user_id) WHERE removed_at IS NULL;

-- 5. Accounts & Contacts, stage 1
ALTER TABLE companies ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'Company'
  CHECK (account_kind IN ('Company','Individual'));
ALTER TABLE company_types ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'Company'
  CHECK (applies_to IN ('Company','Individual','Both'));
ALTER TABLE company_contacts
  ADD COLUMN IF NOT EXISTS role_id uuid NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_self boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS contact_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS contact_roles_tenant_idx ON contact_roles (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_self_per_account_uq
  ON company_contacts (tenant_id, company_id) WHERE is_self AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_self_per_contact_uq
  ON company_contacts (tenant_id, contact_id) WHERE is_self;

-- 6. One primary contact per account. Run the check first: if it returns any rows,
--    those accounts have more than one primary contact and the index below will fail
--    until one of each pair is un-marked.
SELECT tenant_id, company_id, count(*) AS primaries
  FROM company_contacts WHERE is_primary = true
 GROUP BY tenant_id, company_id HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_primary_uq
  ON company_contacts (tenant_id, company_id) WHERE is_primary = true;

-- 7. Meeting attendees (Accounts & Contacts, stage 2)
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, visit_id uuid NOT NULL,
  contact_id uuid NOT NULL, is_main boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS meeting_attendees_visit_contact_uq
  ON meeting_attendees (tenant_id, visit_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_attendees_one_main_uq
  ON meeting_attendees (tenant_id, visit_id) WHERE is_main;
CREATE INDEX IF NOT EXISTS meeting_attendees_contact_idx
  ON meeting_attendees (tenant_id, contact_id);

-- 8. Next meeting: optional time alongside the existing date columns
ALTER TABLE deal_follow_ups ADD COLUMN IF NOT EXISTS due_time time NULL;
ALTER TABLE companies      ADD COLUMN IF NOT EXISTS next_follow_up_time time NULL;

-- 9. Phone push notifications: one row per browser/phone subscription.
--    The endpoint is globally unique (a shared phone moves between people: the
--    subscribe route reassigns the row). notifications needs no change - it has
--    no CHECK on section / context_type.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL,
  user_agent text NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (tenant_id, user_id);
-- Exactly-once follow-up reminders: one notification per (recipient, due moment, item).
-- Only the reminder rows are covered (their context_type is 'follow_up_due@...' / 'next_meeting_due@...').
CREATE UNIQUE INDEX IF NOT EXISTS notifications_reminder_once_uq
  ON notifications (tenant_id, recipient_id, context_type, context_id)
  WHERE context_type LIKE 'follow_up_due@%' OR context_type LIKE 'next_meeting_due@%';

-- 10. How accurate each captured location was, in metres (reported by the phone).
--     Nullable and additive; the app saves lat/lng without it until this is run.
ALTER TABLE daily_visits
  ADD COLUMN IF NOT EXISTS accuracy_m real NULL,
  ADD COLUMN IF NOT EXISTS end_accuracy_m real NULL;
ALTER TABLE todo_outcomes ADD COLUMN IF NOT EXISTS accuracy_m real NULL;
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_accuracy_m real NULL,
  ADD COLUMN IF NOT EXISTS check_out_accuracy_m real NULL;
