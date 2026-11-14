-- 038: Faculty designation (free-text title entered during onboarding,
-- e.g. "Program Coordinator", "OJT Coordinator"). Separate from role and academic rank.
ALTER TABLE public.faculty
    ADD COLUMN IF NOT EXISTS designation TEXT;

NOTIFY pgrst, 'reload schema';
