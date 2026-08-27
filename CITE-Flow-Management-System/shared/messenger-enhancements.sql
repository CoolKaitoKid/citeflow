-- ==============================================================================
-- CITE-Flow Messenger enhancements
-- Run ONCE in the Supabase SQL Editor (same as supabase/migrations/006_messenger_enhancements.sql).
-- Required for reactions and persisted Delivered receipts.
-- Typing + online/offline already use Realtime Broadcast/Presence (no extra tables).
-- ==============================================================================

ALTER TABLE public.conversation_participants
    ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
    ON public.message_reactions(message_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation
    ON public.message_reactions(conversation_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to message_reactions" ON public.message_reactions;
CREATE POLICY "Allow all access to message_reactions"
    ON public.message_reactions
    FOR ALL
    USING (true)
    WITH CHECK (true);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'message_reactions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
    END IF;
END $$;

ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
