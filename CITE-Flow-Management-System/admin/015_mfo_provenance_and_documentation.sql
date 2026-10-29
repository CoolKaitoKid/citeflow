-- =============================================================================
-- CITE-Flow 015 — MFO field provenance + real documentation columns
--
-- Why this migration is needed (nothing here is cosmetic):
--
--   1. Field-level provenance.
--      012 records provenance per ROW via source_kind ('manual' | 'suggested'
--      | 'imported'). That cannot express "the date came from the system but
--      the venue was typed by the Chairperson", so an automatic refresh has no
--      safe way to fill blanks without risking a manual correction. This adds
--      field_sources jsonb — a flat map of column name -> 'system' | 'manual'
--      | 'calculated' | 'na'.
--
--   2. Real documentation columns.
--      mfo_documentation_items has only caption/activity_date/narrative, so the
--      app currently serialises the venue and time INTO the narrative text as
--      "Venue: ..." lines and parses them back with a regex. A user who types
--      "Venue:" inside their own description corrupts the record, and dynamic
--      Event Details cannot be rendered reliably from packed text. This adds
--      title, venue and activity_time as columns and backfills them out of the
--      packed narrative.
--
--   3. Documentation-to-accomplishment linkage.
--      Evidence must state which accomplishment it supports. 012 links
--      documentation to a section_code only. This adds record_table/record_id.
--
--   4. Photo captions and ordering.
--      Captions are optional per photo and photo order must be stable in the
--      generated report. wf_submission_files has neither field.
--
-- Additive and idempotent. Creates no table. Drops nothing. Deletes no data.
-- Does not alter RLS, policies, ownership, or public.faculty.id.
-- Existing rows keep working: field_sources defaults to '{}' and the
-- application falls back to source_kind when a column has no entry.
--
-- Prerequisite: 012_mfo_structured_data.sql (and 013/014 if already applied).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.mfo_packets') IS NULL
     OR to_regclass('public.mfo_documentation_items') IS NULL THEN
    RAISE EXCEPTION 'MFO foundation is missing. Run 012_mfo_structured_data.sql first.';
  END IF;

  IF to_regclass('public.wf_submission_files') IS NULL THEN
    RAISE EXCEPTION 'public.wf_submission_files is required.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. field_sources on every MFO row table
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'mfo_pi1_licensure',
    'mfo_pi2_employment',
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
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping %: table not present.', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT ''{}''::jsonb',
      t
    );

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.field_sources IS %L',
      t,
      'Per-field provenance map: column name -> system | manual | calculated | na. '
      'A column absent from this map falls back to the row-level source_kind. '
      'Automatic refresh must never overwrite a column marked manual or na.'
    );

    -- Guard against a malformed payload: this must stay a flat JSON object.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = format('%s_field_sources_obj_chk', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (jsonb_typeof(field_sources) = ''object'')',
        t, format('%s_field_sources_obj_chk', t)
      );
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Real documentation columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.mfo_documentation_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS venue text,
  ADD COLUMN IF NOT EXISTS activity_time text,
  ADD COLUMN IF NOT EXISTS record_table text,
  ADD COLUMN IF NOT EXISTS record_id uuid,
  ADD COLUMN IF NOT EXISTS is_not_applicable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mfo_documentation_items.title IS
  'Documentation entry title. Derived from the linked accomplishment where possible, then editable. caption is retained for backward compatibility.';
COMMENT ON COLUMN public.mfo_documentation_items.venue IS
  'Replaces the "Venue:" line previously packed into narrative.';
COMMENT ON COLUMN public.mfo_documentation_items.activity_time IS
  'Free text, e.g. "9:00 AM - 12:00 NN". Replaces the packed "Time:" line.';
COMMENT ON COLUMN public.mfo_documentation_items.record_table IS
  'MFO child table holding the accomplishment this evidence supports, e.g. mfo_pi7_trainings. No polymorphic FK.';
COMMENT ON COLUMN public.mfo_documentation_items.record_id IS
  'Row id within record_table. Lets the report state exactly which accomplishment each photo set supports.';

CREATE INDEX IF NOT EXISTS idx_mfo_documentation_record
  ON public.mfo_documentation_items (record_table, record_id);

-- ---------------------------------------------------------------------------
-- 3. Backfill the new columns out of the packed narrative
--
--    The application wrote narratives shaped like:
--      Time: 9:00 AM - 12:00 NN
--      Venue: CTU Argao Campus
--
--      <free description>
--
--    Only rows still holding the packed form are touched, and only where the
--    destination column is empty, so re-running changes nothing.
-- ---------------------------------------------------------------------------

-- 3a. title from caption
UPDATE public.mfo_documentation_items
SET title = caption
WHERE title IS NULL
  AND caption IS NOT NULL
  AND btrim(caption) <> '';

-- 3b. activity_time and venue lifted out of narrative
UPDATE public.mfo_documentation_items
SET activity_time = btrim((regexp_match(narrative, '(?ni)^Time:[ \t]*(.+)$'))[1])
WHERE (activity_time IS NULL OR btrim(activity_time) = '')
  AND narrative ~* '(?n)^Time:';

UPDATE public.mfo_documentation_items
SET venue = btrim((regexp_match(narrative, '(?ni)^Venue:[ \t]*(.+)$'))[1])
WHERE (venue IS NULL OR btrim(venue) = '')
  AND narrative ~* '(?n)^Venue:';

-- 3c. strip the lifted metadata lines from the narrative itself
UPDATE public.mfo_documentation_items
SET narrative = nullif(
      btrim(
        regexp_replace(
          regexp_replace(narrative, '(?ni)^Venue:[ \t]*.*$', '', 'g'),
          '(?ni)^Time:[ \t]*.*$', '', 'g'
        )
      ),
      ''
    )
WHERE narrative ~* '(?n)^(Time|Venue):';

-- 3d. record what the backfill produced so a refresh treats it as user content
UPDATE public.mfo_documentation_items
SET field_sources = field_sources
      || jsonb_strip_nulls(jsonb_build_object(
           'title', CASE WHEN title IS NOT NULL AND btrim(title) <> '' THEN 'manual' END,
           'venue', CASE WHEN venue IS NOT NULL AND btrim(venue) <> '' THEN 'manual' END,
           'activity_time', CASE WHEN activity_time IS NOT NULL AND btrim(activity_time) <> '' THEN 'manual' END,
           'narrative', CASE WHEN narrative IS NOT NULL AND btrim(narrative) <> '' THEN 'manual' END
         ))
WHERE (title IS NOT NULL AND btrim(title) <> '')
   OR (venue IS NOT NULL AND btrim(venue) <> '')
   OR (activity_time IS NOT NULL AND btrim(activity_time) <> '')
   OR (narrative IS NOT NULL AND btrim(narrative) <> '');

-- ---------------------------------------------------------------------------
-- 4. Photo captions and ordering on existing evidence files
--
--    No new bucket and no new attachment table: 012 already tags
--    wf_submission_files with mfo_section / mfo_record_id / mfo_packet_id.
-- ---------------------------------------------------------------------------

ALTER TABLE public.wf_submission_files
  ADD COLUMN IF NOT EXISTS mfo_caption text,
  ADD COLUMN IF NOT EXISTS mfo_sort_order integer,
  ADD COLUMN IF NOT EXISTS mfo_documentation_id uuid;

COMMENT ON COLUMN public.wf_submission_files.mfo_caption IS
  'Optional per-photo caption. NULL means no caption; the report must not invent one.';
COMMENT ON COLUMN public.wf_submission_files.mfo_sort_order IS
  'Photo order within a documentation entry. NULL sorts last by uploaded_at.';
COMMENT ON COLUMN public.wf_submission_files.mfo_documentation_id IS
  'Documentation entry this photo belongs to.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wf_submission_files_mfo_documentation_fk'
  ) THEN
    ALTER TABLE public.wf_submission_files
      ADD CONSTRAINT wf_submission_files_mfo_documentation_fk
      FOREIGN KEY (mfo_documentation_id)
      REFERENCES public.mfo_documentation_items(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wf_submission_files_mfo_documentation
  ON public.wf_submission_files (mfo_documentation_id);

-- ---------------------------------------------------------------------------
-- 5. Chairperson storage safety net
--
--    The chairperson storage policy grants reads only where
--    storage.objects.name = wf_submission_files.storage_path. Rows that
--    recorded the object key in file_path instead are invisible to reviewers.
--    Copy the key across where storage_path is empty. Non-destructive:
--    file_path is left intact.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wf_submission_files'
      AND column_name = 'storage_path'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wf_submission_files'
      AND column_name = 'file_path'
  ) THEN
    UPDATE public.wf_submission_files
    SET storage_path = file_path
    WHERE (storage_path IS NULL OR btrim(storage_path) = '')
      AND file_path IS NOT NULL
      AND btrim(file_path) <> '';
    RAISE NOTICE 'storage_path backfilled from file_path where it was empty.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Version marker
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '015-mfo-provenance-documentation'::text;
$$;

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  packed integer;
BEGIN
  SELECT count(*) INTO packed
  FROM public.mfo_documentation_items
  WHERE narrative ~* '(?n)^(Time|Venue):';

  RAISE NOTICE '015 applied: mfo_sql_version=%', public.mfo_sql_version();
  RAISE NOTICE 'Documentation rows still holding packed metadata: % (expected 0).', packed;
END
$$;
