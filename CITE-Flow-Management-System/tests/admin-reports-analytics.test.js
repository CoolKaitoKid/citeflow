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
let failCount = 0;
const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
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

// 7. Cycle deduplication in groupRecurringReportTasks deduplicates duplicate tasks for the same config and reporting period
test('7. Cycle deduplication in groupRecurringReportTasks collapses duplicate tasks for the same cycle without inflating analytics', () => {
    const reportConfigs = [
        { id: 'cfg-dtr', report_name: 'Daily Time Record', frequency: 'monthly' }
    ];

    // Two tasks exist for October 2026 under the same config (simulating race-condition duplicate records)
    const tasks = [
        {
            id: 'dtr-task-1',
            title: 'Daily Time Record — October 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
            reporting_period_start: '2026-10-01',
            reporting_period_end: '2026-10-31',
            deadline_at: '2026-11-25T04:00:00Z',
            due_at: '2026-11-25T04:00:00Z'
        },
        {
            id: 'dtr-task-2',
            title: 'Daily Time Record — October 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
            reporting_period_start: '2026-10-01',
            reporting_period_end: '2026-10-31',
            deadline_at: '2026-11-25T04:00:00Z',
            due_at: '2026-11-25T04:00:00Z'
        }
    ];

    const assignments = [
        { task_id: 'dtr-task-1', faculty_id: 'fac-1' },
        { task_id: 'dtr-task-1', faculty_id: 'fac-2' },
        { task_id: 'dtr-task-2', faculty_id: 'fac-1' },
        { task_id: 'dtr-task-2', faculty_id: 'fac-2' }
    ];

    const submissions = [
        { id: 'sub-1', task_id: 'dtr-task-1', faculty_id: 'fac-1', status: 'submitted', submitted_at: '2026-10-15T08:00:00Z' }
    ];

    const now = new Date('2026-10-16T12:00:00Z').getTime();

    const groups = wf.groupRecurringReportTasks(tasks, reportConfigs, { submissions, assignments });
    assert.strictEqual(groups.length, 1, 'Only one group exists');
    assert.strictEqual(groups[0].cycles.length, 1, 'Group cycles must contain exactly 1 cycle (not 2 duplicate cards)');

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, reportConfigs, { now });
    assert.strictEqual(result.overallCounts.expected, 2, 'Expected faculty must be 2, not doubled to 4');
    assert.strictEqual(result.overallCounts.submitted, 1, 'Submitted must be 1, not doubled');
    assert.strictEqual(result.overallCounts.not_submitted, 1, 'Not submitted must be 1, not doubled');
    assert.ok(result.overallBalances.coverageMatchesExpected, 'Coverage balance matches expected');
});

// 8. Duplicate prevention covers all recurring report types (Monthly DTR, Quarterly MFO, Semi-Annual Syllabus, Annual IPCR)
test('8. Duplicate prevention covers all recurring report types (DTR, MFO, Syllabus, IPCR)', () => {
    const reportConfigs = [
        { id: 'cfg-mfo', report_name: 'Quarterly Faculty MFO Report', frequency: 'quarterly' },
        { id: 'cfg-syl', report_name: 'Course Syllabus Submission', frequency: 'semi_annual' },
        { id: 'cfg-ipc', report_name: 'Individual Performance Commitment and Review', frequency: 'annual' }
    ];

    const tasks = [
        // Duplicate MFO Q3 2026
        { id: 'mfo-1', title: 'MFO — Q3 2026', report_config_id: 'cfg-mfo', is_recurring: true, reporting_period_label: 'Q3 2026', generated_for_period: 'cfg-mfo:2026-07-01:2026-09-30', due_at: '2026-10-15T12:00:00Z' },
        { id: 'mfo-2', title: 'MFO — Q3 2026', report_config_id: 'cfg-mfo', is_recurring: true, reporting_period_label: 'Q3 2026', generated_for_period: 'cfg-mfo:2026-07-01:2026-09-30', due_at: '2026-10-15T12:00:00Z' },

        // Duplicate Syllabus 1st Semi-Annual 2026
        { id: 'syl-1', title: 'Syllabus — 1st Semi-Annual 2026', report_config_id: 'cfg-syl', is_recurring: true, reporting_period_label: '1st Semi-Annual 2026', generated_for_period: 'cfg-syl:2026-01-01:2026-06-30', due_at: '2026-07-05T12:00:00Z' },
        { id: 'syl-2', title: 'Syllabus — 1st Semi-Annual 2026', report_config_id: 'cfg-syl', is_recurring: true, reporting_period_label: '1st Semi-Annual 2026', generated_for_period: 'cfg-syl:2026-01-01:2026-06-30', due_at: '2026-07-05T12:00:00Z' },

        // Duplicate IPCR Annual 2025
        { id: 'ipc-1', title: 'IPCR — Annual 2025', report_config_id: 'cfg-ipc', is_recurring: true, reporting_period_label: 'Annual 2025', generated_for_period: 'cfg-ipc:2025-01-01:2025-12-31', due_at: '2026-01-15T12:00:00Z' },
        { id: 'ipc-2', title: 'IPCR — Annual 2025', report_config_id: 'cfg-ipc', is_recurring: true, reporting_period_label: 'Annual 2025', generated_for_period: 'cfg-ipc:2025-01-01:2025-12-31', due_at: '2026-01-15T12:00:00Z' }
    ];

    const groups = wf.groupRecurringReportTasks(tasks, reportConfigs);
    assert.strictEqual(groups.length, 3, 'Exactly 3 report groups created');

    const mfoGroup = groups.find(g => g.config_id === 'cfg-mfo');
    assert.ok(mfoGroup, 'MFO group exists');
    assert.strictEqual(mfoGroup.cycles.length, 1, 'MFO duplicate cycles collapsed to 1');

    const sylGroup = groups.find(g => g.config_id === 'cfg-syl');
    assert.ok(sylGroup, 'Syllabus group exists');
    assert.strictEqual(sylGroup.cycles.length, 1, 'Syllabus duplicate cycles collapsed to 1');

    const ipcGroup = groups.find(g => g.config_id === 'cfg-ipc');
    assert.ok(ipcGroup, 'IPCR group exists');
    assert.strictEqual(ipcGroup.cycles.length, 1, 'IPCR duplicate cycles collapsed to 1');
});

// 9. Different reporting periods remain distinct
test('9. Different reporting periods (e.g. Sept 2026 vs Oct 2026) remain legitimately distinct cycles', () => {
    const reportConfigs = [
        { id: 'cfg-dtr', report_name: 'Daily Time Record', frequency: 'monthly' }
    ];

    const tasks = [
        {
            id: 'dtr-sep',
            title: 'DTR — September 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'September 2026',
            generated_for_period: 'cfg-dtr:2026-09-01:2026-09-30',
            due_at: '2026-10-25T04:00:00Z'
        },
        {
            id: 'dtr-oct',
            title: 'DTR — October 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
            due_at: '2026-11-25T04:00:00Z'
        }
    ];

    const groups = wf.groupRecurringReportTasks(tasks, reportConfigs);
    assert.strictEqual(groups.length, 1, 'One group for DTR');
    assert.strictEqual(groups[0].cycles.length, 2, 'September and October must both be preserved as distinct cycles');
    const labels = groups[0].cycles.map(c => c.reporting_period_label);
    assert.ok(labels.includes('September 2026'), 'September cycle is present');
    assert.ok(labels.includes('October 2026'), 'October cycle is present');
});

// 10. Legitimate different configurations and department scopes remain distinct
test('10. Different configurations and department scopes (e.g. BSCS vs BSIT) remain legitimately distinct', () => {
    const reportConfigs = [
        { id: 'cfg-dtr-cs', report_name: 'DTR', frequency: 'monthly', recipient_type: 'department', recipient_department: 'BSCS' },
        { id: 'cfg-dtr-it', report_name: 'DTR', frequency: 'monthly', recipient_type: 'department', recipient_department: 'BSIT' }
    ];

    const tasks = [
        {
            id: 'task-cs-oct',
            title: 'DTR — October 2026',
            report_config_id: 'cfg-dtr-cs',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            assigned_scope: 'department',
            assigned_label: 'BSCS Faculty',
            generated_for_period: 'cfg-dtr-cs:2026-10-01:2026-10-31',
            due_at: '2026-11-25T04:00:00Z'
        },
        {
            id: 'task-it-oct',
            title: 'DTR — October 2026',
            report_config_id: 'cfg-dtr-it',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            assigned_scope: 'department',
            assigned_label: 'BSIT Faculty',
            generated_for_period: 'cfg-dtr-it:2026-10-01:2026-10-31',
            due_at: '2026-11-25T04:00:00Z'
        }
    ];

    const groups = wf.groupRecurringReportTasks(tasks, reportConfigs);
    assert.strictEqual(groups.length, 2, 'Separate department configs produce 2 distinct groups');
    assert.strictEqual(groups[0].cycles.length, 1, 'First department has its own cycle');
    assert.strictEqual(groups[1].cycles.length, 1, 'Second department has its own cycle');
});

// 11. Duplicate tasks with different submission histories are not silently lost
test('11. Duplicate tasks with different submission histories are preserved without loss of submission records', () => {
    const reportConfigs = [
        { id: 'cfg-dtr', report_name: 'DTR', frequency: 'monthly' }
    ];

    const tasks = [
        {
            id: 'dtr-t1',
            title: 'DTR — October 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
            due_at: '2026-11-25T04:00:00Z'
        },
        {
            id: 'dtr-t2',
            title: 'DTR — October 2026',
            report_config_id: 'cfg-dtr',
            is_recurring: true,
            reporting_period_label: 'October 2026',
            generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
            due_at: '2026-11-25T04:00:00Z'
        }
    ];

    // Submissions split across the two tasks: fac-1 submitted on t1, fac-2 submitted on t2
    const assignments = [
        { task_id: 'dtr-t1', faculty_id: 'fac-1' },
        { task_id: 'dtr-t1', faculty_id: 'fac-2' },
        { task_id: 'dtr-t2', faculty_id: 'fac-1' },
        { task_id: 'dtr-t2', faculty_id: 'fac-2' }
    ];

    const submissions = [
        { id: 'sub-t1', task_id: 'dtr-t1', faculty_id: 'fac-1', status: 'submitted', submitted_at: '2026-10-10' },
        { id: 'sub-t2', task_id: 'dtr-t2', faculty_id: 'fac-2', status: 'submitted', submitted_at: '2026-10-11' }
    ];

    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, reportConfigs);

    // Verify exactly 1 cycle in groups
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.groups[0].cycles.length, 1, 'Collapsed into 1 cycle');

    // Verify submissions from both tasks are preserved and counted in analytics
    assert.strictEqual(result.overallCounts.expected, 2, 'Expected 2 faculty members');
    assert.strictEqual(result.overallCounts.submitted, 2, 'Both submissions from t1 and t2 preserved');
    assert.strictEqual(result.overallCounts.not_submitted, 0, '0 not submitted');
    assert.strictEqual(result.overallCounts.pending_review, 2, 'Both pending review');
});

// 12. Integration: generateNextTaskForConfig prevents duplicate task creation on repeated generation in the same session
test('12. generateNextTaskForConfig prevents duplicate task creation on repeated generation in the same session', async () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    let insertedTasks = [];
    let insertedAssignments = [];

    const mockDb = {
        from: (table) => {
            if (table === 'wf_tasks') {
                return {
                    insert: (row) => ({
                        select: () => ({
                            single: async () => {
                                const newTask = { id: `task-gen-${insertedTasks.length + 1}`, ...row };
                                insertedTasks.push(newTask);
                                return { data: newTask, error: null };
                            }
                        })
                    }),
                    select: () => {
                        const run = async () => ({ data: insertedTasks.slice(), error: null });
                        return {
                            eq: run,
                            then: (resolve, reject) => run().then(resolve, reject)
                        };
                    }
                };
            }
            if (table === 'wf_task_assignments') {
                return {
                    insert: async (rows) => {
                        insertedAssignments.push(...(Array.isArray(rows) ? rows : [rows]));
                        return { error: null };
                    },
                    select: () => ({
                        eq: async (_column, taskId) => ({
                            data: insertedAssignments.filter(row => String(row.task_id) === String(taskId)),
                            error: null
                        })
                    })
                };
            }
            if (table === 'wf_activity_log') {
                return { insert: async () => ({ error: null }) };
            }
            return {
                insert: async () => ({ error: null }),
                select: () => ({ single: async () => ({ data: null, error: null }), eq: async () => ({ data: [], error: null }) })
            };
        }
    };

    const config = {
        id: 'cfg-monthly-dtr',
        report_name: 'DTR',
        frequency: 'monthly',
        due_day: 25,
        due_time: '12:00:00',
        recipient_type: 'all',
        is_active: true
    };

    const state = {
        faculty: [{ id: 'fac-1', full_name: 'Dr. Test', status: 'Active', access_enabled: true }],
        tasks: [],
        assignments: [],
        submissions: [],
        submissionFiles: [],
        reportConfigs: [config]
    };

    const sandbox = {
        window: {
            CiteFlowWorkflow: wf,
            workflowState: state,
            supabaseClient: mockDb,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        supabase: mockDb,
        supabaseClient: mockDb,
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        workflowState: state,
        db: mockDb,
        ADMIN_NAME: 'Admin User',
        showToast: () => {},
        createNotification: async () => {},
        applyConfigToExistingRecurringTask: async () => false,
        updateRecurringTaskRow: async () => true,
        reportRecipientLabel: () => 'All Faculty',
        recurringRequirementText: () => 'Submit DTR',
        formatTaskCategoryLabel: () => 'DTR',
        normalizeText: (v) => String(v || '').trim().toLowerCase(),
        makeManilaIso: (y, m, d, t) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${t || '12:00:00'}+08:00`,
        manilaNow: () => new Date('2026-10-28T12:00:00Z'),
        Date: Date,
        Math: Math,
        console: console
    };

    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);

    // Extract scripts from workflow-approval.html
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const code = match[1];
        if (code.includes('function generateNextTaskForConfig') ||
            code.includes('function getPeriodForNextTask') ||
            code.includes('function buildRecurringTaskFields') ||
            code.includes('function getRecipientFaculty')) {
            vm.runInContext(code, sandbox);
        }
    }

    const toasts = [];
    sandbox.showToast = (message) => { toasts.push(String(message || '')); };
    sandbox.createNotification = async () => {};

    assert.strictEqual(typeof sandbox.generateNextTaskForConfig, 'function', 'generateNextTaskForConfig must be a function');

    const [first, second] = await Promise.all([
        sandbox.generateNextTaskForConfig(config, false),
        sandbox.generateNextTaskForConfig(config, false)
    ]);
    assert.ok(first && second, 'Overlapping calls in this page share one generation');
    assert.strictEqual(insertedTasks.length, 1, 'Exactly 1 task inserted into database');
    assert.strictEqual(first.id, second.id, 'Concurrent calls return the same task');
    assert.strictEqual(insertedAssignments.length, 1, 'The new task receives its assignments once');

    const task2 = await sandbox.generateNextTaskForConfig(config, true);
    assert.strictEqual(task2, null, 'The same report and period is blocked');
    assert.strictEqual(insertedTasks.length, 1, 'Task count in DB must remain 1 (no duplicate generated)');
    assert.strictEqual(insertedAssignments.length, 1, 'A blocked report does not insert assignments');
    assert.ok(toasts.some(message => /already exists for /i.test(message)), 'The duplicate popup is shown');
});

function duplicateCycleTask(id, extra = {}) {
    return {
        id,
        title: 'Daily Time Record — October 2026',
        report_config_id: 'cfg-dtr',
        is_recurring: true,
        generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31',
        reporting_period_start: '2026-10-01',
        reporting_period_end: '2026-10-31',
        reporting_period_label: 'October 2026',
        deadline_at: '2026-11-25T04:00:00Z',
        due_at: '2026-11-25T04:00:00Z',
        ...extra
    };
}

const duplicateCycleConfigs = [
    { id: 'cfg-dtr', report_name: 'Daily Time Record', frequency: 'monthly' }
];

test('13. Conflicting period keys, missing config ids, blank scopes, and labels stay separate', () => {
    const sameDatesDifferentKeys = [
        duplicateCycleTask('key-a', { generated_for_period: 'cfg-dtr:2026-10-01:2026-10-31' }),
        duplicateCycleTask('key-b', { generated_for_period: 'cfg-dtr:second-cutoff' })
    ];
    assert.strictEqual(wf.isSameLogicalRecurringCycle(sameDatesDifferentKeys[0], sameDatesDifferentKeys[1]), false);
    assert.strictEqual(
        wf.groupRecurringReportTasks(sameDatesDifferentKeys, duplicateCycleConfigs)[0].cycles.length,
        2,
        'Matching dates must not override conflicting generated_for_period values'
    );

    const labelOnly = [
        duplicateCycleTask('label-a', {
            generated_for_period: '',
            reporting_period_start: '',
            reporting_period_end: '',
            reporting_period_label: 'October 2026'
        }),
        duplicateCycleTask('label-b', {
            generated_for_period: '',
            reporting_period_start: '',
            reporting_period_end: '',
            reporting_period_label: 'October 2026'
        })
    ];
    assert.strictEqual(wf.isSameLogicalRecurringCycle(labelOnly[0], labelOnly[1]), false, 'Period label alone is not identity');

    const missingConfig = [
        duplicateCycleTask('no-cfg-a', { report_config_id: null, title: 'DTR — October 2026' }),
        duplicateCycleTask('no-cfg-b', { report_config_id: '', title: 'DTR — October 2026' })
    ];
    const missingGroups = wf.groupRecurringReportTasks(missingConfig, duplicateCycleConfigs);
    assert.strictEqual(
        missingGroups.reduce((sum, group) => sum + group.cycles.length, 0),
        2,
        'Tasks without configuration ids stay separate'
    );

    const blankScope = duplicateCycleTask('blank-scope', { assigned_scope: '', assigned_label: 'BSCS Faculty' });
    const departmentScope = duplicateCycleTask('dept-scope', { assigned_scope: 'department', assigned_label: 'BSCS Faculty' });
    const otherDepartment = duplicateCycleTask('dept-other', { assigned_scope: 'department', assigned_label: 'BSIT Faculty' });
    const roleScope = duplicateCycleTask('role-scope', { assigned_scope: 'role', assigned_label: 'Chairperson' });
    const facultyScope = duplicateCycleTask('faculty-scope', { assigned_scope: 'faculty', assigned_label: 'Chairperson' });
    assert.strictEqual(wf.isSameLogicalRecurringCycle(blankScope, departmentScope), false, 'Blank scope does not match a department scope');
    assert.strictEqual(wf.isSameLogicalRecurringCycle(departmentScope, otherDepartment), false, 'Different department labels stay separate');
    assert.strictEqual(wf.isSameLogicalRecurringCycle(roleScope, facultyScope), false, 'Role and faculty scopes stay separate');

    const september = duplicateCycleTask('sep', { generated_for_period: 'cfg-dtr:2026-09-01:2026-09-30', reporting_period_label: 'September 2026' });
    const october = duplicateCycleTask('oct');
    assert.strictEqual(wf.isSameLogicalRecurringCycle(september, october), false, 'Different reporting periods stay separate');
});

test('14. Repeated grouping rebuilds linked ids and does not keep removed tasks', () => {
    const taskA = duplicateCycleTask('again-a', { linked_task_ids: ['again-a', 'stale-id'] });
    const taskB = duplicateCycleTask('again-b');
    const first = wf.groupRecurringReportTasks([taskA, taskB], duplicateCycleConfigs);
    assert.strictEqual(first[0].cycles.length, 1);
    assert.deepStrictEqual(first[0].cycles[0].linked_task_ids.map(String).sort(), ['again-a', 'again-b']);
    assert.deepStrictEqual(taskA.linked_task_ids, ['again-a', 'stale-id'], 'Input task keeps its original linked ids');

    const second = wf.groupRecurringReportTasks([taskA], duplicateCycleConfigs);
    assert.deepStrictEqual(second[0].cycles[0].linked_task_ids.map(String), ['again-a']);
});

test('15. Split submissions keep their task ids, and the same faculty on two tasks stays separate', () => {
    const tasks = [duplicateCycleTask('own-1'), duplicateCycleTask('own-2')];
    const assignments = [
        { task_id: 'own-1', faculty_id: 'fac-1' },
        { task_id: 'own-1', faculty_id: 'fac-2' },
        { task_id: 'own-2', faculty_id: 'fac-1' },
        { task_id: 'own-2', faculty_id: 'fac-2' },
        { task_id: 'own-2', faculty_id: 'fac-3' }
    ];
    const submissions = [
        { id: 'sub-own-1', task_id: 'own-1', faculty_id: 'fac-1', status: 'submitted', submitted_at: '2026-10-10' },
        { id: 'sub-own-2', task_id: 'own-2', faculty_id: 'fac-2', status: 'submitted', submitted_at: '2026-10-11' }
    ];
    const result = wf.computeRecurringReportAnalytics(tasks, assignments, submissions, duplicateCycleConfigs);
    assert.strictEqual(result.groups[0].cycles.length, 1);
    const records = result.cycleAnalyticsMap.get('own-1').assignedRecords;
    const fac1 = records.find(record => record.faculty_id === 'fac-1');
    const fac2 = records.find(record => record.faculty_id === 'fac-2');
    const fac3 = records.find(record => record.faculty_id === 'fac-3');
    assert.strictEqual(String(fac1.submission.source_task_id), 'own-1');
    assert.strictEqual(String(fac1.submission.id), 'sub-own-1');
    assert.strictEqual(String(wf.resolveLinkedRecordTaskId(fac1, result.groups[0].cycles[0])), 'own-1');
    assert.strictEqual(String(fac2.submission.source_task_id), 'own-2');
    assert.strictEqual(String(wf.resolveLinkedRecordTaskId(fac2, result.groups[0].cycles[0])), 'own-2');
    assert.strictEqual(String(fac3.source_task_id), 'own-2');
    assert.strictEqual(String(wf.resolveLinkedRecordTaskId(fac3, result.groups[0].cycles[0])), 'own-2');
    assert.strictEqual(result.overallCounts.expected, 3, 'Faculty are counted once across the linked tasks');
    assert.strictEqual(result.overallCounts.submitted, 2);

    const duplicatedFaculty = [
        duplicateCycleTask('dup-fac-1'),
        duplicateCycleTask('dup-fac-2')
    ];
    const duplicatedSubs = [
        { id: 'sub-a', task_id: 'dup-fac-1', faculty_id: 'fac-1', status: 'submitted', submitted_at: '2026-10-10' },
        { id: 'sub-b', task_id: 'dup-fac-2', faculty_id: 'fac-1', status: 'approved', submitted_at: '2026-10-12' }
    ];
    const separate = wf.groupRecurringReportTasks(duplicatedFaculty, duplicateCycleConfigs, { submissions: duplicatedSubs });
    assert.strictEqual(separate[0].cycles.length, 2, 'Same faculty with submissions on two tasks stays on two cycles');
    assert.deepStrictEqual(separate[0].cycles.map(cycle => cycle.linked_task_ids.map(String)), [['dup-fac-1'], ['dup-fac-2']]);
});

test('16. Admin report rows open the task that owns the faculty submission', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
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
            { id: 'fac-2', full_name: 'Prof. Gomez', department_code: 'BSIE' },
            { id: 'fac-3', full_name: 'Ms. Cruz', department_code: 'BSIT' }
        ],
        tasks: [duplicateCycleTask('own-1'), duplicateCycleTask('own-2')],
        assignments: [
            { task_id: 'own-1', faculty_id: 'fac-1' },
            { task_id: 'own-1', faculty_id: 'fac-2' },
            { task_id: 'own-2', faculty_id: 'fac-2' },
            { task_id: 'own-2', faculty_id: 'fac-3' }
        ],
        submissions: [
            { id: 'sub-own-1', task_id: 'own-1', faculty_id: 'fac-1', status: 'submitted', submitted_at: '2026-10-10T08:00:00Z' },
            { id: 'sub-own-2', task_id: 'own-2', faculty_id: 'fac-2', status: 'submitted', submitted_at: '2026-10-11T08:00:00Z' }
        ],
        submissionFiles: [],
        reportConfigs: duplicateCycleConfigs
    };
    const sandbox = {
        window: { CiteFlowWorkflow: wf, workflowFileActionCache: {}, workflowState: state, addEventListener: () => {}, removeEventListener: () => {} },
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
        Date, Math, console
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const code = match[1];
        if (code.includes('function renderReportSubmissions') || code.includes('function getFacultyById')) {
            vm.runInContext(code, sandbox);
        }
    }
    sandbox.renderReportSubmissions();
    const tableHtml = mockElements.reportsSubmissionsTableBody.innerHTML;
    assert.ok(tableHtml.includes("openReviewModal('own-1', 'fac-1')"), 'Review for faculty 1 uses task own-1');
    assert.ok(tableHtml.includes("openReviewModal('own-2', 'fac-2')"), 'Review for faculty 2 uses task own-2');
    assert.ok(
        tableHtml.includes("openTaskDetailsPage('own-2', { focusFacultyId: 'fac-3' })"),
        'Details for the faculty assigned only on own-2 uses own-2'
    );
    assert.ok(tableHtml.includes("openAnalyticsModal('own-1')"), 'Analytics is offered for the first linked task');
    assert.ok(tableHtml.includes("openAnalyticsModal('own-2')"), 'Analytics is offered for the second linked task');
    assert.ok(tableHtml.includes("openTaskDetailsPage('own-1')"), 'Details is offered for the first linked task');
});

function bootRecurringGeneration(state, bag) {
    const insertedTasks = [];
    const payloads = [];
    const toasts = [];
    const deletedIds = [];
    const assignmentRows = [];
    let insertSequence = 0;
    const mockDb = {
        from(table) {
            if (table === 'wf_tasks') {
                return {
                    insert(row) {
                        return {
                            select() {
                                return {
                                    async single() {
                                        payloads.push({ ...row });
                                        if (bag.insertErrors && bag.insertErrors.length) {
                                            return { data: null, error: { message: bag.insertErrors.shift() } };
                                        }
                                        const newTask = { id: `task-gen-${++insertSequence}`, ...row };
                                        insertedTasks.push(newTask);
                                        return { data: newTask, error: null };
                                    }
                                };
                            }
                        };
                    },
                    select() {
                        const run = async () => {
                            if (bag.lookupError) return { data: null, error: { message: bag.lookupError } };
                            const remote = Array.isArray(bag.remoteTasks) ? bag.remoteTasks : [];
                            return { data: remote.concat(insertedTasks), error: null };
                        };
                        return {
                            eq: (...args) => run(...args),
                            then: (resolve, reject) => run().then(resolve, reject)
                        };
                    },
                    delete() {
                        return {
                            async eq(_column, id) {
                                deletedIds.push(id);
                                if (bag.deleteError) return { error: { message: bag.deleteError } };
                                const index = insertedTasks.findIndex(task => String(task.id) === String(id));
                                if (index >= 0) insertedTasks.splice(index, 1);
                                return { error: null };
                            }
                        };
                    }
                };
            }
            if (table === 'wf_task_assignments') {
                return {
                    async insert(rows) {
                        if (bag.assignmentError) return { error: { message: bag.assignmentError } };
                        const list = Array.isArray(rows) ? rows : [rows];
                        assignmentRows.push(...list.map(row => ({ ...row })));
                        return { error: null };
                    },
                    select() {
                        return {
                            async eq(_column, taskId) {
                                if (bag.assignmentLookupError) {
                                    return { data: null, error: { message: bag.assignmentLookupError } };
                                }
                                const seeded = (state.assignments || []).filter(row => String(row.task_id) === String(taskId));
                                const stored = assignmentRows.filter(row => String(row.task_id) === String(taskId));
                                const seen = new Set();
                                const data = [];
                                [...seeded, ...stored].forEach(row => {
                                    const key = String(row.faculty_id);
                                    if (seen.has(key)) return;
                                    seen.add(key);
                                    data.push(row);
                                });
                                return { data, error: null };
                            }
                        };
                    }
                };
            }
            if (table === 'wf_activity_log') return { insert: async () => ({ error: null }) };
            return {
                insert: async () => ({ error: null }),
                select: () => ({ single: async () => ({ data: null, error: null }), eq: async () => ({ data: [], error: null }) })
            };
        }
    };
    const sandbox = {
        window: { CiteFlowWorkflow: wf, workflowState: state, supabaseClient: mockDb, addEventListener: () => {}, removeEventListener: () => {} },
        supabase: mockDb,
        supabaseClient: mockDb,
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        workflowState: state,
        db: mockDb,
        ADMIN_NAME: 'Admin User',
        showToast: (message) => { toasts.push(String(message || '')); },
        createNotification: async () => {},
        applyConfigToExistingRecurringTask: async () => false,
        updateRecurringTaskRow: async () => true,
        reportRecipientLabel: () => 'All Faculty',
        recurringRequirementText: () => 'Submit DTR',
        formatTaskCategoryLabel: () => 'DTR',
        normalizeText: (value) => String(value || '').trim().toLowerCase(),
        makeManilaIso: (year, month, day, time) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time || '12:00:00'}+08:00`,
        manilaNow: () => new Date('2026-10-28T12:00:00Z'),
        Date, Math, console
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'admin', 'workflow-approval.html'), 'utf8');
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const code = match[1];
        if (code.includes('function generateNextTaskForConfig') ||
            code.includes('function getPeriodForNextTask') ||
            code.includes('function buildRecurringTaskFields') ||
            code.includes('function getRecipientFaculty')) {
            vm.runInContext(code, sandbox);
        }
    }
    sandbox.showToast = (message) => { toasts.push(String(message || '')); };
    sandbox.createNotification = async () => {};
    return { sandbox, insertedTasks, payloads, toasts, deletedIds, assignmentRows };
}

test('17. Generation lookup failures, conflicting keys, column fallback, and assignment rollback', async () => {
    const config = {
        id: 'cfg-monthly-dtr',
        report_name: 'DTR',
        frequency: 'monthly',
        due_day: 25,
        due_time: '12:00:00',
        recipient_type: 'all',
        is_active: true,
        submission_method: 'file',
        submission_url: 'https://example.test/upload',
        submission_instructions: 'Upload the file'
    };
    const faculty = [{ id: 'fac-1', full_name: 'Dr. Test', status: 'Active', access_enabled: true }];

    const failedLookup = bootRecurringGeneration({
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    }, { lookupError: "Could not find the 'report_config_id' column of 'wf_tasks' in the schema cache", insertErrors: [] });
    const blocked = await failedLookup.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(blocked, null, 'A failed lookup does not create a task');
    assert.strictEqual(failedLookup.insertedTasks.length, 0);
    assert.ok(failedLookup.toasts.some(message => /existing recurring task/i.test(message)), 'Lookup failure is reported');

    const conflictBag = { insertErrors: [] };
    const conflictState = {
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    };
    const conflictRun = bootRecurringGeneration(conflictState, conflictBag);
    const period = conflictRun.sandbox.getPeriodForNextTask(config);
    const conflicting = {
        id: 'existing-other',
        report_config_id: config.id,
        title: 'Keep me',
        generated_for_period: 'cfg-monthly-dtr:different-cycle',
        reporting_period_start: period.periodStart,
        reporting_period_end: period.periodEnd,
        reporting_period_label: period.label,
        due_at: period.deadlineAt,
        deadline_at: period.deadlineAt
    };
    conflictState.tasks.push(conflicting);
    assert.strictEqual(conflictRun.sandbox.taskMatchesReportingCycle(conflicting, config, period), false);
    const created = await conflictRun.sandbox.generateNextTaskForConfig(config, true);
    assert.strictEqual(created, null, 'The same dates are the same reporting period even when the stored key differs');
    assert.strictEqual(conflicting.title, 'Keep me', 'The existing cycle is not rewritten');
    assert.strictEqual(conflictRun.insertedTasks.length, 0, 'No second task is inserted');
    assert.strictEqual(conflictRun.assignmentRows.length, 0, 'No assignments are inserted for the duplicate');
    assert.ok(conflictRun.toasts.some(message => message === `This report already exists for ${period.label}.`));

    const nextMonth = {
        id: 'next-month',
        report_config_id: config.id,
        title: 'DTR — Later',
        is_recurring: true,
        generated_for_period: `${config.id}:1999-01-01:1999-01-31`,
        reporting_period_start: '1999-01-01',
        reporting_period_end: '1999-01-31',
        reporting_period_label: 'January 1999',
        assigned_scope: 'all'
    };
    const laterState = {
        faculty, tasks: [nextMonth], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    };
    const laterRun = bootRecurringGeneration(laterState, { insertErrors: [] });
    const later = await laterRun.sandbox.generateNextTaskForConfig(config, false);
    assert.ok(later, 'A different reporting period is still generated');
    assert.notStrictEqual(later.id, nextMonth.id);
    assert.strictEqual(nextMonth.title, 'DTR — Later');

    const legacyBag = { insertErrors: [] };
    const legacyState = {
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    };
    const legacyRun = bootRecurringGeneration(legacyState, legacyBag);
    const legacyPeriod = legacyRun.sandbox.getPeriodForNextTask(config);
    legacyState.tasks.push({
        id: 'legacy-row',
        report_config_id: config.id,
        title: 'DTR — October 2026',
        is_recurring: true,
        generated_for_period: '',
        reporting_period_start: legacyPeriod.periodStart,
        reporting_period_end: legacyPeriod.periodEnd,
        reporting_period_label: legacyPeriod.label,
        assigned_scope: 'all'
    });
    const legacyResult = await legacyRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(legacyResult, null, 'A row with the same bounds blocks another task');
    assert.strictEqual(legacyRun.insertedTasks.length, 0, 'That row is not duplicated');
    assert.strictEqual(legacyRun.assignmentRows.length, 0);

    const columnBag = {
        insertErrors: ["Could not find the 'submission_url' column of 'wf_tasks' in the schema cache"]
    };
    const columnRun = bootRecurringGeneration({
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    }, columnBag);
    const columnTask = await columnRun.sandbox.generateNextTaskForConfig(config, false);
    assert.ok(columnTask);
    assert.strictEqual(columnRun.payloads.length, 2);
    assert.ok(!Object.prototype.hasOwnProperty.call(columnRun.payloads[1], 'submission_url'));
    assert.strictEqual(columnRun.payloads[1].report_config_id, config.id);
    assert.ok(columnRun.payloads[1].generated_for_period);
    assert.ok(columnRun.payloads[1].reporting_period_start);
    assert.ok(columnRun.payloads[1].deadline_at);

    const cleanupBag = { insertErrors: [], assignmentError: 'assignment failed', deleteError: 'delete blocked' };
    const cleanupState = {
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    };
    const cleanupRun = bootRecurringGeneration(cleanupState, cleanupBag);
    const cleanupResult = await cleanupRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(cleanupResult, null);
    assert.deepStrictEqual(cleanupRun.deletedIds, ['task-gen-1']);
    const leftover = cleanupState.tasks.find(task => task.id === 'task-gen-1');
    assert.ok(leftover, 'Failed cleanup leaves the database row visible in memory');
    assert.strictEqual(leftover.recurring_assignment_incomplete, true, 'The leftover task is not treated as fully assigned');
    assert.strictEqual(cleanupRun.assignmentRows.length, 0);
    assert.ok(cleanupRun.toasts.some(message => /could not be removed/i.test(message)));
    cleanupBag.assignmentError = null;
    cleanupBag.deleteError = null;
    const repaired = await cleanupRun.sandbox.generateNextTaskForConfig(config, true);
    assert.strictEqual(repaired, null, 'The leftover row blocks another generation');
    assert.strictEqual(cleanupRun.insertedTasks.length, 1, 'The later attempt does not insert a duplicate task');
    assert.strictEqual(cleanupRun.deletedIds.length, 1, 'The later attempt does not delete the existing task');
    assert.strictEqual(cleanupRun.assignmentRows.length, 0, 'The duplicate block does not insert assignments');
    assert.ok(cleanupRun.toasts.some(message => /already exists for /i.test(message)));

    const removedBag = { insertErrors: [], assignmentError: 'assignment failed', deleteError: null };
    const removedState = {
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    };
    const removedRun = bootRecurringGeneration(removedState, removedBag);
    const removedResult = await removedRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(removedResult, null);
    assert.ok(!removedState.tasks.some(task => String(task.id) === 'task-gen-1'));
    assert.ok(removedRun.toasts.some(message => /was removed/i.test(message)));
    removedBag.assignmentError = null;
    const recreated = await removedRun.sandbox.generateNextTaskForConfig(config, false);
    assert.ok(recreated);
    assert.notStrictEqual(recreated.id, 'task-gen-1');
});

test('18. Incomplete assignment cleanup is reported, retried, and does not duplicate a complete task', async () => {
    const config = {
        id: 'cfg-monthly-dtr',
        report_name: 'DTR',
        frequency: 'monthly',
        due_day: 25,
        due_time: '12:00:00',
        recipient_type: 'all',
        is_active: true
    };
    const faculty = [
        { id: 'fac-1', full_name: 'Dr. Test', status: 'Active', access_enabled: true },
        { id: 'fac-2', full_name: 'Dr. Other', status: 'Active', access_enabled: true }
    ];
    const emptyState = () => ({
        faculty, tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [config]
    });

    const removedBag = { assignmentError: 'assignment failed', deleteError: null };
    const removedState = emptyState();
    const removedRun = bootRecurringGeneration(removedState, removedBag);
    const removed = await removedRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(removed, null, 'Assignment failure is not a successful generation');
    assert.strictEqual(removedState.tasks.length, 0, 'Successful cleanup removes the task created by this attempt');
    assert.deepStrictEqual(removedRun.deletedIds, ['task-gen-1']);
    assert.strictEqual(removedRun.assignmentRows.length, 0);
    assert.ok(removedRun.toasts.some(message => /was removed/i.test(message)));

    const stuckBag = { assignmentError: 'assignment failed', deleteError: 'delete blocked' };
    const stuckState = emptyState();
    const stuckRun = bootRecurringGeneration(stuckState, stuckBag);
    const stuck = await stuckRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(stuck, null);
    assert.strictEqual(stuckState.tasks.length, 1);
    assert.strictEqual(stuckState.tasks[0].id, 'task-gen-1');
    assert.strictEqual(stuckState.tasks[0].recurring_assignment_incomplete, true);
    assert.ok(stuckRun.toasts.some(message => /could not be removed/i.test(message)));

    const stillStuck = await stuckRun.sandbox.generateNextTaskForConfig(config, true);
    assert.strictEqual(stillStuck, null, 'The next attempt does not report the existing task as newly generated');
    assert.strictEqual(stuckRun.insertedTasks.length, 1, 'The existing task blocks a second insert');
    assert.deepStrictEqual(stuckRun.deletedIds, ['task-gen-1'], 'An existing task is not deleted');
    assert.strictEqual(stuckRun.assignmentRows.length, 0, 'A duplicate does not receive new assignments');
    assert.ok(stuckRun.toasts.some(message => /already exists for /i.test(message)));

    stuckBag.assignmentError = null;
    const repaired = await stuckRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(repaired, null);
    assert.strictEqual(stuckRun.insertedTasks.length, 1);
    assert.strictEqual(stuckRun.deletedIds.length, 1);
    assert.strictEqual(stuckRun.assignmentRows.length, 0);

    const readyState = emptyState();
    const readyRun = bootRecurringGeneration(readyState, {});
    const period = readyRun.sandbox.getPeriodForNextTask(config);
    readyState.tasks.push({
        id: 'ready-task',
        report_config_id: config.id,
        title: 'Already assigned',
        generated_for_period: period.generatedForPeriod,
        reporting_period_start: period.periodStart,
        reporting_period_end: period.periodEnd
    });
    readyState.assignments.push(
        { task_id: 'ready-task', faculty_id: 'fac-1', assigned_by_name: 'Admin User' },
        { task_id: 'ready-task', faculty_id: 'fac-2', assigned_by_name: 'Admin User' }
    );
    const ready = await readyRun.sandbox.generateNextTaskForConfig(config, true);
    assert.strictEqual(ready, null, 'A matching task blocks another report for that period');
    assert.strictEqual(readyRun.insertedTasks.length, 0);
    assert.strictEqual(readyRun.assignmentRows.length, 0, 'Existing assignments are not inserted again');
    assert.strictEqual(readyRun.deletedIds.length, 0);
    assert.ok(readyRun.toasts.some(message => message === `This report already exists for ${period.label}.`));

    const partialState = emptyState();
    const partialRun = bootRecurringGeneration(partialState, {});
    partialState.tasks.push({
        id: 'partial-task',
        report_config_id: config.id,
        title: 'DTR — partial',
        is_recurring: true,
        generated_for_period: period.generatedForPeriod,
        reporting_period_start: period.periodStart,
        reporting_period_end: period.periodEnd,
        reporting_period_label: period.label,
        assigned_scope: 'all'
    });
    partialState.assignments.push({ task_id: 'partial-task', faculty_id: 'fac-1', assigned_by_name: 'Admin User' });
    const partial = await partialRun.sandbox.generateNextTaskForConfig(config, false);
    assert.strictEqual(partial, null);
    assert.strictEqual(partialRun.insertedTasks.length, 0);
    assert.strictEqual(partialRun.assignmentRows.length, 0, 'A duplicate does not add assignment rows');
    assert.strictEqual(partialRun.deletedIds.length, 0, 'Existing assignments are not deleted');
    assert.ok(partialState.assignments.some(row => String(row.faculty_id) === 'fac-1'));
});

test('19. Duplicate recurring reports are blocked by type, period, and scope', async () => {
    const dtr = {
        id: 'cfg-dtr',
        report_name: 'DTR',
        frequency: 'monthly',
        due_day: 25,
        due_time: '12:00:00',
        recipient_type: 'all',
        is_active: true
    };
    const probe = bootRecurringGeneration({
        faculty: [], tasks: [], assignments: [], submissions: [], submissionFiles: [], reportConfigs: [dtr]
    }, {});
    const period = probe.sandbox.getPeriodForNextTask(dtr);
    const dtrCopy = { ...dtr, id: 'cfg-dtr-copy', report_name: 'Daily Time Record' };
    const mfo = { ...dtr, id: 'cfg-mfo', report_name: 'MFO' };
    const it = { ...dtr, id: 'cfg-it', recipient_type: 'department', recipient_department: 'BSIT' };
    const cs = { ...dtr, id: 'cfg-cs', recipient_type: 'department', recipient_department: 'BSCS' };
    const facultyOne = { ...dtr, id: 'cfg-fac-1', recipient_type: 'faculty', selected_faculty_ids: ['fac-1'] };
    const facultyTwo = { ...dtr, id: 'cfg-fac-2', recipient_type: 'faculty', selected_faculty_ids: ['fac-2'] };
    const intentFor = (config) => ({
        ...config,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        label: period.label
    });
    const existing = (extra) => ({
        id: extra.id,
        title: extra.title || 'DTR — October 2026',
        report_config_id: extra.report_config_id,
        is_recurring: true,
        reporting_period_start: extra.reporting_period_start || period.periodStart,
        reporting_period_end: extra.reporting_period_end || period.periodEnd,
        reporting_period_label: extra.reporting_period_label || period.label,
        generated_for_period: extra.generated_for_period || `${extra.report_config_id}:${period.periodStart}:${period.periodEnd}`,
        assigned_scope: extra.assigned_scope || 'all'
    });
    const configs = [dtr, dtrCopy, mfo, it, cs, facultyOne, facultyTwo];

    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(dtr), existing({ id: 'same', report_config_id: dtr.id, title: 'dtr - October 2026' }), configs), true);
    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(dtrCopy), existing({ id: 'copy', report_config_id: dtr.id, title: 'Daily Time Record — October 2026' }), configs), true);
    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(dtr), existing({
        id: 'november',
        report_config_id: dtr.id,
        reporting_period_start: '1999-11-01',
        reporting_period_end: '1999-11-30',
        reporting_period_label: 'November 1999',
        generated_for_period: 'cfg-dtr:1999-11-01:1999-11-30'
    }), configs), false);
    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(mfo), existing({ id: 'dtr-row', report_config_id: dtr.id }), configs), false);
    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(cs), existing({ id: 'it-row', report_config_id: it.id, assigned_scope: 'department' }), configs), false);
    assert.strictEqual(wf.isDuplicateRecurringReport(intentFor(facultyTwo), existing({ id: 'fac-row', report_config_id: facultyOne.id, assigned_scope: 'faculty' }), configs), false);
    assert.strictEqual(wf.isDuplicateRecurringReport(
        { ...intentFor({ ...dtr, id: 'cfg-load', report_name: 'Faculty Load' }) },
        existing({ id: 'load-row', report_config_id: 'cfg-load-2', title: 'Faculty Load — October 2026' }),
        [{ ...dtr, id: 'cfg-load', report_name: 'Faculty Load' }, { ...dtr, id: 'cfg-load-2', report_name: 'Faculty Load' }]
    ), true);

    const faculty = [
        { id: 'fac-1', full_name: 'Dr. Test', status: 'Active', access_enabled: true, department_code: 'BSCS' },
        { id: 'fac-2', full_name: 'Dr. Other', status: 'Active', access_enabled: true, department_code: 'BSIT' }
    ];
    const baseState = (tasks, reportConfigs) => ({
        faculty, tasks, assignments: [], submissions: [], submissionFiles: [], reportConfigs
    });

    const sameRun = bootRecurringGeneration(baseState([
        existing({ id: 'existing-dtr', report_config_id: dtr.id, title: 'DTR — October 2026' })
    ], [dtr]), {});
    const same = await sameRun.sandbox.generateNextTaskForConfig(dtr, true);
    assert.strictEqual(same, null, 'Same report type and period is blocked');
    assert.strictEqual(sameRun.insertedTasks.length, 0);
    assert.strictEqual(sameRun.assignmentRows.length, 0, 'Duplicate detection inserts no assignments');
    assert.ok(sameRun.toasts.some(message => message === `This report already exists for ${period.label}.`));

    const monthRun = bootRecurringGeneration(baseState([
        existing({
            id: 'old-month',
            report_config_id: dtr.id,
            reporting_period_start: '1999-11-01',
            reporting_period_end: '1999-11-30',
            reporting_period_label: 'November 1999',
            generated_for_period: 'cfg-dtr:1999-11-01:1999-11-30'
        })
    ], [dtr]), {});
    const month = await monthRun.sandbox.generateNextTaskForConfig(dtr, false);
    assert.ok(month, 'The same report type is allowed for a different period');
    assert.strictEqual(monthRun.insertedTasks.length, 1);

    const typeRun = bootRecurringGeneration(baseState([
        existing({ id: 'mfo-row', report_config_id: mfo.id, title: 'MFO — October 2026' })
    ], [dtr, mfo]), {});
    const otherType = await typeRun.sandbox.generateNextTaskForConfig(dtr, false);
    assert.ok(otherType, 'A different report type is allowed for the same period');
    assert.strictEqual(typeRun.insertedTasks.length, 1);

    const remote = existing({ id: 'remote-dtr', report_config_id: dtr.id, title: 'Daily Time Record — October 2026' });
    const crossRun = bootRecurringGeneration(baseState([], [dtr, dtrCopy]), { remoteTasks: [remote] });
    const cross = await crossRun.sandbox.generateNextTaskForConfig(dtrCopy, false);
    assert.strictEqual(cross, null, 'Another configuration of the same type, period, and scope is blocked');
    assert.strictEqual(crossRun.insertedTasks.length, 0);
    assert.strictEqual(crossRun.assignmentRows.length, 0);
    assert.ok(crossRun.toasts.some(message => message === `This report already exists for ${period.label}.`));

    const deptRun = bootRecurringGeneration(baseState([
        existing({ id: 'it-task', report_config_id: it.id, assigned_scope: 'department' })
    ], [it, cs]), {});
    const dept = await deptRun.sandbox.generateNextTaskForConfig(cs, false);
    assert.ok(dept, 'The same report and period for another department is allowed');
    assert.strictEqual(deptRun.insertedTasks.length, 1);
    assert.strictEqual(dept.report_config_id, cs.id);

    const failed = bootRecurringGeneration(baseState([], [dtr]), { lookupError: 'lookup down' });
    const failedResult = await failed.sandbox.generateNextTaskForConfig(dtr, false);
    assert.strictEqual(failedResult, null, 'A failed lookup does not create a task');
    assert.strictEqual(failed.insertedTasks.length, 0);
    assert.strictEqual(failed.assignmentRows.length, 0);
    assert.ok(failed.toasts.some(message => /existing recurring task/i.test(message)));
});

(async function runAll() {
    for (const t of tests) {
        try {
            await t.fn();
            console.log(`PASS  ${t.name}`);
            passCount++;
        } catch (err) {
            console.error(`FAIL  ${t.name}`);
            console.error(err);
            failCount++;
            process.exitCode = 1;
        }
    }
    if (failCount > 0) {
        console.log(`\n${passCount} passed, ${failCount} failed.\n`);
        process.exit(1);
    }
    console.log(`\nAll ${passCount} Phase 2 tests passed successfully!\n`);
})();
