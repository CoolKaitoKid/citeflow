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
        REVISION: 'revision'
    };

    let workflowChannel = null;
    let debounceTimer = null;

    function getSupabaseClient() {
        if (global.supabaseClient) return global.supabaseClient;
        if (global.db) return global.db;
        const url = global.__SUPABASE_URL__;
        const key = global.__SUPABASE_ANON__;
        if (global.supabase?.createClient && url && key) {
            global.supabaseClient = global.supabase.createClient(url, key);
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
        { value: 'TOS', label: 'Table of Specifications (TOS)' }
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
        return {
            role: faculty.role || normalizeRoleValue(faculty.raw_role),
            admin_access: faculty.admin_access === true
        };
    }

    function isChairperson(faculty) {
        return normalizeRole(faculty).role === 'chairperson';
    }

    function isWorkflowAdmin(faculty) {
        if (!faculty) return false;
        const { role, admin_access } = normalizeRole(faculty);
        if (role === 'admin' || role === 'dean' || role === 'college_secretary') return true;
        if (role === 'chairperson' && admin_access) return true;
        return false;
    }

    function isFinalApprover(faculty) {
        if (!faculty) return false;
        const { role } = normalizeRole(faculty);
        return role === 'admin' || role === 'dean' || role === 'college_secretary' ||
            (role === 'chairperson' && faculty.admin_access === true);
    }

    function sameDepartment(a, b) {
        if (!a || !b) return false;
        return normalizeText(a.department_code || a.department) === normalizeText(b.department_code || b.department);
    }

    function getApprovalStage(submission) {
        if (!submission) return APPROVAL_STAGES.CHAIRPERSON;
        return submission.approval_stage || APPROVAL_STAGES.CHAIRPERSON;
    }

    function sanitizeDbStatus(status) {
        const s = normalizeText(status);
        if (VALID_DB_STATUSES.has(s)) return s;
        if (s === 'pending') return 'underreview';
        return 'submitted';
    }

    function getWorkflowStage(submission, task) {
        const status = sanitizeDbStatus(submission?.status);
        const stage = getApprovalStage(submission);

        if (status === 'approved' && stage === APPROVAL_STAGES.APPROVED) return 'completed';
        if (status === 'rejected') return 'rejected';
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

    function isFinallyApproved(submission, task) {
        return getWorkflowStage(submission, task) === 'completed';
    }

    function canFacultyManageSubmissionFiles(submission, task) {
        if (!submission) return true;
        if (isFinallyApproved(submission, task)) return false;
        const status = sanitizeDbStatus(submission.status);
        const stage = getApprovalStage(submission);
        if (status === 'approved' && stage === APPROVAL_STAGES.APPROVED) return false;
        return true;
    }

    function facultyFilesWereUpdatedAfterReview(submission) {
        if (!submission?.submitted_at || !submission?.reviewed_at) return false;
        return new Date(submission.submitted_at).getTime() > new Date(submission.reviewed_at).getTime();
    }

    function buildFacultyFileChangeUpdate(submission, task, remainingFileCount) {
        if (!remainingFileCount) {
            return {
                status: 'notsubmitted',
                submitted_at: null,
                is_late: false,
                submitted_status: null,
                approval_stage: APPROVAL_STAGES.CHAIRPERSON
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
            approval_stage: APPROVAL_STAGES.CHAIRPERSON
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

    function formatWorkflowStatus(submission, task) {
        const stage = getWorkflowStage(submission, task);
        const map = {
            assigned: 'Not Submitted',
            late_pending: 'Overdue — Not Submitted',
            submitted: 'Submitted — Pending Chairperson Review',
            chairperson_review: 'Pending Chairperson Review',
            final_approval: 'Pending Final Approval',
            completed: 'Completed',
            revision_required: 'Revision Required',
            rejected: 'Rejected'
        };
        return map[stage] || 'Unknown';
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

    function canReviewAsChairperson(submission, actorFaculty, targetFaculty) {
        if (!submission || !actorFaculty || !targetFaculty) return false;
        if (!isChairperson(actorFaculty)) return false;
        if (getApprovalStage(submission) !== APPROVAL_STAGES.CHAIRPERSON) return false;
        if (!sameDepartment(actorFaculty, targetFaculty)) return false;
        const status = sanitizeDbStatus(submission.status);
        return ['submitted', 'late', 'underreview'].includes(status);
    }

    function canReviewAsFinalApprover(submission, actorFaculty) {
        if (!submission || !actorFaculty) return false;
        if (!isFinalApprover(actorFaculty)) return false;
        if (getApprovalStage(submission) !== APPROVAL_STAGES.FINAL) return false;
        const status = sanitizeDbStatus(submission.status);
        return status === 'underreview' || status === 'submitted';
    }

    function canAccessWorkflowApproval(faculty) {
        if (!faculty) return false;
        if (isFinalApprover(faculty)) return true;
        if (isChairperson(faculty)) return true;
        return isWorkflowAdmin(faculty);
    }

    function canAccessFacultyPortal(faculty, userMeta) {
        if (!faculty) return false;
        const role = faculty.role || normalizeRoleValue(userMeta?.role);
        return role === 'faculty' || role === 'chairperson';
    }

    async function getFreshSession(sb) {
        const { data: { session }, error } = await sb.auth.getSession();
        if (error || !session?.user) return null;
        const expiresAt = Number(session.expires_at || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (expiresAt && expiresAt > nowSec + 15) return session;
        const refreshed = await sb.auth.refreshSession();
        if (refreshed.error || !refreshed.data?.session?.user) return null;
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

        let response = await sb
            .from('faculty')
            .select('*')
            .eq('auth_user_id', authUser.id)
            .maybeSingle();

        if (response.error) {
            console.error('CiteFlowWorkflow.getCurrentFaculty by auth_user_id:', response.error);
        }

        if (!response.data && authUser.email) {
            const email = String(authUser.email).toLowerCase();
            response = await sb
                .from('faculty')
                .select('*')
                .or(`email.eq.${email},existing_email.eq.${email}`)
                .maybeSingle();
            if (response.error) {
                console.error('CiteFlowWorkflow.getCurrentFaculty by email:', response.error);
            }
        }

        const normalized = normalizeFaculty(response.data);
        return normalized;
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

        const allowed = !!faculty || role === 'faculty' || role === 'chairperson' ||
            role === 'dean' || role === 'college_secretary' || role === 'admin';

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
        const { error } = await sb.from('wf_notifications').insert(payload);
        if (error) console.error('CiteFlowWorkflow.createWorkflowNotification:', error);
        return !error;
    }

    async function recordApprovalHistory(sb, entry) {
        const { error } = await sb.from('wf_approval_history').insert(entry);
        if (error) console.error('CiteFlowWorkflow.recordApprovalHistory:', error);
        return !error;
    }

    /**
     * Compute next submission state after a review action.
     * Never returns "pending" — maps to underreview for DB enum compatibility.
     */
    function computeReviewTransition(submission, action, actorFaculty, config) {
        const stage = getApprovalStage(submission);
        const actorRole = normalizeRole(actorFaculty).role;
        const requiresChair = config?.requires_chairperson_review !== false;
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
            nextStage = APPROVAL_STAGES.REVISION;
            nextStatus = 'rejected';
            historyAction = 'rejected';
        }

        return { nextStage, nextStatus, historyAction, actorRoleLabel };
    }

    function buildReviewUpdate(transition, comment, actorName, rawSubmission) {
        const update = {
            status: transition.nextStatus,
            approval_stage: transition.nextStage,
            reviewed_by_name: actorName,
            reviewed_at: new Date().toISOString(),
            review_remarks: comment || null,
            last_reviewed_by_role: transition.actorRoleLabel
        };

        if (transition.nextStage === APPROVAL_STAGES.APPROVED) {
            update.final_approved_at = new Date().toISOString();
            update.final_approved_by_name = actorName;
            update.final_approval_remarks = comment || null;
        }

        if (transition.nextStatus === 'revision' || transition.nextStatus === 'rejected') {
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
            config
        } = options;

        const actorName = getActorDisplayName(actorFaculty, actorUser);
        const stage = getApprovalStage(submission);
        const target = targetFaculty || actorFaculty;

        if (action === 'approved') {
            if (stage === APPROVAL_STAGES.CHAIRPERSON) {
                if (!canReviewAsChairperson(submission, actorFaculty, target)) {
                    return { ok: false, error: 'You are not authorized to perform chairperson review on this submission.' };
                }
            } else if (stage === APPROVAL_STAGES.FINAL) {
                if (!canReviewAsFinalApprover(submission, actorFaculty)) {
                    return { ok: false, error: 'You are not authorized to perform final approval on this submission.' };
                }
            } else if (stage === APPROVAL_STAGES.APPROVED) {
                return { ok: false, error: 'This submission is already fully approved.' };
            }
        } else {
            const canChair = canReviewAsChairperson(submission, actorFaculty, target);
            const canFinal = canReviewAsFinalApprover(submission, actorFaculty);
            if (!canChair && !canFinal) {
                return { ok: false, error: 'You are not authorized to review this submission.' };
            }
        }

        if ((action === 'revision' || action === 'rejected') && !String(comment || '').trim()) {
            return { ok: false, error: 'Please provide remarks before submitting this action.' };
        }

        const transition = computeReviewTransition(submission, action, actorFaculty, config);
        const update = buildReviewUpdate(transition, comment, actorName, submission);

        const { error } = await sb.from('wf_submissions').update(update).eq('id', submissionId);
        if (error) {
            console.error('CiteFlowWorkflow.applySubmissionReview update:', error);
            return { ok: false, error: error.message || 'Failed to update submission.' };
        }

        await recordApprovalHistory(sb, {
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
            task_id: submission.task_id,
            submission_id: submissionId
        });

        return { ok: true, transition, update };
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
            task_id: taskId,
            submission_id: submissionId || null,
            message: `${isResubmit ? 'Resubmission' : 'New submission'} from ${actorName}: ${task?.title || 'Task'}`,
            is_read: false
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
            task_id: taskId,
            submission_id: submissionId || null,
            message: messageMap[changeType] || `${actorName} updated files on ${title}`,
            is_read: false
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

        const watched = tables || ['wf_submissions', 'wf_approval_history', 'wf_notifications', 'wf_task_assignments'];

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

    function buildTimelineSteps(submission, task, assignment, approvalHistory) {
        const history = Array.isArray(approvalHistory) ? approvalHistory : [];
        const subHistory = history.filter(h => String(h.submission_id) === String(submission?.id));

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

        return [assigned, submitted, chair, finalStep, completed];
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
        canReviewAsFinalApprover,
        canAccessWorkflowApproval,
        canAccessFacultyPortal,
        getApprovalStage,
        getWorkflowStage,
        isFinallyApproved,
        canFacultyManageSubmissionFiles,
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
        escapeHtml,
        sameDepartment
    };

    global.CiteFlowWorkflow = api;
})(typeof window !== 'undefined' ? window : globalThis);
