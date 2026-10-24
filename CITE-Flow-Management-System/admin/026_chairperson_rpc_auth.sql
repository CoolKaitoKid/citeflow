-- =============================================================================
-- CITE-Flow 026 — Chairperson RPCs must run as the signed-in user
--
-- Symptom after 025:
--   empty_reason = no_auth
--   auth_uid = null
--   sql_patch_version = 025-mfo-chair-queue
--
-- Cause:
--   PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
--   If the browser call arrives without a user JWT (anon role),
--   wf_debug_chairperson_visibility() still runs and reports no_auth.
--   The UI then said "No authorized submissions" even though the person
--   was signed in and the real problem was a missing Authorization header.
--
-- This script:
--   1) Revokes PUBLIC/anon execute on Chairperson queue/debug functions.
--   2) Re-grants execute to authenticated only.
--   3) Keeps the same visibility rules (grant + department + Chairperson
--      required). Does not disable RLS.
--
-- Run after 025 in project: uforealazougjckepggc
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.wf_chairperson_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '026-chair-rpc-auth'::text;
$$;

REVOKE ALL ON FUNCTION public.wf_list_chairperson_submissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_list_chairperson_submissions() FROM anon;
REVOKE ALL ON FUNCTION public.wf_debug_chairperson_visibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_debug_chairperson_visibility() FROM anon;
REVOKE ALL ON FUNCTION public.wf_debug_chairperson_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_debug_chairperson_queue() FROM anon;
REVOKE ALL ON FUNCTION public.wf_current_user_has_chairperson_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_current_user_has_chairperson_grant() FROM anon;
REVOKE ALL ON FUNCTION public.wf_chairperson_sql_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_chairperson_sql_version() FROM anon;

GRANT EXECUTE ON FUNCTION public.wf_list_chairperson_submissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_debug_chairperson_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_current_user_has_chairperson_grant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_chairperson_sql_version() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT public.wf_chairperson_sql_version() AS wf_chairperson_sql_version;
