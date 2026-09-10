-- 017_verify_chairperson_visibility.sql
--
-- Read-only verification of the Chairperson visibility rule against live data.
-- Run AFTER 017_chairperson_visibility_rule.sql. Nothing here writes.
--
--     REQUIRED BY WORKFLOW + GRANTED BY ADMIN + WITHIN GRANTED SCOPE
--
-- Queries 1-4 are inspected as an Admin. Queries 5-8 must be run while logged
-- in AS THE CHAIRPERSON (Supabase SQL Editor runs as service role and bypasses
-- RLS, so use the app's browser console for those, or impersonate the role).

-- ===========================================================================
-- 1. Deployed version. Expect 017-chair-visibility.
-- ===========================================================================
SELECT public.wf_chairperson_sql_version() AS chairperson_sql_version;

-- ===========================================================================
-- 2. CONDITION 1 — which tasks require Chairperson review?
--    A task with report_config_id IS NULL requires nothing and will never
--    reach a Chairperson.
-- ===========================================================================
SELECT
    t.id                                        AS task_id,
    t.title,
    t.report_config_id,
    c.requires_chairperson_review               AS config_flag,
    public.wf_task_requires_chairperson(t.id)   AS requires_chairperson,
    CASE
        WHEN t.report_config_id IS NULL THEN 'NO CONFIG LINKED -> routes to final approver'
        WHEN c.requires_chairperson_review IS FALSE THEN 'config explicitly allows direct Admin'
        ELSE 'Chairperson review required'
    END AS interpretation
FROM public.wf_tasks t
LEFT JOIN public.wf_report_configs c ON c.id = t.report_config_id
ORDER BY t.created_at DESC NULLS LAST;

-- ===========================================================================
-- 3. CONDITION 2 + 3 — Admin grants and the scope each one confers.
--    covered_departments is what wf_chairperson_authorized_departments()
--    will return for that grantee.
-- ===========================================================================
SELECT
    d.id                                    AS grant_id,
    d.grantee_name,
    d.grantee_email,
    d.department_codes                      AS explicit_scope,
    public.wf_grant_departments(d)          AS covered_departments,
    d.is_active,
    public.wf_grant_within_dates(d)         AS within_dates,
    CASE
        WHEN d.is_active IS FALSE THEN 'INACTIVE'
        WHEN NOT public.wf_grant_within_dates(d) THEN 'EXPIRED OR NOT YET STARTED'
        WHEN array_length(public.wf_grant_departments(d), 1) IS NULL THEN 'NO USABLE SCOPE'
        ELSE 'USABLE'
    END AS grant_state
FROM public.wf_delegated_access d
ORDER BY d.is_active DESC NULLS LAST, d.id;

-- ===========================================================================
-- 4. CASE B — submissions that require Chairperson review but sit in a
--    department no active grant covers. These are correctly stalled, and each
--    one needs an Admin grant. Expect zero rows in a healthy system.
-- ===========================================================================
SELECT
    s.id                                                AS submission_id,
    f.full_name                                         AS faculty,
    public.wf_faculty_department(f)                      AS department,
    t.title                                             AS task_title,
    s.status,
    public.wf_effective_approval_stage(s)               AS effective_stage,
    'Grant Chairperson access for this department'      AS required_admin_action
FROM public.wf_submissions s
JOIN public.faculty f
  ON f.id::text = s.faculty_id::text
 OR f.auth_user_id::text = s.faculty_id::text
LEFT JOIN public.wf_tasks t ON t.id = s.task_id
WHERE public.wf_submission_needs_chairperson_grant(s)
ORDER BY s.submitted_at DESC NULLS LAST;

-- ===========================================================================
-- 5. Expected visibility matrix, computed independently of RLS.
--
--    For every (chairperson grant x submission) pair this shows whether the
--    submission SHOULD be visible, and why not when it should not. Compare
--    this against what each Chairperson actually sees in the app.
--
--    Scenario coverage:
--      CASE A / E  should_be_visible = true
--      CASE C      blocked_reason = 'task does not require chairperson review'
--      CASE D      blocked_reason = 'outside granted department scope'
--      self-review blocked_reason = 'own submission'
-- ===========================================================================
WITH grants AS (
    SELECT
        d.id AS grant_id,
        d.grantee_name,
        public.wf_grant_departments(d) AS scope,
        (SELECT f.* FROM public.faculty f
          WHERE public.wf_grant_belongs_to_faculty(d, f) LIMIT 1) AS grantee
    FROM public.wf_delegated_access d
    WHERE coalesce((to_jsonb(d)->>'is_active')::boolean, true) IS DISTINCT FROM false
      AND public.wf_grant_within_dates(d)
),
subs AS (
    SELECT
        s.id AS submission_id,
        s.task_id,
        s.status,
        (SELECT f.* FROM public.faculty f
          WHERE f.id::text = s.faculty_id::text
             OR f.auth_user_id::text = s.faculty_id::text
          LIMIT 1) AS submitter
    FROM public.wf_submissions s
)
SELECT
    g.grantee_name                                   AS chairperson,
    g.scope                                          AS granted_scope,
    (sb.submitter).full_name                         AS faculty,
    public.wf_faculty_department((sb.submitter))     AS faculty_department,
    sb.submission_id,
    public.wf_task_requires_chairperson(sb.task_id)  AS requires_chairperson,
    CASE
        WHEN NOT public.wf_task_requires_chairperson(sb.task_id)
            THEN 'task does not require chairperson review'
        WHEN (sb.submitter).id::text = (g.grantee).id::text
            THEN 'own submission'
        WHEN NOT (public.wf_faculty_department((sb.submitter)) = ANY (g.scope))
            THEN 'outside granted department scope'
        ELSE NULL
    END                                              AS blocked_reason,
    (
        public.wf_task_requires_chairperson(sb.task_id)
        AND (sb.submitter).id::text <> (g.grantee).id::text
        AND public.wf_faculty_department((sb.submitter)) = ANY (g.scope)
    )                                                AS should_be_visible
FROM grants g
CROSS JOIN subs sb
WHERE g.grantee IS NOT NULL
  AND sb.submitter IS NOT NULL
ORDER BY g.grantee_name, should_be_visible DESC, sb.submission_id;

-- ===========================================================================
-- 6. RUN AS THE CHAIRPERSON (browser console of the signed-in app):
--
--      await supabase.rpc('wf_list_chairperson_submissions')
--
--    Compare the returned ids against should_be_visible = true above for that
--    chairperson. They must match exactly.
--
--      await supabase.rpc('wf_debug_chairperson_queue')
--
--    empty_reason explains an empty queue: no_matching_grant (Case B),
--    empty_authorized_departments (grant has no department codes), or
--    no_in_scope_chair_required_submissions (nothing to review).
--
-- 7. RUN AS THE CHAIRPERSON — confirm the frontend cannot widen access.
--    A direct select is still RLS-bound, so this must return only submissions
--    the matrix marks visible, plus that chairperson's own:
--
--      await supabase.from('wf_submissions').select('id,faculty_id,status')
--
--    Requesting a Department B submission by id must return no row:
--
--      await supabase.from('wf_submissions').select('*').eq('id','<DEPT_B_ID>')
--
-- 8. RUN AS THE CHAIRPERSON — approval must still be server-checked:
--
--      await supabase.rpc('wf_chairperson_can_review_submission',
--                         { sub: null })   -- signature takes a row type
--
--    Practically: attempt Approve in the UI on an out-of-scope submission id.
--    The wf_prevent_skipping_chairperson trigger and the UPDATE policy on
--    wf_submissions must reject it with 42501.
-- ===========================================================================
