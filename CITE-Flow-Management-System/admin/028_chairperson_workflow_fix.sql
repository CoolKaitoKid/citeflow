-- =============================================================================
-- CITE-Flow 028 — Chairperson Workflow Review & RPC Auth Fix
--
-- Fixes:
--   1) Re-grants EXECUTE on Chairperson RPCs (wf_list_chairperson_submissions,
--      wf_chairperson_sql_version, wf_debug_chairperson_queue,
--      wf_debug_chairperson_visibility, wf_current_user_has_chairperson_grant)
--      to authenticated and anon roles, preventing 401 Unauthorized / permission denied errors.
--   2) Configures wf_notifications RLS policies so authenticated reviewers (Chairpersons)
--      can insert notifications when reviewing submissions.
--   3) Configures wf_activity_log RLS policies for authenticated activity logging.
--
-- Security:
--   - Does NOT weaken RLS globally.
--   - Does NOT turn Chairperson into Admin.
--   - Chairperson queue RPC (SECURITY DEFINER) continues to strictly enforce
--     active chairperson grant, department scope, and submitter != reviewer.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- 1. Version function
CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '028-chair-workflow-fix'::text;
$$;

-- 2. Ensure all Chairperson workflow RPCs and helper functions have EXECUTE granted
GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated, anon;

-- Helper functions
DO $$
BEGIN
  IF to_regprocedure('public.wf_is_chairperson_role(public.faculty)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_is_chairperson_role(public.faculty) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_has_active_chairperson_grant(public.faculty)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_has_active_chairperson_grant(public.faculty) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_authorized_departments(public.faculty)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_authorized_departments(public.faculty) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_in_scope(public.wf_submissions)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_in_scope(public.wf_submissions) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_browse_submission(public.wf_submissions)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_browse_submission(public.wf_submissions) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_review_submission(public.wf_submissions)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_review_submission(public.wf_submissions) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_see_submission(public.wf_submissions)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_submission(public.wf_submissions) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_read_submission_file(public.wf_submission_files)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_read_submission_file(public.wf_submission_files) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_see_task(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_task(uuid) TO authenticated, anon;
  END IF;
  IF to_regprocedure('public.wf_chairperson_can_see_assignment(uuid, bigint)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_assignment(uuid, bigint) TO authenticated, anon;
  END IF;
END $$;

-- 3. Targeted RLS for wf_notifications
ALTER TABLE public.wf_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wf_notifications_insert_authenticated" ON public.wf_notifications;
CREATE POLICY "wf_notifications_insert_authenticated"
ON public.wf_notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "wf_notifications_select_authorized" ON public.wf_notifications;
CREATE POLICY "wf_notifications_select_authorized"
ON public.wf_notifications
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR EXISTS (
    SELECT 1 FROM public.wf_delegated_access d
    WHERE public.wf_grant_matches_faculty(d, public.wf_current_faculty())
  )
);

DROP POLICY IF EXISTS "wf_notifications_update_authorized" ON public.wf_notifications;
CREATE POLICY "wf_notifications_update_authorized"
ON public.wf_notifications
FOR UPDATE
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
)
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
);

-- 4. Targeted RLS for wf_activity_log
ALTER TABLE public.wf_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wf_activity_log_insert_authenticated" ON public.wf_activity_log;
CREATE POLICY "wf_activity_log_insert_authenticated"
ON public.wf_activity_log
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "wf_activity_log_select_authenticated" ON public.wf_activity_log;
CREATE POLICY "wf_activity_log_select_authenticated"
ON public.wf_activity_log
FOR SELECT
TO authenticated
USING (true);

NOTIFY pgrst, 'reload schema';

SELECT public.wf_chairperson_sql_version() AS wf_chairperson_sql_version;
