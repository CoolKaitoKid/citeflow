-- 024_diagnose_mfo_controls.sql
-- Read-only checks after 024_mfo_controls_signature_workflow.sql.
-- Run in the Supabase SQL Editor. Does not change data.

SELECT public.mfo_sql_version() AS mfo_sql_version;

-- 1. Signature columns on the packet
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mfo_packets'
  AND column_name IN ('signature_data_url', 'signature_name', 'signature_signed_at')
ORDER BY column_name;

-- 2. MFO report configurations and Chairperson flag
SELECT
    c.id,
    c.requires_chairperson_review,
    to_jsonb(c) AS full_config_row
FROM public.wf_report_configs c
WHERE to_jsonb(c)::text ILIKE '%mfo%'
   OR to_jsonb(c)::text ILIKE '%accomplishment%'
   OR to_jsonb(c)::text ILIKE '%major final output%'
ORDER BY c.id;

-- 3. MFO tasks: unlinked rows should be empty after 024
SELECT
    t.id AS task_id,
    t.title,
    t.report_config_id,
    public.wf_task_requires_chairperson(t.id) AS requires_chairperson,
    CASE
        WHEN t.report_config_id IS NULL THEN 'UNLINKED'
        WHEN public.wf_task_requires_chairperson(t.id) THEN 'CHAIRPERSON'
        ELSE 'DIRECT_ADMIN'
    END AS route
FROM public.wf_tasks t
WHERE t.title ILIKE '%mfo%'
   OR t.title ILIKE '%accomplishment%'
   OR t.title ILIKE '%major final output%'
ORDER BY t.created_at DESC NULLS LAST
LIMIT 50;

-- 4. RPC is present
SELECT
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('mfo_ensure_task_report_config', 'mfo_ensure_mfo_chairperson_config')
ORDER BY p.proname;
