-- =============================================================================
-- CITE-Flow 012 — MFO structured data foundation
-- Additive. Idempotent where practical. Does NOT drop tables, columns, or data.
-- Does NOT replace existing workflow RLS. Does NOT use public.wf_faculty.
--
-- Prerequisite: 011_chairperson_approval_chain.sql (wf_* RLS helpers).
-- Canonical identity: public.faculty.id  (live type: bigint)
--
-- Architecture (hybrid):
--   1. Header tables (faculty packet + department/program compilation)
--   2. Queryable child tables per MFO section / performance indicator
--   3. JSONB snapshots for revision history / print-ready copies
--   4. Optional tags on existing wf_submission_files (no new storage bucket)
--
-- Packet-level workflow remains Faculty → Chairperson/OIC → Admin via
-- existing wf_tasks / wf_submissions. One MFO packet per faculty per task.
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  faculty_id_type text;
BEGIN
  IF to_regclass('public.faculty') IS NULL THEN
    RAISE EXCEPTION 'public.faculty is required. Do not use wf_faculty.';
  END IF;

  IF to_regclass('public.wf_faculty') IS NOT NULL THEN
    RAISE NOTICE 'Legacy table public.wf_faculty exists and will be ignored. MFO uses public.faculty only.';
  END IF;

  SELECT c.data_type INTO faculty_id_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'faculty'
    AND c.column_name = 'id';

  IF faculty_id_type IS NULL THEN
    RAISE EXCEPTION 'public.faculty.id was not found.';
  END IF;

  IF faculty_id_type NOT IN ('bigint', 'integer') THEN
    RAISE EXCEPTION
      'MFO migration requires public.faculty.id to be bigint (live schema). Found %. Do not attach MFO to wf_faculty.',
      faculty_id_type;
  END IF;

  IF to_regprocedure('public.wf_is_final_approver()') IS NULL
     OR to_regprocedure('public.wf_current_faculty()') IS NULL
     OR to_regprocedure('public.wf_chairperson_can_browse_submission(public.wf_submissions)') IS NULL THEN
    RAISE EXCEPTION
      'MFO migration requires existing workflow helpers. Run 011_chairperson_approval_chain.sql first.';
  END IF;

  IF to_regclass('public.wf_submissions') IS NULL OR to_regclass('public.wf_tasks') IS NULL THEN
    RAISE EXCEPTION 'wf_submissions and wf_tasks are required.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.mfo_sql_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT '012-mfo-structured-data'::text;
$$;

-- ---------------------------------------------------------------------------
-- Calculated-value helpers (authoritative formulas; do not store as source)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_safe_pct(numerator numeric, denominator numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN numerator IS NULL OR denominator IS NULL OR denominator = 0 THEN NULL
    ELSE round((numerator / denominator) * 100.0, 2)
  END;
$$;

-- Default manhours formula: hours × (male + female).
-- PDF example "09/20-09/42" is ambiguous and is NOT used.
-- Unknown formula codes return NULL so an override can be stored instead.
CREATE OR REPLACE FUNCTION public.mfo_manhours(
  training_hours numeric,
  beneficiaries_male integer,
  beneficiaries_female integer,
  formula_code text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN training_hours IS NULL THEN NULL
    WHEN coalesce(nullif(trim(formula_code), ''), 'hours_x_beneficiaries') = 'hours_x_beneficiaries'
      THEN round(training_hours * (coalesce(beneficiaries_male, 0) + coalesce(beneficiaries_female, 0)), 2)
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.mfo_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Section catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_section_catalog (
  section_code text PRIMARY KEY,
  mfo_group text NOT NULL,
  indicator_code text,
  title text NOT NULL,
  ownership text NOT NULL CHECK (ownership IN ('faculty', 'program', 'either', 'supporting')),
  sort_order integer NOT NULL DEFAULT 0,
  description text
);

INSERT INTO public.mfo_section_catalog
  (section_code, mfo_group, indicator_code, title, ownership, sort_order, description)
VALUES
  ('header', 'header', NULL, 'Header / reporting identity', 'either', 10, 'Period, program, submitter. Identity joins public.faculty.'),
  ('mfo1_pi1', 'mfo1', 'PI1', 'Licensure passing percentage', 'program', 20, 'Program-owned. Chairperson enters.'),
  ('mfo1_pi2', 'mfo1', 'PI2', 'Graduate employment (2 years prior)', 'program', 30, 'Program-owned. Chairperson enters.'),
  ('mfo1_pi3', 'mfo1', 'PI3', 'Enrollment / sections / advisers', 'either', 40, 'Faculty own sections; Chairperson completes program gaps.'),
  ('mfo1_pi4', 'mfo1', 'PI4', 'Syllabus submission', 'either', 50, 'May reference an existing Syllabus wf_submission.'),
  ('mfo1_pi5', 'mfo1', 'PI5', 'Certifications', 'faculty', 60, NULL),
  ('mfo1_pi6', 'mfo1', 'PI6', 'Postgraduate education', 'faculty', 70, 'Do not parse faculty.educational_qualification.'),
  ('mfo1_pi7', 'mfo1', 'PI7', 'Trainings / workshops / seminars', 'faculty', 80, NULL),
  ('mfo1_pi8', 'mfo1', 'PI8', 'Instructional materials', 'faculty', 90, NULL),
  ('mfo3_pi1', 'mfo3', 'PI1', 'Research utilized', 'either', 100, 'MFO 2 is not present in the source PDF.'),
  ('mfo3_pi2', 'mfo3', 'PI2', 'Research completed', 'either', 110, 'PDF PI2 table has no column headers. See table comment.'),
  ('mfo3_pi3', 'mfo3', 'PI3', 'Research published', 'either', 120, NULL),
  ('mfo3_pi4', 'mfo3', 'PI4', 'Research presented', 'either', 130, 'Second PDF title column stored as conference_title.'),
  ('mfo4_pi1', 'mfo4', 'PI1', 'Active extension partnerships', 'either', 140, NULL),
  ('mfo4_pi2', 'mfo4', 'PI2', 'Trainees / manhours', 'either', 150, NULL),
  ('other_initiatives', 'other', NULL, 'Other initiatives / activities', 'either', 160, NULL),
  ('awards', 'other', NULL, 'Awards', 'either', 170, NULL),
  ('other_accomplishments', 'other', NULL, 'Other accomplishments (narrative)', 'program', 180, 'Chairperson-owned program narrative.'),
  ('documentation_instruction', 'documentation', NULL, 'Documentation — instruction', 'supporting', 190, NULL),
  ('documentation_training', 'documentation', NULL, 'Documentation — trainings', 'supporting', 200, NULL),
  ('documentation_postgraduate', 'documentation', NULL, 'Documentation — postgraduate', 'supporting', 210, NULL),
  ('documentation_research', 'documentation', NULL, 'Documentation — research', 'supporting', 220, NULL),
  ('documentation_extension', 'documentation', NULL, 'Documentation — extension', 'supporting', 230, NULL),
  ('documentation_other', 'documentation', NULL, 'Documentation — other engagements', 'supporting', 240, NULL)
ON CONFLICT (section_code) DO UPDATE
SET mfo_group = excluded.mfo_group,
    indicator_code = excluded.indicator_code,
    title = excluded.title,
    ownership = excluded.ownership,
    sort_order = excluded.sort_order,
    description = excluded.description;

-- ---------------------------------------------------------------------------
-- Faculty MFO packet (one per faculty per workflow task / period)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES public.wf_submissions(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
  report_config_id uuid,
  faculty_id bigint NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
  department text,
  reporting_year integer,
  quarter integer CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),
  period_start date,
  period_end date,
  period_label text,
  academic_year text,
  semester text,
  packet_state text NOT NULL DEFAULT 'draft'
    CHECK (packet_state IN ('draft', 'submitted', 'late', 'revision', 'resubmitted', 'approved', 'declined')),
  current_version integer NOT NULL DEFAULT 0,
  is_not_applicable boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.mfo_packets
  ADD COLUMN IF NOT EXISTS submission_id uuid,
  ADD COLUMN IF NOT EXISTS task_id uuid,
  ADD COLUMN IF NOT EXISTS report_config_id uuid,
  ADD COLUMN IF NOT EXISTS faculty_id bigint,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS reporting_year integer,
  ADD COLUMN IF NOT EXISTS quarter integer,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS academic_year text,
  ADD COLUMN IF NOT EXISTS semester text,
  ADD COLUMN IF NOT EXISTS packet_state text,
  ADD COLUMN IF NOT EXISTS current_version integer,
  ADD COLUMN IF NOT EXISTS is_not_applicable boolean,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON TABLE public.mfo_packets IS
  'Faculty-owned MFO packet. One row per faculty per wf_task. Identity lives on public.faculty; this table stores period + workflow links only.';

CREATE UNIQUE INDEX IF NOT EXISTS mfo_packets_task_faculty_uidx
  ON public.mfo_packets (task_id, faculty_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mfo_packets_submission_uidx
  ON public.mfo_packets (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mfo_packets_faculty ON public.mfo_packets (faculty_id);
CREATE INDEX IF NOT EXISTS idx_mfo_packets_department ON public.mfo_packets (department);
CREATE INDEX IF NOT EXISTS idx_mfo_packets_period ON public.mfo_packets (reporting_year, quarter);
CREATE INDEX IF NOT EXISTS idx_mfo_packets_state ON public.mfo_packets (packet_state);
CREATE INDEX IF NOT EXISTS idx_mfo_packets_created ON public.mfo_packets (created_at DESC);

DROP TRIGGER IF EXISTS trg_mfo_packets_updated_at ON public.mfo_packets;
CREATE TRIGGER trg_mfo_packets_updated_at
BEFORE UPDATE ON public.mfo_packets
FOR EACH ROW EXECUTE FUNCTION public.mfo_set_updated_at();

CREATE OR REPLACE FUNCTION public.mfo_packets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub public.wf_submissions;
  fac public.faculty;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
    RAISE EXCEPTION 'mfo_packets.faculty_id cannot be changed';
  END IF;

  SELECT * INTO fac FROM public.faculty WHERE id = NEW.faculty_id;
  IF fac IS NULL THEN
    RAISE EXCEPTION 'mfo_packets.faculty_id must reference public.faculty';
  END IF;

  IF NEW.department IS NULL OR btrim(NEW.department) = '' THEN
    NEW.department := fac.department;
  END IF;

  IF NEW.submission_id IS NOT NULL THEN
    SELECT * INTO sub FROM public.wf_submissions WHERE id = NEW.submission_id;
    IF sub IS NULL THEN
      RAISE EXCEPTION 'mfo_packets.submission_id does not exist';
    END IF;
    IF sub.faculty_id IS DISTINCT FROM NEW.faculty_id THEN
      RAISE EXCEPTION 'mfo_packets.faculty_id must match wf_submissions.faculty_id';
    END IF;
    IF NEW.task_id IS NULL THEN
      NEW.task_id := sub.task_id;
    ELSIF sub.task_id IS DISTINCT FROM NEW.task_id THEN
      RAISE EXCEPTION 'mfo_packets.task_id must match wf_submissions.task_id';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mfo_packets_guard ON public.mfo_packets;
CREATE TRIGGER trg_mfo_packets_guard
BEFORE INSERT OR UPDATE ON public.mfo_packets
FOR EACH ROW EXECUTE FUNCTION public.mfo_packets_guard();

-- ---------------------------------------------------------------------------
-- Program / department compilation (Chairperson-owned PI1, PI2, narrative)
-- One per department per workflow task / period
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_program_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
  report_config_id uuid,
  department text NOT NULL,
  chairperson_faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  reporting_year integer,
  quarter integer CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),
  period_start date,
  period_end date,
  period_label text,
  academic_year text,
  semester text,
  other_accomplishments text,
  other_accomplishments_not_applicable boolean NOT NULL DEFAULT false,
  packet_state text NOT NULL DEFAULT 'draft'
    CHECK (packet_state IN ('draft', 'submitted', 'late', 'revision', 'resubmitted', 'approved', 'declined')),
  current_version integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.mfo_program_packets IS
  'Department/program MFO compilation. Uses faculty.department values (BSIT/BSIE/BIT). No separate program table.';
COMMENT ON COLUMN public.mfo_program_packets.other_accomplishments IS
  'Program narrative. Do not hard-code College of Education; print layer uses CITE department labels.';

CREATE UNIQUE INDEX IF NOT EXISTS mfo_program_packets_task_dept_uidx
  ON public.mfo_program_packets (task_id, lower(btrim(department)))
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mfo_program_packets_dept ON public.mfo_program_packets (department);
CREATE INDEX IF NOT EXISTS idx_mfo_program_packets_period ON public.mfo_program_packets (reporting_year, quarter);
CREATE INDEX IF NOT EXISTS idx_mfo_program_packets_chair ON public.mfo_program_packets (chairperson_faculty_id);

DROP TRIGGER IF EXISTS trg_mfo_program_packets_updated_at ON public.mfo_program_packets;
CREATE TRIGGER trg_mfo_program_packets_updated_at
BEFORE UPDATE ON public.mfo_program_packets
FOR EACH ROW EXECUTE FUNCTION public.mfo_set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-section NA / completeness flags
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_section_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  section_code text NOT NULL REFERENCES public.mfo_section_catalog(section_code),
  is_not_applicable boolean NOT NULL DEFAULT false,
  completeness text NOT NULL DEFAULT 'empty'
    CHECK (completeness IN ('empty', 'draft', 'complete', 'not_applicable')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_section_status_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mfo_section_status_packet_uidx
  ON public.mfo_section_status (packet_id, section_code)
  WHERE packet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mfo_section_status_program_uidx
  ON public.mfo_section_status (program_packet_id, section_code)
  WHERE program_packet_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Snapshots (revision history; payload is print-ready structured copy)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  lifecycle_state text NOT NULL
    CHECK (lifecycle_state IN ('draft', 'submitted', 'late', 'revision', 'resubmitted', 'approved', 'declined')),
  snapshot_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_snapshots_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  ),
  CONSTRAINT mfo_snapshots_version_chk CHECK (version_no >= 1)
);

COMMENT ON TABLE public.mfo_snapshots IS
  'Immutable MFO versions. wf_approval_history remains the workflow action log; this table stores structured content copies.';

CREATE UNIQUE INDEX IF NOT EXISTS mfo_snapshots_packet_version_uidx
  ON public.mfo_snapshots (packet_id, version_no)
  WHERE packet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mfo_snapshots_program_version_uidx
  ON public.mfo_snapshots (program_packet_id, version_no)
  WHERE program_packet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mfo_snapshots_created ON public.mfo_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfo_snapshots_payload ON public.mfo_snapshots USING gin (payload);

CREATE OR REPLACE FUNCTION public.mfo_snapshots_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.packet_id IS NOT NULL THEN
    UPDATE public.mfo_packets
    SET current_version = GREATEST(coalesce(current_version, 0), NEW.version_no)
    WHERE id = NEW.packet_id;
  END IF;
  IF NEW.program_packet_id IS NOT NULL THEN
    UPDATE public.mfo_program_packets
    SET current_version = GREATEST(coalesce(current_version, 0), NEW.version_no)
    WHERE id = NEW.program_packet_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mfo_snapshots_after_insert ON public.mfo_snapshots;
CREATE TRIGGER trg_mfo_snapshots_after_insert
AFTER INSERT ON public.mfo_snapshots
FOR EACH ROW EXECUTE FUNCTION public.mfo_snapshots_after_insert();

-- ---------------------------------------------------------------------------
-- MFO 1 PI1 — Licensure (program-owned)
-- Percentages are generated; numerators/denominators are the source of truth.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_pi1_licensure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_packet_id uuid NOT NULL REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  exam_name text,
  exam_date date,
  first_time_takers integer CHECK (first_time_takers IS NULL OR first_time_takers >= 0),
  first_time_passers integer CHECK (first_time_passers IS NULL OR first_time_passers >= 0),
  total_takers integer CHECK (total_takers IS NULL OR total_takers >= 0),
  total_passers integer CHECK (total_passers IS NULL OR total_passers >= 0),
  first_time_passing_pct numeric GENERATED ALWAYS AS (
    public.mfo_safe_pct(first_time_passers::numeric, first_time_takers::numeric)
  ) STORED,
  overall_passing_pct numeric GENERATED ALWAYS AS (
    public.mfo_safe_pct(total_passers::numeric, total_takers::numeric)
  ) STORED,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi1_program ON public.mfo_pi1_licensure (program_packet_id);

-- ---------------------------------------------------------------------------
-- MFO 1 PI2 — Graduate employment (program-owned)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_pi2_employment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_packet_id uuid NOT NULL REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  graduates_count integer CHECK (graduates_count IS NULL OR graduates_count >= 0),
  employed_count integer CHECK (employed_count IS NULL OR employed_count >= 0),
  reference_period text,
  employment_pct numeric GENERATED ALWAYS AS (
    public.mfo_safe_pct(employed_count::numeric, graduates_count::numeric)
  ) STORED,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi2_program ON public.mfo_pi2_employment (program_packet_id);

-- ---------------------------------------------------------------------------
-- Shared parent check used by dual-scope row tables
-- ---------------------------------------------------------------------------

-- MFO 1 PI3 — Enrollment / sections / advisers
CREATE TABLE IF NOT EXISTS public.mfo_pi3_enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  adviser_faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  adviser_name text,
  section text,
  students_enrolled integer CHECK (students_enrolled IS NULL OR students_enrolled >= 0),
  academic_year text,
  semester text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_pi3_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi3_packet ON public.mfo_pi3_enrollment (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi3_program ON public.mfo_pi3_enrollment (program_packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi3_faculty ON public.mfo_pi3_enrollment (faculty_id);

-- MFO 1 PI4 — Syllabus
CREATE TABLE IF NOT EXISTS public.mfo_pi4_syllabus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  subject_code text,
  course_title text,
  syllabus_status text CHECK (syllabus_status IS NULL OR syllabus_status IN ('submitted', 'not_submitted', 'not_applicable')),
  related_syllabus_submission_id uuid REFERENCES public.wf_submissions(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_pi4_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi4_packet ON public.mfo_pi4_syllabus (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi4_faculty ON public.mfo_pi4_syllabus (faculty_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi4_related ON public.mfo_pi4_syllabus (related_syllabus_submission_id);

-- MFO 1 PI5 — Certifications (faculty-owned)
CREATE TABLE IF NOT EXISTS public.mfo_pi5_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  certification_title text,
  certification_nature text,
  granting_agency text,
  date_granted date,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi5_packet ON public.mfo_pi5_certifications (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi5_faculty ON public.mfo_pi5_certifications (faculty_id);

-- MFO 1 PI6 — Postgraduate education (faculty-owned)
CREATE TABLE IF NOT EXISTS public.mfo_pi6_postgraduate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  program_enrolled text,
  institution_name text,
  earned_units numeric,
  current_units numeric,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi6_packet ON public.mfo_pi6_postgraduate (packet_id);

-- MFO 1 PI7 — Trainings
CREATE TABLE IF NOT EXISTS public.mfo_pi7_trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  title text,
  training_type text,
  activity_date date,
  venue text,
  sponsoring_agency text,
  role text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi7_packet ON public.mfo_pi7_trainings (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_pi7_faculty ON public.mfo_pi7_trainings (faculty_id);

-- MFO 1 PI8 — Instructional materials
CREATE TABLE IF NOT EXISTS public.mfo_pi8_instructional_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  title text,
  material_type text,
  courses_utilizing text,
  ip_nature text,
  authors jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mfo_pi8_packet ON public.mfo_pi8_instructional_materials (packet_id);

-- ---------------------------------------------------------------------------
-- MFO 3 Research
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_research_utilized (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  research_title text,
  proponents_text text,
  proponents jsonb NOT NULL DEFAULT '[]'::jsonb,
  utilization_nature text,
  partner_name text,
  partner_address text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_research_utilized_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_research_utilized_packet ON public.mfo_research_utilized (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_research_utilized_program ON public.mfo_research_utilized (program_packet_id);

-- Assumption (PDF PI2 has no column headers): title, proponents, completion date, status.
CREATE TABLE IF NOT EXISTS public.mfo_research_completed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  research_title text,
  proponents_text text,
  proponents jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at date,
  research_status text,
  funding_source text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_research_completed_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.mfo_research_completed IS
  'MFO 3 PI2. Source PDF table has no headers. Columns are a conservative normalization: title, proponents, completed_at, status, optional funding_source.';

CREATE INDEX IF NOT EXISTS idx_mfo_research_completed_packet ON public.mfo_research_completed (packet_id);

CREATE TABLE IF NOT EXISTS public.mfo_research_published (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  research_title text,
  proponents_text text,
  proponents jsonb NOT NULL DEFAULT '[]'::jsonb,
  publication_name text,
  published_at date,
  funding_source text,
  publication_url text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_research_published_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

COMMENT ON COLUMN public.mfo_research_published.published_at IS
  'Do not auto-fill from faculty_research_projects.end_date.';

CREATE INDEX IF NOT EXISTS idx_mfo_research_published_packet ON public.mfo_research_published (packet_id);

-- PDF repeats "Title of Research"; second title is stored as conference_title.
CREATE TABLE IF NOT EXISTS public.mfo_research_presented (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  research_title text,
  conference_title text,
  proponents_text text,
  proponents jsonb NOT NULL DEFAULT '[]'::jsonb,
  presented_at date,
  sponsoring_agency text,
  venue text,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_research_presented_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

COMMENT ON COLUMN public.mfo_research_presented.conference_title IS
  'Interpreted from the PDF''s duplicated Title of Research column as the conference/event title.';

CREATE INDEX IF NOT EXISTS idx_mfo_research_presented_packet ON public.mfo_research_presented (packet_id);

-- ---------------------------------------------------------------------------
-- MFO 4 Extension
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_extension_partnerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  project_title text,
  proponents_text text,
  proponents jsonb NOT NULL DEFAULT '[]'::jsonb,
  partner_name text,
  project_locale text,
  has_moa boolean,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_extension_partnerships_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_extension_partnerships_packet ON public.mfo_extension_partnerships (packet_id);

CREATE TABLE IF NOT EXISTS public.mfo_extension_trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  training_title text,
  partner_agency text,
  beneficiaries_male integer CHECK (beneficiaries_male IS NULL OR beneficiaries_male >= 0),
  beneficiaries_female integer CHECK (beneficiaries_female IS NULL OR beneficiaries_female >= 0),
  beneficiaries_total integer GENERATED ALWAYS AS (
    coalesce(beneficiaries_male, 0) + coalesce(beneficiaries_female, 0)
  ) STORED,
  training_hours numeric CHECK (training_hours IS NULL OR training_hours >= 0),
  manhours_formula text NOT NULL DEFAULT 'hours_x_beneficiaries',
  manhours_calculated numeric GENERATED ALWAYS AS (
    public.mfo_manhours(training_hours, beneficiaries_male, beneficiaries_female, manhours_formula)
  ) STORED,
  manhours_override numeric,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_extension_trainings_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

COMMENT ON COLUMN public.mfo_extension_trainings.manhours_override IS
  'Optional institutional override. Print/report should use coalesce(manhours_override, manhours_calculated).';
COMMENT ON COLUMN public.mfo_extension_trainings.manhours_formula IS
  'Default hours_x_beneficiaries. Change the code later if Chairperson confirms a different official formula.';

CREATE INDEX IF NOT EXISTS idx_mfo_extension_trainings_packet ON public.mfo_extension_trainings (packet_id);

-- ---------------------------------------------------------------------------
-- Other initiatives, awards, documentation captions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfo_other_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  activity_title text,
  category text,
  description text,
  activity_date date,
  venue text,
  sponsoring_agency text,
  students_involved text,
  student_role text,
  faculty_involved text,
  faculty_role text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_other_initiatives_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_other_initiatives_packet ON public.mfo_other_initiatives (packet_id);

CREATE TABLE IF NOT EXISTS public.mfo_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  award_title text,
  award_type text,
  award_nature text,
  granting_agency text,
  awarded_at date,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'suggested', 'imported')),
  source_table text,
  source_id text,
  is_not_applicable boolean NOT NULL DEFAULT false,
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_awards_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_awards_packet ON public.mfo_awards (packet_id);

CREATE TABLE IF NOT EXISTS public.mfo_documentation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid REFERENCES public.mfo_packets(id) ON DELETE CASCADE,
  program_packet_id uuid REFERENCES public.mfo_program_packets(id) ON DELETE CASCADE,
  faculty_id bigint REFERENCES public.faculty(id) ON DELETE SET NULL,
  section_code text NOT NULL REFERENCES public.mfo_section_catalog(section_code),
  caption text,
  activity_date date,
  narrative text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT mfo_documentation_items_parent_chk CHECK (
    (packet_id IS NOT NULL AND program_packet_id IS NULL)
    OR (packet_id IS NULL AND program_packet_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mfo_documentation_packet ON public.mfo_documentation_items (packet_id);
CREATE INDEX IF NOT EXISTS idx_mfo_documentation_section ON public.mfo_documentation_items (section_code);

-- ---------------------------------------------------------------------------
-- Tag existing submission files (additive, nullable — current uploads stay valid)
-- ---------------------------------------------------------------------------

ALTER TABLE public.wf_submission_files
  ADD COLUMN IF NOT EXISTS mfo_section text,
  ADD COLUMN IF NOT EXISTS mfo_indicator text,
  ADD COLUMN IF NOT EXISTS mfo_record_id uuid,
  ADD COLUMN IF NOT EXISTS mfo_packet_id uuid,
  ADD COLUMN IF NOT EXISTS mfo_program_packet_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wf_submission_files_mfo_packet_fk'
  ) THEN
    ALTER TABLE public.wf_submission_files
      ADD CONSTRAINT wf_submission_files_mfo_packet_fk
      FOREIGN KEY (mfo_packet_id) REFERENCES public.mfo_packets(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wf_submission_files_mfo_program_packet_fk'
  ) THEN
    ALTER TABLE public.wf_submission_files
      ADD CONSTRAINT wf_submission_files_mfo_program_packet_fk
      FOREIGN KEY (mfo_program_packet_id) REFERENCES public.mfo_program_packets(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wf_submission_files_mfo_section_fk'
  ) THEN
    ALTER TABLE public.wf_submission_files
      ADD CONSTRAINT wf_submission_files_mfo_section_fk
      FOREIGN KEY (mfo_section) REFERENCES public.mfo_section_catalog(section_code);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wf_submission_files_mfo_section
  ON public.wf_submission_files (mfo_section);
CREATE INDEX IF NOT EXISTS idx_wf_submission_files_mfo_record
  ON public.wf_submission_files (mfo_record_id);
CREATE INDEX IF NOT EXISTS idx_wf_submission_files_mfo_packet
  ON public.wf_submission_files (mfo_packet_id);

COMMENT ON COLUMN public.wf_submission_files.mfo_record_id IS
  'Optional UUID of the MFO child row this file supports. No polymorphic FK.';

-- ---------------------------------------------------------------------------
-- Access helpers (reuse wf_delegated_access / wf_is_final_approver)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mfo_owns_faculty_id(p_faculty_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_faculty_id IS NOT NULL
     AND p_faculty_id::text = (public.wf_current_faculty()).id::text;
$$;

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
  SELECT p IS NOT NULL AND (
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
  SELECT p IS NOT NULL AND (
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
  SELECT p IS NOT NULL AND (
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
  pack public.mfo_packets;
  prog public.mfo_program_packets;
BEGIN
  IF public.wf_is_final_approver() THEN
    RETURN true;
  END IF;
  IF p_packet_id IS NOT NULL THEN
    SELECT * INTO pack FROM public.mfo_packets WHERE id = p_packet_id;
    RETURN public.mfo_can_select_packet(pack);
  END IF;
  IF p_program_packet_id IS NOT NULL THEN
    SELECT * INTO prog FROM public.mfo_program_packets WHERE id = p_program_packet_id;
    RETURN public.mfo_can_select_program_packet(prog);
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
  pack public.mfo_packets;
  prog public.mfo_program_packets;
BEGIN
  IF public.wf_is_final_approver() THEN
    RETURN true;
  END IF;
  IF p_packet_id IS NOT NULL THEN
    SELECT * INTO pack FROM public.mfo_packets WHERE id = p_packet_id;
    RETURN public.mfo_can_write_packet(pack);
  END IF;
  IF p_program_packet_id IS NOT NULL THEN
    SELECT * INTO prog FROM public.mfo_program_packets WHERE id = p_program_packet_id;
    RETURN public.mfo_can_write_program_packet(prog);
  END IF;
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.mfo_section_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_program_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_section_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi1_licensure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi2_employment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi3_enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi4_syllabus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi5_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi6_postgraduate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi7_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_pi8_instructional_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_utilized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_completed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_published ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_research_presented ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_extension_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_extension_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_other_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfo_documentation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfo_section_catalog_select ON public.mfo_section_catalog;
CREATE POLICY mfo_section_catalog_select
ON public.mfo_section_catalog
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS mfo_section_catalog_admin_write ON public.mfo_section_catalog;
CREATE POLICY mfo_section_catalog_admin_write
ON public.mfo_section_catalog
FOR ALL TO authenticated
USING (public.wf_is_final_approver())
WITH CHECK (public.wf_is_final_approver());

DROP POLICY IF EXISTS mfo_packets_select ON public.mfo_packets;
CREATE POLICY mfo_packets_select
ON public.mfo_packets
FOR SELECT TO authenticated
USING (public.mfo_can_select_packet(mfo_packets));

DROP POLICY IF EXISTS mfo_packets_insert ON public.mfo_packets;
CREATE POLICY mfo_packets_insert
ON public.mfo_packets
FOR INSERT TO authenticated
WITH CHECK (
  public.wf_is_final_approver()
  OR public.mfo_owns_faculty_id(faculty_id)
);

DROP POLICY IF EXISTS mfo_packets_update ON public.mfo_packets;
CREATE POLICY mfo_packets_update
ON public.mfo_packets
FOR UPDATE TO authenticated
USING (public.mfo_can_write_packet(mfo_packets))
WITH CHECK (public.mfo_can_write_packet(mfo_packets));

DROP POLICY IF EXISTS mfo_packets_delete ON public.mfo_packets;
CREATE POLICY mfo_packets_delete
ON public.mfo_packets
FOR DELETE TO authenticated
USING (public.wf_is_final_approver());

DROP POLICY IF EXISTS mfo_program_packets_select ON public.mfo_program_packets;
CREATE POLICY mfo_program_packets_select
ON public.mfo_program_packets
FOR SELECT TO authenticated
USING (public.mfo_can_select_program_packet(mfo_program_packets));

DROP POLICY IF EXISTS mfo_program_packets_insert ON public.mfo_program_packets;
CREATE POLICY mfo_program_packets_insert
ON public.mfo_program_packets
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_write_program_packet(mfo_program_packets));

DROP POLICY IF EXISTS mfo_program_packets_update ON public.mfo_program_packets;
CREATE POLICY mfo_program_packets_update
ON public.mfo_program_packets
FOR UPDATE TO authenticated
USING (public.mfo_can_write_program_packet(mfo_program_packets))
WITH CHECK (public.mfo_can_write_program_packet(mfo_program_packets));

DROP POLICY IF EXISTS mfo_program_packets_delete ON public.mfo_program_packets;
CREATE POLICY mfo_program_packets_delete
ON public.mfo_program_packets
FOR DELETE TO authenticated
USING (public.wf_is_final_approver());

-- Snapshots: reviewers may freeze a version they can see; only owners/admin/chair (program) may insert.
DROP POLICY IF EXISTS mfo_snapshots_select ON public.mfo_snapshots;
CREATE POLICY mfo_snapshots_select
ON public.mfo_snapshots
FOR SELECT TO authenticated
USING (public.mfo_can_select_row(packet_id, program_packet_id));

DROP POLICY IF EXISTS mfo_snapshots_insert ON public.mfo_snapshots;
CREATE POLICY mfo_snapshots_insert
ON public.mfo_snapshots
FOR INSERT TO authenticated
WITH CHECK (public.mfo_can_select_row(packet_id, program_packet_id));

DROP POLICY IF EXISTS mfo_snapshots_delete ON public.mfo_snapshots;
CREATE POLICY mfo_snapshots_delete
ON public.mfo_snapshots
FOR DELETE TO authenticated
USING (public.wf_is_final_approver());

DO $$
DECLARE
  t text;
  dual text[] := ARRAY[
    'mfo_section_status',
    'mfo_pi3_enrollment',
    'mfo_pi4_syllabus',
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
  faculty_only text[] := ARRAY[
    'mfo_pi5_certifications',
    'mfo_pi6_postgraduate',
    'mfo_pi7_trainings',
    'mfo_pi8_instructional_materials'
  ];
  program_only text[] := ARRAY[
    'mfo_pi1_licensure',
    'mfo_pi2_employment'
  ];
BEGIN
  FOREACH t IN ARRAY dual LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(%I.packet_id, %I.program_packet_id))',
      t, t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_write_authorized ON public.%I FOR ALL TO authenticated USING (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id)) WITH CHECK (public.mfo_can_write_row(%I.packet_id, %I.program_packet_id))',
      t, t, t, t, t
    );
  END LOOP;

  FOREACH t IN ARRAY faculty_only LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(%I.packet_id, NULL))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_write_authorized ON public.%I FOR ALL TO authenticated USING (public.mfo_can_write_row(%I.packet_id, NULL)) WITH CHECK (public.mfo_can_write_row(%I.packet_id, NULL))',
      t, t, t
    );
  END LOOP;

  FOREACH t IN ARRAY program_only LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfo_select_authorized ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS mfo_write_authorized ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY mfo_select_authorized ON public.%I FOR SELECT TO authenticated USING (public.mfo_can_select_row(NULL, %I.program_packet_id))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY mfo_write_authorized ON public.%I FOR ALL TO authenticated USING (public.mfo_can_write_row(NULL, %I.program_packet_id)) WITH CHECK (public.mfo_can_write_row(NULL, %I.program_packet_id))',
      t, t, t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.mfo_sql_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_safe_pct(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_manhours(numeric, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_owns_faculty_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_packet(public.mfo_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_program_packet(public.mfo_program_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_program_packet(public.mfo_program_packets) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_select_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfo_can_write_row(uuid, uuid) TO authenticated;

GRANT SELECT ON public.mfo_section_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.mfo_packets,
  public.mfo_program_packets,
  public.mfo_section_status,
  public.mfo_snapshots,
  public.mfo_pi1_licensure,
  public.mfo_pi2_employment,
  public.mfo_pi3_enrollment,
  public.mfo_pi4_syllabus,
  public.mfo_pi5_certifications,
  public.mfo_pi6_postgraduate,
  public.mfo_pi7_trainings,
  public.mfo_pi8_instructional_materials,
  public.mfo_research_utilized,
  public.mfo_research_completed,
  public.mfo_research_published,
  public.mfo_research_presented,
  public.mfo_extension_partnerships,
  public.mfo_extension_trainings,
  public.mfo_other_initiatives,
  public.mfo_awards,
  public.mfo_documentation_items
TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'MFO foundation applied. sql_patch_version=012-mfo-structured-data';
END
$$;
