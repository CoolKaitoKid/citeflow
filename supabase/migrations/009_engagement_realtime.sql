-- Enable Supabase Realtime for Engagement Log source tables.
-- These tables already exist; this only adds them to the existing publication
-- so the admin Engagement Log can refresh without a full page reload.
-- Safe to re-run: existing publication membership is left unchanged.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'engagement_logs',
        'faculty',
        'faculty_accomplishments',
        'faculty_research_projects',
        'faculty_documents',
        'calendar_event_feedback',
        'calendar_events',
        'documents'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t
        ) AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
