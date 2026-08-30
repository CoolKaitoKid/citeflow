-- CITE-Flow additive workflow alignment
-- Run in the Supabase SQL Editor ONLY after review.
-- Safe to re-run. Does NOT drop tables, truncate, disable RLS, or seed data.
--
-- DO NOT run admin/workflow-realtime.sql against this database.
-- DO NOT run supabase/migrations/001_full_schema.sql.
--
-- Live identity (verified):
--   faculty.id                     bigint
--   faculty.auth_user_id           uuid
--   wf_delegated_access.grantee_faculty_id   uuid (empty) → aligned to bigint
--   wf_delegated_access.grantee_auth_user_id uuid
--   wf_notifications.faculty_id    bigint
--   wf_submissions.faculty_id      bigint
--   wf_submissions.status          wf_submission_status
--   wf_submissions.approval_stage  text
--
-- Chairperson visibility requires ALL of:
--   1. authenticated user linked to faculty.auth_user_id
--   2. faculty role/position contains chair
--   3. active wf_delegated_access grant for that person
--   4. submitter department in grant.department_codes
--   5. report config requires chairperson review (when a config exists)
--   6. approval_stage = chairperson
--   7. status in (submitted, late, underreview)

-- ---------------------------------------------------------------------------
-- 1. Additive columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.wf_delegated_access
  ADD COLUMN IF NOT EXISTS grantee_name text,
  ADD COLUMN IF NOT EXISTS department_codes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS granted_by_name text,
  ADD COLUMN IF NOT EXISTS grantee_faculty_id uuid,
  ADD COLUMN IF NOT EXISTS grantee_auth_user_id uuid;

ALTER TABLE public.wf_delegated_access
  ALTER COLUMN is_active SET DEFAULT true;

ALTER TABLE public.wf_notifications
  ADD COLUMN IF NOT EXISTS recipient_auth_user_id uuid;

ALTER TABLE public.wf_submissions
  ADD COLUMN IF NOT EXISTS approval_stage text;

ALTER TABLE public.wf_tasks
  ADD COLUMN IF NOT EXISTS report_config_id uuid;

-- Align grantee_faculty_id to faculty.id (bigint) only when safe:
-- column is uuid AND every current value is NULL (live table is empty).
DO $$
DECLARE
  col_type text;
  nonempty bigint;
  fk_name text;
BEGIN
  SELECT c.data_type
    INTO col_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'wf_delegated_access'
    AND c.column_name = 'grantee_faculty_id';

  SELECT count(*)
    INTO nonempty
  FROM public.wf_delegated_access
  WHERE grantee_faculty_id IS NOT NULL;

  FOR fk_name IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'wf_delegated_access'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'grantee_faculty_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.wf_delegated_access DROP CONSTRAINT %I',
      fk_name
    );
  END LOOP;

  IF col_type IS NULL THEN
    ALTER TABLE public.wf_delegated_access
      ADD COLUMN grantee_faculty_id bigint;
  ELSIF col_type = 'uuid' AND nonempty = 0 THEN
    ALTER TABLE public.wf_delegated_access
      ALTER COLUMN grantee_faculty_id TYPE bigint USING NULL;
  ELSIF col_type = 'uuid' AND nonempty > 0 THEN
    RAISE EXCEPTION
      'wf_delegated_access.grantee_faculty_id is uuid and has % non-null row(s). Refusing automatic type change.',
      nonempty;
  END IF;
END
$$;

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT c.data_type
    INTO col_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'wf_delegated_access'
    AND c.column_name = 'grantee_faculty_id';

  IF col_type IN ('bigint', 'integer', 'numeric')
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND table_name = 'wf_delegated_access'
         AND constraint_name = 'wf_delegated_access_grantee_faculty_fkey'
     )
  THEN
    ALTER TABLE public.wf_delegated_access
      ADD CONSTRAINT wf_delegated_access_grantee_faculty_fkey
      FOREIGN KEY (grantee_faculty_id)
      REFERENCES public.faculty(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_active
  ON public.wf_delegated_access (is_active);

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_grantee_faculty
  ON public.wf_delegated_access (grantee_faculty_id);

CREATE INDEX IF NOT EXISTS idx_wf_delegated_access_grantee_auth
  ON public.wf_delegated_access (grantee_auth_user_id);

CREATE INDEX IF NOT EXISTS idx_wf_notifications_recipient_auth
  ON public.wf_notifications (recipient_auth_user_id);

CREATE INDEX IF NOT EXISTS idx_wf_submissions_approval_stage
  ON public.wf_submissions (approval_stage);

-- Null-only backfill. Does not overwrite an existing stage.
UPDATE public.wf_submissions s
SET approval_stage = 'chairperson'
WHERE nullif(trim(coalesce(s.approval_stage, '')), '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.wf_tasks t
    LEFT JOIN public.wf_report_configs c ON c.id = t.report_config_id
    WHERE t.id = s.task_id
      AND c.requires_chairperson_review IS DISTINCT FROM false
  );

UPDATE public.wf_submissions s
SET approval_stage = 'final_approver'
WHERE nullif(trim(coalesce(s.approval_stage, '')), '') IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Authorization helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_faculty_department(fac public.faculty)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(coalesce(nullif(fac.department, ''), '')));
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
     AND position('chair' in lower(coalesce(fac.role, fac.position, ''))) > 0;
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
  faculty_id_text text;
  auth_id_text text;
BEGIN
  IF grant_row IS NULL OR fac IS NULL THEN
    RETURN false;
  END IF;

  grant_json := to_jsonb(grant_row);
  faculty_id_text := nullif(grant_json->>'grantee_faculty_id', '');
  auth_id_text := nullif(grant_json->>'grantee_auth_user_id', '');

  IF faculty_id_text IS NOT NULL THEN
    RETURN faculty_id_text = fac.id::text;
  END IF;

  IF auth_id_text IS NOT NULL THEN
    RETURN auth_id_text = auth.uid()::text
        OR auth_id_text = fac.auth_user_id::text;
  END IF;

  -- Legacy name-only grants. Display/backward compatibility only.
  IF grant_json ? 'grantee_name'
     AND lower(trim(coalesce(grant_json->>'grantee_name', ''))) <> ''
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

  SELECT coalesce(array_agg(DISTINCT lower(trim(code))), '{}')
    INTO codes
  FROM public.wf_delegated_access d
  CROSS JOIN LATERAL unnest(coalesce(d.department_codes, '{}')) AS code
  WHERE public.wf_grant_matches_faculty(d, fac)
    AND nullif(trim(code), '') IS NOT NULL;

  IF codes IS NULL OR coalesce(array_length(codes, 1), 0) = 0 THEN
    IF public.wf_faculty_department(fac) = '' THEN
      RETURN '{}';
    END IF;
    RETURN ARRAY[public.wf_faculty_department(fac)];
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
      RETURN lower(coalesce(sub.approval_stage::text, '')) = 'chairperson';
    WHEN undefined_column THEN
      RETURN lower(coalesce(sub.approval_stage::text, '')) = 'chairperson';
  END;

  IF flag IS FALSE THEN
    RETURN false;
  END IF;

  RETURN lower(coalesce(sub.approval_stage::text, '')) = 'chairperson';
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
  IF auth.uid() IS NULL OR sub IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF NOT public.wf_has_active_chairperson_grant(chair) THEN
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

CREATE OR REPLACE FUNCTION public.wf_owns_submission(sub public.wf_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sub.faculty_id = (public.wf_current_faculty()).id;
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
      AND a.faculty_id = (public.wf_current_faculty()).id
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
      AND public.wf_chairperson_can_see_submission(s)
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
  SELECT EXISTS (
    SELECT 1
    FROM public.wf_submissions s
    WHERE s.task_id = p_task_id
      AND s.faculty_id = p_faculty_id
      AND public.wf_chairperson_can_see_submission(s)
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS — submissions, files, grants (replace open/prior policies)
-- ---------------------------------------------------------------------------

ALTER TABLE public.wf_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_delegated_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_approval_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_report_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_report_targets ENABLE ROW LEVEL SECURITY;

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
  OR public.wf_chairperson_can_see_submission(wf_submissions)
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
  OR public.wf_chairperson_can_see_submission(wf_submissions)
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

-- ---------------------------------------------------------------------------
-- 4. RLS — tasks and assignments
-- ---------------------------------------------------------------------------

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
  OR faculty_id = (public.wf_current_faculty()).id
  OR public.wf_chairperson_can_see_assignment(task_id, faculty_id)
);

CREATE POLICY "wf_task_assignments_admin_write"
ON public.wf_task_assignments
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

-- ---------------------------------------------------------------------------
-- 5. RLS — comments and approval history
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_comments;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_comments;
DROP POLICY IF EXISTS "wf_open_read_comments" ON public.wf_comments;
DROP POLICY IF EXISTS "wf_open_write_comments" ON public.wf_comments;
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
      AND public.wf_chairperson_can_see_submission(s)
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
      AND public.wf_chairperson_can_see_submission(s)
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
      AND public.wf_chairperson_can_see_submission(s)
  )
);

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_approval_history;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_approval_history;
DROP POLICY IF EXISTS "wf_approval_history_select_authorized" ON public.wf_approval_history;
DROP POLICY IF EXISTS "wf_approval_history_write_authorized" ON public.wf_approval_history;

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
      AND public.wf_chairperson_can_see_submission(s)
  )
);

CREATE POLICY "wf_approval_history_write_authorized"
ON public.wf_approval_history
FOR INSERT
TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id::text = (public.wf_current_faculty()).id::text
  OR public.wf_has_active_chairperson_grant(public.wf_current_faculty())
);

-- ---------------------------------------------------------------------------
-- 6. RLS — notifications, activity, report config
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_notifications;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_notifications;
DROP POLICY IF EXISTS "wf_open_read_notifications" ON public.wf_notifications;
DROP POLICY IF EXISTS "wf_open_write_notifications" ON public.wf_notifications;
DROP POLICY IF EXISTS "wf_notifications_select_authorized" ON public.wf_notifications;
DROP POLICY IF EXISTS "wf_notifications_write_authorized" ON public.wf_notifications;

CREATE POLICY "wf_notifications_select_authorized"
ON public.wf_notifications
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR recipient_auth_user_id = auth.uid()
);

CREATE POLICY "wf_notifications_write_authorized"
ON public.wf_notifications
FOR ALL
TO authenticated
USING (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR recipient_auth_user_id = auth.uid()
)
WITH CHECK (
  public.wf_is_final_approver()
  OR faculty_id = (public.wf_current_faculty()).id
  OR recipient_auth_user_id = auth.uid()
  OR public.wf_has_active_chairperson_grant(public.wf_current_faculty())
);

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_activity_log;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_activity_log;
DROP POLICY IF EXISTS "wf_open_read_activity" ON public.wf_activity_log;
DROP POLICY IF EXISTS "wf_open_write_activity" ON public.wf_activity_log;
DROP POLICY IF EXISTS "wf_activity_select_authorized" ON public.wf_activity_log;
DROP POLICY IF EXISTS "wf_activity_write_authorized" ON public.wf_activity_log;

CREATE POLICY "wf_activity_select_authorized"
ON public.wf_activity_log
FOR SELECT
TO authenticated
USING (
  public.wf_is_final_approver()
  OR (
    task_id IS NOT NULL
    AND public.wf_assigned_to_current_faculty(task_id)
  )
  OR (
    task_id IS NOT NULL
    AND public.wf_chairperson_can_see_task(task_id)
  )
);

CREATE POLICY "wf_activity_write_authorized"
ON public.wf_activity_log
FOR INSERT
TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR public.wf_current_faculty() IS NOT NULL
);

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

DROP POLICY IF EXISTS "Allow authenticated full access" ON public.wf_report_targets;
DROP POLICY IF EXISTS "Allow anon read" ON public.wf_report_targets;
DROP POLICY IF EXISTS "wf_report_targets_select_authenticated" ON public.wf_report_targets;
DROP POLICY IF EXISTS "wf_report_targets_admin_write" ON public.wf_report_targets;

CREATE POLICY "wf_report_targets_select_authenticated"
ON public.wf_report_targets
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "wf_report_targets_admin_write"
ON public.wf_report_targets
FOR ALL
TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

-- Report configs/targets are not private submissions. Signed-in faculty
-- must read them to know due dates and whether chairperson review is required.
-- Write remains admin-only.

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.wf_faculty_department(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_is_chairperson_role(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_is_final_approver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_belongs_to_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_matches_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_has_active_chairperson_grant(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_authorized_departments(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_submission_requires_chairperson(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_in_scope(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_owns_submission(public.wf_submissions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_owns_submission_file(public.wf_submission_files) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_assigned_to_current_faculty(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_can_see_assignment(uuid, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Idempotent realtime (never adds wf_faculty)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'faculty',
    'wf_tasks',
    'wf_task_assignments',
    'wf_submissions',
    'wf_submission_files',
    'wf_notifications',
    'wf_approval_history',
    'wf_delegated_access',
    'wf_report_configs',
    'wf_report_targets',
    'wf_activity_log',
    'wf_comments'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
