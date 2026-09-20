/* Chairperson Review ΓÇö lives inside faculty/submissions.html */
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
        actionMode: 'revision',
        arSubmissions: [],
        filterType: 'all',
        activeArReportId: null
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
        if (review.grants.length) return review.grants;
        if (review.access && global.currentFaculty) {
            return [{
                is_active: true,
                grantee_faculty_id: global.currentFaculty.id,
                grantee_auth_user_id: global.currentFaculty.auth_user_id || global.currentUser?.id || null
            }];
        }
        return [];
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

    function isFacultyInChairScope(target) {
        if (!target) return false;
        const helper = wf();
        if (helper?.canBrowseAsChairperson) {
            return helper.canBrowseAsChairperson(global.currentFaculty, target, effectiveGrants());
        }
        const authorized = helper?.chairpersonAuthorizedDepartments?.(global.currentFaculty, effectiveGrants()) || [];
        const dept = helper?.facultyDepartmentCode?.(target) || String(target?.department || '').trim().toLowerCase();
        if (authorized.length) return authorized.includes(dept);
        return sameDept(target);
    }

    function buildRows() {
        const helper = wf();
        const people = facultyMap();
        const tasks = taskMap();

        const taskRows = (review.submissions || []).map((sub) => {
            const person = people.get(String(sub.faculty_id));
            const task = tasks.get(String(sub.task_id));
            return {
                ...sub,
                is_ar: false,
                faculty_name: person?.full_name || person?.name || 'Faculty',
                department: person?.department || person?.department_code || '',
                task_title: task?.title || 'Submission',
                task,
                config: task?.report_config_id ? configMap().get(String(task.report_config_id)) : null,
                files: filesFor(sub.id)
            };
        }).filter((row) => {
            if (!review.access) return false;
            // wf_list_chairperson_submissions() is the authoritative,
            // server-scoped queue. Browser RLS may hide the grant row that
            // authorized it, so do not apply a second incomplete scope filter.
            return true;
        });

        const arRows = (review.arSubmissions || []).map((ar) => {
            const person = people.get(String(ar.faculty_id));
            const typeLabel = ar.report_type === 'online'
                ? 'Online / WFH Accomplishment Report'
                : 'Face-to-Face Accomplishment Report';
            const fmtPeriod = (s, e) => {
                const f = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                return s && e ? `${f(s)} ΓÇô ${f(e)}` : 'Period not specified';
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
        if (row.is_ar) {
            return row.status === 'submitted';
        }
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
        const authorized = helper.chairpersonAuthorizedDepartments?.(global.currentFaculty, effectiveGrants()) || [];
        const dept = helper.facultyDepartmentCode?.(target) || '';
        const inDept = authorized.length ? authorized.includes(dept) : sameDept(target);
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
        const required = helper?.requiresChairpersonReview?.(row.config, row.task);
        if (required === false) return false;
        return stage === 'final_approver' || stage === 'approved' || status === 'approved';
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
        } else if (review.filterType === 'tasks') {
            rows = rows.filter((r) => !r.is_ar);
        }

        const q = String(review.search || '').trim().toLowerCase();
        const searched = q
            ? rows.filter((row) => [row.faculty_name, row.task_title, row.department, row.status, row.period_text || '']
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

    function setFilterType(type) {
        review.filterType = ['all', 'ar', 'tasks'].includes(type) ? type : 'all';
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
        if (!iso) return 'ΓÇö';
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
                    <span class="text-sm text-slate-800 truncate">≡ƒôä ${name}</span>
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
        const actionable = isPending(row);
        const WF = wf();
        const statusLabel = WF ? WF.formatAccomplishmentReportStatus(row.status) : row.status;
        const statusCss = WF ? WF.getAccomplishmentReportStatusCss(row.status) : 'bg-indigo-50 text-indigo-700';

        let remarksBlock = '';
        if (row.chair_remarks) {
            remarksBlock = `
                <div class="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-600">
                    <span class="font-semibold text-slate-700">Chair Remarks:</span> ${esc(row.chair_remarks)}
                </div>`;
        } else if (row.dean_remarks) {
            remarksBlock = `
                <div class="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-600">
                    <span class="font-semibold text-slate-700">Dean Remarks:</span> ${esc(row.dean_remarks)}
                </div>`;
        }

        const actions = actionable
            ? `
                <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openArReview('${row.id}')">
                    <i class="fa-solid fa-eye mr-1"></i> Review Report
                </button>
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.approveAr('${row.id}')">
                    <i class="fa-solid fa-check mr-1"></i> Certify
                </button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.openArRevision('${row.id}')">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Request Revision
                </button>
                <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.openArDecline('${row.id}')">
                    <i class="fa-solid fa-xmark mr-1"></i> Decline
                </button>
            `
            : `
                <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openArReview('${row.id}')">
                    <i class="fa-solid fa-file-pdf mr-1"></i> View Report
                </button>
                ${row.report_pdf_url ? `<a href="${esc(row.report_pdf_url)}" target="_blank" rel="noopener" class="chair-file-view-btn inline-flex items-center gap-1 text-xs font-semibold text-[#621708] hover:underline px-3 py-2">Open PDF Γåù</a>` : ''}
            `;

        const pdfSnippet = row.report_pdf_url
            ? `<div class="chair-file-row mt-3">
                <span class="text-sm text-slate-800 truncate">≡ƒôä ${esc(row.task_title)} (${esc(row.period_text)})</span>
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
                            <span class="font-semibold text-slate-800">${esc(row.faculty_name)}</span> ┬╖ ${esc((row.department || chairDepartment() || 'ΓÇö').toUpperCase())}
                        </p>
                    </div>
                    <span class="text-[11px] font-bold px-2.5 py-1 rounded-full ${statusCss} border">${esc(statusLabel)}</span>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
                    <span>≡ƒôà <strong>Period:</strong> ${esc(row.period_text)}</span>
                    <span>≡ƒòÆ <strong>Submitted:</strong> ${esc(formatWhen(row.submitted_at))}</span>
                </div>
                ${remarksBlock}
                ${pdfSnippet}
                <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">${actions}</div>
            </article>`;
    }

    /**
     * Mirrors isMfoSource() in faculty/mfo-report.js so both pages agree on
     * what counts as an MFO submission.
     */
    function submissionIsMfo(row) {
        const helper = wf();
        if (helper?.resolveDocumentCategory?.(row?.config) === 'MFO') return true;
        if (helper?.resolveDocumentCategory?.(row?.task) === 'MFO') return true;
        const blob = [row?.config?.report_name, row?.task_title, row?.task?.title]
            .join(' ').toLowerCase();
        return /\bmfo\b|major final output|accomplishment report/.test(blob);
    }

    /**
     * Read-only view of the submitted MFO.
     *
     * This reuses the reviewer route that already exists in
     * faculty/mfo-report.js (?view=review&submission=…), which renders the
     * official template, refuses every write, and offers Approve / Request
     * Revision / Decline. Without this link the Chairperson could only review
     * the raw attachment list, and that reviewer mode had no entry point from
     * the Chairperson side at all.
     */
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
        const stage = helper?.formatWorkflowStatus
            ? helper.formatWorkflowStatus(row, row.task, row.config)
            : (helper?.formatApprovalStage
                ? helper.formatApprovalStage(row.approval_stage)
                : (row.approval_stage === 'chairperson' ? 'Pending Chairperson Review' : (row.approval_stage || row.status)));
        const actions = actionable
            ? `
                <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>
                ${mfoReportLink(row)}
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
                <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.openDecline('${row.id}')">Decline</button>
            `
            : `<button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>${mfoReportLink(row)}`;
        return `
            <article class="surface rounded-[16px] p-5">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div>
                        <h3 class="font-bold text-slate-900">${esc(row.task_title)}</h3>
                        <p class="text-sm text-slate-600 mt-1">${esc(row.faculty_name)} ┬╖ ${esc((row.department || chairDepartment() || 'ΓÇö').toUpperCase())}</p>
                    </div>
                    <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">${esc(stage)}</span>
                </div>
                <p class="text-sm text-slate-500">Submitted ${esc(formatWhen(row.submitted_at))}</p>
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

        const dept = (chairDepartment() || 'ΓÇö').toUpperCase();
        const rows = buildRows();
        const pending = rows.filter(isPending);
        const approved = rows.filter(isApproved);
        const revision = rows.filter(isRevision);
        const declined = rows.filter(isDeclined);
        const visible = filteredRows();
        const allRows = buildRows();
        const arRowsCount = allRows.filter((r) => r.is_ar).length;
        const taskRowsCount = allRows.filter((r) => !r.is_ar).length;
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

                <div class="flex flex-wrap items-center gap-2 mb-3">
                    <button type="button" class="chair-subtab ${review.tab === 'pending' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('pending')">Pending Approval</button>
                    <button type="button" class="chair-subtab ${review.tab === 'approved' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('approved')">Approved</button>
                    <button type="button" class="chair-subtab ${review.tab === 'revision' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('revision')">Revision</button>
                    <button type="button" class="chair-subtab ${review.tab === 'declined' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('declined')">Declined</button>
                    <button type="button" class="chair-subtab ${review.tab === 'department' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('department')">Department Submissions</button>
                </div>

                <div class="flex flex-wrap items-center gap-2 mb-4">
                    <span class="text-xs font-semibold text-slate-500 mr-1">Filter:</span>
                    <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'all' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('all')">All Submissions (${allRows.length})</button>
                    <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'ar' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('ar')">Accomplishment Reports (${arRowsCount})</button>
                    <button type="button" class="px-3 py-1 rounded-full text-xs font-semibold transition-all ${review.filterType === 'tasks' ? 'bg-[#621708] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}" onclick="CiteFlowChairReview.setFilterType('tasks')">Task Submissions (${taskRowsCount})</button>
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
            facultyRes, tasksRes, grantsRes, configsRes, arRes
        ] = await Promise.all([
            client.from('faculty').select('id, full_name, name, department, role, position, auth_user_id, email, status'),
            client.from('wf_tasks').select('id, title, report_config_id, due_at, deadline_at'),
            client.from('wf_delegated_access').select('*'),
            client.from('wf_report_configs').select('id, report_name, requires_chairperson_review, requires_final_approval'),
            client.from('accomplishment_report_submissions').select('*').order('submitted_at', { ascending: false })
        ]);

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

        const failed = [facultyRes, tasksRes, submissionsRes, grantsRes, configsRes].find((result) => result.error);
        if (failed?.error) {
            console.warn('Chairperson Review could not load department data:', failed.error);
        }

        review.faculty = (facultyRes.data || []).map((row) => wf()?.normalizeFaculty?.(row) || row);
        review.tasks = tasksRes.data || [];
        review.configs = configsRes.data || [];
        review.grants = (grantsRes.data || []).filter((grant) => grant && grant.is_active !== false);
        review.arSubmissions = arRes?.data || [];
        if (arRes?.error) {
            console.warn('[Chairperson AR Debug] Error fetching accomplishment_report_submissions:', arRes.error);
        } else {
            console.log('[Chairperson AR Debug] Loaded AR submissions:', review.arSubmissions.length);
        }
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
        if (!filesRes.error && submissionIds.length && !(filesRes.data || []).length) {
            console.warn('[Chairperson File Debug] wf_submission_files returned []. If Admin can preview this same submission, RLS is blocking the Chairperson file SELECT. Run admin/workflow-chairperson-files-rls.sql');
        }
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
            <p class="text-sm text-slate-600 mt-1">${esc(row.faculty_name)} ┬╖ ${esc((row.department || 'ΓÇö').toUpperCase())}</p>
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

    function openArReview(reportId) {
        const row = (review.arSubmissions || []).find((item) => String(item.id) === String(reportId));
        const modal = document.getElementById('chairArReviewModal');
        if (!row || !modal) return;

        review.activeArReportId = row.id;

        const people = facultyMap();
        const person = people.get(String(row.faculty_id));
        const facName = person?.full_name || person?.name || row.faculty_name || 'Faculty';
        const dept = (person?.department || person?.department_code || chairDepartment() || 'ΓÇö').toUpperCase();
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'ΓÇö';
        const typeLabel = row.report_type === 'online' ? 'Online / WFH Accomplishment Report' : 'Face-to-Face Accomplishment Report';
        const period = `${fmtDate(row.period_start)} ΓÇô ${fmtDate(row.period_end)}`;
        const WF = wf();
        const statusLabel = WF ? WF.formatAccomplishmentReportStatus(row.status) : row.status;

        const idEl = document.getElementById('chairArReviewId');
        if (idEl) idEl.textContent = `#AR-${row.id}`;
        const titleEl = document.getElementById('chairArReviewTitle');
        if (titleEl) titleEl.textContent = `Review ${typeLabel}`;
        const subEl = document.getElementById('chairArReviewSubtitle');
        if (subEl) subEl.textContent = `${facName} ┬╖ ${dept}`;
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

        // PDF iframe
        const frame = document.getElementById('chairArReviewPdfFrame');
        const link = document.getElementById('chairArReviewPdfLink');
        const pdfUrl = row.report_pdf_url || '';
        if (frame) frame.src = pdfUrl;
        if (link) {
            link.href = pdfUrl || '#';
            link.classList.toggle('hidden', !pdfUrl);
        }

        // History
        const histBlock = document.getElementById('chairArReviewHistoryBlock');
        const histContent = document.getElementById('chairArReviewHistory');
        let histHtml = '';
        if (row.chair_reviewed_by) {
            histHtml += `<div><strong>Chairperson:</strong> ${esc(row.chair_reviewed_by)} (${fmtDate(row.chair_reviewed_at)})${row.chair_remarks ? ` ΓÇö <em>"${esc(row.chair_remarks)}"</em>` : ''}</div>`;
        }
        if (row.dean_reviewed_by) {
            histHtml += `<div><strong>Dean/Admin:</strong> ${esc(row.dean_reviewed_by)} (${fmtDate(row.dean_reviewed_at)})${row.dean_remarks ? ` ΓÇö <em>"${esc(row.dean_remarks)}"</em>` : ''}</div>`;
        }
        if (histBlock && histContent) {
            if (histHtml) {
                histBlock.classList.remove('hidden');
                histContent.innerHTML = histHtml;
            } else {
                histBlock.classList.add('hidden');
            }
        }

        // Remarks input
        const remarksField = document.getElementById('chairArReviewRemarks');
        if (remarksField) remarksField.value = '';

        // Actions
        const actionsDiv = document.getElementById('chairArReviewActions');
        if (actionsDiv) {
            if (row.status === 'submitted') {
                actionsDiv.innerHTML = `
                    <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.closeArReview()">Cancel</button>
                    <button type="button" class="chair-btn-decline" onclick="CiteFlowChairReview.submitArReview('reject')">
                        <i class="fa-solid fa-xmark mr-1"></i> Decline
                    </button>
                    <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.submitArReview('revision')">
                        <i class="fa-solid fa-rotate-left mr-1"></i> Request Revision
                    </button>
                    <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.submitArReview('approve')">
                        <i class="fa-solid fa-check mr-1"></i> Certify as Chairperson
                    </button>
                `;
            } else {
                actionsDiv.innerHTML = `
                    <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.closeArReview()">Close</button>
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

    global.CiteFlowChairReview = {
        get access() { return review.access; },
        get mode() { return review.mode; },
        refreshAccess,
        loadData,
        render,
        syncTabs,
        setMode,
        setTab,
        setFilterType,
        setSearch,
        approve,
        openRevision,
        openDecline,
        closeRevision,
        submitRevision,
        openView,
        closeView,
        openArReview,
        closeArReview,
        approveAr,
        openArRevision,
        openArDecline,
        submitArReview,
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
