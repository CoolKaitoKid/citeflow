-- =============================================================================
-- CITE-Flow 032 — MFO Chairperson Approval Workflow, RLS & Packet Recovery
--
-- Summary:
--   1. Adds reviewed_by and reviewed_at audit columns to public.mfo_packets.
--   2. Updates mfo_packets_packet_state_check to permit 'chairperson_approved'.
--   3. Updates public.mfo_can_select_packet() so Department Chairpersons can
--      read MFO packets and their child rows (PI1-PI8, research, awards, etc.)
--      for submissions in their department.
--   4. Updates public.mfo_can_write_packet() so Department Chairpersons with
--      an active grant can update mfo_packets during review.
--   5. Updates public.wf_task_requires_chairperson() so MFO tasks route to
--      Chairperson review by default.
--   6. Adds public.mfo_get_submission_packet(p_submission_id uuid) RPC
--      to reliably retrieve or link an MFO packet for any submission.
--
-- Safe / Idempotent. Run in Supabase SQL Editor.
-- =============================================================================

-- 1. Add reviewer audit columns to mfo_packets
ALTER TABLE public.mfo_packets
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 2. Update packet_state check constraint to allow 'chairperson_approved'
ALTER TABLE public.mfo_packets
  DROP CONSTRAINT IF EXISTS mfo_packets_packet_state_check;

ALTER TABLE public.mfo_packets
  ADD CONSTRAINT mfo_packets_packet_state_check
  CHECK (packet_state IN (
    'draft',
    'submitted',
    'late',
    'revision',
    'resubmitted',
    'chairperson_approved',
    'approved',
    'declined'
  ));

-- 3. Permit Department Chairpersons to select/read packets and section rows in their department
CREATE OR REPLACE FUNCTION public.mfo_can_select_packet(p public.mfo_packets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p IS NOT NULL AND (
    public.wf_is_final_approver()
    OR public.mfo_owns_faculty_id(p.faculty_id)
    OR EXISTS (
      SELECT 1
      FROM public.wf_submissions s
      WHERE (s.id = p.submission_id OR (s.task_id = p.task_id AND s.faculty_id = p.faculty_id))
        AND public.wf_chairperson_can_browse_submission(s)
    )
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND (
        public.wf_normalize_dept(p.department) = ANY (
          public.wf_chairperson_authorized_departments(public.wf_current_faculty())
        )
        OR EXISTS (
          SELECT 1 FROM public.faculty f
          WHERE f.id = p.faculty_id
            AND public.wf_normalize_dept(f.department) = ANY (
              public.wf_chairperson_authorized_departments(public.wf_current_faculty())
            )
        )
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfo_can_select_packet(public.mfo_packets) TO authenticated;

-- 4. Permit Department Chairpersons to write/update packets in their department
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
    OR EXISTS (
      SELECT 1
      FROM public.wf_submissions s
      WHERE (s.id = p.submission_id OR (s.task_id = p.task_id AND s.faculty_id = p.faculty_id))
        AND public.wf_chairperson_can_browse_submission(s)
    )
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND (
        public.wf_normalize_dept(p.department) = ANY (
          public.wf_chairperson_authorized_departments(public.wf_current_faculty())
        )
        OR EXISTS (
          SELECT 1 FROM public.faculty f
          WHERE f.id = p.faculty_id
            AND public.wf_normalize_dept(f.department) = ANY (
              public.wf_chairperson_authorized_departments(public.wf_current_faculty())
            )
        )
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;

-- 5. Ensure MFO tasks require Chairperson review by default
CREATE OR REPLACE FUNCTION public.wf_task_requires_chairperson(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flag boolean;
  has_config boolean := false;
  t_title text;
  t_instr text;
BEGIN
  IF p_task_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    c.requires_chairperson_review,
    (c.id IS NOT NULL),
    t.title,
    t.instructions
    INTO flag, has_config, t_title, t_instr
  FROM public.wf_tasks t
  LEFT JOIN public.wf_report_configs c ON c.id = t.report_config_id
  WHERE t.id = p_task_id;

  IF flag IS FALSE THEN
    RETURN false;
  END IF;

  IF flag IS TRUE THEN
    RETURN true;
  END IF;

  -- Tasks explicitly designated as MFO require chairperson review
  IF coalesce(t_title, '') ~* '\bmfo\b|major final output'
     OR coalesce(t_instr, '') ~* '\bmfo\b|major final output' THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.mfo_packets WHERE task_id = p_task_id) THEN
    RETURN true;
  END IF;

  -- A linked config with a null flag still requires Chairperson review.
  RETURN has_config;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wf_task_requires_chairperson(uuid) TO authenticated;

-- 6. RPC: Retrieve or associate an MFO packet for any submission
CREATE OR REPLACE FUNCTION public.mfo_get_submission_packet(p_submission_id uuid)
RETURNS public.mfo_packets
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub public.wf_submissions;
  pkt public.mfo_packets;
BEGIN
  IF p_submission_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO sub FROM public.wf_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Verify viewer has access to browse this submission
  IF NOT (
    public.wf_is_final_approver()
    OR public.wf_owns_submission(sub)
    OR public.wf_chairperson_can_browse_submission(sub)
  ) THEN
    RAISE EXCEPTION 'Not authorized to view this submission.' USING ERRCODE = '42501';
  END IF;

  -- 1. Direct match by submission_id
  SELECT * INTO pkt FROM public.mfo_packets WHERE submission_id = p_submission_id LIMIT 1;
  IF FOUND THEN
    RETURN pkt;
  END IF;

  -- 2. Match by task_id and faculty_id
  IF sub.task_id IS NOT NULL AND sub.faculty_id IS NOT NULL THEN
    SELECT * INTO pkt FROM public.mfo_packets
    WHERE task_id = sub.task_id AND faculty_id = sub.faculty_id
    LIMIT 1;
    IF FOUND THEN
      -- Link it if submission_id is not yet populated
      UPDATE public.mfo_packets
      SET submission_id = p_submission_id
      WHERE id = pkt.id AND submission_id IS NULL;
      pkt.submission_id := p_submission_id;
      RETURN pkt;
    END IF;
  END IF;

  -- 3. Match from wf_submission_files mfo_packet_id
  SELECT p.* INTO pkt
  FROM public.wf_submission_files f
  JOIN public.mfo_packets p ON p.id = f.mfo_packet_id
  WHERE f.submission_id = p_submission_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.mfo_packets
    SET submission_id = p_submission_id
    WHERE id = pkt.id AND submission_id IS NULL;
    pkt.submission_id := p_submission_id;
    RETURN pkt;
  END IF;

  -- 4. Latest packet for faculty_id
  IF sub.faculty_id IS NOT NULL THEN
    SELECT * INTO pkt FROM public.mfo_packets
    WHERE faculty_id = sub.faculty_id
    ORDER BY updated_at DESC
    LIMIT 1;
    IF FOUND THEN
      UPDATE public.mfo_packets
      SET submission_id = p_submission_id,
          task_id = coalesce(task_id, sub.task_id)
      WHERE id = pkt.id;
      pkt.submission_id := p_submission_id;
      IF pkt.task_id IS NULL THEN
        pkt.task_id := sub.task_id;
      END IF;
      RETURN pkt;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfo_get_submission_packet(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
