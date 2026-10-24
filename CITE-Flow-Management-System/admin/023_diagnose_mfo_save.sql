-- =============================================================================
-- CITE-Flow 023 — READ-ONLY diagnose for the current MFO save errors
-- Run in the SQL Editor as project owner. auth.uid() is NULL here.
-- =============================================================================

-- 1. Was 022 applied? Is the new routing RPC present?
SELECT public.mfo_sql_version() AS mfo_sql_version;

SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'wf_resolve_initial_approval_stage',
    'mfo_owns_faculty_id',
    'mfo_can_write_packet',
    'mfo_debug_write_access'
  )
ORDER BY p.proname;

-- 2. PI6 must NOT have source_table / source_id (that is expected)
SELECT c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('mfo_pi6_postgraduate', 'mfo_pi7_trainings', 'mfo_pi8_instructional_materials')
  AND c.column_name IN ('source_table', 'source_id', 'source_kind')
ORDER BY c.table_name, c.column_name;

-- 3. Faculty 61 vs the login that failed
--    Console auth_uid was: d018f939-6c74-4629-af09-2206b92ba200
--    Packet: a6ce7591-561d-49d1-b76b-9e25fc4bba92
SELECT
  f.id,
  f.auth_user_id,
  f.email,
  f.existing_email,
  (f.auth_user_id::text = 'd018f939-6c74-4629-af09-2206b92ba200') AS auth_user_id_matches_login,
  p.id AS packet_id,
  p.faculty_id,
  p.packet_state
FROM public.faculty f
LEFT JOIN public.mfo_packets p
  ON p.id = 'a6ce7591-561d-49d1-b76b-9e25fc4bba92'
WHERE f.id = 61
   OR f.auth_user_id::text = 'd018f939-6c74-4629-af09-2206b92ba200';
