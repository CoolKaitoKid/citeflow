-- ============================================================================
-- Migration 028: Add media_files and links to faculty_research_projects
-- ============================================================================

ALTER TABLE public.faculty_research_projects
    ADD COLUMN IF NOT EXISTS media_files JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.faculty_research_projects
    ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.faculty_research_projects.media_files IS 'Array of media attachment objects: [{name, url, path, size, type}]';
COMMENT ON COLUMN public.faculty_research_projects.links IS 'Array of reference link objects: [{url, label}]';
