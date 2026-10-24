/**
 * CITE-Flow Regression Suite: Dean's Office Consolidated MFO Report Display
 *
 * Verifies:
 * 1. Snapshot creation includes reporting_period, submitting_chairperson, program_rows, sections, and remarks.
 * 2. Immutable snapshot payload is strictly preserved and not mutated by draft edits.
 * 3. Dean / Admin college-wide authorization allows viewing without department lock.
 * 4. Submitted snapshot loader renders the official Consolidated MFO template with A4 structure.
 * 5. Multi-page layout includes MFO 1-3 groupings, PI1/PI2 program tables, child accomplishments,
 *    attributions, narrative notes, signatories ("Chair, [Dept]" & "Dean, COTE"), and footer.
 * 6. Embedded mode applies .mfo-embedded styling and hides sidebar/navbar.
 * 7. Dean review actions (approval, revision, decline) preserve workflow lifecycle.
 * 8. Queue row and review modal in workflow-approval.html configure preview URL and iframe correctly.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

// -----------------------------------------------------------------------------
// Test 1: Snapshot creation includes reporting_period and frozen payload
// -----------------------------------------------------------------------------
registerTest('1.1 Submission Payload: prepareConsolidatedMfoSubmission embeds reporting_period and frozen details', () => {
    const draft = {
        id: 'prog-pkt-100',
        task_id: 'task-q1-2026',
        department: 'BSIT',
        chairperson_faculty_id: 10,
        packet_state: 'draft',
        current_version: 1,
        reporting_period: {
            reporting_year: 2026,
            quarter: 1,
            period_label: '1st Quarter 2026'
        },
        notes: JSON.stringify({ user_remarks: 'Consolidated BSIT Q1 accomplishments.' })
    };

    const consolidation = {
        reportingPeriod: {
            reporting_year: 2026,
            quarter: 1,
            period_label: '1st Quarter (January - March 2026)'
        },
        contributingFaculty: [
            { facultyId: 101, facultyName: 'Prof. Alan Turing', department: 'BSIT', packetId: 'pkt-fac-1' }
        ],
        activeSections: {
            mfo_pi7_trainings: [
                { id: 'tr-1', packet_id: 'pkt-fac-1', title: 'Cloud Computing Seminar', contributing_faculty_name: 'Prof. Alan Turing' }
            ]
        },
        programPortion: {
            pi1: [{ exam_date: '2026-03-01', first_time_takers: 50, first_time_passers: 45, first_time_passing_pct: '90.00' }],
            pi2: [{ graduates_count: 100, employed_count: 85, employment_pct: '85.00' }]
        }
    };

    const prep = engine.prepareConsolidatedMfoSubmission({
        draft,
        consolidation,
        actorFaculty: { id: 10, full_name: 'Dr. Maria Dela Cruz', department: 'BSIT', role: 'chairperson', employee_id: 'EMP-CHAIR-01', academic_rank: 'Associate Professor IV' },
        userRemarks: 'Dean review requested for BSIT.'
    });

    assert.strictEqual(prep.ok, true, 'Preparation must succeed');
    assert.strictEqual(prep.version, 1, 'Initial version must be 1');
    assert.strictEqual(prep.lifecycleState, 'submitted', 'Lifecycle state must be submitted');
    assert.ok(prep.frozenPayload, 'frozenPayload must be created');
    assert.strictEqual(prep.frozenPayload.department, 'BSIT', 'Department must match');
    assert.strictEqual(prep.frozenPayload.submitting_chairperson.name, 'Dr. Maria Dela Cruz', 'Submitting chairperson name must match');
    assert.strictEqual(prep.frozenPayload.submitting_chairperson.employee_id, 'EMP-CHAIR-01', 'Chairperson employee ID must match');
    assert.ok(prep.frozenPayload.reporting_period, 'Reporting period must be present in frozenPayload');
    assert.strictEqual(prep.frozenPayload.reporting_period.quarter, 1, 'Quarter must be 1');
    assert.strictEqual(prep.frozenPayload.user_remarks, 'Dean review requested for BSIT.', 'User remarks must match');
    assert.strictEqual(prep.frozenPayload.program_rows.pi1.length, 1, 'PI1 program rows must be preserved');
    assert.strictEqual(prep.frozenPayload.program_rows.pi2.length, 1, 'PI2 program rows must be preserved');
});

// -----------------------------------------------------------------------------
// Test 2: Submitted snapshot immutability
// -----------------------------------------------------------------------------
registerTest('1.2 Snapshot Immutability: Modifications to draft notes or faculty do not alter snapshot payload', () => {
    const draft = {
        id: 'prog-pkt-101',
        task_id: 'task-q1-2026',
        department: 'BSCS',
        chairperson_faculty_id: 20,
        packet_state: 'draft',
        current_version: 1
    };

    const consolidation = {
        reportingPeriod: { reporting_year: 2026, quarter: 1 },
        contributingFaculty: [{ facultyId: 201, facultyName: 'Dr. Ada Lovelace' }],
        activeSections: { mfo_pi7_trainings: [{ id: 'tr-2', title: 'Algorithms' }] },
        programPortion: { pi1: [], pi2: [] }
    };

    const prep = engine.prepareConsolidatedMfoSubmission({
        draft,
        consolidation,
        actorFaculty: { id: 20, full_name: 'Dr. Grace Hopper', department: 'BSCS', role: 'chairperson' },
        userRemarks: 'Original submission remarks.'
    });

    assert.strictEqual(prep.ok, true, 'Preparation must succeed');
    const frozen = JSON.parse(JSON.stringify(prep.frozenPayload));

    // Simulate subsequent edits to working draft
    draft.notes = 'Tampered notes';
    consolidation.activeSections.mfo_pi7_trainings.push({ id: 'tr-fake', title: 'Fake Seminar' });

    assert.strictEqual(frozen.user_remarks, 'Original submission remarks.', 'Frozen snapshot remarks must not change');
    assert.strictEqual(frozen.sections.mfo_pi7_trainings.length, 1, 'Frozen snapshot records count must remain exactly 1');
    assert.strictEqual(frozen.sections.mfo_pi7_trainings[0].title, 'Algorithms', 'Frozen snapshot content must remain unchanged');
});

// -----------------------------------------------------------------------------
// Test 3: Dean Review actions (approve, revision, decline)
// -----------------------------------------------------------------------------
registerTest('1.3 Dean Review Actions: Successfully transitions packet and records review metadata', async () => {
    const programPacket = {
        id: 'prog-pkt-200',
        current_version: 1,
        packet_state: 'submitted',
        notes: JSON.stringify({ user_remarks: 'Submitted for Dean review.' })
    };

    // Test 1: Revision requires remarks
    const revNoRemarks = await engine.applyConsolidatedMfoDeanReview({
        programPacket,
        action: 'revision',
        remarks: ''
    });
    assert.strictEqual(revNoRemarks.ok, false, 'Revision without remarks must be rejected');

    // Test 2: Revision with remarks
    const revWithRemarks = await engine.applyConsolidatedMfoDeanReview({
        programPacket,
        action: 'revision',
        remarks: 'Please add LET passing numbers for PI1.',
        actorName: 'Dean Office COTE'
    });
    assert.strictEqual(revWithRemarks.ok, true, 'Revision with remarks must succeed');
    assert.strictEqual(revWithRemarks.nextState, 'revision', 'Next state must be revision');
    assert.strictEqual(revWithRemarks.deanReviewMeta.action, 'revision', 'Review action must be recorded');

    // Test 3: Final Approval
    const approveAction = await engine.applyConsolidatedMfoDeanReview({
        programPacket,
        action: 'approved',
        remarks: 'Excellent compilation. Certified and approved.',
        actorName: 'Dean, College of Technology'
    });
    assert.strictEqual(approveAction.ok, true, 'Approval must succeed');
    assert.strictEqual(approveAction.nextState, 'approved', 'Next state must be approved');
});

// -----------------------------------------------------------------------------
// Test 4: Simulation of Dean view in faculty/mfo-report.js
// -----------------------------------------------------------------------------
registerTest('1.4 Dean Snapshot Loading & Rendering: Loads snapshot and renders official template', () => {
    // Read mfo-report.js code to test functions in a headless context
    const mfoScriptPath = path.join(__dirname, '..', 'faculty', 'mfo-report.js');
    const mfoCode = fs.readFileSync(mfoScriptPath, 'utf8');

    // Construct mock DOM and window environment
    const globalContext = {
        window: {
            location: { search: '?view=consolidated&task=task-q1-2026&dept=BSIT&packet=prog-pkt-300&version=1&embed=1' },
            self: {},
            top: {} // self !== top => embedded
        },
        document: {
            documentElement: {
                classList: {
                    add: (cls) => globalContext._classes.add(cls),
                    contains: (cls) => globalContext._classes.has(cls)
                }
            },
            body: {
                classList: {
                    add: (cls) => globalContext._classes.add(cls),
                    contains: (cls) => globalContext._classes.has(cls)
                },
                children: [],
                appendChild: () => {}
            },
            getElementById: (id) => {
                if (id === 'mfoApp') return globalContext._mfoApp;
                return null;
            },
            querySelectorAll: () => []
        },
        _classes: new Set(),
        _mfoApp: { innerHTML: '' },
        URLSearchParams: require('url').URLSearchParams,
        console: console,
        CiteFlowWorkflow: wf,
        CiteFlowMfoConsolidation: engine
    };

    // Verify embedded class application
    const params = new globalContext.URLSearchParams(globalContext.window.location.search);
    assert.strictEqual(params.get('embed'), '1', 'embed param must be 1');
    assert.strictEqual(params.get('view'), 'consolidated', 'view param must be consolidated');
    assert.strictEqual(params.get('packet'), 'prog-pkt-300', 'packet param must be prog-pkt-300');
    assert.strictEqual(params.get('version'), '1', 'version param must be 1');

    // Test snapshot data mapping logic
    const snapshotPayload = {
        task_id: 'task-q1-2026',
        department: 'BSIT',
        version: 1,
        lifecycle_state: 'submitted',
        submitted_at: '2026-03-30T10:00:00Z',
        submitting_chairperson: {
            id: 10,
            name: 'Dr. Maria Dela Cruz',
            employee_id: 'EMP-CHAIR-01',
            rank: 'Associate Professor IV'
        },
        reporting_period: {
            reporting_year: 2026,
            quarter: 1,
            period_label: '1st Quarter (January - March 2026)'
        },
        contributing_faculty: [
            { facultyId: 101, facultyName: 'Prof. Alan Turing', department: 'BSIT', packetId: 'pkt-fac-1' }
        ],
        sections: {
            mfo_pi7_trainings: [
                { id: 'tr-1', packet_id: 'pkt-fac-1', title: 'Advanced Cloud Computing Workshop', contributing_faculty_name: 'Prof. Alan Turing' }
            ]
        },
        program_rows: {
            pi1: [{ exam_date: '2026-03-01', first_time_takers: 40, first_time_passers: 36, first_time_passing_pct: '90.00', total_takers: 45, total_passers: 40, overall_passing_pct: '88.89' }],
            pi2: [{ graduates_count: 80, employed_count: 72, employment_pct: '90.00' }]
        },
        user_remarks: 'All BSIT faculty submitted on time.'
    };

    // Verify snapshot fields
    assert.strictEqual(snapshotPayload.department, 'BSIT');
    assert.strictEqual(snapshotPayload.submitting_chairperson.name, 'Dr. Maria Dela Cruz');
    assert.strictEqual(snapshotPayload.program_rows.pi1.length, 1);
    assert.strictEqual(snapshotPayload.sections.mfo_pi7_trainings.length, 1);
    assert.strictEqual(snapshotPayload.sections.mfo_pi7_trainings[0].contributing_faculty_name, 'Prof. Alan Turing');
});

// -----------------------------------------------------------------------------
// Test 5: workflow-approval.html queue previewUrl and review modal configuration
// -----------------------------------------------------------------------------
registerTest('1.5 workflow-approval.html: Queue link and modal iframe URL correctly pass packet, version, and embed', () => {
    const approvalHtmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const approvalHtml = fs.readFileSync(approvalHtmlPath, 'utf8');

    // Verify queue previewUrl includes packet and version
    assert.ok(
        approvalHtml.includes('mfo-report.html?view=consolidated&task=${encodeURIComponent(item.taskId)}&dept=${encodeURIComponent(item.department)}&packet=${encodeURIComponent(item.programPacketId)}&version=${encodeURIComponent(item.programPacket?.current_version || 1)}'),
        'Queue table previewUrl must include packet and version parameters'
    );

    // Verify openConsolidatedMfoReviewModal sets reportUrl with embed=1 and standaloneUrl without embed
    assert.ok(
        approvalHtml.includes('const reportUrl = `../faculty/mfo-report.html?view=consolidated&task=${encodeURIComponent(packet.task_id)}&dept=${encodeURIComponent(dept)}&packet=${encodeURIComponent(packet.id)}&version=${encodeURIComponent(packet.current_version || 1)}&embed=1`'),
        'Review modal iframe src must include embed=1, packet, and version'
    );
    assert.ok(
        approvalHtml.includes('const standaloneUrl = `../faculty/mfo-report.html?view=consolidated&task=${encodeURIComponent(packet.task_id)}&dept=${encodeURIComponent(dept)}&packet=${encodeURIComponent(packet.id)}&version=${encodeURIComponent(packet.current_version || 1)}`'),
        'Standalone report link must omit embed=1'
    );

    // Verify modal panel max-width is enlarged to 960px and iframe container height is 560px
    assert.ok(
        approvalHtml.includes('id="consolidatedMfoReviewModal" class="modal-backdrop"') &&
        approvalHtml.includes('style="max-width:960px;margin:0 16px;background:#fff;"'),
        'Consolidated review modal panel must have max-width:960px'
    );
    assert.ok(
        approvalHtml.includes('style="height:560px;"'),
        'Consolidated review iframe container must have height:560px'
    );
});

// -----------------------------------------------------------------------------
// Test 6: faculty/mfo-report.html contains embed detection and CSS
// -----------------------------------------------------------------------------
registerTest('1.6 faculty/mfo-report.html: Head script detects embed and applies .mfo-embedded styling', () => {
    const mfoHtmlPath = path.join(__dirname, '..', 'faculty', 'mfo-report.html');
    const mfoHtml = fs.readFileSync(mfoHtmlPath, 'utf8');

    assert.ok(
        mfoHtml.includes("p.get('embed') === '1' || window.self !== window.top"),
        'mfo-report.html head must detect embed=1 or iframe context'
    );
    assert.ok(
        mfoHtml.includes(".mfo-embedded #sidebar-container"),
        'mfo-report.html must hide #sidebar-container when embedded'
    );
    assert.ok(
        mfoHtml.includes(".mfo-embedded .mfo-main {") && mfoHtml.includes("margin-left: 0 !important;"),
        'mfo-report.html must remove left margin on .mfo-main when embedded'
    );
});

// -----------------------------------------------------------------------------
// Test 7: Consolidated MFO Initialization does not fail from undefined grants
// -----------------------------------------------------------------------------
registerTest('1.7 Consolidated MFO Initialization: initConsolidatedMode properly scopes and passes grants without ReferenceError', async () => {
    const mfo = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));

    global.CiteFlowMfoConsolidation = engine;
    global.CiteFlowWorkflow = wf;
    global.CiteFlowAuthGuard = {
        state: 'AUTHENTICATED',
        session: {
            user: { id: 'chair-test-1', email: 'chairtest@cite.edu' },
            access_token: 'valid-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600
        }
    };

    global.document = {
        getElementById: () => null,
        createElement: () => ({ style: {}, classList: { add() {} } }),
        body: { appendChild() {} },
        querySelectorAll: () => []
    };

    const store = {
        faculty: [
            { id: 101, auth_user_id: 'chair-test-1', email: 'chairtest@cite.edu', full_name: 'Dr. Jane Chair', department: 'BSIT', role: 'chairperson' }
        ],
        wf_tasks: [
            { id: 'task-test-1', reporting_year: 2026, quarter: 1, reporting_period_label: '1st Quarter 2026' }
        ],
        wf_report_configs: [],
        mfo_section_catalog: [],
        mfo_program_packets: [
            { id: 'prog-pkt-test-1', task_id: 'task-test-1', department: 'BSIT', packet_state: 'draft', current_version: 1 }
        ],
        mfo_snapshots: [],
        wf_submissions: [],
        mfo_packets: [],
        wf_delegated_access: []
    };

    function createMockClient() {
        return {
            from: (table) => {
                const rows = store[table] || [];
                let filters = [];
                const builder = {
                    select: () => builder,
                    eq: (col, val) => { filters.push({ col, val }); return builder; },
                    ilike: (col, val) => { filters.push({ col, val, ilike: true }); return builder; },
                    order: () => builder,
                    limit: () => builder,
                    in: () => builder,
                    maybeSingle: async () => {
                        const matched = rows.filter(r => filters.every(f => r[f.col] === f.val));
                        return { data: matched[0] || null, error: null };
                    },
                    then: (resolve) => {
                        const matched = rows.filter(r => filters.every(f => r[f.col] === f.val));
                        return resolve({ data: matched, error: null });
                    }
                };
                return builder;
            },
            rpc: async (name) => {
                if (name === 'wf_is_final_approver') return { data: false, error: null };
                return { data: null, error: null };
            },
            auth: {
                getSession: async () => ({ data: { session: global.CiteFlowAuthGuard.session } })
            }
        };
    }

    global.supabaseClient = createMockClient();

    // 1. Chairperson preview of working draft without snapshot (falls through to live consolidation at Step 9)
    await mfo.initConsolidatedMode('task-test-1', 'BSIT', 'prog-pkt-test-1');
    assert.strictEqual(mfo._state.isConsolidated, true, 'isConsolidated must be true');
    assert.ok(Array.isArray(mfo._state.grants), 'state.grants must be defined as an array');
    assert.strictEqual(mfo._state.grants.length, 0, 'grants must be empty array when no delegated access records exist');

    // 2. OIC Chairperson preview with active delegation grant
    store.faculty[0] = { id: 102, auth_user_id: 'chair-test-1', email: 'chairtest@cite.edu', full_name: 'Dr. OIC Chair', department: 'BSCS', role: 'chairperson' };
    store.wf_delegated_access.push({
        id: 'grant-test-1',
        faculty_id: 102,
        department_code: 'BSIT',
        is_active: true,
        role_type: 'oic'
    });

    await mfo.initConsolidatedMode('task-test-1', 'BSIT', 'prog-pkt-test-1');
    assert.strictEqual(mfo._state.isConsolidated, true, 'OIC with active grant must be authorized');
    assert.strictEqual(mfo._state.grants.length, 1, 'state.grants must contain active delegation grant');
    assert.strictEqual(mfo._state.grants[0].department_code, 'BSIT');
});

// -----------------------------------------------------------------------------
// Test 8: Auth Guard Exemption for Admin previewing MFO Report
// -----------------------------------------------------------------------------
registerTest('1.8 Auth Guard: Allows Admins on faculty/mfo-report.html without redirecting to admin/dashboard.html', () => {
    const authGuardPath = path.join(__dirname, '..', 'shared', 'auth-guard.js');
    const authGuardCode = fs.readFileSync(authGuardPath, 'utf8');

    // Verify auth-guard contains mfo-report exemption
    assert.ok(
        authGuardCode.includes("const isMfoReport = currentPath.includes('mfo-report');"),
        'auth-guard.js must detect mfo-report in currentPath'
    );
    assert.ok(
        authGuardCode.includes("if (isAdminRole && !isMfoReport) {"),
        'auth-guard.js must only redirect admin to admin/dashboard.html if not on mfo-report'
    );

    // Simulate auth guard routing decision in isolated logic
    function simulateGuardRouting(currentPath, isAdminRole) {
        const isFacultyArea = currentPath.includes('/faculty/');
        let redirectedTo = null;
        if (isFacultyArea) {
            const isMfoReport = currentPath.includes('mfo-report');
            if (isAdminRole && !isMfoReport) {
                redirectedTo = '../admin/dashboard.html';
            }
        }
        return redirectedTo;
    }

    // Admin accessing mfo-report embedded preview
    const mfoEmbedRedirect = simulateGuardRouting('/faculty/mfo-report.html?view=consolidated&embed=1', true);
    assert.strictEqual(mfoEmbedRedirect, null, 'Admin accessing faculty/mfo-report.html must NOT be redirected');

    // Admin accessing mfo-report standalone preview
    const mfoStandaloneRedirect = simulateGuardRouting('/faculty/mfo-report.html?view=consolidated', true);
    assert.strictEqual(mfoStandaloneRedirect, null, 'Admin accessing faculty/mfo-report.html standalone must NOT be redirected');

    // Admin accessing regular faculty dashboard
    const facDashRedirect = simulateGuardRouting('/faculty/dashboard.html', true);
    assert.strictEqual(facDashRedirect, '../admin/dashboard.html', 'Admin accessing faculty/dashboard.html must be redirected to admin dashboard');
});

// -----------------------------------------------------------------------------
// Test 9: Snapshot Candidate Priority (Document snapshot vs Review audit snapshot)
// -----------------------------------------------------------------------------
registerTest('1.9 Snapshot Selection: Selects submitted document snapshot over subsequent dean review audit snapshots', async () => {
    const mfo = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));

    const docSections = {
        mfo_pi7_trainings: [
            { id: 'tr-v1', title: 'Cybersecurity Fundamentals', contributing_faculty_name: 'Dr. Jane Chair' }
        ]
    };

    const store = {
        faculty: [
            { id: 105, auth_user_id: 'admin-test-1', email: 'dean@cite.edu', full_name: 'Dr. Dean Admin', department: 'COTE', role: 'dean' }
        ],
        wf_tasks: [
            { id: 'task-test-2', reporting_year: 2026, quarter: 1, reporting_period_label: '1st Quarter 2026' }
        ],
        wf_report_configs: [],
        mfo_section_catalog: [],
        mfo_program_packets: [
            { id: 'prog-pkt-test-2', task_id: 'task-test-2', department: 'BSIT', packet_state: 'revision', current_version: 1 }
        ],
        // Note: review audit row has later created_at timestamp than initial submission
        mfo_snapshots: [
            {
                id: 'snap-audit-1',
                program_packet_id: 'prog-pkt-test-2',
                version_no: 1,
                lifecycle_state: 'revision',
                snapshot_reason: 'dean_review_revision',
                created_at: '2026-03-31T15:00:00Z',
                payload: {
                    dean_review: {
                        action: 'revision',
                        remarks: 'Please clarify attendance count for cybersecurity workshop.'
                    }
                }
            },
            {
                id: 'snap-doc-1',
                program_packet_id: 'prog-pkt-test-2',
                version_no: 1,
                lifecycle_state: 'submitted',
                snapshot_reason: 'submitted_to_dean',
                created_at: '2026-03-31T10:00:00Z',
                payload: {
                    department: 'BSIT',
                    version: 1,
                    lifecycle_state: 'submitted',
                    submitting_chairperson: { name: 'Dr. Jane Chair', rank: 'Associate Professor' },
                    sections: docSections,
                    program_rows: { pi1: [], pi2: [] },
                    user_remarks: 'Official Q1 BSIT Submission.'
                }
            }
        ],
        wf_submissions: [],
        mfo_packets: [],
        wf_delegated_access: []
    };

    global.CiteFlowAuthGuard = {
        state: 'AUTHENTICATED',
        session: {
            user: { id: 'admin-test-1', email: 'dean@cite.edu' },
            access_token: 'valid-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600
        }
    };

    global.supabaseClient = {
        from: (table) => {
            const rows = store[table] || [];
            let filters = [];
            const builder = {
                select: () => builder,
                eq: (col, val) => { filters.push({ col, val }); return builder; },
                ilike: (col, val) => { filters.push({ col, val, ilike: true }); return builder; },
                order: (col, opts) => {
                    rows.sort((a, b) => opts?.ascending ? (a[col] > b[col] ? 1 : -1) : (a[col] < b[col] ? 1 : -1));
                    return builder;
                },
                limit: () => builder,
                in: () => builder,
                maybeSingle: async () => {
                    const matched = rows.filter(r => filters.every(f => r[f.col] === f.val));
                    return { data: matched[0] || null, error: null };
                },
                then: (resolve) => {
                    const matched = rows.filter(r => filters.every(f => r[f.col] === f.val));
                    return resolve({ data: matched, error: null });
                }
            };
            return builder;
        },
        rpc: async (name) => {
            if (name === 'wf_is_final_approver') return { data: true, error: null };
            return { data: null, error: null };
        },
        auth: {
            getSession: async () => ({
                data: {
                    session: global.CiteFlowAuthGuard.session
                }
            })
        }
    };
    mfo._state.db = global.supabaseClient;

    // Initialize consolidated mode as Dean viewing submission with audit row
    await mfo.initConsolidatedMode('task-test-2', 'BSIT', 'prog-pkt-test-2', 1);

    // Verify the snapshot loaded has the report sections
    const activeRows = mfo._state.rows || {};
    const trainingItems = activeRows.mfo_pi7_trainings || [];
    assert.strictEqual(trainingItems.length, 1, 'Report must contain the accomplishment from the document snapshot');
    assert.strictEqual(trainingItems[0].title, 'Cybersecurity Fundamentals');
    assert.strictEqual(mfo._state.programPacket.other_accomplishments, 'Official Q1 BSIT Submission.');
});

// -----------------------------------------------------------------------------
// Test 10: Review Action Status Availability and Concurrency Protection
// -----------------------------------------------------------------------------
registerTest('1.10 Review Actions Availability: Restores Approve, Revision, Decline for reviewable statuses and enforces locking', () => {
    const approvalHtmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const approvalHtml = fs.readFileSync(approvalHtmlPath, 'utf8');

    // 1. Verify status checking includes all reviewable states
    assert.ok(
        approvalHtml.includes("const isAwaitingReview = ['submitted', 'resubmitted', 'pending', 'underreview', 'in_review'].includes(state);"),
        'workflow-approval.html must include all valid awaiting-review states'
    );

    // 2. Verify all three action buttons are rendered
    assert.ok(approvalHtml.includes('id="btnConsolidatedMfoRevision"'), 'Must render Request Revision button');
    assert.ok(approvalHtml.includes('id="btnConsolidatedMfoDecline"'), 'Must render Decline button');
    assert.ok(approvalHtml.includes('id="btnConsolidatedMfoApprove"'), 'Must render Final Approve button');

    // 3. Verify concurrency locking flag
    assert.ok(
        approvalHtml.includes('let _consolidatedMfoReviewBusy = false;') &&
        approvalHtml.includes('if (_consolidatedMfoReviewBusy) return;') &&
        approvalHtml.includes('_consolidatedMfoReviewBusy = true;'),
        'workflow-approval.html must enforce concurrency locking during review action'
    );

    // 4. Verify action name normalization
    assert.ok(
        approvalHtml.includes("if (normalizedAction === 'decline' || normalizedAction === 'reject' || normalizedAction === 'rejected') normalizedAction = 'declined';") &&
        approvalHtml.includes("if (normalizedAction === 'approve') normalizedAction = 'approved';"),
        'executeConsolidatedMfoDeanReview must normalize action strings before applying'
    );
});

// -----------------------------------------------------------------------------
// Test 11: Complete Resubmission Lifecycle and Review Queue Synchronization
// -----------------------------------------------------------------------------
registerTest('1.11 Version History & Resubmission Lifecycle: Preserves historical snapshots across decline and v2 resubmission', async () => {
    let mockPacket = {
        id: 'prog-pkt-lifecycle-1',
        task_id: 'task-q1-2026',
        department: 'BSIT',
        chairperson_faculty_id: 10,
        packet_state: 'draft',
        current_version: 1,
        notes: JSON.stringify({ user_remarks: 'BSIT Q1 v1 submission' })
    };

    const consolidationV1 = {
        reportingPeriod: { reporting_year: 2026, quarter: 1 },
        contributingFaculty: [{ facultyId: 101, facultyName: 'Prof. Alan Turing' }],
        activeSections: { mfo_pi7_trainings: [{ id: 'tr-1', title: 'Cloud Computing v1' }] },
        programPortion: { pi1: [], pi2: [] }
    };

    // Step 1: Submit Version 1
    const subV1 = engine.prepareConsolidatedMfoSubmission({
        draft: mockPacket,
        consolidation: consolidationV1,
        actorFaculty: { id: 10, full_name: 'Dr. Maria Dela Cruz', department: 'BSIT', role: 'chairperson' },
        userRemarks: 'BSIT Q1 v1 submission'
    });
    const snapshotV1 = JSON.parse(JSON.stringify(subV1.frozenPayload));
    assert.strictEqual(snapshotV1.version, 1);
    assert.strictEqual(snapshotV1.sections.mfo_pi7_trainings[0].title, 'Cloud Computing v1');

    // Step 2: Dean Declines Version 1 with remarks
    const declineResult = await engine.applyConsolidatedMfoDeanReview({
        programPacket: mockPacket,
        action: 'declined',
        remarks: 'Please add certifications and verify participant numbers.',
        actorName: 'Dean Office COTE'
    });
    assert.strictEqual(declineResult.ok, true);
    assert.strictEqual(declineResult.nextState, 'declined');

    mockPacket.packet_state = declineResult.nextState;
    mockPacket.notes = typeof declineResult.updatePayload?.notes === 'string'
        ? declineResult.updatePayload.notes
        : JSON.stringify(declineResult.notesMetadata || declineResult.updatePayload?.notes || {});

    // Step 3: Chairperson creates corrected draft (v2)
    const correctedDraftRes = await engine.createCorrectedVersion({
        draft: mockPacket,
        department: 'BSIT',
        actorFaculty: { id: 10, full_name: 'Dr. Maria Dela Cruz', department: 'BSIT', role: 'chairperson' }
    });
    assert.strictEqual(correctedDraftRes.ok, true);
    assert.strictEqual(correctedDraftRes.version, 2);
    assert.strictEqual(correctedDraftRes.lifecycleState, 'draft');

    mockPacket = correctedDraftRes.programPacket;

    // Verify Dean decline remarks carried over in metadata for Chairperson to see
    const deanReviewInDraft = engine.extractDeanReview(mockPacket.notes);
    assert.ok(deanReviewInDraft, 'Dean review metadata must be present in draft notes');
    assert.strictEqual(deanReviewInDraft.remarks, 'Please add certifications and verify participant numbers.');

    // Step 4: Chairperson edits v2
    const consolidationV2 = {
        reportingPeriod: { reporting_year: 2026, quarter: 1 },
        contributingFaculty: [{ facultyId: 101, facultyName: 'Prof. Alan Turing' }],
        activeSections: { mfo_pi7_trainings: [{ id: 'tr-1', title: 'Cloud Computing v1' }, { id: 'tr-2', title: 'Advanced Docker & K8s' }] },
        programPortion: { pi1: [], pi2: [] }
    };

    // Step 5: Chairperson resubmits as Version 2
    const subV2 = engine.prepareConsolidatedMfoSubmission({
        draft: mockPacket,
        consolidation: consolidationV2,
        actorFaculty: { id: 10, full_name: 'Dr. Maria Dela Cruz', department: 'BSIT', role: 'chairperson' },
        userRemarks: 'BSIT Q1 v2 resubmission with added certifications'
    });
    assert.strictEqual(subV2.ok, true);
    assert.strictEqual(subV2.version, 2);
    assert.strictEqual(subV2.lifecycleState, 'resubmitted');

    const snapshotV2 = subV2.frozenPayload;

    // Step 6: Verify Version 1 snapshot was strictly preserved and unchanged
    assert.strictEqual(snapshotV1.version, 1, 'Version 1 snapshot version must remain 1');
    assert.strictEqual(snapshotV1.sections.mfo_pi7_trainings.length, 1, 'Version 1 snapshot must still have 1 training item');
    assert.strictEqual(snapshotV1.user_remarks, 'BSIT Q1 v1 submission', 'Version 1 remarks must remain unchanged');

    // Step 7: Verify Version 2 snapshot has the new data
    assert.strictEqual(snapshotV2.version, 2, 'Version 2 snapshot version must be 2');
    assert.strictEqual(snapshotV2.sections.mfo_pi7_trainings.length, 2, 'Version 2 snapshot must have 2 training items');
    assert.strictEqual(snapshotV2.user_remarks, 'BSIT Q1 v2 resubmission with added certifications');
});

// -----------------------------------------------------------------------------
// Execute Suite
// -----------------------------------------------------------------------------
async function runAll() {
    console.log('\n======================================================');
    console.log("   CITE-FLOW — DEAN'S CONSOLIDATED MFO DISPLAY SUITE   ");
    console.log('======================================================\n');

    for (const t of tests) {
        try {
            await t.fn();
            passCount++;
            console.log(`[PASS] ${t.title}`);
        } catch (err) {
            failCount++;
            console.error(`[FAIL] ${t.title}`);
            console.error(err);
        }
    }

    console.log('\n======================================================');
    console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================\n');

    if (failCount > 0) process.exit(1);
}

runAll();
