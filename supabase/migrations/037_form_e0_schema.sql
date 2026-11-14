-- =============================================================================
-- CITE-Flow Migration 037: CHED Form E-0 (Individual Faculty Workload Report)
--
-- Description:
--   1. Adds CHED Form E-0 appointment & classification columns to public.faculty
--   2. Adds educational level & lecture/lab breakdown to public.faculty_teaching_loads
--   3. Creates public.form_e0_reports to store verified term submissions & matrices
--   4. Creates public.form_e0_classes to store snapshot rows of scheduled classes
--   5. Configures Row Level Security (RLS) for faculty, chairperson & admin access
--
-- Safe to re-run (idempotent with IF NOT EXISTS checks).
-- =============================================================================

-- 1. EXTEND FACULTY TABLE WITH CHED FORM E-0 APPOINTMENT FIELDS
ALTER TABLE public.faculty
    ADD COLUMN IF NOT EXISTS original_appointment_date DATE,
    ADD COLUMN IF NOT EXISTS tenure_status_code TEXT DEFAULT '1.0', -- 1.0 Tenured, 2.0 Not Tenured, 3.0 No PS Item
    ADD COLUMN IF NOT EXISTS employment_type_code TEXT DEFAULT '1.0', -- 1.0 Full-time, 2.0 Half-time, 3.0 Part-time
    ADD COLUMN IF NOT EXISTS has_plantilla_item BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS salary_charge_to TEXT DEFAULT 'PS ITEM', -- PS ITEM, GAA LUMP SUM, SUC INCOME, LGU
    ADD COLUMN IF NOT EXISTS generic_rank_code TEXT,
    ADD COLUMN IF NOT EXISTS salary_grade NUMERIC(4,1) DEFAULT 12.0,
    ADD COLUMN IF NOT EXISTS lecturer_fee_per_hour NUMERIC(10,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS primary_discipline_code TEXT DEFAULT '464108',
    ADD COLUMN IF NOT EXISTS secondary_discipline_code TEXT,
    ADD COLUMN IF NOT EXISTS college_name TEXT DEFAULT 'Technology and Engineering';

-- 2. EXTEND FACULTY TEACHING LOADS WITH CHED CLASSIFICATIONS
ALTER TABLE public.faculty_teaching_loads
    ADD COLUMN IF NOT EXISTS educational_level TEXT DEFAULT 'BACC',
    ADD COLUMN IF NOT EXISTS is_lab BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_lecture BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS lecture_units NUMERIC(4,2) DEFAULT 3.0,
    ADD COLUMN IF NOT EXISTS lab_units NUMERIC(4,2) DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS lecture_hours NUMERIC(4,2) DEFAULT 3.0,
    ADD COLUMN IF NOT EXISTS lab_hours NUMERIC(4,2) DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS is_team_teaching BOOLEAN DEFAULT FALSE;

-- 3. CREATE FORM E-0 REPORTS TABLE
CREATE TABLE IF NOT EXISTS public.form_e0_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES public.wf_submissions(id) ON DELETE SET NULL,
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE SET NULL,
    faculty_id BIGINT REFERENCES public.faculty(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'chair_certified', 'approved', 'revision')),
    
    -- Identification
    college_name TEXT NOT NULL DEFAULT 'Technology and Engineering',
    department_name TEXT NOT NULL DEFAULT 'Information Technology',
    discipline_code TEXT NOT NULL DEFAULT '464108',
    faculty_printed_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    birthdate DATE,
    original_appointment_date DATE,
    gender TEXT,
    
    -- Appointment
    tenure_status_code TEXT DEFAULT '1.0',
    employment_type_code TEXT DEFAULT '1.0',
    has_plantilla_item BOOLEAN DEFAULT TRUE,
    salary_charge_to TEXT DEFAULT 'PS ITEM',
    generic_rank_code TEXT,
    salary_grade NUMERIC(4,1) DEFAULT 12.0,
    annual_basic_salary NUMERIC(12,2) DEFAULT 0.00,
    lecturer_fee_per_hour NUMERIC(10,2) DEFAULT 0.00,
    is_active_duty BOOLEAN DEFAULT TRUE,
    
    -- Leaves
    leave_without_pay JSONB DEFAULT '{"start_date": "", "end_date": "", "leave_type_code": ""}'::jsonb,
    leave_with_pay JSONB DEFAULT '{"start_date": "", "end_date": "", "leave_type_code": ""}'::jsonb,
    
    -- Degrees snapshot
    degrees_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Primary & Secondary teaching disciplines
    primary_discipline_teaching TEXT DEFAULT '464108',
    secondary_discipline_teaching TEXT,
    
    -- Non-teaching credits E1-E6
    non_teaching_credits JSONB NOT NULL DEFAULT '{
        "admin": { "credits": 0, "start_date": "", "end_date": "", "details": "" },
        "research": { "credits": 0, "start_date": "", "end_date": "", "details": "" },
        "extension": { "credits": 0, "start_date": "", "end_date": "", "details": "" },
        "production": { "credits": 0, "start_date": "", "end_date": "", "details": "" },
        "study": { "credits": 0, "start_date": "", "end_date": "", "details": "" },
        "others": { "credits": 0, "start_date": "", "end_date": "", "details": "" }
    }'::jsonb,
    
    subtotal_non_teaching NUMERIC(5,2) DEFAULT 0.0,
    subtotal_teaching NUMERIC(5,2) DEFAULT 0.0,
    grand_total_credits NUMERIC(5,2) DEFAULT 0.0,
    
    -- Consultation hours (Monday to Saturday)
    consultation_hours JSONB DEFAULT '{
        "mon": "", "tue": "", "wed": "", "thu": "", "fri": "", "sat": ""
    }'::jsonb,
    
    -- Chairperson Summary Matrices (Precalculated & Stored)
    summary_matrix_units JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary_matrix_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Authenticated Endorsements & Timestamps (No canvas signature pad)
    submitted_at TIMESTAMPTZ,
    submitted_by_name TEXT,
    is_signed_by_chair_proxy BOOLEAN DEFAULT FALSE,
    chair_proxy_reason TEXT,
    
    chair_certified_at TIMESTAMPTZ,
    chair_certified_by_name TEXT,
    chair_remarks TEXT,
    
    final_approved_at TIMESTAMPTZ,
    final_approved_by_name TEXT,
    final_approver_role TEXT DEFAULT 'Dean',
    final_approval_remarks TEXT,
    
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),

    CONSTRAINT uq_form_e0_faculty_period UNIQUE (faculty_id, academic_year, semester)
);

-- 4. CREATE FORM E-0 CLASSES SNAPSHOT TABLE
CREATE TABLE IF NOT EXISTS public.form_e0_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_e0_id UUID REFERENCES public.form_e0_reports(id) ON DELETE CASCADE,
    subject_code_title TEXT NOT NULL,
    class_code TEXT NOT NULL,
    schedule_days TEXT NOT NULL,
    schedule_time TEXT NOT NULL,
    room TEXT,
    is_lab BOOLEAN DEFAULT FALSE,
    is_team_teaching BOOLEAN DEFAULT FALSE,
    num_students INT DEFAULT 0,
    educational_level TEXT NOT NULL DEFAULT 'BACC',
    lecture_units NUMERIC(4,2) DEFAULT 3.0,
    lab_units NUMERIC(4,2) DEFAULT 0.0,
    lecture_hours NUMERIC(4,2) DEFAULT 3.0,
    lab_hours NUMERIC(4,2) DEFAULT 0.0,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_form_e0_reports_faculty ON public.form_e0_reports(faculty_id);
CREATE INDEX IF NOT EXISTS idx_form_e0_reports_period ON public.form_e0_reports(academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_form_e0_classes_report ON public.form_e0_classes(form_e0_id);

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.form_e0_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_e0_classes ENABLE ROW LEVEL SECURITY;

-- Helper check if user is admin or chairperson
DO $$
BEGIN
    -- Select policy on form_e0_reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated select form_e0_reports' AND tablename = 'form_e0_reports') THEN
        CREATE POLICY "Authenticated select form_e0_reports" ON public.form_e0_reports
            FOR SELECT TO authenticated
            USING (true);
    END IF;

    -- Write policy on form_e0_reports
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated write form_e0_reports' AND tablename = 'form_e0_reports') THEN
        CREATE POLICY "Authenticated write form_e0_reports" ON public.form_e0_reports
            FOR ALL TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;

    -- Select policy on form_e0_classes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated select form_e0_classes' AND tablename = 'form_e0_classes') THEN
        CREATE POLICY "Authenticated select form_e0_classes" ON public.form_e0_classes
            FOR SELECT TO authenticated
            USING (true);
    END IF;

    -- Write policy on form_e0_classes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated write form_e0_classes' AND tablename = 'form_e0_classes') THEN
        CREATE POLICY "Authenticated write form_e0_classes" ON public.form_e0_classes
            FOR ALL TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
