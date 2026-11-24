/**
 * Test Suite: CITEFLOW Recurring Report Frequencies & Schedule Options
 *
 * Verifies all 6 recurring report frequency options:
 * 1. Twice a Month (twice_monthly / twice_a_month)
 * 2. Monthly (monthly)
 * 3. Quarterly (quarterly)
 * 4. Semi-Annual (semi_annual)
 * 5. Annual (annual)
 * 6. Custom Schedule (custom)
 *
 * Covers:
 * - Frontend modal frequency options and defaults
 * - JavaScript validation in saveReportConfig()
 * - Twice a month two configurable deadlines, conflict validation, cutoff periods & clamping
 * - Custom schedule milestone parsing, validation, sorting & task generation
 * - Monthly, quarterly, semi-annual, annual period & deadline preservation
 * - Duplicate prevention between cutoffs and cycles
 * - Backward compatibility / metadata fallback when schema columns are not yet present
 * - Shared workflow resolveReportingFrequency() canonical normalization
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(name, fn) {
    tests.push({ name, fn });
}

// Read HTML and extract JS functions for testing in a sandboxed vm
const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Set up mock browser / DOM environment for testing
function createMockEnvironment() {
    const elements = new Map();

    const createMockElement = (id, tagName = 'div', initialProps = {}) => {
        const el = {
            id,
            tagName: tagName.toUpperCase(),
            value: initialProps.value || '',
            textContent: initialProps.textContent || '',
            innerHTML: initialProps.innerHTML || '',
            checked: initialProps.checked !== undefined ? initialProps.checked : true,
            selectedOptions: initialProps.selectedOptions || [],
            children: [],
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) this.classes.add(c);
                        else this.classes.delete(c);
                    } else {
                        if (this.classes.has(c)) this.classes.delete(c);
                        else this.classes.add(c);
                    }
                },
                contains(c) { return this.classes.has(c); }
            },
            querySelectorAll(sel) {
                if (sel.includes('.custom-schedule-row')) {
                    return this.children.filter(c => c.classList && c.classList.contains('custom-schedule-row'));
                }
                return [];
            },
            querySelector(sel) {
                return null;
            },
            appendChild(child) {
                this.children.push(child);
            },
            closest(sel) {
                return this;
            },
            remove() {
                // remove from parent
            }
        };
        elements.set(id, el);
        return el;
    };

    const doc = {
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelectorAll(sel) {
            return [];
        },
        createElement(tagName) {
            return createMockElement(`temp_${Date.now()}_${Math.random()}`, tagName);
        }
    };

    // Default form elements
    createMockElement('reportConfigId', 'input', { value: '' });
    createMockElement('reportName', 'input', { value: 'Faculty Accomplishment' });
    createMockElement('reportCategory', 'select', { value: 'custom' });
    createMockElement('reportDescription', 'textarea', { value: 'Test description' });
    createMockElement('reportFrequency', 'select', { value: 'monthly' });
    createMockElement('reportDueDay', 'input', { value: '5' });
    createMockElement('reportDueTime', 'input', { value: '12:00' });
    createMockElement('reportDueDay1', 'input', { value: '15' });
    createMockElement('reportDueTime1', 'input', { value: '12:00' });
    createMockElement('reportDueDay2', 'input', { value: '30' });
    createMockElement('reportDueTime2', 'input', { value: '12:00' });
    createMockElement('customScheduleList', 'div');
    createMockElement('standardDeadlineFields', 'div');
    createMockElement('twiceMonthDeadlineFields', 'div');
    createMockElement('customScheduleFields', 'div');
    createMockElement('reportDeadlinePreview', 'div');
    createMockElement('reportRecipientType', 'select', { value: 'all' });
    createMockElement('reportRecipientRole', 'input', { value: 'CHAIRPERSON' });
    createMockElement('reportRecipientDepartment', 'select', { value: 'BIT' });
    createMockElement('reportSelectedFaculty', 'select', { selectedOptions: [{ value: '1' }] });
    createMockElement('reportSubmissionMethod', 'select', { value: 'file' });
    createMockElement('reportSubmissionUrl', 'input', { value: '' });
    createMockElement('reportSubmissionInstructions', 'textarea', { value: '' });
    createMockElement('reportFinalApprover', 'select', { value: 'either' });
    createMockElement('reportChairReview', 'input', { checked: true });
    createMockElement('reportFinalReview', 'input', { checked: true });
    createMockElement('reportIsActive', 'input', { checked: true });
    createMockElement('saveReportBtn', 'button');
    createMockElement('saveReportBtnText', 'span');
    createMockElement('reportConfigModalTitle', 'span');
    createMockElement('reportConfigModal', 'div');

    return { doc, elements, createMockElement };
}

// -----------------------------------------------------------------------------
// Test 1: Frontend Dropdown and Modal HTML Options
// -----------------------------------------------------------------------------
registerTest('1. Verify HTML modal contains all 6 required frequency options with canonical values', () => {
    assert(htmlContent.includes('<option value="twice_monthly">Twice a Month</option>'), 'Missing twice_monthly option');
    assert(htmlContent.includes('<option value="monthly"'), 'Missing monthly option');
    assert(htmlContent.includes('<option value="quarterly">Quarterly</option>'), 'Missing quarterly option');
    assert(htmlContent.includes('<option value="semi_annual">Semi-Annual</option>'), 'Missing semi_annual option');
    assert(htmlContent.includes('<option value="annual">Annual</option>'), 'Missing annual option');
    assert(htmlContent.includes('<option value="custom">Custom Schedule</option>'), 'Missing custom option');

    // Frequency filter tabs check
    assert(htmlContent.includes('data-report-freq="twice_monthly"'), 'Missing twice_monthly report frequency filter tab');
    assert(htmlContent.includes('data-report-freq="custom"'), 'Missing custom report frequency filter tab');
    assert(htmlContent.includes('data-frequency="twice_monthly"'), 'Missing twice_monthly config frequency filter tab');
    assert(htmlContent.includes('data-frequency="custom"'), 'Missing custom config frequency filter tab');
});

// -----------------------------------------------------------------------------
// Test 2: Frequency Labels Function
// -----------------------------------------------------------------------------
registerTest('2. reportFrequencyLabel() correctly maps all 6 frequency options and aliases', () => {
    const fnMatch = htmlContent.match(/^([ \t]*)function reportFrequencyLabel\(value\)\s*\{[\s\S]*?\n\1\}/m);
    assert(fnMatch, 'Could not find reportFrequencyLabel in workflow-approval.html');

    const context = {};
    vm.createContext(context);
    vm.runInContext(fnMatch[0], context);
    const { reportFrequencyLabel } = context;

    assert.strictEqual(reportFrequencyLabel('twice_monthly'), 'Twice a Month');
    assert.strictEqual(reportFrequencyLabel('twice_a_month'), 'Twice a Month');
    assert.strictEqual(reportFrequencyLabel('monthly'), 'Monthly');
    assert.strictEqual(reportFrequencyLabel('quarterly'), 'Quarterly');
    assert.strictEqual(reportFrequencyLabel('semi_annual'), 'Semi-Annual');
    assert.strictEqual(reportFrequencyLabel('annual'), 'Annual');
    assert.strictEqual(reportFrequencyLabel('custom'), 'Custom Schedule');
});

// -----------------------------------------------------------------------------
// Test 3: Shared Workflow resolveReportingFrequency
// -----------------------------------------------------------------------------
registerTest('3. Shared workflow resolveReportingFrequency() normalizes all frequency options', () => {
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'twice_monthly' }), 'twice_monthly');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'twice_a_month' }), 'twice_monthly');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'monthly' }), 'monthly');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'quarterly' }), 'quarterly');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'semi_annual' }), 'semi_annual');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'annual' }), 'annual');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'custom' }), 'custom');

    // Detection from keywords in title
    assert.strictEqual(wf.resolveReportingFrequency({ title: 'Daily Time Record (DTR)' }), 'twice_monthly');
    assert.strictEqual(wf.resolveReportingFrequency({ title: '1st Half DTR submission' }), 'twice_monthly');
    assert.strictEqual(wf.resolveReportingFrequency({ title: 'Q1 Accomplishment' }), 'quarterly');
    assert.strictEqual(wf.resolveReportingFrequency({ title: 'IPCR 1st Sem' }), 'semi_annual');
    assert.strictEqual(wf.resolveReportingFrequency({ title: 'Annual Performance Review' }), 'annual');
});

// -----------------------------------------------------------------------------
// Test 4: getPeriodForNextTask - Monthly, Quarterly, Semi-Annual, Annual
// -----------------------------------------------------------------------------
registerTest('4. getPeriodForNextTask preserves monthly, quarterly, semi-annual, annual calculation', () => {
    // Extract getPeriodForNextTask and dependencies from HTML
    const match = htmlContent.match(/(function pad2[\s\S]*?^([ \t]*)function getPeriodForNextTask\(config, now[\s\S]*?\n\2\})/m);
    assert(match, 'Could not extract getPeriodForNextTask');

    const context = {
        escapeHtml: (s) => s,
        formatDateTime: (s) => s
    };
    vm.createContext(context);
    vm.runInContext(match[0], context);
    const { getPeriodForNextTask } = context;

    const baseDate = new Date(2026, 9, 10, 10, 0, 0); // Oct 10, 2026

    // Monthly
    const monthlyPeriod = getPeriodForNextTask({ id: 'cfg_m', frequency: 'monthly', due_day: 5, due_time: '17:00' }, baseDate);
    assert.strictEqual(monthlyPeriod.label, 'October 2026');
    assert.strictEqual(monthlyPeriod.periodStart, '2026-10-01');
    assert.strictEqual(monthlyPeriod.periodEnd, '2026-10-31');
    assert.strictEqual(monthlyPeriod.deadlineAt, '2026-11-05T17:00:00+08:00');

    // Quarterly
    const quarterlyPeriod = getPeriodForNextTask({ id: 'cfg_q', frequency: 'quarterly', due_day: 15, due_time: '12:00' }, baseDate);
    assert.strictEqual(quarterlyPeriod.label, 'Q4 2026');
    assert.strictEqual(quarterlyPeriod.periodStart, '2026-10-01');
    assert.strictEqual(quarterlyPeriod.periodEnd, '2026-12-31');
    assert.strictEqual(quarterlyPeriod.deadlineAt, '2027-01-15T12:00:00+08:00');

    // Semi-Annual
    const semiPeriod = getPeriodForNextTask({ id: 'cfg_s', frequency: 'semi_annual', due_day: 20, due_time: '15:00' }, baseDate);
    assert.strictEqual(semiPeriod.label, '2nd Semi-Annual 2026');
    assert.strictEqual(semiPeriod.periodStart, '2026-07-01');
    assert.strictEqual(semiPeriod.periodEnd, '2026-12-31');
    assert.strictEqual(semiPeriod.deadlineAt, '2027-01-20T15:00:00+08:00');

    // Annual
    const annualPeriod = getPeriodForNextTask({ id: 'cfg_a', frequency: 'annual', due_day: 31, due_time: '23:59' }, baseDate);
    assert.strictEqual(annualPeriod.label, 'Annual 2026');
    assert.strictEqual(annualPeriod.periodStart, '2026-01-01');
    assert.strictEqual(annualPeriod.periodEnd, '2026-12-31');
    assert.strictEqual(annualPeriod.deadlineAt, '2027-01-31T23:59:00+08:00');
});

// -----------------------------------------------------------------------------
// Test 5: getPeriodForNextTask - Twice a Month Cutoff 1 & 2
// -----------------------------------------------------------------------------
registerTest('5. Twice a Month: Cutoff 1 (1st-15th) and Cutoff 2 (16th-End) correct dates, labels & deadlines', () => {
    const match = htmlContent.match(/(function pad2[\s\S]*?^([ \t]*)function getPeriodForNextTask\(config, now[\s\S]*?\n\2\})/m);
    const context = {};
    vm.createContext(context);
    vm.runInContext(match[0], context);
    const { getPeriodForNextTask } = context;

    const config = {
        id: 'cfg_dtr',
        frequency: 'twice_monthly',
        due_day_1: 15,
        due_time_1: '17:00',
        due_day_2: 30,
        due_time_2: '17:00'
    };

    // Before deadline 1: Oct 5, 2026 -> Cutoff 1
    const p1 = getPeriodForNextTask(config, new Date(2026, 9, 5, 10, 0, 0));
    assert.strictEqual(p1.label, '1st Half — October 2026');
    assert.strictEqual(p1.periodStart, '2026-10-01');
    assert.strictEqual(p1.periodEnd, '2026-10-15');
    assert.strictEqual(p1.deadlineAt, '2026-10-15T17:00:00+08:00');
    assert.strictEqual(p1.generatedForPeriod, 'cfg_dtr:2026-10-01:2026-10-15');

    // Between deadline 1 and deadline 2: Oct 18, 2026 -> Cutoff 2
    const p2 = getPeriodForNextTask(config, new Date(2026, 9, 18, 10, 0, 0));
    assert.strictEqual(p2.label, '2nd Half — October 2026');
    assert.strictEqual(p2.periodStart, '2026-10-16');
    assert.strictEqual(p2.periodEnd, '2026-10-31');
    assert.strictEqual(p2.deadlineAt, '2026-10-30T17:00:00+08:00');
    assert.strictEqual(p2.generatedForPeriod, 'cfg_dtr:2026-10-16:2026-10-31');

    // After deadline 2: Oct 31, 2026 -> rolls over to November Cutoff 1
    const p3 = getPeriodForNextTask(config, new Date(2026, 9, 31, 18, 0, 0));
    assert.strictEqual(p3.label, '1st Half — November 2026');
    assert.strictEqual(p3.periodStart, '2026-11-01');
    assert.strictEqual(p3.periodEnd, '2026-11-15');
    assert.strictEqual(p3.deadlineAt, '2026-11-15T17:00:00+08:00');
});

// -----------------------------------------------------------------------------
// Test 6: Twice a Month - Month-Length Clamping (Feb 28/29, Apr 30)
// -----------------------------------------------------------------------------
registerTest('6. Twice a Month: Day clamping for shorter months (Feb 28/29, Apr 30) without throwing', () => {
    const match = htmlContent.match(/(function pad2[\s\S]*?^([ \t]*)function getPeriodForNextTask\(config, now[\s\S]*?\n\2\})/m);
    const context = {};
    vm.createContext(context);
    vm.runInContext(match[0], context);
    const { getPeriodForNextTask } = context;

    const config = {
        id: 'cfg_dtr_clamped',
        frequency: 'twice_monthly',
        due_day_1: 15,
        due_time_1: '12:00',
        due_day_2: 31, // configured as 31st
        due_time_2: '18:00'
    };

    // February 2025 (non-leap year, 28 days) -> deadline 2 should clamp to Feb 28
    const febNonLeap = getPeriodForNextTask(config, new Date(2025, 1, 18));
    assert.strictEqual(febNonLeap.label, '2nd Half — February 2025');
    assert.strictEqual(febNonLeap.periodEnd, '2025-02-28');
    assert.strictEqual(febNonLeap.deadlineAt, '2025-02-28T18:00:00+08:00');

    // February 2028 (leap year, 29 days) -> deadline 2 should clamp to Feb 29
    const febLeap = getPeriodForNextTask(config, new Date(2028, 1, 18));
    assert.strictEqual(febLeap.label, '2nd Half — February 2028');
    assert.strictEqual(febLeap.periodEnd, '2028-02-29');
    assert.strictEqual(febLeap.deadlineAt, '2028-02-29T18:00:00+08:00');

    // April 2026 (30 days) -> deadline 2 should clamp to Apr 30
    const apr = getPeriodForNextTask(config, new Date(2026, 3, 18));
    assert.strictEqual(apr.label, '2nd Half — April 2026');
    assert.strictEqual(apr.periodEnd, '2026-04-30');
    assert.strictEqual(apr.deadlineAt, '2026-04-30T18:00:00+08:00');
});

// -----------------------------------------------------------------------------
// Test 7: Custom Schedule - Multiple Milestones
// -----------------------------------------------------------------------------
registerTest('7. Custom Schedule: multiple milestones with label, date & time calculate correctly', () => {
    const match = htmlContent.match(/(function pad2[\s\S]*?^([ \t]*)function getPeriodForNextTask\(config, now[\s\S]*?\n\2\})/m);
    const context = {};
    vm.createContext(context);
    vm.runInContext(match[0], context);
    const { getPeriodForNextTask } = context;

    const config = {
        id: 'cfg_custom',
        frequency: 'custom',
        custom_schedule: [
            { label: 'Midterm Submission', date: '2026-10-15', time: '17:00' },
            { label: 'Pre-Final Submission', date: '2026-11-20', time: '12:00' },
            { label: 'Final Requirement', date: '2026-12-18', time: '23:59' }
        ]
    };

    // When now is Oct 1 -> upcoming is Midterm
    const p1 = getPeriodForNextTask(config, new Date(2026, 9, 1));
    assert.strictEqual(p1.label, 'Midterm Submission');
    assert.strictEqual(p1.periodEnd, '2026-10-15');
    assert.strictEqual(p1.deadlineAt, '2026-10-15T17:00:00+08:00');

    // When now is Oct 20 (past Midterm) -> upcoming is Pre-Final
    const p2 = getPeriodForNextTask(config, new Date(2026, 9, 20));
    assert.strictEqual(p2.label, 'Pre-Final Submission');
    assert.strictEqual(p2.periodEnd, '2026-11-20');
    assert.strictEqual(p2.deadlineAt, '2026-11-20T12:00:00+08:00');

    // When now is Nov 25 (past Pre-Final) -> upcoming is Final
    const p3 = getPeriodForNextTask(config, new Date(2026, 10, 25));
    assert.strictEqual(p3.label, 'Final Requirement');
    assert.strictEqual(p3.periodEnd, '2026-12-18');
    assert.strictEqual(p3.deadlineAt, '2026-12-18T23:59:00+08:00');
});

// -----------------------------------------------------------------------------
// Test 8: Duplicate Prevention for Twice a Month & Cycles
// -----------------------------------------------------------------------------
registerTest('8. Duplicate prevention ensures Cutoff 1 and Cutoff 2 do NOT collide or overwrite', () => {
    const config = {
        id: 'cfg_dtr_dups',
        report_name: 'Daily Time Record',
        frequency: 'twice_monthly',
        due_day_1: 15,
        due_time_1: '12:00',
        due_day_2: 30,
        due_time_2: '12:00',
        recipient_type: 'all'
    };

    const taskCutoff1 = {
        id: 'task_1',
        report_config_id: config.id,
        title: 'Daily Time Record — 1st Half — October 2026',
        reporting_period_start: '2026-10-01',
        reporting_period_end: '2026-10-15',
        reporting_period_label: '1st Half — October 2026',
        generated_for_period: 'cfg_dtr_dups:2026-10-01:2026-10-15',
        is_recurring: true,
        assigned_scope: 'all'
    };

    const taskCutoff2 = {
        id: 'task_2',
        report_config_id: config.id,
        title: 'Daily Time Record — 2nd Half — October 2026',
        reporting_period_start: '2026-10-16',
        reporting_period_end: '2026-10-31',
        reporting_period_label: '2nd Half — October 2026',
        generated_for_period: 'cfg_dtr_dups:2026-10-16:2026-10-31',
        is_recurring: true,
        assigned_scope: 'all'
    };

    // Intent for Cutoff 2 must NOT be flagged as duplicate of Cutoff 1 task
    const intentCutoff2 = {
        ...config,
        periodStart: '2026-10-16',
        periodEnd: '2026-10-31',
        label: '2nd Half — October 2026',
        generatedForPeriod: 'cfg_dtr_dups:2026-10-16:2026-10-31'
    };
    const isDup = wf.isDuplicateRecurringReport(intentCutoff2, taskCutoff1, [config]);
    assert.strictEqual(isDup, false, 'Cutoff 2 was falsely flagged as duplicate of Cutoff 1');

    // Intent for Cutoff 1 against task Cutoff 1 MUST be flagged as duplicate
    const intentCutoff1 = {
        ...config,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        label: '1st Half — October 2026',
        generatedForPeriod: 'cfg_dtr_dups:2026-10-01:2026-10-15'
    };
    const isDup1 = wf.isDuplicateRecurringReport(intentCutoff1, taskCutoff1, [config]);
    assert.strictEqual(isDup1, true, 'Duplicate Cutoff 1 task was not detected');
});

// -----------------------------------------------------------------------------
// Test 9: Twice a Month Conflict Validation
// -----------------------------------------------------------------------------
registerTest('9. Twice a Month: identical deadline days throw validation conflict error', async () => {
    const env = createMockEnvironment();
    env.elements.get('reportFrequency').value = 'twice_monthly';
    env.elements.get('reportDueDay1').value = '15';
    env.elements.get('reportDueDay2').value = '15'; // CONFLICT

    // Execute saveReportConfig validation
    const fnMatch = htmlContent.match(/^([ \t]*)async function saveReportConfig\(\)[\s\S]*?\n\1\}/m);
    assert(fnMatch, 'Could not find saveReportConfig');

    let notifiedMessage = null;
    const context = {
        document: env.doc,
        ADMIN_NAME: 'Admin Test',
        workflowNotify: (msg) => { notifiedMessage = msg; },
        db: {
            from: () => ({
                insert: () => ({ select: () => ({ single: async () => ({ data: {} }) }) }),
                update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: {} }) }) }) })
            })
        },
        showToast: () => {},
        closeReportConfigModal: () => {},
        fetchAllData: async () => {},
        syncOlderOpenRecurringTasksFromConfig: async () => {},
        activeReportConfigId: null
    };
    vm.createContext(context);
    vm.runInContext(fnMatch[0], context);

    await context.saveReportConfig();
    assert(notifiedMessage && notifiedMessage.includes('identical'), `Expected error notification about identical days, got: ${notifiedMessage}`);
});

// -----------------------------------------------------------------------------
// Test 10: Metadata Fallback when Table Lacks New Columns
// -----------------------------------------------------------------------------
registerTest('10. Metadata fallback embeds schedule in submission_instructions comment and getScheduleConfig extracts it', () => {
    const match = htmlContent.match(/(function lastDayOfMonth[\s\S]*?^([ \t]*)function getScheduleConfig\(config\)[\s\S]*?\n\2\})/m);
    const context = {};
    vm.createContext(context);
    vm.runInContext(match[0], context);
    const { getScheduleConfig } = context;

    // Simulate config stored in legacy table without due_day_2 column, but with embedded JSON comment
    const legacyConfig = {
        id: 'cfg_legacy',
        report_name: 'DTR',
        frequency: 'twice_monthly',
        due_day: 15,
        due_time: '12:00',
        submission_instructions: 'Please attach verified timesheet.\n<!-- CITEFLOW_SCHEDULE:{"frequency":"twice_monthly","due_day_1":15,"due_time_1":"12:00","due_day_2":28,"due_time_2":"17:00","custom_schedule":null} -->'
    };

    const schedule = getScheduleConfig(legacyConfig);
    assert.strictEqual(schedule.due_day_1, 15);
    assert.strictEqual(schedule.due_time_1, '12:00');
    assert.strictEqual(schedule.due_day_2, 28);
    assert.strictEqual(schedule.due_time_2, '17:00');
});

// -----------------------------------------------------------------------------
// Test Runner
// -----------------------------------------------------------------------------
async function runAll() {
    console.log(`\n======================================================`);
    console.log(`RUNNING RECURRING REPORT FREQUENCIES TEST SUITE`);
    console.log(`======================================================\n`);

    for (const t of tests) {
        try {
            await t.fn();
            console.log(`\x1b[32m✔ PASS:\x1b[0m ${t.name}`);
            passCount++;
        } catch (err) {
            console.error(`\x1b[31m✘ FAIL:\x1b[0m ${t.name}`);
            console.error(err);
            failCount++;
        }
    }

    console.log(`\n------------------------------------------------------`);
    console.log(`TOTAL: ${tests.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
    console.log(`------------------------------------------------------\n`);

    if (failCount > 0) {
        process.exit(1);
    }
}

runAll();
