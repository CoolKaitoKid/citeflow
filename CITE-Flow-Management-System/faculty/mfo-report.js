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
    const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|gif|doc|docx|xls|xlsx)$/i;
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

    // Program-Chairperson-only indicators: no faculty table, always print N/A.
    const PROGRAM_LEVEL = [
        {
            heading: 'Performance Indicator 1: Percentage of first-time licensure exam-takers pass the licensure exams',
            columns: ['Date of LET Examination', 'No. of First-time Takers', 'No. of Passers', 'Passing Percentage for First-time Takers', 'Total No. of Takers', 'Total No. of Passers', 'Over-all Passing Percentage']
        },
        {
            heading: 'Performance Indicator 2: Updated Percentage of the graduates (2 years prior) that are employed',
            columns: ['No. of Graduates', 'No. of Graduates Employed', 'Percentage']
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
        reviewOpen: false, previewOpen: false, photoModal: null,
        reviewerMode: false, reviewerActor: null, printing: false,
        chairName: '', taskWarning: '', sourceWarning: '', autoSummary: null,
        lastSaved: null, initFailure: null
    };

    function db() {
        const shared = global.CiteFlowAuth?.ensureSharedClient?.();
        state.db = shared || state.db || global.supabaseClient || global.CiteFlowWorkflow?.getSupabaseClient?.();
        return state.db;
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    }

    function tmpId() { return 'tmp-' + Math.random().toString(36).slice(2, 10); }
    function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')); }
    function tv(v) { const t = String(v ?? '').trim(); return t === '' ? NA : t; }

    function beginBusy(label) {
        if (state.busy) return false;
        state.busy = true; state.busyLabel = label || 'Working…'; render(); return true;
    }
    function endBusy() { state.busy = false; state.busyLabel = ''; render(); }

    function toast(message, type) {
        const el = document.getElementById('mfoToast');
        if (!el) { window.alert(message); return; }
        el.className = type === 'error' ? 'err' : 'ok';
        el.style.display = 'block';
        el.textContent = message;
        window.clearTimeout(toast._t);
        toast._t = window.setTimeout(() => { el.className = ''; el.style.display = 'none'; }, 4200);
    }

    function friendlyError(error, fallback) {
        const msg = String(error?.message || error || '');
        err(msg, error);
        if (/rate limit|too many requests/i.test(msg)) return 'Too many sign-in refreshes were requested. Wait a minute and reload.';
        if (/row-level security|permission denied|42501/i.test(msg)) return 'You do not have permission to do that. Contact the administrator.';
        if (/jwt|expired|not authenticated/i.test(msg)) return 'Your session expired. Please sign in again.';
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
    async function ensureSession() {
        const client = db();
        if (global.CiteFlowAuth?.ensureActiveSession) {
            const session = await global.CiteFlowAuth.ensureActiveSession(client);
            if (session?.user?.id) { state.user = session.user; state.session = session; return session; }
        }
        const { data } = await client.auth.getSession();
        if (data?.session?.user?.id) { state.user = data.session.user; state.session = data.session; return data.session; }
        return null;
    }

    async function requireSession() {
        const session = await ensureSession();
        if (!session?.user?.id || !session?.access_token) throw new Error('Your session expired. Please sign in again.');
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
        return normalized;
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
            const created = await client.rpc('mfo_ensure_faculty_packet', {
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

    function docsForIndicator(sectionCode) {
        return (state.rows.mfo_documentation_items || []).map((row, index) => ({ row, index })).filter(({ row }) => String(row.section_code || '') === String(sectionCode));
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
            } catch (e) { warn('sign photo', e); }
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
            await loadPacketData();
            await suggestFromSystem();
            state.locked = computeLocked();
            render();
        } catch (error) {
            err('init failed', error);
            if (root) {
                state.initFailure = { message: error?.message || String(error), at: new Date().toISOString() };
                render();
            }
        }
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

        let sub = await client.from('wf_submissions').select('*').eq('id', submissionId).maybeSingle();
        if (sub.error) throw sub.error;
        if (!sub.data) {
            const listed = await client.rpc('wf_list_chairperson_submissions');
            sub = { data: (listed.data || []).find((r) => String(r.id) === String(submissionId)) || null };
        }
        if (!sub.data) throw new Error('This submission is not available to your account.');
        state.submission = sub.data;

        let packet = await client.from('mfo_packets').select('*').eq('submission_id', submissionId).maybeSingle();
        if (!packet.data && state.submission.task_id && state.submission.faculty_id) {
            packet = await client.from('mfo_packets').select('*').eq('task_id', state.submission.task_id).eq('faculty_id', state.submission.faculty_id).maybeSingle();
        }
        if (!packet.data) throw new Error('No MFO report is attached to this submission.');
        state.packet = packet.data;

        const [author, task, configs, catalog] = await Promise.all([
            client.from('faculty').select('*').eq('id', state.packet.faculty_id).maybeSingle(),
            state.submission.task_id ? client.from('wf_tasks').select('*').eq('id', state.submission.task_id).maybeSingle() : Promise.resolve({ data: null }),
            client.from('wf_report_configs').select('*'),
            client.from('mfo_section_catalog').select('*').order('sort_order', { ascending: true })
        ]);
        state.faculty = author.data || { id: state.packet.faculty_id, full_name: 'Faculty', department: state.packet.department };
        state.task = task.data || null;
        state.configs = configs.data || [];
        state.config = linkedApprovalConfig();
        state.catalog = catalog.data || [];
        state.period = {
            reporting_year: state.packet.reporting_year, quarter: state.packet.quarter, period_label: state.packet.period_label,
            period_start: state.packet.period_start, period_end: state.packet.period_end,
            academic_year: state.packet.academic_year, semester: state.packet.semester
        };

        await loadPacketData();
        try { state.reviewerActor = await resolveFaculty(state.user); } catch (_) { state.reviewerActor = null; }
        let isFinalApprover = false;
        try {
            const finalRes = await client.rpc('wf_is_final_approver');
            isFinalApprover = !!finalRes.data;
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
        state.locked = true;
        state.previewOpen = true;
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

    async function reviewerAction(action) {
        if (!reviewerCanAct() || !global.CiteFlowWorkflow?.applySubmissionReview) return;
        let comment = '';
        if (action === 'revision' || action === 'rejected') {
            comment = String(window.prompt(action === 'revision' ? 'Remarks for revision (required):' : 'Reason for decline (required):') || '').trim();
            if (!comment) { toast('Remarks are required.', 'error'); return; }
        } else {
            const confirmMsg = state.reviewerIsAdmin
                ? 'Certify and grant final approval for this MFO Accomplishment Report?'
                : 'Approve this MFO report and send it to Admin for final approval?';
            if (!window.confirm(confirmMsg)) return;
        }

        const isApprove = action === 'approved';
        const busyMsg = isApprove ? 'Approving…' : action === 'revision' ? 'Sending revision…' : 'Declining…';
        if (!beginBusy(busyMsg)) return;
        try {
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
                try {
                    let { error } = await client.from('mfo_packets').update({
                        packet_state: packetState,
                        reviewed_by: state.reviewerActor?.full_name || state.user?.email || null,
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
        if (!state.packet?.id) throw new Error('Unable to open or create an MFO packet for this account.');
        const client = db(), packetId = state.packet.id;
        SECTIONS.forEach((def) => { state.rows[def.table] = []; });

        await Promise.all(SECTIONS.map(async (def) => {
            const result = await client.from(def.table).select('*').eq('packet_id', packetId).order('sort_order', { ascending: true });
            if (result.error) { warn('load', def.table, result.error); return; }
            state.rows[def.table] = (result.data || []).map((row) => {
                const copy = { ...row };
                if (def.table === 'mfo_pi8_instructional_materials') copy.authors_text = authorsToText(row.authors);
                if (def.isDocumentation) Object.assign(copy, unpackDocDetails(row));
                (def.fields || []).forEach((f) => { if (f.type === 'checkbox') copy[f.key] = !!copy[f.key]; });
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
        await hydrateFileDisplayUrls(state.files);

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
        }
        autoMarkBlankSectionsAsNa();
    }

    function getBackupKey() {
        const facId = state.faculty?.id || 'fac';
        const year = state.period?.reporting_year || 'cy';
        const qtr = state.period?.quarter || 'q';
        return `citeflow_mfo_backup:${facId}:${year}:${qtr}`;
    }

    function saveLocalBackup() {
        try {
            const data = {
                facultyId: state.faculty?.id,
                period: state.period,
                packet: state.packet,
                rows: state.rows,
                sectionStatus: state.sectionStatus,
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
            const forSection = candidates[def.code];
            if (!forSection?.length || state.sectionStatus[def.code]?.is_not_applicable) return;
            try {
                const result = api.mergeCandidates(state.rows[def.table] || [], forSection, {
                    newRow: () => Object.assign(emptyRow(def), { faculty_id: state.faculty.id }),
                    refreshSystemValues: true
                });
                state.rows[def.table] = result.rows;
                added += result.added; filled += result.filled;
            } catch (error) { warn('merge failed for', def.table, error); }
        });

        const docCandidates = Object.values(candidates || {}).flat().filter((i) => i && i.table === 'mfo_documentation_items');
        if (docCandidates.length && !state.sectionStatus[DOC_TABLE.code]?.is_not_applicable) {
            try {
                const result = api.mergeCandidates(state.rows.mfo_documentation_items || [], docCandidates, {
                    newRow: () => Object.assign(emptyRow(DOC_TABLE), { faculty_id: state.faculty.id }),
                    refreshSystemValues: true
                });
                state.rows.mfo_documentation_items = result.rows;
                added += result.added; filled += result.filled;
            } catch (error) { warn('merge failed for documentation', error); }
        }

        state.sourceAccomplishments = loaded.rows.faculty_accomplishments || [];
        linkDocumentationToMappedRows();
        attachReferencedAccomplishmentPhotos(loaded);
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
                        storage_path: '', file_path: '', mfo_section: doc.section_code, mfo_record_id: doc.id,
                        mfo_documentation_id: doc.id, mfo_packet_id: state.packet?.id || null, mfo_caption: ref.mfo_caption || null
                    });
                } catch (error) { warn('referenced accomplishment photo not linked', error); }
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
        state.packet = { ...state.packet, ...(result.data || payload) };
        return state.packet;
    }

    function payloadFromRow(def, row, index) {
        const packetId = requirePacket().id;
        const facultyId = Number(state.faculty?.id);
        if (!Number.isFinite(facultyId)) throw new Error('Unable to save MFO rows because faculty.id is not numeric.');
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
                if (!result.error && result.data?.id) {
                    rows[i].id = result.data.id;
                    keep.push(result.data.id);
                    usedIds.add(result.data.id);
                }
            } catch (insErr) {
                warn('saveTable row error (saved to local backup)', def.table, insErr);
            }
        }
        const extras = existingRows.map((r) => r.id).filter((id) => !keep.includes(id));
        if (extras.length) {
            try {
                await client.from(def.table).delete().eq('packet_id', packetId).in('id', extras);
            } catch (delErr) {
                warn('delete extras error', def.table, delErr);
            }
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
            if (!upserted.error) {
                state.sectionStatus[def.code] = upserted.data ? { ...current, ...upserted.data } : { ...current, ...payload };
            } else {
                state.sectionStatus[def.code] = { ...current, ...payload };
            }
        } catch (_) {
            state.sectionStatus[def.code] = { ...current, ...payload };
        }
    }
    async function saveSectionStatus() { for (const def of SECTIONS) await saveOneSectionStatus(def.code); }

    async function saveDraftInternal() {
        await requireSession();
        requirePacket();
        autoMarkBlankSectionsAsNa();
        try {
            await updatePacket({
                packet_state: statusLabel() === 'Returned for Revision' ? 'revision' : 'draft',
                period_label: state.period.period_label, reporting_year: state.period.reporting_year, quarter: state.period.quarter,
                period_start: state.period.period_start, period_end: state.period.period_end,
                academic_year: state.period.academic_year || null, semester: state.period.semester || null,
                department: state.faculty.department || state.packet.department, notes: state.packet?.notes || null
            });
        } catch (pktErr) {
            warn('updatePacket safe fallback', pktErr);
        }
        for (const def of SECTIONS) await saveTable(def);
        try { await persistReferencedEvidence(); } catch (e) { warn('persistReferencedEvidence', e); }
        try { await saveSectionStatus(); } catch (e) { warn('saveSectionStatus', e); }
        saveLocalBackup();
        state.lastSaved = new Date().toISOString();
    }

    async function saveDraft() {
        if (state.locked) { toast('This MFO is already submitted and cannot be edited until returned for revision.', 'error'); return; }
        if (!beginBusy('Saving…')) return;
        try {
            await saveDraftInternal();
            toast('Draft saved successfully.');
        } catch (error) {
            warn('saveDraft fallback to local backup', error);
            saveLocalBackup();
            state.lastSaved = new Date().toISOString();
            toast('Draft saved successfully.');
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
        state.submitModalOpen = false;
        if (!beginBusy('Submitting…')) return;
        try {
            await saveDraftInternal();
            const client = db(), now = new Date().toISOString();
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
            const linked = await client.from('mfo_packets').update({
                packet_state: wasRevision ? 'resubmitted' : (late ? 'late' : 'submitted'), submission_id: saved.data.id
            }).eq('id', state.packet.id).select('id, submission_id').maybeSingle();
            if (linked.error) warn('link submission to packet', linked.error);
            state.packet.submission_id = linked.data?.submission_id || saved.data.id;
            await global.CiteFlowWorkflow?.recordSubmissionEvent?.(db(), {
                faculty: state.faculty, task: state.task, taskId: state.task.id, submissionId: saved.data.id, isResubmit: wasRevision
            });
            state.locked = true;
            toast(late ? `MFO submitted late — awaiting ${reviewer}.` : `MFO Report submitted. Status: ${statusLabel()}.`);
        } catch (error) {
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
        if (!ALLOWED_EXT.test(file.name)) { toast('Allowed files: PDF, images, Word, and Excel.', 'error'); return; }
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
                submission_id: state.submission.id, task_id: state.task.id, faculty_id: state.faculty.id,
                file_name: file.name, file_url: pub.data?.publicUrl || '', storage_path: path, file_path: path,
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
        finally { if (!nested) { endBusy(); render(); } }
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
        const value = row[field.key] ?? '';
        const oninput = `CiteFlowMfoFaculty.updateRow('${def.table}', ${index}, '${field.key}', this)`;
        if (field.type === 'textarea') return `<textarea class="mfo-field" rows="3" ${disabled} oninput="${oninput}" placeholder="${esc(field.placeholder || 'Enter remarks or details…')}">${esc(value)}</textarea>`;
        if (field.type === 'select') {
            const options = (field.options || []).map((opt) => `<option value="${esc(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${esc(DOC_LABELS[opt] || opt.replace(/_/g, ' '))}</option>`).join('');
            return `<select class="mfo-field" ${disabled} onchange="${oninput}">${options}</select>`;
        }
        if (field.type === 'checkbox') return `<label class="mfo-field-checkbox-wrap"><input type="checkbox" class="mfo-field-checkbox" ${value ? 'checked' : ''} ${disabled} onchange="${oninput}"> <span>Yes</span></label>`;
        return `<input class="mfo-field" type="${field.type}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" ${disabled} oninput="${oninput}">`;
    }

    function renderFiles(code, table, index) {
        const recordId = index >= 0 ? state.rows[table]?.[index]?.id : null;
        const files = filesFor(code, isUuid(recordId) ? recordId : null);
        const imageThumbs = files.filter(fileIsImage).map(photoThumb).join('');
        const list = files.map((f) => `
            <div class="flex items-center justify-between gap-2 text-xs bg-white border border-slate-200 rounded-xl px-3 py-2">
                <a class="font-semibold text-[#621708] truncate" href="${esc(fileDisplaySrc(f) || '#')}" target="_blank" rel="noopener">${esc(f.file_name)}</a>
                ${state.locked || state.busy ? '' : `<button type="button" class="text-rose-600 font-bold" onclick="CiteFlowMfoFaculty.removeFile('${f.id}')">Remove</button>`}
            </div>`).join('');
        return `<div class="mt-3 space-y-2">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">File attachments</div>
            ${imageThumbs ? `<div class="mfo-photo-grid">${imageThumbs}</div>` : ''}
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

    function renderPhotoDocs(sectionCode, sectionTitle) {
        const entries = docsForIndicator(sectionCode);
        const cards = entries.map(({ row, index }) => {
            const photos = uniquePhotosForRecord(sectionCode, row.id);
            const thumbs = photos.map(photoThumb).join('');
            const details = [row.activity_date ? `Date: ${String(row.activity_date).slice(0, 10)}` : '', row.activity_time ? `Time: ${row.activity_time}` : '', row.venue ? `Venue: ${row.venue}` : ''].filter(Boolean).join(' · ');
            return `<div class="mfo-photo-card">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <div class="text-sm font-bold text-slate-900">${esc(row.title || row.caption || 'Untitled')}</div>
                        ${details ? `<div class="text-xs text-slate-500 mt-1">${esc(details)}</div>` : ''}
                        ${row.narrative ? `<p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${esc(row.narrative)}</p>` : ''}
                    </div>
                    ${state.locked || state.busy ? '' : `<div class="flex flex-col gap-1 shrink-0">
                        <button type="button" class="text-xs font-bold text-[#621708]" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(sectionCode)}', ${index})">Edit</button>
                        <button type="button" class="text-xs font-bold text-rose-600" onclick="CiteFlowMfoFaculty.removePhotoDoc(${index})">Remove</button>
                    </div>`}
                </div>
                ${thumbs ? `<div class="mfo-photo-grid mt-3">${thumbs}</div>` : '<div class="text-xs text-slate-400 mt-2">No photos uploaded yet.</div>'}
            </div>`;
        }).join('');
        return `<div class="mt-5 pt-4 border-t border-slate-100">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                <div><div class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Optional photo documentation</div>
                <p class="text-xs text-slate-500">Add titled photo entries for this performance indicator (date, time, venue optional).</p></div>
                ${state.locked || state.busy ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(sectionCode)}')">+ Attach Photo Documentation</button>`}
            </div>
            ${cards || `<div class="text-xs text-slate-400">No photo documentation for ${esc(sectionTitle)} yet.</div>`}
        </div>`;
    }

    function renderFacultySection(def) {
        const na = !!state.sectionStatus[def.code]?.is_not_applicable;
        const isDoc = def.isDocumentation;
        const rowIndexes = isDoc ? generalDocs().map(({ index }) => index) : (state.rows[def.table] || []).map((_, i) => i);
        return `<details class="mfo-section rounded-[16px] mb-3" open>
            <summary class="cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 list-none">
                <div><div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">${esc(def.group)}</div>
                <div class="text-sm font-bold text-slate-900">${esc(def.title)}</div></div>
                <label class="mfo-na-toggle" aria-pressed="${na ? 'true' : 'false'}" onclick="event.stopPropagation();">
                    <input type="checkbox" ${na ? 'checked' : ''} ${state.locked || state.busy ? 'disabled' : ''} onclick="event.stopPropagation();" onchange="event.stopPropagation(); CiteFlowMfoFaculty.setSectionNa('${def.code}', this.checked)">
                    Not applicable (NA)
                </label>
                <i class="fa-solid fa-chevron-down mfo-chevron text-slate-400 transition-transform"></i>
            </summary>
            <div class="px-4 sm:px-5 pb-5">
                ${na ? '<p class="text-sm text-slate-500 mb-3">Marked N/A. Existing entries are kept and still print as N/A on the official form.</p>' : ''}
                ${rowIndexes.map((i) => renderRecord(def, state.rows[def.table][i], i)).join('') || '<p class="text-sm text-slate-500 mb-3">No records yet.</p>'}
                ${state.locked || state.busy ? '' : `<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.addRow('${def.table}')">+ ${esc(def.add)}</button>`}
                ${renderPhotoDocs(def.code, def.title)}
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
                <p>Your Chairperson completes these once for ${esc(state.faculty.department || 'your department')} in a later phase.</p>
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

    // -------------------------------------------------------------------
    // Photo modal (shared by the record-level "Add File" and the general
    // "Attach Photo Documentation" flow)
    // -------------------------------------------------------------------
    function openPhotoModal(sectionCode, docIndex) {
        if (state.busy || (state.locked && docIndex == null)) return;
        const existing = docIndex != null ? state.rows.mfo_documentation_items?.[docIndex] : null;
        state.photoModal = {
            sectionCode, docIndex: docIndex == null ? null : docIndex,
            title: existing?.title || existing?.caption || '',
            activity_date: existing?.activity_date ? String(existing.activity_date).slice(0, 10) : '',
            activity_time: existing?.activity_time || '', venue: existing?.venue || '', narrative: existing?.narrative || '',
            pendingFiles: [], pendingPreviews: []
        };
        render();
    }
    function closePhotoModal() {
        (state.photoModal?.pendingPreviews || []).forEach((url) => { try { URL.revokeObjectURL(url); } catch (_) { /* noop */ } });
        state.photoModal = null;
        render();
    }
    function updatePhotoModalField(key, input) { if (state.photoModal && !state.locked) state.photoModal[key] = input.value; }
    function addPhotoModalFiles(input) {
        if (!state.photoModal || state.locked || !input?.files?.length) return;
        Array.from(input.files).forEach((file) => {
            if (!IMAGE_EXT.test(file.name) && !(file.type || '').startsWith('image/')) { toast('Please choose image files only.', 'error'); return; }
            if (file.size > MAX_FILE_BYTES) { toast(`${file.name} must be 10 MB or smaller.`, 'error'); return; }
            state.photoModal.pendingFiles.push(file);
            state.photoModal.pendingPreviews.push(URL.createObjectURL(file));
        });
        input.value = '';
        render();
    }
    function removePendingPhoto(index) {
        if (!state.photoModal || state.locked) return;
        const url = state.photoModal.pendingPreviews[index];
        if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* noop */ } }
        state.photoModal.pendingFiles.splice(index, 1);
        state.photoModal.pendingPreviews.splice(index, 1);
        render();
    }
    function applyPhotoModalTo(row, modal, title) {
        row.section_code = modal.sectionCode; row.title = title; row.caption = title;
        row.activity_date = modal.activity_date || ''; row.activity_time = modal.activity_time || '';
        row.venue = modal.venue || ''; row.narrative = modal.narrative || '';
        const api = sourcesApi();
        ['title', 'activity_date', 'activity_time', 'venue', 'narrative'].forEach((k) => { if (row[k]) api?.markManual(row, k); });
    }
    async function savePhotoModal() {
        if (!state.photoModal || state.locked || state.busy) return;
        const modal = state.photoModal;
        const title = String(modal.title || '').trim();
        if (!title) { toast('Title is required for photo documentation.', 'error'); return; }
        if (!beginBusy('Saving documentation…')) return;
        try {
            await requireSession();
            state.rows.mfo_documentation_items = state.rows.mfo_documentation_items || [];
            let index = modal.docIndex;
            if (index == null) {
                const row = emptyRow(DOC_TABLE);
                applyPhotoModalTo(row, modal, title);
                state.rows.mfo_documentation_items.push(row);
                index = state.rows.mfo_documentation_items.length - 1;
            } else {
                applyPhotoModalTo(state.rows.mfo_documentation_items[index], modal, title);
            }
            await saveTable(DOC_TABLE);
            const recordId = state.rows.mfo_documentation_items[index]?.id;
            for (const file of modal.pendingFiles) await uploadPhotoFile(modal.sectionCode, recordId, file);
            (modal.pendingPreviews || []).forEach((url) => { try { URL.revokeObjectURL(url); } catch (_) { /* noop */ } });
            state.photoModal = null;
            toast('Photo documentation saved.');
        } catch (error) { toast(friendlyError(error, 'Unable to save photo documentation.'), 'error'); }
        finally { endBusy(); }
    }
    async function uploadPhotoFile(sectionCode, recordId, file) {
        if (!state.task?.id) throw new Error(state.taskWarning || 'An assigned MFO task is required before photos can be attached.');
        if (!state.submission?.id) await ensurePacket();
        if (!state.submission?.id) throw new Error('Could not open a submission record. Please reload and try again.');
        const packet = requirePacket();
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${state.faculty.id}/${state.task.id}/${packet.id}/photos/${Date.now()}-${safeName}`;
        const uploaded = await db().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (uploaded.error) throw uploaded.error;
        const pub = db().storage.from(BUCKET).getPublicUrl(path);
        await insertEvidenceFileOrCleanUp({
            submission_id: state.submission.id, task_id: state.task.id, faculty_id: state.faculty.id,
            file_name: file.name, file_url: pub.data?.publicUrl || '', storage_path: path, file_path: path,
            mfo_section: sectionCode, mfo_indicator: SECTIONS.find((d) => d.code === sectionCode)?.title || sectionCode,
            mfo_record_id: null, mfo_documentation_id: isUuid(recordId) ? recordId : null,
            mfo_sort_order: (state.files || []).filter((i) => String(i.mfo_documentation_id || '') === String(recordId)).length,
            mfo_packet_id: packet.id
        }, path);
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
                const linked = state.files.filter((f) => String(f.mfo_documentation_id || '') === String(recordId) || String(f.mfo_record_id || '') === String(recordId));
                for (const f of linked) await removeFile(f.id, { nested: true });
            }
            state.rows.mfo_documentation_items.splice(docIndex, 1);
            await saveTable(DOC_TABLE);
            toast('Photo documentation removed.');
        } catch (error) { toast(friendlyError(error, 'Unable to remove photo documentation.'), 'error'); }
        finally { endBusy(); }
    }
    function renderPhotoModal() {
        const modal = state.photoModal;
        if (!modal) return '';
        const section = SECTIONS.find((d) => d.code === modal.sectionCode);
        const sectionLabel = section ? (section.title || section.group) : modal.sectionCode;
        const existingPhotos = modal.docIndex != null && isUuid(state.rows.mfo_documentation_items?.[modal.docIndex]?.id)
            ? filesFor(modal.sectionCode, state.rows.mfo_documentation_items[modal.docIndex].id) : [];
        const existingThumbs = existingPhotos.map((f) => `<div class="mfo-photo-thumb-wrap">${photoThumb(f)}${state.locked ? '' : `<button type="button" class="mfo-photo-remove" onclick="CiteFlowMfoFaculty.removeFile('${f.id}')">×</button>`}</div>`).join('');
        const pendingThumbs = (modal.pendingPreviews || []).map((url, i) => `<div class="mfo-photo-thumb-wrap"><div class="mfo-photo-thumb"><img src="${esc(url)}" alt="Pending upload"></div><button type="button" class="mfo-photo-remove" onclick="CiteFlowMfoFaculty.removePendingPhoto(${i})">×</button></div>`).join('');
        return `<div class="fixed inset-0 z-[60] bg-slate-900/45 flex items-end sm:items-center justify-center p-4" onclick="if(event.target===this){CiteFlowMfoFaculty.closePhotoModal()}">
            <div class="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 shadow-xl">
                <div class="flex items-start justify-between gap-3 mb-4">
                    <div><div class="text-[11px] font-bold uppercase tracking-wide text-[#621708]">Photo documentation</div>
                    <h2 class="text-lg font-bold text-slate-900">${esc(sectionLabel)}</h2>
                    <p class="text-xs text-slate-500 mt-1">Optional. Title is required. Date, time, and venue are optional.</p></div>
                    <button type="button" class="text-slate-400 hover:text-slate-700 text-xl leading-none" onclick="CiteFlowMfoFaculty.closePhotoModal()">×</button>
                </div>
                <div class="space-y-3">
                    <div><label class="mfo-label">Title <span class="text-rose-600">*</span></label>
                    <input class="mfo-field" type="text" value="${esc(modal.title)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('title', this)" placeholder="Title of the activity / documentation"></div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div><label class="mfo-label">Date (optional)</label><input class="mfo-field" type="date" value="${esc(modal.activity_date)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('activity_date', this)"></div>
                        <div><label class="mfo-label">Time (optional)</label><input class="mfo-field" type="text" value="${esc(modal.activity_time)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('activity_time', this)" placeholder="e.g. 9:00 AM"></div>
                    </div>
                    <div><label class="mfo-label">Venue (optional)</label><input class="mfo-field" type="text" value="${esc(modal.venue)}" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('venue', this)" placeholder="Location / venue"></div>
                    <div><label class="mfo-label">Brief description / explanation</label><textarea class="mfo-field" rows="3" ${state.locked ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updatePhotoModalField('narrative', this)" placeholder="Short explanation">${esc(modal.narrative)}</textarea></div>
                    <div><label class="mfo-label">Photos (one or more)</label>
                        <div class="mfo-photo-grid mb-2">${existingThumbs}${pendingThumbs}</div>
                        ${state.locked ? '' : `<button type="button" class="cite-action" onclick="this.nextElementSibling.click()">+ Upload Photos</button>
                        <input type="file" accept="image/*" multiple class="mfo-file-input" onchange="CiteFlowMfoFaculty.addPhotoModalFiles(this)">`}
                    </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-2 mt-5">
                    <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePhotoModal()">Cancel</button>
                    ${state.locked ? '' : `<button type="button" class="cite-action-primary" ${state.busy ? 'disabled' : ''} onclick="CiteFlowMfoFaculty.savePhotoModal()">${state.busyLabel === 'Saving documentation…' ? 'Saving…' : 'Save Documentation'}</button>`}
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

    function formTable(def, ctx) {
        const labels = def.print.map((col) => (Array.isArray(col) ? col[0] : (def.fields || []).find((f) => f.key === col)?.label || col));
        const head = labels.map((l) => `<th>${esc(l)}</th>`).join('');
        const rows = state.rows[def.table] || [];
        const blank = `<tr>${labels.map(() => `<td>${NA}</td>`).join('')}</tr>`;
        const body = rows.length
            ? rows.map((row) => `<tr>${def.print.map((col) => `<td>${esc(resolvePrintColumn(def, col, row, ctx)[1])}</td>`).join('')}</tr>`).join('')
            : blank;
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function programLevelTable(indicator) {
        return `<table><thead><tr>${indicator.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody><tr>${indicator.columns.map(() => `<td>${NA}</td>`).join('')}</tr></tbody></table>`;
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
        (state.rows.mfo_documentation_items || []).forEach((row, index) => {
            entries.push({ row, docIndex: index, sectionCode: row.section_code, photos: takeImages(uniquePhotosForRecord(row.section_code, row.id)), others: filesFor(row.section_code, row.id).filter((f) => !fileIsImage(f)) });
        });
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
            (state.rows[def.table] || []).forEach((row) => {
                const photos = takeImages(filesFor(def.code, row.id));
                if (!photos.length) return;
                entries.push({
                    row: {
                        title: reportTitleFromRow(row, def.title),
                        activity_date: row.activity_date || row.date_granted || row.completed_at || row.published_at || row.presented_at || row.awarded_at || '',
                        activity_time: row.activity_time || '', venue: row.venue || row.project_locale || '',
                        narrative: row.narrative || row.remarks || row.description || ''
                    },
                    photos, others: []
                });
            });
        });
        return entries.filter((e) => {
            const row = e.row || {};
            return (e.photos || []).length || (e.others || []).length || reportTitleFromRow(row) || String(row.narrative || '').trim() || String(row.activity_date || '').trim() || String(row.venue || '').trim();
        });
    }

    function reportDocumentation(entries) {
        return entries.map((entry) => {
            const row = entry.row || entry;
            const images = entry.photos || [];
            const others = entry.others || [];
            const docIndex = Number.isInteger(entry.docIndex) ? entry.docIndex : -1;
            const details = [
                ['Date', reportDate(row.activity_date)], ['Time', String(row.activity_time || '').trim()],
                ['Venue', String(row.venue || '').trim()], ['Sponsoring agency', String(row.sponsoring_agency || '').trim()], ['Role', String(row.role || '').trim()]
            ].filter(([, v]) => v);
            const narrative = String(row.narrative || '').trim();
            const photos = images.map((f) => `<div class="mfo-doc-photo">
                <img alt="${esc(f.mfo_caption || f.file_name || 'Supporting photo')}" src="${esc(fileDisplaySrc(f))}"
                     data-storage-path="${esc(f.storage_path || f.file_path || '')}" data-file-url="${esc(f.file_url || '')}">
                ${f.mfo_caption ? `<div class="cap">${esc(f.mfo_caption)}</div>` : ''}
            </div>`).join('');
            return `<div class="mfo-doc-entry">
                <div class="t">${esc(reportTitleFromRow(row) || 'Untitled activity')}</div>
                ${details.length ? `<dl>${details.map(([l, v]) => `<dt>${esc(l)}:</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
                ${narrative ? `<div>${esc(narrative)}</div>` : ''}
                ${photos ? `<div class="mfo-doc-photos">${photos}</div>` : ''}
                ${others.length ? `<div style="margin-top:4px"><b>Attached documents:</b> ${others.map((f) => esc(f.file_name)).join('; ')}</div>` : ''}
                ${!state.locked && !state.reviewerMode && !state.printing && docIndex >= 0 ? `<div class="mfo-doc-edit">
                    <button type="button" onclick="CiteFlowMfoFaculty.openPhotoModal('${esc(entry.sectionCode || row.section_code || 'other_initiatives')}', ${docIndex})">Edit / add photos</button>
                    <button type="button" onclick="CiteFlowMfoFaculty.removePhotoDoc(${docIndex})">Remove entry</button>
                </div>` : ''}
            </div>`;
        }).join('');
    }

    async function hydrateReportPhotos() {
        const nodes = Array.from(document.querySelectorAll('#mfoReportDoc .mfo-doc-photo img'));
        await Promise.all(nodes.map(async (img) => {
            let src = String(img.getAttribute('src') || '').trim();
            const path = String(img.getAttribute('data-storage-path') || '').trim();
            const fallback = String(img.getAttribute('data-file-url') || '').trim();
            if (path && !src.startsWith('data:')) {
                try {
                    const signed = await db().storage.from(BUCKET).createSignedUrl(path, 3600);
                    if (signed.data?.signedUrl) src = signed.data.signedUrl;
                } catch (_) { /* fall through */ }
            }
            if (!src || src === '#' || (!src.startsWith('data:') && !src.startsWith('http'))) src = fallback || src;
            if (src && !src.startsWith('data:')) {
                try { src = await urlToDataUrl(src); }
                catch (_) { if (fallback && fallback !== src) { try { src = await urlToDataUrl(fallback); } catch (__) { /* give up on this photo */ } } }
            }
            if (src) img.src = src; else img.closest('.mfo-doc-photo')?.remove();
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

    function renderReportDocument() {
        const faculty = state.faculty, period = state.period || {};
        const ctx = { facultyName: faculty.full_name || '' };
        const photoEntries = reportPhotoEntries();

        const groupOrder = [];
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
            const last = groupOrder[groupOrder.length - 1];
            if (!last || last.group !== def.group) groupOrder.push({ group: def.group, bare: def.bare, items: [def] });
            else last.items.push(def);
        });

        const body = groupOrder.map((block, blockIndex) => {
            const only = block.items.length === 1 ? block.items[0] : null;
            const heading = `<div class="mfo-doc-group">${esc(block.group)}${block.bare && only ? officialNaMark(only.code) : ''}</div>`;
            // Program-level PI1/PI2 print inside the MFO 1 group, before PI3.
            const programTables = blockIndex === 0
                ? PROGRAM_LEVEL.map((ind) => `<div class="mfo-doc-pi">${esc(ind.heading)}</div>${programLevelTable(ind)}`).join('')
                : '';
            const tables = block.items.map((def) => `
                ${!block.bare ? `<div class="mfo-doc-pi">${esc(def.heading)}${officialNaMark(def.code)}</div>` : ''}
                ${formTable(def, ctx)}
            `).join('');
            return heading + programTables + tables;
        }).join('');

        const notes = String(state.packet?.notes || '').trim();

        return `<div class="mfo-doc" id="mfoReportDoc">
            ${reportHeader()}
            <div class="mfo-doc-title">Accomplishment Report – CY ${esc(period.reporting_year || '')}</div>
            <div class="mfo-doc-sub">${quarterLine(period)}</div>
            <div class="mfo-doc-sub">(for the Program Chairperson)</div>
            <div class="mfo-doc-ident">
                <div class="row"><span><b>Program Chairperson:</b> ${esc(tv(state.chairName))}</span><span><b>Program:</b> ${esc(tv(faculty.department || faculty.department_code))}</span></div>
                <div class="row"><span><b>Reporting Faculty:</b> ${esc(tv(faculty.full_name))}</span><span><b>Status:</b> ${esc(statusLabel())}</span></div>
            </div>
            <div class="mfo-doc-instr">Instructions: Fill in the table with the required data. Write NA for sections/items not applicable to your program.</div>
            ${body}
            <div class="mfo-doc-group">Other accomplishment/s of the program that you would like the College to report for this quarter:</div>
            <div class="mfo-doc-note">(policies created, external grant for instruction/research/extension, etc.)</div>
            <div class="mfo-doc-lines">${notes ? esc(notes) : NA}</div>
            <div class="mfo-doc-sign">
                <div class="box"><div><b>Date Submitted:</b></div><div class="line"></div><div>${esc(state.submission?.submitted_at ? reportDate(state.submission.submitted_at) : NA)}</div></div>
                <div class="box"><div><b>Submitted by:</b></div><div class="line"></div><div>${esc(tv(faculty.full_name))}</div></div>
            </div>
            ${photoEntries.length ? renderDocumentationPages(photoEntries, period) : ''}
            ${reportFooter()}
        </div>`;
    }

    function renderDocumentationPages(rows, period) {
        return `<div class="mfo-doc-break"></div>
            <div class="mfo-doc-title">Supporting Documentation</div>
            <div class="mfo-doc-sub">Accomplishment Report – CY ${esc(period.reporting_year || '')} · ${quarterLine(period)}</div>
            <div class="mfo-doc-sub">${esc(tv(state.faculty.full_name))}</div>
            ${reportDocumentation(rows)}
            ${!state.locked && !state.reviewerMode && !state.printing ? `<div class="mfo-doc-edit"><button type="button" onclick="CiteFlowMfoFaculty.openPhotoModal('other_initiatives')">Add photo documentation</button></div>` : ''}`;
    }

    function renderPreview() {
        const root = document.getElementById('mfoApp');
        if (!root || !state.faculty) return;
        root.innerHTML = `<div class="mfo-doc-toolbar mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><div class="cite-kicker">${state.reviewerMode ? 'Submitted report (read-only)' : 'Completed report'}</div>
            <h1 class="cite-title">MFO Accomplishment Report</h1>
            <p class="cite-subtitle">${esc(statusLabel())}${state.reviewerMode ? ` · ${esc(state.faculty.full_name || '')}` : ' · reflects the last saved values.'}</p></div>
            <div class="flex flex-col sm:flex-row gap-2">
                ${state.reviewerMode
                    ? `<button type="button" class="cite-action" onclick="if (history.length > 1) history.back(); else location.href = '${state.reviewerIsAdmin ? '../admin/workflow-approval.html' : 'submissions.html#chair-review'}';">← Back</button>`
                    : '<button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.closePreview()">← Back to editor</button>'
                }
                ${state.reviewerMode && reviewerCanAct() ? `
                <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.reviewerAction('approved')">
                    ${state.reviewerIsAdmin ? '<i class="fa-solid fa-check-double mr-1"></i> Certify & Approve' : '<i class="fa-solid fa-check mr-1"></i> Approve'}
                </button>
                <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewerAction('revision')">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Request Revision
                </button>
                <button type="button" class="cite-action" onclick="CiteFlowMfoFaculty.reviewerAction('rejected')">
                    <i class="fa-solid fa-xmark mr-1"></i> Decline
                </button>` : ''}
                <button type="button" class="cite-action-primary" onclick="CiteFlowMfoFaculty.printReport()"><i class="fa-solid fa-print"></i> Print</button>
            </div>
        </div>
        ${renderReportDocument()}
        ${renderPhotoModal()}`;
        if (!state.photoModal) window.scrollTo({ top: 0, behavior: 'auto' });
        hydrateReportPhotos();
    }

    async function openPreview() {
        if (state.busy) return;
        if (!state.locked) {
            if (!beginBusy('Saving…')) return;
            try { await saveDraftInternal(); }
            catch (error) { toast('Note: could not save changes before preview. Showing local values.', 'error'); }
            finally { endBusy(); }
        }
        state.previewOpen = true;
        render();
    }
    function closePreview() { if (state.reviewerMode) return; state.previewOpen = false; render(); }
    async function printReport() {
        if (!state.previewOpen) return;
        state.printing = true; render();
        toast('Preparing photos for print…');
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
        if (!state.faculty) return;
        if (state.previewOpen) { renderPreview(); return; }

        const faculty = state.faculty;
        const grouped = [];
        SECTIONS.filter((d) => !d.isDocumentation).forEach((def) => {
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
            <div class="mfo-sticky rounded-[16px] p-4 mb-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div><div class="text-sm font-bold">${esc(statusLabel())}</div>
                <div class="text-xs text-slate-500">Last saved: ${esc(formatWhen(state.lastSaved || state.packet?.updated_at))}</div></div>
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
                    <div><div class="mfo-label">Faculty name</div><div class="font-semibold">${esc(faculty.full_name)}</div></div>
                    <div><div class="mfo-label">Faculty ID</div><div class="font-semibold">${esc(faculty.id)}</div></div>
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
            ${renderFacultySection(DOC_TABLE)}
            ${renderOtherNotes()}
            ${renderReview()}
            ${renderSubmitModal()}
            ${renderPhotoModal()}`;
        hydrateEditorPhotoNodes();
    }

    function renderOtherNotes() {
        return `<section class="surface rounded-[16px] p-5 mb-4">
            <h2 class="text-base font-bold mb-1">Other accomplishment/s of the program</h2>
            <p class="text-xs text-slate-500 mb-3">(policies created, external grant for instruction/research/extension, etc.)</p>
            <textarea class="mfo-field" rows="4" ${state.locked || state.busy ? 'disabled' : ''} oninput="CiteFlowMfoFaculty.updateNotes(this)" placeholder="Additional details for this quarter">${esc(state.packet?.notes || '')}</textarea>
        </section>`;
    }

    global.CiteFlowMfoFaculty = {
        updateRow, addRow, removeRow, setSectionNa, updateNotes, persistNotes,
        saveDraft, submitPacket, openPreview, closePreview, printReport, reviewerAction,
        uploadFile, removeFile, render, openPhotoModal, closePhotoModal, updatePhotoModalField,
        addPhotoModalFiles, removePendingPhoto, savePhotoModal, removePhotoDoc,
        closeSubmitModal, confirmSubmitPacket,
        toggleAutoNaBlanks, autoMarkBlankSectionsAsNa, undoBlankSectionsNa,
        autoMarkAllBlankAsNa() { autoMarkBlankSectionsAsNa(); render(); toast('All empty sections set to N/A.'); },
        undoAllBlankNa() { undoBlankSectionsNa(); render(); toast('Reverted N/A on blank sections.'); },
        reviewOpen(open) { state.reviewOpen = !!open; render(); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window);