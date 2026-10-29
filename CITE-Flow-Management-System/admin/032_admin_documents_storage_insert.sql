-- =============================================================================
-- CITE-Flow 032 — admin-documents Storage INSERT (owned folder only)
--
-- Symptom:
--   Extension PDF/DOC/DOCX in saveDocumentUpload()
--   POST /storage/v1/object/admin-documents/{admin_profiles.id}/{file}
--   HTTP 400  "new row violates row-level security policy"
--   The alert is thrown by uploadToStorage() before admin_documents is inserted.
--
-- Confirmed:
--   Extension photos use admin-accomplishments with the same folder
--   ({auth.uid()}/...) and that upload succeeds. The admin_documents row
--   uses admin_profile_id = that same id, so the table INSERT policy
--   (admin_profile_id = auth.uid()) is not what rejects PDF/DOC/DOCX.
--   A signed-in upload to admin-documents/{auth.uid()}/file.jpg is denied
--   by Storage RLS. This bucket stays the destination for non-photo files.
--
-- This script adds one INSERT policy on storage.objects:
--   bucket admin-documents, folder segment 1 = auth.uid()
--
-- Does NOT:
--   disable RLS
--   use WITH CHECK (true)
--   grant the whole bucket to every authenticated user
--   change admin-accomplishments (working Extension photos)
--   change admin_documents table policies
--   change auth / JWT handling
--
-- Additive and idempotent. Safe to re-run.
-- Run in the Supabase SQL Editor for project: uforealazougjckepggc
-- =============================================================================

DROP POLICY IF EXISTS "admin_documents_storage_insert_own" ON storage.objects;

CREATE POLICY "admin_documents_storage_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'admin-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

SELECT
  policyname,
  cmd,
  roles::text,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname = 'admin_documents_storage_insert_own';
