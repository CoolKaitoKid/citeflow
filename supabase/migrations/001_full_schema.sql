-- ==============================================================================
-- CITE-FLOW FRESH DATABASE RESET & MASTER SCHEMA (V2)
-- Thoroughly crafted from complete frontend codebase inspection.
-- Drops all tables, views, triggers, and rebuilds everything with exact column
-- types, relations, indexes, views, and RLS.
-- ==============================================================================

-- 1. DROP ALL OLD OBJECTS IN CORRECT DEPENDENCY ORDER
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user CASCADE;

DROP VIEW IF EXISTS public.directory CASCADE;

DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversation_participants CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;

DROP TABLE IF EXISTS public.wf_delegated_access CASCADE;
DROP TABLE IF EXISTS public.wf_comments CASCADE;
DROP TABLE IF EXISTS public.wf_activity_log CASCADE;
DROP TABLE IF EXISTS public.wf_notifications CASCADE;
DROP TABLE IF EXISTS public.wf_submission_files CASCADE;
DROP TABLE IF EXISTS public.wf_submissions CASCADE;
DROP TABLE IF EXISTS public.wf_task_files CASCADE;
DROP TABLE IF EXISTS public.wf_task_assignments CASCADE;
DROP TABLE IF EXISTS public.wf_tasks CASCADE;

DROP TABLE IF EXISTS public.calendar_event_feedback CASCADE;
DROP TABLE IF EXISTS public.calendar_events CASCADE;

DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.folders CASCADE;

DROP TABLE IF EXISTS public.system_activity_logs CASCADE;
DROP TABLE IF EXISTS public.engagement_logs CASCADE;
DROP TABLE IF EXISTS public.faculty_admin_role_loads CASCADE;
DROP TABLE IF EXISTS public.faculty_advisory_loads CASCADE;
DROP TABLE IF EXISTS public.faculty_documents CASCADE;
DROP TABLE IF EXISTS public.faculty_research_projects CASCADE;
DROP TABLE IF EXISTS public.faculty_teaching_loads CASCADE;

DROP TABLE IF EXISTS public.faculty CASCADE;
DROP TABLE IF EXISTS public.admin_profiles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 2. ENABLE CORE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 3. USER PROFILES & DIRECTORY
-- ==============================================================================

-- Central auth-linked profile for all user accounts
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    role TEXT NOT NULL DEFAULT 'Admin' CHECK (role IN ('Admin', 'Faculty', 'Superadmin', 'Administrator')),
    department TEXT DEFAULT 'BSIT',
    avatar_url TEXT,
    phone TEXT,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Pending')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Admin Profiles (settings, notifications, preferences)
CREATE TABLE public.admin_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT,
    role TEXT DEFAULT 'Administrator',
    department TEXT DEFAULT 'College of Technology and Engineering',
    phone TEXT,
    avatar_url TEXT,
    status TEXT DEFAULT 'Active',
    email_notifications BOOLEAN DEFAULT TRUE,
    system_alerts BOOLEAN DEFAULT TRUE,
    theme_color TEXT DEFAULT '#7b0000',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- Faculty Profiles (academic info, credentials, onboarding)
CREATE TABLE public.faculty (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    employee_id TEXT UNIQUE,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    middle_name TEXT,
    email TEXT UNIQUE NOT NULL,
    existing_email TEXT,
    phone TEXT,
    sex TEXT,
    birthdate DATE,
    department TEXT NOT NULL DEFAULT 'BSIT',
    position TEXT DEFAULT 'Faculty',
    academic_rank TEXT DEFAULT 'Instructor I',
    employment_type TEXT DEFAULT 'Regular/Organic',
    contract_type TEXT DEFAULT 'Permanent',
    educational_qualification TEXT,
    years_experience INT DEFAULT 0,
    eligibility TEXT,
    profile_photo_url TEXT,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'On Leave', 'Archived')),
    role TEXT DEFAULT 'Faculty',
    start_date DATE,
    end_date DATE,
    salary NUMERIC(12,2),
    renewal TEXT,
    profile_completed BOOLEAN DEFAULT FALSE,
    must_change_password BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX idx_faculty_auth_id ON public.faculty(auth_user_id);
CREATE INDEX idx_faculty_employee_id ON public.faculty(employee_id);
CREATE INDEX idx_faculty_email ON public.faculty(email);

-- ==============================================================================
-- 4. MESSENGER SUBSYSTEM
-- ==============================================================================

CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_group BOOLEAN DEFAULT FALSE,
    name TEXT,
    avatar_url TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.conversation_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(conversation_id, user_id)
);

CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    attachment_url TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_participants_user ON public.conversation_participants(user_id);

-- Unified Directory View for User Search in Messenger
CREATE VIEW public.directory AS
SELECT 
    f.auth_user_id AS id,
    f.auth_user_id,
    f.full_name AS name,
    f.full_name AS display_name,
    f.first_name,
    f.last_name,
    f.email,
    f.profile_photo_url AS avatar_url,
    f.department,
    'Faculty' AS role,
    f.position
FROM public.faculty f
WHERE f.auth_user_id IS NOT NULL AND f.status = 'Active'
UNION ALL
SELECT 
    a.id,
    a.id AS auth_user_id,
    COALESCE(NULLIF(TRIM(CONCAT(a.first_name, ' ', a.last_name)), ''), a.email) AS name,
    COALESCE(NULLIF(TRIM(CONCAT(a.first_name, ' ', a.last_name)), ''), a.email) AS display_name,
    a.first_name,
    a.last_name,
    a.email,
    a.avatar_url,
    a.department,
    COALESCE(a.role, 'Administrator') AS role,
    'Administrator' AS position
FROM public.admin_profiles a
WHERE a.status != 'Inactive';

-- ==============================================================================
-- 5. DOCUMENT VAULT
-- ==============================================================================

CREATE TABLE public.folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT DEFAULT 'folder',
    color TEXT DEFAULT '#621708',
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT DEFAULT 0,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX idx_documents_folder ON public.documents(folder_id);

-- ==============================================================================
-- 6. CALENDAR & EVENT FEEDBACK
-- ==============================================================================

CREATE TABLE public.calendar_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    event_type TEXT DEFAULT 'Meeting',
    location TEXT DEFAULT 'TBA',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN DEFAULT FALSE,
    repeat_rule TEXT DEFAULT 'None',
    priority TEXT DEFAULT 'Medium',
    visibility TEXT DEFAULT 'All Faculty',
    visibility_scope TEXT DEFAULT 'all',
    has_survey_links BOOLEAN DEFAULT FALSE,
    pre_survey_url TEXT,
    post_survey_url TEXT,
    requires_feedback BOOLEAN DEFAULT FALSE,
    feedback_due_after_days INT DEFAULT 1,
    feedback_instructions TEXT,
    notes TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.calendar_event_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES public.calendar_events(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE SET NULL,
    faculty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    faculty_name TEXT NOT NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    feedback_text TEXT NOT NULL,
    suggestions TEXT,
    submitted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX idx_event_feedback_event ON public.calendar_event_feedback(event_id);

-- ==============================================================================
-- 7. WORKFLOW APPROVAL & SUBMISSIONS SYSTEM
-- ==============================================================================

CREATE TABLE public.wf_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'General',
    priority TEXT DEFAULT 'Medium',
    due_date TIMESTAMPTZ,
    target_scope TEXT DEFAULT 'all',
    status TEXT DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed', 'Closed', 'Archived')),
    requires_file BOOLEAN DEFAULT TRUE,
    allowed_file_types TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_task_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(task_id, faculty_id)
);

CREATE TABLE public.wf_task_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    remarks TEXT,
    status TEXT DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Under Review', 'Approved', 'Rejected', 'Revisions Requested')),
    admin_feedback TEXT,
    submitted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE(task_id, faculty_id)
);

CREATE TABLE public.wf_submission_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES public.wf_submissions(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT,
    file_size BIGINT,
    mime_type TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE SET NULL,
    submission_id UUID REFERENCES public.wf_submissions(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_name TEXT,
    action TEXT NOT NULL,
    target TEXT,
    log_type TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    author_name TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.wf_delegated_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grantor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    grantee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.wf_tasks(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    granted_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ==============================================================================
-- 8. FACULTY WORKLOAD, RESEARCH, EXTENSION & DOCUMENTS
-- ==============================================================================

CREATE TABLE public.faculty_teaching_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    subject_code TEXT NOT NULL,
    subject_title TEXT NOT NULL,
    section TEXT NOT NULL,
    schedule_day TEXT,
    start_time TEXT,
    end_time TEXT,
    schedule_entries JSONB DEFAULT '[]'::jsonb,
    room TEXT,
    units NUMERIC(4,2) NOT NULL DEFAULT 3.0,
    hours_per_week NUMERIC(4,2) DEFAULT 3.0,
    total_students INT DEFAULT 0,
    regular_students INT DEFAULT 0,
    irregular_students INT DEFAULT 0,
    dropped_students INT DEFAULT 0,
    withdrawn_students INT DEFAULT 0,
    remarks TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.faculty_research_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'Ongoing' CHECK (status IN ('Proposed', 'Ongoing', 'Completed', 'Published', 'Patented')),
    start_date DATE,
    end_date DATE,
    funding_source TEXT,
    budget NUMERIC(14,2),
    file_name TEXT,
    file_url TEXT,
    file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.faculty_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    category TEXT DEFAULT 'Extension',
    title TEXT NOT NULL,
    document_name TEXT,
    document_type TEXT,
    file_name TEXT,
    file_url TEXT NOT NULL,
    file_path TEXT,
    size_bytes BIGINT,
    description TEXT,
    status TEXT DEFAULT 'Submitted',
    uploaded_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.faculty_advisory_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    title TEXT NOT NULL,
    advisees_count INT DEFAULT 1,
    units NUMERIC(4,2) DEFAULT 1.0,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.faculty_admin_role_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    role_title TEXT NOT NULL,
    designation TEXT,
    units NUMERIC(4,2) DEFAULT 3.0,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ==============================================================================
-- 9. ENGAGEMENT & SYSTEM ACTIVITY LOGS
-- ==============================================================================

CREATE TABLE public.engagement_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE SET NULL,
    faculty_name TEXT,
    department TEXT,
    activity_type TEXT NOT NULL,
    activity_title TEXT NOT NULL,
    description TEXT,
    source_module TEXT,
    activity_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    status TEXT DEFAULT 'Completed',
    details JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE public.system_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT,
    user_role TEXT DEFAULT 'Administrator',
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    details_text TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ==============================================================================
-- 10. AUTH TRIGGER: AUTO-PROVISION PROFILES ON SIGNUP
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
    first_name TEXT;
    last_name TEXT;
    full_name TEXT;
    emp_id TEXT;
BEGIN
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'Admin');
    first_name := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
    last_name := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
    full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', TRIM(CONCAT(first_name, ' ', last_name)));
    IF full_name = '' THEN
        full_name := SPLIT_PART(NEW.email, '@', 1);
    END IF;
    emp_id := NEW.raw_user_meta_data->>'employee_id';

    -- Insert into unified profiles
    INSERT INTO public.profiles (id, email, full_name, first_name, last_name, role)
    VALUES (NEW.id, NEW.email, full_name, first_name, last_name, user_role)
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role;

    -- If Admin, provision admin_profiles
    IF user_role IN ('Admin', 'Administrator', 'Superadmin') THEN
        INSERT INTO public.admin_profiles (id, email, first_name, last_name, full_name, role)
        VALUES (NEW.id, NEW.email, first_name, last_name, full_name, user_role)
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- If Faculty, connect auth_user_id
    IF user_role = 'Faculty' THEN
        UPDATE public.faculty
        SET auth_user_id = NEW.id, updated_at = NOW()
        WHERE email = NEW.email OR (emp_id IS NOT NULL AND employee_id = emp_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_delegated_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_teaching_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_research_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_advisory_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_admin_role_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('CREATE POLICY "Allow authenticated full access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('CREATE POLICY "Allow anon read" ON public.%I FOR SELECT TO anon USING (true)', t);
    END LOOP;
END $$;

-- Specific Messenger Security: View only your conversations
DROP POLICY IF EXISTS "Messenger participant messages" ON public.messages;
CREATE POLICY "Messenger participant messages" ON public.messages
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = messages.conversation_id
            AND cp.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = messages.conversation_id
            AND cp.user_id = auth.uid()
        )
    );

-- ==============================================================================
-- 12. REALTIME PUBLICATION SETUP
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE 
    public.messages, 
    public.conversations, 
    public.conversation_participants,
    public.calendar_events,
    public.calendar_event_feedback,
    public.wf_tasks,
    public.wf_submissions,
    public.wf_notifications,
    public.faculty;

-- ==============================================================================
-- 13. STORAGE BUCKETS INITIALIZATION
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public) VALUES 
    ('documents', 'documents', true),
    ('faculty-profile-photos', 'faculty-profile-photos', true),
    ('wf-submissions', 'wf-submissions', true),
    ('wf-attachments', 'wf-attachments', true),
    ('admin-avatars', 'admin-avatars', true),
    ('faculty-documents', 'faculty-documents', true),
    ('faculty-research', 'faculty-research', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public access to bucket files" ON storage.objects;
CREATE POLICY "Public access to bucket files" ON storage.objects 
    FOR SELECT TO public USING (bucket_id IN ('documents', 'faculty-profile-photos', 'wf-submissions', 'wf-attachments', 'admin-avatars', 'faculty-documents', 'faculty-research'));

DROP POLICY IF EXISTS "Authenticated upload access" ON storage.objects;
CREATE POLICY "Authenticated upload access" ON storage.objects 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
