-- =============================================================================
-- CITE-Flow: scoped Storage SELECT for wf-submissions
-- =============================================================================
-- Run ONLY if Chairperson Review can already see the wf_submission_files row
-- (filename appears) but Preview/Download still 403s.
--
-- Does not make the bucket public.
-- Does not expose files from other departments or revoked grants.
-- Objects are readable only when storage.objects.name matches
-- wf_submission_files.storage_path for a file the caller may already SELECT.
-- =============================================================================

DROP POLICY IF EXISTS "wf_submissions_storage_select_authorized" ON storage.objects;

CREATE POLICY "wf_submissions_storage_select_authorized"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wf-submissions'
  AND (
    public.wf_is_final_approver()
    OR EXISTS (
      SELECT 1
      FROM public.wf_submission_files f
      WHERE f.storage_path IS NOT NULL
        AND f.storage_path <> ''
        AND f.storage_path = name
        AND (
          public.wf_owns_submission_file(f)
          OR public.wf_chairperson_can_read_submission_file(f)
        )
    )
  )
);
