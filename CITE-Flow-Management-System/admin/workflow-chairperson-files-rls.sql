-- =============================================================================
-- CITE-Flow: Chairperson READ of submissions + their files
-- =============================================================================
-- Debug proved the file query never runs:
--   [Chairperson File Debug] submission IDs: []
-- because wf_submissions SELECT returns no rows for the Chairperson.
-- Files are loaded only after those parent IDs exist.
--
-- Additive only. Does not create tables, columns, or wf_submission_files.faculty_id.
-- Does not re-run workflow-realtime.sql or workflow-align-existing.sql.
--
-- Relationship:
--   Chairperson + active grant + same faculty.department
--     → READ wf_submissions
--     → READ wf_submission_files WHERE submission_id = wf_submissions.id
-- =============================================================================

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

  -- Some grants stored the auth uuid in grantee_faculty_id.
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
      OR (
        nullif(sub.faculty_id::text, '') IS NOT NULL
        AND f.auth_user_id::text = sub.faculty_id::text
      )
   LIMIT 1;

  IF submitter IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.wf_faculty_department(submitter) = chair_dept;
END;
$$;

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

-- Same-department submissions the current Chairperson may read.
-- SECURITY DEFINER so nested RLS on wf_submissions cannot hide rows
-- the grant + department check already allows.
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
  WHERE lower(trim(coalesce(
          nullif(f.department, ''),
          nullif(to_jsonb(f)->>'department_code', ''),
          ''
        ))) = chair_dept
  ORDER BY s.id;
END;
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
  sample jsonb := '[]'::jsonb;
BEGIN
  chair := public.wf_current_faculty();
  chair_dept := public.wf_faculty_department(chair);

  SELECT count(*)::integer INTO grant_count
  FROM public.wf_delegated_access d
  WHERE chair IS NOT NULL
    AND public.wf_grant_matches_faculty(d, chair);

  SELECT count(*)::integer INTO total_subs
  FROM public.wf_submissions;

  IF chair_dept <> '' THEN
    SELECT count(DISTINCT s.id)::integer INTO join_count
    FROM public.wf_submissions s
    JOIN public.faculty f
      ON f.id::text = s.faculty_id::text
      OR f.auth_user_id::text = s.faculty_id::text
    WHERE lower(trim(coalesce(
            nullif(f.department, ''),
            nullif(to_jsonb(f)->>'department_code', ''),
            ''
          ))) = chair_dept;
  END IF;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
    INTO sample
    FROM (
      SELECT jsonb_build_object(
        'id', s.id,
        'faculty_id', s.faculty_id,
        'status', s.status,
        'approval_stage', s.approval_stage,
        'faculty_department', f.department,
        'faculty_department_code', to_jsonb(f)->>'department_code'
      ) AS x
      FROM public.wf_submissions s
      LEFT JOIN public.faculty f ON f.id::text = s.faculty_id::text
      ORDER BY s.submitted_at DESC NULLS LAST
      LIMIT 8
    ) sample_rows;

  RETURN jsonb_build_object(
    'auth_uid', auth.uid(),
    'chair_id', chair.id,
    'chair_auth_user_id', chair.auth_user_id,
    'chair_role', chair.role,
    'chair_position', chair.position,
    'chair_department_raw', chair.department,
    'chair_department', chair_dept,
    'is_chair_role', public.wf_is_chairperson_role(chair),
    'has_grant', public.wf_has_active_chairperson_grant(chair),
    'matching_grant_count', grant_count,
    'total_submissions', total_subs,
    'same_dept_join_count', join_count,
    'sample_submissions', sample,
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

GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_browse_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_in_scope(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_faculty_department(public.faculty) TO authenticated;

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_submissions;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_submissions;
DROP POLICY IF EXISTS "wf_open_read_submissions" ON public.wf_submissions;
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
DROP POLICY IF EXISTS "wf_open_read_submission_files" ON public.wf_submission_files;

CREATE POLICY "wf_submission_files_select_authorized"
ON public.wf_submission_files
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR public.wf_owns_submission_file(wf_submission_files)
  OR public.wf_chairperson_can_read_submission_file(wf_submission_files)
);

-- If Preview/Download still 403s after the file ROW is visible, also run:
--   admin/workflow-chairperson-storage-rls.sql
