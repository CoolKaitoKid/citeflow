/**
 * Faculty MFO Report — simplified rewrite.
 *
 * Design, in one paragraph: SECTIONS is the single source of truth for a
 * performance indicator — its table name, its editable fields, and how each
 * field prints on the official form. Editing always happens in the plain
 * "Record" cards; the official-form view (renderReportDocument) is a pure,
 * read-only function of state. Nothing writes through the printed page
 * anymore, so there is exactly one editing surface and one rendering path
 * per indicator instead of two definitions kept in sync by hand.
 *
 * What this version deliberately does NOT do, compared to the previous one:
 *   - No column-fallback retries (assumes the schema migrations are applied)
 *   - No mfo_debug_* diagnostic RPC calls or verbose console tracing
 *   - No editable cells inside the printable report
 * If a write fails, you get one clear toast/error instead of a silent
 * retry-without-that-column. That's a deliberate trade of resilience for
 * readability — turn DEBUG on below if you need the old visibility back.
 */
(function initCiteFlowMfoFaculty(global) {
    'use strict';

    const DEBUG = false;
    function log(...args) { if (DEBUG) console.info('[MFO]', ...args); }
    function warn(...args) { console.warn('[MFO]', ...args); }
    function err(...args) { console.error('[MFO]', ...args); }

    const BUCKET = 'wf-submissions';
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const ALLOWED_EXT = /\.(pdf|doc|docx|xls|xlsx)$/i;
    const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
    const NA = 'N/A';

    // -------------------------------------------------------------------
    // SECTIONS — one entry per performance indicator. `fields` drives the
    // editor cards; `print` drives the official-form table. A `print`
    // column is either a field key (auto: label + formatted value from
    // `fields`) or a [label, get(row, ctx)] pair for anything computed.
    // -------------------------------------------------------------------
    const SECTIONS = [
        {
            table: 'mfo_pi3_enrollment', code: 'mfo1_pi3', group: 'MFO 1 — Higher Education Services',
            title: 'PI3 — Enrollment / sections / advisers', add: 'Add Section',
            heading: 'Performance Indicator 3: Percentage of undergraduate students enrolled in CHED-identified and RDC-identified priority programs',
            fields: [
                { key: 'section', label: 'Class Section', type: 'text' },
                { key: 'students_enrolled', label: 'No. of students enrolled', type: 'number' },
                { key: 'adviser_name', label: 'Name of Adviser', type: 'text' },
                { key: 'academic_year', label: 'Academic year', type: 'text' },
                { key: 'semester', label: 'Semester', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: ['section', 'students_enrolled', 'adviser_name']
        },
        {
            table: 'mfo_pi4_syllabus', code: 'mfo1_pi4', group: 'MFO 1 — Higher Education Services',
            title: 'PI4 — Syllabus submitted this semester', add: 'Add Course',
            heading: 'Performance Indicator 4: List of Syllabus submitted for this semester for the entire program.',
            fields: [
                { key: 'subject_code', label: 'Subject code', type: 'text' },
                { key: 'course_title', label: 'Course / subject', type: 'text' },
                { key: 'syllabus_status', label: 'Syllabus status', type: 'select', options: ['submitted', 'not_submitted', 'not_applicable'] },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                ['Name of Faculty', (r, c) => c.facultyName],
                ['Courses Taught', (r) => [r.subject_code, r.course_title].filter(Boolean).join(' — ')],
                ['Status of Syllabus Submission (submitted/not submitted)', (r) => String(r.syllabus_status || '').replace(/_/g, ' ')],
                'remarks'
            ]
        },
        {
            table: 'mfo_pi5_certifications', code: 'mfo1_pi5', group: 'MFO 1 — Higher Education Services',
            title: 'PI5 — Certifications', add: 'Add Certification',
            heading: 'Performance Indicator 5: Certifications acquired from TESDA, ISO, AACCUP, and others.',
            fields: [
                { key: 'certification_title', label: 'Certification title', type: 'text' },
                { key: 'certification_nature', label: 'Nature of certification', type: 'text', placeholder: 'accreditor / auditor / NC / TM / others' },
                { key: 'granting_agency', label: 'Granting agency', type: 'text' },
                { key: 'date_granted', label: 'Date granted', type: 'date' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                ['Name of Faculty', (r, c) => c.facultyName],
                ['Nature of Certification (accreditor/auditor/NC/TM and others)', (r) => [r.certification_title, r.certification_nature].filter(Boolean).join(' — ')],
                'granting_agency', 'date_granted'
            ]
        },
        {
            table: 'mfo_pi6_postgraduate', code: 'mfo1_pi6', group: 'MFO 1 — Higher Education Services',
            title: 'PI6 — Postgraduate education', add: 'Add Program',
            heading: 'Performance Indicator 6: List of faculty members undergoing post-graduate education.',
            fields: [
                { key: 'program_enrolled', label: 'Program enrolled in', type: 'text' },
                { key: 'institution_name', label: 'Educational institution', type: 'text' },
                { key: 'earned_units', label: 'Total earned units', type: 'number' },
                { key: 'current_units', label: 'Units this semester', type: 'number' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                ['Name of Faculty', (r, c) => c.facultyName],
                'program_enrolled', 'earned_units', 'current_units', 'institution_name'
            ]
        },
        {
            table: 'mfo_pi7_trainings', code: 'mfo1_pi7', group: 'MFO 1 — Higher Education Services',
            title: 'PI7 — Trainings / workshops / seminars', add: 'Add Training',
            heading: 'Performance Indicator 7: List of trainings/workshops/seminars attended by faculty members.',
            fields: [
                { key: 'title', label: 'Title', type: 'text' },
                { key: 'training_type', label: 'Type', type: 'text', placeholder: 'Training / Workshop / Seminar / Conference' },
                { key: 'activity_date', label: 'Date', type: 'date' },
                { key: 'venue', label: 'Venue', type: 'text' },
                { key: 'sponsoring_agency', label: 'Sponsoring agency', type: 'text' },
                { key: 'role', label: 'Role', type: 'text', placeholder: 'participant / resource speaker / facilitator' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                ['Name of Faculty', (r, c) => c.facultyName],
                'title', 'activity_date', 'venue', 'sponsoring_agency', 'role'
            ]
        },
        {
            table: 'mfo_pi8_instructional_materials', code: 'mfo1_pi8', group: 'MFO 1 — Higher Education Services',
            title: 'PI8 — Instructional materials', add: 'Add Instructional Material',
            heading: 'Performance Indicator 8: Production of instructional materials',
            fields: [
                { key: 'title', label: 'Title of IM', type: 'text' },
                { key: 'material_type', label: 'Type', type: 'text', placeholder: 'print, media, graphics, etc.' },
                { key: 'courses_utilizing', label: 'Courses utilizing the IMs', type: 'text' },
                { key: 'ip_nature', label: 'Intellectual property protection', type: 'text', placeholder: 'copyright / UM / industrial design / patent' },
                { key: 'authors_text', label: 'Authors', type: 'text', placeholder: 'Separate names with semicolons' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                ['Name of Faculty (Authors)', (r, c) => r.authors_text || c.facultyName],
                'title', 'material_type', 'courses_utilizing', 'ip_nature'
            ]
        },
        {
            table: 'mfo_research_utilized', code: 'mfo3_pi1', group: 'MFO 3 — Research',
            title: 'PI1 — Research output utilized', add: 'Add Research',
            heading: 'Performance Indicator 1: Research output utilized by the industry/community/other beneficiaries within the quarter',
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'utilization_nature', label: 'Nature of utilization', type: 'text' },
                { key: 'partner_name', label: 'Partner community / industry', type: 'text' },
                { key: 'partner_address', label: 'Address of partner', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: ['research_title', 'proponents_text', 'utilization_nature', 'partner_name', 'partner_address']
        },
        {
            table: 'mfo_research_completed', code: 'mfo3_pi2', group: 'MFO 3 — Research',
            title: 'PI2 — Research output completed', add: 'Add Research',
            heading: 'Performance Indicator 2: Research output completed within the quarter',
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'completed_at', label: 'Date completed', type: 'date' },
                { key: 'research_status', label: 'Status', type: 'text' },
                { key: 'funding_source', label: 'Funding source (optional)', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: ['research_title', 'proponents_text', 'completed_at', 'research_status', 'funding_source']
        },
        {
            table: 'mfo_research_published', code: 'mfo3_pi3', group: 'MFO 3 — Research',
            title: 'PI3 — Research output published', add: 'Add Publication',
            heading: 'Performance Indicator 3: Research output published in internationally refereed or CHED accredited journals within the quarter',
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'proponents_text', label: 'Proponent/s', type: 'text' },
                { key: 'publication_name', label: 'Name of publication', type: 'text' },
                { key: 'published_at', label: 'Date published', type: 'date' },
                { key: 'funding_source', label: 'Funding source', type: 'text' },
                { key: 'publication_url', label: 'URL / DOI', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: ['research_title', 'proponents_text', 'publication_name', 'published_at', 'funding_source']
        },
        {
            table: 'mfo_research_presented', code: 'mfo3_pi4', group: 'MFO 3 — Research',
            title: 'PI4 — Research output presented', add: 'Add Presentation',
            heading: 'Performance Indicator 4: Research Output Presented in Research Conferences within the quarter',
            fields: [
                { key: 'research_title', label: 'Title of research', type: 'text' },
                { key: 'conference_title', label: 'Conference / event title', type: 'text' },
                { key: 'proponents_text', label: 'Proponents', type: 'text' },
                { key: 'presented_at', label: 'Date', type: 'date' },
                { key: 'sponsoring_agency', label: 'Sponsoring agency', type: 'text' },
                { key: 'venue', label: 'Venue', type: 'text' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: ['research_title', 'proponents_text', 'presented_at', 'sponsoring_agency', 'venue']
        },
        {
            table: 'mfo_extension_partnerships', code: 'mfo4_pi1', group: 'MFO 4 — Technical Advisory Extension Program',
            title: 'PI1 — Active partnerships', add: 'Add Partnership',
            heading: 'Performance Indicator 1: Number of active partnerships with LGUs, industries, NGOs, NGAs, SMEs, and other stakeholders as a result of extension activities',
            fields: [
                { key: 'project_title', label: 'Title of community extension project', type: 'text' },
                { key: 'proponents_text', label: 'Proponents', type: 'text' },
                { key: 'partner_name', label: 'Partner industry / community', type: 'text' },
                { key: 'project_locale', label: 'Project locale', type: 'text' },
                { key: 'has_moa', label: 'With MOA', type: 'checkbox' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                'project_title', 'proponents_text',
                ['Partner Industry/Community (indicate if with/without MOA)', (r) => {
                    const partner = String(r.partner_name || '').trim();
                    return partner ? `${partner} (${r.has_moa ? 'with MOA' : 'without MOA'})` : '';
                }],
                'project_locale'
            ]
        },
        {
            table: 'mfo_extension_trainings', code: 'mfo4_pi2', group: 'MFO 4 — Technical Advisory Extension Program',
            title: 'PI2 — Trainees / manhours', add: 'Add Training',
            heading: 'Performance Indicator 2: Number of trainees weighted by the length of training (manhours)',
            fields: [
                { key: 'training_title', label: 'Title of training', type: 'text' },
                { key: 'partner_agency', label: 'Partner agency', type: 'text' },
                { key: 'beneficiaries_male', label: 'Beneficiaries (male)', type: 'number' },
                { key: 'beneficiaries_female', label: 'Beneficiaries (female)', type: 'number' },
                { key: 'training_hours', label: 'Length of training (hours)', type: 'number' },
                { key: 'manhours_override', label: 'Manhours override (optional)', type: 'number' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                'training_title',
                ['No. Community Beneficiaries (separate no. of male & female)', (r) => {
                    const parts = [];
                    if (r.beneficiaries_male !== '' && r.beneficiaries_male != null) parts.push(`Male: ${r.beneficiaries_male}`);
                    if (r.beneficiaries_female !== '' && r.beneficiaries_female != null) parts.push(`Female: ${r.beneficiaries_female}`);
                    return parts.join(' / ');
                }],
                'training_hours',
                ['Total Manhours', (r) => manhoursPreview(r)],
                'partner_agency'
            ]
        },
        {
            table: 'mfo_other_initiatives', code: 'other_initiatives', group: 'Other initiatives/ activities undertaken relevant instruction/research/extension.',
            bare: true, add: 'Add Initiative',
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
            ],
            print: [
                'activity_title', 'activity_date', 'venue', 'sponsoring_agency', 'students_involved',
                ['Role', (r) => r.student_role], 'faculty_involved', ['Role', (r) => r.faculty_role]
            ]
        },
        {
            table: 'mfo_awards', code: 'awards', group: 'Awards received for excellence in instruction, research, community extension work.',
            bare: true, add: 'Add Award',
            fields: [
                { key: 'award_title', label: 'Title of award', type: 'text' },
                { key: 'award_type', label: 'Award type', type: 'text' },
                { key: 'award_nature', label: 'Nature of award', type: 'text', placeholder: 'research / instruction / extension' },
                { key: 'granting_agency', label: 'Granting agency', type: 'text' },
                { key: 'awarded_at', label: 'Date of awarding ceremony', type: 'date' },
                { key: 'remarks', label: 'Remarks', type: 'textarea' }
            ],
            print: [
                'award_title',
                ['Nature of Award (for excellence in research/instruction/extension, etc)', (r) => r.award_nature || r.award_type],
                'granting_agency', 'awarded_at'
            ]
        },
        {
            table: 'mfo_documentation_items', code: 'documentation_other', group: 'Documentation', title: 'Supporting documentation (general)',
            add: 'Add Documentation', isDocumentation: true,
            fields: [
                { key: 'section_code', label: 'Documentation group', type: 'select', options: ['documentation_instruction', 'documentation_training', 'documentation_postgraduate', 'documentation_research', 'documentation_extension', 'documentation_other'] },
                { key: 'title', label: 'Title', type: 'text' },
                { key: 'activity_date', label: 'Date', type: 'date' },
                { key: 'activity_time', label: 'Time (optional)', type: 'text', placeholder: 'e.g. 9:00 AM – 12:00 NN' },
                { key: 'venue', label: 'Venue (optional)', type: 'text' },
                { key: 'narrative', label: 'Brief description / explanation', type: 'textarea' }
            ]
        }
    ];

    // Program-Chairperson indicators. Faculty rows stay on mfo_packets; these print from the program packet.
    const PROGRAM_LEVEL = [
        {
            key: 'pi1',
            heading: 'Performance Indicator 1: Percentage of first-time licensure exam-takers pass the licensure exams',
            columns: ['Date of LET Examination', 'No. of First-time Takers', 'No. of Passers', 'Passing Percentage for First-time Takers', 'Total No. of Takers', 'Total No. of Passers', 'Over-all Passing Percentage'],
            values(row) {
                return [
                    reportDate(row.exam_date) || row.exam_date,
                    row.first_time_takers,
                    row.first_time_passers,
                    row.first_time_passing_pct ?? safePct(row.first_time_passers, row.first_time_takers),
                    row.total_takers,
                    row.total_passers,
                    row.overall_passing_pct ?? safePct(row.total_passers, row.total_takers)
                ];
            }
        },
        {
            key: 'pi2',
            heading: 'Performance Indicator 2: Updated Percentage of the graduates (2 years prior) that are employed',
            columns: ['No. of Graduates', 'No. of Graduates Employed', 'Percentage'],
            values(row) {
                return [
                    row.graduates_count,
                    row.employed_count,
                    row.employment_pct ?? safePct(row.employed_count, row.graduates_count)
                ];
            }
        }
    ];

    const DOC_LABELS = {
        documentation_instruction: 'Instruction', documentation_training: 'Trainings',
        documentation_postgraduate: 'Postgraduate education', documentation_research: 'Research',
        documentation_extension: 'Extension', documentation_other: 'Other engagements'
    };

    const DOC_TABLE = SECTIONS.find((s) => s.isDocumentation);

    // -------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------
    const state = {
        db: null, user: null, session: null, faculty: null,
        task: null, config: null, configs: [], packet: null, submission: null, period: null,
        rows: {}, sectionStatus: {}, files: [],
        busy: false, busyLabel: '', locked: false,
        reviewOpen: false, previewOpen: false, viewPdfOpen: false, previewPdfUrl: '', pdfPreparing: false,
        reviewerMode: false, reviewerActor: null, printing: false,
        chairName: '', profileOverrides: {}, paperSize: 'a4', programPacket: null, programRows: { pi1: [], pi2: [] }, taskWarning: '', sourceWarning: '', autoSummary: null,
        lastSaved: null, initFailure: null
    };

    function pinFacultyToken(session) {
        const client = global.CiteFlowAuth?.ensureSharedClient?.() || state.db || global.supabaseClient;
        const token = session?.access_token;
        if (!client || !token) return client;
        // supabase-js sends the anon key when getSession() is empty. PostgREST
        // then answers the insert with 401 and an RLS error. Keep the faculty
        // access token on this client so table writes are not anonymous.
        client.accessToken = async () => token;
        return client;
    }

    function db() {
        const shared = global.CiteFlowAuth?.ensureSharedClient?.();
        state.db = shared || state.db || global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.();
        if (state.session?.access_token) pinFacultyToken(state.session);
        return state.db;
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    }

    function tmpId() { return 'tmp-' + Math.random().toString(36).slice(2, 10); }
    function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')); }
    function tv(v) { const t = String(v ?? '').trim(); return t === '' ? NA : t; }
    function dateInputValue(value) {
        const text = String(value ?? '').trim();
        const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function beginBusy(label) {
        if (state.busy) return false;
        state.busy = true; state.busyLabel = label || 'Working…'; render(); return true;
    }
    function endBusy() { state.busy = false; state.busyLabel = ''; render(); }

    function toast(message, type) {
        let el = document.getElementById('mfoToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mfoToast';
            document.body.appendChild(el);
        }
        el.className = type === 'error' ? 'err' : 'ok';
        el.style.display = 'block';
        el.textContent = message;
        window.clearTimeout(toast._t);
        toast._t = window.setTimeout(() => { el.className = ''; el.style.display = 'none'; }, 4200);
    }

    function isPermissionError(error) {
        const msg = String(error?.message || error || '');
        const code = String(error?.code || '');
        return code === '42501' || /row-level security|permission denied|42501/i.test(msg);
    }

    function friendlyError(error, fallback) {
        const msg = String(error?.message || error || '');
        err(msg, error);
        if (/rate limit|too many requests/i.test(msg)) return 'Too many sign-in refreshes were requested. Wait a minute and reload.';
        if (/row-level security|permission denied|42501/i.test(msg)) return 'You do not have permission to do that. Contact the administrator.';
        if (/jwt|expired|not authenticated/i.test(msg)) return 'That request was not authorized. You are still signed in — try again.';
        if (/no public\.faculty|not linked|faculty profile/i.test(msg)) return 'No matching faculty profile was found for this account. Contact the administrator.';
        if (/duplicate|unique/i.test(msg)) return 'That record already exists and was reopened.';
        if (/network|fetch/i.test(msg)) return 'Network error. Check your connection and try again.';
        return fallback || msg || 'Something went wrong. Please try again.';
    }

    function requirePacket() {
        if (state.packet?.id) return state.packet;
        throw new Error('No MFO report record exists yet, so nothing was saved. Please reload the page.');
    }

    // -------------------------------------------------------------------
    // Session
    // -------------------------------------------------------------------
    function sessionStillValid(session) {
        if (!session?.user?.id || !session?.access_token) return false;
        let exp = Number(session.expires_at || 0);
        if (!exp) {
            try {
                const part = String(session.access_token).split('.')[1];
                const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
                exp = Number(payload?.exp || 0);
            } catch (_) {}
        }
        return !exp || exp * 1000 > Date.now();
    }

    async function ensureSession() {
        const guard = global.CiteFlowAuthGuard;
        if (guard?.state === 'AUTHENTICATED' && sessionStillValid(guard.session)) {
            state.user = guard.session.user;
            state.session = guard.session;
            pinFacultyToken(guard.session);
            return guard.session;
        }
        const client = db();
        if (global.CiteFlowAuth?.ensureActiveSession) {
            const session = await global.CiteFlowAuth.ensureActiveSession(client);
            if (session?.user?.id) { state.user = session.user; state.session = session; pinFacultyToken(session); return session; }
        }
        const persisted = global.CiteFlowAuth?.getPersistedSupabaseSession?.();
        if (sessionStillValid(persisted)) {
            state.user = persisted.user;
            state.session = persisted;
            pinFacultyToken(persisted);
            return persisted;
        }
        try {
            const { data } = await client.auth.getSession();
            if (data?.session?.user?.id) { state.user = data.session.user; state.session = data.session; pinFacultyToken(data.session); return data.session; }
        } catch (error) {
            warn('getSession', error);
        }
        return null;
    }

    async function requireSession() {
        const session = await ensureSession();
        if (!session?.user?.id || !session?.access_token) throw new Error('The MFO report could not confirm your sign-in. Reload the page.');
        return session;
    }

    // -------------------------------------------------------------------
    // Faculty / task / period resolution
    // -------------------------------------------------------------------
    async function resolveFaculty(user) {
        const client = db();
        const email = String(user?.email || '').trim().toLowerCase();
        const byAuth = await client.from('faculty').select('*').eq('auth_user_id', user.id).limit(2);
        if (byAuth.error) throw byAuth.error;
        let row = (byAuth.data || [])[0] || null;
        if (!row && email) {
            const [byEmail, byExisting] = await Promise.all([
                client.from('faculty').select('*').ilike('email', email).limit(2),
                client.from('faculty').select('*').ilike('existing_email', email).limit(2)
            ]);
            row = (byEmail.data || [])[0] || (byExisting.data || [])[0] || null;
        }
        if (!row) throw new Error('No public.faculty row matches this account. MFO cannot be filed from this account.');
        if (row && user?.id && String(row.auth_user_id || '') !== String(user.id)) {
            try {
                await client.from('faculty').update({ auth_user_id: user.id }).eq('id', row.id);
                row.auth_user_id = user.id;
            } catch (_) { /* optional */ }
        }
        const normalized = global.CiteFlowWorkflow.normalizeFaculty(row);
        normalized.id = Number(row.id);
        normalized.auth_user_id = user.id;
        normalized.first_name = row.first_name || '';
        normalized.middle_name = row.middle_name || '';
        normalized.last_name = row.last_name || '';
        normalized.full_name = facultyFullName(row);
        normalized.employee_id = String(row.employee_id || '').trim() || null;
        normalized.department = String(row.department || '').trim();
        normalized.department_code = row.department_code || '';
        normalized.program = String(row.program || row.program_name || '').trim();
        normalized.academic_rank = String(row.academic_rank || '').trim();
        normalized.position = String(row.position || '').trim();
        return normalized;
    }

    function facultyFullName(faculty) {
        const first = String(faculty?.first_name || '').trim();
        const last = String(faculty?.last_name || '').trim();
        const middle = String(faculty?.middle_name || '').trim();
        if (first || last) {
            const initial = middle ? `${middle.charAt(0).toUpperCase()}.` : '';
            return [first, initial, last].filter(Boolean).join(' ');
        }
        return String(faculty?.full_name || faculty?.name || '').trim();
    }

    function facultyEmployeeLabel(faculty) {
        return String(faculty?.employee_id || '').trim();
    }

    function facultyProgramLabel(faculty) {
        return String(faculty?.program || '').trim();
    }

    function facultyRankLabel(faculty) {
        return String(faculty?.academic_rank || '').trim() || String(faculty?.position || '').trim();
    }

    function facultyRankPdf(faculty) {
        const rank = String(faculty?.academic_rank || '').trim();
        const position = String(faculty?.position || '').trim();
        if (rank && position && rank !== position) return `${rank} · ${position}`;
        return facultyRankLabel(faculty);
    }

    function profileBase() {
        const faculty = state.faculty || {};
        const period = state.period || {};
        return {
            fullName: facultyFullName(faculty),
            employeeId: facultyEmployeeLabel(faculty),
            department: String(faculty.department || '').trim(),
            program: facultyProgramLabel(faculty),
            rank: facultyRankLabel(faculty),
            chairperson: String(state.chairName || '').trim(),
            academicPeriod: [period.academic_year, period.semester].filter(Boolean).join(' · ')
        };
    }

    function reportProfileModel() {
        const base = profileBase();
        const over = state.profileOverrides || {};
        const pick = (key) => Object.prototype.hasOwnProperty.call(over, key) ? String(over[key] ?? '').trim() : base[key];
        return {
            fullName: pick('fullName'),
            employeeId: pick('employeeId'),
            department: pick('department'),
            program: pick('program'),
            rank: pick('rank'),
            chairperson: pick('chairperson'),
            academicPeriod: base.academicPeriod
        };
    }

    function updateProfileField(key, input) {
        if (state.locked) return;
        if (input && input.setAttribute) input.setAttribute('data-mfo-touched', '1');
        state.profileOverrides = state.profileOverrides || {};
        state.profileOverrides[key] = input.value;
        if (key === 'department' && state.packet) state.packet.department = input.value;
    }

    function profileField(key, label, value) {
        const disabled = state.locked || state.busy ? 'disabled' : '';
        return `<div><label class="mfo-label">${esc(label)}</label>
            <input class="mfo-field" type="text" data-mfo-profile="${esc(key)}" value="${esc(value || '')}" ${disabled} oninput="CiteFlowMfoFaculty.updateProfileField('${esc(key)}', this)"></div>`;
    }

    async function loadDepartmentChair() {
        const retained = String(state.packet?.reviewed_by || '').trim();
        const packetState = String(state.packet?.packet_state || '');
        if (retained && /chair|approv/i.test(packetState)) {
            state.chairName = retained;
            return;
        }
        const faculty = state.faculty || {};
        const targets = [faculty.department, faculty.department_code].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
        let result = await db().from('faculty')
            .select('full_name, first_name, middle_name, last_name, role, position, academic_rank, department, department_code')
            .or('role.ilike.%chair%,position.ilike.%chair%,academic_rank.ilike.%chair%')
            .limit(80);
        if (result.error) {
            result = await db().from('faculty')
                .select('full_name, role, position, academic_rank, department, department_code')
                .or('role.ilike.%chair%,position.ilike.%chair%,academic_rank.ilike.%chair%')
                .limit(80);
        }
        if (result.error || !Array.isArray(result.data)) return;
        const match = result.data.find((row) => {
            const values = [row.department, row.department_code].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
            return targets.some((target) => values.includes(target));
        });
        state.chairName = match ? (facultyFullName(match) || String(match.full_name || '').trim()) : '';
    }

    function manilaNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })); }
    function isoDate(v) {
        if (!v) return '';
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function quarterPeriod(now) {
        const q = Math.floor(now.getMonth() / 3);
        const start = new Date(now.getFullYear(), q * 3, 1), end = new Date(now.getFullYear(), q * 3 + 3, 0);
        const names = ['January to March', 'April to June', 'July to September', 'October to December'];
        const ordinal = ['1st', '2nd', '3rd', '4th'][q];
        return { reporting_year: start.getFullYear(), quarter: q + 1, period_start: isoDate(start), period_end: isoDate(end), period_label: `${ordinal} Quarter — ${names[q]} ${start.getFullYear()}` };
    }
    function periodFromTask(task, config) {
        if (task?.reporting_period_start && task?.reporting_period_end) {
            const start = new Date(task.reporting_period_start);
            const q = Number.isNaN(start.getTime()) ? null : Math.floor(start.getMonth() / 3) + 1;
            return {
                reporting_year: start.getFullYear() || manilaNow().getFullYear(), quarter: q,
                period_start: String(task.reporting_period_start).slice(0, 10), period_end: String(task.reporting_period_end).slice(0, 10),
                period_label: task.reporting_period_label || `Q${q || ''} ${start.getFullYear()}`
            };
        }
        if (config?.frequency === 'annual') {
            const y = manilaNow().getFullYear();
            return { reporting_year: y, quarter: null, period_start: `${y}-01-01`, period_end: `${y}-12-31`, period_label: `Annual ${y}` };
        }
        return quarterPeriod(manilaNow());
    }
    function periodsMatch(packet, period) {
        if (!packet || !period) return false;
        if (packet.period_start && period.period_start) return String(packet.period_start).slice(0, 10) === String(period.period_start).slice(0, 10);
        return Number(packet.reporting_year) === Number(period.reporting_year) && Number(packet.quarter) === Number(period.quarter);
    }

    function isMfoSource(source) {
        const wf = global.CiteFlowWorkflow;
        if (wf?.resolveDocumentCategory && wf.resolveDocumentCategory(source) === 'MFO') return true;
        const blob = [source?.title, source?.report_name, source?.name, source?.instructions, source?.description].join(' ').toLowerCase();
        return /\bmfo\b|major final output|accomplishment report/.test(blob);
    }

    async function resolveContext() {
        const client = db();
        const facultyId = state.faculty.id;
        const params = new URLSearchParams(window.location.search);
        const requestedTaskId = params.get('task');

        const [configs, assigned, catalog] = await Promise.all([
            client.from('wf_report_configs').select('*'),
            global.CiteFlowWorkflow.loadFacultyAssignedTasks(facultyId),
            client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true })
        ]);
        state.catalog = catalog.data || [];
        SECTIONS.forEach((def) => {
            const row = state.catalog.find((item) => item.section_code === def.code);
            if (row?.title) {
                const cleanedTitle = String(row.title || '').replace(/â€”/g, '—').replace(/â€“/g, '–').replace(/â€™/g, "'");
                def.title = row.indicator_code ? `${row.indicator_code} — ${cleanedTitle}` : cleanedTitle;
            }
        });

        state.configs = configs.data || [];
        const mfoConfigs = state.configs.filter(isMfoSource);
        const tasks = assigned.tasks || [];
        let task = null;

        if (requestedTaskId) {
            task = tasks.find((t) => String(t.id) === String(requestedTaskId)) || null;
            if (!task) {
                const fetched = await client.from('wf_tasks').select('*').eq('id', requestedTaskId).maybeSingle();
                if (fetched.data && (isMfoSource(fetched.data) || mfoConfigs.some((c) => String(c.id) === String(fetched.data.report_config_id)))) task = fetched.data;
            }
        }
        if (!task) {
            const mfoTasks = tasks.filter((t) => isMfoSource(t) || mfoConfigs.some((c) => String(c.id) === String(t.report_config_id)));
            mfoTasks.sort((a, b) => new Date(b.created_at || b.due_at || 0) - new Date(a.created_at || a.due_at || 0));
            task = mfoTasks[0] || null;
        }

        if (task) {
            state.task = task;
            state.config = state.configs.find((c) => String(c.id) === String(task.report_config_id)) || mfoConfigs[0] || null;
        } else if (mfoConfigs[0]) {
            state.config = mfoConfigs[0];
        }

        state.period = periodFromTask(state.task, state.config);
        if (global.CiteFlowSettings?.getAcademicPeriod) {
            try {
                const academic = await global.CiteFlowSettings.getAcademicPeriod();
                state.period.academic_year = academic.academic_year || '';
                state.period.semester = academic.semester || '';
            } catch (_) { /* optional */ }
        }

        const existing = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
        const mine = existing.data || [];
        const resume = (state.task && mine.find((r) => String(r.task_id) === String(state.task.id)))
            || mine.find((r) => periodsMatch(r, state.period))
            || [...mine].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0] || null;

        if (resume) {
            state.packet = resume;
            Object.assign(state.period, {
                period_label: resume.period_label || state.period.period_label,
                reporting_year: resume.reporting_year || state.period.reporting_year,
                quarter: resume.quarter ?? state.period.quarter,
                period_start: resume.period_start ? String(resume.period_start).slice(0, 10) : state.period.period_start,
                period_end: resume.period_end ? String(resume.period_end).slice(0, 10) : state.period.period_end,
                academic_year: resume.academic_year || state.period.academic_year,
                semester: resume.semester || state.period.semester
            });
            if (resume.task_id && (!state.task || String(state.task.id) !== String(resume.task_id))) {
                const fetched = await client.from('wf_tasks').select('*').eq('id', resume.task_id).maybeSingle();
                if (fetched.data) state.task = fetched.data;
            }
        }

        if (!state.task) {
            state.taskWarning = 'No MFO task is assigned for this period. You can still save a draft. Ask an administrator to create a quarterly MFO report before submitting.';
        }
    }

    async function rpcWithCurrentSession(name, args) {
        const session = await requireSession();
        const token = session?.access_token;
        if (!token) throw new Error('The MFO report could not confirm your sign-in. Reload the page.');
        const response = await fetch(`${global.__SUPABASE_URL__}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: {
                apikey: global.__SUPABASE_ANON__,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(args || {})
        });
        let body = null;
        try { body = await response.json(); } catch (_) { body = null; }
        if (!response.ok) {
            return {
                data: null,
                error: {
                    message: body?.message || body?.error_description || response.statusText || 'Request failed',
                    code: body?.code || null,
                    status: response.status
                }
            };
        }
        return { data: body, error: null };
    }

    async function ensurePacket() {
        const client = db();
        const facultyId = Number(state.faculty.id);
        const task = state.task, period = state.period;
        const session = await requireSession();
        state.session = session;

        if (task?.id) {
            const sub = await client.from('wf_submissions').select('*').eq('task_id', task.id).eq('faculty_id', facultyId).maybeSingle();
            state.submission = sub.data || null;
            if (!state.packet) {
                const byTask = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId).eq('task_id', task.id).maybeSingle();
                state.packet = byTask.data || null;
            }
        }
        if (!state.packet) {
            const listed = await client.from('mfo_packets').select('*').eq('faculty_id', facultyId);
            state.packet = (listed.data || []).find((r) => periodsMatch(r, period)) || null;
        }

        if (!state.packet) {
            const created = await rpcWithCurrentSession('mfo_ensure_faculty_packet', {
                p_faculty_id: facultyId, p_task_id: task?.id || null,
                p_report_config_id: task?.report_config_id || state.config?.id || null,
                p_department: state.faculty.department || state.faculty.department_code || null,
                p_reporting_year: period.reporting_year || null, p_quarter: period.quarter || null,
                p_period_start: period.period_start || null, p_period_end: period.period_end || null,
                p_period_label: period.period_label || null, p_academic_year: period.academic_year || null,
                p_semester: period.semester || null, p_submission_id: state.submission?.id || null
            });
            if (created.error) throw new Error(`The MFO report could not be created: ${created.error.message}`);
            state.packet = Array.isArray(created.data) ? created.data[0] : created.data;
        }

        if (!state.packet?.id) throw new Error('The MFO report record could not be created or found for this account.');

        if (task?.id && !state.packet.task_id) {
            const linked = await client.from('mfo_packets').update({ task_id: task.id }).eq('id', state.packet.id).select('*').maybeSingle();
            if (linked.data) state.packet = linked.data;
        }
        if (!state.submission && task?.id) {
            const saved = await client.from('wf_submissions').upsert(
                { task_id: task.id, faculty_id: facultyId, status: 'notsubmitted', approval_stage: mfoApprovalStage() },
                { onConflict: 'task_id,faculty_id' }
            ).select('*').single();
            if (!saved.error) {
                state.submission = saved.data;
                if (!state.packet.submission_id) {
                    await client.from('mfo_packets').update({ submission_id: saved.data.id }).eq('id', state.packet.id);
                    state.packet.submission_id = saved.data.id;
                }
            } else {
                warn('draft submission upsert failed', saved.error);
            }
        }
    }

    // -------------------------------------------------------------------
    // Approval routing (delegates the actual decision logic to CiteFlowWorkflow)
    // -------------------------------------------------------------------
    function linkedApprovalConfig() {
        const linkedId = state.task?.report_config_id;
        if (!linkedId) return null;
        if (state.config && String(state.config.id) === String(linkedId)) return state.config;
        return (state.configs || []).find((c) => String(c.id) === String(linkedId)) || null;
    }
    function mfoApprovalConfig() {
        const config = linkedApprovalConfig();
        if (!config) return { requires_chairperson_review: true, report_name: 'MFO Accomplishment Report' };
        return config.requires_chairperson_review === false ? config : Object.assign({}, config, { requires_chairperson_review: true, report_name: config.report_name || 'MFO Accomplishment Report' });
    }
    function requiresChairpersonReview() { return mfoApprovalConfig().requires_chairperson_review !== false; }
    function mfoApprovalStage() { return global.CiteFlowWorkflow.resolveInitialApprovalStage(mfoApprovalConfig(), state.task); }
    async function mfoApprovalStageForSubmitter() {
        const helper = global.CiteFlowWorkflow;
        if (!helper?.resolveInitialApprovalStageForSubmission) return mfoApprovalStage();
        let grants = [];
        try { grants = await helper.loadActiveDelegatedAccess(db()); } catch (_) { /* best effort */ }
        return helper.resolveInitialApprovalStageForSubmission(db(), {
            config: mfoApprovalConfig(), task: state.task, submitterFaculty: state.faculty, delegatedAccess: grants
        });
    }

    function statusLabel() {
        const wf = global.CiteFlowWorkflow, sub = state.submission;
        if (!sub || !sub.submitted_at) return 'Draft';
        const pending = requiresChairpersonReview() ? 'Submitted — Awaiting Chairperson Review' : 'Submitted — Pending Admin Final Approval';
        const stage = wf?.getWorkflowStage ? wf.getWorkflowStage(sub, state.task, mfoApprovalConfig()) : null;
        if (stage === 'chairperson_review' || stage === 'submitted') return pending;
        if (stage === 'final_approval') return 'Pending Admin Final Approval';
        if (stage === 'completed') return 'Admin Approved';
        if (stage === 'revision_required') return 'Returned for Revision';
        if (stage === 'rejected') return 'Declined';
        return pending;
    }
    function computeLocked() {
        const wf = global.CiteFlowWorkflow, sub = state.submission;
        if (!sub || !sub.submitted_at) return false;
        if (wf?.getWorkflowStage) {
            const stage = wf.getWorkflowStage(sub, state.task, mfoApprovalConfig());
            return !['assigned', 'late_pending', 'revision_required', 'rejected'].includes(stage);
        }
        return ['submitted', 'late', 'underreview', 'approved'].includes(String(sub.status || '').toLowerCase());
    }

    // -------------------------------------------------------------------
    // Row helpers
    // -------------------------------------------------------------------
    function emptyRow(def) {
        const row = { id: tmpId(), source_kind: 'manual' };
        (def.fields || []).forEach((f) => { row[f.key] = f.type === 'checkbox' ? false : ''; });
        if (def.isDocumentation) { row.section_code = 'documentation_other'; row.activity_time = ''; row.venue = ''; }
        if (def.table === 'mfo_extension_trainings') row.manhours_formula = 'hours_x_beneficiaries';
        return row;
    }

    function unpackDocDetails(row) {
        const raw = String(row?.narrative || '');
        let activity_time = row.activity_time || '', venue = row.venue || '', narrative = raw;
        if (!activity_time || !venue) {
            const timeMatch = raw.match(/^Time:\s*(.+)$/im), venueMatch = raw.match(/^Venue:\s*(.+)$/im);
            if (timeMatch || venueMatch) {
                if (timeMatch) activity_time = activity_time || timeMatch[1].trim();
                if (venueMatch) venue = venue || venueMatch[1].trim();
                narrative = raw.replace(/^Time:\s*.+$/im, '').replace(/^Venue:\s*.+$/im, '').trim();
            }
        }
        return { ...row, title: row.title || row.caption || '', activity_time, venue, narrative };
    }

    function generalDocs() {
        return (state.rows.mfo_documentation_items || []).map((row, index) => ({ row, index })).filter(({ row }) => String(row.section_code || '').startsWith('documentation_'));
    }

    function authorsToText(v) {
        if (Array.isArray(v)) return v.map((i) => (typeof i === 'string' ? i : i?.name || '')).filter(Boolean).join('; ');
        return String(v || '');
    }
    function textToAuthors(v) { return String(v || '').split(/;|\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })); }

    function manhoursPreview(row) {
        const hours = Number(row.training_hours);
        const male = Number(row.beneficiaries_male) || 0, female = Number(row.beneficiaries_female) || 0;
        if (!Number.isFinite(hours)) return '—';
        const calc = hours * (male + female);
        if (row.manhours_override !== '' && row.manhours_override != null) return `${Number(row.manhours_override)} (override; calculated ${calc.toFixed(2)})`;
        return `${calc.toFixed(2)}  (hours × male+female)`;
    }

    function reportDate(v) {
        if (!v) return '';
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    function formatWhen(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    // -------------------------------------------------------------------
    // Files
    // -------------------------------------------------------------------
    function fileIsImage(file) {
        if (isSubmittedMfoPdf(file)) return false;
        const name = String(file?.file_name || file?.storage_path || file?.file_url || '');
        if (IMAGE_EXT.test(name)) return true;
        if (/^image\//i.test(String(file?.content_type || file?.mime_type || file?.file_type || ''))) return true;
        return /\/photos\//i.test(String(file?.storage_path || file?.file_path || ''));
    }
    function filesFor(code, recordId) {
        return (state.files || []).filter((f) => recordId
            ? (String(f.mfo_record_id || '') === String(recordId) || String(f.mfo_documentation_id || '') === String(recordId))
            : (f.mfo_section === code && !f.mfo_record_id && !f.mfo_documentation_id));
    }
    function uniquePhotosForRecord(sectionCode, recordId) {
        const seen = new Set(), out = [];
        filesFor(sectionCode, recordId).forEach((f) => {
            if (!fileIsImage(f) || seen.has(String(f.id))) return;
            seen.add(String(f.id)); out.push(f);
        });
        return out;
    }
    function fileDisplaySrc(file) { return String(file?.display_url || file?.file_url || '').trim(); }

    async function resolveFileDisplayUrl(file) {
        if (!file) return '';
        const path = String(file.storage_path || file.file_path || '').trim();
        if (path) {
            try {
                const signed = await db().storage.from(BUCKET).createSignedUrl(path, 3600);
                if (signed.data?.signedUrl) { file.display_url = signed.data.signedUrl; return file.display_url; }
            } catch (e) { warn('sign file', e); }
        }
        file.display_url = String(file.file_url || '');
        return file.display_url;
    }
    async function hydrateFileDisplayUrls(files) { await Promise.all((files || []).map(resolveFileDisplayUrl)); }

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
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Could not read image (${res.status}).`);
        const dataUrl = await blobToDataUrl(await res.blob());
        if (!/^data:image\//i.test(dataUrl)) throw new Error('That file is not a readable image.');
        return dataUrl;
    }
    function photoThumb(file) {
        const src = fileDisplaySrc(file);
        return `<a href="${esc(src || '#')}" target="_blank" rel="noopener" class="mfo-photo-thumb" title="${esc(file.file_name || '')}">
            <img src="${esc(src)}" alt="${esc(file.file_name || 'Documentation photo')}" loading="lazy"
                 data-storage-path="${esc(file.storage_path || file.file_path || '')}" data-file-url="${esc(file.file_url || '')}"></a>`;
    }
    async function hydrateEditorPhotoNodes() {
        const nodes = Array.from(document.querySelectorAll('#mfoApp img[data-storage-path]'));
        await Promise.all(nodes.map(async (img) => {
            const path = String(img.getAttribute('data-storage-path') || '').trim();
            if (path) {
                try {
                    const signed = await db().storage.from(BUCKET).createSignedUrl(path, 3600);
                    if (signed.data?.signedUrl) { img.src = signed.data.signedUrl; return; }
                } catch (_) { /* fall through */ }
            }
            const fallback = String(img.getAttribute('data-file-url') || '').trim();
            if (fallback) img.src = fallback;
        }));
    }

    // -------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------
    async function init() {
        const root = document.getElementById('mfoApp');
        try {
            state.db = db();
            if (!state.db) throw new Error('Database client is not available.');
            if (global.CiteFlowAuthGuard?.ready) await global.CiteFlowAuthGuard.ready;

            const session = await requireSession();
            state.session = session;
            if (session?.user) state.user = session.user;
            const sidebarPromise = typeof global.loadSidebar === 'function'
                ? Promise.resolve().then(() => global.loadSidebar()).catch((e) => warn('sidebar', e)) : Promise.resolve();
            try { await db().rpc('wf_link_faculty_auth_user_if_safe'); } catch (_) { /* optional */ }
            void sidebarPromise;

            const params = new URLSearchParams(window.location.search);
            if (params.get('view') === 'review' && params.get('submission')) {
                await initReviewerMode(params.get('submission'));
                return;
            }

            state.faculty = await resolveFaculty(state.user || session.user);
            await resolveContext();
            await ensurePacket();
            try { await loadDepartmentChair(); } catch (error) { warn('chairperson lookup', error); }
            await loadPacketData();
            try { await loadProgramPortion(); } catch (error) { warn('program packet', error); }
            await suggestFromSystem();
            autoMarkBlankSectionsAsNa();
            state.locked = computeLocked();
            render();
            void backfillSubmittedMfoPdf();
        } catch (error) {
            err('init failed', error);
            if (root) {
                state.initFailure = { message: error?.message || String(error), at: new Date().toISOString() };
                render();
            }
        }
    }

    function withTimeout(promise, ms, fallbackValue) {
        return Promise.race([
            promise,
            new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms))
        ]);
    }

    function renderInitFailure() {
        const root = document.getElementById('mfoApp');
        if (!root) return;
        root.innerHTML = `
            <div class="mb-4">
                <a href="submissions.html" class="text-sm font-bold text-[#621708]">← Back to Submissions</a>
                <div class="cite-kicker mt-3">MFO Report</div>
                <h1 class="cite-title">The MFO report could not be opened</h1>
            </div>
            <section class="surface rounded-[16px] p-5 mb-4 border border-rose-200">
                <p class="text-sm text-slate-700 mb-3">Nothing has been lost and nothing was saved. The error was:</p>
                <p class="font-mono text-[12px] text-slate-900 break-words bg-slate-50 rounded-lg p-3">${esc(state.initFailure.message)}</p>
                <div class="flex flex-col sm:flex-row gap-2 mt-4">
                    <button type="button" class="cite-action-primary" onclick="window.location.reload()">Retry</button>
                    <button type="button" class="cite-action" onclick="window.location.href='submissions.html'">Back to Submissions</button>
                </div>
            </section>`;
    }

    async function initReviewerMode(submissionId) {
        const client = db();
        state.reviewerMode = true;
        if (!state.user && state.session?.user) state.user = state.session.user;

        let sub = null;
        try {
            const subRes = await withTimeout(
                client.from('wf_submissions').select('*').eq('id', submissionId).maybeSingle(),
                4000,
                { data: null, error: null }
            );
            if (subRes?.error) throw subRes.error;
            sub = subRes;
        } catch (e) {
            warn('fetch submission', e);
        }

        if (!sub?.data) {
            try {
                const listed = await withTimeout(
                    client.rpc('wf_list_chairperson_submissions'),
                    4000,
                    { data: [] }
                );
                sub = { data: (listed?.data || []).find((r) => String(r.id) === String(submissionId)) || null };
            } catch (_) {}
        }
        if (!sub?.data) throw new Error('This submission is not available to your account.');
        state.submission = sub.data;
        // Retrieve MFO packet via authoritative RPC or fallbacks
        let packetData = null;
        try {
            const rpcRes = await withTimeout(
                client.rpc('mfo_get_submission_packet', { p_submission_id: submissionId }),
                3500,
                { data: null }
            );
            if (rpcRes?.data) {
                packetData = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
            }
        } catch (_) {}

        // Fallback 1: Query by submission_id
        if (!packetData) {
            try {
                const p1 = await withTimeout(
                    client.from('mfo_packets').select('*').eq('submission_id', submissionId).maybeSingle(),
                    3000,
                    { data: null }
                );
                if (p1?.data) packetData = p1.data;
            } catch (_) {}
        }

        // Fallback 2: Query by task_id and faculty_id
        if (!packetData && state.submission.task_id && state.submission.faculty_id) {
            try {
                const p2 = await withTimeout(
                    client.from('mfo_packets').select('*').eq('task_id', state.submission.task_id).eq('faculty_id', state.submission.faculty_id).maybeSingle(),
                    3000,
                    { data: null }
                );
                if (p2?.data) packetData = p2.data;
            } catch (_) {}
        }

        // Fallback 3: Check wf_submission_files for tagged mfo_packet_id
        if (!packetData) {
            try {
                const filesRes = await withTimeout(
                    client.from('wf_submission_files').select('mfo_packet_id').eq('submission_id', submissionId),
                    3000,
                    { data: [] }
                );
                const pktId = (filesRes?.data || []).map((f) => f.mfo_packet_id).find(Boolean);
                if (pktId) {
                    const p3 = await withTimeout(
                        client.from('mfo_packets').select('*').eq('id', pktId).maybeSingle(),
                        3000,
                        { data: null }
                    );
                    if (p3?.data) packetData = p3.data;
                }
            } catch (_) {}
        }

        // Fallback 4: Query latest packet for this faculty member
        if (!packetData && state.submission.faculty_id) {
            try {
                const facPackets = await withTimeout(
                    client.from('mfo_packets').select('*').eq('faculty_id', state.submission.faculty_id).order('updated_at', { ascending: false }),
                    3000,
                    { data: [] }
                );
                if (Array.isArray(facPackets?.data) && facPackets.data.length > 0) {
                    const matched = facPackets.data.find((p) => p.task_id && String(p.task_id) === String(state.submission.task_id))
                        || facPackets.data[0];
                    packetData = matched;
                }
            } catch (_) {}
        }

        // Auto-link packet to submission if found
        if (packetData?.id) {
            const patch = {};
            if (!packetData.submission_id) patch.submission_id = submissionId;
            if (!packetData.task_id && state.submission.task_id) patch.task_id = state.submission.task_id;
            if (Object.keys(patch).length > 0) {
                try {
                    client.from('mfo_packets').update(patch).eq('id', packetData.id).then(() => {}).catch(() => {});
                    Object.assign(packetData, patch);
                } catch (_) {}
            }
        }

        // Fallback 5: If no packet record exists, synthesize a fallback packet
        // so the reviewer can still inspect the submission, view files, and take approval actions
        if (!packetData) {
            packetData = {
                id: null,
                submission_id: submissionId,
                task_id: state.submission.task_id || null,
                faculty_id: state.submission.faculty_id,
                department: null,
                packet_state: state.submission.status || 'submitted',
                reporting_year: new Date().getFullYear(),
                quarter: Math.floor(new Date().getMonth() / 3) + 1,
                period_label: 'Submitted Accomplishment Report',
                is_synthetic: true
            };
        }

        state.packet = packetData;

        const [author, task, configs, catalog] = await Promise.all([
            state.packet.faculty_id
                ? withTimeout(client.from('faculty').select('*').eq('id', state.packet.faculty_id).maybeSingle(), 3000, { data: null })
                : Promise.resolve({ data: null }),
            state.submission.task_id
                ? withTimeout(client.from('wf_tasks').select('*').eq('id', state.submission.task_id).maybeSingle(), 3000, { data: null })
                : Promise.resolve({ data: null }),
            withTimeout(client.from('wf_report_configs').select('*'), 3000, { data: [] }),
            withTimeout(client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true }), 3000, { data: [] })
        ]);
        state.faculty = author?.data || { id: state.packet.faculty_id, full_name: 'Faculty', department: state.packet.department };
        state.task = task?.data || null;
        state.configs = configs?.data || [];
        state.config = linkedApprovalConfig();
        state.catalog = catalog?.data || [];
        state.period = {
            reporting_year: state.packet.reporting_year, quarter: state.packet.quarter, period_label: state.packet.period_label,
            period_start: state.packet.period_start, period_end: state.packet.period_end,
            academic_year: state.packet.academic_year, semester: state.packet.semester
        };

        await loadPacketData();
        autoMarkBlankSectionsAsNa();
        try {
            if (state.user) {
                state.reviewerActor = await resolveFaculty(state.user);
            }
        } catch (_) {
            state.reviewerActor = null;
        }
        let isFinalApprover = false;
        try {
            const finalRes = await withTimeout(client.rpc('wf_is_final_approver'), 2000, { data: false });
            isFinalApprover = !!finalRes?.data;
        } catch (_) {}
        if (!isFinalApprover && state.user) {
            const role = String(state.reviewerActor?.role || state.user?.user_metadata?.role || '').toLowerCase();
            isFinalApprover = role === 'admin' || role === 'dean' || role === 'superadmin' || role === 'administrator';
        }
        state.reviewerIsAdmin = isFinalApprover;
        if (!state.reviewerActor && state.reviewerIsAdmin) {
            state.reviewerActor = {
                id: null,
                auth_user_id: state.user?.id,
                full_name: state.user?.user_metadata?.full_name || state.user?.email || 'Administrator',
                role: 'admin'
            };
        }
        try { await loadDepartmentChair(); } catch (error) { warn('chairperson lookup', error); }
        try { await loadProgramPortion(); } catch (error) { warn('program packet', error); }
        state.locked = true;
        state.previewOpen = !!state.reviewerIsAdmin;
        render();
    }

    function reviewerCanAct() {
        if (!state.reviewerMode || !state.submission) return false;
        const helper = global.CiteFlowWorkflow;
        const status = String(state.submission.status || '').toLowerCase();
        const stage = String(state.submission.approval_stage || '').toLowerCase();

        if (state.reviewerIsAdmin) {
            return ['submitted', 'late', 'underreview'].includes(status) &&
                (stage === 'final' || stage === 'final_approver' || stage === 'admin' || stage === 'chairperson');
        }

        if (!state.reviewerActor) return false;
        if (helper?.isPendingChairpersonReview) return helper.isPendingChairpersonReview(state.submission, state.config, state.task);
        return ['submitted', 'late', 'underreview'].includes(status) && stage === 'chairperson';
    }

    function openReviewerModal(action) {
        if (!reviewerCanAct()) return;
        state.reviewerModal = { action, comment: '', error: '' };
        render();
    }

    function closeReviewerModal() {
        state.reviewerModal = null;
        render();
    }

    function updateReviewerModalComment(comment) {
        if (!state.reviewerModal) return;
        state.reviewerModal.comment = comment;
        if (comment.trim() && state.reviewerModal.error) {
            state.reviewerModal.error = '';
            const errEl = document.getElementById('mfoReviewCommentError');
            if (errEl) errEl.style.display = 'none';
        }
    }

    async function confirmReviewerAction() {
        const modal = state.reviewerModal;
        if (!modal) return;
        const action = modal.action;
        const comment = String(modal.comment || '').trim();

        if ((action === 'revision' || action === 'rejected') && !comment) {
            modal.error = action === 'revision'
                ? 'Please provide remarks explaining what needs revision.'
                : 'Please provide a reason for declining this report.';
            render();
            const input = document.getElementById('mfoReviewCommentInput');
            if (input) input.focus();
            return;
        }

        if (!state.reviewerIsAdmin && action === 'approved') syncChairForm();
        closeReviewerModal();
        await executeReviewAction(action, comment);
    }
    const confirmReviewerModal = confirmReviewerAction;

    function reviewerAction(action) {
        openReviewerModal(action);
    }

    async function executeReviewAction(action, comment = '') {
        if (!reviewerCanAct() || !global.CiteFlowWorkflow?.applySubmissionReview) return;
        const isApprove = action === 'approved';
        if (!state.reviewerIsAdmin && isApprove) syncChairForm();
        const busyMsg = isApprove ? 'Approving…' : action === 'revision' ? 'Sending revision…' : 'Declining…';
        if (!beginBusy(busyMsg)) return;
        try {
            if (!state.reviewerIsAdmin && isApprove) await saveChairPortion({ nested: true });
            const client = db();
            const result = await global.CiteFlowWorkflow.applySubmissionReview(client, {
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

            if (state.packet?.id) {
                let packetState = 'submitted';
                if (action === 'approved') {
                    packetState = state.reviewerIsAdmin ? 'approved' : 'chairperson_approved';
                } else if (action === 'revision') {
                    packetState = 'revision';
                } else if (action === 'rejected') {
                    packetState = 'declined';
                }
                const reviewerName = state.reviewerActor?.full_name || state.user?.email || null;
                if (reviewerName) state.packet.reviewed_by = reviewerName;
                if (action === 'approved' && reviewerName && !state.reviewerIsAdmin) state.chairName = reviewerName;
                try {
                    let { error } = await client.from('mfo_packets').update({
                        packet_state: packetState,
                        reviewed_by: reviewerName,
                        reviewed_at: new Date().toISOString()
                    }).eq('id', state.packet.id);
                    if (error && /column|schema|cache/i.test(error.message || '')) {
                        await client.from('mfo_packets').update({
                            packet_state: packetState
                        }).eq('id', state.packet.id);
                    }
                } catch (_) {}
            }

            const successMsg = isApprove
                ? (state.reviewerIsAdmin ? 'MFO report certified and approved.' : 'Chairperson approval recorded. Sent to Admin for final approval.')
                : action === 'revision' ? 'Revision requested.' : 'Submission declined.';
            toast(successMsg, action === 'rejected' ? 'error' : 'ok');

            setTimeout(() => {
                if (state.reviewerIsAdmin) {
                    window.location.href = '../admin/workflow-approval.html';
                } else {
                    window.location.href = 'submissions.html#chair-review';
                }
            }, 1200);
        } catch (error) {
            toast(friendlyError(error, 'Unable to record the review decision.'), 'error');
        } finally { endBusy(); }
    }

    // -------------------------------------------------------------------
    // Load
    // -------------------------------------------------------------------
    async function loadPacketData() {
        if (!state.packet?.id) {
            const client = db();
            SECTIONS.forEach((def) => { state.rows[def.table] = []; });
            state.sectionStatus = {};
            if (state.submission?.id) {
                try {
                    const files = await client.from('wf_submission_files').select('*').eq('submission_id', state.submission.id).order('created_at', { ascending: true });
                    state.files = files.data || [];
                    void hydrateFileDisplayUrls(state.files).catch((e) => warn('sign files', e));
                } catch (_) {}
            }
            return;
        }
        const client = db(), packetId = state.packet.id;
        SECTIONS.forEach((def) => { state.rows[def.table] = []; });

        await Promise.all(SECTIONS.map(async (def) => {
            const result = await client.from(def.table).select('*').eq('packet_id', packetId).order('sort_order', { ascending: true });
            if (result.error) { warn('load', def.table, result.error); return; }
            state.rows[def.table] = (result.data || []).map((row) => {
                const copy = { ...row };
                if (def.table === 'mfo_pi8_instructional_materials') copy.authors_text = authorsToText(row.authors);
                if (def.isDocumentation) Object.assign(copy, unpackDocDetails(row));
                (def.fields || []).forEach((f) => {
                    if (f.type === 'checkbox') copy[f.key] = !!copy[f.key];
                    if (f.type === 'date' && copy[f.key]) copy[f.key] = dateInputValue(copy[f.key]) || copy[f.key];
                });
                return copy;
            });
        }));

        const status = await client.from('mfo_section_status').select('*').eq('packet_id', packetId);
        state.sectionStatus = {};
        (status.data || []).forEach((row) => { state.sectionStatus[row.section_code] = row; });

        const filesQuery = state.packet.submission_id
            ? client.from('wf_submission_files').select('*').or(`mfo_packet_id.eq.${packetId},submission_id.eq.${state.packet.submission_id}`)
            : client.from('wf_submission_files').select('*').eq('mfo_packet_id', packetId);
        const files = await filesQuery.order('mfo_sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true, nullsFirst: false });
        if (files.error) warn('evidence files', files.error);

        const docIds = (state.rows.mfo_documentation_items || []).map((r) => r.id).filter(isUuid);
        const recordIds = SECTIONS.filter((d) => !d.isDocumentation).flatMap((d) => (state.rows[d.table] || []).map((r) => r.id)).filter(isUuid);
        const [byDoc, byRecord] = await Promise.all([
            docIds.length ? client.from('wf_submission_files').select('*').in('mfo_documentation_id', docIds) : Promise.resolve({ data: [] }),
            recordIds.length ? client.from('wf_submission_files').select('*').in('mfo_record_id', recordIds) : Promise.resolve({ data: [] })
        ]);

        const unique = new Map();
        [...(files.data || []), ...(byDoc.data || []), ...(byRecord.data || [])].forEach((f) => {
            const key = String(f.id || `${f.storage_path || f.file_path || ''}:${f.file_name || ''}`);
            if (key) unique.set(key, f);
        });
        state.files = [...unique.values()];
        void hydrateFileDisplayUrls(state.files).catch((e) => warn('sign files', e));

        const backup = loadLocalBackup();
        if (backup?.rows) {
            SECTIONS.forEach((def) => {
                if (!state.rows[def.table]?.length && backup.rows[def.table]?.length) {
                    state.rows[def.table] = backup.rows[def.table];
                }
            });
            if (backup.sectionStatus) {
                state.sectionStatus = { ...backup.sectionStatus, ...state.sectionStatus };
            }
            if (backup.profileOverrides && typeof backup.profileOverrides === 'object') {
                state.profileOverrides = { ...backup.profileOverrides, ...(state.profileOverrides || {}) };
            }
            if (PAPER_SIZES.some((item) => item.id === backup.paperSize)) state.paperSize = backup.paperSize;
        }
        const savedDept = String(state.packet?.department || '').trim();
        const profileDept = String(state.faculty?.department || '').trim();
        if (savedDept && savedDept !== profileDept && !Object.prototype.hasOwnProperty.call(state.profileOverrides, 'department')) {
            state.profileOverrides.department = savedDept;
        }
    }

    function getBackupKey() {
        const facId = state.faculty?.id || 'fac';
        const year = state.period?.reporting_year || 'cy';
        const qtr = state.period?.quarter || 'q';
        return `citeflow_mfo_backup:${facId}:${year}:${qtr}`;
    }

    function saveLocalBackup() {
        if (state.reviewerMode) return;
        try {
            const data = {
                facultyId: state.faculty?.id,
                period: state.period,
                packet: state.packet,
                rows: state.rows,
                sectionStatus: state.sectionStatus,
                profileOverrides: state.profileOverrides || {},
                paperSize: state.paperSize || 'a4',
                lastSaved: new Date().toISOString()
            };
            localStorage.setItem(getBackupKey(), JSON.stringify(data));
        } catch (e) {
            warn('saveLocalBackup', e);
        }
    }

    function loadLocalBackup() {
        try {
            const raw = localStorage.getItem(getBackupKey());
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            warn('loadLocalBackup', e);
            return null;
        }
    }

    function getBlankSections() {
        return SECTIONS.filter((def) => !def.isDocumentation && !(state.rows[def.table] || []).length);
    }

    function areBlankSectionsNa() {
        const blanks = getBlankSections();
        if (!blanks.length) return false;
        return blanks.every((def) => !!state.sectionStatus[def.code]?.is_not_applicable);
    }

    function autoMarkBlankSectionsAsNa() {
        getBlankSections().forEach((def) => {
            state.sectionStatus[def.code] = {
                ...(state.sectionStatus[def.code] || { section_code: def.code }),
                is_not_applicable: true,
                completeness: 'not_applicable'
            };
        });
        saveLocalBackup();
    }

    function undoBlankSectionsNa() {
        getBlankSections().forEach((def) => {
            state.sectionStatus[def.code] = {
                ...(state.sectionStatus[def.code] || { section_code: def.code }),
                is_not_applicable: false,
                completeness: 'empty'
            };
        });
        saveLocalBackup();
    }

    function toggleAutoNaBlanks() {
        if (areBlankSectionsNa()) {
            undoBlankSectionsNa();
            render();
            toast('Reverted N/A on blank sections.');
        } else {
            autoMarkBlankSectionsAsNa();
            render();
            toast('Marked all blank sections as N/A.');
        }
    }

    // -------------------------------------------------------------------
    // Auto-population from other CITE-Flow records (shared/mfo-sources.js)
    // -------------------------------------------------------------------
    function sourcesApi() { return global.CiteFlowMfoSources || null; }

    async function suggestFromSystem() {
        if (state.locked) return;
        const api = sourcesApi();
        if (!api) { state.sourceWarning = 'Automatic data retrieval is unavailable. All fields are open for manual entry.'; return; }

        let loaded;
        try { loaded = await api.loadSources(db(), { facultyIds: [state.faculty.id], period: state.period }); }
        catch (error) { warn('loadSources failed', error); state.sourceWarning = 'Automatic data retrieval failed. You can still complete the report manually.'; return; }

        if ((loaded.errors || []).length) {
            state.sourceWarning = `Some records could not be read automatically (${loaded.errors.map((e) => e.table).join(', ')}). Those fields are open for manual entry.`;
        }

        let candidates;
        try { candidates = api.buildCandidates(loaded, { period: state.period, includeUndated: true }); }
        catch (error) { warn('buildCandidates failed', error); return; }

        let added = 0, filled = 0;
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
            let forSection = candidates[def.code];
            if (!forSection?.length) return;
            if (def.code === 'mfo1_pi7') {
                forSection = forSection.map((candidate) => {
                    const fields = { ...(candidate.fields || {}) };
                    delete fields.role;
                    return { ...candidate, fields };
                }).filter((candidate) => Object.keys(candidate.fields || {}).length);
            }
            if (!forSection.length) return;
            try {
                const result = api.mergeCandidates(state.rows[def.table] || [], forSection, {
                    newRow: () => Object.assign(emptyRow(def), { faculty_id: state.faculty.id }),
                    refreshSystemValues: false
                });
                state.rows[def.table] = result.rows;
                added += result.added; filled += result.filled;
                if (result.added && state.sectionStatus[def.code]?.is_not_applicable) {
                    state.sectionStatus[def.code].is_not_applicable = false;
                    state.sectionStatus[def.code].completeness = 'draft';
                }
            } catch (error) { warn('merge failed for', def.table, error); }
        });

        state.sourceAccomplishments = loaded.rows.faculty_accomplishments || [];
        state.autoSummary = { added, filled };
    }

    function textValue(v) { return String(v || '').trim(); }

    function linkDocumentationToMappedRows() {
        (state.rows.mfo_documentation_items || []).forEach((doc) => {
            if (textValue(doc.source_table) !== 'faculty_accomplishments' || !doc.source_id) return;
            const table = textValue(doc.record_table);
            if (!table || !state.rows[table]) return;
            const match = state.rows[table].find((r) => textValue(r.source_table) === 'faculty_accomplishments' && String(r.source_id) === String(doc.source_id));
            if (match && isUuid(match.id)) doc.record_id = match.id;
        });
    }
    function fileAlreadyLinked(fileUrl, docId) {
        return (state.files || []).some((f) => String(f.file_url || '') === String(fileUrl || '')
            && (String(f.mfo_documentation_id || '') === String(docId || '') || String(f.mfo_record_id || '') === String(docId || '')));
    }
    function attachReferencedAccomplishmentPhotos(loaded) {
        const api = sourcesApi();
        if (!api?.accomplishmentPhotos) return;
        const byId = new Map((loaded?.rows?.faculty_accomplishments || []).map((r) => [String(r.id), r]));
        state.files = state.files || [];
        (state.rows.mfo_documentation_items || []).forEach((doc) => {
            if (textValue(doc.source_table) !== 'faculty_accomplishments' || !doc.source_id) return;
            const source = byId.get(String(doc.source_id));
            if (!source) return;
            api.accomplishmentPhotos(source).forEach((ref) => {
                if (fileAlreadyLinked(ref.file_url, doc.id)) return;
                state.files.push({
                    id: `ref-${ref.source_ref}`, file_url: ref.file_url, file_name: ref.file_name,
                    mfo_caption: ref.mfo_caption || '', mfo_section: doc.section_code, mfo_record_id: doc.id,
                    mfo_documentation_id: isUuid(doc.id) ? doc.id : null, mfo_packet_id: state.packet?.id || null,
                    storage_path: '', file_path: '', referenced_from: 'faculty_accomplishments', source_ref: ref.source_ref
                });
            });
        });
    }
    async function persistReferencedEvidence() {
        if (state.locked) return;
        const api = sourcesApi();
        if (!api?.accomplishmentPhotos) return;
        if (!state.submission?.id) await ensurePacket();
        if (!state.submission?.id) return;
        const byId = new Map((state.sourceAccomplishments || []).map((r) => [String(r.id), r]));
        for (const doc of (state.rows.mfo_documentation_items || [])) {
            if (!isUuid(doc.id) || textValue(doc.source_table) !== 'faculty_accomplishments') continue;
            const source = byId.get(String(doc.source_id));
            if (!source) continue;
            for (const ref of api.accomplishmentPhotos(source)) {
                if (fileAlreadyLinked(ref.file_url, doc.id)) continue;
                try {
                    await insertEvidenceFile({
                        submission_id: state.submission.id, file_name: ref.file_name, file_url: ref.file_url,
                        storage_path: '', mfo_section: doc.section_code, mfo_record_id: doc.id,
                        mfo_documentation_id: doc.id, mfo_packet_id: state.packet?.id || null, mfo_caption: ref.mfo_caption || null
                    });
                } catch (error) {
                    warn('referenced accomplishment photo not linked', error);
                    if (isPermissionError(error)) throw error;
                }
            }
        }
    }
    // -------------------------------------------------------------------
    // Editing
    // -------------------------------------------------------------------
    function updateRow(table, index, key, input) {
        const row = state.rows[table]?.[index];
        if (!row || state.locked || state.busy) return;
        row[key] = input.type === 'checkbox' ? input.checked : input.value;
        if (input && input.setAttribute) input.setAttribute('data-mfo-touched', '1');
        sourcesApi()?.markManual(row, key);
        if (table === 'mfo_extension_trainings') {
            const preview = document.getElementById(`manhours-${index}`);
            if (preview) preview.textContent = manhoursPreview(row);
        }
        if (input.type === 'checkbox') persistTable(table);
    }
    async function persistTable(table) {
        if (!state.packet?.id || state.locked || state.busy) return;
        const def = SECTIONS.find((d) => d.table === table);
        if (!def) return;
        try { await requireSession(); await saveTable(def); state.lastSaved = new Date().toISOString(); }
        catch (error) { toast(friendlyError(error, 'Unable to save that change.'), 'error'); }
    }
    function addRow(table) {
        if (state.locked || state.busy) return;
        const def = SECTIONS.find((d) => d.table === table);
        if (!def) return;
        state.rows[table] = state.rows[table] || [];
        state.rows[table].push(emptyRow(def));
        if (state.sectionStatus[def.code]?.is_not_applicable) {
            state.sectionStatus[def.code] = {
                ...(state.sectionStatus[def.code] || { section_code: def.code }),
                is_not_applicable: false,
                completeness: 'draft'
            };
        }
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
        current.completeness = current.is_not_applicable ? 'not_applicable' : ((state.rows[SECTIONS.find((d) => d.code === code)?.table] || []).length ? 'draft' : 'empty');
        state.sectionStatus[code] = current;
        const y = window.scrollY;
        render();
        window.scrollTo({ top: y, behavior: 'auto' });
        persistSectionNa(code);
    }
    async function persistSectionNa(code) {
        if (!state.packet?.id || state.locked) return;
        try { await requireSession(); await saveOneSectionStatus(code); }
        catch (error) { toast(friendlyError(error, 'Unable to save the Not Applicable setting.'), 'error'); }
    }

    function updateNotes(input) {
        if (!state.packet || state.locked || state.busy) return;
        if (input && input.setAttribute) input.setAttribute('data-mfo-touched', '1');
        state.packet.notes = input.value;
        scheduleNotesSave();
    }
    let notesTimer = null;
    function scheduleNotesSave() {
        if (notesTimer) clearTimeout(notesTimer);
        notesTimer = setTimeout(() => { persistNotes().catch((e) => toast(friendlyError(e, 'Unable to save additional details.'), 'error')); }, 500);
    }
    async function persistNotes() {
        if (!state.packet?.id || state.locked || state.busy) return;
        try { await requireSession(); await updatePacket({ notes: state.packet.notes || null }); state.lastSaved = new Date().toISOString(); }
        catch (error) { toast(friendlyError(error, 'Unable to save additional details.'), 'error'); }
    }

    // -------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------
    async function updatePacket(payload) {
        const client = db(), packet = requirePacket();
        const result = await client.from('mfo_packets').update(payload).eq('id', packet.id).select('*').maybeSingle();
        if (result.error) throw result.error;
        const prior = state.packet || {};
        const next = { ...prior, ...(result.data || {}), ...payload };
        if (!Object.prototype.hasOwnProperty.call(payload, 'signature_data_url') && prior.signature_data_url && !next.signature_data_url) {
            next.signature_data_url = prior.signature_data_url;
            next.signature_name = prior.signature_name || null;
            next.signature_signed_at = prior.signature_signed_at || null;
        }
        state.packet = next;
        return state.packet;
    }

    function payloadFromRow(def, row, index) {
        const packet = requirePacket();
        const packetId = packet.id;
        const packetOwnerId = Number(packet.faculty_id);
        const signedInFacultyId = Number(state.faculty?.id);
        const facultyId = Number.isFinite(packetOwnerId) ? packetOwnerId : signedInFacultyId;
        if (!Number.isFinite(facultyId)) throw new Error('Unable to save MFO rows because this packet is not linked to a faculty record.');
        if (Number.isFinite(packetOwnerId) && Number.isFinite(signedInFacultyId) && packetOwnerId !== signedInFacultyId) {
            throw new Error('This MFO packet belongs to another faculty record, so its rows cannot be saved from this account.');
        }
        const payload = { packet_id: packetId, faculty_id: facultyId, sort_order: index, is_not_applicable: !!row.is_not_applicable, field_sources: sourcesApi()?.fieldSources(row) || {} };
        (def.fields || []).forEach((field) => {
            const key = field.key;
            if (key === 'authors_text') { payload.authors = textToAuthors(row.authors_text); return; }
            if (key === 'proponents_text' && def.table.includes('research') || key === 'proponents_text' && def.table.includes('extension')) {
                payload.proponents_text = row.proponents_text; payload.proponents = textToAuthors(row.proponents_text); return;
            }
            let value = row[key];
            if (value === '' || value === undefined) value = null;
            if (field.type === 'checkbox') value = !!row[key];
            payload[key] = value;
        });
        if (def.isDocumentation) {
            payload.section_code = row.section_code; payload.title = row.title || row.caption || '';
            payload.caption = payload.title; payload.activity_date = row.activity_date || null;
            payload.activity_time = row.activity_time || null; payload.venue = row.venue || null; payload.narrative = row.narrative || null;
        }
        if (def.table === 'mfo_extension_trainings' && !payload.manhours_formula) payload.manhours_formula = 'hours_x_beneficiaries';
        return payload;
    }

    function existingIdForRow(row, existingRows, usedIds) {
        if (isUuid(row.id)) return row.id;
        const sourceTable = textValue(row.source_table), sourceId = textValue(row.source_id);
        if (!sourceTable || !sourceId) return null;
        const match = existingRows.find((item) => !usedIds.has(item.id) && textValue(item.source_table) === sourceTable && String(item.source_id) === String(row.source_id));
        return match ? match.id : null;
    }

    async function saveTable(def) {
        const client = db(), packetId = requirePacket().id;
        const rows = state.rows[def.table] || [];
        let existingRows = [];
        try {
            const existing = await client.from(def.table).select('id, source_table, source_id').eq('packet_id', packetId);
            if (!existing.error) existingRows = existing.data || [];
        } catch (e) {
            warn('select existing', def.table, e);
        }
        const keep = [], usedIds = new Set();

        for (let i = 0; i < rows.length; i += 1) {
            const payload = payloadFromRow(def, rows[i], i);
            const existingId = existingIdForRow(rows[i], existingRows, usedIds);
            let result;
            try {
                if (existingId) {
                    result = await client.from(def.table).update(payload).eq('id', existingId).eq('packet_id', packetId).select('id').single();
                } else {
                    result = await client.from(def.table).insert(payload).select('id').single();
                }
                if (result.error) throw result.error;
                if (!result.data?.id) throw new Error('The record was not saved.');
                rows[i].id = result.data.id;
                keep.push(result.data.id);
                usedIds.add(result.data.id);
            } catch (insErr) {
                warn('saveTable row error', def.table, insErr);
                throw insErr;
            }
        }
        const extras = existingRows.map((r) => r.id).filter((id) => !keep.includes(id));
        if (extras.length) {
            const removed = await client.from(def.table).delete().eq('packet_id', packetId).in('id', extras);
            if (removed.error) throw removed.error;
        }
    }

    async function saveOneSectionStatus(code) {
        const def = SECTIONS.find((d) => d.code === code);
        if (!def || !state.packet?.id) return;
        const client = db();
        const rows = state.rows[def.table] || [];
        const na = !!state.sectionStatus[def.code]?.is_not_applicable;
        const completeness = na ? 'not_applicable' : (rows.length ? 'draft' : 'empty');
        const payload = { packet_id: state.packet.id, section_code: def.code, is_not_applicable: na, completeness };
        const current = state.sectionStatus[def.code] || { section_code: def.code };
        try {
            const upserted = await client.from('mfo_section_status').upsert(payload, { onConflict: 'packet_id,section_code' }).select('*').maybeSingle();
            if (upserted.error) throw upserted.error;
            state.sectionStatus[def.code] = upserted.data ? { ...current, ...upserted.data } : { ...current, ...payload };
        } catch (error) {
            state.sectionStatus[def.code] = { ...current, ...payload };
            throw error;
        }
    }
    async function saveSectionStatus() { for (const def of SECTIONS) await saveOneSectionStatus(def.code); }

    function isBlankValue(value) {
        return value === null || value === undefined || String(value).trim() === '';
    }

    function syncLiveFormState() {
        const root = document.getElementById('mfoApp');
        if (!root) return state.rows;
        root.querySelectorAll('[data-mfo-table][data-mfo-key]').forEach((el) => {
            const table = el.getAttribute('data-mfo-table');
            const index = Number(el.getAttribute('data-mfo-index'));
            const key = el.getAttribute('data-mfo-key');
            const row = state.rows[table]?.[index];
            if (!row || !key || !Number.isInteger(index)) return;
            const value = el.type === 'checkbox' ? !!el.checked : el.value;
            const touched = el.getAttribute('data-mfo-touched') === '1';
            if (el.type !== 'checkbox' && isBlankValue(value) && !isBlankValue(row[key]) && !touched) return;
            row[key] = value;
        });
        root.querySelectorAll('input[data-mfo-na]').forEach((el) => {
            const code = el.getAttribute('data-mfo-na');
            if (!code) return;
            const current = state.sectionStatus[code] || { section_code: code };
            current.is_not_applicable = !!el.checked;
            current.completeness = current.is_not_applicable ? 'not_applicable' : ((state.rows[SECTIONS.find((d) => d.code === code)?.table] || []).length ? 'draft' : 'empty');
            state.sectionStatus[code] = current;
        });
        root.querySelectorAll('[data-mfo-profile]').forEach((el) => {
            const key = el.getAttribute('data-mfo-profile');
            if (!key || el.getAttribute('data-mfo-touched') !== '1') return;
            state.profileOverrides = state.profileOverrides || {};
            state.profileOverrides[key] = el.value;
            if (key === 'department' && state.packet) state.packet.department = el.value;
        });
        const notes = root.querySelector('[data-mfo-notes]');
        if (notes && state.packet) {
            const touched = notes.getAttribute('data-mfo-touched') === '1';
            if (!(isBlankValue(notes.value) && !isBlankValue(state.packet.notes) && !touched)) state.packet.notes = notes.value;
        }
        return state.rows;
    }

    function capturePdfRows() {
        const snap = {};
        SECTIONS.forEach((def) => {
            snap[def.table] = (state.rows[def.table] || []).map((row) => ({ ...row }));
        });
        return snap;
    }

    function rowsOf(table) {
        const source = state.pdfRows || state.rows || {};
        return source[table] || [];
    }

    async function saveDraftInternal() {
        syncLiveFormState();
        await requireSession();
        requirePacket();
        autoMarkBlankSectionsAsNa();
        try {
            await updatePacket({
                packet_state: statusLabel() === 'Returned for Revision' ? 'revision' : 'draft',
                period_label: state.period.period_label, reporting_year: state.period.reporting_year, quarter: state.period.quarter,
                period_start: state.period.period_start, period_end: state.period.period_end,
                academic_year: state.period.academic_year || null, semester: state.period.semester || null,
                department: reportProfileModel().department || state.packet.department, notes: state.packet?.notes || null
            });
        } catch (pktErr) {
            warn('updatePacket', pktErr);
            throw pktErr;
        }
        for (const def of SECTIONS) await saveTable(def);
        await persistReferencedEvidence();
        await saveSectionStatus();
        saveLocalBackup();
        state.lastSaved = new Date().toISOString();
    }

    async function saveDraft() {
        if (state.locked) { toast('This MFO is already submitted and cannot be edited until returned for revision.', 'error'); return; }
        syncLiveFormState();
        if (!beginBusy('Saving…')) return;
        try {
            await saveDraftInternal();
            toast('Draft saved successfully.');
        } catch (error) {
            saveLocalBackup();
            toast(friendlyError(error, 'The MFO could not be saved.'), 'error');
        } finally {
            endBusy();
        }
    }

    function missingSections() {
        return SECTIONS.filter((def) => {
            if (def.isDocumentation) return false;
            const na = !!state.sectionStatus[def.code]?.is_not_applicable;
            return !na && !(state.rows[def.table] || []).length;
        });
    }

    const SUBMITTED_MFO_PDF_MARKER = 'submitted_mfo_pdf';
    const SUBMITTED_MFO_PDF_FILE = 'MFO-Accomplishment-Report.pdf';

    function isSubmittedMfoPdf(file) {
        if (String(file?.mfo_indicator || '') === SUBMITTED_MFO_PDF_MARKER) return true;
        return /\/submitted-report\/MFO-Accomplishment-Report\.pdf$/i.test(String(file?.storage_path || file?.file_path || ''));
    }

    function loadScriptOnce(src) {
        const present = Array.from(document.scripts).some((script) => script.src === src);
        if (present) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Unable to load the PDF generator.'));
            document.head.appendChild(script);
        });
    }

    async function loadPdfLibraries() {
        if (typeof global.html2canvas !== 'function') {
            await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        }
        if (!global.jspdf?.jsPDF) {
            await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        if (typeof global.html2canvas !== 'function' || !global.jspdf?.jsPDF) {
            throw new Error('The PDF generator did not start.');
        }
    }

    const PAPER_SIZES = [
        { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
        { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
        { id: 'legal', label: 'Legal', widthMm: 215.9, heightMm: 355.6 },
        { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 }
    ];

    function mmToPx(mm) { return Math.round((Number(mm) / 25.4) * 96); }

    function selectedPaper() {
        const picked = document.querySelector('[data-mfo-paper]');
        if (picked && PAPER_SIZES.some((item) => item.id === picked.value)) state.paperSize = picked.value;
        const match = PAPER_SIZES.find((item) => item.id === state.paperSize) || PAPER_SIZES[0];
        return {
            ...match,
            widthPx: mmToPx(match.widthMm),
            heightPx: mmToPx(match.heightMm)
        };
    }

    function setPaperSize(value) {
        state.paperSize = PAPER_SIZES.some((item) => item.id === value) ? value : 'a4';
        saveLocalBackup();
    }

    function pdfUnitKind(node) {
        if (node.classList.contains('mfo-pdf-page')) return 'break';
        if (node.classList.contains('mfo-doc-group')) return 'group';
        if (node.classList.contains('mfo-doc-pi')) return 'pi';
        if (node.tagName === 'TR' && node.parentElement && node.parentElement.tagName === 'THEAD') return 'head';
        if (node.tagName === 'TR') {
            const cells = Array.from(node.children);
            if (cells.length === 1 && cells[0].tagName === 'TD' && cells[0].hasAttribute('colspan')) return 'extra';
            return 'row';
        }
        return 'block';
    }

    function paginateMfoUnits(units, pageHeightPx, totalHeight) {
        const pageH = Math.max(1, pageHeightPx);
        const total = Math.max(Number(totalHeight) || 0, units.length ? units[units.length - 1].bottom : 0, 1);
        const starts = [0];
        let pageStart = 0;

        function pushStart(y) {
            const n = Math.round(y);
            if (n <= Math.round(pageStart) + 1 || n >= total - 1) return false;
            starts.push(n);
            pageStart = n;
            return true;
        }

        function breakBefore(index) {
            const unit = units[index];
            const previousBottom = index > 0 ? units[index - 1].bottom : 0;
            const y = Math.min(unit.top, Math.max(previousBottom, unit.top - (unit.marginTop || 0)));
            pushStart(y);
        }

        function sliceOverflow(bottom) {
            let guard = 0;
            while (bottom > pageStart + pageH + 1 && guard < 80) {
                const before = pageStart;
                if (!pushStart(pageStart + pageH)) break;
                if (pageStart <= before + 1) break;
                guard += 1;
            }
        }

        function bundleEnd(index) {
            const kind = units[index].kind;
            let end = index + 1;
            if (kind === 'group' && units[end] && units[end].kind === 'pi') end += 1;
            if ((kind === 'group' || kind === 'pi' || kind === 'head') && units[end] && units[end].kind === 'head') end += 1;
            if ((kind === 'group' || kind === 'pi' || kind === 'head') && units[end] && units[end].kind === 'row') {
                end += 1;
                if (units[end] && units[end].kind === 'extra') end += 1;
            } else if (kind === 'row' && units[end] && units[end].kind === 'extra') {
                end += 1;
            }
            return end;
        }

        let index = 0;
        while (index < units.length) {
            const unit = units[index];
            if (unit.kind === 'break' && unit.top > pageStart + 1) breakBefore(index);
            const end = bundleEnd(index);
            const last = units[end - 1];
            const opening = unit.kind === 'group' || unit.kind === 'pi' || unit.kind === 'head';
            const needed = last.bottom - Math.min(unit.top, Math.max(index > 0 ? units[index - 1].bottom : 0, unit.top - (unit.marginTop || 0)));
            const fitsHere = last.bottom <= pageStart + pageH + 0.5;
            if (!fitsHere && unit.top > pageStart + 1) {
                const room = pageStart + pageH - unit.top;
                if (needed <= pageH + 0.5 || opening || unit.kind === 'row' || unit.kind === 'extra' || room < 40) {
                    breakBefore(index);
                }
            }
            if (last.bottom > pageStart + pageH + 0.5) sliceOverflow(last.bottom);
            index = end;
        }
        sliceOverflow(total);

        const points = [...new Set([0, ...starts.map((n) => Math.round(n)), Math.round(total)])]
            .filter((n) => n >= 0 && n <= Math.round(total))
            .sort((a, b) => a - b);
        const pages = [];
        for (let point = 0; point < points.length - 1; point += 1) {
            let cursor = points[point];
            const limit = points[point + 1];
            while (cursor < limit - 0.5) {
                const sliceEnd = Math.min(cursor + pageH, limit);
                if (sliceEnd <= cursor) break;
                pages.push({ start: cursor, height: sliceEnd - cursor });
                cursor = sliceEnd;
            }
        }
        if (!pages.length) pages.push({ start: 0, height: Math.min(total, pageH) });
        const covered = pages[pages.length - 1].start + pages[pages.length - 1].height;
        if (covered < total - 2) throw new Error('The MFO PDF did not include the end of the report.');
        return { total, pages };
    }

    function planPdfPages(root, pageHeightPx) {
        const total = Math.max(root.scrollHeight, root.offsetHeight);
        const rootRect = root.getBoundingClientRect();
        const units = Array.from(root.querySelectorAll('.mfo-pdf-unit')).filter((node) => !node.querySelector('.mfo-pdf-unit')).map((node) => {
            const rect = node.getBoundingClientRect();
            const top = rect.top - rootRect.top + root.scrollTop;
            let marginTop = 0;
            try { marginTop = parseFloat(getComputedStyle(node).marginTop) || 0; } catch (_) { marginTop = 0; }
            return { top, bottom: top + rect.height, marginTop, kind: pdfUnitKind(node) };
        }).filter((unit) => unit.bottom - unit.top > 1).sort((a, b) => a.top - b.top);
        return paginateMfoUnits(units, pageHeightPx, total);
    }

    async function imageBlobForPdf(file) {
        const path = String(file?.storage_path || file?.file_path || '').trim();
        if (path) {
            const downloaded = await db().storage.from(BUCKET).download(path);
            if (!downloaded.error && downloaded.data) return downloaded.data;
            warn('pdf photo download', path, downloaded.error);
        }
        const src = String(file?.pdf_data_url || fileDisplaySrc(file) || '').trim();
        if (!src) throw new Error('The documentation photo has no stored image.');
        if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('http')) {
            const res = await fetch(src);
            if (!res.ok) throw new Error(`Could not read the documentation photo (${res.status}).`);
            return res.blob();
        }
        throw new Error('The documentation photo could not be read.');
    }

    function rasterizeBlob(blob) {
        return blobToDataUrl(blob).then((dataUrl) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const maxW = 1400;
                const nw = img.naturalWidth || 0;
                const nh = img.naturalHeight || 0;
                if (!nw || !nh) { reject(new Error('The photo has no visible pixels.')); return; }
                const scale = Math.min(1, maxW / nw);
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(nw * scale));
                canvas.height = Math.max(1, Math.round(nh * scale));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height });
            };
            img.onerror = () => reject(new Error('The documentation photo could not be decoded.'));
            img.src = dataUrl;
        }));
    }

    async function embedDocumentationImages() {
        const photos = [];
        reportPhotoEntries().forEach((entry) => (entry.photos || []).forEach((file) => photos.push(file)));
        for (const file of photos) {
            const label = String(file.mfo_caption || file.file_name || 'documentation photo').trim();
            try {
                const raster = await rasterizeBlob(await imageBlobForPdf(file));
                if (!/^data:image\/jpeg/i.test(raster.dataUrl) || !raster.width || !raster.height) {
                    throw new Error('decoded image was empty');
                }
                file.pdf_data_url = raster.dataUrl;
                file.pdf_px_w = raster.width;
                file.pdf_px_h = raster.height;
            } catch (error) {
                warn('embed documentation photo', label, error);
                throw new Error(`The photo “${label}” could not be placed in the PDF. Upload it again as a JPG, PNG, or WebP image.`);
            }
        }
    }

    async function inlineCaptureImages(root) {
        const images = Array.from(root.querySelectorAll('img'));
        await Promise.all(images.map(async (img) => {
            const src = String(img.getAttribute('src') || '').trim();
            if (!src || src.startsWith('data:')) return;
            try {
                const absolute = new URL(src, window.location.href).href;
                img.src = await urlToDataUrl(absolute);
            } catch (error) {
                warn('pdf image', src, error);
            }
        }));
    }

    function waitForImages(root) {
        const images = Array.from(root.querySelectorAll('img'));
        return Promise.all(images.map((img) => {
            if (img.complete && img.naturalWidth) return Promise.resolve();
            return new Promise((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
                setTimeout(resolve, 2500);
            });
        }));
    }

    function assertEmbeddedPhotos(stage, expected) {
        const imgs = Array.from(stage.querySelectorAll('.mfo-doc-photo img'));
        if (imgs.length !== expected) {
            throw new Error('The PDF is missing one or more documentation photos.');
        }
        imgs.forEach((img) => {
            const src = String(img.getAttribute('src') || img.src || '');
            if (!/^data:image\/jpeg/i.test(src) || !img.naturalWidth || !img.naturalHeight) {
                throw new Error('A documentation photo was not embedded as an image.');
            }
        });
    }

    async function buildSubmittedMfoPdfBlob() {
        syncLiveFormState();
        state.pdfRows = capturePdfRows();
        await embedDocumentationImages();
        const expectedPhotos = reportPhotoEntries().reduce((count, entry) => count + (entry.photos || []).length, 0);
        const wasPrinting = state.printing;
        state.printing = true;
        let html = '';
        try { html = renderReportDocument(); }
        catch (error) { state.pdfRows = null; throw error; }
        finally { state.printing = wasPrinting; }

        const paper = selectedPaper();
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = `position:absolute;left:0;top:0;width:${paper.widthPx}px;height:auto;overflow:visible;z-index:12000;pointer-events:none;background:#fff;`;
        stage.innerHTML = `<style>
            #mfoPdfCapture, #mfoPdfCapture * { font-family: 'Times New Roman', Times, serif; box-sizing: border-box; }
            #mfoPdfCapture, #mfoPdfCapture .mfo-doc { overflow: visible !important; height: auto !important; max-height: none !important; }
            #mfoPdfCapture .mfo-doc { position: relative; width:${paper.widthPx}px; max-width:${paper.widthPx}px; margin:0; padding:45px 40px; box-shadow:none; border:0; border-radius:0; background:#fff; color:#000; }
            #mfoPdfCapture .mfo-doc-head img { width:409px; max-width:100%; height:auto; }
            #mfoPdfCapture .mfo-doc-foot img { width:572px; max-width:100%; height:auto; }
            #mfoPdfCapture .mfo-doc-photos { display:block; }
            #mfoPdfCapture .mfo-doc-photo { width:auto; max-width:min(160mm, 100%); margin-top:8px; }
            #mfoPdfCapture .mfo-doc-photo img { display:block; max-width:100%; height:auto; object-fit:contain; background:#fff; border:1px solid #000; }
            #mfoPdfCapture .mfo-doc table { display:table !important; width:100% !important; overflow:visible !important; }
            #mfoPdfCapture .mfo-doc thead { display:table-header-group !important; }
            #mfoPdfCapture .mfo-doc tbody { display:table-row-group !important; }
            #mfoPdfCapture .mfo-doc tr { display:table-row !important; }
            #mfoPdfCapture .mfo-doc th, #mfoPdfCapture .mfo-doc td { display:table-cell !important; min-width:0 !important; overflow-wrap:anywhere; }
        </style><div id="mfoPdfCapture">${html}</div>`;
        document.body.appendChild(stage);
        const previousScroll = window.scrollY;
        window.scrollTo(0, 0);
        try {
            await inlineCaptureImages(stage);
            await waitForImages(stage);
            if (document.fonts?.ready) await document.fonts.ready;
            assertEmbeddedPhotos(stage, expectedPhotos);
            const source = stage.querySelector('#mfoReportDoc');
            if (!source) throw new Error('The MFO report could not be prepared for PDF.');
            assertReportText(source);
            await loadPdfLibraries();
            const plan = planPdfPages(source, paper.heightPx);
            const { jsPDF } = global.jspdf;
            const format = [paper.widthMm, paper.heightMm];
            const pdf = new jsPDF({ unit: 'mm', format, orientation: 'portrait' });
            const mediaW = pdf.internal.pageSize.getWidth();
            const mediaH = pdf.internal.pageSize.getHeight();
            if (Math.abs(mediaW - paper.widthMm) > 0.4 || Math.abs(mediaH - paper.heightMm) > 0.4) {
                throw new Error('The PDF page size does not match the selected paper.');
            }
            for (let index = 0; index < plan.pages.length; index += 1) {
                const page = plan.pages[index];
                const canvas = await global.html2canvas(source, {
                    scale: 2,
                    x: 0,
                    y: page.start,
                    width: paper.widthPx,
                    height: page.height,
                    windowWidth: paper.widthPx,
                    windowHeight: plan.total,
                    scrollX: 0,
                    scrollY: 0,
                    backgroundColor: '#ffffff',
                    useCORS: true,
                    logging: false,
                    onclone(doc) {
                        doc.querySelectorAll('#mfoReportDoc table').forEach((table) => {
                            table.style.display = 'table';
                            table.style.width = '100%';
                            table.style.tableLayout = 'fixed';
                        });
                        doc.querySelectorAll('#mfoReportDoc th, #mfoReportDoc td').forEach((cell) => {
                            cell.style.display = 'table-cell';
                            cell.style.color = '#000';
                        });
                    }
                });
                if (!canvas || canvas.width < 10 || canvas.height < 10) {
                    throw new Error('A page of the MFO PDF could not be rendered.');
                }
                if (index) pdf.addPage(format, 'portrait');
                const drawH = paper.heightMm * (page.height / paper.heightPx);
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, paper.widthMm, Math.min(paper.heightMm, drawH));
            }
            if (pdf.getNumberOfPages() < plan.pages.length) throw new Error('The MFO PDF is missing pages.');
            const blob = pdf.output('blob');
            if (!blob || blob.size < 1000) throw new Error('The MFO PDF was empty.');
            return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
        } finally {
            state.pdfRows = null;
            stage.remove();
            window.scrollTo(0, previousScroll);
        }
    }

    function assertReportText(root) {
        const text = String(root.textContent || '');
        const profile = reportProfileModel();
        [profile.fullName, profile.employeeId, profile.department, profile.program, profile.rank, profile.chairperson]
            .map((value) => String(value || '').trim())
            .filter((value) => value && value !== '—' && value !== 'N/A')
            .forEach((value) => {
                if (!text.includes(value)) throw new Error(`The PDF is missing ${value}.`);
            });
        const missingSection = SECTIONS.find((def) => !def.isDocumentation && def.group && !text.includes(def.group));
        if (missingSection) throw new Error('The PDF is missing an MFO section.');
        if (!text.includes('Other accomplishment')) throw new Error('The PDF is missing the closing accomplishment section.');
        const missingRecords = [];
        SECTIONS.forEach((def) => {
            if (def.isDocumentation) return;
            rowsOf(def.table).forEach((row, index) => {
                (def.fields || []).forEach((field) => {
                    if (field.type === 'checkbox' || field.key === 'section_code') return;
                    let value = String(row[field.key] ?? '').trim();
                    if (!value) return;
                    if (field.type === 'date') value = reportDate(row[field.key]) || dateInputValue(row[field.key]);
                    else if (field.type === 'select') value = DOC_LABELS[row[field.key]] || value.replace(/_/g, ' ');
                    if (!value || text.includes(value)) return;
                    missingRecords.push(`${def.title || def.code} row ${index + 1} ${field.label}`);
                });
            });
        });
        const notes = String(state.packet?.notes || '').trim();
        if (notes && !text.includes(notes)) missingRecords.push('Other accomplishments');
        if (missingRecords.length) throw new Error(`The PDF is missing saved MFO records: ${missingRecords.slice(0, 4).join('; ')}`);
    }

    async function uploadSubmittedPdf(path, blob) {
        const bucket = db().storage.from(BUCKET);
        // The bucket allows INSERT and DELETE for the faculty path, not UPDATE.
        // upsert:true is an update and is rejected once the PDF already exists.
        try { await bucket.remove([path]); } catch (error) { warn('replace submitted pdf object', error); }
        let uploaded = await bucket.upload(path, blob, { upsert: false, contentType: 'application/pdf' });
        if (uploaded.error && /already exists|duplicate/i.test(String(uploaded.error.message || ''))) {
            try { await bucket.remove([path]); } catch (error) { warn('replace submitted pdf object', error); }
            uploaded = await bucket.upload(path, blob, { upsert: false, contentType: 'application/pdf' });
        }
        if (uploaded.error) throw uploaded.error;
    }

    async function persistSubmittedMfoPdf(preparedBlob) {
        const packet = requirePacket();
        const submissionId = state.submission?.id;
        if (!submissionId) throw new Error('The submission record is missing, so the PDF could not be saved.');
        const blob = preparedBlob || await buildSubmittedMfoPdfBlob();
        const stablePath = `${state.faculty.id}/${state.task.id}/${packet.id}/submitted-report/${SUBMITTED_MFO_PDF_FILE}`;
        const listed = await db().from('wf_submission_files').select('*').eq('submission_id', submissionId);
        if (listed.error) throw listed.error;
        const matches = (listed.data || []).filter(isSubmittedMfoPdf).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        const existing = matches[0] || null;
        await uploadSubmittedPdf(stablePath, blob);
        const pub = db().storage.from(BUCKET).getPublicUrl(stablePath);
        const facultyName = String(state.faculty?.full_name || 'Faculty').replace(/[^\w.\-]+/g, '_');
        const row = {
            submission_id: submissionId,
            file_name: `MFO-Accomplishment-Report-${facultyName}.pdf`,
            file_url: pub.data?.publicUrl || '',
            storage_path: stablePath,
            mfo_section: null,
            mfo_indicator: SUBMITTED_MFO_PDF_MARKER,
            mfo_record_id: null,
            mfo_documentation_id: null,
            mfo_packet_id: packet.id
        };
        let saved;
        if (existing?.id) {
            const previousPath = String(existing.storage_path || existing.file_path || '');
            if (previousPath && previousPath !== stablePath) {
                try { await db().storage.from(BUCKET).remove([previousPath]); } catch (e) { warn('replace submitted pdf', e); }
            }
            saved = await db().from('wf_submission_files').update(row).eq('id', existing.id).select('*').single();
        } else {
            saved = await db().from('wf_submission_files').insert(row).select('*').single();
        }
        if (saved.error) throw saved.error;
        const extras = matches.filter((file) => String(file.id) !== String(saved.data.id));
        for (const extra of extras) {
            const extraPath = String(extra.storage_path || extra.file_path || '');
            if (extraPath && extraPath !== stablePath) {
                try { await db().storage.from(BUCKET).remove([extraPath]); } catch (e) { warn('remove duplicate submitted pdf', e); }
            }
            try { await db().from('wf_submission_files').delete().eq('id', extra.id); } catch (e) { warn('delete duplicate submitted pdf row', e); }
        }
        state.files = (state.files || []).filter((file) => !isSubmittedMfoPdf(file) || String(file.id) === String(saved.data.id));
        const idx = state.files.findIndex((file) => String(file.id) === String(saved.data.id));
        if (idx >= 0) state.files[idx] = saved.data;
        else state.files.push(saved.data);
    }

    async function backfillSubmittedMfoPdf() {
        if (state.reviewerMode || state.busy || !state.locked || !state.submission?.submitted_at || !state.packet?.id) return;
        try {
            const listed = await db().from('wf_submission_files').select('id, mfo_indicator, storage_path, file_path').eq('submission_id', state.submission.id);
            if (listed.error || (listed.data || []).some(isSubmittedMfoPdf)) return;
            await persistSubmittedMfoPdf();
        } catch (error) {
            warn('submitted mfo pdf', error);
        }
    }

    async function submitPacket() {
        if (state.busy) return;
        if (!state.task?.id) { toast(state.taskWarning || 'Ask an administrator to create an MFO task before submitting.', 'error'); return; }
        if (state.locked && statusLabel() !== 'Returned for Revision' && statusLabel() !== 'Declined') { toast('This MFO is already submitted.', 'error'); return; }
        const missing = missingSections();
        if (missing.length) {
            state.reviewOpen = true; render();
            toast('Mark empty sections as Not Applicable, or add at least one record, before submitting.', 'error');
            return;
        }
        const stage = await mfoApprovalStageForSubmitter();
        const reviewer = stage === 'chairperson' ? 'Chairperson review' : 'Admin final approval';
        state.pendingSubmitStage = stage;
        state.pendingSubmitReviewer = reviewer;
        state.submitModalOpen = true;
        render();
    }

    function closeSubmitModal() {
        state.submitModalOpen = false;
        render();
    }

    async function confirmSubmitPacket() {
        syncLiveFormState();
        state.submitModalOpen = false;
        if (!beginBusy('Submitting…')) return;
        const client = db();
        const previousSubmission = state.submission ? { ...state.submission } : null;
        const previousPacketState = state.packet?.packet_state || null;
        let markedSubmitted = false;
        try {
            await saveDraftInternal();
            const now = new Date().toISOString();
            const previousSubmittedAt = state.submission?.submitted_at || null;
            if (state.submission) state.submission.submitted_at = now;
            let pdfBlob;
            try {
                pdfBlob = await buildSubmittedMfoPdfBlob();
            } catch (pdfError) {
                if (state.submission) state.submission.submitted_at = previousSubmittedAt;
                throw pdfError;
            }
            const due = state.task?.deadline_at || state.task?.due_at;
            const late = !!(due && new Date(due) < new Date());
            const wasRevision = ['revision'].includes(String(state.submission?.status || '').toLowerCase()) || ['revision'].includes(String(state.submission?.approval_stage || '').toLowerCase());
            const stage = state.pendingSubmitStage || 'admin';
            const reviewer = state.pendingSubmitReviewer || 'Admin final approval';
            const payload = {
                task_id: state.task.id, faculty_id: state.faculty.id, submitted_at: now,
                status: late ? 'late' : 'submitted', is_late: late, submitted_status: late ? 'late' : 'on_time',
                approval_stage: stage, reviewed_by_name: null, reviewed_at: null, review_remarks: ''
            };
            if (wasRevision) payload.resubmission_count = Number(state.submission?.resubmission_count || 0) + 1;
            const saved = await client.from('wf_submissions').upsert(payload, { onConflict: 'task_id,faculty_id' }).select('*').single();
            if (saved.error) throw saved.error;
            state.submission = saved.data;
            markedSubmitted = true;
            const linked = await client.from('mfo_packets').update({
                packet_state: wasRevision ? 'resubmitted' : (late ? 'late' : 'submitted'), submission_id: saved.data.id
            }).eq('id', state.packet.id).select('id, submission_id').maybeSingle();
            if (linked.error) throw linked.error;
            state.packet.submission_id = linked.data?.submission_id || saved.data.id;
            await persistSubmittedMfoPdf(pdfBlob);
            await global.CiteFlowWorkflow?.recordSubmissionEvent?.(db(), {
                faculty: state.faculty, task: state.task, taskId: state.task.id, submissionId: saved.data.id, isResubmit: wasRevision
            });
            state.locked = true;
            toast(late ? `MFO submitted late — awaiting ${reviewer}.` : `MFO Report submitted. Status: ${statusLabel()}.`);
        } catch (error) {
            if (markedSubmitted && previousSubmission?.id) {
                try {
                    await client.from('wf_submissions').update({
                        status: previousSubmission.status || 'draft',
                        submitted_at: previousSubmission.submitted_at || null,
                        is_late: previousSubmission.is_late || false,
                        submitted_status: previousSubmission.submitted_status || null,
                        approval_stage: previousSubmission.approval_stage || null,
                        resubmission_count: previousSubmission.resubmission_count || 0
                    }).eq('id', previousSubmission.id);
                    state.submission = previousSubmission;
                    if (previousPacketState) {
                        await client.from('mfo_packets').update({ packet_state: previousPacketState }).eq('id', state.packet.id);
                        state.packet.packet_state = previousPacketState;
                    }
                } catch (revertError) { warn('revert failed submit', revertError); }
            }
            toast(friendlyError(error, 'Unable to submit the MFO report.'), 'error');
        } finally {
            state.reviewOpen = false;
            endBusy();
        }
    }

    // -------------------------------------------------------------------
    // File upload
    // -------------------------------------------------------------------
    async function uploadFile(code, table, index, input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file || state.locked || state.busy) return;
        if (file.size > MAX_FILE_BYTES) { toast('File must be 10 MB or smaller.', 'error'); return; }
        if (!ALLOWED_EXT.test(file.name) || fileIsImage({ file_name: file.name, content_type: file.type })) {
            toast('Allowed files: PDF, Word, and Excel.', 'error');
            return;
        }
        if (!beginBusy('Uploading…')) return;
        try {
            await requireSession();
            if (!state.task?.id) { toast(state.taskWarning || 'An assigned MFO task is required before files can be attached.', 'error'); return; }
            if (index >= 0 && state.rows[table]?.[index] && !isUuid(state.rows[table][index].id)) {
                const def = SECTIONS.find((d) => d.table === table);
                if (def) await saveTable(def);
            }
            if (!state.submission?.id) await ensurePacket();
            if (!state.submission?.id) { toast('Could not open a submission record. Please reload and try again.', 'error'); return; }
            const packet = requirePacket();
            const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${state.faculty.id}/${state.task.id}/${packet.id}/${Date.now()}-${safeName}`;
            const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
            if (uploaded.error) throw uploaded.error;
            const pub = db().storage.from(BUCKET).getPublicUrl(path);
            await insertEvidenceFileOrCleanUp({
                submission_id: state.submission.id,
                file_name: file.name, file_url: pub.data?.publicUrl || '', storage_path: path,
                mfo_section: code, mfo_indicator: SECTIONS.find((d) => d.code === code)?.title || null,
                mfo_record_id: isUuid(recordId) ? recordId : null, mfo_packet_id: packet.id
            }, path);
            toast('Documentation attached.');
        } catch (error) { toast(friendlyError(error, 'Unable to upload the file.'), 'error'); }
        finally { endBusy(); }
    }

    async function insertEvidenceFileOrCleanUp(row, storagePath) {
        try { return await insertEvidenceFile(row); }
        catch (error) {
            try { await db().storage.from(BUCKET).remove([storagePath]); } catch (e) { warn('cleanup failed', storagePath, e); }
            throw error;
        }
    }
    async function insertEvidenceFile(row) {
        const result = await db().from('wf_submission_files').insert(row).select('*').single();
        if (result.error) throw result.error;
        await resolveFileDisplayUrl(result.data);
        state.files.push(result.data);
        return result.data;
    }

    async function removeFile(fileId, options) {
        if (state.locked) return;
        const nested = !!options?.nested;
        if (!nested && state.busy) return;
        const file = state.files.find((f) => String(f.id) === String(fileId));
        if (!file) return;
        if (!nested && !beginBusy('Removing file…')) return;
        try {
            if (!isUuid(file.id)) { state.files = state.files.filter((f) => String(f.id) !== String(fileId)); render(); return; }
            const path = file.storage_path || file.file_path;
            if (path) await db().storage.from(BUCKET).remove([path]);
            const { error } = await db().from('wf_submission_files').delete().eq('id', fileId);
            if (error) throw error;
            state.files = state.files.filter((f) => String(f.id) !== String(fileId));
        } catch (error) { toast(friendlyError(error, 'Unable to remove the file.'), 'error'); }
        finally {
            if (!nested) {
                endBusy();
                if (state.viewPdfOpen) await refreshOpenPdfPreview();
            }
        }
    }

    // -------------------------------------------------------------------
    // Editor rendering
    // -------------------------------------------------------------------
    function fieldBadge(row, field) {
        const api = sourcesApi();
        if (!api) return '';
        const value = row[field.key];
        const blank = value === null || value === undefined || String(value).trim() === '';
        const provenance = api.provenanceOf(row, field.key);
        if (provenance === api.PROVENANCE.NA) return '<span class="mfo-flag mfo-flag-na">N/A</span>';
        if (!blank && provenance === api.PROVENANCE.SYSTEM) {
            const label = api.helpers.sourceLabel(row.source_table) || 'existing record';
            return `<span class="mfo-flag mfo-flag-auto" title="Retrieved from your ${esc(label)}"><i class="fa-solid fa-check text-[8px]"></i> Auto-filled</span>`;
        }
        if (!blank && provenance === api.PROVENANCE.MANUAL) return '<span class="mfo-flag mfo-flag-manual"><i class="fa-solid fa-pen text-[8px]"></i> Edited</span>';
        return '';
    }

    function fieldControl(def, row, index, field) {
        const disabled = (state.locked || state.busy) ? 'disabled' : '';
        const value = field.type === 'date' ? (dateInputValue(row[field.key]) || '') : (row[field.key] ?? '');
        const oninput = `CiteFlowMfoFaculty.updateRow('${def.table}', ${index}, '${field.key}', this)`;
        const meta = `data-mfo-table="${esc(def.table)}" data-mfo-index="${index}" data-mfo-key="${esc(field.key)}"`;
        if (field.type === 'textarea') return `<textarea class="mfo-field" rows="3" ${meta} ${disabled} oninput="${oninput}" placeholder="${esc(field.placeholder || 'Enter remarks or details…')}">${esc(value)}</textarea>`;
        if (field.type === 'select') {
            const options = (field.options || []).map((opt) => `<option value="${esc(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${esc(DOC_LABELS[opt] || opt.replace(/_/g, ' '))}</option>`).join('');
            return `<select class="mfo-field" ${meta} ${disabled} onchange="${oninput}">${options}</select>`;
        }
        if (field.type === 'checkbox') return `<label class="mfo-field-checkbox-wrap"><input type="checkbox" class="mfo-field-checkbox" ${meta} ${value ? 'checked' : ''} ${disabled} onchange="${oninput}"> <span>Yes</span></label>`;
        return `<input class="mfo-field" type="${field.type}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" ${meta} ${disabled} oninput="${oninput}">`;
    }

    function renderFiles(code, table, index) {
        const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
        const files = filesFor(code, isUuid(recordId) ? recordId : null);
        const list = files.filter((f) => !fileIsImage(f)).map((f) => `
            <div class="flex items-center justify-between gap-2 text-xs bg-white border border-slate-200 rounded-xl px-3 py-2">
                <a class="font-semibold text-[#621708] truncate" href="${esc(fileDisplaySrc(f) || '#')}" target="_blank" rel="noopener">${esc(f.file_name)}</a>
                ${state.locked || state.busy ? '' : `<button type="button" class="text-rose-600 font-bold" onclick="CiteFlowMfoFaculty.removeFile('${f.id}')">Remove</button>`}
            </div>`).join('');
        return `<div class="mt-3 space-y-2">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">File attachments</div>
            ${list || '<div class="text-xs text-slate-400">No files attached to this record yet.</div>'}
            ${state.locked || state.busy ? '' : `
                <button type="button" class="cite-action" onclick="this.nextElementSibling.click()">+ Add File</button>
                <input type="file" class="mfo-file-input" onchange="CiteFlowMfoFaculty.uploadFile('${code}', '${table}', ${index}, this)">`}
        </div>`;
    }

    function renderRecord(def, row, index) {
        const suggested = row.source_kind === 'suggested' || row.source_kind === 'imported';
        return `<div class="mfo-record mb-3">
            <div class="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-slate-100">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded-md px-2.5 py-1">
                        <i class="fa-regular fa-file-lines text-[#621708] text-[11px]"></i> Record ${index + 1}
                    </span>
                    ${suggested ? '<span class="mfo-chip text-[11px]">Suggested from record — verify</span>' : ''}
                </div>
                ${state.locked || state.busy ? '' : `<button type="button" class="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-800 p-1" onclick="CiteFlowMfoFaculty.removeRow('${def.table}', ${index})"><i class="fa-solid fa-trash-can text-[10px]"></i> Remove</button>`}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                ${def.fields.map((field) => `
                    <div class="${field.type === 'textarea' ? 'md:col-span-2' : ''}">
                        <label class="mfo-label"><span class="mfo-label-text">${esc(field.label)}</span>${fieldBadge(row, field)}</label>
                        ${fieldControl(def, row, index, field)}
                    </div>`).join('')}
            </div>
            ${def.table === 'mfo_extension_trainings' ? `
                <div class="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-sky-800">
                    <span class="mfo-chip mfo-chip-calc">System-calculated manhours</span>
                    <span id="manhours-${index}" class="ml-1 text-slate-700 font-mono">${esc(manhoursPreview(row))}</span>
                </div>` : ''}
            ${def.isDocumentation ? '' : renderFiles(def.code, def.table, index)}
        </div>`;
    }

    function renderFacultySection(def) {
        const na = !!state.sectionStatus[def.code]?.is_not_applicable;
        const rowIndexes = def.isDocumentation ? generalDocs().map(({ index }) => index) : (state.rows[def.table] || []).map((_, i) => i);
        return `<details class="mfo-section rounded-[16px] mb-3" open>
            <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                <div><div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">${esc(def.group)}</div>
                <div class="text-sm font-bold text-slate-900">${esc(def.title)}</div></div>
                <label class="mfo-na-toggle" aria-pressed="${na ? 'true' : 'false'}" onclick="event.stopPropagation();">
                    <input type="checkbox" data-mfo-na="${esc(def.code)}" ${na ? 'checked' : ''} ${state.locked || state.busy ? 'disabled' : ''} onclick="event.stopPropagation();" onchange="event.stopPropagation(); CiteFlowMfoFaculty.setSectionNa('${def.code}', this.checked)">
                    Not applicable (NA)
                </label>
                <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
            </summary>
            <div class="px-4 sm:px-5 pb-5">
                ${na ? '<p class="text-sm text-slate-500 mb-3">Marked N/A. Records already entered stay in the report with the N/A mark.</p>' : ''}
                ${rowIndexes.map((i) => renderRecord(def, state.rows[def.table][i], i)).join('') || '<p class="text-sm text-slate-500 mb-3">No records yet.</p>'}
                ${state.locked || state.busy ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">Add Record</button>`}
            </div>
        </details>`;
    }

    function renderProgramLocked() {
        return `<details class="mfo-section rounded-[16px] mb-3">
            <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                <div><div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">Program-owned sections</div>
                <div class="text-sm font-bold text-slate-900">Completed by the Program Chairperson</div></div>
                <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
            </summary>
            <div class="px-4 sm:px-5 pb-5 text-sm text-slate-600 space-y-2">
                <p><span class="mfo-chip mfo-chip-lock">View only</span> These MFO items are program-level and are not entered by individual faculty.</p>
                <ul class="list-disc pl-5 space-y-1">
                    <li>MFO 1 PI1 — Licensure passing percentage</li>
                    <li>MFO 1 PI2 — Graduate employment</li>
                    <li>Other accomplishments of the program (narrative)</li>
                </ul>
                <p>Your Chairperson completes these once for ${esc(state.faculty.department || 'your department')} after you submit.</p>
            </div>
        </details>`;
    }

    function renderReview() {
        if (!state.reviewOpen) return '';
        const missing = missingSections();
        const allNa = areBlankSectionsNa();
        const groups = SECTIONS.map((def) => {
            const rows = state.rows[def.table] || [];
            const na = !!state.sectionStatus[def.code]?.is_not_applicable;
            return `<div class="border-b border-slate-100 py-3 flex items-center justify-between"><div class="font-bold text-sm text-slate-900">${esc(def.title || def.group)}</div>
                <div class="text-xs ${na ? 'text-slate-500 font-semibold' : 'text-slate-700 font-medium'}">${na ? '<span class="mfo-chip mfo-chip-lock">N/A</span>' : `${rows.length} record(s)`}</div></div>`;
        }).join('');
        return `<div class="mfo-review-overlay" onclick="if(event.target===this){CiteFlowMfoFaculty.reviewOpen(false)}">
            <div class="mfo-review-dialog" role="dialog" aria-modal="true" aria-labelledby="mfoReviewTitle">
                <div class="mfo-review-header">
                    <div><h2 id="mfoReviewTitle" class="text-lg font-bold">Review MFO Report</h2>
                    <p class="text-sm text-slate-500 mt-1">${esc(state.period.period_label)} · ${esc(state.faculty.full_name)}</p></div>
                    <button type="button" class="mfo-review-close" aria-label="Close review" onclick="CiteFlowMfoFaculty.reviewOpen(false)">×</button>
                </div>
                <div class="mfo-review-body">
                    ${missing.length ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">Incomplete: ${missing.map((d) => esc(d.title || d.group)).join(', ')}. Mark NA or add records.</div>` : '<div class="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm font-semibold">All faculty sections have records or are marked NA.</div>'}
                    ${groups}
                </div>
                <div class="mfo-review-footer flex flex-col sm:flex-row items-center justify-between gap-2">
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.toggleAutoNaBlanks()">
                        ${allNa ? '<i class="fa-solid fa-rotate-left mr-1"></i> Undo N/A for Blanks' : '<i class="fa-solid fa-check-double mr-1"></i> Auto N/A All Blank'}
                    </button>
                    <div class="flex gap-2 w-full sm:w-auto justify-end">
                        <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewOpen(false)">Close</button>
                        <button type="button" class="cite-action-primary" ${state.busy || !state.task || missing.length ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">${state.busyLabel === 'Submitting…' ? 'Submitting…' : 'Submit MFO Report'}</button>
                    </div>
                </div>
            </div>
        </div>`;
    }

    function renderSubmitModal() {
        if (!state.submitModalOpen) return '';
        const reviewer = state.pendingSubmitReviewer || 'Admin final approval';
        return `<div class="mfo-review-overlay" onclick="if(event.target===this){CiteFlowMfoFaculty.closeSubmitModal()}">
            <div class="mfo-review-dialog" role="dialog" aria-modal="true" style="max-width: 480px;">
                <div class="mfo-review-header">
                    <div>
                        <h2 class="text-lg font-bold text-slate-900">Submit MFO Report</h2>
                        <p class="text-xs text-slate-500 mt-0.5">Accomplishment Report — CY ${esc(state.period?.reporting_year || '')}</p>
                    </div>
                    <button type="button" class="mfo-review-close" aria-label="Close" onclick="CiteFlowMfoFaculty.closeSubmitModal()">×</button>
                </div>
                <div class="mfo-review-body" style="padding-top: 18px; padding-bottom: 20px;">
                    <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center shrink-0 text-base border border-amber-200">
                            <i class="fa-solid fa-file-circle-check"></i>
                        </div>
                        <div class="text-sm text-slate-700 leading-relaxed">
                            Submit this MFO Report for <strong class="text-slate-900">${esc(reviewer)}</strong>?<br>
                            <span class="text-slate-500 text-xs mt-1 block">You will not be able to edit it unless it is returned for revision.</span>
                        </div>
                    </div>
                </div>
                <div class="mfo-review-footer flex flex-row justify-end gap-2">
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closeSubmitModal()">Cancel</button>
                    <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.confirmSubmitPacket()">Confirm & Submit</button>
                </div>
            </div>
        </div>`;
    }

    function renderReviewerModal() {
        const modal = state.reviewerModal;
        if (!modal) return '';
        const action = modal.action;
        const isApprove = action === 'approved';
        const isRevision = action === 'revision';
        const isDecline = action === 'rejected';

        const facultyName = state.faculty?.full_name || 'Faculty';
        const department = state.faculty?.department || state.faculty?.department_code || 'Program';
        const periodLabel = state.period?.period_label || 'Current Period';

        let title = 'Review Decision';
        let subtitle = 'MFO Accomplishment Report';
        let iconHtml = '';
        let confirmBtnText = 'Confirm';
        let confirmBtnStyle = 'background:#621708;border-color:#621708;color:#fff;';
        let promptText = '';
        let requireRemarks = false;
        let remarksPlaceholder = '';
        let remarksLabel = 'Optional remarks';

        if (isApprove) {
            title = state.reviewerIsAdmin ? 'Certify & Approve MFO Report' : 'Approve MFO Report';
            subtitle = state.reviewerIsAdmin ? 'Grant final institutional certification' : 'Advance report to Admin for final approval';
            iconHtml = `<div class="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 text-xl border border-emerald-200 shadow-xs">
                <i class="fa-solid fa-file-circle-check"></i>
            </div>`;
            confirmBtnText = state.reviewerIsAdmin ? 'Certify & Approve' : 'Approve Submission';
            confirmBtnStyle = 'background:#047857;border-color:#047857;color:#fff;';
            promptText = state.reviewerIsAdmin
                ? `You are granting final approval and certifying the quarterly accomplishment report for <strong>${esc(facultyName)}</strong> (${esc(department)}).`
                : `Approve this MFO Accomplishment Report for <strong>${esc(facultyName)}</strong> (${esc(department)}) and forward it to the Admin for final review.`;
            remarksPlaceholder = 'Add any commendations, notes, or remarks (optional)...';
        } else if (isRevision) {
            title = 'Request Revision';
            subtitle = 'Return report to submitter for corrections';
            iconHtml = `<div class="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 text-xl border border-amber-200 shadow-xs">
                <i class="fa-solid fa-rotate-left"></i>
            </div>`;
            confirmBtnText = 'Send Revision Request';
            confirmBtnStyle = 'background:#b45309;border-color:#b45309;color:#fff;';
            promptText = `Return this report to <strong>${esc(facultyName)}</strong>. The faculty member will be notified with your remarks so they can make corrections and resubmit.`;
            requireRemarks = true;
            remarksLabel = 'Revision Remarks (Required)';
            remarksPlaceholder = 'Detail the items, tables, or documentation that require updating...';
        } else if (isDecline) {
            title = 'Decline MFO Report';
            subtitle = 'Reject this report submission';
            iconHtml = `<div class="w-11 h-11 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0 text-xl border border-rose-200 shadow-xs">
                <i class="fa-solid fa-circle-xmark"></i>
            </div>`;
            confirmBtnText = 'Decline Submission';
            confirmBtnStyle = 'background:#be123c;border-color:#be123c;color:#fff;';
            promptText = `Decline the MFO Accomplishment Report submitted by <strong>${esc(facultyName)}</strong>. This will formally decline the submission.`;
            requireRemarks = true;
            remarksLabel = 'Reason for Decline (Required)';
            remarksPlaceholder = 'Specify the reason for declining this report...';
        }

        return `
        <div class="mfo-review-overlay" onclick="if(event.target===this){CiteFlowMfoFaculty.closeReviewerModal()}">
            <div class="mfo-review-dialog" role="dialog" aria-modal="true" style="max-width: 500px;">
                <div class="mfo-review-header">
                    <div>
                        <h2 class="text-lg font-bold text-slate-900">${esc(title)}</h2>
                        <p class="text-xs text-slate-500 mt-0.5">${esc(subtitle)}</p>
                    </div>
                    <button type="button" class="mfo-review-close" aria-label="Close" onclick="CiteFlowMfoFaculty.closeReviewerModal()">×</button>
                </div>
                <div class="mfo-review-body" style="padding-top: 16px; padding-bottom: 20px;">
                    <div class="flex items-start gap-3 mb-4">
                        ${iconHtml}
                        <div class="flex-1 min-w-0">
                            <p class="text-sm text-slate-700 leading-relaxed">${promptText}</p>
                            <div class="mt-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-0.5">
                                <div><span class="text-slate-400 font-medium">Faculty:</span> <strong class="text-slate-800">${esc(facultyName)}</strong></div>
                                <div><span class="text-slate-400 font-medium">Program:</span> <span class="text-slate-700 font-medium">${esc(department)}</span> · <span class="text-slate-500">${esc(periodLabel)}</span></div>
                            </div>
                        </div>
                    </div>

                    <div class="mt-3">
                        <label class="block text-xs font-bold text-slate-800 mb-1.5" for="mfoReviewCommentInput">
                            ${esc(remarksLabel)}
                            ${requireRemarks ? '<span class="text-rose-600 font-bold ml-0.5">*</span>' : ''}
                        </label>
                        <textarea
                            id="mfoReviewCommentInput"
                            class="mfo-field"
                            rows="${requireRemarks ? 3 : 2}"
                            placeholder="${esc(remarksPlaceholder)}"
                            oninput="CiteFlowMfoFaculty.updateReviewerModalComment(this.value)"
                            style="width: 100%; border-radius: 12px; font-size: 13px; line-height: 1.5; padding: 10px 12px;"
                        >${esc(modal.comment || '')}</textarea>
                        ${modal.error ? `<p id="mfoReviewCommentError" class="text-xs font-semibold text-rose-600 mt-1.5 flex items-center gap-1"><i class="fa-solid fa-circle-exclamation"></i> ${esc(modal.error)}</p>` : ''}
                    </div>
                </div>
                <div class="mfo-review-footer flex flex-row justify-end gap-2.5">
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closeReviewerModal()" style="border-radius: 10px;">Cancel</button>
                    <button type="button" class="cite-action-primary" style="${confirmBtnStyle}; border-radius: 10px; font-weight: 600;" onclick="CiteFlowMfoFaculty.confirmReviewerAction()">
                        ${esc(confirmBtnText)}
                    </button>
                </div>
            </div>
        </div>`;
    }

    // -------------------------------------------------------------------
    // Printable report — read-only, always. This is the whole point of the
    // rewrite: nothing here writes to state or the database. It only reads
    // state.rows / state.sectionStatus / state.packet and produces markup
    // that mirrors the official PDF layout.
    // -------------------------------------------------------------------
    function officialNaMark(code) {
        if (!code) return '';
        const na = !!state.sectionStatus[code]?.is_not_applicable;
        return ` <span class="mfo-doc-na">${na ? '☑' : '☐'} N/A</span>`;
    }

    function resolvePrintColumn(def, col, row, ctx) {
        if (Array.isArray(col)) {
            const [label, get] = col;
            let value = '';
            try { value = get(row, ctx); } catch (_) { value = ''; }
            return [label, tv(value)];
        }
        // col is a field key: derive label + formatted value from `fields`.
        const field = (def.fields || []).find((f) => f.key === col);
        const label = field?.label || col;
        let value = row[col];
        if (field?.type === 'date') value = reportDate(value);
        if (field?.type === 'select') value = String(value || '').replace(/_/g, ' ');
        return [label, tv(value)];
    }

    function extraFieldLine(def, row) {
        const printed = new Set((def.print || []).filter((col) => typeof col === 'string'));
        const bits = [];
        if (row.is_not_applicable) bits.push('Not applicable: Yes');
        (def.fields || []).forEach((field) => {
            if (printed.has(field.key)) return;
            if (field.type === 'checkbox') {
                if (row[field.key]) bits.push(`${field.label}: Yes`);
                return;
            }
            let value = row[field.key];
            if (value === null || value === undefined || String(value).trim() === '') return;
            if (field.type === 'date') value = reportDate(value) || value;
            if (field.type === 'select') value = DOC_LABELS[value] || String(value).replace(/_/g, ' ');
            bits.push(`${field.label}: ${value}`);
        });
        return bits.join(' · ');
    }

    function formTable(def, ctx) {
        const labels = def.print.map((col) => (Array.isArray(col) ? col[0] : (def.fields || []).find((f) => f.key === col)?.label || col));
        const head = labels.map((l) => `<th>${esc(l)}</th>`).join('');
        const rows = rowsOf(def.table);
        const blank = `<tr class="mfo-pdf-unit">${labels.map(() => `<td>${NA}</td>`).join('')}</tr>`;
        const body = rows.length
            ? rows.map((row) => {
                const cells = def.print.map((col) => `<td>${esc(resolvePrintColumn(def, col, row, ctx)[1])}</td>`).join('');
                const extra = extraFieldLine(def, row);
                return `<tr class="mfo-pdf-unit">${cells}</tr>${extra ? `<tr class="mfo-pdf-unit"><td colspan="${labels.length}">${esc(extra)}</td></tr>` : ''}`;
            }).join('')
            : blank;
        return `<table><thead><tr class="mfo-pdf-unit">${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function safePct(numerator, denominator) {
        const n = Number(numerator);
        const d = Number(denominator);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return '';
        return (Math.round((n / d) * 10000) / 100).toFixed(2);
    }

    function chairEditing() {
        return !!(state.reviewerMode && !state.reviewerIsAdmin);
    }

    function chairInputsEnabled() {
        return chairEditing() && reviewerCanAct() && !state.busy;
    }

    function programDepartment() {
        return String(state.packet?.department || state.faculty?.department || state.faculty?.department_code || '').trim();
    }

    function programDepartmentKeys() {
        return [state.packet?.department, state.faculty?.department, state.faculty?.department_code]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean);
    }

    function blankProgramRow() {
        return {
            id: null,
            exam_date: '',
            first_time_takers: '',
            first_time_passers: '',
            total_takers: '',
            total_passers: '',
            graduates_count: '',
            employed_count: '',
            is_not_applicable: false
        };
    }

    function programRowBlank(kind, row) {
        if (!row || row.is_not_applicable) return false;
        const keys = kind === 'pi1'
            ? ['exam_date', 'first_time_takers', 'first_time_passers', 'total_takers', 'total_passers']
            : ['graduates_count', 'employed_count'];
        return keys.every((key) => String(row[key] ?? '').trim() === '');
    }

    function programDraft() {
        if (!state.programPacket) {
            state.programPacket = { other_accomplishments: '', other_accomplishments_not_applicable: false };
        }
        return state.programPacket;
    }

    function chairFacultyId() {
        const id = Number(state.reviewerActor?.id);
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    function officialNarrativeText() {
        const facultyNotes = String(state.packet?.notes || '').trim();
        const packet = state.programPacket || {};
        const chairNotes = packet.other_accomplishments_not_applicable ? '' : String(packet.other_accomplishments || '').trim();
        if (facultyNotes && chairNotes) return `${facultyNotes}\n\n${chairNotes}`;
        return facultyNotes || chairNotes;
    }

    async function loadProgramPortion() {
        state.programRows = state.programRows || { pi1: [], pi2: [] };
        const taskId = state.task?.id || state.packet?.task_id || state.submission?.task_id || null;
        const keys = programDepartmentKeys();
        if (!taskId && !keys.length) {
            state.programPacket = null;
            state.programRows.pi1 = [];
            state.programRows.pi2 = [];
            return;
        }
        let query = db().from('mfo_program_packets').select('*');
        if (taskId) query = query.eq('task_id', taskId);
        const listed = await query.limit(40);
        if (listed.error) throw listed.error;
        const match = (listed.data || []).find((row) => keys.includes(String(row.department || '').trim().toLowerCase())) || null;
        if (!match?.id) {
            state.programPacket = null;
            state.programRows.pi1 = [];
            state.programRows.pi2 = [];
            return;
        }
        const [pi1, pi2] = await Promise.all([
            db().from('mfo_pi1_licensure').select('*').eq('program_packet_id', match.id).order('sort_order'),
            db().from('mfo_pi2_employment').select('*').eq('program_packet_id', match.id).order('sort_order')
        ]);
        if (pi1.error) throw pi1.error;
        if (pi2.error) throw pi2.error;
        state.programPacket = match;
        state.programRows.pi1 = pi1.data || [];
        state.programRows.pi2 = pi2.data || [];
    }

    function editorRows(kind) {
        state.programRows = state.programRows || { pi1: [], pi2: [] };
        if (!Array.isArray(state.programRows[kind])) state.programRows[kind] = [];
        if (!state.programRows[kind].length) state.programRows[kind].push(blankProgramRow());
        return state.programRows[kind];
    }

    function syncChairForm() {
        if (!chairEditing()) return;
        const draft = programDraft();
        document.querySelectorAll('[data-chair-kind="pi1"], [data-chair-kind="pi2"]').forEach((input) => {
            const kind = input.getAttribute('data-chair-kind');
            const index = Number(input.getAttribute('data-chair-index'));
            const key = input.getAttribute('data-chair-key');
            const row = state.programRows?.[kind]?.[index];
            if (!row || !key) return;
            row[key] = input.type === 'checkbox' ? input.checked : input.value;
        });
        const narrative = document.querySelector('[data-chair-kind="narrative"]');
        if (narrative) draft.other_accomplishments = narrative.value;
        const narrativeNa = document.querySelector('[data-chair-kind="narrative-na"]');
        if (narrativeNa) draft.other_accomplishments_not_applicable = narrativeNa.checked;
    }

    function updateProgramRow(kind, index, key, input) {
        if (!chairInputsEnabled()) return;
        const row = state.programRows?.[kind]?.[index];
        if (!row) return;
        row[key] = input.type === 'checkbox' ? input.checked : input.value;
        const pairs = kind === 'pi1'
            ? [['first', safePct(row.first_time_passers, row.first_time_takers)], ['overall', safePct(row.total_passers, row.total_takers)]]
            : [['employment', safePct(row.employed_count, row.graduates_count)]];
        pairs.forEach(([name, value]) => {
            const el = document.getElementById(`chair-pct-${kind}-${index}-${name}`);
            if (el) el.textContent = value || '—';
        });
    }

    function addProgramRow(kind) {
        if (!chairInputsEnabled()) return;
        syncChairForm();
        state.programRows[kind].push(blankProgramRow());
        render();
    }

    function removeProgramRow(kind, index) {
        if (!chairInputsEnabled()) return;
        syncChairForm();
        state.programRows[kind].splice(index, 1);
        render();
    }

    function updateProgramNarrative(input) {
        if (!chairInputsEnabled()) return;
        programDraft().other_accomplishments = input.value;
    }

    function updateProgramNarrativeNa(checked) {
        if (!chairInputsEnabled()) return;
        programDraft().other_accomplishments_not_applicable = !!checked;
    }

    function programRowPayload(kind, row, sort) {
        const payload = {
            program_packet_id: state.programPacket.id,
            sort_order: sort,
            is_not_applicable: !!row.is_not_applicable
        };
        const ints = kind === 'pi1'
            ? ['first_time_takers', 'first_time_passers', 'total_takers', 'total_passers']
            : ['graduates_count', 'employed_count'];
        const dates = kind === 'pi1' ? ['exam_date'] : [];
        ints.concat(dates).forEach((key) => {
            const raw = row[key];
            if (dates.includes(key)) payload[key] = String(raw || '').trim() || null;
            else if (raw === '' || raw == null) payload[key] = null;
            else payload[key] = Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : null;
        });
        return payload;
    }

    async function ensureProgramPacket() {
        if (state.programPacket?.id) return state.programPacket;
        const department = programDepartment();
        if (!department) throw new Error('This MFO has no department, so the Chairperson sections cannot be saved.');
        const draft = programDraft();
        const period = state.period || {};
        const packet = state.packet || {};
        const payload = {
            task_id: state.task?.id || packet.task_id || state.submission?.task_id || null,
            department,
            reporting_year: period.reporting_year || packet.reporting_year || null,
            quarter: period.quarter || packet.quarter || null,
            period_start: period.period_start || packet.period_start || null,
            period_end: period.period_end || packet.period_end || null,
            period_label: period.period_label || packet.period_label || null,
            academic_year: period.academic_year || packet.academic_year || null,
            semester: period.semester || packet.semester || null,
            other_accomplishments: String(draft.other_accomplishments || ''),
            other_accomplishments_not_applicable: !!draft.other_accomplishments_not_applicable,
            packet_state: 'draft'
        };
        const chairId = chairFacultyId();
        if (chairId) payload.chairperson_faculty_id = chairId;
        const inserted = await db().from('mfo_program_packets').insert(payload).select('*').single();
        if (inserted.error) {
            if (inserted.error.code === '23505' || /duplicate|unique/i.test(inserted.error.message || '')) {
                await loadProgramPortion();
                if (state.programPacket?.id) {
                    state.programPacket.other_accomplishments = payload.other_accomplishments;
                    state.programPacket.other_accomplishments_not_applicable = payload.other_accomplishments_not_applicable;
                    return state.programPacket;
                }
            }
            throw inserted.error;
        }
        state.programPacket = inserted.data;
        return state.programPacket;
    }

    async function replaceProgramRows(kind, rows) {
        const table = kind === 'pi1' ? 'mfo_pi1_licensure' : 'mfo_pi2_employment';
        const existing = await db().from(table).select('id').eq('program_packet_id', state.programPacket.id);
        if (existing.error) throw existing.error;
        const keep = new Set();
        for (let index = 0; index < rows.length; index += 1) {
            const payload = programRowPayload(kind, rows[index], index);
            if (isUuid(rows[index].id)) {
                const updated = await db().from(table).update(payload).eq('id', rows[index].id);
                if (updated.error) throw updated.error;
                keep.add(String(rows[index].id));
            } else {
                const inserted = await db().from(table).insert(payload).select('id').single();
                if (inserted.error) throw inserted.error;
                keep.add(String(inserted.data.id));
            }
        }
        const remove = (existing.data || []).map((row) => row.id).filter((id) => !keep.has(String(id)));
        if (remove.length) {
            const deleted = await db().from(table).delete().in('id', remove);
            if (deleted.error) throw deleted.error;
        }
    }

    async function persistProgramPortion() {
        const keepers = {
            pi1: (state.programRows?.pi1 || []).filter((row) => !programRowBlank('pi1', row)),
            pi2: (state.programRows?.pi2 || []).filter((row) => !programRowBlank('pi2', row))
        };
        const draft = programDraft();
        const narrative = String(draft.other_accomplishments || '');
        const narrativeNa = !!draft.other_accomplishments_not_applicable;
        const hasRows = keepers.pi1.length || keepers.pi2.length;
        if (!state.programPacket?.id && !hasRows && !narrative.trim() && !narrativeNa) return;
        await ensureProgramPacket();
        const update = {
            other_accomplishments: narrative,
            other_accomplishments_not_applicable: narrativeNa
        };
        const chairId = chairFacultyId();
        if (chairId) update.chairperson_faculty_id = chairId;
        const saved = await db().from('mfo_program_packets').update(update).eq('id', state.programPacket.id).select('*').single();
        if (saved.error) throw saved.error;
        state.programPacket = saved.data;
        await replaceProgramRows('pi1', keepers.pi1);
        await replaceProgramRows('pi2', keepers.pi2);
    }

    async function saveChairPortion(options) {
        const nested = !!(options && options.nested);
        if (!chairEditing() || !reviewerCanAct()) {
            if (nested) throw new Error('This submission is not waiting for Chairperson review.');
            return;
        }
        syncChairForm();
        if (!nested && !beginBusy('Saving chairperson portion…')) return;
        try {
            await persistProgramPortion();
            try { await loadProgramPortion(); } catch (error) { warn('program packet', error); }
            if (!state.chairName) {
                try { await loadDepartmentChair(); } catch (error) { warn('chairperson lookup', error); }
            }
            const blob = await buildSubmittedMfoPdfBlob();
            try {
                await persistSubmittedMfoPdf(blob);
            } catch (error) {
                const message = String(error?.message || error || '');
                if (/row-level security|permission|unauthorized|not authorized|403/i.test(message)) {
                    throw new Error('Chairperson fields were saved, but the submitted PDF could not be replaced. Run admin/034_chairperson_mfo_pdf_replace.sql in Supabase, then save again.');
                }
                throw error;
            }
            if (!nested) toast('Chairperson portion saved. The submitted MFO PDF was updated.');
        } catch (error) {
            if (nested) throw error;
            toast(friendlyError(error, 'The Chairperson portion could not be saved.'), 'error');
        } finally {
            if (!nested) endBusy();
        }
    }

    function chairNumberField(kind, index, key, label, value) {
        const disabled = chairInputsEnabled() ? '' : 'disabled';
        return `<div><label class="mfo-label">${esc(label)}</label>
            <input class="mfo-field" type="number" min="0" step="1" data-chair-kind="${kind}" data-chair-index="${index}" data-chair-key="${esc(key)}" value="${esc(value ?? '')}" ${disabled} oninput="CiteFlowMfoFaculty.updateProgramRow('${kind}', ${index}, '${key}', this)"></div>`;
    }

    function chairDateField(kind, index, value) {
        const disabled = chairInputsEnabled() ? '' : 'disabled';
        return `<div><label class="mfo-label">Date of LET Examination</label>
            <input class="mfo-field" type="date" data-chair-kind="${kind}" data-chair-index="${index}" data-chair-key="exam_date" value="${esc(dateInputValue(value))}" ${disabled} oninput="CiteFlowMfoFaculty.updateProgramRow('${kind}', ${index}, 'exam_date', this)"></div>`;
    }

    function chairPctField(kind, index, name, label, value) {
        return `<div><div class="mfo-label">${esc(label)}</div><div class="font-semibold" id="chair-pct-${kind}-${index}-${name}">${esc(value || '—')}</div></div>`;
    }

    function renderChairRecord(kind, row, index) {
        const disabled = chairInputsEnabled() ? '' : 'disabled';
        const fields = kind === 'pi1'
            ? `${chairDateField(kind, index, row.exam_date)}
                ${chairNumberField(kind, index, 'first_time_takers', 'No. of First-time Takers', row.first_time_takers)}
                ${chairNumberField(kind, index, 'first_time_passers', 'No. of Passers', row.first_time_passers)}
                ${chairPctField(kind, index, 'first', 'Passing Percentage for First-time Takers', row.first_time_passing_pct ?? safePct(row.first_time_passers, row.first_time_takers))}
                ${chairNumberField(kind, index, 'total_takers', 'Total No. of Takers', row.total_takers)}
                ${chairNumberField(kind, index, 'total_passers', 'Total No. of Passers', row.total_passers)}
                ${chairPctField(kind, index, 'overall', 'Over-all Passing Percentage', row.overall_passing_pct ?? safePct(row.total_passers, row.total_takers))}`
            : `${chairNumberField(kind, index, 'graduates_count', 'No. of Graduates', row.graduates_count)}
                ${chairNumberField(kind, index, 'employed_count', 'No. of Graduates Employed', row.employed_count)}
                ${chairPctField(kind, index, 'employment', 'Percentage', row.employment_pct ?? safePct(row.employed_count, row.graduates_count))}`;
        return `<div class="rounded-xl border border-slate-200 p-4 mb-3">
            <div class="flex items-center justify-between gap-3 mb-3">
                <label class="mfo-na-toggle">
                    <input type="checkbox" data-chair-kind="${kind}" data-chair-index="${index}" data-chair-key="is_not_applicable" ${row.is_not_applicable ? 'checked' : ''} ${disabled} onchange="CiteFlowMfoFaculty.updateProgramRow('${kind}', ${index}, 'is_not_applicable', this)">
                    Not applicable (NA)
                </label>
                ${chairInputsEnabled() ? `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.removeProgramRow('${kind}', ${index})">Remove</button>` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${fields}</div>
        </div>`;
    }

    function renderChairEditor() {
        const draft = state.programPacket || {};
        const disabled = chairInputsEnabled() ? '' : 'disabled';
        const pi1 = PROGRAM_LEVEL[0];
        const pi2 = PROGRAM_LEVEL[1];
        return `<section class="surface rounded-[16px] p-5 mb-4">
            <h2 class="text-base font-bold mb-1">Chairperson sections</h2>
            <p class="text-xs text-slate-500 mb-4">Complete these program sections. Faculty records below stay locked.</p>
            <h3 class="text-sm font-bold mb-3">${esc(pi1.heading)}</h3>
            ${editorRows('pi1').map((row, index) => renderChairRecord('pi1', row, index)).join('')}
            ${chairInputsEnabled() ? '<button type="button" class="cite-action mb-5" onclick="CiteFlowMfoFaculty.addProgramRow(\'pi1\')">Add Record</button>' : ''}
            <h3 class="text-sm font-bold mb-3 mt-2">${esc(pi2.heading)}</h3>
            ${editorRows('pi2').map((row, index) => renderChairRecord('pi2', row, index)).join('')}
            ${chairInputsEnabled() ? '<button type="button" class="cite-action mb-5" onclick="CiteFlowMfoFaculty.addProgramRow(\'pi2\')">Add Record</button>' : ''}
            <h3 class="text-sm font-bold mb-1">Other accomplishments (narrative)</h3>
            <p class="text-xs text-slate-500 mb-3">Program narrative for this quarter. Faculty notes stay in the section below.</p>
            <label class="mfo-na-toggle mb-3">
                <input type="checkbox" data-chair-kind="narrative-na" ${draft.other_accomplishments_not_applicable ? 'checked' : ''} ${disabled} onchange="CiteFlowMfoFaculty.updateProgramNarrativeNa(this.checked)">
                Not applicable (NA)
            </label>
            <textarea class="mfo-field" rows="4" data-chair-kind="narrative" ${disabled} oninput="CiteFlowMfoFaculty.updateProgramNarrative(this)">${esc(draft.other_accomplishments || '')}</textarea>
        </section>`;
    }

    function programLevelTable(indicator) {
        const source = (state.programRows && state.programRows[indicator.key]) || [];
        const filled = source.filter((row) => !programRowBlank(indicator.key, row) && !row.is_not_applicable);
        const body = filled.length
            ? filled.map((row) => `<tr class="mfo-pdf-unit">${indicator.values(row).map((value) => `<td>${esc(tv(value))}</td>`).join('')}</tr>`).join('')
            : `<tr class="mfo-pdf-unit">${indicator.columns.map(() => `<td>${NA}</td>`).join('')}</tr>`;
        return `<table><thead><tr class="mfo-pdf-unit">${indicator.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody></table>`;
    }

    function reportTitleFromRow(row, fallback) {
        return String(row?.title || row?.caption || row?.research_title || row?.activity_title || row?.project_title
            || row?.award_title || row?.certification_title || row?.training_title || row?.course_title || fallback || '').trim();
    }

    function reportPhotoEntries() {
        const used = new Set(), entries = [];
        function takeImages(list) {
            const unique = [];
            (list || []).forEach((f) => {
                if (!fileIsImage(f)) return;
                const key = String(f.id || f.storage_path || f.file_path || f.file_url || '');
                if (!key || used.has(key)) return;
                used.add(key); unique.push(f);
            });
            return unique;
        }
        rowsOf('mfo_documentation_items').forEach((row, index) => {
            if (!String(row.section_code || '').startsWith('documentation_')) return;
            entries.push({ row, docIndex: index, sectionCode: row.section_code, photos: takeImages(uniquePhotosForRecord(row.section_code, row.id)), others: filesFor(row.section_code, row.id).filter((f) => !fileIsImage(f)) });
        });
        return entries.filter((entry) => {
            const row = entry.row || {};
            return (entry.photos || []).length || (entry.others || []).length || reportTitleFromRow(row) || String(row.narrative || '').trim() || String(row.activity_date || '').trim() || String(row.venue || '').trim();
        });
    }

    function photoFrameStyle(file) {
        const w = Number(file?.pdf_px_w) || 1200;
        const h = Number(file?.pdf_px_h) || 800;
        const widthMm = 160;
        const heightMm = Math.max(30, Math.min(170, (widthMm * h) / w));
        return `width:${widthMm}mm;height:${heightMm.toFixed(1)}mm;object-fit:contain;display:block;background:#fff;border:1px solid #000;`;
    }

    function photoDetailText(file, row) {
        const caption = String(file?.mfo_caption || '').trim();
        const date = reportDate(row?.activity_date);
        const time = String(row?.activity_time || '').trim();
        const venue = String(row?.venue || '').trim();
        const narrative = String(row?.narrative || '').trim();
        const lines = [];
        if (caption) lines.push(caption);
        const meta = [date && `Date: ${date}`, time && `Time: ${time}`, venue && `Venue: ${venue}`].filter(Boolean).join(' · ');
        if (meta) lines.push(meta);
        if (narrative && narrative !== caption) lines.push(narrative);
        return lines.join('\n');
    }

    function reportDocumentation(entries) {
        return entries.map((entry) => {
            const row = entry.row || entry;
            const images = entry.photos || [];
            const others = entry.others || [];
            const details = [
                ['Date', reportDate(row.activity_date)], ['Time', String(row.activity_time || '').trim()],
                ['Venue', String(row.venue || '').trim()], ['Sponsoring agency', String(row.sponsoring_agency || '').trim()], ['Role', String(row.role || '').trim()]
            ].filter(([, value]) => value);
            const narrative = String(row.narrative || '').trim();
            const photos = images.map((file) => {
                const src = String(file.pdf_data_url || '').trim();
                const detail = photoDetailText(file, row);
                return `<div class="mfo-doc-photo mfo-pdf-unit">
                <img alt="" src="${esc(src)}" width="${Number(file.pdf_px_w) || 1200}" height="${Number(file.pdf_px_h) || 800}" style="${photoFrameStyle(file)}"
                     data-storage-path="${esc(file.storage_path || file.file_path || '')}" data-file-url="${esc(file.file_url || '')}">
                ${detail ? `<div class="cap">${esc(detail)}</div>` : ''}
            </div>`;
            }).join('');
            return `<div class="mfo-doc-entry">
                <div class="t mfo-pdf-unit">Documentation details</div>
                <div class="mfo-pdf-unit">${esc(reportTitleFromRow(row) || 'Untitled activity')}</div>
                ${details.length ? `<dl class="mfo-pdf-unit">${details.map(([label, value]) => `<dt>${esc(label)}:</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : ''}
                ${narrative ? `<div class="mfo-pdf-unit">${esc(narrative)}</div>` : ''}
                ${photos ? `<div class="mfo-doc-photos">${photos}</div>` : ''}
                ${others.length ? `<div class="mfo-pdf-unit" style="margin-top:4px"><b>Attached documents:</b> ${others.map((file) => esc(file.file_name)).join('; ')}</div>` : ''}
            </div>`;
        }).join('');
    }

    async function hydrateReportPhotos(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const nodes = Array.from(scope.querySelectorAll('.mfo-doc-photo img'));
        await Promise.all(nodes.map(async (img) => {
            if (/^data:image\//i.test(String(img.getAttribute('src') || ''))) return;
            const path = String(img.getAttribute('data-storage-path') || '').trim();
            const file = (state.files || []).find((item) => String(item.storage_path || item.file_path || '') === path) || {
                storage_path: path,
                file_url: img.getAttribute('data-file-url') || ''
            };
            try {
                const raster = await rasterizeBlob(await imageBlobForPdf(file));
                img.src = raster.dataUrl;
                img.width = raster.width;
                img.height = raster.height;
                img.style.cssText = photoFrameStyle({ pdf_px_w: raster.width, pdf_px_h: raster.height });
            } catch (error) {
                warn('preview photo', path, error);
            }
        }));
    }

    function quarterLine(period) {
        const ordinals = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
        const months = { 1: 'January to March', 2: 'April to June', 3: 'July to September', 4: 'October to December' };
        const q = Number(period.quarter || 0);
        return q && ordinals[q] ? `${ordinals[q]} Quarter, Months of ${months[q]}` : esc(period.period_label || '');
    }

    function reportHeader() { return `<div class="mfo-doc-head"><img src="../assets/mfo-letterhead.jpg" alt="Republic of the Philippines · Cebu Technological University · Argao Campus"></div>`; }
    function reportFooter() { return `<div class="mfo-doc-foot"><img src="../assets/mfo-footer-rankings.png" alt="Cebu Technological University accreditations and rankings"></div>`; }

    function submittedByLine(faculty) {
        const signature = String(state.packet?.signature_data_url || '').trim();
        const name = state.packet?.signature_name || facultyFullName(faculty);
        if (/^data:image\//i.test(signature)) {
            return `<div class="line sig"><img src="${esc(signature)}" alt="Signature of ${esc(name || 'faculty')}"></div>`;
        }
        return `<div class="line" style="display:flex;align-items:flex-end;padding-bottom:2px;font-weight:600;">${esc(tv(name))}</div>`;
    }

    function renderReportDocument() {
        const faculty = state.faculty || {};
        const period = state.period || {};
        const profile = reportProfileModel();
        const ctx = { facultyName: profile.fullName || faculty.full_name || '' };
        const documentationEntries = reportPhotoEntries();

        const groupOrder = [];
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
            const last = groupOrder[groupOrder.length - 1];
            if (!last || last.group !== def.group) groupOrder.push({ group: def.group, bare: def.bare, items: [def] });
            else last.items.push(def);
        });

        const body = groupOrder.map((block, blockIndex) => {
            const only = block.items.length === 1 ? block.items[0] : null;
            const heading = `<div class="mfo-doc-group mfo-pdf-unit">${esc(block.group)}${block.bare && only ? officialNaMark(only.code) : ''}</div>`;
            // Program-level PI1/PI2 print inside the MFO 1 group, before PI3.
            const programTables = blockIndex === 0
                ? PROGRAM_LEVEL.map((ind) => `<div class="mfo-doc-pi mfo-pdf-unit">${esc(ind.heading)}</div>${programLevelTable(ind)}`).join('')
                : '';
            const tables = block.items.map((def) => `
                ${!block.bare ? `<div class="mfo-doc-pi mfo-pdf-unit">${esc(def.heading)}${officialNaMark(def.code)}</div>` : ''}
                ${formTable(def, ctx)}
            `).join('');
            return heading + programTables + tables;
        }).join('');

        const notes = officialNarrativeText();

        return `<div class="mfo-doc" id="mfoReportDoc">
            <div class="mfo-pdf-unit">
            ${reportHeader()}
            <div class="mfo-doc-title">Accomplishment Report – CY ${esc(period.reporting_year || '')}</div>
            <div class="mfo-doc-sub">${quarterLine(period)}</div>
            <div class="mfo-doc-sub">(for the Program Chairperson)</div>
            <div class="mfo-doc-ident">
                <div class="row"><span><b>Program Chairperson:</b> ${esc(tv(profile.chairperson))}</span><span><b>Program:</b> ${esc(tv(profile.program))}</span></div>
                <div class="row"><span><b>Reporting Faculty:</b> ${esc(tv(profile.fullName))}</span><span><b>Faculty ID:</b> ${esc(tv(profile.employeeId))}</span></div>
                <div class="row"><span><b>Department:</b> ${esc(tv(profile.department))}</span><span><b>Academic Rank / Position:</b> ${esc(tv(profile.rank))}</span></div>
                <div class="row"><span><b>Academic period:</b> ${esc(tv(profile.academicPeriod))}</span><span><b>Status:</b> ${esc(statusLabel())}</span></div>
            </div>
            <div class="mfo-doc-instr">Instructions: Fill in the table with the required data. Write NA for sections/items not applicable to your program.</div>
            </div>
            ${body}
            <div class="mfo-pdf-unit">
            <div class="mfo-doc-group">Other accomplishment/s of the program that you would like the College to report for this quarter:</div>
            <div class="mfo-doc-note">(policies created, external grant for instruction/research/extension, etc.)</div>
            <div class="mfo-doc-lines">${notes ? esc(notes) : NA}</div>
            </div>
            <div class="mfo-doc-sign mfo-pdf-unit">
                <div class="box"><div><b>Date Submitted:</b></div><div class="line" style="display:flex;align-items:flex-end;padding-bottom:2px;">${esc(state.submission?.submitted_at ? reportDate(state.submission.submitted_at) : NA)}</div></div>
                <div class="box"><div><b>Submitted by:</b></div>${submittedByLine(faculty)}</div>
            </div>
            <div class="mfo-pdf-unit">${reportFooter()}</div>
            ${documentationEntries.length ? renderDocumentationPages(documentationEntries, period) : ''}
        </div>`;
    }

    function renderDocumentationPages(rows, period) {
        return `<div class="mfo-pdf-page mfo-pdf-unit">
            <div class="mfo-doc-title">Supporting Documentation</div>
            <div class="mfo-doc-sub">Accomplishment Report – CY ${esc(period.reporting_year || '')} · ${quarterLine(period)}</div>
            <div class="mfo-doc-sub">${esc(tv(facultyFullName(state.faculty)))}</div>
            </div>
            ${reportDocumentation(rows)}`;
    }

    function renderPreview() {
        const root = document.getElementById('mfoApp');
        if (!root || !state.faculty) return;
        root.innerHTML = `<div class="mfo-doc-toolbar mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><div class="cite-kicker">${state.reviewerMode ? 'Submitted report (read-only)' : 'Completed report'}</div>
            <h1 class="cite-title">MFO Accomplishment Report</h1>
            <p class="cite-subtitle">${esc(statusLabel())}${state.reviewerMode ? ` · ${esc(state.faculty.full_name || '')}` : (state.previewPdfUrl ? ' · generated PDF' : ' · reflects the last saved values.')}</p></div>
            <div class="flex flex-col sm:flex-row gap-2">
                ${state.reviewerMode
                    ? `<button type="button" class="cite-action" onclick="if (history.length > 1) history.back(); else location.href = '${state.reviewerIsAdmin ? '../admin/workflow-approval.html' : 'submissions.html#chair-review'}';">← Back</button>`
                    : '<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePreview()">← Back to editor</button>'
                }
                ${state.reviewerMode && reviewerCanAct() ? `
                <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.openReviewerModal('approved')">
                    ${state.reviewerIsAdmin ? '<i class="fa-solid fa-check-double mr-1"></i> Certify & Approve' : '<i class="fa-solid fa-check mr-1"></i> Approve'}
                </button>
                <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openReviewerModal('revision')">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Request Revision
                </button>
                <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openReviewerModal('rejected')">
                    <i class="fa-solid fa-xmark mr-1"></i> Decline
                </button>` : ''}
                <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.printReport()"><i class="fa-solid fa-print"></i> Print</button>
            </div>
        </div>
        ${state.previewPdfUrl
            ? `<iframe class="mfo-pdf-frame" title="Generated MFO PDF" src="${esc(state.previewPdfUrl)}"></iframe>`
            : renderReportDocument()}
        ${renderReviewerModal()}`;
        window.scrollTo({ top: 0, behavior: 'auto' });
        if (!state.previewPdfUrl) hydrateReportPhotos();
        placeOverlays();
    }

    function renderPdfModal() {
        if (state.reviewerIsAdmin || !state.viewPdfOpen) return '';
        const frame = state.previewPdfUrl
            ? `<iframe class="mfo-pdf-frame" title="Generated MFO PDF" src="${esc(state.previewPdfUrl)}"></iframe>`
            : '<div class="mfo-pdf-waiting">Preparing the current MFO PDF…</div>';
        return `<div class="mfo-review-overlay mfo-pdf-overlay" data-mfo-overlay="preview">
            <div class="mfo-review-dialog mfo-pdf-dialog" role="dialog" aria-modal="true" aria-label="View MFO">
                <div class="mfo-review-header">
                    <div>
                        <h2 class="text-base font-bold text-slate-900">View MFO</h2>
                        <p class="text-xs text-slate-500 mt-0.5">Accomplishment report as it stands now</p>
                    </div>
                </div>
                <div class="mfo-review-body">
                    ${frame}
                </div>
                <div class="mfo-review-footer mfo-pdf-footer">
                    <button type="button" class="cite-action-primary" ${state.previewPdfUrl ? '' : 'disabled'} data-mfo-action="print-preview">Print</button>
                    <button type="button" class="cite-action" data-mfo-action="close-preview">Cancel</button>
                </div>
            </div>
        </div>`;
    }

    let previewRefreshQueued = false;
    async function refreshOpenPdfPreview() {
        if (state.reviewerIsAdmin || !state.viewPdfOpen) return;
        if (state.pdfPreparing) { previewRefreshQueued = true; return; }
        if (chairEditing()) syncChairForm();
        else syncLiveFormState();
        state.pdfPreparing = true;
        try {
            if (!state.chairName) {
                try { await loadDepartmentChair(); } catch (error) { warn('chair lookup', error); }
            }
            const blob = await buildSubmittedMfoPdfBlob();
            if (!state.viewPdfOpen) return;
            if (state.previewPdfUrl) URL.revokeObjectURL(state.previewPdfUrl);
            state.previewPdfUrl = URL.createObjectURL(blob);
            const frame = document.querySelector('.mfo-pdf-frame');
            if (frame) frame.src = state.previewPdfUrl;
            else render();
        } catch (error) {
            if (state.viewPdfOpen) toast(friendlyError(error, 'The MFO PDF could not be prepared.'), 'error');
        } finally {
            state.pdfPreparing = false;
            const waiting = document.querySelector('.mfo-pdf-waiting');
            if (waiting && state.previewPdfUrl) render();
            if (previewRefreshQueued && state.viewPdfOpen) {
                previewRefreshQueued = false;
                await refreshOpenPdfPreview();
            }
        }
    }

    async function openPreview() {
        if (state.reviewerMode && state.reviewerIsAdmin) { state.previewOpen = true; render(); return; }
        if (state.pdfPreparing) return;
        if (chairEditing()) syncChairForm();
        else syncLiveFormState();
        if (state.previewPdfUrl) { URL.revokeObjectURL(state.previewPdfUrl); state.previewPdfUrl = ''; }
        state.viewPdfOpen = true;
        render();
        await refreshOpenPdfPreview();
    }

    function closePreview() {
        state.previewOpen = false;
        state.viewPdfOpen = false;
        if (state.previewPdfUrl) { URL.revokeObjectURL(state.previewPdfUrl); state.previewPdfUrl = ''; }
        render();
    }
    async function printReport() {
        if (state.previewPdfUrl) {
            const frame = document.querySelector('.mfo-pdf-frame');
            try {
                frame?.contentWindow?.focus();
                frame?.contentWindow?.print();
            } catch (_) {
                toast('Unable to print this PDF from the preview.', 'error');
            }
            return;
        }
        if (!state.previewOpen) return;
        state.printing = true; render();
        await hydrateReportPhotos();
        window.print();
        state.printing = false; render();
        hydrateReportPhotos();
    }

    // -------------------------------------------------------------------
    // Main render
    // -------------------------------------------------------------------
    function render() {
        const root = document.getElementById('mfoApp');
        if (!root) return;
        if (state.initFailure) { renderInitFailure(); return; }
        // In reviewer mode, faculty is always pre-set; do not bail silently.
        if (!state.faculty && !state.reviewerMode) return;
        // Defensive fallback: ensure state.faculty is never null when rendering
        if (!state.faculty) {
            state.faculty = { id: null, full_name: 'Faculty', department: '' };
        }
        if (state.previewOpen) {
            try { renderPreview(); } catch (e) {
                err('renderPreview failed', e);
                root.innerHTML = `<div class="surface rounded-[16px] p-6 text-sm text-slate-700">
                    <div class="font-bold text-base mb-2">Could not render the report</div>
                    <p class="font-mono text-xs break-words bg-slate-50 rounded-lg p-3">${esc(String(e?.message || e))}</p>
                    <button type="button" class="cite-action mt-4" onclick="window.location.reload()">Retry</button>
                </div>`;
            }
            return;
        }

        const faculty = state.faculty;
        const profile = reportProfileModel();
        const grouped = [];
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
            const last = grouped[grouped.length - 1];
            if (!last || last.group !== def.group) grouped.push({ group: def.group, items: [def] });
            else last.items.push(def);
        });

        const chairReview = chairEditing();
        const stickyActions = chairReview
            ? `<button type="button" class="cite-action" ${chairInputsEnabled() ? '' : 'disabled'} onclick="CiteFlowMfoFaculty.saveChairPortion()">${state.busyLabel === 'Saving chairperson portion…' ? 'Saving…' : 'Save changes'}</button>
                    <button type="button" class="cite-action" ${state.busy ? 'disabled' : ''} data-mfo-action="open-preview">${state.busyLabel === 'Preparing PDF…' ? 'Preparing…' : 'View MFO'}</button>
                    ${reviewerCanAct() && !state.busy ? `<button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.openReviewerModal('approved')"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openReviewerModal('revision')"><i class="fa-solid fa-rotate-left mr-1"></i> Request Revision</button>
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openReviewerModal('rejected')"><i class="fa-solid fa-xmark mr-1"></i> Decline</button>` : ''}`
            : `<button type="button" class="cite-action" ${state.busy || state.locked ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.saveDraft()">${state.busyLabel === 'Saving…' ? 'Saving…' : 'Save Draft'}</button>
                    <button type="button" class="cite-action" ${state.busy ? 'disabled' : ''} data-mfo-action="open-preview">${state.busyLabel === 'Preparing PDF…' ? 'Preparing…' : 'View MFO'}</button>
                    <button type="button" class="cite-action-primary" ${state.busy || !state.task || (state.locked && statusLabel() !== 'Returned for Revision') ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.submitPacket()">${state.busyLabel === 'Submitting…' ? 'Submitting…' : 'Submit'}</button>`;
        root.innerHTML = `
            <div class="mb-4">
                <a href="${chairReview ? 'submissions.html#chair-review' : 'submissions.html'}" class="text-sm font-bold text-[#621708]">${chairReview ? '← Back to Chairperson review' : '← Back to Submissions'}</a>
                <div class="cite-kicker mt-3">MFO Report</div>
                <h1 class="cite-title">Accomplishment Report — CY ${esc(state.period.reporting_year || '')}</h1>
                <p class="cite-subtitle">${chairReview ? 'Complete the Chairperson sections, then save. Faculty records stay locked.' : 'Quarterly faculty contribution. Program-level licensure, employment, and narrative sections stay with the Chairperson.'}</p>
            </div>
            ${state.taskWarning ? `<div class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm font-semibold">${esc(state.taskWarning)}</div>` : ''}
            <div class="mfo-sticky rounded-[16px] p-4 mb-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div><div class="text-sm font-bold">${esc(statusLabel())}</div>
                <div class="text-xs text-slate-500">Last saved: ${esc(formatWhen(state.lastSaved || state.packet?.updated_at))}</div></div>
                <div class="mfo-actions flex flex-col sm:flex-row sm:items-center gap-2">
                    <label class="mfo-label" for="mfoPaperSize" style="margin:0;">Paper size</label>
                    <select id="mfoPaperSize" class="mfo-field" data-mfo-paper style="width:auto;min-width:9.5rem;height:38px;" onchange="CiteFlowMfoFaculty.setPaperSize(this.value)">
                        ${PAPER_SIZES.map((item) => `<option value="${item.id}" ${state.paperSize === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
                    </select>
                    ${stickyActions}
                </div>
            </div>
            <section class="surface rounded-[16px] p-5 mb-4">
                <h2 class="text-base font-bold mb-4">Report information</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    ${profileField('fullName', 'Faculty name', profile.fullName)}
                    ${profileField('employeeId', 'Faculty ID', profile.employeeId)}
                    ${profileField('department', 'Department', profile.department)}
                    ${profileField('program', 'Program', profile.program)}
                    ${profileField('rank', 'Academic rank / position', profile.rank)}
                    ${profileField('chairperson', 'Program Chairperson', profile.chairperson)}
                    <div><div class="mfo-label">Reporting period</div><div class="font-semibold">${esc(state.period.period_label)}</div></div>
                    <div><div class="mfo-label">Deadline</div><div class="font-semibold">${esc(formatWhen(state.task?.deadline_at || state.task?.due_at))}</div></div>
                    <div><div class="mfo-label">Status</div><div class="font-semibold">${esc(statusLabel())}</div></div>
                    <div><div class="mfo-label">Date created</div><div class="font-semibold">${esc(formatWhen(state.packet?.created_at))}</div></div>
                    <div><div class="mfo-label">Academic period</div><div class="font-semibold">${esc([state.period.academic_year, state.period.semester].filter(Boolean).join(' · ') || '—')}</div></div>
                </div>
            </section>
            ${chairEditing() ? renderChairEditor() : renderProgramLocked()}
            ${grouped.map((block) => block.items.map(renderFacultySection).join('')).join('')}
            ${renderFacultySection(DOC_TABLE)}
            ${renderOtherNotes()}
            ${renderReview()}
            ${renderPdfModal()}
            ${renderSubmitModal()}
            ${renderReviewerModal()}`;
        placeOverlays();
    }

    function placeOverlays() {
        const fresh = Array.from(document.querySelectorAll('#mfoApp .mfo-review-overlay'));
        Array.from(document.body.children).forEach((node) => {
            if (node.classList && node.classList.contains('mfo-review-overlay')) node.remove();
        });
        fresh.forEach((node) => document.body.appendChild(node));
    }

    function onMfoActionClick(event) {
        const actionEl = event.target && event.target.closest ? event.target.closest('[data-mfo-action]') : null;
        if (actionEl) {
            if (actionEl.disabled) return;
            const action = actionEl.getAttribute('data-mfo-action');
            const arg = actionEl.getAttribute('data-mfo-arg');
            const handlers = {
                'open-preview': () => openPreview(),
                'close-preview': () => closePreview(),
                'print-preview': () => printReport(),
                'remove-file': () => removeFile(arg)
            };
            const run = handlers[action];
            if (!run) return;
            event.preventDefault();
            event.stopPropagation();
            run();
            return;
        }
        const overlay = event.target && event.target.classList && event.target.classList.contains('mfo-review-overlay') ? event.target : null;
        if (!overlay) return;
        const which = overlay.getAttribute('data-mfo-overlay');
        if (which === 'preview') closePreview();
    }

    function renderOtherNotes() {
        return `<section class="surface rounded-[16px] p-5 mb-4">
            <h2 class="text-base font-bold mb-1">Other accomplishment/s of the program</h2>
            <p class="text-xs text-slate-500 mb-3">(policies created, external grant for instruction/research/extension, etc.)</p>
            <textarea class="mfo-field" rows="4" data-mfo-notes ${state.locked || state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateNotes(this)" placeholder="Additional details for this quarter">${esc(state.packet?.notes || '')}</textarea>
        </section>`;
    }

    global.CiteFlowMfoFaculty = {
        updateRow, addRow, removeRow, setSectionNa, updateNotes, persistNotes, updateProfileField, setPaperSize,
        updateProgramRow, addProgramRow, removeProgramRow, updateProgramNarrative, updateProgramNarrativeNa, saveChairPortion,
        saveDraft, submitPacket, openPreview, closePreview, printReport, refreshPdfPreview: refreshOpenPdfPreview, reviewerAction,
        openReviewerModal, closeReviewerModal, updateReviewerModalComment, confirmReviewerAction,
        uploadFile, removeFile, render,
        closeSubmitModal, confirmSubmitPacket,
        toggleAutoNaBlanks, autoMarkBlankSectionsAsNa, undoBlankSectionsNa,
        autoMarkAllBlankAsNa() { autoMarkBlankSectionsAsNa(); render(); toast('All empty sections set to N/A.'); },
        undoAllBlankNa() { undoBlankSectionsNa(); render(); toast('Reverted N/A on blank sections.'); },
        reviewOpen(open) { state.reviewOpen = !!open; render(); }
    };

    document.addEventListener('click', onMfoActionClick);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window);