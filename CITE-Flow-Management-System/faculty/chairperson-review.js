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
        revisionId: null
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
            const target = targetFaculty(row);
            if (helper?.canBrowseAsChairperson?.(global.currentFaculty, target, effectiveGrants())) return true;
            return sameDept(target);
        });
    }

    function isPending(row) {
        const helper = wf();
        if (!helper || !review.access) return false;
        if (helper.canReviewAsChairperson(row, global.currentFaculty, targetFaculty(row), reviewContext(row.task))) {
            return true;
        }
        return sameDept(targetFaculty(row))
            && helper.isPendingChairpersonReview(row, row.config, row.task);
    }

    function isApproved(row) {
        const helper = wf();
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        const required = helper?.requiresChairpersonReview?.(row.config, row.task);
        if (required === false) return false;
        return stage === 'final_approver' || stage === 'approved' || status === 'approved';
    }

    function isRevision(row) {
        const stage = String(row.approval_stage || '').toLowerCase();
        const status = String(row.status || '').toLowerCase();
        return status === 'revision' || stage === 'revision';
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
        review.tab = ['pending', 'approved', 'revision', 'department'].includes(tab) ? tab : 'pending';
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

    function renderCard(row) {
        const helper = wf();
        const actionable = isPending(row);
        const stage = helper?.formatApprovalStage
            ? helper.formatApprovalStage(row.approval_stage)
            : (row.approval_stage === 'chairperson' ? 'Pending Chairperson Review' : (row.approval_stage || row.status));
        const actions = actionable
            ? `
                <button type="button" class="chair-btn-secondary" onclick="CiteFlowChairReview.openView('${row.id}')">View Submission</button>
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
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
        const visible = filteredRows();
        const tabLabel = {
            pending: 'Pending Approval',
            approved: 'Approved',
            revision: 'Revision',
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

                <section class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
                </section>

                <div class="flex flex-wrap items-center gap-2 mb-4">
                    <button type="button" class="chair-subtab ${review.tab === 'pending' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('pending')">Pending Approval</button>
                    <button type="button" class="chair-subtab ${review.tab === 'approved' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('approved')">Approved</button>
                    <button type="button" class="chair-subtab ${review.tab === 'revision' ? 'active' : ''}" onclick="CiteFlowChairReview.setTab('revision')">Revision</button>
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
        if (!looksChair(faculty)) {
            console.info('[Chairperson Access Debug]', {
                authUserId: user?.id || null,
                facultyId: faculty.id,
                role: faculty.role,
                position: faculty.position,
                rawRole: faculty.raw_role,
                isChairperson: false,
                grantFound: false,
                shouldShow: false
            });
            review.access = false;
            if (review.mode === 'chair') review.mode = 'mine';
            syncTabs();
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
            review.files = [];
            review.filesError = null;
            review.fileActions = {};
            review.tasks = [];
            review.faculty = [];
            review.grants = [];
            review.configs = [];
            syncTabs();
            return;
        }

        const client = db();
        const [
            facultyRes, tasksRes, submissionsRes, grantsRes, configsRes
        ] = await Promise.all([
            client.from('faculty').select('id, full_name, name, department, role, position, auth_user_id, email, status'),
            client.from('wf_tasks').select('id, title, report_config_id, due_at, deadline_at'),
            client.from('wf_submissions').select('*'),
            client.from('wf_delegated_access').select('*'),
            client.from('wf_report_configs').select('id, report_name, requires_chairperson_review, requires_final_approval')
        ]);

        const failed = [facultyRes, tasksRes, submissionsRes, grantsRes, configsRes].find((result) => result.error);
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

        if (!(submissionsRes.data || []).length) {
            const listed = await client.rpc('wf_list_chairperson_submissions');
            console.warn('[Chairperson File Debug] RPC submissions:', listed.data);
            console.warn('[Chairperson File Debug] RPC submissions error:', listed.error);
            if (listed.error) {
                console.warn('[Chairperson File Debug] Run admin/workflow-chairperson-files-rls.sql if this RPC is missing.');
            }
            if (!listed.error && Array.isArray(listed.data) && listed.data.length) {
                submissionsRes = listed;
            }
        }

        const visibility = await client.rpc('wf_debug_chairperson_visibility');
        console.warn('[Chairperson File Debug] visibility:', JSON.stringify(visibility.data, null, 2));
        console.warn('[Chairperson File Debug] visibility error:', visibility.error);

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
        const modal = document.getElementById('chairRevisionModal');
        const field = document.getElementById('chairRevisionRemarks');
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
        if (!comment) {
            toast('Please provide remarks before requesting a revision.', 'warn');
            return;
        }
        const result = await wf().applySubmissionReview(db(), {
            submissionId: row.id,
            submission: row,
            action: 'revision',
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
        toast('Revision requested. Faculty must revise and resubmit.', 'warn');
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
            <div class="mt-4">${renderFiles(row.files)}</div>
            ${isPending(row) ? `<div class="flex flex-wrap gap-2 mt-5">
                <button type="button" class="chair-btn-approve" onclick="CiteFlowChairReview.closeView(); CiteFlowChairReview.approve('${row.id}')">Approve</button>
                <button type="button" class="chair-btn-revision" onclick="CiteFlowChairReview.closeView(); CiteFlowChairReview.openRevision('${row.id}')">Request Revision</button>
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
        closeRevision,
        submitRevision,
        openView,
        closeView,
        previewFile: previewByKey,
        downloadFile: downloadByKey,
        closeFilePreview,
        afterDataRefresh
    };
})(window);
