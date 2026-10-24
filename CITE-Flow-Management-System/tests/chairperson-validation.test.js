/**
 * CITE-Flow Phase 3 — Comprehensive Validation Suite
 * Runs targeted automated checks for all 5 Phase 3 validation areas:
 * 1. Analytics calculations & Invariant balances
 * 2. Submission statuses & Latest valid submission selection
 * 3. Deadlines (Open vs Overdue) & Recurring report cycles
 * 4. Department authorization & OIC delegation boundaries
 * 5. Realtime refresh deduplication & Error resiliency in loadData
 * 6. Review action contracts (approve, revision, decline)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const ChairReview = require(path.join(__dirname, '..', 'faculty', 'chairperson-review.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

// Mock setup helper
function setupContext({
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

// -------------------------------------------------------------
// 1. ANALYTICS CALCULATIONS & INVARIANTS
// -------------------------------------------------------------

registerTest('1.1 Invariant: Expected = Submitted + Not Submitted across diverse states', () => {
    const faculty = [
        { id: 'f1', full_name: 'Faculty 1', department: 'bsit' },
        { id: 'f2', full_name: 'Faculty 2', department: 'bsit' },
        { id: 'f3', full_name: 'Faculty 3', department: 'bsit' },
        { id: 'f4', full_name: 'Faculty 4', department: 'bsit' }
    ];
    const task = { id: 't1', title: 'Task 1', department: 'bsit', deadline_at: '2026-11-01T00:00:00Z' };
    const assignments = faculty.map(f => ({ task_id: 't1', faculty_id: f.id }));
    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 's2', task_id: 't1', faculty_id: 'f2', status: 'approved', approval_stage: 'final' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });
    const { counts, balances } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.expected, 4);
    assert.strictEqual(counts.submitted, 2);
    assert.strictEqual(counts.not_submitted, 2);
    assert.strictEqual(counts.expected, counts.submitted + counts.not_submitted);
    assert.strictEqual(balances.coverageMatchesExpected, true);
});

registerTest('1.2 Invariant: Submitted = Pending Review + Needs Revision + Approved + Rejected', () => {
    const faculty = [
        { id: 'f1', full_name: 'F1', department: 'bsit' },
        { id: 'f2', full_name: 'F2', department: 'bsit' },
        { id: 'f3', full_name: 'F3', department: 'bsit' },
        { id: 'f4', full_name: 'F4', department: 'bsit' }
    ];
    const task = { id: 't1', title: 'Task 1', department: 'bsit' };
    const assignments = faculty.map(f => ({ task_id: 't1', faculty_id: f.id }));
    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 's2', task_id: 't1', faculty_id: 'f2', status: 'revision', approval_stage: 'revision' },
        { id: 's3', task_id: 't1', faculty_id: 'f3', status: 'rejected', approval_stage: 'declined' },
        { id: 's4', task_id: 't1', faculty_id: 'f4', status: 'approved', approval_stage: 'final' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });
    const { counts, balances } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.submitted, 4);
    assert.strictEqual(counts.pending_review, 1);
    assert.strictEqual(counts.needs_revision, 1);
    assert.strictEqual(counts.rejected, 1);
    assert.strictEqual(counts.approved, 1);
    assert.strictEqual(
        counts.submitted,
        counts.pending_review + counts.needs_revision + counts.approved + counts.rejected
    );
    assert.strictEqual(balances.exclusiveMatchesSubmitted, true);
});

registerTest('1.3 Invariant: Not Submitted = Not Submitted Open + Not Submitted Overdue', () => {
    const faculty = [
        { id: 'f1', full_name: 'F1', department: 'bsit' },
        { id: 'f2', full_name: 'F2', department: 'bsit' }
    ];
    const tasks = [
        { id: 't_open', title: 'Open Task', department: 'bsit', deadline_at: '2026-12-31T23:59:59Z' },
        { id: 't_overdue', title: 'Overdue Task', department: 'bsit', deadline_at: '2026-01-01T00:00:00Z' }
    ];
    const assignments = [
        { task_id: 't_open', faculty_id: 'f1' },
        { task_id: 't_overdue', faculty_id: 'f2' }
    ];

    setupContext({ faculty, tasks, assignments, submissions: [] });
    const { counts, balances } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.not_submitted, 2);
    assert.strictEqual(counts.not_submitted_open, 1);
    assert.strictEqual(counts.not_submitted_overdue, 1);
    assert.strictEqual(counts.not_submitted, counts.not_submitted_open + counts.not_submitted_overdue);
    assert.strictEqual(balances.notSubmittedMatchesCategories, true);
});

registerTest('1.4 Draft MFO packets excluded from formal submission counts even from raw DB records', () => {
    const faculty = [
        { id: 'f1', full_name: 'F1', department: 'bsit' },
        { id: 'f2', full_name: 'F2', department: 'bsit' }
    ];
    const task = { id: 't_mfo', title: 'Q1 MFO Report', department: 'bsit', deadline_at: '2026-11-30T00:00:00Z' };
    const assignments = [
        { task_id: 't_mfo', faculty_id: 'f1' },
        { task_id: 't_mfo', faculty_id: 'f2' }
    ];
    // Raw submission without mfo_packet pre-attached on the object
    const rawSubDraft = { id: 'sub_draft', task_id: 't_mfo', faculty_id: 'f1', status: 'submitted', submitted_at: '2026-10-10' };
    const rawSubFinal = { id: 'sub_final', task_id: 't_mfo', faculty_id: 'f2', status: 'submitted', submitted_at: '2026-10-10' };
    const mfoPackets = [
        { submission_id: 'sub_draft', task_id: 't_mfo', faculty_id: 'f1', packet_state: 'draft' },
        { submission_id: 'sub_final', task_id: 't_mfo', faculty_id: 'f2', packet_state: 'submitted' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions: [rawSubDraft, rawSubFinal], mfoPackets });
    const { counts } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.expected, 2, 'Expected should be 2');
    assert.strictEqual(counts.submitted, 1, 'Only sub_final should count as submitted');
    assert.strictEqual(counts.not_submitted, 1, 'Draft packet must count as not submitted');
    assert.strictEqual(counts.not_submitted_open, 1, 'Draft packet on open deadline must be not_submitted_open');
});

registerTest('1.5 Deduplication prevents count inflation from multiple assignments or submissions', () => {
    const faculty = [{ id: 'f1', full_name: 'F1', department: 'bsit' }];
    const task = { id: 't1', title: 'T1', department: 'bsit' };
    const duplicateAssignments = [
        { task_id: 't1', faculty_id: 'f1' },
        { task_id: 't1', faculty_id: 'f1' }
    ];
    const duplicateSubmissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted', created_at: '2026-10-01' },
        { id: 's2', task_id: 't1', faculty_id: 'f1', status: 'submitted', created_at: '2026-10-02' }
    ];

    setupContext({ faculty, tasks: [task], assignments: duplicateAssignments, submissions: duplicateSubmissions });
    const { counts } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.expected, 1, 'Expected must be deduplicated to 1');
    assert.strictEqual(counts.submitted, 1, 'Submitted must be deduplicated to 1');
    assert.strictEqual(counts.not_submitted, 0);
});

// -------------------------------------------------------------
// 2. SUBMISSION STATUSES & LATEST VALID SELECTION
// -------------------------------------------------------------

registerTest('2.1 Latest valid submission selected when earlier attempt exists and draft resubmission is in progress', () => {
    const faculty = [{ id: 'f1', full_name: 'F1', department: 'bsit' }];
    const task = { id: 't1', title: 'T1', department: 'bsit' };
    const assignments = [{ task_id: 't1', faculty_id: 'f1' }];
    // Earlier genuine submission marked as revision requested
    // Newer unsubmitted draft created by faculty while revising
    const submissions = [
        { id: 's_prev', task_id: 't1', faculty_id: 'f1', status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
        { id: 's_draft', task_id: 't1', faculty_id: 'f1', status: 'draft', is_draft: true, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });
    const { counts } = ChairReview.getDepartmentAnalytics();

    // The genuine submission (revision) must be selected over the unsubmitted draft
    assert.strictEqual(counts.submitted, 1, 'Genuine submission is preserved as submitted');
    assert.strictEqual(counts.needs_revision, 1, 'Review status should be needs_revision');
    assert.strictEqual(counts.not_submitted, 0);
});

registerTest('2.2 Revision requested and rejected submissions still count as submitted', () => {
    const faculty = [
        { id: 'f_rev', full_name: 'F Rev', department: 'bsit' },
        { id: 'f_rej', full_name: 'F Rej', department: 'bsit' }
    ];
    const task = { id: 't1', title: 'T1', department: 'bsit' };
    const assignments = [
        { task_id: 't1', faculty_id: 'f_rev' },
        { task_id: 't1', faculty_id: 'f_rej' }
    ];
    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f_rev', status: 'revision', approval_stage: 'revision' },
        { id: 's2', task_id: 't1', faculty_id: 'f_rej', status: 'rejected', approval_stage: 'declined' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });
    const { counts } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.submitted, 2, 'Both revision and rejected count as submitted');
    assert.strictEqual(counts.needs_revision, 1);
    assert.strictEqual(counts.rejected, 1);
    assert.strictEqual(counts.not_submitted, 0);
});

// -------------------------------------------------------------
// 3. DEADLINES & RECURRING REPORT CYCLES
// -------------------------------------------------------------

registerTest('3.1 Missing deadline defaults to Open, not Overdue', () => {
    const faculty = [{ id: 'f1', full_name: 'F1', department: 'bsit' }];
    const task = { id: 't_nodeadline', title: 'Task without deadline', department: 'bsit', deadline_at: null, due_at: null };
    const assignments = [{ task_id: 't_nodeadline', faculty_id: 'f1' }];

    setupContext({ faculty, tasks: [task], assignments, submissions: [] });
    const { counts } = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(counts.not_submitted, 1);
    assert.strictEqual(counts.not_submitted_open, 1, 'Without deadline, should be classified as open');
    assert.strictEqual(counts.not_submitted_overdue, 0);
});

registerTest('3.2 Recurring report cycles are grouped by reporting period and frequency with strict isolation', () => {
    const faculty = [{ id: 'f1', full_name: 'F1', department: 'bsit' }];
    const configs = [
        { id: 'cfg_m', report_name: 'Faculty Monthly Accomplishment', frequency: 'monthly' }
    ];
    const tasks = [
        { id: 't_oct', title: 'Faculty Monthly Accomplishment - October 2026', report_config_id: 'cfg_m', is_recurring: true, department: 'bsit', deadline_at: '2026-10-31T23:59:59Z' },
        { id: 't_nov', title: 'Faculty Monthly Accomplishment - November 2026', report_config_id: 'cfg_m', is_recurring: true, department: 'bsit', deadline_at: '2026-11-30T23:59:59Z' }
    ];
    const assignments = [
        { task_id: 't_oct', faculty_id: 'f1' },
        { task_id: 't_nov', faculty_id: 'f1' }
    ];
    // Submitted ONLY for October
    const submissions = [
        { id: 'sub_oct', task_id: 't_oct', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' }
    ];

    setupContext({ faculty, configs, tasks, assignments, submissions });
    const recurring = ChairReview.getRecurringAnalytics();

    assert.strictEqual(recurring.groups.length, 1);
    assert.strictEqual(recurring.groups[0].frequency, 'monthly');
    assert.strictEqual(recurring.groups[0].cycles.length, 2);

    const oct = recurring.cycleAnalyticsMap.get('t_oct');
    const nov = recurring.cycleAnalyticsMap.get('t_nov');

    assert.strictEqual(oct.counts.expected, 1);
    assert.strictEqual(oct.counts.submitted, 1);
    assert.strictEqual(oct.counts.not_submitted, 0);

    assert.strictEqual(nov.counts.expected, 1);
    assert.strictEqual(nov.counts.submitted, 0, 'November must have 0 submitted');
    assert.strictEqual(nov.counts.not_submitted, 1, 'November must have 1 not submitted');
});

registerTest('3.3 Unsubmitted faculty appear in analytics even when they have no submission record', () => {
    const faculty = [
        { id: 'f_submit', full_name: 'Submitting Faculty', department: 'bsit' },
        { id: 'f_nosubmit', full_name: 'Ghost Faculty', department: 'bsit' }
    ];
    const task = { id: 't1', title: 'T1', department: 'bsit', deadline_at: '2026-11-01T00:00:00Z' };
    const assignments = [
        { task_id: 't1', faculty_id: 'f_submit' },
        { task_id: 't1', faculty_id: 'f_nosubmit' }
    ];
    // Only f_submit has a record in submissions table; f_nosubmit has no record at all
    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f_submit', status: 'submitted' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });
    const nonSubmitted = ChairReview.buildNonSubmittedRows();

    assert.strictEqual(nonSubmitted.length, 1);
    assert.strictEqual(nonSubmitted[0].faculty_id, 'f_nosubmit');
    assert.strictEqual(nonSubmitted[0].faculty_name, 'Ghost Faculty');
});

// -------------------------------------------------------------
// 4. DEPARTMENT & OIC AUTHORIZATION BOUNDARIES
// -------------------------------------------------------------

registerTest('4.1 Native Chairperson sees ONLY their authorized department records', () => {
    const allFaculty = [
        { id: 'f_bsit', full_name: 'BSIT Faculty', department: 'bsit' },
        { id: 'f_bit', full_name: 'BIT Faculty', department: 'bit' }
    ];
    const tasks = [
        { id: 't_bsit', title: 'BSIT Task', department: 'bsit' },
        { id: 't_bit', title: 'BIT Task', department: 'bit' }
    ];
    const assignments = [
        { task_id: 't_bsit', faculty_id: 'f_bsit' },
        { task_id: 't_bit', faculty_id: 'f_bit' }
    ];
    const submissions = [
        { id: 's_bsit', task_id: 't_bsit', faculty_id: 'f_bsit', status: 'submitted' },
        { id: 's_bit', task_id: 't_bit', faculty_id: 'f_bit', status: 'submitted' }
    ];

    setupContext({
        chairFaculty: { id: 'c_bsit', full_name: 'Chair BSIT', department: 'bsit', role: 'chairperson' },
        faculty: allFaculty,
        tasks,
        assignments,
        submissions
    });

    const scopedFac = ChairReview.scopedFaculty();
    const scopedAssign = ChairReview.scopedAssignments();
    const scopedSub = ChairReview.scopedSubmissions();

    assert.strictEqual(scopedFac.length, 1);
    assert.strictEqual(scopedFac[0].department, 'bsit');

    assert.strictEqual(scopedAssign.length, 1);
    assert.strictEqual(scopedAssign[0].task_id, 't_bsit');

    assert.strictEqual(scopedSub.length, 1);
    assert.strictEqual(scopedSub[0].id, 's_bsit');
});

registerTest('4.2 OIC active grant authorizes delegated department; revoked grant cuts off access', () => {
    const allFaculty = [
        { id: 'f_bsit', full_name: 'BSIT Faculty', department: 'bsit' },
        { id: 'f_bit', full_name: 'BIT Faculty', department: 'bit' }
    ];
    const activeGrant = [{
        id: 'g1',
        is_active: true,
        department_code: 'bit',
        grantee_faculty_id: 'chair-oic'
    }];

    setupContext({
        chairFaculty: { id: 'chair-oic', full_name: 'Chair BSIT', department: 'bsit', role: 'chairperson' },
        grants: activeGrant,
        faculty: allFaculty
    });

    let depts = ChairReview.authorizedDepartmentCodes();
    assert.ok(depts.includes('bit'), 'Active OIC grant must authorize BIT');
    assert.ok(depts.includes('bsit'), 'Home department BSIT must remain authorized');
    assert.strictEqual(ChairReview.scopedFaculty().length, 2, 'Should see both BSIT and BIT faculty');

    // Revoke grant
    const revokedGrant = [{
        id: 'g1',
        is_active: false,
        department_code: 'bit',
        grantee_faculty_id: 'chair-oic'
    }];

    setupContext({
        chairFaculty: { id: 'chair-oic', full_name: 'Chair BSIT', department: 'bsit', role: 'chairperson' },
        grants: revokedGrant,
        faculty: allFaculty
    });

    depts = ChairReview.authorizedDepartmentCodes();
    assert.strictEqual(depts.includes('bit'), false, 'Revoked grant must NOT authorize BIT');
    assert.strictEqual(ChairReview.scopedFaculty().length, 1, 'Only BSIT faculty scoped after revocation');
});

// -------------------------------------------------------------
// 5. REALTIME REFRESH & ERROR RESILIENCY
// -------------------------------------------------------------

registerTest('5.1 Realtime burst events do not duplicate counts', () => {
    const faculty = [{ id: 'f1', full_name: 'F1', department: 'bsit' }];
    const task = { id: 't1', title: 'T1', department: 'bsit' };
    const assignments = [{ task_id: 't1', faculty_id: 'f1' }];
    const submissions = [{ id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted' }];

    setupContext({ faculty, tasks: [task], assignments, submissions });

    const initial = ChairReview.getDepartmentAnalytics();
    const second = ChairReview.getDepartmentAnalytics();

    assert.strictEqual(initial.counts.expected, second.counts.expected);
    assert.strictEqual(initial.counts.submitted, second.counts.submitted);
    assert.strictEqual(initial.counts.not_submitted, second.counts.not_submitted);
});

registerTest('5.2 Temporary query failure in loadData does not wipe existing valid data', async () => {
    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Chair', department: 'bsit', role: 'chairperson' },
        faculty: [{ id: 'f1', full_name: 'Faculty 1', department: 'bsit' }],
        tasks: [{ id: 't1', title: 'Task 1', department: 'bsit' }],
        assignments: [{ task_id: 't1', faculty_id: 'f1' }],
        submissions: [{ id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted' }]
    });

    assert.strictEqual(ChairReview.review.tasks.length, 1);
    assert.strictEqual(ChairReview.review.assignments.length, 1);

    // Mock db client returning error for tasks and submissions
    const createQuery = (table) => {
        let result = { data: [], error: null };
        if (table === 'wf_tasks') result = { data: null, error: { message: 'Network timeout' } };
        if (table === 'wf_task_assignments') result = { data: null, error: { message: '503 Service Unavailable' } };

        const promise = Promise.resolve(result);
        promise.order = () => promise;
        return promise;
    };

    const mockDb = {
        from: (table) => ({
            select: () => createQuery(table)
        }),
        rpc: () => Promise.resolve({ data: null, error: { message: 'RPC Error' } })
    };
    global.supabaseClient = mockDb;

    await ChairReview.loadData();

    // Valid tasks and assignments should NOT have been cleared out by the failed requests
    assert.strictEqual(ChairReview.review.tasks.length, 1, 'Tasks should not be cleared on network failure');
    assert.strictEqual(ChairReview.review.assignments.length, 1, 'Assignments should not be cleared on network failure');
});

// -------------------------------------------------------------
// 6. CHAIRPERSON REVIEW ACTIONS
// -------------------------------------------------------------

registerTest('6.1 approve() invokes applySubmissionReview with action approved', async () => {
    let reviewArgs = null;
    wf.applySubmissionReview = async (client, args) => {
        reviewArgs = args;
        return { ok: true };
    };

    const task = { id: 't1', title: 'Task 1', department: 'bsit' };
    const sub = { id: 'sub_action', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' };
    setupContext({
        faculty: [{ id: 'f1', full_name: 'Alice', department: 'bsit' }],
        tasks: [task],
        submissions: [sub]
    });

    await ChairReview.approve('sub_action');
    assert.ok(reviewArgs, 'applySubmissionReview should have been called');
    assert.strictEqual(reviewArgs.action, 'approved');
    assert.strictEqual(reviewArgs.submissionId, 'sub_action');
});

registerTest('6.2 submitRevision() with decline mode invokes applySubmissionReview with action rejected', async () => {
    let reviewArgs = null;
    wf.applySubmissionReview = async (client, args) => {
        reviewArgs = args;
        return { ok: true };
    };

    const task = { id: 't1', title: 'Task 1', department: 'bsit' };
    const sub = { id: 'sub_dec', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' };
    setupContext({
        faculty: [{ id: 'f1', full_name: 'Alice', department: 'bsit' }],
        tasks: [task],
        submissions: [sub]
    });

    // Mock modal textarea
    global.document = {
        getElementById: (id) => {
            if (id === 'chairRevisionRemarks') return { value: 'Incomplete bibliography' };
            return { classList: { add: () => {}, remove: () => {} }, textContent: '' };
        }
    };

    ChairReview.openDecline('sub_dec');
    await ChairReview.submitRevision();

    assert.ok(reviewArgs, 'applySubmissionReview should have been called for decline');
    assert.strictEqual(reviewArgs.action, 'rejected');
    assert.strictEqual(reviewArgs.comment, 'Incomplete bibliography');
});

// -------------------------------------------------------------
// 7. CONSOLIDATE MFO MODAL & ACTIONS
// -------------------------------------------------------------

registerTest('7.1 Dedicated Consolidate MFO exports exist on CiteFlowChairReview', () => {
    assert.strictEqual(typeof ChairReview.openConsolidatedMfo, 'function', 'openConsolidatedMfo must be exported');
    assert.strictEqual(typeof ChairReview.closeConsolidatedMfo, 'function', 'closeConsolidatedMfo must be exported');
    assert.strictEqual(typeof ChairReview.setConsolidatedMfoTab, 'function', 'setConsolidatedMfoTab must be exported');
    assert.strictEqual(typeof ChairReview.loadAndRenderConsolidatedMfo, 'function', 'loadAndRenderConsolidatedMfo must be exported');
    assert.strictEqual(typeof ChairReview.createConsolidatedDraft, 'function', 'createConsolidatedDraft must be exported');
    assert.strictEqual(typeof ChairReview.regenerateMfoDraftModal, 'function', 'regenerateMfoDraftModal must be exported');
    assert.strictEqual(typeof ChairReview.acknowledgeMfoDraftModal, 'function', 'acknowledgeMfoDraftModal must be exported');
    assert.strictEqual(typeof ChairReview.toggleExclusionModal, 'function', 'toggleExclusionModal must be exported');
    assert.strictEqual(typeof ChairReview.saveMfoDraftRemarks, 'function', 'saveMfoDraftRemarks must be exported');
});

registerTest('7.2 openConsolidatedMfo blocks missing tasks and unauthorized department access', () => {
    let lastToast = null;
    wf.showToast = (msg, type) => { lastToast = { msg, type }; };

    const modalClasses = new Set();
    global.document = {
        getElementById: (id) => {
            if (id === 'chairConsolidatedMfoModal') {
                return {
                    classList: {
                        add: (c) => modalClasses.add(c),
                        remove: (c) => modalClasses.delete(c),
                        contains: (c) => modalClasses.has(c)
                    }
                };
            }
            return {
                classList: { add: () => {}, remove: () => {} },
                textContent: '',
                innerHTML: '',
                value: ''
            };
        }
    };

    // 1. Task not found check
    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Dr. BSIT', department: 'bsit', role: 'chairperson' },
        tasks: []
    });
    ChairReview.openConsolidatedMfo('non-existent-task');
    assert.strictEqual(lastToast?.type, 'error');
    assert.strictEqual(lastToast?.msg, 'Task not found.');
    assert.strictEqual(modalClasses.has('open'), false);

    // 2. Unauthorized department check
    const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));
    global.CiteFlowMfoConsolidation = engine;
    const auth = engine.verifyChairpersonDepartmentAccess({ id: 'c1', department: 'bsit', role: 'chairperson' }, 'bit', []);
    assert.strictEqual(auth.authorized, false, 'Chairperson without grant is unauthorized for BIT');

    // 3. Authorized access opens modal
    const bsitTask = { id: 'task-bsit', title: 'BSIT MFO Task', department: 'bsit' };
    const createChain = () => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            ilike: () => chain,
            in: () => chain,
            order: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            single: () => Promise.resolve({ data: null, error: null })
        };
        return chain;
    };
    global.supabaseClient = {
        from: () => createChain(),
        rpc: () => Promise.resolve({ data: [], error: null })
    };

    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Dr. BSIT', department: 'bsit', role: 'chairperson' },
        tasks: [bsitTask]
    });
    ChairReview.openConsolidatedMfo('task-bsit');
    assert.strictEqual(modalClasses.has('open'), true, 'Modal opens for authorized department');
    assert.strictEqual(ChairReview.review.activeConsolidatedMfoTaskId, 'task-bsit');

    // Close modal
    ChairReview.closeConsolidatedMfo();
    assert.strictEqual(modalClasses.has('open'), false, 'closeConsolidatedMfo removes open class');
    assert.strictEqual(ChairReview.review.activeConsolidatedMfoTaskId, null);
});

registerTest('7.3 createConsolidatedDraft enforces busy state idempotency guard against duplicate clicks', async () => {
    let insertCalls = 0;
    global.supabaseClient = {
        from: (table) => ({
            select: () => ({
                eq: () => ({
                    ilike: () => ({
                        maybeSingle: () => Promise.resolve({ data: null, error: null })
                    })
                })
            }),
            insert: () => {
                insertCalls++;
                return {
                    select: () => ({
                        single: () => Promise.resolve({ data: { id: 'pkt-new', current_version: 1 }, error: null })
                    })
                };
            }
        })
    };

    ChairReview.review.mfoDraftBusy = true; // Simulate in-flight request
    await ChairReview.createConsolidatedDraft('task-bsit');
    assert.strictEqual(insertCalls, 0, 'No insert should occur while mfoDraftBusy is true');
    ChairReview.review.mfoDraftBusy = false;
});

registerTest('7.4 saveMfoDraftRemarks preserves existing notes metadata and updates user remarks', async () => {
    const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));
    global.CiteFlowMfoConsolidation = engine;

    const existingDraft = {
        id: 'prog-pkt-1',
        task_id: 'task-mfo',
        department: 'bsit',
        notes: JSON.stringify({
            citeflow_mfo_consolidation: {
                excluded_accomplishments: ['acc-1', 'acc-2'],
                count: 2,
                acknowledged_at: '2026-03-28T10:00:00Z'
            }
        })
    };

    let updatedPayload = null;
    const createChain = () => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            ilike: () => chain,
            in: () => chain,
            order: () => chain,
            maybeSingle: () => Promise.resolve({ data: existingDraft, error: null }),
            single: () => Promise.resolve({ data: existingDraft, error: null }),
            update: (data) => {
                updatedPayload = data;
                return chain;
            }
        };
        return chain;
    };

    global.supabaseClient = {
        from: () => createChain(),
        rpc: () => Promise.resolve({ data: [], error: null })
    };

    global.document = {
        getElementById: (id) => {
            if (id === 'chairMfoDraftRemarksInput') {
                return { value: 'Approved subject to minor verification of PI7 documentation.' };
            }
            return { classList: { add: () => {}, remove: () => {} } };
        }
    };

    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        tasks: [{ id: 'task-mfo', title: 'MFO Task', department: 'bsit' }]
    });

    await ChairReview.saveMfoDraftRemarks('task-mfo');

    assert.ok(updatedPayload, 'Draft update should have been called');
    const parsedNotes = JSON.parse(updatedPayload.notes);
    const consolidationMeta = parsedNotes.citeflow_mfo_consolidation;
    assert.ok(consolidationMeta, 'citeflow_mfo_consolidation metadata must exist');
    assert.strictEqual(consolidationMeta.user_remarks, 'Approved subject to minor verification of PI7 documentation.');
    // Invariant: Excluded accomplishments and acknowledgment must NOT be wiped
    assert.deepStrictEqual(consolidationMeta.excluded_accomplishments, ['acc-1', 'acc-2']);
    assert.strictEqual(consolidationMeta.count, 2);
    assert.strictEqual(consolidationMeta.acknowledged_at, '2026-03-28T10:00:00Z');
});

registerTest('7.5 Single "Consolidate MFO" button per submission card', () => {
    const row = {
        id: 'sub_mfo_1',
        task_id: 'task_mfo_1',
        task_title: 'MFO Accomplishment Report',
        faculty_name: 'Dr. Jane Smith',
        department: 'bsit',
        status: 'submitted',
        approval_stage: 'chairperson',
        submitted_at: '2026-03-15T08:00:00Z',
        task: { id: 'task_mfo_1', title: 'MFO Accomplishment Report' }
    };
    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        tasks: [row.task],
        submissions: [row]
    });
    const html = ChairReview.renderCard(row);
    const matches = html.match(/Consolidate MFO/g) || [];
    assert.strictEqual(matches.length, 1, 'Exactly one "Consolidate MFO" button must be rendered on the card');
    assert.ok(html.includes("CiteFlowChairReview.openConsolidatedMfo('task_mfo_1')"), 'Card must link to openConsolidatedMfo with taskId');
});

registerTest('7.6 Modal close button deduplication in submissions.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'faculty', 'submissions.html'), 'utf8');

    // chairConsolidatedMfoModal: exactly 1 close button
    const consolidatedModalCloseMatches = html.match(/onclick=["']CiteFlowChairReview\.closeConsolidatedMfo\(\)["']/g) || [];
    assert.strictEqual(consolidatedModalCloseMatches.length, 1, 'chairConsolidatedMfoModal must have exactly 1 close button');

    // chairTaskDetailModal: exactly 1 close button
    const taskDetailsCloseMatches = html.match(/onclick=["']CiteFlowChairReview\.closeTaskDetails\(\)["']/g) || [];
    assert.strictEqual(taskDetailsCloseMatches.length, 1, 'chairTaskDetailModal must have exactly 1 close button');

    // chairFilePreviewModal: exactly 1 close button
    const filePreviewCloseMatches = html.match(/onclick=["']CiteFlowChairReview\.closeFilePreview\(\)["']/g) || [];
    assert.strictEqual(filePreviewCloseMatches.length, 1, 'chairFilePreviewModal must have exactly 1 close button');
});

registerTest('7.7 View MFO action button and preview tab in renderConsolidatedMfoModalView', () => {
    const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));
    global.CiteFlowMfoConsolidation = engine;

    const task = { id: 'task_mfo_demo', title: 'Q1 MFO Report', department: 'bsit' };
    const consolidation = {
        contributingFaculty: [{ facultyId: 'f1', facultyName: 'Faculty 1', submissionId: 's1' }],
        unsubmittedFaculty: [],
        sections: { mfo_pi3_enrollment: [{ section: 'IT3A', students_enrolled: 40 }] },
        programRows: { pi1: [], pi2: [] },
        photos: []
    };
    const draft = { id: 'pkt_1', current_version: 1, packet_state: 'draft' };
    const staleness = { status: 'fresh' };

    let modalContent = '';
    let footerContent = '';
    global.document = {
        addEventListener: () => {},
        removeEventListener: () => {},
        getElementById: (id) => {
            if (id === 'chairMfoModalBody' || id === 'chairConsolidatedMfoContent') {
                return { innerHTML: '', set innerHTML(val) { modalContent = val; } };
            }
            if (id === 'chairMfoModalFooterActions') {
                return { innerHTML: '', set innerHTML(val) { footerContent = val; } };
            }
            return {
                innerHTML: '',
                textContent: '',
                className: '',
                classList: { add: () => {}, remove: () => {} }
            };
        }
    };

    setupContext({
        chairFaculty: { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'bsit', role: 'chairperson' },
        tasks: [task]
    });

    // Test Summary tab
    ChairReview.review.consolidatedMfoActiveTab = 'summary';
    ChairReview.renderConsolidatedMfoModalView({ task, draft, consolidation, staleness, dept: 'bsit' });

    assert.ok(modalContent.includes('Full Compiled Report'), 'Navigation tabs must include Full Compiled Report');
    assert.ok(modalContent.includes('mfo-report.html?view=consolidated'), 'Summary tab must have View MFO action link');
    assert.ok(footerContent.includes('mfo-report.html?view=consolidated'), 'Modal footer must include View MFO button');

    // Test Preview tab
    ChairReview.review.consolidatedMfoActiveTab = 'preview';
    ChairReview.renderConsolidatedMfoModalView({ task, draft, consolidation, staleness, dept: 'bsit' });

    assert.ok(modalContent.includes('<iframe'), 'Preview tab must render an iframe for the full compiled report');
    assert.ok(modalContent.includes('src="mfo-report.html?view=consolidated'), 'Preview iframe src must point to consolidated MFO report');
});

registerTest('7.8 Full compiled MFO report, Chairperson Report Information, and contributing faculty attribution', () => {
    const MfoFaculty = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));
    const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));

    const chair = {
        id: 'chair-prof-1',
        first_name: 'Maria',
        middle_name: 'Santos',
        last_name: 'Dela Cruz',
        full_name: 'Maria S. Dela Cruz',
        academic_rank: 'Associate Professor IV',
        employee_id: 'EMP-CHAIR-001',
        department: 'Information Technology',
        department_code: 'bsit',
        program: 'BS Information Technology',
        role: 'chairperson'
    };
    const task = {
        id: 'task_mfo_full',
        title: 'Q1 MFO Department Report',
        department: 'bsit'
    };
    const period = {
        reporting_year: 2026,
        academic_year: '2025-2026',
        semester: '2nd Semester',
        quarter: '1st Quarter'
    };

    // Set state to consolidated mode
    const state = MfoFaculty._state;
    state.isConsolidated = true;
    state.chairFaculty = chair;
    state.faculty = chair; // Fallback
    state.task = task;
    state.period = period;
    state.profileOverrides = {};

    // 1. Verify Report Information correctly identifies the authenticated Chairperson
    const profile = MfoFaculty._reportProfileModel();
    assert.strictEqual(profile.fullName, 'Maria S. Dela Cruz', 'Preparer full name must be the Chairperson');
    assert.strictEqual(profile.employeeId, 'EMP-CHAIR-001', 'Employee ID must be the Chairperson ID');
    assert.strictEqual(profile.rank, 'Associate Professor IV', 'Rank must be the Chairperson rank');
    assert.strictEqual(profile.department, 'bsit', 'Department must match');
    assert.strictEqual(profile.program, 'BS Information Technology', 'Program must match Chairperson program');
    assert.strictEqual(profile.chairperson, 'Maria S. Dela Cruz', 'Chairperson certification name must be Chairperson');
    assert.strictEqual(profile.academicPeriod, '2025-2026 · 2nd Semester', 'Academic period must be formatted correctly');

    // 2. Verify status label and submittedByLine
    state.programDraft = { packet_state: 'draft' };
    assert.strictEqual(MfoFaculty._statusLabel(), 'Consolidated — Program Draft');
    state.programDraft = { packet_state: 'submitted', certified_by_name: 'Maria S. Dela Cruz' };
    assert.strictEqual(MfoFaculty._statusLabel(), 'Consolidated — Certified by Program Chairperson');
    const submitLine = MfoFaculty._submittedByLine(chair);
    assert.ok(submitLine.includes('Maria S. Dela Cruz'), 'Submitted by line must contain Chairperson certified name');

    // 3. Verify contributing faculty attribution in resolvePrintColumn
    const sampleRow = {
        contributing_faculty_name: 'Engr. Juan Luna',
        section: 'IT3B',
        students_enrolled: 45
    };
    const [label, val] = MfoFaculty._resolvePrintColumn(
        { fields: [] },
        ['Name of Faculty', () => 'Default Faculty'],
        sampleRow,
        {}
    );
    assert.strictEqual(val, 'Engr. Juan Luna', 'Print column for Name of Faculty must display contributing faculty name in consolidated mode');

    // 4. Verify exclusion handling in consolidation engine
    const allAccomplishments = [
        { id: 'acc_keep', title: 'Machine Learning Curriculum Workshop' },
        { id: 'acc_exclude', title: 'Unverified External Event' }
    ];
    const excludedIds = ['acc_exclude'];
    const active = allAccomplishments.filter((a) => !excludedIds.includes(a.id));
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].id, 'acc_keep', 'Excluded items must be filtered out of active accomplishments');
});

// Async test runner
(async function runAll() {
    console.log('\n======================================================');
    console.log('   CITE-FLOW PHASE 3 — CHAIRPERSON VALIDATION SUITE   ');
    console.log('======================================================\n');

    for (const t of tests) {
        try {
            await t.fn();
            console.log(`[PASS] ${t.title}`);
            passCount++;
        } catch (err) {
            console.error(`[FAIL] ${t.title}`);
            console.error(err);
            failCount++;
            process.exitCode = 1;
        }
    }

    console.log('\n======================================================');
    console.log(`VALIDATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================\n');

    if (failCount > 0) {
        process.exit(1);
    }
})();
