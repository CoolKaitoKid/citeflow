-- =============================================================================
-- CITE-Flow 036 — Faculty can write their own MFO packet and child rows
--
-- Symptom (still present after 035):
--   INSERT into mfo_pi7_trainings → 42501
--   mfo_owns_faculty_id(packet.faculty_id) is true
--   mfo_can_write_packet(packet) and mfo_can_write_row(...) are false
--
-- Cause:
--   The write/select helpers are SQL functions that start with "p IS NOT NULL"
--   on a composite row. In PostgreSQL that is true only when EVERY column is
--   non-null. mfo_packets and mfo_program_packets always have nullable columns
--   (notes, signature, submission, review), so the check rejected the owner
--   even though faculty_id was correct. Child policies call those helpers, so
--   PI7 insert/update/delete failed. Packet UPDATE uses the same helper.
--
-- Fix:
--   Treat a row as present when its id is present. Row helpers read scalar
--   faculty_id / department columns instead of passing the composite through.
--   Ownership rules are unchanged: a faculty member writes only their packet
--   and its child rows; a chairperson writes only an authorized program packet
--   (PI1, PI2, narrative). RLS stays enabled. No USING (true) / WITH CHECK (true).
--
-- Also removes draft packets created by the earlier RLS probe.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '036-mfo-packet-scalar-write'::text;
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_select_packet(p public.mfo_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.mfo_owns_faculty_id(p.faculty_id)
    OR EXISTS (
      SELECT 1
      FROM public.wf_submissions s
      WHERE s.id = p.submission_id
        AND public.wf_chairperson_can_browse_submission(s)
    )
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND public.wf_normalize_dept(p.department) = ANY (
        public.wf_chairperson_authorized_departments(public.wf_current_faculty())
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
  SELECT p.id IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.mfo_owns_faculty_id(p.faculty_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_select_program_packet(p public.mfo_program_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.wf_normalize_dept(p.department) = public.wf_faculty_department(public.wf_current_faculty())
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND public.wf_normalize_dept(p.department) = ANY (
        public.wf_chairperson_authorized_departments(public.wf_current_faculty())
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_write_program_packet(p public.mfo_program_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id IS NOT NULL AND (
    public.wf_is_final_approver()
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND public.wf_normalize_dept(p.department) = ANY (
        public.wf_chairperson_authorized_departments(public.wf_current_faculty())
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_select_row(p_packet_id uuid, p_program_packet_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id bigint;
  submission_id uuid;
  dept text;
BEGIN
  IF public.wf_is_final_approver() THEN
    RETURN true;
  END IF;

  IF p_packet_id IS NOT NULL THEN
    SELECT faculty_id, mfo_packets.submission_id, department
    INTO owner_id, submission_id, dept
    FROM public.mfo_packets
    WHERE id = p_packet_id;

    IF NOT FOUND THEN
      RETURN false;
    END IF;

    RETURN public.mfo_owns_faculty_id(owner_id)
      OR EXISTS (
        SELECT 1
        FROM public.wf_submissions s
        WHERE s.id = submission_id
          AND public.wf_chairperson_can_browse_submission(s)
      )
      OR (
        public.wf_has_active_chairperson_grant(public.wf_current_faculty())
        AND public.wf_normalize_dept(dept) = ANY (
          public.wf_chairperson_authorized_departments(public.wf_current_faculty())
        )
      );
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    SELECT department
    INTO dept
    FROM public.mfo_program_packets
    WHERE id = p_program_packet_id;

    IF NOT FOUND THEN
      RETURN false;
    END IF;

    RETURN public.wf_normalize_dept(dept) = public.wf_faculty_department(public.wf_current_faculty())
      OR (
        public.wf_has_active_chairperson_grant(public.wf_current_faculty())
        AND public.wf_normalize_dept(dept) = ANY (
          public.wf_chairperson_authorized_departments(public.wf_current_faculty())
        )
      );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfo_can_write_row(p_packet_id uuid, p_program_packet_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id bigint;
  dept text;
BEGIN
  IF public.wf_is_final_approver() THEN
    RETURN true;
  END IF;

  IF p_packet_id IS NOT NULL THEN
    SELECT faculty_id
    INTO owner_id
    FROM public.mfo_packets
    WHERE id = p_packet_id;

    IF NOT FOUND THEN
      RETURN false;
    END IF;

    RETURN public.mfo_owns_faculty_id(owner_id);
  END IF;

  IF p_program_packet_id IS NOT NULL THEN
    SELECT department
    INTO dept
    FROM public.mfo_program_packets
    WHERE id = p_program_packet_id;

    IF NOT FOUND THEN
      RETURN false;
    END IF;

    RETURN public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND public.wf_normalize_dept(dept) = ANY (
        public.wf_chairperson_authorized_departments(public.wf_current_faculty())
      );
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_program_packet(public.mfo_program_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_program_packet(public.mfo_program_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;

-- Draft packets created while diagnosing this policy. Faculty cannot delete them.
DO $$
DECLARE
  pid uuid;
  t text;
  child_tables text[] := ARRAY[
    'mfo_section_status',
    'mfo_snapshots',
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
  FOR pid IN
    SELECT id FROM public.mfo_packets
    WHERE period_label = 'RLS probe' AND packet_state = 'draft'
  LOOP
    FOREACH t IN ARRAY child_tables LOOP
      IF to_regclass(format('public.%I', t)) IS NULL THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'packet_id'
      ) THEN
        EXECUTE format('DELETE FROM public.%I WHERE packet_id = $1', t) USING pid;
      END IF;
    END LOOP;
    DELETE FROM public.mfo_packets WHERE id = pid;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
