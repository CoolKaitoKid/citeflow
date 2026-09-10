-- =============================================================================
-- CITE-Flow 013 — Faculty MFO ownership + Chairperson auth/queue fix
--
-- RUN IN THE SAME SUPABASE PROJECT THE APP USES:
--   https://supabase.com/dashboard/project/uforealazougjckepggc/sql
-- Project ref must be: uforealazougjckepggc
--
-- Idempotent where practical. Does NOT disable RLS.
-- Does NOT use public.wf_faculty.
-- Does NOT change public.faculty.id type (must remain bigint).
-- Does NOT create USING (true) policies.
--
-- Prerequisite: 011 chairperson helpers + 012 MFO structured data.
-- Replaces / supersedes the need to re-run:
--   admin/mfo-faculty-ownership-fix.sql
--   admin/FIX-chairperson-queue-NOW.sql
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Version markers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '013-mfo-faculty-chair-auth'::text;
$$;

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '013-mfo-faculty-chair-auth'::text;
$$;

-- ---------------------------------------------------------------------------
-- Shared: is this grant still within optional date bounds?
-- Reads optional columns via to_jsonb so missing columns never break.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_grant_within_dates(grant_row public.wf_delegated_access)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g jsonb := to_jsonb(grant_row);
  starts text := nullif(trim(coalesce(g->>'starts_at', g->>'valid_from', g->>'effective_from', '')), '');
  ends text := nullif(trim(coalesce(g->>'ends_at', g->>'expires_at', g->>'valid_until', g->>'effective_until', '')), '');
BEGIN
  IF grant_row IS NULL THEN
    RETURN false;
  END IF;
  IF starts IS NOT NULL AND starts::timestamptz > timezone('utc', now()) THEN
    RETURN false;
  END IF;
  IF ends IS NOT NULL AND ends::timestamptz <= timezone('utc', now()) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- A4 — wf_current_faculty: text-safe auth_user_id match + unique email fallback
-- ---------------------------------------------------------------------------

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
      f.auth_user_id::text = auth.uid()::text
      OR (
        f.auth_user_id IS NULL
        AND nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
        AND (
          lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
          OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
        )
        AND (
          SELECT count(*)::integer
          FROM public.faculty f2
          WHERE f2.auth_user_id IS NULL
            AND (
              lower(trim(coalesce(f2.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
              OR lower(trim(coalesce(f2.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
            )
        ) = 1
      )
    )
  ORDER BY
    CASE WHEN f.auth_user_id::text = auth.uid()::text THEN 0 ELSE 1 END,
    f.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.wf_current_faculty() IS
  'Canonical faculty for auth.uid(). Prefers auth_user_id; email fallback only when unique and auth_user_id is null.';

-- ---------------------------------------------------------------------------
-- A3 — Safe one-row auth_user_id link (never multi-match)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_link_faculty_auth_user_if_safe()
RETURNS public.faculty
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  match_count integer := 0;
  fac public.faculty;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO fac
  FROM public.faculty f
  WHERE f.auth_user_id::text = auth.uid()::text
  ORDER BY f.id
  LIMIT 1;
  IF FOUND THEN
    RETURN fac;
  END IF;

  IF jwt_email = '' THEN
    RETURN public.wf_current_faculty();
  END IF;

  SELECT count(*)::integer INTO match_count
  FROM public.faculty f
  WHERE f.auth_user_id IS NULL
    AND (
      lower(trim(coalesce(f.email, ''))) = jwt_email
      OR lower(trim(coalesce(f.existing_email, ''))) = jwt_email
    );

  IF match_count = 1 THEN
    UPDATE public.faculty f
    SET auth_user_id = auth.uid()
    WHERE f.auth_user_id IS NULL
      AND (
        lower(trim(coalesce(f.email, ''))) = jwt_email
        OR lower(trim(coalesce(f.existing_email, ''))) = jwt_email
      )
    RETURNING * INTO fac;
    RETURN fac;
  END IF;

  RETURN public.wf_current_faculty();
END;
$$;

-- ---------------------------------------------------------------------------
-- A5 — mfo_owns_faculty_id
-- NOTE: Further hardened in admin/014_mfo_child_table_rls_fix.sql
--       (removes wf_current_faculty indirection that broke child-table writes).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_owns_faculty_id(p_faculty_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_faculty_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.faculty f
       WHERE f.id = p_faculty_id
         AND (
           f.auth_user_id::text = auth.uid()::text
           OR (
             f.auth_user_id IS NULL
             AND nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
             AND (
               lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
               OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
             )
             AND (
               SELECT count(*)::integer
               FROM public.faculty f2
               WHERE f2.auth_user_id IS NULL
                 AND (
                   lower(trim(coalesce(f2.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
                   OR lower(trim(coalesce(f2.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
                 )
             ) = 1
           )
         )
     );
$$;

COMMENT ON FUNCTION public.mfo_owns_faculty_id(bigint) IS
  'True only when p_faculty_id is the authenticated user''s public.faculty.id.';

-- ---------------------------------------------------------------------------
-- A6 — mfo_ensure_faculty_packet (derive owner server-side)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_ensure_faculty_packet(
  p_faculty_id bigint DEFAULT NULL,
  p_task_id uuid DEFAULT NULL,
  p_report_config_id uuid DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_reporting_year integer DEFAULT NULL,
  p_quarter integer DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_period_label text DEFAULT NULL,
  p_academic_year text DEFAULT NULL,
  p_semester text DEFAULT NULL,
  p_submission_id uuid DEFAULT NULL
)
RETURNS public.mfo_packets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fac public.faculty;
  packet public.mfo_packets;
  dept text;
  owner_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  fac := public.wf_link_faculty_auth_user_if_safe();
  IF fac IS NULL OR fac.id IS NULL THEN
    RAISE EXCEPTION
      'No public.faculty row is linked to this login. Ask an administrator to set faculty.auth_user_id.'
      USING ERRCODE = '42501';
  END IF;

  owner_id := fac.id;

  IF p_faculty_id IS NOT NULL AND p_faculty_id IS DISTINCT FROM owner_id THEN
    RAISE EXCEPTION
      'Not allowed to create an MFO packet for another faculty member.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.mfo_owns_faculty_id(owner_id)
     AND NOT public.wf_is_final_approver() THEN
    RAISE EXCEPTION
      'Not allowed to create an MFO packet for this faculty identity.'
      USING ERRCODE = '42501';
  END IF;

  dept := nullif(btrim(coalesce(p_department, fac.department, '')), '');

  IF p_task_id IS NOT NULL THEN
    SELECT * INTO packet
    FROM public.mfo_packets
    WHERE faculty_id = owner_id
      AND task_id = p_task_id
    LIMIT 1;
    IF FOUND THEN
      RETURN packet;
    END IF;
  END IF;

  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL THEN
    SELECT * INTO packet
    FROM public.mfo_packets
    WHERE faculty_id = owner_id
      AND period_start = p_period_start
      AND period_end = p_period_end
    ORDER BY created_at DESC
    LIMIT 1;
    IF FOUND THEN
      IF p_task_id IS NOT NULL AND packet.task_id IS NULL THEN
        UPDATE public.mfo_packets
        SET task_id = p_task_id,
            submission_id = coalesce(p_submission_id, submission_id),
            report_config_id = coalesce(p_report_config_id, report_config_id)
        WHERE id = packet.id
        RETURNING * INTO packet;
      END IF;
      RETURN packet;
    END IF;
  END IF;

  INSERT INTO public.mfo_packets (
    task_id,
    report_config_id,
    faculty_id,
    department,
    reporting_year,
    quarter,
    period_start,
    period_end,
    period_label,
    academic_year,
    semester,
    packet_state,
    submission_id
  ) VALUES (
    p_task_id,
    p_report_config_id,
    owner_id,
    dept,
    p_reporting_year,
    p_quarter,
    p_period_start,
    p_period_end,
    p_period_label,
    p_academic_year,
    p_semester,
    'draft',
    p_submission_id
  )
  RETURNING * INTO packet;

  RETURN packet;
END;
$$;

COMMENT ON FUNCTION public.mfo_ensure_faculty_packet(
  bigint, uuid, uuid, text, integer, integer, date, date, text, text, text, uuid
) IS
  'Creates/resumes the signed-in faculty MFO packet. Owner is derived server-side; p_faculty_id must match or be null.';

CREATE OR REPLACE FUNCTION public.mfo_debug_ownership(p_faculty_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'sql_patch_version', public.mfo_sql_version(),
    'auth_uid', auth.uid(),
    'jwt_email', auth.jwt() ->> 'email',
    'requested_faculty_id', p_faculty_id,
    'owns_requested', CASE
      WHEN p_faculty_id IS NULL THEN null
      ELSE public.mfo_owns_faculty_id(p_faculty_id)
    END,
    'wf_current_faculty_id', (public.wf_current_faculty()).id,
    'is_final_approver', public.wf_is_final_approver(),
    'matched_faculty', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'email', f.email,
        'existing_email', f.existing_email,
        'auth_user_id', f.auth_user_id,
        'department', f.department
      ))
      FROM public.faculty f
      WHERE f.auth_user_id::text = auth.uid()::text
         OR (
           nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
           AND (
             lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
             OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
           )
         )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- A7 — Packet RLS (explicit ownership WITH CHECK)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS mfo_packets_select ON public.mfo_packets;
CREATE POLICY mfo_packets_select
ON public.mfo_packets
FOR SELECT TO authenticated
USING (public.mfo_can_select_packet(mfo_packets));

DROP POLICY IF EXISTS mfo_packets_insert ON public.mfo_packets;
CREATE POLICY mfo_packets_insert
ON public.mfo_packets
FOR INSERT TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR public.mfo_owns_faculty_id(faculty_id)
);

DROP POLICY IF EXISTS mfo_packets_update ON public.mfo_packets;
CREATE POLICY mfo_packets_update
ON public.mfo_packets
FOR UPDATE TO authenticated
USING (public.mfo_can_write_packet(mfo_packets))
WITH CHECK (public.mfo_can_write_packet(mfo_packets));

DROP POLICY IF EXISTS mfo_packets_delete ON public.mfo_packets;
CREATE POLICY mfo_packets_delete
ON public.mfo_packets
FOR DELETE TO authenticated
USING (public.wf_is_final_approver());

-- ---------------------------------------------------------------------------
-- B — Chairperson grant helpers (active + optional date bounds)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf_grant_belongs_to_faculty(
  grant_row public.wf_delegated_access,
  fac public.faculty
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grant_json jsonb;
  fac_json jsonb;
  fac_id text;
  fac_auth text;
  fac_name text;
  fac_email text;
BEGIN
  IF grant_row IS NULL OR fac IS NULL THEN
    RETURN false;
  END IF;

  grant_json := to_jsonb(grant_row);
  fac_json := to_jsonb(fac);
  fac_id := nullif(fac_json->>'id', '');
  fac_auth := nullif(fac_json->>'auth_user_id', '');
  fac_name := lower(trim(coalesce(fac_json->>'full_name', fac_json->>'name', '')));
  fac_email := lower(trim(coalesce(fac_json->>'email', fac_json->>'existing_email', '')));

  IF fac_id IS NOT NULL AND fac_id IN (
    grant_json->>'grantee_faculty_id',
    grant_json->>'faculty_id'
  ) THEN
    RETURN true;
  END IF;

  IF nullif(grant_json->>'grantee_auth_user_id', '') IS NOT NULL
     AND grant_json->>'grantee_auth_user_id' IN (
       coalesce(auth.uid()::text, ''),
       coalesce(fac_auth, '')
     ) THEN
    RETURN true;
  END IF;

  IF fac_email <> ''
     AND lower(trim(coalesce(grant_json->>'grantee_email', grant_json->>'email', ''))) = fac_email THEN
    RETURN true;
  END IF;

  IF fac_name <> ''
     AND lower(trim(coalesce(grant_json->>'grantee_name', ''))) = fac_name THEN
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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT grant_row IS NOT NULL
     AND fac IS NOT NULL
     AND coalesce((to_jsonb(grant_row)->>'is_active')::boolean, true) IS DISTINCT FROM false
     AND public.wf_grant_within_dates(grant_row)
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
     AND EXISTS (
       SELECT 1
       FROM public.wf_delegated_access d
       WHERE public.wf_grant_matches_faculty(d, fac)
     );
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

-- ---------------------------------------------------------------------------
-- B3 — Accurate chairperson visibility diagnostic (no sparse early return)
-- ---------------------------------------------------------------------------

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
  browse_count integer := 0;
  list_count integer := 0;
  reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'sql_patch_version', public.wf_chairperson_sql_version(),
      'auth_uid', null,
      'chair_id', null,
      'chair_auth_user_id', null,
      'chair_role', null,
      'chair_position', null,
      'chair_department', null,
      'authorized_departments', '[]'::jsonb,
      'is_chair_role', false,
      'has_grant', false,
      'matching_grant_count', 0,
      'total_submissions', 0,
      'table_visible_count', 0,
      'rpc_visible_count', 0,
      'empty_reason', 'no_auth',
      'empty_reason_detail', 'no authenticated Supabase session'
    );
  END IF;

  chair := public.wf_link_faculty_auth_user_if_safe();
  chair_dept := public.wf_faculty_department(chair);
  authorized := public.wf_chairperson_authorized_departments(chair);

  SELECT count(*)::integer INTO grant_count
  FROM public.wf_delegated_access d
  WHERE chair IS NOT NULL
    AND public.wf_grant_matches_faculty(d, chair);

  SELECT count(*)::integer INTO total_subs FROM public.wf_submissions;

  BEGIN
    SELECT count(*)::integer INTO browse_count
    FROM public.wf_submissions s
    WHERE public.wf_chairperson_can_browse_submission(s);
  EXCEPTION WHEN OTHERS THEN
    browse_count := 0;
  END;

  BEGIN
    SELECT count(*)::integer INTO list_count
    FROM public.wf_list_chairperson_submissions();
  EXCEPTION WHEN OTHERS THEN
    list_count := 0;
  END;

  reason := CASE
    WHEN chair IS NULL THEN 'no_faculty_row'
    WHEN grant_count = 0 THEN 'no_matching_grant'
    WHEN authorized IS NULL OR array_length(authorized, 1) IS NULL THEN 'empty_authorized_departments'
    WHEN total_subs = 0 THEN 'no_submissions_in_table'
    WHEN browse_count = 0 AND list_count = 0 THEN 'in_scope_join_returned_zero'
    ELSE 'ok'
  END;

  RETURN jsonb_build_object(
    'sql_patch_version', public.wf_chairperson_sql_version(),
    'auth_uid', auth.uid(),
    'chair_id', chair.id,
    'chair_auth_user_id', chair.auth_user_id,
    'chair_role', to_jsonb(chair)->>'role',
    'chair_position', to_jsonb(chair)->>'position',
    'chair_department', chair_dept,
    'authorized_departments', to_jsonb(authorized),
    'is_chair_role', public.wf_is_chairperson_role(chair),
    'has_grant', public.wf_has_active_chairperson_grant(chair),
    'matching_grant_count', grant_count,
    'total_submissions', total_subs,
    'table_visible_count', browse_count,
    'rpc_visible_count', list_count,
    'empty_reason', reason,
    'empty_reason_detail', CASE reason
      WHEN 'no_faculty_row' THEN 'authenticated but faculty not resolved'
      WHEN 'no_matching_grant' THEN 'faculty resolved but no active Chairperson grant'
      WHEN 'empty_authorized_departments' THEN 'grant exists but department scope failed'
      WHEN 'no_submissions_in_table' THEN 'no submissions exist in wf_submissions'
      WHEN 'in_scope_join_returned_zero' THEN 'grant exists but no in-scope Chairperson-required submissions'
      ELSE 'ok'
    END
  );
END;
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_within_dates(public.wf_delegated_access) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_link_faculty_auth_user_if_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_ensure_faculty_packet(
  bigint, uuid, uuid, text, integer, integer, date, date, text, text, text, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_debug_ownership(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_belongs_to_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_matches_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_has_active_chairperson_grant(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '013 applied: mfo_sql_version=% wf_chairperson_sql_version=%',
    public.mfo_sql_version(),
    public.wf_chairperson_sql_version();
END
$$;
