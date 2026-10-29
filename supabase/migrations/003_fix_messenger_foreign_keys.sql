-- ==============================================================================
-- Migration 003: Messenger Schema & Realtime Replication Fix
-- Run this in your Supabase SQL Editor
-- ==============================================================================

-- 1. Remove strict foreign keys to allow messaging both Auth users and Faculty IDs
ALTER TABLE IF EXISTS public.conversation_participants 
    DROP CONSTRAINT IF EXISTS conversation_participants_user_id_fkey;

ALTER TABLE IF EXISTS public.messages 
    DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

ALTER TABLE IF EXISTS public.conversations 
    DROP CONSTRAINT IF EXISTS conversations_created_by_fkey;

-- 2. Ensure RLS is enabled with permissive policies for all authenticated/anon users
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to conversations" ON public.conversations;
CREATE POLICY "Allow all access to conversations" ON public.conversations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to participants" ON public.conversation_participants;
CREATE POLICY "Allow all access to participants" ON public.conversation_participants FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to messages" ON public.messages;
CREATE POLICY "Allow all access to messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);

-- 3. Enable Supabase Realtime Replication for instant messaging updates
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
