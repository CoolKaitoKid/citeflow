-- 017_chairperson_visibility_rule.sql
--
-- Enforces the Chairperson task-visibility rule:
--
--     REQUIRED BY WORKFLOW + GRANTED BY ADMIN + WITHIN GRANTED SCOPE
--     = visible to that Chairperson for review
--
-- Additive and narrowing only. No policy is widened, no USING (true), no
-- WITH CHECK (true), nothing is dropped, and no data is modified.
--
-- WHAT WAS ALREADY CORRECT (verified in 011 / 013, left untouched):
--
--   Condition 1  wf_task_requires_chairperson(task_id) resolves the flag from
--                wf_tasks.report_config_id -> wf_report_configs.
--                                             requires_chairperson_review
--   Condition 2  wf_has_active_chairperson_grant(fac) requires a matching
--                wf_delegated_access row that is active and within its dates.
--                Role alone is deliberately NOT sufficient — the grant is the
--                door, so a temporary OIC works and a titled Chairperson with
--                no grant does not.
--   Condition 3  wf_chairperson_authorized_departments(fac) reads the grant's
--                department_codes, and wf_chairperson_in_scope() requires the
--                submitter's department to be in that list.
--
--   wf_chairperson_can_browse_submission() = in_scope AND requires_chairperson,
--   and wf_list_chairperson_submissions() applies the same pair. So conditions
--   1, 2 and 3 are already AND-ed server-side.
--
-- WHAT THIS FILE ADDS
--
--   1. Self-review exclusion. A Chairperson holding a grant over their own
--      department satisfied every condition above for their OWN submissions,
--      so they could review themselves. Now excluded.
--   2. wf_submission_needs_chairperson_grant() so the UI can state plainly
--      that a submission is waiting on an Admin access grant (Case B) instead
--      of silently showing an empty queue.

-- ---------------------------------------------------------------------------
-- 1. Self-review exclusion.
--
--    Identical to the 011 definition except for the added check that the
--    submitter is not the Chairperson. Narrowing only.
-- ---------------------------------------------------------------------------
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

  -- No self-review, regardless of grant scope.
  IF submitter.id::text = chair.id::text
     OR (
       chair.auth_user_id IS NOT NULL
       AND submitter.auth_user_id::text = chair.auth_user_id::text
     ) THEN
    RETURN false;
  END IF;

  submitter_dept := public.wf_faculty_department(submitter);
  IF submitter_dept = '' THEN
    RETURN false;
  END IF;

  RETURN submitter_dept = ANY (authorized);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Case B support: which departments actually have an authorized
--    Chairperson, so the UI can name the missing grant.
-- ---------------------------------------------------------------------------

-- Departments a single grant covers: its explicit department_codes, or the
-- grantee's own department when the grant lists none.
CREATE OR REPLACE FUNCTION public.wf_grant_departments(grant_row public.wf_delegated_access)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  codes text[];
  grantee public.faculty;
BEGIN
  IF grant_row IS NULL THEN
    RETURN '{}';
  END IF;

  SELECT coalesce(array_agg(DISTINCT public.wf_normalize_dept(code)), '{}')
    INTO codes
  FROM unnest(coalesce(grant_row.department_codes, '{}')) AS code
  WHERE public.wf_normalize_dept(code) <> '';

  IF codes IS NOT NULL AND array_length(codes, 1) > 0 THEN
    RETURN codes;
  END IF;

  SELECT f.* INTO grantee
    FROM public.faculty f
   WHERE public.wf_grant_belongs_to_faculty(grant_row, f)
   LIMIT 1;

  IF grantee IS NULL OR public.wf_faculty_department(grantee) = '' THEN
    RETURN '{}';
  END IF;

  RETURN ARRAY[public.wf_faculty_department(grantee)];
END;
$$;

CREATE OR REPLACE FUNCTION public.wf_department_has_chairperson_grant(p_dept text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_normalize_dept(p_dept) <> ''
     AND EXISTS (
       SELECT 1
       FROM public.wf_delegated_access d
       WHERE coalesce((to_jsonb(d)->>'is_active')::boolean, true) IS DISTINCT FROM false
         AND public.wf_grant_within_dates(d)
         AND public.wf_normalize_dept(p_dept) = ANY (public.wf_grant_departments(d))
     );
$$;

/*
 * True when a submission requires Chairperson review but no Admin grant covers
 * the submitter's department. This is Case B: the submission must not fall
 * through to the final approver, so it waits, and the UI uses this to say why.
 */
CREATE OR REPLACE FUNCTION public.wf_submission_needs_chairperson_grant(sub public.wf_submissions)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  submitter public.faculty;
BEGIN
  IF sub IS NULL OR NOT public.wf_task_requires_chairperson(sub.task_id) THEN
    RETURN false;
  END IF;

  SELECT f.* INTO submitter
    FROM public.faculty f
   WHERE f.id::text = sub.faculty_id::text
      OR f.auth_user_id::text = sub.faculty_id::text
   LIMIT 1;

  IF submitter IS NULL THEN
    RETURN false;
  END IF;

  RETURN NOT public.wf_department_has_chairperson_grant(
    public.wf_faculty_department(submitter)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wf_grant_departments(public.wf_delegated_access) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_department_has_chairperson_grant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_submission_needs_chairperson_grant(public.wf_submissions) TO authenticated;

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '017-chair-visibility'::text;
$$;
