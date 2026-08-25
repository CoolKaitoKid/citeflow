/**
 * CITE-Flow shared workflow helpers.
 * Authoritative faculty source: public.faculty
 *   faculty.id          → BIGINT (do not confuse with UUID)
 *   faculty.auth_user_id → UUID (auth.users.id / profiles.id)
 * Frontend role checks are UI-only. Database authorization comes from RLS.
 */
(function (root) {
    const WF = root.CiteFlowWorkflow = root.CiteFlowWorkflow || {};

    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const ALLOWED_FILE_TYPES = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'application/zip'
    ];
    const ALLOWED_FILE_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'zip'];

    const STATUS_META = {
        draft: { key: 'DRAFT', label: 'Draft', className: 'wf-status-draft', tone: 'slate' },
        notsubmitted: { key: 'PENDING_SUBMISSION', label: 'Pending Submission', className: 'wf-status-pending', tone: 'amber' },
        pending_submission: { key: 'PENDING_SUBMISSION', label: 'Pending Submission', className: 'wf-status-pending', tone: 'amber' },
        submitted: { key: 'SUBMITTED', label: 'Submitted', className: 'wf-status-submitted', tone: 'blue' },
        late: { key: 'SUBMITTED', label: 'Submitted Late', className: 'wf-status-late', tone: 'red' },
        underreview: { key: 'CHAIRPERSON_REVIEW', label: 'Under Chairperson Review', className: 'wf-status-review', tone: 'blue' },
        chairperson_review: { key: 'CHAIRPERSON_REVIEW', label: 'Under Chairperson Review', className: 'wf-status-review', tone: 'blue' },
        pending: { key: 'PENDING_FINAL_APPROVAL', label: 'Pending Final Approval', className: 'wf-status-final', tone: 'indigo' },
        pending_final_approval: { key: 'PENDING_FINAL_APPROVAL', label: 'Pending Final Approval', className: 'wf-status-final', tone: 'indigo' },
        final_approver: { key: 'PENDING_FINAL_APPROVAL', label: 'Pending Final Approval', className: 'wf-status-final', tone: 'indigo' },
        revision: { key: 'RETURNED', label: 'Returned for Revision', className: 'wf-status-returned', tone: 'purple' },
        returned: { key: 'RETURNED', label: 'Returned for Revision', className: 'wf-status-returned', tone: 'purple' },
        rejected: { key: 'REJECTED', label: 'Rejected', className: 'wf-status-rejected', tone: 'red' },
        approved: { key: 'APPROVED', label: 'Approved', className: 'wf-status-approved', tone: 'green' },
        completed: { key: 'COMPLETED', label: 'Completed', className: 'wf-status-completed', tone: 'green' }
    };

    const STAGE_LABELS = {
        chairperson: 'Chairperson Review',
        final_approver: 'Final Approval',
        revision: 'Returned for Revision',
        approved: 'Completed',
        assigned: 'Assigned',
        submitted: 'Submitted'
    };

    let cachedUser = null;
    let cachedFaculty = null;
    let cachedAdmin = null;
    let cachedRoleContext = null;

    function getClient() {
        if (root.supabaseClient) return root.supabaseClient;
        if (typeof root.db !== 'undefined' && root.db?.auth) return root.db;
        if (root.supabase && typeof root.supabase.createClient === 'function' && root.__SUPABASE_URL__ && root.__SUPABASE_ANON__) {
            root.supabaseClient = root.supabase.createClient(root.__SUPABASE_URL__, root.__SUPABASE_ANON__, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            });
            return root.supabaseClient;
        }
        return null;
    }

    function sameId(a, b) {
        if (a == null || b == null) return false;
        return String(a).trim() === String(b).trim();
    }

    function asFacultyId(value) {
        if (value == null || value === '') return value;
        return value;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function truthyFlag(value) {
        if (value === true || value === 1) return true;
        const text = normalizeText(value);
        return text === 'true' || text === 't' || text === 'yes' || text === '1';
    }

    function isChairpersonRole(role) {
        const text = normalizeText(role);
        return text === 'chairperson' || text === 'department chairperson' || text.includes('chair');
    }

    function isAdminRole(role) {
        const text = normalizeText(role);
        return text === 'admin' || text === 'administrator' || text === 'dean' || text === 'secretary';
    }

    function isFacultyRole(role) {
        const text = normalizeText(role);
        return !text || text === 'faculty' || text === 'faculty member' || text === 'instructor' || text === 'lecturer';
    }

    function normalizeFaculty(row) {
        if (!row) return null;
        const status = String(row.status || 'Active');
        return {
            ...row,
            id: row.id,
            auth_user_id: row.auth_user_id || null,
            faculty_code: row.faculty_id || row.employee_id || row.id_number || row.faculty_code || '',
            full_name: row.full_name || row.name || row.email || 'Faculty Member',
            email: row.email || row.existing_email || '',
            department_code: row.department_code || row.department || 'N/A',
            department: row.department || row.department_code || 'N/A',
            role: row.role || row.user_role || row.position || 'Faculty',
            position: row.position || row.academic_rank || row.role || 'Faculty',
            admin_access: truthyFlag(row.admin_access),
            status,
            is_active: row.access_enabled !== false && status.toLowerCase() === 'active'
        };
    }

    function statusKey(raw, extra) {
        const stage = normalizeText(extra?.approval_stage || extra?.stage);
        const status = normalizeText(raw || extra?.status);
        if (stage === 'approved' || status === 'approved' || status === 'completed') return status === 'completed' ? 'completed' : 'approved';
        if (status === 'revision' || status === 'returned' || stage === 'revision') return 'revision';
        if (status === 'rejected') return 'rejected';
        if (stage === 'final_approver' || status === 'pending' || status === 'pending_final_approval') return 'pending';
        if (stage === 'chairperson' || status === 'underreview' || status === 'chairperson_review') return 'underreview';
        if (status === 'late') return 'late';
        if (status === 'submitted') return 'submitted';
        if (status === 'draft') return 'draft';
        return status || 'notsubmitted';
    }

    function getStatusMeta(raw, extra) {
        return STATUS_META[statusKey(raw, extra)] || STATUS_META.notsubmitted;
    }

    function formatWorkflowStatus(raw, extra) {
        return getStatusMeta(raw, extra).label;
    }

    function getStatusClass(raw, extra) {
        return getStatusMeta(raw, extra).className;
    }

    function formatDate(iso) {
        if (!iso) return '—';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDateTime(iso) {
        if (!iso) return '—';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function formatDeadline(iso) {
        if (!iso) return { label: 'No due date', overdue: false, days: null, className: 'wf-deadline-none' };
        const due = new Date(iso);
        if (Number.isNaN(due.getTime())) return { label: 'No due date', overdue: false, days: null, className: 'wf-deadline-none' };
        const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
        if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, overdue: true, days, className: 'wf-deadline-overdue' };
        if (days === 0) return { label: 'Due today', overdue: false, days, className: 'wf-deadline-soon' };
        if (days === 1) return { label: '1 day left', overdue: false, days, className: 'wf-deadline-soon' };
        if (days <= 3) return { label: `${days} days left`, overdue: false, days, className: 'wf-deadline-warn' };
        return { label: `${days} days left`, overdue: false, days, className: 'wf-deadline-ok' };
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'CF';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function friendlyError(error, fallback) {
        const message = String(error?.message || error || '');
        console.error(fallback || 'Workflow error:', error);
        if (/row-level security|rls|permission denied|42501/i.test(message)) {
            return fallback || 'You do not have permission to complete this action.';
        }
        if (/failed to fetch|network|load failed/i.test(message)) {
            return 'Unable to reach the server. Please check your connection and try again.';
        }
        return fallback || 'Something went wrong. Please try again.';
    }

    function ensureToastHost() {
        let host = document.getElementById('citeflow-toast-host');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'citeflow-toast-host';
        host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:12000;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(host);
        return host;
    }

    function showToast(message, type) {
        const host = ensureToastHost();
        const colors = {
            success: 'background:#064e3b;color:#d1fae5;border-color:#047857;',
            error: 'background:#7f1d1d;color:#fee2e2;border-color:#991b1b;',
            warn: 'background:#78350f;color:#fef3c7;border-color:#b45309;',
            info: 'background:#1e3a8a;color:#dbeafe;border-color:#1d4ed8;'
        };
        const el = document.createElement('div');
        el.style.cssText = `pointer-events:auto;max-width:380px;padding:12px 16px;border-radius:12px;border:1px solid;font-size:13px;font-weight:600;line-height:1.45;box-shadow:0 18px 40px rgba(15,23,42,.18);${colors[type] || colors.success}`;
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity .2s ease';
            setTimeout(() => el.remove(), 200);
        }, 3200);
        const legacy = document.getElementById('toast');
        if (legacy && typeof root.showToast !== 'function') {
            legacy.style.display = 'none';
        }
        return el;
    }

    function ensureConfirmHost() {
        let host = document.getElementById('citeflow-confirm-host');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'citeflow-confirm-host';
        host.innerHTML = `
            <div class="citeflow-confirm-backdrop" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:13000;align-items:center;justify-content:center;padding:20px;">
                <div style="background:#fff;border-radius:18px;max-width:460px;width:100%;box-shadow:0 30px 80px rgba(15,23,42,.28);overflow:hidden;">
                    <div style="padding:22px 24px 8px;">
                        <h3 id="citeflowConfirmTitle" style="margin:0;font-size:18px;font-weight:700;color:#111827;"></h3>
                        <p id="citeflowConfirmMessage" style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#4b5563;"></p>
                    </div>
                    <div style="padding:16px 24px 22px;display:flex;justify-content:flex-end;gap:10px;">
                        <button type="button" id="citeflowConfirmCancel" style="border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:10px;padding:9px 14px;font-weight:600;cursor:pointer;">Cancel</button>
                        <button type="button" id="citeflowConfirmOk" style="border:0;background:#621708;color:#fff;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;">Confirm</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(host);
        return host;
    }

    function confirmAction(title, message, confirmLabel) {
        return new Promise((resolve) => {
            const native = root.confirm;
            const host = ensureConfirmHost();
            const backdrop = host.querySelector('.citeflow-confirm-backdrop');
            const titleEl = host.querySelector('#citeflowConfirmTitle');
            const messageEl = host.querySelector('#citeflowConfirmMessage');
            const ok = host.querySelector('#citeflowConfirmOk');
            const cancel = host.querySelector('#citeflowConfirmCancel');
            titleEl.textContent = title || 'Please confirm';
            messageEl.textContent = message || 'Do you want to continue?';
            ok.textContent = confirmLabel || 'Confirm';
            backdrop.style.display = 'flex';
            const finish = (value) => {
                backdrop.style.display = 'none';
                ok.onclick = null;
                cancel.onclick = null;
                resolve(value);
            };
            ok.onclick = () => finish(true);
            cancel.onclick = () => finish(false);
            backdrop.onclick = (event) => {
                if (event.target === backdrop) finish(false);
            };
            if (!ok || !cancel) resolve(typeof native === 'function' ? native(message) : false);
        });
    }

    async function getCurrentUser() {
        if (cachedUser) return cachedUser;
        const sb = getClient();
        if (!sb) return null;
        const { data, error } = await sb.auth.getSession();
        if (error) {
            console.error('Unable to read auth session:', error);
            return null;
        }
        cachedUser = data?.session?.user || null;
        return cachedUser;
    }

    async function getCurrentFaculty(force) {
        if (cachedFaculty && !force) return cachedFaculty;
        const user = await getCurrentUser();
        if (!user) return null;
        const sb = getClient();
        if (!sb) return null;
        const email = String(user.email || '').toLowerCase();
        let response = await sb.from('faculty').select('*').eq('auth_user_id', user.id).maybeSingle();
        if (response.error) console.error('Failed to load faculty by auth_user_id:', response.error);
        if (!response.data && email) {
            response = await sb.from('faculty').select('*').or(`email.eq.${email},existing_email.eq.${email}`).maybeSingle();
            if (response.error) console.error('Failed to load faculty by email:', response.error);
        }
        cachedFaculty = normalizeFaculty(response.data);
        return cachedFaculty;
    }

    async function getCurrentAdminProfile() {
        if (cachedAdmin) return cachedAdmin;
        const user = await getCurrentUser();
        if (!user) return null;
        const sb = getClient();
        if (!sb) return null;
        const { data, error } = await sb.from('admin_profiles').select('*').eq('id', user.id).maybeSingle();
        if (error && error.code !== 'PGRST116') console.error('Failed to load admin_profiles:', error);
        cachedAdmin = data || null;
        return cachedAdmin;
    }

    async function getCurrentRoleContext(force) {
        if (cachedRoleContext && !force) return cachedRoleContext;
        const user = await getCurrentUser();
        const faculty = await getCurrentFaculty(force);
        const admin = await getCurrentAdminProfile();
        const metaRole = String(user?.user_metadata?.role || '').trim();
        const facultyRole = faculty?.role || '';
        if (faculty && metaRole && isAdminRole(metaRole) && !isChairpersonRole(facultyRole) && !truthyFlag(faculty.admin_access)) {
            console.warn('Role inconsistency: auth metadata says Admin but public.faculty does not grant admin_access.', {
                auth_user_id: user?.id,
                metadata_role: metaRole,
                faculty_role: facultyRole,
                faculty_id: faculty?.id
            });
        }
        const chair = isChairpersonRole(facultyRole);
        const adminAccess = !!(faculty && truthyFlag(faculty.admin_access));
        const adminUser = isAdminRole(metaRole) || isAdminRole(facultyRole) || !!admin;
        cachedRoleContext = {
            user,
            faculty,
            admin,
            metadataRole: metaRole,
            facultyRole,
            displayName:
                faculty?.full_name
                || [admin?.first_name, admin?.last_name].filter(Boolean).join(' ')
                || user?.user_metadata?.full_name
                || user?.email
                || 'User',
            isChairperson: chair,
            hasAdminAccess: adminAccess,
            isAdmin: adminUser && !chair ? true : (adminUser && adminAccess) || (adminUser && !faculty),
            canChairReview: chair,
            canFinalReview: adminUser || adminAccess,
            canManageWorkflow: adminUser || adminAccess,
            department: faculty?.department_code || faculty?.department || null,
            facultyId: faculty?.id || null
        };
        if (chair && !adminAccess) {
            cachedRoleContext.isAdmin = false;
            cachedRoleContext.canFinalReview = false;
            cachedRoleContext.canManageWorkflow = false;
        }
        if (chair && adminAccess) {
            cachedRoleContext.isAdmin = true;
            cachedRoleContext.canFinalReview = true;
            cachedRoleContext.canManageWorkflow = true;
        }
        return cachedRoleContext;
    }

    async function getCurrentRole() {
        const ctx = await getCurrentRoleContext();
        if (ctx.isChairperson && ctx.hasAdminAccess) return 'Chairperson+Admin';
        if (ctx.isChairperson) return 'Chairperson';
        if (ctx.isAdmin) return 'Admin';
        return 'Faculty';
    }

    async function getCurrentFacultyId() {
        const faculty = await getCurrentFaculty();
        return faculty?.id ?? null;
    }

    function canReviewSubmission(ctx, submission, facultyRow, config) {
        if (!ctx || !submission) return false;
        const stage = submission.approval_stage || 'chairperson';
        const status = normalizeText(submission.status);
        if (['approved', 'rejected'].includes(status) && stage === 'approved') return false;
        const sameDept = !ctx.department || !facultyRow?.department_code || sameId(ctx.department, facultyRow.department_code);
        if (ctx.canChairReview && (stage === 'chairperson' || !stage) && ['submitted', 'late', 'underreview', 'pending'].includes(status || 'submitted')) {
            return sameDept;
        }
        if (ctx.canFinalReview && stage === 'final_approver') return true;
        if (ctx.canFinalReview && config?.requires_chairperson_review === false && ['submitted', 'late', 'underreview', 'pending'].includes(status)) return true;
        return false;
    }

    function validateWorkflowFile(file) {
        if (!file) return 'Please choose a file to upload.';
        if (file.size > MAX_FILE_BYTES) return 'File is too large. Maximum size is 25 MB.';
        const ext = String(file.name || '').split('.').pop().toLowerCase();
        if (!ALLOWED_FILE_EXTS.includes(ext) && file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
            return 'This file type is not accepted. Use PDF, Office, image, or ZIP files.';
        }
        return null;
    }

    function unsubscribeChannel(client, channel) {
        if (!client || !channel) return;
        try {
            client.removeChannel(channel);
        } catch (error) {
            console.warn('Failed to remove realtime channel:', error);
        }
    }

    function createManagedChannel(client, name, tables, onChange) {
        if (!client) return null;
        let channel = client.channel(name);
        (tables || []).forEach((table) => {
            channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
        });
        channel.subscribe((status, error) => {
            if (error) console.error(`Realtime subscription error (${name}):`, error);
            if (status === 'CHANNEL_ERROR') console.error(`Realtime channel error: ${name}`);
        });
        return channel;
    }

    async function loadApprovalHistory(client, submissionId) {
        if (!client || !submissionId) return [];
        const { data, error } = await client
            .from('wf_approval_history')
            .select('*')
            .eq('submission_id', submissionId)
            .order('created_at', { ascending: true });
        if (error) {
            console.error('Unable to load approval history:', error);
            throw error;
        }
        return data || [];
    }

    function buildTimeline(row, history) {
        const submission = row?.submission || row;
        const assignment = row?.assignment || {};
        const facultyName = row?.faculty_name || row?.faculty?.full_name || '';
        const historyRows = Array.isArray(history) ? history : [];
        const chairEvent = [...historyRows].reverse().find((h) => /chair/i.test(`${h.action || ''} ${h.actor_role || ''}`));
        const finalEvent = [...historyRows].reverse().find((h) => /final|dean|secretary|admin/i.test(`${h.action || ''} ${h.actor_role || ''}`) && !/chair/i.test(`${h.action || ''}`));
        const stage = submission?.approval_stage || '';
        const status = statusKey(submission?.status, submission);
        const submitted = !!submission?.submitted_at;
        const chairDone = !!chairEvent || stage === 'final_approver' || stage === 'approved' || status === 'approved';
        const finalDone = stage === 'approved' || status === 'approved' || status === 'completed';
        const returned = status === 'revision' || status === 'rejected';

        return [
            {
                key: 'assigned',
                title: 'Assigned',
                done: true,
                current: !submitted,
                at: assignment.assigned_at || row?.task?.created_at || null,
                actor: assignment.assigned_by_name || 'System',
                remarks: 'Task assigned to faculty member.'
            },
            {
                key: 'submitted',
                title: 'Submitted',
                done: submitted,
                current: submitted && !chairDone && !returned,
                at: submission?.submitted_at || null,
                actor: submitted ? (facultyName || 'Faculty') : '',
                remarks: submitted ? 'Documents were submitted for review.' : 'Waiting for submission.'
            },
            {
                key: 'chairperson',
                title: 'Chairperson Review',
                done: chairDone && !returned,
                current: submitted && (stage === 'chairperson' || (!stage && submitted)) && !finalDone && !returned,
                at: chairEvent?.created_at || (chairDone ? submission?.reviewed_at : null),
                actor: chairEvent?.actor_name || (chairDone ? submission?.reviewed_by_name : ''),
                remarks: chairEvent?.comment || (returned && stage !== 'final_approver' ? (submission?.review_remarks || '') : (chairDone ? 'Chairperson review completed.' : 'Currently waiting'))
            },
            {
                key: 'final',
                title: 'Final Approval',
                done: finalDone,
                current: stage === 'final_approver',
                at: finalEvent?.created_at || submission?.final_approved_at || (finalDone ? submission?.reviewed_at : null),
                actor: finalEvent?.actor_name || submission?.final_approved_by_name || '',
                remarks: finalEvent?.comment || submission?.final_approval_remarks || (finalDone ? 'Final approval completed.' : 'Waiting')
            },
            {
                key: 'completed',
                title: 'Completed',
                done: finalDone,
                current: false,
                at: finalDone ? (submission?.final_approved_at || submission?.reviewed_at) : null,
                actor: finalDone ? (submission?.final_approved_by_name || submission?.reviewed_by_name || '') : '',
                remarks: finalDone ? 'Workflow completed.' : 'Waiting'
            }
        ];
    }

    function actionLabelForStatus(status) {
        const key = statusKey(status, { status });
        if (['notsubmitted', 'late', 'draft'].includes(key) || status === 'Not Submitted' || status === 'Late') return 'Submit Now';
        if (key === 'revision' || status === 'Returned for Revision' || status === 'Rejected') return 'Revise & Resubmit';
        if (['submitted', 'underreview', 'pending'].includes(key) || status === 'Submitted' || status === 'Under Review') return 'View Submission';
        if (key === 'approved' || status === 'Approved') return 'View Details';
        if (key === 'completed') return 'View Record';
        return 'View Details';
    }

    function emptyState(title, subtitle, icon) {
        return `
            <div class="wf-empty-state">
                <div class="wf-empty-icon">${icon || '<i class="fa-regular fa-folder-open"></i>'}</div>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(subtitle)}</p>
            </div>`;
    }

    WF.MAX_FILE_BYTES = MAX_FILE_BYTES;
    WF.STATUS_META = STATUS_META;
    WF.STAGE_LABELS = STAGE_LABELS;
    WF.sameId = sameId;
    WF.asFacultyId = asFacultyId;
    WF.escapeHtml = escapeHtml;
    WF.normalizeText = normalizeText;
    WF.normalizeFaculty = normalizeFaculty;
    WF.isChairpersonRole = isChairpersonRole;
    WF.isAdminRole = isAdminRole;
    WF.isFacultyRole = isFacultyRole;
    WF.statusKey = statusKey;
    WF.getStatusMeta = getStatusMeta;
    WF.formatWorkflowStatus = formatWorkflowStatus;
    WF.getStatusClass = getStatusClass;
    WF.formatDate = formatDate;
    WF.formatDateTime = formatDateTime;
    WF.formatDeadline = formatDeadline;
    WF.initials = initials;
    WF.friendlyError = friendlyError;
    WF.showToast = showToast;
    WF.confirmAction = confirmAction;
    WF.getCurrentUser = getCurrentUser;
    WF.getCurrentFaculty = getCurrentFaculty;
    WF.getCurrentFacultyId = getCurrentFacultyId;
    WF.getCurrentRole = getCurrentRole;
    WF.getCurrentRoleContext = getCurrentRoleContext;
    WF.canReviewSubmission = canReviewSubmission;
    WF.validateWorkflowFile = validateWorkflowFile;
    WF.unsubscribeChannel = unsubscribeChannel;
    WF.createManagedChannel = createManagedChannel;
    WF.loadApprovalHistory = loadApprovalHistory;
    WF.buildTimeline = buildTimeline;
    WF.actionLabelForStatus = actionLabelForStatus;
    WF.emptyState = emptyState;
    WF.clearCache = function () {
        cachedUser = null;
        cachedFaculty = null;
        cachedAdmin = null;
        cachedRoleContext = null;
    };
})(window);
