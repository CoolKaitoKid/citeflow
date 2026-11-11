-- =============================================================================
-- CITE-Flow 035 — Grant Administrator Role Workload Read & Management Permissions
--
-- Objective:
--   Update public.workload_is_dean_or_secretary() to recognize the 'Administrator'
--   role (in public.admin_profiles and public.faculty) alongside College Dean and
--   College Secretary, matching the trusted role check in commit_workload_import RPC
--   (migration 033).
--
-- Effect:
--   - Enables Administrators to SELECT all teaching loads in admin/workload-tracker.html
--     and admin/faculty-profiles.html (resolving the empty Workload Tracker issue).
--   - Preserves granular restrictions: Chairpersons can only see their departments,
--     and Faculty members can only see their own teaching loads.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.workload_is_dean_or_secretary()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.id = auth.uid()
      AND (
        (
          lower(trim(coalesce(ap.role, ''))) LIKE '%admin%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%chair%'
        )
        OR (
          lower(trim(coalesce(ap.role, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(ap.role, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%associate%'
        )
      )
  ) OR EXISTS (
    SELECT 1 FROM public.faculty f
    WHERE f.auth_user_id = auth.uid()
      AND (
        (
          (lower(trim(coalesce(f.role, ''))) LIKE '%admin%' OR lower(trim(coalesce(f.position, ''))) LIKE '%admin%')
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%chair%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%chair%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%faculty%'
        )
        OR (
          lower(trim(coalesce(f.role, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.role, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.position, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.position, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%associate%'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.workload_is_dean_or_secretary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workload_is_dean_or_secretary() TO authenticated;

