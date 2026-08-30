-- =============================================================================
-- CITE-Flow: Chairperson Review inside Faculty Submissions
-- =============================================================================
-- Additive only. Does not create tables, new status enums, or wf_faculty.
-- Does not run workflow-realtime.sql. Does not wipe data.
--
-- Run this once in the live Supabase SQL editor.
-- Do NOT re-run workflow-align-existing.sql or workflow-realtime.sql.
-- =============================================================================

-- 1. Chair role: check role OR position (coalesce hid Chairperson in position)
CREATE OR REPLACE FUNCTION public.wf_is_chairperson_role(fac public.faculty)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fac IS NOT NULL
     AND (
       position('chair' in lower(coalesce(fac.role, ''))) > 0
       OR position('chair' in lower(coalesce(fac.position, ''))) > 0
     );
$$;

-- 2. Grant match: any identifier, not first-non-null only
CREATE OR REPLACE FUNCTION public.wf_grant_belongs_to_faculty(
  grant_row public.wf_delegated_access,
  fac public.faculty
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  grant_json jsonb;
BEGIN
  IF grant_row IS NULL OR fac IS NULL THEN
    RETURN false;
  END IF;

  grant_json := to_jsonb(grant_row);

  IF nullif(grant_json->>'grantee_faculty_id', '') IS NOT NULL
     AND grant_json->>'grantee_faculty_id' = fac.id::text THEN
    RETURN true;
  END IF;

  IF nullif(grant_json->>'grantee_auth_user_id', '') IS NOT NULL
     AND (
       grant_json->>'grantee_auth_user_id' = auth.uid()::text
       OR grant_json->>'grantee_auth_user_id' = fac.auth_user_id::text
     ) THEN
    RETURN true;
  END IF;

  IF nullif(lower(trim(coalesce(grant_json->>'grantee_email', grant_json->>'email', ''))), '') IS NOT NULL
     AND lower(trim(coalesce(grant_json->>'grantee_email', grant_json->>'email', '')))
       = lower(trim(coalesce(fac.email, fac.existing_email, ''))) THEN
    RETURN true;
  END IF;

  IF nullif(lower(trim(coalesce(grant_json->>'grantee_name', ''))), '') IS NOT NULL
     AND lower(trim(coalesce(grant_json->>'grantee_name', '')))
       = lower(trim(coalesce(fac.full_name, fac.name, ''))) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 3. Scope = live faculty.department after an active grant (not grant.department_codes)
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

-- 4. Zero-arg RPC so the Faculty Submissions page can detect the grant reliably
CREATE OR REPLACE FUNCTION public.wf_current_user_has_chairperson_grant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_has_active_chairperson_grant(public.wf_current_faculty());
$$;

GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated;

-- 5. Browse vs review (same-dept history is readable; approve stays pending-only)
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

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_can_browse_submission(sub);
$$;

DROP POLICY IF EXISTS "wf_submissions_select_authorized" ON public.wf_submissions;
CREATE POLICY "wf_submissions_select_authorized"
ON public.wf_submissions
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
  OR public.wf_chairperson_can_browse_submission(wf_submissions)
);

DROP POLICY IF EXISTS "wf_submissions_update_authorized" ON public.wf_submissions;
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

-- 6. Repair existing Faculty submissions that required chair review but were
--    stored as final_approver / null because the client missed the config.
UPDATE public.wf_submissions s
SET approval_stage = 'chairperson'
FROM public.wf_tasks t
JOIN public.wf_report_configs c ON c.id = t.report_config_id
WHERE s.task_id = t.id
  AND c.requires_chairperson_review IS TRUE
  AND s.status IN ('submitted', 'late')
  AND lower(coalesce(s.approval_stage::text, '')) IN ('', 'final_approver')
  AND NOT EXISTS (
    SELECT 1
    FROM public.wf_approval_history h
    WHERE h.submission_id = s.id
      AND lower(coalesce(h.action, '')) LIKE '%chairperson_approved%'
  );

-- 7. File SELECT follows the parent submission (no faculty_id on files).
--    Use a SECURITY DEFINER helper so nested RLS on wf_submissions cannot
--    hide files the Chairperson is already allowed to review.
--    Prefer running admin/workflow-chairperson-files-rls.sql if this file
--    was already applied earlier.

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

DROP POLICY IF EXISTS "wf_submission_files_select_authorized" ON public.wf_submission_files;

CREATE POLICY "wf_submission_files_select_authorized"
ON public.wf_submission_files
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
  OR public.wf_chairperson_can_read_submission_file(wf_submission_files)
);
