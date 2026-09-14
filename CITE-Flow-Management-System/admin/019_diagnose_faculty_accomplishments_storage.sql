-- =============================================================================
-- CITE-Flow 019 — READ-ONLY diagnose: faculty-accomplishments Storage RLS
--
-- Run in the Supabase SQL Editor for project uforealazougjckepggc.
-- Nothing here writes, drops, or alters policies.
-- =============================================================================

-- 1. Bucket exists, public flag, mime limits
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets
WHERE id = 'faculty-accomplishments';

-- 2. Every storage.objects policy (INSERT / UPDATE / SELECT / DELETE / ALL)
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
ORDER BY cmd, policyname;

-- 3. INSERT / ALL / UPDATE policies that mention this bucket or all buckets
SELECT
  policyname,
  cmd,
  roles,
  with_check,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND cmd IN ('INSERT', 'UPDATE', 'ALL')
ORDER BY cmd, policyname;

-- 4. Faculty 61 identity map (auth.uid() is NULL in the SQL Editor)
SELECT
  f.id,
  f.auth_user_id,
  f.email,
  f.full_name,
  f.department
FROM public.faculty f
WHERE f.id = 61;
