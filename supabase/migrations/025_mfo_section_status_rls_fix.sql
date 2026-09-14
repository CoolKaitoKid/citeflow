-- CITE-Flow 025 — Repair faculty ownership checks for MFO section status
--
-- The later MFO child-write policy uses mfo_can_write_row(packet_id,
-- program_packet_id), but older deployments may still have the structured-data
-- ownership helper that resolves faculty through wf_current_faculty(). Reapply
-- the authenticated ownership path and scope the policy repair to
-- mfo_section_status only.
--
-- Preserves RLS, authenticated-only access, final-approver access, and faculty
-- ownership checks. Does not grant anon/public access or alter other tables.

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
    RETURN public.wf_is_final_approver();
  END IF;

  RETURN false;
END;
$$;

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

CREATE POLICY mfo_section_status_select
ON public.mfo_section_status
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_insert
ON public.mfo_section_status
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_update
ON public.mfo_section_status
FOR UPDATE TO authenticated
USING (public.mfo_can_write_row(packet_id, program_packet_id))
WITH CHECK (public.mfo_can_write_row(packet_id, program_packet_id));

CREATE POLICY mfo_section_status_delete
ON public.mfo_section_status
FOR DELETE TO authenticated
USING (public.mfo_can_write_row(packet_id, program_packet_id));

GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
