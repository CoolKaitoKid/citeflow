-- Finalize Chairperson/OIC access after later workflow patches may have
-- redefined wf_has_active_chairperson_grant with grant-only logic.
CREATE OR REPLACE FUNCTION public.wf_has_active_chairperson_grant(fac public.faculty)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fac IS NOT NULL
     AND (
       public.wf_is_chairperson_role(fac)
       OR EXISTS (
         SELECT 1
         FROM public.wf_delegated_access d
         WHERE public.wf_grant_matches_faculty(d, fac)
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.wf_current_user_has_chairperson_grant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_has_active_chairperson_grant(
    public.wf_current_faculty()
  );
$$;
