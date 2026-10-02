-- =============================================================================
-- CITE-Flow 034 — Chairperson may replace the one submitted MFO PDF
--
-- Symptom:
--   Chairperson saves the program-owned MFO sections (licensure, graduate
--   employment, program narrative) and the page regenerates
--   MFO-Accomplishment-Report.pdf with the existing generator.
--   Storage INSERT/DELETE and wf_submission_files writes then fail with
--   row-level security, because 027 allows those writes only for the faculty
--   owner and a final approver.
--
-- This script lets a Chairperson who can still review the submission replace
-- only that submitted PDF object and its wf_submission_files row. It does not
-- grant photo upload, faculty-record writes, or a public bucket.
--
-- Run in the Supabase SQL Editor for project: uforealazougjckepggc
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.chair_can_replace_submitted_mfo_pdf(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_name IS NOT NULL
     AND split_part(p_name, '/', 4) = 'submitted-report'
     AND split_part(p_name, '/', 5) = 'MFO-Accomplishment-Report.pdf'
     AND split_part(p_name, '/', 6) = ''
     AND EXISTS (
       SELECT 1
       FROM public.mfo_packets p
       JOIN public.wf_submissions s ON s.id = p.submission_id
       WHERE p.id::text = split_part(p_name, '/', 3)
         AND split_part(p_name, '/', 1) = p.faculty_id::text
         AND public.wf_chairperson_can_review_submission(s)
     );
$$;

COMMENT ON FUNCTION public.chair_can_replace_submitted_mfo_pdf(text) IS
  'True when storage.objects.name is the one submitted MFO PDF for a packet the caller can still review as Chairperson.';

REVOKE ALL ON FUNCTION public.chair_can_replace_submitted_mfo_pdf(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chair_can_replace_submitted_mfo_pdf(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chair_can_replace_submitted_mfo_pdf(text) TO authenticated;

-- Keep the faculty-owner and final-approver writes from 027, and add the Chairperson PDF path.
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
    OR public.chair_can_replace_submitted_mfo_pdf(name)
  )
);

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
    OR public.chair_can_replace_submitted_mfo_pdf(name)
  )
);

DROP POLICY IF EXISTS "wf_submission_files_chair_replace_mfo_pdf" ON public.wf_submission_files;
CREATE POLICY "wf_submission_files_chair_replace_mfo_pdf"
ON public.wf_submission_files
FOR ALL
TO authenticated
USING (
  coalesce(mfo_indicator, '') = 'submitted_mfo_pdf'
  AND EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.id = wf_submission_files.submission_id
      AND public.wf_chairperson_can_review_submission(s)
  )
)
WITH CHECK (
  coalesce(mfo_indicator, '') = 'submitted_mfo_pdf'
  AND EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.id = wf_submission_files.submission_id
      AND public.wf_chairperson_can_review_submission(s)
  )
);

NOTIFY pgrst, 'reload schema';
