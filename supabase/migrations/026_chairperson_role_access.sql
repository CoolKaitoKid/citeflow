-- Treat an actual Chairperson role as workflow access while preserving
-- Admin-granted OIC access for faculty without that role.
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
