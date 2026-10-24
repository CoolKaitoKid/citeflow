-- =============================================================================
-- CITE-Flow: Consolidated Fix for MFO Child Table RLS (Error 42501)
-- 
-- Run this script in your Supabase SQL Editor (Project: uforealazougjckepggc):
-- https://supabase.com/dashboard/project/uforealazougjckepggc/sql
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- 1. Sync public.faculty.auth_user_id with auth.users based on email
UPDATE public.faculty f
SET auth_user_id = u.id
FROM auth.users u
WHERE (
    lower(trim(coalesce(f.email, ''))) = lower(trim(coalesce(u.email, '')))
    OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(coalesce(u.email, '')))
  )
  AND (f.auth_user_id IS NULL OR f.auth_user_id <> u.id);

-- 2. Backfill faculty_id on all child tables from their parent mfo_packets
DO $$
DECLARE
  t text;
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
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I c
         SET faculty_id = p.faculty_id
         FROM public.mfo_packets p
         WHERE c.packet_id = p.id
           AND (c.faculty_id IS NULL OR c.faculty_id <> p.faculty_id)',
        t
      );
    END IF;
  END LOOP;
END;
$$;

-- 3. Robust ownership verification (matches auth.uid OR matching JWT email)
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
             nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '') IS NOT NULL
             AND (
               lower(trim(coalesce(f.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
               OR lower(trim(coalesce(f.existing_email, ''))) = lower(trim(auth.jwt() ->> 'email'))
             )
           )
         )
     );
$$;

-- 4. Packet write permission
CREATE OR REPLACE FUNCTION public.mfo_can_write_packet(p public.mfo_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p IS NOT NULL
     AND (
       public.wf_is_final_approver()
       OR public.mfo_owns_faculty_id(p.faculty_id)
     );
$$;

-- 5. Row write permission
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
    SELECT * INTO pack
    FROM public.mfo_packets
    WHERE id = p_packet_id;
    RETURN public.mfo_can_write_packet(pack);
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    SELECT * INTO prog
    FROM public.mfo_program_packets
    WHERE id = p_program_packet_id;
    RETURN public.mfo_can_write_program_packet(prog);
  END IF;

  RETURN false;
END;
$$;

-- 6. Child row write permission (safe: checks packet ownership and non-conflicting faculty)
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

    IF p_faculty_id IS NOT NULL AND pack.faculty_id IS NOT NULL AND p_faculty_id <> pack.faculty_id THEN
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

-- 7. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_child_row(uuid, uuid, bigint) TO authenticated;

-- 8. Apply RLS policies to mfo_packets
ALTER TABLE public.mfo_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_packets_select ON public.mfo_packets;
DROP POLICY IF EXISTS mfo_packets_insert ON public.mfo_packets;
DROP POLICY IF EXISTS mfo_packets_update ON public.mfo_packets;
DROP POLICY IF EXISTS mfo_packets_delete ON public.mfo_packets;

CREATE POLICY mfo_packets_select ON public.mfo_packets
FOR SELECT TO authenticated
USING (public.mfo_can_select_packet(mfo_packets));

CREATE POLICY mfo_packets_insert ON public.mfo_packets
FOR INSERT TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR public.mfo_owns_faculty_id(faculty_id)
);

CREATE POLICY mfo_packets_update ON public.mfo_packets
FOR UPDATE TO authenticated
USING (public.mfo_can_write_packet(mfo_packets))
WITH CHECK (public.mfo_can_write_packet(mfo_packets));

CREATE POLICY mfo_packets_delete ON public.mfo_packets
FOR DELETE TO authenticated
USING (public.wf_is_final_approver());

-- 9. Apply RLS policies to mfo_section_status
ALTER TABLE public.mfo_section_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_section_status_select ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_section_status_insert ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_section_status_update ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_section_status_delete ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_section_status;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_section_status;

CREATE POLICY mfo_section_status_select ON public.mfo_section_status
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_insert ON public.mfo_section_status
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_update ON public.mfo_section_status
FOR UPDATE TO authenticated
USING (public.mfo_can_write_row(packet_id, program_packet_id))
WITH CHECK (public.mfo_can_write_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_delete ON public.mfo_section_status
FOR DELETE TO authenticated
USING (public.mfo_can_write_row(packet_id, program_packet_id));

-- 10. Recreate policies on all child tables safely
DO $$
DECLARE
  t text;
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
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS mfo_insert_authorized ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS mfo_update_authorized ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS mfo_delete_authorized ON public.%I', t);

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'program_packet_id'
      ) INTO has_prog;

      IF has_prog THEN
        EXECUTE format(
          'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id)) WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))', t
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_insert_authorized ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_update_authorized ON public.%I FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id)) WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))', t
        );
        EXECUTE format(
          'CREATE POLICY mfo_delete_authorized ON public.%I FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))', t
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
