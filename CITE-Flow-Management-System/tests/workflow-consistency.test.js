/**
 * CITE-Flow Phase 4 — Final Workflow Consistency Audit Test Suite
 *
 * Verifies:
 * 1. Multi-role consistency between Faculty Submissions, Chairperson Review, and Dean/Admin Final Approval.
 * 2. Submission status transitions: pending -> chair-approved -> final-approved, revision, declined.
 * 3. Chairperson approval does NOT imply final Dean's Office approval.
 * 4. File locking consistency across lifecycle states.
 * 5. Department scoping & OIC delegated authorization boundaries on review actions.
 * 6. Deduplication and tab badge count consistency.
 */

const assert = require('assert');
const path = require('path');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const ChairReview = require(path.join(__dirname, '..', 'faculty', 'chairperson-review.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

function setupContext({
    chairFaculty = { id: 'chair-cs', full_name: 'Dr. BSCS Chair', department: 'bscs', role: 'chairperson' },
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

// -----------------------------------------------------------------------------
// 1. CHAIRPERSON APPROVAL DOES NOT IMPLY FINAL DEAN APPROVAL
// -----------------------------------------------------------------------------

registerTest('4.1 Invariant: Chairperson approval transitions to final_approver stage without final approval', () => {
    const task = { id: 't1', title: 'Syllabus CS101', requires_chairperson_review: true };
    const config = { id: 'cfg1', requires_chairperson_review: true, requires_final_approval: true };
    const faculty = { id: 'f1', department: 'bscs', full_name: 'Alice Faculty' };
    const chair = { id: 'c1', department: 'bscs', role: 'chairperson', full_name: 'Dr. Chair' };

    // Initial submission
    const sub = {
        id: 's1',
        task_id: 't1',
        faculty_id: 'f1',
        status: 'submitted',
        approval_stage: 'chairperson',
        submitted_at: '2026-10-15T08:00:00Z'
    };

    // 1. Initial stage check
    assert.strictEqual(wf.getApprovalStage(sub, config, task), 'chairperson');
    assert.strictEqual(wf.getWorkflowStage(sub, task, config), 'chairperson_review');
    assert.strictEqual(wf.isFinallyApproved(sub, task, config), false);

    // 2. Chairperson approves
    const chairTransition = wf.computeReviewTransition(sub, 'approved', chair, config, task);
    assert.strictEqual(chairTransition.nextStage, 'final_approver', 'Chairperson approval must route to final_approver stage');
    assert.strictEqual(chairTransition.nextStatus, 'underreview', 'Chairperson approval must set status to underreview (not approved)');
    assert.strictEqual(chairTransition.historyAction, 'chairperson_approved');

    // Simulate database record update after Chairperson approval
    const chairApprovedSub = {
        ...sub,
        status: chairTransition.nextStatus,
        approval_stage: chairTransition.nextStage,
        reviewed_by_name: 'Dr. Chair',
        reviewed_at: '2026-10-15T09:00:00Z',
        last_reviewed_by_role: 'CHAIRPERSON'
    };

    // 3. Verify that Chairperson approval DOES NOT imply final approval
    assert.strictEqual(wf.isFinallyApproved(chairApprovedSub, task, config), false, 'isFinallyApproved must be FALSE after chairperson approval');
    assert.strictEqual(wf.getWorkflowStage(chairApprovedSub, task, config), 'final_approval');
    assert.strictEqual(wf.formatWorkflowStatus(chairApprovedSub, task, config), 'Pending Admin Final Approval');

    // Analytics verify counts.approved is 0 and pending_review is 1
    const analytics = wf.computeSubmissionAnalytics([{ task_id: 't1', faculty_id: 'f1' }], [chairApprovedSub], task, { reportConfigs: [config] });
    assert.strictEqual(analytics.counts.approved, 0, 'counts.approved must remain 0');
    assert.strictEqual(analytics.counts.pending_review, 1, 'counts.pending_review must be 1');
    assert.strictEqual(analytics.counts.submitted, 1, 'counts.submitted must be 1');
});

registerTest('4.2 Invariant: Dean / Admin final approval completes workflow and transitions to approved stage', () => {
    const task = { id: 't1', title: 'Syllabus CS101', requires_chairperson_review: true };
    const config = { id: 'cfg1', requires_chairperson_review: true, requires_final_approval: true };
    const admin = { id: 'admin1', department: 'All', role: 'admin', full_name: 'College Dean' };

    // Submission already approved by Chairperson, currently at final_approver stage
    const chairApprovedSub = {
        id: 's1',
        task_id: 't1',
        faculty_id: 'f1',
        status: 'underreview',
        approval_stage: 'final_approver',
        submitted_at: '2026-10-15T08:00:00Z',
        reviewed_by_name: 'Dr. Chair',
        reviewed_at: '2026-10-15T09:00:00Z',
        last_reviewed_by_role: 'CHAIRPERSON'
    };

    // Admin approves
    const adminTransition = wf.computeReviewTransition(chairApprovedSub, 'approved', admin, config, task);
    assert.strictEqual(adminTransition.nextStage, 'approved', 'Admin approval must advance stage to approved');
    assert.strictEqual(adminTransition.nextStatus, 'approved', 'Admin approval must advance status to approved');
    assert.strictEqual(adminTransition.historyAction, 'final_approved');

    const fullyApprovedSub = {
        ...chairApprovedSub,
        status: adminTransition.nextStatus,
        approval_stage: adminTransition.nextStage,
        final_approved_at: '2026-10-15T11:00:00Z',
        final_approved_by_name: 'College Dean'
    };

    // Verify completion
    assert.strictEqual(wf.isFinallyApproved(fullyApprovedSub, task, config), true, 'isFinallyApproved must be TRUE after admin approval');
    assert.strictEqual(wf.getWorkflowStage(fullyApprovedSub, task, config), 'completed');
    assert.strictEqual(wf.formatWorkflowStatus(fullyApprovedSub, task, config), 'Completed');

    // Analytics verify counts.approved is 1
    const analytics = wf.computeSubmissionAnalytics([{ task_id: 't1', faculty_id: 'f1' }], [fullyApprovedSub], task, { reportConfigs: [config] });
    assert.strictEqual(analytics.counts.approved, 1, 'counts.approved must be 1');
    assert.strictEqual(analytics.counts.pending_review, 0, 'counts.pending_review must be 0');
    assert.strictEqual(analytics.counts.submitted, 1, 'counts.submitted must be 1');
});

// -----------------------------------------------------------------------------
// 2. MULTI-ROLE TIMELINE & STATUS PRESENTATION CONSISTENCY
// -----------------------------------------------------------------------------

registerTest('4.3 Faculty timeline reflects exact stage without premature completion', () => {
    const task = { id: 't1', title: 'Task 1', requires_chairperson_review: true };
    const assignment = { task_id: 't1', faculty_id: 'f1', assigned_at: '2026-10-01' };

    // Case A: Just submitted
    const subSubmitted = { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-10-10' };
    const stepsA = wf.buildTimelineSteps(subSubmitted, task, assignment, [], null);
    const chairStepA = stepsA.find(s => s.key === 'chairperson');
    const finalStepA = stepsA.find(s => s.key === 'final');
    const completedStepA = stepsA.find(s => s.key === 'completed');

    assert.strictEqual(chairStepA.active, true, 'Chair step must be active');
    assert.strictEqual(chairStepA.done, false, 'Chair step must not be done');
    assert.strictEqual(finalStepA.active, false, 'Final step must not be active');
    assert.strictEqual(completedStepA.done, false, 'Completed step must not be done');

    // Case B: Chairperson approved (waiting for Admin)
    const subChairApproved = { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'underreview', approval_stage: 'final_approver', submitted_at: '2026-10-10', reviewed_at: '2026-10-11' };
    const historyB = [{ submission_id: 's1', action: 'chairperson_approved', created_at: '2026-10-11' }];
    const stepsB = wf.buildTimelineSteps(subChairApproved, task, assignment, historyB, null);
    const chairStepB = stepsB.find(s => s.key === 'chairperson');
    const finalStepB = stepsB.find(s => s.key === 'final');
    const completedStepB = stepsB.find(s => s.key === 'completed');

    assert.strictEqual(chairStepB.done, true, 'Chair step must be done');
    assert.strictEqual(finalStepB.active, true, 'Final step must be active');
    assert.strictEqual(finalStepB.done, false, 'Final step must not be done');
    assert.strictEqual(completedStepB.done, false, 'Completed step must not be done');

    // Case C: Admin finally approved
    const subFinalApproved = { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-10', final_approved_at: '2026-10-12' };
    const historyC = [
        { submission_id: 's1', action: 'chairperson_approved', created_at: '2026-10-11' },
        { submission_id: 's1', action: 'final_approved', created_at: '2026-10-12' }
    ];
    const stepsC = wf.buildTimelineSteps(subFinalApproved, task, assignment, historyC, null);
    const finalStepC = stepsC.find(s => s.key === 'final');
    const completedStepC = stepsC.find(s => s.key === 'completed');

    assert.strictEqual(finalStepC.done, true, 'Final step must be done');
    assert.strictEqual(completedStepC.done, true, 'Completed step must be done');
});

// -----------------------------------------------------------------------------
// 3. FILE LOCKING CONSISTENCY ACROSS WORKFLOW
// -----------------------------------------------------------------------------

registerTest('4.4 File management permissions lock after chairperson approval, unlock on revision, lock permanently on approval', () => {
    const task = { id: 't1', title: 'Task 1', requires_chairperson_review: true };
    const config = { id: 'c1', requires_chairperson_review: true };

    // State 1: Submitted (chairperson stage) - faculty can unsubmit or manage files before chair reviews
    const subReview = { id: 's1', status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-10-10' };
    assert.strictEqual(wf.canFacultyUnsubmit(subReview, task, config), true, 'Faculty can unsubmit before reviewer action');
    assert.strictEqual(wf.canFacultyManageSubmissionFiles(subReview, task, config), true, 'Faculty can manage files before chair reviews');

    // State 2: Chairperson approved (waiting for Admin) - files and unsubmit are locked
    const subChairApproved = { id: 's1', status: 'underreview', approval_stage: 'final_approver', submitted_at: '2026-10-10' };
    assert.strictEqual(wf.canFacultyManageSubmissionFiles(subChairApproved, task, config), false, 'Files must be locked after chairperson approval');
    assert.strictEqual(wf.canFacultyUnsubmit(subChairApproved, task, config), false, 'Faculty cannot unsubmit after chairperson approval');

    // State 3: Returned for revision - files are unlocked for updating and resubmission
    const subRevision = { id: 's1', status: 'revision', approval_stage: 'chairperson', submitted_at: '2026-10-10' };
    assert.strictEqual(wf.canFacultyManageSubmissionFiles(subRevision, task, config), true, 'Files must be editable during revision');

    // State 4: Finally approved - permanently locked
    const subApproved = { id: 's1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-10' };
    assert.strictEqual(wf.canFacultyManageSubmissionFiles(subApproved, task, config), false, 'Files must be permanently locked on completion');
    assert.strictEqual(wf.canFacultyUnsubmit(subApproved, task, config), false, 'Cannot unsubmit completed submission');

    // State 5: Declined / Rejected - locked
    const subRejected = { id: 's1', status: 'rejected', approval_stage: 'declined', submitted_at: '2026-10-10' };
    assert.strictEqual(wf.canFacultyManageSubmissionFiles(subRejected, task, config), false, 'Files must be locked on rejection');
    assert.strictEqual(wf.canFacultyUnsubmit(subRejected, task, config), false, 'Cannot unsubmit rejected submission');
});

// -----------------------------------------------------------------------------
// 4. DEPARTMENT SCOPING & OIC DELEGATED AUTHORIZATION ON REVIEW ACTIONS
// -----------------------------------------------------------------------------

registerTest('4.5 Chairperson can review ONLY faculty in authorized department scope', () => {
    const chairBSCS = { id: 'chair-cs', department: 'bscs', role: 'chairperson', full_name: 'CS Chair' };
    const facultyBSCS = { id: 'fac-cs', department: 'bscs', full_name: 'CS Faculty' };
    const facultyBSIT = { id: 'fac-it', department: 'bsit', full_name: 'IT Faculty' };

    const subCS = { id: 's_cs', faculty_id: 'fac-cs', status: 'submitted', approval_stage: 'chairperson' };
    const subIT = { id: 's_it', faculty_id: 'fac-it', status: 'submitted', approval_stage: 'chairperson' };

    // 1. Without OIC grant: can review CS faculty, cannot review IT faculty
    assert.strictEqual(wf.canReviewAsChairperson(subCS, chairBSCS, facultyBSCS, { delegatedAccess: [] }), true);
    assert.strictEqual(wf.canReviewAsChairperson(subIT, chairBSCS, facultyBSIT, { delegatedAccess: [] }), false);

    // 2. With active OIC grant covering BSIT
    const activeGrant = [{ id: 'g1', is_active: true, department_code: 'bsit', grantee_faculty_id: 'chair-cs' }];
    assert.strictEqual(wf.canReviewAsChairperson(subIT, chairBSCS, facultyBSIT, { delegatedAccess: activeGrant }), true, 'Active OIC grant must permit review');

    // 3. With revoked OIC grant covering BSIT
    const revokedGrant = [{ id: 'g1', is_active: false, department_code: 'bsit', grantee_faculty_id: 'chair-cs' }];
    assert.strictEqual(wf.canReviewAsChairperson(subIT, chairBSCS, facultyBSIT, { delegatedAccess: revokedGrant }), false, 'Revoked OIC grant must deny review');
});

registerTest('4.6 Submitter cannot act as Chairperson reviewer on their own submission', () => {
    const chairCS = { id: 'chair-cs', department: 'bscs', role: 'chairperson', full_name: 'CS Chair' };
    const ownSub = { id: 's_own', faculty_id: 'chair-cs', status: 'submitted', approval_stage: 'chairperson' };

    assert.strictEqual(wf.canReviewAsChairperson(ownSub, chairCS, chairCS, { delegatedAccess: [] }), false, 'Chairperson cannot review own submission');
    assert.strictEqual(wf.submitterIsOwnChairperson(chairCS, []), true, 'submitterIsOwnChairperson must detect self-review hazard');
});

// -----------------------------------------------------------------------------
// 5. CHAIRPERSON TAB BADGES & ROW COUNTS EXACT ALIGNMENT
// -----------------------------------------------------------------------------

registerTest('4.7 Chairperson subtab badges match exact row counts across all states', () => {
    const faculty = [
        { id: 'f1', full_name: 'F1', department: 'bscs' },
        { id: 'f2', full_name: 'F2', department: 'bscs' },
        { id: 'f3', full_name: 'F3', department: 'bscs' },
        { id: 'f4', full_name: 'F4', department: 'bscs' },
        { id: 'f5', full_name: 'F5', department: 'bscs' }
    ];
    const task = { id: 't1', title: 'Task 1', department: 'bscs', requires_chairperson_review: true };
    const assignments = faculty.map(f => ({ task_id: 't1', faculty_id: f.id }));

    // f1: pending chair approval
    // f2: chair approved (at admin final approval)
    // f3: revision requested
    // f4: declined
    // f5: not submitted (no submission)
    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'submitted', approval_stage: 'chairperson' },
        { id: 's2', task_id: 't1', faculty_id: 'f2', status: 'underreview', approval_stage: 'final_approver' },
        { id: 's3', task_id: 't1', faculty_id: 'f3', status: 'revision', approval_stage: 'revision' },
        { id: 's4', task_id: 't1', faculty_id: 'f4', status: 'rejected', approval_stage: 'declined' }
    ];

    setupContext({ faculty, tasks: [task], assignments, submissions });

    const allRows = ChairReview.buildRows();
    const pendingRows = allRows.filter(ChairReview.isPending);
    const approvedRows = allRows.filter(ChairReview.isApproved);
    const revisionRows = allRows.filter(ChairReview.isRevision);
    const declinedRows = allRows.filter(ChairReview.isDeclined);
    const nonSubmittedRows = ChairReview.buildNonSubmittedRows();

    // Verify row partitions
    assert.strictEqual(pendingRows.length, 1, 'Only s1 is pending chair approval');
    assert.strictEqual(pendingRows[0].id, 's1');

    assert.strictEqual(approvedRows.length, 1, 's2 (chair approved) must appear in approved tab');
    assert.strictEqual(approvedRows[0].id, 's2');

    assert.strictEqual(revisionRows.length, 1, 's3 in revision tab');
    assert.strictEqual(declinedRows.length, 1, 's4 in declined tab');
    assert.strictEqual(nonSubmittedRows.length, 1, 'f5 in non-submitted tab');

    // Total rows consistency
    assert.strictEqual(allRows.length, 4, '4 submissions in department');
});

// Run all tests
(async function runAll() {
    console.log('\n======================================================');
    console.log('   CITE-FLOW PHASE 4 — WORKFLOW CONSISTENCY AUDIT     ');
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
    console.log(`CONSISTENCY AUDIT: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================\n');

    if (failCount > 0) {
        process.exit(1);
    }
})();
