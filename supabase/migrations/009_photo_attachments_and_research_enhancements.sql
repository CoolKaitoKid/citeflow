-- ============================================================================
-- Migration 009: Photo Attachments & Research Enhancements
-- ============================================================================

-- 1. Add photo_attachments JSONB column to faculty_accomplishments
-- Stores array of {title, details, photo_url, description} objects
ALTER TABLE public.faculty_accomplishments
    ADD COLUMN IF NOT EXISTS photo_attachments JSONB DEFAULT '[]'::jsonb;

-- 2. Add venue column to faculty_accomplishments
ALTER TABLE public.faculty_accomplishments
    ADD COLUMN IF NOT EXISTS venue TEXT;
