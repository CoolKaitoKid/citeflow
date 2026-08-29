-- CITE-Flow Settings: academic period + per-user notification preferences
-- Run this in the Supabase SQL Editor.
-- Compatible with an existing system_settings table whose id is UUID.

ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS academic_year TEXT;

ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS semester TEXT;

ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());

ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.system_settings
SET
    academic_year = COALESCE(NULLIF(academic_year, ''), '2026-2027'),
    semester = COALESCE(NULLIF(semester, ''), 'First Semester')
WHERE academic_year IS NULL OR academic_year = '' OR semester IS NULL OR semester = '';

INSERT INTO public.system_settings (id, academic_year, semester)
SELECT gen_random_uuid(), '2026-2027', 'First Semester'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings);

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read system_settings" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated write system_settings" ON public.system_settings;
DROP POLICY IF EXISTS "Users read own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users write own preferences" ON public.user_preferences;

CREATE POLICY "Authenticated read system_settings"
    ON public.system_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write system_settings"
    ON public.system_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users read own preferences"
    ON public.user_preferences FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users write own preferences"
    ON public.user_preferences FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
