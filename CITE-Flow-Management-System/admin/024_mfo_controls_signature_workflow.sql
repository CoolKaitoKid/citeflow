-- =============================================================================
-- CITE-Flow 024 — MFO controls, signature columns, Chairperson config link
--
-- Symptom:
--   Faculty MFO submit is blocked with:
--     "This MFO task is not linked to an MFO report configuration,
--      so the system cannot route it to your Chairperson."
--   Electronic signature columns may still be missing if 022 was not applied.
--
-- Cause:
--   public.wf_task_requires_chairperson(task_id) reads
--   wf_tasks.report_config_id → wf_report_configs.requires_chairperson_review.
--   A task with report_config_id IS NULL routes to the final approver in SQL,
--   so the faculty page correctly refuses to submit (that would be a silent
--   Chairperson bypass). The task was never linked to a real MFO config.
--
-- This script:
--   1) Re-applies the 022 electronic-signature columns (IF NOT EXISTS).
--   2) Finds an existing MFO wf_report_configs row that requires Chairperson
--      review, or creates one using only columns that exist live.
--   3) Links ONLY unlinked MFO-looking wf_tasks to that config.
--      Already-linked tasks are left alone, including tasks that are
--      intentionally configured for direct Admin approval.
--   4) Adds mfo_ensure_task_report_config(task_id) so a faculty member who
--      opens an unlinked MFO task can complete the same link (they cannot
--      UPDATE wf_tasks under RLS).
--
-- Does NOT:
--   disable RLS / use USING (true) / WITH CHECK (true)
--   overwrite an existing report_config_id
--   send a Chairperson-required report straight to Admin
--   change Storage policies (019) or the JWT/shared-client auth fix
--
-- Safe / idempotent.
--
-- Run in Supabase SQL Editor for project: uforealazougjckepggc
-- After running: hard-refresh the MFO page (Ctrl+F5).
-- =============================================================================

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '024-mfo-controls-workflow'::text;
$$;

-- ---------------------------------------------------------------------------
-- Electronic signature columns (same as 022; no-op when already present)
-- Stored as a PNG data URL on the packet so print/PDF can render without a
-- signed Storage URL. Not a public object.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mfo_packets
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signature_name text,
  ADD COLUMN IF NOT EXISTS signature_signed_at timestamptz;

COMMENT ON COLUMN public.mfo_packets.signature_data_url IS
  'PNG data URL of the faculty electronic signature. Print uses this directly.';
COMMENT ON COLUMN public.mfo_packets.signature_name IS
  'Printed name stored with the electronic signature.';
COMMENT ON COLUMN public.mfo_packets.signature_signed_at IS
  'UTC timestamp when the electronic signature was applied.';

-- ---------------------------------------------------------------------------
-- Find or create the Chairperson-required MFO report configuration.
-- Never flips requires_chairperson_review on an existing row: a config that
-- explicitly disables Chairperson review is an intentional Admin path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_ensure_mfo_chairperson_config()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg_id uuid;
  col record;
  cols text[] := '{}';
  vals text[] := '{}';
  sql text;
  report_name_value text := 'MFO (Accomplishment Report)';
BEGIN
  SELECT c.id INTO cfg_id
  FROM public.wf_report_configs c
  WHERE (
      to_jsonb(c)::text ILIKE '%mfo%'
      OR to_jsonb(c)::text ILIKE '%accomplishment%'
      OR to_jsonb(c)::text ILIKE '%major final output%'
    )
    AND coalesce(c.requires_chairperson_review, true) IS NOT FALSE
  ORDER BY c.id
  LIMIT 1;

  IF cfg_id IS NOT NULL THEN
    RETURN cfg_id;
  END IF;

  FOR col IN
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wf_report_configs'
      AND column_name NOT IN ('id', 'created_at', 'updated_at')
    ORDER BY ordinal_position
  LOOP
    IF col.column_name IN ('report_name', 'title', 'name') THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal(report_name_value);
    ELSIF col.column_name = 'description' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal(
        'Quarterly faculty MFO / accomplishment report. '
        'Faculty submit to Chairperson, then Admin/Dean/Secretary final approval.'
      );
    ELSIF col.column_name = 'frequency' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('quarterly');
    ELSIF col.column_name = 'reporting_period_type' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('previous_quarter');
    ELSIF col.column_name = 'due_day' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || '15';
    ELSIF col.column_name = 'due_time' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('17:00');
    ELSIF col.column_name = 'submission_method' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('file_and_text');
    ELSIF col.column_name = 'recipient_type' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('all');
    ELSIF col.column_name = 'requires_chairperson_review' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || 'true';
    ELSIF col.column_name = 'requires_final_approval' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || 'true';
    ELSIF col.column_name = 'is_active' THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || 'true';
    ELSIF col.column_name IN ('created_by_name', 'updated_by_name') THEN
      cols := cols || quote_ident(col.column_name);
      vals := vals || quote_literal('system');
    ELSIF col.is_nullable = 'NO' AND col.column_default IS NULL THEN
      RAISE EXCEPTION
        'wf_report_configs.% is required and has no default; create the MFO report configuration in Admin Workflow first.',
        col.column_name;
    END IF;
  END LOOP;

  IF cols IS NULL OR array_length(cols, 1) IS NULL THEN
    RAISE EXCEPTION 'wf_report_configs has no usable columns to create an MFO configuration';
  END IF;

  sql := format(
    'INSERT INTO public.wf_report_configs (%s) VALUES (%s) RETURNING id',
    array_to_string(cols, ', '),
    array_to_string(vals, ', ')
  );

  BEGIN
    EXECUTE sql INTO cfg_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- A same-named row already exists. Prefer a Chairperson-required MFO
      -- config; do not flip an intentional direct-Admin flag. Retry once
      -- with a distinct name so unlinked Faculty MFO tasks can still be
      -- routed to the Chairperson.
      SELECT c.id INTO cfg_id
      FROM public.wf_report_configs c
      WHERE (
          to_jsonb(c)::text ILIKE '%mfo%'
          OR to_jsonb(c)::text ILIKE '%accomplishment%'
        )
        AND coalesce(c.requires_chairperson_review, true) IS NOT FALSE
      ORDER BY c.id
      LIMIT 1;

      IF cfg_id IS NULL THEN
        report_name_value := 'MFO Faculty Accomplishment Report';
        sql := replace(
          sql,
          quote_literal('MFO (Accomplishment Report)'),
          quote_literal(report_name_value)
        );
        EXECUTE sql INTO cfg_id;
      END IF;
  END;

  RETURN cfg_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Faculty-callable link for an unlinked MFO task.
-- Never overwrites an existing report_config_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_ensure_task_report_config(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.wf_tasks;
  cfg_id uuid;
  caller_faculty_id bigint;
  allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_task_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO task FROM public.wf_tasks WHERE id = p_task_id;
  IF task IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- Already linked: keep the administrator's routing decision.
  IF task.report_config_id IS NOT NULL THEN
    RETURN task.report_config_id;
  END IF;

  IF NOT (
    task.title ILIKE '%mfo%'
    OR task.title ILIKE '%accomplishment%'
    OR task.title ILIKE '%major final output%'
    OR to_jsonb(task)::text ILIKE '%mfo%'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT f.id INTO caller_faculty_id
  FROM public.faculty f
  WHERE f.auth_user_id::text = auth.uid()::text
  LIMIT 1;

  IF to_regprocedure('public.wf_is_final_approver()') IS NOT NULL
     AND public.wf_is_final_approver() THEN
    allowed := true;
  END IF;

  IF NOT allowed AND caller_faculty_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.wf_task_assignments a
      WHERE a.task_id = p_task_id
        AND a.faculty_id::text = caller_faculty_id::text
    ) THEN
      allowed := true;
    ELSIF EXISTS (
      SELECT 1
      FROM public.mfo_packets p
      WHERE p.task_id = p_task_id
        AND p.faculty_id = caller_faculty_id
    ) THEN
      allowed := true;
    ELSIF to_regprocedure('public.mfo_owns_faculty_id(bigint)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.mfo_packets p
        WHERE p.task_id = p_task_id
          AND public.mfo_owns_faculty_id(p.faculty_id)
      ) THEN
      allowed := true;
    END IF;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Not allowed to link this MFO task to a report configuration';
  END IF;

  cfg_id := public.mfo_ensure_mfo_chairperson_config();
  IF cfg_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.wf_tasks
     SET report_config_id = cfg_id
   WHERE id = p_task_id
     AND report_config_id IS NULL;

  RETURN cfg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mfo_ensure_mfo_chairperson_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mfo_ensure_mfo_chairperson_config() FROM anon;
REVOKE ALL ON FUNCTION public.mfo_ensure_task_report_config(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mfo_ensure_task_report_config(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mfo_ensure_task_report_config(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;

-- ---------------------------------------------------------------------------
-- Link currently unlinked MFO tasks. Already-linked rows are untouched.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  cfg_id uuid;
  linked_count integer := 0;
BEGIN
  cfg_id := public.mfo_ensure_mfo_chairperson_config();

  UPDATE public.wf_tasks t
     SET report_config_id = cfg_id
   WHERE t.report_config_id IS NULL
     AND (
       t.title ILIKE '%mfo%'
       OR t.title ILIKE '%accomplishment%'
       OR t.title ILIKE '%major final output%'
       OR to_jsonb(t)::text ILIKE '%major final output%'
     );

  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RAISE NOTICE '024: MFO report_config_id=% ; linked % previously unlinked MFO task(s).',
    cfg_id, linked_count;
END
$$;

NOTIFY pgrst, 'reload schema';

-- Verification (read-only)
SELECT public.mfo_sql_version() AS mfo_sql_version;

SELECT
    c.id,
    c.requires_chairperson_review,
    to_jsonb(c) AS full_config_row
FROM public.wf_report_configs c
WHERE to_jsonb(c)::text ILIKE '%mfo%'
   OR to_jsonb(c)::text ILIKE '%accomplishment%'
   OR to_jsonb(c)::text ILIKE '%major final output%'
ORDER BY c.id;

SELECT
    t.id AS task_id,
    t.title,
    t.report_config_id,
    public.wf_task_requires_chairperson(t.id) AS requires_chairperson
FROM public.wf_tasks t
WHERE t.title ILIKE '%mfo%'
   OR t.title ILIKE '%accomplishment%'
   OR t.title ILIKE '%major final output%'
ORDER BY t.created_at DESC NULLS LAST
LIMIT 50;

SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mfo_packets'
  AND column_name IN ('signature_data_url', 'signature_name', 'signature_signed_at')
ORDER BY column_name;
