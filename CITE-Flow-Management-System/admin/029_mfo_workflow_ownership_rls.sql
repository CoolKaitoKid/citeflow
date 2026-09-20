-- CITE-Flow 029 — Consolidated MFO ownership and child-write RLS
--
-- This migration removes conflicting historical MFO policy variants and
-- recreates one generic policy model for every MFO parent and child table.
-- Ownership is always derived from the authenticated user and public.faculty.
-- No faculty ID, auth UUID, email, department, or packet ID is embedded.

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
  SELECT p IS NOT NULL
     AND (
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
  IF NOT public.mfo_can_write_row(p_packet_id, p_program_packet_id) THEN
    RETURN false;
  END IF;

  IF p_faculty_id IS NULL OR p_program_packet_id IS NOT NULL THEN
    RETURN true;
  END IF;

  SELECT * INTO pack
  FROM public.mfo_packets
  WHERE id = p_packet_id;

  RETURN pack IS NOT NULL
     AND (
       public.wf_is_final_approver()
       OR p_faculty_id = pack.faculty_id
     );
END;
$$;

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

ALTER TABLE public.mfo_pi1_licensure ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi1_licensure;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi1_licensure;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi1_licensure;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi1_licensure;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi1_licensure;
CREATE POLICY mfo_select_authorized ON public.mfo_pi1_licensure
FOR SELECT TO authenticated USING (public.mfo_can_select_row(NULL, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi1_licensure
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_row(NULL, program_packet_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi1_licensure
FOR UPDATE TO authenticated USING (public.mfo_can_write_row(NULL, program_packet_id))
WITH CHECK (public.mfo_can_write_row(NULL, program_packet_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi1_licensure
FOR DELETE TO authenticated USING (public.mfo_can_write_row(NULL, program_packet_id));

ALTER TABLE public.mfo_pi2_employment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi2_employment;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi2_employment;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi2_employment;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi2_employment;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi2_employment;
CREATE POLICY mfo_select_authorized ON public.mfo_pi2_employment
FOR SELECT TO authenticated USING (public.mfo_can_select_row(NULL, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi2_employment
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_row(NULL, program_packet_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi2_employment
FOR UPDATE TO authenticated USING (public.mfo_can_write_row(NULL, program_packet_id))
WITH CHECK (public.mfo_can_write_row(NULL, program_packet_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi2_employment
FOR DELETE TO authenticated USING (public.mfo_can_write_row(NULL, program_packet_id));

ALTER TABLE public.mfo_pi3_enrollment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi3_enrollment;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi3_enrollment;
CREATE POLICY mfo_select_authorized ON public.mfo_pi3_enrollment
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi3_enrollment
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi3_enrollment
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi3_enrollment
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_pi4_syllabus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi4_syllabus;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi4_syllabus;
CREATE POLICY mfo_select_authorized ON public.mfo_pi4_syllabus
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi4_syllabus
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi4_syllabus
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi4_syllabus
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

ALTER TABLE public.mfo_pi5_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi5_certifications;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi5_certifications;
CREATE POLICY mfo_select_authorized ON public.mfo_pi5_certifications
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi5_certifications
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi5_certifications
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi5_certifications
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi6_postgraduate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi6_postgraduate;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi6_postgraduate;
CREATE POLICY mfo_select_authorized ON public.mfo_pi6_postgraduate
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi6_postgraduate
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi6_postgraduate
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi6_postgraduate
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi7_trainings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi7_trainings;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi7_trainings;
CREATE POLICY mfo_select_authorized ON public.mfo_pi7_trainings
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi7_trainings
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi7_trainings
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi7_trainings
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_pi8_instructional_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_pi8_instructional_materials;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_pi8_instructional_materials;
CREATE POLICY mfo_select_authorized ON public.mfo_pi8_instructional_materials
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, NULL));
CREATE POLICY mfo_insert_authorized ON public.mfo_pi8_instructional_materials
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_pi8_instructional_materials
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_pi8_instructional_materials
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, NULL, faculty_id));

ALTER TABLE public.mfo_research_utilized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_completed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_published ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_presented ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_extension_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_extension_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_other_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_documentation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_utilized;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_utilized;
CREATE POLICY mfo_select_authorized ON public.mfo_research_utilized
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_utilized
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_utilized
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_utilized
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_completed;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_completed;
CREATE POLICY mfo_select_authorized ON public.mfo_research_completed
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_completed
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_completed
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_completed
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_published;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_published;
CREATE POLICY mfo_select_authorized ON public.mfo_research_published
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_published
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_published
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_published
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_research_presented;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_research_presented;
CREATE POLICY mfo_select_authorized ON public.mfo_research_presented
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_research_presented
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_research_presented
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_research_presented
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_extension_partnerships;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_extension_partnerships;
CREATE POLICY mfo_select_authorized ON public.mfo_extension_partnerships
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_extension_partnerships
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_extension_partnerships
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_extension_partnerships
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_extension_trainings;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_extension_trainings;
CREATE POLICY mfo_select_authorized ON public.mfo_extension_trainings
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_extension_trainings
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_extension_trainings
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_extension_trainings
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_other_initiatives;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_other_initiatives;
CREATE POLICY mfo_select_authorized ON public.mfo_other_initiatives
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_other_initiatives
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_other_initiatives
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_other_initiatives
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_awards;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_awards;
CREATE POLICY mfo_select_authorized ON public.mfo_awards
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_awards
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_awards
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_awards
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

DROP POLICY IF EXISTS mfo_select_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_write_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_insert_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_update_authorized ON public.mfo_documentation_items;
DROP POLICY IF EXISTS mfo_delete_authorized ON public.mfo_documentation_items;
CREATE POLICY mfo_select_authorized ON public.mfo_documentation_items
FOR SELECT TO authenticated USING (public.mfo_can_select_row(packet_id, program_packet_id));
CREATE POLICY mfo_insert_authorized ON public.mfo_documentation_items
FOR INSERT TO authenticated WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_update_authorized ON public.mfo_documentation_items
FOR UPDATE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id))
WITH CHECK (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));
CREATE POLICY mfo_delete_authorized ON public.mfo_documentation_items
FOR DELETE TO authenticated USING (public.mfo_can_write_child_row(packet_id, program_packet_id, faculty_id));

GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_child_row(uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
