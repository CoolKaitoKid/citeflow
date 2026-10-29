-- CITE-Flow 024 — Make packet section-status upserts addressable by PostgREST
--
-- mfo-report.js uses onConflict: 'packet_id,section_code'. The original
-- partial unique index enforces the relationship but cannot be selected by
-- PostgREST for a column-only ON CONFLICT target. This adds the equivalent
-- non-partial uniqueness needed by that upsert target.
--
-- Safe/idempotent: existing data is checked for duplicates first, and the
-- index is created only when an equivalent unique constraint/index is absent.
-- Does not change RLS, authentication, or unrelated MFO tables.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mfo_section_status
    WHERE packet_id IS NOT NULL
    GROUP BY packet_id, section_code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create mfo_section_status packet uniqueness: duplicate (packet_id, section_code) rows exist.';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class table_rel ON table_rel.oid = i.indrelid
    JOIN pg_namespace table_ns ON table_ns.oid = table_rel.relnamespace
    JOIN pg_attribute packet_col
      ON packet_col.attrelid = i.indrelid
     AND packet_col.attname = 'packet_id'
    JOIN pg_attribute section_col
      ON section_col.attrelid = i.indrelid
     AND section_col.attname = 'section_code'
    WHERE table_ns.nspname = 'public'
      AND table_rel.relname = 'mfo_section_status'
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indnkeyatts = 2
      AND i.indkey = ARRAY[packet_col.attnum, section_col.attnum]::int2vector
  ) THEN
    CREATE UNIQUE INDEX mfo_section_status_packet_conflict_uidx
      ON public.mfo_section_status (packet_id, section_code);
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
