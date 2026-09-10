-- =============================================================================
-- SUPERSEDED by admin/013_mfo_faculty_chairperson_auth_fix.sql
-- Keep this file for history only. Prefer running 013 instead.
-- =============================================================================
-- CITE-Flow MFO — Faculty packet RLS fix (re-run OK / idempotent)
-- Required after Phase 1 (admin/mfo-structured-data.sql)
--
-- Symptom:
--   POST /rest/v1/mfo_packets → 403
--   "new row violates row-level security policy for table mfo_packets"
--
-- This script:
--   1) Hardens mfo_owns_faculty_id (auth_user_id OR email, with casts)
--   2) Recreates mfo_packets INSERT/SELECT/UPDATE policies
--   3) Adds SECURITY DEFINER RPC mfo_ensure_faculty_packet (safe owned insert)
--
-- Run once in Supabase SQL Editor, then hard-refresh the MFO page.
-- Do NOT re-run mfo-structured-data.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ownership helper
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
     AND (
       EXISTS (
         SELECT 1
         FROM public.faculty f
         WHERE f.id = p_faculty_id
           AND (
             f.auth_user_id::text = auth.uid()::text
             OR (
               nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
               AND (
                 lower(trim(coalesce(f.email, '')))
                   = lower(trim(auth.jwt() ->> 'email'))
                 OR lower(trim(coalesce(f.existing_email, '')))
                   = lower(trim(auth.jwt() ->> 'email'))
               )
             )
           )
       )
       OR (
         (public.wf_current_faculty()).id IS NOT NULL
         AND (public.wf_current_faculty()).id = p_faculty_id
       )
     );
$$;

COMMENT ON FUNCTION public.mfo_owns_faculty_id(bigint) IS
  'True when p_faculty_id belongs to the signed-in user (faculty.auth_user_id/email or wf_current_faculty).';

GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Recreate packet policies (explicit WITH CHECK on insert)
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
-- 3) SECURITY DEFINER ensure-packet (bypasses RLS after ownership check)
--    Frontend should prefer this over a raw insert.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_ensure_faculty_packet(
  p_faculty_id bigint,
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Heal common data issue: faculty row matches email but auth_user_id was never linked.
  UPDATE public.faculty f
  SET auth_user_id = auth.uid()
  WHERE f.id = p_faculty_id
    AND f.auth_user_id IS NULL
    AND nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
    AND (
      lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
      OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
    );

  IF NOT public.mfo_owns_faculty_id(p_faculty_id)
     AND NOT public.wf_is_final_approver() THEN
    RAISE EXCEPTION
      'Not allowed to create MFO packet for faculty_id=% (auth.uid=%). Link public.faculty.auth_user_id to your login.',
      p_faculty_id, auth.uid()
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO fac FROM public.faculty WHERE id = p_faculty_id;
  IF fac IS NULL THEN
    RAISE EXCEPTION 'faculty_id % not found in public.faculty', p_faculty_id;
  END IF;

  dept := nullif(btrim(coalesce(p_department, fac.department, '')), '');

  IF p_task_id IS NOT NULL THEN
    SELECT * INTO packet
    FROM public.mfo_packets
    WHERE faculty_id = p_faculty_id
      AND task_id = p_task_id
    LIMIT 1;
    IF FOUND THEN
      RETURN packet;
    END IF;
  END IF;

  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL THEN
    SELECT * INTO packet
    FROM public.mfo_packets
    WHERE faculty_id = p_faculty_id
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
    p_faculty_id,
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
  'Creates or resumes the faculty MFO packet for the signed-in owner. SECURITY DEFINER after ownership check.';

GRANT EXECUTE ON FUNCTION public.mfo_ensure_faculty_packet(
  bigint, uuid, uuid, text, integer, integer, date, date, text, text, text, uuid
) TO authenticated;

-- Optional diagnostic (returns whether current user owns a faculty id)
CREATE OR REPLACE FUNCTION public.mfo_debug_ownership(p_faculty_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'jwt_email', auth.jwt() ->> 'email',
    'faculty_id', p_faculty_id,
    'owns', public.mfo_owns_faculty_id(p_faculty_id),
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
         OR lower(trim(coalesce(f.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
         OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfo_debug_ownership(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'MFO RLS fix applied: ownership + mfo_ensure_faculty_packet RPC.';
END
$$;
