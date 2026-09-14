-- =============================================================================
-- CITE-Flow 025 — Chairperson queue can see submitted MFOs
--
-- Symptom:
--   Chairperson Review console:
--     submission: null
--     submission ID: null
--     submission IDs: []
--     files query result: []
--
-- Cause:
--   wf_list_chairperson_submissions() only returns rows whose task is linked
--   to a Chairperson-required wf_report_configs row AND whose submitter
--   faculty row joins on wf_submissions.faculty_id.
--   Unlinked MFO tasks (report_config_id IS NULL) make
--   wf_task_requires_chairperson() return false, so a submitted MFO never
--   enters the queue. A packet whose submission_id was not written after
--   submit is also invisible to the MFO reviewer route.
--
-- This script:
--   1) Re-applies the 024 MFO config link for unlinked MFO tasks only.
--   2) Backfills mfo_packets.submission_id from matching wf_submissions.
--   3) Rebuilds wf_list_chairperson_submissions() with the same authorization
--      rules (grant + department scope + requires_chairperson + no self-review)
--      plus a faculty join via mfo_packets when faculty_id alone does not
--      match, and excludes unsubmitted drafts.
--   4) Extends the visibility diagnostic with MFO-specific counts.
--
-- Does NOT disable RLS, use USING (true), overwrite existing report_config_id
-- values, or send Chairperson-required reports straight to Admin.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- After running: hard-refresh Faculty Submissions → Chairperson Review.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '025-mfo-chair-queue'::text;
$$;

-- ---------------------------------------------------------------------------
-- 1. Link unlinked MFO tasks (same safe rule as 024). No-op if 024 already ran.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  cfg_id uuid;
  linked_count integer := 0;
BEGIN
  IF to_regprocedure('public.mfo_ensure_mfo_chairperson_config()') IS NULL THEN
    RAISE NOTICE '025: mfo_ensure_mfo_chairperson_config() is missing. Run 024 first if MFO tasks are still unlinked.';
    RETURN;
  END IF;

  cfg_id := public.mfo_ensure_mfo_chairperson_config();

  UPDATE public.wf_tasks t
     SET report_config_id = cfg_id
   WHERE t.report_config_id IS NULL
     AND (
       t.title ILIKE '%mfo%'
       OR t.title ILIKE '%accomplishment%'
       OR t.title ILIKE '%major final output%'
       OR to_jsonb(t)::text ILIKE '%major final output%'
     );

  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RAISE NOTICE '025: linked % previously unlinked MFO task(s) to %.', linked_count, cfg_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Attach packets that were submitted but never received submission_id
-- ---------------------------------------------------------------------------

UPDATE public.mfo_packets p
   SET submission_id = s.id
  FROM public.wf_submissions s
 WHERE p.submission_id IS NULL
   AND p.task_id IS NOT NULL
   AND p.task_id = s.task_id
   AND p.faculty_id::text = s.faculty_id::text
   AND s.submitted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Authorized Chairperson queue
-- ---------------------------------------------------------------------------

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
  LEFT JOIN public.faculty f
    ON f.id::text = s.faculty_id::text
    OR f.auth_user_id::text = s.faculty_id::text
  LEFT JOIN public.mfo_packets p
    ON p.submission_id = s.id
    OR (p.task_id IS NOT NULL AND p.task_id = s.task_id AND p.faculty_id::text = s.faculty_id::text)
  LEFT JOIN public.faculty fp
    ON fp.id = p.faculty_id
  WHERE public.wf_task_requires_chairperson(s.task_id)
    AND s.submitted_at IS NOT NULL
    AND lower(coalesce(s.status::text, '')) NOT IN ('notsubmitted')
    AND coalesce(f.id, fp.id) IS NOT NULL
    AND public.wf_faculty_department(coalesce(f, fp)) = ANY (authorized)
    AND coalesce(f.id, fp.id) IS DISTINCT FROM chair.id
    AND (
      chair.auth_user_id IS NULL
      OR coalesce(f.auth_user_id, fp.auth_user_id) IS DISTINCT FROM chair.auth_user_id
    )
  ORDER BY s.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Visibility diagnostic — keep existing keys, add MFO counts
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
  unlinked_mfo integer := 0;
  submitted_mfo integer := 0;
  reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'sql_patch_version', public.wf_chairperson_sql_version(),
      'auth_uid', null,
      'chair_id', null,
      'has_grant', false,
      'total_submissions', 0,
      'rpc_visible_count', 0,
      'empty_reason', 'no_auth'
    );
  END IF;

  chair := public.wf_current_faculty();
  IF to_regprocedure('public.wf_link_faculty_auth_user_if_safe()') IS NOT NULL THEN
    chair := public.wf_link_faculty_auth_user_if_safe();
  END IF;
  chair_dept := public.wf_faculty_department(chair);
  authorized := public.wf_chairperson_authorized_departments(chair);

  SELECT count(*)::integer INTO grant_count
  FROM public.wf_delegated_access d
  WHERE chair IS NOT NULL
    AND public.wf_grant_matches_faculty(d, chair);

  SELECT count(*)::integer INTO total_subs FROM public.wf_submissions;

  SELECT count(*)::integer INTO unlinked_mfo
  FROM public.wf_tasks t
  WHERE t.report_config_id IS NULL
    AND (
      t.title ILIKE '%mfo%'
      OR t.title ILIKE '%accomplishment%'
      OR t.title ILIKE '%major final output%'
    );

  SELECT count(*)::integer INTO submitted_mfo
  FROM public.wf_submissions s
  JOIN public.wf_tasks t ON t.id = s.task_id
  WHERE s.submitted_at IS NOT NULL
    AND (
      t.title ILIKE '%mfo%'
      OR t.title ILIKE '%accomplishment%'
      OR t.title ILIKE '%major final output%'
      OR EXISTS (SELECT 1 FROM public.mfo_packets p WHERE p.submission_id = s.id)
    );

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
    WHEN submitted_mfo > 0 AND unlinked_mfo > 0 AND list_count = 0 THEN 'unlinked_mfo_tasks'
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
    'submitted_mfo_count', submitted_mfo,
    'unlinked_mfo_task_count', unlinked_mfo,
    'table_visible_count', browse_count,
    'rpc_visible_count', list_count,
    'empty_reason', reason,
    'empty_reason_detail', CASE reason
      WHEN 'no_faculty_row' THEN 'authenticated but faculty not resolved'
      WHEN 'no_matching_grant' THEN 'faculty resolved but no active Chairperson grant'
      WHEN 'empty_authorized_departments' THEN 'grant exists but department scope failed'
      WHEN 'no_submissions_in_table' THEN 'no submissions exist in wf_submissions'
      WHEN 'unlinked_mfo_tasks' THEN 'MFO was submitted but the task is not linked to a Chairperson wf_report_configs row'
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

GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT public.wf_chairperson_sql_version() AS wf_chairperson_sql_version;

SELECT
    t.id AS task_id,
    t.title,
    t.report_config_id,
    public.wf_task_requires_chairperson(t.id) AS requires_chairperson
FROM public.wf_tasks t
WHERE t.title ILIKE '%mfo%'
   OR t.title ILIKE '%accomplishment%'
   OR t.title ILIKE '%major final output%'
ORDER BY t.created_at DESC NULLS LAST
LIMIT 20;
