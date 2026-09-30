-- =============================================================================
-- CITE-Flow 032 — MFO Chairperson Approval Workflow & Packet Write RLS
--
-- Summary:
--   1. Adds reviewed_by and reviewed_at columns to public.mfo_packets.
--   2. Updates mfo_packets_packet_state_check to permit 'chairperson_approved'.
--   3. Updates public.mfo_can_write_packet() so Department Chairpersons with
--      an active grant can update mfo_packets for their department during review.
--   4. Updates public.wf_task_requires_chairperson() so MFO tasks route to
--      Chairperson review by default.
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

-- 3. Permit Department Chairpersons to write/update packets in their department
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
    OR (
      public.wf_has_active_chairperson_grant(public.wf_current_faculty())
      AND public.wf_normalize_dept(p.department) = ANY (
        public.wf_chairperson_authorized_departments(public.wf_current_faculty())
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;

-- 4. Ensure MFO tasks require Chairperson review by default
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

NOTIFY pgrst, 'reload schema';
