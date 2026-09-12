/**
 * CITE-Flow shared workflow helpers
 * Single source of truth for submission review stages, status labels, and Supabase utilities.
 */
(function initCiteFlowWorkflow(global) {
    'use strict';

    const VALID_DB_STATUSES = new Set([
        'notsubmitted', 'submitted', 'late', 'underreview', 'approved', 'rejected', 'revision'
    ]);

    const APPROVAL_STAGES = {
        CHAIRPERSON: 'chairperson',
        FINAL: 'final_approver',
        APPROVED: 'approved',
        REVISION: 'revision',
        DECLINED: 'declined'
    };

    let workflowChannel = null;
    let debounceTimer = null;

    function getSupabaseClient() {
        if (global.CiteFlowAuth?.ensureSharedClient) {
            const shared = global.CiteFlowAuth.ensureSharedClient();
            if (shared) return shared;
        }
        if (global.supabaseClient) return global.supabaseClient;
        if (global.db) return global.db;
        const url = global.__SUPABASE_URL__;
        const key = global.__SUPABASE_ANON__;
        if (global.supabase?.createClient && url && key) {
            const options = global.CiteFlowAuth?.AUTH_CLIENT_OPTIONS || {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            };
            global.supabaseClient = global.supabase.createClient(url, key, options);
            return global.supabaseClient;
        }
        return null;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }

    function normalizeText(value) {
        return String(value ?? '').trim().toLowerCase();
    }

    /**
     * Standard document categories. Internal values follow the live
     * wf_report_configs.report_name / wf_tasks.title convention (DTR, LDP, Syllabus).
     * TOS is stored as "TOS" and displayed as "Table of Specifications (TOS)".
     */
    const DOCUMENT_CATEGORIES = [
        { value: 'DTR', label: 'DTR' },
        { value: 'LDP', label: 'LDP' },
        { value: 'Syllabus', label: 'Syllabus' },
        { value: 'IPCR', label: 'IPCR' },
        { value: 'TOS', label: 'Table of Specifications (TOS)' },
        { value: 'MFO', label: 'MFO (Accomplishment Report)' }
    ];

    const QUICK_SUBMISSION_CATEGORY_VALUES = ['Syllabus', 'DTR', 'TOS', 'IPCR', 'LDP'];

    const DOCUMENT_CATEGORY_VALUES = DOCUMENT_CATEGORIES.map((item) => item.value);

    function getDocumentCategories() {
        return DOCUMENT_CATEGORIES.slice();
    }

    function getQuickSubmissionCategories() {
        return QUICK_SUBMISSION_CATEGORY_VALUES.map((value) => {
            const found = DOCUMENT_CATEGORIES.find((item) => item.value === value);
            return {
                value,
                label: found ? found.label : value,
                shortLabel: value === 'TOS' ? 'TOS' : value
            };
        });
    }

    function tokenizeCategorySource(value) {
        return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);
    }

    function resolveDocumentCategory(source) {
        if (source && typeof source === 'object') {
            const explicit = source.document_category || source.category || source.report_name;
            const fromExplicit = resolveDocumentCategory(explicit);
            if (fromExplicit) return fromExplicit;
            source = source.title || source.name || source.folder_name || '';
        }

        const raw = String(source ?? '').trim();
        if (!raw) return '';
        const lower = normalizeText(raw);

        for (const cat of DOCUMENT_CATEGORIES) {
            const value = normalizeText(cat.value);
            const label = normalizeText(cat.label);
            if (lower === value || lower === label) return cat.value;
        }

        if (lower.includes('table of specifications')) return 'TOS';
        if (lower.includes('major final output')) return 'MFO';

        const tokens = tokenizeCategorySource(raw);
        for (const cat of DOCUMENT_CATEGORIES) {
            if (tokens.includes(normalizeText(cat.value))) return cat.value;
        }

        return '';
    }

    function formatDocumentCategory(value) {
        const resolved = resolveDocumentCategory(value);
        if (resolved) {
            const found = DOCUMENT_CATEGORIES.find((item) => item.value === resolved);
            if (found) return found.label;
        }
        if (value && typeof value === 'object') {
            return String(value.report_name || value.title || value.name || '').trim();
        }
        return String(value ?? '').trim();
    }

    function matchesDocumentCategory(source, categoryValue) {
        if (!categoryValue) return true;
        return resolveDocumentCategory(source) === categoryValue;
    }

    function documentCategoryOptionsHtml(selectedValue, options) {
        const opts = options || {};
        const selected = String(selectedValue || '');
        const parts = [];
        if (opts.includeAll) {
            parts.push(`<option value=""${selected === '' ? ' selected' : ''}>All Categories</option>`);
        }
        if (opts.includeCustom) {
            const isKnown = DOCUMENT_CATEGORY_VALUES.includes(selected);
            const isCustom = selected === 'custom' || (selected !== '' && !isKnown);
            parts.push(`<option value="custom"${isCustom ? ' selected' : ''}>Custom</option>`);
        }
        DOCUMENT_CATEGORIES.forEach((cat) => {
            parts.push(
                `<option value="${escapeHtml(cat.value)}"${selected === cat.value ? ' selected' : ''}>${escapeHtml(cat.label)}</option>`
            );
        });
        return parts.join('');
    }

    function ensureTitleReflectsCategory(title, categoryValue) {
        if (!categoryValue || categoryValue === 'custom') return String(title || '').trim();
        const label = formatDocumentCategory(categoryValue);
        const trimmed = String(title || '').trim();
        if (!trimmed) return label;
        if (resolveDocumentCategory(trimmed) === categoryValue) return trimmed;
        return `${label} — ${trimmed}`;
    }

    function normalizeRoleValue(role) {
        const r = normalizeText(role);
        if (!r) return '';
        if (r === 'administrator' || r === 'admin') return 'admin';
        if (r === 'dean') return 'dean';
        if (r.includes('secretary') || r === 'college secretary') return 'college_secretary';
        if (r.includes('chair')) return 'chairperson';
        if (r === 'faculty') return 'faculty';
        return r;
    }

    function normalizeFaculty(row) {
        if (!row) return null;
        const dept = row.department_code || row.department || 'N/A';
        const role = normalizeRoleValue(row.role || row.position || '');
        const status = normalizeText(row.status || 'active');
        return {
            ...row,
            id: row.id,
            auth_user_id: row.auth_user_id || null,
            full_name: row.full_name || row.name || [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Faculty Member',
            department_code: dept,
            department: dept,
            role,
            raw_role: row.role || row.position || '',
            admin_access: row.admin_access === true,
            is_active: row.access_enabled !== false && (status === 'active' || status === ''),
            employee_id: row.employee_id || row.faculty_id || null
        };
    }

    function normalizeRole(faculty) {
        if (!faculty) return { role: '', admin_access: false };
        const fromRole = normalizeRoleValue(faculty.role);
        const fromPosition = normalizeRoleValue(faculty.position || faculty.raw_role);
        const role = fromRole === 'chairperson' || fromPosition === 'chairperson'
            ? 'chairperson'
            : (fromRole || fromPosition);
        return {
            role,
            admin_access: faculty.admin_access === true
        };
    }

    function isChairperson(faculty) {
        if (!faculty) return false;
        if (normalizeRole(faculty).role === 'chairperson') return true;
        return /chair/i.test(String(
            faculty.role || faculty.position || faculty.raw_role || ''
        ));
    }

    function isWorkflowAdmin(faculty) {
        if (!faculty) return false;
        const { role } = normalizeRole(faculty);
        return role === 'admin' || role === 'dean' || role === 'college_secretary' ||
            role === 'administrator' || role === 'superadmin';
    }

    function isFinalApprover(faculty) {
        return isWorkflowAdmin(faculty);
    }

    function sameDepartment(a, b) {
        if (!a || !b) return false;
        return normalizeText(a.department_code || a.department) === normalizeText(b.department_code || b.department);
    }

    function facultyDepartmentCode(faculty) {
        return normalizeText(faculty?.department_code || faculty?.department || '');
    }

    function parseDepartmentCodes(value) {
        if (Array.isArray(value)) {
            return value.map((code) => normalizeText(code)).filter(Boolean);
        }
        if (value == null || value === '') return [];
        return String(value)
            .replace(/^{|}$/g, '')
            .split(',')
            .map((code) => normalizeText(code.replace(/^"|"$/g, '')))
            .filter(Boolean);
    }

    function grantIsActive(grant) {
        return !!(grant && grant.is_active !== false);
    }

    function grantMatchesChairperson(grant, faculty) {
        if (!grantIsActive(grant) || !faculty) return false;

        const facultyId = faculty.id != null ? String(faculty.id) : '';
        const grantFacultyId = grant.grantee_faculty_id || grant.faculty_id;
        if (facultyId && grantFacultyId != null && String(grantFacultyId) === facultyId) return true;

        const authId = faculty.auth_user_id ? String(faculty.auth_user_id) : '';
        const grantAuthId = grant.grantee_auth_user_id;
        if (authId && grantAuthId != null && String(grantAuthId) === authId) return true;

        const grantName = normalizeText(grant.grantee_name);
        const facultyName = normalizeText(faculty.full_name || faculty.name);
        if (grantName && facultyName && (grantName === facultyName || grantName.includes(facultyName) || facultyName.includes(grantName))) return true;

        const grantEmail = normalizeText(grant.grantee_email || grant.email);
        const facultyEmail = normalizeText(faculty.email || faculty.existing_email);
        if (grantEmail && facultyEmail && grantEmail === facultyEmail) return true;

        return false;
    }

    function getChairpersonGrant(faculty, delegatedAccess) {
        const grants = Array.isArray(delegatedAccess) ? delegatedAccess : [];
        return grants.find((grant) => grantMatchesChairperson(grant, faculty)) || null;
    }

    function matchingChairpersonGrants(faculty, delegatedAccess) {
        const grants = Array.isArray(delegatedAccess) ? delegatedAccess : [];
        return grants.filter((grant) => grantMatchesChairperson(grant, faculty));
    }

    function hasChairpersonWorkflowAccess(faculty, delegatedAccess) {
        if (!faculty) return false;
        if (isChairperson(faculty)) return true;
        if (isWorkflowAdmin(faculty)) return true;
        return matchingChairpersonGrants(faculty, delegatedAccess).length > 0;
    }

    function chairpersonAuthorizedDepartments(faculty, delegatedAccess) {
        if (!hasChairpersonWorkflowAccess(faculty, delegatedAccess)) return [];
        const fromGrants = matchingChairpersonGrants(faculty, delegatedAccess)
            .flatMap((grant) => parseDepartmentCodes(grant.department_codes))
            .filter(Boolean);
        const unique = [...new Set(fromGrants)];
        if (unique.length) return unique;
        const own = facultyDepartmentCode(faculty);
        return own && own !== 'n/a' ? [own] : [];
    }

    function isInChairpersonScope(actorFaculty, targetFaculty, delegatedAccess) {
        if (!hasChairpersonWorkflowAccess(actorFaculty, delegatedAccess)) return false;
        if (!targetFaculty) return true;
        const targetDept = facultyDepartmentCode(targetFaculty);
        if (!targetDept) return true;
        const authorized = chairpersonAuthorizedDepartments(actorFaculty, delegatedAccess);
        return authorized.includes(targetDept);
    }

    function canBrowseAsChairperson(actorFaculty, targetFaculty, delegatedAccess) {
        return isInChairpersonScope(actorFaculty, targetFaculty, delegatedAccess);
    }

    function requiresChairpersonReview(config, task) {
        const flag = config?.requires_chairperson_review;
        if (flag === false || flag === 'false' || flag === 0) return false;
        if (flag === true || flag === 'true' || flag === 1) return true;
        if (config && (flag == null || flag === '')) return true;
        const taskFlag = task?.requires_chairperson_review;
        if (taskFlag === false || taskFlag === 'false' || taskFlag === 0) return false;
        if (taskFlag === true || taskFlag === 'true' || taskFlag === 1) return true;
        return false;
    }

    function resolveInitialApprovalStage(config, task) {
        return requiresChairpersonReview(config, task)
            ? APPROVAL_STAGES.CHAIRPERSON
            : APPROVAL_STAGES.FINAL;
    }

    /**
     * True when this person would be the reviewer of their own submission.
     *
     * A chairperson still has to file their own report, and the chairperson
     * stage is scoped by department. If the only grant covering their
     * department is their own, routing the report to the chairperson stage
     * parks it forever: they are excluded from reviewing themselves, and no
     * other chairperson is in scope.
     */
    function submitterIsOwnChairperson(faculty, delegatedAccess) {
        if (!faculty) return false;
        if (!hasChairpersonWorkflowAccess(faculty, delegatedAccess)) return false;
        const own = facultyDepartmentCode(faculty);
        if (!own || own === 'n/a') return false;
        return chairpersonAuthorizedDepartments(faculty, delegatedAccess).includes(own);
    }

    /**
     * Decide the stage a brand-new submission enters.
     *
     * Preference order is deliberate. wf_resolve_initial_approval_stage() runs
     * with full visibility of every grant, which the browser does not have —
     * RLS shows a chairperson only their own grant rows, so the client alone
     * cannot tell "I am the only chairperson for my department" from "another
     * chairperson also covers it". When the function is not deployed we fall
     * back to the local rule, which is correct for the common case.
     */
    async function resolveInitialApprovalStageForSubmission(sb, options) {
        const { config, task, submitterFaculty, delegatedAccess } = options || {};
        const localStage = resolveInitialApprovalStage(config, task);

        const client = sb || getSupabaseClient();
        if (client?.rpc && task?.id) {
            try {
                const { data, error } = await client.rpc('wf_resolve_initial_approval_stage', {
                    p_task_id: task.id
                });
                if (!error && typeof data === 'string' && data) {
                    return data;
                }
                if (error && error.code !== 'PGRST202') {
                    console.warn('CiteFlowWorkflow: stage routing RPC failed:', error.message || error);
                }
            } catch (error) {
                console.warn('CiteFlowWorkflow: stage routing RPC threw:', error);
            }
        }

        if (localStage === APPROVAL_STAGES.CHAIRPERSON
            && submitterIsOwnChairperson(submitterFaculty, delegatedAccess)) {
            return APPROVAL_STAGES.FINAL;
        }
        return localStage;
    }

    function getApprovalStage(submission, config, task) {
        const stored = submission?.approval_stage;
        const status = sanitizeDbStatus(submission?.status);
        const required = requiresChairpersonReview(config, task);
        if (
            required
            && ['submitted', 'late'].includes(status)
            && (!stored || stored === APPROVAL_STAGES.FINAL)
        ) {
            return APPROVAL_STAGES.CHAIRPERSON;
        }
        if (stored) return stored;
        if (config || task) return resolveInitialApprovalStage(config, task);
        return APPROVAL_STAGES.FINAL;
    }

    function isPendingChairpersonReview(submission, config, task) {
        if (!submission) return false;
        const status = sanitizeDbStatus(submission.status);
        if (!['submitted', 'late', 'underreview'].includes(status)) return false;
        if (getApprovalStage(submission, config, task) !== APPROVAL_STAGES.CHAIRPERSON) return false;
        if (config) return requiresChairpersonReview(config, task);
        return submission.approval_stage === APPROVAL_STAGES.CHAIRPERSON;
    }

    function resolveReviewContext(context) {
        if (!context) return { delegatedAccess: [], config: null, task: null };
        if (Array.isArray(context)) return { delegatedAccess: context, config: null, task: null };
        return {
            delegatedAccess: Array.isArray(context.delegatedAccess) ? context.delegatedAccess : [],
            config: context.config || null,
            task: context.task || null
        };
    }

    function sanitizeDbStatus(status) {
        const s = normalizeText(status);
        if (VALID_DB_STATUSES.has(s)) return s;
        if (s === 'pending') return 'underreview';
        return 'submitted';
    }

    function getWorkflowStage(submission, task, config) {
        const status = sanitizeDbStatus(submission?.status);
        const stage = getApprovalStage(submission, config, task);

        if (status === 'approved' && stage === APPROVAL_STAGES.APPROVED) return 'completed';
        if (status === 'rejected' || stage === APPROVAL_STAGES.DECLINED) return 'rejected';
        if (status === 'revision' || stage === APPROVAL_STAGES.REVISION) return 'revision_required';
        if (!submission?.submitted_at && (status === 'notsubmitted' || !submission)) {
            const due = task?.deadline_at || task?.due_at;
            if (due && new Date(due) < new Date()) return 'late_pending';
            return 'assigned';
        }
        if (stage === APPROVAL_STAGES.CHAIRPERSON && ['submitted', 'late', 'underreview'].includes(status)) {
            return 'chairperson_review';
        }
        if (stage === APPROVAL_STAGES.FINAL) return 'final_approval';
        if (status === 'approved') return 'completed';
        if (['submitted', 'late'].includes(status)) return 'submitted';
        return 'submitted';
    }

    function isFinallyApproved(submission, task, config) {
        if (!submission) return false;
        return getWorkflowStage(submission, task, config) === 'completed';
    }

    function canFacultyManageSubmissionFiles(submission, task, config) {
        if (!submission) return true;
        if (isFinallyApproved(submission, task, config)) return false;
        const status = sanitizeDbStatus(submission.status);
        if (status === 'rejected') return false;
        const stage = getApprovalStage(submission, config, task);
        if (status === 'approved' && stage === APPROVAL_STAGES.APPROVED) return false;
        if (stage === APPROVAL_STAGES.FINAL && requiresChairpersonReview(config, task)) return false;
        return true;
    }

    function canFacultyUnsubmit(submission, task, config) {
        if (!submission) return false;
        if (isFinallyApproved(submission, task, config)) return false;
        const status = sanitizeDbStatus(submission.status);
        if (!['submitted', 'late', 'underreview', 'revision'].includes(status)) return false;
        if (status === 'rejected') return false;
        const stage = getApprovalStage(submission, config, task);
        if (stage === APPROVAL_STAGES.APPROVED || stage === APPROVAL_STAGES.DECLINED) return false;
        if (stage === APPROVAL_STAGES.FINAL && requiresChairpersonReview(config, task)) return false;
        return true;
    }

    function facultyFilesWereUpdatedAfterReview(submission) {
        if (!submission?.submitted_at || !submission?.reviewed_at) return false;
        return new Date(submission.submitted_at).getTime() > new Date(submission.reviewed_at).getTime();
    }

    function buildFacultyFileChangeUpdate(submission, task, remainingFileCount, config) {
        const approvalStage = resolveInitialApprovalStage(config, task);
        if (!remainingFileCount) {
            return {
                status: 'notsubmitted',
                submitted_at: null,
                is_late: false,
                submitted_status: null,
                approval_stage: approvalStage
            };
        }

        const due = task?.deadline_at || task?.due_at;
        const late = !!(due && new Date(due) < new Date());
        const prevStatus = sanitizeDbStatus(submission?.status);
        const wasReturned = prevStatus === 'revision' || prevStatus === 'rejected';
        const update = {
            status: late ? 'late' : 'submitted',
            submitted_at: new Date().toISOString(),
            is_late: late,
            submitted_status: late ? 'late' : 'on_time',
            approval_stage: approvalStage
        };

        if (wasReturned) {
            update.resubmission_count = Number(submission?.resubmission_count || 0) + 1;
        }

        return update;
    }

    function getTaskDeadline(task) {
        return task?.deadline_at || task?.due_at || null;
    }

    function getTaskRequirementText(task) {
        return String(task?.instructions || task?.submission_instructions || '').trim();
    }

    const DEADLINE_REMINDER_WINDOWS = [
        { daysBefore: 3, phrase: 'in 3 days' },
        { daysBefore: 1, phrase: 'tomorrow' },
        { daysBefore: 0, phrase: 'today' }
    ];

    let reminderInFlight = null;
    let lastReminderRunAt = 0;

    function manilaCalendarYmd(value) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(value instanceof Date ? value : new Date(value));
    }

    function manilaCalendarDaysUntil(deadlineIso) {
        if (!deadlineIso) return null;
        const today = Date.parse(`${manilaCalendarYmd(new Date())}T00:00:00+08:00`);
        const due = Date.parse(`${manilaCalendarYmd(deadlineIso)}T00:00:00+08:00`);
        if (!Number.isFinite(today) || !Number.isFinite(due)) return null;
        return Math.round((due - today) / 86400000);
    }

    function formatManilaDateTime(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function shouldReceiveDeadlineReminder(submission, task) {
        if (isFinallyApproved(submission, task)) return false;
        if (!submission) return true;
        const status = sanitizeDbStatus(submission.status);
        if (!submission.submitted_at || status === 'notsubmitted') return true;
        return status === 'revision' || status === 'rejected';
    }

    function buildDeadlineReminderMessage(task, windowSpec) {
        const deadline = getTaskDeadline(task);
        const when = formatManilaDateTime(deadline);
        const title = task?.title || 'Assigned report';
        return `Reminder: "${title}" is due ${windowSpec.phrase} (${when} Asia/Manila).`;
    }

    function reminderDedupeKey(row) {
        return `${row.faculty_id}|${row.task_id}|${row.message}`;
    }

    async function runDeadlineReminderPass(sb, options) {
        const facultyFilter = options.facultyId;
        let assignQuery = sb.from('wf_task_assignments').select('task_id,faculty_id');
        if (facultyFilter != null) assignQuery = assignQuery.eq('faculty_id', facultyFilter);
        const { data: assignments, error: assignError } = await assignQuery;
        if (assignError) throw assignError;
        if (!assignments?.length) return { sent: 0 };

        const taskIds = [...new Set(assignments.map((row) => row.task_id).filter(Boolean))];
        if (!taskIds.length) return { sent: 0 };

        const { data: tasks, error: taskError } = await sb.from('wf_tasks').select('*').in('id', taskIds);
        if (taskError) throw taskError;

        let subQuery = sb.from('wf_submissions').select('*').in('task_id', taskIds);
        if (facultyFilter != null) subQuery = subQuery.eq('faculty_id', facultyFilter);
        const { data: submissions, error: subError } = await subQuery;
        if (subError) throw subError;

        let notifQuery = sb
            .from('wf_notifications')
            .select('faculty_id,task_id,message')
            .eq('type', 'task')
            .ilike('message', 'Reminder:%');
        if (facultyFilter != null) notifQuery = notifQuery.eq('faculty_id', facultyFilter);
        const { data: existing, error: notifError } = await notifQuery.limit(1000);
        if (notifError) throw notifError;

        const existingKeys = new Set((existing || []).map(reminderDedupeKey));
        const taskMap = new Map((tasks || []).map((task) => [String(task.id), task]));
        const subMap = new Map();
        (submissions || []).forEach((row) => {
            subMap.set(`${row.task_id}|${row.faculty_id}`, row);
        });

        const rows = [];
        assignments.forEach((assignment) => {
            const task = taskMap.get(String(assignment.task_id));
            const deadline = getTaskDeadline(task);
            if (!task || !deadline) return;

            const submission = subMap.get(`${assignment.task_id}|${assignment.faculty_id}`);
            if (!shouldReceiveDeadlineReminder(submission, task)) return;

            const days = manilaCalendarDaysUntil(deadline);
            const windowSpec = DEADLINE_REMINDER_WINDOWS.find((item) => item.daysBefore === days);
            if (!windowSpec) return;

            const message = buildDeadlineReminderMessage(task, windowSpec);
            const row = {
                type: 'task',
                faculty_id: assignment.faculty_id,
                task_id: assignment.task_id,
                message,
                is_read: false
            };
            const key = reminderDedupeKey(row);
            if (existingKeys.has(key)) return;
            existingKeys.add(key);
            rows.push(row);
        });

        if (!rows.length) return { sent: 0 };

        const { error: insertError } = await sb.from('wf_notifications').insert(rows);
        if (insertError) throw insertError;
        return { sent: rows.length };
    }

    async function processDeadlineReminders(sb, options = {}) {
        const client = sb || getSupabaseClient();
        if (!client) return { sent: 0 };
        if (reminderInFlight) return reminderInFlight;
        if (!options.force && lastReminderRunAt && Date.now() - lastReminderRunAt < 60000) {
            return { sent: 0, skipped: true };
        }

        reminderInFlight = runDeadlineReminderPass(client, options)
            .then((result) => {
                lastReminderRunAt = Date.now();
                return result;
            })
            .catch((error) => {
                console.error('CiteFlowWorkflow.processDeadlineReminders:', error);
                return { sent: 0, error: error.message || String(error) };
            })
            .finally(() => {
                reminderInFlight = null;
            });

        return reminderInFlight;
    }

    function formatWorkflowStatus(submission, task, config) {
        const stage = getWorkflowStage(submission, task, config);
        if (stage === 'rejected') {
            const role = normalizeText(submission?.last_reviewed_by_role || submission?.actor_role || '');
            if (role.includes('chair')) return 'Chairperson Declined';
            if (role.includes('final') || role.includes('admin') || role.includes('dean') || role.includes('secret')) {
                return 'Admin Declined';
            }
            return 'Declined';
        }
        const map = {
            assigned: 'Not Submitted',
            late_pending: 'Overdue — Not Submitted',
            submitted: 'Submitted',
            chairperson_review: 'Pending Chairperson Review',
            final_approval: 'Pending Admin Final Approval',
            completed: 'Completed',
            revision_required: 'Revision Requested',
            rejected: 'Declined'
        };
        return map[stage] || 'Unknown';
    }

    function isFacultySubmitter(faculty, submission) {
        if (!faculty || !submission) return false;
        return String(faculty.id) === String(submission.faculty_id);
    }

    function getStatusClass(submission, task) {
        const stage = getWorkflowStage(submission, task);
        const map = {
            assigned: 'bg-gray-100 text-gray-700 border-gray-200',
            late_pending: 'bg-red-50 text-red-700 border-red-100',
            submitted: 'bg-blue-50 text-blue-700 border-blue-100',
            chairperson_review: 'bg-indigo-50 text-indigo-700 border-indigo-100',
            final_approval: 'bg-amber-50 text-amber-800 border-amber-100',
            completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
            revision_required: 'bg-purple-50 text-purple-700 border-purple-100',
            rejected: 'bg-rose-50 text-rose-700 border-rose-100'
        };
        return map[stage] || map.assigned;
    }

    function canReviewAsChairperson(submission, actorFaculty, targetFaculty, context) {
        if (!submission || !actorFaculty) return false;
        const { delegatedAccess, config, task } = resolveReviewContext(context);
        if (!hasChairpersonWorkflowAccess(actorFaculty, delegatedAccess)) return false;
        if (targetFaculty && !isInChairpersonScope(actorFaculty, targetFaculty, delegatedAccess)) return false;
        return isPendingChairpersonReview(submission, config, task);
    }

    /**
     * Ask the database whether this session holds a chairperson grant, and
     * remember the answer for the rest of the page's life.
     *
     * This exists because the two halves of the chairperson feature disagreed
     * about who is authorized. The review queue is populated by
     * wf_list_chairperson_submissions(), a SECURITY DEFINER function, so it can
     * legitimately return rows while RLS on wf_delegated_access hides the grant
     * row itself from the browser. The client-side grant check then found no
     * grant and refused the action with "You are not authorized...", even
     * though the database would have allowed the write. The server is the only
     * component that can see both sides, so it decides.
     */
    let chairGrantServerAnswer = null;
    async function serverConfirmsChairpersonGrant(sb) {
        if (chairGrantServerAnswer !== null) return chairGrantServerAnswer;
        const client = sb || getSupabaseClient();
        if (!client?.rpc) return false;
        try {
            const { data, error } = await client.rpc('wf_current_user_has_chairperson_grant');
            if (error) {
                console.warn('CiteFlowWorkflow: chairperson grant RPC unavailable:', error.message || error);
                return false;
            }
            chairGrantServerAnswer = data === true;
            return chairGrantServerAnswer;
        } catch (error) {
            console.warn('CiteFlowWorkflow: chairperson grant RPC threw:', error);
            return false;
        }
    }

    function resetChairpersonGrantCache() {
        chairGrantServerAnswer = null;
    }

    function canReviewAsFinalApprover(submission, actorFaculty, context) {
        if (!submission || !actorFaculty) return false;
        if (isChairperson(actorFaculty)) return false;
        if (!isFinalApprover(actorFaculty) && !isWorkflowAdmin(actorFaculty)) return false;
        const { config, task } = resolveReviewContext(context);
        const stage = getApprovalStage(submission, config, task);
        const awaitingFinal = stage === APPROVAL_STAGES.FINAL ||
            (stage === APPROVAL_STAGES.CHAIRPERSON && !requiresChairpersonReview(config, task));
        if (!awaitingFinal) return false;
        const status = sanitizeDbStatus(submission.status);
        return status === 'underreview' || status === 'submitted' || status === 'late';
    }

    function canAccessWorkflowApproval(faculty, delegatedAccess) {
        if (!faculty) return false;
        if (isFinalApprover(faculty) || isWorkflowAdmin(faculty)) return true;
        return hasChairpersonWorkflowAccess(faculty, delegatedAccess);
    }

    function canAccessFacultyPortal(faculty, userMeta) {
        if (!faculty) return false;
        const role = faculty.role || normalizeRoleValue(userMeta?.role);
        return role === 'faculty' || role === 'chairperson';
    }

    async function getFreshSession(sb) {
        if (global.CiteFlowAuth?.getFreshSession) {
            return global.CiteFlowAuth.getFreshSession(sb || getSupabaseClient());
        }
        const client = sb || getSupabaseClient();
        if (!client) return null;
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session?.user) return null;
        const expiresAt = Number(session.expires_at || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (expiresAt && expiresAt > nowSec + 15) return session;
        // Share one refresh across the page; concurrent refreshes race on the
        // rotating refresh token and trip the endpoint rate limit.
        if (global.CiteFlowAuth?.refreshSessionShared) {
            const shared = await global.CiteFlowAuth.refreshSessionShared(client);
            return shared?.user ? shared : session;
        }
        const refreshed = await client.auth.refreshSession();
        if (refreshed.error || !refreshed.data?.session?.user) return session;
        return refreshed.data.session;
    }

    async function getCurrentUser() {
        const sb = getSupabaseClient();
        if (!sb) return null;
        // Use a refreshed local session. Calling auth.getUser() with an expired
        // access token hits /auth/v1/user and produces a 401 in the console.
        const session = await getFreshSession(sb);
        return session?.user || null;
    }

    async function getCurrentFaculty(user) {
        const sb = getSupabaseClient();
        const authUser = user || await getCurrentUser();
        if (!sb || !authUser) return null;

        const email = String(authUser.email || '').toLowerCase();
        const orFilter = email
            ? `auth_user_id.eq.${authUser.id},email.eq.${email},existing_email.eq.${email}`
            : `auth_user_id.eq.${authUser.id}`;

        let response = await sb.from('faculty').select('*').or(orFilter);

        if (response.error) {
            console.error('CiteFlowWorkflow.getCurrentFaculty:', response.error);
        }

        const rows = Array.isArray(response.data) ? response.data : (response.data ? [response.data] : []);
        const byAuth = rows.filter((row) => String(row.auth_user_id || '') === String(authUser.id));
        const looksChair = (row) => /chair/i.test(String(row.role || row.position || ''));
        const matched = byAuth.find(looksChair)
            || byAuth[0]
            || rows.find(looksChair)
            || rows[0]
            || null;

        if (matched) {
            return normalizeFaculty(matched);
        }

        // Fallback for Admin users from admin_profiles or user_metadata
        try {
            const adminResp = await sb
                .from('admin_profiles')
                .select('*')
                .eq('id', authUser.id)
                .maybeSingle();

            if (adminResp.data) {
                const a = adminResp.data;
                return normalizeFaculty({
                    id: a.id,
                    auth_user_id: a.id,
                    full_name: a.full_name || [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || 'Administrator',
                    first_name: a.first_name,
                    last_name: a.last_name,
                    email: a.email,
                    role: 'admin',
                    department: a.department || 'All',
                    admin_access: true
                });
            }
        } catch (_) {}

        const meta = authUser.user_metadata || {};
        const metaRole = String(meta.role || '').toLowerCase();
        if (metaRole.includes('chair')) {
            return normalizeFaculty({
                id: authUser.id,
                auth_user_id: authUser.id,
                full_name: meta.full_name || meta.name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || authUser.email || 'Chairperson',
                first_name: meta.first_name || '',
                last_name: meta.last_name || '',
                email: authUser.email,
                role: 'chairperson',
                department: meta.department || '',
                admin_access: false
            });
        }

        const isAdminMeta = !metaRole || metaRole === 'admin' || metaRole === 'administrator' ||
            metaRole === 'superadmin' || metaRole === 'dean' || metaRole.includes('secretary');
        if (!isAdminMeta) return null;

        return normalizeFaculty({
            id: authUser.id,
            auth_user_id: authUser.id,
            full_name: meta.full_name || meta.name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || authUser.email || 'Administrator',
            first_name: meta.first_name || '',
            last_name: meta.last_name || '',
            email: authUser.email,
            role: metaRole || 'admin',
            department: meta.department || 'All',
            admin_access: true
        });
    }

    /**
     * Load assigned workflow tasks for a faculty member using a joined query
     * so task rows always match assignment rows.
     */
    async function loadFacultyAssignedTasks(facultyId) {
        const sb = getSupabaseClient();
        if (!sb || facultyId == null) {
            return { tasks: [], assignments: [], error: null };
        }

        const numericId = Number(facultyId);
        const idFilter = Number.isFinite(numericId) ? numericId : facultyId;

        async function fetchTasksByIds(taskIds) {
            if (!taskIds.length) return [];
            const { data, error } = await sb
                .from('wf_tasks')
                .select('*')
                .in('id', taskIds);
            if (error) throw error;
            return data || [];
        }

        let assignmentRows = [];
        let taskMap = new Map();

        const joined = await sb
            .from('wf_task_assignments')
            .select('*, wf_tasks(*)')
            .eq('faculty_id', idFilter)
            .order('assigned_at', { ascending: false });

        if (!joined.error && Array.isArray(joined.data)) {
            joined.data.forEach((row) => {
                const task = row.wf_tasks;
                const assignment = { ...row };
                delete assignment.wf_tasks;
                assignmentRows.push(assignment);
                if (task?.id) {
                    taskMap.set(String(task.id), task);
                }
            });
        } else {
            const plain = await sb
                .from('wf_task_assignments')
                .select('*')
                .eq('faculty_id', idFilter)
                .order('assigned_at', { ascending: false });

            if (plain.error) {
                return { tasks: [], assignments: [], error: plain.error };
            }

            assignmentRows = plain.data || [];
        }

        const missingTaskIds = assignmentRows
            .map((row) => row.task_id)
            .filter((taskId) => taskId && !taskMap.has(String(taskId)));

        if (missingTaskIds.length) {
            try {
                const fetchedTasks = await fetchTasksByIds([...new Set(missingTaskIds)]);
                fetchedTasks.forEach((task) => {
                    if (task?.id) taskMap.set(String(task.id), task);
                });
            } catch (taskError) {
                return { tasks: [], assignments: assignmentRows, error: taskError };
            }
        }

        const tasks = Array.from(taskMap.values()).sort((a, b) => {
            const aTime = new Date(a.created_at || a.due_at || 0).getTime();
            const bTime = new Date(b.created_at || b.due_at || 0).getTime();
            return bTime - aTime;
        });

        return { tasks, assignments: assignmentRows, error: null };
    }

    async function canAccessFacultyPortalSession(user) {
        const sb = getSupabaseClient();
        if (!sb || !user) return { allowed: false, faculty: null };

        let faculty = await getCurrentFaculty(user);
        const metaRole = normalizeRoleValue(user.user_metadata?.role);
        const profileRole = faculty?.role || normalizeRoleValue(faculty?.raw_role || faculty?.position || '');
        const role = profileRole || metaRole;

        // Any linked faculty profile may use the faculty portal.
        // Do not require the role string to equal exactly "faculty".
        const allowed = !!faculty
            || role === 'faculty'
            || role === 'chairperson'
            || String(role || '').includes('chair')
            || role === 'dean'
            || role === 'college_secretary'
            || String(role || '').includes('secretary')
            || role === 'admin'
            || role === 'administrator'
            || !role;

        return { allowed, faculty };
    }

    function getActorDisplayName(faculty, user) {
        if (faculty?.full_name) return faculty.full_name;
        const meta = user?.user_metadata || {};
        const name = [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim();
        return name || user?.email || 'User';
    }

    function showToast(message, type) {
        if (typeof global.showToast === 'function') {
            global.showToast(message, type);
            return;
        }
        if (global.CiteFlowUI?.showMessage) {
            global.CiteFlowUI.showMessage(message, type === 'error' ? 'error' : 'info');
            return;
        }
        console.log(`[${type || 'info'}]`, message);
    }

    async function confirmAction(message, title) {
        return global.confirm(title ? `${title}\n\n${message}` : message);
    }

    async function logActivity(sb, payload) {
        const { error } = await sb.from('wf_activity_log').insert(payload);
        if (error) console.error('CiteFlowWorkflow.logActivity:', error);
        return !error;
    }

    async function createWorkflowNotification(sb, payload) {
        const rows = (Array.isArray(payload) ? payload : [payload]).filter(Boolean);
        if (!rows.length) return true;

        let { error } = await sb.from('wf_notifications').insert(rows);
        if (error && /recipient_auth_user_id|column|schema|cache/i.test(error.message || '')) {
            const fallback = rows.map((row) => {
                const next = { ...row };
                delete next.recipient_auth_user_id;
                return next;
            });
            ({ error } = await sb.from('wf_notifications').insert(fallback));
        }
        if (error) console.error('CiteFlowWorkflow.createWorkflowNotification:', error);
        return !error;
    }

    async function loadActiveDelegatedAccess(sb) {
        const { data, error } = await sb.from('wf_delegated_access').select('*');
        if (error) {
            console.error('CiteFlowWorkflow.loadActiveDelegatedAccess:', error);
            return [];
        }
        return (data || []).filter((grant) => grantIsActive(grant));
    }

    async function currentUserHasChairpersonGrant(sb, faculty, user) {
        const client = sb || getSupabaseClient();
        const session = client ? await getFreshSession(client) : null;
        const authUser = user || session?.user || await getCurrentUser();
        const isChair = isChairperson(faculty);
        const isAdmin = isWorkflowAdmin(faculty);

        if (isChair || isAdmin) {
            return true;
        }

        const debug = {
            authUserId: authUser?.id || null,
            authEmail: authUser?.email || null,
            facultyId: faculty?.id ?? null,
            facultyAuthUserId: faculty?.auth_user_id || null,
            facultyName: faculty?.full_name || faculty?.name || null,
            role: faculty?.role || null,
            rawRole: faculty?.raw_role || null,
            position: faculty?.position || null,
            department: faculty?.department || faculty?.department_code || null,
            isChairperson: isChair,
            sessionPresent: !!session?.user,
            grantFound: false,
            grantId: null,
            grantActive: false,
            grantError: null,
            rpcValue: null,
            rpcError: null,
            shouldShow: false
        };

        if (!faculty || !client) {
            debug.shouldShow = false;
            console.info('[Chairperson Access Debug]', debug);
            return false;
        }

        if (!session?.user && !authUser?.id) {
            debug.shouldShow = false;
            console.info('[Chairperson Access Debug]', debug);
            return false;
        }

        // Prefer database authorization when the session is present.
        try {
            const rpc = await client.rpc('wf_current_user_has_chairperson_grant');
            debug.rpcValue = rpc.data;
            debug.rpcError = rpc.error?.message || null;
            if (!rpc.error && rpc.data === true) {
                debug.shouldShow = true;
                console.info('[Chairperson Access Debug]', debug);
                return true;
            }
            if (!rpc.error && rpc.data === false) {
                debug.shouldShow = false;
                console.info('[Chairperson Access Debug]', debug);
                return false;
            }
        } catch (error) {
            debug.rpcError = error?.message || String(error);
        }

        // UI convenience fallback only when the RPC is unavailable.
        let grants = [];
        const filters = [];
        if (faculty.id != null) filters.push(`grantee_faculty_id.eq.${faculty.id}`);
        if (faculty.auth_user_id || authUser?.id) {
            filters.push(`grantee_auth_user_id.eq.${faculty.auth_user_id || authUser.id}`);
        }

        const targeted = filters.length
            ? await client.from('wf_delegated_access').select('*').or(filters.join(','))
            : { data: [], error: null };
        const visible = await client.from('wf_delegated_access').select('*');
        debug.grantError = targeted.error?.message || visible.error?.message || null;
        grants = [...(targeted.data || []), ...(visible.data || [])]
            .filter((grant, index, list) => grant && list.findIndex((row) => String(row.id) === String(grant.id)) === index)
            .filter((grant) => grantIsActive(grant));

        const matched = getChairpersonGrant(faculty, grants)
            || grants.find((grant) => grantMatchesChairperson(grant, {
                ...faculty,
                auth_user_id: faculty.auth_user_id || authUser?.id || null,
                email: faculty.email || authUser?.email || null
            }))
            || null;

        debug.grantFound = !!matched;
        debug.grantId = matched?.id || null;
        debug.grantActive = !!(matched && grantIsActive(matched));
        debug.shouldShow = !!matched;
        console.info('[Chairperson Access Debug]', debug);
        return !!matched;
    }

    function formatApprovalStage(stage) {
        const map = {
            chairperson: 'Pending Chairperson Review',
            final_approver: 'Pending Admin Final Approval',
            approved: 'Admin Approved',
            revision: 'Revision Requested',
            declined: 'Declined',
            rejected: 'Declined'
        };
        return map[normalizeText(stage)] || (stage ? String(stage) : '—');
    }

    async function loadFacultyDirectory(sb) {
        const { data, error } = await sb
            .from('faculty')
            .select('id,auth_user_id,full_name,name,email,existing_email,department,role,position,status');
        if (error) {
            console.error('CiteFlowWorkflow.loadFacultyDirectory:', error);
            return [];
        }
        return (data || []).map(normalizeFaculty);
    }

    async function resolveTaskConfig(sb, task) {
        if (!task?.report_config_id) return null;
        const { data, error } = await sb
            .from('wf_report_configs')
            .select('*')
            .eq('id', task.report_config_id)
            .maybeSingle();
        if (error) {
            console.error('CiteFlowWorkflow.resolveTaskConfig:', error);
            return null;
        }
        return data || null;
    }

    function authorizedChairpersonsForSubmission(submitter, facultyList, grants, config, task) {
        if (!submitter || !requiresChairpersonReview(config, task)) return [];
        return (facultyList || []).filter((chair) => {
            if (!hasChairpersonWorkflowAccess(chair, grants)) return false;
            return isInChairpersonScope(chair, submitter, grants);
        });
    }

    async function notifyAuthorizedChairpersons(sb, { submitter, task, taskId, submissionId, message }) {
        const [grants, facultyList] = await Promise.all([
            loadActiveDelegatedAccess(sb),
            loadFacultyDirectory(sb)
        ]);
        const config = await resolveTaskConfig(sb, task);
        const chairs = authorizedChairpersonsForSubmission(submitter, facultyList, grants, config, task);
        if (!chairs.length) return true;

        return createWorkflowNotification(sb, chairs.map((chair) => ({
            type: 'submission',
            faculty_id: chair.id,
            recipient_auth_user_id: chair.auth_user_id || null,
            task_id: taskId || task?.id || null,
            submission_id: submissionId || null,
            message,
            is_read: false
        })));
    }

    /**
     * Name the column the database is rejecting.
     *
     *   42703     column wf_submissions.foo does not exist
     *   PGRST204  Could not find the 'foo' column of 'wf_submissions' in the
     *             schema cache
     */
    function unknownColumnFromError(error) {
        const raw = String(error?.message || '');
        const code = String(error?.code || '');
        if (code && code !== '42703' && code !== 'PGRST204' && !/column|schema cache/i.test(raw)) {
            return null;
        }
        const patterns = [
            /column\s+(?:[\w.]*\.)?"?([a-z0-9_]+)"?\s+does not exist/i,
            /could not find the '([a-z0-9_]+)' column/i,
            /'([a-z0-9_]+)' column of/i
        ];
        for (const pattern of patterns) {
            const match = raw.match(pattern);
            if (match && match[1]) return match[1];
        }
        return null;
    }

    /**
     * Approval history is the audit trail behind every "who declined this and
     * why". A failure here used to be a console line, which meant a decline
     * could report success while its reason was never recorded. The caller now
     * gets the error so it can tell the user the action was only partly saved.
     */
    async function recordApprovalHistory(sb, entry) {
        const optional = new Set();
        const build = () => {
            const copy = { ...entry };
            optional.forEach((column) => { delete copy[column]; });
            return copy;
        };

        let { error } = await sb.from('wf_approval_history').insert(build());
        const maxPasses = Object.keys(entry).length + 1;
        for (let pass = 0; pass < maxPasses && error; pass += 1) {
            const column = unknownColumnFromError(error);
            if (!column || optional.has(column) || column === 'submission_id') break;
            optional.add(column);
            ({ error } = await sb.from('wf_approval_history').insert(build()));
        }

        if (error) {
            console.error('CiteFlowWorkflow.recordApprovalHistory:', error);
            return { ok: false, error: error.message || 'Failed to record approval history.' };
        }
        return { ok: true };
    }

    /**
     * Compute next submission state after a review action.
     * Never returns "pending" — maps to underreview for DB enum compatibility.
     */
    function computeReviewTransition(submission, action, actorFaculty, config, task) {
        const stage = getApprovalStage(submission, config, task);
        const actorRole = normalizeRole(actorFaculty).role;
        const requiresChair = requiresChairpersonReview(config, task);
        const requiresFinal = config?.requires_final_approval !== false;

        let nextStage = stage;
        let nextStatus = sanitizeDbStatus(submission?.status);
        let historyAction = action;
        let actorRoleLabel = actorRole.toUpperCase();

        if (action === 'approved') {
            if (stage === APPROVAL_STAGES.CHAIRPERSON && requiresChair) {
                if (requiresFinal) {
                    nextStage = APPROVAL_STAGES.FINAL;
                    nextStatus = 'underreview';
                    historyAction = 'chairperson_approved';
                } else {
                    nextStage = APPROVAL_STAGES.APPROVED;
                    nextStatus = 'approved';
                    historyAction = 'final_approved';
                }
            } else if (stage === APPROVAL_STAGES.FINAL || (stage === APPROVAL_STAGES.CHAIRPERSON && !requiresChair)) {
                nextStage = APPROVAL_STAGES.APPROVED;
                nextStatus = 'approved';
                historyAction = 'final_approved';
                actorRoleLabel = actorRole === 'chairperson' ? 'CHAIRPERSON' : 'FINAL APPROVER';
            }
        } else if (action === 'revision') {
            nextStage = APPROVAL_STAGES.REVISION;
            nextStatus = 'revision';
            historyAction = stage === APPROVAL_STAGES.FINAL ? 'final_revision' : 'chairperson_revision';
        } else if (action === 'rejected') {
            nextStage = APPROVAL_STAGES.DECLINED;
            nextStatus = 'rejected';
            historyAction = stage === APPROVAL_STAGES.FINAL ? 'final_declined' : 'chairperson_declined';
        }

        return { nextStage, nextStatus, historyAction, actorRoleLabel };
    }

    /**
     * Apply a review update and prove that a row actually changed.
     *
     * PostgREST returns no error for an UPDATE whose WHERE clause matches
     * nothing once RLS has filtered it, so the previous fire-and-forget call
     * reported "Submission marked rejected" for a decline the database had
     * silently refused. Asking for the updated row back turns that into a real
     * failure the caller can show.
     *
     * The retry loop exists because this schema has drifted from the migrations
     * in the repo; rather than fail outright on a column that a given
     * deployment lacks, drop it and retry. Status and approval_stage are never
     * dropped — an update that cannot move the workflow forward must fail.
     */
    async function updateSubmissionStrict(sb, submissionId, update) {
        const dropped = new Set();
        const build = () => {
            const copy = { ...update };
            dropped.forEach((column) => { delete copy[column]; });
            return copy;
        };

        let result = await sb.from('wf_submissions')
            .update(build()).eq('id', submissionId).select('id');

        const maxPasses = Object.keys(update).length + 1;
        for (let pass = 0; pass < maxPasses && result.error; pass += 1) {
            const column = unknownColumnFromError(result.error);
            if (!column || dropped.has(column)) break;
            if (column === 'status' || column === 'approval_stage') break;
            console.warn(`CiteFlowWorkflow: wf_submissions has no "${column}" column; retrying without it.`);
            dropped.add(column);
            result = await sb.from('wf_submissions')
                .update(build()).eq('id', submissionId).select('id');
        }

        if (result.error) {
            console.error('CiteFlowWorkflow.applySubmissionReview update:', result.error);
            const message = String(result.error.message || '');
            if (result.error.code === '42501' || /row-level security/i.test(message)) {
                return {
                    ok: false,
                    error: 'The database refused this action for your account. '
                        + 'Your login is not recognised as an approver for this submission.'
                };
            }
            return { ok: false, error: message || 'Failed to update submission.' };
        }

        if (!Array.isArray(result.data) || result.data.length === 0) {
            return {
                ok: false,
                error: 'No submission was updated. Your account does not have permission '
                    + 'to review this submission, or it was changed by someone else. '
                    + 'Nothing was saved.'
            };
        }

        return { ok: true };
    }

    function buildReviewUpdate(transition, comment, actorName, rawSubmission) {
        const trimmed = String(comment || '').trim();

        const update = {
            status: transition.nextStatus,
            approval_stage: transition.nextStage,
            reviewed_by_name: actorName,
            reviewed_at: new Date().toISOString(),
            last_reviewed_by_role: transition.actorRoleLabel
        };

        // Approve carries no remarks, and writing null here used to erase the
        // chairperson's revision remarks that faculty were still reading on the
        // status-tracking page. Only overwrite when there is something to say.
        if (trimmed) {
            update.review_remarks = trimmed;
        }

        if (transition.nextStage === APPROVAL_STAGES.APPROVED) {
            update.final_approved_at = new Date().toISOString();
            update.final_approved_by_name = actorName;
            update.final_approval_remarks = trimmed || null;
        }

        // Only a revision sends the report back for another round. A decline is
        // terminal, so counting it as a resubmission overstated the count.
        if (transition.nextStatus === 'revision') {
            update.resubmission_count = Number(rawSubmission?.resubmission_count || 0) + 1;
        }

        if (transition.nextStage === APPROVAL_STAGES.CHAIRPERSON && transition.nextStatus === 'submitted') {
            update.approval_stage = APPROVAL_STAGES.CHAIRPERSON;
        }

        return update;
    }

    async function applySubmissionReview(sb, options) {
        const {
            submissionId,
            submission,
            action,
            comment,
            actorFaculty,
            actorUser,
            targetFaculty,
            task,
            config,
            delegatedAccess
        } = options;

        const actorName = getActorDisplayName(actorFaculty, actorUser);
        const stage = getApprovalStage(submission, config, task);
        const target = targetFaculty || actorFaculty;
        const reviewContext = { delegatedAccess: delegatedAccess || [], config, task };

        // A chairperson whose grant row is hidden from the browser by RLS still
        // fails the local check, so fall back to asking the database before
        // refusing. This only ever widens the check to what the database itself
        // would permit: the write is still governed by RLS, and
        // updateSubmissionStrict() reports an actual refusal honestly.
        const chairAllowedLocally = canReviewAsChairperson(submission, actorFaculty, target, reviewContext);
        const chairStageIsOpen = isPendingChairpersonReview(submission, config, task);
        const chairAllowed = chairAllowedLocally
            || (chairStageIsOpen && await serverConfirmsChairpersonGrant(sb));

        if (action === 'approved') {
            if (stage === APPROVAL_STAGES.CHAIRPERSON) {
                const finalSkipChair = canReviewAsFinalApprover(submission, actorFaculty, reviewContext);
                if (!chairAllowed && !finalSkipChair) {
                    return { ok: false, error: 'You are not authorized to perform chairperson review on this submission.' };
                }
            } else if (stage === APPROVAL_STAGES.FINAL) {
                if (!canReviewAsFinalApprover(submission, actorFaculty, reviewContext)) {
                    return { ok: false, error: 'You are not authorized to perform final approval on this submission.' };
                }
            } else if (stage === APPROVAL_STAGES.APPROVED) {
                return { ok: false, error: 'This submission is already fully approved.' };
            }
        } else {
            const canFinal = canReviewAsFinalApprover(submission, actorFaculty, reviewContext);
            if (!chairAllowed && !canFinal) {
                return { ok: false, error: 'You are not authorized to review this submission.' };
            }
        }

        if ((action === 'revision' || action === 'rejected') && !String(comment || '').trim()) {
            return { ok: false, error: 'Please provide remarks before submitting this action.' };
        }

        const transition = computeReviewTransition(submission, action, actorFaculty, config, task);
        const update = buildReviewUpdate(transition, comment, actorName, submission);

        const written = await updateSubmissionStrict(sb, submissionId, update);
        if (!written.ok) return written;

        const history = await recordApprovalHistory(sb, {
            submission_id: submissionId,
            task_id: submission.task_id,
            faculty_id: submission.faculty_id,
            actor_name: actorName,
            actor_role: transition.actorRoleLabel,
            action: transition.historyAction,
            status: transition.nextStatus,
            comment: comment || null
        });

        await logActivity(sb, {
            action: action === 'approved'
                ? (transition.nextStage === APPROVAL_STAGES.APPROVED ? 'Final approval' : 'Chairperson approval')
                : action === 'revision' ? 'Returned for revision' : 'Rejected',
            actor_name: actorName,
            target: `${target?.full_name || 'Faculty'} - ${task?.title || 'Submission'}`,
            log_type: action,
            task_id: submission.task_id,
            submission_id: submissionId
        });

        const notifyMessage = action === 'approved' && transition.nextStage === APPROVAL_STAGES.FINAL
            ? `Submission approved by chairperson — pending final approval: ${task?.title || 'Submission'}`
            : action === 'approved' && transition.nextStage === APPROVAL_STAGES.APPROVED
                ? `Submission fully approved: ${task?.title || 'Submission'}`
                : action === 'revision'
                    ? `Revision required: ${task?.title || 'Submission'}`
                    : `Submission rejected: ${task?.title || 'Submission'}`;

        await createWorkflowNotification(sb, {
            type: 'review',
            message: notifyMessage,
            is_read: false,
            faculty_id: submission.faculty_id,
            recipient_auth_user_id: target?.auth_user_id || null,
            task_id: submission.task_id,
            submission_id: submissionId
        });

        // The status change is committed at this point, so the action succeeded.
        // A failed audit row is still worth telling the reviewer about, because
        // the decision will not appear in the approval history panel.
        return {
            ok: true,
            transition,
            update,
            warning: history.ok
                ? null
                : 'The decision was saved, but it could not be added to the approval history.'
        };
    }

    async function unsubmitSubmission(sb, options) {
        const {
            submissionId,
            submission,
            actorFaculty,
            actorUser,
            task,
            config
        } = options || {};

        if (!submission || !actorFaculty) {
            return { ok: false, error: 'Submission could not be unsubmitted.' };
        }
        if (String(actorFaculty.id) !== String(submission.faculty_id)) {
            return { ok: false, error: 'You can only unsubmit your own work.' };
        }
        if (!canFacultyUnsubmit(submission, task, config)) {
            return { ok: false, error: 'This submission can no longer be unsubmitted.' };
        }

        const actorName = getActorDisplayName(actorFaculty, actorUser);
        const update = {
            status: 'notsubmitted',
            submitted_at: null,
            is_late: false,
            submitted_status: null,
            approval_stage: resolveInitialApprovalStage(config, task),
            reviewed_by_name: null,
            reviewed_at: null
        };

        const { error } = await sb.from('wf_submissions').update(update).eq('id', submissionId);
        if (error) {
            console.error('CiteFlowWorkflow.unsubmitSubmission:', error);
            return { ok: false, error: error.message || 'Failed to unsubmit.' };
        }

        await recordApprovalHistory(sb, {
            submission_id: submissionId,
            task_id: submission.task_id,
            faculty_id: submission.faculty_id,
            actor_name: actorName,
            actor_role: 'FACULTY',
            action: 'unsubmitted',
            status: 'notsubmitted',
            comment: 'Faculty unsubmitted this work before the next approval stage.'
        });

        await logActivity(sb, {
            action: 'Unsubmitted task',
            actor_name: actorName,
            target: task?.title || 'Submission',
            log_type: 'submission',
            task_id: submission.task_id,
            submission_id: submissionId
        });

        return { ok: true, update };
    }

    async function recordSubmissionEvent(sb, { faculty, task, taskId, submissionId, isResubmit }) {
        const actorName = faculty.full_name;
        await logActivity(sb, {
            action: isResubmit ? 'Resubmitted task' : 'Submitted task',
            actor_name: actorName,
            target: task?.title || 'Task',
            log_type: 'submission',
            task_id: taskId,
            submission_id: submissionId || null
        });

        await createWorkflowNotification(sb, {
            type: 'submission',
            faculty_id: faculty.id,
            recipient_auth_user_id: faculty.auth_user_id || null,
            task_id: taskId,
            submission_id: submissionId || null,
            message: `${isResubmit ? 'Resubmission' : 'New submission'} from ${actorName}: ${task?.title || 'Task'}`,
            is_read: false
        });

        await notifyAuthorizedChairpersons(sb, {
            submitter: faculty,
            task,
            taskId,
            submissionId,
            message: `${isResubmit ? 'Resubmission' : 'New submission'} from ${actorName} requires Chairperson review: ${task?.title || 'Task'}`
        });

        if (submissionId) {
            await recordApprovalHistory(sb, {
                submission_id: submissionId,
                task_id: taskId,
                faculty_id: faculty.id,
                actor_name: actorName,
                actor_role: 'FACULTY',
                action: isResubmit ? 'resubmitted' : 'submitted',
                status: 'submitted',
                comment: null
            });
        }
    }

    async function recordFacultyFileChange(sb, { faculty, task, taskId, submissionId, changeType }) {
        const actorName = faculty?.full_name || 'Faculty';
        const title = task?.title || 'Submission';
        const actionMap = {
            deleted: 'Deleted submission file',
            replaced: 'Replaced submission file',
            added: 'Added submission file'
        };
        const messageMap = {
            deleted: `${actorName} deleted a file on ${title}`,
            replaced: `${actorName} replaced a file on ${title}`,
            added: `${actorName} added a file on ${title}`
        };
        await logActivity(sb, {
            action: actionMap[changeType] || 'Updated submission files',
            actor_name: actorName,
            target: title,
            log_type: 'submission',
            task_id: taskId,
            submission_id: submissionId || null
        });
        await createWorkflowNotification(sb, {
            type: 'submission',
            faculty_id: faculty?.id,
            recipient_auth_user_id: faculty?.auth_user_id || null,
            task_id: taskId,
            submission_id: submissionId || null,
            message: messageMap[changeType] || `${actorName} updated files on ${title}`,
            is_read: false
        });
        await notifyAuthorizedChairpersons(sb, {
            submitter: faculty,
            task,
            taskId,
            submissionId,
            message: `${actorName} updated files and returned "${title}" for Chairperson review`
        });
        if (submissionId) {
            await recordApprovalHistory(sb, {
                submission_id: submissionId,
                task_id: taskId,
                faculty_id: faculty?.id,
                actor_name: actorName,
                actor_role: 'FACULTY',
                action: changeType === 'replaced' ? 'file_replaced' : (changeType === 'deleted' ? 'file_deleted' : 'file_added'),
                status: 'submitted',
                comment: actionMap[changeType] || 'Updated submission files'
            });
        }
    }

    function subscribeWorkflow(onChange, tables) {
        const sb = getSupabaseClient();
        if (!sb || typeof onChange !== 'function') return null;

        const watched = tables || [
            'wf_submissions',
            'wf_approval_history',
            'wf_notifications',
            'wf_task_assignments',
            'wf_tasks',
            'wf_submission_files',
            'wf_delegated_access'
        ];

        cleanupWorkflowRealtime();

        workflowChannel = sb.channel(`wf-shared-${Date.now()}`);
        watched.forEach((table) => {
            workflowChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(onChange, 400);
            });
        });

        workflowChannel.subscribe((status) => {
            if (status === 'CHANNEL_ERROR') {
                console.warn('CiteFlowWorkflow: realtime channel error — continuing without live updates.');
            }
        });

        return workflowChannel;
    }

    function cleanupWorkflowRealtime() {
        const sb = getSupabaseClient();
        if (workflowChannel && sb) {
            sb.removeChannel(workflowChannel);
            workflowChannel = null;
        }
        clearTimeout(debounceTimer);
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('beforeunload', cleanupWorkflowRealtime);
    }

    function buildTimelineSteps(submission, task, assignment, approvalHistory, config) {
        const history = Array.isArray(approvalHistory) ? approvalHistory : [];
        const subHistory = history.filter(h => String(h.submission_id) === String(submission?.id));
        const includeChairStep = requiresChairpersonReview(config, task);

        const findHistory = (actions) => subHistory.find(h => actions.includes(normalizeText(h.action)));

        const assigned = {
            key: 'assigned',
            label: 'Assigned',
            done: true,
            date: assignment?.assigned_at || task?.created_at,
            note: 'Report assigned to you.'
        };

        const submittedEntry = findHistory(['submitted', 'resubmitted']);
        const submitted = {
            key: 'submitted',
            label: 'Submitted',
            done: !!submission?.submitted_at,
            date: submission?.submitted_at || submittedEntry?.created_at,
            note: submission?.submitted_at ? 'Your submission was received.' : 'Waiting for your submission.'
        };

        const chairEntry = findHistory(['chairperson_approved', 'chairperson_revision']);
        const stage = getWorkflowStage(submission, task);
        const chairDone = !!chairEntry || ['final_approval', 'completed'].includes(stage) ||
            getApprovalStage(submission) === APPROVAL_STAGES.FINAL ||
            submission?.status === 'approved';
        const chairActive = stage === 'chairperson_review';
        const chair = {
            key: 'chairperson',
            label: 'Chairperson Review',
            done: chairDone,
            active: chairActive,
            date: chairEntry?.created_at || (chairDone ? submission?.reviewed_at : null),
            note: chairActive
                ? 'Your department chairperson is reviewing this submission.'
                : chairDone ? 'Chairperson review completed.' : 'Waiting for chairperson review.'
        };

        const finalEntry = findHistory(['final_approved', 'final_revision']);
        const finalDone = submission?.status === 'approved' && getApprovalStage(submission) === APPROVAL_STAGES.APPROVED;
        const finalActive = stage === 'final_approval';
        const finalStep = {
            key: 'final',
            label: 'Final Approval',
            done: finalDone || !!finalEntry,
            active: finalActive,
            date: submission?.final_approved_at || finalEntry?.created_at,
            note: finalActive
                ? 'Awaiting final approval from the college administrator.'
                : finalDone ? 'Final approval completed.' : 'Waiting for final approval.'
        };

        const completed = {
            key: 'completed',
            label: 'Completed',
            done: stage === 'completed',
            active: false,
            date: submission?.final_approved_at,
            note: stage === 'completed' ? 'Your submission has been fully approved.' : 'Waiting for completion.'
        };

        if (stage === 'revision_required') {
            return [assigned, submitted, {
                key: 'revision',
                label: 'Revision Required',
                done: true,
                active: true,
                date: submission?.reviewed_at,
                note: submission?.review_remarks || 'Your submission was returned for revision.'
            }];
        }

        if (stage === 'rejected') {
            return [assigned, submitted, {
                key: 'rejected',
                label: 'Rejected',
                done: true,
                active: true,
                date: submission?.reviewed_at,
                note: submission?.review_remarks || 'Your submission was rejected.'
            }];
        }

        return includeChairStep
            ? [assigned, submitted, chair, finalStep, completed]
            : [assigned, submitted, finalStep, completed];
    }

    // =========================================================================
    // ACCOMPLISHMENT REPORT WORKFLOW HELPERS
    // =========================================================================

    const AR_STATUSES = {
        draft:          { label: 'Draft',           css: 'bg-gray-100 text-gray-700 border-gray-200' },
        submitted:      { label: 'Submitted',       css: 'bg-blue-50 text-blue-700 border-blue-100' },
        chair_approved: { label: 'Chair Certified', css: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
        dean_approved:  { label: 'Approved',        css: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        revision:       { label: 'Revision Requested', css: 'bg-purple-50 text-purple-700 border-purple-100' },
        rejected:       { label: 'Declined',        css: 'bg-rose-50 text-rose-700 border-rose-100' }
    };

    function formatAccomplishmentReportStatus(status) {
        return (AR_STATUSES[status] || AR_STATUSES.draft).label;
    }

    function getAccomplishmentReportStatusCss(status) {
        return (AR_STATUSES[status] || AR_STATUSES.draft).css;
    }

    /**
     * Check if the actor can review an accomplishment report submission as Chairperson.
     * Returns true if:
     *  - Actor is a chairperson with delegated access
     *  - Report status is 'submitted'
     *  - Actor's department scope covers the faculty member
     */
    function canReviewAccomplishmentAsChair(actor, reportSubmission, targetFaculty, delegatedAccess) {
        if (!actor || !reportSubmission) return false;
        if (reportSubmission.status !== 'submitted') return false;
        if (!hasChairpersonWorkflowAccess(actor, delegatedAccess)) return false;
        if (targetFaculty && !isInChairpersonScope(actor, targetFaculty, delegatedAccess)) return false;
        return true;
    }

    /**
     * Check if the actor can review an accomplishment report submission as Dean/Admin.
     * Returns true if:
     *  - Actor is an admin/dean/college_secretary
     *  - Report status is 'chair_approved'
     */
    function canReviewAccomplishmentAsDean(actor, reportSubmission) {
        if (!actor || !reportSubmission) return false;
        if (reportSubmission.status !== 'chair_approved') return false;
        if (!isWorkflowAdmin(actor) && !isFinalApprover(actor)) return false;
        return true;
    }

    /**
     * Apply a review action to an accomplishment report submission.
     * @param {object} sb - Supabase client
     * @param {object} options
     * @param {number} options.reportId - accomplishment_report_submissions.id
     * @param {string} options.action - 'approve' | 'revision' | 'reject'
     * @param {string} options.actorRole - 'chairperson' | 'dean' | 'admin'
     * @param {string} options.actorName - Display name of reviewer
     * @param {number} options.actorId - Faculty/admin ID
     * @param {string} [options.remarks] - Review remarks
     * @param {number} [options.facultyId] - Target faculty ID (for notification)
     */
    async function reviewAccomplishmentReport(sb, options) {
        const { reportId, action, actorRole, actorName, actorId, remarks, facultyId } = options;
        if (!reportId || !action || !actorRole) {
            throw new Error('Missing required review parameters');
        }

        const isChairRole = actorRole === 'chairperson';
        const now = new Date().toISOString();
        let update = { updated_at: now };
        let notifMessage = '';

        if (isChairRole) {
            // Chairperson actions
            if (action === 'approve') {
                update.status = 'chair_approved';
                update.chair_reviewed_by = actorName;
                update.chair_reviewed_by_id = actorId;
                update.chair_reviewed_at = now;
                update.chair_remarks = remarks || null;
                notifMessage = `Your accomplishment report has been certified by Chairperson ${actorName}.`;
            } else if (action === 'revision') {
                update.status = 'revision';
                update.chair_reviewed_by = actorName;
                update.chair_reviewed_by_id = actorId;
                update.chair_reviewed_at = now;
                update.chair_remarks = remarks || 'Please revise and resubmit.';
                notifMessage = `Your accomplishment report was returned for revision by ${actorName}. Remarks: ${remarks || 'Please revise and resubmit.'}`;
            } else if (action === 'reject') {
                update.status = 'rejected';
                update.chair_reviewed_by = actorName;
                update.chair_reviewed_by_id = actorId;
                update.chair_reviewed_at = now;
                update.chair_remarks = remarks || 'Report declined.';
                notifMessage = `Your accomplishment report was declined by ${actorName}.`;
            }
        } else {
            // Dean / Admin actions
            if (action === 'approve') {
                update.status = 'dean_approved';
                update.dean_reviewed_by = actorName;
                update.dean_reviewed_by_id = actorId;
                update.dean_reviewed_at = now;
                update.dean_remarks = remarks || null;
                notifMessage = `Your accomplishment report has been fully approved by ${actorName}.`;
            } else if (action === 'revision') {
                update.status = 'revision';
                update.dean_reviewed_by = actorName;
                update.dean_reviewed_by_id = actorId;
                update.dean_reviewed_at = now;
                update.dean_remarks = remarks || 'Please revise and resubmit.';
                notifMessage = `Your accomplishment report was returned for revision by ${actorName}. Remarks: ${remarks || 'Please revise and resubmit.'}`;
            } else if (action === 'reject') {
                update.status = 'rejected';
                update.dean_reviewed_by = actorName;
                update.dean_reviewed_by_id = actorId;
                update.dean_reviewed_at = now;
                update.dean_remarks = remarks || 'Report declined.';
                notifMessage = `Your accomplishment report was declined by ${actorName}.`;
            }
        }

        const { error } = await sb
            .from('accomplishment_report_submissions')
            .update(update)
            .eq('id', reportId);

        if (error) throw error;

        // Send notification to the faculty member
        if (facultyId && notifMessage) {
            await createWorkflowNotification(sb, {
                faculty_id: facultyId,
                type: 'accomplishment_report',
                title: 'Accomplishment Report Update',
                message: notifMessage,
                is_read: false
            });
        }

        // Log activity
        await logActivity(sb, {
            actor_name: actorName,
            action: `accomplishment_report_${action}`,
            target: `Report #${reportId}`,
            log_type: 'accomplishment_report',
            details: remarks || `${actorRole} ${action}d accomplishment report`
        });

        return update;
    }

    const api = {
        VALID_DB_STATUSES,
        APPROVAL_STAGES,
        DOCUMENT_CATEGORIES,
        DOCUMENT_CATEGORY_VALUES,
        QUICK_SUBMISSION_CATEGORY_VALUES,
        getDocumentCategories,
        getQuickSubmissionCategories,
        resolveDocumentCategory,
        formatDocumentCategory,
        matchesDocumentCategory,
        documentCategoryOptionsHtml,
        ensureTitleReflectsCategory,
        getSupabaseClient,
        getCurrentUser,
        getFreshSession,
        getCurrentFaculty,
        loadFacultyAssignedTasks,
        canAccessFacultyPortalSession,
        normalizeFaculty,
        normalizeRole,
        normalizeRoleValue,
        normalizeText,
        isChairperson,
        isWorkflowAdmin,
        isFinalApprover,
        canReviewAsChairperson,
        canBrowseAsChairperson,
        canReviewAsFinalApprover,
        canAccessWorkflowApproval,
        canAccessFacultyPortal,
        getChairpersonGrant,
        hasChairpersonWorkflowAccess,
        currentUserHasChairpersonGrant,
        serverConfirmsChairpersonGrant,
        resetChairpersonGrantCache,
        loadActiveDelegatedAccess,
        formatApprovalStage,
        chairpersonAuthorizedDepartments,
        isInChairpersonScope,
        facultyDepartmentCode,
        requiresChairpersonReview,
        resolveInitialApprovalStage,
        resolveInitialApprovalStageForSubmission,
        submitterIsOwnChairperson,
        unknownColumnFromError,
        isPendingChairpersonReview,
        grantMatchesChairperson,
        getApprovalStage,
        getWorkflowStage,
        isFinallyApproved,
        canFacultyManageSubmissionFiles,
        canFacultyUnsubmit,
        facultyFilesWereUpdatedAfterReview,
        buildFacultyFileChangeUpdate,
        getTaskDeadline,
        getTaskRequirementText,
        processDeadlineReminders,
        formatWorkflowStatus,
        getStatusClass,
        sanitizeDbStatus,
        computeReviewTransition,
        buildReviewUpdate,
        applySubmissionReview,
        unsubmitSubmission,
        recordSubmissionEvent,
        recordFacultyFileChange,
        recordApprovalHistory,
        logActivity,
        createWorkflowNotification,
        getActorDisplayName,
        showToast,
        confirmAction,
        subscribeWorkflow,
        cleanupWorkflowRealtime,
        buildTimelineSteps,
        AR_STATUSES,
        formatAccomplishmentReportStatus,
        getAccomplishmentReportStatusCss,
        canReviewAccomplishmentAsChair,
        canReviewAccomplishmentAsDean,
        reviewAccomplishmentReport,
        escapeHtml,
        sameDepartment
    };

    global.CiteFlowWorkflow = api;
})(typeof window !== 'undefined' ? window : globalThis);
