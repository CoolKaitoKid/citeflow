-- ==============================================================================
-- Migration 005: Add UNIQUE constraint on faculty.auth_user_id
-- Required for onboarding upsert to work correctly
-- ==============================================================================

-- First, clean up any duplicate auth_user_id entries (keep the newest one)
DELETE FROM public.faculty a
USING public.faculty b
WHERE a.auth_user_id IS NOT NULL
  AND a.auth_user_id = b.auth_user_id
  AND a.updated_at < b.updated_at;

-- Drop existing non-unique index
DROP INDEX IF EXISTS idx_faculty_auth_id;

-- Add UNIQUE constraint (this also creates an index)
ALTER TABLE public.faculty
ADD CONSTRAINT faculty_auth_user_id_unique UNIQUE (auth_user_id);

-- Verify
SELECT 'FACULTY_UNIQUE_CHECK' as check_type, 
       conname as constraint_name, 
       contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'public.faculty'::regclass 
AND conname = 'faculty_auth_user_id_unique';
