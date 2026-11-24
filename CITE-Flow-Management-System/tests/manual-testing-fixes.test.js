/**
 * CITE-Flow Regression Suite: 4 Manual Testing Fixes
 *
 * Verifies:
 * Issue 1 — Admin MFO Consolidated Report Displays the Correct View
 * Issue 2 — Workflow Approval Shows Accurate Chair Certification & Workflow Statuses
 * Issue 3 — Task Assignment Notification Message Is Role/Context-Aware (Admin Creator vs Faculty Assignee)
 * Issue 4 — Custom Schedule Frequency Visible & Selectable in Admin and Faculty Interfaces
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

// =============================================================================
// ISSUE 1: Admin MFO Consolidated Report Displays the Correct View
// =============================================================================

registerTest('Issue 1.1: faculty-nav.js mounts admin navigation when user is an administrator', () => {
    const navJsPath = path.join(__dirname, '..', 'faculty', 'faculty-nav.js');
    const navJs = fs.readFileSync(navJsPath, 'utf8');

    assert.ok(
        navJs.includes('isAdminUser') && navJs.includes('../nav.html'),
        'faculty-nav.js must detect admin user and load admin navigation (../nav.html)'
    );
    assert.ok(
        navJs.includes('workflow-approval'),
        'faculty-nav.js must activate the workflow-approval (Submissions) nav item for admin'
    );
    assert.ok(
        navJs.includes('../admin/'),
        'faculty-nav.js must route admin sidebar link clicks to ../admin/'
    );
});

registerTest('Issue 1.2: mfo-report.js resolves department chairperson and does not present Admin as Chairperson', () => {
    const mfoJsPath = path.join(__dirname, '..', 'faculty', 'mfo-report.js');
    const mfoJs = fs.readFileSync(mfoJsPath, 'utf8');

    assert.ok(
        mfoJs.includes("Department Consolidated MFO Report — Dean\\'s Review") || mfoJs.includes("Department Consolidated MFO Report — Dean's Review"),
        'mfo-report.js must render Dean review kicker when viewed by final approver'
    );
    assert.ok(
        mfoJs.includes('state.reviewerIsAdmin') && mfoJs.includes('resolvedChair'),
        'mfo-report.js must resolve actual department chairperson for targetDept instead of assigning admin as chair'
    );
});

registerTest('Issue 1.3: nav.js supports resolving admin paths from /faculty/ path context', () => {
    const navJsPath = path.join(__dirname, '..', 'nav.js');
    const navJs = fs.readFileSync(navJsPath, 'utf8');

    assert.ok(
        navJs.includes('/faculty/') && navJs.includes('../admin/'),
        'nav.js must resolve admin paths with ../admin/ when called from /faculty/'
    );
    assert.ok(
        navJs.includes('mfo-report') && navJs.includes('workflow-approval.html'),
        'nav.js normalizeMenuTarget must map mfo-report to workflow-approval.html'
    );
});

// =============================================================================
// ISSUE 2: Workflow Approval Shows Accurate Chair Certification & Workflow Statuses
// =============================================================================

registerTest('Issue 2.1: renderStatusPill distinguishes Pending Chair Review from Chair Certified', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Extract renderStatusPill
    const fnMatch = html.match(/function\s+renderStatusPill\s*\([\s\S]*?return\s+`[\s\S]*?`;\s*}/);
    assert.ok(fnMatch, 'renderStatusPill must exist in workflow-approval.html');

    // Create a safe evaluation environment
    const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const renderStatusPill = new Function('escapeHtml', `return ${fnMatch[0]}`)(escapeHtml);

    // 1. Pending chairperson review must NOT be Chair Certified
    const pendingChairPill = renderStatusPill('Pending Chairperson Review', 'chairperson_review');
    assert.ok(pendingChairPill.includes('Pending Chair Review'), 'Pending chairperson review must show "Pending Chair Review"');
    assert.ok(!pendingChairPill.includes('Chair Certified'), 'Pending chairperson review must NOT show "Chair Certified"');
    assert.ok(pendingChairPill.includes('pill-pending'), 'Pending chairperson review must use pill-pending');

    // 2. Awaiting chair / dean must NOT be Chair Certified
    const awaitingChairPill = renderStatusPill('Awaiting Chair / Dean', 'submitted');
    assert.ok(awaitingChairPill.includes('Pending Chair Review'), 'Awaiting chair must show "Pending Chair Review"');
    assert.ok(!awaitingChairPill.includes('Chair Certified'), 'Awaiting chair must NOT show "Chair Certified"');

    // 3. Chairperson revision requested must show Needs Revision, NOT Chair Certified
    const revisionPill = renderStatusPill('Chairperson Revision Requested', 'revision');
    assert.ok(revisionPill.includes('pill-revision'), 'Revision must use pill-revision');
    assert.ok(!revisionPill.includes('Chair Certified'), 'Revision must NOT show "Chair Certified"');

    // 4. Truly chair-approved report MUST show Chair Certified
    const certifiedPill = renderStatusPill('Chair Certified', 'chair_approved');
    assert.ok(certifiedPill.includes('Chair Certified'), 'chair_approved must show "Chair Certified"');
    assert.ok(certifiedPill.includes('pill-info'), 'Chair Certified must use pill-info');

    // 5. Pending final approval must show Pending Final Review, NOT Approved
    const pendingFinalPill = renderStatusPill('Pending Admin Final Approval', 'final_approval');
    assert.ok(pendingFinalPill.includes('Pending Final Review'), 'Pending Admin Final Approval must show "Pending Final Review"');
    assert.ok(pendingFinalPill.includes('pill-pending'), 'Pending final review must use pill-pending');

    // 6. Approved by dean must show Approved
    const approvedPill = renderStatusPill('Approved by Dean', 'approved');
    assert.ok(approvedPill.includes('Approved'), 'Approved must show "Approved"');
    assert.ok(approvedPill.includes('pill-approved'), 'Approved must use pill-approved');
});

// =============================================================================
// ISSUE 3: Task Assignment Notification Message Is Role/Context-Aware
// =============================================================================

registerTest('Issue 3.1: notification-presentation.js formats creator notifications as "Task Created Successfully"', () => {
    const sourcePath = path.join(__dirname, '..', 'shared', 'notification-presentation.js');
    const context = { console, window: {}, globalThis: {} };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
    const notifPresentation = context.window.CiteFlowNotifPresentation;

    // Admin / Creator notification
    const creatorNotif = {
        type: 'task_assignment',
        category: 'task_assignment',
        title: 'Task Created Successfully',
        message: 'Task "Q1 Accomplishment" created successfully and assigned to 5 faculty.',
        link: 'submissions.html#task=123'
    };
    const creatorCard = notifPresentation.present(creatorNotif);
    assert.strictEqual(creatorCard.title, 'Task Created Successfully', 'Creator notification must have title "Task Created Successfully"');
    assert.ok(creatorCard.description.includes('created successfully'), 'Creator notification description must state task was created successfully');
    assert.ok(!creatorCard.description.includes('You have been assigned'), 'Creator notification must NOT say "You have been assigned"');

    // Faculty assignee notification
    const assigneeNotif = {
        type: 'task_assignment',
        category: 'task_assignment',
        title: 'New Task Assigned',
        message: 'Dean\'s Office has assigned you "Q1 Accomplishment". Deadline: March 31, 2026.',
        link: 'submissions.html#task=123'
    };
    const assigneeCard = notifPresentation.present(assigneeNotif);
    assert.strictEqual(assigneeCard.title, 'New Task Assigned', 'Assignee notification must have title "New Task Assigned"');
    assert.ok(assigneeCard.description.includes('Dean\'s Office has assigned you'), 'Assignee notification must state assignment');
});

registerTest('Issue 3.2: workflow-approval.html creates creator notifications with "Task Created Successfully"', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(
        html.includes("title: 'Task Created Successfully'"),
        'workflow-approval.html must create creator notifications with title "Task Created Successfully"'
    );
});

// =============================================================================
// ISSUE 4: Custom Schedule Recurring Report Frequency
// =============================================================================

registerTest('Issue 4.1: Custom Schedule option is selectable and configurable in workflow-approval.html', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(
        html.includes('<option value="custom">Custom Schedule</option>'),
        'workflow-approval.html must include Custom Schedule option in reportFrequency'
    );
    assert.ok(
        html.includes('setSelectValue(\'reportFrequency\', normFreq'),
        'workflow-approval.html openReportConfigModal must use setSelectValue to refresh compact select'
    );
    assert.ok(
        html.includes('id="customScheduleFields"'),
        'workflow-approval.html must contain customScheduleFields container'
    );
    assert.ok(
        html.includes('data-report-freq="custom"'),
        'workflow-approval.html must contain Custom frequency filter tab'
    );
});

registerTest('Issue 4.2: faculty/submissions.html includes Custom Schedule tab and counts', () => {
    const htmlPath = path.join(__dirname, '..', 'faculty', 'submissions.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(
        html.includes('setReportFrequency(\'custom\')'),
        'faculty/submissions.html must provide a Custom Schedule filter tab'
    );
    assert.ok(
        html.includes('custom: 0'),
        'faculty/submissions.html reportFrequencyCounts must include custom key'
    );
});

registerTest('Issue 4.3: shared/workflow.js correctly identifies and handles custom frequency', () => {
    const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));

    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'custom' }), 'custom', 'Explicit frequency custom must resolve to custom');
    assert.strictEqual(wf.resolveReportingFrequency({ frequency: 'custom_schedule' }), 'custom', 'Explicit frequency custom_schedule must resolve to custom');
    assert.strictEqual(wf.resolveReportingFrequency({ title: 'Special Custom Project Milestone' }), 'custom', 'Custom title must resolve to custom');
});

// =============================================================================
// ISSUE 5: Admin Submission Navigation Buttons (Tasks, Reports, Accomplishments, etc.)
// =============================================================================

registerTest('Issue 5.1: setAdminWorkflowView correctly updates adminWorkflowView, toggles active class on tabs, and toggles is-hidden on view panels', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Create a mock DOM environment
    class MockClassList {
        constructor() { this.classes = new Set(); }
        add(c) { this.classes.add(c); }
        remove(c) { this.classes.delete(c); }
        contains(c) { return this.classes.has(c); }
        toggle(c, force) {
            if (force === undefined) {
                if (this.classes.has(c)) { this.classes.delete(c); return false; }
                else { this.classes.add(c); return true; }
            }
            if (force) { this.classes.add(c); return true; }
            else { this.classes.delete(c); return false; }
        }
    }

    class MockElement {
        constructor(id, attrs = {}) {
            this.id = id;
            this.attrs = attrs;
            this.classList = new MockClassList();
        }
        getAttribute(name) { return this.attrs[name] || null; }
    }

    const tabs = [
        new MockElement('tab-queue', { 'data-view': 'queue' }),
        new MockElement('tab-tasks', { 'data-view': 'tasks' }),
        new MockElement('tab-reports', { 'data-view': 'reports' }),
        new MockElement('tab-accomplishments', { 'data-view': 'accomplishments' }),
        new MockElement('tab-analysis', { 'data-view': 'analysis' })
    ];
    tabs[0].classList.add('active');

    const panels = {
        wfViewQueue: new MockElement('wfViewQueue'),
        wfViewTasks: new MockElement('wfViewTasks'),
        wfViewReports: new MockElement('wfViewReports'),
        wfViewAccomplishments: new MockElement('wfViewAccomplishments'),
        wfViewAnalysis: new MockElement('wfViewAnalysis')
    };
    panels.wfViewTasks.classList.add('is-hidden');
    panels.wfViewReports.classList.add('is-hidden');
    panels.wfViewAccomplishments.classList.add('is-hidden');
    panels.wfViewAnalysis.classList.add('is-hidden');

    const mockDoc = {
        querySelectorAll: (sel) => {
            if (sel.includes('#wfViewTabs .wf-category-tab')) return tabs;
            return [];
        },
        getElementById: (id) => panels[id] || null
    };

    let renderedView = null;
    let badgeUpdated = false;

    // Sandbox with extracted setAdminWorkflowView logic from workflow-approval.html
    const sandbox = {
        document: mockDoc,
        window: { location: { hash: '' } },
        history: { replaceState: () => {} },
        adminWorkflowView: 'queue',
        renderSubmissionQueue: () => { renderedView = 'queue'; },
        filterSubmissions: () => { renderedView = 'tasks'; },
        renderReportSubmissions: () => { renderedView = 'reports'; },
        renderAccomplishmentsView: () => { renderedView = 'accomplishments'; },
        renderFacultyAnalysis: () => { renderedView = 'analysis'; },
        updateQueueBadgeCount: () => { badgeUpdated = true; }
    };

    const funcMatch = html.match(/function setAdminWorkflowView\(view\) \{([\s\S]*?)\n        \}/);
    assert.ok(funcMatch, 'setAdminWorkflowView function must be present in workflow-approval.html');
    const funcCode = `function setAdminWorkflowView(view) {${funcMatch[1]}\n}`;
    vm.runInNewContext(funcCode + '; this.setAdminWorkflowView = setAdminWorkflowView;', sandbox);

    // Test switching to 'tasks'
    sandbox.setAdminWorkflowView('tasks');
    assert.strictEqual(sandbox.adminWorkflowView, 'tasks', 'adminWorkflowView must be tasks');
    assert.strictEqual(renderedView, 'tasks', 'filterSubmissions must be called for tasks view');
    assert.ok(tabs.find(t => t.attrs['data-view'] === 'tasks').classList.contains('active'), 'Tasks tab must be active');
    assert.ok(!tabs.find(t => t.attrs['data-view'] === 'queue').classList.contains('active'), 'Queue tab must not be active');
    assert.strictEqual(panels.wfViewTasks.classList.contains('is-hidden'), false, 'wfViewTasks must not be hidden');
    assert.strictEqual(panels.wfViewQueue.classList.contains('is-hidden'), true, 'wfViewQueue must be hidden');
    assert.strictEqual(panels.wfViewReports.classList.contains('is-hidden'), true, 'wfViewReports must be hidden');

    // Test switching to 'reports'
    sandbox.setAdminWorkflowView('reports');
    assert.strictEqual(sandbox.adminWorkflowView, 'reports', 'adminWorkflowView must be reports');
    assert.strictEqual(renderedView, 'reports', 'renderReportSubmissions must be called for reports view');
    assert.ok(tabs.find(t => t.attrs['data-view'] === 'reports').classList.contains('active'), 'Reports tab must be active');
    assert.strictEqual(panels.wfViewReports.classList.contains('is-hidden'), false, 'wfViewReports must not be hidden');
    assert.strictEqual(panels.wfViewTasks.classList.contains('is-hidden'), true, 'wfViewTasks must be hidden');

    // Test switching to 'accomplishments'
    sandbox.setAdminWorkflowView('accomplishments');
    assert.strictEqual(sandbox.adminWorkflowView, 'accomplishments', 'adminWorkflowView must be accomplishments');
    assert.strictEqual(renderedView, 'accomplishments', 'renderAccomplishmentsView must be called for accomplishments view');
    assert.ok(tabs.find(t => t.attrs['data-view'] === 'accomplishments').classList.contains('active'), 'Accomplishments tab must be active');
    assert.strictEqual(panels.wfViewAccomplishments.classList.contains('is-hidden'), false, 'wfViewAccomplishments must not be hidden');
    assert.strictEqual(panels.wfViewReports.classList.contains('is-hidden'), true, 'wfViewReports must be hidden');

    // Test switching to 'analysis'
    sandbox.setAdminWorkflowView('analysis');
    assert.strictEqual(sandbox.adminWorkflowView, 'analysis', 'adminWorkflowView must be analysis');
    assert.strictEqual(renderedView, 'analysis', 'renderFacultyAnalysis must be called for analysis view');
    assert.ok(tabs.find(t => t.attrs['data-view'] === 'analysis').classList.contains('active'), 'Analysis tab must be active');
    assert.strictEqual(panels.wfViewAnalysis.classList.contains('is-hidden'), false, 'wfViewAnalysis must not be hidden');

    // Test switching back to 'queue'
    sandbox.setAdminWorkflowView('queue');
    assert.strictEqual(sandbox.adminWorkflowView, 'queue', 'adminWorkflowView must be queue');
    assert.strictEqual(renderedView, 'queue', 'renderSubmissionQueue must be called for queue view');
    assert.ok(tabs.find(t => t.attrs['data-view'] === 'queue').classList.contains('active'), 'Queue tab must be active');
    assert.strictEqual(panels.wfViewQueue.classList.contains('is-hidden'), false, 'wfViewQueue must not be hidden');
    assert.strictEqual(panels.wfViewAnalysis.classList.contains('is-hidden'), true, 'wfViewAnalysis must be hidden');
});

registerTest('Issue 5.2: Repeated section switching preserves state and updates UI consistently', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    class MockClassList {
        constructor() { this.classes = new Set(); }
        toggle(c, force) {
            if (force) { this.classes.add(c); return true; }
            else { this.classes.delete(c); return false; }
        }
        contains(c) { return this.classes.has(c); }
    }
    class MockElement {
        constructor(id, attrs = {}) {
            this.id = id;
            this.attrs = attrs;
            this.classList = new MockClassList();
        }
        getAttribute(name) { return this.attrs[name] || null; }
    }

    const views = ['queue', 'tasks', 'reports', 'accomplishments', 'analysis'];
    const tabs = views.map(v => new MockElement(`tab-${v}`, { 'data-view': v }));
    const panels = {
        wfViewQueue: new MockElement('wfViewQueue'),
        wfViewTasks: new MockElement('wfViewTasks'),
        wfViewReports: new MockElement('wfViewReports'),
        wfViewAccomplishments: new MockElement('wfViewAccomplishments'),
        wfViewAnalysis: new MockElement('wfViewAnalysis')
    };

    const sandbox = {
        document: {
            querySelectorAll: () => tabs,
            getElementById: (id) => panels[id] || null
        },
        window: { location: { hash: '' } },
        history: { replaceState: () => {} },
        adminWorkflowView: 'queue',
        renderSubmissionQueue: () => {},
        filterSubmissions: () => {},
        renderReportSubmissions: () => {},
        renderAccomplishmentsView: () => {},
        renderFacultyAnalysis: () => {},
        updateQueueBadgeCount: () => {}
    };

    const funcMatch = html.match(/function setAdminWorkflowView\(view\) \{([\s\S]*?)\n        \}/);
    vm.runInNewContext(`function setAdminWorkflowView(view) {${funcMatch[1]}\n}; this.setAdminWorkflowView = setAdminWorkflowView;`, sandbox);

    // Rapid switching cycle
    const sequence = ['tasks', 'reports', 'tasks', 'accomplishments', 'reports', 'analysis', 'queue', 'tasks'];
    for (const targetView of sequence) {
        sandbox.setAdminWorkflowView(targetView);
        assert.strictEqual(sandbox.adminWorkflowView, targetView);
        // Only target tab is active
        tabs.forEach(tab => {
            const isTarget = tab.attrs['data-view'] === targetView;
            assert.strictEqual(tab.classList.contains('active'), isTarget, `Tab ${tab.attrs['data-view']} active state mismatch`);
        });
        // Only target panel is visible (not hidden)
        const panelMap = {
            queue: panels.wfViewQueue,
            tasks: panels.wfViewTasks,
            reports: panels.wfViewReports,
            accomplishments: panels.wfViewAccomplishments,
            analysis: panels.wfViewAnalysis
        };
        for (const [v, p] of Object.entries(panelMap)) {
            const isHidden = p.classList.contains('is-hidden');
            assert.strictEqual(isHidden, v !== targetView, `Panel ${v} visibility mismatch for target ${targetView}`);
        }
    }
});

registerTest('Issue 5.3: HTML elements and inline bindings for all navigation buttons are valid and exposed on window', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Check all navigation tabs exist in wfViewTabs
    const requiredViews = ['queue', 'tasks', 'reports', 'accomplishments', 'analysis'];
    for (const v of requiredViews) {
        assert.ok(
            html.includes(`data-view="${v}"`),
            `wfViewTabs must contain tab with data-view="${v}"`
        );
        assert.ok(
            html.includes(`onclick="setAdminWorkflowView('${v}')"`),
            `Tab for ${v} must bind onclick="setAdminWorkflowView('${v}')"`
        );
    }

    // Verify window bindings are explicit
    assert.ok(html.includes('window.setAdminWorkflowView = setAdminWorkflowView'), 'window.setAdminWorkflowView must be explicitly assigned');
    assert.ok(html.includes('window.setQueueBucket = setQueueBucket'), 'window.setQueueBucket must be explicitly assigned');
    assert.ok(html.includes('window.setReportListFrequencyFilter = setReportListFrequencyFilter'), 'window.setReportListFrequencyFilter must be explicitly assigned');
    assert.ok(html.includes('window.setAccomplishmentTypeFilter = setAccomplishmentTypeFilter'), 'window.setAccomplishmentTypeFilter must be explicitly assigned');
});

registerTest('Issue 5.4: Page refresh / hash routing (readIncomingAdminView) correctly initializes requested view', () => {
    const htmlPath = path.join(__dirname, '..', 'admin', 'workflow-approval.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const funcMatch = html.match(/function readIncomingAdminView\(\) \{([\s\S]*?)\n        \}/);
    assert.ok(funcMatch, 'readIncomingAdminView must be present');

    const createSandbox = (hash) => ({
        window: { location: { hash } },
        decodeURIComponent: decodeURIComponent,
        URLSearchParams: URLSearchParams
    });

    const runRead = (hash) => {
        const sb = createSandbox(hash);
        vm.runInNewContext(`function readIncomingAdminView() {${funcMatch[1]}\n}; this.result = readIncomingAdminView();`, sb);
        return sb.result;
    };

    assert.strictEqual(runRead('#view=tasks'), 'tasks', 'Should parse tasks from #view=tasks');
    assert.strictEqual(runRead('#view=reports'), 'reports', 'Should parse reports from #view=reports');
    assert.strictEqual(runRead('#view=accomplishments'), 'accomplishments', 'Should parse accomplishments from #view=accomplishments');
    assert.strictEqual(runRead('#view=analysis'), 'analysis', 'Should parse analysis from #view=analysis');
    assert.strictEqual(runRead('#view=queue'), 'queue', 'Should parse queue from #view=queue');
    assert.strictEqual(runRead('#view=invalid'), '', 'Should reject invalid view');
    assert.strictEqual(runRead(''), '', 'Should return empty for empty hash');
});

// =============================================================================
// RUN TESTS
// =============================================================================

async function runAll() {
    console.log('\n======================================================');
    console.log('   CITE-FLOW — 4 MANUAL TESTING FIXES REGRESSION SUITE   ');
    console.log('======================================================\n');

    for (const t of tests) {
        try {
            await t.fn();
            passCount++;
            console.log(`[PASS] ${t.title}`);
        } catch (err) {
            failCount++;
            console.error(`[FAIL] ${t.title}`);
            console.error('       ' + (err.stack || err.message));
        }
    }

    console.log('\n======================================================');
    console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================\n');

    if (failCount > 0) {
        process.exit(1);
    }
}

runAll();
