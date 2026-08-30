-- CITE-Flow Chairperson workflow authorization
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Replaces open "allow all authenticated" policies on approval data.
-- Does NOT disable RLS.
-- Does NOT grant every CHAIRPERSON role access to every chair task.
--
-- Visibility requires:
--   1. An active wf_delegated_access grant (Admin → Manage Access)
--   2. The submission's faculty department is in that grant's department_codes
--   3. The submission is in the Chairperson approval stage
--   4. The report config requires Chairperson review (when a config exists)

ALTER TABLE public.wf_delegated_access
  ADD COLUMN IF NOT EXISTS grantee_name text,
  ADD COLUMN IF NOT EXISTS department_codes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS granted_by_name text,
  ADD COLUMN IF NOT EXISTS grantee_faculty_id uuid,
  ADD COLUMN IF NOT EXISTS grantee_auth_user_id uuid;

ALTER TABLE public.wf_delegated_access
  ALTER COLUMN is_active SET DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_active
  ON public.wf_delegated_access (is_active);

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_grantee_faculty
  ON public.wf_delegated_access (grantee_faculty_id);

CREATE OR REPLACE FUNCTION public.wf_faculty_department(fac public.faculty)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(coalesce(
    nullif(fac.department, ''),
    CASE
      WHEN to_jsonb(fac) ? 'department_code' THEN nullif(to_jsonb(fac)->>'department_code', '')
      ELSE NULL
    END,
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
        AND lower(trim(coalesce(f.role, f.position, ''))) IN (
          'admin', 'administrator', 'dean', 'college secretary',
          'college_secretary', 'secretary', 'superadmin'
        )
    )
    OR lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) IN (
      'admin', 'administrator', 'superadmin', 'dean'
    )
    OR lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '')) LIKE '%secretary%';
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

  IF grant_json ? 'grantee_faculty_id'
     AND grant_json->>'grantee_faculty_id' IS NOT NULL
     AND grant_json->>'grantee_faculty_id' = fac.id::text THEN
    RETURN true;
  END IF;

  IF grant_json ? 'grantee_auth_user_id'
     AND grant_json->>'grantee_auth_user_id' IS NOT NULL
     AND grant_json->>'grantee_auth_user_id' = auth.uid()::text THEN
    RETURN true;
  END IF;

  IF grant_json ? 'grantee_name'
     AND lower(trim(coalesce(grant_json->>'grantee_name', ''))) <> ''
     AND lower(trim(coalesce(grant_json->>'grantee_name', '')))
       = lower(trim(coalesce(fac.full_name, ''))) THEN
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

CREATE OR REPLACE FUNCTION public.wf_chairperson_authorized_departments(fac public.faculty)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  codes text[];
BEGIN
  IF fac IS NULL THEN
    RETURN '{}';
  END IF;

  SELECT coalesce(array_agg(lower(trim(code))), '{}')
    INTO codes
  FROM public.wf_delegated_access d
  CROSS JOIN LATERAL unnest(coalesce(d.department_codes, '{}')) AS code
  WHERE public.wf_grant_matches_faculty(d, fac)
    AND nullif(trim(code), '') IS NOT NULL;

  IF codes IS NULL OR coalesce(array_length(codes, 1), 0) = 0 THEN
    IF public.wf_faculty_department(fac) = '' THEN
      RETURN '{}';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.wf_delegated_access d
      WHERE public.wf_grant_matches_faculty(d, fac)
    ) THEN
      RETURN ARRAY[public.wf_faculty_department(fac)];
    END IF;
    RETURN '{}';
  END IF;

  RETURN codes;
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_submission_requires_chairperson(sub public.wf_submissions)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flag boolean;
BEGIN
  BEGIN
    SELECT c.requires_chairperson_review
      INTO flag
    FROM public.wf_tasks t
    LEFT JOIN public.wf_report_configs c ON c.id = t.report_config_id
    WHERE t.id = sub.task_id;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN lower(coalesce(sub.approval_stage, '')) = 'chairperson';
    WHEN undefined_column THEN
      RETURN lower(coalesce(sub.approval_stage, '')) = 'chairperson';
  END;

  IF flag IS FALSE THEN
    RETURN false;
  END IF;

  RETURN lower(coalesce(sub.approval_stage, '')) = 'chairperson';
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
  codes text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL THEN
    RETURN false;
  END IF;

  IF position('chair' in lower(coalesce(chair.role, chair.position, ''))) = 0 THEN
    RETURN false;
  END IF;

  codes := public.wf_chairperson_authorized_departments(chair);
  IF codes IS NULL OR coalesce(array_length(codes, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  SELECT f.* INTO submitter FROM public.faculty f WHERE f.id = sub.faculty_id;
  IF submitter IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.wf_faculty_department(submitter) = ANY (codes);
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_submission(sub public.wf_submissions)
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
  OR faculty_id = (public.wf_current_faculty()).id
  OR public.wf_chairperson_can_see_submission(wf_submissions)
);

CREATE POLICY "wf_submissions_insert_own"
ON public.wf_submissions
FOR INSERT
TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
);

CREATE POLICY "wf_submissions_update_authorized"
ON public.wf_submissions
FOR UPDATE
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR public.wf_chairperson_can_see_submission(wf_submissions)
)
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR public.wf_chairperson_in_scope(wf_submissions)
);

CREATE POLICY "wf_submissions_delete_admin"
ON public.wf_submissions
FOR DELETE
TO authenticated
USING (public.wf_is_final_approver());

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
      AND s.faculty_id = (public.wf_current_faculty()).id
  );
$$;

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
  OR EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.id = wf_submission_files.submission_id
      AND public.wf_chairperson_can_see_submission(s)
  )
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

GRANT EXECUTE ON FUNCTION public.wf_faculty_department(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_is_final_approver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_belongs_to_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_matches_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_authorized_departments(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_submission_requires_chairperson(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_in_scope(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_owns_submission_file(public.wf_submission_files) TO authenticated;
