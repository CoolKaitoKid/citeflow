-- =============================================================================
-- CITE-Flow 014 — MFO child-table write RLS fix
--
-- Symptom:
--   INSERT into mfo_pi5_certifications (and other MFO child tables) → 42501
--   "new row violates row-level security policy"
--
-- Cause:
--   Child writes use mfo_can_write_row → mfo_owns_faculty_id.
--   Ownership previously also required (wf_current_faculty()).id = faculty_id,
--   which can fail even when the packet is clearly owned via auth_user_id.
--
-- This script:
--   1) Simplifies mfo_owns_faculty_id to a direct faculty.auth_user_id/email check
--   2) Hardens mfo_can_write_packet / mfo_can_write_row
--   3) Recreates child-table SELECT/INSERT/UPDATE/DELETE policies
--
-- Safe / idempotent. Does NOT disable RLS. Does NOT use USING (true).
-- Does NOT change public.faculty.id type. Does NOT use wf_faculty.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- After running: hard-refresh MFO and retry Save/Submit.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '014-mfo-child-rls'::text;
$$;

-- ---------------------------------------------------------------------------
-- Ownership: direct faculty match only (no wf_current_faculty indirection)
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

CREATE OR REPLACE FUNCTION public.mfo_can_write_packet(p public.mfo_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.mfo_owns_faculty_id(p.faculty_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_write_row(
  p_packet_id uuid,
  p_program_packet_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pack public.mfo_packets;
  prog public.mfo_program_packets;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_packet_id IS NOT NULL THEN
    SELECT * INTO pack FROM public.mfo_packets WHERE id = p_packet_id;
    IF pack IS NULL THEN
      RETURN false;
    END IF;
    RETURN public.mfo_can_write_packet(pack);
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    SELECT * INTO prog FROM public.mfo_program_packets WHERE id = p_program_packet_id;
    IF prog IS NULL THEN
      RETURN false;
    END IF;
    RETURN public.mfo_can_write_program_packet(prog);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_select_row(
  p_packet_id uuid,
  p_program_packet_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pack public.mfo_packets;
  prog public.mfo_program_packets;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_packet_id IS NOT NULL THEN
    SELECT * INTO pack FROM public.mfo_packets WHERE id = p_packet_id;
    IF pack IS NULL THEN
      RETURN false;
    END IF;
    RETURN public.mfo_can_select_packet(pack);
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    SELECT * INTO prog FROM public.mfo_program_packets WHERE id = p_program_packet_id;
    IF prog IS NULL THEN
      RETURN false;
    END IF;
    RETURN public.mfo_can_select_program_packet(prog);
  END IF;

  RETURN false;
END;
$$;

-- Optional diagnostic for child-write failures
CREATE OR REPLACE FUNCTION public.mfo_debug_write_access(p_packet_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pack public.mfo_packets;
BEGIN
  IF p_packet_id IS NOT NULL THEN
    SELECT * INTO pack FROM public.mfo_packets WHERE id = p_packet_id;
  END IF;

  RETURN jsonb_build_object(
    'sql_patch_version', public.mfo_sql_version(),
    'auth_uid', auth.uid(),
    'packet_id', p_packet_id,
    'packet_faculty_id', pack.faculty_id,
    'owns_packet_faculty', public.mfo_owns_faculty_id(pack.faculty_id),
    'can_write_packet', public.mfo_can_write_packet(pack),
    'can_write_row', public.mfo_can_write_row(p_packet_id, NULL),
    'wf_current_faculty_id', (public.wf_current_faculty()).id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Recreate child policies (separate INSERT/UPDATE/DELETE; no open policies)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  dual text[] := ARRAY[
    'mfo_section_status',
    'mfo_pi3_enrollment',
    'mfo_pi4_syllabus',
    'mfo_research_utilized',
    'mfo_research_completed',
    'mfo_research_published',
    'mfo_research_presented',
    'mfo_extension_partnerships',
    'mfo_extension_trainings',
    'mfo_other_initiatives',
    'mfo_awards',
    'mfo_documentation_items'
  ];
  faculty_only text[] := ARRAY[
    'mfo_pi5_certifications',
    'mfo_pi6_postgraduate',
    'mfo_pi7_trainings',
    'mfo_pi8_instructional_materials'
  ];
BEGIN
  FOREACH t IN ARRAY dual LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_insert_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_update_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_delete_authorized ON public.%I', t);

    EXECUTE format(
      'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(%I.packet_id, %I.program_packet_id))',
      t, t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id))',
      t, t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id)) WITH CHECK (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id))',
      t, t, t, t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id))',
      t, t, t
    );
  END LOOP;

  FOREACH t IN ARRAY faculty_only LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_insert_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_update_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_delete_authorized ON public.%I', t);

    EXECUTE format(
      'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(%I.packet_id, NULL))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_row(%I.packet_id, NULL))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_row(%I.packet_id, NULL)) WITH CHECK (public.mfo_can_write_row(%I.packet_id, NULL))',
      t, t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_row(%I.packet_id, NULL))',
      t, t
    );
  END LOOP;
END
$$;

-- Keep packet policies aligned with simplified ownership
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

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_debug_write_access(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '014 applied: mfo_sql_version=% — child-table write RLS fixed.', public.mfo_sql_version();
END
$$;
