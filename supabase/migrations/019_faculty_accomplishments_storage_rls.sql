-- CITE-Flow 019 — faculty-accomplishments Storage INSERT (owned folder only)
-- Canonical copy of admin/019_faculty_accomplishments_storage_rls.sql
-- Additive. Idempotent. Does not disable RLS. Does not use USING/WITH CHECK (true).

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

DROP POLICY IF EXISTS "faculty_accomplishments_storage_insert_own" ON storage.objects;

CREATE POLICY "faculty_accomplishments_storage_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'faculty-accomplishments'
  AND public.faculty_owns_accomplishment_storage_object(name)
);
