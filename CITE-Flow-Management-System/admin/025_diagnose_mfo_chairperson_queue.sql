-- Read-only checks after 025_mfo_chairperson_queue.sql.
-- Expect:
--   wf_chairperson_sql_version = 025-mfo-chair-queue
--   unlinked MFO tasks = 0 (or only tasks that are not MFO)
--   submitted MFOs with a packet.submission_id

SELECT public.wf_chairperson_sql_version() AS wf_chairperson_sql_version;

SELECT
    t.id,
    t.title,
    t.report_config_id,
    public.wf_task_requires_chairperson(t.id) AS requires_chairperson
FROM public.wf_tasks t
WHERE t.title ILIKE '%mfo%'
   OR t.title ILIKE '%accomplishment%'
   OR t.title ILIKE '%major final output%'
ORDER BY t.created_at DESC NULLS LAST
LIMIT 20;

SELECT
    count(*) FILTER (WHERE p.submission_id IS NULL) AS packets_without_submission,
    count(*) FILTER (WHERE p.submission_id IS NOT NULL) AS packets_linked_to_submission
FROM public.mfo_packets p;

SELECT
    s.id AS submission_id,
    s.status,
    s.approval_stage,
    s.submitted_at,
    t.title AS task_title,
    t.report_config_id,
    p.id AS packet_id,
    p.submission_id AS packet_submission_id
FROM public.wf_submissions s
LEFT JOIN public.wf_tasks t ON t.id = s.task_id
LEFT JOIN public.mfo_packets p
  ON p.submission_id = s.id
  OR (p.task_id = s.task_id AND p.faculty_id::text = s.faculty_id::text)
WHERE s.submitted_at IS NOT NULL
  AND (
    t.title ILIKE '%mfo%'
    OR t.title ILIKE '%accomplishment%'
    OR t.title ILIKE '%major final output%'
    OR p.id IS NOT NULL
  )
ORDER BY s.submitted_at DESC
LIMIT 20;
