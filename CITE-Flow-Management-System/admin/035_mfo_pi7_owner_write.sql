-- =============================================================================
-- CITE-Flow 035 — Faculty can insert their own MFO child rows (PI7 and siblings)
--
-- Symptom:
--   INSERT into mfo_pi7_trainings → 42501
--   "new row violates row-level security policy for table mfo_pi7_trainings"
--   Save and Submit stop on the first new training row.
--
-- Cause:
--   mfo_owns_faculty_id() compared the packet owner to wf_current_faculty().id.
--   That helper can be null or a different faculty row even when
--   faculty.auth_user_id = auth.uid(). Child-row policies call that check, so
--   the signed-in faculty cannot insert into their own packet.
--
-- This script:
--   1) Restores ownership as auth.uid() → faculty.auth_user_id → faculty.id.
--      Email fallback only when auth_user_id is null and the email is unique.
--   2) Restores mfo_can_write_child_row so a faculty member can write a child
--      row only when they can write that packet AND the row's faculty_id is
--      empty or equal to the packet owner. A Chairperson still cannot write
--      another faculty member's PI7 rows. Program-packet rows (PI1/PI2) stay
--      on mfo_can_write_program_packet.
--   3) Recreates SELECT/INSERT/UPDATE/DELETE on the faculty MFO child tables
--      used by the form. No USING (true) or WITH CHECK (true). RLS stays on.
--
-- Run in the Supabase SQL Editor for project: uforealazougjckepggc
-- Then hard-refresh the MFO page and submit again.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '035-mfo-pi7-owner-write'::text;
$$;

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

COMMENT ON FUNCTION public.mfo_owns_faculty_id(bigint) IS
  'True only when p_faculty_id is the authenticated user''s public.faculty.id.';

-- A composite "IS NOT NULL" is true only when every column is non-null.
-- Keep the id check so re-running this file does not undo 036.
CREATE OR REPLACE FUNCTION public.mfo_can_write_packet(p public.mfo_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.mfo_owns_faculty_id(p.faculty_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_write_child_row(
  p_packet_id uuid,
  p_program_packet_id uuid,
  p_faculty_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pack public.mfo_packets;
BEGIN
  IF p_packet_id IS NOT NULL THEN
    SELECT *
    INTO pack
    FROM public.mfo_packets
    WHERE id = p_packet_id;

    IF pack IS NULL OR NOT public.mfo_can_write_row(p_packet_id, NULL) THEN
      RETURN false;
    END IF;

    IF p_faculty_id IS NOT NULL
       AND pack.faculty_id IS NOT NULL
       AND p_faculty_id <> pack.faculty_id THEN
      RETURN false;
    END IF;

    RETURN true;
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    RETURN public.mfo_can_write_row(NULL, p_program_packet_id);
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_child_row(uuid, uuid, bigint) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.mfo_can_write_row(uuid,uuid)') IS NULL
     OR to_regprocedure('public.mfo_can_select_row(uuid,uuid)') IS NULL
     OR to_regprocedure('public.wf_is_final_approver()') IS NULL THEN
    RAISE EXCEPTION
      '035 requires mfo_can_write_row, mfo_can_select_row, and wf_is_final_approver. Do not continue.';
  END IF;
END
$$;

DO $$
DECLARE
  t text;
  pol record;
  child_tables text[] := ARRAY[
    'mfo_pi3_enrollment',
    'mfo_pi4_syllabus',
    'mfo_pi5_certifications',
    'mfo_pi6_postgraduate',
    'mfo_pi7_trainings',
    'mfo_pi8_instructional_materials',
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
  has_prog boolean;
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'program_packet_id'
    ) INTO has_prog;

    IF has_prog THEN
      EXECUTE format(
        'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id)) WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))',
        t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id)) WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))',
        t
      );
      EXECUTE format(
        'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))',
        t
      );
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

SELECT public.mfo_sql_version() AS mfo_sql_version;
