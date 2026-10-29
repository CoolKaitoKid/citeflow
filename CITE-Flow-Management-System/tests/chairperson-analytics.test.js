/**
 * Phase 3 Unit Tests: Chairperson Analytics and Departmental Submission Tracking
 * Validates:
 * 1. Assigned faculty with no submission included in departmental expected & not submitted counts
 * 2. Open versus overdue deadlines properly categorized (not_submitted_open vs not_submitted_overdue)
 * 3. Revision and rejected submissions counted as submitted (submission completion != approval status)
 * 4. Draft MFO packet exclusion: draft packets do not count as formal submissions
 * 5. Reporting-cycle isolation: cycles and series maintain strict assignment/submission boundaries
 * 6. Department authorization and OIC delegated-access boundaries:
 *    - Chairperson sees only authorized department(s)
 *    - OIC grant (is_active: true) enables access; revoked grant (is_active: false) immediately revokes access
 *    - Cross-department data (faculty, tasks, assignments, submissions) is strictly excluded
 * 7. Mathematical invariants hold:
 *    - Expected = Submitted + Not Submitted
 *    - Submitted = Pending Review + Needs Revision + Approved + Rejected
 *    - Not Submitted = Open + Overdue
 * 8. Realtime refresh without duplicate counts: deduplication prevents double-counting on refresh
 */

const assert = require('assert');
const path = require('path');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const ChairReview = require(path.join(__dirname, '..', 'faculty', 'chairperson-review.js'));

let passCount = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`PASS  ${name}`);
        passCount++;
    } catch (err) {
        console.error(`FAIL  ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

console.log('\n--- PHASE 3: CHAIRPERSON ANALYTICS & DEPARTMENT TRACKING TESTS ---\n');

// Mock setup helper
function setupChairContext({
    chairFaculty = { id: 'chair-1', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
    grants = [],
    faculty = [],
    tasks = [],
    assignments = [],
    submissions = [],
    configs = [],
    mfoPackets = []
}) {
    global.CiteFlowWorkflow = wf;
    global.currentFaculty = chairFaculty;
    global.currentUser = { id: chairFaculty.auth_user_id || 'user-chair' };

    ChairReview.access = true;
    ChairReview.review.access = true;
    ChairReview.review.grants = grants;
    ChairReview.review.faculty = faculty;
    ChairReview.review.tasks = tasks;
    ChairReview.review.assignments = assignments;
    ChairReview.review.submissions = submissions;
    ChairReview.review.configs = configs;
    ChairReview.review.mfoPackets = mfoPackets;
}

// 1. Assigned faculty with no submission included in analytics
test('1. Assigned faculty with no submission are included in expected and not submitted counts', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' },
        { id: 'fac-2', full_name: 'Prof. Bob', department: 'bsit' }
    ];
    const task = {
        id: 'task-1',
        title: 'Midterm Syllabus Submission',
        department: 'bsit',
        deadline_at: '2026-12-01T23:59:59Z'
    };
    const assignments = [
        { id: 'as-1', task_id: 'task-1', faculty_id: 'fac-1' },
        { id: 'as-2', task_id: 'task-1', faculty_id: 'fac-2' }
    ];
    // Alice submitted, Bob did not submit
    const submissions = [
        {
            id: 'sub-1',
            task_id: 'task-1',
            faculty_id: 'fac-1',
            status: 'submitted',
            approval_stage: 'chairperson',
            submitted_at: '2026-10-15T10:00:00Z'
        }
    ];

    setupChairContext({
        faculty,
        tasks: [task],
        assignments,
        submissions
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    assert.strictEqual(analytics.counts.expected, 2, 'Expected submissions should be 2');
    assert.strictEqual(analytics.counts.submitted, 1, 'Submitted should be 1');
    assert.strictEqual(analytics.counts.not_submitted, 1, 'Not submitted should be 1');

    const nonSubmitted = ChairReview.buildNonSubmittedRows();
    assert.strictEqual(nonSubmitted.length, 1, 'Should have 1 non-submitted row');
    assert.strictEqual(nonSubmitted[0].faculty_id, 'fac-2', 'Bob should be non-submitted');
    assert.strictEqual(nonSubmitted[0].status_key, 'not_submitted_open', 'Future deadline should be open');
});

// 2. Open versus overdue deadlines
test('2. Distinguishes open deadlines from overdue non-submitters', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' },
        { id: 'fac-2', full_name: 'Prof. Bob', department: 'bsit' }
    ];
    const tasks = [
        {
            id: 'task-open',
            title: 'Final Exam Submission',
            department: 'bsit',
            deadline_at: '2026-11-30T23:59:59Z' // future
        },
        {
            id: 'task-overdue',
            title: 'Course Outline Submission',
            department: 'bsit',
            deadline_at: '2026-09-01T23:59:59Z' // past
        }
    ];
    const assignments = [
        { id: 'as-1', task_id: 'task-open', faculty_id: 'fac-1' },
        { id: 'as-2', task_id: 'task-overdue', faculty_id: 'fac-2' }
    ];

    setupChairContext({
        faculty,
        tasks,
        assignments,
        submissions: []
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    assert.strictEqual(analytics.counts.expected, 2);
    assert.strictEqual(analytics.counts.not_submitted, 2);
    assert.strictEqual(analytics.counts.not_submitted_open, 1, 'Open non-submissions should be 1');
    assert.strictEqual(analytics.counts.not_submitted_overdue, 1, 'Overdue non-submissions should be 1');

    const nonSubmitted = ChairReview.buildNonSubmittedRows();
    const openRow = nonSubmitted.find((r) => r.task_id === 'task-open');
    const overdueRow = nonSubmitted.find((r) => r.task_id === 'task-overdue');

    assert.strictEqual(openRow.is_overdue, false, 'task-open should not be overdue');
    assert.strictEqual(openRow.status_key, 'not_submitted_open');
    assert.strictEqual(overdueRow.is_overdue, true, 'task-overdue should be overdue');
    assert.strictEqual(overdueRow.status_key, 'not_submitted_overdue');
});

// 3. Revision and rejected submissions counted as submitted
test('3. Revision and rejected submissions are counted as submitted, separating submission from approval', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' },
        { id: 'fac-2', full_name: 'Prof. Bob', department: 'bsit' },
        { id: 'fac-3', full_name: 'Prof. Carol', department: 'bsit' },
        { id: 'fac-4', full_name: 'Prof. Dave', department: 'bsit' }
    ];
    const task = {
        id: 'task-1',
        title: 'Department Research Output',
        department: 'bsit',
        deadline_at: '2026-10-31T23:59:59Z'
    };
    const assignments = [
        { id: 'as-1', task_id: 'task-1', faculty_id: 'fac-1' },
        { id: 'as-2', task_id: 'task-1', faculty_id: 'fac-2' },
        { id: 'as-3', task_id: 'task-1', faculty_id: 'fac-3' },
        { id: 'as-4', task_id: 'task-1', faculty_id: 'fac-4' }
    ];
    const submissions = [
        { id: 's-1', task_id: 'task-1', faculty_id: 'fac-1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 's-2', task_id: 'task-1', faculty_id: 'fac-2', status: 'revision', approval_stage: 'revision' },
        { id: 's-3', task_id: 'task-1', faculty_id: 'fac-3', status: 'rejected', approval_stage: 'declined' },
        { id: 's-4', task_id: 'task-1', faculty_id: 'fac-4', status: 'approved', approval_stage: 'final' }
    ];

    setupChairContext({
        faculty,
        tasks: [task],
        assignments,
        submissions
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    assert.strictEqual(analytics.counts.expected, 4, 'Expected is 4');
    assert.strictEqual(analytics.counts.submitted, 4, 'All 4 submitted files exist and must count as submitted');
    assert.strictEqual(analytics.counts.not_submitted, 0, 'Not submitted is 0');
    assert.strictEqual(analytics.counts.pending_review, 1, 'Pending review is 1');
    assert.strictEqual(analytics.counts.needs_revision, 1, 'Needs revision is 1');
    assert.strictEqual(analytics.counts.rejected, 1, 'Rejected is 1');
    assert.strictEqual(analytics.counts.approved, 1, 'Approved is 1');

    // Invariant check
    assert.strictEqual(
        analytics.counts.submitted,
        analytics.counts.pending_review + analytics.counts.needs_revision + analytics.counts.approved + analytics.counts.rejected,
        'Submitted must equal sum of review categories'
    );
});

// 4. Draft MFO packet exclusion
test('4. Draft MFO packets are excluded from formal submission counts', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' },
        { id: 'fac-2', full_name: 'Prof. Bob', department: 'bsit' }
    ];
    const task = {
        id: 'task-mfo',
        title: 'Q1 Major Final Output (MFO) Report',
        department: 'bsit',
        deadline_at: '2026-10-31T23:59:59Z'
    };
    const assignments = [
        { id: 'as-1', task_id: 'task-mfo', faculty_id: 'fac-1' },
        { id: 'as-2', task_id: 'task-mfo', faculty_id: 'fac-2' }
    ];

    // Alice submitted a formal MFO submission with submitted packet
    // Bob has a draft packet (packet_state: 'draft') with or without unsubmitted record
    const submissions = [
        {
            id: 'sub-alice',
            task_id: 'task-mfo',
            faculty_id: 'fac-1',
            status: 'submitted',
            approval_stage: 'chairperson'
        },
        {
            id: 'sub-bob-draft',
            task_id: 'task-mfo',
            faculty_id: 'fac-2',
            status: 'draft',
            approval_stage: 'draft',
            mfo_packet: { packet_state: 'draft' }
        }
    ];
    const mfoPackets = [
        { id: 'pkt-1', submission_id: 'sub-alice', task_id: 'task-mfo', faculty_id: 'fac-1', packet_state: 'submitted' },
        { id: 'pkt-2', submission_id: 'sub-bob-draft', task_id: 'task-mfo', faculty_id: 'fac-2', packet_state: 'draft' }
    ];

    setupChairContext({
        faculty,
        tasks: [task],
        assignments,
        submissions,
        mfoPackets
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    assert.strictEqual(analytics.counts.expected, 2, 'Expected is 2');
    assert.strictEqual(analytics.counts.submitted, 1, 'Only Alice has a genuine formal submission');
    assert.strictEqual(analytics.counts.not_submitted, 1, 'Bob with draft packet must count as Not Submitted');
    assert.strictEqual(analytics.counts.not_submitted_open, 1, 'Bob is open');

    const nonSubmitted = ChairReview.buildNonSubmittedRows();
    const bobRow = nonSubmitted.find((r) => r.faculty_id === 'fac-2');
    assert.ok(bobRow, 'Bob should be listed in non-submitted rows');
    assert.strictEqual(bobRow.is_draft_packet, true, 'Bob should be flagged as having a draft packet in progress');
});

// 5. Reporting-cycle isolation
test('5. Reporting-cycle isolation: submissions in cycle 1 never bleed into cycle 2', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' }
    ];
    const configs = [
        { id: 'cfg-1', report_name: 'Monthly Department Accomplishment', frequency: 'monthly' }
    ];
    const tasks = [
        {
            id: 'task-cycle-1',
            title: 'Monthly Department Accomplishment - October 2026',
            report_config_id: 'cfg-1',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            department: 'bsit',
            deadline_at: '2026-10-31T23:59:59Z'
        },
        {
            id: 'task-cycle-2',
            title: 'Monthly Department Accomplishment - November 2026',
            report_config_id: 'cfg-1',
            is_recurring: true,
            reporting_period_label: 'November 2026',
            department: 'bsit',
            deadline_at: '2026-11-30T23:59:59Z'
        }
    ];
    const assignments = [
        { id: 'as-1', task_id: 'task-cycle-1', faculty_id: 'fac-1' },
        { id: 'as-2', task_id: 'task-cycle-2', faculty_id: 'fac-1' }
    ];
    // Alice submitted ONLY for October (cycle 1), not November (cycle 2)
    const submissions = [
        {
            id: 'sub-oct',
            task_id: 'task-cycle-1',
            faculty_id: 'fac-1',
            status: 'submitted',
            approval_stage: 'chairperson'
        }
    ];

    setupChairContext({
        faculty,
        tasks,
        assignments,
        submissions,
        configs
    });

    const recurring = ChairReview.getRecurringAnalytics();
    assert.strictEqual(recurring.groups.length, 1, 'Should find 1 report group');
    const group = recurring.groups[0];
    assert.strictEqual(group.cycles.length, 2, 'Group has 2 cycles');

    const octAnalytics = recurring.cycleAnalyticsMap.get('task-cycle-1');
    const novAnalytics = recurring.cycleAnalyticsMap.get('task-cycle-2');

    assert.strictEqual(octAnalytics.counts.expected, 1);
    assert.strictEqual(octAnalytics.counts.submitted, 1, 'October must have 1 submitted');
    assert.strictEqual(octAnalytics.counts.not_submitted, 0, 'October must have 0 not submitted');

    assert.strictEqual(novAnalytics.counts.expected, 1);
    assert.strictEqual(novAnalytics.counts.submitted, 0, 'November must NOT receive October submission');
    assert.strictEqual(novAnalytics.counts.not_submitted, 1, 'November must have 1 not submitted');
});

// 6. Department authorization and OIC delegation boundaries
test('6. Department authorization and OIC delegation boundaries are strictly enforced', () => {
    const allFaculty = [
        { id: 'bsit-1', full_name: 'Prof. BSIT Member', department: 'bsit' },
        { id: 'bit-1', full_name: 'Prof. BIT Member', department: 'bit' },
        { id: 'bsie-1', full_name: 'Prof. BSIE Member', department: 'bsie' }
    ];
    const tasks = [
        { id: 'task-bsit', title: 'BSIT Curriculum Review', department: 'bsit' },
        { id: 'task-bit', title: 'BIT Lab Inventory', department: 'bit' }
    ];
    const assignments = [
        { id: 'as-1', task_id: 'task-bsit', faculty_id: 'bsit-1' },
        { id: 'as-2', task_id: 'task-bit', faculty_id: 'bit-1' }
    ];
    const submissions = [
        { id: 'sub-bsit', task_id: 'task-bsit', faculty_id: 'bsit-1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 'sub-bit', task_id: 'task-bit', faculty_id: 'bit-1', status: 'submitted', approval_stage: 'chairperson' }
    ];

    // Case 6A: Native BSIT Chairperson without extra grants
    setupChairContext({
        chairFaculty: { id: 'chair-bsit', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        grants: [],
        faculty: allFaculty,
        tasks,
        assignments,
        submissions
    });

    assert.deepStrictEqual(ChairReview.authorizedDepartmentCodes(), ['bsit'], 'Authorized depts must be [bsit]');
    const scopedFacA = ChairReview.scopedFaculty();
    assert.strictEqual(scopedFacA.length, 1, 'Should only see 1 BSIT faculty member');
    assert.strictEqual(scopedFacA[0].id, 'bsit-1');

    const scopedAssignA = ChairReview.scopedAssignments();
    assert.strictEqual(scopedAssignA.length, 1, 'Should only see BSIT assignment');
    assert.strictEqual(scopedAssignA[0].id, 'as-1');

    const scopedSubA = ChairReview.scopedSubmissions();
    assert.strictEqual(scopedSubA.length, 1, 'Should only see BSIT submission');
    assert.strictEqual(scopedSubA[0].id, 'sub-bsit');

    // Case 6B: OIC with active delegation to BIT
    const activeOicGrants = [
        {
            id: 'grant-oic',
            is_active: true,
            department_code: 'bit',
            grantee_faculty_id: 'chair-bsit'
        }
    ];

    setupChairContext({
        chairFaculty: { id: 'chair-bsit', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        grants: activeOicGrants,
        faculty: allFaculty,
        tasks,
        assignments,
        submissions
    });

    const authorizedB = ChairReview.authorizedDepartmentCodes();
    assert.ok(authorizedB.includes('bit'), 'OIC grant should add BIT to authorized departments');
    assert.ok(authorizedB.includes('bsit'), 'Home department BSIT should remain authorized');

    const scopedFacB = ChairReview.scopedFaculty();
    assert.strictEqual(scopedFacB.length, 2, 'Should see both BSIT and BIT faculty');
    assert.ok(!scopedFacB.some((f) => f.department === 'bsie'), 'BSIE faculty must NOT be visible');

    // Case 6C: Revoked OIC grant (is_active: false)
    const revokedGrants = [
        {
            id: 'grant-oic',
            is_active: false,
            department_code: 'bit',
            grantee_faculty_id: 'chair-bsit'
        }
    ];

    setupChairContext({
        chairFaculty: { id: 'chair-bsit', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        grants: revokedGrants,
        faculty: allFaculty,
        tasks,
        assignments,
        submissions
    });

    const authorizedC = ChairReview.authorizedDepartmentCodes();
    assert.ok(!authorizedC.includes('bit'), 'Revoked grant must NOT authorize BIT');
    assert.deepStrictEqual(authorizedC, ['bsit'], 'Only BSIT remains authorized');

    const scopedFacC = ChairReview.scopedFaculty();
    assert.strictEqual(scopedFacC.length, 1, 'Only BSIT faculty should be scoped after revocation');
    assert.strictEqual(scopedFacC[0].department, 'bsit');
});

// 7. Mathematical invariants hold
test('7. Mathematical invariants hold across department summary and recurring cycles', () => {
    const faculty = [
        { id: 'f-1', full_name: 'Prof. Alice', department: 'bsit' },
        { id: 'f-2', full_name: 'Prof. Bob', department: 'bsit' },
        { id: 'f-3', full_name: 'Prof. Carol', department: 'bsit' },
        { id: 'f-4', full_name: 'Prof. Dave', department: 'bsit' },
        { id: 'f-5', full_name: 'Prof. Eve', department: 'bsit' }
    ];
    const task = {
        id: 'task-inv',
        title: 'Department Progress Audit',
        department: 'bsit',
        deadline_at: '2026-10-31T23:59:59Z'
    };
    const assignments = faculty.map((f, i) => ({ id: `as-${i}`, task_id: 'task-inv', faculty_id: f.id }));
    const submissions = [
        { id: 's-1', task_id: 'task-inv', faculty_id: 'f-1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 's-2', task_id: 'task-inv', faculty_id: 'f-2', status: 'revision', approval_stage: 'revision' },
        { id: 's-3', task_id: 'task-inv', faculty_id: 'f-3', status: 'rejected', approval_stage: 'declined' },
        { id: 's-4', task_id: 'task-inv', faculty_id: 'f-4', status: 'approved', approval_stage: 'final' }
        // f-5 has no submission (not submitted open)
    ];

    setupChairContext({
        faculty,
        tasks: [task],
        assignments,
        submissions
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    const c = analytics.counts;

    // Invariant 1: Expected = Submitted + Not Submitted
    assert.strictEqual(
        c.expected,
        c.submitted + c.not_submitted,
        `Expected (${c.expected}) must equal Submitted (${c.submitted}) + Not Submitted (${c.not_submitted})`
    );

    // Invariant 2: Submitted = Pending Review + Needs Revision + Approved + Rejected
    assert.strictEqual(
        c.submitted,
        c.pending_review + c.needs_revision + c.approved + c.rejected,
        `Submitted (${c.submitted}) must equal Pending (${c.pending_review}) + Revision (${c.needs_revision}) + Approved (${c.approved}) + Rejected (${c.rejected})`
    );

    // Invariant 3: Not Submitted = Open + Overdue
    assert.strictEqual(
        c.not_submitted,
        c.not_submitted_open + c.not_submitted_overdue,
        `Not Submitted (${c.not_submitted}) must equal Open (${c.not_submitted_open}) + Overdue (${c.not_submitted_overdue})`
    );

    assert.strictEqual(analytics.balances.coverageMatchesExpected, true);
    assert.strictEqual(analytics.balances.exclusiveMatchesSubmitted, true);
    assert.strictEqual(analytics.balances.notSubmittedMatchesCategories, true);
});

// 8. Realtime refresh without duplicate counts
test('8. Realtime refresh without duplicate counts: duplicate assignment events do not inflate counts', () => {
    const faculty = [
        { id: 'fac-1', full_name: 'Prof. Alice', department: 'bsit' }
    ];
    const task = {
        id: 'task-1',
        title: 'Department Report',
        department: 'bsit',
        deadline_at: '2026-10-31T23:59:59Z'
    };
    // Duplicate assignment records sent by multiple realtime bursts
    const duplicateAssignments = [
        { id: 'as-1', task_id: 'task-1', faculty_id: 'fac-1' },
        { id: 'as-1-dup', task_id: 'task-1', faculty_id: 'fac-1' }
    ];
    const submissions = [
        { id: 'sub-1', task_id: 'task-1', faculty_id: 'fac-1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 'sub-1-dup', task_id: 'task-1', faculty_id: 'fac-1', status: 'submitted', approval_stage: 'chairperson' }
    ];

    setupChairContext({
        faculty,
        tasks: [task],
        assignments: duplicateAssignments,
        submissions
    });

    const analytics = ChairReview.getDepartmentAnalytics();
    assert.strictEqual(analytics.counts.expected, 1, 'Expected count must be deduplicated to 1');
    assert.strictEqual(analytics.counts.submitted, 1, 'Submitted count must be deduplicated to 1');
    assert.strictEqual(analytics.counts.not_submitted, 0, 'Not submitted must be 0');
});

console.log(`\nAll ${passCount} Phase 3 Chairperson Analytics unit tests passed successfully!\n`);
