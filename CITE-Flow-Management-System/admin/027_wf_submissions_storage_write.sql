-- =============================================================================
-- CITE-Flow 027 — wf-submissions Storage INSERT / DELETE (owned MFO path only)
--
-- Symptom:
--   Faculty MFO photo / file upload:
--     POST /storage/v1/object/wf-submissions/{faculty.id}/{task}/{packet}/...
--     HTTP 400 / 403  "new row violates row-level security policy"
--   Editor preview may work from a blob URL, then disappear after refresh
--   because the Storage object was never accepted.
--
-- Cause:
--   The bucket is private. Repo policy wf_submissions_storage_select_authorized
--   is SELECT only. upload() INSERTs storage.objects before wf_submission_files
--   is written, so there is no authenticated INSERT (or DELETE) for the
--   faculty owner's path.
--
-- This script:
--   1) Adds a helper that allows an object only when:
--        auth.uid() → faculty.auth_user_id → faculty.id
--        AND the first path segment is that faculty.id
--        AND, when the third segment is a UUID, it is that faculty's mfo_packets.id
--   2) Adds INSERT and DELETE on storage.objects for bucket wf-submissions
--      using that helper (final approvers keep full write on this bucket).
--   3) Does NOT add UPDATE. mfo-report.js must upload with upsert: false.
--   4) Leaves the existing SELECT policy in place (object readable only when
--      storage.objects.name = wf_submission_files.storage_path and the caller
--      may already SELECT that file row).
--
-- Does NOT:
--   disable RLS
--   use USING (true) or WITH CHECK (true)
--   make the bucket public
--   grant the whole bucket to every authenticated user
--   change faculty-accomplishments (019)
--   change mfo_packets signature columns or child-table RLS
--
-- Additive and idempotent. Safe to re-run.
-- Run in the Supabase SQL Editor for project: uforealazougjckepggc
-- After running: hard-refresh the MFO page (Ctrl+F5) and retry photo upload.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '027-wf-submissions-storage-write'::text;
$$;

-- ---------------------------------------------------------------------------
-- Ownership helper
--
-- Browser path {faculty.id}/{taskId}/{packetId}/[photos/]{file} is not trusted
-- on its own. auth.uid() must own the faculty row whose numeric id is the
-- first folder, and when the third folder is a UUID it must be that faculty's
-- packet. SECURITY DEFINER so faculty / packet RLS cannot hide the identity
-- check from the storage policy.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.faculty_owns_wf_submission_storage_object(p_name text)
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
         AND split_part(p_name, '/', 1) = f.id::text
         AND (
           split_part(p_name, '/', 3) = ''
           OR split_part(p_name, '/', 3) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR EXISTS (
             SELECT 1
             FROM public.mfo_packets p
             WHERE p.id::text = split_part(p_name, '/', 3)
               AND p.faculty_id = f.id
           )
         )
     );
$$;

COMMENT ON FUNCTION public.faculty_owns_wf_submission_storage_object(text) IS
  'True when storage.objects.name is {owned faculty.id}/{task}/{packet}/… and faculty.auth_user_id = auth.uid(). Used only by wf-submissions Storage INSERT/DELETE.';

REVOKE ALL ON FUNCTION public.faculty_owns_wf_submission_storage_object(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.faculty_owns_wf_submission_storage_object(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.faculty_owns_wf_submission_storage_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;

-- ---------------------------------------------------------------------------
-- INSERT only into the caller's own faculty.id / packet folder.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "wf_submissions_storage_insert_own" ON storage.objects;

CREATE POLICY "wf_submissions_storage_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wf-submissions'
  AND (
    public.wf_is_final_approver()
    OR public.faculty_owns_wf_submission_storage_object(name)
  )
);

-- ---------------------------------------------------------------------------
-- DELETE only from the same owned folder (Remove photo / replace file).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "wf_submissions_storage_delete_own" ON storage.objects;

CREATE POLICY "wf_submissions_storage_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wf-submissions'
  AND (
    public.wf_is_final_approver()
    OR public.faculty_owns_wf_submission_storage_object(name)
  )
);

NOTIFY pgrst, 'reload schema';

-- Verification (read-only)
SELECT public.mfo_sql_version() AS mfo_sql_version;

SELECT
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (
    'wf_submissions_storage_select_authorized',
    'wf_submissions_storage_insert_own',
    'wf_submissions_storage_delete_own'
  )
ORDER BY policyname;
