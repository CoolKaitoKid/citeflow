-- =============================================================================
-- CITE-Flow 019 — READ-ONLY verify after faculty-accomplishments Storage INSERT
-- Run AFTER admin/019_faculty_accomplishments_storage_rls.sql
-- =============================================================================

SELECT
  policyname,
  cmd,
  roles,
  permissive,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    policyname = 'faculty_accomplishments_storage_insert_own'
    OR policyname ILIKE '%faculty-accomplishments%'
    OR policyname ILIKE '%faculty_accomplishments%'
  )
ORDER BY cmd, policyname;

-- Expect exactly one row: faculty 61 has a non-null auth_user_id
SELECT
  id,
  auth_user_id IS NOT NULL AS has_auth_link,
  email
FROM public.faculty
WHERE id = 61;

-- Helper exists and is granted to authenticated only
SELECT
  p.proname,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'faculty_owns_accomplishment_storage_object';
