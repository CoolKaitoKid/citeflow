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
        tab: 'pending',
        search: '',
        grants: [],
        submissions: [],
        files: [],
        filesError: null,
        fileActions: {},
        tasks: [],
        faculty: [],
        configs: [],
        visibility: null,
        sqlVersion: null,
        revisionId: null,
        actionMode: 'revision'
    };

    function wf() {
        return global.CiteFlowWorkflow;
    }

    function db() {
        return global.db || global.supabaseClient;
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
        return (review.grants || []).filter((grant) => grant && grant.is_active !== false);
    }

    async function ensureAuthSession() {
        const client = db();
        if (!client?.auth?.getSession) return null;
        if (wf()?.getFreshSession) {
            try {
                return await wf().getFreshSession(client);
            } catch (_) {}
        }
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session?.user) return null;
        const expiresAt = Number(session.expires_at || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (expiresAt && expiresAt <= nowSec + 15) {
            if (global.CiteFlowAuth?.refreshSessionShared) {
                const shared = await global.CiteFlowAuth.refreshSessionShared(client);
                return shared?.user ? shared : session;
            }
            const refreshed = await client.auth.refreshSession();
            if (refreshed.error || !refreshed.data?.session?.user) return session;
            return refreshed.data.session;
        }
        return session;
    }

    function sameDept(target) {
        const helper = wf();
        const actor = global.currentFaculty;
        const left = helper?.facultyDepartmentCode?.(actor) || String(actor?.department || '').trim().toLowerCase();
        const right = helper?.facultyDepartmentCode?.(target) || String(target?.department || target?.department_code || '').trim().toLowerCase();
        return !!left && !!right && left === right;
    }

    function chairDepartment() {
        const helper = wf();
        return helper?.facultyDepartmentCode?.(global.currentFaculty)
            || global.currentFaculty?.department
            || global.currentFaculty?.department_code
            || '';
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

    function buildRows() {
        const helper = wf();
        const people = facultyMap();
        const tasks = taskMap();
        return (review.submissions || []).map((sub) => {
            const person = people.get(String(sub.faculty_id));
            const task = tasks.get(String(sub.task_id));
            return {
                ...sub,
                faculty_name: person?.full_name || person?.name || 'Faculty',
                department: person?.department || person?.department_code || '',
                task_title: task?.title || 'Submission',
                task,
                config: task?.report_config_id ? configMap().get(String(task.report_config_id)) : null,
                files: filesFor(sub.id)
            };
        }).filter((row) => {
            if (!review.access) return false;
            // Nobody reviews their own submission, whatever their grant says.
            if (isOwnSubmission(row)) return false;
            // Rows from wf_list_chairperson_submissions() are already scoped by
            // the database to an active grant, the granted departments, and
            // tasks that require Chairperson review. Re-filtering them here
            // would only risk hiding valid work when the browser's copy of the
            // grants is incomplete, so scope filtering applies to the degraded
            // fallback path alone.
            if (review.queueSource === 'rpc') return true;

            const helper = wf();
            const target = targetFaculty(row);
            if (helper?.canBrowseAsChairperson) {
                return helper.canBrowseAsChairperson(global.currentFaculty, target, effectiveGrants());
            }
            const authorized = helper?.chairpersonAuthorizedDepartments?.(global.currentFaculty, effectiveGrants()) || [];
            const dept = helper?.facultyDepartmentCode?.(target) || String(target?.department || '').trim().toLowerCase();
            if (authorized.length) return authorized.includes(dept);
            return sameDept(target);
        });
    }

    /**
     * A grant covering the chairperson's own department would otherwise put
     * their own submissions in their review queue.
     */
    function isOwnSubmission(row) {
        const me = global.currentFaculty;
        if (!me || !row) return false;
        const mine = [me.id, me.auth_user_id].filter((v) => v !== null && v !== undefined).map(String);
        return mine.includes(String(row.faculty_id));
    }

    function isPending(row) {
        const helper = wf();
        if (!helper || !review.access) return false;
        if (isOwnSubmission(row)) return false;
        if (helper.canReviewAsChairperson(row, global.currentFaculty, targetFaculty(row), reviewContext(row.task))) {
            return true;
        }
        // Authorization for these rows was already settled by the database, so
        // what remains is purely a question of stage and status.
        if (review.queueSource === 'rpc') {
            return helper.isPendingChairpersonReview(row, row.config, row.task);
        }
        const target = targetFaculty(row);
        const authorized = helper.chairpersonAuthorizedDepartments?.(global.currentFaculty, effectiveGrants()) || [];
        const dept = helper.facultyDepartmentCode?.(target) || '';
        const inDept = authorized.length ? authorized.includes(dept) : sameDept(target);
        return inDept && helper.isPendingChairpersonReview(row, row.config, row.task);
    }

    function isApproved(row) {
        const helper = wf();
        const status = String(row.status || '').toLowerCase();
        if (status === 'rejected' || status === 'revision') return false;
        const stage = String(row.approval_stage || '').toLowerCase();
        if (stage === 'declined' || stage === 'revision') return false;
        const required = helper?.requiresChairpersonReview?.(row.config, row.task);
        if (required === false) return false;
        return stage === 'final_approver' || stage === 'approved' || status === 'approved';
    }

    function isRevision(row) {
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        return status === 'revision' || stage === 'revision';
    }

    function isDeclined(row) {
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        return status === 'rejected' || stage === 'declined';
    }

    function filteredRows() {
        const rows = buildRows();
        const q = String(review.search || '').trim().toLowerCase();
        const searched = q
            ? rows.filter((row) => [row.faculty_name, row.task_title, row.department, row.status]
                .join(' ')
                .toLowerCase()
                .includes(q))
            : rows;
        if (review.tab === 'approved') return searched.filter(isApproved);
        if (review.tab === 'revision') return searched.filter(isRevision);
        if (review.tab === 'declined') return searched.filter(isDeclined);
        if (review.tab === 'department') return searched;
        return searched.filter(isPending);
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
            console.log('[Chairperson File Debug] signed URL error:', signed.error || null);
            console.log('[Chairperson File Debug] signed URL:', signed.data?.signedUrl || null);
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
            global.currentView = 'chair-review';
            render();
            return;
        }
        global.currentView = 'list';
        if (typeof global.renderListPage === 'function') global.renderListPage();
    }

    function setTab(tab) {
        review.tab = ['pending', 'approved', 'revision', 'declined', 'department'].includes(tab) ? tab : 'pending';
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
        const v = review.visibility;
        if (!v || (review.submissions || []).length) return '';

        const version = String(v.sql_patch_version || review.sqlVersion || '').trim();
        const patched = /013-mfo-faculty-chair-auth|011-chair-queue/.test(version)
            || v.matching_grant_count != null
            || v.empty_reason != null;
        const grantBlocked = v.has_grant === false;
        const reason = String(v.empty_reason || '');
        const detail = String(v.empty_reason_detail || '');
        const grantCount = Number.isFinite(Number(v.matching_grant_count))
            ? Number(v.matching_grant_count)
            : (review.grants?.length || 0);

        let title = 'Chairperson Review cannot load department submissions.';
        let text = 'Ask an administrator to confirm your Chairperson access for your department, then refresh this page.';

        if (!patched) {
            title = 'Chairperson Review is not fully configured yet.';
            text = 'Please contact the administrator. Database authorization rules for Chairperson Review still need to be applied.';
        } else if (reason === 'no_auth') {
            title = 'Your session is not available for Chairperson Review.';
            text = detail || 'Please sign in again, then reopen Chairperson Review.';
        } else if (reason === 'no_faculty_row') {
            title = 'Your faculty profile could not be resolved.';
            text = detail || 'Ask the administrator to link your login to a faculty profile.';
        } else if (grantBlocked || reason === 'no_matching_grant') {
            title = 'No active Chairperson grant was found for your account.';
            text = 'Ask Admin to grant you access in Workflow Approval → Manage Access for your department, then refresh.';
        } else if (reason === 'empty_authorized_departments') {
            title = 'Your grant has no usable department scope.';
            text = detail || 'Ask Admin to set department codes (for example BSIT, BSIE, or BIT) on your grant.';
        } else if (reason === 'no_submissions_in_table' || reason === 'no_in_scope_chair_required_submissions' || reason === 'in_scope_join_returned_zero') {
            title = 'No department submissions are waiting for Chairperson review.';
            text = 'When faculty submit reports that require Chairperson review in your authorized department, they will appear here.';
        }

        const debugLine = `patch=${version || 'missing'}; has_grant=${String(v.has_grant)}; is_chair_role=${String(v.is_chair_role)}; grants=${grantCount}; reason=${reason || 'n/a'}${detail ? `; detail=${detail}` : ''}`;
        console.warn('[Chairperson Review]', debugLine);

        return `
            <div class="rounded-[16px] border border-amber-200 bg-amber-50 p-4 mb-4 text-sm text-amber-950">
                <p class="font-bold">${esc(title)}</p>
                <p class="mt-1">${esc(text)}</p>
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
                    <span class="text-sm text-slate-800 truncate">📄 ${name}</span>
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

    /**
     * Link to the structured MFO report itself. The evidence files are not the
     * report — the report lives in the mfo_* tables and is rendered read-only
     * by the same official-template renderer the faculty member previews.
     */
    function renderMfoLink(row) {
        if (!isMfoSubmission(row)) return '';
        return `
            <div class="mt-2">
                <a class="file-manage-btn inline-flex" target="_blank" rel="noopener"
                   href="mfo-report.html?submission=${encodeURIComponent(row.id)}&view=review">
                    Open completed MFO report
                </a>
            </div>`;
    }

    function isMfoSubmission(row) {
        // A file carrying MFO packet tags proves a structured MFO exists, which
        // is stronger evidence than matching words in the task title.
        const files = Array.isArray(row?.files) ? row.files : [];
        if (files.some((file) => file?.mfo_packet_id || file?.mfo_section)) return true;

        const blob = [
            row?.task_title, row?.task?.title, row?.task?.instructions,
            row?.config?.report_name
        ].filter(Boolean).join(' ').toLowerCase();
        return /\bmfo\b|major final output|accomplishment report/.test(blob);
    }

    function renderCard(row) {
        const helper = wf();
        const actionable = isPending(row);
        const stage = helper?.formatWorkflowStatus
            ? helper.formatWorkflowStatus(row, row.task, row.config)
            : (helper?.formatApprovalStage
                ? helper.formatApprovalStage(row.approval_stage)
                : (row.approval_stage === 'chairperson' ? 'Pending Chairperson Review' : (row.approval_stage || row.status)));
        const actions = actionable
            ? `
                <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
                <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.openDecline('${row.id}')">Decline</button>
            `
            : `<button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>`;
        return `
            <article class="surface rounded-[16px] p-5">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div>
                        <h3 class="font-bold text-slate-900">${esc(row.task_title)}</h3>
                        <p class="text-sm text-slate-600 mt-1">${esc(row.faculty_name)} · ${esc((row.department || chairDepartment() || '—').toUpperCase())}</p>
                    </div>
                    <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">${esc(stage)}</span>
                </div>
                <p class="text-sm text-slate-500">Submitted ${esc(formatWhen(row.submitted_at))}</p>
                ${renderMfoLink(row)}
                <div class="mt-3 space-y-2">${renderFiles(row.files)}</div>
                <div class="flex flex-wrap gap-2 mt-4">${actions}</div>
            </article>`;
    }

    function render() {
        syncTabs();
        const root = document.getElementById('appRoot');
        if (!root || review.mode !== 'chair') return;
        if (!review.access) {
            setMode('mine');
            return;
        }

        const dept = (chairDepartment() || '—').toUpperCase();
        const rows = buildRows();
        const pending = rows.filter(isPending);
        const approved = rows.filter(isApproved);
        const revision = rows.filter(isRevision);
        const declined = rows.filter(isDeclined);
        const visible = filteredRows();
        const tabLabel = {
            pending: 'Pending Approval',
            approved: 'Approved',
            revision: 'Revision Requested',
            declined: 'Declined',
            department: 'Department Submissions'
        }[review.tab];

        root.innerHTML = `
            <div class="fade-in">
                <header class="mb-6">
                    <p class="cite-kicker">Submissions</p>
                    <div class="flex items-center flex-wrap gap-2.5 mt-1">
                        <h1 class="cite-title">Chairperson Review</h1>
                        <span class="cite-live"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>Live</span>
                    </div>
                    <p class="cite-subtitle">${esc(dept)} Department. Review faculty submissions that require your approval.</p>
                </header>

                <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div class="cite-stat cite-stat-pending rounded-[16px] p-5">
                        <p class="text-xs font-bold uppercase tracking-wide text-gray-400">Pending</p>
                        <div class="text-3xl font-extrabold mt-3 tracking-tight">${pending.length}</div>
                    </div>
                    <div class="cite-stat cite-stat-approved rounded-[16px] p-5">
                        <p class="text-xs font-bold uppercase tracking-wide text-gray-400">Approved</p>
                        <div class="text-3xl font-extrabold mt-3 tracking-tight">${approved.length}</div>
                    </div>
                    <div class="cite-stat cite-stat-review rounded-[16px] p-5">
                        <p class="text-xs font-bold uppercase tracking-wide text-gray-400">Revision</p>
                        <div class="text-3xl font-extrabold mt-3 tracking-tight">${revision.length}</div>
                    </div>
                    <div class="cite-stat cite-stat-urgent rounded-[16px] p-5">
                        <p class="text-xs font-bold uppercase tracking-wide text-gray-400">Declined</p>
                        <div class="text-3xl font-extrabold mt-3 tracking-tight">${declined.length}</div>
                    </div>
                </section>

                <div class="flex flex-wrap items-center gap-2 mb-4">
                    <button type="button" class="chair-subtab ${review.tab === 'pending' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('pending')">Pending Approval</button>
                    <button type="button" class="chair-subtab ${review.tab === 'approved' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('approved')">Approved</button>
                    <button type="button" class="chair-subtab ${review.tab === 'revision' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('revision')">Revision</button>
                    <button type="button" class="chair-subtab ${review.tab === 'declined' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('declined')">Declined</button>
                    <button type="button" class="chair-subtab ${review.tab === 'department' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('department')">Department Submissions</button>
                </div>

                <section class="surface rounded-[16px] p-5 lg:p-6">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
                        <div>
                            <h2 class="text-base font-bold text-gray-950">${esc(tabLabel)}</h2>
                            <p class="text-sm text-gray-500 mt-1">${review.tab === 'pending' ? 'Only submissions that currently require your decision.' : 'View and download are available. Approve only when the submission is waiting for Chairperson review.'}</p>
                        </div>
                        <input type="search" value="${esc(review.search)}" oninput="CiteFlowChairReview.setSearch(this.value)" placeholder="Search faculty or submission..." class="w-full lg:w-80 px-4 py-3 rounded-2xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-4 focus:ring-[#8c2a10]/10 focus:border-[#8c2a10]">
                    </div>
                    <div class="space-y-4">
                        ${queueBlockerBanner()}
                        ${visible.length
                            ? visible.map(renderCard).join('')
                            : emptyState(
                                review.tab === 'pending' ? 'No submissions currently require your approval.' : 'No submissions in this view.',
                                'New faculty submissions that need Chairperson review will appear here automatically.'
                            )}
                    </div>
                </section>
            </div>`;
    }

    function looksChair(faculty) {
        const helper = wf();
        if (helper?.isChairperson?.(faculty)) return true;
        return /chair/i.test(String(faculty?.role || faculty?.position || faculty?.raw_role || ''));
    }

    function syncTabs() {
        const wrap = document.getElementById('submissionsModeTabs');
        if (!wrap) {
            console.info('[Chairperson Access Debug] submissionsModeTabs not in the DOM yet');
            return;
        }
        wrap.classList.toggle('hidden', !review.access);
        wrap.classList.toggle('is-visible', review.access);
        wrap.style.setProperty('display', review.access ? 'flex' : 'none', 'important');
        const mine = document.getElementById('submissionsModeMine');
        const chair = document.getElementById('submissionsModeChair');
        mine?.classList.toggle('active', review.mode === 'mine');
        chair?.classList.toggle('active', review.mode === 'chair');
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
            review.access = false;
            syncTabs();
            return false;
        }

        const session = await ensureAuthSession();
        if (!session?.user) {
            console.info('[Chairperson Access Debug] no authenticated session before grant check');
            review.access = false;
            review.visibility = {
                sql_patch_version: review.sqlVersion || null,
                has_grant: false,
                is_chair_role: false,
                matching_grant_count: 0,
                empty_reason: 'no_auth',
                empty_reason_detail: 'no authenticated Supabase session'
            };
            syncTabs();
            return false;
        }

        review.access = await helper.currentUserHasChairpersonGrant(db(), faculty, user || session.user);
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
            review.files = [];
            review.filesError = null;
            review.fileActions = {};
            review.tasks = [];
            review.faculty = [];
            review.grants = [];
            review.configs = [];
            review.visibility = review.visibility || null;
            review.sqlVersion = review.sqlVersion || null;
            syncTabs();
            return;
        }

        const client = db();
        const session = await ensureAuthSession();
        if (!session?.user) {
            review.submissions = [];
            review.grants = [];
            review.visibility = {
                sql_patch_version: review.sqlVersion || null,
                has_grant: false,
                is_chair_role: false,
                matching_grant_count: 0,
                empty_reason: 'no_auth',
                empty_reason_detail: 'no authenticated Supabase session'
            };
            review.access = false;
            review.mode = 'mine';
            syncTabs();
            return;
        }

        const [
            facultyRes, tasksRes, grantsRes, configsRes
        ] = await Promise.all([
            client.from('faculty').select('id, full_name, name, department, role, position, auth_user_id, email, status'),
            client.from('wf_tasks').select('id, title, report_config_id, due_at, deadline_at'),
            client.from('wf_delegated_access').select('*'),
            client.from('wf_report_configs').select('id, report_name, requires_chairperson_review, requires_final_approval')
        ]);

        // The contents of this queue are decided by the database, not the
        // browser. wf_list_chairperson_submissions() is the authoritative set:
        // it returns nothing without an active wf_delegated_access grant,
        // restricts rows to the granted department scope, and includes only
        // tasks whose wf_report_configs row requires Chairperson review.
        //
        // A plain select on wf_submissions cannot drive this queue. Its RLS
        // policy is `wf_is_final_approver() OR wf_owns_submission() OR
        // wf_chairperson_can_browse_submission()`, so it also returns the
        // chairperson's own submissions — which both pollutes the queue and,
        // because the previous code only consulted the RPC when that select
        // came back empty, meant the authoritative query never ran for any
        // chairperson who had ever submitted anything themselves.
        let submissionsRes = await client.rpc('wf_list_chairperson_submissions');
        review.queueSource = 'rpc';
        if (submissionsRes.error) {
            // Older database without the function deployed. RLS still governs
            // the rows; the client-side scope filters below remain in force.
            console.warn('Chairperson queue RPC unavailable, falling back to RLS-filtered select:', submissionsRes.error);
            submissionsRes = await client.from('wf_submissions').select('*');
            review.queueSource = 'rls-select';
        }

        const failed = [facultyRes, tasksRes, grantsRes, configsRes].find((result) => result.error);
        if (failed?.error) {
            console.warn('Chairperson Review could not load department data:', failed.error);
        }

        review.faculty = (facultyRes.data || []).map((row) => wf()?.normalizeFaculty?.(row) || row);
        review.tasks = tasksRes.data || [];
        review.configs = configsRes.data || [];
        review.grants = (grantsRes.data || []).filter((grant) => grant && grant.is_active !== false);
        review.fileActions = {};
        review.filesError = null;

        console.warn('[Chairperson File Debug] table submissions:', submissionsRes.data);
        console.warn('[Chairperson File Debug] table submissions error:', submissionsRes.error || null);
        console.warn('[Chairperson File Debug] faculty rows:', (facultyRes.data || []).length, facultyRes.error || null);
        console.warn('[Chairperson File Debug] task rows:', (tasksRes.data || []).length, tasksRes.error || null);
        console.warn('[Chairperson File Debug] currentFaculty department fields:', {
            id: global.currentFaculty?.id,
            department: global.currentFaculty?.department,
            department_code: global.currentFaculty?.department_code,
            role: global.currentFaculty?.role,
            position: global.currentFaculty?.position
        });
        console.warn('[Chairperson File Debug] grants:', JSON.stringify(review.grants, null, 2));

        const versionRes = await client.rpc('wf_chairperson_sql_version');
        review.sqlVersion = typeof versionRes.data === 'string'
            ? versionRes.data
            : (Array.isArray(versionRes.data) ? versionRes.data[0] : null);
        console.warn('[Chairperson File Debug] sql_version:', review.sqlVersion, versionRes.error || null);

        const visibility = await client.rpc('wf_debug_chairperson_queue');
        const visibilityFallback = visibility.error
            ? await client.rpc('wf_debug_chairperson_visibility')
            : visibility;
        const visData = parseRpcJson(visibilityFallback.data);
        review.visibility = visData || parseRpcJson(visibilityFallback.data) || (typeof visibilityFallback.data === 'object' ? visibilityFallback.data : null);
        if (review.visibility && review.sqlVersion && !review.visibility.sql_patch_version) {
            review.visibility.sql_patch_version = review.sqlVersion;
        }
        console.warn('[Chairperson File Debug] visibility:', JSON.stringify(review.visibility, null, 2));
        console.warn('[Chairperson File Debug] visibility error:', visibilityFallback.error);

        if (review.visibility?.empty_reason === 'no_auth') {
            review.access = false;
            review.mode = 'mine';
            review.submissions = [];
            syncTabs();
            return;
        }

        if (review.visibility && review.visibility.has_grant === false) {
            review.access = false;
            review.mode = 'mine';
            review.submissions = [];
            syncTabs();
            return;
        }

        review.submissions = submissionsRes.data || [];

        const submissionIds = (review.submissions || []).map((row) => row.id).filter(Boolean);
        console.log('[Chairperson File Debug] submission:', review.submissions[0] || null);
        console.log('[Chairperson File Debug] submission ID:', submissionIds[0] || null);
        console.log('[Chairperson File Debug] submission IDs:', submissionIds);

        let filesRes = { data: [], error: null };
        if (submissionIds.length) {
            filesRes = await client
                .from('wf_submission_files')
                .select('*')
                .in('submission_id', submissionIds);
        }

        console.log('[Chairperson File Debug] files query result:', filesRes.data);
        console.log('[Chairperson File Debug] files query error:', filesRes.error);
        if (filesRes.error) console.warn('[Chairperson File Debug] files query error:', filesRes.error);
        review.filesError = filesRes.error || null;

        const rawFiles = filesRes.data || [];
        review.files = [];
        for (const file of rawFiles) {
            console.log('[Chairperson File Debug] storage path:', file?.storage_path);
            console.log('[Chairperson File Debug] file URL:', file?.file_url);
            const resolved = await resolveFileUrl(file);
            console.log('[Chairperson File Debug] resolved URL:', resolved);
            review.files.push({ ...file, _resolvedUrl: resolved });
        }

        const rpcOk = await wf()?.currentUserHasChairpersonGrant?.(client, global.currentFaculty, session.user);
        if (wf() && global.currentFaculty && review.visibility?.has_grant !== true && !rpcOk) {
            review.access = false;
            review.mode = 'mine';
            review.submissions = [];
        } else if (rpcOk === true) {
            review.access = true;
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
        const action = review.actionMode === 'decline' ? 'rejected' : 'revision';
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
        console.log('[Chairperson File Debug] submission:', row);
        console.log('[Chairperson File Debug] submission ID:', row?.id);
        console.log('[Chairperson File Debug] files for submission:', row.files);
        const stage = wf()?.formatApprovalStage?.(row.approval_stage) || row.approval_stage || row.status;
        body.innerHTML = `
            <h3 class="text-lg font-bold text-slate-900">${esc(row.task_title)}</h3>
            <p class="text-sm text-slate-600 mt-1">${esc(row.faculty_name)} · ${esc((row.department || '—').toUpperCase())}</p>
            <p class="text-sm text-slate-500 mt-2">Submitted ${esc(formatWhen(row.submitted_at))}</p>
            <p class="text-sm text-slate-700 mt-2"><span class="font-semibold">Status:</span> ${esc(stage)}</p>
            ${renderMfoLink(row)}
            <div class="mt-4">${renderFiles(row.files)}</div>
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

    function afterDataRefresh() {
        if (review.mode === 'chair' && review.access) render();
        else syncTabs();
    }

    global.CiteFlowChairReview = {
        get access() { return review.access; },
        get mode() { return review.mode; },
        refreshAccess,
        loadData,
        render,
        syncTabs,
        setMode,
        setTab,
        setSearch,
        approve,
        openRevision,
        openDecline,
        closeRevision,
        submitRevision,
        openView,
        closeView,
        previewFile: previewByKey,
        downloadFile: downloadByKey,
        closeFilePreview,
        afterDataRefresh
    };

    window.addEventListener('hashchange', () => {
        const hash = String(location.hash || '').toLowerCase();
        if (hash === '#chair-review' || hash === '#chairperson-review') {
            setMode('chair');
        }
        if (typeof window.updateFacultyActiveMenu === 'function') {
            window.updateFacultyActiveMenu();
        }
    });
})(window);
