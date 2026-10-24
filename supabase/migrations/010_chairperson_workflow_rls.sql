-- =============================================================================
-- CITE-Flow Chairperson workflow authorization
-- Safe to re-run. Does NOT drop tables, delete data, or disable RLS.
-- Does NOT create wf_faculty or add wf_submission_files.faculty_id.
--
-- Matches the live frontend (shared/workflow.js + faculty/chairperson-review.js):
--   Grant (wf_delegated_access.is_active) = may enter Chairperson Review
--   Scope = live faculty.department / department_code (NOT grant.department_codes)
--   Approve / Request Revision = pending Chairperson stage only
--
-- Faculty → Chairperson → Admin/Dean/Secretary → final approval
-- A CHAIRPERSON role without an active Admin grant sees nothing extra.
-- =============================================================================

ALTER TABLE public.wf_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_delegated_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_report_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wf_delegated_access
  ADD COLUMN IF NOT EXISTS grantee_name text,
  ADD COLUMN IF NOT EXISTS department_codes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS granted_by_name text,
  ADD COLUMN IF NOT EXISTS grantee_auth_user_id uuid;

ALTER TABLE public.wf_delegated_access
  ALTER COLUMN is_active SET DEFAULT true;

-- Live faculty.id is bigint. Never add grantee_faculty_id as uuid.
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT c.data_type INTO col_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'wf_delegated_access'
    AND c.column_name = 'grantee_faculty_id';

  IF col_type IS NULL THEN
    ALTER TABLE public.wf_delegated_access
      ADD COLUMN grantee_faculty_id bigint;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_active
  ON public.wf_delegated_access (is_active);

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_grantee_faculty
  ON public.wf_delegated_access (grantee_faculty_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_faculty_department(fac public.faculty)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(coalesce(
    nullif(fac.department, ''),
    nullif(to_jsonb(fac)->>'department_code', ''),
    nullif(to_jsonb(fac)->>'dept', ''),
    ''
  )));
$$;

CREATE OR REPLACE FUNCTION public.wf_current_faculty()
RETURNS public.faculty
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.*
  FROM public.faculty f
  WHERE f.auth_user_id = auth.uid()
     OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     OR lower(coalesce(f.existing_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ORDER BY CASE WHEN f.auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;
$$;

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

CREATE OR REPLACE FUNCTION public.wf_is_final_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.admin_profiles ap
      WHERE ap.id = auth.uid()
        AND lower(coalesce(ap.role, 'administrator')) NOT LIKE '%chair%'
    )
    OR EXISTS (
      SELECT 1
      FROM public.faculty f
      WHERE (f.auth_user_id = auth.uid()
         OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        AND public.wf_is_chairperson_role(f) IS DISTINCT FROM true
        AND lower(trim(coalesce(f.role, f.position, ''))) IN (
          'admin', 'administrator', 'dean', 'college secretary',
          'college_secretary', 'secretary', 'superadmin'
        )
    )
    OR (
      lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN (
        'admin', 'administrator', 'superadmin', 'dean'
      )
      AND position(
        'chair' in lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', ''))
      ) = 0
    )
    OR (
      lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) LIKE '%secretary%'
      AND position(
        'chair' in lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', ''))
      ) = 0
    );
$$;

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

  IF nullif(grant_json->>'grantee_faculty_id', '') IS NOT NULL
     AND (
       grant_json->>'grantee_faculty_id' = auth.uid()::text
       OR grant_json->>'grantee_faculty_id' = fac.auth_user_id::text
     ) THEN
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

CREATE OR REPLACE FUNCTION public.wf_grant_matches_faculty(
  grant_row public.wf_delegated_access,
  fac public.faculty
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT grant_row.is_active IS DISTINCT FROM false
     AND public.wf_grant_belongs_to_faculty(grant_row, fac);
$$;

CREATE OR REPLACE FUNCTION public.wf_has_active_chairperson_grant(fac public.faculty)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fac IS NOT NULL
     AND public.wf_is_chairperson_role(fac)
     AND EXISTS (
       SELECT 1
       FROM public.wf_delegated_access d
       WHERE public.wf_grant_matches_faculty(d, fac)
     );
$$;

-- Frontend: grant = door; authorized departments = live profile department.
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

CREATE OR REPLACE FUNCTION public.wf_task_requires_chairperson(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flag boolean;
  has_config boolean := false;
BEGIN
  SELECT
    c.requires_chairperson_review,
    (c.id IS NOT NULL)
    INTO flag, has_config
  FROM public.wf_tasks t
  LEFT JOIN public.wf_report_configs c ON c.id = t.report_config_id
  WHERE t.id = p_task_id;

  IF flag IS FALSE THEN
    RETURN false;
  END IF;

  IF flag IS TRUE THEN
    RETURN true;
  END IF;

  -- Frontend: a config with a null flag still requires Chairperson review.
  RETURN has_config;
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_submission_requires_chairperson(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_task_requires_chairperson(sub.task_id);
$$;

-- Effective stage matches shared/workflow.js getApprovalStage().
CREATE OR REPLACE FUNCTION public.wf_effective_approval_stage(sub public.wf_submissions)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored text := lower(trim(coalesce(sub.approval_stage::text, '')));
  status text := lower(trim(coalesce(sub.status::text, '')));
BEGIN
  IF public.wf_task_requires_chairperson(sub.task_id)
     AND status IN ('submitted', 'late')
     AND stored IN ('', 'final_approver') THEN
    RETURN 'chairperson';
  END IF;

  IF stored <> '' THEN
    RETURN stored;
  END IF;

  IF public.wf_task_requires_chairperson(sub.task_id) THEN
    RETURN 'chairperson';
  END IF;

  RETURN 'final_approver';
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_in_scope(sub public.wf_submissions)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair public.faculty;
  submitter public.faculty;
  chair_dept text;
BEGIN
  IF auth.uid() IS NULL OR sub IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL OR NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN false;
  END IF;

  chair_dept := public.wf_faculty_department(chair);
  IF chair_dept = '' THEN
    RETURN false;
  END IF;

  SELECT f.*
    INTO submitter
    FROM public.faculty f
   WHERE f.id::text = sub.faculty_id::text
      OR f.auth_user_id::text = sub.faculty_id::text
   LIMIT 1;

  IF submitter IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.wf_faculty_department(submitter) = chair_dept;
END;
$$;

-- Pending Chairperson review (frontend isPendingChairpersonReview).
CREATE OR REPLACE FUNCTION public.wf_chairperson_can_review_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_in_scope(sub)
     AND public.wf_task_requires_chairperson(sub.task_id)
     AND lower(coalesce(sub.status::text, '')) IN ('submitted', 'late', 'underreview')
     AND public.wf_effective_approval_stage(sub) = 'chairperson';
$$;

-- SELECT/browse uses in_scope so Chairperson Review tabs can load.
-- Approve still requires can_review.
CREATE OR REPLACE FUNCTION public.wf_chairperson_can_browse_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_in_scope(sub);
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

CREATE OR REPLACE FUNCTION public.wf_owns_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sub.faculty_id::text = (public.wf_current_faculty()).id::text;
$$;

CREATE OR REPLACE FUNCTION public.wf_owns_submission_file(file_row public.wf_submission_files)
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
      AND public.wf_owns_submission(s)
  );
$$;

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
      AND public.wf_chairperson_in_scope(s)
  );
$$;

CREATE OR REPLACE FUNCTION public.wf_assigned_to_current_faculty(p_task_id uuid)
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
      AND a.faculty_id::text = (public.wf_current_faculty()).id::text
  );
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
    FROM public.wf_submissions s
    WHERE s.task_id = p_task_id
      AND public.wf_chairperson_in_scope(s)
  );
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_assignment(p_task_id uuid, p_faculty_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = p_task_id
      AND s.faculty_id::text = p_faculty_id::text
      AND public.wf_chairperson_in_scope(s)
  );
$$;

CREATE OR REPLACE FUNCTION public.wf_list_chairperson_submissions()
RETURNS SETOF public.wf_submissions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair public.faculty;
  chair_dept text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL OR NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN;
  END IF;

  chair_dept := public.wf_faculty_department(chair);
  IF chair_dept = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (s.id) s.*
  FROM public.wf_submissions s
  JOIN public.faculty f
    ON f.id::text = s.faculty_id::text
    OR f.auth_user_id::text = s.faculty_id::text
  WHERE public.wf_faculty_department(f) = chair_dept
  ORDER BY s.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_current_user_has_chairperson_grant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_has_active_chairperson_grant(public.wf_current_faculty());
$$;

CREATE OR REPLACE FUNCTION public.wf_debug_chairperson_visibility()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair public.faculty;
  chair_dept text;
  grant_count integer := 0;
  total_subs integer := 0;
  join_count integer := 0;
BEGIN
  chair := public.wf_current_faculty();
  chair_dept := public.wf_faculty_department(chair);

  SELECT count(*)::integer INTO grant_count
  FROM public.wf_delegated_access d
  WHERE chair IS NOT NULL
    AND public.wf_grant_matches_faculty(d, chair);

  SELECT count(*)::integer INTO total_subs FROM public.wf_submissions;

  IF chair_dept <> '' THEN
    SELECT count(DISTINCT s.id)::integer INTO join_count
    FROM public.wf_submissions s
    JOIN public.faculty f
      ON f.id::text = s.faculty_id::text
      OR f.auth_user_id::text = s.faculty_id::text
    WHERE public.wf_faculty_department(f) = chair_dept;
  END IF;

  RETURN jsonb_build_object(
    'auth_uid', auth.uid(),
    'chair_id', chair.id,
    'chair_department', chair_dept,
    'is_chair_role', public.wf_is_chairperson_role(chair),
    'has_grant', public.wf_has_active_chairperson_grant(chair),
    'matching_grant_count', grant_count,
    'total_submissions', total_subs,
    'same_dept_join_count', join_count,
    'empty_reason', CASE
      WHEN auth.uid() IS NULL THEN 'no_auth'
      WHEN chair IS NULL THEN 'no_faculty_row'
      WHEN public.wf_is_chairperson_role(chair) IS NOT TRUE THEN 'not_chair_role'
      WHEN grant_count = 0 THEN 'no_matching_grant'
      WHEN coalesce(chair_dept, '') = '' THEN 'empty_department'
      WHEN total_subs = 0 THEN 'no_submissions_in_table'
      WHEN join_count = 0 THEN 'faculty_id_or_department_mismatch'
      ELSE 'ok'
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_submissions;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_open_read_submissions" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_open_write_submissions" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_submissions_select_authorized" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_submissions_insert_own" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_submissions_update_authorized" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_submissions_delete_admin" ON public.wf_submissions;

CREATE POLICY "wf_submissions_select_authorized"
ON public.wf_submissions
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
  OR public.wf_chairperson_can_browse_submission(wf_submissions)
);

CREATE POLICY "wf_submissions_insert_own"
ON public.wf_submissions
FOR INSERT
TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR public.wf_owns_submission(wf_submissions)
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

CREATE POLICY "wf_submissions_delete_admin"
ON public.wf_submissions
FOR DELETE
TO authenticated
USING (public.wf_is_final_approver());

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_submission_files;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_submission_files;
DROP POLICY IF EXISTS "wf_open_read_submission_files" ON public.wf_submission_files;
DROP POLICY IF EXISTS "wf_open_write_submission_files" ON public.wf_submission_files;
DROP POLICY IF EXISTS "wf_submission_files_select_authorized" ON public.wf_submission_files;
DROP POLICY IF EXISTS "wf_submission_files_write_own" ON public.wf_submission_files;

CREATE POLICY "wf_submission_files_select_authorized"
ON public.wf_submission_files
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
  OR public.wf_chairperson_can_read_submission_file(wf_submission_files)
);

CREATE POLICY "wf_submission_files_write_own"
ON public.wf_submission_files
FOR ALL
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
)
WITH CHECK (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
);

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_delegated_access;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_delegated_access;
DROP POLICY IF EXISTS "wf_open_read_delegate" ON public.wf_delegated_access;
DROP POLICY IF EXISTS "wf_open_write_delegate" ON public.wf_delegated_access;
DROP POLICY IF EXISTS "wf_delegated_access_select" ON public.wf_delegated_access;
DROP POLICY IF EXISTS "wf_delegated_access_admin_write" ON public.wf_delegated_access;

CREATE POLICY "wf_delegated_access_select"
ON public.wf_delegated_access
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_grant_belongs_to_faculty(wf_delegated_access, public.wf_current_faculty())
);

CREATE POLICY "wf_delegated_access_admin_write"
ON public.wf_delegated_access
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_tasks;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_tasks;
DROP POLICY IF EXISTS "wf_open_read_tasks" ON public.wf_tasks;
DROP POLICY IF EXISTS "wf_open_write_tasks" ON public.wf_tasks;
DROP POLICY IF EXISTS "wf_tasks_select_authorized" ON public.wf_tasks;
DROP POLICY IF EXISTS "wf_tasks_admin_write" ON public.wf_tasks;

CREATE POLICY "wf_tasks_select_authorized"
ON public.wf_tasks
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_assigned_to_current_faculty(id)
  OR public.wf_chairperson_can_see_task(id)
);

CREATE POLICY "wf_tasks_admin_write"
ON public.wf_tasks
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_task_assignments;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_task_assignments;
DROP POLICY IF EXISTS "wf_open_read_assignments" ON public.wf_task_assignments;
DROP POLICY IF EXISTS "wf_open_write_assignments" ON public.wf_task_assignments;
DROP POLICY IF EXISTS "wf_task_assignments_select_authorized" ON public.wf_task_assignments;
DROP POLICY IF EXISTS "wf_task_assignments_admin_write" ON public.wf_task_assignments;

CREATE POLICY "wf_task_assignments_select_authorized"
ON public.wf_task_assignments
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR public.wf_chairperson_can_see_assignment(task_id, faculty_id)
);

CREATE POLICY "wf_task_assignments_admin_write"
ON public.wf_task_assignments
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_report_configs;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_report_configs;
DROP POLICY IF EXISTS "wf_report_configs_select_authenticated" ON public.wf_report_configs;
DROP POLICY IF EXISTS "wf_report_configs_admin_write" ON public.wf_report_configs;

CREATE POLICY "wf_report_configs_select_authenticated"
ON public.wf_report_configs
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "wf_report_configs_admin_write"
ON public.wf_report_configs
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

GRANT EXECUTE ON FUNCTION public.wf_faculty_department(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_is_chairperson_role(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_is_final_approver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_belongs_to_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_matches_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_has_active_chairperson_grant(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_authorized_departments(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_task_requires_chairperson(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_submission_requires_chairperson(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_effective_approval_stage(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_in_scope(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_review_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_browse_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_owns_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_owns_submission_file(public.wf_submission_files) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_read_submission_file(public.wf_submission_files) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_assigned_to_current_faculty(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_assignment(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
