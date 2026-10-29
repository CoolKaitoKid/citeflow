-- =============================================================================
-- CITE-Flow 031 — Admin Profile records and storage
--
-- Parent: public.admin_profiles.id (uuid, same value as auth.uid()).
-- Does not alter faculty_* tables, faculty storage policies, or faculty rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_extension_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_profile_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.admin_accomplishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_profile_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    accomplishment_type TEXT DEFAULT 'Seminar',
    description TEXT,
    date_achieved DATE,
    venue TEXT,
    proof_file_url TEXT,
    photo_attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.admin_researches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_profile_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'Ongoing' CHECK (status IN (
        'Proposed', 'Ongoing',
        'Completed but not Published', 'Completed and Published',
        'Completed', 'Published', 'Patented'
    )),
    start_date DATE,
    end_date DATE,
    funding_source TEXT,
    budget NUMERIC(14,2),
    file_name TEXT,
    file_url TEXT,
    file_path TEXT,
    authors JSONB DEFAULT '[]'::jsonb,
    publication_url TEXT,
    media_files JSONB DEFAULT '[]'::jsonb,
    links JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.admin_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_profile_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    document_name TEXT,
    document_type TEXT,
    description TEXT,
    file_name TEXT,
    file_url TEXT,
    file_path TEXT,
    media_files JSONB DEFAULT '[]'::jsonb,
    sub_category TEXT,
    expiry_date DATE,
    extension_project_id UUID REFERENCES public.admin_extension_projects(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'Submitted',
    verification_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_admin_extension_projects_owner ON public.admin_extension_projects(admin_profile_id);
CREATE INDEX IF NOT EXISTS idx_admin_accomplishments_owner ON public.admin_accomplishments(admin_profile_id);
CREATE INDEX IF NOT EXISTS idx_admin_researches_owner ON public.admin_researches(admin_profile_id);
CREATE INDEX IF NOT EXISTS idx_admin_documents_owner ON public.admin_documents(admin_profile_id);
CREATE INDEX IF NOT EXISTS idx_admin_documents_project ON public.admin_documents(extension_project_id);

ALTER TABLE public.admin_extension_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_accomplishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_researches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'admin_extension_projects',
        'admin_accomplishments',
        'admin_researches',
        'admin_documents'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_own', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_own', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_own', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_own', t);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (admin_profile_id = auth.uid())',
            t || '_select_own', t
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (admin_profile_id = auth.uid())',
            t || '_insert_own', t
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (admin_profile_id = auth.uid()) WITH CHECK (admin_profile_id = auth.uid())',
            t || '_update_own', t
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (admin_profile_id = auth.uid())',
            t || '_delete_own', t
        );
    END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
    ('admin-accomplishments', 'admin-accomplishments', true, 5242880),
    ('admin-researches', 'admin-researches', true, 26214400),
    ('admin-documents', 'admin-documents', true, 26214400)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_owns_storage_folder(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL
       AND p_name IS NOT NULL
       AND btrim(p_name) <> ''
       AND EXISTS (
           SELECT 1
           FROM public.admin_profiles ap
           WHERE ap.id = auth.uid()
             AND p_name LIKE (ap.id::text || '/%')
       );
$$;

REVOKE ALL ON FUNCTION public.admin_owns_storage_folder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_owns_storage_folder(text) TO authenticated;

DROP POLICY IF EXISTS "admin_profile_storage_select" ON storage.objects;
CREATE POLICY "admin_profile_storage_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id IN ('admin-accomplishments', 'admin-researches', 'admin-documents'));

DROP POLICY IF EXISTS "admin_profile_storage_insert_own" ON storage.objects;
CREATE POLICY "admin_profile_storage_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id IN ('admin-accomplishments', 'admin-researches', 'admin-documents')
    AND public.admin_owns_storage_folder(name)
);

DROP POLICY IF EXISTS "admin_profile_storage_delete_own" ON storage.objects;
CREATE POLICY "admin_profile_storage_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id IN ('admin-accomplishments', 'admin-researches', 'admin-documents')
    AND public.admin_owns_storage_folder(name)
);

NOTIFY pgrst, 'reload schema';
