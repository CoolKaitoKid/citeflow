/**
 * Comprehensive test suite for Phase 1: Standardize Submission Analytics.
 * Validates:
 * 1. Future-deadline non-submitters (not_submitted_open)
 * 2. Overdue non-submitters (not_submitted_overdue)
 * 3. Submitted and pending-review records (on-time & late timing separation)
 * 4. Revision and rejected submissions (counted as submitted)
 * 5. Approved submissions
 * 6. Mathematical invariants (Expected = Submitted + Not Submitted, Submitted = Pending + Revision + Approved + Rejected)
 * 7. Duplicate or historical submission attempts (deterministic latest selection)
 * 8. Draft MFO packets & unsubmitted drafts (excluded from genuine submissions)
 * 9. Unassigned / orphaned submissions (diagnostics without inflating expected)
 * 10. Admin workflow-approval integration (computeTaskProgress, classifyWorkflowRow)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const wfPath = path.join(__dirname, '..', 'shared', 'workflow.js');
const wf = require(wfPath);

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

console.log('\n--- PHASE 1: SUBMISSION ANALYTICS UNIT TESTS ---\n');

// 1. Future-deadline non-submitters
test('1. Future-deadline non-submitter is classified as not_submitted_open', () => {
    const task = { id: 10, deadline_at: '2026-12-31T23:59:59Z' };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(null, task, null, now);

    assert.strictEqual(result.is_submitted, false);
    assert.strictEqual(result.category, 'not_submitted_open');
    assert.strictEqual(result.timing, 'open');
    assert.strictEqual(result.is_overdue, false);
});

// 2. Overdue non-submitters
test('2. Past-deadline non-submitter is classified as not_submitted_overdue', () => {
    const task = { id: 10, deadline_at: '2026-09-01T23:59:59Z' };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(null, task, null, now);

    assert.strictEqual(result.is_submitted, false);
    assert.strictEqual(result.category, 'not_submitted_overdue');
    assert.strictEqual(result.timing, 'overdue');
    assert.strictEqual(result.is_overdue, true);
});

// 3. Submitted and pending-review records
test('3a. On-time submission pending review has separate timing and review status', () => {
    const task = { id: 10, deadline_at: '2026-10-20T23:59:59Z' };
    const sub = {
        id: 101,
        task_id: 10,
        faculty_id: 5,
        status: 'submitted',
        submitted_at: '2026-10-15T10:00:00Z'
    };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(sub, task, null, now);

    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.category, 'pending_review');
    assert.strictEqual(result.review_status, 'pending_review');
    assert.strictEqual(result.timing, 'on_time');
    assert.strictEqual(result.is_late, false);
});

test('3b. Late submission pending review has timing=late without hijacking review category', () => {
    const task = { id: 10, deadline_at: '2026-10-01T23:59:59Z' };
    const sub = {
        id: 102,
        task_id: 10,
        faculty_id: 6,
        status: 'submitted',
        submitted_at: '2026-10-05T10:00:00Z'
    };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(sub, task, null, now);

    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.category, 'pending_review');
    assert.strictEqual(result.review_status, 'pending_review');
    assert.strictEqual(result.timing, 'late');
    assert.strictEqual(result.is_late, true);
});

// 4. Revision and rejected submissions count as submitted
test('4a. Revision requested submission counts as submitted (needs_revision)', () => {
    const task = { id: 10, deadline_at: '2026-10-01T23:59:59Z' };
    const sub = {
        id: 103,
        task_id: 10,
        faculty_id: 7,
        status: 'revision',
        approval_stage: 'revision',
        submitted_at: '2026-09-28T10:00:00Z'
    };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(sub, task, null, now);

    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.category, 'needs_revision');
    assert.strictEqual(result.review_status, 'needs_revision');
});

test('4b. Rejected/declined submission counts as submitted (rejected)', () => {
    const task = { id: 10, deadline_at: '2026-10-01T23:59:59Z' };
    const sub = {
        id: 104,
        task_id: 10,
        faculty_id: 8,
        status: 'rejected',
        approval_stage: 'declined',
        submitted_at: '2026-09-29T10:00:00Z'
    };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(sub, task, null, now);

    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.category, 'rejected');
    assert.strictEqual(result.review_status, 'rejected');
});

// 5. Approved submissions
test('5. Approved submission is classified as approved with timing preserved', () => {
    const task = { id: 10, deadline_at: '2026-10-01T23:59:59Z' };
    const sub = {
        id: 105,
        task_id: 10,
        faculty_id: 9,
        status: 'approved',
        approval_stage: 'approved',
        submitted_at: '2026-10-02T10:00:00Z' // late submission, but approved
    };
    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(sub, task, null, now);

    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.category, 'approved');
    assert.strictEqual(result.review_status, 'approved');
    assert.strictEqual(result.timing, 'late'); // timing tracked orthogonally
});

// 6. Mathematical Invariants
test('6. Invariants hold: Expected = Submitted + Not Submitted, and Submitted = Review categories sum', () => {
    const task = { id: 20, deadline_at: '2026-10-01T00:00:00Z' };
    const assignments = [
        { task_id: 20, faculty_id: 1 },
        { task_id: 20, faculty_id: 2 },
        { task_id: 20, faculty_id: 3 },
        { task_id: 20, faculty_id: 4 },
        { task_id: 20, faculty_id: 5 },
        { task_id: 20, faculty_id: 6 }
    ];
    const submissions = [
        { id: 1, task_id: 20, faculty_id: 1, status: 'approved', approval_stage: 'approved', submitted_at: '2026-09-20' },
        { id: 2, task_id: 20, faculty_id: 2, status: 'submitted', submitted_at: '2026-09-22' },
        { id: 3, task_id: 20, faculty_id: 3, status: 'revision', approval_stage: 'revision', submitted_at: '2026-09-25' },
        { id: 4, task_id: 20, faculty_id: 4, status: 'rejected', approval_stage: 'declined', submitted_at: '2026-09-26' }
        // Faculty 5 and 6 have no submissions (overdue)
    ];

    const analytics = wf.computeSubmissionAnalytics(assignments, submissions, task, {
        now: new Date('2026-10-16T00:00:00Z').getTime()
    });

    const c = analytics.counts;
    assert.strictEqual(c.expected, 6, 'Expected count must be 6');
    assert.strictEqual(c.submitted, 4, 'Submitted count must be 4');
    assert.strictEqual(c.not_submitted, 2, 'Not submitted count must be 2');
    assert.strictEqual(c.not_submitted_overdue, 2, 'Both non-submitters must be overdue');
    assert.strictEqual(c.approved, 1);
    assert.strictEqual(c.pending_review, 1);
    assert.strictEqual(c.needs_revision, 1);
    assert.strictEqual(c.rejected, 1);

    // Verify balances
    assert.strictEqual(analytics.balances.exclusiveMatchesSubmitted, true);
    assert.strictEqual(analytics.balances.notSubmittedMatchesCategories, true);
    assert.strictEqual(analytics.balances.coverageMatchesExpected, true);
});

// 7. Duplicate or historical submission attempts
test('7. Deduplicates assignments and deterministically selects the latest submission attempt', () => {
    const task = { id: 30, deadline_at: '2026-12-01T00:00:00Z' };
    const assignments = [
        { task_id: 30, faculty_id: 1 },
        { task_id: 30, faculty_id: 1 } // Duplicate assignment row in DB
    ];
    const submissions = [
        { id: 10, task_id: 30, faculty_id: 1, status: 'revision', submitted_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' },
        { id: 20, task_id: 30, faculty_id: 1, status: 'submitted', submitted_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z' } // Latest revision attempt
    ];

    const latest = wf.selectLatestSubmission(submissions, 30, 1);
    assert.strictEqual(latest.id, 20, 'Latest attempt (id: 20) must be selected');

    const analytics = wf.computeSubmissionAnalytics(assignments, submissions, task);
    assert.strictEqual(analytics.counts.expected, 1, 'Duplicate assignment must not inflate expected count');
    assert.strictEqual(analytics.counts.submitted, 1, 'Submitted count must be 1');
    assert.strictEqual(analytics.counts.pending_review, 1, 'Latest submission is pending review');
});

// 8. Draft MFO packets and unsubmitted drafts
test('8. Draft MFO packets and unsubmitted drafts do not count as formal submissions', () => {
    const draftMfo = { id: 50, task_id: 40, faculty_id: 1, packet_state: 'draft', status: 'submitted' };
    const draftFlag = { id: 51, task_id: 40, faculty_id: 2, is_draft: true, status: 'submitted' };
    const unsubmitted = { id: 52, task_id: 40, faculty_id: 3, status: 'notsubmitted', submitted_at: null };
    const normalSub = { id: 53, task_id: 40, faculty_id: 4, status: 'submitted', submitted_at: '2026-10-01' };

    assert.strictEqual(wf.isGenuineSubmission(draftMfo), false);
    assert.strictEqual(wf.isGenuineSubmission(draftFlag), false);
    assert.strictEqual(wf.isGenuineSubmission(unsubmitted), false);
    assert.strictEqual(wf.isGenuineSubmission(normalSub), true);
});

// 9. Unassigned / orphaned submissions
test('9. Orphaned submissions do not inflate expected faculty totals and are tracked in diagnostics', () => {
    const task = { id: 50, deadline_at: '2026-12-01T00:00:00Z' };
    const assignments = [
        { task_id: 50, faculty_id: 1 }
    ];
    const submissions = [
        { id: 1, task_id: 50, faculty_id: 1, status: 'submitted', submitted_at: '2026-10-01' },
        { id: 2, task_id: 50, faculty_id: 999, status: 'submitted', submitted_at: '2026-10-01' } // Orphaned: faculty 999 not assigned
    ];

    const analytics = wf.computeSubmissionAnalytics(assignments, submissions, task);
    assert.strictEqual(analytics.counts.expected, 1, 'Expected must strictly match assigned faculty (1)');
    assert.strictEqual(analytics.counts.submitted, 1, 'Submitted must match assigned faculty (1)');
    assert.strictEqual(analytics.counts.orphaned_submissions, 1, 'Orphaned submission tracked');
    assert.strictEqual(analytics.orphanedRecords.length, 1);
    assert.strictEqual(analytics.orphanedRecords[0].faculty_id, '999');
});

// 10. admin/workflow-approval.html integration
test('10. workflow-approval.html computeTaskProgress and classifyWorkflowRow function correctly', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Load in VM with mock DOM and window context
    const sandbox = {
        console,
        window: {
            CiteFlowWorkflow: wf,
            addEventListener: () => {},
            removeEventListener: () => {},
            location: { hash: '', search: '', pathname: '' },
            workflowFileActionCache: {}
        },
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {},
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} }),
            body: { style: {} }
        },
        workflowState: {
            faculty: [
                { id: 1, full_name: 'Dr. Alice', is_active: true, status: 'active', department_code: 'BSIT' },
                { id: 2, full_name: 'Prof. Bob', is_active: true, status: 'active', department_code: 'BIT' },
                { id: 3, full_name: 'Dr. Charlie', is_active: true, status: 'active', department_code: 'BSIE' }
            ],
            assignments: [
                { task_id: '100', faculty_id: '1' },
                { task_id: '100', faculty_id: '2' },
                { task_id: '100', faculty_id: '3' }
            ],
            submissions: [
                { id: 1, task_id: '100', faculty_id: '1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-01' },
                { id: 2, task_id: '100', faculty_id: '2', status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-02' }
                // Faculty 3 not submitted
            ],
            submissionFiles: []
        }
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);

    // Extract script content
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch, 'script tag must exist in workflow-approval.html');
    vm.runInContext(scriptMatch[1], sandbox);

    sandbox.workflowState.faculty = [
        { id: '1', full_name: 'Dr. Alice', is_active: true, status: 'active', department_code: 'BSIT' },
        { id: '2', full_name: 'Prof. Bob', is_active: true, status: 'active', department_code: 'BIT' },
        { id: '3', full_name: 'Dr. Charlie', is_active: true, status: 'active', department_code: 'BSIE' }
    ];
    sandbox.workflowState.assignments = [
        { task_id: '100', faculty_id: '1' },
        { task_id: '100', faculty_id: '2' },
        { task_id: '100', faculty_id: '3' }
    ];
    sandbox.workflowState.submissions = [
        { id: 1, task_id: '100', faculty_id: '1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-01' },
        { id: 2, task_id: '100', faculty_id: '2', status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-02' }
        // Faculty 3 not submitted
    ];
    sandbox.workflowState.tasks = [
        { id: '100', title: 'Midterm Syllabus', deadline_at: '2026-12-31T23:59:59Z' }
    ];

    const task = { id: '100', title: 'Midterm Syllabus', deadline_at: '2026-12-31T23:59:59Z' };
    const progress = sandbox.computeTaskProgress(task);

    assert.strictEqual(progress.totalAssigned, 3, 'Total assigned must be 3');
    assert.strictEqual(progress.submittedCount, 2, 'Submitted count must be 2 (includes revision!)');
    assert.strictEqual(progress.notSubmittedCount, 1, 'Not submitted count must be 1');
    assert.strictEqual(progress.approvedCount, 1, 'Approved count must be 1');
    assert.strictEqual(progress.needsRevisionCount, 1, 'Needs revision count must be 1');
    assert.strictEqual(progress.notSubmittedOpenCount, 1, 'Future deadline non-submitter is open');
    assert.strictEqual(progress.summary.label, 'In Progress');

    // Test row classification for all 3 faculty
    const row1 = { submission_id: 1, faculty_id: 1, raw_status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-01' };
    const row2 = { submission_id: 2, faculty_id: 2, raw_status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-02' };
    const row3 = { submission_id: null, faculty_id: 3, raw_status: null, submitted_at: null };

    assert.strictEqual(sandbox.classifyWorkflowRow(row1, task), 'approved');
    assert.strictEqual(sandbox.classifyWorkflowRow(row2, task), 'needs_revision');
    assert.strictEqual(sandbox.classifyWorkflowRow(row3, task), 'not_submitted_open', 'Future non-submitter must NOT be null');

    // Overdue task row classification
    const overdueTask = { id: '100', title: 'Midterm Syllabus', deadline_at: '2026-09-01T00:00:00Z' };
    assert.strictEqual(sandbox.classifyWorkflowRow(row3, overdueTask), 'not_submitted_overdue');
});

console.log(`\nAll ${passCount} Phase 1 tests passed successfully!\n`);
