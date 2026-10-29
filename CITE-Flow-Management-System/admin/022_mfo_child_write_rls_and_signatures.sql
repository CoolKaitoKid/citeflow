-- =============================================================================
-- CITE-Flow 022 — MFO child-table write RLS + electronic signature columns
--
-- Symptom:
--   INSERT into mfo_pi7_trainings → 42501 / HTTP 403
--   "new row violates row-level security policy"
--   Electronic signature columns are missing on mfo_packets.
--   Migration 019 is Storage RLS for faculty-accomplishments, not signatures.
--
-- Cause:
--   Child writes use mfo_can_write_row → mfo_owns_faculty_id(packet.faculty_id).
--   The original 012 helper compared p_faculty_id to (wf_current_faculty()).id,
--   which can fail even when faculty.auth_user_id = auth.uid().
--   014 / 021 replace that helper; they may not be applied live.
--
-- This script:
--   1) Re-applies the 014 ownership helpers (auth.uid() → faculty.auth_user_id
--      → faculty.id). Email fallback only when auth_user_id is null and unique.
--   2) Recreates SELECT / INSERT / UPDATE / DELETE on all existing MFO child
--      tables. Faculty write their own packet. Final approvers keep write
--      access. Chairperson browse stays on SELECT via mfo_can_select_packet.
--   3) Adds the three electronic-signature columns the faculty MFO page
--      already reads and writes: signature_data_url, signature_name,
--      signature_signed_at.
--
-- Safe / idempotent. Does NOT disable RLS. Does NOT use USING (true) or
-- WITH CHECK (true). Does NOT change public.faculty.id. Does NOT edit 019.
-- Does NOT change wf_report_configs / wf_submissions / approval stages.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- After running: hard-refresh the MFO page and retry Save / Submit.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '022-mfo-child-rls-signatures'::text;
$$;

-- ---------------------------------------------------------------------------
-- Ownership: faculty.id owned by the signed-in auth user
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
-- Recreate child policies (no open policies)
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
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping %: table not present.', t;
      CONTINUE;
    END IF;

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
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping %: table not present.', t;
      CONTINUE;
    END IF;

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

-- ---------------------------------------------------------------------------
-- Electronic signature columns expected by faculty/mfo-report.js
-- ---------------------------------------------------------------------------

ALTER TABLE public.mfo_packets
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signature_name text,
  ADD COLUMN IF NOT EXISTS signature_signed_at timestamptz;

COMMENT ON COLUMN public.mfo_packets.signature_data_url IS
  'PNG data URL of the faculty electronic signature. Added by 022; 019 is Storage RLS.';
COMMENT ON COLUMN public.mfo_packets.signature_name IS
  'Printed name stored with the electronic signature.';
COMMENT ON COLUMN public.mfo_packets.signature_signed_at IS
  'UTC timestamp when the electronic signature was applied.';

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_debug_write_access(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '022 applied: mfo_sql_version=% — child write RLS + signature columns.', public.mfo_sql_version();
END
$$;
