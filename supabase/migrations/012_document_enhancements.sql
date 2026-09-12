-- ============================================================================
-- CITE-FLOW MIGRATION 012: Document Management Enhancements
-- 5 Features: Sub-Categories, Expiry Tracking, Extension Projects,
--             Document Verification, 201 File Report (schema only)
-- ============================================================================

-- Enhancement 1: Sub-categories for "Other" documents
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS sub_category TEXT;

-- Enhancement 2: Expiry date tracking
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Enhancement 4: Document verification workflow
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS verified_by BIGINT;
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS verified_by_name TEXT;
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Enhancement 3: Extension Projects structured tracker
-- NOTE: faculty.id is BIGINT in the live database, so faculty_id must also be BIGINT
CREATE TABLE IF NOT EXISTS public.extension_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id BIGINT REFERENCES public.faculty(id) ON DELETE CASCADE,
    project_title TEXT NOT NULL,
    partner_organization TEXT,
    beneficiary_count INTEGER DEFAULT 0,
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Ongoing', 'Completed')),
    sdg_alignment TEXT[] DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- FK linking documents to extension projects
ALTER TABLE public.faculty_documents ADD COLUMN IF NOT EXISTS extension_project_id UUID REFERENCES public.extension_projects(id) ON DELETE SET NULL;

-- RLS for extension_projects
ALTER TABLE public.extension_projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'extension_projects' AND policyname = 'auth_select_extension_projects') THEN
        CREATE POLICY "auth_select_extension_projects" ON public.extension_projects FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'extension_projects' AND policyname = 'auth_insert_extension_projects') THEN
        CREATE POLICY "auth_insert_extension_projects" ON public.extension_projects FOR INSERT TO authenticated WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'extension_projects' AND policyname = 'auth_update_extension_projects') THEN
        CREATE POLICY "auth_update_extension_projects" ON public.extension_projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'extension_projects' AND policyname = 'auth_delete_extension_projects') THEN
        CREATE POLICY "auth_delete_extension_projects" ON public.extension_projects FOR DELETE TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'extension_projects' AND policyname = 'anon_select_extension_projects') THEN
        CREATE POLICY "anon_select_extension_projects" ON public.extension_projects FOR SELECT TO anon USING (true);
    END IF;
END $$;

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_extension_projects_faculty ON public.extension_projects(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_documents_ext_project ON public.faculty_documents(extension_project_id);
CREATE INDEX IF NOT EXISTS idx_faculty_documents_expiry ON public.faculty_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_faculty_documents_sub_category ON public.faculty_documents(sub_category);
CREATE INDEX IF NOT EXISTS idx_faculty_documents_verification ON public.faculty_documents(verification_status);

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
