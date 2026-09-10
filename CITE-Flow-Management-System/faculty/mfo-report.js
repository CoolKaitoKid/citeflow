/**
 * Faculty MFO Report — Phase 2
 * Structured packet editor. Packet-level workflow only. No chairperson/admin review UI.
 */
(function initCiteFlowMfoFaculty(global) {
    'use strict';

    const BUCKET = 'wf-submissions';
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|gif|doc|docx|xls|xlsx)$/i;

    const TABLES = [
        {
            table: 'mfo_pi3_enrollment',
            code: 'mfo1_pi3',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI3 — Enrollment / sections / advisers',
            add: 'Add Section',
            columns: ['section', 'students_enrolled', 'adviser_name', 'academic_year', 'semester', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'adviser_faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'section', label: 'Class Section', type: 'text' },
                { key: 'students_enrolled', label: 'No. of students enrolled', type: 'number' },
                { key: 'adviser_name', label: 'Name of Adviser', type: 'text' },
                { key: 'academic_year', label: 'Academic year', type: 'text' },
                { key: 'semester', label: 'Semester', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_pi4_syllabus',
            code: 'mfo1_pi4',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI4 — Syllabus submitted this semester',
            add: 'Add Course',
            columns: ['subject_code', 'course_title', 'syllabus_status', 'related_syllabus_submission_id', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'subject_code', label: 'Subject code', type: 'text' },
                { key: 'course_title', label: 'Course / subject', type: 'text' },
                { key: 'syllabus_status', label: 'Syllabus status', type: 'select', options: ['submitted', 'not_submitted', 'not_applicable'] },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_pi5_certifications',
            code: 'mfo1_pi5',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI5 — Certifications',
            add: 'Add Certification',
            columns: ['certification_title', 'certification_nature', 'granting_agency', 'date_granted', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'certification_title', label: 'Certification title', type: 'text' },
                { key: 'certification_nature', label: 'Nature of certification', type: 'text', placeholder: 'accreditor / auditor / NC / TM / others' },
                { key: 'granting_agency', label: 'Granting agency', type: 'text' },
                { key: 'date_granted', label: 'Date granted', type: 'date' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_pi6_postgraduate',
            code: 'mfo1_pi6',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI6 — Postgraduate education',
            add: 'Add Program',
            columns: ['program_enrolled', 'institution_name', 'earned_units', 'current_units', 'remarks', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'program_enrolled', label: 'Program enrolled in', type: 'text' },
                { key: 'institution_name', label: 'Educational institution', type: 'text' },
                { key: 'earned_units', label: 'Total earned units', type: 'number' },
                { key: 'current_units', label: 'Units this semester', type: 'number' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_pi7_trainings',
            code: 'mfo1_pi7',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI7 — Trainings / workshops / seminars',
            add: 'Add Training',
            columns: ['title', 'training_type', 'activity_date', 'venue', 'sponsoring_agency', 'role', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'title', label: 'Title', type: 'text' },
                { key: 'training_type', label: 'Type', type: 'text', placeholder: 'Training / Workshop / Seminar / Conference' },
                { key: 'activity_date', label: 'Date', type: 'date' },
                { key: 'venue', label: 'Venue', type: 'text' },
                { key: 'sponsoring_agency', label: 'Sponsoring agency', type: 'text' },
                { key: 'role', label: 'Role', type: 'text', placeholder: 'participant / resource speaker / facilitator' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_pi8_instructional_materials',
            code: 'mfo1_pi8',
            group: 'MFO 1 — Higher Education Services',
            title: 'PI8 — Instructional materials',
            add: 'Add Instructional Material',
            columns: ['title', 'material_type', 'courses_utilizing', 'ip_nature', 'authors', 'remarks', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'title', label: 'Title of IM', type: 'text' },
                { key: 'material_type', label: 'Type', type: 'text', placeholder: 'print, media, graphics, etc.' },
                { key: 'courses_utilizing', label: 'Courses utilizing the IMs', type: 'text' },
                { key: 'ip_nature', label: 'Intellectual property protection', type: 'text', placeholder: 'copyright / UM / industrial design / patent' },
                { key: 'authors_text', label: 'Authors', type: 'text', placeholder: 'Separate names with semicolons' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_research_utilized',
            code: 'mfo3_pi1',
            group: 'MFO 3 — Research',
            title: 'PI1 — Research output utilized',
            add: 'Add Research',
            columns: ['research_title', 'proponents_text', 'proponents', 'utilization_nature', 'partner_name', 'partner_address', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'utilization_nature', label: 'Nature of utilization', type: 'text' },
                { key: 'partner_name', label: 'Partner community / industry', type: 'text' },
                { key: 'partner_address', label: 'Address of partner', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_research_completed',
            code: 'mfo3_pi2',
            group: 'MFO 3 — Research',
            title: 'PI2 — Research output completed',
            add: 'Add Research',
            hint: 'The source PDF table has no column headers. These fields are the Phase 1 normalized structure.',
            columns: ['research_title', 'proponents_text', 'proponents', 'completed_at', 'research_status', 'funding_source', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'completed_at', label: 'Date completed', type: 'date' },
                { key: 'research_status', label: 'Status', type: 'text' },
                { key: 'funding_source', label: 'Funding source (optional)', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_research_published',
            code: 'mfo3_pi3',
            group: 'MFO 3 — Research',
            title: 'PI3 — Research output published',
            add: 'Add Publication',
            columns: ['research_title', 'proponents_text', 'proponents', 'publication_name', 'published_at', 'funding_source', 'publication_url', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'publication_name', label: 'Name of publication', type: 'text' },
                { key: 'published_at', label: 'Date published', type: 'date' },
                { key: 'funding_source', label: 'Funding source', type: 'text' },
                { key: 'publication_url', label: 'URL / DOI', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_research_presented',
            code: 'mfo3_pi4',
            group: 'MFO 3 — Research',
            title: 'PI4 — Research output presented',
            add: 'Add Presentation',
            hint: 'The source PDF repeats “Title of Research”. The second title is stored as conference title.',
            columns: ['research_title', 'conference_title', 'proponents_text', 'proponents', 'presented_at', 'sponsoring_agency', 'venue', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'conference_title', label: 'Conference / event title', type: 'text' },
                { key: 'proponents_text', label: 'Proponents', type: 'text' },
                { key: 'presented_at', label: 'Date', type: 'date' },
                { key: 'sponsoring_agency', label: 'Sponsoring agency', type: 'text' },
                { key: 'venue', label: 'Venue', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_extension_partnerships',
            code: 'mfo4_pi1',
            group: 'MFO 4 — Technical Advisory Extension Program',
            title: 'PI1 — Active partnerships',
            add: 'Add Partnership',
            columns: ['project_title', 'proponents_text', 'proponents', 'partner_name', 'project_locale', 'has_moa', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'project_title', label: 'Title of community extension project', type: 'text' },
                { key: 'proponents_text', label: 'Proponents', type: 'text' },
                { key: 'partner_name', label: 'Partner industry / community', type: 'text' },
                { key: 'project_locale', label: 'Project locale', type: 'text' },
                { key: 'has_moa', label: 'With MOA', type: 'checkbox' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_extension_trainings',
            code: 'mfo4_pi2',
            group: 'MFO 4 — Technical Advisory Extension Program',
            title: 'PI2 — Trainees / manhours',
            add: 'Add Training',
            columns: ['training_title', 'partner_agency', 'beneficiaries_male', 'beneficiaries_female', 'training_hours', 'manhours_formula', 'manhours_override', 'remarks', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'training_title', label: 'Title of training', type: 'text' },
                { key: 'partner_agency', label: 'Partner agency', type: 'text' },
                { key: 'beneficiaries_male', label: 'Beneficiaries (male)', type: 'number' },
                { key: 'beneficiaries_female', label: 'Beneficiaries (female)', type: 'number' },
                { key: 'training_hours', label: 'Length of training (hours)', type: 'number' },
                { key: 'manhours_override', label: 'Manhours override (optional)', type: 'number' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_other_initiatives',
            code: 'other_initiatives',
            group: 'Other Initiatives / Activities',
            title: 'Other initiatives / activities',
            add: 'Add Initiative',
            columns: ['activity_title', 'category', 'description', 'activity_date', 'venue', 'sponsoring_agency', 'students_involved', 'student_role', 'faculty_involved', 'faculty_role', 'remarks', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'activity_title', label: 'Title of activity', type: 'text' },
                { key: 'category', label: 'Category', type: 'text', placeholder: 'instruction / research / extension' },
                { key: 'activity_date', label: 'Date conducted', type: 'date' },
                { key: 'venue', label: 'Venue', type: 'text' },
                { key: 'sponsoring_agency', label: 'Sponsoring agency', type: 'text' },
                { key: 'students_involved', label: 'Students involved', type: 'text' },
                { key: 'student_role', label: 'Student role', type: 'text' },
                { key: 'faculty_involved', label: 'Faculty involved', type: 'text' },
                { key: 'faculty_role', label: 'Faculty role', type: 'text' },
                { key: 'description', label: 'Description', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_awards',
            code: 'awards',
            group: 'Awards',
            title: 'Awards received',
            add: 'Add Award',
            columns: ['award_title', 'award_type', 'award_nature', 'granting_agency', 'awarded_at', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
            fields: [
                { key: 'award_title', label: 'Title of award', type: 'text' },
                { key: 'award_type', label: 'Award type', type: 'text' },
                { key: 'award_nature', label: 'Nature of award', type: 'text', placeholder: 'research / instruction / extension' },
                { key: 'granting_agency', label: 'Granting agency', type: 'text' },
                { key: 'awarded_at', label: 'Date of awarding ceremony', type: 'date' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ]
        },
        {
            table: 'mfo_documentation_items',
            code: 'documentation_other',
            group: 'Documentation',
            title: 'Supporting documentation (general)',
            add: 'Add Documentation',
            columns: ['section_code', 'title', 'caption', 'activity_date', 'activity_time', 'venue', 'narrative', 'record_table', 'record_id', 'faculty_id', 'sort_order'],
            fields: [
                { key: 'section_code', label: 'Documentation group', type: 'select', options: [
                    'documentation_instruction',
                    'documentation_training',
                    'documentation_postgraduate',
                    'documentation_research',
                    'documentation_extension',
                    'documentation_other'
                ] },
                { key: 'title', label: 'Title', type: 'text' },
                { key: 'activity_date', label: 'Date', type: 'date' },
                { key: 'activity_time', label: 'Time (optional)', type: 'text', placeholder: 'e.g. 9:00 AM – 12:00 NN' },
                { key: 'venue', label: 'Venue (optional)', type: 'text' },
                { key: 'narrative', label: 'Brief description / explanation', type: 'textarea' }
            ]
        }
    ];

    const DOC_LABELS = {
        documentation_instruction: 'Instruction',
        documentation_training: 'Trainings',
        documentation_postgraduate: 'Postgraduate education',
        documentation_research: 'Research',
        documentation_extension: 'Extension',
        documentation_other: 'Other engagements'
    };

    const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

    const state = {
        user: null,
        faculty: null,
        db: null,
        task: null,
        config: null,
        packet: null,
        submission: null,
        period: null,
        files: [],
        sectionStatus: {},
        rows: {},
        busy: false,
        locked: false,
        reviewOpen: false,
        previewOpen: false,
        configs: [],
        photoModal: null,
        lastSaved: null,
        catalog: [],
        taskWarning: '',
        routeWarning: '',
        configError: '',
        chairName: '',
        reviewerMode: false,
        sourceWarning: '',
        sourceErrors: [],
        autoSummary: null
    };

    function db() {
        return state.db || global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.();
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }

    function toast(message, type) {
        const el = document.getElementById('mfoToast');
        if (!el) {
            window.alert(message);
            return;
        }
        el.className = type === 'error' ? 'err' : 'ok';
        el.style.display = 'block';
        el.textContent = message;
        window.clearTimeout(toast._t);
        toast._t = window.setTimeout(() => {
            el.className = '';
            el.style.display = 'none';
        }, 4200);
    }

    function friendlyError(error, fallback) {
        const msg = String(error?.message || error || '');
        const code = String(error?.code || error?.status || '');
        const status = Number(error?.status || error?.statusCode || 0);
        console.error(
            `[MFO] ${msg || 'unknown error'}${code ? ` (code ${code})` : ''}`,
            { message: msg, code, status, details: error?.details, hint: error?.hint, error }
        );
        if (status === 429 || /rate limit|too many requests/i.test(msg)) {
            return 'Too many sign-in refreshes were requested. Wait about a minute and reload this page.';
        }
        // Checked before the session heuristics below: an authorization failure
        // is not an authentication failure, and telling a signed-in user to
        // sign in again sends them chasing the wrong problem.
        if (code === '42501' || /row-level security|violates row-level|permission denied|42501/i.test(msg)) {
            return 'Unable to save or submit the MFO report. Please try again or contact the administrator.';
        }
        if (/jwt|expired|session|not authenticated/i.test(msg)) {
            return 'Your session expired. Please sign in again.';
        }
        if (/no public\.faculty|not linked|faculty profile/i.test(msg)) {
            return 'Your account is signed in, but no matching faculty profile was found. Please contact the administrator.';
        }
        if (/another faculty|not allowed to create/i.test(msg)) {
            return 'Unable to create the MFO report for this account. Please contact the administrator.';
        }
        if (/duplicate|unique/i.test(msg)) return 'An MFO report for this period already exists and was reopened.';
        if (/network|fetch/i.test(msg)) return 'Network error. Check your connection and try again.';
        return fallback || msg || 'Something went wrong. Please try again.';
    }

    async function ensureAuthSession() {
        const client = db();
        if (!client?.auth?.getSession) return null;
        if (global.CiteFlowAuth?.getFreshSession) {
            return global.CiteFlowAuth.getFreshSession(client);
        }
        if (global.CiteFlowWorkflow?.getFreshSession) {
            return global.CiteFlowWorkflow.getFreshSession(client);
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

    function isNumericFacultyId(value) {
        return value != null && value !== '' && Number.isFinite(Number(value)) && !String(value).includes('-');
    }

    /**
     * Resolve the same public.faculty row MFO RLS expects.
     * Prefer auth_user_id (matches SQL), never use admin UUID fallbacks.
     */
    async function resolveMfoFaculty(user) {
        const client = db();
        const email = String(user?.email || '').trim().toLowerCase();

        let byAuth = await client
            .from('faculty')
            .select('*')
            .eq('auth_user_id', user.id)
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (byAuth.error && !/no rows|PGRST116/i.test(byAuth.error.message || '')) {
            console.warn('[MFO] faculty by auth_user_id', byAuth.error);
        }

        let row = byAuth.data || null;
        if (!row && email) {
            const byEmail = await client
                .from('faculty')
                .select('*')
                .or(`email.ilike.${email},existing_email.ilike.${email}`)
                .order('id', { ascending: true })
                .limit(10);
            if (byEmail.error) console.warn('[MFO] faculty by email', byEmail.error);
            const rows = byEmail.data || [];
            row = rows.find((item) => String(item.auth_user_id || '') === String(user.id))
                || rows[0]
                || null;
        }

        if (!row) {
            throw new Error('No matching public.faculty profile was found for this account. MFO cannot use admin-only accounts.');
        }
        if (!isNumericFacultyId(row.id)) {
            throw new Error('Invalid faculty identity. MFO requires public.faculty.id (bigint), not an auth UUID.');
        }

        const normalized = global.CiteFlowWorkflow.normalizeFaculty(row);
        normalized.id = Number(row.id);
        return normalized;
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
    }

    function tmpId() {
        return 'tmp-' + Math.random().toString(36).slice(2, 10);
    }

    function isMfoSource(source) {
        const wf = global.CiteFlowWorkflow;
        if (wf?.resolveDocumentCategory && wf.resolveDocumentCategory(source) === 'MFO') return true;
        const blob = [
            source?.title, source?.report_name, source?.name, source?.instructions, source?.description
        ].join(' ').toLowerCase();
        return /\bmfo\b|major final output|accomplishment report/.test(blob);
    }

    function manilaNow() {
        return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    }

    function isoDate(value) {
        if (!value) return '';
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function formatWhen(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function quarterPeriod(now) {
        const q = Math.floor(now.getMonth() / 3);
        const start = new Date(now.getFullYear(), q * 3, 1);
        const end = new Date(now.getFullYear(), q * 3 + 3, 0);
        const names = ['January to March', 'April to June', 'July to September', 'October to December'];
        const ordinal = ['1st', '2nd', '3rd', '4th'][q];
        return {
            reporting_year: start.getFullYear(),
            quarter: q + 1,
            period_start: isoDate(start),
            period_end: isoDate(end),
            period_label: `${ordinal} Quarter — ${names[q]} ${start.getFullYear()}`
        };
    }

    function periodFromTask(task, config) {
        if (task?.reporting_period_start && task?.reporting_period_end) {
            const start = new Date(task.reporting_period_start);
            const q = Number.isNaN(start.getTime()) ? null : Math.floor(start.getMonth() / 3) + 1;
            return {
                reporting_year: start.getFullYear() || manilaNow().getFullYear(),
                quarter: q,
                period_start: String(task.reporting_period_start).slice(0, 10),
                period_end: String(task.reporting_period_end).slice(0, 10),
                period_label: task.reporting_period_label || `Q${q || ''} ${start.getFullYear()}`
            };
        }
        if (config?.frequency) {
            const now = manilaNow();
            if (config.frequency === 'quarterly' || !config.frequency) return quarterPeriod(now);
            if (config.frequency === 'annual') {
                const y = now.getFullYear();
                return {
                    reporting_year: y,
                    quarter: null,
                    period_start: `${y}-01-01`,
                    period_end: `${y}-12-31`,
                    period_label: `Annual ${y}`
                };
            }
        }
        return quarterPeriod(manilaNow());
    }

    function periodsMatch(packet, period) {
        if (!packet || !period) return false;
        if (packet.period_start && period.period_start && packet.period_end && period.period_end) {
            return String(packet.period_start).slice(0, 10) === String(period.period_start).slice(0, 10)
                && String(packet.period_end).slice(0, 10) === String(period.period_end).slice(0, 10);
        }
        if (packet.reporting_year && period.reporting_year && packet.quarter && period.quarter) {
            return Number(packet.reporting_year) === Number(period.reporting_year)
                && Number(packet.quarter) === Number(period.quarter);
        }
        return false;
    }

    /**
     * The config the database will use to route this submission.
     *
     * public.wf_task_requires_chairperson() reads wf_tasks.report_config_id, so
     * the routing decision has to come from the task's own linked config.
     * state.config is not usable here: resolveContext() falls back to the first
     * MFO config when the task has none, which is fine for deriving the period
     * but wrong for deciding who reviews.
     */
    function linkedApprovalConfig() {
        const linkedId = state.task?.report_config_id;
        if (!linkedId) return null;
        if (state.config && String(state.config.id) === String(linkedId)) return state.config;
        return (state.configs || []).find((cfg) => String(cfg.id) === String(linkedId)) || null;
    }

    /**
     * Mirrors public.wf_task_requires_chairperson(): a linked config decides,
     * a linked config with no flag set still means Chairperson review, and a
     * task with no linked config goes straight to the final approver.
     *
     * Claiming Chairperson review when the database disagrees strands the
     * submission — the Chairperson queue filters on the SQL function and never
     * shows it, while the admin page refuses to act on anything still marked
     * 'chairperson'.
     */
    function mfoApprovalConfig() {
        const config = linkedApprovalConfig();
        // The MFO workflow requires Chairperson review unless a linked
        // configuration explicitly disables it. A missing configuration is a
        // configuration error, never consent to bypass the Chairperson, so the
        // route still reads as 'chairperson' here and submitPacket() refuses
        // rather than quietly sending the report to Admin.
        if (!config) return { requires_chairperson_review: true };
        if (config.requires_chairperson_review === false) return config;
        return Object.assign({}, config, { requires_chairperson_review: true });
    }

    function requiresChairpersonReview() {
        return mfoApprovalConfig().requires_chairperson_review !== false;
    }

    /**
     * True when the task carries no linked wf_report_configs row. The database
     * decides routing from wf_tasks.report_config_id, so without it the
     * Chairperson queue can never surface this submission — which makes
     * submitting it a silent bypass. Blocked instead.
     */
    function approvalConfigMissing() {
        return !linkedApprovalConfig();
    }

    const CONFIG_ERROR = 'Workflow configuration error: this MFO task is not linked to an MFO report configuration, so the system cannot route it to your Chairperson. Ask an administrator to link the task to a wf_report_configs entry with Chairperson review enabled. Submission is blocked until then — the report will not be sent directly to Admin.';

    function mfoApprovalStage() {
        return global.CiteFlowWorkflow.resolveInitialApprovalStage(mfoApprovalConfig(), state.task);
    }

    /**
     * The stage this report should enter, accounting for who is submitting it.
     *
     * A Chairperson has to file their own MFO, and the Chairperson stage is
     * scoped by department. If the only grant covering their department is
     * their own, routing their report to the Chairperson stage strands it: they
     * are excluded from reviewing themselves and no other Chairperson is in
     * scope. Those reports go straight to Admin final review instead.
     *
     * The decision is made by the database when
     * wf_resolve_initial_approval_stage() is available, because RLS shows the
     * browser only its own grant rows and so cannot tell "I am the only
     * Chairperson for this department" from "someone else covers it too".
     */
    async function mfoApprovalStageForSubmitter() {
        const helper = global.CiteFlowWorkflow;
        if (!helper?.resolveInitialApprovalStageForSubmission) return mfoApprovalStage();

        let grants = [];
        try {
            grants = await helper.loadActiveDelegatedAccess(db());
        } catch (error) {
            console.warn('[MFO] could not read delegated access for routing', error);
        }

        return helper.resolveInitialApprovalStageForSubmission(db(), {
            config: mfoApprovalConfig(),
            task: state.task,
            submitterFaculty: state.faculty,
            delegatedAccess: grants
        });
    }

    function catalogTitle(code, fallback) {
        const row = (state.catalog || []).find((item) => item.section_code === code);
        if (!row) return fallback;
        return row.indicator_code ? `${row.indicator_code} — ${row.title}` : row.title;
    }

    function emptyRow(def) {
        const row = { id: tmpId(), source_kind: 'manual' };
        (def.fields || []).forEach((field) => {
            row[field.key] = field.type === 'checkbox' ? false : '';
        });
        if (def.table === 'mfo_documentation_items') {
            row.section_code = 'documentation_other';
            row.activity_time = '';
            row.venue = '';
        }
        if (def.table === 'mfo_extension_trainings') row.manhours_formula = 'hours_x_beneficiaries';
        return row;
    }

    /**
     * Documentation rows written before migration 015 packed the time and
     * venue into the narrative text. Read those apart on load so older drafts
     * still display correctly; new writes use the real columns.
     */
    function unpackDocDetails(row) {
        const raw = String(row?.narrative || '');
        let activity_time = row.activity_time || '';
        let venue = row.venue || '';
        let narrative = raw;
        if (!activity_time || !venue) {
            const timeMatch = raw.match(/^Time:\s*(.+)$/im);
            const venueMatch = raw.match(/^Venue:\s*(.+)$/im);
            if (timeMatch || venueMatch) {
                if (timeMatch) activity_time = activity_time || timeMatch[1].trim();
                if (venueMatch) venue = venue || venueMatch[1].trim();
                narrative = raw
                    .replace(/^Time:\s*.+$/im, '')
                    .replace(/^Venue:\s*.+$/im, '')
                    .replace(/^\s+/, '')
                    .trim();
            }
        }
        return {
            ...row,
            title: row.title || row.caption || '',
            activity_time,
            venue,
            narrative
        };
    }

    function docsForIndicator(sectionCode) {
        return (state.rows.mfo_documentation_items || [])
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => String(row.section_code || '') === String(sectionCode));
    }

    function generalDocs() {
        return (state.rows.mfo_documentation_items || [])
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => String(row.section_code || '').startsWith('documentation_'));
    }

    function authorsToText(value) {
        if (Array.isArray(value)) {
            return value.map((item) => (typeof item === 'string' ? item : item?.name || '')).filter(Boolean).join('; ');
        }
        return String(value || '');
    }

    function textToAuthors(value) {
        return String(value || '').split(/;|\n/).map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
    }

    function manhoursPreview(row) {
        const hours = Number(row.training_hours);
        const male = Number(row.beneficiaries_male) || 0;
        const female = Number(row.beneficiaries_female) || 0;
        if (!Number.isFinite(hours)) return '—';
        const calc = hours * (male + female);
        if (row.manhours_override !== '' && row.manhours_override != null) {
            return `${Number(row.manhours_override)} (override; calculated ${calc.toFixed(2)})`;
        }
        return `${calc.toFixed(2)}  (hours × male+female)`;
    }

    function statusLabel() {
        const wf = global.CiteFlowWorkflow;
        const sub = state.submission;
        const task = state.task;
        if (!sub || !sub.submitted_at) return 'Draft';
        // Path B routes straight to the final approver, so the pending label has
        // to follow the configured path rather than always naming the Chairperson.
        const pendingFirstReview = requiresChairpersonReview()
            ? 'Submitted — Awaiting Chairperson Review'
            : 'Submitted — Pending Admin Final Approval';
        if (wf?.getWorkflowStage) {
            const stage = wf.getWorkflowStage(sub, task, mfoApprovalConfig());
            if (stage === 'chairperson_review' || stage === 'submitted') return pendingFirstReview;
            if (stage === 'final_approval') return 'Pending Admin Final Approval';
            if (stage === 'completed') return 'Admin Approved';
            if (stage === 'revision_required') return 'Returned for Revision';
            if (stage === 'rejected') return 'Declined';
        }
        const stage = String(sub.approval_stage || '').toLowerCase();
        const status = String(sub.status || '').toLowerCase();
        if (status === 'revision' || stage === 'revision') return 'Returned for Revision';
        if (status === 'rejected' || stage === 'declined') return 'Declined';
        if (stage === 'approved' || status === 'approved') return 'Admin Approved';
        if (stage === 'final_approver') return 'Pending Admin Final Approval';
        if (stage === 'chairperson') return 'Submitted — Awaiting Chairperson Review';
        return pendingFirstReview;
    }

    function computeLocked() {
        const wf = global.CiteFlowWorkflow;
        const sub = state.submission;
        if (!sub || !sub.submitted_at) return false;
        if (wf?.getWorkflowStage) {
            const stage = wf.getWorkflowStage(sub, state.task, mfoApprovalConfig());
            return !['assigned', 'late_pending', 'revision_required', 'rejected'].includes(stage);
        }
        const status = String(sub.status || '').toLowerCase();
        return ['submitted', 'late', 'underreview', 'approved'].includes(status);
    }

    function filesFor(code, recordId) {
        return (state.files || []).filter((file) => {
            if (recordId) return String(file.mfo_record_id || '') === String(recordId);
            return file.mfo_section === code && !file.mfo_record_id;
        });
    }

    async function init() {
        const root = document.getElementById('mfoApp');
        try {
            if (typeof global.loadSidebar === 'function') await global.loadSidebar();
            state.db = db();
            if (!state.db) throw new Error('Database client is not available.');

            if (global.CiteFlowAuthGuard?.ready) {
                await global.CiteFlowAuthGuard.ready;
                if (global.CiteFlowAuthGuard.state === 'AUTH_UNAUTHENTICATED') {
                    return;
                }
            }

            const wf = global.CiteFlowWorkflow;
            const session = await ensureAuthSession();
            state.user = session?.user
                || global.CiteFlowAuthGuard?.user
                || await wf.getCurrentUser();
            if (!state.user) {
                const next = encodeURIComponent(`${window.location.pathname}${window.location.search || ''}`);
                window.location.replace(`../login.html?next=${next}`);
                return;
            }

            // Reviewer route: same renderer, read-only, reading the author's
            // packet instead of the signed-in user's. Access is decided by
            // mfo_can_select_packet / wf_submissions RLS, not here.
            const params = new URLSearchParams(window.location.search);
            if (params.get('view') === 'review' && params.get('submission')) {
                await initReviewerMode(params.get('submission'));
                return;
            }

            state.faculty = await resolveMfoFaculty(state.user);

            await resolveContext();
            await ensurePacket();
            await loadPacketData();
            await suggestFromSystem();
            state.locked = computeLocked();
            render();
        } catch (error) {
            if (root) {
                const message = friendlyError(error, error.message);
                const isAuth = /session expired|not authenticated|sign in/i.test(message);
                root.innerHTML = `
                    <div class="surface rounded-[16px] p-6">
                        <div class="cite-kicker">MFO Report</div>
                        <h1 class="cite-title">${isAuth ? 'Sign in required' : 'Unable to open MFO'}</h1>
                        <p class="cite-subtitle mt-2">${esc(message)}</p>
                        <div class="flex flex-wrap gap-2 mt-5">
                            <a href="submissions.html" class="cite-action inline-flex">Back to Submissions</a>
                            <button type="button" class="cite-action-primary" onclick="location.reload()">Retry</button>
                        </div>
                    </div>`;
            }
        }
    }

    /**
     * Read-only view of a submitted MFO for an authorized Chairperson or
     * Admin. Deliberately never calls resolveMfoFaculty(): the report belongs
     * to the submitting faculty member, not the reviewer. Every read below is
     * an ordinary RLS-governed select, so an unauthorized reviewer simply gets
     * nothing back and sees the not-available message.
     */
    async function initReviewerMode(submissionId) {
        const client = db();
        state.reviewerMode = true;

        const sub = await client.from('wf_submissions').select('*').eq('id', submissionId).maybeSingle();
        if (sub.error) throw sub.error;
        if (!sub.data) throw new Error('This submission is not available to your account.');
        state.submission = sub.data;

        const packet = await client.from('mfo_packets').select('*')
            .eq('submission_id', submissionId).maybeSingle();
        if (packet.error) throw packet.error;
        if (!packet.data) throw new Error('No MFO report is attached to this submission.');
        state.packet = packet.data;

        const [author, task, configs, catalog] = await Promise.all([
            client.from('faculty').select('*').eq('id', state.packet.faculty_id).maybeSingle(),
            state.submission.task_id
                ? client.from('wf_tasks').select('*').eq('id', state.submission.task_id).maybeSingle()
                : Promise.resolve({ data: null }),
            client.from('wf_report_configs').select('*'),
            client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true })
        ]);

        state.faculty = author.data || {
            id: state.packet.faculty_id,
            full_name: 'Faculty',
            department: state.packet.department
        };
        state.task = task.data || null;
        state.configs = configs.data || [];
        state.config = linkedApprovalConfig();
        state.catalog = catalog.data || [];
        state.period = {
            reporting_year: state.packet.reporting_year,
            quarter: state.packet.quarter,
            period_label: state.packet.period_label,
            period_start: state.packet.period_start,
            period_end: state.packet.period_end,
            academic_year: state.packet.academic_year,
            semester: state.packet.semester
        };

        await loadPacketData();
        // Locked so no editor control can ever write through this route.
        state.locked = true;
        state.previewOpen = true;
        render();
    }

    async function resolveContext() {
        const client = db();
        const facultyId = state.faculty.id;
        const params = new URLSearchParams(window.location.search);
        const requestedTaskId = params.get('task');

        const [{ data: configs }, assigned, catalog] = await Promise.all([
            client.from('wf_report_configs').select('*'),
            global.CiteFlowWorkflow.loadFacultyAssignedTasks(facultyId),
            client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true })
        ]);
        if (assigned.error) console.warn('[MFO] assigned tasks', assigned.error);
        if (catalog.error) console.warn('[MFO] section catalog', catalog.error);
        state.catalog = catalog.data || [];
        TABLES.forEach((def) => {
            const row = state.catalog.find((item) => item.section_code === def.code);
            if (row?.title) def.title = catalogTitle(def.code, def.title);
        });

        state.configs = configs || [];
        const mfoConfigs = state.configs.filter((row) => isMfoSource(row));
        const tasks = assigned.tasks || [];
        let task = null;
        if (requestedTaskId) {
            task = tasks.find((row) => String(row.id) === String(requestedTaskId)) || null;
            if (!task) {
                const fetched = await client.from('wf_tasks').select('*').eq('id', requestedTaskId).maybeSingle();
                if (fetched.data && isMfoSource(fetched.data)) task = fetched.data;
            }
        }
        if (!task) {
            const mfoTasks = tasks.filter((row) => {
                if (isMfoSource(row)) return true;
                return mfoConfigs.some((cfg) => String(cfg.id) === String(row.report_config_id));
            });
            mfoTasks.sort((a, b) => new Date(b.created_at || b.due_at || 0) - new Date(a.created_at || a.due_at || 0));
            task = mfoTasks[0] || null;
        }

        if (task) {
            state.task = task;
            state.config = mfoConfigs.find((cfg) => String(cfg.id) === String(task.report_config_id)) || mfoConfigs[0] || null;
            if (!state.config && task.report_config_id) {
                const one = await client.from('wf_report_configs').select('*').eq('id', task.report_config_id).maybeSingle();
                state.config = one.data || null;
            }
        } else if (mfoConfigs[0]) {
            state.config = mfoConfigs[0];
        }

        state.period = periodFromTask(state.task, state.config);
        if (window.CiteFlowSettings?.getAcademicPeriod) {
            try {
                const academic = await window.CiteFlowSettings.getAcademicPeriod();
                state.period.academic_year = academic.academic_year || '';
                state.period.semester = academic.semester || '';
            } catch (_) {}
        }

        const existingPackets = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
        if (existingPackets.error) console.warn('[MFO] packet list', existingPackets.error);
        const mine = existingPackets.data || [];
        const byRequestedTask = state.task
            ? mine.find((row) => String(row.task_id) === String(state.task.id))
            : null;
        const byPeriod = mine.find((row) => periodsMatch(row, state.period));
        const resume = byRequestedTask || byPeriod || null;
        if (resume) {
            state.packet = resume;
            if (resume.period_label) state.period.period_label = resume.period_label;
            if (resume.reporting_year) state.period.reporting_year = resume.reporting_year;
            if (resume.quarter) state.period.quarter = resume.quarter;
            if (resume.period_start) state.period.period_start = String(resume.period_start).slice(0, 10);
            if (resume.period_end) state.period.period_end = String(resume.period_end).slice(0, 10);
            if (resume.task_id && (!state.task || String(state.task.id) !== String(resume.task_id))) {
                const fetched = await client.from('wf_tasks').select('*').eq('id', resume.task_id).maybeSingle();
                if (fetched.data) state.task = fetched.data;
            }
        }

        if (!state.task) {
            await createFallbackTask();
        }

        // Named up front rather than discovered at submit time.
        state.configError = (state.task && approvalConfigMissing()) ? CONFIG_ERROR : '';
    }

    const NO_TASK_WARNING = 'No MFO task is assigned for this period. You can still save a draft. Ask an administrator to create a quarterly MFO report before submitting.';

    /**
     * Safe snapshot for diagnosing authorization failures.
     * Deliberately carries no access token, refresh token, or credential.
     */
    async function authSnapshot() {
        const client = db();
        let session = null;
        try {
            session = (await client?.auth?.getSession())?.data?.session || null;
        } catch (_) {}
        const expiresAt = Number(session?.expires_at || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        return {
            hasSession: !!session,
            hasUser: !!session?.user,
            jwtPresent: !!session?.access_token,
            authUserId: session?.user?.id || null,
            expiresInSeconds: expiresAt ? expiresAt - nowSec : null,
            facultyId: state.faculty?.id ?? null,
            facultyIdType: typeof state.faculty?.id,
            facultyRole: state.faculty?.role || state.faculty?.position || null
        };
    }

    /**
     * Authoritative answer to "may this account create workflow tasks", taken
     * from the same SQL function the wf_tasks policy evaluates. Falls back to
     * the client role heuristic only if the function is unavailable.
     */
    async function currentUserIsFinalApprover() {
        try {
            const { data, error } = await db().rpc('wf_is_final_approver');
            if (!error && typeof data === 'boolean') return data;
            if (error) console.warn('[MFO] wf_is_final_approver unavailable', error.message);
        } catch (error) {
            console.warn('[MFO] wf_is_final_approver threw', error);
        }
        return !!global.CiteFlowWorkflow?.isFinalApprover?.(state.faculty);
    }

    async function createFallbackTask() {
        const client = db();
        const faculty = state.faculty;
        const period = state.period;

        // wf_tasks INSERT is reserved for final approvers by the
        // wf_tasks_admin_write policy: administrators publish the reporting
        // task and faculty report against it. Faculty attempting the insert
        // only produces a rejected request, and mfo_packets.task_id is
        // nullable, so a draft is still possible without a task.
        //
        // Ask the same function the policy uses rather than guessing from the
        // faculty role. wf_is_final_approver() also counts an admin_profiles
        // row, which a role-based client check cannot see, so guessing would
        // wrongly skip the insert for some administrators.
        if (!(await currentUserIsFinalApprover())) {
            state.taskWarning = NO_TASK_WARNING;
            return false;
        }
        const due = new Date();
        due.setDate(due.getDate() + 14);
        due.setHours(17, 0, 0, 0);
        const dueAt = due.toISOString();
        const row = {
            title: `MFO (Accomplishment Report) — ${period.period_label}`,
            instructions: 'Complete your faculty MFO contribution for this reporting period, then submit for Chairperson review.',
            due_at: dueAt,
            deadline_at: dueAt,
            created_by_name: faculty.full_name,
            assigned_label: 'Faculty MFO',
            assigned_scope: 'specific',
            submission_method: 'file_and_text',
            is_recurring: false,
            reporting_period_start: period.period_start,
            reporting_period_end: period.period_end,
            reporting_period_label: period.period_label
        };
        if (state.config?.id) row.report_config_id = state.config.id;

        let result = await client.from('wf_tasks').insert(row).select('*').single();
        if (result.error) {
            const slim = {
                title: row.title,
                instructions: row.instructions,
                due_at: dueAt,
                created_by_name: faculty.full_name
            };
            result = await client.from('wf_tasks').insert(slim).select('*').single();
        }
        if (result.error) {
            console.warn('[MFO] wf_tasks insert rejected', result.error, await authSnapshot());
            state.taskWarning = NO_TASK_WARNING;
            return false;
        }
        state.task = result.data;
        const assignment = await client.from('wf_task_assignments').insert({
            task_id: state.task.id,
            faculty_id: faculty.id,
            assigned_by_name: faculty.full_name
        });
        if (assignment.error && !/duplicate|unique/i.test(assignment.error.message || '')) {
            await client.from('wf_task_assignments').insert({
                task_id: state.task.id,
                faculty_id: faculty.id
            });
        }
        return true;
    }

    async function ensurePacket() {
        const client = db();
        const faculty = state.faculty;
        const facultyId = Number(faculty.id);
        const task = state.task;
        const period = state.period;

        let session = await ensureAuthSession();
        if (!session?.user) {
            // Second opinion straight from storage: a failed refresh must not
            // be reported as a signed-out user while a usable session is held.
            session = (await client.auth.getSession())?.data?.session || null;
        }
        if (!session?.user) {
            console.error('[MFO] no session before packet write', await authSnapshot());
            throw new Error('Not authenticated');
        }

        if (task?.id) {
            const existingSub = await client
                .from('wf_submissions')
                .select('*')
                .eq('task_id', task.id)
                .eq('faculty_id', facultyId)
                .maybeSingle();
            if (existingSub.error && !/no rows|PGRST116/i.test(existingSub.error.message || '')) {
                console.warn('[MFO] submission lookup', existingSub.error);
            }
            state.submission = existingSub.data || null;
        }

        if (!state.packet && task?.id) {
            const byTask = await client
                .from('mfo_packets')
                .select('*')
                .eq('faculty_id', facultyId)
                .eq('task_id', task.id)
                .maybeSingle();
            if (byTask.error && !/no rows|PGRST116/i.test(byTask.error.message || '')) {
                throw byTask.error;
            }
            state.packet = byTask.data || null;
        }

        if (!state.packet) {
            const listed = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
            state.packet = (listed.data || []).find((row) => periodsMatch(row, period)) || null;
        }

        if (!state.packet) {
            const rpcPayload = {
                p_faculty_id: facultyId,
                p_task_id: task?.id || null,
                p_report_config_id: task?.report_config_id || state.config?.id || null,
                p_department: faculty.department || faculty.department_code || null,
                p_reporting_year: period.reporting_year || null,
                p_quarter: period.quarter || null,
                p_period_start: period.period_start || null,
                p_period_end: period.period_end || null,
                p_period_label: period.period_label || null,
                p_academic_year: period.academic_year || null,
                p_semester: period.semester || null,
                p_submission_id: state.submission?.id || null
            };

            let created = await client.rpc('mfo_ensure_faculty_packet', rpcPayload);
            if (created.error && /could not find|PGRST202|function|schema cache/i.test(created.error.message || '')) {
                console.warn('[MFO] mfo_ensure_faculty_packet RPC missing — falling back to owned insert');
                created = null;
            } else if (created.error) {
                try {
                    const debug = await client.rpc('mfo_debug_ownership', { p_faculty_id: facultyId });
                    console.error('[MFO] ownership debug', debug.data || debug.error);
                } catch (debugErr) {
                    console.warn('[MFO] ownership debug unavailable', debugErr);
                }
                throw created.error;
            } else if (created.data) {
                state.packet = Array.isArray(created.data) ? created.data[0] : created.data;
            }

            if (!state.packet) {
                const insert = {
                    task_id: task?.id || null,
                    report_config_id: task?.report_config_id || state.config?.id || null,
                    faculty_id: facultyId,
                    department: faculty.department || faculty.department_code || '',
                    reporting_year: period.reporting_year,
                    quarter: period.quarter,
                    period_start: period.period_start,
                    period_end: period.period_end,
                    period_label: period.period_label,
                    academic_year: period.academic_year || null,
                    semester: period.semester || null,
                    packet_state: 'draft',
                    submission_id: state.submission?.id || null
                };
                let direct = await client.from('mfo_packets').insert(insert).select('*').single();
                if (direct.error && /column|schema cache|report_config|academic_year|semester|quarter/i.test(direct.error.message || '')) {
                    const slim = {
                        task_id: insert.task_id,
                        faculty_id: facultyId,
                        department: insert.department,
                        reporting_year: insert.reporting_year,
                        period_start: insert.period_start,
                        period_end: insert.period_end,
                        period_label: insert.period_label,
                        packet_state: 'draft'
                    };
                    direct = await client.from('mfo_packets').insert(slim).select('*').single();
                }
                if (direct.error) {
                    if (/duplicate|unique/i.test(direct.error.message || '')) {
                        const again = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
                        state.packet = (again.data || []).find((row) =>
                            (task?.id && String(row.task_id) === String(task.id)) || periodsMatch(row, period)
                        ) || null;
                        if (!state.packet) throw direct.error;
                    } else {
                        try {
                            const debug = await client.rpc('mfo_debug_ownership', { p_faculty_id: facultyId });
                            console.error('[MFO] ownership debug', debug.data || debug.error);
                        } catch (_) {}
                        throw direct.error;
                    }
                } else {
                    state.packet = direct.data;
                }
            }
        }

        if (state.packet && task?.id && !state.packet.task_id) {
            const linked = await client.from('mfo_packets').update({ task_id: task.id }).eq('id', state.packet.id).eq('faculty_id', facultyId).select('*').maybeSingle();
            if (linked.data) state.packet = linked.data;
            else state.packet.task_id = task.id;
        }

        if (!state.submission && task?.id) {
            const draft = {
                task_id: task.id,
                faculty_id: facultyId,
                status: 'notsubmitted',
                approval_stage: mfoApprovalStage()
            };
            const saved = await client.from('wf_submissions').upsert(draft, { onConflict: 'task_id,faculty_id' }).select('*').single();
            if (saved.error) {
                console.warn('[MFO] draft submission', saved.error);
            } else {
                state.submission = saved.data;
                if (state.packet && !state.packet.submission_id) {
                    await client.from('mfo_packets').update({ submission_id: saved.data.id }).eq('id', state.packet.id).eq('faculty_id', facultyId);
                    state.packet.submission_id = saved.data.id;
                }
            }
        }
    }

    async function loadPacketData() {
        if (!state.packet?.id) {
            throw new Error('Unable to open or create an MFO packet for this faculty account.');
        }
        const client = db();
        const packetId = state.packet.id;
        TABLES.forEach((def) => {
            state.rows[def.table] = [];
        });

        await Promise.all(TABLES.map(async (def) => {
            const result = await client.from(def.table).select('*').eq('packet_id', packetId).order('sort_order', { ascending: true });
            if (result.error) {
                console.warn('[MFO] load', def.table, result.error);
                return;
            }
            state.rows[def.table] = (result.data || []).map((row) => {
                const copy = { ...row };
                if (def.table === 'mfo_pi8_instructional_materials') copy.authors_text = authorsToText(row.authors);
                if (def.table === 'mfo_documentation_items') Object.assign(copy, unpackDocDetails(row));
                return copy;
            });
        }));

        const status = await client.from('mfo_section_status').select('*').eq('packet_id', packetId);
        state.sectionStatus = {};
        (status.data || []).forEach((row) => {
            state.sectionStatus[row.section_code] = row;
        });

        let files;
        if (state.packet.submission_id) {
            files = await client
                .from('wf_submission_files')
                .select('*')
                .or(`mfo_packet_id.eq.${packetId},submission_id.eq.${state.packet.submission_id}`);
        } else {
            files = await client.from('wf_submission_files').select('*').eq('mfo_packet_id', packetId);
        }
        state.files = files.data || [];
    }

    function sourcesApi() {
        return global.CiteFlowMfoSources || null;
    }

    /**
     * Populate MFO rows from records that already exist in CITE-Flow.
     *
     * Retrieval and field mapping live in shared/mfo-sources.js, so this page
     * never queries a source table directly. The merge only writes fields that
     * are empty or were themselves system-sourced, so a manual correction is
     * never replaced by a later refresh.
     */
    async function suggestFromSystem() {
        if (state.locked) return;
        const api = sourcesApi();
        if (!api) {
            console.warn('[MFO] shared/mfo-sources.js is not loaded. Automatic population is unavailable.');
            state.sourceWarning = 'Automatic data retrieval is unavailable. All fields are open for manual entry.';
            return;
        }

        let loaded;
        try {
            loaded = await api.loadSources(db(), {
                facultyIds: [state.faculty.id],
                period: state.period
            });
        } catch (error) {
            console.warn('[MFO] loadSources failed', error);
            state.sourceWarning = 'Automatic data retrieval failed. You can still complete the report manually.';
            return;
        }

        state.sourceErrors = loaded.errors || [];
        if (state.sourceErrors.length) {
            const names = state.sourceErrors.map((item) => item.table).join(', ');
            state.sourceWarning = `Some records could not be read automatically (${names}). Those fields are open for manual entry.`;
        }

        let candidates;
        try {
            candidates = api.buildCandidates(loaded, {
                period: state.period,
                includeUndated: true
            });
        } catch (error) {
            console.warn('[MFO] buildCandidates failed', error);
            return;
        }

        let added = 0;
        let filled = 0;

        TABLES.forEach((def) => {
            const forSection = candidates[def.code];
            if (!forSection || !forSection.length) return;
            if (state.sectionStatus[def.code]?.is_not_applicable) return;
            try {
                const result = api.mergeCandidates(state.rows[def.table] || [], forSection, {
                    newRow: () => Object.assign(emptyRow(def), { faculty_id: state.faculty.id }),
                    refreshSystemValues: true
                });
                state.rows[def.table] = result.rows;
                added += result.added;
                filled += result.filled;
            } catch (error) {
                console.warn('[MFO] merge failed for', def.table, error);
            }
        });

        state.autoSummary = { added, filled };
    }

    function updateRow(table, index, key, input) {
        const row = state.rows[table]?.[index];
        if (!row || state.locked) return;
        row[key] = input.type === 'checkbox' ? input.checked : input.value;
        // Record that this value was typed by the user so no later automatic
        // refresh can replace it.
        sourcesApi()?.markManual(row, key);
        if (table === 'mfo_extension_trainings') {
            const preview = document.getElementById(`manhours-${index}`);
            if (preview) preview.textContent = manhoursPreview(row);
        }
    }

    function addRow(table) {
        if (state.locked) return;
        const def = TABLES.find((item) => item.table === table);
        if (!def) return;
        state.rows[table] = state.rows[table] || [];
        state.rows[table].push(emptyRow(def));
        render();
    }

    function removeRow(table, index) {
        if (state.locked) return;
        state.rows[table].splice(index, 1);
        render();
    }

    function setSectionNa(code, checked) {
        if (state.locked) return;
        const current = state.sectionStatus[code] || { section_code: code };
        current.is_not_applicable = checked;
        current.completeness = checked ? 'not_applicable' : ((state.rows[TABLES.find((d) => d.code === code)?.table] || []).length ? 'draft' : 'empty');
        state.sectionStatus[code] = current;
    }

    function payloadFromRow(def, row, index) {
        const payload = {
            packet_id: state.packet.id,
            faculty_id: state.faculty.id,
            sort_order: index,
            field_sources: sourcesApi()?.fieldSources(row) || {}
        };
        def.columns.forEach((key) => {
            if (key === 'authors') {
                payload.authors = textToAuthors(row.authors_text);
                return;
            }
            if (key === 'proponents') {
                payload.proponents = textToAuthors(row.proponents_text);
                return;
            }
            if (['beneficiaries_total', 'manhours_calculated', 'first_time_passing_pct', 'overall_passing_pct', 'employment_pct'].includes(key)) return;
            let value = row[key];
            // caption predates the title column and is kept in step so an
            // unmigrated database still shows a usable label.
            if (key === 'caption' && def.table === 'mfo_documentation_items') {
                value = row.title || row.caption || '';
            }
            if (value === '' || value === undefined) value = null;
            if (key === 'has_moa') value = !!row.has_moa;
            payload[key] = value;
        });
        if (def.table === 'mfo_extension_trainings' && !payload.manhours_formula) {
            payload.manhours_formula = 'hours_x_beneficiaries';
        }
        return payload;
    }

    /**
     * Columns added by migration 015. Until it is applied the page still works:
     * the first write that mentions an unknown column records it here and the
     * payload is retried without it.
     */
    const OPTIONAL_COLUMNS = [
        'field_sources', 'title', 'venue', 'activity_time', 'record_table', 'record_id',
        // Migration 019 (e-signature).
        'signature_data_url', 'signature_name', 'signature_signed_at'
    ];
    const unsupportedColumns = new Set();

    /** Which optional column, if any, this error is complaining about. */
    function unknownColumnFrom(error) {
        const message = String(error?.message || '').toLowerCase();
        if (!message.includes('column') && !message.includes('schema cache')) return null;
        return OPTIONAL_COLUMNS.find(
            (column) => !unsupportedColumns.has(column) && message.includes(column)
        ) || null;
    }

    function stripUnsupported(payload) {
        if (!unsupportedColumns.size) return payload;
        const copy = { ...payload };
        unsupportedColumns.forEach((column) => { delete copy[column]; });
        return copy;
    }

    /**
     * Update the packet row, dropping any column this deployment does not have.
     *
     * The two packet writes used to be plain updates, so one unknown column
     * failed the whole save. That matters more now that the signature lives on
     * this row: a database without migration 019 must still be able to save a
     * draft, just without a signature.
     */
    async function updatePacket(payload) {
        const client = db();
        const run = (data) => client.from('mfo_packets')
            .update(data)
            .eq('id', state.packet.id)
            .eq('faculty_id', state.faculty.id)
            .select('*')
            .maybeSingle();

        let result = await run(stripUnsupported(payload));
        for (let attempt = 0; attempt < OPTIONAL_COLUMNS.length && result.error; attempt += 1) {
            const column = unknownColumnFrom(result.error);
            if (!column) break;
            console.warn(`[MFO] mfo_packets has no "${column}" column; saving without it.`);
            unsupportedColumns.add(column);
            result = await run(stripUnsupported(payload));
        }
        if (result.error) throw result.error;
        if (result.data) state.packet = { ...state.packet, ...result.data };
        return result.data;
    }

    async function saveTable(def) {
        const client = db();
        const packetId = state.packet.id;
        const rows = state.rows[def.table] || [];
        const existing = await client.from(def.table).select('id').eq('packet_id', packetId);
        if (existing.error) throw existing.error;
        const keep = [];

        async function write(payload, rowId) {
            const run = (data) => (rowId
                ? client.from(def.table).update(data).eq('id', rowId).eq('packet_id', packetId).select('id').single()
                : client.from(def.table).insert(data).select('id').single());

            let result = await run(stripUnsupported(payload));
            // Retry while the database reports optional columns we can drop.
            for (let attempt = 0; attempt < OPTIONAL_COLUMNS.length && result.error; attempt += 1) {
                const column = unknownColumnFrom(result.error);
                if (!column) break;
                console.warn(`[MFO] column "${column}" is not present yet. Run 015_mfo_provenance_and_documentation.sql for the full feature set.`);
                unsupportedColumns.add(column);
                result = await run(stripUnsupported(payload));
            }
            if (result.error) throw result.error;
            return result.data;
        }

        for (let i = 0; i < rows.length; i += 1) {
            const payload = payloadFromRow(def, rows[i], i);
            if (isUuid(rows[i].id)) {
                await write(payload, rows[i].id);
                keep.push(rows[i].id);
            } else {
                const saved = await write(payload, null);
                rows[i].id = saved.id;
                keep.push(saved.id);
            }
        }
        const extras = (existing.data || []).map((row) => row.id).filter((id) => !keep.includes(id));
        if (extras.length) {
            const { error } = await client.from(def.table).delete().eq('packet_id', packetId).in('id', extras);
            if (error) throw error;
        }
    }

    async function saveSectionStatus(forSubmit) {
        const client = db();
        for (const def of TABLES) {
            const rows = state.rows[def.table] || [];
            const na = !!state.sectionStatus[def.code]?.is_not_applicable;
            const completeness = na ? 'not_applicable' : (rows.length ? (forSubmit ? 'complete' : 'draft') : 'empty');
            const payload = {
                packet_id: state.packet.id,
                section_code: def.code,
                is_not_applicable: na,
                completeness
            };
            const current = state.sectionStatus[def.code];
            if (current?.id) {
                const { error } = await client.from('mfo_section_status').update(payload).eq('id', current.id);
                if (error) throw error;
            } else {
                const { data, error } = await client.from('mfo_section_status').upsert(payload, { onConflict: 'packet_id,section_code' }).select('*').maybeSingle();
                if (error && !/no unique|on conflict/i.test(error.message || '')) {
                    const inserted = await client.from('mfo_section_status').insert(payload).select('*').maybeSingle();
                    if (inserted.error) console.warn('[MFO] section status', inserted.error);
                    else if (inserted.data) state.sectionStatus[def.code] = inserted.data;
                } else if (data) {
                    state.sectionStatus[def.code] = data;
                }
            }
        }
    }

    async function saveDraft() {
        if (state.locked) {
            toast('This MFO is already submitted and cannot be edited until it is returned for revision.', 'error');
            return;
        }
        state.busy = true;
        render();
        try {
            await updatePacket({
                packet_state: statusLabel() === 'Returned for Revision' ? 'revision' : 'draft',
                period_label: state.period.period_label,
                reporting_year: state.period.reporting_year,
                quarter: state.period.quarter,
                period_start: state.period.period_start,
                period_end: state.period.period_end,
                academic_year: state.period.academic_year || null,
                semester: state.period.semester || null,
                department: state.faculty.department || state.packet.department
            });
            for (const def of TABLES) await saveTable(def);
            await saveSectionStatus();
            state.lastSaved = new Date().toISOString();
            toast('Draft saved successfully.');
        } catch (error) {
            try {
                const debug = await db().rpc('mfo_debug_write_access', { p_packet_id: state.packet?.id || null });
                console.error('[MFO] write-access debug', debug.data || debug.error);
            } catch (_) {}
            toast(friendlyError(error, 'Unable to save draft.'), 'error');
        } finally {
            state.busy = false;
            render();
        }
    }

    function missingSections() {
        return TABLES.filter((def) => {
            if (def.table === 'mfo_documentation_items') return false;
            const na = !!state.sectionStatus[def.code]?.is_not_applicable;
            const rows = state.rows[def.table] || [];
            return !na && !rows.length;
        });
    }

    async function writeSnapshot(reason, lifecycle) {
        const client = db();
        const version = Number(state.packet.current_version || 0) + 1;
        const payload = {
            header: {
                faculty_id: state.faculty.id,
                faculty_name: state.faculty.full_name,
                department: state.faculty.department,
                period: state.period,
                task_id: state.task?.id,
                submission_id: state.submission?.id,
                // Captured in the snapshot so the signature stays with the
                // version of the report it was applied to, even if the packet
                // row is later re-signed.
                signature_name: state.packet?.signature_name || null,
                signature_signed_at: state.packet?.signature_signed_at || null,
                signature_data_url: state.packet?.signature_data_url || null
            },
            sections: {},
            files: state.files
        };
        TABLES.forEach((def) => {
            payload.sections[def.table] = state.rows[def.table] || [];
        });
        const { error } = await client.from('mfo_snapshots').insert({
            packet_id: state.packet.id,
            version_no: version,
            lifecycle_state: lifecycle,
            snapshot_reason: reason,
            payload,
            created_by_faculty_id: state.faculty.id
        });
        if (error) console.warn('[MFO] snapshot', error);
        else state.packet.current_version = version;
    }

    async function submitPacket() {
        if (!state.task?.id) {
            toast(state.taskWarning || 'Ask an administrator to create an MFO task before submitting.', 'error');
            return;
        }
        if (approvalConfigMissing()) {
            state.configError = CONFIG_ERROR;
            render();
            toast(CONFIG_ERROR, 'error');
            return;
        }
        if (state.locked && statusLabel() !== 'Returned for Revision' && statusLabel() !== 'Declined') {
            toast('This MFO is already submitted.', 'error');
            return;
        }
        const missing = missingSections();
        if (missing.length) {
            state.reviewOpen = true;
            render();
            toast('Mark empty sections as Not Applicable, or add at least one record, before submitting.', 'error');
            return;
        }
        // Resolved before the prompt so the dialog names the reviewer this
        // report will really go to. A Chairperson submitting their own report
        // is routed to Admin, and saying "Chairperson review" there would be a
        // lie about what is about to happen.
        const stage = await mfoApprovalStageForSubmitter();
        const reviewer = stage === 'chairperson' ? 'Chairperson review' : 'Admin final approval';
        if (!window.confirm(`Submit this MFO Report for ${reviewer}? You will not be able to edit it unless it is returned for revision.`)) {
            return;
        }
        state.busy = true;
        render();
        try {
            await saveDraftInternal(true);
            const client = db();
            const now = new Date().toISOString();
            const due = state.task?.deadline_at || state.task?.due_at;
            const late = !!(due && new Date(due) < new Date());
            const wasRevision = String(state.submission?.status || '').toLowerCase() === 'revision'
                || String(state.submission?.approval_stage || '').toLowerCase() === 'revision';
            const payload = {
                task_id: state.task.id,
                faculty_id: state.faculty.id,
                submitted_at: now,
                status: late ? 'late' : 'submitted',
                is_late: late,
                submitted_status: late ? 'late' : 'on_time',
                approval_stage: stage,
                reviewed_by_name: null,
                reviewed_at: null,
                review_remarks: ''
            };
            if (wasRevision) payload.resubmission_count = Number(state.submission?.resubmission_count || 0) + 1;
            let saved = await client.from('wf_submissions').upsert(payload, { onConflict: 'task_id,faculty_id' }).select('*').single();
            if (saved.error && /column|schema cache|is_late|submitted_status/i.test(saved.error.message || '')) {
                const slim = {
                    task_id: payload.task_id,
                    faculty_id: payload.faculty_id,
                    submitted_at: payload.submitted_at,
                    status: payload.status,
                    approval_stage: payload.approval_stage
                };
                saved = await client.from('wf_submissions').upsert(slim, { onConflict: 'task_id,faculty_id' }).select('*').single();
            }
            if (saved.error) throw saved.error;
            state.submission = saved.data;
            await client.from('mfo_packets').update({
                packet_state: wasRevision ? 'resubmitted' : (late ? 'late' : 'submitted'),
                submission_id: saved.data.id
            }).eq('id', state.packet.id).eq('faculty_id', state.faculty.id);
            await writeSnapshot(wasRevision ? 'resubmitted' : 'submitted', wasRevision ? 'resubmitted' : (late ? 'late' : 'submitted'));
            await global.CiteFlowWorkflow.recordSubmissionEvent(db(), {
                faculty: state.faculty,
                task: state.task,
                taskId: state.task.id,
                submissionId: saved.data.id,
                isResubmit: wasRevision
            });
            state.locked = true;
            toast(late
                ? `MFO submitted late — awaiting ${reviewer}.`
                : `MFO Report submitted. Status: ${statusLabel()}.`);
        } catch (error) {
            try {
                const debug = await db().rpc('mfo_debug_write_access', { p_packet_id: state.packet?.id || null });
                console.error('[MFO] write-access debug', debug.data || debug.error);
            } catch (_) {}
            toast(friendlyError(error, 'Unable to submit the MFO report.'), 'error');
        } finally {
            state.busy = false;
            state.reviewOpen = false;
            render();
        }
    }

    async function saveDraftInternal(forSubmit) {
        await updatePacket({
            period_label: state.period.period_label,
            reporting_year: state.period.reporting_year,
            quarter: state.period.quarter,
            period_start: state.period.period_start,
            period_end: state.period.period_end,
            academic_year: state.period.academic_year || null,
            semester: state.period.semester || null
        });
        for (const def of TABLES) await saveTable(def);
        await saveSectionStatus(!!forSubmit);
        state.lastSaved = new Date().toISOString();
    }

    /* ═══════════════════════════════════════════════════════════════
       ELECTRONIC SIGNATURE

       "Submitted by" stays exactly as it was — a printed name taken from the
       faculty record. The signature is an addition beside it.

       It is stored as a PNG data URL on mfo_packets rather than as a Storage
       object on purpose. The printed report has to render the signature at
       window.print() time, and a Storage object would need a signed URL that
       may not have resolved yet, which prints a blank box. Keeping the image on
       the packet row also means it travels with the report for free: the
       reviewer route already selects the packet with select('*'), so both
       Chairperson and Admin see the same signature as the author, and the
       snapshot written at submit time preserves it.

       Size is bounded by downscaling to SIGNATURE_MAX_WIDTH before encoding.
       ═══════════════════════════════════════════════════════════════ */

    const SIGNATURE_MAX_WIDTH = 700;
    const SIGNATURE_MAX_BYTES = 400 * 1024;

    /** Redraw the pad after render() has replaced the DOM. */
    function restoreSignaturePad() {
        const canvas = document.getElementById('mfoSignaturePad');
        if (!canvas) return;
        // Match the backing store to the displayed size so strokes are crisp
        // and land under the pointer.
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        if (rect.width && (canvas.width !== Math.round(rect.width * ratio))) {
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#111827';
        signaturePad.ctx = ctx;
        signaturePad.dirty = false;
    }

    const signaturePad = { ctx: null, drawing: false, dirty: false };

    function signaturePointerDown(event) {
        if (state.locked) return;
        const canvas = document.getElementById('mfoSignaturePad');
        if (!canvas || !signaturePad.ctx) return;
        event.preventDefault();
        signaturePad.drawing = true;
        const point = signaturePointer(canvas, event);
        signaturePad.ctx.beginPath();
        signaturePad.ctx.moveTo(point.x, point.y);
    }

    function signaturePointerMove(event) {
        if (!signaturePad.drawing || !signaturePad.ctx) return;
        const canvas = document.getElementById('mfoSignaturePad');
        if (!canvas) return;
        event.preventDefault();
        const point = signaturePointer(canvas, event);
        signaturePad.ctx.lineTo(point.x, point.y);
        signaturePad.ctx.stroke();
        signaturePad.dirty = true;
    }

    function signaturePointerUp() {
        signaturePad.drawing = false;
    }

    function signaturePointer(canvas, event) {
        const rect = canvas.getBoundingClientRect();
        const source = event.touches?.[0] || event.changedTouches?.[0] || event;
        return { x: source.clientX - rect.left, y: source.clientY - rect.top };
    }

    function clearSignaturePad() {
        const canvas = document.getElementById('mfoSignaturePad');
        if (!canvas) return;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        signaturePad.dirty = false;
    }

    /** Trim transparent margins and downscale, so the stored PNG stays small. */
    function normalizeSignatureCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let minX = width; let minY = height; let maxX = -1; let maxY = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (pixels[((y * width) + x) * 4 + 3] > 8) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;

        const pad = 6;
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
        const cropW = (maxX - minX) + 1;
        const cropH = (maxY - minY) + 1;

        const scale = Math.min(1, SIGNATURE_MAX_WIDTH / cropW);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(cropW * scale));
        out.height = Math.max(1, Math.round(cropH * scale));
        out.getContext('2d').drawImage(
            canvas, minX, minY, cropW, cropH, 0, 0, out.width, out.height
        );
        return out.toDataURL('image/png');
    }

    async function saveDrawnSignature() {
        if (state.locked) return;
        const canvas = document.getElementById('mfoSignaturePad');
        if (!canvas) return;
        const dataUrl = normalizeSignatureCanvas(canvas);
        if (!dataUrl) {
            toast('Please draw your signature in the box first.', 'error');
            return;
        }
        await persistSignature(dataUrl);
    }

    async function uploadSignatureImage(input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file || state.locked) return;
        if (!/^image\//.test(file.type || '')) {
            toast('A signature must be an image file (PNG or JPG).', 'error');
            return;
        }
        try {
            const dataUrl = await downscaleImageFile(file);
            await persistSignature(dataUrl);
        } catch (error) {
            toast(friendlyError(error, 'Unable to read that signature image.'), 'error');
        }
    }

    function downscaleImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the image.'));
            reader.onload = () => {
                const image = new Image();
                image.onerror = () => reject(new Error('That file is not a readable image.'));
                image.onload = () => {
                    const scale = Math.min(1, SIGNATURE_MAX_WIDTH / (image.width || 1));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(image.width * scale));
                    canvas.height = Math.max(1, Math.round(image.height * scale));
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/png'));
                };
                image.src = String(reader.result);
            };
            reader.readAsDataURL(file);
        });
    }

    async function persistSignature(dataUrl) {
        if (dataUrl && dataUrl.length > SIGNATURE_MAX_BYTES) {
            toast('That signature image is too large. Please use a smaller or simpler image.', 'error');
            return;
        }
        const typed = String(document.getElementById('mfoSignatureName')?.value || '').trim();
        state.busy = true;
        render();
        try {
            await updatePacket({
                signature_data_url: dataUrl,
                signature_name: dataUrl ? (typed || state.faculty.full_name || null) : null,
                signature_signed_at: dataUrl ? new Date().toISOString() : null
            });
            if (unsupportedColumns.has('signature_data_url')) {
                toast('This database does not have the signature columns yet. Run migration 019.', 'error');
                return;
            }
            toast(dataUrl ? 'Electronic signature saved.' : 'Electronic signature removed.');
        } catch (error) {
            toast(friendlyError(error, 'Unable to save the signature.'), 'error');
        } finally {
            state.busy = false;
            render();
        }
    }

    async function removeSignature() {
        if (state.locked) return;
        if (!window.confirm('Remove the electronic signature from this report?')) return;
        await persistSignature(null);
    }

    function hasSignature() {
        return !!String(state.packet?.signature_data_url || '').trim();
    }

    async function uploadFile(code, table, index, input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file || state.locked) return;
        if (file.size > MAX_FILE_BYTES) {
            toast('File must be 10 MB or smaller.', 'error');
            return;
        }
        if (!ALLOWED_EXT.test(file.name)) {
            toast('Allowed files: PDF, images, Word, and Excel.', 'error');
            return;
        }
        try {
            if (!state.task?.id) {
                toast(state.taskWarning || 'An assigned MFO task is required before files can be attached.', 'error');
                return;
            }
            if (index >= 0 && state.rows[table]?.[index] && !isUuid(state.rows[table][index].id)) {
                const def = TABLES.find((item) => item.table === table);
                if (def) await saveTable(def);
            }
            if (!state.submission?.id) await ensurePacket();
            // ensurePacket() logs and continues when the draft submission write
            // fails, so this has to be checked rather than assumed. Reaching the
            // Storage upload without it produced a null dereference *after* the
            // file had been sent, leaving an orphan object behind.
            if (!state.submission?.id) {
                toast('Could not open a submission record for this report. Please reload and try again.', 'error');
                return;
            }
            const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${state.faculty.id}/${state.task.id}/${state.packet.id}/${Date.now()}-${safeName}`;
            const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
            if (uploaded.error) throw uploaded.error;
            const pub = db().storage.from(BUCKET).getPublicUrl(path);
            const row = {
                submission_id: state.submission.id,
                task_id: state.task.id,
                faculty_id: state.faculty.id,
                file_name: file.name,
                file_url: pub.data?.publicUrl || '',
                storage_path: path,
                file_path: path,
                mfo_section: code,
                mfo_indicator: TABLES.find((d) => d.code === code)?.title || null,
                mfo_record_id: isUuid(recordId) ? recordId : null,
                mfo_packet_id: state.packet.id
            };
            await insertEvidenceFileOrCleanUp(row, path);
            toast('Documentation attached.');
            render();
        } catch (error) {
            toast(friendlyError(error, 'Unable to upload the file.'), 'error');
        }
    }

    /**
     * Link an uploaded object to the submission, discarding the object if the
     * link cannot be made. Without this an unlinked file stays in the bucket
     * forever: nothing references it, so nothing can ever show or delete it.
     */
    async function insertEvidenceFileOrCleanUp(row, storagePath) {
        try {
            return await insertEvidenceFile(row);
        } catch (error) {
            try {
                await db().storage.from(BUCKET).remove([storagePath]);
            } catch (cleanupError) {
                console.warn('[MFO] could not remove the orphaned upload', storagePath, cleanupError);
            }
            throw error;
        }
    }

    /**
     * Columns without which an evidence row is useless. If the database rejects
     * one of these the upload must fail loudly rather than write a widow row:
     * submission_id is what links the file to the report under review, and
     * file_name/file_url are what a reviewer clicks.
     *
     * storage_path is required for the same reason. The chairperson storage
     * policy grants reads only where storage.objects.name equals
     * wf_submission_files.storage_path, so a row without it produces a file the
     * reviewer can see listed but cannot open.
     */
    const REQUIRED_FILE_COLUMNS = new Set([
        'submission_id', 'file_name', 'file_url', 'storage_path'
    ]);
    const unsupportedFileColumns = new Set();

    /**
     * Name the column Postgres/PostgREST is complaining about.
     *
     * Two error shapes reach us and only the first is documented anywhere:
     *   42703  column wf_submission_files.task_id does not exist
     *   PGRST204  Could not find the 'task_id' column of 'wf_submission_files'
     *             in the schema cache
     *
     * The previous implementation matched the message against a fixed whitelist
     * instead of reading the name out of it, so a rejection naming any column
     * outside that list aborted the insert. task_id and faculty_id were not on
     * the list and do not exist on this deployment, which meant every photo and
     * every supporting document failed after the file had already been pushed
     * to Storage.
     */
    function unknownFileColumn(error) {
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

    async function insertEvidenceFile(row) {
        const client = db();
        const attempt = (payload) => client.from('wf_submission_files').insert(payload).select('*').single();

        const build = () => {
            const copy = { ...row };
            unsupportedFileColumns.forEach((column) => { delete copy[column]; });
            return copy;
        };

        let result = await attempt(build());

        // Bounded by the payload width: each pass either drops exactly one
        // column or stops, so this cannot spin.
        const maxPasses = Object.keys(row).length + 1;
        for (let pass = 0; pass < maxPasses && result.error; pass += 1) {
            const column = unknownFileColumn(result.error);
            if (!column || unsupportedFileColumns.has(column)) break;
            if (REQUIRED_FILE_COLUMNS.has(column)) {
                console.error(
                    `[MFO] wf_submission_files is missing the required column "${column}". `
                    + 'Evidence cannot be linked to the submission until it exists.'
                );
                break;
            }
            console.warn(`[MFO] wf_submission_files has no "${column}" column; retrying without it.`);
            unsupportedFileColumns.add(column);
            result = await attempt(build());
        }

        if (result.error) throw result.error;
        state.files.push(result.data);
        return result.data;
    }

    async function removeFile(fileId) {
        if (state.locked) return;
        const file = state.files.find((item) => String(item.id) === String(fileId));
        if (!file) return;
        try {
            const path = file.storage_path || file.file_path;
            if (path) await db().storage.from(BUCKET).remove([path]);
            const { error } = await db().from('wf_submission_files').delete().eq('id', fileId);
            if (error) throw error;
            state.files = state.files.filter((item) => String(item.id) !== String(fileId));
            render();
        } catch (error) {
            toast(friendlyError(error, 'Unable to remove the file.'), 'error');
        }
    }

    /**
     * Small marker telling the user where a value came from, or that it still
     * needs them. Deliberately plain language: no database terminology.
     */
    function fieldBadge(def, row, field) {
        const api = sourcesApi();
        if (!api) return '';
        const value = row[field.key];
        const blank = value === null || value === undefined || String(value).trim() === '';
        const provenance = api.provenanceOf(row, field.key);

        if (provenance === api.PROVENANCE.NA) {
            return '<span class="mfo-flag mfo-flag-na">N/A</span>';
        }
        if (!blank && provenance === api.PROVENANCE.SYSTEM) {
            const label = api.helpers.sourceLabel(row.source_table) || 'existing record';
            return `<span class="mfo-flag mfo-flag-auto" title="Retrieved from your ${esc(label)}">Auto-filled</span>`;
        }
        if (!blank && provenance === api.PROVENANCE.MANUAL) {
            return '<span class="mfo-flag mfo-flag-manual">Edited</span>';
        }
        if (blank && (api.MAP[def.code]?.manualOnly || []).includes(field.key)) {
            return '<span class="mfo-flag mfo-flag-need">Needs your input</span>';
        }
        return '';
    }

    function fieldControl(def, row, index, field) {
        const disabled = state.locked ? 'disabled' : '';
        const value = row[field.key] ?? '';
        const oninput = `CiteFlowMfoFaculty.updateRow('${def.table}', ${index}, '${field.key}', this)`;
        if (field.type === 'textarea') {
            return `<textarea class="mfo-field" rows="2" ${disabled} oninput="${oninput}">${esc(value)}</textarea>`;
        }
        if (field.type === 'select') {
            const options = (field.options || []).map((opt) => {
                const label = DOC_LABELS[opt] || opt.replace(/_/g, ' ');
                return `<option value="${esc(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${esc(label)}</option>`;
            }).join('');
            return `<select class="mfo-field" ${disabled} onchange="${oninput}">${options}</select>`;
        }
        if (field.type === 'checkbox') {
            return `<label class="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" ${value ? 'checked' : ''} ${disabled} onchange="${oninput}"> Yes</label>`;
        }
        return `<input class="mfo-field" type="${field.type}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" ${disabled} oninput="${oninput}">`;
    }

    function renderFiles(code, table, index) {
        const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
        const files = filesFor(code, isUuid(recordId) ? recordId : null);
        const list = files.map((file) => `
            <div class="flex items-center justify-between gap-2 text-xs bg-white border border-slate-200 rounded-xl px-3 py-2">
                <a class="font-semibold text-[#621708] truncate" href="${esc(file.file_url || '#')}" target="_blank" rel="noopener">${esc(file.file_name)}</a>
                ${state.locked ? '' : `<button type="button" class="text-rose-600 font-bold" onclick="CiteFlowMfoFaculty.removeFile('${file.id}')">Remove</button>`}
            </div>
        `).join('');
        return `
            <div class="mt-3 space-y-2">
                <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">File attachments</div>
                ${list || '<div class="text-xs text-slate-400">No files attached to this record yet.</div>'}
                ${state.locked ? '' : `
                    <label class="cite-action inline-flex cursor-pointer">
                        + Add File
                        <input type="file" class="hidden" onchange="CiteFlowMfoFaculty.uploadFile('${code}', '${table}', ${index}, this)">
                    </label>
                `}
            </div>
        `;
    }

    function openPhotoModal(sectionCode, docIndex) {
        if (state.locked && docIndex == null) return;
        const existing = docIndex != null ? state.rows.mfo_documentation_items?.[docIndex] : null;
        state.photoModal = {
            sectionCode,
            docIndex: docIndex == null ? null : docIndex,
            title: existing?.title || existing?.caption || '',
            activity_date: existing?.activity_date ? String(existing.activity_date).slice(0, 10) : '',
            activity_time: existing?.activity_time || '',
            venue: existing?.venue || '',
            narrative: existing?.narrative || '',
            pendingFiles: [],
            pendingPreviews: []
        };
        render();
    }

    function closePhotoModal() {
        (state.photoModal?.pendingPreviews || []).forEach((url) => {
            try { URL.revokeObjectURL(url); } catch (_) {}
        });
        state.photoModal = null;
        render();
    }

    function updatePhotoModalField(key, input) {
        if (!state.photoModal || state.locked) return;
        state.photoModal[key] = input.value;
    }

    function addPhotoModalFiles(input) {
        if (!state.photoModal || state.locked || !input?.files?.length) return;
        const files = Array.from(input.files);
        files.forEach((file) => {
            if (!IMAGE_EXT.test(file.name) && !(file.type || '').startsWith('image/')) {
                toast('Please choose image files only (JPG, PNG, WEBP, GIF).', 'error');
                return;
            }
            if (file.size > MAX_FILE_BYTES) {
                toast(`${file.name} must be 10 MB or smaller.`, 'error');
                return;
            }
            state.photoModal.pendingFiles.push(file);
            state.photoModal.pendingPreviews.push(URL.createObjectURL(file));
        });
        input.value = '';
        render();
    }

    function removePendingPhoto(index) {
        if (!state.photoModal || state.locked) return;
        const url = state.photoModal.pendingPreviews[index];
        if (url) {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }
        state.photoModal.pendingFiles.splice(index, 1);
        state.photoModal.pendingPreviews.splice(index, 1);
        render();
    }

    /** Copy the modal fields onto a documentation row, marking them user-authored. */
    function applyPhotoModalTo(row, modal, title) {
        if (!row) return;
        const api = sourcesApi();
        row.section_code = modal.sectionCode;
        row.title = title;
        row.caption = title;
        row.activity_date = modal.activity_date || '';
        row.activity_time = modal.activity_time || '';
        row.venue = modal.venue || '';
        row.narrative = modal.narrative || '';
        ['title', 'activity_date', 'activity_time', 'venue', 'narrative'].forEach((key) => {
            if (row[key]) api?.markManual(row, key);
        });
    }

    async function savePhotoModal() {
        if (!state.photoModal || state.locked) return;
        const modal = state.photoModal;
        const title = String(modal.title || '').trim();
        if (!title) {
            toast('Title is required for photo documentation.', 'error');
            return;
        }
        try {
            state.busy = true;
            render();
            state.rows.mfo_documentation_items = state.rows.mfo_documentation_items || [];
            let index = modal.docIndex;
            if (index == null) {
                const def = TABLES.find((item) => item.table === 'mfo_documentation_items');
                const row = emptyRow(def);
                applyPhotoModalTo(row, modal, title);
                state.rows.mfo_documentation_items.push(row);
                index = state.rows.mfo_documentation_items.length - 1;
            } else {
                applyPhotoModalTo(state.rows.mfo_documentation_items[index], modal, title);
            }

            const def = TABLES.find((item) => item.table === 'mfo_documentation_items');
            await saveTable(def);

            const recordId = state.rows.mfo_documentation_items[index]?.id;
            for (const file of modal.pendingFiles) {
                await uploadPhotoFile(modal.sectionCode, recordId, file);
            }

            (modal.pendingPreviews || []).forEach((url) => {
                try { URL.revokeObjectURL(url); } catch (_) {}
            });
            state.photoModal = null;
            toast('Photo documentation saved.');
        } catch (error) {
            toast(friendlyError(error, 'Unable to save photo documentation.'), 'error');
        } finally {
            state.busy = false;
            render();
        }
    }

    async function uploadPhotoFile(sectionCode, recordId, file) {
        if (!state.task?.id) {
            throw new Error(state.taskWarning || 'An assigned MFO task is required before photos can be attached.');
        }
        if (!state.submission?.id) await ensurePacket();
        if (!state.submission?.id) {
            throw new Error('Could not open a submission record for this report. Please reload and try again.');
        }
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${state.faculty.id}/${state.task.id}/${state.packet.id}/photos/${Date.now()}-${safeName}`;
        const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploaded.error) throw uploaded.error;
        const pub = db().storage.from(BUCKET).getPublicUrl(path);
        const indicator = TABLES.find((d) => d.code === sectionCode)?.title || sectionCode;
        const row = {
            submission_id: state.submission.id,
            task_id: state.task.id,
            faculty_id: state.faculty.id,
            file_name: file.name,
            file_url: pub.data?.publicUrl || '',
            storage_path: path,
            file_path: path,
            mfo_section: sectionCode,
            mfo_indicator: indicator,
            mfo_record_id: isUuid(recordId) ? recordId : null,
            mfo_documentation_id: isUuid(recordId) ? recordId : null,
            mfo_sort_order: (state.files || []).filter(
                (item) => String(item.mfo_record_id || '') === String(recordId)
            ).length,
            mfo_packet_id: state.packet.id
        };
        await insertEvidenceFileOrCleanUp(row, path);
    }

    async function removePhotoDoc(docIndex) {
        if (state.locked) return;
        const row = state.rows.mfo_documentation_items?.[docIndex];
        if (!row) return;
        if (!window.confirm('Remove this photo documentation entry and its photos?')) return;
        try {
            const recordId = isUuid(row.id) ? row.id : null;
            if (recordId) {
                const linked = state.files.filter((file) => String(file.mfo_record_id || '') === String(recordId));
                for (const file of linked) {
                    await removeFile(file.id);
                }
            }
            state.rows.mfo_documentation_items.splice(docIndex, 1);
            const def = TABLES.find((item) => item.table === 'mfo_documentation_items');
            await saveTable(def);
            toast('Photo documentation removed.');
            render();
        } catch (error) {
            toast(friendlyError(error, 'Unable to remove photo documentation.'), 'error');
        }
    }

    function renderPhotoDocs(sectionCode, sectionTitle) {
        const entries = docsForIndicator(sectionCode);
        const cards = entries.map(({ row, index }) => {
            const photos = isUuid(row.id) ? filesFor(sectionCode, row.id) : [];
            const thumbs = photos.map((file) => `
                <a href="${esc(file.file_url || '#')}" target="_blank" rel="noopener" class="mfo-photo-thumb" title="${esc(file.file_name)}">
                    <img src="${esc(file.file_url || '')}" alt="${esc(file.file_name)}" loading="lazy">
                </a>
            `).join('');
            const details = [
                row.activity_date ? `Date: ${String(row.activity_date).slice(0, 10)}` : '',
                row.activity_time ? `Time: ${row.activity_time}` : '',
                row.venue ? `Venue: ${row.venue}` : ''
            ].filter(Boolean).join(' · ');
            return `
                <div class="mfo-photo-card">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <div class="text-sm font-bold text-slate-900">${esc(row.title || row.caption || 'Untitled')}</div>
                            ${details ? `<div class="text-xs text-slate-500 mt-1">${esc(details)}</div>` : ''}
                            ${row.narrative ? `<p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${esc(row.narrative)}</p>` : ''}
                        </div>
                        ${state.locked ? '' : `
                            <div class="flex flex-col gap-1 shrink-0">
                                <button type="button" class="text-xs font-bold text-[#621708]" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(sectionCode)}', ${index})">Edit</button>
                                <button type="button" class="text-xs font-bold text-rose-600" onclick="CiteFlowMfoFaculty.removePhotoDoc(${index})">Remove</button>
                            </div>
                        `}
                    </div>
                    ${thumbs ? `<div class="mfo-photo-grid mt-3">${thumbs}</div>` : '<div class="text-xs text-slate-400 mt-2">No photos uploaded yet.</div>'}
                </div>
            `;
        }).join('');

        return `
            <div class="mt-5 pt-4 border-t border-slate-100">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Optional photo documentation</div>
                        <p class="text-xs text-slate-500">Add titled photo entries for this performance indicator (date, time, venue optional).</p>
                    </div>
                    ${state.locked ? '' : `
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(sectionCode)}')">
                            + Attach Photo Documentation
                        </button>
                    `}
                </div>
                ${cards || `<div class="text-xs text-slate-400">No photo documentation for ${esc(sectionTitle)} yet.</div>`}
            </div>
        `;
    }

    function renderPhotoModal() {
        const modal = state.photoModal;
        if (!modal) return '';
        const section = TABLES.find((d) => d.code === modal.sectionCode);
        const sectionLabel = section ? section.title : modal.sectionCode;
        const existingPhotos = modal.docIndex != null && isUuid(state.rows.mfo_documentation_items?.[modal.docIndex]?.id)
            ? filesFor(modal.sectionCode, state.rows.mfo_documentation_items[modal.docIndex].id)
            : [];
        const existingThumbs = existingPhotos.map((file) => `
            <div class="mfo-photo-thumb-wrap">
                <a href="${esc(file.file_url || '#')}" target="_blank" rel="noopener" class="mfo-photo-thumb">
                    <img src="${esc(file.file_url || '')}" alt="${esc(file.file_name)}">
                </a>
                ${state.locked ? '' : `<button type="button" class="mfo-photo-remove" onclick="CiteFlowMfoFaculty.removeFile('${file.id}')">×</button>`}
            </div>
        `).join('');
        const pendingThumbs = (modal.pendingPreviews || []).map((url, index) => `
            <div class="mfo-photo-thumb-wrap">
                <div class="mfo-photo-thumb"><img src="${esc(url)}" alt="Pending upload"></div>
                <button type="button" class="mfo-photo-remove" onclick="CiteFlowMfoFaculty.removePendingPhoto(${index})">×</button>
            </div>
        `).join('');

        return `
            <div class="fixed inset-0 z-[60] bg-slate-900/45 flex items-end sm:items-center justify-center p-4" onclick="if(event.target===this){CiteFlowMfoFaculty.closePhotoModal()}">
                <div class="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 shadow-xl">
                    <div class="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">Photo documentation</div>
                            <h2 class="text-lg font-bold text-slate-900">${esc(sectionLabel)}</h2>
                            <p class="text-xs text-slate-500 mt-1">Optional. Title is required. Date, time, and venue are optional. You may upload more than one photo.</p>
                        </div>
                        <button type="button" class="text-slate-400 hover:text-slate-700 text-xl leading-none" onclick="CiteFlowMfoFaculty.closePhotoModal()">×</button>
                    </div>

                    <div class="space-y-3">
                        <div>
                            <label class="mfo-label">Title <span class="text-rose-600">*</span></label>
                            <input class="mfo-field" type="text" value="${esc(modal.title)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('title', this)" placeholder="Title of the activity / documentation">
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label class="mfo-label">Date (optional)</label>
                                <input class="mfo-field" type="date" value="${esc(modal.activity_date)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('activity_date', this)">
                            </div>
                            <div>
                                <label class="mfo-label">Time (optional)</label>
                                <input class="mfo-field" type="text" value="${esc(modal.activity_time)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('activity_time', this)" placeholder="e.g. 9:00 AM">
                            </div>
                        </div>
                        <div>
                            <label class="mfo-label">Venue (optional)</label>
                            <input class="mfo-field" type="text" value="${esc(modal.venue)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('venue', this)" placeholder="Location / venue">
                        </div>
                        <div>
                            <label class="mfo-label">Brief description / explanation</label>
                            <textarea class="mfo-field" rows="3" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('narrative', this)" placeholder="Short explanation of the documentation">${esc(modal.narrative)}</textarea>
                        </div>
                        <div>
                            <label class="mfo-label">Photos (one or more)</label>
                            <div class="mfo-photo-grid mb-2">${existingThumbs}${pendingThumbs || ''}</div>
                            ${state.locked ? '' : `
                                <label class="cite-action inline-flex cursor-pointer">
                                    + Add Photos
                                    <input type="file" accept="image/*" multiple class="hidden" onchange="CiteFlowMfoFaculty.addPhotoModalFiles(this)">
                                </label>
                            `}
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-2 mt-5">
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePhotoModal()">Cancel</button>
                        ${state.locked ? '' : `<button type="button" class="cite-action-primary" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.savePhotoModal()">Save Documentation</button>`}
                    </div>
                </div>
            </div>
        `;
    }

    function renderRecord(def, row, index) {
        const suggested = row.source_kind === 'suggested' || row.source_kind === 'imported';
        return `
            <div class="mfo-record mb-3">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-bold text-slate-900">Record ${index + 1}</span>
                        ${suggested ? '<span class="mfo-chip">Suggested from existing record — confirm or edit</span>' : ''}
                    </div>
                    ${state.locked ? '' : `<button type="button" class="text-xs font-bold text-rose-600" onclick="CiteFlowMfoFaculty.removeRow('${def.table}', ${index})">Remove</button>`}
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    ${def.fields.map((field) => `
                        <div class="${field.type === 'textarea' ? 'md:col-span-2' : ''}">
                            <label class="mfo-label">
                                ${esc(field.label)}
                                ${fieldBadge(def, row, field)}
                            </label>
                            ${fieldControl(def, row, index, field)}
                        </div>
                    `).join('')}
                </div>
                ${def.table === 'mfo_extension_trainings' ? `
                    <div class="mt-3 text-xs font-semibold text-sky-800">
                        <span class="mfo-chip mfo-chip-calc">System-calculated manhours</span>
                        <span id="manhours-${index}" class="ml-2">${esc(manhoursPreview(row))}</span>
                    </div>
                ` : ''}
                ${def.table === 'mfo_documentation_items' ? '' : renderFiles(def.code, def.table, index)}
            </div>
        `;
    }

    function renderFacultySection(def) {
        const na = !!state.sectionStatus[def.code]?.is_not_applicable;
        const isDocTable = def.table === 'mfo_documentation_items';
        const rows = isDocTable
            ? generalDocs().map(({ row }) => row)
            : (state.rows[def.table] || []);
        const rowIndexes = isDocTable
            ? generalDocs().map(({ index }) => index)
            : rows.map((_, index) => index);

        return `
            <details class="mfo-section rounded-[16px] mb-3" ${na ? '' : 'open'}>
                <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">${esc(def.group)}</div>
                        <div class="text-sm font-bold text-slate-900">${esc(def.title)}</div>
                    </div>
                    <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
                </summary>
                <div class="px-4 sm:px-5 pb-5">
                    ${def.hint ? `<p class="text-xs text-slate-500 mb-3">${esc(def.hint)}</p>` : ''}
                    <label class="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 mb-4">
                        <input type="checkbox" ${na ? 'checked' : ''} ${state.locked ? 'disabled' : ''} onchange="CiteFlowMfoFaculty.setSectionNa('${def.code}', this.checked); CiteFlowMfoFaculty.render();">
                        Not applicable (NA)
                    </label>
                    ${na ? '<p class="text-sm text-slate-500">This section is marked NA for your program contribution.</p>' : `
                        ${isDocTable ? `
                            ${generalDocs().map(({ row, index }) => renderRecord(def, row, index)).join('') || '<p class="text-sm text-slate-500 mb-3">No general documentation records yet.</p>'}
                            ${state.locked ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">+ ${esc(def.add)}</button>`}
                            ${renderPhotoDocs(def.code, def.title)}
                        ` : `
                            ${rowIndexes.map((index) => renderRecord(def, state.rows[def.table][index], index)).join('') || '<p class="text-sm text-slate-500 mb-3">No records yet.</p>'}
                            ${state.locked ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">+ ${esc(def.add)}</button>`}
                            ${renderPhotoDocs(def.code, def.title)}
                        `}
                    `}
                </div>
            </details>
        `;
    }

    function renderProgramLocked() {
        return `
            <details class="mfo-section rounded-[16px] mb-3">
                <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">Program-owned sections</div>
                        <div class="text-sm font-bold text-slate-900">Completed by the Program Chairperson</div>
                    </div>
                    <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
                </summary>
                <div class="px-4 sm:px-5 pb-5 text-sm text-slate-600 space-y-2">
                    <p><span class="mfo-chip mfo-chip-lock">View only</span> These MFO items are program-level and are not entered by individual faculty.</p>
                    <ul class="list-disc pl-5 space-y-1">
                        <li>MFO 1 PI1 — Licensure passing percentage</li>
                        <li>MFO 1 PI2 — Graduate employment</li>
                        <li>Other accomplishments of the program (narrative)</li>
                    </ul>
                    <p>Your Chairperson completes these once for ${esc(state.faculty.department || 'your department')} in a later phase.</p>
                </div>
            </details>
        `;
    }

    function renderReview() {
        if (!state.reviewOpen) return '';
        const missing = missingSections();
        const groups = [];
        TABLES.forEach((def) => {
            const rows = state.rows[def.table] || [];
            const na = !!state.sectionStatus[def.code]?.is_not_applicable;
            groups.push(`
                <div class="border-b border-slate-100 py-3">
                    <div class="font-bold text-sm">${esc(def.title)}</div>
                    <div class="text-xs text-slate-500">${na ? 'NA' : `${rows.length} record(s)`}</div>
                </div>
            `);
        });
        return `
            <div class="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-4" onclick="if(event.target===this){CiteFlowMfoFaculty.reviewOpen(false)}">
                <div class="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5">
                    <h2 class="text-lg font-bold mb-1">Review MFO Report</h2>
                    <p class="text-sm text-slate-500 mb-4">${esc(state.period.period_label)} · ${esc(state.faculty.full_name)}</p>
                    ${missing.length ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">Incomplete: ${missing.map((d) => esc(d.title)).join(', ')}. Mark NA or add records.</div>` : '<div class="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm font-semibold">All faculty sections have records or are marked NA.</div>'}
                    ${groups.join('')}
                    <div class="flex flex-col sm:flex-row gap-2 mt-4">
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewOpen(false)">Close</button>
                        <button type="button" class="cite-action-primary" ${state.busy || !state.task || missing.length ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">Submit MFO Report</button>
                    </div>
                </div>
            </div>
        `;
    }

    // -----------------------------------------------------------------------
    // Completed report view
    //
    // Renders the saved packet in the official accomplishment report layout so
    // faculty can read and print what they are submitting instead of only
    // seeing the editor. It reads state.rows and state.sectionStatus directly —
    // the same data the editor writes — so there is no second copy of the
    // report to keep in step.
    // -----------------------------------------------------------------------

    const NA = 'N/A';

    /**
     * Template value. Every column in the official form stays present, so a
     * missing value prints N/A rather than disappearing (MFO instruction:
     * "Write NA for sections/items not applicable to your program").
     */
    function tv(value) {
        const text = String(value ?? '').trim();
        return text === '' ? NA : text;
    }

    function reportDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }

    /**
     * The official MFO form, transcribed from MFO.pdf.
     *
     * This is the authoritative spec for the rendered report: MFO order,
     * Performance Indicator order and wording, column order, and the official
     * column labels verbatim. Each column carries a resolver that maps the
     * stored row onto that column. Nothing here is derived from the editor's
     * abbreviated field labels, because the form's own wording is what the
     * reviewers and the College expect to read.
     *
     * `programLevel: true` marks the two indicators the form assigns to the
     * Program Chairperson. They stay in the document so the structure is
     * complete, and print N/A on a faculty member's report.
     */
    const FORM = [
        {
            group: 'MFO 1: Higher Education Services',
            indicators: [
                {
                    heading: 'Performance Indicator 1: Percentage of first-time licensure exam-takers pass the licensure exams',
                    programLevel: true,
                    columns: [
                        'Date of LET Examination', 'No. of First-time Takers', 'No. of Passers',
                        'Passing Percentage for First-time Takers', 'Total No. of Takers',
                        'Total No. of Passers', 'Over-all Passing Percentage'
                    ]
                },
                {
                    heading: 'Performance Indicator 2: Updated Percentage of the graduates (2 years prior) that are employed',
                    programLevel: true,
                    columns: ['No. of Graduates', 'No. of Graduates Employed', 'Percentage']
                },
                {
                    heading: 'Performance Indicator 3: Percentage of undergraduate students enrolled in CHED-identified and RDC-identified priority programs',
                    table: 'mfo_pi3_enrollment',
                    code: 'mfo1_pi3',
                    columns: [
                        ['Class Section', (r) => r.section],
                        ['No. of Students Enrolled', (r) => r.students_enrolled],
                        ['Name of Adviser', (r) => r.adviser_name]
                    ]
                },
                {
                    heading: 'Performance Indicator 4: List of Syllabus submitted for this semester for the entire program.',
                    table: 'mfo_pi4_syllabus',
                    code: 'mfo1_pi4',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Courses Taught', (r) => [r.subject_code, r.course_title].filter(Boolean).join(' — ')],
                        ['Status of Syllabus Submission (submitted/not submitted)', (r) => String(r.syllabus_status || '').replace(/_/g, ' ')],
                        ['Remarks', (r) => r.remarks]
                    ]
                },
                {
                    heading: 'Performance Indicator 5: Certifications acquired from TESDA, ISO, AACCUP, and others.',
                    table: 'mfo_pi5_certifications',
                    code: 'mfo1_pi5',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Nature of Certification (accreditor/auditor/NC/TM and others)', (r) => [r.certification_title, r.certification_nature].filter(Boolean).join(' — ')],
                        ['Granting Agency', (r) => r.granting_agency],
                        ['Date Granted', (r) => reportDate(r.date_granted)]
                    ]
                },
                {
                    heading: 'Performance Indicator 6: List of faculty members undergoing post-graduate education.',
                    table: 'mfo_pi6_postgraduate',
                    code: 'mfo1_pi6',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Program enrolled in', (r) => r.program_enrolled],
                        ['Total no. of earned units as of this semester', (r) => r.earned_units],
                        ['No. of units enrolled in this semester', (r) => r.current_units],
                        ['Name of Educational Institution', (r) => r.institution_name]
                    ]
                },
                {
                    heading: 'Performance Indicator 7: List of trainings/workshops/seminars attended by faculty members.',
                    table: 'mfo_pi7_trainings',
                    code: 'mfo1_pi7',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Title of Training/Workshop/Seminar', (r) => r.title],
                        ['Date', (r) => reportDate(r.activity_date)],
                        ['Venue', (r) => r.venue],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency],
                        ['Role (participant/resource speaker/facilitator)', (r) => r.role]
                    ]
                },
                {
                    heading: 'Performance Indicator 8: Production of instructional materials',
                    table: 'mfo_pi8_instructional_materials',
                    code: 'mfo1_pi8',
                    columns: [
                        ['Name of Faculty (Authors)', (r, c) => r.authors_text || c.facultyName],
                        ['Title of Instructional Materials (IM)', (r) => r.title],
                        ['Type of Instructional Material (print, media, graphics, etc.)', (r) => r.material_type],
                        ['Courses Utilizing the IMs', (r) => r.courses_utilizing],
                        ['Nature of Intellection Property Protection (copyright/UM/industrial design/patents etc.', (r) => r.ip_nature]
                    ]
                }
            ]
        },
        {
            group: 'MFO 3: Research',
            indicators: [
                {
                    heading: 'Performance Indicator 1: Research output utilized by the industry/community/other beneficiaries within the quarter',
                    table: 'mfo_research_utilized',
                    code: 'mfo3_pi1',
                    columns: [
                        ['Title of Research', (r) => r.research_title],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text],
                        ['Nature of Utilization (technology adoption/commercialization/community extension, etc.)', (r) => r.utilization_nature],
                        ['Name of Partner Community/Industry', (r) => r.partner_name],
                        ["Address of Partner's Office", (r) => r.partner_address]
                    ]
                },
                {
                    // The official form leaves this table without column
                    // headers. These are the normalized fields already stored
                    // for it, so the data stays readable.
                    heading: 'Performance Indicator 2: Research output completed within the quarter',
                    table: 'mfo_research_completed',
                    code: 'mfo3_pi2',
                    columns: [
                        ['Title of Research', (r) => r.research_title],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text],
                        ['Date Completed', (r) => reportDate(r.completed_at)],
                        ['Status', (r) => r.research_status],
                        ['Funding Source', (r) => r.funding_source]
                    ]
                },
                {
                    heading: 'Performance Indicator 3: Research output published in internationally refereed or CHED accredited journals within the quarter',
                    table: 'mfo_research_published',
                    code: 'mfo3_pi3',
                    columns: [
                        ['Title of Research', (r) => r.research_title],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text],
                        ['Name of Publication', (r) => r.publication_name],
                        ['Date Published', (r) => reportDate(r.published_at)],
                        ['Funding Source', (r) => r.funding_source]
                    ]
                },
                {
                    heading: 'Performance Indicator 4: Research Output Presented in Research Conferences within the quarter',
                    table: 'mfo_research_presented',
                    code: 'mfo3_pi4',
                    columns: [
                        ['Title of Research', (r) => r.research_title],
                        ['Title of Research Proponents', (r) => r.proponents_text],
                        ['Date', (r) => reportDate(r.presented_at)],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency],
                        ['Venue', (r) => r.venue]
                    ]
                }
            ]
        },
        {
            group: 'MFO 4: Technical Advisory Extension Program',
            indicators: [
                {
                    heading: 'Performance Indicator 1: Number of active partnerships with LGUs, industries, NGOs, NGAs, SMEs, and other stakeholders as a result of extension activities',
                    table: 'mfo_extension_partnerships',
                    code: 'mfo4_pi1',
                    columns: [
                        ['Title of Community Extension Project', (r) => r.project_title],
                        ['Proponents', (r) => r.proponents_text],
                        ['Partner Industry/Community (indicate if with/without MOA)', (r) => {
                            const partner = String(r.partner_name || '').trim();
                            if (!partner) return '';
                            return `${partner} (${r.has_moa ? 'with MOA' : 'without MOA'})`;
                        }],
                        ['Project Locale', (r) => r.project_locale]
                    ]
                },
                {
                    heading: 'Performance Indicator 2: Number of trainees weighted by the length of training (manhours)',
                    table: 'mfo_extension_trainings',
                    code: 'mfo4_pi2',
                    columns: [
                        ['Title of Training Provided to the Community/Industry', (r) => r.training_title],
                        ['No. Community Beneficiaries (separate no. of male & female)', (r) => {
                            const male = r.beneficiaries_male;
                            const female = r.beneficiaries_female;
                            const parts = [];
                            if (male !== null && male !== undefined && male !== '') parts.push(`Male: ${male}`);
                            if (female !== null && female !== undefined && female !== '') parts.push(`Female: ${female}`);
                            return parts.join(' / ');
                        }],
                        ['Length of Training (number of hours)', (r) => r.training_hours],
                        ['Total Manhours', (r) => manhoursPreview(r)],
                        ['Partner Agency', (r) => r.partner_agency]
                    ]
                }
            ]
        },
        {
            group: 'Other initiatives/ activities undertaken relevant instruction/research/extension.',
            bare: true,
            indicators: [
                {
                    table: 'mfo_other_initiatives',
                    code: 'other_initiatives',
                    columns: [
                        ['Title of Activity', (r) => r.activity_title],
                        ['Date Conducted', (r) => reportDate(r.activity_date)],
                        ['Venue', (r) => r.venue],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency],
                        ['Students Involved', (r) => r.students_involved],
                        ['Role', (r) => r.student_role],
                        ['Faculty Involved', (r) => r.faculty_involved],
                        ['Role', (r) => r.faculty_role]
                    ]
                }
            ]
        },
        {
            group: 'Awards received for excellence in instruction, research, community extension work.',
            bare: true,
            indicators: [
                {
                    table: 'mfo_awards',
                    code: 'awards',
                    columns: [
                        ['Title of Award', (r) => r.award_title],
                        ['Nature of Award (for excellence in research/instruction/extension, etc)', (r) => r.award_nature || r.award_type],
                        ['Granting Agency', (r) => r.granting_agency],
                        ['Date of Awarding Ceremony', (r) => reportDate(r.awarded_at)]
                    ]
                }
            ]
        }
    ];

    /**
     * One indicator table. Every official column is emitted on every row, and
     * an empty cell prints N/A — the form is a fixed grid, so nothing is
     * dropped for being blank. A section with no records still shows its full
     * header row above a single all-N/A row so the structure survives.
     */
    function formTable(indicator, ctx) {
        const labels = indicator.columns.map((col) => (Array.isArray(col) ? col[0] : col));
        const head = labels.map((label) => `<th>${esc(label)}</th>`).join('');

        const na = indicator.code ? !!state.sectionStatus[indicator.code]?.is_not_applicable : false;
        const rows = indicator.table ? (state.rows[indicator.table] || []) : [];
        const blank = `<tr>${labels.map(() => `<td>${NA}</td>`).join('')}</tr>`;

        let body;
        if (indicator.programLevel || na || !rows.length) {
            body = blank;
        } else {
            body = rows.map((row) => {
                const cells = indicator.columns.map((col) => {
                    const get = Array.isArray(col) ? col[1] : null;
                    let value;
                    try {
                        value = get ? get(row, ctx) : '';
                    } catch (_) {
                        value = '';
                    }
                    return `<td>${esc(tv(value))}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        }
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    /**
     * Documentation entries print as blocks rather than a grid: a title, event
     * details built only from the fields that carry values, the description,
     * and the evidence actually on file. No detail line is emitted for a field
     * the faculty member left blank.
     */
    function reportDocumentation(rows) {
        return rows.map((row) => {
            const details = [
                ['Date', reportDate(row.activity_date)],
                ['Time', String(row.activity_time || '').trim()],
                ['Venue', String(row.venue || '').trim()],
                ['Sponsoring agency', String(row.sponsoring_agency || '').trim()],
                ['Role', String(row.role || '').trim()]
            ].filter(([, value]) => value);
            const attached = filesFor('documentation_other', row.id)
                .concat((state.files || []).filter((file) => String(file.mfo_documentation_id || '') === String(row.id)));
            const unique = [];
            attached.forEach((file) => {
                if (!unique.some((item) => String(item.id) === String(file.id))) unique.push(file);
            });
            const narrative = String(row.narrative || '').trim();
            const images = unique.filter((file) => IMAGE_EXT.test(String(file.file_name || '')));
            const others = unique.filter((file) => !IMAGE_EXT.test(String(file.file_name || '')));
            // src is filled in by hydrateReportPhotos(): the bucket is private,
            // so each object key has to be signed before it will load.
            const photos = images.map((file) => `
                <div class="mfo-doc-photo">
                    <img alt="${esc(file.mfo_caption || file.file_name || 'Supporting photo')}"
                         data-storage-path="${esc(file.storage_path || file.file_path || '')}"
                         data-file-url="${esc(file.file_url || '')}">
                    ${file.mfo_caption ? `<div class="cap">${esc(file.mfo_caption)}</div>` : ''}
                </div>`).join('');
            return `
                <div class="mfo-doc-entry">
                    <div class="t">${esc(String(row.title || '').trim() || 'Untitled activity')}</div>
                    ${details.length ? `<dl>${details.map(([label, value]) =>
                        `<dt>${esc(label)}:</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : ''}
                    ${narrative ? `<div>${esc(narrative)}</div>` : ''}
                    ${photos ? `<div class="mfo-doc-photos">${photos}</div>` : ''}
                    ${others.length ? `<div style="margin-top:4px"><b>Attached documents:</b> ${
                        others.map((file) => esc(file.file_name)).join('; ')
                    }</div>` : ''}
                </div>`;
        }).join('');
    }

    /**
     * Resolve each documentation photo to a signed URL after the report is in
     * the DOM. Signing is per-object and asynchronous, so it cannot happen
     * inside the synchronous renderer. A photo that cannot be signed is removed
     * rather than left as a broken image.
     */
    async function hydrateReportPhotos() {
        const nodes = Array.from(document.querySelectorAll('#mfoReportDoc img[data-storage-path]'));
        if (!nodes.length) return;
        const client = db();
        await Promise.all(nodes.map(async (img) => {
            const path = img.getAttribute('data-storage-path');
            if (path && client?.storage) {
                try {
                    const signed = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
                    if (signed.data?.signedUrl) {
                        img.src = signed.data.signedUrl;
                        return;
                    }
                } catch (_) {}
            }
            const fallback = img.getAttribute('data-file-url');
            if (fallback) {
                img.src = fallback;
                return;
            }
            img.closest('.mfo-doc-photo')?.remove();
        }));
    }

    /**
     * Quarter wording as the form states it: "1st_ Quarter, Months of January
     * to March". Derived from the reporting period rather than hard-coded, so
     * the same renderer serves any quarter.
     */
    function quarterLine(period) {
        const ordinals = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
        const months = {
            1: 'January to March', 2: 'April to June',
            3: 'July to September', 4: 'October to December'
        };
        const q = Number(period.quarter || 0);
        if (!q || !ordinals[q]) return esc(period.period_label || '');
        return `${ordinals[q]} Quarter, Months of ${months[q]}`;
    }

    function renderReportDocument() {
        const faculty = state.faculty;
        const period = state.period || {};
        const ctx = { facultyName: faculty.full_name || '' };
        const docRows = state.rows.mfo_documentation_items || [];

        const body = FORM.map((group) => {
            const heading = `<div class="mfo-doc-group">${esc(group.group)}</div>`;
            const tables = group.indicators.map((indicator) => `
                ${indicator.heading ? `<div class="mfo-doc-pi">${esc(indicator.heading)}</div>` : ''}
                ${formTable(indicator, ctx)}
            `).join('');
            return heading + tables;
        }).join('');

        const otherAccomplishments = String(state.packet?.notes || '').trim();

        return `
            <div class="mfo-doc" id="mfoReportDoc">
                ${reportHeader()}
                <div class="mfo-doc-title">Accomplishment Report – CY ${esc(period.reporting_year || '')}</div>
                <div class="mfo-doc-sub">${quarterLine(period)}</div>
                <div class="mfo-doc-sub">(for the Program Chairperson)</div>

                <div class="mfo-doc-ident">
                    <div class="row">
                        <span><b>Program Chairperson:</b> ${esc(tv(state.chairName))}</span>
                        <span><b>Program:</b> ${esc(tv(faculty.department || faculty.department_code))}</span>
                    </div>
                    <div class="row">
                        <span><b>Reporting Faculty:</b> ${esc(tv(faculty.full_name))}</span>
                        <span><b>Status:</b> ${esc(statusLabel())}</span>
                    </div>
                </div>

                <div class="mfo-doc-instr">
                    Instructions: Fill in the table with the required data. Write NA for sections/items
                    not applicable to your program.
                </div>

                ${body}

                <div class="mfo-doc-group">Other accomplishment/s of the program that you would like the College of Education to report for this quarter:</div>
                <div class="mfo-doc-note">(policies created, external grant for instruction/research/extension, etc.)</div>
                <div class="mfo-doc-lines">${otherAccomplishments ? esc(otherAccomplishments) : NA}</div>

                <div class="mfo-doc-sign">
                    <div class="box">
                        <div><b>Date Submitted:</b></div>
                        <div class="line"></div>
                        <div>${esc(state.submission?.submitted_at
                            ? reportDate(state.submission.submitted_at)
                            : NA)}</div>
                    </div>
                    <div class="box">
                        <div><b>Submitted by:</b></div>
                        <div class="line"></div>
                        <div>${esc(tv(faculty.full_name))}</div>
                    </div>
                    <div class="box">
                        <div><b>E-Signature:</b></div>
                        ${hasSignature()
                            ? `<div class="line sig"><img src="${esc(state.packet.signature_data_url)}" alt="Electronic signature" /></div>`
                            : '<div class="line"></div>'}
                        <div>${esc(tv(state.packet?.signature_name || (hasSignature() ? faculty.full_name : '')))}</div>
                    </div>
                </div>

                ${docRows.length ? renderDocumentationPages(docRows, period) : ''}
                ${reportFooter()}
            </div>`;
    }

    /**
     * Header and footer are the official form's own artwork, copied out of
     * MFO.docx (word/media/image1.jpeg and image2.png) into assets/. The
     * letterhead is a single flattened banner in the template — seal, Republic
     * of the Philippines, CEBU TECHNOLOGICAL UNIVERSITY, ARGAO CAMPUS, address,
     * website, e-mail, phone, and the Bagong Pilipinas mark are all baked into
     * that one image, which is why reading the PDF as text showed no header at
     * all. Using the artwork itself avoids rebuilding it out of separate assets
     * and drifting from the original.
     *
     * Widths match the template's own display sizes (108.24mm and 151.39mm),
     * both centred as the document has them.
     */
    function reportHeader() {
        return `
            <div class="mfo-doc-head">
                <img src="../assets/mfo-letterhead.jpg"
                     alt="Republic of the Philippines · Cebu Technological University · Argao Campus">
            </div>`;
    }

    function reportFooter() {
        return `
            <div class="mfo-doc-foot">
                <img src="../assets/mfo-footer-rankings.png"
                     alt="Cebu Technological University accreditations and rankings">
            </div>`;
    }

    /**
     * Supporting documentation follows the report, carrying the same title
     * block identity. Event details here follow the opposite rule to the form
     * tables: a detail with no value is omitted entirely rather than printed
     * as an empty label.
     */
    function renderDocumentationPages(rows, period) {
        return `
            <div class="mfo-doc-break"></div>
            <div class="mfo-doc-title">Supporting Documentation</div>
            <div class="mfo-doc-sub">Accomplishment Report – CY ${esc(period.reporting_year || '')} · ${quarterLine(period)}</div>
            <div class="mfo-doc-sub">${esc(tv(state.faculty.full_name))}</div>
            ${reportDocumentation(rows)}`;
    }

    function renderPreview() {
        const root = document.getElementById('mfoApp');
        if (!root || !state.faculty) return;
        root.innerHTML = `
            <div class="mfo-doc-toolbar mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <div class="cite-kicker">${state.reviewerMode ? 'Submitted report (read-only)' : 'Completed report'}</div>
                    <h1 class="cite-title">MFO Accomplishment Report</h1>
                    <p class="cite-subtitle">${esc(statusLabel())}${
                        state.reviewerMode ? ` · ${esc(state.faculty.full_name || '')}` : ' · reflects the last saved values.'
                    }</p>
                </div>
                <div class="flex flex-col sm:flex-row gap-2">
                    ${state.reviewerMode ? '' : '<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePreview()">← Back to editor</button>'}
                    <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.printReport()">
                        <i class="fa-solid fa-print"></i> Print
                    </button>
                </div>
            </div>
            ${renderReportDocument()}`;
        window.scrollTo({ top: 0, behavior: 'auto' });
        hydrateReportPhotos();
    }

    /**
     * Preview must show what would actually be submitted, so pending edits are
     * written first. If that write fails the editor stays put and the error is
     * surfaced rather than showing a preview that silently omits the changes.
     */
    async function openPreview() {
        if (!state.locked) {
            state.busy = true;
            render();
            try {
                await saveDraftInternal(false);
                state.lastSaved = new Date().toISOString();
            } catch (error) {
                state.busy = false;
                render();
                toast(friendlyError(error, 'Unable to save your changes before preview.'), 'error');
                return;
            }
            state.busy = false;
        }
        state.previewOpen = true;
        render();
    }

    function closePreview() {
        // The reviewer route has no editor to return to.
        if (state.reviewerMode) return;
        state.previewOpen = false;
        render();
    }

    function printReport() {
        if (!state.previewOpen) return;
        window.print();
    }

    function render() {
        const root = document.getElementById('mfoApp');
        if (!root || !state.faculty) return;
        if (state.previewOpen) {
            renderPreview();
            return;
        }
        const faculty = state.faculty;
        const grouped = [];
        TABLES.forEach((def) => {
            const last = grouped[grouped.length - 1];
            if (!last || last.group !== def.group) grouped.push({ group: def.group, items: [def] });
            else last.items.push(def);
        });
        root.innerHTML = `
            <div class="mb-4">
                <a href="submissions.html" class="text-sm font-bold text-[#621708]">← Back to Submissions</a>
                <div class="cite-kicker mt-3">MFO Report</div>
                <h1 class="cite-title">Accomplishment Report — CY ${esc(state.period.reporting_year || '')}</h1>
                <p class="cite-subtitle">Quarterly faculty contribution. Program-level licensure, employment, and narrative sections stay with the Chairperson.</p>
            </div>

            ${state.taskWarning ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">${esc(state.taskWarning)}</div>` : ''}
            ${state.configError ? `<div class="mb-4 p-3 rounded-xl bg-rose-50 text-rose-900 text-sm font-semibold">${esc(state.configError)}</div>` : ''}
            ${state.sourceWarning ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">${esc(state.sourceWarning)}</div>` : ''}
            ${state.autoSummary && (state.autoSummary.added || state.autoSummary.filled) ? `
                <div class="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-900 text-sm font-semibold">
                    Retrieved from your existing CITE-Flow records:
                    ${state.autoSummary.added ? `${state.autoSummary.added} record${state.autoSummary.added === 1 ? '' : 's'} added` : ''}
                    ${state.autoSummary.added && state.autoSummary.filled ? ' · ' : ''}
                    ${state.autoSummary.filled ? `${state.autoSummary.filled} blank field${state.autoSummary.filled === 1 ? '' : 's'} completed` : ''}.
                    Review and correct anything that is out of date — your edits are kept.
                </div>
            ` : ''}

            <div class="mfo-sticky rounded-[16px] p-4 mb-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                    <div class="text-sm font-bold">${esc(statusLabel())}</div>
                    <div class="text-xs text-slate-500">Last saved: ${esc(formatWhen(state.lastSaved || state.packet?.updated_at))}</div>
                </div>
                <div class="mfo-actions flex flex-col sm:flex-row gap-2">
                    <button type="button" class="cite-action" ${state.busy || state.locked ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.saveDraft()">Save Draft</button>
                    <button type="button" class="cite-action" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.openPreview()">View / Print Report</button>
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewOpen(true)">Review MFO Report</button>
                    <button type="button" class="cite-action-primary" ${state.busy || !state.task || (state.locked && statusLabel() !== 'Returned for Revision') ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">Submit MFO Report</button>
                </div>
            </div>

            <section class="surface rounded-[16px] p-5 mb-4">
                <h2 class="text-base font-bold mb-4">Report information</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    <div><div class="mfo-label">Faculty name</div><div class="font-semibold">${esc(faculty.full_name)}</div><div class="text-[11px] text-slate-400">Auto-filled from logged-in faculty</div></div>
                    <div><div class="mfo-label">Faculty ID</div><div class="font-semibold">${esc(faculty.id)}</div><div class="text-[11px] text-slate-400">${faculty.employee_id ? `Employee ID: ${esc(faculty.employee_id)}` : 'From public.faculty.id'}</div></div>
                    <div><div class="mfo-label">Department</div><div class="font-semibold">${esc(faculty.department || faculty.department_code || '—')}</div></div>
                    <div><div class="mfo-label">Position</div><div class="font-semibold">${esc(faculty.position || faculty.academic_rank || faculty.raw_role || 'Faculty')}</div></div>
                    <div><div class="mfo-label">Reporting period</div><div class="font-semibold">${esc(state.period.period_label)}</div></div>
                    <div><div class="mfo-label">Deadline</div><div class="font-semibold">${esc(formatWhen(state.task?.deadline_at || state.task?.due_at))}</div></div>
                    <div><div class="mfo-label">Status</div><div class="font-semibold">${esc(statusLabel())}</div></div>
                    <div><div class="mfo-label">Date created</div><div class="font-semibold">${esc(formatWhen(state.packet?.created_at))}</div></div>
                    <div><div class="mfo-label">Academic period</div><div class="font-semibold">${esc([state.period.academic_year, state.period.semester].filter(Boolean).join(' · ') || '—')}</div></div>
                </div>
            </section>

            ${renderProgramLocked()}
            ${grouped.map((block) => block.items.map(renderFacultySection).join('')).join('')}
            ${renderSignatureSection()}
            ${renderReview()}
            ${renderPhotoModal()}
        `;
        restoreSignaturePad();
    }

    /**
     * "Submitted By" and the electronic signature, side by side.
     *
     * Submitted By is unchanged and still comes from the faculty record; it is
     * shown here only so the author can see what will be printed above their
     * signature.
     */
    function renderSignatureSection() {
        const faculty = state.faculty;
        const signed = hasSignature();
        const signedName = state.packet?.signature_name || faculty.full_name || '';

        return `
            <section class="surface rounded-[16px] p-5 mb-4">
                <h2 class="text-base font-bold mb-1">Submitted by &amp; electronic signature</h2>
                <p class="text-xs text-slate-500 mb-4">
                    Both appear on the printed report and stay attached to this report
                    for the Chairperson and the Admin to see.
                </p>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div>
                        <div class="mfo-label">Submitted by</div>
                        <div class="font-semibold text-sm">${esc(faculty.full_name || '—')}</div>
                        <div class="text-[11px] text-slate-400">
                            ${esc(faculty.position || faculty.academic_rank || 'Faculty')}
                            ${faculty.department ? ` · ${esc(faculty.department)}` : ''}
                        </div>
                        <div class="mfo-label mt-4">Date submitted</div>
                        <div class="font-semibold text-sm">${esc(
                            state.submission?.submitted_at
                                ? formatWhen(state.submission.submitted_at)
                                : 'Not yet submitted'
                        )}</div>
                    </div>

                    <div>
                        <div class="mfo-label">Electronic signature</div>
                        ${signed ? `
                            <div class="mt-1 p-3 rounded-xl border border-slate-200 bg-white">
                                <img src="${esc(state.packet.signature_data_url)}" alt="Electronic signature"
                                     style="max-height:70px;max-width:100%;display:block" />
                                <div class="text-[11px] text-slate-500 mt-2">
                                    ${esc(signedName)}${state.packet?.signature_signed_at
                                        ? ` · signed ${esc(formatWhen(state.packet.signature_signed_at))}`
                                        : ''}
                                </div>
                            </div>
                            ${state.locked ? '' : `
                                <button type="button" class="cite-action mt-2"
                                        onclick="CiteFlowMfoFaculty.removeSignature()">Remove signature</button>
                            `}
                        ` : `
                            ${state.locked
                                ? '<div class="text-sm text-slate-500 mt-1">No signature was attached to this report.</div>'
                                : `
                                <p class="text-xs text-slate-500 mt-1 mb-2">Sign in the box below, or upload an image of your signature.</p>
                                <canvas id="mfoSignaturePad" width="700" height="150"
                                    style="width:100%;height:150px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair"
                                    onmousedown="CiteFlowMfoFaculty.signatureDown(event)"
                                    onmousemove="CiteFlowMfoFaculty.signatureMove(event)"
                                    onmouseup="CiteFlowMfoFaculty.signatureUp(event)"
                                    onmouseleave="CiteFlowMfoFaculty.signatureUp(event)"
                                    ontouchstart="CiteFlowMfoFaculty.signatureDown(event)"
                                    ontouchmove="CiteFlowMfoFaculty.signatureMove(event)"
                                    ontouchend="CiteFlowMfoFaculty.signatureUp(event)"></canvas>
                                <label class="mfo-label mt-3 block" for="mfoSignatureName">Name under the signature</label>
                                <input id="mfoSignatureName" type="text" class="mfo-field" maxlength="120"
                                       value="${esc(faculty.full_name || '')}" />
                                <div class="flex flex-wrap gap-2 mt-3">
                                    <button type="button" class="cite-action-primary" ${state.busy ? 'disabled' : ''}
                                            onclick="CiteFlowMfoFaculty.saveDrawnSignature()">Save signature</button>
                                    <button type="button" class="cite-action"
                                            onclick="CiteFlowMfoFaculty.clearSignaturePad()">Clear</button>
                                    <label class="cite-action inline-flex cursor-pointer">
                                        Upload image
                                        <input type="file" accept="image/*" class="hidden"
                                               onchange="CiteFlowMfoFaculty.uploadSignatureImage(this)">
                                    </label>
                                </div>
                            `}
                        `}
                    </div>
                </div>
            </section>`;
    }

    global.CiteFlowMfoFaculty = {
        updateRow,
        addRow,
        removeRow,
        setSectionNa,
        saveDraft,
        submitPacket,
        openPreview,
        closePreview,
        printReport,
        uploadFile,
        removeFile,
        render,
        openPhotoModal,
        closePhotoModal,
        updatePhotoModalField,
        addPhotoModalFiles,
        removePendingPhoto,
        savePhotoModal,
        removePhotoDoc,
        signatureDown: signaturePointerDown,
        signatureMove: signaturePointerMove,
        signatureUp: signaturePointerUp,
        clearSignaturePad,
        saveDrawnSignature,
        uploadSignatureImage,
        removeSignature,
        reviewOpen(open) {
            state.reviewOpen = !!open;
            render();
        }
    };

    window.addEventListener('load', init);
})(window);
