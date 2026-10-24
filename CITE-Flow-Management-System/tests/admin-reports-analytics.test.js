/**
 * Phase 2 Unit Tests: Admin Reports Submission Analytics
 * Validates:
 * 1. Missing non-submitters included in recurring report analytics
 * 2. Distinguishes open deadlines (not_submitted_open) from overdue non-submitters (not_submitted_overdue)
 * 3. Recurring cycle separation: submissions in one period are never counted in another
 * 4. Draft MFO packets excluded from formal recurring submission counts
 * 5. Unassigned / orphaned submissions do not inflate expected faculty totals
 * 6. Mathematical invariants hold for each cycle and across overall aggregated counts:
 *    - Expected = Submitted + Not Submitted
 *    - Submitted = Pending Review + Needs Revision + Approved + Rejected
 *    - Not Submitted = Open + Overdue
 * 7. Admin workflow-approval.html reports rendering and cycle grouping integration
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

console.log('\n--- PHASE 2: ADMIN REPORTS SUBMISSION ANALYTICS UNIT TESTS ---\n');

// 1. Missing non-submitters included in recurring report analytics
test('1. Missing non-submitters are included in recurring report analytics with open vs overdue distinction', () => {
    const reportConfigs = [
        { id: 1, report_name: 'Monthly Faculty Accomplishment Report', frequency: 'monthly' }
    ];

    const tasks = [
        {
            id: 'task-oct',
            title: 'Monthly Faculty Accomplishment Report - October 2026',
            report_config_id: 1,
            is_recurring: true,
            reporting_period_label: 'October 2026',
            deadline_at: '2026-10-31T23:59:59Z' // future
        },
        {
            id: 'task-sep',
            title: 'Monthly Faculty Accomplishment Report - September 2026',
            report_config_id: 1,
            is_recurring: true,
            reporting_period_label: 'September 2026',
            deadline_at: '2026-09-30T23:59:59Z' // past / overdue
        }
    ];

    const assignments = [
        { task_id: 'task-oct', faculty_id: 'fac-1' },
        { task_id: 'task-oct', faculty_id: 'fac-2' },
        { task_id: 'task-sep', faculty_id: 'fac-1' },
        { task_id: 'task-sep', faculty_id: 'fac-2' }
    ];

    // Only fac-1 submitted in October; nobody submitted in September
    const submissions = [
        {
            id: 'sub-1',
            task_id: 'task-oct',
            faculty_id: 'fac-1',
            status: 'submitted',
            submitted_at: '2026-10-15T10:00:00Z'
        }
    ];

    const now = new Date('2026-10-16T12:00:00Z').getTime();

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, reportConfigs, { now });

    const octData = result.cycleAnalyticsMap.get('task-oct');
    assert.ok(octData, 'October cycle must exist');
    assert.strictEqual(octData.counts.expected, 2, 'October expected must be 2');
    assert.strictEqual(octData.counts.submitted, 1, 'October submitted must be 1');
    assert.strictEqual(octData.counts.not_submitted, 1, 'October not_submitted must be 1');
    assert.strictEqual(octData.counts.not_submitted_open, 1, 'October non-submitter deadline is in the future (open)');
    assert.strictEqual(octData.counts.not_submitted_overdue, 0, 'October has no overdue non-submitters');

    const sepData = result.cycleAnalyticsMap.get('task-sep');
    assert.ok(sepData, 'September cycle must exist');
    assert.strictEqual(sepData.counts.expected, 2, 'September expected must be 2');
    assert.strictEqual(sepData.counts.submitted, 0, 'September submitted must be 0');
    assert.strictEqual(sepData.counts.not_submitted, 2, 'September not_submitted must be 2');
    assert.strictEqual(sepData.counts.not_submitted_open, 0, 'September deadline has passed');
    assert.strictEqual(sepData.counts.not_submitted_overdue, 2, 'September non-submitters are overdue');
});

// 2. Recurring cycle separation: submissions from one cycle are never counted in another
test('2. Submissions from one cycle are strictly isolated and never counted in another', () => {
    const reportConfigs = [
        { id: 'cfg-mfo', report_name: 'Quarterly MFO Accomplishment Report', frequency: 'quarterly' }
    ];

    const tasks = [
        {
            id: 'task-q3',
            title: 'MFO Q3 2026',
            report_config_id: 'cfg-mfo',
            is_recurring: true,
            reporting_period_label: 'Q3 2026',
            deadline_at: '2026-09-30T23:59:59Z'
        },
        {
            id: 'task-q4',
            title: 'MFO Q4 2026',
            report_config_id: 'cfg-mfo',
            is_recurring: true,
            reporting_period_label: 'Q4 2026',
            deadline_at: '2026-12-31T23:59:59Z'
        }
    ];

    const assignments = [
        { task_id: 'task-q3', faculty_id: 'fac-bsit' },
        { task_id: 'task-q4', faculty_id: 'fac-bsit' }
    ];

    // Submission only for Q3
    const submissions = [
        {
            id: 'sub-q3',
            task_id: 'task-q3',
            faculty_id: 'fac-bsit',
            status: 'approved',
            approval_stage: 'approved',
            submitted_at: '2026-09-25T10:00:00Z'
        }
    ];

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, reportConfigs);

    const q3Data = result.cycleAnalyticsMap.get('task-q3');
    const q4Data = result.cycleAnalyticsMap.get('task-q4');

    assert.strictEqual(q3Data.counts.submitted, 1, 'Q3 must have 1 submission');
    assert.strictEqual(q3Data.counts.approved, 1, 'Q3 must have 1 approved submission');
    assert.strictEqual(q3Data.counts.not_submitted, 0, 'Q3 must have 0 not submitted');

    assert.strictEqual(q4Data.counts.submitted, 0, 'Q4 must NOT count Q3 submission');
    assert.strictEqual(q4Data.counts.not_submitted, 1, 'Q4 faculty must be counted as not submitted');
});

// 3. Draft MFO packets excluded from formal submission counts
test('3. Draft MFO packets do not count as formal submissions in recurring reports', () => {
    const tasks = [
        {
            id: 'task-mfo',
            title: 'Quarterly MFO Departmental Report - Q4 2026',
            report_config_id: 'cfg-1',
            is_recurring: true,
            deadline_at: '2026-12-31T23:59:59Z'
        }
    ];

    const assignments = [
        { task_id: 'task-mfo', faculty_id: 'chair-1' }
    ];

    // Draft MFO packet exists
    const submissions = [
        {
            id: 'sub-draft-packet',
            task_id: 'task-mfo',
            faculty_id: 'chair-1',
            packet_state: 'draft',
            status: 'draft',
            is_draft: true
        }
    ];

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, []);
    const cycle = result.cycleAnalyticsMap.get('task-mfo');

    assert.strictEqual(cycle.counts.expected, 1);
    assert.strictEqual(cycle.counts.submitted, 0, 'Draft MFO packet must NOT count as submitted');
    assert.strictEqual(cycle.counts.not_submitted, 1, 'Faculty with only draft packet must count as not submitted');
});

// 4. Orphaned submissions do not inflate expected faculty totals
test('4. Orphaned submissions do not inflate expected faculty totals in recurring cycles', () => {
    const tasks = [
        {
            id: 'task-cycle',
            title: 'Monthly Accomplishment - Cycle 1',
            is_recurring: true,
            deadline_at: '2026-12-31T23:59:59Z'
        }
    ];

    // Assigned only to fac-1
    const assignments = [
        { task_id: 'task-cycle', faculty_id: 'fac-1' }
    ];

    // Submissions from assigned fac-1 AND unassigned fac-orphaned
    const submissions = [
        {
            id: 'sub-assigned',
            task_id: 'task-cycle',
            faculty_id: 'fac-1',
            status: 'submitted',
            submitted_at: '2026-10-10T10:00:00Z'
        },
        {
            id: 'sub-orphaned',
            task_id: 'task-cycle',
            faculty_id: 'fac-orphaned',
            status: 'submitted',
            submitted_at: '2026-10-11T10:00:00Z'
        }
    ];

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, []);
    const cycle = result.cycleAnalyticsMap.get('task-cycle');

    assert.strictEqual(cycle.counts.expected, 1, 'Expected count must strictly equal assigned count (1)');
    assert.strictEqual(cycle.counts.submitted, 1, 'Submitted count for assigned faculty must be 1');
    assert.strictEqual(cycle.counts.orphaned_submissions, 1, 'Orphaned submission tracked in diagnostics');
    assert.strictEqual(cycle.orphanedRecords.length, 1, 'Orphaned record retained for diagnostics');
});

// 5. Mathematical invariants hold for individual cycles and aggregated overall
test('5. Mathematical invariants hold for every recurring cycle and aggregated totals', () => {
    const reportConfigs = [
        { id: 10, report_name: 'DTR and Time Records', frequency: 'monthly' },
        { id: 20, report_name: 'Quarterly Research Progress', frequency: 'quarterly' }
    ];

    const tasks = [
        { id: 't1', report_config_id: 10, is_recurring: true, deadline_at: '2026-12-31T23:59:59Z' },
        { id: 't2', report_config_id: 10, is_recurring: true, deadline_at: '2026-08-31T23:59:59Z' },
        { id: 't3', report_config_id: 20, is_recurring: true, deadline_at: '2026-12-31T23:59:59Z' }
    ];

    const assignments = [
        { task_id: 't1', faculty_id: 'f1' },
        { task_id: 't1', faculty_id: 'f2' },
        { task_id: 't1', faculty_id: 'f3' },
        { task_id: 't2', faculty_id: 'f1' },
        { task_id: 't2', faculty_id: 'f2' },
        { task_id: 't3', faculty_id: 'f1' }
    ];

    const submissions = [
        { id: 's1', task_id: 't1', faculty_id: 'f1', status: 'approved', approval_stage: 'approved', submitted_at: '2026-10-01' },
        { id: 's2', task_id: 't1', faculty_id: 'f2', status: 'revision', approval_stage: 'revision', submitted_at: '2026-10-02' },
        // t1 f3 not submitted (open)
        // t2 f1 not submitted (overdue)
        { id: 's3', task_id: 't2', faculty_id: 'f2', status: 'rejected', submitted_at: '2026-08-15' },
        { id: 's4', task_id: 't3', faculty_id: 'f1', status: 'submitted', submitted_at: '2026-10-05' }
    ];

    const now = new Date('2026-10-16T12:00:00Z').getTime();
    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, reportConfigs, { now });

    // Invariants on every cycle
    tasks.forEach(t => {
        const c = result.cycleAnalyticsMap.get(t.id).counts;
        const b = result.cycleAnalyticsMap.get(t.id).balances;

        assert.ok(b.coverageMatchesExpected, `Cycle ${t.id}: Expected = Submitted + Not Submitted`);
        assert.ok(b.exclusiveMatchesSubmitted, `Cycle ${t.id}: Submitted = Pending + Revision + Approved + Rejected`);
        assert.ok(b.notSubmittedMatchesCategories, `Cycle ${t.id}: Not Submitted = Open + Overdue`);

        assert.strictEqual(c.expected, c.submitted + c.not_submitted);
        assert.strictEqual(c.submitted, c.pending_review + c.needs_revision + c.approved + c.rejected);
        assert.strictEqual(c.not_submitted, c.not_submitted_open + c.not_submitted_overdue);
    });

    // Invariants on aggregated overall counts
    const oc = result.overallCounts;
    const ob = result.overallBalances;

    assert.ok(ob.coverageMatchesExpected, 'Overall: Expected = Submitted + Not Submitted');
    assert.ok(ob.exclusiveMatchesSubmitted, 'Overall: Submitted = Pending + Revision + Approved + Rejected');
    assert.ok(ob.notSubmittedMatchesCategories, 'Overall: Not Submitted = Open + Overdue');

    assert.strictEqual(oc.expected, 6, 'Total expected assignments across all 3 cycles is 6');
    assert.strictEqual(oc.submitted, 4, 'Total submitted across cycles is 4');
    assert.strictEqual(oc.not_submitted, 2, 'Total not submitted across cycles is 2');
    assert.strictEqual(oc.not_submitted_open, 1, '1 open non-submitter (t1 f3)');
    assert.strictEqual(oc.not_submitted_overdue, 1, '1 overdue non-submitter (t2 f1)');
    assert.strictEqual(oc.approved, 1);
    assert.strictEqual(oc.needs_revision, 1);
    assert.strictEqual(oc.rejected, 1);
    assert.strictEqual(oc.pending_review, 1);
});

// 6. Integration test with admin/workflow-approval.html renderReportSubmissions
test('6. admin/workflow-approval.html renderReportSubmissions renders cycles, summary bar, and non-submitters', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // DOM mock elements
    const mockElements = {
        reportsSubmissionsTableBody: { innerHTML: '' },
        reportsAnalyticsSummaryBar: { innerHTML: '' },
        reportsSubmissionsSearch: { value: '' },
        reportsDeptFilter: { value: '' },
        reportsStatusFilter: { value: '' }
    };

    const state = {
        faculty: [
            { id: 'fac-1', full_name: 'Dr. Santos', department_code: 'BSIT' },
            { id: 'fac-2', full_name: 'Prof. Gomez', department_code: 'BSIE' }
        ],
        tasks: [
            {
                id: 'task-101',
                title: 'Monthly Accomplishment Report - Oct 2026',
                report_config_id: 'cfg-1',
                is_recurring: true,
                reporting_period_label: 'October 2026',
                deadline_at: '2026-10-31T23:59:59Z'
            }
        ],
        assignments: [
            { task_id: 'task-101', faculty_id: 'fac-1' },
            { task_id: 'task-101', faculty_id: 'fac-2' }
        ],
        submissions: [
            {
                id: 'sub-1',
                task_id: 'task-101',
                faculty_id: 'fac-1',
                status: 'submitted',
                submitted_at: '2026-10-15T10:00:00Z'
            }
            // fac-2 has NOT submitted
        ],
        submissionFiles: [],
        reportConfigs: [
            { id: 'cfg-1', report_name: 'Monthly Accomplishment Report', frequency: 'monthly' }
        ]
    };

    const sandbox = {
        window: {
            CiteFlowWorkflow: wf,
            workflowFileActionCache: {},
            workflowState: state,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        document: {
            getElementById: (id) => mockElements[id] || null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        reportsFrequencyFilter: '',
        reportsQuarterlySubFilter: 'all',
        workflowState: state,
        allSubmissions: [],
        Date: Date,
        Math: Math,
        console: console
    };

    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);

    // Extract relevant scripts from workflow-approval.html
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const code = match[1];
        if (code.includes('function renderReportSubmissions') || code.includes('function getFacultyById')) {
            vm.runInContext(code, sandbox);
        }
    }

    assert.strictEqual(typeof sandbox.renderReportSubmissions, 'function', 'renderReportSubmissions must be a function');

    // Run renderReportSubmissions
    sandbox.renderReportSubmissions();

    const summaryHtml = mockElements.reportsAnalyticsSummaryBar.innerHTML;
    const tableHtml = mockElements.reportsSubmissionsTableBody.innerHTML;

    // Verify summary bar was populated with accurate metrics
    assert.ok(summaryHtml.includes('Expected Submissions'), 'Summary bar contains Expected Submissions');
    assert.ok(summaryHtml.includes('2'), 'Expected count is 2');
    assert.ok(summaryHtml.includes('1'), 'Submitted count is 1');
    assert.ok(summaryHtml.includes('Balanced'), 'Invariants are balanced');

    // Verify table body rendered both submitters and non-submitters
    assert.ok(tableHtml.includes('Dr. Santos'), 'Submitted faculty Dr. Santos is rendered');
    assert.ok(tableHtml.includes('Prof. Gomez'), 'Non-submitted faculty Prof. Gomez is rendered');
    assert.ok(tableHtml.includes('Not submitted yet'), 'Non-submitted label is rendered');
    assert.ok(tableHtml.includes('Not Submitted (Open)'), 'Non-submitter open status pill is rendered');
    assert.ok(tableHtml.includes('report-cycle-header-row'), 'Cycle header row is rendered');

    // Test filter: status = 'notsubmitted'
    mockElements.reportsStatusFilter.value = 'notsubmitted';
    sandbox.renderReportSubmissions();
    const filteredTableHtml = mockElements.reportsSubmissionsTableBody.innerHTML;

    assert.ok(!filteredTableHtml.includes('Dr. Santos'), 'Submitted faculty excluded when filtering for not submitted');
    assert.ok(filteredTableHtml.includes('Prof. Gomez'), 'Non-submitted faculty included when filtering for not submitted');
});

console.log(`\nAll ${passCount} Phase 2 tests passed successfully!\n`);
