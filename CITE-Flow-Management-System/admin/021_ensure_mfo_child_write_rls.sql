-- =============================================================================
-- CITE-Flow 021 — Ensure existing MFO child WRITE RLS (014) is present
--
-- Symptom:
--   INSERT into mfo_pi7_trainings → 42501 / HTTP 403
--   "new row violates row-level security policy"
--
-- Blocking policy (when 014 is present):
--   mfo_insert_authorized
--   WITH CHECK (public.mfo_can_write_row(packet_id, NULL))
--
-- mfo_can_write_row → mfo_can_write_packet → mfo_owns_faculty_id(packet.faculty_id)
-- or wf_is_final_approver().
--
-- This does NOT invent a new RLS model. It re-applies the 014 helpers and the
-- faculty-owned child INSERT/UPDATE/DELETE policies. Safe to re-run.
-- Does NOT disable RLS. Does NOT use USING (true) / WITH CHECK (true).
-- Does NOT change Storage, Chairperson, or Admin approval.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

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

DO $$
DECLARE
  t text;
  faculty_only text[] := ARRAY[
    'mfo_pi5_certifications',
    'mfo_pi6_postgraduate',
    'mfo_pi7_trainings',
    'mfo_pi8_instructional_materials'
  ];
BEGIN
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

GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
