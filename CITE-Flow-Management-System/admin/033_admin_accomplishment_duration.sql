-- Stores accomplishment duration outside the description text.
-- Required so Description can be saved exactly as entered.
-- Safe to re-run. Does not change storage policies or auth.

ALTER TABLE public.admin_accomplishments
    ADD COLUMN IF NOT EXISTS duration_hours numeric;

NOTIFY pgrst, 'reload schema';
