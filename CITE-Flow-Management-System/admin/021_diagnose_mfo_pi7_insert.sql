-- =============================================================================
-- CITE-Flow 021 — READ-ONLY diagnose: mfo_pi7_trainings INSERT 42501
-- Run in the SQL Editor as the project owner (service role).
-- Nothing here writes.
-- =============================================================================

-- 1. Table shape
SELECT
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'mfo_pi7_trainings'
ORDER BY c.ordinal_position;

-- 2. Live policies on PI7 vs a working sibling (PI5)
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('mfo_pi7_trainings', 'mfo_pi5_certifications')
ORDER BY tablename, cmd, policyname;

-- 3. Helper versions / ownership for faculty 61 (auth.uid() is NULL here)
SELECT public.mfo_sql_version() AS mfo_sql_version;

SELECT
  f.id,
  f.auth_user_id,
  f.email,
  p.id AS packet_id,
  p.faculty_id AS packet_faculty_id,
  p.packet_state
FROM public.faculty f
LEFT JOIN public.mfo_packets p ON p.faculty_id = f.id
WHERE f.id = 61
ORDER BY p.created_at DESC NULLS LAST;
