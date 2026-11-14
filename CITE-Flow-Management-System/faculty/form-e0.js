/**
 * CITE-Flow: Form E-0 Faculty Studio Controller
 * Handles session resolution, automatic account & workload reflection from Supabase,
 * real-time matrix computations, CTU official preview rendering, and submissions.
 */
(function initCiteFlowFormE0(global) {
    'use strict';

    let supabaseClient = null;
    let currentAuthUser = null;
    let currentFaculty = null;
    let targetFaculty = null;
    let targetFacultyId = null;
    let accountBundle = null;
    let activeReport = null;
    let activeClasses = [];
    let isDirty = false;
    let suppressDirty = false;
    let bypassUnsavedGuard = false;
    let currentMode = 'editor';
    let previewZoom = 0.68;
    let isChairpersonUser = false;
    let lastValidation = null;

    const LOCKED_STATUSES = ['submitted', 'chair_certified', 'approved'];
    const REPORT_COLUMNS = [
        'faculty_id', 'academic_year', 'semester', 'status',
        'college_name', 'department_name', 'discipline_code',
        'faculty_printed_name', 'faculty_last_name', 'faculty_first_name', 'faculty_middle_initial',
        'email', 'phone', 'birthdate', 'original_appointment_date', 'gender',
        'tenure_status_code', 'employment_type_code', 'has_plantilla_item', 'salary_charge_to',
        'generic_rank_code', 'salary_grade', 'annual_basic_salary', 'lecturer_fee_per_hour', 'is_active_duty',
        'leave_without_pay', 'leave_with_pay', 'degrees_snapshot',
        'primary_discipline_teaching', 'secondary_discipline_teaching',
        'non_teaching_credits', 'subtotal_non_teaching', 'subtotal_teaching', 'grand_total_credits',
        'consultation_hours', 'summary_matrix_units', 'summary_matrix_hours',
        'is_signed_by_chair_proxy', 'chair_proxy_reason'
    ];
    const OPTIONAL_039_COLUMNS = ['faculty_last_name', 'faculty_first_name', 'faculty_middle_initial'];
    const NT_KEYS = ['admin', 'research', 'extension', 'production', 'study', 'others'];

    function engine() {
        return global.CiteFlowFormE0Engine;
    }

    function getDb() {
        if (!supabaseClient) {
            supabaseClient = global.CiteFlowAuth?.ensureSharedClient?.()
                || global.CiteFlowWorkflow?.getSupabaseClient?.()
                || global.supabaseClient
                || null;
        }
        return supabaseClient;
    }

    function esc(val) {
        return String(val ?? '').replace(/[&<>'"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
        });
    }

    // ------------------------------------------------------------------
    // System-consistent Toasts & Designed Modals (NO native alert/confirm)
    // ------------------------------------------------------------------
    function showToast(msg, type) {
        if (global.CiteFlowUI && typeof global.CiteFlowUI.toast === 'function') {
            global.CiteFlowUI.toast(msg, type || 'info');
            return;
        }
        if (typeof global.showToast === 'function' && global.showToast !== showToast) {
            global.showToast(msg, type || 'info');
            return;
        }
        let toast = document.getElementById('citeflowGlobalToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'citeflowGlobalToast';
            toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:11px 22px;border-radius:14px;font-size:13.5px;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,.25);z-index:100001;display:flex;align-items:center;gap:10px;';
            document.body.appendChild(toast);
        }
        toast.textContent = String(msg || '');
        toast.style.opacity = '1';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { toast.style.opacity = '0'; }, 3500);
    }

    function showModalDialog(options) {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        if (global.CiteFlowUI && typeof global.CiteFlowUI.dialog === 'function') {
            return global.CiteFlowUI.dialog({
                title: opts.title || 'Notice',
                message: opts.message || '',
                type: opts.type || 'info',
                confirmText: opts.confirmText || 'OK',
                cancelText: opts.cancelText || null
            });
        }
        // Fallback designed modal matching system-ui.js if script is still deferring
        return new Promise(function (resolve) {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs';
            const iconBg = opts.type === 'warning' ? 'bg-amber-50 text-amber-600 border border-amber-200'
                : opts.type === 'error' ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : opts.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'bg-[#fbf1ef] text-[#621708] border border-[#e8d0cb]';
            const iconCls = opts.type === 'warning' ? 'fa-triangle-exclamation'
                : opts.type === 'error' ? 'fa-circle-xmark'
                    : opts.type === 'success' ? 'fa-circle-check'
                        : 'fa-circle-info';
            overlay.innerHTML = `
                <div class="bg-white rounded-[2rem] w-full max-w-md shadow-2xl border border-slate-100 p-6 sm:p-7 text-center">
                    <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 text-xl ${iconBg}">
                        <i class="fa-solid ${iconCls}"></i>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900 leading-snug">${esc(opts.title || 'Notice')}</h3>
                    <div class="text-sm text-slate-600 mt-2.5 leading-relaxed whitespace-pre-line">${esc(opts.message || '')}</div>
                    <div class="mt-6 flex items-center justify-center gap-3">
                        ${opts.cancelText ? `<button type="button" data-modal-cancel class="flex-1 px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">${esc(opts.cancelText)}</button>` : ''}
                        <button type="button" data-modal-confirm class="${opts.cancelText ? 'flex-1' : 'w-full'} py-2.5 px-6 rounded-xl font-semibold text-sm text-white bg-[#621708] hover:bg-[#450f05] transition-colors shadow-sm cursor-pointer">${esc(opts.confirmText || 'OK')}</button>
                    </div>
                </div>`;
            const close = function (val) { overlay.remove(); resolve(val); };
            overlay.querySelector('[data-modal-confirm]')?.addEventListener('click', function () { close(true); });
            overlay.querySelector('[data-modal-cancel]')?.addEventListener('click', function () { close(false); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
            document.body.appendChild(overlay);
        });
    }

    function blankToNull(val) {
        return val === '' || val === undefined ? null : val;
    }

    function numOrNull(val) {
        if (val === '' || val == null) return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
    }

    function currentTermDefaults() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const startYear = m >= 7 ? y : y - 1;
        const sem = (m >= 8 && m <= 12) ? '1' : ((m >= 1 && m <= 5) ? '2' : 'SUMMER');
        return { ay: `${startYear}-${startYear + 1}`, sem };
    }

    function isLocked() {
        return LOCKED_STATUSES.includes(String(activeReport?.status || 'draft').toLowerCase());
    }

    function ayKey(ay) {
        const m = /(\d{4})\D+(\d{4})/.exec(String(ay || ''));
        return m ? `${m[1]}-${m[2]}` : String(ay || '').trim();
    }

    // ------------------------------------------------------------------
    // Session & Account Resolution
    // ------------------------------------------------------------------
    async function waitWithTimeout(promise, ms) {
        if (!promise || typeof promise.then !== 'function') return null;
        return Promise.race([
            Promise.resolve(promise).catch(function () { return null; }),
            new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); })
        ]);
    }

    async function safeSupabaseQuery(runQuery, fallbackData) {
        try {
            const res = await runQuery();
            if (!res || res.error) return { data: fallbackData, error: res?.error || null };
            return { data: res.data ?? fallbackData, error: null };
        } catch (err) {
            console.warn('[Form E-0] Supabase query warning:', err);
            return { data: fallbackData, error: err };
        }
    }

    function getCachedUserFallback() {
        try {
            if (global.CiteFlowAuth?.getCachedUser) {
                const u = global.CiteFlowAuth.getCachedUser();
                if (u) return u;
            }
            const raw = localStorage.getItem('citeflow_user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    async function resolveAuthenticatedFaculty() {
        const db = getDb();
        const guard = await waitWithTimeout(global.CiteFlowAuthGuard?.ready, 4500) || global.CiteFlowAuthGuard || null;
        let session = guard?.session || null;
        if (!session?.user && global.CiteFlowAuth?.ensureActiveSession && db) {
            session = await waitWithTimeout(global.CiteFlowAuth.ensureActiveSession(db), 4500);
        }
        if (!session?.user && db?.auth?.getSession) {
            try {
                const res = await db.auth.getSession();
                session = res?.data?.session || null;
            } catch (_) {}
        }

        const user = guard?.user || session?.user || null;
        currentAuthUser = user;
        const cached = getCachedUserFallback() || {};
        const meta = user?.user_metadata || {};

        let facRow = null;

        // 1. Query full faculty row by auth_user_id
        if (db && user?.id) {
            try {
                const byAuth = await db
                    .from('faculty')
                    .select('*')
                    .eq('auth_user_id', user.id)
                    .order('id', { ascending: true })
                    .limit(1)
                    .maybeSingle();
                if (!byAuth.error && byAuth.data) facRow = byAuth.data;
            } catch (e) {
                console.warn('[Form E-0] Faculty lookup by auth_user_id failed:', e);
            }
        }

        // 2. Query full faculty row by guard.faculty.id if numeric
        if (!facRow && db && guard?.faculty?.id != null && /^\d+$/.test(String(guard.faculty.id))) {
            try {
                const byGuardId = await db
                    .from('faculty')
                    .select('*')
                    .eq('id', Number(guard.faculty.id))
                    .maybeSingle();
                if (!byGuardId.error && byGuardId.data) facRow = byGuardId.data;
            } catch (e) {
                console.warn('[Form E-0] Faculty lookup by guard id failed:', e);
            }
        }

        // 3. Query full faculty row by verified email (with fallback if existing_email column is absent)
        const lookupEmail = String(user?.email || cached.email || '').trim().toLowerCase();
        if (!facRow && db && lookupEmail && lookupEmail.includes('@')) {
            try {
                let byEmail = await db
                    .from('faculty')
                    .select('*')
                    .or(`email.ilike.${lookupEmail},existing_email.ilike.${lookupEmail}`)
                    .order('id', { ascending: true })
                    .limit(5);
                if (byEmail.error || !byEmail.data?.length) {
                    byEmail = await db
                        .from('faculty')
                        .select('*')
                        .ilike('email', lookupEmail)
                        .order('id', { ascending: true })
                        .limit(5);
                }
                const rows = byEmail.data || [];
                facRow = rows.find(function (r) { return user?.id && String(r.auth_user_id || '') === String(user.id); })
                    || rows.find(function (r) { return !r.auth_user_id; })
                    || (!user?.id ? rows[0] : null)
                    || null;
            } catch (e) {
                console.warn('[Form E-0] Faculty lookup by email failed:', e);
            }
        }

        // 4. Enrich any missing fields from auth metadata & cached user so account info always reflects
        const merged = Object.assign({
            first_name: meta.first_name || cached.first_name || '',
            middle_name: meta.middle_name || cached.middle_name || '',
            last_name: meta.last_name || cached.last_name || '',
            full_name: meta.full_name || cached.full_name || cached.name || '',
            email: user?.email || cached.email || '',
            department: meta.department || cached.department || 'BSIT',
            academic_rank: meta.academic_rank || cached.academic_rank || cached.rank || '',
            designation: meta.designation || cached.designation || '',
            phone: meta.phone || cached.phone || '',
            sex: meta.sex || meta.gender || cached.sex || ''
        }, facRow || {});

        if (facRow) {
            if (!merged.email) merged.email = user?.email || cached.email || '';
            if (!merged.designation && meta.designation) merged.designation = meta.designation;
            if (!merged.first_name && meta.first_name) merged.first_name = meta.first_name;
            if (!merged.last_name && meta.last_name) merged.last_name = meta.last_name;
            if (!merged.middle_name && meta.middle_name) merged.middle_name = meta.middle_name;
        }
        if (merged.id != null && /^\d+$/.test(String(merged.id))) {
            merged.id = Number(merged.id);
        }

        return merged;
    }

    async function fetchAccountBundle(facultyId, baseFaculty) {
        const db = getDb();
        const bundle = {
            faculty: baseFaculty || {},
            teachingLoads: [],
            adminLoads: [],
            researchProjects: [],
            postgraduateRows: []
        };
        if (!db || !facultyId || !/^\d+$/.test(String(facultyId))) {
            return bundle;
        }
        const fid = Number(facultyId);

        const [facRes, loadsRes, adminRes, researchRes, postgradRes] = await Promise.all([
            safeSupabaseQuery(function () { return db.from('faculty').select('*').eq('id', fid).maybeSingle(); }, null),
            safeSupabaseQuery(function () { return db.from('faculty_teaching_loads').select('*').eq('faculty_id', fid).order('created_at', { ascending: true }); }, []),
            safeSupabaseQuery(function () { return db.from('faculty_admin_role_loads').select('*').eq('faculty_id', fid); }, []),
            safeSupabaseQuery(function () { return db.from('faculty_research_projects').select('*').eq('faculty_id', fid).order('created_at', { ascending: false }); }, []),
            safeSupabaseQuery(function () { return db.from('mfo_pi6_postgraduate').select('*').eq('faculty_id', fid).order('created_at', { ascending: false }); }, [])
        ]);

        if (facRes?.data) {
            bundle.faculty = Object.assign({}, baseFaculty || {}, facRes.data);
            if (!bundle.faculty.email && currentAuthUser?.email) bundle.faculty.email = currentAuthUser.email;
            if (!bundle.faculty.designation && currentAuthUser?.user_metadata?.designation) {
                bundle.faculty.designation = currentAuthUser.user_metadata.designation;
            }
        }
        const notArchived = function (r) { return String(r?.status || '').trim().toLowerCase() !== 'archived'; };
        bundle.teachingLoads = (Array.isArray(loadsRes?.data) ? loadsRes.data : []).filter(notArchived);
        bundle.adminLoads = (Array.isArray(adminRes?.data) ? adminRes.data : []).filter(notArchived);
        bundle.researchProjects = Array.isArray(researchRes?.data) ? researchRes.data : [];
        bundle.postgraduateRows = Array.isArray(postgradRes?.data) ? postgradRes.data : [];
        return bundle;
    }

    // ------------------------------------------------------------------
    // Init & Loading
    // ------------------------------------------------------------------
    async function init() {
        getDb();
        populateRankOptions();

        const params = new URLSearchParams(window.location.search);
        const fallbackTerm = currentTermDefaults();
        let initialAY = params.get('ay') || fallbackTerm.ay;
        let initialSem = params.get('sem') || fallbackTerm.sem;

        // Render an immediate valid sheet & form right away so Preview is never blank while loading
        const cachedUser = getCachedUserFallback() || {};
        activeReport = createInitialReport(null, initialAY, initialSem, cachedUser, null);
        activeClasses = [];
        populateFormUI();
        recalculateTotals();
        renderOfficialPreview();

        // Check system-configured active academic period if not overridden in URL
        if (!params.get('ay') && !params.get('sem') && global.CiteFlowSettings?.getAcademicPeriod) {
            try {
                const sysPeriod = await waitWithTimeout(global.CiteFlowSettings.getAcademicPeriod(), 2500);
                if (sysPeriod) {
                    if (sysPeriod.academic_year) initialAY = sysPeriod.academic_year;
                    if (sysPeriod.semester) initialSem = sysPeriod.semester;
                }
            } catch (_) {}
        }

        const hasExplicitTerm = Boolean(params.get('ay') || params.get('sem'));
        try {
            currentFaculty = await resolveAuthenticatedFaculty();
            const numericOwnId = (currentFaculty?.id != null && /^\d+$/.test(String(currentFaculty.id)))
                ? Number(currentFaculty.id)
                : null;
            targetFacultyId = params.get('faculty_id') ? Number(params.get('faculty_id')) : numericOwnId;

            isChairpersonUser = await detectChairperson(numericOwnId);
            const reviewLink = document.getElementById('btnChairReview');
            if (reviewLink) reviewLink.style.display = isChairpersonUser ? 'inline-flex' : 'none';
            const proxySec = document.getElementById('proxySection');
            if (proxySec) {
                const fillingForOther = numericOwnId && targetFacultyId && Number(targetFacultyId) !== Number(numericOwnId);
                proxySec.style.display = isChairpersonUser && fillingForOther ? 'block' : 'none';
            }

            await loadReport(targetFacultyId, initialAY, initialSem, { allowTermFallback: !hasExplicitTerm });
        } catch (err) {
            console.error('[Form E-0] Initialization error:', err);
        }
    }

    async function detectChairperson(facultyId) {
        const db = getDb();
        if (!db || !facultyId) return false;
        try {
            const { data, error } = await db.rpc('wf_current_user_has_chairperson_grant');
            if (!error) return data === true;
        } catch (e) { /* fall back below */ }
        try {
            const { data } = await db
                .from('wf_delegated_access')
                .select('id')
                .eq('grantee_faculty_id', facultyId)
                .eq('is_active', true)
                .limit(1);
            return !!(data && data.length);
        } catch (e) {
            return false;
        }
    }

    async function querySavedReportForTerm(db, facultyId, academicYear, semester) {
        if (!db || !facultyId || !/^\d+$/.test(String(facultyId))) return { report: null, classes: [] };
        const E = engine();
        const ayVariants = Array.from(new Set([ayKey(academicYear), E.formatSchoolYear(academicYear), String(academicYear || '').trim()].filter(Boolean)));
        const semCode = E.semesterCode(semester);
        try {
            const { data } = await db
                .from('form_e0_reports')
                .select('*')
                .eq('faculty_id', Number(facultyId))
                .in('academic_year', ayVariants)
                .eq('semester', semCode)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!data) return { report: null, classes: [] };
            const classesRes = await db
                .from('form_e0_classes')
                .select('*')
                .eq('form_e0_id', data.id)
                .order('sort_order', { ascending: true });
            return { report: data, classes: classesRes.data || [] };
        } catch (e) {
            console.warn('[Form E-0] Could not query saved Form E-0 report:', e);
            return { report: null, classes: [] };
        }
    }

    async function loadReport(facultyId, academicYear, semester, options) {
        const opts = options || {};
        const db = getDb();
        const E = engine();
        const baseFac = (facultyId && Number(facultyId) === Number(currentFaculty?.id)) ? currentFaculty : {};
        accountBundle = await fetchAccountBundle(facultyId, baseFac);
        targetFaculty = accountBundle.faculty || baseFac || {};

        let effectiveAY = academicYear;
        let effectiveSem = semester;
        let found = await querySavedReportForTerm(db, facultyId, effectiveAY, effectiveSem);
        let savedReport = found.report;
        let savedClasses = found.classes;

        // On initial auto-load (when no saved report exists in the default term and no classes match it,
        // yet the faculty has active teaching loads in the database), automatically align to that term
        // so both profile AND teaching load rows reflect immediately.
        if (!savedReport && opts.allowTermFallback && accountBundle.teachingLoads.length > 0) {
            const currentTermClasses = filterTermTeachingLoads(accountBundle.teachingLoads, effectiveAY, effectiveSem);
            if (currentTermClasses.length === 0) {
                const alt = findLatestAvailableLoadTerm(accountBundle.teachingLoads);
                if (alt && (alt.ay !== ayKey(effectiveAY) || alt.sem !== E.semesterCode(effectiveSem))) {
                    effectiveAY = alt.ay;
                    effectiveSem = alt.sem;
                    found = await querySavedReportForTerm(db, facultyId, effectiveAY, effectiveSem);
                    savedReport = found.report;
                    savedClasses = found.classes;
                }
            }
        }

        if (savedReport) {
            activeReport = savedReport;
            activeClasses = savedClasses;
            // When still editable (draft / revision), backfill any blank fields from the account DB
            if (!isLocked()) {
                const fresh = createInitialReport(facultyId, activeReport.academic_year, activeReport.semester, targetFaculty, accountBundle);
                mergeAccountIntoReport(activeReport, fresh, false);
                if (activeClasses.length === 0) {
                    activeClasses = filterTermTeachingLoads(accountBundle.teachingLoads, activeReport.academic_year, activeReport.semester);
                }
            }
        } else {
            activeReport = createInitialReport(facultyId, effectiveAY, effectiveSem, targetFaculty, accountBundle);
            activeClasses = filterTermTeachingLoads(accountBundle.teachingLoads, effectiveAY, effectiveSem);
        }

        isDirty = false;
        populateFormUI();
        recalculateTotals();
        applyLockState();
        renderRevisionBanner();
        renderOfficialPreview();
    }

    // ------------------------------------------------------------------
    // Mapping Account Profile, Degrees, Leaves & Loads -> Form E-0
    // ------------------------------------------------------------------
    function splitName(f) {
        if (f.first_name || f.last_name) {
            return {
                first: String(f.first_name || '').trim(),
                last: String(f.last_name || '').trim(),
                mi: String(f.middle_name || '').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()
            };
        }
        const parts = String(f.full_name || f.name || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length < 2) return { first: parts[0] || '', last: '', mi: '' };
        const last = parts.pop();
        let mi = '';
        if (parts.length > 1 && /^[A-Za-z]\.?$/.test(parts[parts.length - 1])) {
            mi = parts.pop().charAt(0).toUpperCase();
        }
        return { first: parts.join(' '), last, mi };
    }

    function departmentInfo(dept) {
        // COTE departments only: BSIT, BSIE, BIT
        const d = String(dept || '').trim();
        if (/^bsit$|information\s+technology/i.test(d)) return { name: 'Information Technology', code: '464108' };
        if (/^bsie$|industrial\s+engineering/i.test(d)) return { name: 'Industrial Engineering', code: '542600' };
        if (/^bit$|industrial\s+technology/i.test(d)) return { name: 'Industrial Technology', code: '549900' };
        return { name: d, code: '' };
    }

    function deriveDegreesFromAccount(f, postgradRows, defaultDiscCode) {
        const degrees = [];
        const qual = String(f.educational_qualification || '').trim();
        const baccRaw = String(f.bachelors_degree || f.baccalaureate_degree || '').trim()
            || (/^(bachelor|bs|ba|ab|bit|btech|bsit|bscs|bsis|bsie|bsme|bsee|bsce|bscpe|bsed|beed)\b/i.test(qual) ? qual : '');
        if (baccRaw) {
            degrees.push({
                level: 'BACC',
                degree_title: baccRaw.toUpperCase(),
                status_code: '1',
                date_completed: '',
                institution_name: '',
                discipline_code: /information\s+tech|\bbsit\b/i.test(baccRaw) ? '464108' : (defaultDiscCode || '')
            });
        }

        const pgList = Array.isArray(postgradRows) ? postgradRows : [];
        const pgMasters = pgList.find(function (r) { return /\b(master|ms|ma|mit|mba|meng|mat|mpa)\b/i.test(String(r.program_enrolled || '')); });
        const pgDoc = pgList.find(function (r) { return /\b(doctor|phd|ph\.d|dit|edd|ed\.d|dba|deng)\b/i.test(String(r.program_enrolled || '')); });

        const mastersRaw = String(f.masters_degree || '').trim() || String(pgMasters?.program_enrolled || '').trim();
        if (mastersRaw && !/^(n\/?a|none|-)$/i.test(mastersRaw)) {
            const pursuing = !f.masters_degree && pgMasters
                ? true
                : /\b(ongoing|pursuing|units|car|enrolled|candidate)\b/i.test(mastersRaw);
            degrees.push({
                level: 'MASTERS',
                degree_title: mastersRaw.replace(/\s*\((ongoing|pursuing|car|units[^)]*)\)\s*/ig, '').trim().toUpperCase(),
                status_code: pursuing ? '2' : '1',
                date_completed: '',
                institution_name: String(pgMasters?.institution_name || '').trim().toUpperCase(),
                discipline_code: /information\s+tech|\bmit\b|\bmsit\b/i.test(mastersRaw) ? '464108' : '',
                wrote_thesis: false
            });
        }

        const docRaw = String(f.doctorate_degree || '').trim() || String(pgDoc?.program_enrolled || '').trim();
        if (docRaw && !/^(n\/?a|none|-)$/i.test(docRaw)) {
            const pursuingDoc = !f.doctorate_degree && pgDoc
                ? true
                : /\b(ongoing|pursuing|units|car|enrolled|candidate)\b/i.test(docRaw);
            degrees.push({
                level: 'DOCTORAL',
                degree_title: docRaw.replace(/\s*\((ongoing|pursuing|car|units[^)]*)\)\s*/ig, '').trim().toUpperCase(),
                status_code: pursuingDoc ? '2' : '1',
                date_completed: '',
                institution_name: String(pgDoc?.institution_name || '').trim().toUpperCase(),
                discipline_code: /information\s+tech|\bdit\b/i.test(docRaw) ? '464108' : '',
                wrote_dissertation: !pursuingDoc
            });
        }

        return degrees;
    }

    function parseConsultationFromAccount(raw) {
        const empty = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '' };
        if (!raw) return empty;
        if (typeof raw === 'object') {
            return {
                mon: String(raw.mon || '').trim(),
                tue: String(raw.tue || '').trim(),
                wed: String(raw.wed || '').trim(),
                thu: String(raw.thu || '').trim(),
                fri: String(raw.fri || '').trim(),
                sat: String(raw.sat || '').trim()
            };
        }
        const text = String(raw).trim();
        const m = text.match(/^(mon|tue|wed|thu|fri|sat)[a-z]*\s*[–—-]\s*(mon|tue|wed|thu|fri|sat)[a-z]*\s*:\s*(.+)$/i);
        if (m) {
            const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const sIdx = order.indexOf(m[1].slice(0, 3).toLowerCase());
            const eIdx = order.indexOf(m[2].slice(0, 3).toLowerCase());
            if (sIdx !== -1 && eIdx >= sIdx) {
                for (let i = sIdx; i <= eIdx; i++) empty[order[i]] = m[3].trim();
                return empty;
            }
        }
        return empty;
    }

    function createInitialReport(facultyId, academicYear, semester, f, bundle) {
        f = f || {};
        const E = engine();
        const name = splitName(f);
        const dept = departmentInfo(f.department);
        const discCode = String(f.primary_discipline_code || dept.code || '').replace(/\.0+$/, '');

        const empText = `${f.employment_type || ''} ${f.contract_type || ''} ${f.academic_rank || ''}`.toLowerCase();
        const isPartTimeOrCos = /part[-\s]?time|job\s*order|contract\s*of\s*service|\bcos\b|lecturer|visiting/.test(empText);
        const isProbOrTemp = /probationary|temporary|contractual|casual/.test(empText);

        let empCode = E.normalizeCode(f.employment_type_code);
        if (!empCode || (empCode === '1' && /part[-\s]?time/.test(empText))) {
            empCode = /part[-\s]?time/.test(empText) ? '3' : (/half[-\s]?time/.test(empText) ? '2' : '1');
        }

        let tenureCode = E.normalizeCode(f.tenure_status_code);
        if (!tenureCode || (tenureCode === '1' && (isPartTimeOrCos || isProbOrTemp))) {
            tenureCode = isPartTimeOrCos ? '3' : (isProbOrTemp ? '2' : '1');
        }

        const hasPlantilla = f.has_plantilla_item !== undefined && f.has_plantilla_item !== null
            ? (tenureCode === '3' ? false : Boolean(f.has_plantilla_item))
            : tenureCode !== '3';

        const rankText = f.academic_rank || f.position || '';
        const rankCode = E.normalizeRankCode(f.generic_rank_code) || E.rankCodeFromText(rankText);
        const inferredSG = E.sslGradeFromRank ? E.sslGradeFromRank(rankText) : null;
        const sg = (f.salary_grade != null && f.salary_grade !== '') ? f.salary_grade : (hasPlantilla && inferredSG ? inferredSG : '');

        // Active duty & leave status from faculty.status
        const facStatus = String(f.status || 'Active').trim();
        const onLeave = /^on\s+/i.test(facStatus);
        const leaveWithPay = {
            start_date: onLeave && f.leave_start_date ? (E.toYMD(f.leave_start_date) || '') : '',
            end_date: onLeave && f.leave_end_date ? (E.toYMD(f.leave_end_date) || '') : '',
            leave_type_code: onLeave ? facStatus.replace(/^on\s+/i, '').toUpperCase() : ''
        };

        // Non-teaching credits from designation, admin role loads, and active research
        const nt = {};
        NT_KEYS.forEach(function (k) { nt[k] = { credits: 0, start_date: '', end_date: '', details: '' }; });
        if (f.designation) nt.admin.details = String(f.designation).trim();

        const semCode = E.semesterCode(semester);
        const normAY = E.formatSchoolYear(academicYear);
        if (bundle && Array.isArray(bundle.adminLoads) && bundle.adminLoads.length) {
            const termAdmin = bundle.adminLoads.filter(function (a) {
                return (!a.academic_year || E.formatSchoolYear(a.academic_year) === normAY) &&
                    (!a.semester || E.semesterCode(a.semester) === semCode);
            });
            const adminSource = termAdmin.length ? termAdmin : bundle.adminLoads;
            const adminUnits = adminSource.reduce(function (sum, a) { return sum + (Number(a.units) || 0); }, 0);
            const adminTitles = Array.from(new Set(adminSource.map(function (a) {
                return [a.role_title, a.designation].filter(Boolean).join(' - ');
            }).filter(Boolean))).join('; ');
            if (adminUnits > 0) nt.admin.credits = adminUnits;
            if (adminTitles && !nt.admin.details) nt.admin.details = adminTitles;
        }

        if (bundle && Array.isArray(bundle.researchProjects) && bundle.researchProjects.length) {
            const ongoing = bundle.researchProjects.find(function (p) { return /ongoing/i.test(String(p.status || '')); });
            if (ongoing) {
                nt.research.details = String(ongoing.title || '').trim();
                nt.research.start_date = E.toYMD(ongoing.start_date) || '';
                nt.research.end_date = E.toYMD(ongoing.end_date) || '';
            }
        }

        if (/study\s+leave/i.test(facStatus)) {
            nt.study.details = 'Official Study Leave';
            nt.study.start_date = leaveWithPay.start_date;
            nt.study.end_date = leaveWithPay.end_date;
        }

        const miDot = name.mi ? name.mi + '.' : '';
        const printed = [name.first, miDot, name.last].filter(Boolean).join(' ') || f.full_name || f.name || '';

        return {
            faculty_id: facultyId,
            academic_year: ayKey(academicYear),
            semester: semCode || '1',
            status: 'draft',
            college_name: f.college_name || 'Technology and Engineering',
            department_name: dept.name || '',
            discipline_code: discCode,
            faculty_printed_name: printed,
            faculty_last_name: name.last,
            faculty_first_name: name.first,
            faculty_middle_initial: name.mi,
            email: f.email || f.existing_email || '',
            phone: f.phone || '',
            birthdate: E.toYMD(f.birthdate) || '',
            original_appointment_date: E.toYMD(f.original_appointment_date || f.start_date) || '',
            gender: E.normalizeGender ? E.normalizeGender(f.sex || f.gender) : String(f.sex || f.gender || '').toUpperCase(),
            tenure_status_code: tenureCode,
            employment_type_code: empCode,
            has_plantilla_item: hasPlantilla,
            salary_charge_to: f.salary_charge_to || 'PS ITEM',
            generic_rank_code: rankCode,
            salary_grade: sg,
            annual_basic_salary: f.annual_basic_salary ?? f.salary ?? '',
            lecturer_fee_per_hour: f.lecturer_fee_per_hour ?? '',
            is_active_duty: !onLeave,
            leave_without_pay: { start_date: '', end_date: '', leave_type_code: '' },
            leave_with_pay: leaveWithPay,
            degrees_snapshot: deriveDegreesFromAccount(f, bundle?.postgraduateRows, discCode),
            primary_discipline_teaching: discCode,
            secondary_discipline_teaching: String(f.secondary_discipline_code || '').replace(/\.0+$/, ''),
            non_teaching_credits: nt,
            consultation_hours: parseConsultationFromAccount(f.consultation_hours)
        };
    }

    function mergeAccountIntoReport(target, fresh, overwriteExisting) {
        const scalarKeys = [
            'faculty_last_name', 'faculty_first_name', 'faculty_middle_initial',
            'email', 'phone', 'birthdate', 'original_appointment_date', 'gender',
            'tenure_status_code', 'employment_type_code', 'salary_charge_to',
            'generic_rank_code', 'salary_grade', 'annual_basic_salary', 'lecturer_fee_per_hour',
            'college_name', 'department_name', 'discipline_code',
            'primary_discipline_teaching', 'secondary_discipline_teaching'
        ];
        scalarKeys.forEach(function (k) {
            const cur = target[k];
            const nxt = fresh[k];
            if (nxt === '' || nxt == null) return;
            if (overwriteExisting || cur === '' || cur == null) {
                target[k] = nxt;
            }
        });
        if (overwriteExisting || !target.faculty_printed_name) {
            target.faculty_printed_name = fresh.faculty_printed_name || target.faculty_printed_name;
        }
        if (overwriteExisting && fresh.has_plantilla_item !== undefined) {
            target.has_plantilla_item = fresh.has_plantilla_item;
        }

        // Backfill missing degrees by level
        const E = engine();
        const existingDegrees = Array.isArray(target.degrees_snapshot) ? target.degrees_snapshot.slice() : [];
        (fresh.degrees_snapshot || []).forEach(function (fd) {
            const idx = existingDegrees.findIndex(function (d) { return String(d.level || '').toUpperCase() === fd.level; });
            if (idx === -1) {
                existingDegrees.push(fd);
            } else if (overwriteExisting || (!existingDegrees[idx].degree_title && fd.degree_title)) {
                existingDegrees[idx] = Object.assign({}, fd, overwriteExisting ? {} : existingDegrees[idx], {
                    degree_title: existingDegrees[idx].degree_title || fd.degree_title,
                    status_code: E.normalizeCode(existingDegrees[idx].status_code) || fd.status_code,
                    institution_name: existingDegrees[idx].institution_name || fd.institution_name,
                    discipline_code: existingDegrees[idx].discipline_code || fd.discipline_code
                });
            }
        });
        target.degrees_snapshot = existingDegrees;

        // Backfill non-teaching details if empty
        target.non_teaching_credits = target.non_teaching_credits || {};
        NT_KEYS.forEach(function (k) {
            const cur = target.non_teaching_credits[k] || { credits: 0, start_date: '', end_date: '', details: '' };
            const nxt = (fresh.non_teaching_credits || {})[k] || {};
            if ((overwriteExisting || !cur.details) && nxt.details) cur.details = nxt.details;
            if ((overwriteExisting || !Number(cur.credits)) && Number(nxt.credits) > 0) cur.credits = nxt.credits;
            if ((overwriteExisting || !cur.start_date) && nxt.start_date) cur.start_date = nxt.start_date;
            if ((overwriteExisting || !cur.end_date) && nxt.end_date) cur.end_date = nxt.end_date;
            target.non_teaching_credits[k] = cur;
        });

        // Backfill consultation hours if empty
        target.consultation_hours = target.consultation_hours || { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '' };
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(function (day) {
            if ((overwriteExisting || !target.consultation_hours[day]) && fresh.consultation_hours?.[day]) {
                target.consultation_hours[day] = fresh.consultation_hours[day];
            }
        });
    }

    // ------------------------------------------------------------------
    // Teaching Loads -> Schedule of Classes
    // ------------------------------------------------------------------
    function scheduleEntries(ld) {
        if (Array.isArray(ld.schedule_entries)) return ld.schedule_entries;
        if (typeof ld.schedule_entries === 'string') {
            try { return JSON.parse(ld.schedule_entries) || []; } catch (e) { return []; }
        }
        return [];
    }

    function splitUnits(ld) {
        const units = Number(ld.units) || 0;
        const hours = Number(ld.hours_per_week) || 0;
        const lu = Number(ld.lecture_units) || 0;
        const bu = Number(ld.lab_units) || 0;
        const lh = Number(ld.lecture_hours) || 0;
        const bh = Number(ld.lab_hours) || 0;
        if (lu + bu > 0 && (!units || Math.abs(lu + bu - units) < 0.01) && (lh + bh > 0)) {
            return { lecture_units: lu, lab_units: bu, lecture_hours: lh, lab_hours: bh };
        }
        if (units > 0 && hours > units) {
            const lab = (hours - units) / 2;
            if (lab > 0 && lab <= units && Number.isInteger(lab * 2)) {
                return { lecture_units: units - lab, lab_units: lab, lecture_hours: units - lab, lab_hours: lab * 3 };
            }
        }
        if (ld.is_lab && units > 0) {
            return { lecture_units: 0, lab_units: units, lecture_hours: 0, lab_hours: hours || units * 3 };
        }
        return { lecture_units: units, lab_units: 0, lecture_hours: hours || units, lab_hours: 0 };
    }

    function mapTeachingLoad(ld, i) {
        const entries = scheduleEntries(ld);
        let days = '';
        let time = '';
        if (entries.length) {
            days = engine().normalizeDays(entries.map(function (e) { return e.day || ''; }).join(''));
            time = Array.from(new Set(entries.map(function (e) {
                return [e.start_time, e.end_time].filter(Boolean).join(' - ');
            }).filter(Boolean))).join('\n');
        } else {
            days = engine().normalizeDays(ld.schedule_day || '');
            time = [ld.start_time, ld.end_time].filter(Boolean).join(' - ');
        }
        const parts = splitUnits(ld);
        const students = Number(ld.total_students) || ((Number(ld.regular_students) || 0) + (Number(ld.irregular_students) || 0));
        return Object.assign({
            sort_order: i + 1,
            subject_code_title: [ld.subject_code, ld.subject_title].filter(Boolean).join(' - '),
            class_code: ld.section || '',
            schedule_days: days,
            schedule_time: time,
            room: ld.room || '',
            is_team_teaching: !!ld.is_team_teaching,
            num_students: students,
            educational_level: engine().normalizeLevel(ld.educational_level)
        }, parts);
    }

    function filterTermTeachingLoads(allLoads, academicYear, semester) {
        const E = engine();
        const ay = E.formatSchoolYear(academicYear);
        const sem = E.semesterCode(semester);
        return (allLoads || []).filter(function (ld) {
            return E.formatSchoolYear(ld.academic_year) === ay && E.semesterCode(ld.semester) === sem;
        }).map(mapTeachingLoad);
    }

    function findLatestAvailableLoadTerm(allLoads) {
        const E = engine();
        const groups = new Map();
        (allLoads || []).forEach(function (ld) {
            const ay = ayKey(ld.academic_year);
            const sem = E.semesterCode(ld.semester);
            if (!ay || !sem) return;
            const key = `${ay}::${sem}`;
            if (!groups.has(key)) groups.set(key, { ay, sem, count: 0 });
            groups.get(key).count += 1;
        });
        const list = Array.from(groups.values());
        list.sort(function (a, b) { return b.ay.localeCompare(a.ay) || String(a.sem).localeCompare(String(b.sem)); });
        return list[0] || null;
    }

    async function onTermChange() {
        if (isLocked() || suppressDirty) return;
        const E = engine();
        const newSem = E.semesterCode(getValue('fieldSemester'));
        const newAY = ayKey(getValue('fieldSchoolYear'));
        if (!newAY || !/\d{4}-\d{4}/.test(newAY)) {
            markDirty();
            return;
        }
        if (activeReport && newSem === E.semesterCode(activeReport.semester) && newAY === ayKey(activeReport.academic_year)) {
            return;
        }
        if (isDirty) {
            const proceed = await showModalDialog({
                title: 'Leave Current Term?',
                message: 'Changes you made to this Form E-0 may not be saved. Switch academic terms without saving?',
                type: 'warning',
                confirmText: 'Switch Term',
                cancelText: 'Cancel'
            });
            if (!proceed) {
                suppressDirty = true;
                try {
                    setValue('fieldSemester', E.semesterCode(activeReport?.semester) || '1');
                    setValue('fieldSchoolYear', E.formatSchoolYear(activeReport?.academic_year));
                } finally {
                    setTimeout(function () { suppressDirty = false; }, 80);
                }
                return;
            }
            isDirty = false;
        }
        if (targetFacultyId) {
            await loadReport(targetFacultyId, newAY, newSem, { allowTermFallback: false });
        } else {
            markDirty();
        }
    }

    async function autoSyncProfileAndLoads() {
        if (isLocked()) {
            showToast('This Form E-0 is locked while submitted or approved.', 'warning');
            return;
        }
        const btn = document.getElementById('btnAutoFill');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[#621708]"></i><span>Syncing...</span>';
        }

        try {
            syncStateFromInputs();
            if (!currentFaculty) {
                currentFaculty = await resolveAuthenticatedFaculty();
            }
            if (!targetFacultyId && currentFaculty?.id && /^\d+$/.test(String(currentFaculty.id))) {
                targetFacultyId = Number(currentFaculty.id);
            }

            const baseFac = (targetFacultyId && Number(targetFacultyId) === Number(currentFaculty?.id))
                ? currentFaculty
                : (targetFaculty || currentFaculty || {});
            accountBundle = await fetchAccountBundle(targetFacultyId, baseFac);
            targetFaculty = accountBundle.faculty || baseFac;

            const E = engine();
            let targetAY = activeReport.academic_year;
            let targetSem = activeReport.semester;
            let termClasses = filterTermTeachingLoads(accountBundle.teachingLoads, targetAY, targetSem);

            if (activeClasses.length > 0) {
                const proceed = await showModalDialog({
                    title: 'Sync Account & Teaching Load',
                    message: `Refresh missing/updated profile details from your account and replace the current ${activeClasses.length} class row(s) with your ${E.semesterOrdinal(targetSem)} Semester ${E.formatSchoolYear(targetAY)} teaching load?`,
                    type: 'info',
                    confirmText: 'Sync & Update',
                    cancelText: 'Keep Current Schedule'
                });
                if (!proceed) {
                    const freshOnly = createInitialReport(targetFacultyId, targetAY, targetSem, targetFaculty, accountBundle);
                    mergeAccountIntoReport(activeReport, freshOnly, false);
                    populateFormUI();
                    recalculateTotals();
                    renderOfficialPreview();
                    showToast('Account profile details synced; kept your current class schedule.', 'info');
                    return;
                }
            }

            // If no teaching loads exist in the selected term, check if the account has teaching loads in another term
            if (termClasses.length === 0 && accountBundle.teachingLoads.length > 0) {
                const alt = findLatestAvailableLoadTerm(accountBundle.teachingLoads);
                if (alt && (alt.ay !== ayKey(targetAY) || alt.sem !== E.semesterCode(targetSem))) {
                    const switchTerm = await showModalDialog({
                        title: 'Teaching Load Found in Another Term',
                        message: `No teaching load subjects were found for ${E.semesterOrdinal(targetSem)} Semester ${E.formatSchoolYear(targetAY)}, but ${alt.count} class(es) were found in ${E.semesterOrdinal(alt.sem)} Semester ${E.formatSchoolYear(alt.ay)}.\n\nSwitch this Form E-0 to that term and load those classes?`,
                        type: 'info',
                        confirmText: 'Switch & Load Classes',
                        cancelText: 'Stay on Current Term'
                    });
                    if (switchTerm) {
                        targetAY = alt.ay;
                        targetSem = alt.sem;
                        activeReport.academic_year = targetAY;
                        activeReport.semester = targetSem;
                        termClasses = filterTermTeachingLoads(accountBundle.teachingLoads, targetAY, targetSem);
                    }
                }
            }

            const fresh = createInitialReport(targetFacultyId, targetAY, targetSem, targetFaculty, accountBundle);
            mergeAccountIntoReport(activeReport, fresh, true);
            activeClasses = termClasses;
            isDirty = true;

            populateFormUI();
            recalculateTotals();
            renderOfficialPreview();

            if (termClasses.length > 0) {
                showToast(`Auto-filled account profile and ${termClasses.length} class(es) for ${E.semesterOrdinal(targetSem)} Sem ${E.formatSchoolYear(targetAY)}.`, 'success');
            } else {
                await showModalDialog({
                    title: 'Account Details Synced',
                    message: `Your account profile, appointment, and degree records from the database are now reflected in Form E-0 (all fields remain editable).\n\nNo teaching load subjects were found for ${E.semesterOrdinal(targetSem)} Semester ${E.formatSchoolYear(targetAY)} yet — you can add subjects in Faculty Profile → Teaching Load or click "+ Add Class" below.`,
                    type: 'info',
                    confirmText: 'Got It'
                });
            }
        } catch (err) {
            console.error('[Form E-0] Auto-fill error:', err);
            await showModalDialog({
                title: 'Auto-Fill Error',
                message: err?.message || 'Unable to sync account and teaching load data right now.',
                type: 'error',
                confirmText: 'OK'
            });
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    }

    // ------------------------------------------------------------------
    // Form <-> State
    // ------------------------------------------------------------------
    function populateRankOptions() {
        const sel = document.getElementById('fieldRankCode');
        const E = engine();
        if (!sel || !E || sel.tagName !== 'SELECT') return;
        sel.innerHTML = '<option value="">Select rank code</option>' + E.GENERIC_RANK_CODES.map(function (r) {
            return `<option value="${r.code}">${r.code} - ${esc(r.label)}</option>`;
        }).join('');
    }

    function setValue(id, val) {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') {
            el.checked = !!val;
            return;
        }
        const nextVal = val ?? '';
        el.value = nextVal;
        if (el._flatpickr) {
            try { el._flatpickr.setDate(nextVal || null, false); } catch (_) {}
        }
    }

    function getValue(id) {
        const el = document.getElementById(id);
        if (!el) return '';
        if (el.type === 'checkbox') return el.checked;
        return el.value;
    }

    function populateFormUI() {
        const r = activeReport || {};
        const E = engine();
        if (!E) return;
        suppressDirty = true;
        try {
            const ymd = function (v) { return E.toYMD(v) || ''; };

            setValue('fieldSemester', E.semesterCode(r.semester) || '1');
            setValue('fieldSchoolYear', E.formatSchoolYear(r.academic_year));
            setValue('fieldCollege', r.college_name || '');
            setValue('fieldDepartment', r.department_name || '');
            setValue('fieldDisciplineCode', r.discipline_code || '');
            setValue('fieldLastName', r.faculty_last_name || '');
            setValue('fieldFirstName', r.faculty_first_name || '');
            setValue('fieldMiddleInitial', r.faculty_middle_initial || '');
            setValue('fieldEmail', r.email || '');
            setValue('fieldPhone', r.phone || '');
            setValue('fieldBirthdate', ymd(r.birthdate));
            setValue('fieldOriginalAppointment', ymd(r.original_appointment_date));
            setValue('fieldGender', E.normalizeGender ? E.normalizeGender(r.gender) : String(r.gender || '').toUpperCase());

            updateStatusBadge(r.status);

            setValue('fieldTenure', E.normalizeCode(r.tenure_status_code));
            setValue('fieldEmploymentType', E.normalizeCode(r.employment_type_code));
            setValue('fieldPlantilla', r.has_plantilla_item === false ? 'NO' : 'YES');
            setValue('fieldSalaryCharge', r.salary_charge_to || 'PS ITEM');
            setValue('fieldRankCode', E.normalizeRankCode(r.generic_rank_code));
            setValue('fieldSalaryGrade', r.salary_grade ?? '');
            setValue('fieldAnnualSalary', r.annual_basic_salary ?? '');
            setValue('fieldLecturerFee', r.lecturer_fee_per_hour || '');
            setValue('fieldActiveDuty', r.is_active_duty === false ? 'NO' : 'YES');

            const lwop = r.leave_without_pay || {};
            const lwp = r.leave_with_pay || {};
            setValue('fieldLeaveWithoutPayStart', ymd(lwop.start_date));
            setValue('fieldLeaveWithoutPayEnd', ymd(lwop.end_date));
            setValue('fieldLeaveWithoutPayType', lwop.leave_type_code || '');
            setValue('fieldLeaveWithPayStart', ymd(lwp.start_date));
            setValue('fieldLeaveWithPayEnd', ymd(lwp.end_date));
            setValue('fieldLeaveWithPayType', lwp.leave_type_code || '');

            const bac = E.findDegree(r.degrees_snapshot, 'BACC');
            const mas = E.findDegree(r.degrees_snapshot, 'MASTERS');
            const doc = E.findDegree(r.degrees_snapshot, 'DOCTORAL');
            [['Bac', bac], ['Master', mas], ['Doc', doc]].forEach(function (pair) {
                const p = pair[0];
                const d = pair[1] || {};
                setValue(`field${p}Title`, d.degree_title || '');
                setValue(`field${p}Status`, E.normalizeCode(d.status_code) || (d.degree_title ? '1' : ''));
                const dv = E.toYMD(d.date_completed);
                setValue(`field${p}Date`, dv || '');
                setValue(`field${p}School`, d.institution_name || '');
                setValue(`field${p}Discipline`, String(d.discipline_code || '').replace(/\.0+$/, ''));
            });
            setValue('fieldMasterThesis', mas.wrote_thesis ? 'YES' : 'NO');
            setValue('fieldDocDissertation', doc.wrote_dissertation ? 'YES' : 'NO');

            setValue('fieldPrimaryDisciplineTeaching', String(r.primary_discipline_teaching || '').replace(/\.0+$/, ''));
            setValue('fieldSecondaryDisciplineTeaching', String(r.secondary_discipline_teaching || '').replace(/\.0+$/, ''));

            const nt = r.non_teaching_credits || {};
            NT_KEYS.forEach(function (k, i) {
                const e = nt[k] || {};
                const n = i + 1;
                setValue(`fieldE${n}Credits`, Number(e.credits) ? e.credits : '');
                setValue(`fieldE${n}Start`, ymd(e.start_date));
                setValue(`fieldE${n}End`, ymd(e.end_date));
                setValue(`fieldE${n}Details`, e.details || '');
            });

            const c = r.consultation_hours || {};
            setValue('consultMon', c.mon || '');
            setValue('consultTue', c.tue || '');
            setValue('consultWed', c.wed || '');
            setValue('consultThu', c.thu || '');
            setValue('consultFri', c.fri || '');
            setValue('consultSat', c.sat || '');

            setValue('chkProxyChair', !!r.is_signed_by_chair_proxy);
            setValue('proxyReasonInput', r.chair_proxy_reason || '');
            toggleProxyNotice();

            renderClassesTable();
        } finally {
            setTimeout(function () { suppressDirty = false; }, 120);
        }
    }

    function updateStatusBadge(status) {
        const badge = document.getElementById('statusBadge');
        if (!badge) return;
        const st = String(status || 'draft').toLowerCase();
        const labels = { draft: 'Draft', submitted: 'Submitted', chair_certified: 'Chair certified', approved: 'Approved', revision: 'Needs revision' };
        badge.textContent = labels[st] || st.replace(/_/g, ' ');
        const base = 'text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wide ';
        if (st === 'approved') badge.className = base + 'bg-emerald-100 text-emerald-800';
        else if (st === 'submitted' || st === 'chair_certified') badge.className = base + 'bg-blue-100 text-blue-800';
        else if (st === 'revision') badge.className = base + 'bg-amber-100 text-amber-900';
        else badge.className = base + 'bg-slate-200 text-slate-700';
    }

    function markDirty() {
        if (suppressDirty) return;
        isDirty = true;
        recalculateTotals();
        if (lastValidation) runValidation(false);
    }

    function syncStateFromInputs() {
        const E = engine();
        if (!E) return;
        if (!activeReport) {
            const d = currentTermDefaults();
            activeReport = createInitialReport(targetFacultyId, d.ay, d.sem, targetFaculty || currentFaculty || {}, accountBundle);
        }
        const r = activeReport;

        r.semester = E.semesterCode(getValue('fieldSemester'));
        r.academic_year = ayKey(getValue('fieldSchoolYear'));
        r.college_name = getValue('fieldCollege').trim();
        r.department_name = getValue('fieldDepartment').trim();
        r.discipline_code = getValue('fieldDisciplineCode').trim();
        r.faculty_last_name = getValue('fieldLastName').trim();
        r.faculty_first_name = getValue('fieldFirstName').trim();
        r.faculty_middle_initial = getValue('fieldMiddleInitial').trim().replace(/\.+$/, '');
        const mi = r.faculty_middle_initial ? r.faculty_middle_initial + '.' : '';
        r.faculty_printed_name = [r.faculty_first_name, mi, r.faculty_last_name].filter(Boolean).join(' ') || r.faculty_printed_name || '';
        r.email = getValue('fieldEmail').trim();
        r.phone = getValue('fieldPhone').trim();
        r.birthdate = getValue('fieldBirthdate');
        r.original_appointment_date = getValue('fieldOriginalAppointment');
        r.gender = E.normalizeGender ? E.normalizeGender(getValue('fieldGender')) : getValue('fieldGender');

        r.tenure_status_code = getValue('fieldTenure');
        r.employment_type_code = getValue('fieldEmploymentType');
        r.has_plantilla_item = getValue('fieldPlantilla') === 'YES';
        r.salary_charge_to = getValue('fieldSalaryCharge');
        r.generic_rank_code = getValue('fieldRankCode');
        r.salary_grade = numOrNull(getValue('fieldSalaryGrade'));
        r.annual_basic_salary = numOrNull(getValue('fieldAnnualSalary'));
        r.lecturer_fee_per_hour = numOrNull(getValue('fieldLecturerFee'));
        r.is_active_duty = getValue('fieldActiveDuty') === 'YES';
        r.leave_without_pay = {
            start_date: getValue('fieldLeaveWithoutPayStart'),
            end_date: getValue('fieldLeaveWithoutPayEnd'),
            leave_type_code: getValue('fieldLeaveWithoutPayType').trim()
        };
        r.leave_with_pay = {
            start_date: getValue('fieldLeaveWithPayStart'),
            end_date: getValue('fieldLeaveWithPayEnd'),
            leave_type_code: getValue('fieldLeaveWithPayType').trim()
        };

        r.primary_discipline_teaching = getValue('fieldPrimaryDisciplineTeaching').trim();
        r.secondary_discipline_teaching = getValue('fieldSecondaryDisciplineTeaching').trim();

        function degree(level, p, paperKey) {
            const d = {
                level,
                degree_title: getValue(`field${p}Title`).trim(),
                status_code: getValue(`field${p}Status`),
                date_completed: getValue(`field${p}Date`),
                institution_name: getValue(`field${p}School`).trim(),
                discipline_code: getValue(`field${p}Discipline`).trim()
            };
            if (paperKey) d[paperKey] = getValue(paperKey === 'wrote_thesis' ? 'fieldMasterThesis' : 'fieldDocDissertation') === 'YES';
            return d;
        }
        r.degrees_snapshot = [
            degree('BACC', 'Bac'),
            degree('MASTERS', 'Master', 'wrote_thesis'),
            degree('DOCTORAL', 'Doc', 'wrote_dissertation')
        ].filter(function (d) { return d.level === 'BACC' || d.degree_title || d.institution_name; });

        r.non_teaching_credits = {};
        NT_KEYS.forEach(function (k, i) {
            const n = i + 1;
            r.non_teaching_credits[k] = {
                credits: Number(getValue(`fieldE${n}Credits`)) || 0,
                start_date: getValue(`fieldE${n}Start`),
                end_date: getValue(`fieldE${n}End`),
                details: getValue(`fieldE${n}Details`).trim()
            };
        });

        r.consultation_hours = {
            mon: getValue('consultMon').trim(),
            tue: getValue('consultTue').trim(),
            wed: getValue('consultWed').trim(),
            thu: getValue('consultThu').trim(),
            fri: getValue('consultFri').trim(),
            sat: getValue('consultSat').trim()
        };

        const summary = E.computeSummary(r, activeClasses);
        r.subtotal_non_teaching = summary.workload.subtotalNonTeaching;
        r.subtotal_teaching = summary.workload.subtotalTeaching;
        r.grand_total_credits = summary.workload.grandTotal;
        r.summary_matrix_units = summary.units;
        r.summary_matrix_hours = summary.hours;

        const proxy = document.getElementById('proxySection');
        const proxyVisible = proxy && proxy.style.display !== 'none';
        r.is_signed_by_chair_proxy = proxyVisible && getValue('chkProxyChair') === true;
        r.chair_proxy_reason = r.is_signed_by_chair_proxy ? getValue('proxyReasonInput').trim() : null;
    }

    function buildPayload(omit039) {
        const r = activeReport;
        const payload = {};
        REPORT_COLUMNS.forEach(function (k) {
            if (omit039 && OPTIONAL_039_COLUMNS.includes(k)) return;
            if (r[k] !== undefined) payload[k] = r[k];
        });
        if (!payload.faculty_id && targetFacultyId) payload.faculty_id = Number(targetFacultyId);
        ['birthdate', 'original_appointment_date'].forEach(function (k) {
            payload[k] = engine().toYMD(payload[k]) || null;
        });
        ['phone', 'gender', 'generic_rank_code', 'secondary_discipline_teaching', 'chair_proxy_reason'].forEach(function (k) {
            payload[k] = blankToNull(payload[k]);
        });
        if (r.id) payload.id = r.id;
        return payload;
    }

    // ------------------------------------------------------------------
    // Schedule of Classes (Part 2A)
    // ------------------------------------------------------------------
    function renderClassesTable() {
        const tbody = document.getElementById('classesTbody');
        if (!tbody) return;
        const E = engine();
        if (!E) return;
        const locked = isLocked();
        const dis = locked ? 'disabled' : '';

        if (activeClasses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="p-6 text-center text-slate-400">No classes listed for this semester yet. Click <b>Auto-Fill Load</b> to sync from your teaching load or <b>+ Add Class</b> to add a row manually.</td></tr>`;
            return;
        }

        const numCell = function (idx, field, val, step) {
            return `<td class="p-1"><input type="number" min="0" step="${step}" value="${esc(val ?? '')}" ${dis} class="input-field py-1 text-xs text-center" style="height:34px;padding:0 4px" onchange="updateClass(${idx}, '${field}', this.value === '' ? 0 : Number(this.value))"></td>`;
        };

        tbody.innerHTML = activeClasses.map((cls, idx) => `
            <tr>
                <td class="p-2 text-center font-bold text-slate-400">A${idx + 1}</td>
                <td class="p-1" style="min-width:220px"><input type="text" value="${esc(cls.subject_code_title)}" ${dis} class="input-field py-1 text-xs" style="height:34px" placeholder="CC111 - INTRODUCTION TO COMPUTING" onchange="updateClass(${idx}, 'subject_code_title', this.value)"></td>
                <td class="p-1" style="min-width:80px"><input type="text" value="${esc(cls.class_code)}" ${dis} class="input-field py-1 text-xs" style="height:34px" onchange="updateClass(${idx}, 'class_code', this.value)"></td>
                <td class="p-1" style="min-width:80px"><input type="text" value="${esc(cls.schedule_days)}" ${dis} class="input-field py-1 text-xs" style="height:34px" placeholder="TTh" onchange="this.value = CiteFlowFormE0Engine.normalizeDays(this.value); updateClass(${idx}, 'schedule_days', this.value)"></td>
                <td class="p-1" style="min-width:130px"><textarea rows="2" ${dis} class="input-field text-xs" style="height:auto;padding:4px 8px;line-height:1.3" placeholder="Lec time&#10;Lab time" onchange="updateClass(${idx}, 'schedule_time', this.value)">${esc(cls.schedule_time)}</textarea></td>
                <td class="p-1" style="min-width:100px"><input type="text" value="${esc(cls.room)}" ${dis} class="input-field py-1 text-xs" style="height:34px" onchange="updateClass(${idx}, 'room', this.value)"></td>
                <td class="p-1" style="min-width:96px">
                    <select ${dis} class="input-field py-1 text-xs" style="height:34px;padding:0 6px" onchange="updateClass(${idx}, 'educational_level', this.value)">
                        ${E.LEVEL_KEYS.map(l => `<option value="${l.key}" ${E.normalizeLevel(cls.educational_level) === l.key ? 'selected' : ''}>${esc(l.label.replace(/:$/, ''))}</option>`).join('')}
                    </select>
                </td>
                ${numCell(idx, 'lecture_units', cls.lecture_units, '0.5')}
                ${numCell(idx, 'lab_units', cls.lab_units, '0.5')}
                ${numCell(idx, 'lecture_hours', cls.lecture_hours, '0.5')}
                ${numCell(idx, 'lab_hours', cls.lab_hours, '0.5')}
                ${numCell(idx, 'num_students', cls.num_students, '1')}
                <td class="p-1 text-center">
                    <div class="text-[11px] font-bold ${E.lecLabLabel(cls) === 'LAB' ? 'text-indigo-700' : 'text-slate-600'}">${E.lecLabLabel(cls)}</div>
                    <label class="text-[10px] text-slate-500 flex items-center justify-center gap-1 mt-0.5"><input type="checkbox" ${cls.is_team_teaching ? 'checked' : ''} ${dis} onchange="updateClass(${idx}, 'is_team_teaching', this.checked)"> Team</label>
                </td>
                <td class="p-1 text-center">
                    ${locked ? '' : `<button type="button" onclick="removeClassRow(${idx})" class="text-rose-600 hover:text-rose-800 p-1" title="Delete class row"><i class="fa-solid fa-trash-can"></i></button>`}
                </td>
            </tr>
        `).join('');
    }

    function addClassRow() {
        if (isLocked()) return;
        activeClasses.push({
            sort_order: activeClasses.length + 1,
            subject_code_title: '',
            class_code: '',
            schedule_days: '',
            schedule_time: '',
            room: '',
            is_team_teaching: false,
            num_students: 0,
            educational_level: 'BACC',
            lecture_units: 0,
            lab_units: 0,
            lecture_hours: 0,
            lab_hours: 0
        });
        renderClassesTable();
        markDirty();
    }

    function removeClassRow(idx) {
        if (isLocked()) return;
        activeClasses.splice(idx, 1);
        renderClassesTable();
        markDirty();
    }

    function updateClass(idx, field, val) {
        if (!activeClasses[idx] || isLocked()) return;
        activeClasses[idx][field] = val;
        if (['lecture_units', 'lab_units', 'lecture_hours', 'lab_hours'].includes(field)) {
            activeClasses[idx].is_lab = engine().lecLabLabel(activeClasses[idx]) === 'LAB';
            renderClassesTable();
        }
        markDirty();
    }

    // ------------------------------------------------------------------
    // Totals & Matrices
    // ------------------------------------------------------------------
    function recalculateTotals() {
        const E = engine();
        if (!E || !activeReport) return;

        const ntCredits = {};
        NT_KEYS.forEach(function (k, i) { ntCredits[k] = { credits: Number(getValue(`fieldE${i + 1}Credits`)) || 0 }; });
        const summary = E.computeSummary({ non_teaching_credits: ntCredits }, activeClasses);
        const wl = summary.workload;

        const set = function (id, text) { const el = document.getElementById(id); if (el) el.textContent = text; };
        set('displayE7Total', wl.subtotalNonTeaching.toFixed(1));
        set('displayE8Total', wl.subtotalTeaching.toFixed(1));
        set('displayE9Total', wl.grandTotal.toFixed(1));
        set('displayE8Basis', summary.teachingCreditBasis === 'credit_units'
            ? 'Total credit units (C6) from the schedule of classes'
            : 'Total teaching hours per week (D6), as on the CTU form');
        set('stickyGrandTotal', `${wl.grandTotal.toFixed(1)} credits`);

        const sem = E.semesterCode(getValue('fieldSemester') || activeReport.semester);
        const ay = E.formatSchoolYear(getValue('fieldSchoolYear') || activeReport.academic_year);
        set('stickyPeriodLabel', `${E.semesterOrdinal(sem)} Sem ${ay}`);

        renderMatrixUnitsUI(summary.units);
        renderMatrixHoursUI(summary.hours);

        if (currentMode === 'preview') renderOfficialPreview();
    }

    function fmt(n) {
        return n ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '-';
    }

    function renderMatrixUnitsUI(mu) {
        const tbody = document.getElementById('matrixUnitsTbody');
        if (!tbody) return;
        const rows = engine().LEVEL_KEYS.map(lvl => {
            const row = mu.matrix[lvl.key] || {};
            return `
                <tr>
                    <td class="p-2 font-semibold text-slate-800">${esc(lvl.code)}. ${esc(lvl.label)}</td>
                    <td class="p-2 text-center">${fmt(row.lecSubjectUnits)}</td>
                    <td class="p-2 text-center">${fmt(row.labSubjectUnits)}</td>
                    <td class="p-2 text-center font-bold text-slate-900">${fmt(row.totalSubjectUnits)}</td>
                    <td class="p-2 text-center">${fmt(row.lecCreditUnits)}</td>
                    <td class="p-2 text-center">${fmt(row.labCreditUnits)}</td>
                    <td class="p-2 text-center font-bold text-[#621708]">${fmt(row.totalCreditUnits)}</td>
                </tr>`;
        });
        const t = mu.totals;
        rows.push(`
            <tr class="bg-slate-100 font-bold border-t border-slate-300">
                <td class="p-2.5 text-[#621708]">C6. TOTAL TEACHING LOAD</td>
                <td class="p-2.5 text-center">${fmt(t.lecSubjectUnits)}</td>
                <td class="p-2.5 text-center">${fmt(t.labSubjectUnits)}</td>
                <td class="p-2.5 text-center font-black">${fmt(t.totalSubjectUnits)}</td>
                <td class="p-2.5 text-center">${fmt(t.lecCreditUnits)}</td>
                <td class="p-2.5 text-center">${fmt(t.labCreditUnits)}</td>
                <td class="p-2.5 text-center font-black text-[#621708] text-sm">${fmt(t.totalCreditUnits)}</td>
            </tr>`);
        tbody.innerHTML = rows.join('');
    }

    function renderMatrixHoursUI(mh) {
        const tbody = document.getElementById('matrixHoursTbody');
        if (!tbody) return;
        const rows = engine().LEVEL_KEYS.map(lvl => {
            const row = mh.matrix[lvl.key] || {};
            return `
                <tr>
                    <td class="p-2 font-semibold text-slate-800">${esc(lvl.code.replace('C', 'D'))}. ${esc(lvl.label)}</td>
                    <td class="p-2 text-center">${fmt(row.lecHoursPerWeek)}</td>
                    <td class="p-2 text-center">${fmt(row.labHoursPerWeek)}</td>
                    <td class="p-2 text-center font-bold text-slate-900">${fmt(row.totalHoursPerWeek)}</td>
                    <td class="p-2 text-center">${fmt(row.lecContactHours)}</td>
                    <td class="p-2 text-center">${fmt(row.labContactHours)}</td>
                    <td class="p-2 text-center font-bold text-[#621708]">${fmt(row.totalContactHours)}</td>
                </tr>`;
        });
        const t = mh.totals;
        rows.push(`
            <tr class="bg-slate-100 font-bold border-t border-slate-300">
                <td class="p-2.5 text-[#621708]">D6. TOTAL TEACHING LOAD</td>
                <td class="p-2.5 text-center">${fmt(t.lecHoursPerWeek)}</td>
                <td class="p-2.5 text-center">${fmt(t.labHoursPerWeek)}</td>
                <td class="p-2.5 text-center font-black">${fmt(t.totalHoursPerWeek)}</td>
                <td class="p-2.5 text-center">${fmt(t.lecContactHours)}</td>
                <td class="p-2.5 text-center">${fmt(t.labContactHours)}</td>
                <td class="p-2.5 text-center font-black text-[#621708] text-sm">${fmt(t.totalContactHours)}</td>
            </tr>`);
        tbody.innerHTML = rows.join('');
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------
    function runValidation(scroll) {
        syncStateFromInputs();
        lastValidation = engine().validateReport(activeReport, activeClasses);
        renderValidation(lastValidation, scroll);
        return lastValidation;
    }

    function renderValidation(result, scroll) {
        document.querySelectorAll('.e0-invalid').forEach(function (el) { el.classList.remove('e0-invalid'); });
        const panel = document.getElementById('validationPanel');
        if (!panel) return;
        if (!result || (!result.errors.length && !result.warnings.length)) {
            panel.style.display = result ? 'block' : 'none';
            panel.innerHTML = result ? `<div class="flex items-center gap-2 text-emerald-800 text-xs font-bold"><i class="fa-solid fa-circle-check"></i> All checks passed. The form is ready to submit.</div>` : '';
            panel.className = 'e0-card p-4 mb-6 no-print border-emerald-200 bg-emerald-50/70';
            return;
        }
        result.errors.forEach(function (e) {
            const el = document.getElementById(e.field);
            if (el) el.classList.add('e0-invalid');
        });
        const item = function (e, kind) {
            return `<li><button type="button" class="text-left hover:underline" onclick="CiteFlowFormE0.focusField('${esc(e.field)}')">
                <i class="fa-solid ${kind === 'error' ? 'fa-circle-xmark text-rose-600' : 'fa-triangle-exclamation text-amber-600'} mr-1"></i>${esc(e.message)}</button></li>`;
        };
        panel.className = 'e0-card p-4 mb-6 no-print ' + (result.errors.length ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60');
        panel.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <h3 class="text-xs font-extrabold uppercase tracking-wider ${result.errors.length ? 'text-rose-800' : 'text-amber-900'}">
                    ${result.errors.length ? `${result.errors.length} problem(s) must be fixed before submitting` : 'Please double-check'}
                    ${result.warnings.length ? ` &middot; ${result.warnings.length} warning(s)` : ''}
                </h3>
                <button type="button" class="text-xs text-slate-500 hover:text-slate-800" onclick="document.getElementById('validationPanel').style.display='none'">Hide</button>
            </div>
            <ul class="space-y-1 text-xs text-slate-800">
                ${result.errors.map(e => item(e, 'error')).join('')}
                ${result.warnings.map(e => item(e, 'warning')).join('')}
            </ul>`;
        panel.style.display = 'block';
        if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function focusField(id) {
        if (currentMode !== 'editor') setMode('editor');
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el.focus === 'function') setTimeout(function () { el.focus(); }, 300);
    }

    // ------------------------------------------------------------------
    // Save / Submit / Withdraw
    // ------------------------------------------------------------------
    async function persist() {
        const db = getDb();
        if (!db || !activeReport) return false;
        syncStateFromInputs();

        if (!activeReport.faculty_id && !targetFacultyId) {
            throw new Error('Could not find a linked faculty profile ID for your account.');
        }

        let payload = buildPayload(false);
        payload.status = String(activeReport.status) === 'revision' ? 'revision' : 'draft';

        let savedRes = await db
            .from('form_e0_reports')
            .upsert(payload, { onConflict: 'faculty_id,academic_year,semester' })
            .select()
            .single();

        // Fallback if migration 039 optional columns have not been applied yet
        if (savedRes.error && /column|schema cache|PGRST204/i.test(`${savedRes.error.code || ''} ${savedRes.error.message || ''}`)) {
            payload = buildPayload(true);
            payload.status = String(activeReport.status) === 'revision' ? 'revision' : 'draft';
            savedRes = await db
                .from('form_e0_reports')
                .upsert(payload, { onConflict: 'faculty_id,academic_year,semester' })
                .select()
                .single();
        }

        if (savedRes.error) throw savedRes.error;
        activeReport = Object.assign(activeReport, savedRes.data);

        await db.from('form_e0_classes').delete().eq('form_e0_id', activeReport.id);
        if (activeClasses.length > 0) {
            const classPayload = activeClasses.map((c, i) => ({
                form_e0_id: activeReport.id,
                subject_code_title: c.subject_code_title || '',
                class_code: c.class_code || '',
                schedule_days: c.schedule_days || '',
                schedule_time: c.schedule_time || '',
                room: c.room || null,
                is_lab: engine().lecLabLabel(c) === 'LAB',
                is_team_teaching: !!c.is_team_teaching,
                num_students: Math.max(0, Math.round(Number(c.num_students) || 0)),
                educational_level: engine().normalizeLevel(c.educational_level),
                lecture_units: Number(c.lecture_units) || 0,
                lab_units: Number(c.lab_units) || 0,
                lecture_hours: Number(c.lecture_hours) || 0,
                lab_hours: Number(c.lab_hours) || 0,
                sort_order: i + 1
            }));
            const { error: clsErr } = await db.from('form_e0_classes').insert(classPayload);
            if (clsErr) throw clsErr;
        }
        isDirty = false;
        return true;
    }

    async function saveDraft() {
        if (isLocked()) {
            showToast('This Form E-0 has been submitted and can no longer be edited.', 'warning');
            return false;
        }
        try {
            await persist();
            showToast('Form E-0 draft saved.', 'success');
            return true;
        } catch (err) {
            console.error('[Form E-0] Save draft error:', err);
            await showModalDialog({
                title: 'Unable to Save Draft',
                message: err?.message || 'An unexpected error occurred while saving your Form E-0 draft.',
                type: 'error',
                confirmText: 'OK'
            });
            return false;
        }
    }

    function openSubmitModal() {
        if (isLocked()) return;
        const result = runValidation(true);
        if (!result.ok) {
            showModalDialog({
                title: 'Complete Required Fields First',
                message: `Please resolve the ${result.errors.length} highlighted item(s) in the validation checklist above before submitting your Form E-0.`,
                type: 'warning',
                confirmText: 'Review Checklist'
            });
            return;
        }
        const signerName = currentFaculty?.full_name || currentFaculty?.name || activeReport.faculty_printed_name;
        document.getElementById('modalSignatoryName').textContent = signerName;
        document.getElementById('modalSignatoryDate').textContent = engine().formatDateDisplay(new Date().toISOString().slice(0, 10));
        document.getElementById('modalGrandTotalCredits').textContent = `${Number(activeReport.grand_total_credits || 0).toFixed(1)} credits`;

        const warnBox = document.getElementById('modalWarnings');
        const ack = document.getElementById('modalAckWarnings');
        if (warnBox) {
            if (result.warnings.length) {
                warnBox.style.display = 'block';
                warnBox.querySelector('ul').innerHTML = result.warnings.map(w => `<li>${esc(w.message)}</li>`).join('');
                if (ack) ack.checked = false;
            } else {
                warnBox.style.display = 'none';
                if (ack) ack.checked = true;
            }
        }
        document.getElementById('submitModal').style.display = 'flex';
    }

    function closeSubmitModal() {
        document.getElementById('submitModal').style.display = 'none';
    }

    async function confirmSubmitForm() {
        const ack = document.getElementById('modalAckWarnings');
        if (ack && !ack.checked) {
            showToast('Please confirm that you reviewed the warnings.', 'warning');
            return;
        }
        closeSubmitModal();
        const db = getDb();
        try {
            await persist();
            const signer = currentFaculty?.full_name || currentFaculty?.name || activeReport.faculty_printed_name;
            const submittedAt = new Date().toISOString();
            const { data, error } = await db
                .from('form_e0_reports')
                .update({ status: 'submitted', submitted_at: submittedAt, submitted_by_name: signer })
                .eq('id', activeReport.id)
                .select()
                .single();
            if (error) throw error;
            activeReport = Object.assign(activeReport, data);
            updateStatusBadge(activeReport.status);
            applyLockState();
            renderRevisionBanner();
            renderOfficialPreview();
            showToast('Form E-0 submitted for Department Chairperson certification.', 'success');
        } catch (err) {
            console.error('[Form E-0] Submit error:', err);
            await showModalDialog({
                title: 'Submission Failed',
                message: err?.message || 'Unable to submit your Form E-0 right now.',
                type: 'error',
                confirmText: 'OK'
            });
        }
    }

    async function withdrawSubmission() {
        if (String(activeReport?.status) !== 'submitted') return;
        const confirmed = await showModalDialog({
            title: 'Withdraw Submission?',
            message: 'Return this Form E-0 to Draft status so you can edit and resubmit it before the Department Chairperson certifies it?',
            type: 'warning',
            confirmText: 'Withdraw to Draft',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        const { data, error } = await getDb()
            .from('form_e0_reports')
            .update({ status: 'draft', submitted_at: null })
            .eq('id', activeReport.id)
            .select()
            .single();
        if (error) {
            await showModalDialog({
                title: 'Withdraw Failed',
                message: error.message || 'Unable to withdraw this submission.',
                type: 'error',
                confirmText: 'OK'
            });
            return;
        }
        activeReport = Object.assign(activeReport, data);
        updateStatusBadge(activeReport.status);
        applyLockState();
        renderOfficialPreview();
        showToast('Submission withdrawn. You can edit the form again.', 'success');
    }

    function applyLockState() {
        const locked = isLocked();
        const view = document.getElementById('viewEditor');
        if (view) {
            view.querySelectorAll('input, select, textarea').forEach(function (el) {
                el.disabled = locked;
            });
        }
        ['btnSaveDraft', 'btnSubmitForm', 'btnAutoFill', 'btnAddClass'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = locked ? 'none' : '';
        });
        const withdraw = document.getElementById('btnWithdraw');
        if (withdraw) withdraw.style.display = String(activeReport?.status) === 'submitted' ? '' : 'none';
        const lockNote = document.getElementById('lockNotice');
        if (lockNote) {
            const st = String(activeReport?.status || '');
            lockNote.style.display = locked ? 'block' : 'none';
            lockNote.innerHTML = st === 'approved'
                ? '<i class="fa-solid fa-lock mr-1"></i> Approved by the Dean. This record is final.'
                : (st === 'chair_certified'
                    ? '<i class="fa-solid fa-lock mr-1"></i> Certified by the Department Chair and waiting for the Dean.'
                    : '<i class="fa-solid fa-lock mr-1"></i> Submitted. Waiting for the Department Chair. Use "Withdraw" to edit.');
        }
        renderClassesTable();
    }

    function renderRevisionBanner() {
        const el = document.getElementById('revisionBanner');
        if (!el) return;
        if (String(activeReport?.status) === 'revision' && activeReport.revision_remarks) {
            el.style.display = 'block';
            el.innerHTML = `<div class="text-xs font-extrabold uppercase tracking-wider text-amber-900 mb-1"><i class="fa-solid fa-rotate-left mr-1"></i> Revision requested${activeReport.revision_requested_by_name ? ' by ' + esc(activeReport.revision_requested_by_name) : ''}</div>
                <p class="text-sm text-amber-950">${esc(activeReport.revision_remarks)}</p>`;
        } else {
            el.style.display = 'none';
        }
    }

    // ------------------------------------------------------------------
    // Modes, Official Preview & Export
    // ------------------------------------------------------------------
    function setMode(mode) {
        currentMode = mode;
        const btnEditor = document.getElementById('btnModeEditor');
        const btnPreview = document.getElementById('btnModePreview');
        const viewEditor = document.getElementById('viewEditor');
        const viewPreview = document.getElementById('viewPreview');

        if (mode === 'preview') {
            syncStateFromInputs();
            renderOfficialPreview();
            if (viewEditor) viewEditor.style.display = 'none';
            if (viewPreview) viewPreview.style.display = 'block';
            btnEditor?.classList.remove('active');
            btnPreview?.classList.add('active');
        } else {
            if (viewEditor) viewEditor.style.display = 'block';
            if (viewPreview) viewPreview.style.display = 'none';
            btnPreview?.classList.remove('active');
            btnEditor?.classList.add('active');
        }
    }

    function setPreviewZoom(delta) {
        if (delta === 0) previewZoom = 0.68;
        else previewZoom = Math.max(0.44, Math.min(1.16, Math.round((previewZoom + delta) * 100) / 100));
        document.documentElement.style.setProperty('--e0-preview-zoom', String(previewZoom));
        const lbl = document.getElementById('previewZoomLabel');
        if (lbl) lbl.textContent = Math.round(previewZoom * 100) + '%';
    }

    function toggleProxyNotice() {
        const chk = document.getElementById('chkProxyChair');
        const wrap = document.getElementById('proxyReasonWrap');
        if (wrap && chk) wrap.style.display = chk.checked ? 'block' : 'none';
    }

    async function exportExcel() {
        syncStateFromInputs();
        const result = engine().validateReport(activeReport, activeClasses);
        if (!result.ok) {
            const proceed = await showModalDialog({
                title: 'Incomplete Form E-0',
                message: `This Form E-0 still has ${result.errors.length} incomplete or invalid item(s).\n\nWould you like to export the draft Excel workbook anyway, or review the issues first?`,
                type: 'warning',
                confirmText: 'Export Anyway',
                cancelText: 'Review Issues'
            });
            if (!proceed) {
                if (currentMode !== 'editor') setMode('editor');
                renderValidation(result, true);
                return;
            }
        }
        try {
            await engine().exportToExcel(activeReport, activeClasses);
            showToast('Form E-0 Excel workbook downloaded.', 'success');
        } catch (err) {
            console.error('[Form E-0] Export error:', err);
            await showModalDialog({
                title: 'Excel Export Failed',
                message: err?.message || 'Unable to generate the Excel workbook.',
                type: 'error',
                confirmText: 'OK'
            });
        }
    }

    function renderOfficialPreview() {
        const container = document.getElementById('officialFormDoc');
        const E = engine();
        if (!container || !E) return;
        try {
            const reportForPreview = activeReport || createInitialReport(targetFacultyId, currentTermDefaults().ay, currentTermDefaults().sem, targetFaculty || currentFaculty || {}, accountBundle);
            const model = E.buildSheetModel(reportForPreview, activeClasses);
            container.innerHTML = E.renderSheetHtml(model);
        } catch (err) {
            console.error('[Form E-0] Preview render error:', err);
            container.innerHTML = `<div class="bg-white rounded-2xl border border-rose-200 p-8 max-w-lg text-center text-sm text-rose-700 shadow-sm">
                <i class="fa-solid fa-triangle-exclamation text-xl mb-2"></i>
                <div class="font-bold mb-1">Unable to render Official Form Preview</div>
                <div class="text-xs text-slate-600">${esc(err?.message || String(err))}</div>
            </div>`;
        }
    }

    // ------------------------------------------------------------------
    // System-Consistent "Leave Page?" Modal Guard (No Native beforeunload)
    // ------------------------------------------------------------------
    function shouldPromptBeforeLeaving() {
        return Boolean(isDirty && !isLocked() && !bypassUnsavedGuard);
    }

    function closeOpenNavOverlays() {
        document.getElementById('facultyProfileModal')?.classList.remove('show');
        document.getElementById('facultyProfileBackdrop')?.classList.remove('show');
        document.getElementById('facultyNavNotifDropdown')?.classList.remove('open');
        if (typeof global.toggleFacultyMobileSidebar === 'function') {
            global.toggleFacultyMobileSidebar(true);
        }
    }

    async function confirmLeaveWithSystemModal(proceedFn) {
        if (!shouldPromptBeforeLeaving()) {
            proceedFn();
            return;
        }
        closeOpenNavOverlays();
        const leave = await showModalDialog({
            title: 'Leave Page?',
            message: 'Changes you made to this Form E-0 may not be saved. Are you sure you want to leave without saving?',
            type: 'warning',
            confirmText: 'Leave Page',
            cancelText: 'Cancel'
        });
        if (leave) {
            bypassUnsavedGuard = true;
            isDirty = false;
            proceedFn();
        }
    }

    function wrapFacultyNavFunctions() {
        if (typeof global.navigateToFacultyPage === 'function' && !global.navigateToFacultyPage._e0Wrapped) {
            const origNav = global.navigateToFacultyPage;
            const wrappedNav = function (pageFile) {
                if (!shouldPromptBeforeLeaving()) return origNav.apply(this, arguments);
                confirmLeaveWithSystemModal(function () { origNav.call(global, pageFile); });
            };
            wrappedNav._e0Wrapped = true;
            global.navigateToFacultyPage = wrappedNav;
        }
        if (typeof global.facultyLogout === 'function' && !global.facultyLogout._e0Wrapped) {
            const origLogout = global.facultyLogout;
            const wrappedLogout = function () {
                if (!shouldPromptBeforeLeaving()) return origLogout.apply(this, arguments);
                confirmLeaveWithSystemModal(function () { origLogout.call(global); });
            };
            wrappedLogout._e0Wrapped = true;
            global.facultyLogout = wrappedLogout;
        }
    }

    function installUnsavedNavigationGuard() {
        wrapFacultyNavFunctions();

        document.addEventListener('click', function (e) {
            wrapFacultyNavFunctions();
            if (!shouldPromptBeforeLeaving()) return;
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;

            // 1. Sidebar items, Logo, and Profile Dropdown items ([data-page])
            const navItem = target.closest('.sidebar .nav-item[data-page], .sidebar .logo-area[data-page], #facultyProfileModal .nav-item[data-page], .profile-link[data-page]');
            if (navItem) {
                const pageFile = navItem.getAttribute('data-page');
                if (pageFile) {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmLeaveWithSystemModal(function () {
                        if (typeof global.navigateToFacultyPage === 'function') {
                            global.navigateToFacultyPage(pageFile);
                        } else {
                            window.location.href = pageFile;
                        }
                    });
                    return;
                }
            }

            // 2. Profile modal Logout button
            const logoutBtn = target.closest('.logout-btn, [onclick*="facultyLogout"]');
            if (logoutBtn) {
                e.preventDefault();
                e.stopPropagation();
                confirmLeaveWithSystemModal(function () {
                    if (typeof global.facultyLogout === 'function') {
                        global.facultyLogout();
                    } else {
                        window.location.href = '../login.html';
                    }
                });
                return;
            }

            // 3. Standard <a href="..."> links navigating away from this page
            const anchor = target.closest('a[href]');
            if (anchor && !anchor.hasAttribute('download') && (!anchor.target || anchor.target === '_self')) {
                const rawHref = String(anchor.getAttribute('href') || '').trim();
                if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) return;
                try {
                    const destUrl = new URL(anchor.href, window.location.href);
                    const sameDoc = destUrl.origin === window.location.origin
                        && destUrl.pathname === window.location.pathname
                        && destUrl.search === window.location.search;
                    if (sameDoc) return;
                    e.preventDefault();
                    e.stopPropagation();
                    confirmLeaveWithSystemModal(function () {
                        window.location.href = destUrl.href;
                    });
                } catch (_) {}
            }
        }, true);
    }

    installUnsavedNavigationGuard();

    // Expose API
    global.CiteFlowFormE0 = {
        init,
        autoSyncProfileAndLoads,
        onTermChange,
        saveDraft,
        openSubmitModal,
        closeSubmitModal,
        confirmSubmitForm,
        withdrawSubmission,
        setMode,
        setPreviewZoom,
        addClassRow,
        removeClassRow,
        updateClass,
        markDirty,
        recalculateTotals,
        runValidation,
        focusField,
        toggleProxyNotice,
        exportExcel
    };

    // Global helper aliases for inline onclicks
    global.setMode = setMode;
    global.setPreviewZoom = setPreviewZoom;
    global.onTermChange = onTermChange;
    global.autoSyncProfileAndLoads = autoSyncProfileAndLoads;
    global.saveDraft = saveDraft;
    global.openSubmitModal = openSubmitModal;
    global.closeSubmitModal = closeSubmitModal;
    global.confirmSubmitForm = confirmSubmitForm;
    global.withdrawSubmission = withdrawSubmission;
    global.addClassRow = addClassRow;
    global.removeClassRow = removeClassRow;
    global.updateClass = updateClass;
    global.markDirty = markDirty;
    global.recalculateTotals = recalculateTotals;
    global.runValidation = runValidation;
    global.toggleProxyNotice = toggleProxyNotice;
    global.exportExcel = exportExcel;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
