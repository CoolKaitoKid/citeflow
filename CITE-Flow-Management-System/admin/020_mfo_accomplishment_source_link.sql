-- =============================================================================
-- CITE-Flow 020 — source provenance on other_initiatives + documentation
--
-- Needed so faculty_accomplishments → MFO merge can persist
-- source_table + source_id and therefore not duplicate rows on reopen.
--
-- Additive. Does not change RLS, Storage, workflow, or faculty.id.
-- Safe to re-run.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  t text;
  targets text[] := ARRAY['mfo_other_initiatives', 'mfo_documentation_items'];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping %: table not present.', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS source_kind text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS source_table text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS source_id text', t);
    EXECUTE format(
      'UPDATE public.%I SET source_kind = ''manual'' WHERE source_kind IS NULL OR btrim(source_kind) = ''''',
      t
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN source_kind SET DEFAULT ''manual''', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = format('%s_source_kind_chk', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (source_kind IN (''manual'', ''suggested'', ''imported''))',
        t, format('%s_source_kind_chk', t)
      );
    END IF;
  END LOOP;
END
$$;
