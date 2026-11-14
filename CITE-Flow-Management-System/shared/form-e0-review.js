/**
 * CITE-Flow: CHED Form E-0 review controller (shared by the Dean/Admin viewer and the
 * Department Chair review page).
 *
 * Approval chain (enforced again in the database by migration 039):
 *   Faculty submits -> Department Chair certifies (E2) -> Dean approves (E3)
 *   A chairperson never certifies their own form; it goes straight to the Dean.
 *
 * Page contract (element ids): reviewQueue, reviewDetail, viewerDocMount, viewerStatusPill,
 * viewerSubtitle, reviewChecks, reviewActions.
 */
(function (global) {
    'use strict';

    const STATUS_LABELS = {
        draft: 'Draft', submitted: 'Submitted', chair_certified: 'Chair certified',
        approved: 'Approved', revision: 'Needs revision'
    };

    let reportData = null;
    let classesData = [];
    let me = { name: '', facultyId: null, isFinal: false };
    let role = { canCertify: false, canApprove: false, canReturn: false, isOwner: false, reason: '' };

    function E() { return global.CiteFlowFormE0Engine; }
    function db() { return global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.() || global.CiteFlowAuth?.getClient?.() || global.CiteFlowAuth?.ensureSharedClient?.(); }

    function esc(val) {
        return String(val ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    }

    // ------------------------------------------------------------------
    // Designed CITE-Flow Toasts & Modals (Zero Browser Dialogs)
    // ------------------------------------------------------------------
    function toast(msg, type = 'info') {
        if (global.CiteFlowUI?.toast) {
            global.CiteFlowUI.toast(msg, type);
            return;
        }
        if (typeof global.showToast === 'function') {
            global.showToast(msg, type);
            return;
        }
        let wrap = document.getElementById('e0-review-toast-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'e0-review-toast-wrap';
            wrap.className = 'fixed bottom-6 right-6 z-[99999] flex flex-col gap-2 max-w-sm pointer-events-none no-print';
            document.body.appendChild(wrap);
        }
        const item = document.createElement('div');
        const tone = type === 'error'
            ? 'border-red-200 bg-red-50 text-red-900'
            : type === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900';
        item.className = `pointer-events-auto rounded-2xl border px-4 py-3 text-xs font-semibold shadow-xl ${tone}`;
        item.textContent = msg;
        wrap.appendChild(item);
        setTimeout(() => item.remove(), 4200);
    }

    function showConfirmModal({ title, message, type = 'info', confirmText = 'Confirm', cancelText = 'Cancel' }) {
        if (global.CiteFlowUI?.dialog) {
            return global.CiteFlowUI.dialog({ title, message, type, confirmText, cancelText });
        }
        return new Promise((resolve) => {
            let root = document.getElementById('e0-review-modal-root');
            if (!root) {
                root = document.createElement('div');
                root.id = 'e0-review-modal-root';
                document.body.appendChild(root);
            }
            const iconMap = {
                warning: { icon: 'fa-triangle-exclamation', badge: 'bg-amber-50 text-amber-600 border-amber-100', btn: 'bg-amber-600 hover:bg-amber-700 text-white' },
                success: { icon: 'fa-circle-check', badge: 'bg-emerald-50 text-emerald-600 border-emerald-100', btn: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
                info: { icon: 'fa-stamp', badge: 'bg-[#fbf1ef] text-[#621708] border-[#e8d0cb]', btn: 'bg-[#621708] hover:bg-[#4a1005] text-white' }
            };
            const cfg = iconMap[type] || iconMap.info;
            root.innerHTML = `
                <div class="fixed inset-0 z-[99998] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print" id="e0RevConfirmBackdrop">
                    <div class="bg-white rounded-[2rem] shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
                        <div class="p-6 sm:p-8">
                            <div class="flex items-start gap-4">
                                <div class="w-12 h-12 rounded-2xl ${cfg.badge} border flex items-center justify-center shrink-0 text-xl shadow-sm">
                                    <i class="fa-solid ${cfg.icon}"></i>
                                </div>
                                <div class="flex-1 min-w-0 pt-0.5">
                                    <h3 class="text-lg font-extrabold text-slate-900 tracking-tight leading-snug">${esc(title)}</h3>
                                    <p class="text-sm text-slate-600 mt-2 leading-relaxed whitespace-pre-line">${esc(message)}</p>
                                </div>
                            </div>
                        </div>
                        <div class="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button type="button" id="e0RevConfirmCancel" class="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold transition shadow-sm">${esc(cancelText)}</button>
                            <button type="button" id="e0RevConfirmOk" class="px-5 py-2.5 rounded-xl text-xs font-bold transition shadow-md ${cfg.btn}">${esc(confirmText)}</button>
                        </div>
                    </div>
                </div>`;
            const close = (val) => { root.innerHTML = ''; resolve(val); };
            document.getElementById('e0RevConfirmOk')?.addEventListener('click', () => close(true));
            document.getElementById('e0RevConfirmCancel')?.addEventListener('click', () => close(false));
            document.getElementById('e0RevConfirmBackdrop')?.addEventListener('click', (e) => {
                if (e.target.id === 'e0RevConfirmBackdrop') close(false);
            });
        });
    }

    function showRevisionModal(facultyName) {
        return new Promise((resolve) => {
            let root = document.getElementById('e0-review-prompt-root');
            if (!root) {
                root = document.createElement('div');
                root.id = 'e0-review-prompt-root';
                document.body.appendChild(root);
            }
            root.innerHTML = `
                <div class="fixed inset-0 z-[99998] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print" id="e0RevPromptBackdrop">
                    <div class="bg-white rounded-[2rem] shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
                        <div class="p-6 sm:p-8 space-y-4">
                            <div class="flex items-start gap-4">
                                <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0 text-xl shadow-sm">
                                    <i class="fa-solid fa-rotate-left"></i>
                                </div>
                                <div class="flex-1 min-w-0 pt-0.5">
                                    <h3 class="text-lg font-extrabold text-slate-900 tracking-tight leading-snug">Request Form E-0 Revision</h3>
                                    <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                                        Return ${facultyName ? `<strong class="text-slate-700">${esc(facultyName)}</strong>'s` : 'this'} Form E-0 so the faculty member can update and resubmit it.
                                    </p>
                                </div>
                            </div>
                            <div>
                                <label for="e0RevisionReasonInput" class="block text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
                                    Revision Remarks <span class="text-rose-600">*</span>
                                </label>
                                <textarea id="e0RevisionReasonInput" rows="4"
                                    placeholder="Specify what should be corrected on this Form E-0 (e.g., verify consultation hours, update degree completion status, or check class schedule)..."
                                    class="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-800 focus:bg-white focus:border-[#621708] focus:ring-2 focus:ring-[#621708]/15 outline-none transition"></textarea>
                                <p id="e0RevisionReasonError" class="hidden text-xs font-semibold text-rose-600 mt-1.5">
                                    <i class="fa-solid fa-circle-exclamation mr-1"></i>Please enter revision remarks so the faculty member knows what to fix.
                                </p>
                            </div>
                        </div>
                        <div class="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button type="button" id="e0RevPromptCancel" class="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold transition shadow-sm">Cancel</button>
                            <button type="button" id="e0RevPromptSubmit" class="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5">
                                <i class="fa-solid fa-rotate-left"></i> Return for Revision
                            </button>
                        </div>
                    </div>
                </div>`;

            const input = document.getElementById('e0RevisionReasonInput');
            const errEl = document.getElementById('e0RevisionReasonError');
            const cleanup = (val) => {
                document.removeEventListener('keydown', onKey);
                root.innerHTML = '';
                resolve(val);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(null);
            };
            document.addEventListener('keydown', onKey);

            document.getElementById('e0RevPromptSubmit')?.addEventListener('click', () => {
                const text = String(input?.value || '').trim();
                if (!text) {
                    errEl?.classList.remove('hidden');
                    input?.focus();
                    return;
                }
                cleanup(text);
            });
            input?.addEventListener('input', () => errEl?.classList.add('hidden'));
            document.getElementById('e0RevPromptCancel')?.addEventListener('click', () => cleanup(null));
            document.getElementById('e0RevPromptBackdrop')?.addEventListener('click', (e) => {
                if (e.target.id === 'e0RevPromptBackdrop') cleanup(null);
            });
            setTimeout(() => input?.focus(), 30);
        });
    }

    function normalizeCoteDept(val) {
        const s = String(val || '').trim().toLowerCase();
        if (!s) return '';
        if (s === 'bsit' || s.includes('information technology')) return 'bsit';
        if (s === 'bsie' || s.includes('industrial engineering')) return 'bsie';
        if (s === 'bit' || s.includes('industrial technology')) return 'bit';
        return s;
    }

    async function rpcCall(name, args) {
        try {
            const client = db();
            if (!client) return { ok: false, value: false };
            const { data, error } = await client.rpc(name, args || {});
            if (error) return { ok: false, value: false, error };
            return { ok: true, value: data === true };
        } catch (e) {
            return { ok: false, value: false, error: e };
        }
    }

    async function rpcBool(name, args) {
        const res = await rpcCall(name, args);
        return res.ok && res.value === true;
    }

    async function identify() {
        const client = db();
        let guard = null;
        if (global.CiteFlowAuthGuard?.ready) {
            try {
                guard = await Promise.race([
                    global.CiteFlowAuthGuard.ready,
                    new Promise((r) => setTimeout(() => r(null), 4000))
                ]);
            } catch (_) {}
        }

        let user = guard?.user || null;
        if (!user && global.CiteFlowAuth?.ensureActiveSession) {
            try {
                const session = await global.CiteFlowAuth.ensureActiveSession(client);
                user = session?.user || null;
            } catch (_) {}
        }
        if (!user && client?.auth?.getUser) {
            try {
                const { data: u } = await client.auth.getUser();
                user = u?.user || null;
            } catch (_) {}
        }

        let fac = null;
        const facCols = 'id, full_name, first_name, last_name, email, department, role, position';
        if (client && user?.id) {
            try {
                const { data } = await client
                    .from('faculty')
                    .select(facCols)
                    .eq('auth_user_id', user.id)
                    .maybeSingle();
                if (data) fac = data;
            } catch (_) {}
        }
        if (!fac && client && guard?.faculty?.id) {
            try {
                const { data } = await client
                    .from('faculty')
                    .select(facCols)
                    .eq('id', guard.faculty.id)
                    .maybeSingle();
                if (data) fac = data;
            } catch (_) {}
        }
        if (!fac && client && user?.email) {
            try {
                const { data } = await client
                    .from('faculty')
                    .select(facCols)
                    .or(`email.ilike.${user.email},existing_email.ilike.${user.email}`)
                    .limit(1);
                if (Array.isArray(data) && data[0]) fac = data[0];
            } catch (_) {}
        }
        if (!fac && guard?.faculty?.id) {
            fac = guard.faculty;
        }

        me.faculty = fac || null;
        me.facultyId = fac?.id ?? null;
        me.department = normalizeCoteDept(fac?.department || '');
        me.isChairRole = /chair/i.test(String(fac?.role || fac?.position || ''));
        me.name = fac?.full_name || [fac?.first_name, fac?.last_name].filter(Boolean).join(' ') || '';

        if (!me.name && client && user?.id) {
            try {
                const { data: ap } = await client
                    .from('admin_profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                me.name = ap?.full_name || [ap?.first_name, ap?.last_name].filter(Boolean).join(' ') || ap?.name || '';
            } catch (_) { /* name stays blank */ }
        }
        if (!me.name && user) {
            me.name = user.user_metadata?.full_name || user.email || '';
        }

        me.isFinal = await rpcBool('wf_is_final_approver');
    }

    function statusPill(status) {
        const st = String(status || 'draft').toLowerCase();
        const cls = st === 'approved' ? 'bg-emerald-100 text-emerald-800'
            : (st === 'submitted' || st === 'chair_certified') ? 'bg-blue-100 text-blue-800'
                : st === 'revision' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700';
        return { text: STATUS_LABELS[st] || st, cls: 'text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ' + cls };
    }

    // ------------------------------------------------------------------
    // Queue (no report selected)
    // ------------------------------------------------------------------
    async function loadQueue() {
        const mount = document.getElementById('reviewQueue');
        if (!mount) return;
        document.getElementById('reviewDetail')?.style.setProperty('display', 'none');
        mount.style.display = 'block';
        mount.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm">Loading Form E-0 submissions...</div>';

        const { data, error } = await db()
            .from('form_e0_reports')
            .select('id, faculty_id, faculty_printed_name, department_name, academic_year, semester, status, submitted_at, grand_total_credits, chair_certified_by_name')
            .neq('status', 'draft')
            .order('submitted_at', { ascending: false, nullsFirst: false })
            .limit(300);
        if (error) {
            mount.innerHTML = `<div class="p-8 text-center text-rose-600 text-sm">Could not load submissions: ${esc(error.message)}</div>`;
            return;
        }
        let rows = (data || []).filter(r => Number(r.faculty_id) !== Number(me.facultyId) || me.isFinal);
        if (!me.isFinal && me.department) {
            rows = rows.filter(r => normalizeCoteDept(r.department_name) === me.department || !r.department_name);
        }
        const pending = me.isFinal ? ['submitted', 'chair_certified'] : ['submitted'];
        const order = r => (pending.includes(r.status) ? 0 : 1);
        rows.sort((a, b) => order(a) - order(b));

        if (!rows.length) {
            mount.innerHTML = '<div class="p-10 text-center text-slate-500 text-sm">No Form E-0 submissions to review.</div>';
            return;
        }
        mount.innerHTML = `
            <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
                        <tr>
                            <th class="p-3 text-left">Faculty</th>
                            <th class="p-3 text-left">Department</th>
                            <th class="p-3 text-left">Term</th>
                            <th class="p-3 text-center">E9 Credits</th>
                            <th class="p-3 text-left">Submitted</th>
                            <th class="p-3 text-left">Status</th>
                            <th class="p-3"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.map(r => {
                            const p = statusPill(r.status);
                            const needs = pending.includes(r.status);
                            return `<tr class="${needs ? 'bg-amber-50/40' : ''}">
                                <td class="p-3 font-semibold text-slate-900">${esc(r.faculty_printed_name || '')}</td>
                                <td class="p-3 text-slate-600">${esc(r.department_name || '')}</td>
                                <td class="p-3 text-slate-600">${esc(E().semesterOrdinal(r.semester))} Sem ${esc(E().formatSchoolYear(r.academic_year))}</td>
                                <td class="p-3 text-center font-bold">${Number(r.grand_total_credits || 0).toFixed(1)}</td>
                                <td class="p-3 text-slate-600">${esc(E().formatDateDisplay((r.submitted_at || '').slice(0, 10)))}</td>
                                <td class="p-3"><span class="${p.cls}">${esc(p.text)}</span></td>
                                <td class="p-3 text-right"><a class="text-xs font-bold text-[#621708] hover:underline" href="?id=${encodeURIComponent(r.id)}">${needs ? 'Review' : 'Open'} &rarr;</a></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    // ------------------------------------------------------------------
    // Single report
    // ------------------------------------------------------------------
    async function loadReport(params) {
        let query = db().from('form_e0_reports').select('*');
        if (params.get('id')) {
            query = query.eq('id', params.get('id'));
        } else {
            query = query.eq('faculty_id', params.get('faculty_id'));
            if (params.get('ay')) {
                const ay = params.get('ay');
                query = query.in('academic_year', Array.from(new Set([ay, E().formatSchoolYear(ay), ay.replace(/\s*TO\s*/i, '-')])));
            }
            if (params.get('sem')) query = query.eq('semester', E().semesterCode(params.get('sem')));
            query = query.order('updated_at', { ascending: false }).limit(1);
        }
        const { data: rep, error } = await query.maybeSingle();
        const mount = document.getElementById('viewerDocMount');
        if (error || !rep) {
            mount.innerHTML = `
                <div class="p-8 text-center">
                    <p class="text-rose-600 font-bold">Form E-0 report not found${error ? ': ' + esc(error.message) : ''}.</p>
                    <a href="?" class="text-xs text-[#621708] underline mt-2 inline-block">Back to the list</a>
                </div>`;
            return;
        }
        reportData = rep;
        const { data: cls } = await db().from('form_e0_classes').select('*').eq('form_e0_id', rep.id).order('sort_order', { ascending: true });
        classesData = cls || [];
        await resolveRole();
        render();
    }

    async function checkChairInScope(facultyId, fallbackDeptName) {
        const rpcRes = await rpcCall('form_e0_chair_in_scope', { p_faculty_id: facultyId });
        if (rpcRes.ok) return rpcRes.value === true;

        // Fallback if migration 039 RPC is not yet deployed on Supabase
        const client = db();
        let hasGrant = !!me.isChairRole;
        if (!hasGrant && global.CiteFlowWorkflow?.currentUserHasChairpersonGrant && me.faculty) {
            try {
                hasGrant = await global.CiteFlowWorkflow.currentUserHasChairpersonGrant(client, me.faculty);
            } catch (_) {}
        }
        if (!hasGrant || !me.department) return false;

        let targetDept = normalizeCoteDept(fallbackDeptName);
        if (client && facultyId != null) {
            try {
                const { data: subFac } = await client
                    .from('faculty')
                    .select('department')
                    .eq('id', facultyId)
                    .maybeSingle();
                if (subFac?.department) targetDept = normalizeCoteDept(subFac.department);
            } catch (_) {}
        }
        return !!targetDept && targetDept === me.department;
    }

    async function resolveRole() {
        const st = String(reportData.status || '').toLowerCase();
        role.isOwner = me.facultyId != null && Number(reportData.faculty_id) === Number(me.facultyId);
        const chairInScope = await checkChairInScope(reportData.faculty_id, reportData.department_name);
        role.canCertify = chairInScope && !role.isOwner && st === 'submitted';
        role.canApprove = me.isFinal && (st === 'submitted' || st === 'chair_certified');
        role.canReturn = (role.canCertify || role.canApprove);
        role.reason = '';
        if (chairInScope && role.isOwner && st === 'submitted') {
            role.reason = 'This is your own Form E-0. A chairperson cannot certify their own report; it goes directly to the Dean.';
        } else if (st === 'submitted' && !chairInScope && !me.isFinal) {
            role.reason = 'Waiting for the Department Chairperson.';
        } else if (st === 'chair_certified' && !me.isFinal) {
            role.reason = 'Certified by the Department Chair. Waiting for the Dean.';
        }
    }

    function render() {
        const r = reportData;
        const pill = statusPill(r.status);
        const pillEl = document.getElementById('viewerStatusPill');
        if (pillEl) { pillEl.textContent = pill.text; pillEl.className = pill.cls; }
        const sub = document.getElementById('viewerSubtitle');
        if (sub) {
            sub.textContent = `${r.faculty_printed_name || 'Faculty'} · ${r.department_name || ''} · ${E().semesterOrdinal(r.semester)} Sem ${E().formatSchoolYear(r.academic_year)}`;
        }

        const model = E().buildSheetModel(r, classesData);
        document.getElementById('viewerDocMount').innerHTML = E().renderSheetHtml(model, { highlightValues: false });

        renderChecks();
        renderActions();
    }

    function renderChecks() {
        const box = document.getElementById('reviewChecks');
        if (!box) return;
        const result = E().validateReport(reportData, classesData);
        const items = result.errors.map(e => ({ kind: 'error', msg: e.message }))
            .concat(result.warnings.map(w => ({ kind: 'warning', msg: w.message })));
        if (reportData.revision_remarks && String(reportData.status) === 'revision') {
            items.unshift({ kind: 'info', msg: `Revision requested${reportData.revision_requested_by_name ? ' by ' + reportData.revision_requested_by_name : ''}: ${reportData.revision_remarks}` });
        }
        if (!items.length) {
            box.className = 'e0-review-checks no-print rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800';
            box.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i> Automatic checks passed: dates, codes, degree statuses and totals are consistent.';
            return;
        }
        box.className = 'e0-review-checks no-print rounded-2xl border border-amber-200 bg-amber-50 p-4';
        box.innerHTML = `<div class="text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-2">Automatic checks</div>
            <ul class="space-y-1 text-xs text-slate-800">${items.map(i => `<li><i class="fa-solid ${i.kind === 'error' ? 'fa-circle-xmark text-rose-600' : (i.kind === 'info' ? 'fa-rotate-left text-amber-700' : 'fa-triangle-exclamation text-amber-600')} mr-1"></i>${esc(i.msg)}</li>`).join('')}</ul>`;
    }

    function renderActions() {
        const box = document.getElementById('reviewActions');
        if (!box) return;
        const btn = (id, label, icon, cls, handler) =>
            `<button type="button" id="${id}" onclick="CiteFlowFormE0Review.${handler}()" class="px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm ${cls}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
        let html = '';
        html += btn('btnExport', 'Export Excel', 'fa-file-excel', 'border border-slate-200 bg-white hover:bg-slate-50 text-emerald-700', 'exportExcel');
        html += btn('btnPrint', 'Print', 'fa-print', 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700', 'print');
        if (role.canCertify) html += btn('btnCertify', 'Certify Correct (Dept. Chair)', 'fa-stamp', 'bg-blue-700 hover:bg-blue-800 text-white', 'certify');
        if (role.canApprove) html += btn('btnApprove', 'Approve (Dean)', 'fa-check', 'bg-emerald-600 hover:bg-emerald-700 text-white', 'approve');
        if (role.canReturn) html += btn('btnRevision', 'Request Revision', 'fa-rotate-left', 'border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900', 'requestRevision');
        if (role.reason) html += `<span class="text-xs text-slate-500 ml-1">${esc(role.reason)}</span>`;
        box.innerHTML = html;
    }

    async function updateReport(patch, successMsg) {
        let res = await db().from('form_e0_reports').update(patch).eq('id', reportData.id).select().single();
        if (res.error && patch.status === 'revision' && /column|schema cache|PGRST204/i.test(`${res.error.code || ''} ${res.error.message || ''}`)) {
            res = await db().from('form_e0_reports').update({
                status: 'revision',
                chair_remarks: patch.revision_remarks || null
            }).eq('id', reportData.id).select().single();
        }
        if (res.error) {
            toast('Action failed: ' + res.error.message, 'error');
            return false;
        }
        reportData = res.data;
        await resolveRole();
        render();
        toast(successMsg, 'success');
        return true;
    }

    async function certify() {
        if (!role.canCertify) return;
        const result = E().validateReport(reportData, classesData);
        const hasErrors = result.errors.length > 0;
        const confirmed = await showConfirmModal({
            title: hasErrors ? 'Certify Form E-0 with Warnings?' : 'Certify Form E-0 (Department Chair)',
            message: hasErrors
                ? `Automatic checks found ${result.errors.length} issue(s) on this Form E-0.\n\nCertify as correct anyway? Your name will be recorded on line E2 (Department Chair).`
                : 'Certify this Form E-0 as correct? Your name and date will appear on line E2 (Department Chair), and the report will be forwarded to the College Dean.',
            type: hasErrors ? 'warning' : 'info',
            confirmText: 'Certify Correct',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;
        await updateReport({
            status: 'chair_certified',
            chair_certified_at: new Date().toISOString(),
            chair_certified_by_name: me.name || 'Department Chair'
        }, 'Certified. The form now goes to the Dean.');
    }

    async function approve() {
        if (!role.canApprove) return;
        const skipping = String(reportData.status) === 'submitted';
        const message = skipping
            ? (role.isOwner || !reportData.chair_certified_at
                ? 'This Form E-0 has not been certified by a Department Chair (for example, when the faculty member is the chairperson).\n\nApprove it directly as College Dean? Your name will appear on line E3.'
                : 'Approve this Form E-0 as College Dean? Your name will appear on line E3.')
            : 'Approve this Form E-0? Your name and date will appear on line E3 (College Dean).';
        const confirmed = await showConfirmModal({
            title: 'Approve Form E-0 (College Dean)',
            message,
            type: skipping ? 'warning' : 'success',
            confirmText: 'Approve Form E-0',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;
        await updateReport({
            status: 'approved',
            final_approved_at: new Date().toISOString(),
            final_approved_by_name: me.name || 'College Dean',
            final_approver_role: 'Dean'
        }, 'Form E-0 approved.');
    }

    async function requestRevision() {
        if (!role.canReturn) return;
        const reason = await showRevisionModal(reportData?.faculty_printed_name || '');
        if (!reason || !reason.trim()) return;
        await updateReport({
            status: 'revision',
            revision_remarks: reason.trim(),
            revision_requested_at: new Date().toISOString(),
            revision_requested_by_name: me.name || null
        }, 'Revision requested. The faculty member can now edit and resubmit.');
    }

    async function exportExcel() {
        if (!reportData) return;
        try {
            await E().exportToExcel(reportData, classesData);
        } catch (err) {
            toast('Excel export failed: ' + err.message, 'error');
        }
    }

    function print() {
        window.print();
    }

    async function init() {
        if (!db() || !E()) return;
        await identify();
        const params = new URLSearchParams(window.location.search);
        if (params.get('id') || params.get('faculty_id')) {
            document.getElementById('reviewQueue')?.style.setProperty('display', 'none');
            document.getElementById('reviewDetail')?.style.setProperty('display', 'block');
            await loadReport(params);
        } else {
            await loadQueue();
        }
    }

    global.CiteFlowFormE0Review = { init, certify, approve, requestRevision, exportExcel, print };
    document.addEventListener('DOMContentLoaded', function () {
        // Give auth/session scripts a tick to restore the session.
        setTimeout(init, 0);
    });
})(typeof window !== 'undefined' ? window : globalThis);
