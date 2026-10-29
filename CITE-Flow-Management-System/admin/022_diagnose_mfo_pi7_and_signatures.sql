-- =============================================================================
-- CITE-Flow 022 — READ-ONLY diagnose: PI7 42501 + signature columns
-- Run in the SQL Editor as the project owner. Nothing here writes.
-- =============================================================================

SELECT public.mfo_sql_version() AS mfo_sql_version;

-- 1. Signature columns on mfo_packets
SELECT
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'mfo_packets'
  AND c.column_name IN (
    'id', 'faculty_id', 'packet_state',
    'signature_data_url', 'signature_name', 'signature_signed_at'
  )
ORDER BY c.ordinal_position;

-- 2. PI7 shape
SELECT
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'mfo_pi7_trainings'
ORDER BY c.ordinal_position;

-- 3. Live PI7 policies
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('mfo_pi7_trainings', 'mfo_packets')
ORDER BY tablename, cmd, policyname;

-- 4. Faculty 61 ownership map (auth.uid() is NULL in the SQL Editor)
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
