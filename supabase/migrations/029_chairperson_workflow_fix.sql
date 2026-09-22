-- =============================================================================
-- Migration 029: Chairperson Workflow Review & RPC Auth Fix
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '028-chair-workflow-fix'::text;
$$;

GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated, anon;

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
