-- =============================================================================
-- RUN THIS IN THE SAME SUPABASE PROJECT THE APP USES:
--   https://supabase.com/dashboard/project/uforealazougjckepggc/sql
-- Project ref must be: uforealazougjckepggc
-- Then hard-refresh Chairperson Review (Ctrl+F5).
-- =============================================================================
-- Success check in SQL Editor Notices:
--   FIX applied. sql_patch_version=011-chair-queue
-- Success check in the browser console:
--   sql_version: "011-chair-queue"
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '011-chair-queue'::text;
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
     AND public.wf_grant_belongs_to_faculty(grant_row, fac);
$$;

CREATE OR REPLACE FUNCTION public.wf_has_active_chairperson_grant(fac public.faculty)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fac_json jsonb;
  fac_id text;
  fac_auth text;
  fac_name text;
  fac_email text;
BEGIN
  IF fac IS NULL THEN
    RETURN false;
  END IF;

  fac_json := to_jsonb(fac);
  fac_id := nullif(fac_json->>'id', '');
  fac_auth := nullif(fac_json->>'auth_user_id', '');
  fac_name := lower(trim(coalesce(fac_json->>'full_name', fac_json->>'name', '')));
  fac_email := lower(trim(coalesce(fac_json->>'email', fac_json->>'existing_email', '')));

  RETURN EXISTS (
    SELECT 1
    FROM public.wf_delegated_access d
    WHERE coalesce((to_jsonb(d)->>'is_active')::boolean, true) IS DISTINCT FROM false
      AND (
        (fac_id IS NOT NULL AND fac_id IN (to_jsonb(d)->>'grantee_faculty_id', to_jsonb(d)->>'faculty_id'))
        OR (
          nullif(to_jsonb(d)->>'grantee_auth_user_id', '') IS NOT NULL
          AND to_jsonb(d)->>'grantee_auth_user_id' IN (
            coalesce(auth.uid()::text, ''),
            coalesce(fac_auth, '')
          )
        )
        OR (
          fac_email <> ''
          AND lower(trim(coalesce(to_jsonb(d)->>'grantee_email', to_jsonb(d)->>'email', ''))) = fac_email
        )
        OR (
          fac_name <> ''
          AND lower(trim(coalesce(to_jsonb(d)->>'grantee_name', ''))) = fac_name
        )
      )
  );
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
  browse_count integer := 0;
  list_count integer := 0;
BEGIN
  chair := public.wf_current_faculty();
  chair_dept := public.wf_faculty_department(chair);

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

  RETURN jsonb_build_object(
    'sql_patch_version', '011-chair-queue',
    'auth_uid', auth.uid(),
    'chair_id', chair.id,
    'chair_auth_user_id', chair.auth_user_id,
    'chair_role', to_jsonb(chair)->>'role',
    'chair_position', to_jsonb(chair)->>'position',
    'chair_department', chair_dept,
    'is_chair_role', public.wf_is_chairperson_role(chair),
    'has_grant', public.wf_has_active_chairperson_grant(chair),
    'matching_grant_count', grant_count,
    'total_submissions', total_subs,
    'table_visible_count', browse_count,
    'rpc_visible_count', list_count,
    'empty_reason', CASE
      WHEN auth.uid() IS NULL THEN 'no_auth'
      WHEN chair IS NULL THEN 'no_faculty_row'
      WHEN grant_count = 0 THEN 'no_matching_grant'
      WHEN coalesce(chair_dept, '') = '' THEN 'empty_department'
      WHEN total_subs = 0 THEN 'no_submissions_in_table'
      WHEN browse_count = 0 AND list_count = 0 THEN 'in_scope_join_returned_zero'
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

GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wf_is_chairperson_role(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_belongs_to_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_grant_matches_faculty(public.wf_delegated_access, public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_has_active_chairperson_grant(public.faculty) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  fac public.faculty;
  grant_n integer := 0;
BEGIN
  SELECT f.* INTO fac
  FROM public.faculty f
  WHERE f.id = 90
     OR f.auth_user_id = '1b0c5793-863f-4faa-8a1f-cce8b49067af'
  ORDER BY CASE WHEN f.id = 90 THEN 0 ELSE 1 END
  LIMIT 1;

  IF fac IS NULL THEN
    RAISE NOTICE 'FIX applied. Faculty id 90 was not found.';
    RETURN;
  END IF;

  SELECT count(*)::integer INTO grant_n
  FROM public.wf_delegated_access d
  WHERE public.wf_grant_matches_faculty(d, fac);

  RAISE NOTICE 'FIX applied. sql_patch_version=011-chair-queue ella_id=% is_chair=% has_grant=% matching_grants=% version=%',
    fac.id,
    public.wf_is_chairperson_role(fac),
    public.wf_has_active_chairperson_grant(fac),
    grant_n,
    public.wf_chairperson_sql_version();
END $$;
