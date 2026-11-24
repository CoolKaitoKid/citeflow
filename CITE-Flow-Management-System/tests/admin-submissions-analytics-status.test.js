/**
 * Test Suite: Admin Submissions and Analytics Status Classification
 * Verifies Scenarios 1 - 8 as defined in the user specifications:
 * 1. Faculty member with no submission for the reporting period -> Not Submitted (never Pending)
 * 2. Faculty member who submitted and is awaiting Chairperson review -> Pending
 * 3. Faculty member approved by Chairperson and awaiting Dean's Office approval -> Pending
 * 4. Faculty member whose submission is fully approved -> Approved
 * 5. Faculty member whose submission was returned for revision -> For Revision
 * 6. Faculty member whose submission was declined -> Declined
 * 7. Faculty member with submissions from a previous reporting period but none for current -> Not Submitted
 * 8. Faculty member with multiple submission history rows -> counts as exactly 1 faculty with latest valid status
 *
 * Invariant Verification:
 * - Total Faculty = Submitted + Not Submitted
 * - Submitted = Pending + Approved + For Revision + Declined
 * - Non-submitted faculty NEVER contribute to Pending, even when overdue.
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

console.log('\n--- ADMIN SUBMISSIONS & ANALYTICS STATUS CLASSIFICATION TESTS ---\n');

// -----------------------------------------------------------------------------
// Scenario 1: Faculty member with no submission for the reporting period
// -----------------------------------------------------------------------------
test('Scenario 1a: Faculty with no submission (future deadline) -> Not Submitted (Open), never Pending', () => {
    const task = { id: 'task-1', title: 'DTR October', deadline_at: '2026-12-31T23:59:59Z' };
    const now = new Date('2026-10-15T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(null, task, null, now);

    assert.strictEqual(result.is_submitted, false);
    assert.strictEqual(result.category, 'not_submitted_open');
    assert.strictEqual(result.review_status, null);
    assert.notStrictEqual(result.review_status, 'pending_review');
    assert.notStrictEqual(result.status_key, 'pending_approval');
});

test('Scenario 1b: Faculty with no submission (overdue deadline) -> Not Submitted (Overdue), never Pending', () => {
    const task = { id: 'task-1', title: 'DTR September', deadline_at: '2026-09-30T23:59:59Z' };
    const now = new Date('2026-10-15T12:00:00Z').getTime();
    const result = wf.classifySubmissionRecord(null, task, null, now);

    assert.strictEqual(result.is_submitted, false);
    assert.strictEqual(result.category, 'not_submitted_overdue');
    assert.strictEqual(result.review_status, null);
    assert.notStrictEqual(result.review_status, 'pending_review');
});

test('Scenario 1c: Placeholder submission with status=notsubmitted -> Not Submitted, never Pending', () => {
    const task = { id: 'task-1', title: 'Syllabus', deadline_at: '2026-09-01T00:00:00Z' };
    const sub = { id: 'sub-ph', task_id: 'task-1', faculty_id: 'fac-1', status: 'notsubmitted', submitted_at: null };
    const now = new Date('2026-10-15T12:00:00Z').getTime();

    assert.strictEqual(wf.isGenuineSubmission(sub), false);
    const result = wf.classifySubmissionRecord(sub, task, null, now);
    assert.strictEqual(result.is_submitted, false);
    assert.strictEqual(result.category, 'not_submitted_overdue');
    assert.strictEqual(result.review_status, null);
});

// -----------------------------------------------------------------------------
// Scenario 2: Faculty who submitted and is awaiting Chairperson review
// -----------------------------------------------------------------------------
test('Scenario 2: Faculty submitted, awaiting Chairperson review -> Pending', () => {
    const task = { id: 'task-2', title: 'IPCR 2026', requires_chairperson_review: true, deadline_at: '2026-12-31' };
    const config = { id: 'cfg-2', requires_chairperson_review: true };
    const sub = {
        id: 'sub-2',
        task_id: 'task-2',
        faculty_id: 'fac-2',
        status: 'submitted',
        approval_stage: 'chairperson',
        submitted_at: '2026-10-10T10:00:00Z'
    };

    assert.strictEqual(wf.isGenuineSubmission(sub), true);
    assert.strictEqual(wf.getWorkflowStage(sub, task, config), 'chairperson_review');

    const result = wf.classifySubmissionRecord(sub, task, config);
    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.review_status, 'pending_review');
    assert.strictEqual(result.category, 'pending_review');
});

// -----------------------------------------------------------------------------
// Scenario 3: Faculty approved by Chairperson, awaiting Dean / Final approval
// -----------------------------------------------------------------------------
test('Scenario 3: Faculty approved by Chairperson, awaiting Dean approval -> Pending', () => {
    const task = { id: 'task-3', title: 'MFO Q3', requires_chairperson_review: true };
    const config = { id: 'cfg-3', requires_chairperson_review: true, requires_final_approval: true };
    const sub = {
        id: 'sub-3',
        task_id: 'task-3',
        faculty_id: 'fac-3',
        status: 'underreview',
        approval_stage: 'final_approver',
        submitted_at: '2026-10-01T10:00:00Z',
        reviewed_by_name: 'Dr. Chairperson',
        reviewed_at: '2026-10-05T14:00:00Z',
        last_reviewed_by_role: 'CHAIRPERSON'
    };

    assert.strictEqual(wf.isFinallyApproved(sub, task, config), false, 'Not finally approved yet');
    assert.strictEqual(wf.getWorkflowStage(sub, task, config), 'final_approval');

    const result = wf.classifySubmissionRecord(sub, task, config);
    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.review_status, 'pending_review');
});

// -----------------------------------------------------------------------------
// Scenario 4: Faculty whose submission is fully approved
// -----------------------------------------------------------------------------
test('Scenario 4: Faculty fully approved -> Approved', () => {
    const task = { id: 'task-4', title: 'DTR', requires_chairperson_review: true };
    const config = { id: 'cfg-4', requires_chairperson_review: true, requires_final_approval: true };
    const sub = {
        id: 'sub-4',
        task_id: 'task-4',
        faculty_id: 'fac-4',
        status: 'approved',
        approval_stage: 'approved',
        submitted_at: '2026-10-01T10:00:00Z',
        final_approved_at: '2026-10-08T15:00:00Z',
        final_approved_by_name: 'Dean Smith'
    };

    assert.strictEqual(wf.isFinallyApproved(sub, task, config), true);
    assert.strictEqual(wf.getWorkflowStage(sub, task, config), 'completed');

    const result = wf.classifySubmissionRecord(sub, task, config);
    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.review_status, 'approved');
    assert.strictEqual(result.category, 'approved');
});

// -----------------------------------------------------------------------------
// Scenario 5: Faculty whose submission was returned for revision
// -----------------------------------------------------------------------------
test('Scenario 5: Faculty returned for revision -> For Revision', () => {
    const task = { id: 'task-5', title: 'Syllabus' };
    const sub = {
        id: 'sub-5',
        task_id: 'task-5',
        faculty_id: 'fac-5',
        status: 'revision',
        approval_stage: 'revision',
        submitted_at: '2026-10-01T10:00:00Z',
        review_remarks: 'Please update Week 4 learning outcomes.'
    };

    assert.strictEqual(wf.isGenuineSubmission(sub), true);
    assert.strictEqual(wf.getWorkflowStage(sub, task, null), 'revision_required');

    const result = wf.classifySubmissionRecord(sub, task, null);
    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.review_status, 'needs_revision');
    assert.strictEqual(result.category, 'needs_revision');
});

// -----------------------------------------------------------------------------
// Scenario 6: Faculty whose submission was declined
// -----------------------------------------------------------------------------
test('Scenario 6: Faculty declined -> Declined', () => {
    const task = { id: 'task-6', title: 'Form E-0' };
    const sub = {
        id: 'sub-6',
        task_id: 'task-6',
        faculty_id: 'fac-6',
        status: 'rejected',
        approval_stage: 'declined',
        submitted_at: '2026-10-01T10:00:00Z',
        review_remarks: 'Incorrect load units.'
    };

    assert.strictEqual(wf.isGenuineSubmission(sub), true);
    assert.strictEqual(wf.getWorkflowStage(sub, task, null), 'rejected');

    const result = wf.classifySubmissionRecord(sub, task, null);
    assert.strictEqual(result.is_submitted, true);
    assert.strictEqual(result.review_status, 'rejected');
    assert.strictEqual(result.category, 'rejected');
});

// -----------------------------------------------------------------------------
// Scenario 7: Previous reporting period submission only -> Not Submitted for current
// -----------------------------------------------------------------------------
test('Scenario 7: Faculty submitted in previous cycle but not current -> Not Submitted for current cycle', () => {
    const currentTask = {
        id: 'task-current',
        title: 'Monthly Report - October 2026',
        reporting_period_label: 'October 2026',
        deadline_at: '2026-10-31T23:59:59Z'
    };
    const previousTask = {
        id: 'task-prev',
        title: 'Monthly Report - September 2026',
        reporting_period_label: 'September 2026',
        deadline_at: '2026-09-30T23:59:59Z'
    };

    const assignments = [
        { task_id: 'task-current', faculty_id: 'fac-7' },
        { task_id: 'task-prev', faculty_id: 'fac-7' }
    ];

    // Faculty 7 submitted ONLY for previousTask
    const submissions = [
        {
            id: 'sub-prev',
            task_id: 'task-prev',
            faculty_id: 'fac-7',
            status: 'approved',
            approval_stage: 'approved',
            submitted_at: '2026-09-25T10:00:00Z'
        }
    ];

    // Compute analytics specifically for the current task
    const analytics = wf.computeSubmissionAnalytics(
        assignments.filter(a => a.task_id === 'task-current'),
        submissions.filter(s => s.task_id === 'task-current'),
        currentTask
    );

    assert.strictEqual(analytics.counts.expected, 1, 'Faculty 7 is expected for current task');
    assert.strictEqual(analytics.counts.submitted, 0, 'Faculty 7 has NOT submitted for current task');
    assert.strictEqual(analytics.counts.not_submitted, 1, 'Faculty 7 is Not Submitted for current task');
    assert.strictEqual(analytics.counts.pending_review, 0, 'Faculty 7 is NOT pending');
});

// -----------------------------------------------------------------------------
// Scenario 8: Multiple submission history rows -> Exactly 1 faculty with latest valid status
// -----------------------------------------------------------------------------
test('Scenario 8: Faculty with multiple submission attempts -> Exactly 1 count with latest valid status', () => {
    const task = { id: 'task-8', deadline_at: '2026-12-31' };
    const assignments = [
        { task_id: 'task-8', faculty_id: 'fac-8' }
    ];

    // Faculty submitted v1 (returned for revision), then submitted v2 (approved)
    const submissions = [
        {
            id: 'sub-v1',
            task_id: 'task-8',
            faculty_id: 'fac-8',
            status: 'revision',
            approval_stage: 'revision',
            created_at: '2026-10-01T10:00:00Z',
            submitted_at: '2026-10-01T10:00:00Z'
        },
        {
            id: 'sub-v2',
            task_id: 'task-8',
            faculty_id: 'fac-8',
            status: 'approved',
            approval_stage: 'approved',
            created_at: '2026-10-05T10:00:00Z',
            submitted_at: '2026-10-05T10:00:00Z'
        }
    ];

    const analytics = wf.computeSubmissionAnalytics(assignments, submissions, task);

    assert.strictEqual(analytics.counts.expected, 1, 'Exactly 1 expected faculty');
    assert.strictEqual(analytics.counts.submitted, 1, 'Exactly 1 submitted count (not inflated to 2)');
    assert.strictEqual(analytics.counts.not_submitted, 0);
    assert.strictEqual(analytics.counts.approved, 1, 'Latest submission status is approved');
    assert.strictEqual(analytics.counts.needs_revision, 0, 'Old revision status is superseded');
    assert.strictEqual(analytics.balances.coverageMatchesExpected, true);
    assert.strictEqual(analytics.balances.exclusiveMatchesSubmitted, true);
});

// -----------------------------------------------------------------------------
// Comprehensive Invariant Verification across all 6 roles & statuses
// -----------------------------------------------------------------------------
test('Mathematical Invariants: Total Faculty = Submitted + Not Submitted across mixed population', () => {
    const task = { id: 'task-mixed', deadline_at: '2026-10-01T00:00:00Z' };
    const assignments = [
        { task_id: 'task-mixed', faculty_id: 'f1' }, // will be Approved
        { task_id: 'task-mixed', faculty_id: 'f2' }, // will be Pending Review
        { task_id: 'task-mixed', faculty_id: 'f3' }, // will be For Revision
        { task_id: 'task-mixed', faculty_id: 'f4' }, // will be Declined
        { task_id: 'task-mixed', faculty_id: 'f5' }, // Not Submitted (Overdue)
        { task_id: 'task-mixed', faculty_id: 'f6' }, // Not Submitted (Overdue)
        { task_id: 'task-mixed', faculty_id: 'f7' }  // Not Submitted (Overdue)
    ];

    const submissions = [
        { id: 1, task_id: 'task-mixed', faculty_id: 'f1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-09-20' },
        { id: 2, task_id: 'task-mixed', faculty_id: 'f2', status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-09-22' },
        { id: 3, task_id: 'task-mixed', faculty_id: 'f3', status: 'revision', approval_stage: 'revision', submitted_at: '2026-09-25' },
        { id: 4, task_id: 'task-mixed', faculty_id: 'f4', status: 'rejected', approval_stage: 'declined', submitted_at: '2026-09-26' }
    ];

    const analytics = wf.computeSubmissionAnalytics(assignments, submissions, task, {
        now: new Date('2026-10-15T00:00:00Z').getTime()
    });

    const c = analytics.counts;

    // Rule: Total Faculty = Submitted + Not Submitted
    assert.strictEqual(c.expected, 7, 'Total Faculty = 7');
    assert.strictEqual(c.submitted, 4, 'Submitted = 4');
    assert.strictEqual(c.not_submitted, 3, 'Not Submitted = 3');
    assert.strictEqual(c.expected, c.submitted + c.not_submitted, 'Total = Submitted + Not Submitted');

    // Rule: Submitted = Pending + Approved + For Revision + Declined
    assert.strictEqual(c.pending_review, 1, 'Pending = 1');
    assert.strictEqual(c.approved, 1, 'Approved = 1');
    assert.strictEqual(c.needs_revision, 1, 'For Revision = 1');
    assert.strictEqual(c.rejected, 1, 'Declined = 1');
    assert.strictEqual(c.submitted, c.pending_review + c.approved + c.needs_revision + c.rejected, 'Submitted breakdown matches perfectly');

    // Rule: Non-submitters must NEVER contribute to Pending
    assert.strictEqual(c.not_submitted, 3);
    assert.strictEqual(c.not_submitted_overdue, 3);
});

// -----------------------------------------------------------------------------
// Admin Submissions page (admin/workflow-approval.html) Integration
// -----------------------------------------------------------------------------
test('admin/workflow-approval.html: computeEffectiveStatus, workflowRowHasSubmission, classifyWorkflowRow, openAnalyticsModal', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const mockModal = { classList: { add() {}, remove() {} } };
    const mockElements = {
        taskAnalyticsModal: mockModal,
        analyticsTitle: { textContent: '' },
        analyticsSubtitle: { textContent: '' },
        analyticsContent: { innerHTML: '' },
        statusDetailsModal: { classList: { add() {}, remove() {} } },
        wfTaskSearch: { value: '' },
        statusFilter: { value: '' },
        deptFilter: { value: '' },
        categoryFilter: { value: '' }
    };

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
            getElementById: (id) => mockElements[id] || null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {},
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} }),
            body: { style: {} }
        },
        workflowState: {
            faculty: [
                { id: '1', full_name: 'Dr. Approved', department_code: 'BSIT' },
                { id: '2', full_name: 'Prof. Pending', department_code: 'BIT' },
                { id: '3', full_name: 'Dr. Revision', department_code: 'BSIE' },
                { id: '4', full_name: 'Prof. Declined', department_code: 'BSIT' },
                { id: '5', full_name: 'Dr. OverdueNonSubmitter', department_code: 'BIT' }
            ],
            assignments: [
                { task_id: 'task-test', faculty_id: '1' },
                { task_id: 'task-test', faculty_id: '2' },
                { task_id: 'task-test', faculty_id: '3' },
                { task_id: 'task-test', faculty_id: '4' },
                { task_id: 'task-test', faculty_id: '5' }
            ],
            submissions: [
                { id: 101, task_id: 'task-test', faculty_id: '1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-01' },
                { id: 102, task_id: 'task-test', faculty_id: '2', status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-10-02' },
                { id: 103, task_id: 'task-test', faculty_id: '3', status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-03' },
                { id: 104, task_id: 'task-test', faculty_id: '4', status: 'rejected', approval_stage: 'declined', submitted_at: '2026-10-04' }
                // Faculty 5 has NO submission
            ],
            submissionFiles: []
        }
    };
    sandbox.window.workflowState = sandbox.workflowState;
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch, 'script tag must exist in workflow-approval.html');
    vm.runInContext(scriptMatch[1], sandbox);

    // Populate tasks and recompute matrix
    const task = { id: 'task-test', title: 'Task Test Matrix', deadline_at: '2026-09-01T00:00:00Z' }; // Overdue task
    vm.runInContext(`workflowState.tasks = [${JSON.stringify(task)}]; recomputeSubmissionMatrix();`, sandbox);

    // Verify matrix rows
    const rows = vm.runInContext('allSubmissions', sandbox).filter(s => s.task_id === 'task-test');
    assert.strictEqual(rows.length, 5, '5 total faculty rows');

    const rowApproved = rows.find(r => r.faculty_id === '1');
    const rowPending = rows.find(r => r.faculty_id === '2');
    const rowRevision = rows.find(r => r.faculty_id === '3');
    const rowDeclined = rows.find(r => r.faculty_id === '4');
    const rowOverdue = rows.find(r => r.faculty_id === '5');

    // 1. Verify workflowRowHasSubmission
    assert.strictEqual(sandbox.workflowRowHasSubmission(rowApproved), true);
    assert.strictEqual(sandbox.workflowRowHasSubmission(rowPending), true);
    assert.strictEqual(sandbox.workflowRowHasSubmission(rowRevision), true);
    assert.strictEqual(sandbox.workflowRowHasSubmission(rowDeclined), true);
    assert.strictEqual(sandbox.workflowRowHasSubmission(rowOverdue), false, 'Non-submitter MUST evaluate to false for hasSubmission');

    // 2. Verify classifyWorkflowRow
    assert.strictEqual(sandbox.classifyWorkflowRow(rowApproved, task), 'approved');
    assert.strictEqual(sandbox.classifyWorkflowRow(rowPending, task), 'pending_approval');
    assert.strictEqual(sandbox.classifyWorkflowRow(rowRevision, task), 'needs_revision');
    assert.strictEqual(sandbox.classifyWorkflowRow(rowDeclined, task), 'rejected');
    assert.strictEqual(sandbox.classifyWorkflowRow(rowOverdue, task), 'not_submitted_overdue', 'Overdue non-submitter MUST be not_submitted_overdue');

    // 3. Verify computeEffectiveStatus
    assert.strictEqual(sandbox.computeEffectiveStatus(task, null), 'notsubmitted', 'Missing submission must return notsubmitted, NEVER late');

    // 4. Verify openAnalyticsModal content and math
    sandbox.openAnalyticsModal('task-test');
    const modalContent = mockElements.analyticsContent.innerHTML;

    assert.ok(modalContent.includes('Total Faculty</div><div class="text-xl font-semibold text-gray-900">5</div>'), 'Total Faculty is 5');
    assert.ok(modalContent.includes('Submitted</div><div class="text-xl font-semibold text-emerald-800">4</div>'), 'Submitted count is 4');
    assert.ok(modalContent.includes('Not Submitted</div><div class="text-xl font-semibold text-slate-800">1</div>'), 'Not Submitted count is 1');
    assert.ok(modalContent.includes('Pending Review</div><div class="text-xl font-semibold text-amber-800">1</div>'), 'Pending Review count is 1');
    assert.ok(modalContent.includes('Approved</div><div class="text-xl font-semibold text-blue-800">1</div>'), 'Approved count is 1');
    assert.ok(modalContent.includes('Revision / Declined</div><div class="text-xl font-semibold text-rose-800">2</div>'), 'Revision/Declined count is 2');

    // 5. Verify Review Result Breakdown
    assert.ok(modalContent.includes('Review Result Breakdown'), 'Review Result Breakdown is rendered');
    assert.ok(modalContent.includes('Pending Review</span><span class="text-gray-500">1 (20%)</span>'), 'Pending is exactly 1 (20% of 5)');
    assert.ok(modalContent.includes('Not Submitted</span><span class="text-gray-500">1 (20%)</span>'), 'Not Submitted is exactly 1 (20% of 5)');
});

console.log(`\nAll ${passCount} Scenarios & Invariant tests passed successfully!\n`);
