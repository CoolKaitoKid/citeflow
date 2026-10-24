-- =============================================================================
-- CITE-Flow 019 — faculty-accomplishments Storage INSERT (owned folder only)
--
-- Symptom:
--   POST /storage/v1/object/faculty-accomplishments/faculty-{id}/{file}
--   HTTP 400  "new row violates row-level security policy"
--
-- Cause:
--   uploadToStorage() INSERTs storage.objects before faculty_accomplishments
--   is written. There is no authenticated INSERT policy that allows only
--   faculty-{owned faculty.id}/. Anon INSERT is denied (confirmed live).
--
-- This script:
--   1) Adds a helper that resolves faculty.id from faculty.auth_user_id = auth.uid()
--   2) Adds INSERT on storage.objects for bucket faculty-accomplishments
--      only when the object name starts with faculty-{that id}/
--
-- Does NOT:
--   disable RLS
--   use USING (true) or WITH CHECK (true)
--   grant the whole bucket to every authenticated user
--   change the folder format to an auth UUID
--   add UPDATE (uploadToStorage uses upsert: false)
--   modify MFO RLS, wf-submissions, Chairperson/Admin approval, or auth
--
-- Additive and idempotent. Safe to re-run.
-- Run in the Supabase SQL Editor for project: uforealazougjckepggc
-- Prerequisite: public.faculty.id is bigint; public.faculty.auth_user_id exists.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ownership helper
--
-- The browser path faculty-{id}/ is not trusted on its own.
-- auth.uid() must own a public.faculty row whose numeric id is exactly
-- the folder segment. SECURITY DEFINER so faculty table RLS cannot hide
-- that one identity row from the storage policy.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.faculty_owns_accomplishment_storage_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_name IS NOT NULL
     AND btrim(p_name) <> ''
     AND EXISTS (
       SELECT 1
       FROM public.faculty f
       WHERE f.auth_user_id IS NOT NULL
         AND f.auth_user_id::text = auth.uid()::text
         AND p_name LIKE ('faculty-' || f.id::text || '/%')
     );
$$;

COMMENT ON FUNCTION public.faculty_owns_accomplishment_storage_object(text) IS
  'True when storage.objects.name is faculty-{faculty.id}/… and faculty.auth_user_id = auth.uid(). Used only by faculty-accomplishments Storage INSERT.';

REVOKE ALL ON FUNCTION public.faculty_owns_accomplishment_storage_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.faculty_owns_accomplishment_storage_object(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- INSERT only. Path must be faculty-{owned id}/…
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "faculty_accomplishments_storage_insert_own" ON storage.objects;

CREATE POLICY "faculty_accomplishments_storage_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'faculty-accomplishments'
  AND public.faculty_owns_accomplishment_storage_object(name)
);

-- ---------------------------------------------------------------------------
-- After-state (read-only). Expect the new INSERT policy and no UPDATE policy
-- created by this migration.
-- ---------------------------------------------------------------------------

SELECT
  policyname,
  cmd,
  roles,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname = 'faculty_accomplishments_storage_insert_own';
