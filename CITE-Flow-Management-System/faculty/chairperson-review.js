/* Chairperson Review — lives inside faculty/submissions.html */
console.log("[Submissions Debug] chairperson-review.js file executed");

(function initCiteFlowChairReview(global) {
    'use strict';

    const REVIEWABLE = new Set(['submitted', 'late', 'underreview']);
    const SUBMISSION_BUCKET = 'wf-submissions';
    let fileActionSeq = 0;

    const review = {
        access: false,
        mode: 'mine',
        tab: 'pending', // 'pending' | 'not_submitted' | 'approved' | 'revision' | 'declined' | 'reports' | 'department'
        search: '',
        grants: [],
        submissions: [],
        files: [],
        filesError: null,
        fileActions: {},
        tasks: [],
        assignments: [],
        faculty: [],
        configs: [],
        mfoPackets: [],
        visibility: null,
        sqlVersion: null,
        revisionId: null,
        actionMode: 'revision',
        arSubmissions: [],
        filterType: 'all', // 'all' | 'mfo' | 'ar' | 'tasks'
        notSubmittedFilter: 'all', // 'all' | 'open' | 'overdue'
        reportFilterFreq: 'all', // 'all' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual'
        expandedCycles: {}, // map of `${groupId}_${cycleId}` -> boolean
        activeTaskDetailsId: null,
        activeArReportId: null,
        activeConsolidatedMfoTaskId: null,
        mfoDraftBusy: false,
        consolidatedMfoActiveTab: 'summary',
        activeConsolidatedCustomizations: null,
        activeConsolidatedHasUnsavedChanges: false,
        activeConsolidatedFilter: 'all',
        activeConsolidatedSearch: '',
        activeConsolidatedModel: null,
        activeConsolidatedStaleness: null,
        activeConsolidatedDraft: null,
        activeConsolidatedChildRows: null,
        activeConsolidatedProgramRows: null,
        pendingRemoveTarget: null
    };

    function wf() {
        return global.CiteFlowWorkflow;
    }

    function db() {
        const shared = global.CiteFlowAuth?.ensureSharedClient?.();
        if (shared) {
            global.supabaseClient = shared;
            return shared;
        }
        return global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.() || global.db;
    }

    function esc(value) {
        if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }

    function facultyMap() {
        return new Map((review.faculty || []).map((row) => [String(row.id), row]));
    }

    function taskMap() {
        return new Map((review.tasks || []).map((row) => [String(row.id), row]));
    }

    function configMap() {
        return new Map((review.configs || []).map((row) => [String(row.id), row]));
    }

    function filesFor(submissionId) {
        return (review.files || []).filter((file) => String(file.submission_id) === String(submissionId));
    }

    function effectiveGrants() {
        if (review.grants && review.grants.length) {
            return review.grants.filter((grant) => grant && grant.is_active !== false);
        }
        if (review.access && global.currentFaculty) {
            return [{
                is_active: true,
                grantee_faculty_id: global.currentFaculty.id,
                grantee_auth_user_id: global.currentFaculty.auth_user_id || global.currentUser?.id || null
            }];
        }
        return [];
    }

    function authorizedDepartmentCodes() {
        const helper = wf();
        const actor = global.currentFaculty;
        if (!actor) return [];
        const grants = effectiveGrants();
        if (helper?.chairpersonAuthorizedDepartments) {
            const depts = helper.chairpersonAuthorizedDepartments(actor, grants) || [];
            if (depts.length) return depts;
        }
        const home = helper?.facultyDepartmentCode?.(actor)
            || String(actor?.department || actor?.department_code || '').trim().toLowerCase();
        return home ? [home] : [];
    }

    function chairDepartment() {
        const codes = authorizedDepartmentCodes();
        return codes[0] || '';
    }

    function chairDepartmentDisplay() {
        const codes = authorizedDepartmentCodes();
        return codes.map((c) => c.toUpperCase()).join(', ') || '—';
    }

    function sameDept(target) {
        const helper = wf();
        const actor = global.currentFaculty;
        const left = helper?.facultyDepartmentCode?.(actor) || String(actor?.department || actor?.department_code || '').trim().toLowerCase();
        const right = helper?.facultyDepartmentCode?.(target) || String(target?.department || target?.department_code || '').trim().toLowerCase();
        return !!left && !!right && left === right;
    }

    function isFacultyInChairScope(target) {
        if (!target) return false;
        const helper = wf();
        if (helper?.canBrowseAsChairperson) {
            return helper.canBrowseAsChairperson(global.currentFaculty, target, effectiveGrants());
        }
        const authorized = authorizedDepartmentCodes();
        const dept = helper?.facultyDepartmentCode?.(target) || String(target?.department || target?.department_code || '').trim().toLowerCase();
        if (authorized.length) return authorized.includes(dept);
        return sameDept(target);
    }

    function targetFaculty(row) {
        return facultyMap().get(String(row.faculty_id)) || {
            id: row.faculty_id,
            department: row.department,
            department_code: row.department,
            full_name: row.faculty_name
        };
    }

    function reviewContext(task) {
        return {
            delegatedAccess: effectiveGrants(),
            config: task?.report_config_id ? configMap().get(String(task.report_config_id)) : null,
            task
        };
    }

    function scopedFaculty() {
        return (review.faculty || []).filter(isFacultyInChairScope);
    }

    function scopedAssignments() {
        const people = facultyMap();
        return (review.assignments || []).filter((a) => {
            const person = people.get(String(a.faculty_id));
            return isFacultyInChairScope(person || { id: a.faculty_id, department: a.department });
        });
    }

    function scopedSubmissions() {
        return (review.submissions || []).filter((sub) => {
            const person = targetFaculty(sub);
            return isFacultyInChairScope(person);
        }).map((sub) => {
            if (sub.mfo_packet) return sub;
            const mfoPacket = (review.mfoPackets || []).find((p) =>
                (p.submission_id && String(p.submission_id) === String(sub.id)) ||
                (p.task_id && p.faculty_id && String(p.task_id) === String(sub.task_id) && String(p.faculty_id) === String(sub.faculty_id))
            );
            return mfoPacket ? { ...sub, mfo_packet: mfoPacket } : sub;
        });
    }

    function scopedTasks() {
        const assignedTaskIds = new Set(scopedAssignments().map((a) => String(a.task_id)));
        const submittedTaskIds = new Set(scopedSubmissions().map((s) => String(s.task_id)));
        const authorized = new Set(authorizedDepartmentCodes());

        return (review.tasks || []).filter((task) => {
            const idStr = String(task.id);
            if (assignedTaskIds.has(idStr) || submittedTaskIds.has(idStr)) return true;
            const taskDept = String(task.department_code || task.department || '').trim().toLowerCase();
            if (taskDept && authorized.has(taskDept)) return true;
            if (!taskDept && (task.is_all_departments || task.target_scope === 'college')) return true;
            return false;
        });
    }

    function getDepartmentAnalytics() {
        const helper = wf();
        const defaultRes = {
            counts: {
                expected: 0,
                submitted: 0,
                not_submitted: 0,
                not_submitted_open: 0,
                not_submitted_overdue: 0,
                pending_review: 0,
                needs_revision: 0,
                approved: 0,
                rejected: 0,
                timing_on_time: 0,
                timing_late: 0,
                orphaned_submissions: 0
            },
            balances: {
                exclusiveMatchesSubmitted: true,
                notSubmittedMatchesCategories: true,
                coverageMatchesExpected: true
            },
            assignedRecords: [],
            orphanedRecords: []
        };
        if (!helper?.computeSubmissionAnalytics) return defaultRes;

        return helper.computeSubmissionAnalytics(
            scopedAssignments(),
            scopedSubmissions(),
            scopedTasks(),
            {
                reportConfigs: review.configs || [],
                mfoPackets: review.mfoPackets || [],
                authorizedDepartments: authorizedDepartmentCodes()
            }
        );
    }

    function getRecurringAnalytics() {
        const helper = wf();
        if (!helper?.computeRecurringReportAnalytics) {
            return { groups: [], cycleAnalyticsMap: new Map(), overallCounts: {}, overallBalances: {} };
        }
        return helper.computeRecurringReportAnalytics(
            scopedTasks(),
            scopedAssignments(),
            scopedSubmissions(),
            review.configs || [],
            {
                reportConfigs: review.configs || [],
                mfoPackets: review.mfoPackets || [],
                authorizedDepartments: authorizedDepartmentCodes()
            }
        );
    }

    function formatDeadlineRelative(dateStr, now = Date.now()) {
        if (!dateStr) return { text: 'No deadline set', isOverdue: false, dateText: '—' };
        const dueTime = new Date(dateStr).getTime();
        if (isNaN(dueTime)) return { text: 'No deadline set', isOverdue: false, dateText: '—' };
        const diffMs = dueTime - now;
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        const formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        if (diffMs < 0) {
            const overdueDays = Math.max(1, Math.abs(diffDays));
            return {
                text: `Overdue by ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`,
                isOverdue: true,
                dateText: formattedDate
            };
        } else if (diffDays === 0) {
            return {
                text: `Due today`,
                isOverdue: false,
                dateText: formattedDate
            };
        } else {
            return {
                text: `Due in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`,
                isOverdue: false,
                dateText: formattedDate
            };
        }
    }

    function renderStatusPill(statusKey, label) {
        let cls = 'pill-neutral';
        if (statusKey === 'approved') cls = 'pill-approved';
        else if (statusKey === 'pending_review' || statusKey === 'pending') cls = 'pill-pending';
        else if (statusKey === 'needs_revision' || statusKey === 'revision') cls = 'pill-revision';
        else if (statusKey === 'rejected' || statusKey === 'declined' || statusKey === 'not_submitted_overdue') cls = 'pill-rejected';
        else if (statusKey === 'not_submitted_open') cls = 'pill-neutral';
        return `<span class="pill-badge ${cls}"><span class="pill-dot"></span>${esc(label || statusKey)}</span>`;
    }

    function buildNonSubmittedRows() {
        const analytics = getDepartmentAnalytics();
        const people = facultyMap();
        const tasks = taskMap();

        const rows = (analytics.assignedRecords || [])
            .filter((rec) => !rec.classification?.is_submitted)
            .map((rec) => {
                const person = people.get(String(rec.faculty_id)) || {
                    id: rec.faculty_id,
                    full_name: 'Faculty Member',
                    department: chairDepartment()
                };
                const task = tasks.get(String(rec.task_id)) || {
                    id: rec.task_id,
                    title: 'Assigned Task'
                };
                const deadlineInfo = formatDeadlineRelative(task.deadline_at || task.due_at);
                const mfoPacket = (review.mfoPackets || []).find((p) =>
                    (String(p.task_id) === String(rec.task_id) && String(p.faculty_id) === String(rec.faculty_id))
                );
                const isDraftPacket = mfoPacket && (mfoPacket.packet_state === 'draft' || mfoPacket.packet_state === 'in_progress');

                return {
                    faculty_id: rec.faculty_id,
                    task_id: rec.task_id,
                    faculty_name: person.full_name || person.name || 'Faculty Member',
                    department: person.department || person.department_code || chairDepartment(),
                    task_title: task.title || 'Task',
                    task,
                    deadlineInfo,
                    is_overdue: rec.classification?.is_overdue || false,
                    status_key: rec.classification?.status_key || rec.classification?.category || (rec.classification?.is_overdue ? 'not_submitted_overdue' : 'not_submitted_open'),
                    status_label: rec.classification?.status_label || (rec.classification?.is_overdue ? 'Not Submitted (Overdue)' : 'Not Submitted (Open)'),
                    is_draft_packet: isDraftPacket,
                    mfo_packet: mfoPacket || null
                };
            });

        return rows;
    }

    function buildRows() {
        const helper = wf();
        const people = facultyMap();
        const tasks = taskMap();

        const taskRows = (review.submissions || []).map((sub) => {
            const person = people.get(String(sub.faculty_id));
            const task = tasks.get(String(sub.task_id));
            const config = task?.report_config_id ? configMap().get(String(task.report_config_id)) : null;
            const mfoPacket = (review.mfoPackets || []).find((p) => String(p.submission_id) === String(sub.id) || (String(p.task_id) === String(sub.task_id) && String(p.faculty_id) === String(sub.faculty_id)));
            const isMfo = !!mfoPacket || submissionIsMfo({ ...sub, task, config });
            return {
                ...sub,
                is_ar: false,
                is_mfo: isMfo,
                mfo_packet: mfoPacket || null,
                faculty_name: person?.full_name || person?.name || 'Faculty',
                department: person?.department || person?.department_code || '',
                task_title: task?.title || (isMfo ? 'MFO Accomplishment Report' : 'Submission'),
                task,
                config,
                files: filesFor(sub.id)
            };
        }).filter((row) => {
            if (!review.access) return false;
            return isFacultyInChairScope(targetFaculty(row));
        });

        const arRows = (review.arSubmissions || []).map((ar) => {
            const person = people.get(String(ar.faculty_id));
            const typeLabel = ar.report_type === 'online'
                ? 'Online / WFH Accomplishment Report'
                : 'Face-to-Face Accomplishment Report';
            const fmtPeriod = (s, e) => {
                const f = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                return s && e ? `${f(s)} – ${f(e)}` : 'Period not specified';
            };
            return {
                ...ar,
                id: ar.id,
                is_ar: true,
                faculty_name: person?.full_name || person?.name || 'Faculty',
                department: person?.department || person?.department_code || '',
                task_title: typeLabel,
                period_text: fmtPeriod(ar.period_start, ar.period_end),
                task: null,
                config: null,
                files: []
            };
        }).filter((row) => {
            if (!review.access) return false;
            const target = targetFaculty(row);
            return isFacultyInChairScope(target);
        });

        return [...taskRows, ...arRows].sort((a, b) => new Date(b.submitted_at || b.created_at || 0) - new Date(a.submitted_at || a.created_at || 0));
    }

     function isPending(row) {
        if (!row) return false;

        // 1. Handling para sa Accomplishment Reports (AR)
        if (row.is_ar) {
            if (!review.access) return false;
            
            const st = String(row.status || '').toLowerCase().trim();
            const isPendingStatus = (st === 'submitted' || st === 'pending' || st === 'underreview' || st === 'under_review');
            if (!isPendingStatus) return false;

            // I-verify ang department authority kung nailhan ang target faculty
            const target = targetFaculty(row);
            if (target) {
                const helper = wf();
                const authorized = helper?.chairpersonAuthorizedDepartments?.(global.currentFaculty, effectiveGrants()) || [];
                const dept = helper?.facultyDepartmentCode?.(target) || '';
                const inDept = authorized.length ? authorized.includes(dept) : sameDept(target);
                if (!inDept) return false;
            }
            return true;
        }

        // 2. Handling para sa Regular Task Submissions & RPC Queue
        const helper = wf();
        if (!helper || !review.access) return false;
        
        if (helper.canReviewAsChairperson(row, global.currentFaculty, targetFaculty(row), reviewContext(row.task))) {
            return true;
        }
        // The row came from the authoritative Chairperson queue RPC, which
        // already enforced grant, department, and workflow-stage scope.
        if (!row.is_ar && helper.isPendingChairpersonReview(row, row.config, row.task)) {
            return true;
        }
        
        const target = targetFaculty(row);
        const inDept = isFacultyInChairScope(target);
        return inDept && helper.isPendingChairpersonReview(row, row.config, row.task);
    }
    function isApproved(row) {
        if (row.is_ar) {
            return row.status === 'chair_approved' || row.status === 'dean_approved';
        }
        const helper = wf();
        const status = String(row.status || '').toLowerCase();
        if (status === 'rejected' || status === 'revision') return false;
        const stage = String(row.approval_stage || '').toLowerCase();
        if (stage === 'declined' || stage === 'revision') return false;
        if (status === 'approved' || stage === 'approved') return true;
        const required = helper?.requiresChairpersonReview?.(row.config, row.task);
        if (required === false) return false;
        return stage === 'final' || stage === 'final_approver';
    }

    function isRevision(row) {
        if (row.is_ar) {
            return row.status === 'revision';
        }
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        return status === 'revision' || stage === 'revision';
    }

    function isDeclined(row) {
        if (row.is_ar) {
            return row.status === 'rejected';
        }
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        return status === 'rejected' || stage === 'declined';
    }

    function filteredRows() {
        let rows = buildRows();
        if (review.filterType === 'ar') {
            rows = rows.filter((r) => r.is_ar);
        } else if (review.filterType === 'mfo') {
            rows = rows.filter((r) => r.is_mfo || submissionIsMfo(r));
        } else if (review.filterType === 'tasks') {
            rows = rows.filter((r) => !r.is_ar && !r.is_mfo && !submissionIsMfo(r));
        }

        const q = String(review.search || '').trim().toLowerCase();
        const searched = q
            ? rows.filter((row) => [row.faculty_name, row.task_title, row.department, row.status, row.period_text || '']
                .join(' ')
                .toLowerCase()
                .includes(q))
            : rows;

        if (review.filterType === 'ar') return searched;
        if (review.tab === 'approved') return searched.filter(isApproved);
        if (review.tab === 'revision') return searched.filter(isRevision);
        if (review.tab === 'declined') return searched.filter(isDeclined);
        if (review.tab === 'department') return searched;
        return searched.filter(isPending);
    }

    function setFilterType(type) {
        review.filterType = ['all', 'mfo', 'ar', 'tasks'].includes(type) ? type : 'all';
        render();
    }

    function setNotSubmittedFilter(filter) {
        review.notSubmittedFilter = ['all', 'open', 'overdue'].includes(filter) ? filter : 'all';
        render();
    }

    function setReportFilterFreq(freq) {
        review.reportFilterFreq = ['all', 'monthly', 'quarterly', 'semi_annual', 'annual'].includes(freq) ? freq : 'all';
        render();
    }

    function toggleCycle(groupKey, cycleId) {
        const key = `${groupKey}_${cycleId}`;
        review.expandedCycles[key] = !review.expandedCycles[key];
        render();
    }

    function fileName(file) {
        return file?.file_name || file?.name || file?.filename || 'Submitted file';
    }

    function storagePathOf(file) {
        return file?.storage_path || file?.path || '';
    }

    function looksLikeHttpUrl(value) {
        return /^https?:\/\//i.test(String(value || '').trim());
    }

    function fileUrl(file) {
        return file?._resolvedUrl
            || file?.file_url
            || file?.public_url
            || file?.url
            || file?.signed_url
            || (looksLikeHttpUrl(file?.path) ? file.path : '')
            || '';
    }

    async function resolveFileUrl(file) {
        if (!file) return '';
        const direct = fileUrl(file);
        if (looksLikeHttpUrl(direct)) return direct;

        const path = storagePathOf(file);
        const client = db();
        if (path && client?.storage) {
            const signed = await client.storage.from(SUBMISSION_BUCKET).createSignedUrl(path, 60 * 60);
            if (signed.error) console.warn('[Chairperson File Debug] signed URL error:', signed.error);
            if (signed.data?.signedUrl) return signed.data.signedUrl;

            const pub = client.storage.from(SUBMISSION_BUCKET).getPublicUrl(path);
            if (pub?.data?.publicUrl) return pub.data.publicUrl;
        }

        return direct || path || '';
    }

    function registerFileAction(file) {
        const key = `wf_file_${++fileActionSeq}`;
        review.fileActions[key] = file;
        return key;
    }

    function previewFile(url, name) {
        const title = document.getElementById('chairFilePreviewTitle');
        const frame = document.getElementById('chairFilePreviewFrame');
        const link = document.getElementById('chairFilePreviewDownloadLink');
        const modal = document.getElementById('chairFilePreviewModal');
        if (!modal || !frame) {
            if (url) window.open(url, '_blank', 'noopener');
            return;
        }
        if (title) title.textContent = name || 'Submitted file';
        frame.src = url || '';
        if (link) {
            link.href = url || '#';
            link.download = name || '';
        }
        modal.classList.add('open');
    }

    function closeFilePreview() {
        const modal = document.getElementById('chairFilePreviewModal');
        const frame = document.getElementById('chairFilePreviewFrame');
        modal?.classList.remove('open');
        if (frame) frame.src = '';
    }

    function downloadFile(url, name) {
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = name || '';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function previewByKey(key) {
        const file = review.fileActions[key];
        const url = fileUrl(file);
        if (!file || !url) {
            toast('This file does not have a preview URL saved.', 'warn');
            return;
        }
        previewFile(url, fileName(file));
    }

    function downloadByKey(key) {
        const file = review.fileActions[key];
        const url = fileUrl(file);
        if (!file || !url) {
            toast('This file does not have a download URL saved.', 'warn');
            return;
        }
        downloadFile(url, fileName(file));
    }

    function formatWhen(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function toast(message, type) {
        if (wf()?.showToast) wf().showToast(message, type || 'info');
        else if (global.CiteFlowUI?.showMessage) global.CiteFlowUI.showMessage(message, type === 'error' ? 'error' : 'info');
        else alert(message);
    }

    function setMode(mode) {
        if (mode === 'chair' && !review.access) {
            review.mode = 'mine';
            if (typeof global.renderListPage === 'function') global.renderListPage();
            return;
        }
        review.mode = mode === 'chair' ? 'chair' : 'mine';
        if (review.mode === 'chair') {
            location.hash = '#chair-review';
            global.currentView = 'chair-review';
            render();
            return;
        }

        if (location.hash === '#chair-review' || location.hash === '#chairperson-review') {
            history.replaceState(null, '', location.pathname);
        }
        global.currentView = 'list';
        if (typeof global.renderListPage === 'function') global.renderListPage();
    }

    function setTab(tab) {
        review.tab = ['pending', 'not_submitted', 'approved', 'revision', 'declined', 'reports', 'department'].includes(tab) ? tab : 'pending';
        render();
    }

    function setSearch(value) {
        review.search = value;
        render();
    }

    function emptyState(title, text) {
        return `
            <div class="surface rounded-[16px] p-10 text-center">
                <div class="text-slate-300 text-3xl mb-3"><i class="fa-solid fa-folder-open"></i></div>
                <div class="font-bold text-slate-800">${esc(title)}</div>
                <p class="text-sm text-slate-500 mt-1">${esc(text)}</p>
            </div>`;
    }

    function parseRpcJson(raw) {
        let value = raw;
        for (let i = 0; i < 5; i += 1) {
            if (value == null) return null;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return null;
                try { value = JSON.parse(trimmed); } catch (_) { return null; }
                continue;
            }
            if (Array.isArray(value)) {
                value = value[0];
                continue;
            }
            if (typeof value === 'object') {
                if (value.sql_patch_version || value.empty_reason || Object.prototype.hasOwnProperty.call(value, 'has_grant')) {
                    return value;
                }
                if (value.wf_debug_chairperson_visibility) {
                    value = value.wf_debug_chairperson_visibility;
                    continue;
                }
                if (value.wf_debug_chairperson_queue) {
                    value = value.wf_debug_chairperson_queue;
                    continue;
                }
                return value;
            }
            return null;
        }
        return value && typeof value === 'object' ? value : null;
    }

    function queueBlockerBanner() {
        if (review.access || (review.submissions || []).length) return '';

        return `
            <div class="rounded-[16px] border border-amber-200 bg-amber-50 p-4 mb-4 text-sm text-amber-950">
                <p class="font-bold">Chairperson Review Queue</p>
                <p class="mt-1">Review access is reserved for Department Chairpersons and delegated reviewers. Submissions requiring Chairperson review will be processed by authorized department reviewers.</p>
            </div>`;
    }

    function renderFiles(files) {
        if (review.filesError) {
            const message = review.filesError.message || JSON.stringify(review.filesError);
            return `<p class="text-sm text-red-600">Could not load submitted files: ${esc(message)}</p>`;
        }
        if (!files.length) {
            return '<p class="text-sm text-slate-400">No submitted files saved.</p>';
        }
        const rows = files.map((file) => {
            const url = fileUrl(file);
            const name = esc(fileName(file));
            const key = registerFileAction(file);
            return `
                <div class="chair-file-row">
                    <span class="text-sm text-slate-800 truncate"><i class="fa-solid fa-file-lines mr-1.5 text-slate-500"></i>${name}</span>
                    <div class="flex gap-2 shrink-0">
                        <button type="button" class="file-manage-btn" ${url ? `onclick="CiteFlowChairReview.previewFile('${key}')"` : 'disabled title="No file URL saved"'}>Preview</button>
                        <button type="button" class="file-manage-btn" ${url ? `onclick="CiteFlowChairReview.downloadFile('${key}')"` : 'disabled title="No file URL saved"'}>Download</button>
                    </div>
                </div>`;
        }).join('');
        return `
            <div>
                <p class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Submitted Document</p>
                <div class="space-y-2">${rows}</div>
            </div>`;
    }

    function renderArCard(row) {
        const actions = `
            <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openArReview('${row.id}')">
                <i class="fa-solid fa-file-pdf mr-1"></i> View Report
            </button>
            ${row.report_pdf_url ? `<a href="${esc(row.report_pdf_url)}" target="_blank" rel="noopener" class="chair-file-view-btn inline-flex items-center gap-1 text-xs font-semibold text-[#621708] hover:underline px-3 py-2">Open PDF</a>` : ''}
        `;

        const pdfSnippet = row.report_pdf_url
            ? `<div class="chair-file-row mt-3">
                <span class="text-sm text-slate-800 truncate"><i class="fa-solid fa-file-lines mr-1.5 text-slate-500"></i>${esc(row.task_title)} (${esc(row.period_text)})</span>
                <div class="flex gap-2 shrink-0">
                    <button type="button" class="file-manage-btn" onclick="CiteFlowChairReview.openArReview('${row.id}')">Preview</button>
                    <a href="${esc(row.report_pdf_url)}" target="_blank" rel="noopener" download class="file-manage-btn">Download</a>
                </div>
            </div>`
            : '<p class="text-xs text-slate-400 mt-2">No PDF attached.</p>';

        return `
            <article class="surface rounded-[16px] p-5 border-l-4 border-l-[#621708]">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#fff0eb] text-[#621708] border border-[#fbdacf]">
                                Accomplishment Report
                            </span>
                            <span class="text-xs text-slate-400 font-medium">#AR-${row.id}</span>
                        </div>
                        <h3 class="font-bold text-slate-900 text-base">${esc(row.task_title)}</h3>
                        <p class="text-sm text-slate-600 mt-0.5">
                            <span class="font-semibold text-slate-800">${esc(row.faculty_name)}</span> &middot; ${esc((row.department || chairDepartment() || '—').toUpperCase())}
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
                    <span><i class="fa-regular fa-calendar mr-1"></i><strong>Period:</strong> ${esc(row.period_text)}</span>
                    <span><i class="fa-regular fa-clock mr-1"></i><strong>Submitted:</strong> ${esc(formatWhen(row.submitted_at))}</span>
                </div>
                ${pdfSnippet}
                <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">${actions}</div>
            </article>`;
    }

    function submissionIsMfo(row) {
        const helper = wf();
        if (helper?.resolveDocumentCategory?.(row?.config) === 'MFO') return true;
        if (helper?.resolveDocumentCategory?.(row?.task) === 'MFO') return true;
        const blob = [row?.config?.report_name, row?.task_title, row?.task?.title]
            .join(' ').toLowerCase();
        return /\bmfo\b|major final output|accomplishment report/.test(blob);
    }

    function mfoReportLink(row) {
        if (!row?.id || !submissionIsMfo(row)) return '';
        return `<a class="chair-btn-secondary inline-flex items-center" `
            + `href="mfo-report.html?view=review&submission=${encodeURIComponent(row.id)}" `
            + `target="_blank" rel="noopener"><i class="fa-solid fa-file-lines mr-1"></i> Open MFO Report</a>`;
    }

    function renderCard(row) {
        if (row.is_ar) {
            return renderArCard(row);
        }
        const helper = wf();
        const actionable = isPending(row);
        const isMfo = submissionIsMfo(row);
        const stage = helper?.formatWorkflowStatus
            ? helper.formatWorkflowStatus(row, row.task, row.config)
            : (helper?.formatApprovalStage
                ? helper.formatApprovalStage(row.approval_stage)
                : (row.approval_stage === 'chairperson' ? 'Pending Chairperson Review' : (row.approval_stage || row.status)));

        const viewBtn = isMfo
            ? `<a class="chair-btn-secondary inline-flex items-center" href="mfo-report.html?view=review&submission=${encodeURIComponent(row.id)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-lines mr-1.5"></i> Review MFO Report</a>`
            : `<button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>`;

        const actions = actionable
            ? `
                ${viewBtn}
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
                <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.openDecline('${row.id}')">Decline</button>
            `
            : `${viewBtn}`;

        const documentBlock = isMfo
            ? `
                <div class="mt-3 p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-lg bg-[#621708] text-white flex items-center justify-center font-bold text-sm">
                            <i class="fa-solid fa-file-invoice"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold uppercase tracking-wide text-[#621708]">Submitted MFO Accomplishment Report</p>
                            <p class="text-sm font-semibold text-slate-800">${esc(row.task_title)}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.openConsolidatedMfo('${row.task_id}')" title="Open Department Consolidated MFO Report">
                            <i class="fa-solid fa-layer-group mr-1.5"></i> Consolidate MFO
                        </button>
                        <a href="mfo-report.html?view=review&submission=${encodeURIComponent(row.id)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs">
                            Review Faculty Report &rarr;
                        </a>
                    </div>
                </div>
              `
            : `<div class="mt-3 space-y-2">${renderFiles(row.files)}</div>`;

        return `
            <article class="surface rounded-[16px] p-5 border-l-4 ${isMfo ? 'border-l-[#621708]' : 'border-l-indigo-500'}">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${isMfo ? 'bg-[#fff0eb] text-[#621708] border border-[#fbdacf]' : 'bg-slate-100 text-slate-700'}">
                                ${isMfo ? 'Major Final Output (MFO)' : 'Task Submission'}
                            </span>
                        </div>
                        <h3 class="font-bold text-slate-900 text-base">${esc(row.task_title)}</h3>
                        <p class="text-sm text-slate-600 mt-0.5">
                            <span class="font-semibold text-slate-800">${esc(row.faculty_name)}</span> &middot; ${esc((row.department || chairDepartment() || '—').toUpperCase())}
                        </p>
                    </div>
                    <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">${esc(stage)}</span>
                </div>
                <p class="text-xs text-slate-500">Submitted ${esc(formatWhen(row.submitted_at))}</p>
                ${documentBlock}
                <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">${actions}</div>
            </article>`;
    }

    function renderNonSubmittedCard(row) {
        const isMfo = submissionIsMfo({ task: row.task });
        const pill = renderStatusPill(row.status_key, row.status_label);

        const draftNotice = row.is_draft_packet
            ? `
                <div class="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs">
                    <i class="fa-solid fa-pen-ruler text-amber-600"></i>
                    <span><strong>Draft MFO Packet in Progress</strong> &mdash; faculty member has drafted but not formally submitted this report.</span>
                </div>
              `
            : '';

        return `
            <article class="surface rounded-[16px] p-5 border-l-4 ${row.is_overdue ? 'border-l-rose-500' : 'border-l-slate-300'}">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${isMfo ? 'bg-[#fff0eb] text-[#621708] border border-[#fbdacf]' : 'bg-slate-100 text-slate-700'}">
                                ${isMfo ? 'Major Final Output (MFO)' : 'Assigned Task'}
                            </span>
                        </div>
                        <h3 class="font-bold text-slate-900 text-base">${esc(row.task_title)}</h3>
                        <p class="text-sm text-slate-600 mt-0.5">
                            <span class="font-semibold text-slate-800">${esc(row.faculty_name)}</span> &middot; ${esc(row.department.toUpperCase())}
                        </p>
                    </div>
                    ${pill}
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mt-2">
                    <span class="${row.is_overdue ? 'text-rose-600 font-semibold' : 'text-slate-500'}">
                        <i class="fa-regular fa-clock mr-1"></i>${esc(row.deadlineInfo.text)}
                    </span>
                    <span class="text-slate-400">
                        <i class="fa-regular fa-calendar mr-1"></i>Deadline: ${esc(row.deadlineInfo.dateText)}
                    </span>
                </div>
                ${draftNotice}
                <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openTaskDetails('${row.task_id}')">
                        <i class="fa-solid fa-circle-info mr-1.5"></i> View Task Details
                    </button>
                    ${isMfo ? `
                        <button type="button" class="chair-btn-primary text-xs inline-flex items-center" onclick="CiteFlowChairReview.openConsolidatedMfo('${row.task_id}')" title="Open Department Consolidated MFO Report">
                            <i class="fa-solid fa-layer-group mr-1.5"></i> Consolidate MFO
                        </button>
                    ` : ''}
                </div>
            </article>`;
    }

    function renderReportsView(recurring) {
        const groups = recurring.groups || [];
        const cycleMap = recurring.cycleAnalyticsMap || new Map();

        const filteredGroups = groups.filter((g) => {
            if (review.reportFilterFreq === 'all') return true;
            return g.frequency === review.reportFilterFreq;
        });

        if (!filteredGroups.length) {
            return emptyState(
                'No Recurring Reports Found',
                'There are no recurring reporting cycles currently configured for your department.'
            );
        }

        const frequencyLabels = {
            monthly: 'Monthly',
            quarterly: 'Quarterly',
            semi_annual: 'Semi-Annual',
            annual: 'Annual'
        };

        return filteredGroups.map((group) => {
            const freqLabel = frequencyLabels[group.frequency] || group.frequency;

            // Calculate series-wide totals
            let groupExpected = 0;
            let groupSubmitted = 0;
            let groupPending = 0;
            let groupApproved = 0;
            let groupNotSubmitted = 0;
            let groupOpen = 0;
            let groupOverdue = 0;

            group.cycles.forEach((task) => {
                const analytics = cycleMap.get(String(task.id));
                if (analytics?.counts) {
                    groupExpected += (analytics.counts.expected || 0);
                    groupSubmitted += (analytics.counts.submitted || 0);
                    groupPending += (analytics.counts.pending_review || 0);
                    groupApproved += (analytics.counts.approved || 0);
                    groupNotSubmitted += (analytics.counts.not_submitted || 0);
                    groupOpen += (analytics.counts.not_submitted_open || 0);
                    groupOverdue += (analytics.counts.not_submitted_overdue || 0);
                }
            });

            const groupProgress = groupExpected > 0 ? Math.round((groupSubmitted / groupExpected) * 100) : 0;

            const cyclesHtml = group.cycles.map((task) => {
                const cycleAnalytics = cycleMap.get(String(task.id));
                const counts = cycleAnalytics?.counts || {
                    expected: 0, submitted: 0, not_submitted: 0,
                    not_submitted_open: 0, not_submitted_overdue: 0,
                    pending_review: 0, needs_revision: 0, approved: 0, rejected: 0
                };
                const deadline = formatDeadlineRelative(task.deadline_at || task.due_at);
                const progress = counts.expected > 0 ? Math.round((counts.submitted / counts.expected) * 100) : 0;
                const cycleKey = `${group.group_key}_${task.id}`;
                const isExpanded = !!review.expandedCycles[cycleKey];
                const isCycleMfo = group.is_mfo || submissionIsMfo({ task });

                const people = facultyMap();
                const facultyBreakdown = (cycleAnalytics?.assignedRecords || []).map((rec) => {
                    const person = people.get(String(rec.faculty_id));
                    const name = esc(person?.full_name || person?.name || 'Faculty Member');
                    const dept = esc((person?.department || person?.department_code || chairDepartment()).toUpperCase());
                    const pill = renderStatusPill(rec.classification?.status_key, rec.classification?.status_label);
                    const sub = rec.submission;

                    return `
                        <div class="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                            <div>
                                <span class="font-semibold text-slate-800">${name}</span>
                                <span class="text-slate-400 ml-1.5">${dept}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                ${pill}
                                ${sub ? `<button type="button" class="file-manage-btn" onclick="CiteFlowChairReview.openView('${sub.id}')">Review</button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('') || '<p class="text-xs text-slate-400 p-2">No departmental faculty assigned to this cycle.</p>';

                return `
                    <div class="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                                <h4 class="font-bold text-slate-900 text-sm">${esc(task.title || 'Reporting Cycle')}</h4>
                                <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-0.5">
                                    <span><i class="fa-regular fa-calendar mr-1"></i>Deadline: <strong>${esc(deadline.dateText)}</strong> (${esc(deadline.text)})</span>
                                    ${task.reporting_period_label ? `<span><i class="fa-solid fa-clock-rotate-left mr-1"></i>Period: ${esc(task.reporting_period_label)}</span>` : ''}
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                ${isCycleMfo ? `
                                    <button type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.openConsolidatedMfo('${task.id}')" title="Open Department Consolidated MFO Report">
                                        <i class="fa-solid fa-layer-group mr-1.5"></i> Consolidate MFO
                                    </button>
                                ` : ''}
                                <button type="button" class="chair-btn-secondary text-xs" onclick="CiteFlowChairReview.openTaskDetails('${task.id}')">
                                    <i class="fa-solid fa-circle-info mr-1"></i> Task Details
                                </button>
                                <button type="button" class="chair-btn-secondary text-xs" onclick="CiteFlowChairReview.toggleCycle('${group.group_key}', '${task.id}')">
                                    <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} mr-1"></i> ${isExpanded ? 'Hide Faculty' : 'Show Faculty (' + counts.expected + ')'}
                                </button>
                            </div>
                        </div>

                        <!-- 9 Metrics Standard Display -->
                        <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5 text-center text-xs">
                            <div class="p-2 rounded-lg bg-white border border-slate-200">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Expected</span>
                                <span class="font-extrabold text-slate-900 text-sm">${counts.expected}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-indigo-50/70 border border-indigo-100">
                                <span class="text-[9px] uppercase font-bold text-indigo-600 block">Submitted</span>
                                <span class="font-extrabold text-indigo-900 text-sm">${counts.submitted}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-amber-50/70 border border-amber-200">
                                <span class="text-[9px] uppercase font-bold text-amber-700 block">Pending</span>
                                <span class="font-extrabold text-amber-900 text-sm">${counts.pending_review}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-purple-50/70 border border-purple-200">
                                <span class="text-[9px] uppercase font-bold text-purple-700 block">Revision</span>
                                <span class="font-extrabold text-purple-900 text-sm">${counts.needs_revision}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-emerald-50/70 border border-emerald-100">
                                <span class="text-[9px] uppercase font-bold text-emerald-700 block">Approved</span>
                                <span class="font-extrabold text-emerald-900 text-sm">${counts.approved}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-rose-50/70 border border-rose-200">
                                <span class="text-[9px] uppercase font-bold text-rose-700 block">Declined</span>
                                <span class="font-extrabold text-rose-900 text-sm">${counts.rejected}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-slate-100 border border-slate-200">
                                <span class="text-[9px] uppercase font-bold text-slate-500 block">Not Sub.</span>
                                <span class="font-extrabold text-slate-800 text-sm">${counts.not_submitted}</span>
                            </div>
                            <div class="p-2 rounded-lg bg-slate-50 border border-slate-200">
                                <span class="text-[9px] uppercase font-bold text-emerald-700 block">Open</span>
                                <span class="font-extrabold text-emerald-900 text-sm">${counts.not_submitted_open}</span>
                            </div>
                            <div class="p-2 rounded-lg ${counts.not_submitted_overdue > 0 ? 'bg-rose-100/70 border border-rose-300' : 'bg-slate-50 border border-slate-200'}">
                                <span class="text-[9px] uppercase font-bold ${counts.not_submitted_overdue > 0 ? 'text-rose-700' : 'text-slate-400'} block">Overdue</span>
                                <span class="font-extrabold ${counts.not_submitted_overdue > 0 ? 'text-rose-900' : 'text-slate-600'} text-sm">${counts.not_submitted_overdue}</span>
                            </div>
                        </div>

                        <!-- Progress -->
                        <div>
                            <div class="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
                                <span>Cycle Completion</span>
                                <span>${progress}% (${counts.submitted} / ${counts.expected})</span>
                            </div>
                            <div class="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                <div class="h-full bg-[#621708] rounded-full" style="width: ${progress}%"></div>
                            </div>
                        </div>

                        ${isExpanded ? `
                            <div class="pt-3 border-t border-slate-200 space-y-1.5">
                                <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Department Faculty Submission Breakdown</p>
                                <div class="space-y-1.5 max-h-56 overflow-y-auto">${facultyBreakdown}</div>
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');

            return `
                <article class="surface rounded-[16px] p-5 mb-5 border border-slate-200">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    ${esc(freqLabel)}
                                </span>
                                ${group.is_mfo ? '<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#fff0eb] text-[#621708] border border-[#fbdacf]">MFO Report</span>' : ''}
                            </div>
                            <h3 class="font-extrabold text-slate-900 text-lg">${esc(group.report_name)}</h3>
                            <p class="text-xs text-slate-500 mt-0.5">${esc(chairDepartmentDisplay())} Department &middot; ${group.cycles.length} reporting cycle${group.cycles.length === 1 ? '' : 's'}</p>
                        </div>
                        <div class="flex items-center gap-4 text-xs font-semibold">
                            <span class="text-slate-600">Expected: <strong>${groupExpected}</strong></span>
                            <span class="text-indigo-600">Submitted: <strong>${groupSubmitted}</strong></span>
                            <span class="${groupOverdue > 0 ? 'text-rose-600' : 'text-slate-500'}">Not Submitted: <strong>${groupNotSubmitted}</strong></span>
                        </div>
                    </div>

                    <!-- Series Progress Bar -->
                    <div class="mb-4">
                        <div class="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                            <span>Series Submission Rate</span>
                            <span>${groupProgress}% (${groupSubmitted} / ${groupExpected})</span>
                        </div>
                        <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div class="h-full bg-[#621708] rounded-full" style="width: ${groupProgress}%"></div>
                        </div>
                    </div>

                    <!-- Cycles List -->
                    <div class="space-y-3">${cyclesHtml}</div>
                </article>
            `;
        }).join('');
    }

    function render() {
        syncTabs();
        const root = document.getElementById('appRoot');
        if (!root || review.mode !== 'chair') return;
        if (!review.access) {
            setMode('mine');
            return;
        }

        const deptDisplay = chairDepartmentDisplay();
        const analytics = getDepartmentAnalytics();
        const counts = analytics.counts;
        const recurring = getRecurringAnalytics();

        const progressPercent = counts.expected > 0 ? Math.round((counts.submitted / counts.expected) * 100) : 0;

        const allSubmissionsRows = buildRows();
        const pendingRows = allSubmissionsRows.filter(isPending);
        const approvedRows = allSubmissionsRows.filter(isApproved);
        const revisionRows = allSubmissionsRows.filter(isRevision);
        const declinedRows = allSubmissionsRows.filter(isDeclined);
        const nonSubmittedRows = buildNonSubmittedRows();

        const mfoRowsCount = allSubmissionsRows.filter((r) => r.is_mfo || submissionIsMfo(r)).length;
        const arRowsCount = allSubmissionsRows.filter((r) => r.is_ar).length;
        const taskRowsCount = allSubmissionsRows.filter((r) => !r.is_ar && !r.is_mfo && !submissionIsMfo(r)).length;

        // Determine content based on active tab
        let contentHtml = '';
        let tabHeading = '';
        let tabSubtitle = '';

        if (review.tab === 'reports') {
            tabHeading = 'Department Reports & Recurring Cycles';
            tabSubtitle = 'Track expected submissions across monthly, quarterly, semi-annual, and annual reporting periods.';
            contentHtml = renderReportsView(recurring);
        } else if (review.tab === 'not_submitted') {
            tabHeading = 'Assigned Faculty Without Submission';
            tabSubtitle = 'Faculty members expected to submit reports who have not yet submitted genuine reports.';

            let filteredNonSubmitted = nonSubmittedRows;
            if (review.notSubmittedFilter === 'open') {
                filteredNonSubmitted = filteredNonSubmitted.filter((r) => !r.is_overdue);
            } else if (review.notSubmittedFilter === 'overdue') {
                filteredNonSubmitted = filteredNonSubmitted.filter((r) => r.is_overdue);
            }

            const q = String(review.search || '').trim().toLowerCase();
            if (q) {
                filteredNonSubmitted = filteredNonSubmitted.filter((r) =>
                    [r.faculty_name, r.task_title, r.department, r.status_label].join(' ').toLowerCase().includes(q)
                );
            }

            contentHtml = filteredNonSubmitted.length
                ? `<div class="space-y-4">${filteredNonSubmitted.map(renderNonSubmittedCard).join('')}</div>`
                : emptyState(
                    review.notSubmittedFilter === 'overdue' ? 'No Overdue Non-Submissions' : 'All Department Submissions Accounted For',
                    'All assigned faculty members in your department have completed their submissions for this category.'
                );
        } else {
            const tabLabels = {
                pending: 'Pending Chairperson Approval',
                approved: 'Approved Submissions',
                revision: 'Revision Requested',
                declined: 'Declined Submissions',
                department: 'All Department Submissions'
            };
            tabHeading = tabLabels[review.tab] || 'Department Submissions';
            tabSubtitle = review.tab === 'pending'
                ? 'Only submissions that currently require your approval decision.'
                : 'Review, preview, and download submitted documents and MFO reports.';

            const visible = filteredRows();
            contentHtml = `
                <div class="space-y-4">
                    ${queueBlockerBanner()}
                    ${visible.length
                        ? visible.map(renderCard).join('')
                        : emptyState(
                            review.tab === 'pending' ? 'No submissions currently require your approval.' : 'No submissions in this view.',
                            'New faculty submissions that need Chairperson review will appear here automatically.'
                        )}
                </div>
            `;
        }

        root.innerHTML = `
            <div class="fade-in">
                <header class="mb-6">
                    <div class="flex items-center flex-wrap gap-2.5 mt-1">
                        <h1 class="cite-title">Chairperson Review</h1>
                        <span class="cite-live"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>Live</span>
                    </div>
                    <p class="cite-subtitle">${esc(deptDisplay)} Department. Submission analytics and departmental workflow management.</p>
                </header>

                <!-- Overview Stat Cards (Standardized Metrics) -->
                <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mb-6">
                    <!-- Expected -->
                    <div class="cite-stat rounded-[16px] p-4 bg-white border border-slate-200 cursor-pointer hover:border-slate-400 transition-colors" onclick="CiteFlowChairReview.setTab('department')">
                        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                            <span>Expected</span>
                            <i class="fa-solid fa-list-check text-slate-300"></i>
                        </div>
                        <div class="text-2xl font-black mt-2 tracking-tight text-slate-900">${counts.expected}</div>
                        <div class="mt-2">
                            <div class="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                                <span>Progress</span>
                                <span>${progressPercent}%</span>
                            </div>
                            <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div class="h-full bg-[#621708] rounded-full" style="width: ${progressPercent}%"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Submitted -->
                    <div class="cite-stat cite-stat-pending rounded-[16px] p-4 cursor-pointer hover:opacity-90 transition-opacity" onclick="CiteFlowChairReview.setTab('department')">
                        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                            <span>Submitted</span>
                            <i class="fa-solid fa-cloud-arrow-up text-indigo-300"></i>
                        </div>
                        <div class="text-2xl font-black mt-2 tracking-tight text-indigo-900">${counts.submitted}</div>
                        <p class="text-xs text-slate-500 mt-2">${counts.approved} approved &middot; ${counts.pending_review} pending</p>
                    </div>

                    <!-- Not Submitted -->
                    <div class="cite-stat rounded-[16px] p-4 ${counts.not_submitted_overdue > 0 ? 'border border-rose-200 bg-rose-50/40' : 'bg-white border border-slate-200'} cursor-pointer hover:border-rose-400 transition-colors" onclick="CiteFlowChairReview.setTab('not_submitted')">
                        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wide ${counts.not_submitted_overdue > 0 ? 'text-rose-600' : 'text-slate-400'}">
                            <span>Not Submitted</span>
                            <i class="fa-solid fa-user-xmark ${counts.not_submitted_overdue > 0 ? 'text-rose-400' : 'text-slate-300'}"></i>
                        </div>
                        <div class="text-2xl font-black mt-2 tracking-tight ${counts.not_submitted_overdue > 0 ? 'text-rose-950' : 'text-slate-900'}">${counts.not_submitted}</div>
                        <p class="text-xs mt-2">
                            <span class="text-emerald-700 font-semibold">${counts.not_submitted_open} open</span> &middot;
                            <span class="${counts.not_submitted_overdue > 0 ? 'text-rose-700 font-bold' : 'text-slate-500'}">${counts.not_submitted_overdue} overdue</span>
                        </p>
                    </div>

                    <!-- Pending Review -->
                    <div class="cite-stat cite-stat-pending rounded-[16px] p-4 cursor-pointer hover:opacity-90 transition-opacity" onclick="CiteFlowChairReview.setTab('pending')">
                        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                            <span>Pending Review</span>
                            <i class="fa-solid fa-hourglass-half text-amber-300"></i>
                        </div>
                        <div class="text-2xl font-black mt-2 tracking-tight text-amber-950">${pendingRows.length}</div>
                        <p class="text-xs text-slate-500 mt-2">${pendingRows.length} awaiting chair decision${counts.pending_review > pendingRows.length ? ` &middot; ${counts.pending_review - pendingRows.length} at admin` : ''}</p>
                    </div>

                    <!-- Revision & Declined -->
                    <div class="cite-stat rounded-[16px] p-4 bg-white border border-slate-200 cursor-pointer hover:border-slate-400 transition-colors" onclick="CiteFlowChairReview.setTab('revision')">
                        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                            <span>Revision &amp; Declined</span>
                            <i class="fa-solid fa-rotate-left text-purple-300"></i>
                        </div>
                        <div class="text-2xl font-black mt-2 tracking-tight text-purple-950">${counts.needs_revision + counts.rejected}</div>
                        <p class="text-xs text-slate-500 mt-2">${counts.needs_revision} revision &middot; ${counts.rejected} declined</p>
                    </div>
                </section>

                <!-- Tabs Navigation -->
                <div class="flex flex-wrap items-center gap-2 mb-3">
                    <button type="button" class="chair-subtab ${review.tab === 'pending' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('pending')">
                        Pending Approval <span class="ml-1 text-[11px] px-1.5 py-0.2 rounded-full ${review.tab === 'pending' ? 'bg-[#621708] text-white' : 'bg-slate-200 text-slate-700'}">${pendingRows.length}</span>
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'not_submitted' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('not_submitted')">
                        Not Submitted <span class="ml-1 text-[11px] px-1.5 py-0.2 rounded-full ${counts.not_submitted_overdue > 0 ? 'bg-rose-600 text-white' : (review.tab === 'not_submitted' ? 'bg-[#621708] text-white' : 'bg-slate-200 text-slate-700')}">${counts.not_submitted}</span>
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'approved' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('approved')">
                        Approved <span class="ml-1 text-[11px] px-1.5 py-0.2 rounded-full ${review.tab === 'approved' ? 'bg-[#621708] text-white' : 'bg-slate-200 text-slate-700'}">${approvedRows.length}</span>
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'revision' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('revision')">
                        Revision <span class="ml-1 text-[11px] px-1.5 py-0.2 rounded-full ${review.tab === 'revision' ? 'bg-[#621708] text-white' : 'bg-slate-200 text-slate-700'}">${revisionRows.length}</span>
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'declined' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('declined')">
                        Declined <span class="ml-1 text-[11px] px-1.5 py-0.2 rounded-full ${review.tab === 'declined' ? 'bg-[#621708] text-white' : 'bg-slate-200 text-slate-700'}">${declinedRows.length}</span>
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'reports' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('reports')">
                        Reports &amp; Cycles
                    </button>
                    <button type="button" class="chair-subtab ${review.tab === 'department' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('department')">
                        All Submissions (${allSubmissionsRows.length})
                    </button>
                </div>

                <!-- Sub-filters Bar -->
                ${review.tab === 'not_submitted' ? `
                    <div class="flex flex-wrap items-center gap-2 mb-4">
                        <span class="text-xs font-semibold text-slate-500 mr-1">Status:</span>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.notSubmittedFilter === 'all' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setNotSubmittedFilter('all')">All Not Submitted (${counts.not_submitted})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.notSubmittedFilter === 'open' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setNotSubmittedFilter('open')">Open Deadlines (${counts.not_submitted_open})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.notSubmittedFilter === 'overdue' ? 'bg-rose-700 text-white shadow-sm' : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'}" onclick="CiteFlowChairReview.setNotSubmittedFilter('overdue')">Overdue (${counts.not_submitted_overdue})</button>
                    </div>
                ` : (review.tab === 'reports' ? `
                    <div class="flex flex-wrap items-center gap-2 mb-4">
                        <span class="text-xs font-semibold text-slate-500 mr-1">Frequency:</span>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.reportFilterFreq === 'all' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setReportFilterFreq('all')">All Frequencies (${recurring.groups.length})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.reportFilterFreq === 'monthly' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setReportFilterFreq('monthly')">Monthly</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.reportFilterFreq === 'quarterly' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setReportFilterFreq('quarterly')">Quarterly</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.reportFilterFreq === 'semi_annual' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setReportFilterFreq('semi_annual')">Semi-Annual</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.reportFilterFreq === 'annual' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setReportFilterFreq('annual')">Annual</button>
                    </div>
                ` : `
                    <div class="flex flex-wrap items-center gap-2 mb-4">
                        <span class="text-xs font-semibold text-slate-500 mr-1">Filter:</span>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'all' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('all')">All Submissions (${allSubmissionsRows.length})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'mfo' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('mfo')">MFO Reports (${mfoRowsCount})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'ar' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('ar')">Accomplishment Reports (${arRowsCount})</button>
                        <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'tasks' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('tasks')">Task Submissions (${taskRowsCount})</button>
                    </div>
                `)}

                <!-- Main Content Surface -->
                <section class="surface rounded-[16px] p-5 lg:p-6">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
                        <div>
                            <h2 class="text-base font-bold text-gray-950">${esc(tabHeading)}</h2>
                            <p class="text-sm text-gray-500 mt-1">${esc(tabSubtitle)}</p>
                        </div>
                        ${review.tab !== 'reports' ? `
                            <input type="search" value="${esc(review.search)}" oninput="CiteFlowChairReview.setSearch(this.value)" placeholder="Search faculty or report..." class="w-full lg:w-80 px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-4 focus:ring-[#8c2a10]/10 focus:border-[#8c2a10]">
                        ` : ''}
                    </div>

                    ${contentHtml}
                </section>
            </div>`;
    }

    function looksChair(faculty) {
        const helper = wf();
        if (helper?.isChairperson?.(faculty)) return true;
        return /chair/i.test(String(faculty?.role || faculty?.position || faculty?.raw_role || ''));
    }

    function syncTabs() {
        if (typeof document === 'undefined') return;
        const wrap = document.getElementById('submissionsModeTabs');
        if (!wrap) {
            console.info('[Chairperson Access Debug] submissionsModeTabs not in the DOM yet');
            return;
        }
        wrap.classList?.toggle?.('hidden', !review.access);
        wrap.classList?.toggle?.('is-visible', review.access);
        wrap.style?.setProperty?.('display', review.access ? 'flex' : 'none', 'important');
        const mine = document.getElementById('submissionsModeMine');
        const chair = document.getElementById('submissionsModeChair');
        mine?.classList?.toggle?.('active', review.mode === 'mine');
        chair?.classList?.toggle?.('active', review.mode === 'chair');
    }

    async function refreshAccess(facultyOverride, userOverride) {
        const helper = wf();
        const faculty = facultyOverride || global.currentFaculty;
        const user = userOverride || global.currentUser;
        if (!helper) {
            console.info('[Chairperson Access Debug] CiteFlowWorkflow is not loaded');
            review.access = false;
            syncTabs();
            return false;
        }
        if (!faculty) {
            console.info('[Chairperson Access Debug] currentFaculty is not loaded yet');
            if (typeof global.refreshFacultyChairReviewNav === 'function') {
                setTimeout(() => global.refreshFacultyChairReviewNav(), 400);
            }
            return false;
        }

        review.access = await helper.currentUserHasChairpersonGrant(db(), faculty, user);
        if (!review.access && review.mode === 'chair') {
            review.mode = 'mine';
        }
        if (review.access && (location.hash === '#chair-review' || location.hash === '#chairperson-review')) {
            review.mode = 'chair';
        }
        syncTabs();
        return review.access;
    }

    async function loadData() {
        if (!review.access) {
            review.submissions = [];
            review.arSubmissions = [];
            review.files = [];
            review.filesError = null;
            review.fileActions = {};
            review.tasks = [];
            review.assignments = [];
            review.faculty = [];
            review.grants = [];
            review.configs = [];
            review.visibility = null;
            review.sqlVersion = null;
            syncTabs();
            return;
        }

        const client = db();
        const [
            facultyRes, tasksRes, assignmentsRes, grantsRes, configsRes, arRes, mfoPacketsRes
        ] = await Promise.all([
            client.from('faculty').select('id, full_name, name, department, role, position, auth_user_id, email, status'),
            client.from('wf_tasks').select('*'),
            client.from('wf_task_assignments').select('*'),
            client.from('wf_delegated_access').select('*'),
            client.from('wf_report_configs').select('*'),
            client.from('accomplishment_report_submissions').select('*').order('submitted_at', { ascending: false }),
            client.from('mfo_packets').select('*').order('created_at', { ascending: false })
        ]);

        if (Array.isArray(mfoPacketsRes?.data)) review.mfoPackets = mfoPacketsRes.data;

        let submissionsRes = await client.rpc('wf_list_chairperson_submissions');
        console.info('[Chairperson Queue] wf_list_chairperson_submissions response:', {
            count: Array.isArray(submissionsRes.data) ? submissionsRes.data.length : 0,
            error: submissionsRes.error || null
        });
        if (submissionsRes.error) {
            console.error('[Chairperson Queue] authoritative queue RPC failed:', {
                message: submissionsRes.error.message || null,
                code: submissionsRes.error.code || null,
                details: submissionsRes.error.details || null,
                hint: submissionsRes.error.hint || null
            });
            submissionsRes = await client.from('wf_submissions').select('*');
            console.warn('[Chairperson Queue] direct submissions query used only after RPC failure:', submissionsRes.error || null);
        }

        const mfoSubIds = (review.mfoPackets || []).map((p) => p.submission_id).filter(Boolean);
        const loadedSubIds = new Set((submissionsRes.data || []).map((s) => String(s.id)));
        const missingMfoSubIds = mfoSubIds.filter((id) => !loadedSubIds.has(String(id)));
        if (missingMfoSubIds.length) {
            try {
                const extraSub = await client.from('wf_submissions').select('*').in('id', missingMfoSubIds);
                if (Array.isArray(extraSub.data) && extraSub.data.length) {
                    submissionsRes.data = [...(submissionsRes.data || []), ...extraSub.data];
                }
            } catch (_) {}
        }

        const failed = [facultyRes, tasksRes, assignmentsRes, submissionsRes, grantsRes, configsRes].find((result) => result?.error);
        if (failed?.error) {
            console.warn('Chairperson Review could not load department data:', failed.error);
        }

        if (Array.isArray(facultyRes?.data)) review.faculty = facultyRes.data.map((row) => wf()?.normalizeFaculty?.(row) || row);
        if (Array.isArray(tasksRes?.data)) review.tasks = tasksRes.data;
        if (Array.isArray(assignmentsRes?.data)) review.assignments = assignmentsRes.data;
        if (Array.isArray(configsRes?.data)) review.configs = configsRes.data;
        if (Array.isArray(grantsRes?.data)) review.grants = grantsRes.data.filter((grant) => grant && grant.is_active !== false);
        if (Array.isArray(arRes?.data)) review.arSubmissions = arRes.data;
        if (Array.isArray(submissionsRes?.data)) review.submissions = submissionsRes.data;

        review.fileActions = {};
        review.filesError = null;

        const versionRes = await client.rpc('wf_chairperson_sql_version');
        review.sqlVersion = typeof versionRes.data === 'string'
            ? versionRes.data
            : (Array.isArray(versionRes.data) ? versionRes.data[0] : null);

        const visibility = await client.rpc('wf_debug_chairperson_queue');
        const visibilityFallback = visibility.error
            ? await client.rpc('wf_debug_chairperson_visibility')
            : visibility;
        const visData = parseRpcJson(visibilityFallback.data);
        review.visibility = visData || parseRpcJson(visibilityFallback.data) || (typeof visibilityFallback.data === 'object' ? visibilityFallback.data : null);
        if (review.visibility && review.sqlVersion && !review.visibility.sql_patch_version) {
            review.visibility.sql_patch_version = review.sqlVersion;
        }

        const submissionIds = (review.submissions || []).map((row) => row.id).filter(Boolean);

        let filesRes = { data: [], error: null };
        if (submissionIds.length) {
            filesRes = await client
                .from('wf_submission_files')
                .select('*')
                .in('submission_id', submissionIds);
        }

        review.filesError = filesRes.error || null;
        const rawFiles = filesRes.data || [];
        review.files = [];
        for (const file of rawFiles) {
            const resolved = await resolveFileUrl(file);
            review.files.push({ ...file, _resolvedUrl: resolved });
        }

        if (wf() && global.currentFaculty && !wf().hasChairpersonWorkflowAccess(global.currentFaculty, review.grants)) {
            const rpcOk = await wf().currentUserHasChairpersonGrant(client, global.currentFaculty);
            review.access = rpcOk;
            if (!rpcOk) {
                review.mode = 'mine';
                review.submissions = [];
            }
        }
        syncTabs();
    }

    async function approve(submissionId) {
        const row = review.submissions.find((item) => String(item.id) === String(submissionId));
        if (!row || !wf()) return;
        const result = await wf().applySubmissionReview(db(), {
            submissionId: row.id,
            submission: row,
            action: 'approved',
            comment: '',
            actorFaculty: global.currentFaculty,
            actorUser: global.currentUser,
            targetFaculty: targetFaculty(row),
            task: taskMap().get(String(row.task_id)),
            config: reviewContext(taskMap().get(String(row.task_id))).config,
            delegatedAccess: effectiveGrants()
        });
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        if (submissionIsMfo(row) || row.is_mfo) {
            try {
                let { error } = await db().from('mfo_packets')
                    .update({
                        packet_state: 'chairperson_approved',
                        reviewed_by: global.currentFaculty?.full_name || 'Chairperson',
                        reviewed_at: new Date().toISOString()
                    })
                    .eq('submission_id', row.id);
                if (error && /column|schema|cache/i.test(error.message || '')) {
                    await db().from('mfo_packets')
                        .update({ packet_state: 'chairperson_approved' })
                        .eq('submission_id', row.id);
                }
            } catch (_) {}
        }
        toast('Chairperson approval recorded. Admin will handle final approval.', 'success');
        if (typeof global.fetchAllData === 'function') await global.fetchAllData();
    }

    function openRevision(submissionId) {
        review.revisionId = submissionId;
        review.actionMode = 'revision';
        const modal = document.getElementById('chairRevisionModal');
        const title = document.getElementById('chairRevisionTitle');
        const hint = document.getElementById('chairRevisionHint');
        const field = document.getElementById('chairRevisionRemarks');
        const submit = document.getElementById('chairRevisionSubmit');
        if (title) title.textContent = 'Request Revision';
        if (hint) hint.textContent = 'Remarks are required so the faculty member knows what to change.';
        if (submit) submit.textContent = 'Send Revision Request';
        if (field) field.value = '';
        modal?.classList.add('open');
    }

    function openDecline(submissionId) {
        review.revisionId = submissionId;
        review.actionMode = 'decline';
        const modal = document.getElementById('chairRevisionModal');
        const title = document.getElementById('chairRevisionTitle');
        const hint = document.getElementById('chairRevisionHint');
        const field = document.getElementById('chairRevisionRemarks');
        const submit = document.getElementById('chairRevisionSubmit');
        if (title) title.textContent = 'Decline Submission';
        if (hint) hint.textContent = 'Please provide a reason. The submission stays visible to Faculty and Admin with this decision.';
        if (submit) submit.textContent = 'Decline Submission';
        if (field) field.value = '';
        modal?.classList.add('open');
    }

    function closeRevision() {
        review.revisionId = null;
        document.getElementById('chairRevisionModal')?.classList.remove('open');
    }

    async function submitRevision() {
        const row = review.submissions.find((item) => String(item.id) === String(review.revisionId));
        const comment = String(document.getElementById('chairRevisionRemarks')?.value || '').trim();
        if (!row) return;
        let action;
        if (review.actionMode === 'revision') {
            action = 'revision';
        } else if (review.actionMode === 'decline') {
            action = 'rejected';
        } else {
            toast('Unable to submit review: choose Request Revision or Decline and try again.', 'error');
            return;
        }
        if (!comment) {
            toast(action === 'rejected'
                ? 'Please provide a reason before declining this submission.'
                : 'Please provide remarks before requesting a revision.', 'warn');
            return;
        }
        const result = await wf().applySubmissionReview(db(), {
            submissionId: row.id,
            submission: row,
            action,
            comment,
            actorFaculty: global.currentFaculty,
            actorUser: global.currentUser,
            targetFaculty: targetFaculty(row),
            task: taskMap().get(String(row.task_id)),
            config: reviewContext(taskMap().get(String(row.task_id))).config,
            delegatedAccess: effectiveGrants()
        });
        if (!result.ok) {
            toast(result.error, 'error');
            return;
        }
        if (submissionIsMfo(row) || row.is_mfo) {
            try {
                const nextPacketState = action === 'revision' ? 'revision' : 'declined';
                let { error } = await db().from('mfo_packets')
                    .update({
                        packet_state: nextPacketState,
                        reviewed_by: global.currentFaculty?.full_name || 'Chairperson',
                        reviewed_at: new Date().toISOString()
                    })
                    .eq('submission_id', row.id);
                if (error && /column|schema|cache/i.test(error.message || '')) {
                    await db().from('mfo_packets')
                        .update({ packet_state: nextPacketState })
                        .eq('submission_id', row.id);
                }
            } catch (_) {}
        }
        closeRevision();
        toast(action === 'rejected'
            ? 'Submission declined. Faculty and Admin can still see this decision.'
            : 'Revision requested. Faculty must revise and resubmit.', action === 'rejected' ? 'error' : 'warn');
        if (typeof global.fetchAllData === 'function') await global.fetchAllData();
    }

    function openView(submissionId) {
        const row = buildRows().find((item) => String(item.id) === String(submissionId));
        const modal = document.getElementById('chairViewModal');
        const body = document.getElementById('chairViewBody');
        if (!row || !modal || !body) return;

        const stage = wf()?.formatApprovalStage?.(row.approval_stage) || row.approval_stage || row.status;
        body.innerHTML = `
            <h3 class="text-lg font-bold text-slate-900">${esc(row.task_title)}</h3>
            <p class="text-sm text-slate-600 mt-1">${esc(row.faculty_name)} · ${esc((row.department || '—').toUpperCase())}</p>
            <p class="text-sm text-slate-500 mt-2">Submitted ${esc(formatWhen(row.submitted_at))}</p>
            <p class="text-sm text-slate-700 mt-2"><span class="font-semibold">Status:</span> ${esc(stage)}</p>
            <div class="mt-4">${renderFiles(row.files)}</div>
            ${mfoReportLink(row) ? `<div class="flex flex-wrap gap-2 mt-4">${mfoReportLink(row)}</div>` : ''}
            ${isPending(row) ? `<div class="flex flex-wrap gap-2 mt-5">
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.closeView(); CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.closeView(); CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
                <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.closeView(); CiteFlowChairReview.openDecline('${row.id}')">Decline</button>
            </div>` : '<p class="text-xs text-slate-500 mt-4">View only. Approval is available only while this submission is waiting for Chairperson review.</p>'}`;
        modal.classList.add('open');
    }

    function closeView() {
        document.getElementById('chairViewModal')?.classList.remove('open');
    }

    /* ------------------------------------------------------------------ */
    /* MFO Consolidated Draft Staleness & Decision Actions (Phase 5.2)    */
    /* ------------------------------------------------------------------ */

    async function checkAndRenderMfoDraftBanner(task) {
        const bannerEl = document.getElementById('chairMfoDraftBanner');
        if (!bannerEl || !task) return;

        const config = task.report_config_id ? configMap().get(String(task.report_config_id)) : null;
        if (!submissionIsMfo({ task, config })) {
            bannerEl.innerHTML = '';
            return;
        }

        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const client = db();

        // Query existing department program packet
        let programPacket = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (_) {}
        }

        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));

        const staleness = engine.detectConsolidatedDraftStaleness({
            taskId: task.id,
            department: dept,
            draft: programPacket,
            submissions: taskSubmissions,
            packets: taskPackets,
            facultyList: review.faculty || [],
            actorFaculty: global.currentFaculty,
            delegatedAccess: effectiveGrants()
        });

        if (staleness.status === 'unauthorized') {
            bannerEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                    <i class="fa-solid fa-shield-halved text-rose-600"></i>
                    <span>Access restricted: You are not authorized to view or modify consolidated drafts for department "${esc(dept)}".</span>
                </div>
            `;
            return;
        }

        if (staleness.status === 'stale') {
            bannerEl.innerHTML = `
                <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs">
                    <div class="flex items-center gap-2 font-bold mb-1 text-amber-900">
                        <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
                        <span>Consolidated Department Draft Is Stale</span>
                    </div>
                    <p class="text-slate-700 mb-2">Newer faculty submissions or revisions have arrived since this departmental draft was generated (${esc(staleness.reasons.join('; '))}).</p>
                    <div class="flex flex-wrap gap-2">
                        <button id="chairRegenerateDraftBtn" type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.regenerateMfoDraft('${task.id}')">
                            <i class="fa-solid fa-arrows-rotate mr-1"></i> Regenerate Draft
                        </button>
                        <button id="chairAcknowledgeDraftBtn" type="button" class="chair-btn-secondary text-xs" onclick="CiteFlowChairReview.acknowledgeMfoDraft('${task.id}')">
                            <i class="fa-solid fa-check mr-1"></i> Keep Current Draft
                        </button>
                    </div>
                </div>
            `;
        } else if (staleness.status === 'fresh') {
            if (staleness.acknowledged) {
                bannerEl.innerHTML = `
                    <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-circle-check text-emerald-600"></i>
                            <span>Departmental draft retained without changes (Chairperson acknowledged).</span>
                        </div>
                        <button id="chairRegenerateDraftBtn" type="button" class="text-xs font-semibold text-[#621708] underline" onclick="CiteFlowChairReview.regenerateMfoDraft('${task.id}')">Regenerate</button>
                    </div>
                `;
            } else {
                bannerEl.innerHTML = `
                    <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-emerald-600"></i>
                        <span>Consolidated departmental draft is current and up to date with all eligible submissions.</span>
                    </div>
                `;
            }
        } else if (staleness.status === 'unknown') {
            bannerEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                    <i class="fa-solid fa-circle-question text-slate-400"></i>
                    <span>Draft freshness unavailable: source timestamps or draft records cannot be verified reliably.</span>
                </div>
            `;
        } else if (staleness.status === 'no_draft') {
            bannerEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-circle-info text-blue-600"></i>
                        <span>No consolidated draft has been generated yet for this period.</span>
                    </div>
                    <button id="chairRegenerateDraftBtn" type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.regenerateMfoDraft('${task.id}')">
                        <i class="fa-solid fa-file-export mr-1"></i> Generate Draft
                    </button>
                </div>
            `;
        }
    }

    async function regenerateMfoDraft(taskId) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Unauthorized to regenerate draft for this department.', 'error');
            return;
        }

        const task = taskMap().get(String(taskId));
        if (!task) return;

        const bannerEl = document.getElementById('chairMfoDraftBanner');
        const buttons = bannerEl ? Array.from(bannerEl.querySelectorAll('button')) : [];
        const regenBtn = document.getElementById('chairRegenerateDraftBtn');
        const origRegenHtml = regenBtn ? regenBtn.innerHTML : '';

        // UI Loading state
        buttons.forEach((btn) => {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });
        if (regenBtn) {
            regenBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Regenerating Draft...';
        }

        const client = db();
        let previousDraft = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) previousDraft = res.data;
            } catch (_) {}
        }

        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));
        const packetIds = taskPackets.map((p) => p.id).filter(Boolean);

        // Fetch child rows for all contributing packets across sections
        const childRows = {};
        if (client && packetIds.length > 0) {
            await Promise.all(engine.MFO_SECTIONS.map(async (sec) => {
                try {
                    const res = await client.from(sec.table).select('*').in('packet_id', packetIds);
                    if (res?.data) childRows[sec.table] = res.data;
                } catch (e) {
                    console.warn(`[MFO Regeneration] Could not load ${sec.table}:`, e);
                }
            }));
        }

        // Fetch program-level portion (PI1 licensure, PI2 employment)
        const programRows = { pi1: [], pi2: [] };
        if (client && previousDraft?.id) {
            try {
                const [pi1Res, pi2Res] = await Promise.all([
                    client.from('mfo_pi1_licensure').select('*').eq('program_packet_id', previousDraft.id).order('sort_order'),
                    client.from('mfo_pi2_employment').select('*').eq('program_packet_id', previousDraft.id).order('sort_order')
                ]);
                if (pi1Res?.data) programRows.pi1 = pi1Res.data;
                if (pi2Res?.data) programRows.pi2 = pi2Res.data;
            } catch (e) {
                console.warn('[MFO Regeneration] Could not load program PI1/PI2:', e);
            }
        }

        try {
            const regenerated = engine.regenerateDepartmentDraft({
                taskId: task.id,
                department: dept,
                previousDraft,
                submissions: taskSubmissions,
                packets: taskPackets,
                childRows,
                programRows,
                facultyList: review.faculty || [],
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants()
            });

            // Update/save in database if client is available
            if (client && previousDraft?.id) {
                const mergedNotes = engine.mergeNotesMetadata(previousDraft.notes, {
                    excluded_accomplishments: Array.from(regenerated.excludedAccomplishmentIds),
                    count: regenerated.excludedAccomplishmentIds.size,
                    consolidated_at: regenerated.frozenPayload.metadata.consolidated_at
                });
                const { error: updateErr } = await client.from('mfo_program_packets').update({
                    updated_at: new Date().toISOString(),
                    notes: JSON.stringify(mergedNotes)
                }).eq('id', previousDraft.id);
                if (updateErr) throw updateErr;

                // Insert snapshot to record this regenerated version in snapshot history
                try {
                    const nextVer = (previousDraft.current_version || 0) + 1;
                    await client.from('mfo_snapshots').insert({
                        program_packet_id: previousDraft.id,
                        version_no: nextVer,
                        lifecycle_state: 'draft',
                        snapshot_reason: 'Draft regenerated with latest faculty submissions',
                        payload: regenerated.frozenPayload,
                        created_by_faculty_id: global.currentFaculty?.id || null
                    });
                } catch (snapErr) {
                    console.warn('[MFO Snapshot] Non-fatal snapshot log:', snapErr);
                }
            } else if (client && !previousDraft?.id) {
                const mergedNotes = engine.mergeNotesMetadata(null, {
                    excluded_accomplishments: Array.from(regenerated.excludedAccomplishmentIds),
                    count: regenerated.excludedAccomplishmentIds.size,
                    consolidated_at: regenerated.frozenPayload.metadata.consolidated_at
                });
                const { data: insertedDraft, error: insertErr } = await client.from('mfo_program_packets').insert({
                    task_id: task.id,
                    department: dept,
                    packet_state: 'draft',
                    chairperson_faculty_id: global.currentFaculty?.id || null,
                    notes: JSON.stringify(mergedNotes)
                }).select('id, current_version').single();
                if (insertErr) throw insertErr;

                if (insertedDraft?.id) {
                    try {
                        await client.from('mfo_snapshots').insert({
                            program_packet_id: insertedDraft.id,
                            version_no: 1,
                            lifecycle_state: 'draft',
                            snapshot_reason: 'Initial consolidated draft created',
                            payload: regenerated.frozenPayload,
                            created_by_faculty_id: global.currentFaculty?.id || null
                        });
                    } catch (snapErr) {
                        console.warn('[MFO Snapshot] Non-fatal snapshot log:', snapErr);
                    }
                }
            }

            toast('Departmental draft regenerated with latest eligible submissions. Rejection exclusions preserved.', 'info');
            await checkAndRenderMfoDraftBanner(task);
            if (review.activeConsolidatedMfoTaskId === task.id && typeof loadAndRenderConsolidatedMfo === 'function') {
                await loadAndRenderConsolidatedMfo(task.id);
            }
        } catch (err) {
            console.error('[MFO Staleness]', err);
            toast('Failed to regenerate draft: ' + (err?.message || err), 'error');
        } finally {
            buttons.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            });
            if (regenBtn && origRegenHtml) {
                regenBtn.innerHTML = origRegenHtml;
            }
        }
    }

    async function acknowledgeMfoDraft(taskId) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Unauthorized to modify draft for this department.', 'error');
            return;
        }

        const task = taskMap().get(String(taskId));
        if (!task) return;

        const bannerEl = document.getElementById('chairMfoDraftBanner');
        const buttons = bannerEl ? Array.from(bannerEl.querySelectorAll('button')) : [];
        const ackBtn = document.getElementById('chairAcknowledgeDraftBtn');
        const origAckHtml = ackBtn ? ackBtn.innerHTML : '';

        // UI Loading state
        buttons.forEach((btn) => {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });
        if (ackBtn) {
            ackBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Retaining Draft...';
        }

        const client = db();
        let programPacket = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (_) {}
        }

        if (!programPacket) {
            toast('No draft found to acknowledge.', 'warn');
            buttons.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            });
            if (ackBtn && origAckHtml) ackBtn.innerHTML = origAckHtml;
            return;
        }

        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));

        try {
            const { acknowledgedDraft, acknowledgment } = engine.acknowledgeStaleDraft({
                draft: programPacket,
                department: dept,
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants(),
                submissions: taskSubmissions,
                packets: taskPackets,
                facultyList: review.faculty || []
            });

            // Save acknowledgment into notes metadata (preserving existing notes and history)
            if (client && programPacket.id) {
                const metaString = JSON.stringify(acknowledgedDraft.metadataObj || {
                    citeflow_mfo_consolidation: {
                        version: 1,
                        acknowledgment,
                        updated_at: new Date().toISOString()
                    }
                });
                const { error: updateErr } = await client.from('mfo_program_packets').update({
                    notes: metaString
                }).eq('id', programPacket.id);
                if (updateErr) throw updateErr;
            }

            toast('Current draft retained. Decision recorded.', 'info');
            await checkAndRenderMfoDraftBanner(task);
            if (review.activeConsolidatedMfoTaskId === task.id && typeof loadAndRenderConsolidatedMfo === 'function') {
                await loadAndRenderConsolidatedMfo(task.id);
            }
        } catch (err) {
            console.error('[MFO Acknowledge]', err);
            toast('Failed to record acknowledgment: ' + (err?.message || err), 'error');
        } finally {
            buttons.forEach((btn) => {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            });
            if (ackBtn && origAckHtml) {
                ackBtn.innerHTML = origAckHtml;
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* MFO Consolidated Report Modal & Workflows                           */
    /* ------------------------------------------------------------------ */

    function openConsolidatedMfo(taskId) {
        if (typeof document === 'undefined') return;
        const task = taskMap().get(String(taskId));
        const modal = document.getElementById('chairConsolidatedMfoModal');
        if (!modal) return;
        if (!task) {
            toast('Task not found.', 'error');
            return;
        }

        const dept = chairDepartment();
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) {
            toast('Consolidation engine is not loaded.', 'error');
            return;
        }

        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Access denied: You are not authorized for this department.', 'error');
            return;
        }

        review.activeConsolidatedMfoTaskId = task.id;
        review.consolidatedMfoActiveTab = 'summary';
        review.activeConsolidatedCustomizations = null;
        review.activeConsolidatedHasUnsavedChanges = false;
        review.activeConsolidatedFilter = 'all';
        review.activeConsolidatedSearch = '';

        const titleEl = document.getElementById('chairMfoModalTitle');
        const subEl = document.getElementById('chairMfoModalSubtitle');
        const deptPill = document.getElementById('chairMfoModalDeptPill');
        const verPill = document.getElementById('chairMfoModalVersionPill');
        const bodyEl = document.getElementById('chairMfoModalBody');
        const footerStatus = document.getElementById('chairMfoModalFooterStatus');

        if (titleEl) titleEl.textContent = `${task.title || 'MFO Accomplishment Report'} — Consolidated Report`;
        if (subEl) subEl.textContent = `${chairDepartmentDisplay()} Department · ${task.reporting_period_label || task.academic_year || 'Current Period'}`;
        if (deptPill) deptPill.textContent = `${dept.toUpperCase()} DEPARTMENT`;
        if (verPill) {
            verPill.className = 'text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200';
            verPill.textContent = 'Loading...';
        }
        if (footerStatus) footerStatus.textContent = 'Fetching consolidated draft records...';

        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="py-12 text-center text-slate-500">
                    <i class="fa-solid fa-spinner fa-spin text-3xl text-[#621708] mb-3"></i>
                    <p class="text-sm font-semibold text-slate-700">Loading consolidated MFO report...</p>
                    <p class="text-xs text-slate-400 mt-1">Retrieving faculty submissions and department records...</p>
                </div>
            `;
        }

        modal.classList.add('open');
        try { populateOfficialSectionDropdowns(); } catch (_) {}
        loadAndRenderConsolidatedMfo(task.id);
    }

    function closeConsolidatedMfo(force) {
        if (typeof document === 'undefined') return;
        if (!force && review.activeConsolidatedHasUnsavedChanges) {
            if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                const leave = window.confirm('You have unsaved edits in this consolidated report draft. Close without saving?');
                if (!leave) return;
            }
        }
        review.activeConsolidatedMfoTaskId = null;
        review.activeConsolidatedHasUnsavedChanges = false;
        review.activeConsolidatedCustomizations = null;
        review.pendingRemoveTarget = null;
        document.getElementById('chairConsolidatedMfoModal')?.classList.remove('open');
    }

    function setConsolidatedMfoTab(tab) {
        review.consolidatedMfoActiveTab = tab;
        const taskId = review.activeConsolidatedMfoTaskId;
        if (taskId) {
            loadAndRenderConsolidatedMfo(taskId);
        }
    }

    async function loadAndRenderConsolidatedMfo(taskId) {
        if (typeof document === 'undefined') return;
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const task = taskMap().get(String(taskId));
        if (!task) return;
        const dept = chairDepartment();
        const client = db();

        let programPacket = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (err) {
                console.warn('[Consolidated MFO] fetch draft error:', err);
            }
        }

        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));
        const packetIds = taskPackets.map((p) => p.id).filter(Boolean);

        const childRows = {};
        if (client && packetIds.length > 0) {
            await Promise.all(engine.MFO_SECTIONS.map(async (sec) => {
                try {
                    const res = await client.from(sec.table).select('*').in('packet_id', packetIds);
                    if (res?.data) childRows[sec.table] = res.data;
                } catch (e) {
                    console.warn(`[Consolidated MFO] Child load warning (${sec.table}):`, e);
                }
            }));
        }

        const programRows = { pi1: [], pi2: [] };
        if (client && programPacket?.id) {
            try {
                const [pi1Res, pi2Res] = await Promise.all([
                    client.from('mfo_pi1_licensure').select('*').eq('program_packet_id', programPacket.id).order('sort_order'),
                    client.from('mfo_pi2_employment').select('*').eq('program_packet_id', programPacket.id).order('sort_order')
                ]);
                if (pi1Res?.data) programRows.pi1 = pi1Res.data;
                if (pi2Res?.data) programRows.pi2 = pi2Res.data;
            } catch (e) {
                console.warn('[Consolidated MFO] Program rows warning:', e);
            }
        }

        // Initialize customizations from draft notes if not yet loaded in active session
        if (!review.activeConsolidatedCustomizations) {
            review.activeConsolidatedCustomizations = engine.extractManualCustomizations(programPacket?.notes || programPacket);
            review.activeConsolidatedHasUnsavedChanges = false;
        }

        review.activeConsolidatedChildRows = childRows;
        review.activeConsolidatedProgramRows = programRows;

        const staleness = engine.detectConsolidatedDraftStaleness({
            taskId: task.id,
            department: dept,
            draft: programPacket,
            submissions: taskSubmissions,
            packets: taskPackets,
            childRows,
            sourceSnapshots: review.activeConsolidatedCustomizations?.source_snapshots,
            facultyList: review.faculty || [],
            actorFaculty: global.currentFaculty,
            delegatedAccess: effectiveGrants()
        });

        const consolidation = engine.buildDepartmentMfoConsolidation({
            taskId: task.id,
            department: dept,
            draft: programPacket,
            submissions: taskSubmissions,
            packets: taskPackets,
            childRows,
            programRows,
            customizations: review.activeConsolidatedCustomizations,
            facultyList: review.faculty || [],
            assignments: (scopedAssignments()).filter((a) => String(a.task_id) === String(task.id)),
            actorFaculty: global.currentFaculty,
            delegatedAccess: effectiveGrants()
        });

        review.activeConsolidatedModel = consolidation;
        review.activeConsolidatedStaleness = staleness;
        review.activeConsolidatedDraft = programPacket;

        renderConsolidatedMfoModalView({
            task,
            draft: programPacket,
            consolidation,
            staleness,
            dept
        });
    }

    function renderConsolidatedMfoModalView({ task, draft, consolidation, staleness, dept }) {
        if (typeof document === 'undefined') return;
        const titleEl = document.getElementById('chairMfoModalTitle');
        const subEl = document.getElementById('chairMfoModalSubtitle');
        const deptPill = document.getElementById('chairMfoModalDeptPill');
        const verPill = document.getElementById('chairMfoModalVersionPill');
        const bodyEl = document.getElementById('chairMfoModalBody');
        const footerStatus = document.getElementById('chairMfoModalFooterStatus');

        if (titleEl) titleEl.textContent = `${task.title || 'MFO Accomplishment Report'} — Consolidated Report`;
        if (subEl) subEl.textContent = `${chairDepartmentDisplay()} Department · ${task.reporting_period_label || task.academic_year || 'Current Period'}`;
        if (deptPill) deptPill.textContent = `${dept.toUpperCase()} DEPARTMENT`;

        const summary = consolidation.summary || {};
        const expectedCount = summary.totalExpectedFaculty ?? (consolidation.contributingFaculty.length + consolidation.unsubmittedFaculty.length);
        const contributingCount = summary.contributingFacultyCount ?? consolidation.contributingFaculty.length;
        const unsubmittedCount = summary.unsubmittedFacultyCount ?? consolidation.unsubmittedFaculty.length;
        const statusCounts = summary.statusCounts || { approved: 0, pending: 0, revision: 0, rejected: 0 };
        const totalItems = summary.totalItemsCount ?? 0;
        const activeItems = summary.activeItemsCount ?? 0;
        const excludedItems = summary.excludedItemsCount ?? 0;

        if (verPill) {
            if (draft) {
                const state = String(draft.packet_state || 'draft').toLowerCase();
                let isCorrected = false;
                let correctedFromVer = null;
                try {
                    if (typeof draft.notes === 'string' && draft.notes.trim().startsWith('{')) {
                        const parsed = JSON.parse(draft.notes);
                        correctedFromVer = parsed.corrected_from_version || parsed.citeflow_mfo_consolidation?.corrected_from_version || null;
                        isCorrected = Boolean(correctedFromVer);
                    }
                } catch (_) {}

                let pillClass = 'bg-indigo-50 text-indigo-700 border-indigo-100';
                let stateLabel = 'Draft';
                if (state === 'submitted' || state === 'resubmitted') {
                    pillClass = 'bg-blue-50 text-blue-700 border-blue-200';
                    stateLabel = state === 'resubmitted' ? 'Resubmitted to Dean' : 'Submitted to Dean';
                } else if (state === 'revision') {
                    pillClass = 'bg-amber-50 text-amber-800 border-amber-200';
                    stateLabel = 'Revision Requested';
                } else if (state === 'approved') {
                    pillClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                    stateLabel = 'Approved by Dean';
                } else if (state === 'declined') {
                    pillClass = 'bg-rose-50 text-rose-800 border-rose-200';
                    stateLabel = 'Declined';
                } else if (isCorrected) {
                    pillClass = 'bg-purple-50 text-purple-800 border-purple-200';
                    stateLabel = `Corrected Draft (from v${correctedFromVer || 1})`;
                }
                verPill.className = `text-xs font-semibold px-2 py-0.5 rounded border ${pillClass}`;
                verPill.textContent = `Version ${draft.current_version || 1} (${stateLabel})`;
            } else {
                verPill.className = 'text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200';
                verPill.textContent = 'No Draft Created';
            }
        }

        if (footerStatus) {
            if (draft) {
                footerStatus.innerHTML = `<span>Last Updated: <strong>${esc(formatWhen(draft.updated_at || draft.created_at))}</strong> · Snapshot Version: <strong>v${draft.current_version || 1}</strong></span>`;
            } else {
                footerStatus.innerHTML = `<span>Draft not yet compiled · Eligible submissions: <strong>${contributingCount} of ${expectedCount}</strong></span>`;
            }
        }

        if (!bodyEl) return;

        // CASE 1: No draft has been created yet
        if (!draft) {
            bodyEl.innerHTML = `
                <!-- No Draft Banner -->
                <div class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2 font-bold text-sm text-blue-900 mb-1">
                            <i class="fa-solid fa-circle-info text-blue-600"></i>
                            <span>No Consolidated Department Draft Exists</span>
                        </div>
                        <p class="text-xs text-blue-800">
                            A consolidated draft has not yet been generated for this reporting period. You can create the initial draft now from all available faculty submissions.
                        </p>
                    </div>
                    <button id="chairCreateDraftBtn" type="button" class="chair-btn-primary flex items-center justify-center gap-2 whitespace-nowrap" onclick="CiteFlowChairReview.createConsolidatedDraft('${task.id}')">
                        <i class="fa-solid fa-plus"></i> Create Consolidated Draft
                    </button>
                </div>

                <!-- 4 Summary Metric Cards -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center text-xs">
                    <div class="p-3 rounded-xl bg-slate-100 border border-slate-200">
                        <span class="text-[10px] uppercase font-bold text-slate-400 block">Expected Faculty</span>
                        <span class="text-lg font-extrabold text-slate-900">${expectedCount}</span>
                    </div>
                    <div class="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                        <span class="text-[10px] uppercase font-bold text-indigo-600 block">Submitted Reports</span>
                        <span class="text-lg font-extrabold text-indigo-900">${contributingCount}</span>
                    </div>
                    <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                        <span class="text-[10px] uppercase font-bold text-emerald-600 block">Ready Accomplishments</span>
                        <span class="text-lg font-extrabold text-emerald-900">${totalItems}</span>
                    </div>
                    <div class="p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <span class="text-[10px] uppercase font-bold text-amber-700 block">Not Yet Submitted</span>
                        <span class="text-lg font-extrabold text-amber-900">${unsubmittedCount}</span>
                    </div>
                </div>

                <!-- Available Contributing Faculty Preview -->
                <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                    <h4 class="font-bold text-slate-900 text-sm">Department Faculty Submissions (${consolidation.contributingFaculty.length})</h4>
                    ${consolidation.contributingFaculty.length > 0 ? `
                        <div class="space-y-2 max-h-60 overflow-y-auto">
                            ${consolidation.contributingFaculty.map((c) => `
                                <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                                    <div>
                                        <span class="font-semibold text-slate-800">${esc(c.facultyName)}</span>
                                        ${c.employeeId ? `<span class="text-slate-400 ml-1.5">(${esc(c.employeeId)})</span>` : ''}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        ${renderStatusPill(c.submissionStatus, c.statusLabel)}
                                        <a href="mfo-report.html?view=review&submission=${encodeURIComponent(c.submissionId)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs py-1 px-2.5">
                                            View Report &rarr;
                                        </a>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <p class="text-xs text-slate-400 p-2">No genuine faculty submissions received yet for this department.</p>
                    `}
                </div>

                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                    <i class="fa-solid fa-shield-halved text-slate-400 mt-0.5"></i>
                    <div>
                        <span class="font-semibold text-slate-700 block">Safeguards & Isolation</span>
                        Creating a consolidated draft creates an isolated department packet (<code class="text-xs text-slate-700">mfo_program_packets</code>) and generates Version 1 in snapshot history. Original faculty records remain completely immutable.
                    </div>
                </div>
            `;
            const footerActionsEl = document.getElementById('chairMfoModalFooterActions');
            if (footerActionsEl) {
                footerActionsEl.innerHTML = `
                    <a href="mfo-report.html?view=consolidated&task=${encodeURIComponent(task.id)}&dept=${encodeURIComponent(dept)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs inline-flex items-center" id="chairModalViewMfoBtn" title="Preview compiled MFO report">
                        <i class="fa-solid fa-file-invoice mr-1.5"></i> View MFO (Preview)
                    </a>
                `;
            }
            return;
        }

        // CASE 2: Draft exists
        const activeTab = review.consolidatedMfoActiveTab || 'summary';
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);

        // 1. Freshness & Source Updates Banner
        let freshnessBannerHtml = '';
        if (staleness.sourceUpdates && staleness.sourceUpdates.hasUpdates) {
            freshnessBannerHtml += `
                <div class="p-3.5 rounded-xl bg-blue-50 border border-blue-300 text-blue-950 text-xs mb-3">
                    <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
                        <div class="flex items-center gap-2 font-bold text-blue-900">
                            <i class="fa-solid fa-circle-exclamation text-blue-600 text-sm"></i>
                            <span>Underlying Faculty Submissions Have Been Updated (${staleness.sourceUpdates.totalUpdatedRows} items)</span>
                        </div>
                        <button type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.openSourceUpdatesModal()">
                            <i class="fa-solid fa-code-compare mr-1"></i> Review Source Changes
                        </button>
                    </div>
                    <p class="text-blue-800 text-[11px]">Faculty members have modified their accomplishments since this consolidated draft or your baseline snapshot was recorded. You can review field-by-field differences and choose which updates to accept or keep.</p>
                </div>
            `;
        }

        if (staleness.status === 'stale') {
            freshnessBannerHtml += `
                <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs mb-3">
                    <div class="flex items-center gap-2 font-bold mb-1 text-amber-900">
                        <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
                        <span>Consolidated Department Draft Is Stale</span>
                    </div>
                    <p class="text-slate-700 mb-2">Newer faculty submissions, status updates, or revisions have arrived since this draft was generated (${esc((staleness.reasons || []).join('; '))}).</p>
                    <div class="flex flex-wrap gap-2">
                        <button id="chairRegenerateDraftBtn" type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.regenerateMfoDraftModal('${task.id}')">
                            <i class="fa-solid fa-arrows-rotate mr-1"></i> Regenerate Draft
                        </button>
                        <button id="chairAcknowledgeDraftBtn" type="button" class="chair-btn-secondary text-xs" onclick="CiteFlowChairReview.acknowledgeMfoDraftModal('${task.id}')">
                            <i class="fa-solid fa-check mr-1"></i> Keep Current Draft
                        </button>
                    </div>
                </div>
            `;
        } else if (staleness.status === 'fresh' && staleness.acknowledged) {
            freshnessBannerHtml += `
                <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-emerald-600"></i>
                        <span>Departmental draft retained without changes (Chairperson acknowledged on ${esc(formatWhen(staleness.acknowledgment?.acknowledged_at))}).</span>
                    </div>
                    <button type="button" class="text-xs font-semibold text-[#621708] underline" onclick="CiteFlowChairReview.regenerateMfoDraftModal('${task.id}')">Regenerate Anyway</button>
                </div>
            `;
        } else if (staleness.status === 'fresh') {
            freshnessBannerHtml += `
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-emerald-600"></i>
                        <span>Consolidated departmental draft is current and up to date with all eligible submissions.</span>
                    </div>
                    <button type="button" class="chair-btn-secondary text-xs py-1 px-2.5" onclick="CiteFlowChairReview.regenerateMfoDraftModal('${task.id}')">
                        <i class="fa-solid fa-arrows-rotate mr-1"></i> Refresh Draft
                    </button>
                </div>
            `;
        }

        // 2. Summary Metric Cards
        const editedCount = summary.manuallyEditedCount || 0;
        const addedCount = summary.manualAdditionsCount || 0;
        const removedCount = summary.manuallyRemovedCount || 0;

        const summaryMetricsHtml = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center text-xs mb-3">
                <div class="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
                    <span class="text-[9px] uppercase font-bold text-indigo-600 block">Contributing Faculty</span>
                    <span class="text-base font-extrabold text-indigo-900">${contributingCount} / ${expectedCount}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                    <span class="text-[9px] uppercase font-bold text-emerald-600 block">Active Accomplishments</span>
                    <span class="text-base font-extrabold text-emerald-900">${activeItems}</span>
                    <span class="text-[9px] text-slate-400 block">${excludedItems} excluded · ${removedCount} removed</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
                    <span class="text-[9px] uppercase font-bold text-slate-500 block">Draft Version</span>
                    <span class="text-base font-extrabold text-slate-800">v${draft.current_version || 1}</span>
                    <span class="text-[9px] text-slate-400 block">${draft.packet_state || 'draft'}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                    <span class="text-[9px] uppercase font-bold text-amber-700 block">Manual Customizations</span>
                    <span class="text-xs font-bold text-slate-800 block mt-0.5">
                        ${editedCount} edited · ${addedCount} added
                    </span>
                    <span class="text-[9px] text-slate-400 block">${review.activeConsolidatedHasUnsavedChanges ? '<span class="text-amber-600 font-bold">● Unsaved edits</span>' : 'All saved'}</span>
                </div>
            </div>
        `;

        // 3. Navigation Tabs
        const tabsHtml = `
            <div class="flex border-b border-slate-200 gap-4 text-xs font-semibold mb-3 overflow-x-auto">
                <button type="button" class="pb-2.5 whitespace-nowrap ${activeTab === 'summary' ? 'border-b-2 border-[#621708] text-[#621708] font-bold' : 'text-slate-500 hover:text-slate-800'}" onclick="CiteFlowChairReview.setConsolidatedMfoTab('summary')">
                    <i class="fa-solid fa-chart-pie mr-1"></i> Summary &amp; Remarks
                </button>
                <button type="button" class="pb-2.5 whitespace-nowrap ${activeTab === 'preview' ? 'border-b-2 border-[#621708] text-[#621708] font-bold' : 'text-slate-500 hover:text-slate-800'}" onclick="CiteFlowChairReview.setConsolidatedMfoTab('preview')">
                    <i class="fa-solid fa-file-invoice mr-1"></i> Full Compiled Report
                </button>
                <button type="button" class="pb-2.5 whitespace-nowrap ${activeTab === 'faculty' ? 'border-b-2 border-[#621708] text-[#621708] font-bold' : 'text-slate-500 hover:text-slate-800'}" onclick="CiteFlowChairReview.setConsolidatedMfoTab('faculty')">
                    <i class="fa-solid fa-users mr-1"></i> Contributing Faculty (${consolidation.contributingFaculty.length})
                </button>
                <button type="button" class="pb-2.5 whitespace-nowrap ${activeTab === 'accomplishments' ? 'border-b-2 border-[#621708] text-[#621708] font-bold' : 'text-slate-500 hover:text-slate-800'}" onclick="CiteFlowChairReview.setConsolidatedMfoTab('accomplishments')">
                    <i class="fa-solid fa-list-check mr-1"></i> Accomplishments (${totalItems})${review.activeConsolidatedHasUnsavedChanges ? ' <span class="w-2 h-2 rounded-full bg-amber-500 inline-block align-middle ml-1" title="Unsaved changes"></span>' : ''}
                </button>
                <button type="button" class="pb-2.5 whitespace-nowrap ${activeTab === 'program' ? 'border-b-2 border-[#621708] text-[#621708] font-bold' : 'text-slate-500 hover:text-slate-800'}" onclick="CiteFlowChairReview.setConsolidatedMfoTab('program')">
                    <i class="fa-solid fa-graduation-cap mr-1"></i> Program Metrics (PI1/PI2)
                </button>
            </div>
        `;

        // 4. Tab Content
        let tabContentHtml = '';

        if (activeTab === 'summary') {
            let existingRemarks = '';
            try {
                if (typeof draft.notes === 'string') {
                    if (draft.notes.trim().startsWith('{')) {
                        const parsed = JSON.parse(draft.notes);
                        existingRemarks = parsed.user_remarks || parsed.citeflow_mfo_consolidation?.user_remarks || '';
                    } else {
                        existingRemarks = draft.notes.split('\n---')[0].trim();
                    }
                }
            } catch (_) {}

            const deanReview = engine?.extractDeanReview ? engine.extractDeanReview(draft.notes) : null;
            let isCorrected = false;
            let correctedFromVer = null;
            let previousDeanReview = null;
            try {
                if (typeof draft.notes === 'string' && draft.notes.trim().startsWith('{')) {
                    const parsed = JSON.parse(draft.notes);
                    correctedFromVer = parsed.corrected_from_version || parsed.citeflow_mfo_consolidation?.corrected_from_version || null;
                    isCorrected = Boolean(correctedFromVer);
                    previousDeanReview = parsed.previous_dean_review || parsed.citeflow_mfo_consolidation?.previous_dean_review || null;
                }
            } catch (_) {}

            const state = String(draft.packet_state || 'draft').toLowerCase();
            let statusBannerHtml = '';
            if (state === 'submitted' || state === 'resubmitted') {
                statusBannerHtml = `
                    <div class="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 text-xs flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-paper-plane"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-bold text-blue-900 block">Submitted to Dean's Office</span>
                                <span class="text-[11px] font-semibold text-blue-700">Version ${draft.current_version || 1} · ${esc(formatWhen(draft.updated_at || draft.created_at))}</span>
                            </div>
                            <p class="text-blue-800">The Department Consolidated MFO has been submitted to the Dean's Office for final review and approval. An immutable version snapshot has been recorded in the audit trail.</p>
                        </div>
                    </div>
                `;
            } else if (state === 'revision') {
                statusBannerHtml = `
                    <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-rotate-left"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-bold text-amber-900 block">Dean's Office Requested Revisions</span>
                                <span class="text-[11px] font-semibold text-amber-800">${esc(formatWhen(deanReview?.reviewed_at || draft.updated_at))}</span>
                            </div>
                            <p class="text-amber-900 mb-1 font-medium"><strong>Dean Remarks:</strong> "${esc(deanReview?.remarks || 'Please review and revise department accomplishments.')}"</p>
                            <p class="text-[11px] text-amber-800 mb-2">The original submitted snapshot is preserved in version history. You may edit accomplishments, section assignments, and evidence, then click <strong>Resubmit to Dean's Office</strong> below.</p>
                            <div class="flex items-center gap-2">
                                <button type="button" class="chair-btn-secondary text-xs inline-flex items-center" onclick="CiteFlowChairReview.setConsolidatedMfoTab('accomplishments')">
                                    <i class="fa-regular fa-pen-to-square mr-1.5"></i> Edit Consolidated Report
                                </button>
                                <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairBannerResubmitBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')">
                                    <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean's Office
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else if (state === 'approved') {
                statusBannerHtml = `
                    <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-circle-check"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-bold text-emerald-900 block">Approved by Dean's Office</span>
                                <span class="text-[11px] font-semibold text-emerald-700">Version ${draft.current_version || 1} · ${esc(formatWhen(deanReview?.reviewed_at || draft.updated_at))}</span>
                            </div>
                            <p class="text-emerald-800">The Dean's Office has granted final approval to the Department Consolidated MFO for ${esc(dept.toUpperCase())}.${deanReview?.remarks ? ` Remarks: "${esc(deanReview.remarks)}"` : ''}</p>
                            <p class="text-[11px] text-emerald-700 mt-1">This approved snapshot is an immutable historical record.</p>
                        </div>
                    </div>
                `;
            } else if (state === 'declined') {
                statusBannerHtml = `
                    <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-xmark"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-bold text-rose-900 block">Declined by Dean's Office</span>
                                <span class="text-[11px] font-semibold text-rose-700">${esc(formatWhen(deanReview?.reviewed_at || draft.updated_at))}</span>
                            </div>
                            <p class="text-rose-800 mb-1">The Dean's Office declined this consolidated report.${deanReview?.remarks ? ` Decline Reason: "<strong>${esc(deanReview.remarks)}</strong>"` : ''}</p>
                            <p class="text-[11px] text-rose-700 mb-2">The declined submission and its review remarks are preserved in version history. To correct this report and resubmit, create a corrected version.</p>
                            <div>
                                <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairBannerCreateCorrectedVersionBtn" onclick="CiteFlowChairReview.createCorrectedVersion('${task.id}')">
                                    <i class="fa-solid fa-file-pen mr-1.5"></i> Create Corrected Version
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else if (isCorrected) {
                statusBannerHtml = `
                    <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-bold text-amber-900 block">Corrected Draft (Version ${draft.current_version || 2})</span>
                                <span class="text-[11px] font-semibold text-amber-800">Corrected from v${correctedFromVer || 1}</span>
                            </div>
                            ${previousDeanReview?.remarks ? `<p class="text-amber-900 mb-1 font-medium"><strong>Previous Dean Decline Reason:</strong> "${esc(previousDeanReview.remarks)}"</p>` : ''}
                            <p class="text-[11px] text-amber-800 mb-2">This working draft preserves all previous accomplishments, manual additions, and edits. You can make further changes or re-assign sections, then click <strong>Resubmit to Dean's Office</strong>.</p>
                            <div class="flex items-center gap-2">
                                <button type="button" class="chair-btn-secondary text-xs inline-flex items-center" onclick="CiteFlowChairReview.setConsolidatedMfoTab('accomplishments')">
                                    <i class="fa-regular fa-pen-to-square mr-1.5"></i> Edit Consolidated Report
                                </button>
                                <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairBannerResubmitCorrectedBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')">
                                    <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean's Office
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }

            let summaryCardSubmitAction = '';
            if (state === 'draft') {
                if (isCorrected) {
                    summaryCardSubmitAction = `
                        <button type="button" class="chair-btn-primary text-xs inline-flex items-center whitespace-nowrap" id="chairSummaryResubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Resubmit Corrected Consolidated MFO to Dean's Office">
                            <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean
                        </button>
                    `;
                } else {
                    summaryCardSubmitAction = `
                        <button type="button" class="chair-btn-primary text-xs inline-flex items-center whitespace-nowrap" id="chairSummarySubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Submit Consolidated MFO to Dean's Office">
                            <i class="fa-solid fa-paper-plane mr-1.5"></i> Submit to Dean
                        </button>
                    `;
                }
            } else if (state === 'revision') {
                summaryCardSubmitAction = `
                    <button type="button" class="chair-btn-primary text-xs inline-flex items-center whitespace-nowrap" id="chairSummaryResubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Resubmit Consolidated MFO to Dean's Office">
                        <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean
                    </button>
                `;
            } else if (state === 'declined') {
                summaryCardSubmitAction = `
                    <button type="button" class="chair-btn-primary text-xs inline-flex items-center whitespace-nowrap" id="chairSummaryCreateCorrectedBtn" onclick="CiteFlowChairReview.createCorrectedVersion('${task.id}')" title="Create a corrected version to edit and resubmit">
                        <i class="fa-solid fa-file-pen mr-1.5"></i> Create Corrected Version
                    </button>
                `;
            }

            tabContentHtml = `
                <div class="space-y-4">
                    ${statusBannerHtml}
                    <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Reporting Cycle:</span>
                            <span class="font-bold text-slate-900">${esc(task.title)}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Department:</span>
                            <span class="font-bold text-slate-900">${esc(dept.toUpperCase())}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Reporting Period:</span>
                            <span class="font-bold text-slate-900">${esc(task.reporting_period_label || task.academic_year || 'Current Period')}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Workflow Status:</span>
                            <span class="font-bold text-slate-900 uppercase">${esc(state)}</span>
                        </div>
                    </div>

                    <div class="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                        <label for="chairMfoDraftRemarksInput" class="text-xs font-bold uppercase tracking-wide text-slate-700 block">
                            Chairperson Remarks &amp; Feedback on Consolidated Draft
                        </label>
                        <textarea id="chairMfoDraftRemarksInput" rows="3" class="w-full border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#621708]" placeholder="Enter chairperson notes or remarks for this consolidated report...">${esc(existingRemarks)}</textarea>
                        <div class="flex justify-end">
                            <button type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.saveMfoDraftRemarks('${task.id}')">
                                <i class="fa-regular fa-floppy-disk mr-1"></i> Save Remarks
                            </button>
                        </div>
                    </div>

                    <!-- View Full Compiled MFO Action Card -->
                    <div class="p-3.5 rounded-xl bg-[#fff0eb] border border-[#fbdacf] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-lg bg-[#621708] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                                <i class="fa-solid fa-file-invoice"></i>
                            </div>
                            <div>
                                <span class="text-xs font-bold text-[#621708] uppercase tracking-wide block">Official Consolidated MFO Document</span>
                                <span class="text-xs text-slate-600">View and print the complete continuous report compiled from all contributing faculty</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <a href="mfo-report.html?view=consolidated&task=${encodeURIComponent(task.id)}&dept=${encodeURIComponent(dept)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs inline-flex items-center whitespace-nowrap" id="chairSummaryViewMfoBtn">
                                <i class="fa-solid fa-file-invoice mr-1.5"></i> View MFO
                            </a>
                            ${summaryCardSubmitAction}
                        </div>
                    </div>

                    <!-- PDF Status Disclaimer (Requirement 8) -->
                    <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
                        <div class="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            <i class="fa-solid fa-file-pdf"></i>
                        </div>
                        <div>
                            <span class="font-bold text-slate-800 block">Consolidated PDF Compilation Status</span>
                            <span>All faculty data above is compiled and versioned in snapshots. Official Consolidated PDF generation will be finalized during Dean's Office packet review (Phase 5.3). No unauthorized or incomplete PDF is generated prematurely.</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (activeTab === 'preview') {
            tabContentHtml = `
                <div class="space-y-3">
                    <div class="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                        <div>
                            <span class="font-bold text-slate-800 block">Full Compiled Official MFO Report</span>
                            <span class="text-slate-500">Live compiled report rendered with official headers, continuous tables, contributing faculty attribution, and documentation.</span>
                        </div>
                        <a href="mfo-report.html?view=consolidated&task=${encodeURIComponent(task.id)}&dept=${encodeURIComponent(dept)}" target="_blank" rel="noopener" class="chair-btn-primary text-xs inline-flex items-center">
                            <i class="fa-solid fa-up-right-from-square mr-1.5"></i> Open in New Tab
                        </a>
                    </div>
                    <iframe src="mfo-report.html?view=consolidated&task=${encodeURIComponent(task.id)}&dept=${encodeURIComponent(dept)}" class="w-full border border-slate-200 rounded-xl bg-white shadow-inner" style="height:620px;" title="Full Compiled MFO Report Preview"></iframe>
                </div>
            `;
        } else if (activeTab === 'faculty') {
            tabContentHtml = `
                <div class="space-y-4">
                    <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                        <h4 class="font-bold text-slate-900 text-sm">Contributing Faculty Members (${consolidation.contributingFaculty.length})</h4>
                        ${consolidation.contributingFaculty.length > 0 ? `
                            <div class="space-y-2 max-h-72 overflow-y-auto">
                                ${consolidation.contributingFaculty.map((c) => `
                                    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                                        <div>
                                            <div class="font-bold text-slate-900">${esc(c.facultyName)}</div>
                                            <div class="text-slate-500 text-[11px] mt-0.5">
                                                ${c.employeeId ? `<span class="mr-2">Emp ID: ${esc(c.employeeId)}</span>` : ''}
                                                ${c.rank ? `<span>Rank: ${esc(c.rank)}</span>` : ''}
                                            </div>
                                            <div class="text-slate-400 text-[10px] mt-0.5">Submitted: ${esc(formatWhen(c.submittedAt))}</div>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            ${renderStatusPill(c.submissionStatus, c.statusLabel)}
                                            <a href="mfo-report.html?view=review&submission=${encodeURIComponent(c.submissionId)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs py-1 px-2.5">
                                                Review Report &rarr;
                                            </a>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <p class="text-xs text-slate-400 p-2">No genuine faculty submissions contributing to this draft.</p>
                        `}
                    </div>

                    ${consolidation.unsubmittedFaculty.length > 0 ? `
                        <div class="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                            <h4 class="font-bold text-slate-700 text-xs uppercase tracking-wide">
                                Expected Faculty Without Genuine Submission (${consolidation.unsubmittedFaculty.length})
                            </h4>
                            <p class="text-[11px] text-slate-500">The following faculty members are assigned to this task but have not submitted genuine reports. In accordance with Rule 3, they are excluded from the consolidated report and appear in analytics only.</p>
                            <div class="flex flex-wrap gap-1.5 pt-1">
                                ${consolidation.unsubmittedFaculty.map((u) => `
                                    <span class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 font-medium">
                                        ${esc(u.facultyName)}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        } else if (activeTab === 'accomplishments') {
            const pState = String(draft.packet_state || 'draft').toLowerCase();
            const isLocked = ['submitted', 'resubmitted', 'approved', 'declined'].includes(pState);
            const sections = engine?.MFO_SECTIONS || [];
            const currentFilter = review.activeConsolidatedFilter || 'all';
            const searchQ = (review.activeConsolidatedSearch || '').trim().toLowerCase();

            let sectionsHtml = '';
            let hasAnyMatchingItems = false;

            // Top action toolbar: Add Entry button, Filter pills, Search box, Save Draft button
            const toolbarHtml = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 mb-3 text-xs">
                    <div class="flex items-center gap-2 flex-wrap">
                        ${!isLocked ? `
                            <button type="button" class="chair-btn-primary text-xs flex items-center gap-1.5" onclick="CiteFlowChairReview.openAddAccomplishmentModal()">
                                <i class="fa-solid fa-plus"></i> Add Entry
                            </button>
                        ` : `
                            <div class="inline-flex items-center gap-1.5 text-xs">
                                ${pState === 'declined' ? `
                                    <span class="text-rose-700 font-semibold px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
                                        <i class="fa-solid fa-lock mr-1 text-rose-500"></i> Report Declined &middot; Click "Create Corrected Version" to enable edits
                                    </span>
                                ` : (pState === 'approved' ? `
                                    <span class="text-emerald-700 font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
                                        <i class="fa-solid fa-lock mr-1 text-emerald-500"></i> Approved Snapshot (Immutable)
                                    </span>
                                ` : `
                                    <span class="text-blue-700 font-semibold px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200">
                                        <i class="fa-solid fa-lock mr-1 text-blue-500"></i> Submitted to Dean (Pending Review)
                                    </span>
                                `)}
                            </div>
                        `}
                        <div class="flex items-center gap-1 border border-slate-200 rounded-lg bg-white p-0.5">
                            <button type="button" class="px-2 py-1 rounded text-[11px] font-semibold ${currentFilter === 'all' ? 'bg-[#621708] text-white' : 'text-slate-600 hover:text-slate-900'}" onclick="CiteFlowChairReview.setConsolidatedFilter('all')">All (${totalItems})</button>
                            <button type="button" class="px-2 py-1 rounded text-[11px] font-semibold ${currentFilter === 'edited' ? 'bg-[#621708] text-white' : 'text-slate-600 hover:text-slate-900'}" onclick="CiteFlowChairReview.setConsolidatedFilter('edited')">Edited (${editedCount})</button>
                            <button type="button" class="px-2 py-1 rounded text-[11px] font-semibold ${currentFilter === 'added' ? 'bg-[#621708] text-white' : 'text-slate-600 hover:text-slate-900'}" onclick="CiteFlowChairReview.setConsolidatedFilter('added')">Added (${addedCount})</button>
                            <button type="button" class="px-2 py-1 rounded text-[11px] font-semibold ${currentFilter === 'removed' ? 'bg-[#621708] text-white' : 'text-slate-600 hover:text-slate-900'}" onclick="CiteFlowChairReview.setConsolidatedFilter('removed')">Removed (${removedCount})</button>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="relative w-full sm:w-48">
                            <input type="text" class="w-full border border-slate-200 rounded-lg pl-7 pr-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#621708]" placeholder="Search entries..." value="${esc(review.activeConsolidatedSearch || '')}" oninput="CiteFlowChairReview.setConsolidatedSearch(this.value)">
                            <i class="fa-solid fa-magnifying-glass absolute left-2 top-2 text-[11px] text-slate-400"></i>
                        </div>
                        ${!isLocked && review.activeConsolidatedHasUnsavedChanges ? `
                            <button type="button" class="chair-btn-primary text-xs whitespace-nowrap animate-pulse" onclick="CiteFlowChairReview.saveConsolidatedMfoEdits()" title="Save changes to draft">
                                <i class="fa-regular fa-floppy-disk mr-1"></i> Save Draft
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;

            sections.forEach((secDef) => {
                const allSecItems = consolidation.sections?.[secDef.table] || [];
                const filteredItems = allSecItems.filter((item) => {
                    const isRemoved = item.is_manually_removed === true;
                    const isEdited = item._isEdited === true;
                    const isAdded = item._isAdded === true;

                    if (currentFilter === 'edited' && !isEdited) return false;
                    if (currentFilter === 'added' && !isAdded) return false;
                    if (currentFilter === 'removed' && !isRemoved) return false;
                    if (currentFilter === 'all' && isRemoved) return false;

                    if (searchQ) {
                        const title = String(item.title || item.activity_title || item.program_title || item.subject_code || item.course_title || item.award_name || item.name || '').toLowerCase();
                        const desc = String(item.description || item.details || item.venue || item.remarks || '').toLowerCase();
                        const fac = String(item.contributing_faculty_name || '').toLowerCase();
                        if (!title.includes(searchQ) && !desc.includes(searchQ) && !fac.includes(searchQ)) {
                            return false;
                        }
                    }
                    return true;
                });

                if (!allSecItems.length && currentFilter !== 'all') return;
                if (!filteredItems.length && searchQ) return;

                hasAnyMatchingItems = hasAnyMatchingItems || filteredItems.length > 0;

                sectionsHtml += `
                    <div class="border border-slate-200 rounded-xl overflow-hidden mb-3 bg-white">
                        <div class="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <span class="font-bold text-xs text-slate-800">${esc(secDef.group)} &middot; ${esc(secDef.title)}</span>
                                <span class="text-[10px] text-slate-400 block">Protected official template section &middot; Cannot be deleted</span>
                            </div>
                            <span class="text-[11px] font-semibold text-slate-500">${filteredItems.length} active item${filteredItems.length === 1 ? '' : 's'}</span>
                        </div>
                        ${filteredItems.length > 0 ? `
                            <div class="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                                ${filteredItems.map((item) => {
                                    const rowId = item.id != null ? String(item.id) : (item._source?.sourceRowId || '');
                                    const isRemoved = item.is_manually_removed === true;
                                    const isEdited = item._isEdited === true;
                                    const isAdded = item._isAdded === true;
                                    const isExcluded = item.is_excluded === true;
                                    const isRejected = item.is_rejected === true;
                                    const title = item.title || item.activity_title || item.program_title || item.subject_code || item.course_title || item.award_name || item.name || 'Accomplishment';
                                    const desc = item.description || item.details || item.venue || item.remarks || '';
                                    const dateVal = item.start_date || item.date || item.publication_date || item.exam_date || '';

                                    return `
                                        <div class="p-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${isRemoved ? 'bg-slate-50/80 opacity-60' : (isExcluded ? 'bg-rose-50/40 opacity-75' : '')}">
                                            <div class="flex-1 min-w-0">
                                                <div class="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span class="font-bold text-slate-900 ${isRemoved ? 'line-through text-slate-500' : ''}">${esc(title)}</span>
                                                    ${isRemoved ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-700"><i class="fa-solid fa-trash-can mr-1"></i> Removed from Report</span>` : ''}
                                                    ${isAdded ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800"><i class="fa-solid fa-plus-circle mr-1"></i> Added by Chair</span>` : ''}
                                                    ${isEdited ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800"><i class="fa-solid fa-pen mr-1"></i> Edited by Chair</span>` : ''}
                                                    ${!isAdded && !isEdited && !isRemoved ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-600">Auto-fetched</span>` : ''}
                                                    ${isRejected ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">Declined Submission</span>` : ''}
                                                    ${isExcluded ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-700">Excluded</span>` : ''}
                                                </div>
                                                ${desc ? `<p class="text-slate-600 text-[11px] mb-1 line-clamp-2">${esc(desc)}</p>` : ''}
                                                <div class="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
                                                    <span>Contributor: <strong>${esc(item.contributing_faculty_name || 'Chairperson')}</strong></span>
                                                    ${dateVal ? `<span>&middot; Date: <strong>${esc(dateVal)}</strong></span>` : ''}
                                                    <span>&middot; Status: ${esc(item.contributing_status_label || '—')}</span>
                                                </div>
                                            </div>
                                            <div class="flex items-center gap-1.5 flex-shrink-0">
                                                ${isLocked ? `
                                                    <span class="text-[11px] text-slate-400 font-medium italic px-2 py-1">Locked</span>
                                                ` : (isRemoved ? `
                                                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100" onclick="CiteFlowChairReview.restoreConsolidatedAccomplishment('${secDef.table}', '${rowId}')" title="Restore this item to the consolidated report">
                                                        <i class="fa-solid fa-rotate-left mr-1"></i> Restore
                                                    </button>
                                                ` : `
                                                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-50" onclick="CiteFlowChairReview.openEditAccomplishmentModal('${secDef.table}', '${rowId}')" title="Edit content details">
                                                        <i class="fa-regular fa-pen-to-square mr-1 text-[#621708]"></i> Edit
                                                    </button>
                                                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg font-semibold bg-white text-rose-700 border border-rose-200 hover:bg-rose-50" onclick="CiteFlowChairReview.removeConsolidatedAccomplishment('${secDef.table}', '${rowId}')" title="Remove from consolidated report">
                                                        <i class="fa-regular fa-trash-can mr-1"></i> Remove
                                                    </button>
                                                `)}
                                                ${!isLocked && isRejected ? `
                                                    <button type="button" class="text-xs px-2.5 py-1 rounded-lg font-semibold border ${isExcluded ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300'}" onclick="CiteFlowChairReview.toggleExclusionModal('${task.id}', '${rowId}', ${isExcluded ? 'false' : 'true'})">
                                                        <i class="fa-solid ${isExcluded ? 'fa-eye' : 'fa-eye-slash'} mr-1"></i> ${isExcluded ? 'Include' : 'Exclude'}
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : `
                            <div class="p-3 text-center text-slate-400 text-xs italic bg-slate-50/50">
                                No active accomplishments in this section (will render with official table headers and "N/A" in official report).
                            </div>
                        `}
                    </div>
                `;
            });

            if (!hasAnyMatchingItems && searchQ) {
                sectionsHtml = `
                    <div class="py-8 text-center text-slate-400 text-xs">
                        <i class="fa-solid fa-magnifying-glass text-2xl mb-2 text-slate-300 block"></i>
                        No accomplishments found matching "${esc(searchQ)}".
                    </div>
                `;
            }

            tabContentHtml = toolbarHtml + sectionsHtml;
        } else if (activeTab === 'program') {
            const pState = String(draft.packet_state || 'draft').toLowerCase();
            const isLocked = ['submitted', 'resubmitted', 'approved', 'declined'].includes(pState);
            const pi1Rows = consolidation.programPortion?.pi1 || [];
            const pi2Rows = consolidation.programPortion?.pi2 || [];

            tabContentHtml = `
                <div class="space-y-4 text-xs">
                    <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
                        <div class="flex items-center justify-between">
                            <h4 class="font-bold text-slate-900 text-xs uppercase tracking-wide">PI1 — Licensure Examination Results</h4>
                            ${!isLocked ? `
                                <button type="button" class="chair-btn-secondary text-xs py-1 px-2.5" onclick="CiteFlowChairReview.openEditProgramPortionModal('pi1', 0)" title="Edit Licensure Results">
                                    <i class="fa-regular fa-pen-to-square mr-1"></i> Edit Metric
                                </button>
                            ` : '<span class="text-[11px] text-slate-400 italic">Locked</span>'}
                        </div>
                        ${pi1Rows.length > 0 ? `
                            <div class="space-y-1.5">
                                ${pi1Rows.map((r) => `
                                    <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
                                        <span>${esc(r.exam_name || 'Licensure Examination')}</span>
                                        <span class="font-bold">${esc(r.passing_rate || '—')}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <p class="text-slate-400 p-2">No program-level PI1 licensure records configured for this draft. Click "Edit Metric" to set values.</p>
                        `}
                    </div>

                    <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
                        <div class="flex items-center justify-between">
                            <h4 class="font-bold text-slate-900 text-xs uppercase tracking-wide">PI2 — Graduate Employment Tracking</h4>
                            ${!isLocked ? `
                                <button type="button" class="chair-btn-secondary text-xs py-1 px-2.5" onclick="CiteFlowChairReview.openEditProgramPortionModal('pi2', 0)" title="Edit Graduate Employment">
                                    <i class="fa-regular fa-pen-to-square mr-1"></i> Edit Metric
                                </button>
                            ` : '<span class="text-[11px] text-slate-400 italic">Locked</span>'}
                        </div>
                        ${pi2Rows.length > 0 ? `
                            <div class="space-y-1.5">
                                ${pi2Rows.map((r) => `
                                    <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
                                        <span>${esc(r.cohort_label || 'Graduate Cohort')}</span>
                                        <span class="font-bold">${esc(r.employed_percentage || '—')}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <p class="text-slate-400 p-2">No program-level PI2 graduate employment records configured for this draft. Click "Edit Metric" to set values.</p>
                        `}
                    </div>
                </div>
            `;
        }

        bodyEl.innerHTML = `
            ${freshnessBannerHtml}
            ${summaryMetricsHtml}
            ${tabsHtml}
            ${tabContentHtml}
        `;

        if (footerStatus) {
            if (review.activeConsolidatedHasUnsavedChanges) {
                footerStatus.innerHTML = `<span class="text-amber-700 font-bold inline-flex items-center gap-1.5"><i class="fa-solid fa-circle-dot text-amber-500 animate-pulse"></i> You have unsaved changes. Click <strong>Save Draft</strong> to persist.</span>`;
            } else if (draft) {
                footerStatus.innerHTML = `<span>Last Updated: <strong>${esc(formatWhen(draft.updated_at || draft.created_at))}</strong> · Snapshot Version: <strong>v${draft.current_version || 1}</strong></span>`;
            } else {
                footerStatus.innerHTML = `<span>Draft not yet compiled · Eligible submissions: <strong>${contributingCount} of ${expectedCount}</strong></span>`;
            }
        }

        const footerActionsEl = document.getElementById('chairMfoModalFooterActions');
        if (footerActionsEl) {
            const pState = String(draft.packet_state || 'draft').toLowerCase();
            let isCorrected = false;
            try {
                if (typeof draft.notes === 'string' && draft.notes.trim().startsWith('{')) {
                    const parsed = JSON.parse(draft.notes);
                    isCorrected = Boolean(parsed.corrected_from_version || parsed.citeflow_mfo_consolidation?.corrected_from_version);
                }
            } catch (_) {}

            let submitBtnHtml = '';
            if (pState === 'draft') {
                if (isCorrected) {
                    submitBtnHtml = `
                        <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairModalResubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Resubmit Corrected Consolidated MFO to Dean's Office">
                            <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean's Office
                        </button>
                    `;
                } else {
                    submitBtnHtml = `
                        <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairModalSubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Submit Consolidated MFO to Dean's Office">
                            <i class="fa-solid fa-paper-plane mr-1.5"></i> Submit Consolidated MFO
                        </button>
                    `;
                }
            } else if (pState === 'revision') {
                submitBtnHtml = `
                    <button type="button" class="chair-btn-secondary text-xs inline-flex items-center" onclick="CiteFlowChairReview.setConsolidatedMfoTab('accomplishments')">
                        <i class="fa-regular fa-pen-to-square mr-1.5"></i> Edit Consolidated Report
                    </button>
                    <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairModalResubmitMfoBtn" onclick="CiteFlowChairReview.openSubmitConsolidatedMfoModal('${task.id}')" title="Resubmit Consolidated MFO to Dean's Office">
                        <i class="fa-solid fa-paper-plane mr-1.5"></i> Resubmit to Dean's Office
                    </button>
                `;
            } else if (pState === 'submitted' || pState === 'resubmitted') {
                submitBtnHtml = `
                    <span class="inline-flex items-center text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-200">
                        <i class="fa-solid fa-clock mr-1.5"></i> Submitted to Dean's Office
                    </span>
                `;
            } else if (pState === 'approved') {
                submitBtnHtml = `
                    <span class="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                        <i class="fa-solid fa-check mr-1.5"></i> Approved by Dean's Office
                    </span>
                `;
            } else if (pState === 'declined') {
                submitBtnHtml = `
                    <button type="button" class="chair-btn-primary text-xs inline-flex items-center" id="chairCreateCorrectedVersionBtn" onclick="CiteFlowChairReview.createCorrectedVersion('${task.id}')" title="Create a corrected draft based on this declined report">
                        <i class="fa-solid fa-file-pen mr-1.5"></i> Create Corrected Version
                    </button>
                `;
            }

            let saveEditsBtnHtml = '';
            if (review.activeConsolidatedHasUnsavedChanges && (pState === 'draft' || pState === 'revision')) {
                saveEditsBtnHtml = `
                    <button type="button" class="chair-btn-primary text-xs inline-flex items-center animate-pulse" id="chairModalSaveEditsBtn" onclick="CiteFlowChairReview.saveConsolidatedMfoEdits()" title="Save manual edits to draft">
                        <i class="fa-regular fa-floppy-disk mr-1.5"></i> Save Draft
                    </button>
                `;
            }

            footerActionsEl.innerHTML = `
                <a href="mfo-report.html?view=consolidated&task=${encodeURIComponent(task.id)}&dept=${encodeURIComponent(dept)}" target="_blank" rel="noopener" class="chair-btn-secondary text-xs inline-flex items-center" id="chairModalViewMfoBtn" title="View Full Compiled Official MFO Report">
                    <i class="fa-solid fa-file-invoice mr-1.5"></i> View MFO
                </a>
                ${saveEditsBtnHtml}
                ${submitBtnHtml}
            `;
        }
    }

    async function createCorrectedVersion(taskId) {
        if (review.mfoDraftBusy) return;
        review.mfoDraftBusy = true;

        const btn = typeof document !== 'undefined' ? (document.getElementById('chairCreateCorrectedVersionBtn') || document.getElementById('chairBannerCreateCorrectedVersionBtn') || document.getElementById('chairSummaryCreateCorrectedBtn')) : null;
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Creating Corrected Version...';
        }

        try {
            const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
            if (!engine) throw new Error('Consolidation engine not loaded.');

            const dept = chairDepartment();
            const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
            if (!auth.authorized) {
                toast(auth.reason || 'Unauthorized for this department.', 'error');
                return;
            }

            const task = taskMap().get(String(taskId));
            if (!task) throw new Error('Task not found.');

            const client = db();
            let programPacket = review.activeConsolidatedDraft;
            if (client && (!programPacket || !programPacket.id)) {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            }

            if (!programPacket) {
                toast('No consolidated report found to create a corrected version.', 'error');
                return;
            }

            const customizations = review.activeConsolidatedCustomizations || engine.extractManualCustomizations(programPacket?.notes || programPacket);

            const result = await engine.createCorrectedVersion({
                db: client,
                draft: programPacket,
                taskId: task.id,
                department: dept,
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants(),
                customizations
            });

            if (!result.ok) {
                toast(result.error || 'Failed to create corrected version.', 'error');
                return;
            }

            review.activeConsolidatedHasUnsavedChanges = false;
            toast(`Created corrected draft v${result.version}. You can now edit accomplishments, section assignments, and evidence before resubmitting.`, 'success');
            await loadAndRenderConsolidatedMfo(task.id);
            if (typeof render === 'function') render();
        } catch (err) {
            console.error('[Create Corrected Version]', err);
            toast('Failed to create corrected version: ' + (err?.message || err), 'error');
        } finally {
            review.mfoDraftBusy = false;
            if (btn && origHtml) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    }

    async function createConsolidatedDraft(taskId) {
        if (review.mfoDraftBusy) return;
        review.mfoDraftBusy = true;

        const btn = typeof document !== 'undefined' ? document.getElementById('chairCreateDraftBtn') : null;
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Creating Draft...';
        }

        try {
            const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
            if (!engine) throw new Error('Consolidation engine not loaded.');

            const dept = chairDepartment();
            const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
            if (!auth.authorized) {
                toast(auth.reason || 'Unauthorized for this department.', 'error');
                return;
            }

            const task = taskMap().get(String(taskId));
            if (!task) throw new Error('Task not found.');

            const client = db();

            // Idempotency: verify no concurrent draft was created
            let existingDraft = null;
            if (client) {
                const checkRes = await client.from('mfo_program_packets')
                    .select('id, current_version')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (checkRes?.data) {
                    existingDraft = checkRes.data;
                }
            }

            if (existingDraft) {
                toast('Consolidated draft already exists.', 'info');
                await loadAndRenderConsolidatedMfo(task.id);
                return;
            }

            const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
            const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));
            const packetIds = taskPackets.map((p) => p.id).filter(Boolean);

            const childRows = {};
            if (client && packetIds.length > 0) {
                await Promise.all(engine.MFO_SECTIONS.map(async (sec) => {
                    try {
                        const res = await client.from(sec.table).select('*').in('packet_id', packetIds);
                        if (res?.data) childRows[sec.table] = res.data;
                    } catch (e) {
                        console.warn(`[Create MFO Draft] Child load warning (${sec.table}):`, e);
                    }
                }));
            }

            const regenerated = engine.regenerateDepartmentDraft({
                taskId: task.id,
                department: dept,
                previousDraft: null,
                submissions: taskSubmissions,
                packets: taskPackets,
                childRows,
                programRows: { pi1: [], pi2: [] },
                facultyList: review.faculty || [],
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants()
            });

            if (client) {
                const mergedNotes = engine.mergeNotesMetadata(null, {
                    excluded_accomplishments: Array.from(regenerated.excludedAccomplishmentIds),
                    count: regenerated.excludedAccomplishmentIds.size,
                    consolidated_at: regenerated.frozenPayload.metadata.consolidated_at
                });

                const { data: insertedDraft, error: insertErr } = await client.from('mfo_program_packets').insert({
                    task_id: task.id,
                    department: dept,
                    packet_state: 'draft',
                    chairperson_faculty_id: global.currentFaculty?.id || null,
                    notes: JSON.stringify(mergedNotes)
                }).select('id, current_version').single();

                if (insertErr) throw insertErr;

                if (insertedDraft?.id) {
                    try {
                        await client.from('mfo_snapshots').insert({
                            program_packet_id: insertedDraft.id,
                            version_no: 1,
                            lifecycle_state: 'draft',
                            snapshot_reason: 'Initial consolidated draft created',
                            payload: regenerated.frozenPayload,
                            created_by_faculty_id: global.currentFaculty?.id || null
                        });
                    } catch (snapErr) {
                        console.warn('[MFO Snapshot] Non-fatal snapshot log:', snapErr);
                    }
                }
            }

            toast('Consolidated MFO draft created successfully!', 'success');
            await loadAndRenderConsolidatedMfo(task.id);
        } catch (err) {
            console.error('[Create Consolidated Draft]', err);
            toast('Failed to create draft: ' + (err?.message || err), 'error');
        } finally {
            review.mfoDraftBusy = false;
            if (btn && origHtml) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    }

    async function regenerateMfoDraftModal(taskId) {
        if (review.mfoDraftBusy) return;
        review.mfoDraftBusy = true;
        try {
            await regenerateMfoDraft(taskId);
            await loadAndRenderConsolidatedMfo(taskId);
        } finally {
            review.mfoDraftBusy = false;
        }
    }

    async function acknowledgeMfoDraftModal(taskId) {
        if (review.mfoDraftBusy) return;
        review.mfoDraftBusy = true;
        try {
            await acknowledgeMfoDraft(taskId);
            await loadAndRenderConsolidatedMfo(taskId);
        } finally {
            review.mfoDraftBusy = false;
        }
    }

    async function toggleExclusionModal(taskId, accomplishmentId, explicitState) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Unauthorized for this department.', 'error');
            return;
        }

        const task = taskMap().get(String(taskId));
        if (!task) return;

        const client = db();
        let programPacket = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (_) {}
        }

        if (!programPacket) {
            toast('No consolidated draft found to update exclusion decision.', 'warn');
            return;
        }

        try {
            const updatedExclusions = engine.toggleAccomplishmentExclusion(
                programPacket.notes,
                accomplishmentId,
                explicitState
            );
            const isExcluded = updatedExclusions.has(String(accomplishmentId));

            if (client && programPacket.id) {
                const metaString = JSON.stringify(engine.mergeNotesMetadata(programPacket.notes, {
                    excluded_accomplishments: Array.from(updatedExclusions),
                    count: updatedExclusions.size
                }));

                const { error: updateErr } = await client.from('mfo_program_packets').update({
                    notes: metaString,
                    updated_at: new Date().toISOString()
                }).eq('id', programPacket.id);

                if (updateErr) throw updateErr;
            }

            toast(isExcluded ? 'Accomplishment excluded from consolidated report.' : 'Accomplishment included in consolidated report.', 'info');
            await loadAndRenderConsolidatedMfo(task.id);
        } catch (err) {
            console.error('[MFO Exclusion Toggle]', err);
            toast('Failed to update exclusion: ' + (err?.message || err), 'error');
        }
    }

    async function saveMfoDraftRemarks(taskId) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Unauthorized for this department.', 'error');
            return;
        }

        const task = taskMap().get(String(taskId));
        if (!task) return;

        const textarea = typeof document !== 'undefined' ? document.getElementById('chairMfoDraftRemarksInput') : null;
        const remarks = String(textarea?.value || '').trim();

        const client = db();
        let programPacket = null;
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (_) {}
        }

        if (!programPacket) {
            toast('No consolidated draft found to save remarks.', 'warn');
            return;
        }

        try {
            const merged = engine.mergeNotesMetadata(programPacket.notes, {
                user_remarks: remarks,
                remarks_updated_at: new Date().toISOString(),
                remarks_by: global.currentFaculty?.full_name || global.currentFaculty?.name || 'Chairperson'
            });

            if (client && programPacket.id) {
                const { error: updateErr } = await client.from('mfo_program_packets').update({
                    notes: JSON.stringify(merged),
                    updated_at: new Date().toISOString()
                }).eq('id', programPacket.id);
                if (updateErr) throw updateErr;
            }

            toast('Remarks saved to consolidated draft.', 'success');
            await loadAndRenderConsolidatedMfo(task.id);
        } catch (err) {
            console.error('[Save Remarks]', err);
            toast('Failed to save remarks: ' + (err?.message || err), 'error');
        }
    }

    async function openSubmitConsolidatedMfoModal(taskId) {
        if (typeof document === 'undefined') return;
        const task = taskMap().get(String(taskId));
        if (!task) {
            toast('Task not found.', 'error');
            return;
        }

        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) {
            toast('Consolidation engine not loaded.', 'error');
            return;
        }

        const dept = chairDepartment();
        const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
        if (!auth.authorized) {
            toast(auth.reason || 'Unauthorized to submit for this department.', 'error');
            return;
        }

        review.submittingConsolidatedMfoTaskId = task.id;

        const modal = document.getElementById('chairSubmitConsolidatedMfoModal');
        const summaryEl = document.getElementById('chairSubmitConsolidatedMfoSummary');
        if (!modal) return;

        let programPacket = null;
        const client = db();
        if (client) {
            try {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            } catch (e) {
                console.warn('[Submit MFO Modal] draft check error:', e);
            }
        }

        if (!programPacket) {
            toast('No consolidated draft exists yet. Please create and compile a draft first.', 'warn');
            return;
        }

        const currentState = String(programPacket.packet_state || 'draft').toLowerCase();
        if (currentState === 'submitted' || currentState === 'resubmitted') {
            toast(`Version ${programPacket.current_version || 1} has already been submitted to the Dean's Office and is awaiting review.`, 'info');
            return;
        }
        if (currentState === 'approved') {
            toast('This Department Consolidated MFO has already been approved by the Dean\'s Office.', 'info');
            return;
        }
        if (currentState === 'declined') {
            toast('This report was declined by the Dean\'s Office. Please click "Create Corrected Version" to prepare an editable draft before resubmitting.', 'warn');
            return;
        }

        let isCorrected = false;
        try {
            if (typeof programPacket.notes === 'string' && programPacket.notes.trim().startsWith('{')) {
                const parsed = JSON.parse(programPacket.notes);
                isCorrected = Boolean(parsed.corrected_from_version || parsed.citeflow_mfo_consolidation?.corrected_from_version);
            }
        } catch (_) {}

        const currentVer = Number(programPacket.current_version || 1);
        const isResubmit = currentState === 'revision' || (currentState === 'draft' && (isCorrected || currentVer > 1));
        const nextVer = currentState === 'revision' ? currentVer + 1 : currentVer;
        const nextAction = isResubmit ? 'Resubmitted to Dean\'s Office' : 'Submitted to Dean\'s Office';

        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Department:</span>
                        <strong class="text-slate-900">${esc(dept.toUpperCase())}</strong>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Reporting Cycle:</span>
                        <strong class="text-slate-900">${esc(task.title)}</strong>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Period:</span>
                        <strong class="text-slate-900">${esc(task.reporting_period_label || task.academic_year || 'Current Period')}</strong>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Current Status:</span>
                        <span class="font-semibold text-slate-800">${esc(programPacket.packet_state || 'draft')}</span>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Submitting As:</span>
                        <strong class="text-[#621708]">Version ${nextVer} (${nextAction})</strong>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500">Submitting Officer:</span>
                        <strong class="text-slate-900">${esc(global.currentFaculty?.full_name || global.currentFaculty?.name || 'Chairperson')}</strong>
                    </div>
                </div>
            `;
        }

        modal.classList.add('open');
    }

    function closeSubmitConsolidatedMfoModal() {
        if (typeof document === 'undefined') return;
        review.submittingConsolidatedMfoTaskId = null;
        document.getElementById('chairSubmitConsolidatedMfoModal')?.classList.remove('open');
    }

    async function confirmSubmitConsolidatedMfo() {
        const taskId = review.submittingConsolidatedMfoTaskId || review.activeConsolidatedMfoTaskId;
        if (!taskId) return;

        if (review.mfoSubmitBusy) return;
        review.mfoSubmitBusy = true;

        const btn = typeof document !== 'undefined' ? document.getElementById('chairConfirmSubmitConsolidatedMfoBtn') : null;
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Submitting to Dean...';
        }

        try {
            const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
            if (!engine) throw new Error('Consolidation engine not loaded.');

            const task = taskMap().get(String(taskId));
            if (!task) throw new Error('Task not found.');

            const dept = chairDepartment();
            const auth = engine.verifyChairpersonDepartmentAccess(global.currentFaculty, dept, effectiveGrants());
            if (!auth.authorized) {
                toast(auth.reason || 'Unauthorized for this department.', 'error');
                return;
            }

            const client = db();
            let programPacket = null;
            if (client) {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            }

            if (!programPacket) {
                toast('No consolidated draft found to submit.', 'error');
                return;
            }

            const currentState = String(programPacket.packet_state || 'draft').toLowerCase();
            if (currentState === 'declined') {
                toast('This report was declined by the Dean\'s Office. Please click "Create Corrected Version" to prepare an editable draft before resubmitting.', 'warn');
                return;
            }
            if (currentState === 'submitted' || currentState === 'resubmitted') {
                toast('This report is already submitted and pending review.', 'info');
                return;
            }
            if (currentState === 'approved') {
                toast('This report has already been approved.', 'info');
                return;
            }

            const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
            const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));
            const packetIds = taskPackets.map((p) => p.id).filter(Boolean);

            const childRows = {};
            if (client && packetIds.length > 0) {
                await Promise.all(engine.MFO_SECTIONS.map(async (sec) => {
                    try {
                        const res = await client.from(sec.table).select('*').in('packet_id', packetIds);
                        if (res?.data) childRows[sec.table] = res.data;
                    } catch (_) {}
                }));
            }

            const programRows = { pi1: [], pi2: [] };
            if (client && programPacket.id) {
                try {
                    const [pi1Res, pi2Res] = await Promise.all([
                        client.from('mfo_pi1_licensure').select('*').eq('program_packet_id', programPacket.id).order('sort_order'),
                        client.from('mfo_pi2_employment').select('*').eq('program_packet_id', programPacket.id).order('sort_order')
                    ]);
                    if (pi1Res?.data) programRows.pi1 = pi1Res.data;
                    if (pi2Res?.data) programRows.pi2 = pi2Res.data;
                } catch (_) {}
            }

            const customizations = review.activeConsolidatedCustomizations || engine.extractManualCustomizations(programPacket?.notes || programPacket);

            const consolidation = engine.buildDepartmentMfoConsolidation({
                taskId: task.id,
                department: dept,
                draft: programPacket,
                submissions: taskSubmissions,
                packets: taskPackets,
                childRows,
                programRows,
                customizations,
                facultyList: review.faculty || [],
                assignments: (scopedAssignments()).filter((a) => String(a.task_id) === String(task.id)),
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants()
            });

            const prep = engine.prepareConsolidatedMfoSubmission({
                taskId: task.id,
                department: dept,
                draft: programPacket,
                consolidation,
                customizations,
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants(),
                userRemarks: typeof document !== 'undefined' ? (document.getElementById('chairMfoDraftRemarksInput')?.value || '') : ''
            });

            if (!prep.ok) {
                toast(prep.error || 'Failed to prepare submission.', 'error');
                return;
            }

            const result = await engine.submitConsolidatedMfoToDean({
                db: client,
                draft: programPacket,
                taskId: task.id,
                department: dept,
                actorFaculty: global.currentFaculty,
                delegatedAccess: effectiveGrants(),
                consolidation,
                customizations,
                userRemarks: prep.frozenPayload.user_remarks
            });

            if (!result.ok) {
                toast(result.error || 'Submission failed.', 'error');
                return;
            }

            const isResubmit = currentState === 'revision' || (currentState === 'draft' && Boolean(prep.frozenPayload?.notes_metadata?.corrected_from_version || Number(programPacket.current_version) > 1));
            review.activeConsolidatedHasUnsavedChanges = false;
            toast(isResubmit ? 'Department Consolidated MFO resubmitted to Dean\'s Office successfully!' : 'Department Consolidated MFO submitted to Dean\'s Office successfully!', 'success');
            closeSubmitConsolidatedMfoModal();
            await loadAndRenderConsolidatedMfo(task.id);
            if (typeof render === 'function') render();
        } catch (err) {
            console.error('[Submit Consolidated MFO]', err);
            toast('Submission error: ' + (err?.message || err), 'error');
        } finally {
            review.mfoSubmitBusy = false;
            if (btn && origHtml) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Manual Content Editing, Additions, Removals & Review Methods       */
    /* ------------------------------------------------------------------ */

    function rerenderConsolidatedMfoInPlace() {
        const taskId = review.activeConsolidatedMfoTaskId;
        if (!taskId) return;
        const task = taskMap().get(String(taskId));
        if (!task) return;
        const dept = chairDepartment();
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));

        const consolidation = engine.buildDepartmentMfoConsolidation({
            taskId: task.id,
            department: dept,
            draft: review.activeConsolidatedDraft,
            submissions: taskSubmissions,
            packets: taskPackets,
            childRows: review.activeConsolidatedChildRows || {},
            programRows: review.activeConsolidatedProgramRows || { pi1: [], pi2: [] },
            customizations: review.activeConsolidatedCustomizations,
            facultyList: review.faculty || [],
            assignments: (scopedAssignments()).filter((a) => String(a.task_id) === String(task.id)),
            actorFaculty: global.currentFaculty,
            delegatedAccess: effectiveGrants()
        });

        review.activeConsolidatedModel = consolidation;

        renderConsolidatedMfoModalView({
            task,
            draft: review.activeConsolidatedDraft,
            consolidation,
            staleness: review.activeConsolidatedStaleness || { status: 'fresh' },
            dept
        });
        try { populateOfficialSectionDropdowns(); } catch (_) {}
    }

    const OFFICIAL_CONSOLIDATED_SECTIONS = [
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1A', title: 'Licensure Passing Percentage', table: 'mfo_pi1_licensure' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1B', title: 'Graduate Employment (2 years prior)', table: 'mfo_pi2_employment' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1C', title: 'Syllabus Submission', table: 'mfo_pi4_syllabus' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1D', title: 'Certifications (TESDA, ISO, AACCUP, etc.)', table: 'mfo_pi5_certifications' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1E', title: 'Postgraduate Education', table: 'mfo_pi6_postgraduate' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1F', title: 'Accreditation & QA', table: 'mfo_accreditation_qa' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1G', title: 'Trainings / Workshops / Seminars Attended', table: 'mfo_pi7_trainings' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1H', title: 'Instructional Materials Production', table: 'mfo_pi8_instructional_materials' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1I', title: 'Awards & Recognitions / Competitions', table: 'mfo_awards' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1J', title: 'Other Academic Initiatives & Activities', table: 'mfo_other_initiatives' },
        { group: 'MFO 1: Advanced and Higher Education Services', code: 'MFO 1K', title: 'Student Enrollment & Advisory (Thesis / Capstone)', table: 'mfo_pi3_enrollment' },
        { group: 'MFO 2: Research and Development Services', code: 'MFO 2A', title: 'Research Output Utilized by Industry / Beneficiaries', table: 'mfo_research_utilized' },
        { group: 'MFO 2: Research and Development Services', code: 'MFO 2B', title: 'Research Output Completed / Published in Journals', table: 'mfo_research_published' },
        { group: 'MFO 2: Research and Development Services', code: 'MFO 2C', title: 'Research Output Presented in Conferences', table: 'mfo_research_presented' },
        { group: 'MFO 3: Extension Services', code: 'MFO 3A', title: 'Active Extension Partnerships (LGUs, Industry, NGOs)', table: 'mfo_extension_partnerships' },
        { group: 'MFO 3: Extension Services', code: 'MFO 3B', title: 'Extension Trainees & Manhours', table: 'mfo_extension_trainings' },
        { group: 'Production', code: 'Production', title: 'Income-Generating & Production Activities', table: 'mfo_production' },
        { group: 'MFO 4: General Administration and Support Services', code: 'MFO 4A', title: 'General Administration & Operational Initiatives', table: 'mfo_admin_initiatives' },
        { group: 'MFO 4: General Administration and Support Services', code: 'MFO 4B', title: 'Support Services Accomplishments', table: 'mfo_support_services' },
        { group: 'MFO 5: Management of Resources', code: 'MFO 5', title: 'Management of Resources, Equipment & Facilities', table: 'mfo_resource_management' },
        { group: 'Supporting Evidence & Gallery', code: 'GALLERY', title: 'Verifiable Evidence / Supporting Documents', table: 'mfo_documentation_items' }
    ];

    function getOfficialMfoSections() {
        return OFFICIAL_CONSOLIDATED_SECTIONS.slice();
    }

    function populateOfficialSectionDropdowns(selectedTable = null) {
        if (typeof document === 'undefined') return;
        const addSelect = document.getElementById('chairAddSectionSelect') || document.getElementById('chairAddTable');
        const editSelect = document.getElementById('chairEditSectionSelect') || document.getElementById('chairEditTableSelect');

        let sections = [];
        try {
            sections = getOfficialMfoSections();
        } catch (e) {
            console.error('[Consolidated MFO] Failed to retrieve official sections:', e);
            sections = [];
        }

        if (!Array.isArray(sections) || !sections.length) {
            const emptyOption = '<option value="" disabled selected>No official MFO sections available</option>';
            if (addSelect && addSelect.tagName === 'SELECT') addSelect.innerHTML = emptyOption;
            if (editSelect && editSelect.tagName === 'SELECT') editSelect.innerHTML = emptyOption;
            toast('Failed to load official MFO sections. Please refresh the page.', 'error');
            return;
        }

        const groups = {};
        sections.forEach((sec) => {
            const grp = sec.group || 'Official MFO Sections';
            if (!groups[grp]) groups[grp] = [];
            groups[grp].push(sec);
        });

        let optgroupsHtml = '';
        Object.keys(groups).forEach((grp) => {
            optgroupsHtml += `<optgroup label="${esc(grp)}">`;
            groups[grp].forEach((sec) => {
                const label = sec.code ? `${sec.code} — ${sec.title}` : sec.title;
                optgroupsHtml += `<option value="${esc(sec.table)}">${esc(label)}</option>`;
            });
            optgroupsHtml += '</optgroup>';
        });

        if (addSelect && addSelect.tagName === 'SELECT') {
            addSelect.innerHTML = '<option value="" disabled selected>Select Target Official MFO Section...</option>' + optgroupsHtml;
            if (selectedTable) addSelect.value = selectedTable;
        }
        if (editSelect && editSelect.tagName === 'SELECT') {
            editSelect.innerHTML = optgroupsHtml;
            if (selectedTable) editSelect.value = selectedTable;
        }
    }

    function isConsolidatedReportLocked() {
        const pState = String(review.activeConsolidatedDraft?.packet_state || 'draft').toLowerCase();
        return ['submitted', 'resubmitted', 'approved', 'declined'].includes(pState);
    }

    function checkConsolidatedReportLockedToast(actionDesc = 'modify accomplishments') {
        if (!isConsolidatedReportLocked()) return false;
        const pState = String(review.activeConsolidatedDraft?.packet_state || 'draft').toLowerCase();
        if (pState === 'declined') {
            toast(`Cannot ${actionDesc} while report is declined. Please click "Create Corrected Version" first.`, 'warn');
        } else if (pState === 'approved') {
            toast(`Cannot ${actionDesc} on an approved report (immutable record).`, 'warn');
        } else {
            toast(`Cannot ${actionDesc} while report is submitted to the Dean's Office (pending review).`, 'warn');
        }
        return true;
    }

    function openEditAccomplishmentModal(table, rowId) {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('edit accomplishments')) return;
        const consolidation = review.activeConsolidatedModel;
        if (!consolidation) return;
        const items = consolidation.sections?.[table] || [];
        const item = items.find((i) => (i.id != null && String(i.id) === String(rowId)) || (i._source?.sourceRowId && String(i._source.sourceRowId) === String(rowId)));
        if (!item) {
            toast('Accomplishment not found.', 'error');
            return;
        }

        const modal = document.getElementById('chairEditAccomplishmentModal');
        if (!modal) return;

        populateOfficialSectionDropdowns(table);

        const tableInp = document.getElementById('chairEditTable');
        const secSelect = document.getElementById('chairEditSectionSelect');
        const rowIdInp = document.getElementById('chairEditRowId');
        const titleInp = document.getElementById('chairEditTitle');
        const descInp = document.getElementById('chairEditDescription') || document.getElementById('chairEditDesc');
        const startInp = document.getElementById('chairEditStartDate');
        const endInp = document.getElementById('chairEditEndDate');
        const venueInp = document.getElementById('chairEditVenue');
        const remarksInp = document.getElementById('chairEditRemarks');
        const subEl = document.getElementById('chairEditModalSubtitle');

        if (tableInp) tableInp.value = table;
        if (secSelect) secSelect.value = table;
        if (rowIdInp) rowIdInp.value = rowId;

        const title = item.title || item.activity_title || item.program_title || item.subject_code || item.course_title || item.award_name || item.name || '';
        const desc = item.description || item.details || '';
        const startDate = item.start_date || item.date || item.publication_date || item.exam_date || '';
        const endDate = item.end_date || '';
        const venue = item.venue || item.location || item.institution || item.journal_name || '';
        const remarks = item.remarks || item.actions_taken || item.ched_strategies || '';

        if (titleInp) titleInp.value = title;
        if (descInp) descInp.value = desc;
        if (startInp) startInp.value = startDate;
        if (endInp) endInp.value = endDate;
        if (venueInp) venueInp.value = venue;
        if (remarksInp) remarksInp.value = remarks;

        if (subEl) {
            subEl.textContent = `Editing: ${title || 'Accomplishment'} · Contributing Faculty: ${item.contributing_faculty_name || 'Chairperson Addition'}`;
        }

        modal.classList.add('open');
    }

    function closeEditAccomplishmentModal() {
        if (typeof document === 'undefined') return;
        document.getElementById('chairEditAccomplishmentModal')?.classList.remove('open');
    }

    function saveEditAccomplishment() {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('edit accomplishments')) return;
        const originalTable = document.getElementById('chairEditTable')?.value;
        const targetTable = document.getElementById('chairEditSectionSelect')?.value || originalTable;
        const rowId = document.getElementById('chairEditRowId')?.value;
        const title = document.getElementById('chairEditTitle')?.value?.trim();
        const desc = (document.getElementById('chairEditDescription') || document.getElementById('chairEditDesc'))?.value?.trim();
        const startDate = document.getElementById('chairEditStartDate')?.value?.trim();
        const endDate = document.getElementById('chairEditEndDate')?.value?.trim();
        const venue = document.getElementById('chairEditVenue')?.value?.trim();
        const remarks = document.getElementById('chairEditRemarks')?.value?.trim();

        if (!rowId || !originalTable) return;

        if (!review.activeConsolidatedCustomizations) {
            review.activeConsolidatedCustomizations = {
                manual_overrides: {},
                manual_additions: {},
                manual_removals: {},
                source_snapshots: {},
                program_portion_overrides: {}
            };
        }

        const isAddition = String(rowId).startsWith('added_');
        if (isAddition) {
            const list = review.activeConsolidatedCustomizations.manual_additions[originalTable] || [];
            const idx = list.findIndex((a) => String(a.id) === String(rowId));
            if (idx >= 0) {
                const item = list[idx];
                item.title = title;
                item.description = desc;
                item.start_date = startDate;
                item.end_date = endDate;
                item.venue = venue;
                item.remarks = remarks;
                item.updated_at = new Date().toISOString();

                // If target section changed, move to new section
                if (targetTable && targetTable !== originalTable) {
                    list.splice(idx, 1);
                    item.table = targetTable;
                    if (!Array.isArray(review.activeConsolidatedCustomizations.manual_additions[targetTable])) {
                        review.activeConsolidatedCustomizations.manual_additions[targetTable] = [];
                    }
                    review.activeConsolidatedCustomizations.manual_additions[targetTable].push(item);
                }
            }
        } else {
            review.activeConsolidatedCustomizations.manual_overrides[rowId] = {
                title,
                description: desc,
                start_date: startDate,
                end_date: endDate,
                venue,
                remarks,
                _targetTable: targetTable && targetTable !== originalTable ? targetTable : undefined,
                edited_at: new Date().toISOString()
            };
        }

        review.activeConsolidatedHasUnsavedChanges = true;
        closeEditAccomplishmentModal();
        rerenderConsolidatedMfoInPlace();
        toast('Accomplishment updated (draft edit). Click "Save Draft" to persist.', 'info');
    }

    function openAddAccomplishmentModal() {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('add accomplishments')) return;
        const modal = document.getElementById('chairAddAccomplishmentModal');
        if (!modal) return;

        populateOfficialSectionDropdowns();

        const titleInp = document.getElementById('chairAddTitle');
        const descInp = document.getElementById('chairAddDescription') || document.getElementById('chairAddDesc');
        const startInp = document.getElementById('chairAddStartDate');
        const endInp = document.getElementById('chairAddEndDate');
        const venueInp = document.getElementById('chairAddVenue');
        const remarksInp = document.getElementById('chairAddRemarks');

        if (titleInp) titleInp.value = '';
        if (descInp) descInp.value = '';
        if (startInp) startInp.value = '';
        if (endInp) endInp.value = '';
        if (venueInp) venueInp.value = '';
        if (remarksInp) remarksInp.value = '';

        modal.classList.add('open');
    }

    function closeAddAccomplishmentModal() {
        if (typeof document === 'undefined') return;
        document.getElementById('chairAddAccomplishmentModal')?.classList.remove('open');
    }

    function saveAddAccomplishment() {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('add accomplishments')) return;
        const table = document.getElementById('chairAddSectionSelect')?.value || document.getElementById('chairAddTable')?.value;
        const title = document.getElementById('chairAddTitle')?.value?.trim();
        const desc = (document.getElementById('chairAddDescription') || document.getElementById('chairAddDesc'))?.value?.trim();
        const startDate = document.getElementById('chairAddStartDate')?.value?.trim();
        const endDate = document.getElementById('chairAddEndDate')?.value?.trim();
        const venue = document.getElementById('chairAddVenue')?.value?.trim();
        const remarks = document.getElementById('chairAddRemarks')?.value?.trim();

        if (!table) {
            toast('Please select an official MFO section.', 'error');
            return;
        }
        if (!title) {
            toast('Please enter a title for the accomplishment.', 'error');
            return;
        }

        if (!review.activeConsolidatedCustomizations) {
            review.activeConsolidatedCustomizations = {
                manual_overrides: {},
                manual_additions: {},
                manual_removals: {},
                source_snapshots: {},
                program_portion_overrides: {}
            };
        }
        if (!review.activeConsolidatedCustomizations.manual_additions) {
            review.activeConsolidatedCustomizations.manual_additions = {};
        }
        if (!Array.isArray(review.activeConsolidatedCustomizations.manual_additions[table])) {
            review.activeConsolidatedCustomizations.manual_additions[table] = [];
        }

        const newId = `added_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        review.activeConsolidatedCustomizations.manual_additions[table].push({
            id: newId,
            table,
            title,
            description: desc,
            start_date: startDate,
            end_date: endDate,
            venue,
            remarks,
            contributing_faculty_name: global.currentFaculty?.full_name || 'Chairperson Addition',
            contributing_status_label: 'Added by Chairperson',
            created_at: new Date().toISOString()
        });

        review.activeConsolidatedHasUnsavedChanges = true;
        closeAddAccomplishmentModal();
        rerenderConsolidatedMfoInPlace();
        toast('New entry added to section. Click "Save Draft" to persist.', 'info');
    }

    function removeConsolidatedAccomplishment(table, rowId) {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('remove accomplishments')) return;
        review.pendingRemoveTarget = { table, rowId };

        const consolidation = review.activeConsolidatedModel;
        const items = consolidation?.sections?.[table] || [];
        const item = items.find((i) => (i.id != null && String(i.id) === String(rowId)) || (i._source?.sourceRowId && String(i._source.sourceRowId) === String(rowId)));
        const title = item?.title || item?.activity_title || item?.name || 'this accomplishment';

        const modal = document.getElementById('chairRemoveAccomplishmentModal');
        const titleEl = document.getElementById('chairRemoveItemTitle');
        if (titleEl) titleEl.textContent = title;
        modal?.classList.add('open');
    }

    function closeRemoveAccomplishmentModal() {
        if (typeof document === 'undefined') return;
        review.pendingRemoveTarget = null;
        document.getElementById('chairRemoveAccomplishmentModal')?.classList.remove('open');
    }

    function confirmRemoveAccomplishment() {
        if (checkConsolidatedReportLockedToast('remove accomplishments')) return;
        const target = review.pendingRemoveTarget;
        if (!target) return;
        const { table, rowId } = target;

        if (!review.activeConsolidatedCustomizations) {
            review.activeConsolidatedCustomizations = {
                manual_overrides: {},
                manual_additions: {},
                manual_removals: {},
                source_snapshots: {},
                program_portion_overrides: {}
            };
        }
        if (!review.activeConsolidatedCustomizations.manual_removals) {
            review.activeConsolidatedCustomizations.manual_removals = {};
        }

        const isAddition = String(rowId).startsWith('added_');
        if (isAddition) {
            const list = review.activeConsolidatedCustomizations.manual_additions[table] || [];
            review.activeConsolidatedCustomizations.manual_additions[table] = list.filter((a) => String(a.id) !== String(rowId));
        } else {
            review.activeConsolidatedCustomizations.manual_removals[rowId] = {
                removed_at: new Date().toISOString(),
                reason: 'Removed by Chairperson'
            };
        }

        review.activeConsolidatedHasUnsavedChanges = true;
        closeRemoveAccomplishmentModal();
        rerenderConsolidatedMfoInPlace();
        toast('Accomplishment removed from consolidated report. (Section structure remains intact).', 'info');
    }

    function restoreConsolidatedAccomplishment(table, rowId) {
        if (checkConsolidatedReportLockedToast('restore accomplishments')) return;
        if (!review.activeConsolidatedCustomizations?.manual_removals) return;
        delete review.activeConsolidatedCustomizations.manual_removals[rowId];
        review.activeConsolidatedHasUnsavedChanges = true;
        rerenderConsolidatedMfoInPlace();
        toast('Accomplishment restored to consolidated report.', 'info');
    }

    function setConsolidatedFilter(filter) {
        review.activeConsolidatedFilter = filter;
        rerenderConsolidatedMfoInPlace();
    }

    function setConsolidatedSearch(search) {
        review.activeConsolidatedSearch = search;
        rerenderConsolidatedMfoInPlace();
    }

    function openSourceUpdatesModal() {
        if (typeof document === 'undefined') return;
        const modal = document.getElementById('chairSourceUpdatesModal');
        const listEl = document.getElementById('chairSourceUpdatesList');
        if (!modal || !listEl) return;

        const staleness = review.activeConsolidatedStaleness;
        const updates = staleness?.sourceUpdates;
        if (!updates || !updates.hasUpdates || !updates.updatedRows.length) {
            toast('No pending source updates to review.', 'info');
            return;
        }

        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        const secMap = new Map((engine?.MFO_SECTIONS || []).map((s) => [s.table, s]));

        listEl.innerHTML = updates.updatedRows.map((row) => {
            const secDef = secMap.get(row.table);
            const secLabel = secDef ? `${secDef.group} — ${secDef.title}` : row.table;
            const diffs = row.diffs || {};
            const chairOverride = (review.activeConsolidatedCustomizations?.manual_overrides || {})[row.rowId];

            return `
                <div class="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">${esc(secLabel)}</span>
                            <span class="font-bold text-slate-900 text-xs">${esc(row.title || 'Accomplishment')}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button type="button" class="chair-btn-secondary text-xs py-1 px-2.5" onclick="CiteFlowChairReview.declineSourceUpdate('${row.table}', '${row.rowId}')" title="Keep Chairperson's version">
                                <i class="fa-solid fa-xmark mr-1"></i> Decline Update
                            </button>
                            <button type="button" class="chair-btn-primary text-xs py-1 px-2.5" onclick="CiteFlowChairReview.acceptSourceUpdate('${row.table}', '${row.rowId}')" title="Accept new faculty values">
                                <i class="fa-solid fa-check mr-1"></i> Accept Update
                            </button>
                        </div>
                    </div>

                    ${chairOverride ? `
                        <div class="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-1.5">
                            <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
                            <span>You have already manually edited this item. Accepting will update the baseline; declining preserves your manual edits.</span>
                        </div>
                    ` : ''}

                    <div class="divide-y divide-slate-100 text-xs">
                        ${Object.keys(diffs).map((fieldKey) => {
                            const diff = diffs[fieldKey];
                            return `
                                <div class="py-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div>
                                        <span class="text-[10px] uppercase font-bold text-slate-400 block">${esc(diff.label || fieldKey)}</span>
                                    </div>
                                    <div class="p-2 rounded bg-slate-50 border border-slate-200">
                                        <span class="text-[10px] uppercase font-bold text-slate-400 block">Baseline Value</span>
                                        <span class="text-slate-600 text-[11px]">${esc(diff.previousValue || '(empty)')}</span>
                                    </div>
                                    <div class="p-2 rounded bg-blue-50 border border-blue-200">
                                        <span class="text-[10px] uppercase font-bold text-blue-600 block">Updated by Faculty</span>
                                        <span class="text-blue-900 text-[11px] font-semibold">${esc(diff.currentFacultyValue || '(empty)')}</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');

        modal.classList.add('open');
    }

    function closeSourceUpdatesModal() {
        if (typeof document === 'undefined') return;
        document.getElementById('chairSourceUpdatesModal')?.classList.remove('open');
    }

    function acceptSourceUpdate(table, rowId) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const diffItem = review.activeConsolidatedStaleness?.sourceUpdates?.updatedRows?.find((r) => String(r.rowId) === String(rowId));
        if (!diffItem) return;

        engine.applySourceUpdateDecision({
            customizations: review.activeConsolidatedCustomizations,
            diffItem,
            decision: 'accept'
        });

        review.activeConsolidatedHasUnsavedChanges = true;
        toast(`Accepted faculty update for "${diffItem.title || 'Accomplishment'}".`, 'info');

        refreshStalenessAfterDecision();
    }

    function declineSourceUpdate(table, rowId) {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const diffItem = review.activeConsolidatedStaleness?.sourceUpdates?.updatedRows?.find((r) => String(r.rowId) === String(rowId));
        if (!diffItem) return;

        engine.applySourceUpdateDecision({
            customizations: review.activeConsolidatedCustomizations,
            diffItem,
            decision: 'decline'
        });

        review.activeConsolidatedHasUnsavedChanges = true;
        toast(`Declined update for "${diffItem.title || 'Accomplishment'}". Current report copy preserved.`, 'info');

        refreshStalenessAfterDecision();
    }

    function acceptAllSourceUpdates() {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const rows = review.activeConsolidatedStaleness?.sourceUpdates?.updatedRows || [];
        rows.forEach((diffItem) => {
            engine.applySourceUpdateDecision({
                customizations: review.activeConsolidatedCustomizations,
                diffItem,
                decision: 'accept'
            });
        });

        review.activeConsolidatedHasUnsavedChanges = true;
        toast(`Accepted all ${rows.length} faculty updates.`, 'info');
        closeSourceUpdatesModal();
        refreshStalenessAfterDecision();
    }

    function refreshStalenessAfterDecision() {
        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        const task = taskMap().get(String(review.activeConsolidatedMfoTaskId));
        if (!task || !engine) return;
        const dept = chairDepartment();
        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskPackets = (review.mfoPackets || []).filter((p) => String(p.task_id) === String(task.id));

        const staleness = engine.detectConsolidatedDraftStaleness({
            taskId: task.id,
            department: dept,
            draft: review.activeConsolidatedDraft,
            submissions: taskSubmissions,
            packets: taskPackets,
            childRows: review.activeConsolidatedChildRows || {},
            sourceSnapshots: review.activeConsolidatedCustomizations?.source_snapshots,
            facultyList: review.faculty || [],
            actorFaculty: global.currentFaculty,
            delegatedAccess: effectiveGrants()
        });

        review.activeConsolidatedStaleness = staleness;
        if (!staleness.sourceUpdates?.hasUpdates) {
            closeSourceUpdatesModal();
        } else {
            openSourceUpdatesModal();
        }
        rerenderConsolidatedMfoInPlace();
    }

    function openEditProgramPortionModal(type, index) {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('edit program metrics')) return;
        const modal = document.getElementById('chairEditProgramPortionModal');
        if (!modal) return;

        const idx = Number(index) || 0;
        const typeInp = document.getElementById('chairProgramPortionType');
        const indexInp = document.getElementById('chairProgramPortionIndex');
        if (typeInp) typeInp.value = type;
        if (indexInp) indexInp.value = String(idx);

        const isPi1 = type === 'pi1';
        const titleEl = document.getElementById('chairEditProgramModalTitle');
        if (titleEl) {
            titleEl.textContent = isPi1
                ? 'Edit PI1 — Licensure Examination Results'
                : 'Edit PI2 — Graduate Employment Tracking';
        }

        const pi1Fields = document.getElementById('chairPi1Fields');
        const pi2Fields = document.getElementById('chairPi2Fields');
        if (pi1Fields) pi1Fields.style.display = isPi1 ? 'block' : 'none';
        if (pi2Fields) pi2Fields.style.display = isPi1 ? 'none' : 'block';

        const row = review.activeConsolidatedModel?.programPortion?.[type]?.[idx] || {};

        if (isPi1) {
            const exName = document.getElementById('chairPi1ExamName');
            const exDate = document.getElementById('chairPi1ExamDate');
            const exTakers = document.getElementById('chairPi1Takers');
            const exPassers = document.getElementById('chairPi1Passers');
            const exRate = document.getElementById('chairPi1PassingRate');

            if (exName) exName.value = row.exam_name || '';
            if (exDate) exDate.value = row.exam_date || '';
            if (exTakers) exTakers.value = row.total_takers != null ? row.total_takers : '';
            if (exPassers) exPassers.value = row.total_passers != null ? row.total_passers : '';
            if (exRate) exRate.value = row.passing_rate != null ? row.passing_rate : '';
        } else {
            const cohort = document.getElementById('chairPi2Cohort');
            const grads = document.getElementById('chairPi2Graduates');
            const emp = document.getElementById('chairPi2Employed');
            const empPct = document.getElementById('chairPi2EmployedPct');

            if (cohort) cohort.value = row.cohort_label || '';
            if (grads) grads.value = row.total_graduates != null ? row.total_graduates : '';
            if (emp) emp.value = row.employed_graduates != null ? row.employed_graduates : '';
            if (empPct) empPct.value = row.employed_percentage != null ? row.employed_percentage : '';
        }

        modal.classList.add('open');
    }

    function closeEditProgramPortionModal() {
        if (typeof document === 'undefined') return;
        document.getElementById('chairEditProgramPortionModal')?.classList.remove('open');
    }

    function saveEditProgramPortion() {
        if (typeof document === 'undefined') return;
        if (checkConsolidatedReportLockedToast('save program metrics')) return;
        const type = document.getElementById('chairProgramPortionType')?.value || 'pi1';
        const idx = Number(document.getElementById('chairProgramPortionIndex')?.value) || 0;

        if (!review.activeConsolidatedCustomizations) {
            review.activeConsolidatedCustomizations = {
                manual_overrides: {},
                manual_additions: {},
                manual_removals: {},
                source_snapshots: {},
                program_portion_overrides: {}
            };
        }
        if (!review.activeConsolidatedCustomizations.program_portion_overrides) {
            review.activeConsolidatedCustomizations.program_portion_overrides = {};
        }
        if (!Array.isArray(review.activeConsolidatedCustomizations.program_portion_overrides[type])) {
            review.activeConsolidatedCustomizations.program_portion_overrides[type] = [];
        }

        const isPi1 = type === 'pi1';
        const override = isPi1 ? {
            exam_name: document.getElementById('chairPi1ExamName')?.value?.trim(),
            exam_date: document.getElementById('chairPi1ExamDate')?.value?.trim(),
            total_takers: Number(document.getElementById('chairPi1Takers')?.value) || 0,
            total_passers: Number(document.getElementById('chairPi1Passers')?.value) || 0,
            passing_rate: Number(document.getElementById('chairPi1PassingRate')?.value) || 0
        } : {
            cohort_label: document.getElementById('chairPi2Cohort')?.value?.trim(),
            total_graduates: Number(document.getElementById('chairPi2Graduates')?.value) || 0,
            employed_graduates: Number(document.getElementById('chairPi2Employed')?.value) || 0,
            employed_percentage: Number(document.getElementById('chairPi2EmployedPct')?.value) || 0
        };

        review.activeConsolidatedCustomizations.program_portion_overrides[type][idx] = override;
        review.activeConsolidatedHasUnsavedChanges = true;
        closeEditProgramPortionModal();
        rerenderConsolidatedMfoInPlace();
        toast('Program portion metrics updated. Click "Save Draft" to persist.', 'info');
    }

    async function saveConsolidatedMfoEdits() {
        if (checkConsolidatedReportLockedToast('save draft edits')) return;
        const taskId = review.activeConsolidatedMfoTaskId;
        if (!taskId) return;
        const task = taskMap().get(String(taskId));
        if (!task) return;

        const engine = global.CiteFlowMfoConsolidation || (typeof require !== 'undefined' ? require('../shared/mfo-consolidation.js') : null);
        if (!engine) return;

        const dept = chairDepartment();
        const client = db();

        try {
            let programPacket = review.activeConsolidatedDraft;
            if (client && (!programPacket || !programPacket.id)) {
                const res = await client.from('mfo_program_packets')
                    .select('*')
                    .eq('task_id', task.id)
                    .ilike('department', dept)
                    .maybeSingle();
                if (res?.data) programPacket = res.data;
            }

            if (!programPacket) {
                toast('No consolidated draft exists to save edits. Please create a draft first.', 'warn');
                return;
            }

            const formattedCustomizations = engine.formatManualCustomizations(review.activeConsolidatedCustomizations);
            const mergedNotes = engine.mergeNotesMetadata(programPacket.notes, formattedCustomizations);

            if (client && programPacket.id) {
                const { error: updateErr } = await client.from('mfo_program_packets').update({
                    notes: JSON.stringify(mergedNotes),
                    updated_at: new Date().toISOString()
                }).eq('id', programPacket.id);
                if (updateErr) throw updateErr;

                // Also record a draft snapshot for auditability
                const consolidation = review.activeConsolidatedModel;
                if (consolidation?.frozenPayload) {
                    try {
                        await client.from('mfo_snapshots').insert({
                            program_packet_id: programPacket.id,
                            version_no: programPacket.current_version || 1,
                            lifecycle_state: 'draft',
                            snapshot_reason: 'Draft manual edits saved by Chairperson',
                            payload: consolidation.frozenPayload,
                            created_by_faculty_id: global.currentFaculty?.id || null
                        });
                    } catch (snapErr) {
                        console.warn('[Save Edits Snapshot]', snapErr);
                    }
                }
            } else {
                programPacket.notes = JSON.stringify(mergedNotes);
            }

            review.activeConsolidatedHasUnsavedChanges = false;
            toast('Consolidated report draft and manual edits saved successfully!', 'success');
            await loadAndRenderConsolidatedMfo(task.id);
        } catch (err) {
            console.error('[Save Consolidated Edits]', err);
            toast('Failed to save consolidated edits: ' + (err?.message || err), 'error');
        }
    }

    function openTaskDetails(taskId) {
        const task = taskMap().get(String(taskId));
        const modal = document.getElementById('chairTaskDetailModal');
        const titleEl = document.getElementById('chairTaskDetailTitle');
        const subEl = document.getElementById('chairTaskDetailSubtitle');
        const catEl = document.getElementById('chairTaskDetailCategory');
        const freqEl = document.getElementById('chairTaskDetailFrequency');
        const bodyEl = document.getElementById('chairTaskDetailBody');
        if (!task || !modal) return;

        review.activeTaskDetailsId = task.id;
        const config = task.report_config_id ? configMap().get(String(task.report_config_id)) : null;
        const isMfo = submissionIsMfo({ task, config });
        const freq = wf()?.resolveReportingFrequency ? wf().resolveReportingFrequency(task, config) : (task.frequency || 'Monthly');
        const deadline = formatDeadlineRelative(task.deadline_at || task.due_at);

        if (titleEl) titleEl.textContent = task.title || 'Task Details';
        if (subEl) subEl.textContent = `${chairDepartmentDisplay()} Department · ${task.reporting_period_label || task.academic_year || 'Current Period'}`;
        if (catEl) catEl.textContent = isMfo ? 'Major Final Output (MFO)' : 'Task Workflow';
        if (freqEl) freqEl.textContent = String(freq).toUpperCase();

        const helper = wf();
        const taskAssignments = (scopedAssignments()).filter((a) => String(a.task_id) === String(task.id));
        const taskSubmissions = (scopedSubmissions()).filter((s) => String(s.task_id) === String(task.id));
        const taskAnalytics = helper?.computeSubmissionAnalytics
            ? helper.computeSubmissionAnalytics(taskAssignments, taskSubmissions, task, {
                reportConfigs: review.configs || [],
                mfoPackets: review.mfoPackets || [],
                authorizedDepartments: authorizedDepartmentCodes()
            })
            : null;

        const counts = taskAnalytics?.counts || {
            expected: taskAssignments.length,
            submitted: taskSubmissions.length,
            not_submitted: Math.max(0, taskAssignments.length - taskSubmissions.length),
            not_submitted_open: 0,
            not_submitted_overdue: 0,
            pending_review: 0,
            needs_revision: 0,
            approved: 0,
            rejected: 0
        };

        const progressPercent = counts.expected > 0 ? Math.round((counts.submitted / counts.expected) * 100) : 0;

        const people = facultyMap();
        const facultyRows = taskAssignments.map((a) => {
            const person = people.get(String(a.faculty_id));
            const sub = taskSubmissions.find((s) => String(s.faculty_id) === String(a.faculty_id));
            const classification = taskAnalytics?.assignedRecords?.find((r) => String(r.faculty_id) === String(a.faculty_id))?.classification;

            const name = esc(person?.full_name || person?.name || 'Faculty Member');
            const dept = esc((person?.department || person?.department_code || chairDepartment()).toUpperCase());
            const statusKey = classification?.status_key || (sub ? sub.status : 'not_submitted');
            const statusLabel = classification?.status_label || (sub ? 'Submitted' : 'Not Submitted');
            const pill = renderStatusPill(statusKey, statusLabel);

            return `
                <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                    <div>
                        <div class="font-semibold text-slate-900">${name}</div>
                        <div class="text-xs text-slate-500">${dept}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${pill}
                        ${sub ? `<button type="button" class="file-manage-btn" onclick="CiteFlowChairReview.closeTaskDetails(); CiteFlowChairReview.openView('${sub.id}')">View</button>` : ''}
                    </div>
                </div>
            `;
        }).join('') || '<p class="text-xs text-slate-400 p-3">No departmental faculty assigned to this task.</p>';

        if (bodyEl) {
            bodyEl.innerHTML = `
                <!-- MFO Consolidated Action Card -->
                ${isMfo ? `
                    <div class="p-3.5 rounded-xl bg-[#fff0eb] border border-[#fbdacf] flex items-center justify-between mb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-lg bg-[#621708] text-white flex items-center justify-center font-bold text-sm">
                                <i class="fa-solid fa-layer-group"></i>
                            </div>
                            <div>
                                <span class="text-xs font-bold text-[#621708] uppercase tracking-wide block">Department Consolidated MFO</span>
                                <span class="text-xs text-slate-600">Review or generate the consolidated MFO program report for this cycle</span>
                            </div>
                        </div>
                        <button type="button" class="chair-btn-primary text-xs" onclick="CiteFlowChairReview.closeTaskDetails(); CiteFlowChairReview.openConsolidatedMfo('${task.id}')">
                            <i class="fa-solid fa-layer-group mr-1.5"></i> Consolidate MFO
                        </button>
                    </div>
                ` : ''}

                <!-- MFO Consolidated Draft Staleness / Decision Banner (Phase 5.2) -->
                ${isMfo ? `<div id="chairMfoDraftBanner" class="mb-3"></div>` : ''}

                <!-- 9 Metrics Standard Display -->
                <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-xs">
                    <div class="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
                        <span class="text-slate-500 block text-[10px] uppercase font-bold">Expected</span>
                        <span class="text-base font-extrabold text-slate-900">${counts.expected}</span>
                    </div>
                    <div class="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
                        <span class="text-indigo-600 block text-[10px] uppercase font-bold">Submitted</span>
                        <span class="text-base font-extrabold text-indigo-900">${counts.submitted}</span>
                    </div>
                    <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                        <span class="text-amber-700 block text-[10px] uppercase font-bold">Pending</span>
                        <span class="text-base font-extrabold text-amber-900">${counts.pending_review}</span>
                    </div>
                    <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                        <span class="text-emerald-700 block text-[10px] uppercase font-bold">Approved</span>
                        <span class="text-base font-extrabold text-emerald-900">${counts.approved}</span>
                    </div>
                    <div class="p-2.5 rounded-xl ${counts.not_submitted_overdue > 0 ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50 border border-slate-200'}">
                        <span class="${counts.not_submitted_overdue > 0 ? 'text-rose-700' : 'text-slate-600'} block text-[10px] uppercase font-bold">Not Submitted</span>
                        <span class="text-base font-extrabold ${counts.not_submitted_overdue > 0 ? 'text-rose-900' : 'text-slate-900'}">${counts.not_submitted}</span>
                        <span class="block text-[9px] text-slate-400">${counts.not_submitted_open} open · ${counts.not_submitted_overdue} overdue</span>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div>
                    <div class="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                        <span>Submission Progress</span>
                        <span>${progressPercent}% (${counts.submitted} / ${counts.expected})</span>
                    </div>
                    <div class="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div class="h-full bg-[#621708] rounded-full transition-all" style="width: ${progressPercent}%"></div>
                    </div>
                </div>

                <!-- Deadline & Instructions -->
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                    <div class="flex items-center justify-between">
                        <span class="text-slate-500 font-medium"><i class="fa-regular fa-calendar mr-1"></i>Deadline:</span>
                        <span class="font-bold ${deadline.isOverdue ? 'text-rose-700' : 'text-slate-900'}">${esc(deadline.dateText)} &middot; ${esc(deadline.text)}</span>
                    </div>
                    ${task.instructions ? `
                        <div class="pt-2 border-t border-slate-200 text-slate-700">
                            <span class="font-semibold block mb-0.5">Instructions:</span>
                            <p class="whitespace-pre-line">${esc(task.instructions)}</p>
                        </div>
                    ` : ''}
                </div>

                <!-- Assigned Faculty Status -->
                <div>
                    <p class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Department Faculty Submission Status (${taskAssignments.length})</p>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-1">${facultyRows}</div>
                </div>
            `;

            if (isMfo) {
                checkAndRenderMfoDraftBanner(task);
            }
        }

        modal.classList.add('open');
    }

    function closeTaskDetails() {
        review.activeTaskDetailsId = null;
        document.getElementById('chairTaskDetailModal')?.classList.remove('open');
    }

    function openArReview(reportId) {
        const row = (review.arSubmissions || []).find((item) => String(item.id) === String(reportId));
        const modal = document.getElementById('chairArReviewModal');
        if (!row || !modal) return;

        review.activeArReportId = row.id;

        const people = facultyMap();
        const person = people.get(String(row.faculty_id));
        const facName = person?.full_name || person?.name || row.faculty_name || 'Faculty';
        const dept = (person?.department || person?.department_code || chairDepartment() || '—').toUpperCase();
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        const typeLabel = row.report_type === 'online' ? 'Online / WFH Accomplishment Report' : 'Face-to-Face Accomplishment Report';
        const period = `${fmtDate(row.period_start)} – ${fmtDate(row.period_end)}`;
        const WF = wf();
        const statusLabel = WF ? WF.formatAccomplishmentReportStatus(row.status) : row.status;

        const idEl = document.getElementById('chairArReviewId');
        if (idEl) idEl.textContent = `#AR-${row.id}`;
        const titleEl = document.getElementById('chairArReviewTitle');
        if (titleEl) titleEl.textContent = `Review ${typeLabel}`;
        const subEl = document.getElementById('chairArReviewSubtitle');
        if (subEl) subEl.textContent = `${facName} · ${dept}`;
        const facEl = document.getElementById('chairArReviewFaculty');
        if (facEl) facEl.textContent = facName;
        const deptEl = document.getElementById('chairArReviewDept');
        if (deptEl) deptEl.textContent = dept;
        const typeEl = document.getElementById('chairArReviewType');
        if (typeEl) typeEl.textContent = typeLabel;
        const periodEl = document.getElementById('chairArReviewPeriod');
        if (periodEl) periodEl.textContent = period;
        const statusEl = document.getElementById('chairArReviewStatus');
        if (statusEl) statusEl.textContent = statusLabel;
        const subAtEl = document.getElementById('chairArReviewSubmitted');
        if (subAtEl) subAtEl.textContent = fmtDate(row.submitted_at || row.created_at);

        const frame = document.getElementById('chairArReviewPdfFrame');
        const link = document.getElementById('chairArReviewPdfLink');
        const pdfUrl = row.report_pdf_url || '';
        if (frame) frame.src = pdfUrl;
        if (link) {
            link.href = pdfUrl || '#';
            link.classList.toggle('hidden', !pdfUrl);
        }

        const histBlock = document.getElementById('chairArReviewHistoryBlock');
        const histContent = document.getElementById('chairArReviewHistory');
        let histHtml = '';
        if (row.chair_reviewed_by) {
            histHtml += `<div><strong>Chairperson:</strong> ${esc(row.chair_reviewed_by)} (${fmtDate(row.chair_reviewed_at)})${row.chair_remarks ? ` — <em>"${esc(row.chair_remarks)}"</em>` : ''}</div>`;
        }
        if (row.dean_reviewed_by) {
            histHtml += `<div><strong>Dean/Admin:</strong> ${esc(row.dean_reviewed_by)} (${fmtDate(row.dean_reviewed_at)})${row.dean_remarks ? ` — <em>"${esc(row.dean_remarks)}"</em>` : ''}</div>`;
        }
        if (histBlock && histContent) {
            if (histHtml) {
                histBlock.classList.remove('hidden');
                histContent.innerHTML = histHtml;
            } else {
                histBlock.classList.add('hidden');
            }
        }

        // Check if report is currently pending review
        const pending = isPending({ ...row, is_ar: true });

        // Remarks field handling (unhide so Chairperson can enter remarks/feedback)
        const remarksField = document.getElementById('chairArReviewRemarks');
        const remarksWrap = remarksField?.closest('div');
        if (remarksField) {
            remarksField.value = '';
            remarksField.placeholder = 'Add remarks (optional for certification, required for revision or decline)...';
        }
        if (remarksWrap) {
            if (pending) {
                remarksWrap.classList.remove('hidden');
            } else {
                remarksWrap.classList.add('hidden');
            }
        }

        // Action buttons: render Certify & Approve, Request Revision, and Decline when pending
        const actionsDiv = document.getElementById('chairArReviewActions');
        if (actionsDiv) {
            if (pending) {
                actionsDiv.innerHTML = `
                    <div class="flex flex-wrap items-center justify-end gap-2 w-full">
                        <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.closeArReview()">Cancel</button>
                        <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.submitArReview('reject')">Decline</button>
                        <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.submitArReview('revision')">Request Revision</button>
                        <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.submitArReview('approve')">Certify &amp; Approve</button>
                    </div>
                `;
            } else {
                actionsDiv.innerHTML = `
                    <div class="flex items-center justify-end w-full">
                        <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.closeArReview()">Close</button>
                    </div>
                `;
            }
        }

        modal.classList.add('open');
    }
    function closeArReview() {
        review.activeArReportId = null;
        const modal = document.getElementById('chairArReviewModal');
        const frame = document.getElementById('chairArReviewPdfFrame');
        if (frame) frame.src = '';
        modal?.classList.remove('open');
    }


        async function updateArStatus(reportId, newStatus) {
        if (!confirm(`Are you sure you want to mark this accomplishment report as "${newStatus.replace('_', ' ').toUpperCase()}"?`)) {
            return;
        }

        try {
            const client = db();
            if (!client) throw new Error('Database client unavailable');

            const { error } = await client
                .from('accomplishment_report_submissions')
                .update({ 
                    status: newStatus,
                    reviewed_at: new Date().toISOString()
                })
                .eq('id', reportId);

            if (error) throw error;

            alert(`Report status successfully updated to ${newStatus.replace('_', ' ')}.`);
            closeArReview();
            await loadAll(); // I-refresh ang listahan
        } catch (err) {
            console.error('Error updating AR status:', err);
            alert('Failed to update report status: ' + (err.message || err));
        }
    }

    async function approveAr(reportId) {
        const ar = (review.arSubmissions || []).find((item) => String(item.id) === String(reportId));
        if (!ar || !wf()) return;
        const people = facultyMap();
        const fac = people.get(String(ar.faculty_id));
        const facName = fac?.full_name || fac?.name || ar.faculty_name || 'Faculty';

        if (!confirm(`Are you sure you want to certify the accomplishment report for ${facName}?`)) return;

        try {
            await wf().reviewAccomplishmentReport(db(), {
                reportId: ar.id,
                action: 'approve',
                actorRole: 'chairperson',
                actorName: global.currentFaculty?.full_name || global.currentFaculty?.name || 'Chairperson',
                actorId: global.currentFaculty?.id,
                remarks: null,
                facultyId: ar.faculty_id
            });
            toast('Accomplishment report certified successfully! Dean/Admin will handle final approval.', 'success');
            await loadData();
            render();
            if (typeof global.fetchAllData === 'function') await global.fetchAllData();
        } catch (err) {
            console.error('approveAr error:', err);
            toast('Error: ' + (err.message || err), 'error');
        }
    }

    function openArRevision(reportId) {
        openArReview(reportId);
        setTimeout(() => {
            const el = document.getElementById('chairArReviewRemarks');
            if (el) {
                el.focus();
                el.placeholder = 'Please enter remarks explaining what needs revision (required)...';
            }
        }, 150);
    }

    function openArDecline(reportId) {
        openArReview(reportId);
        setTimeout(() => {
            const el = document.getElementById('chairArReviewRemarks');
            if (el) {
                el.focus();
                el.placeholder = 'Please enter reason for declining this report (required)...';
            }
        }, 150);
    }

    async function submitArReview(action) {
        const reportId = review.activeArReportId;
        const ar = (review.arSubmissions || []).find((item) => String(item.id) === String(reportId));
        if (!ar || !wf()) return;

        const remarks = String(document.getElementById('chairArReviewRemarks')?.value || '').trim();
        if (action === 'revision' && !remarks) {
            toast('Please enter remarks explaining what needs revision.', 'warn');
            return;
        }
        if (action === 'reject' && !remarks) {
            toast('Please enter a reason before declining this report.', 'warn');
            return;
        }

        const actionText = action === 'approve' ? 'certify' : action === 'revision' ? 'request revision for' : 'decline';
        if (!confirm(`Are you sure you want to ${actionText} this accomplishment report?`)) return;

        try {
            await wf().reviewAccomplishmentReport(db(), {
                reportId: ar.id,
                action,
                actorRole: 'chairperson',
                actorName: global.currentFaculty?.full_name || global.currentFaculty?.name || 'Chairperson',
                actorId: global.currentFaculty?.id,
                remarks: remarks || null,
                facultyId: ar.faculty_id
            });

            closeArReview();
            const msg = action === 'approve'
                ? 'Accomplishment report certified successfully! Dean/Admin will handle final approval.'
                : action === 'revision'
                    ? 'Revision requested. The faculty member has been notified.'
                    : 'Accomplishment report declined.';
            toast(msg, action === 'approve' ? 'success' : action === 'revision' ? 'warn' : 'error');

            await loadData();
            render();
            if (typeof global.fetchAllData === 'function') await global.fetchAllData();
        } catch (err) {
            console.error('submitArReview error:', err);
            toast('Error: ' + (err.message || err), 'error');
        }
    }

    function afterDataRefresh() {
        if (review.mode === 'chair' && review.access) render();
        else syncTabs();
    }

    const CiteFlowChairReview = {
        get access() { return review.access; },
        set access(v) { review.access = v; },
        get mode() { return review.mode; },
        set mode(v) { review.mode = v; },
        review,
        effectiveGrants,
        authorizedDepartmentCodes,
        chairDepartment,
        chairDepartmentDisplay,
        isFacultyInChairScope,
        scopedFaculty,
        scopedAssignments,
        scopedSubmissions,
        scopedTasks,
        getDepartmentAnalytics,
        getRecurringAnalytics,
        buildNonSubmittedRows,
        buildRows,
        isPending,
        isApproved,
        isRevision,
        isDeclined,
        formatDeadlineRelative,
        refreshAccess,
        loadData,
        render,
        syncTabs,
        setMode,
        setTab,
        setFilterType,
        setNotSubmittedFilter,
        setReportFilterFreq,
        toggleCycle,
        setSearch,
        approve,
        openRevision,
        openDecline,
        closeRevision,
        submitRevision,
        openView,
        closeView,
        openTaskDetails,
        closeTaskDetails,
        openConsolidatedMfo,
        closeConsolidatedMfo,
        createConsolidatedDraft,
        createCorrectedVersion,
        isConsolidatedReportLocked,
        regenerateMfoDraftModal,
        acknowledgeMfoDraftModal,
        toggleExclusionModal,
        saveMfoDraftRemarks,
        setConsolidatedMfoTab,
        loadAndRenderConsolidatedMfo,
        renderConsolidatedMfoModalView,
        checkAndRenderMfoDraftBanner,
        regenerateMfoDraft,
        acknowledgeMfoDraft,
        rerenderConsolidatedMfoInPlace,
        openEditAccomplishmentModal,
        closeEditAccomplishmentModal,
        saveEditAccomplishment,
        openAddAccomplishmentModal,
        closeAddAccomplishmentModal,
        saveAddAccomplishment,
        OFFICIAL_CONSOLIDATED_SECTIONS,
        getOfficialMfoSections,
        populateOfficialSectionDropdowns,
        removeConsolidatedAccomplishment,
        closeRemoveAccomplishmentModal,
        confirmRemoveAccomplishment,
        restoreConsolidatedAccomplishment,
        setConsolidatedFilter,
        setConsolidatedSearch,
        openSourceUpdatesModal,
        closeSourceUpdatesModal,
        acceptSourceUpdate,
        declineSourceUpdate,
        acceptAllSourceUpdates,
        openEditProgramPortionModal,
        closeEditProgramPortionModal,
        saveEditProgramPortion,
        saveConsolidatedMfoEdits,
        openArReview,
        closeArReview,
        updateArStatus,
        approveAr,
        openArRevision,
        openArDecline,
        submitArReview,
        previewFile: previewByKey,
        downloadFile: downloadByKey,
        closeFilePreview,
        afterDataRefresh,
        openSubmitConsolidatedMfoModal,
        closeSubmitConsolidatedMfoModal,
        confirmSubmitConsolidatedMfo,
        renderCard,
        _reviewState: review
    };

    global.CiteFlowChairReview = CiteFlowChairReview;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CiteFlowChairReview;
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('hashchange', () => {
            const hash = String(location.hash || '').toLowerCase();
            if (hash === '#chair-review' || hash === '#chairperson-review') {
                setMode('chair');
            } else {
                setMode('mine');
            }
            if (typeof window.updateFacultyActiveMenu === 'function') {
                window.updateFacultyActiveMenu();
            }
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
