-- ============================================================================
-- Migration 011: Add Budget and Funding Source to faculty_research_projects
-- ============================================================================
-- Ensures funding_source and budget columns exist in faculty_research_projects
-- and reloads the PostgREST schema cache.
-- ============================================================================

-- 1. Add funding_source and budget columns if not present
ALTER TABLE public.faculty_research_projects
    ADD COLUMN IF NOT EXISTS funding_source TEXT;

ALTER TABLE public.faculty_research_projects
    ADD COLUMN IF NOT EXISTS budget NUMERIC(14,2);

-- 2. Reload PostgREST schema cache so Supabase immediately recognizes the new columns
NOTIFY pgrst, 'reload schema';
