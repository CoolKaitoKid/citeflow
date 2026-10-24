-- CITE-Flow 030 — Targeted MFO child-row write reconciliation
--
-- This migration repairs the deployed child-write mismatch without
-- enumerating pg_policies or using dynamic SQL. It only addresses tables
-- whose rows can belong to an mfo_packets parent.

DO $$
BEGIN
  IF to_regprocedure('public.mfo_can_write_row(uuid,uuid)') IS NULL
     OR to_regprocedure('public.mfo_can_write_packet(public.mfo_packets)') IS NULL
     OR to_regprocedure('public.mfo_can_select_row(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'MFO child reconciliation requires mfo_can_write_row, mfo_can_write_packet, and mfo_can_select_row';
  END IF;

  IF to_regclass('public.mfo_packets') IS NULL
     OR to_regclass('public.mfo_pi3_enrollment') IS NULL
     OR to_regclass('public.mfo_pi4_syllabus') IS NULL
     OR to_regclass('public.mfo_pi5_certifications') IS NULL
     OR to_regclass('public.mfo_pi6_postgraduate') IS NULL
     OR to_regclass('public.mfo_pi7_trainings') IS NULL
     OR to_regclass('public.mfo_pi8_instructional_materials') IS NULL
     OR to_regclass('public.mfo_research_utilized') IS NULL
     OR to_regclass('public.mfo_research_completed') IS NULL
     OR to_regclass('public.mfo_research_published') IS NULL
     OR to_regclass('public.mfo_research_presented') IS NULL
     OR to_regclass('public.mfo_extension_partnerships') IS NULL
     OR to_regclass('public.mfo_extension_trainings') IS NULL
     OR to_regclass('public.mfo_other_initiatives') IS NULL
     OR to_regclass('public.mfo_awards') IS NULL
     OR to_regclass('public.mfo_documentation_items') IS NULL THEN
    RAISE EXCEPTION
      'One or more MFO child reconciliation tables are missing';
  END IF;
END
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

    IF pack IS NULL
       OR NOT public.mfo_can_write_row(p_packet_id, NULL)
       OR p_faculty_id IS NULL
       OR p_faculty_id <> pack.faculty_id THEN
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

ALTER TABLE public.mfo_pi3_enrollment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi3_enrollment;
CREATE POLICY mfo_select_authorized ON public.mfo_pi3_enrollment
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi3_enrollment
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi3_enrollment
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi3_enrollment
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_pi4_syllabus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi4_syllabus;
CREATE POLICY mfo_select_authorized ON public.mfo_pi4_syllabus
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi4_syllabus
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi4_syllabus
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi4_syllabus
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_pi5_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi5_certifications;
CREATE POLICY mfo_select_authorized ON public.mfo_pi5_certifications
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi5_certifications
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi5_certifications
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi5_certifications
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi6_postgraduate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi6_postgraduate;
CREATE POLICY mfo_select_authorized ON public.mfo_pi6_postgraduate
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi6_postgraduate
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi6_postgraduate
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi6_postgraduate
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi7_trainings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi7_trainings;
CREATE POLICY mfo_select_authorized ON public.mfo_pi7_trainings
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi7_trainings
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi7_trainings
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi7_trainings
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi8_instructional_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi8_instructional_materials;
CREATE POLICY mfo_select_authorized ON public.mfo_pi8_instructional_materials
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi8_instructional_materials
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi8_instructional_materials
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi8_instructional_materials
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_research_utilized ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_utilized;
CREATE POLICY mfo_select_authorized ON public.mfo_research_utilized
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_utilized
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_utilized
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_utilized
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_research_completed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_completed;
CREATE POLICY mfo_select_authorized ON public.mfo_research_completed
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_completed
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_completed
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_completed
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_research_published ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_published;
CREATE POLICY mfo_select_authorized ON public.mfo_research_published
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_published
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_published
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_published
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_research_presented ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_presented;
CREATE POLICY mfo_select_authorized ON public.mfo_research_presented
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_presented
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_presented
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_presented
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_extension_partnerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_extension_partnerships;
CREATE POLICY mfo_select_authorized ON public.mfo_extension_partnerships
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_extension_partnerships
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_extension_partnerships
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_extension_partnerships
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_extension_trainings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_extension_trainings;
CREATE POLICY mfo_select_authorized ON public.mfo_extension_trainings
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_extension_trainings
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_extension_trainings
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_extension_trainings
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_other_initiatives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_other_initiatives;
CREATE POLICY mfo_select_authorized ON public.mfo_other_initiatives
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_other_initiatives
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_other_initiatives
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_other_initiatives
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_awards;
CREATE POLICY mfo_select_authorized ON public.mfo_awards
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_awards
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_awards
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_awards
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_documentation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_documentation_items;
CREATE POLICY mfo_select_authorized ON public.mfo_documentation_items
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_documentation_items
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_documentation_items
FOR UPDATE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_documentation_items
FOR DELETE TO authenticated
USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

GRANT EXECUTE ON FUNCTION public.mfo_can_write_child_row(uuid, uuid, bigint)
TO authenticated;

NOTIFY pgrst, 'reload schema';
