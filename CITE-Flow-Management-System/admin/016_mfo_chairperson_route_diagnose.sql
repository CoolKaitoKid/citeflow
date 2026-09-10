-- 016_mfo_chairperson_route_diagnose.sql
--
-- Diagnostic + guarded repair for MFO submissions stranded between the
-- Chairperson and the final approver.
--
-- Read-only by default. Nothing is deleted, no policy is changed, no config is
-- invented, and the repair section is commented out until an administrator
-- names the configuration to use.
--
-- WHY A SUBMISSION GETS STRANDED
--
--   public.wf_task_requires_chairperson(task_id) resolves the route from
--   wf_tasks.report_config_id:
--
--       IF flag IS FALSE THEN RETURN false;
--       IF flag IS TRUE  THEN RETURN true;
--       RETURN has_config;          -- false when no config is linked
--
--   So a task with report_config_id IS NULL routes to the final approver.
--   Meanwhile wf_effective_approval_stage() returns a *stored* stage verbatim
--   once it is set, so a submission stamped approval_stage='chairperson' keeps
--   reporting 'chairperson'. The two disagree, and the row becomes invisible to
--   wf_list_chairperson_submissions() and to
--   wf_chairperson_can_browse_submission() while the Admin UI refuses to act on
--   anything still sitting at the 'chairperson' stage.

-- ---------------------------------------------------------------------------
-- 1. Which MFO report configurations exist, and do they require Chairperson
--    review? Columns vary by deployment, so the whole row is returned.
-- ---------------------------------------------------------------------------
SELECT
    c.id,
    c.requires_chairperson_review,
    to_jsonb(c) AS full_config_row
FROM public.wf_report_configs c
WHERE to_jsonb(c)::text ILIKE '%mfo%'
   OR to_jsonb(c)::text ILIKE '%accomplishment%'
   OR to_jsonb(c)::text ILIKE '%major final output%'
ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- 2. Stranded submissions: the stage says Chairperson, the database's routing
--    predicate says otherwise. These are the reports that "disappeared".
-- ---------------------------------------------------------------------------
SELECT
    s.id                                        AS submission_id,
    s.task_id,
    s.faculty_id,
    s.status,
    s.approval_stage                            AS stored_stage,
    public.wf_effective_approval_stage(s)       AS effective_stage,
    public.wf_task_requires_chairperson(s.task_id) AS db_requires_chairperson,
    t.report_config_id,
    t.title                                     AS task_title,
    f.department,
    (SELECT count(*) FROM public.mfo_packets p WHERE p.submission_id = s.id)         AS mfo_packets,
    (SELECT count(*) FROM public.wf_submission_files wsf WHERE wsf.submission_id = s.id) AS evidence_files
FROM public.wf_submissions s
LEFT JOIN public.wf_tasks t ON t.id = s.task_id
LEFT JOIN public.faculty f  ON f.id::text = s.faculty_id::text
WHERE public.wf_effective_approval_stage(s) = 'chairperson'
  AND public.wf_task_requires_chairperson(s.task_id) IS NOT TRUE
ORDER BY s.submitted_at DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 3. MFO tasks with no linked configuration. Every submission created against
--    one of these will strand until the link exists.
-- ---------------------------------------------------------------------------
SELECT
    t.id AS task_id,
    t.title,
    t.report_config_id,
    (SELECT count(*) FROM public.wf_submissions s WHERE s.task_id = t.id) AS submissions
FROM public.wf_tasks t
WHERE t.report_config_id IS NULL
  AND (
      t.title ILIKE '%mfo%'
   OR t.title ILIKE '%accomplishment%'
   OR t.title ILIKE '%major final output%'
  )
ORDER BY t.id;

-- ---------------------------------------------------------------------------
-- 4. Can the intended Chairperson actually receive the work? Authority comes
--    from an active wf_delegated_access grant plus department scope; there is
--    no separate "chairperson task" in this architecture.
-- ---------------------------------------------------------------------------
SELECT
    d.id            AS grant_id,
    d.grantee_name,
    d.grantee_email,
    d.department_codes,
    d.is_active,
    g.department    AS grantee_department,
    public.wf_is_chairperson_role(g)          AS has_chairperson_role,
    public.wf_has_active_chairperson_grant(g) AS grant_is_active
FROM public.wf_delegated_access d
LEFT JOIN public.faculty g
       ON g.id::text = d.grantee_faculty_id::text
       OR g.auth_user_id = d.grantee_auth_user_id
ORDER BY d.is_active DESC, d.id;

-- ---------------------------------------------------------------------------
-- 5. GUARDED REPAIR — intentionally commented out.
--
--    Restores Faculty -> Chairperson -> Admin for already-stranded rows by
--    linking the task to a real configuration. Replace both placeholders with
--    ids taken from queries 1 and 3 above, then run.
--
--    This only sets a foreign key that was left null. It deletes nothing,
--    changes no policy, and re-running it is a no-op.
-- ---------------------------------------------------------------------------
-- BEGIN;
--
-- UPDATE public.wf_tasks
--    SET report_config_id = '<CONFIG_ID_FROM_QUERY_1>'::uuid
--  WHERE id = '<TASK_ID_FROM_QUERY_3>'::uuid
--    AND report_config_id IS NULL;
--
-- -- Confirm the route now resolves to the Chairperson before committing.
-- SELECT
--     s.id,
--     public.wf_effective_approval_stage(s)          AS effective_stage,
--     public.wf_task_requires_chairperson(s.task_id) AS db_requires_chairperson,
--     public.wf_chairperson_can_browse_submission(s) AS chair_can_browse
-- FROM public.wf_submissions s
-- WHERE s.task_id = '<TASK_ID_FROM_QUERY_3>'::uuid;
--
-- -- COMMIT;   -- or ROLLBACK; if db_requires_chairperson is still not true
