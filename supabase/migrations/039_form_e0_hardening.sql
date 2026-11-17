-- =============================================================================
-- CITE-Flow Migration 039: CHED Form E-0 hardening (CTU template alignment)
--
-- Description:
--   1. Adds the name-part and revision columns the Form E-0 studio saves.
--   2. Normalizes CHED code values ('1.0' -> '1') and removes placeholder
--      defaults (salary grade 12.0, etc.) so blank fields export blank.
--   3. Adds CHED lookup tables: generic faculty rank codes and 6-digit
--      discipline codes (IT family seeded).
--   4. Replaces the permissive "USING (true)" RLS policies with
--      owner / chairperson-in-scope / final-approver rules.
--   5. Adds a trigger that enforces the approval chain:
--        draft|revision -> submitted            (owner or chair proxy)
--        submitted      -> chair_certified      (chair in scope, NOT own form)
--        submitted|chair_certified -> approved  (Dean / Secretary / Admin)
--        submitted|chair_certified -> revision  (reviewer)
--
-- Depends on helpers from 010/011/027 (wf_current_faculty, wf_is_final_approver,
-- wf_has_active_chairperson_grant, wf_chairperson_authorized_departments,
-- wf_faculty_department).
-- Safe to re-run.
-- =============================================================================

-- 1. COLUMNS -------------------------------------------------------------------
ALTER TABLE public.form_e0_reports
    ADD COLUMN IF NOT EXISTS faculty_last_name TEXT,
    ADD COLUMN IF NOT EXISTS faculty_first_name TEXT,
    ADD COLUMN IF NOT EXISTS faculty_middle_initial TEXT,
    ADD COLUMN IF NOT EXISTS revision_remarks TEXT,
    ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revision_requested_by_name TEXT;

-- 2. CODE NORMALIZATION & PLACEHOLDER DEFAULTS --------------------------------
UPDATE public.form_e0_reports
   SET tenure_status_code = regexp_replace(tenure_status_code, '\.0+$', '')
 WHERE tenure_status_code ~ '^\d+\.0+$';
UPDATE public.form_e0_reports
   SET employment_type_code = regexp_replace(employment_type_code, '\.0+$', '')
 WHERE employment_type_code ~ '^\d+\.0+$';
UPDATE public.faculty
   SET tenure_status_code = regexp_replace(tenure_status_code, '\.0+$', '')
 WHERE tenure_status_code ~ '^\d+\.0+$';
UPDATE public.faculty
   SET employment_type_code = regexp_replace(employment_type_code, '\.0+$', '')
 WHERE employment_type_code ~ '^\d+\.0+$';

ALTER TABLE public.form_e0_reports
    ALTER COLUMN tenure_status_code SET DEFAULT '1',
    ALTER COLUMN employment_type_code SET DEFAULT '1',
    ALTER COLUMN salary_grade DROP DEFAULT,
    ALTER COLUMN annual_basic_salary DROP DEFAULT,
    ALTER COLUMN lecturer_fee_per_hour DROP DEFAULT;

ALTER TABLE public.faculty
    ALTER COLUMN tenure_status_code SET DEFAULT '1',
    ALTER COLUMN employment_type_code SET DEFAULT '1',
    ALTER COLUMN salary_grade DROP DEFAULT,
    ALTER COLUMN lecturer_fee_per_hour DROP DEFAULT;

-- Teaching-load placeholders (3 units / 3 hours on every row) skew the matrices.
ALTER TABLE public.form_e0_classes
    ALTER COLUMN lecture_units SET DEFAULT 0,
    ALTER COLUMN lecture_hours SET DEFAULT 0;

-- 3. LOOKUP TABLES --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ched_generic_rank_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.ched_generic_rank_codes (code, label, sort_order) VALUES
    ('09', 'Teaching Fellow / Teaching Associate', 1),
    ('10', 'Teacher / Master Teacher', 2),
    ('11', 'Lecturer / Senior Lecturer / Professorial Lecturer', 3),
    ('12', 'Professor Emeritus', 4),
    ('13', 'Visiting Professor', 5),
    ('14', 'Adjunct / Affiliate Faculty', 6),
    ('20', 'Instructor', 7),
    ('30', 'Assistant Professor', 8),
    ('40', 'Associate Professor', 9),
    ('50', 'Professor (incl. University Professor)', 10),
    ('90', 'Others', 11)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.ched_discipline_codes (
    code TEXT PRIMARY KEY CHECK (code ~ '^\d{6}$'),
    label TEXT NOT NULL
);

INSERT INTO public.ched_discipline_codes (code, label) VALUES
    ('464101', 'Computer Science'),
    ('464102', 'Computer Data Processing Management'),
    ('464104', 'Computer Technology'),
    ('464105', 'Information and Computer Science'),
    ('464106', 'Computer Applications'),
    ('464107', 'Information Management'),
    ('464108', 'Information Technology')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

ALTER TABLE public.ched_generic_rank_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ched_discipline_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read ched_generic_rank_codes" ON public.ched_generic_rank_codes;
CREATE POLICY "Read ched_generic_rank_codes" ON public.ched_generic_rank_codes
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin write ched_generic_rank_codes" ON public.ched_generic_rank_codes;
CREATE POLICY "Admin write ched_generic_rank_codes" ON public.ched_generic_rank_codes
    FOR ALL TO authenticated USING (public.wf_is_final_approver()) WITH CHECK (public.wf_is_final_approver());

DROP POLICY IF EXISTS "Read ched_discipline_codes" ON public.ched_discipline_codes;
CREATE POLICY "Read ched_discipline_codes" ON public.ched_discipline_codes
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin write ched_discipline_codes" ON public.ched_discipline_codes;
CREATE POLICY "Admin write ched_discipline_codes" ON public.ched_discipline_codes
    FOR ALL TO authenticated USING (public.wf_is_final_approver()) WITH CHECK (public.wf_is_final_approver());

-- 4. ACCESS HELPERS ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.form_e0_is_owner(p_faculty_id BIGINT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_faculty_id IS NOT NULL
     AND (public.wf_current_faculty()).id = p_faculty_id;
$$;

CREATE OR REPLACE FUNCTION public.form_e0_chair_in_scope(p_faculty_id BIGINT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair public.faculty;
  submitter public.faculty;
  authorized text[];
  submitter_dept text;
BEGIN
  IF auth.uid() IS NULL OR p_faculty_id IS NULL THEN
    RETURN false;
  END IF;

  chair := public.wf_current_faculty();
  IF chair IS NULL OR NOT public.wf_has_active_chairperson_grant(chair) THEN
    RETURN false;
  END IF;

  authorized := public.wf_chairperson_authorized_departments(chair);
  IF authorized IS NULL OR array_length(authorized, 1) IS NULL THEN
    RETURN false;
  END IF;

  SELECT f.* INTO submitter FROM public.faculty f WHERE f.id = p_faculty_id LIMIT 1;
  IF submitter IS NULL THEN
    RETURN false;
  END IF;

  submitter_dept := public.wf_faculty_department(submitter);
  RETURN submitter_dept <> '' AND submitter_dept = ANY (authorized);
END;
$$;

CREATE OR REPLACE FUNCTION public.form_e0_can_read(p_faculty_id BIGINT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.form_e0_is_owner(p_faculty_id)
      OR public.form_e0_chair_in_scope(p_faculty_id)
      OR public.wf_is_final_approver();
$$;

CREATE OR REPLACE FUNCTION public.form_e0_report_faculty(p_report_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT faculty_id FROM public.form_e0_reports WHERE id = p_report_id;
$$;

CREATE OR REPLACE FUNCTION public.form_e0_report_status(p_report_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status FROM public.form_e0_reports WHERE id = p_report_id;
$$;

-- Who may edit the class schedule of a report: the owner (or a chair filling it
-- in on behalf of an absent faculty member) while it is still a draft/revision;
-- final approvers at any time.
CREATE OR REPLACE FUNCTION public.form_e0_can_edit_classes(p_report_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.wf_is_final_approver()
      OR (
        coalesce(public.form_e0_report_status(p_report_id), 'draft') IN ('draft', 'revision')
        AND (
          public.form_e0_is_owner(public.form_e0_report_faculty(p_report_id))
          OR public.form_e0_chair_in_scope(public.form_e0_report_faculty(p_report_id))
        )
      );
$$;

-- 5. RLS POLICIES -------------------------------------------------------------------
ALTER TABLE public.form_e0_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_e0_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated select form_e0_reports" ON public.form_e0_reports;
DROP POLICY IF EXISTS "Authenticated write form_e0_reports" ON public.form_e0_reports;
DROP POLICY IF EXISTS "Authenticated select form_e0_classes" ON public.form_e0_classes;
DROP POLICY IF EXISTS "Authenticated write form_e0_classes" ON public.form_e0_classes;

DROP POLICY IF EXISTS "form_e0_reports_select" ON public.form_e0_reports;
CREATE POLICY "form_e0_reports_select" ON public.form_e0_reports
    FOR SELECT TO authenticated
    USING (public.form_e0_can_read(faculty_id));

DROP POLICY IF EXISTS "form_e0_reports_insert" ON public.form_e0_reports;
CREATE POLICY "form_e0_reports_insert" ON public.form_e0_reports
    FOR INSERT TO authenticated
    WITH CHECK (
        status IN ('draft', 'submitted')
        AND (
            public.form_e0_is_owner(faculty_id)
            OR public.form_e0_chair_in_scope(faculty_id)
            OR public.wf_is_final_approver()
        )
    );

DROP POLICY IF EXISTS "form_e0_reports_update" ON public.form_e0_reports;
CREATE POLICY "form_e0_reports_update" ON public.form_e0_reports
    FOR UPDATE TO authenticated
    USING (public.form_e0_can_read(faculty_id))
    WITH CHECK (public.form_e0_can_read(faculty_id));

DROP POLICY IF EXISTS "form_e0_reports_delete" ON public.form_e0_reports;
CREATE POLICY "form_e0_reports_delete" ON public.form_e0_reports
    FOR DELETE TO authenticated
    USING (public.wf_is_final_approver());

DROP POLICY IF EXISTS "form_e0_classes_select" ON public.form_e0_classes;
CREATE POLICY "form_e0_classes_select" ON public.form_e0_classes
    FOR SELECT TO authenticated
    USING (public.form_e0_can_read(public.form_e0_report_faculty(form_e0_id)));

DROP POLICY IF EXISTS "form_e0_classes_insert" ON public.form_e0_classes;
CREATE POLICY "form_e0_classes_insert" ON public.form_e0_classes
    FOR INSERT TO authenticated
    WITH CHECK (public.form_e0_can_edit_classes(form_e0_id));

DROP POLICY IF EXISTS "form_e0_classes_update" ON public.form_e0_classes;
CREATE POLICY "form_e0_classes_update" ON public.form_e0_classes
    FOR UPDATE TO authenticated
    USING (public.form_e0_can_edit_classes(form_e0_id))
    WITH CHECK (public.form_e0_can_edit_classes(form_e0_id));

DROP POLICY IF EXISTS "form_e0_classes_delete" ON public.form_e0_classes;
CREATE POLICY "form_e0_classes_delete" ON public.form_e0_classes
    FOR DELETE TO authenticated
    USING (public.form_e0_can_edit_classes(form_e0_id));

-- 6. APPROVAL-CHAIN GUARD -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.form_e0_guard_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_final boolean := public.wf_is_final_approver();
  is_owner boolean := public.form_e0_is_owner(OLD.faculty_id);
  is_chair boolean := public.form_e0_chair_in_scope(OLD.faculty_id);
BEGIN
  NEW.updated_at := timezone('utc', now());

  IF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id
     OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
     OR NEW.semester IS DISTINCT FROM OLD.semester THEN
    IF NOT is_final THEN
      RAISE EXCEPTION 'Form E-0: faculty and term cannot be changed after creation.';
    END IF;
  END IF;

  -- Dean / Secretary / Admin may do anything.
  IF is_final THEN
    RETURN NEW;
  END IF;

  -- Content edits while still editable (owner, or chair filling in for absent faculty).
  IF OLD.status IN ('draft', 'revision') THEN
    IF NOT (is_owner OR is_chair) THEN
      RAISE EXCEPTION 'Form E-0: you cannot edit this report.';
    END IF;
    IF NEW.status NOT IN ('draft', 'revision', 'submitted') THEN
      RAISE EXCEPTION 'Form E-0: a draft can only be saved or submitted.';
    END IF;
    IF NEW.chair_certified_at IS DISTINCT FROM OLD.chair_certified_at
       OR NEW.chair_certified_by_name IS DISTINCT FROM OLD.chair_certified_by_name
       OR NEW.final_approved_at IS DISTINCT FROM OLD.final_approved_at
       OR NEW.final_approved_by_name IS DISTINCT FROM OLD.final_approved_by_name THEN
      RAISE EXCEPTION 'Form E-0: endorsements can only be recorded by reviewers.';
    END IF;
    RETURN NEW;
  END IF;

  -- Chairperson certification of a submitted report.
  IF OLD.status = 'submitted' AND NEW.status IN ('chair_certified', 'revision') THEN
    IF NOT is_chair THEN
      RAISE EXCEPTION 'Form E-0: only the department chairperson can certify this report.';
    END IF;
    IF is_owner THEN
      RAISE EXCEPTION 'Form E-0: a chairperson cannot certify their own report. It goes to the Dean.';
    END IF;
    IF NEW.final_approved_at IS DISTINCT FROM OLD.final_approved_at
       OR NEW.final_approved_by_name IS DISTINCT FROM OLD.final_approved_by_name THEN
      RAISE EXCEPTION 'Form E-0: final approval is reserved for the Dean.';
    END IF;
    RETURN NEW;
  END IF;

  -- Owner may pull back a submission that nobody has acted on yet.
  IF OLD.status = 'submitted' AND NEW.status = 'draft' AND is_owner THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Form E-0: status change % -> % is not allowed for your role.', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_e0_guard_transition ON public.form_e0_reports;
CREATE TRIGGER trg_form_e0_guard_transition
    BEFORE UPDATE ON public.form_e0_reports
    FOR EACH ROW EXECUTE FUNCTION public.form_e0_guard_transition();

GRANT EXECUTE ON FUNCTION public.form_e0_is_owner(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.form_e0_chair_in_scope(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.form_e0_can_read(BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
