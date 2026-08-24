-- ==============================================================================
-- Migration 004: Fix Messenger Participant Resolution & Realtime
-- Run this ONCE in your Supabase SQL Editor to fix messaging
-- ==============================================================================

-- 1. Drop ALL foreign key constraints on conversation_participants.user_id
-- These silently block participant inserts when IDs don't exist in auth.users
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'conversation_participants'
          AND con.contype = 'f'
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = rel.oid
                AND a.attnum = ANY(con.conkey)
                AND a.attname = 'user_id'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.conversation_participants DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
        RAISE NOTICE 'Dropped FK constraint: %', constraint_rec.conname;
    END LOOP;
END $$;

-- 2. Drop ALL foreign key constraints on messages.sender_id
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'messages'
          AND con.contype = 'f'
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = rel.oid
                AND a.attnum = ANY(con.conkey)
                AND a.attname = 'sender_id'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
        RAISE NOTICE 'Dropped FK constraint: %', constraint_rec.conname;
    END LOOP;
END $$;

-- 3. Drop ALL foreign key constraints on conversations.created_by
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'conversations'
          AND con.contype = 'f'
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = rel.oid
                AND a.attnum = ANY(con.conkey)
                AND a.attname = 'created_by'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
        RAISE NOTICE 'Dropped FK constraint: %', constraint_rec.conname;
    END LOOP;
END $$;

-- 4. Ensure permissive RLS policies exist (idempotent)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to conversations" ON public.conversations;
CREATE POLICY "Allow all access to conversations" ON public.conversations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to participants" ON public.conversation_participants;
CREATE POLICY "Allow all access to participants" ON public.conversation_participants FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to messages" ON public.messages;
CREATE POLICY "Allow all access to messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);

-- 5. Ensure Realtime is enabled for all messenger tables
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_participants'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
    END IF;
END $$;

-- 6. Set REPLICA IDENTITY to FULL for realtime change detection
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;

-- 7. Auto-link faculty.auth_user_id from auth.users by email (where missing)
UPDATE public.faculty f
SET auth_user_id = au.id
FROM auth.users au
WHERE lower(au.email) = lower(f.email)
AND (f.auth_user_id IS NULL OR f.auth_user_id::text = '');

-- 8. Report results
SELECT 'FACULTY_AUTH_LINKS' as check_type, f.name, f.email, f.auth_user_id,
       CASE WHEN f.auth_user_id IS NOT NULL THEN 'LINKED' ELSE 'UNLINKED' END as status
FROM public.faculty f
ORDER BY f.name;
