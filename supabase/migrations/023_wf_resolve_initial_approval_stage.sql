-- =============================================================================
-- CITE-Flow 023 — Add wf_resolve_initial_approval_stage()
--
-- Symptom:
--   POST /rest/v1/rpc/wf_resolve_initial_approval_stage → 404
--
-- Cause:
--   faculty/mfo-report.js and shared/workflow.js already call this RPC so a
--   Chairperson filing their own MFO is not stranded in a queue only they
--   can see. The function was never created in SQL. The browser already
--   falls back to the local routing rule; this migration removes the 404
--   and uses the same helpers as the Chairperson workflow.
--
-- Does NOT change RLS, wf_report_configs, or approval-stage names.
-- Safe / idempotent.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.wf_resolve_initial_approval_stage(p_task_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submitter public.faculty;
  dept text;
  other_chairs integer := 0;
BEGIN
  IF p_task_id IS NULL THEN
    RETURN 'final_approver';
  END IF;

  IF NOT public.wf_task_requires_chairperson(p_task_id) THEN
    RETURN 'final_approver';
  END IF;

  submitter := public.wf_current_faculty();
  IF submitter IS NULL THEN
    RETURN 'chairperson';
  END IF;

  -- Regular faculty still go to Chairperson review when the task requires it.
  IF NOT public.wf_has_active_chairperson_grant(submitter) THEN
    RETURN 'chairperson';
  END IF;

  dept := public.wf_faculty_department(submitter);
  IF dept IS NULL OR dept = '' THEN
    RETURN 'chairperson';
  END IF;

  IF NOT (dept = ANY (public.wf_chairperson_authorized_departments(submitter))) THEN
    RETURN 'chairperson';
  END IF;

  -- Another Chairperson / OIC is authorized for this department.
  SELECT count(*)::integer
    INTO other_chairs
  FROM public.faculty f
  WHERE f.id IS DISTINCT FROM submitter.id
    AND public.wf_has_active_chairperson_grant(f)
    AND public.wf_normalize_dept(dept) = ANY (public.wf_chairperson_authorized_departments(f));

  IF other_chairs > 0 THEN
    RETURN 'chairperson';
  END IF;

  RETURN 'final_approver';
END;
$$;

COMMENT ON FUNCTION public.wf_resolve_initial_approval_stage(uuid) IS
  'Initial wf_submissions.approval_stage for a new submit. chairperson unless the submitter is the only Chairperson covering their own department, in which case final_approver.';

GRANT EXECUTE ON FUNCTION public.wf_resolve_initial_approval_stage(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '023 applied: wf_resolve_initial_approval_stage(uuid) is available.';
END
$$;
