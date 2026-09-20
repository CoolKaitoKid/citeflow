/**
 * Faculty MFO Report — Phase 2
 * Structured packet editor. Packet-level workflow only. No chairperson/admin review UI.
 */
(function initCiteFlowMfoFaculty(global) {
    'use strict';

    window.addEventListener('error', (event) => {
        console.error('[MFO TRACE] JavaScript error before navigation', event.error || event.message, {
            source: event.filename || null,
            line: event.lineno || null,
            column: event.colno || null
        });
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error('[MFO TRACE] Unhandled promise rejection', event.reason);
    });

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
            columns: ['activity_title', 'category', 'description', 'activity_date', 'venue', 'sponsoring_agency', 'students_involved', 'student_role', 'faculty_involved', 'faculty_role', 'remarks', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order', 'is_not_applicable'],
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
            columns: ['section_code', 'title', 'caption', 'activity_date', 'activity_time', 'venue', 'narrative', 'record_table', 'record_id', 'source_kind', 'source_table', 'source_id', 'faculty_id', 'sort_order'],
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

    function fileIsImage(file) {
        const name = String(file?.file_name || file?.storage_path || file?.file_url || '');
        if (IMAGE_EXT.test(name)) return true;
        if (/^image\//i.test(String(file?.content_type || file?.mime_type || file?.file_type || ''))) return true;
        return /\/photos\//i.test(String(file?.storage_path || file?.file_path || ''));
    }

    const state = {
        user: null,
        session: null,
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
        busyLabel: '',
        locked: false,
        reviewOpen: false,
        previewOpen: false,
        configs: [],
        photoModal: null,
        previewPhotosReady: false,
        lastSaved: null,
        catalog: [],
        taskWarning: '',
        routeWarning: '',
        configError: '',
        chairName: '',
        reviewerMode: false,
        printingOfficial: false,
        reviewerActor: null,
        sourceWarning: '',
        sourceErrors: [],
        autoSummary: null,
        // Set when initialization could not build the editing context. While
        // this is set the page renders a hard failure screen instead of an
        // editor, so a missing packet can never look like a usable report.
        initFailure: null
    };

    function db() {
        const shared = global.CiteFlowAuth?.ensureSharedClient?.();
        if (shared) {
            state.db = shared;
            return shared;
        }
        return state.db || global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.();
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[c]));
    }

    function beginBusy(label) {
        if (state.busy) return false;
        state.busy = true;
        state.busyLabel = label || 'Working…';
        render();
        return true;
    }

    function endBusy() {
        state.busy = false;
        state.busyLabel = '';
        render();
    }

    /**
     * The packet every write path needs.
     *
     * Without this, a report whose packet was never created reached
     * saveTable()/updatePacket() and failed with "Cannot read properties of
     * null (reading 'id')" — a message that names neither the missing object
     * nor the database error that caused it. Throwing here keeps the real
     * cause in front of the user.
     */
    function requirePacket() {
        if (state.packet?.id) return state.packet;
        const failure = state.initFailure;
        const cause = failure?.error?.message ? ` The report could not be opened: ${failure.error.message}` : '';
        throw new Error(
            `No MFO report record exists for this account yet, so nothing was saved.${cause}`
        );
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
        if (code === '42501' || /row-level security|violates row-level|permission denied|42501|AccessDenied/i.test(msg)) {
            if (/storage|object|bucket|wf-submissions/i.test(msg + String(error?.details || ''))) {
                return 'Photo upload was blocked by storage permissions. Run migration 027 in the SQL Editor, then reload this page.';
            }
            return 'Unable to save or submit the MFO report. If you were just signed in, reload the page. If this continues, sign in again.';
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

    function mfoDiagnosticError(error) {
        return {
            message: error?.message || null,
            code: error?.code || null,
            details: error?.details || null,
            hint: error?.hint || null,
            status: error?.status || error?.statusCode || null
        };
    }

    function logMfoDiagnostic(operation, response, context) {
        const error = response?.error || null;
        console.info(`[MFO Init Trace] ${operation}`, {
            ...context,
            response: response
                ? { data: response.data ?? null, error: mfoDiagnosticError(error) }
                : null
        });
        if (error) console.error(`[MFO Init Trace] ${operation} failed`, mfoDiagnosticError(error), error);
    }

    async function ensureAuthSession() {
        const client = db();
        if (!client?.auth?.getSession) return null;
        const guard = global.CiteFlowAuthGuard;
        if (guard?.ready && guard.state === guard.AuthState?.INITIALIZING) {
            await guard.ready;
        }
        const stored = await client.auth.getSession();
        if (stored.data?.session?.user?.id && stored.data.session.access_token) {
            console.info('[AUTH TRACE] MFO SESSION AFTER LOAD', {
                userId: stored.data.session.user.id,
                authGuardState: guard?.state || null,
                source: 'shared-client'
            });
            return stored.data.session;
        }
        return null;
    }

    async function requireLiveSession() {
        const client = db();
        const session = await ensureAuthSession();

        if (session?.user?.id && session?.access_token) {
            state.user = session.user;
            state.session = session;
            return session;
        }

        console.error('[MFO] write blocked: no live JWT', await authSnapshot());
        throw new Error('Your session expired. Please sign in again.');
    }

    async function logWriteAccess(reason) {
        try {
            const snapshot = await authSnapshot();
            const debug = await db().rpc('mfo_debug_write_access', { p_packet_id: state.packet?.id || null });
            console.info('[MFO] write-access', reason, {
                clientAuthUserId: snapshot.authUserId,
                jwtPresent: snapshot.jwtPresent,
                debug: debug.data || debug.error
            });
        } catch (error) {
            console.warn('[MFO] write-access log failed', error);
        }
    }

    async function linkFacultyAuthIfSafe() {
        try {
            const { data, error } = await db().rpc('wf_link_faculty_auth_user_if_safe');
            if (error) {
                if (!/could not find the function|PGRST202|42883/i.test(error.message || '')) {
                    console.warn('[MFO] wf_link_faculty_auth_user_if_safe', error);
                }
                return null;
            }
            return data || null;
        } catch (error) {
            console.warn('[MFO] wf_link_faculty_auth_user_if_safe threw', error);
            return null;
        }
    }

    function isNumericFacultyId(value) {
        return value != null && value !== '' && Number.isFinite(Number(value)) && !String(value).includes('-');
    }

    /**
     * Which public.faculty rows carry this email address.
     *
     * public.mfo_owns_faculty_id() accepts a row whose email OR existing_email
     * matches the login. Matching only `email` here rejected logins whose
     * faculty row carries the address in existing_email — the database would
     * have accepted them, so the page refused a report the server allowed.
     */
    async function loadFacultyByEmail(email) {
        const client = db();
        const [byEmail, byExisting] = await Promise.all([
            client.from('faculty').select('*').ilike('email', email)
                .order('id', { ascending: true }).limit(3),
            client.from('faculty').select('*').ilike('existing_email', email)
                .order('id', { ascending: true }).limit(3)
        ]);
        logMfoDiagnostic('faculty select by email', byEmail, { email });
        logMfoDiagnostic('faculty select by existing_email', byExisting, { email });
        if (byEmail.error) console.error('[MFO] faculty by email failed', mfoDiagnosticError(byEmail.error));
        if (byExisting.error) console.error('[MFO] faculty by existing_email failed', mfoDiagnosticError(byExisting.error));
        const merged = new Map();
        [...(byEmail.data || []), ...(byExisting.data || [])].forEach((candidate) => merged.set(String(candidate.id), candidate));
        return [...merged.values()];
    }

    /**
     * Resolve the same public.faculty row MFO RLS expects.
     * Prefer auth_user_id (matches SQL), never use admin UUID fallbacks.
     *
     * A lookup that fails outright is rethrown rather than treated as "no
     * row": swallowing it turned a database error into a misleading
     * "no faculty profile" message. Two rows sharing one auth_user_id is
     * reported instead of being silently narrowed, because the server picks
     * the owner itself (wf_link_faculty_auth_user_if_safe) and a client guess
     * that disagrees makes mfo_ensure_faculty_packet reject the write with
     * "Not allowed to create an MFO packet for another faculty member."
     */
    async function resolveMfoFaculty(user) {
        const client = db();
        const email = String(user?.email || '').trim().toLowerCase();

        const byAuth = await client
            .from('faculty')
            .select('*')
            .eq('auth_user_id', user.id)
            .order('id', { ascending: true })
            .limit(2);
        logMfoDiagnostic('faculty select by auth_user_id', byAuth, { authUid: user?.id || null });
        if (byAuth.error) {
            console.error('[MFO] faculty lookup by auth_user_id failed', mfoDiagnosticError(byAuth.error));
            throw byAuth.error;
        }

        const authRows = byAuth.data || [];
        if (authRows.length > 1) {
            console.error('[MFO] several public.faculty rows carry this auth_user_id', authRows.map((r) => r.id));
            throw new Error(
                'More than one faculty profile is linked to this sign-in, so MFO cannot choose one safely. '
                + 'Ask an administrator to clear the duplicate faculty.auth_user_id entries.'
            );
        }

        let row = authRows[0] || null;
        if (!row && email) {
            const matches = await loadFacultyByEmail(email);
            if (matches.length > 1) {
                console.error('[MFO] ambiguous faculty email', email, matches.map((r) => r.id));
                throw new Error('More than one faculty profile matches this account email. MFO cannot safely choose a profile.');
            }
            row = matches[0] || null;
        }

        if (!row) {
            throw new Error(
                'No public.faculty row matches this account (checked auth_user_id, email, and existing_email). '
                + 'MFO cannot be filed from an admin-only account.'
            );
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
        // Match wf_task_requires_chairperson(): an unlinked task follows the
        // database default and enters final approval.
        if (!config) return { requires_chairperson_review: false };
        if (config.requires_chairperson_review === false) return config;
        return Object.assign({}, config, { requires_chairperson_review: true });
    }

    function requiresChairpersonReview() {
        return mfoApprovalConfig().requires_chairperson_review !== false;
    }

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
            if (recordId) {
                return String(file.mfo_record_id || '') === String(recordId)
                    || String(file.mfo_documentation_id || '') === String(recordId);
            }
            return file.mfo_section === code && !file.mfo_record_id && !file.mfo_documentation_id;
        });
    }

    function uniquePhotosForRecord(sectionCode, recordId) {
        const photos = [];
        filesFor(sectionCode, recordId)
            .concat((state.files || []).filter((file) => (
                String(file.mfo_documentation_id || '') === String(recordId || '')
                || String(file.mfo_record_id || '') === String(recordId || '')
            )))
            .forEach((file) => {
                if (!fileIsImage(file)) return;
                if (photos.some((item) => String(item.id) === String(file.id)
                    || (file.file_url && String(item.file_url || '') === String(file.file_url || '')))) {
                    return;
                }
                photos.push(file);
            });
        return photos;
    }

    function fileDisplaySrc(file) {
        return String(file?.display_url || file?.file_url || '').trim();
    }

    /**
     * wf-submissions is private. Editor thumbs must use a signed URL from
     * storage_path, not the public file_url (that 404s after refresh).
     * Accomplishment photos that only have a public faculty-accomplishments
     * URL still use file_url.
     */
    async function resolveFileDisplayUrl(file) {
        if (!file) return '';
        const path = String(file.storage_path || file.file_path || '').trim();
        if (path) {
            try {
                const signed = await db().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
                if (signed.data?.signedUrl) {
                    file.display_url = signed.data.signedUrl;
                    return file.display_url;
                }
                if (signed.error) console.warn('[MFO] sign photo', signed.error);
            } catch (error) {
                console.warn('[MFO] sign photo', error);
            }
        }
        const fallback = String(file.file_url || '').trim();
        if (fallback) {
            file.display_url = fallback;
            return fallback;
        }
        return String(file.display_url || '');
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Could not read the image.'));
            reader.readAsDataURL(blob);
        });
    }

    async function urlToDataUrl(url) {
        const src = String(url || '').trim();
        if (!src || src.startsWith('data:')) return src;
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Could not read image (${response.status}).`);
        const dataUrl = await blobToDataUrl(await response.blob());
        if (!/^data:image\//i.test(dataUrl)) throw new Error('That file is not a readable image.');
        return dataUrl;
    }

    async function hydrateFileDisplayUrls(files) {
        await Promise.all((files || []).map((file) => resolveFileDisplayUrl(file)));
    }

    async function hydrateEditorPhotoNodes() {
        const nodes = Array.from(document.querySelectorAll('#mfoApp img[data-storage-path]'));
        if (!nodes.length) return;
        await Promise.all(nodes.map(async (img) => {
            const path = String(img.getAttribute('data-storage-path') || '').trim();
            if (path) {
                try {
                    const signed = await db().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
                    if (signed.data?.signedUrl) {
                        img.src = signed.data.signedUrl;
                        const parent = img.closest('a[href]');
                        if (parent && (!parent.getAttribute('href') || parent.getAttribute('href') === '#')) {
                            parent.href = signed.data.signedUrl;
                        }
                        return;
                    }
                } catch (_) {}
            }
            const fallback = String(img.getAttribute('data-file-url') || '').trim();
            if (fallback) img.src = fallback;
        }));
    }

    function photoThumb(file, extraClass) {
        const src = fileDisplaySrc(file);
        const path = String(file.storage_path || file.file_path || '').trim();
        return `
            <a href="${esc(src || '#')}" target="_blank" rel="noopener" class="${extraClass || 'mfo-photo-thumb'}" title="${esc(file.file_name || '')}">
                <img src="${esc(src)}"
                     alt="${esc(file.file_name || 'Documentation photo')}"
                     loading="lazy"
                     data-storage-path="${esc(path)}"
                     data-file-url="${esc(file.file_url || '')}">
            </a>
        `;
    }

    /**
     * Shown when the editing context could not be built.
     *
     * This replaced a fallback that rendered the full editor with a null
     * packet. That looked like a working report, so the first Save died with
     * "Cannot read properties of null (reading 'id')" — a symptom that hid the
     * real database error and invited someone to add a null check instead of
     * fixing the cause. The report must not appear usable when it has no
     * database record, so the failure, its stage, and the database's own
     * message/code/details/hint are put on screen instead.
     */
    function renderInitFailure() {
        const root = document.getElementById('mfoApp');
        if (!root) return;
        const failure = state.initFailure || {};
        const error = failure.error || {};
        const auth = failure.auth || {};
        const rows = [
            ['Failed at', failure.stage || 'unknown stage'],
            ['Message', error.message || '(no message)'],
            ['Code', error.code || '—'],
            ['Details', error.details || '—'],
            ['Hint', error.hint || '—'],
            ['HTTP status', error.status != null ? String(error.status) : '—'],
            ['Signed in', auth.hasUser ? `yes (${auth.authUserId || 'unknown id'})` : 'no'],
            ['JWT present', auth.jwtPresent ? 'yes' : 'no'],
            ['Faculty id resolved', auth.facultyId != null ? String(auth.facultyId) : 'not resolved'],
            ['Recorded at', failure.at || '—']
        ];
        root.innerHTML = `
            <div class="mb-4">
                <a href="submissions.html" class="text-sm font-bold text-[#621708]">← Back to Submissions</a>
                <div class="cite-kicker mt-3">MFO Report</div>
                <h1 class="cite-title">The MFO report could not be opened</h1>
            </div>
            <section class="surface rounded-[16px] p-5 mb-4 border border-rose-200">
                <p class="text-sm text-slate-700 mb-3">
                    Your MFO report has no database record yet, so the editor was not opened.
                    Nothing has been lost and nothing was saved. This is the database's own
                    response for the first operation that failed.
                </p>
                <table class="w-full text-sm">
                    <tbody>
                        ${rows.map(([label, value]) => `
                            <tr class="align-top border-t border-slate-100">
                                <th class="text-left font-bold text-slate-500 py-2 pr-4 w-44">${esc(label)}</th>
                                <td class="py-2 font-mono text-[12px] text-slate-900 break-words">${esc(value)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="flex flex-col sm:flex-row gap-2 mt-4">
                    <button type="button" class="cite-action-primary" onclick="window.location.reload()">Retry</button>
                    <button type="button" class="cite-action" onclick="window.location.href='submissions.html'">Back to Submissions</button>
                </div>
                <p class="text-xs text-slate-500 mt-3">
                    The same detail is in the browser console under
                    “MFO Init Trace — ORIGINAL initialization failure”.
                </p>
            </section>`;
    }

    async function init() {
        const root = document.getElementById('mfoApp');
        const requestedTaskId = new URLSearchParams(window.location.search).get('task');
        console.info('[AUTH TRACE] MFO PAGE LOAD', {
            href: window.location.href,
            taskId: requestedTaskId || null,
            authGuardState: global.CiteFlowAuthGuard?.state || null,
            hasGuardSession: !!global.CiteFlowAuthGuard?.session
        });
        let initStage = 'start';
        try {
            initStage = 'create-client';
            state.db = db();
            if (!state.db) throw new Error('Database client is not available.');

            initStage = 'auth-guard-ready';
            if (global.CiteFlowAuthGuard?.ready) {
                await global.CiteFlowAuthGuard.ready;
            }

            initStage = 'ensure-auth-session';
            const session = await requireLiveSession();
            console.info('[MFO Init Trace] ensureAuthSession response', {
                hasSession: !!session,
                hasUser: !!session?.user,
                authUid: session?.user?.id || null,
                hasAccessToken: !!session?.access_token,
                expiresAt: session?.expires_at || null
            });
            if (!(session?.user?.id && session?.access_token)) {
                throw new Error('Your session expired. Please sign in again.');
            }
            initStage = 'load-sidebar';
            const sidebarPromise = typeof global.loadSidebar === 'function'
                ? Promise.resolve().then(() => global.loadSidebar()).catch((error) => {
                    console.error('[MFO] Sidebar failed to load', error);
                })
                : Promise.resolve();
            initStage = 'link-faculty-auth';
            await linkFacultyAuthIfSafe();
            void sidebarPromise;

            // Reviewer route: same renderer, read-only, reading the author's
            // packet instead of the signed-in user's. Access is decided by
            // mfo_can_select_packet / wf_submissions RLS, not here.
            const params = new URLSearchParams(window.location.search);
            if (params.get('view') === 'review' && params.get('submission')) {
                await initReviewerMode(params.get('submission'));
                return;
            }

            initStage = 'resolve-faculty';
            state.faculty = await resolveMfoFaculty(state.user);
            console.info('[MFO Init Trace] resolveMfoFaculty success', {
                authUid: state.user?.id || null,
                facultyId: state.faculty?.id || null,
                facultyAuthUserId: state.faculty?.auth_user_id || null,
                facultyEmail: state.faculty?.email || null
            });

            initStage = 'resolve-context';
            await resolveContext();
            initStage = 'ensure-packet';
            await ensurePacket();
            console.info('[MFO Init Trace] ensurePacket success', {
                facultyId: state.faculty?.id || null,
                taskId: state.task?.id || null,
                packetId: state.packet?.id || null,
                submissionId: state.submission?.id || null
            });
            initStage = 'load-packet-data';
            await loadPacketData();
            initStage = 'suggest-from-system';
            await suggestFromSystem();
            initStage = 'render';
            state.locked = computeLocked();
            render();
        } catch (error) {
            let auth = null;
            try { auth = await authSnapshot(); } catch (_) {}
            console.error('[MFO Init Trace] ORIGINAL initialization failure', {
                stage: initStage,
                error: mfoDiagnosticError(error),
                stack: error?.stack || null,
                auth,
                facultyId: state.faculty?.id || null,
                taskId: state.task?.id || null,
                packetId: state.packet?.id || null,
                submissionId: state.submission?.id || null
            }, error);
            if (root) {
                state.initFailure = {
                    stage: initStage,
                    error: mfoDiagnosticError(error),
                    auth,
                    at: new Date().toISOString()
                };
                render();
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

        let sub = await client.from('wf_submissions').select('*').eq('id', submissionId).maybeSingle();
        if (sub.error) throw sub.error;
        if (!sub.data) {
            const listed = await client.rpc('wf_list_chairperson_submissions');
            if (listed.error) throw listed.error;
            sub = {
                data: (listed.data || []).find((row) => String(row.id) === String(submissionId)) || null,
                error: null
            };
        }
        if (!sub.data) throw new Error('This submission is not available to your account.');
        state.submission = sub.data;

        let packet = await client.from('mfo_packets').select('*')
            .eq('submission_id', submissionId).maybeSingle();
        if (packet.error) throw packet.error;
        if (!packet.data && state.submission.task_id && state.submission.faculty_id) {
            packet = await client.from('mfo_packets').select('*')
                .eq('task_id', state.submission.task_id)
                .eq('faculty_id', state.submission.faculty_id)
                .maybeSingle();
            if (packet.error) throw packet.error;
        }
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
        // The report still belongs to the author. Resolve the signed-in
        // reviewer separately so Approve / Revision / Decline can name the
        // Chairperson without rewriting "Submitted by".
        try {
            state.reviewerActor = await resolveMfoFaculty(state.user);
        } catch (_) {
            state.reviewerActor = null;
        }
        // Locked so no editor control can ever write through this route.
        state.locked = true;
        state.previewOpen = true;
        render();
    }

    function reviewerCanAct() {
        if (!state.reviewerMode || !state.submission || !state.reviewerActor) return false;
        const helper = global.CiteFlowWorkflow;
        if (helper?.isPendingChairpersonReview) {
            return helper.isPendingChairpersonReview(state.submission, state.config, state.task);
        }
        const status = String(state.submission.status || '').toLowerCase();
        const stage = String(state.submission.approval_stage || '').toLowerCase();
        return ['submitted', 'late', 'underreview'].includes(status) && stage === 'chairperson';
    }

    async function reviewerAction(action) {
        if (!reviewerCanAct() || !global.CiteFlowWorkflow?.applySubmissionReview) return;
        let comment = '';
        if (action === 'revision' || action === 'rejected') {
            comment = String(window.prompt(action === 'revision'
                ? 'Remarks for revision (required):'
                : 'Reason for decline (required):') || '').trim();
            if (!comment) {
                toast('Remarks are required.', 'error');
                return;
            }
        } else if (!window.confirm('Approve this MFO and send it to Admin final approval?')) {
            return;
        }
        if (!beginBusy(action === 'approved' ? 'Approving…' : action === 'revision' ? 'Sending revision…' : 'Declining…')) return;
        try {
            const result = await global.CiteFlowWorkflow.applySubmissionReview(db(), {
                submissionId: state.submission.id,
                submission: state.submission,
                action,
                comment,
                actorFaculty: state.reviewerActor,
                actorUser: state.user,
                targetFaculty: state.faculty,
                task: state.task,
                config: state.config,
                delegatedAccess: []
            });
            if (!result.ok) throw new Error(result.error || 'Review action failed.');
            toast(action === 'approved'
                ? 'Chairperson approval recorded. Admin will handle final approval.'
                : action === 'revision'
                    ? 'Revision requested. Faculty must revise and resubmit.'
                    : 'Submission declined. Faculty and Admin can still see this decision.',
                action === 'rejected' ? 'error' : action === 'revision' ? 'warn' : 'success');
            window.location.href = 'submissions.html#chair-review';
        } catch (error) {
            toast(friendlyError(error, 'Unable to record the review decision.'), 'error');
        } finally {
            endBusy();
        }
    }

    async function resolveContext() {
        const client = db();
        const facultyId = state.faculty.id;
        const params = new URLSearchParams(window.location.search);
        const requestedTaskId = params.get('task');
        const hasRequestedTask = Boolean(requestedTaskId);

        console.info('[MFO Init Trace] resolveContext start', {
            facultyId,
            requestedTaskId: requestedTaskId || null
        });
        const [configs, assigned, catalog] = await Promise.all([
            client.from('wf_report_configs').select('*'),
            global.CiteFlowWorkflow.loadFacultyAssignedTasks(facultyId),
            client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true })
        ]);
        logMfoDiagnostic('wf_report_configs select', configs, { facultyId });
        logMfoDiagnostic('loadFacultyAssignedTasks', assigned, { facultyId });
        logMfoDiagnostic('mfo_section_catalog select', catalog, { facultyId });
        if (assigned.error) console.warn('[MFO] assigned tasks', assigned.error);
        if (catalog.error) console.warn('[MFO] section catalog', catalog.error);
        state.catalog = catalog.data || [];
        TABLES.forEach((def) => {
            const row = state.catalog.find((item) => item.section_code === def.code);
            if (row?.title) def.title = catalogTitle(def.code, def.title);
        });

        state.configs = configs.data || [];
        const mfoConfigs = state.configs.filter((row) => isMfoSource(row));
        const tasks = assigned.tasks || [];
        let task = null;
        if (requestedTaskId) {
            task = tasks.find((row) => String(row.id) === String(requestedTaskId)) || null;
            if (!task) {
                const fetched = await client.from('wf_tasks').select('*').eq('id', requestedTaskId).maybeSingle();
                logMfoDiagnostic('requested wf_tasks select', fetched, { facultyId, requestedTaskId });
                const fetchedIsMfo = fetched.data && (
                    isMfoSource(fetched.data)
                    || mfoConfigs.some((cfg) => String(cfg.id) === String(fetched.data.report_config_id))
                );
                if (fetchedIsMfo) task = fetched.data;
            }
        }
        if (!task) {
            if (hasRequestedTask) {
                throw new Error(`The requested MFO task is not available: ${requestedTaskId}`);
            }
            const mfoTasks = tasks.filter((row) => {
                if (isMfoSource(row)) return true;
                return mfoConfigs.some((cfg) => String(cfg.id) === String(row.report_config_id));
            });
            mfoTasks.sort((a, b) => new Date(b.created_at || b.due_at || 0) - new Date(a.created_at || a.due_at || 0));
            task = mfoTasks[0] || null;
        }

        console.info('[MFO Init Trace] task resolution', {
            facultyId,
            requestedTaskId: requestedTaskId || null,
            resolvedTaskId: task?.id || null,
            assignedTaskCount: tasks.length,
            mfoConfigCount: mfoConfigs.length
        });

        if (task) {
            state.task = task;
            state.config = state.configs.find((cfg) => String(cfg.id) === String(task.report_config_id)) || mfoConfigs[0] || null;
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
        logMfoDiagnostic('mfo_packets select existing faculty rows', existingPackets, {
            facultyId,
            taskId: state.task?.id || null,
            period: state.period
        });
        if (existingPackets.error) console.warn('[MFO] packet list', existingPackets.error);
        const mine = existingPackets.data || [];
        const byRequestedTask = state.task
            ? mine.find((row) => String(row.task_id) === String(state.task.id))
            : null;
        const byPeriod = hasRequestedTask
            ? null
            : mine.find((row) => periodsMatch(row, state.period));
        const resume = byRequestedTask || byPeriod || null;
        console.info('[MFO Init Trace] existing packet resolution', {
            facultyId,
            taskId: state.task?.id || null,
            foundByRequestedTask: !!byRequestedTask,
            foundByPeriod: !!byPeriod,
            existingPacketId: resume?.id || null
        });
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

        state.configError = '';
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

        console.info('[MFO Init Trace] createFallbackTask start', {
            facultyId: faculty?.id || null,
            taskId: state.task?.id || null,
            period
        });

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
        logMfoDiagnostic('wf_tasks fallback insert', result, { facultyId: faculty.id });
        if (result.error) {
            const slim = {
                title: row.title,
                instructions: row.instructions,
                due_at: dueAt,
                created_by_name: faculty.full_name
            };
            result = await client.from('wf_tasks').insert(slim).select('*').single();
            logMfoDiagnostic('wf_tasks fallback slim insert', result, { facultyId: faculty.id });
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
        logMfoDiagnostic('wf_task_assignments fallback insert', assignment, {
            facultyId: faculty.id,
            taskId: state.task?.id || null
        });
        if (assignment.error && !/duplicate|unique/i.test(assignment.error.message || '')) {
            await client.from('wf_task_assignments').insert({
                task_id: state.task.id,
                faculty_id: faculty.id
            });
        }
        return true;
    }

    /**
     * True only when the database really does not expose the function.
     *
     * The previous test included the bare word "function", which also matches
     * "permission denied for function mfo_ensure_faculty_packet". A genuine
     * EXECUTE denial was therefore read as "the RPC is not deployed" and the
     * page silently switched to a direct insert, hiding an authorization
     * problem behind a different code path. Only the not-found shapes count.
     */
    function isMissingRpcError(error) {
        if (!error) return false;
        const message = String(error.message || '');
        const code = String(error.code || '');
        if (code === 'PGRST202' || code === '42883') return true;
        if (/permission denied/i.test(message)) return false;
        return /could not find the function|no matches were found in the schema cache|does not exist/i.test(message);
    }

    /**
     * The exact reason packet creation failed, in a form worth showing.
     * Supabase returns these four fields separately, and the hint frequently
     * carries the actionable part.
     */
    function describePacketFailure(error) {
        const parts = [String(error?.message || 'unknown error')];
        if (error?.code) parts.push(`code ${error.code}`);
        if (error?.details) parts.push(`details: ${error.details}`);
        if (error?.hint) parts.push(`hint: ${error.hint}`);
        return parts.join(' · ');
    }

    async function ensurePacket() {
        const client = db();
        const faculty = state.faculty;
        const facultyId = Number(faculty.id);
        const task = state.task;
        const period = state.period;

        console.info('[MFO Init Trace] ensurePacket start', {
            facultyId,
            taskId: task?.id || null,
            existingPacketId: state.packet?.id || null,
            existingSubmissionId: state.submission?.id || null,
            period
        });

        // Use the session recovered by the shared auth client immediately
        // before the packet RPC. Do not replace it with a second raw read,
        // which can briefly be empty while Supabase completes a refresh.
        const session = await requireLiveSession();
        state.session = session;
        if (!session?.user?.id || !session?.access_token) {
            throw new Error('Your session expired. Please sign in again.');
        }
        console.info('[MFO] shared RPC auth state', {
            sessionExists: true,
            authUid: session.user.id,
            sameClient: client === db()
        });

        if (task?.id) {
            const existingSub = await client
                .from('wf_submissions')
                .select('*')
                .eq('task_id', task.id)
                .eq('faculty_id', facultyId)
                .maybeSingle();
            logMfoDiagnostic('wf_submissions select existing draft', existingSub, { facultyId, taskId: task.id });
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
            logMfoDiagnostic('mfo_packets select by task', byTask, { facultyId, taskId: task.id });
            if (byTask.error && !/no rows|PGRST116/i.test(byTask.error.message || '')) {
                throw byTask.error;
            }
            state.packet = byTask.data || null;
        }

        if (!state.packet) {
            const listed = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
            logMfoDiagnostic('mfo_packets select before ensure', listed, { facultyId });
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

            console.info('[MFO] packet RPC auth state', {
                hasSession: !!session,
                hasUser: !!session?.user,
                jwtPresent: !!session?.access_token,
                authUserId: session?.user?.id || null,
                expiresAt: session?.expires_at || null,
                facultyId,
                mfoEnsureFacultyPacketCalled: false
            });
            if (!session?.user?.id || !session?.access_token) {
                throw new Error('Your session expired. Please sign in again.');
            }
            console.info('[MFO] mfo_ensure_faculty_packet called', {
                sessionExists: !!session,
                authUid: session.user.id
            });
            let created = await client.rpc('mfo_ensure_faculty_packet', rpcPayload);
            logMfoDiagnostic('mfo_ensure_faculty_packet RPC', created, {
                facultyId,
                taskId: task?.id || null,
                packetIdBeforeCall: state.packet?.id || null,
                hasAuthenticatedSession: !!session?.user?.id && !!session?.access_token,
                authUid: session?.user?.id || null,
                rpcPayload
            });
            if (isMissingRpcError(created.error)) {
                console.warn('[MFO] mfo_ensure_faculty_packet is not deployed — falling back to an owned mfo_packets insert.', mfoDiagnosticError(created.error));
                created = null;
            } else if (created.error) {
                // Logged in full, then rethrown untouched: this is the real
                // reason the report could not be opened and the page now shows
                // it instead of a null dereference later on.
                console.error('[MFO] mfo_ensure_faculty_packet failed', {
                    request: 'rpc/mfo_ensure_faculty_packet',
                    payload: rpcPayload,
                    error: mfoDiagnosticError(created.error),
                    authUid: session?.user?.id || null
                });
                try {
                    const debug = await client.rpc('mfo_debug_ownership', { p_faculty_id: facultyId });
                    console.error('[MFO] ownership debug', debug.data || debug.error);
                } catch (debugErr) {
                    console.warn('[MFO] ownership debug unavailable', debugErr);
                }
                throw new Error(`The MFO report could not be created: ${describePacketFailure(created.error)}`);
            } else if (created.data) {
                state.packet = Array.isArray(created.data) ? created.data[0] : created.data;
            } else {
                console.error('[MFO] mfo_ensure_faculty_packet returned no row and no error', {
                    request: 'rpc/mfo_ensure_faculty_packet',
                    payload: rpcPayload
                });
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
                logMfoDiagnostic('mfo_packets direct insert fallback', direct, {
                    facultyId,
                    taskId: task?.id || null,
                    insert
                });
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
                    logMfoDiagnostic('mfo_packets direct slim insert fallback', direct, {
                        facultyId,
                        taskId: task?.id || null,
                        insert: slim
                    });
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
            logMfoDiagnostic('mfo_packets link task update', linked, {
                facultyId,
                packetId: state.packet.id,
                taskId: task.id
            });
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
            logMfoDiagnostic('wf_submissions draft upsert', saved, {
                facultyId,
                taskId: task.id,
                packetId: state.packet?.id || null,
                draft
            });
            if (saved.error) {
                console.warn('[MFO] draft submission', saved.error);
            } else {
                state.submission = saved.data;
                if (state.packet && !state.packet.submission_id) {
                    const linked = await client.from('mfo_packets').update({ submission_id: saved.data.id }).eq('id', state.packet.id).eq('faculty_id', facultyId).select('*').maybeSingle();
                    logMfoDiagnostic('mfo_packets link submission update', linked, {
                        facultyId,
                        packetId: state.packet.id,
                        submissionId: saved.data.id
                    });
                    state.packet.submission_id = saved.data.id;
                }
            }
        }

        // Guarantee the invariant the rest of the module relies on. Reaching
        // here without a packet used to be possible (RPC returned no row, or
        // the direct insert reported a duplicate that the re-read could not
        // find), and the failure only surfaced later as a null dereference in
        // saveTable()/updatePacket().
        if (!state.packet?.id) {
            throw new Error(
                'The MFO report record could not be created or found for this faculty account, so the editor was not opened. '
                + 'Nothing was saved.'
            );
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
                (def.fields || []).forEach((field) => {
                    if (field.type === 'checkbox') copy[field.key] = !!copy[field.key];
                });
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
                .or(`mfo_packet_id.eq.${packetId},submission_id.eq.${state.packet.submission_id}`)
                .order('mfo_sort_order', { ascending: true, nullsFirst: false })
                .order('created_at', { ascending: true, nullsFirst: false })
                .order('id', { ascending: true });
        } else {
            files = await client
                .from('wf_submission_files')
                .select('*')
                .eq('mfo_packet_id', packetId)
                .order('mfo_sort_order', { ascending: true, nullsFirst: false })
                .order('created_at', { ascending: true, nullsFirst: false })
                .order('id', { ascending: true });
        }
        if (files.error) console.warn('[MFO] evidence files', files.error);

        // Older evidence rows may have been linked only to the documentation
        // or source record, without carrying the packet/submission id. Read
        // those existing rows as well; this does not widen access because all
        // queries still run through the authenticated RLS policies.
        const linkedIds = [
            ...(state.rows.mfo_documentation_items || []).map((row) => row.id),
            ...TABLES
                .filter((def) => def.table !== 'mfo_documentation_items')
                .flatMap((def) => (state.rows[def.table] || []).map((row) => row.id))
        ].filter((id) => isUuid(id));
        const linkedEvidence = [];
        const documentationIds = (state.rows.mfo_documentation_items || [])
            .map((row) => row.id)
            .filter((id) => isUuid(id));
        const linkedQueries = [];
        if (documentationIds.length) {
            linkedQueries.push(
                client.from('wf_submission_files').select('*')
                    .in('mfo_documentation_id', documentationIds)
            );
        }
        if (linkedIds.length) {
            linkedQueries.push(
                client.from('wf_submission_files').select('*')
                    .in('mfo_record_id', linkedIds)
            );
        }
        const linkedResults = await Promise.all(linkedQueries);
        linkedResults.forEach((result) => {
            if (result.error) console.warn('[MFO] linked evidence files', result.error);
            linkedEvidence.push(...(result.data || []));
        });
        const uniqueFiles = new Map();
        [...(files.data || []), ...linkedEvidence].forEach((file) => {
            const key = String(file.id || `${file.storage_path || file.file_path || ''}:${file.file_name || ''}`);
            if (key) uniqueFiles.set(key, file);
        });
        state.files = [...uniqueFiles.values()];
        await hydrateFileDisplayUrls(state.files);
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
            if (def.table === 'mfo_documentation_items') return;
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

        const docDef = TABLES.find((item) => item.table === 'mfo_documentation_items');
        const docCandidates = Object.values(candidates || {})
            .flat()
            .filter((item) => item && item.table === 'mfo_documentation_items');
        if (docDef && docCandidates.length && !state.sectionStatus[docDef.code]?.is_not_applicable) {
            try {
                const result = api.mergeCandidates(state.rows.mfo_documentation_items || [], docCandidates, {
                    newRow: () => Object.assign(emptyRow(docDef), { faculty_id: state.faculty.id }),
                    refreshSystemValues: true
                });
                state.rows.mfo_documentation_items = result.rows;
                added += result.added;
                filled += result.filled;
            } catch (error) {
                console.warn('[MFO] merge failed for mfo_documentation_items', error);
            }
        }

        state.sourceAccomplishments = loaded.rows.faculty_accomplishments || [];
        linkDocumentationToMappedRows();
        attachReferencedAccomplishmentPhotos(loaded);
        state.autoSummary = { added, filled };
    }

    function linkDocumentationToMappedRows() {
        (state.rows.mfo_documentation_items || []).forEach((doc) => {
            if (textValue(doc.source_table) !== 'faculty_accomplishments' || !doc.source_id) return;
            const table = textValue(doc.record_table);
            if (!table || !state.rows[table]) return;
            const match = state.rows[table].find((row) => (
                textValue(row.source_table) === 'faculty_accomplishments'
                && String(row.source_id) === String(doc.source_id)
            ));
            if (match && isUuid(match.id)) doc.record_id = match.id;
        });
    }

    function fileAlreadyLinked(fileUrl, docId) {
        return (state.files || []).some((file) => (
            String(file.file_url || '') === String(fileUrl || '')
            && (
                String(file.mfo_documentation_id || '') === String(docId || '')
                || String(file.mfo_record_id || '') === String(docId || '')
            )
        ));
    }

    /**
     * Point MFO documentation at the original faculty-accomplishments public
     * URLs. The file is not copied into wf-submissions.
     */
    function attachReferencedAccomplishmentPhotos(loaded) {
        const api = sourcesApi();
        if (!api?.accomplishmentPhotos) return;
        const byId = new Map(
            (loaded?.rows?.faculty_accomplishments || []).map((row) => [String(row.id), row])
        );
        state.files = state.files || [];
        (state.rows.mfo_documentation_items || []).forEach((doc) => {
            if (textValue(doc.source_table) !== 'faculty_accomplishments' || !doc.source_id) return;
            const source = byId.get(String(doc.source_id));
            if (!source) return;
            api.accomplishmentPhotos(source).forEach((ref) => {
                if (fileAlreadyLinked(ref.file_url, doc.id)) return;
                state.files.push({
                    id: `ref-${ref.source_ref}`,
                    file_url: ref.file_url,
                    file_name: ref.file_name,
                    mfo_caption: ref.mfo_caption || '',
                    mfo_section: doc.section_code,
                    mfo_record_id: doc.id,
                    mfo_documentation_id: isUuid(doc.id) ? doc.id : null,
                    mfo_packet_id: state.packet?.id || null,
                    storage_path: '',
                    file_path: '',
                    referenced_from: 'faculty_accomplishments',
                    source_ref: ref.source_ref
                });
            });
        });
    }

    function textValue(value) {
        return String(value || '').trim();
    }

    async function persistReferencedEvidence() {
        if (state.locked) return;
        const api = sourcesApi();
        if (!api?.accomplishmentPhotos) return;
        if (!state.submission?.id) await ensurePacket();
        if (!state.submission?.id) return;

        const byId = new Map(
            (state.sourceAccomplishments || []).map((row) => [String(row.id), row])
        );

        for (const doc of (state.rows.mfo_documentation_items || [])) {
            if (!isUuid(doc.id) || textValue(doc.source_table) !== 'faculty_accomplishments') continue;
            const source = byId.get(String(doc.source_id));
            if (!source) continue;
            for (const ref of api.accomplishmentPhotos(source)) {
                if (fileAlreadyLinked(ref.file_url, doc.id)) continue;
                try {
                    await insertEvidenceFile({
                        submission_id: state.submission.id,
                        file_name: ref.file_name,
                        file_url: ref.file_url,
                        storage_path: '',
                        file_path: '',
                        mfo_section: doc.section_code,
                        mfo_record_id: doc.id,
                        mfo_documentation_id: doc.id,
                        mfo_packet_id: state.packet?.id || null,
                        mfo_caption: ref.mfo_caption || null
                    });
                } catch (error) {
                    console.warn('[MFO] referenced accomplishment photo was not linked', error);
                }
            }
        }
    }

    function updateRow(table, index, key, input) {
        const row = state.rows[table]?.[index];
        if (!row || state.locked || state.busy) return;
        row[key] = input.type === 'checkbox' ? input.checked : input.value;
        // Record that this value was typed by the user so no later automatic
        // refresh can replace it.
        sourcesApi()?.markManual(row, key);
        if (table === 'mfo_extension_trainings') {
            const preview = document.getElementById(`manhours-${index}`);
            if (preview) preview.textContent = manhoursPreview(row);
        }
        if (input.type === 'checkbox') persistCheckboxField(table);
    }

    /**
     * Checkboxes must survive refresh without waiting for Save Draft.
     * Same write path as a draft save for that table only — no extra table.
     */
    async function persistCheckboxField(table) {
        if (!state.packet?.id || state.locked || state.busy) return;
        const def = TABLES.find((item) => item.table === table);
        if (!def) return;
        try {
            await requireLiveSession();
            await saveTable(def);
            state.lastSaved = new Date().toISOString();
        } catch (error) {
            toast(friendlyError(error, 'Unable to save that change.'), 'error');
        }
    }

    function addRow(table) {
        if (state.locked || state.busy) return;
        const def = TABLES.find((item) => item.table === table);
        if (!def) return;
        state.rows[table] = state.rows[table] || [];
        state.rows[table].push(emptyRow(def));
        render();
    }

    function removeRow(table, index) {
        if (state.locked || state.busy) return;
        state.rows[table].splice(index, 1);
        render();
    }

    function setSectionNa(code, checked) {
        if (state.locked) return;
        const current = state.sectionStatus[code] || { section_code: code };
        current.is_not_applicable = !!checked;
        current.completeness = current.is_not_applicable
            ? 'not_applicable'
            : ((state.rows[TABLES.find((d) => d.code === code)?.table] || []).length ? 'draft' : 'empty');
        state.sectionStatus[code] = current;
        const y = window.scrollY;
        render();
        window.scrollTo({ top: y, behavior: 'auto' });
        persistSectionNa(code);
    }

    function updateNotes(input) {
        if (!state.packet || state.locked || state.busy) return;
        state.packet.notes = input.value;
        scheduleNotesSave();
    }

    let notesSaveTimer = null;
    function scheduleNotesSave() {
        if (notesSaveTimer) clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => {
            persistNotes().catch((error) => {
                toast(friendlyError(error, 'Unable to save additional details.'), 'error');
            });
        }, 500);
    }

    async function persistNotes() {
        if (!state.packet?.id || state.locked || state.busy) return;
        try {
            await requireLiveSession();
            await updatePacket({ notes: state.packet.notes || null });
            state.lastSaved = new Date().toISOString();
        } catch (error) {
            toast(friendlyError(error, 'Unable to save additional details.'), 'error');
        }
    }

    async function diagnoseSectionStatusInsert(code) {
        const client = db();
        const packetId = state.packet?.id || null;
        const facultyId = Number(state.faculty?.id);
        let packetLookup = { data: null, error: new Error('No packet id') };
        let ownership = null;
        try {
            if (packetId && client) {
                packetLookup = await client.from('mfo_packets').select('id, faculty_id').eq('id', packetId).maybeSingle();
                const debug = await client.rpc('mfo_debug_write_access', { p_packet_id: packetId });
                ownership = debug.data || { error: mfoDiagnosticError(debug.error) };
            }
        } catch (error) {
            ownership = ownership || { error: mfoDiagnosticError(error) };
        }

        const packetFacultyId = packetLookup.data?.faculty_id ?? null;
        const failedConditions = [];
        if (!ownership || ownership.auth_uid == null) failedConditions.push('auth.uid() is null');
        if (packetLookup.error || !packetLookup.data) failedConditions.push('mfo_packets row unavailable');
        if (packetFacultyId !== null && Number(packetFacultyId) !== facultyId) {
            failedConditions.push('packet faculty_id does not match state faculty_id');
        }
        if (ownership?.owns_packet_faculty === false) failedConditions.push('mfo_owns_faculty_id(packet.faculty_id) is false');
        if (ownership?.can_write_row === false) failedConditions.push('mfo_can_write_row(packet_id, null) is false');

        console.info('[MFO] section-status RLS diagnostic', {
            sectionCode: code,
            packetId,
            facultyId,
            packetFacultyId,
            packetFacultyMatchesFaculty: packetFacultyId !== null && Number(packetFacultyId) === facultyId,
            authUid: ownership?.auth_uid || null,
            ownsFaculty: ownership?.owns_packet_faculty ?? null,
            canWriteRow: ownership?.can_write_row ?? null,
            packetLookupError: mfoDiagnosticError(packetLookup.error),
            failedConditions
        });
    }

    function updateOfficialCell(table, index, key, input) {
        updateRow(table, index, key, input);
        if (table === 'mfo_documentation_items' && key === 'title') {
            const row = state.rows[table]?.[index];
            if (row) row.caption = row.title;
        }
    }

    function persistOfficialTable(table) {
        persistCheckboxField(table);
    }

    async function persistSectionNa(code) {
        if (!state.packet?.id || state.locked) return;
        try {
            await requireLiveSession();
            await saveOneSectionStatus(code);
        } catch (error) {
            toast(friendlyError(error, 'Unable to save the Not Applicable setting.'), 'error');
        }
    }

    function payloadFromRow(def, row, index) {
        const packetId = requirePacket().id;
        const facultyId = Number(state.faculty?.id);
        if (!Number.isFinite(facultyId)) {
            throw new Error('Unable to save MFO rows because faculty.id is not numeric.');
        }
        const payload = {
            packet_id: packetId,
            faculty_id: facultyId,
            sort_order: index,
            is_not_applicable: !!row.is_not_applicable,
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
            if (key === 'is_not_applicable') value = !!row.is_not_applicable;
            if (key === 'faculty_id') value = facultyId;
            payload[key] = value;
        });
        if (def.table === 'mfo_pi7_trainings') {
            const existingSortOrder = Number(row.sort_order);
            payload.sort_order = Number.isFinite(existingSortOrder)
                && row.sort_order !== null
                && row.sort_order !== undefined
                && row.sort_order !== ''
                ? existingSortOrder
                : index;
        }
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
        'source_kind', 'source_table', 'source_id',
        'notes'
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

    async function logBrowserRequestAuth(operation, client, payload) {
        let session = null;
        let sessionError = null;
        try {
            const result = await client.auth.getSession();
            session = result?.data?.session || null;
            sessionError = result?.error || null;
        } catch (error) {
            sessionError = error;
        }
        const authorization = client?.rest?.headers?.get?.('Authorization') || '';
        console.info(`[MFO REQUEST TRACE] ${operation}`, {
            clientIsShared: client === db(),
            clientIsWindowShared: client === global.supabaseClient,
            authGuardState: global.CiteFlowAuthGuard?.state || null,
            guardUserId: global.CiteFlowAuthGuard?.user?.id || null,
            sessionExists: !!session,
            sessionUserId: session?.user?.id || null,
            sessionAccessTokenExists: !!session?.access_token,
            sessionError: sessionError ? mfoDiagnosticError(sessionError) : null,
            authorizationHeaderExists: Boolean(authorization),
            authorizationHeaderIsBearer: /^Bearer\s+\S+$/i.test(authorization),
            payload: {
                packet_id: payload?.packet_id || null,
                faculty_id: payload?.faculty_id ?? null,
                rowId: payload?.id || null
            }
        });
    }

    /** Update the packet row, dropping optional columns this deployment lacks. */
    async function updatePacket(payload) {
        const client = db();
        const packet = requirePacket();
        const run = async (data) => {
            await logBrowserRequestAuth('mfo_packets UPDATE before request', client, {
                ...data,
                packet_id: packet.id,
                faculty_id: packet.faculty_id
            });
            return client.from('mfo_packets')
                .update(data)
                .eq('id', packet.id)
                .eq('faculty_id', packet.faculty_id)
                .select('*')
                .maybeSingle();
        };

        const { data: preflightData, error: preflightError } = await client
            .from('mfo_packets')
            .select('id, faculty_id')
            .eq('id', packet.id)
            .maybeSingle();
        console.log('[MFO] update preflight', {
            localPacketId: packet.id,
            localFacultyId: packet.faculty_id,
            dbPacket: preflightData ?? null,
            preflightError: preflightError
                ? {
                    message: preflightError.message ?? null,
                    code: preflightError.code ?? null,
                    details: preflightError.details ?? null,
                    hint: preflightError.hint ?? null,
                    status: preflightError.status ?? null
                }
                : null
        });

        let result = await run(stripUnsupported(payload));
        for (let attempt = 0; attempt < OPTIONAL_COLUMNS.length && result.error; attempt += 1) {
            const column = unknownColumnFrom(result.error);
            if (!column) break;
            console.warn(`[MFO] mfo_packets has no "${column}" column; saving without it.`);
            unsupportedColumns.add(column);
            result = await run(stripUnsupported(payload));
        }
        console.log('[MFO] mfo_packets update result', {
            data: result.data ?? null,
            error: result.error
                ? {
                    message: result.error.message ?? null,
                    code: result.error.code ?? null,
                    details: result.error.details ?? null,
                    hint: result.error.hint ?? null,
                    status: result.error.status ?? null
                }
                : null,
            status: result.status ?? null,
            statusText: result.statusText ?? null
        });
        if (result.error) throw result.error;
        const updatedPacket = result.data || stripUnsupported(payload);
        state.packet = { ...state.packet, ...updatedPacket };
        return updatedPacket;
    }

    function childSelectColumns(def) {
        const cols = ['id'];
        if ((def.columns || []).includes('source_table')) cols.push('source_table');
        if ((def.columns || []).includes('source_id')) cols.push('source_id');
        return cols.join(', ');
    }

    function isMissingColumnError(error) {
        const code = String(error?.code || '');
        const message = String(error?.message || error?.details || '');
        return code === '42703' || code === 'PGRST204'
            || /column .+ does not exist|could not find the '.+' column|schema cache/i.test(message);
    }

    async function loadExistingChildRows(def, packetId) {
        const client = db();
        let existing = await client.from(def.table)
            .select(childSelectColumns(def))
            .eq('packet_id', packetId);
        if (existing.error && isMissingColumnError(existing.error)) {
            const column = unknownColumnFrom(existing.error);
            if (column) unsupportedColumns.add(column);
            console.warn(`[MFO] ${def.table} has no source columns; matching existing rows by id only.`);
            existing = await client.from(def.table).select('id').eq('packet_id', packetId);
        }
        if (existing.error) throw existing.error;
        return existing.data || [];
    }

    function existingIdForRow(row, existingRows, usedIds) {
        if (isUuid(row.id)) return row.id;
        const sourceTable = textValue(row.source_table);
        const sourceId = textValue(row.source_id);
        if (!sourceTable || !sourceId) return null;
        const match = existingRows.find((item) =>
            !usedIds.has(item.id)
            && textValue(item.source_table) === sourceTable
            && String(item.source_id) === String(row.source_id)
        );
        return match ? match.id : null;
    }

    async function saveTable(def) {
        const client = db();
        const packetId = requirePacket().id;
        const rows = state.rows[def.table] || [];
        const existingRows = await loadExistingChildRows(def, packetId);
        const keep = [];
        const usedIds = new Set();

        async function write(payload, rowId) {
            const run = async (data) => {
                await logBrowserRequestAuth(
                    rowId
                        ? 'mfo_pi7_trainings UPDATE before request'
                        : 'mfo_pi7_trainings INSERT before request',
                    client,
                    data
                );
                if (!rowId && def.table === 'mfo_pi7_trainings') {
                    const debugResult = await client.rpc(
                        'mfo_debug_write_access',
                        { p_packet_id: packetId }
                    );
                    console.info('[MFO] mfo_debug_write_access immediately before PI7 INSERT', {
                        data: debugResult.data ?? null,
                        error: debugResult.error
                            ? {
                                message: debugResult.error.message ?? null,
                                code: debugResult.error.code ?? null,
                                details: debugResult.error.details ?? null,
                                hint: debugResult.error.hint ?? null,
                                status: debugResult.error.status ?? null
                            }
                            : null,
                        auth_uid: debugResult.data?.auth_uid ?? null,
                        packet_id: debugResult.data?.packet_id ?? packetId,
                        packet_faculty_id: debugResult.data?.packet_faculty_id ?? null,
                        owns_packet_faculty: debugResult.data?.owns_packet_faculty ?? null,
                        can_write_packet: debugResult.data?.can_write_packet ?? null,
                        can_write_row: debugResult.data?.can_write_row ?? null
                    });
                }
                return rowId
                    ? client.from(def.table).update(data).eq('id', rowId).eq('packet_id', packetId).select('id').single()
                    : client.from(def.table).insert(data).select('id').single();
            };

            if (!rowId && def.table === 'mfo_pi7_trainings') {
                let packetLookup = { data: null, error: null };
                let ownership = null;
                let ownsFacultyResult = null;
                let finalApproverResult = null;
                const facultyId = Number(state.faculty?.id);
                try {
                    packetLookup = await client
                        .from('mfo_packets')
                        .select('faculty_id')
                        .eq('id', packetId)
                        .maybeSingle();
                    const [ownershipDebug, ownsFaculty, finalApprover] = await Promise.all([
                        client.rpc('mfo_debug_write_access', { p_packet_id: packetId }),
                        client.rpc('mfo_owns_faculty_id', { p_faculty_id: facultyId }),
                        client.rpc('wf_is_final_approver')
                    ]);
                    ownership = ownershipDebug.data || null;
                    ownsFacultyResult = ownsFaculty.data ?? null;
                    finalApproverResult = finalApprover.data ?? null;
                } catch (_) {}
                const packetFacultyId = packetLookup.data?.faculty_id ?? null;
                const authUid = ownership?.auth_uid || state.user?.id || null;
                console.info('[MFO] mfo_pi7_trainings insert diagnostic', {
                    packetId,
                    facultyId,
                    authUid,
                    ownsFaculty: ownsFacultyResult,
                    finalApprover: finalApproverResult,
                    canWritePacket: ownership?.can_write_packet ?? null,
                    canWriteRow: ownership?.can_write_row ?? null,
                    packetFacultyId,
                    packetFacultyMatchesFaculty: packetFacultyId !== null
                        && Number(packetFacultyId) === facultyId,
                    packetLookupError: packetLookup.error
                        ? {
                            message: packetLookup.error.message ?? null,
                            code: packetLookup.error.code ?? null,
                            details: packetLookup.error.details ?? null,
                            hint: packetLookup.error.hint ?? null,
                            status: packetLookup.error.status ?? null
                        }
                        : null
                });
            }

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
            const existingId = existingIdForRow(rows[i], existingRows, usedIds);
            if (existingId) {
                await write(payload, existingId);
                rows[i].id = existingId;
                keep.push(existingId);
                usedIds.add(existingId);
            } else {
                const saved = await write(payload, null);
                rows[i].id = saved.id;
                keep.push(saved.id);
                usedIds.add(saved.id);
            }
        }
        const extras = existingRows.map((row) => row.id).filter((id) => !keep.includes(id));
        if (extras.length) {
            const { error } = await client.from(def.table).delete().eq('packet_id', packetId).in('id', extras);
            if (error) throw error;
        }
    }

    async function saveOneSectionStatus(code, forSubmit) {
        const def = TABLES.find((item) => item.code === code);
        if (!def || !state.packet?.id) return;
        const client = db();
        const rows = state.rows[def.table] || [];
        const na = !!state.sectionStatus[def.code]?.is_not_applicable;
        const completeness = na ? 'not_applicable' : (rows.length ? (forSubmit ? 'complete' : 'draft') : 'empty');
        const payload = {
            packet_id: state.packet.id,
            section_code: def.code,
            is_not_applicable: na,
            completeness
        };
        const current = state.sectionStatus[def.code] || { section_code: def.code };
        let saved = null;
        if (current.id) {
            const updated = await client.from('mfo_section_status').update(payload).eq('id', current.id).select('*').maybeSingle();
            if (updated.error) throw updated.error;
            saved = updated.data;
        } else {
            await diagnoseSectionStatusInsert(code);
            const upserted = await client.from('mfo_section_status').upsert(payload, { onConflict: 'packet_id,section_code' }).select('*').maybeSingle();
            if (upserted.error && !/no unique|on conflict/i.test(upserted.error.message || '')) {
                await diagnoseSectionStatusInsert(code);
                const inserted = await client.from('mfo_section_status').insert(payload).select('*').maybeSingle();
                if (inserted.error) throw inserted.error;
                saved = inserted.data;
            } else if (upserted.error) {
                throw upserted.error;
            } else {
                saved = upserted.data;
            }
        }
        state.sectionStatus[def.code] = saved
            ? { ...current, ...saved, is_not_applicable: na, completeness }
            : { ...current, ...payload };
    }

    async function saveSectionStatus(forSubmit) {
        for (const def of TABLES) {
            await saveOneSectionStatus(def.code, forSubmit);
        }
    }

    async function saveDraft() {
        if (state.locked) {
            toast('This MFO is already submitted and cannot be edited until it is returned for revision.', 'error');
            return;
        }
        if (!beginBusy('Saving…')) return;
        try {
            await requireLiveSession();
            requirePacket();
            await logWriteAccess('save-draft');
            await updatePacket({
                packet_state: statusLabel() === 'Returned for Revision' ? 'revision' : 'draft',
                period_label: state.period.period_label,
                reporting_year: state.period.reporting_year,
                quarter: state.period.quarter,
                period_start: state.period.period_start,
                period_end: state.period.period_end,
                academic_year: state.period.academic_year || null,
                semester: state.period.semester || null,
                department: state.faculty.department || state.packet.department,
                notes: state.packet?.notes || null
            });
            for (const def of TABLES) await saveTable(def);
            await persistReferencedEvidence();
            await saveSectionStatus();
            state.lastSaved = new Date().toISOString();
            toast('Draft saved successfully.');
        } catch (error) {
            try {
                const snapshot = await authSnapshot();
                const debug = await db().rpc('mfo_debug_write_access', { p_packet_id: state.packet?.id || null });
                console.error('[MFO] write-access debug', { snapshot, debug: debug.data || debug.error });
            } catch (_) {}
            toast(friendlyError(error, 'Unable to save draft.'), 'error');
        } finally {
            endBusy();
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
        const packet = requirePacket();
        const version = Number(packet.current_version || 0) + 1;
        const payload = {
            header: {
                faculty_id: state.faculty.id,
                faculty_name: state.faculty.full_name,
                department: state.faculty.department,
                period: state.period,
                task_id: state.task?.id,
                submission_id: state.submission?.id
            },
            sections: {},
            files: state.files
        };
        TABLES.forEach((def) => {
            payload.sections[def.table] = state.rows[def.table] || [];
        });
        const { error } = await client.from('mfo_snapshots').insert({
            packet_id: packet.id,
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
        if (state.busy) return;
        if (!state.task?.id) {
            toast(state.taskWarning || 'Ask an administrator to create an MFO task before submitting.', 'error');
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
        if (!beginBusy('Submitting…')) return;
        try {
            await requireLiveSession();
            requirePacket();
            await logWriteAccess('submit');
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
            if (!saved.data?.id) throw new Error('The workflow submission was not created.');
            state.submission = saved.data;
            const linked = await client.from('mfo_packets').update({
                packet_state: wasRevision ? 'resubmitted' : (late ? 'late' : 'submitted'),
                submission_id: saved.data.id
            }).eq('id', state.packet.id).eq('faculty_id', state.faculty.id).select('id, submission_id').maybeSingle();
            if (linked.error) throw linked.error;
            if (!linked.data?.submission_id) {
                throw new Error('The MFO was submitted, but it was not linked to the workflow submission, so Chairperson Review cannot open it.');
            }
            state.packet.submission_id = linked.data.submission_id;
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
                const snapshot = await authSnapshot();
                const debug = await db().rpc('mfo_debug_write_access', { p_packet_id: state.packet?.id || null });
                console.error('[MFO] write-access debug', { snapshot, debug: debug.data || debug.error });
            } catch (_) {}
            toast(friendlyError(error, 'Unable to submit the MFO report.'), 'error');
        } finally {
            state.reviewOpen = false;
            endBusy();
        }
    }

    async function saveDraftInternal(forSubmit) {
        await requireLiveSession();
        requirePacket();
        await updatePacket({
            period_label: state.period.period_label,
            reporting_year: state.period.reporting_year,
            quarter: state.period.quarter,
            period_start: state.period.period_start,
            period_end: state.period.period_end,
            academic_year: state.period.academic_year || null,
            semester: state.period.semester || null,
            notes: state.packet?.notes || null
        });
        for (const def of TABLES) await saveTable(def);
        await persistReferencedEvidence();
        await saveSectionStatus(!!forSubmit);
        state.lastSaved = new Date().toISOString();
    }

    async function uploadFile(code, table, index, input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file || state.locked || state.busy) return;
        if (file.size > MAX_FILE_BYTES) {
            toast('File must be 10 MB or smaller.', 'error');
            return;
        }
        if (!ALLOWED_EXT.test(file.name)) {
            toast('Allowed files: PDF, images, Word, and Excel.', 'error');
            return;
        }
        if (!beginBusy('Uploading…')) return;
        try {
            await requireLiveSession();
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
            const packet = requirePacket();
            const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${state.faculty.id}/${state.task.id}/${packet.id}/${Date.now()}-${safeName}`;
            const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
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
                mfo_packet_id: packet.id
            };
            await insertEvidenceFileOrCleanUp(row, path);
            toast('Documentation attached.');
        } catch (error) {
            toast(friendlyError(error, 'Unable to upload the file.'), 'error');
        } finally {
            endBusy();
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
        await resolveFileDisplayUrl(result.data);
        state.files.push(result.data);
        return result.data;
    }

    async function removeFile(fileId, options) {
        if (state.locked) return;
        const nested = !!options?.nested;
        if (!nested && state.busy) return;
        const file = state.files.find((item) => String(item.id) === String(fileId));
        if (!file) return;
        if (!nested && !beginBusy('Removing file…')) return;
        try {
            if (!isUuid(file.id)) {
                state.files = state.files.filter((item) => String(item.id) !== String(fileId));
                render();
                return;
            }
            const path = file.storage_path || file.file_path;
            if (path) await db().storage.from(BUCKET).remove([path]);
            const { error } = await db().from('wf_submission_files').delete().eq('id', fileId);
            if (error) throw error;
            state.files = state.files.filter((item) => String(item.id) !== String(fileId));
        } catch (error) {
            toast(friendlyError(error, 'Unable to remove the file.'), 'error');
        } finally {
            if (!nested) {
                endBusy();
                render();
            }
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
        const disabled = (state.locked || state.busy) ? 'disabled' : '';
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
        const imageThumbs = files.filter(fileIsImage).map((file) => photoThumb(file)).join('');
        const list = files.map((file) => `
            <div class="flex items-center justify-between gap-2 text-xs bg-white border border-slate-200 rounded-xl px-3 py-2">
                <a class="font-semibold text-[#621708] truncate" href="${esc(fileDisplaySrc(file) || '#')}" target="_blank" rel="noopener">${esc(file.file_name)}</a>
                ${state.locked || state.busy ? '' : `<button type="button" class="text-rose-600 font-bold" onclick="CiteFlowMfoFaculty.removeFile('${file.id}')">Remove</button>`}
            </div>
        `).join('');
        return `
            <div class="mt-3 space-y-2">
                <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">File attachments</div>
                ${imageThumbs ? `<div class="mfo-photo-grid">${imageThumbs}</div>` : ''}
                ${list || '<div class="text-xs text-slate-400">No files attached to this record yet.</div>'}
                ${state.locked || state.busy ? '' : `
                    <button type="button" class="cite-action" onclick="this.nextElementSibling.click()">+ Add File</button>
                    <input type="file" class="mfo-file-input" onchange="CiteFlowMfoFaculty.uploadFile('${code}', '${table}', ${index}, this)">
                `}
            </div>
        `;
    }

    function openPhotoModal(sectionCode, docIndex) {
        if (state.busy) return;
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
        if (!state.photoModal || state.locked || state.busy) return;
        const modal = state.photoModal;
        const title = String(modal.title || '').trim();
        if (!title) {
            toast('Title is required for photo documentation.', 'error');
            return;
        }
        if (!beginBusy('Saving documentation…')) return;
        try {
            await requireLiveSession();
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
            endBusy();
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
        const packet = requirePacket();
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${state.faculty.id}/${state.task.id}/${packet.id}/photos/${Date.now()}-${safeName}`;
        const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
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
            mfo_record_id: null,
            mfo_documentation_id: isUuid(recordId) ? recordId : null,
            mfo_sort_order: (state.files || []).filter(
                (item) => String(item.mfo_documentation_id || '') === String(recordId)
            ).length,
            mfo_packet_id: packet.id
        };
        await insertEvidenceFileOrCleanUp(row, path);
    }

    async function removePhotoDoc(docIndex) {
        if (state.locked || state.busy) return;
        requirePacket();
        const row = state.rows.mfo_documentation_items?.[docIndex];
        if (!row) return;
        if (!window.confirm('Remove this photo documentation entry and its photos?')) return;
        if (!beginBusy('Removing documentation…')) return;
        try {
            const recordId = isUuid(row.id) ? row.id : null;
            if (recordId) {
                // Photos added through the photo modal carry
                // mfo_documentation_id; uploads made from a record's "Add File"
                // carry mfo_record_id. Matching only one of the two left the
                // other orphaned in wf_submission_files and in Storage after
                // "Remove entry".
                const linked = state.files.filter((file) => (
                    String(file.mfo_documentation_id || '') === String(recordId)
                    || String(file.mfo_record_id || '') === String(recordId)
                ));
                for (const file of linked) {
                    await removeFile(file.id, { nested: true });
                }
            }
            state.rows.mfo_documentation_items.splice(docIndex, 1);
            const def = TABLES.find((item) => item.table === 'mfo_documentation_items');
            await saveTable(def);
            toast('Photo documentation removed.');
        } catch (error) {
            toast(friendlyError(error, 'Unable to remove photo documentation.'), 'error');
        } finally {
            endBusy();
        }
    }

    function renderPhotoDocs(sectionCode, sectionTitle) {
        const entries = docsForIndicator(sectionCode);
        const cards = entries.map(({ row, index }) => {
            const photos = uniquePhotosForRecord(sectionCode, row.id);
            const thumbs = photos.map((file) => photoThumb(file)).join('');
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
                        ${state.locked || state.busy ? '' : `
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
                    ${state.locked || state.busy ? '' : `
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
                ${photoThumb(file)}
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
                                <button type="button" class="cite-action" onclick="this.nextElementSibling.click()">+ Upload Photos</button>
                                <input type="file" accept="image/*" multiple class="mfo-file-input" onchange="CiteFlowMfoFaculty.addPhotoModalFiles(this)">
                            `}
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-2 mt-5">
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePhotoModal()">Cancel</button>
                        ${state.locked ? '' : `<button type="button" class="cite-action-primary" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.savePhotoModal()">${state.busyLabel === 'Saving documentation…' ? 'Saving…' : 'Save Documentation'}</button>`}
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
                    ${state.locked || state.busy ? '' : `<button type="button" class="text-xs font-bold text-rose-600" onclick="CiteFlowMfoFaculty.removeRow('${def.table}', ${index})">Remove</button>`}
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
            <details class="mfo-section rounded-[16px] mb-3" open>
                <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">${esc(def.group)}</div>
                        <div class="text-sm font-bold text-slate-900">${esc(def.title)}</div>
                    </div>
                    <label class="mfo-na-toggle" aria-pressed="${na ? 'true' : 'false'}"
                           onclick="event.stopPropagation();">
                        <input type="checkbox" ${na ? 'checked' : ''} ${state.locked || state.busy ? 'disabled' : ''}
                               onclick="event.stopPropagation();"
                               onchange="event.stopPropagation(); CiteFlowMfoFaculty.setSectionNa('${def.code}', this.checked)">
                        Not applicable (NA)
                    </label>
                    <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
                </summary>
                <div class="px-4 sm:px-5 pb-5">
                    ${def.hint ? `<p class="text-xs text-slate-500 mb-3">${esc(def.hint)}</p>` : ''}
                    ${na ? '<p class="text-sm text-slate-500 mb-3">Marked N/A. Existing entries are kept and still print as N/A on the official form.</p>' : ''}
                    ${isDocTable ? `
                        ${generalDocs().map(({ row, index }) => renderRecord(def, row, index)).join('') || '<p class="text-sm text-slate-500 mb-3">No general documentation records yet.</p>'}
                        ${state.locked || state.busy ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">+ ${esc(def.add)}</button>`}
                        ${renderPhotoDocs(def.code, def.title)}
                    ` : `
                        ${rowIndexes.map((index) => renderRecord(def, state.rows[def.table][index], index)).join('') || '<p class="text-sm text-slate-500 mb-3">No records yet.</p>'}
                        ${state.locked || state.busy ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">+ ${esc(def.add)}</button>`}
                        ${renderPhotoDocs(def.code, def.title)}
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
            <div class="mfo-review-overlay" onclick="if(event.target===this){CiteFlowMfoFaculty.reviewOpen(false)}">
                <div class="mfo-review-dialog" role="dialog" aria-modal="true" aria-labelledby="mfoReviewTitle">
                    <div class="mfo-review-header">
                        <div>
                            <h2 id="mfoReviewTitle" class="text-lg font-bold">Review MFO Report</h2>
                            <p class="text-sm text-slate-500 mt-1">${esc(state.period.period_label)} · ${esc(state.faculty.full_name)}</p>
                        </div>
                        <button type="button" class="mfo-review-close" aria-label="Close review" onclick="CiteFlowMfoFaculty.reviewOpen(false)">×</button>
                    </div>
                    <div class="mfo-review-body">
                        ${missing.length ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">Incomplete: ${missing.map((d) => esc(d.title)).join(', ')}. Mark NA or add records.</div>` : '<div class="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm font-semibold">All faculty sections have records or are marked NA.</div>'}
                        ${groups.join('')}
                    </div>
                    <div class="mfo-review-footer">
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewOpen(false)">Close</button>
                        <button type="button" class="cite-action-primary" ${state.busy || !state.task || missing.length ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">${state.busyLabel === 'Submitting…' ? 'Submitting…' : 'Submit MFO Report'}</button>
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
                        ['Class Section', (r) => r.section, 'section'],
                        ['No. of Students Enrolled', (r) => r.students_enrolled, 'students_enrolled'],
                        ['Name of Adviser', (r) => r.adviser_name, 'adviser_name']
                    ]
                },
                {
                    heading: 'Performance Indicator 4: List of Syllabus submitted for this semester for the entire program.',
                    table: 'mfo_pi4_syllabus',
                    code: 'mfo1_pi4',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Courses Taught', (r) => [r.subject_code, r.course_title].filter(Boolean).join(' — '), 'course_title'],
                        ['Status of Syllabus Submission (submitted/not submitted)', (r) => String(r.syllabus_status || '').replace(/_/g, ' '), 'syllabus_status'],
                        ['Remarks', (r) => r.remarks, 'remarks']
                    ]
                },
                {
                    heading: 'Performance Indicator 5: Certifications acquired from TESDA, ISO, AACCUP, and others.',
                    table: 'mfo_pi5_certifications',
                    code: 'mfo1_pi5',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Nature of Certification (accreditor/auditor/NC/TM and others)', (r) => [r.certification_title, r.certification_nature].filter(Boolean).join(' — '), 'certification_title'],
                        ['Granting Agency', (r) => r.granting_agency, 'granting_agency'],
                        ['Date Granted', (r) => reportDate(r.date_granted), 'date_granted']
                    ]
                },
                {
                    heading: 'Performance Indicator 6: List of faculty members undergoing post-graduate education.',
                    table: 'mfo_pi6_postgraduate',
                    code: 'mfo1_pi6',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Program enrolled in', (r) => r.program_enrolled, 'program_enrolled'],
                        ['Total no. of earned units as of this semester', (r) => r.earned_units, 'earned_units'],
                        ['No. of units enrolled in this semester', (r) => r.current_units, 'current_units'],
                        ['Name of Educational Institution', (r) => r.institution_name, 'institution_name']
                    ]
                },
                {
                    heading: 'Performance Indicator 7: List of trainings/workshops/seminars attended by faculty members.',
                    table: 'mfo_pi7_trainings',
                    code: 'mfo1_pi7',
                    columns: [
                        ['Name of Faculty', (r, c) => c.facultyName],
                        ['Title of Training/Workshop/Seminar', (r) => r.title, 'title'],
                        ['Date', (r) => reportDate(r.activity_date), 'activity_date'],
                        ['Venue', (r) => r.venue, 'venue'],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency, 'sponsoring_agency'],
                        ['Role (participant/resource speaker/facilitator)', (r) => r.role, 'role']
                    ]
                },
                {
                    heading: 'Performance Indicator 8: Production of instructional materials',
                    table: 'mfo_pi8_instructional_materials',
                    code: 'mfo1_pi8',
                    columns: [
                        ['Name of Faculty (Authors)', (r, c) => r.authors_text || c.facultyName, 'authors_text'],
                        ['Title of Instructional Materials (IM)', (r) => r.title, 'title'],
                        ['Type of Instructional Material (print, media, graphics, etc.)', (r) => r.material_type, 'material_type'],
                        ['Courses Utilizing the IMs', (r) => r.courses_utilizing, 'courses_utilizing'],
                        ['Nature of Intellection Property Protection (copyright/UM/industrial design/patents etc.', (r) => r.ip_nature, 'ip_nature']
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
                        ['Title of Research', (r) => r.research_title, 'research_title'],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text, 'proponents_text'],
                        ['Nature of Utilization (technology adoption/commercialization/community extension, etc.)', (r) => r.utilization_nature, 'utilization_nature'],
                        ['Name of Partner Community/Industry', (r) => r.partner_name, 'partner_name'],
                        ["Address of Partner's Office", (r) => r.partner_address, 'partner_address']
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
                        ['Title of Research', (r) => r.research_title, 'research_title'],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text, 'proponents_text'],
                        ['Date Completed', (r) => reportDate(r.completed_at), 'completed_at'],
                        ['Status', (r) => r.research_status, 'research_status'],
                        ['Funding Source', (r) => r.funding_source, 'funding_source']
                    ]
                },
                {
                    heading: 'Performance Indicator 3: Research output published in internationally refereed or CHED accredited journals within the quarter',
                    table: 'mfo_research_published',
                    code: 'mfo3_pi3',
                    columns: [
                        ['Title of Research', (r) => r.research_title, 'research_title'],
                        ['Proponent/s (Faculty or Students)', (r) => r.proponents_text, 'proponents_text'],
                        ['Name of Publication', (r) => r.publication_name, 'publication_name'],
                        ['Date Published', (r) => reportDate(r.published_at), 'published_at'],
                        ['Funding Source', (r) => r.funding_source, 'funding_source']
                    ]
                },
                {
                    heading: 'Performance Indicator 4: Research Output Presented in Research Conferences within the quarter',
                    table: 'mfo_research_presented',
                    code: 'mfo3_pi4',
                    columns: [
                        ['Title of Research', (r) => r.research_title, 'research_title'],
                        ['Title of Research Proponents', (r) => r.proponents_text, 'proponents_text'],
                        ['Date', (r) => reportDate(r.presented_at), 'presented_at'],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency, 'sponsoring_agency'],
                        ['Venue', (r) => r.venue, 'venue']
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
                        ['Title of Community Extension Project', (r) => r.project_title, 'project_title'],
                        ['Proponents', (r) => r.proponents_text, 'proponents_text'],
                        ['Partner Industry/Community (indicate if with/without MOA)', (r) => {
                            const partner = String(r.partner_name || '').trim();
                            if (!partner) return '';
                            return `${partner} (${r.has_moa ? 'with MOA' : 'without MOA'})`;
                        }, 'partner_name'],
                        ['Project Locale', (r) => r.project_locale, 'project_locale']
                    ]
                },
                {
                    heading: 'Performance Indicator 2: Number of trainees weighted by the length of training (manhours)',
                    table: 'mfo_extension_trainings',
                    code: 'mfo4_pi2',
                    columns: [
                        ['Title of Training Provided to the Community/Industry', (r) => r.training_title, 'training_title'],
                        ['No. Community Beneficiaries (separate no. of male & female)', (r) => {
                            const male = r.beneficiaries_male;
                            const female = r.beneficiaries_female;
                            const parts = [];
                            if (male !== null && male !== undefined && male !== '') parts.push(`Male: ${male}`);
                            if (female !== null && female !== undefined && female !== '') parts.push(`Female: ${female}`);
                            return parts.join(' / ');
                        }, 'beneficiaries'],
                        ['Length of Training (number of hours)', (r) => r.training_hours, 'training_hours'],
                        ['Total Manhours', (r) => manhoursPreview(r)],
                        ['Partner Agency', (r) => r.partner_agency, 'partner_agency']
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
                        ['Title of Activity', (r) => r.activity_title, 'activity_title'],
                        ['Date Conducted', (r) => reportDate(r.activity_date), 'activity_date'],
                        ['Venue', (r) => r.venue, 'venue'],
                        ['Sponsoring Agency', (r) => r.sponsoring_agency, 'sponsoring_agency'],
                        ['Students Involved', (r) => r.students_involved, 'students_involved'],
                        ['Role', (r) => r.student_role, 'student_role'],
                        ['Faculty Involved', (r) => r.faculty_involved, 'faculty_involved'],
                        ['Role', (r) => r.faculty_role, 'faculty_role']
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
                        ['Title of Award', (r) => r.award_title, 'award_title'],
                        ['Nature of Award (for excellence in research/instruction/extension, etc)', (r) => r.award_nature || r.award_type, 'award_nature'],
                        ['Granting Agency', (r) => r.granting_agency, 'granting_agency'],
                        ['Date of Awarding Ceremony', (r) => reportDate(r.awarded_at), 'awarded_at']
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
    function canEditOfficialForm() {
        return !state.locked && !state.reviewerMode && !state.printingOfficial;
    }

    function officialNaMark(code) {
        if (!code) return '';
        const na = !!state.sectionStatus[code]?.is_not_applicable;
        if (canEditOfficialForm()) {
            return ` <label class="mfo-doc-na"><input type="checkbox" ${na ? 'checked' : ''} ${state.busy ? 'disabled' : ''} onchange="CiteFlowMfoFaculty.setSectionNa('${code}', this.checked)"> N/A</label>`;
        }
        return ` <span class="mfo-doc-na">${na ? '☑' : '☐'} N/A</span>`;
    }

    function officialInputType(key) {
        if (key === 'beneficiaries' || /units|enrolled|hours|students_/.test(key)) return 'number';
        if (/(_at|_date)$/.test(key) || key === 'date_granted') return 'date';
        return 'text';
    }

    function officialRawValue(row, key) {
        const value = row?.[key];
        if (value == null || value === '') return '';
        if (/(_at|_date)$/.test(key) || key === 'date_granted') return String(value).slice(0, 10);
        return value;
    }

    function officialCell(indicator, row, rowIndex, col, ctx) {
        const get = Array.isArray(col) ? col[1] : null;
        const key = Array.isArray(col) ? col[2] : null;
        let display = '';
        try { display = get ? get(row, ctx) : ''; } catch (_) { display = ''; }
        display = tv(display);
        if (!canEditOfficialForm() || !key || indicator.programLevel) {
            return `<td>${esc(display || NA)}</td>`;
        }
        const table = indicator.table;
        const disabled = state.busy ? 'disabled' : '';
        if (key === 'beneficiaries') {
            return `<td>
                <span class="mfo-doc-pair">Male <input class="mfo-doc-cell" type="number" min="0" ${disabled} value="${esc(officialRawValue(row, 'beneficiaries_male'))}" oninput="CiteFlowMfoFaculty.updateOfficialCell('${table}', ${rowIndex}, 'beneficiaries_male', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('${table}')"></span>
                <span class="mfo-doc-pair">Female <input class="mfo-doc-cell" type="number" min="0" ${disabled} value="${esc(officialRawValue(row, 'beneficiaries_female'))}" oninput="CiteFlowMfoFaculty.updateOfficialCell('${table}', ${rowIndex}, 'beneficiaries_female', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('${table}')"></span>
            </td>`;
        }
        const type = officialInputType(key);
        const moa = key === 'partner_name' && table === 'mfo_extension_partnerships'
            ? ` <label class="mfo-doc-na"><input type="checkbox" ${row.has_moa ? 'checked' : ''} ${disabled} onchange="CiteFlowMfoFaculty.updateOfficialCell('${table}', ${rowIndex}, 'has_moa', this)"> MOA</label>`
            : '';
        return `<td><input class="mfo-doc-cell" type="${type}" ${disabled} value="${esc(officialRawValue(row, key))}" oninput="CiteFlowMfoFaculty.updateOfficialCell('${table}', ${rowIndex}, '${key}', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('${table}')">${moa}</td>`;
    }

    function formTable(indicator, ctx) {
        const labels = indicator.columns.map((col) => (Array.isArray(col) ? col[0] : col));
        const head = labels.map((label) => `<th>${esc(label)}</th>`).join('');

        const na = indicator.code ? !!state.sectionStatus[indicator.code]?.is_not_applicable : false;
        const rows = indicator.table ? (state.rows[indicator.table] || []) : [];
        const blank = `<tr>${labels.map(() => `<td>${NA}</td>`).join('')}</tr>`;
        let body;
        if (indicator.programLevel || !rows.length) {
            body = blank;
        } else {
            body = rows.map((row, rowIndex) => {
                const cells = indicator.columns.map((col) => officialCell(indicator, row, rowIndex, col, ctx)).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
        }
        const addRow = canEditOfficialForm() && indicator.table && !indicator.programLevel
            ? `<div class="mfo-doc-edit"><button type="button" onclick="CiteFlowMfoFaculty.addRow('${indicator.table}')">Add row</button></div>`
            : '';
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${addRow}`;
    }

    /**
     * Documentation entries print as blocks rather than a grid: a title, event
     * details built only from the fields that carry values, the description,
     * and the evidence actually on file. No detail line is emitted for a field
     * the faculty member left blank.
     */
    function reportTitleFromRow(row, fallback) {
        return String(
            row?.title || row?.caption || row?.research_title || row?.activity_title
            || row?.project_title || row?.award_title || row?.certification_title
            || row?.training_title || row?.course_title || fallback || ''
        ).trim();
    }

    function reportPhotoEntries() {
        const used = new Set();
        const entries = [];

        function takeImages(list) {
            const unique = [];
            (list || []).forEach((file) => {
                if (!fileIsImage(file)) return;
                const key = String(file.id || file.storage_path || file.file_path || file.file_url || '');
                if (!key || used.has(key)) return;
                used.add(key);
                unique.push(file);
            });
            return unique;
        }

        (state.rows.mfo_documentation_items || []).forEach((row, index) => {
            entries.push({
                row,
                docIndex: index,
                sectionCode: row.section_code,
                photos: takeImages(uniquePhotosForRecord(row.section_code, row.id)),
                others: filesFor(row.section_code, row.id).filter((file) => !fileIsImage(file))
            });
        });

        TABLES.forEach((def) => {
            if (def.table === 'mfo_documentation_items') return;
            (state.rows[def.table] || []).forEach((row) => {
                const photos = takeImages(filesFor(def.code, row.id));
                if (!photos.length) return;
                entries.push({
                    row: {
                        title: reportTitleFromRow(row, def.title),
                        activity_date: row.activity_date || row.date_granted || row.completed_at
                            || row.published_at || row.presented_at || row.awarded_at || '',
                        activity_time: row.activity_time || '',
                        venue: row.venue || row.project_locale || '',
                        narrative: row.narrative || row.remarks || row.description || ''
                    },
                    photos,
                    others: []
                });
            });
        });

        return entries.filter((entry) => {
            const row = entry.row || {};
            return (entry.photos || []).length
                || (entry.others || []).length
                || reportTitleFromRow(row)
                || String(row.narrative || '').trim()
                || String(row.activity_date || '').trim()
                || String(row.venue || '').trim()
                || String(row.activity_time || '').trim();
        });
    }

    function reportDocumentation(entries) {
        return entries.map((entry) => {
            const row = entry.row || entry;
            const images = entry.photos || uniquePhotosForRecord(row.section_code, row.id);
            const others = entry.others || [];
            const docIndex = Number.isInteger(entry.docIndex) ? entry.docIndex : -1;
            const canEditDoc = canEditOfficialForm() && docIndex >= 0;
            const details = canEditDoc
                ? [
                    ['Date', `<input class="mfo-doc-cell" type="date" value="${esc(String(row.activity_date || '').slice(0, 10))}" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateOfficialCell('mfo_documentation_items', ${docIndex}, 'activity_date', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('mfo_documentation_items')">`],
                    ['Time', `<input class="mfo-doc-cell" type="text" value="${esc(row.activity_time || '')}" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateOfficialCell('mfo_documentation_items', ${docIndex}, 'activity_time', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('mfo_documentation_items')">`],
                    ['Venue', `<input class="mfo-doc-cell" type="text" value="${esc(row.venue || '')}" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateOfficialCell('mfo_documentation_items', ${docIndex}, 'venue', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('mfo_documentation_items')">`]
                ]
                : [
                    ['Date', reportDate(row.activity_date)],
                    ['Time', String(row.activity_time || '').trim()],
                    ['Venue', String(row.venue || '').trim()],
                    ['Sponsoring agency', String(row.sponsoring_agency || '').trim()],
                    ['Role', String(row.role || '').trim()]
                ].filter(([, value]) => value);
            const narrative = String(row.narrative || '').trim();
            const titleBlock = canEditDoc
                ? `<input class="mfo-doc-cell mfo-doc-title-input" type="text" value="${esc(reportTitleFromRow(row))}" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateOfficialCell('mfo_documentation_items', ${docIndex}, 'title', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('mfo_documentation_items')">`
                : `<div class="t">${esc(reportTitleFromRow(row) || 'Untitled activity')}</div>`;
            const narrativeBlock = canEditDoc
                ? `<textarea class="mfo-doc-cell" rows="2" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateOfficialCell('mfo_documentation_items', ${docIndex}, 'narrative', this)" onblur="CiteFlowMfoFaculty.persistOfficialTable('mfo_documentation_items')">${esc(narrative)}</textarea>`
                : (narrative ? `<div>${esc(narrative)}</div>` : '');
            // src is filled in by hydrateReportPhotos(): the bucket is private,
            // so each object key has to be signed (then inlined) before print.
            const photos = images.map((file) => `
                <div class="mfo-doc-photo">
                    <img alt="${esc(file.mfo_caption || file.file_name || 'Supporting photo')}"
                         src="${esc(fileDisplaySrc(file))}"
                         data-storage-path="${esc(file.storage_path || file.file_path || '')}"
                         data-file-url="${esc(file.file_url || '')}">
                    ${file.mfo_caption ? `<div class="cap">${esc(file.mfo_caption)}</div>` : ''}
                    ${canEditDoc ? `<div class="mfo-doc-edit"><button type="button" onclick="CiteFlowMfoFaculty.removeFile('${file.id}')">Remove photo</button></div>` : ''}
                </div>`).join('');
            return `
                <div class="mfo-doc-entry">
                    ${titleBlock}
                    ${details.length ? `<dl>${details.map(([label, value]) =>
                        `<dt>${esc(label)}:</dt><dd>${canEditDoc ? value : esc(value)}</dd>`).join('')}</dl>` : ''}
                    ${narrativeBlock}
                    ${photos ? `<div class="mfo-doc-photos">${photos}</div>` : ''}
                    ${others.length ? `<div style="margin-top:4px"><b>Attached documents:</b> ${
                        others.map((file) => esc(file.file_name)).join('; ')
                    }</div>` : ''}
                    ${canEditDoc ? `<div class="mfo-doc-edit">
                        <button type="button" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(entry.sectionCode || row.section_code || 'other_initiatives')}', ${docIndex})">Add photos</button>
                        <button type="button" onclick="CiteFlowMfoFaculty.removePhotoDoc(${docIndex})">Remove entry</button>
                    </div>` : ''}
                </div>`;
        }).join('');
    }

    /**
     * Resolve each documentation photo to a signed URL after the report is in
     * the DOM, then inline it as a data URL so window.print() does not depend
     * on a Storage URL that may still be resolving (or expire mid-print).
     */
    async function hydrateReportPhotos() {
        const nodes = Array.from(document.querySelectorAll('#mfoReportDoc .mfo-doc-photo img'));
        if (!nodes.length) {
            state.previewPhotosReady = true;
            return;
        }
        const client = db();
        await Promise.all(nodes.map(async (img) => {
            let src = String(img.getAttribute('src') || '').trim();
            const path = String(img.getAttribute('data-storage-path') || '').trim();
            const fallback = String(img.getAttribute('data-file-url') || '').trim();
            if (path && client?.storage && !src.startsWith('data:')) {
                try {
                    const signed = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
                    if (signed.data?.signedUrl) src = signed.data.signedUrl;
                } catch (_) {}
            }
            if (!src || src === '#' || (!src.startsWith('data:') && !src.startsWith('http'))) {
                src = fallback || src;
            }
            if (src && !src.startsWith('data:')) {
                try {
                    src = await urlToDataUrl(src);
                } catch (_) {
                    if (fallback && fallback !== src) {
                        try { src = await urlToDataUrl(fallback); } catch (__) {}
                    }
                }
            }
            if (src) {
                img.src = src;
                return;
            }
            img.closest('.mfo-doc-photo')?.remove();
        }));
        state.previewPhotosReady = true;
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
        const photoEntries = reportPhotoEntries();

        const body = FORM.map((group) => {
            const only = group.indicators.length === 1 ? group.indicators[0] : null;
            const heading = `<div class="mfo-doc-group">${esc(group.group)}${
                group.bare && only?.code ? officialNaMark(only.code) : ''
            }</div>`;
            const tables = group.indicators.map((indicator) => `
                ${indicator.heading ? `<div class="mfo-doc-pi">${esc(indicator.heading)}${officialNaMark(indicator.code)}</div>` : ''}
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
                ${canEditOfficialForm()
                    ? `<textarea class="mfo-doc-lines-input" ${state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateNotes(this)" onblur="CiteFlowMfoFaculty.persistNotes()">${esc(otherAccomplishments)}</textarea>`
                    : `<div class="mfo-doc-lines">${otherAccomplishments ? esc(otherAccomplishments) : NA}</div>`}

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
                </div>

                ${photoEntries.length || canEditOfficialForm() ? renderDocumentationPages(photoEntries, period) : ''}
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
            ${reportDocumentation(rows)}
            ${canEditOfficialForm() ? `<div class="mfo-doc-edit"><button type="button" onclick="CiteFlowMfoFaculty.openPhotoModal('other_initiatives')">Add photo documentation</button></div>` : ''}`;
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
                    ${state.reviewerMode ? '<button type="button" class="cite-action" onclick="if (history.length > 1) history.back(); else location.href = \'submissions.html#chair-review\'">← Back</button>' : '<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePreview()">← Back to editor</button>'}
                    ${state.reviewerMode && reviewerCanAct() ? `
                    <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.reviewerAction('approved')">Approve</button>
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewerAction('revision')">Request Revision</button>
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewerAction('rejected')">Decline</button>
                    ` : ''}
                    <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.printReport()">
                        <i class="fa-solid fa-print"></i> Print
                    </button>
                </div>
            </div>
            ${renderReportDocument()}
            ${renderPhotoModal()}`;
        if (!state.photoModal) window.scrollTo({ top: 0, behavior: 'auto' });
        state.previewPhotosReady = false;
        hydrateReportPhotos();
    }

    /**
     * Preview must show what would actually be submitted, so pending edits are
     * written first. If that write fails the editor stays put and the error is
     * surfaced rather than showing a preview that silently omits the changes.
     */
    async function openPreview() {
        if (state.busy) return;
        if (!state.locked) {
            if (!beginBusy('Saving…')) return;
            try {
                await requireLiveSession();
                await saveDraftInternal(false);
                state.lastSaved = new Date().toISOString();
            } catch (error) {
                endBusy();
                toast(friendlyError(error, 'Unable to save your changes before preview.'), 'error');
                return;
            }
            endBusy();
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

    async function printReport() {
        if (!state.previewOpen) return;
        state.printingOfficial = true;
        render();
        toast('Preparing photos for print…');
        await hydrateReportPhotos();
        window.print();
        state.printingOfficial = false;
        render();
        hydrateReportPhotos();
    }

    function render() {
        const root = document.getElementById('mfoApp');
        if (!root) return;
        // The failure screen outranks every other view. Rendering the editor
        // without a packet is what made this page look usable while nothing
        // could actually be saved.
        if (state.initFailure) {
            renderInitFailure();
            return;
        }
        if (!state.faculty) return;
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
                    <button type="button" class="cite-action" ${state.busy || state.locked ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.saveDraft()">${state.busyLabel === 'Saving…' ? 'Saving…' : 'Save Draft'}</button>
                    <button type="button" class="cite-action" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.openPreview()">${state.busyLabel === 'Saving…' && !state.locked ? 'Saving…' : 'View / Print Report'}</button>
                    <button type="button" class="cite-action" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.reviewOpen(true)">Review MFO Report</button>
                    <button type="button" class="cite-action-primary" ${state.busy || !state.task || (state.locked && statusLabel() !== 'Returned for Revision') ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">${state.busyLabel === 'Submitting…' ? 'Submitting…' : 'Submit MFO Report'}</button>
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
            ${renderOtherNotes()}
            ${renderReview()}
            ${renderPhotoModal()}
        `;
        hydrateEditorPhotoNodes();
    }

    function renderOtherNotes() {
        return `
            <section class="surface rounded-[16px] p-5 mb-4">
                <h2 class="text-base font-bold mb-1">Other accomplishment/s of the program</h2>
                <p class="text-xs text-slate-500 mb-3">(policies created, external grant for instruction/research/extension, etc.)</p>
                <textarea class="mfo-field" rows="4" ${state.locked || state.busy ? 'disabled' : ''}
                          oninput="CiteFlowMfoFaculty.updateNotes(this)"
                          placeholder="Additional details for this quarter">${esc(state.packet?.notes || '')}</textarea>
            </section>`;
    }

    global.CiteFlowMfoFaculty = {
        updateRow,
        addRow,
        removeRow,
        setSectionNa,
        updateNotes,
        persistNotes,
        updateOfficialCell,
        persistOfficialTable,
        saveDraft,
        submitPacket,
        openPreview,
        closePreview,
        printReport,
        reviewerAction,
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
        reviewOpen(open) {
            state.reviewOpen = !!open;
            render();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window);
