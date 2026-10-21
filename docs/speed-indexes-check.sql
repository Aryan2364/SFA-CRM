-- READ-ONLY. Run this on RDS BEFORE docs/speed-indexes.sql.
-- It only SELECTs from the system catalogs; it changes nothing and takes no lock beyond a
-- catalog read. Safe to run on production at any time.
--
-- Purpose: show every index that already exists on the tables docs/speed-indexes.sql touches,
-- so a duplicate (same table, same leading columns) can be spotted before it is built. The
-- file is idempotent by NAME only; if RDS already has a differently named index on the same
-- columns, the new one would be a redundant copy. Compare the "definition" column below with
-- the CREATE INDEX statements in the file and skip any statement that is already covered.

-- 1. Is pg_trgm available / installed?  (installed_version NULL = available but not installed)
SELECT name, default_version, installed_version
FROM pg_available_extensions WHERE name = 'pg_trgm';

-- 2. Every index on the affected tables, with size and how often it has been used.
SELECT t.relname                                   AS table_name,
       i.relname                                   AS index_name,
       pg_get_indexdef(x.indexrelid)               AS definition,
       x.indisvalid                                AS valid,
       pg_size_pretty(pg_relation_size(x.indexrelid)) AS size,
       s.idx_scan                                  AS times_used
FROM pg_index x
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = x.indexrelid
WHERE n.nspname = 'public'
  AND t.relname IN (
    'daily_visits', 'users', 'companies', 'contacts', 'deals', 'orders', 'order_items',
    'expenses', 'weekly_plans', 'weekly_plan_items', 'weekly_plan_audit_logs', 'notifications',
    'contextual_remarks', 'states', 'districts', 'talukas', 'villages', 'products',
    'departments', 'designations', 'company_types', 'deal_stages')
ORDER BY t.relname, i.relname;

-- 3. Any index left INVALID by an earlier cancelled CONCURRENTLY build (should be zero rows).
--    If any appear, DROP INDEX CONCURRENTLY <name>; before re-running the file.
SELECT indexrelid::regclass AS invalid_index FROM pg_index WHERE NOT indisvalid;

-- 4. Row counts and table sizes of the affected tables (estimates; instant), to judge build time.
SELECT c.relname AS table_name, c.reltuples::bigint AS approx_rows,
       pg_size_pretty(pg_table_size(c.oid)) AS table_size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN (
    'daily_visits', 'users', 'companies', 'contacts', 'deals', 'orders', 'order_items',
    'expenses', 'weekly_plans', 'weekly_plan_items', 'weekly_plan_audit_logs', 'notifications',
    'contextual_remarks', 'villages', 'talukas', 'districts')
ORDER BY c.reltuples DESC;
