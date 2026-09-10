-- 018_fix_admin_final_approver.sql
--
-- "new row violates row-level security policy for table wf_delegated_access"
-- when an Admin uses Manage Access -> Grant Access.
--
-- The insert policy is:
--
--   CREATE POLICY "wf_delegated_access_admin_write"
--   ON public.wf_delegated_access FOR ALL TO authenticated
--   USING (public.wf_is_final_approver())
--   WITH CHECK (public.wf_is_final_approver());
--
-- So the error means exactly one thing: wf_is_final_approver() returned false
-- for the signed-in Admin. The policy is correct and is NOT changed here.
-- What follows identifies why the Admin is not being recognised, and repairs
-- the identity record rather than loosening the rule.
--
-- wf_is_final_approver() passes if ANY of these hold:
--   (1) an admin_profiles row where id = auth.uid() and role not like '%chair%'
--   (2) a faculty row matching auth.uid()/email, not a chairperson, whose
--       role or position is one of admin/administrator/dean/secretary/etc.
--   (3) JWT user_metadata.role in (admin, administrator, superadmin, dean)
--   (4) JWT user_metadata.role like '%secretary%'
--
-- The usual cause is (1) missing. CiteFlowAuth upserts admin_profiles inside a
-- try/catch that swallows failures, so an Admin whose upsert was ever blocked
-- has no row and no error was surfaced.

-- ===========================================================================
-- STEP 1 — DIAGNOSE. Read-only. Run in the Supabase SQL Editor.
--
-- Shows, for every auth user, which branch would pass. Find your Admin's
-- e-mail: if every branch column is false, that is why the grant fails.
-- ===========================================================================
SELECT
    u.id                                        AS auth_user_id,
    u.email,
    u.raw_user_meta_data ->> 'role'             AS jwt_role,
    (ap.id IS NOT NULL)                         AS has_admin_profile,
    ap.role                                     AS admin_profile_role,
    f.id                                        AS faculty_id,
    coalesce(f.role, f.position)                AS faculty_role,

    -- branch 1
    (ap.id IS NOT NULL
       AND lower(coalesce(ap.role, 'administrator')) NOT LIKE '%chair%')      AS branch1_admin_profile,
    -- branch 2
    (f.id IS NOT NULL
       AND public.wf_is_chairperson_role(f) IS DISTINCT FROM true
       AND lower(trim(coalesce(f.role, f.position, ''))) IN (
             'admin','administrator','dean','college secretary',
             'college_secretary','secretary','superadmin'))                   AS branch2_faculty_role,
    -- branches 3 and 4 (JWT)
    (lower(coalesce(u.raw_user_meta_data ->> 'role', '')) IN
        ('admin','administrator','superadmin','dean'))                        AS branch3_jwt_role,
    (lower(coalesce(u.raw_user_meta_data ->> 'role', '')) LIKE '%secretary%') AS branch4_jwt_secretary
FROM auth.users u
LEFT JOIN public.admin_profiles ap ON ap.id = u.id
LEFT JOIN public.faculty f
       ON f.auth_user_id = u.id
       OR lower(trim(coalesce(f.email, ''))) = lower(trim(u.email))
ORDER BY has_admin_profile, u.email;

-- ===========================================================================
-- STEP 2 — In-app confirmation, run as the actual signed-in Admin.
--
-- The SQL Editor runs as service_role where auth.uid() is NULL, so STEP 1
-- cannot prove what the Admin's own session sees. This function can.
-- After creating it, run in the Admin browser console:
--
--     await supabase.rpc('wf_debug_final_approver')
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.wf_debug_final_approver()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_email', auth.jwt() ->> 'email',
    'jwt_user_metadata_role', auth.jwt() -> 'user_metadata' ->> 'role',
    'has_admin_profile', EXISTS (
        SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()
    ),
    'admin_profile_role', (
        SELECT ap.role FROM public.admin_profiles ap WHERE ap.id = auth.uid()
    ),
    'branch1_admin_profile', EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.id = auth.uid()
          AND lower(coalesce(ap.role, 'administrator')) NOT LIKE '%chair%'
    ),
    'branch2_faculty_role', EXISTS (
        SELECT 1 FROM public.faculty f
        WHERE (f.auth_user_id = auth.uid()
           OR (nullif(lower(trim(coalesce(auth.jwt() ->> 'email',''))),'') IS NOT NULL
               AND lower(trim(coalesce(f.email,''))) = lower(trim(auth.jwt() ->> 'email'))))
          AND public.wf_is_chairperson_role(f) IS DISTINCT FROM true
          AND lower(trim(coalesce(f.role, f.position, ''))) IN (
                'admin','administrator','dean','college secretary',
                'college_secretary','secretary','superadmin')
    ),
    'is_final_approver', public.wf_is_final_approver()
  );
$$;

GRANT EXECUTE ON FUNCTION public.wf_debug_final_approver() TO authenticated;

-- ===========================================================================
-- STEP 3 — REPAIR. Give the Admin the identity record they should already
-- have. This does not touch any policy and grants nothing beyond recording
-- that this user is an administrator.
--
-- Replace the e-mail, then run. Safe to re-run: it updates instead of
-- duplicating, and it refuses to touch anyone whose role mentions "chair".
-- ===========================================================================
-- INSERT INTO public.admin_profiles (id, email, first_name, last_name, role, updated_at)
-- SELECT
--     u.id,
--     u.email,
--     coalesce(u.raw_user_meta_data ->> 'first_name', split_part(u.email, '@', 1)),
--     coalesce(u.raw_user_meta_data ->> 'last_name', ''),
--     'Administrator',
--     now()
-- FROM auth.users u
-- WHERE lower(u.email) = lower('<ADMIN_EMAIL_HERE>')
--   AND lower(coalesce(u.raw_user_meta_data ->> 'role', '')) NOT LIKE '%chair%'
-- ON CONFLICT (id) DO UPDATE
--   SET role = CASE
--         WHEN lower(coalesce(public.admin_profiles.role, '')) LIKE '%chair%'
--           THEN public.admin_profiles.role      -- never silently promote a chair
--         ELSE 'Administrator'
--       END,
--       updated_at = now();
--
-- Then re-check (expect is_final_approver = true):
--   SELECT * FROM public.admin_profiles WHERE lower(email) = lower('<ADMIN_EMAIL_HERE>');

-- ===========================================================================
-- SECURITY NOTE — please read before deciding how to fix.
--
-- Branches 3 and 4 of wf_is_final_approver() trust
-- auth.jwt() -> 'user_metadata' ->> 'role'. In Supabase, user_metadata is
-- writable by the user themselves:
--
--     await supabase.auth.updateUser({ data: { role: 'admin' } })
--
-- Any signed-in faculty member can therefore make wf_is_final_approver()
-- return true for their own session, which would let them write
-- wf_delegated_access, wf_tasks and wf_report_configs, and perform final
-- approvals. This is pre-existing and is NOT introduced by this file.
--
-- Repairing admin_profiles (STEP 3) is the correct fix for the reported error
-- and leaves that hole untouched. Closing the hole means dropping branches 3
-- and 4 so that admin identity comes only from admin_profiles and faculty —
-- server-controlled tables. That is deliberately left out of this script,
-- because any Admin currently relying on the JWT branch would lose access the
-- moment it runs. Confirm STEP 1 shows every Admin passing branch 1 or 2
-- first, then apply the tightening below.
-- ===========================================================================
-- CREATE OR REPLACE FUNCTION public.wf_is_final_approver()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
-- AS $$
--   SELECT
--     EXISTS (
--       SELECT 1 FROM public.admin_profiles ap
--       WHERE ap.id = auth.uid()
--         AND lower(coalesce(ap.role, 'administrator')) NOT LIKE '%chair%'
--     )
--     OR EXISTS (
--       SELECT 1 FROM public.faculty f
--       WHERE (f.auth_user_id = auth.uid()
--          OR (nullif(lower(trim(coalesce(auth.jwt() ->> 'email',''))),'') IS NOT NULL
--              AND lower(trim(coalesce(f.email,''))) = lower(trim(auth.jwt() ->> 'email'))))
--         AND public.wf_is_chairperson_role(f) IS DISTINCT FROM true
--         AND lower(trim(coalesce(f.role, f.position, ''))) IN (
--               'admin','administrator','dean','college secretary',
--               'college_secretary','secretary','superadmin')
--     );
-- $$;
