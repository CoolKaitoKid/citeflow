-- =============================================================================
-- CITE-Flow Chairperson browse vs review RLS
-- =============================================================================
-- STATUS: DRAFT FOR REVIEW. Do not run until this file is approved.
--
-- This file is additive. It does NOT:
--   - create tables
--   - add columns
--   - change wf_submission_status
--   - create wf_faculty
--   - create a new grant table
--   - rewrite the approval engine
--   - re-run workflow-realtime.sql
--   - enable RLS on faculty
--
-- It only replaces existing helper function bodies and existing policies
-- that were created by admin/workflow-align-existing.sql.
--
-- INTENDED BEHAVIOR
--   Grant (wf_delegated_access.is_active) = may enter the Chairperson module
--   faculty.department (live profile)     = what the Chairperson can VIEW
--   requires_chairperson_review
--     + approval_stage = 'chairperson'
--     + reviewable status                 = what the Chairperson can APPROVE
--
-- SAFETY vs current production
--   Faculty own-row INSERT/UPDATE: unchanged
--   Admin / final approver full access: unchanged
--   Chairperson APPROVE / REQUEST REVISION: same predicate as today
--     (grant + same dept + config + stage + submitted/late/underreview)
--   Chairperson SELECT: WIDENS from pending-chair-only to all same-dept
--     submissions after an active grant. This is required for department
--     browse. Revoked grant still returns no rows.
--   Chairperson UPDATE: NARROWED from can_see to can_review so browse
--     cannot be used to write approval fields on historical rows.
--
-- department_codes on wf_delegated_access is left in place as metadata.
-- It is no longer used as the visibility scope.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scope = live Chairperson profile department, not grant.department_codes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_chairperson_authorized_departments(fac public.faculty)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF fac IS NULL OR NOT public.wf_has_active_chairperson_grant(fac) THEN
    RETURN '{}';
  END IF;

  IF public.wf_faculty_department(fac) = '' THEN
    RETURN '{}';
  END IF;

  RETURN ARRAY[public.wf_faculty_department(fac)];
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Split browse (view) from review (approve / request revision)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_browse_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_in_scope(sub);
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_review_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_in_scope(sub)
     AND public.wf_submission_requires_chairperson(sub)
     AND sub.status IN ('submitted', 'late', 'underreview');
$$;

-- Keep the old name as the SELECT/browse helper so existing policies that
-- already call it automatically follow the new view rule.
CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_can_browse_submission(sub);
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_browse_faculty(p_faculty_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair public.faculty;
  target public.faculty;
BEGIN
  IF auth.uid() IS NULL OR p_faculty_id IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN false;
  END IF;

  SELECT f.* INTO target FROM public.faculty f WHERE f.id = p_faculty_id;
  IF target IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.wf_faculty_department(chair) <> ''
     AND public.wf_faculty_department(chair) = public.wf_faculty_department(target);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wf_task_assignments a
    WHERE a.task_id = p_task_id
      AND public.wf_chairperson_can_browse_faculty(a.faculty_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = p_task_id
      AND public.wf_chairperson_can_browse_submission(s)
  );
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_assignment(
  p_task_id uuid,
  p_faculty_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_can_browse_faculty(p_faculty_id)
     AND (
       EXISTS (
         SELECT 1
         FROM public.wf_submissions s
         WHERE s.task_id = p_task_id
           AND s.faculty_id = p_faculty_id
           AND public.wf_chairperson_can_browse_submission(s)
       )
       OR EXISTS (
         SELECT 1
         FROM public.wf_task_assignments a
         WHERE a.task_id = p_task_id
           AND a.faculty_id = p_faculty_id
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 3. Policies — SELECT uses browse; UPDATE uses review
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "wf_submissions_select_authorized" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_submissions_update_authorized" ON public.wf_submissions;

CREATE POLICY "wf_submissions_select_authorized"
ON public.wf_submissions
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
  OR public.wf_chairperson_can_browse_submission(wf_submissions)
);

CREATE POLICY "wf_submissions_update_authorized"
ON public.wf_submissions
FOR UPDATE
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
  OR public.wf_chairperson_can_review_submission(wf_submissions)
)
WITH CHECK (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
  OR public.wf_chairperson_in_scope(wf_submissions)
);

DROP POLICY IF EXISTS "wf_submission_files_select_authorized" ON public.wf_submission_files;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_read_submission_file(
  file_row public.wf_submission_files
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.id = file_row.submission_id
      AND public.wf_chairperson_can_browse_submission(s)
  );
$$;

GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_read_submission_file(public.wf_submission_files)
  TO authenticated;

CREATE POLICY "wf_submission_files_select_authorized"
ON public.wf_submission_files
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
  OR public.wf_chairperson_can_read_submission_file(wf_submission_files)
);

-- File writes stay owner / admin only. Chairpersons cannot upload or replace files.

DROP POLICY IF EXISTS "wf_tasks_select_authorized" ON public.wf_tasks;

CREATE POLICY "wf_tasks_select_authorized"
ON public.wf_tasks
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_assigned_to_current_faculty(id)
  OR public.wf_chairperson_can_see_task(id)
);

DROP POLICY IF EXISTS "wf_task_assignments_select_authorized" ON public.wf_task_assignments;

CREATE POLICY "wf_task_assignments_select_authorized"
ON public.wf_task_assignments
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR public.wf_chairperson_can_see_assignment(task_id, faculty_id)
);

DROP POLICY IF EXISTS "wf_comments_select_authorized" ON public.wf_comments;
DROP POLICY IF EXISTS "wf_comments_write_authorized" ON public.wf_comments;

CREATE POLICY "wf_comments_select_authorized"
ON public.wf_comments
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = wf_comments.task_id
      AND s.faculty_id::text = wf_comments.faculty_id::text
      AND public.wf_chairperson_can_browse_submission(s)
  )
);

CREATE POLICY "wf_comments_write_authorized"
ON public.wf_comments
FOR ALL
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = wf_comments.task_id
      AND s.faculty_id::text = wf_comments.faculty_id::text
      AND public.wf_chairperson_can_review_submission(s)
  )
)
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = wf_comments.task_id
      AND s.faculty_id::text = wf_comments.faculty_id::text
      AND public.wf_chairperson_can_review_submission(s)
  )
);

DROP POLICY IF EXISTS "wf_approval_history_select_authorized" ON public.wf_approval_history;

CREATE POLICY "wf_approval_history_select_authorized"
ON public.wf_approval_history
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.id = wf_approval_history.submission_id
      AND public.wf_chairperson_can_browse_submission(s)
  )
);

-- History INSERT already allows an active grant so a Chairperson can record
-- their own decision. That remains unchanged.

GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_browse_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_review_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_browse_faculty(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_authorized_departments(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_assignment(uuid, bigint) TO authenticated;

-- =============================================================================
-- VERIFICATION (run as queries after this file, do not skip)
-- =============================================================================
-- 1. No new tables:
--    SELECT tablename FROM pg_tables
--    WHERE schemaname = 'public' AND tablename LIKE 'wf_%'
--    ORDER BY 1;
--
-- 2. Scope ignores grant.department_codes:
--    SELECT pg_get_functiondef('public.wf_chairperson_authorized_departments(public.faculty)'::regprocedure);
--    Expect only faculty.department, not unnest(department_codes).
--
-- 3. Browse vs review:
--    SELECT proname FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN (
--        'wf_chairperson_can_browse_submission',
--        'wf_chairperson_can_review_submission'
--      );
--
-- 4. UPDATE policy must mention can_review, not only can_see:
--    SELECT polname, pg_get_expr(polqual, polrelid)
--    FROM pg_policy
--    WHERE polrelid = 'public.wf_submissions'::regclass
--      AND polname = 'wf_submissions_update_authorized';
--
-- 5. Production workflow still intact:
--    Faculty can still submit their own rows.
--    Admin still sees every department.
--    Granted Chairperson can SELECT same-dept historical rows.
--    Granted Chairperson can UPDATE only reviewable chair-stage rows.
--    Revoked Chairperson matches no grant and sees no module rows.
-- =============================================================================
