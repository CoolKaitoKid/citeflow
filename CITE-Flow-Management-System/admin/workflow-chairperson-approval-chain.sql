-- =============================================================================
-- CITE-Flow Faculty → Chairperson/OIC → Admin approval chain
-- Safe to re-run. Additive. Does NOT drop tables, wipe data, or disable RLS.
--
-- If Chairperson Review is empty and debug still has is_chair_role:false
-- with no sql_patch_version, run admin/FIX-chairperson-queue-NOW.sql first.
-- Then run this file for the full chain (OIC, unsubmit, Admin skip block).
--
-- DO NOT run admin/workflow-realtime.sql or supabase/migrations/001_full_schema.sql.
--
-- Live identity (verified):
--   faculty.id                     bigint
--   faculty.auth_user_id           uuid
--   wf_submissions.faculty_id      bigint
--   wf_delegated_access.grantee_faculty_id  bigint
--   wf_delegated_access.department_codes    text[]
--
-- Architecture:
--   Grant (wf_delegated_access.is_active) = may review as Chairperson/OIC
--   grant.department_codes = authorized departments (OIC may differ from home dept)
--   If department_codes is empty, fall back to the grantee's live faculty.department
--   Role CHAIRPERSON is NOT required (temporary OIC support)
--   Review actions apply only when the report config requires Chairperson review
--   Admin remains fully visible; cannot finalize while Chairperson review is pending
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
  ADD COLUMN IF NOT EXISTS grantee_auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS grantee_email text;

ALTER TABLE public.wf_delegated_access
  ALTER COLUMN is_active SET DEFAULT true;

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

CREATE OR REPLACE FUNCTION public.wf_normalize_dept(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(value, '')));
$$;

CREATE OR REPLACE FUNCTION public.wf_faculty_department(fac public.faculty)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT public.wf_normalize_dept(coalesce(
    nullif(fac.department, ''),
    nullif(to_jsonb(fac)->>'department_code', ''),
    nullif(to_jsonb(fac)->>'dept', ''),
    ''
  ));
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
  WHERE auth.uid() IS NOT NULL
    AND (
      f.auth_user_id = auth.uid()
      OR (
        nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
        AND (
          lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
          OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
        )
      )
    )
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
       strpos(lower(coalesce(to_jsonb(fac)->>'role', '')), 'chair') > 0
       OR strpos(lower(coalesce(to_jsonb(fac)->>'position', '')), 'chair') > 0
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
         OR (
           nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
           AND lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
         ))
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
  grant_email text;
  faculty_email text;
BEGIN
  IF grant_row IS NULL OR fac IS NULL THEN
    RETURN false;
  END IF;

  grant_json := to_jsonb(grant_row);

  IF nullif(grant_json->>'grantee_faculty_id', '') IS NOT NULL
     AND grant_json->>'grantee_faculty_id' = fac.id::text THEN
    RETURN true;
  END IF;

  IF nullif(grant_json->>'faculty_id', '') IS NOT NULL
     AND grant_json->>'faculty_id' = fac.id::text THEN
    RETURN true;
  END IF;

  IF nullif(grant_json->>'grantee_auth_user_id', '') IS NOT NULL
     AND (
       grant_json->>'grantee_auth_user_id' = auth.uid()::text
       OR grant_json->>'grantee_auth_user_id' = fac.auth_user_id::text
     ) THEN
    RETURN true;
  END IF;

  grant_email := lower(trim(coalesce(
    grant_json->>'grantee_email',
    grant_json->>'email',
    ''
  )));
  faculty_email := lower(trim(coalesce(
    to_jsonb(fac)->>'email',
    to_jsonb(fac)->>'existing_email',
    ''
  )));
  IF grant_email <> '' AND faculty_email <> '' AND grant_email = faculty_email THEN
    RETURN true;
  END IF;

  IF nullif(lower(trim(coalesce(grant_json->>'grantee_name', ''))), '') IS NOT NULL
     AND lower(trim(coalesce(grant_json->>'grantee_name', '')))
       = lower(trim(coalesce(to_jsonb(fac)->>'full_name', to_jsonb(fac)->>'name', ''))) THEN
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

-- Grant is the door. CHAIRPERSON role is not required (temporary OIC).
CREATE OR REPLACE FUNCTION public.wf_has_active_chairperson_grant(fac public.faculty)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fac IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.wf_delegated_access d
       WHERE public.wf_grant_matches_faculty(d, fac)
     );
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
  IF fac IS NULL OR NOT public.wf_has_active_chairperson_grant(fac) THEN
    RETURN '{}';
  END IF;

  SELECT coalesce(array_agg(DISTINCT public.wf_normalize_dept(code)), '{}')
    INTO codes
  FROM public.wf_delegated_access d
  CROSS JOIN LATERAL unnest(coalesce(d.department_codes, '{}')) AS code
  WHERE public.wf_grant_matches_faculty(d, fac)
    AND public.wf_normalize_dept(code) <> '';

  IF codes IS NOT NULL AND array_length(codes, 1) > 0 THEN
    RETURN codes;
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

  -- A linked config with a null flag still requires Chairperson review.
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
  IF status IN ('rejected') THEN
    RETURN CASE WHEN stored IN ('declined', 'rejected') THEN stored ELSE 'declined' END;
  END IF;

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
  authorized text[];
  submitter_dept text;
BEGIN
  IF auth.uid() IS NULL OR sub IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL OR NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN false;
  END IF;

  authorized := public.wf_chairperson_authorized_departments(chair);
  IF authorized IS NULL OR array_length(authorized, 1) IS NULL THEN
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

  submitter_dept := public.wf_faculty_department(submitter);
  IF submitter_dept = '' THEN
    RETURN false;
  END IF;

  RETURN submitter_dept = ANY (authorized);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_browse_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_chairperson_in_scope(sub)
     AND public.wf_task_requires_chairperson(sub.task_id);
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
  SELECT sub.faculty_id::text = (public.wf_current_faculty()).id::text
      OR (
        (public.wf_current_faculty()).auth_user_id IS NOT NULL
        AND sub.faculty_id::text = (public.wf_current_faculty()).auth_user_id::text
      );
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
      AND public.wf_chairperson_can_browse_submission(s)
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
  SELECT public.wf_task_requires_chairperson(p_task_id)
     AND (
       EXISTS (
         SELECT 1
         FROM public.wf_submissions s
         WHERE s.task_id = p_task_id
           AND public.wf_chairperson_in_scope(s)
       )
       OR EXISTS (
         SELECT 1
         FROM public.wf_task_assignments a
         JOIN public.faculty f
           ON f.id::text = a.faculty_id::text
         WHERE a.task_id = p_task_id
           AND public.wf_faculty_department(f) = ANY (
             public.wf_chairperson_authorized_departments(public.wf_current_faculty())
           )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_can_see_assignment(p_task_id uuid, p_faculty_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_task_requires_chairperson(p_task_id)
     AND EXISTS (
       SELECT 1
       FROM public.faculty f
       WHERE f.id = p_faculty_id
         AND public.wf_faculty_department(f) = ANY (
           public.wf_chairperson_authorized_departments(public.wf_current_faculty())
         )
     );
$$;

CREATE OR REPLACE FUNCTION public.wf_faculty_can_unsubmit(sub public.wf_submissions)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  status text;
  stage text;
BEGIN
  IF NOT public.wf_owns_submission(sub) THEN
    RETURN false;
  END IF;

  status := lower(trim(coalesce(sub.status::text, '')));
  IF status IN ('approved', 'rejected') THEN
    RETURN false;
  END IF;
  IF lower(trim(coalesce(sub.approval_stage::text, ''))) = 'approved' THEN
    RETURN false;
  END IF;

  stage := public.wf_effective_approval_stage(sub);
  IF status IN ('submitted', 'late', 'underreview', 'revision')
     AND (
       stage = 'chairperson'
       OR (stage = 'final_approver' AND NOT public.wf_task_requires_chairperson(sub.task_id))
       OR stage = 'revision'
     ) THEN
    RETURN true;
  END IF;

  RETURN status IN ('notsubmitted', 'revision');
END;
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
  authorized text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL OR NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN;
  END IF;

  authorized := public.wf_chairperson_authorized_departments(chair);
  IF authorized IS NULL OR array_length(authorized, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (s.id) s.*
  FROM public.wf_submissions s
  JOIN public.faculty f
    ON f.id::text = s.faculty_id::text
    OR f.auth_user_id::text = s.faculty_id::text
  WHERE public.wf_faculty_department(f) = ANY (authorized)
    AND public.wf_task_requires_chairperson(s.task_id)
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
  authorized text[];
  grant_count integer := 0;
  total_subs integer := 0;
  join_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'auth_uid', null,
      'empty_reason', 'no_auth'
    );
  END IF;

  chair := public.wf_current_faculty();
  chair_dept := public.wf_faculty_department(chair);
  authorized := public.wf_chairperson_authorized_departments(chair);

  SELECT count(*)::integer INTO grant_count
  FROM public.wf_delegated_access d
  WHERE chair IS NOT NULL
    AND public.wf_grant_matches_faculty(d, chair);

  SELECT count(*)::integer INTO total_subs FROM public.wf_submissions;

  IF authorized IS NOT NULL AND array_length(authorized, 1) IS NOT NULL THEN
    SELECT count(DISTINCT s.id)::integer INTO join_count
    FROM public.wf_submissions s
    JOIN public.faculty f
      ON f.id::text = s.faculty_id::text
      OR f.auth_user_id::text = s.faculty_id::text
    WHERE public.wf_faculty_department(f) = ANY (authorized)
      AND public.wf_task_requires_chairperson(s.task_id);
  END IF;

  RETURN jsonb_build_object(
    'sql_patch_version', '011-chair-queue',
    'auth_uid', auth.uid(),
    'chair_id', chair.id,
    'chair_role', to_jsonb(chair)->>'role',
    'chair_position', to_jsonb(chair)->>'position',
    'chair_department', chair_dept,
    'authorized_departments', to_jsonb(authorized),
    'is_chair_role', public.wf_is_chairperson_role(chair),
    'has_grant', public.wf_has_active_chairperson_grant(chair),
    'matching_grant_count', grant_count,
    'total_submissions', total_subs,
    'in_scope_chair_required_count', join_count,
    'table_visible_count', (
      SELECT count(*)::integer FROM public.wf_submissions s
      WHERE public.wf_chairperson_can_browse_submission(s)
    ),
    'rpc_visible_count', (
      SELECT count(*)::integer FROM public.wf_list_chairperson_submissions()
    ),
    'empty_reason', CASE
      WHEN chair IS NULL THEN 'no_faculty_row'
      WHEN grant_count = 0 THEN 'no_matching_grant'
      WHEN authorized IS NULL OR array_length(authorized, 1) IS NULL THEN 'empty_authorized_departments'
      WHEN total_subs = 0 THEN 'no_submissions_in_table'
      WHEN join_count = 0 THEN 'no_in_scope_chair_required_submissions'
      ELSE 'ok'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_prevent_skipping_chairperson()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND lower(coalesce(NEW.status::text, '')) = 'approved'
     AND public.wf_task_requires_chairperson(OLD.task_id)
     AND public.wf_effective_approval_stage(OLD) = 'chairperson'
     AND NOT public.wf_chairperson_can_review_submission(OLD) THEN
    RAISE EXCEPTION 'Chairperson review is required before final approval'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wf_prevent_skipping_chairperson ON public.wf_submissions;
CREATE TRIGGER trg_wf_prevent_skipping_chairperson
BEFORE UPDATE ON public.wf_submissions
FOR EACH ROW
EXECUTE FUNCTION public.wf_prevent_skipping_chairperson();

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

GRANT EXECUTE ON FUNCTION public.wf_normalize_dept(text) TO authenticated;
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
GRANT EXECUTE ON FUNCTION public.wf_faculty_can_unsubmit(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '011-chair-queue'::text;
$$;

CREATE OR REPLACE FUNCTION public.wf_debug_chairperson_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_debug_chairperson_visibility();
$$;

GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated;

NOTIFY pgrst, 'reload schema';
