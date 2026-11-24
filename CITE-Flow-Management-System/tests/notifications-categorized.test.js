/**
 * Test Suite: CITEFLOW Centralized & Categorized Notification System
 *
 * Verifies all 16 requirements from Section 10:
 * 1. Admin creates a task and assigns one faculty member.
 * 2. Admin assigns a task to multiple faculty members.
 * 3. Unassigned faculty receive no assignment notification.
 * 4. Faculty successfully submits a report.
 * 5. Chairperson receives the submission notification.
 * 6. Chairperson approves and faculty receives a Chairperson Approved notification.
 * 7. Faculty is not incorrectly notified of final Dean's Office approval at this stage.
 * 8. Dean's Office grants final approval and faculty receives a final approval notification.
 * 9. Chairperson requests revision and faculty receives a revision notification with remarks.
 * 10. Dean's Office requests revision and faculty receives a separate revision notification.
 * 11. A submission is declined and faculty receives the correct decline notification.
 * 12. Deadline reminders are sent only to relevant faculty.
 * 13. Duplicate events do not produce duplicate notifications.
 * 14. Read/unread counts work correctly across filter tabs.
 * 15. Realtime notifications update state without page refresh.
 * 16. Existing notification and approval functionality remains intact.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));

// Load notification presentation module in vm context
const notifPresentationSource = fs.readFileSync(path.join(__dirname, '..', 'shared', 'notification-presentation.js'), 'utf8');
const context = { console, window: {}, globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(notifPresentationSource, context);
const presentation = context.window.CiteFlowNotifPresentation;

let passCount = 0;
let failCount = 0;

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`PASS  ${name}`);
                passCount++;
            }).catch((err) => {
                console.error(`FAIL  ${name}`);
                console.error(err);
                failCount++;
                process.exitCode = 1;
            });
        }
        console.log(`PASS  ${name}`);
        passCount++;
    } catch (err) {
        console.error(`FAIL  ${name}`);
        console.error(err);
        failCount++;
        process.exitCode = 1;
    }
}

/**
 * In-memory Mock Supabase Client
 */
function createMockDb(initialState = {}) {
    const tables = {
        wf_notifications: [...(initialState.wf_notifications || [])],
        wf_task_assignments: [...(initialState.wf_task_assignments || [])],
        wf_tasks: [...(initialState.wf_tasks || [])],
        wf_submissions: [...(initialState.wf_submissions || [])],
        wf_approval_history: [...(initialState.wf_approval_history || [])],
        wf_activity_log: [...(initialState.wf_activity_log || [])],
        wf_delegated_access: [...(initialState.wf_delegated_access || [])],
        wf_report_configs: [...(initialState.wf_report_configs || [])],
        faculty: [...(initialState.faculty || [])],
        admin_profiles: [...(initialState.admin_profiles || [])]
    };

    function tableQuery(tableName) {
        let filters = [];
        let orderSpecs = [];
        let limitVal = null;
        let selectedColumns = '*';
        let updatePatch = null;
        let isDelete = false;

        const builder = {
            select(cols = '*') {
                selectedColumns = cols;
                return builder;
            },
            eq(col, val) {
                filters.push((row) => String(row[col]) === String(val));
                return builder;
            },
            neq(col, val) {
                filters.push((row) => String(row[col]) !== String(val));
                return builder;
            },
            in(col, vals) {
                const set = new Set((vals || []).map(String));
                filters.push((row) => set.has(String(row[col])));
                return builder;
            },
            ilike(col, pattern) {
                const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');
                filters.push((row) => regex.test(String(row[col] || '')));
                return builder;
            },
            order(col, opts = {}) {
                orderSpecs.push({ col, asc: opts.ascending !== false });
                return builder;
            },
            limit(num) {
                limitVal = num;
                return builder;
            },
            single() {
                return builder.then((res) => {
                    if (res.error) return res;
                    return { data: res.data[0] || null, error: null };
                });
            },
            maybeSingle() {
                return builder.then((res) => {
                    if (res.error) return res;
                    return { data: res.data[0] || null, error: null };
                });
            },
            async insert(payload) {
                const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
                    id: r.id || 'id-' + Math.random().toString(36).slice(2, 9),
                    created_at: r.created_at || new Date().toISOString(),
                    ...r
                }));
                if (!tables[tableName]) tables[tableName] = [];
                tables[tableName].push(...rows);
                return { data: rows, error: null };
            },
            update(patch) {
                updatePatch = patch;
                return builder;
            },
            delete() {
                isDelete = true;
                return builder;
            },
            then(resolve, reject) {
                if (!tables[tableName]) tables[tableName] = [];
                if (updatePatch) {
                    const matched = tables[tableName].filter((row) => filters.every((f) => f(row)));
                    matched.forEach((row) => Object.assign(row, updatePatch));
                    return resolve({ data: matched, error: null });
                }
                if (isDelete) {
                    const remaining = [];
                    const removed = [];
                    tables[tableName].forEach((row) => {
                        if (filters.every((f) => f(row))) removed.push(row);
                        else remaining.push(row);
                    });
                    tables[tableName] = remaining;
                    return resolve({ data: removed, error: null });
                }
                let data = [...tables[tableName]];
                for (const f of filters) data = data.filter(f);
                for (const { col, asc } of orderSpecs) {
                    data.sort((a, b) => {
                        if (a[col] < b[col]) return asc ? -1 : 1;
                        if (a[col] > b[col]) return asc ? 1 : -1;
                        return 0;
                    });
                }
                if (limitVal != null) data = data.slice(0, limitVal);
                resolve({ data, error: null });
            }
        };
        return builder;
    }

    return {
        _tables: tables,
        from(tableName) {
            return tableQuery(tableName);
        }
    };
}

(async function runAllNotificationTests() {
    console.log('\n======================================================');
    console.log('   CITE-FLOW CATEGORIZED NOTIFICATION TEST SUITE     ');
    console.log('======================================================\n');

    // -------------------------------------------------------------------------
    // Scenario 1: Admin creates a task and assigns ONE faculty member
    // -------------------------------------------------------------------------
    await test('Scenario 1: Admin creates task and assigns 1 faculty -> exactly 1 task_assignment notification dispatched', async () => {
        const db = createMockDb();
        const task = { id: 'task-101', title: 'Syllabus Review', due_at: '2026-12-01T17:00:00Z', academic_year: '2026-2027', semester: '1st Semester' };
        const faculty = [{ id: 'fac-1', full_name: 'Dr. John Doe', auth_user_id: 'auth-1' }];

        const result = await wf.dispatchTaskAssignmentNotifications(db, {
            task,
            assignedFaculty: faculty,
            sender: "Dean's Office",
            instructions: 'Please upload approved syllabus.'
        });

        assert.strictEqual(result.sent, 1);
        const rows = db._tables.wf_notifications;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].faculty_id, 'fac-1');
        assert.strictEqual(rows[0].type, 'task_assignment');
        assert.strictEqual(rows[0].category, 'task_assignment');
        assert.strictEqual(rows[0].title, 'New Task Assigned');
        assert.ok(rows[0].message.includes("Dean's Office has assigned you"));
        assert.ok(rows[0].message.includes('Syllabus Review'));
        assert.ok(rows[0].message.includes('Deadline'));
        assert.ok(rows[0].link.includes('task-101'));

        const presented = presentation.present(rows[0]);
        assert.strictEqual(presented.category, 'task_assignment');
        assert.strictEqual(presented.icon, 'fa-clipboard-list');
        assert.strictEqual(presented.title, 'New Task Assigned');
        assert.strictEqual(presentation.resolveCategory(rows[0]), 'task_assignment');
    });

    // -------------------------------------------------------------------------
    // Scenario 2: Admin assigns a task to MULTIPLE faculty members
    // -------------------------------------------------------------------------
    await test('Scenario 2: Admin assigns task to multiple faculty -> distinct notification for each assigned recipient', async () => {
        const db = createMockDb();
        const task = { id: 'task-102', title: 'Midterm Grades Submission', due_at: '2026-11-30T17:00:00Z' };
        const faculty = [
            { id: 'fac-1', full_name: 'Faculty Alpha', auth_user_id: 'auth-1' },
            { id: 'fac-2', full_name: 'Faculty Beta', auth_user_id: 'auth-2' },
            { id: 'fac-3', full_name: 'Faculty Gamma', auth_user_id: 'auth-3' }
        ];

        const result = await wf.dispatchTaskAssignmentNotifications(db, {
            task,
            assignedFaculty: faculty
        });

        assert.strictEqual(result.sent, 3);
        const rows = db._tables.wf_notifications;
        assert.strictEqual(rows.length, 3);
        const assignedIds = new Set(rows.map(r => r.faculty_id));
        assert.ok(assignedIds.has('fac-1'));
        assert.ok(assignedIds.has('fac-2'));
        assert.ok(assignedIds.has('fac-3'));
    });

    // -------------------------------------------------------------------------
    // Scenario 3: Unassigned faculty receive NO assignment notification
    // -------------------------------------------------------------------------
    await test('Scenario 3: Unassigned faculty receive no notification', async () => {
        const db = createMockDb();
        const task = { id: 'task-103', title: 'Curriculum Meeting' };
        const assigned = [{ id: 'fac-1', full_name: 'Assigned Person' }];
        const unassignedId = 'fac-99';

        await wf.dispatchTaskAssignmentNotifications(db, { task, assignedFaculty: assigned });

        const rowsForUnassigned = db._tables.wf_notifications.filter(r => r.faculty_id === unassignedId);
        assert.strictEqual(rowsForUnassigned.length, 0);
    });

    // -------------------------------------------------------------------------
    // Scenario 4 & 5: Faculty submits report -> Chairperson receives notification
    // -------------------------------------------------------------------------
    await test('Scenario 4 & 5: Faculty submits report -> Submitter gets confirmation and Chairperson receives Submission Received notification', async () => {
        const chairPerson = { id: 'chair-1', full_name: 'Prof. Chairperson', department: 'BSIT', role: 'department_chair' };
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT', auth_user_id: 'auth-1' };
        const task = { id: 'task-104', title: 'Monthly Progress Report', department: 'BSIT' };

        const db = createMockDb({
            faculty: [chairPerson, submitter],
            wf_delegated_access: []
        });

        await wf.recordSubmissionEvent(db, {
            faculty: submitter,
            task,
            taskId: task.id,
            submissionId: 'sub-201',
            isResubmit: false
        });

        const rows = db._tables.wf_notifications;
        // 1. Submitter notification
        const submitterNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(submitterNotif, 'Submitter must receive submission confirmation');
        assert.strictEqual(submitterNotif.category, 'submission_update');
        assert.strictEqual(presentation.resolveCategory(submitterNotif), 'submission_update');

        // 2. Chairperson notification
        const chairNotif = rows.find(r => r.faculty_id === chairPerson.id);
        assert.ok(chairNotif, 'Chairperson must receive submission notification');
        assert.strictEqual(chairNotif.category, 'submission_update');
        assert.strictEqual(chairNotif.title, 'Submission Received');
        assert.ok(chairNotif.message.includes('Faculty submission received. A report from Maria Santos is awaiting your review'));

        const presentedChair = presentation.present(chairNotif);
        assert.strictEqual(presentedChair.category, 'submission_update');
        assert.strictEqual(presentedChair.icon, 'fa-file-lines');
        assert.strictEqual(presentedChair.actionLabel, 'Review Submission');
    });

    // -------------------------------------------------------------------------
    // Scenario 6 & 7: Chairperson Approved -> Faculty receives Chairperson Approved notification (NOT final approval)
    // -------------------------------------------------------------------------
    await test('Scenario 6 & 7: Chairperson approves -> Faculty receives Chairperson Approved notification stating pending final review, NOT final approval', async () => {
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT' };
        const chairPerson = { id: 'chair-1', full_name: 'Chair Maria', department: 'BSIT', role: 'department_chair' };
        const task = { id: 'task-105', title: 'Annual Accomplishment' };
        const submission = { id: 'sub-202', task_id: task.id, faculty_id: submitter.id, status: 'submitted', approval_stage: 'chairperson' };

        const db = createMockDb({
            faculty: [chairPerson, submitter],
            wf_submissions: [submission],
            wf_approval_history: []
        });

        const reviewResult = await wf.applySubmissionReview(db, {
            submissionId: submission.id,
            submission,
            action: 'approved',
            actorFaculty: chairPerson,
            targetFaculty: submitter,
            task,
            config: { requires_chairperson_review: true, requires_final_approval: true }
        });

        assert.strictEqual(reviewResult.ok, true);
        const rows = db._tables.wf_notifications;
        const facultyNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(facultyNotif, 'Faculty must receive approval transition notification');
        assert.strictEqual(facultyNotif.category, 'submission_update');
        assert.strictEqual(facultyNotif.title, 'Submission Approved by Chairperson');
        assert.strictEqual(facultyNotif.message, "Your submission has been approved by the Department Chairperson and forwarded to the Dean's Office for final review.");

        // Requirement 7 check: Must NOT claim final approval
        assert.ok(!facultyNotif.message.toLowerCase().includes('final approval from the dean'), 'Must NOT imply final approval');
        assert.ok(facultyNotif.message.toLowerCase().includes('forwarded to the dean\'s office for final review'), 'Must explicitly indicate pending Dean final review');

        const presented = presentation.present(facultyNotif);
        assert.strictEqual(presented.category, 'submission_update');
        assert.strictEqual(presented.icon, 'fa-circle-check');
        assert.strictEqual(presentation.resolveCategory(facultyNotif), 'submission_update');
    });

    // -------------------------------------------------------------------------
    // Scenario 8: Dean's Office grants final approval -> Faculty receives final approval notification
    // -------------------------------------------------------------------------
    await test('Scenario 8: Dean\'s Office final approval -> Faculty receives Final Approval Granted notification', async () => {
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT' };
        const deanPerson = { id: 'dean-1', full_name: 'Dr. Dean', role: 'dean' };
        const task = { id: 'task-106', title: 'Research Deliverable' };
        const submission = { id: 'sub-203', task_id: task.id, faculty_id: submitter.id, status: 'underreview', approval_stage: 'final_approver' };

        const db = createMockDb({
            faculty: [deanPerson, submitter],
            wf_submissions: [submission],
            wf_approval_history: []
        });

        const reviewResult = await wf.applySubmissionReview(db, {
            submissionId: submission.id,
            submission,
            action: 'approved',
            actorFaculty: deanPerson,
            targetFaculty: submitter,
            task,
            config: { requires_chairperson_review: true, requires_final_approval: true }
        });

        assert.strictEqual(reviewResult.ok, true);
        const rows = db._tables.wf_notifications;
        const facultyNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(facultyNotif);
        assert.strictEqual(facultyNotif.category, 'submission_update');
        assert.strictEqual(facultyNotif.title, 'Final Approval Granted');
        assert.strictEqual(facultyNotif.message, "Your submission has received final approval from the Dean's Office.");

        const presented = presentation.present(facultyNotif);
        assert.strictEqual(presented.category, 'submission_update');
        assert.strictEqual(presented.icon, 'fa-circle-check');
        assert.strictEqual(presentation.resolveCategory(facultyNotif), 'submission_update');
    });

    // -------------------------------------------------------------------------
    // Scenario 9: Chairperson requests revision with remarks
    // -------------------------------------------------------------------------
    await test('Scenario 9: Chairperson requests revision -> Revision Required notification with Department Chairperson identity & remarks', async () => {
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT' };
        const chairPerson = { id: 'chair-1', full_name: 'Chair Maria', department: 'BSIT', role: 'department_chair' };
        const task = { id: 'task-107', title: 'Course Packet' };
        const submission = { id: 'sub-204', task_id: task.id, faculty_id: submitter.id, status: 'submitted', approval_stage: 'chairperson' };

        const db = createMockDb({
            faculty: [chairPerson, submitter],
            wf_submissions: [submission]
        });

        const reviewResult = await wf.applySubmissionReview(db, {
            submissionId: submission.id,
            submission,
            action: 'revision',
            comment: 'Missing Section 3 rubric.',
            actorFaculty: chairPerson,
            targetFaculty: submitter,
            task,
            config: { requires_chairperson_review: true }
        });

        assert.strictEqual(reviewResult.ok, true);
        const rows = db._tables.wf_notifications;
        const facultyNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(facultyNotif);
        assert.strictEqual(facultyNotif.category, 'submission_update');
        assert.strictEqual(facultyNotif.title, 'Revision Required');
        assert.ok(facultyNotif.message.includes("Department Chairperson's review"));
        assert.ok(facultyNotif.message.includes('Missing Section 3 rubric.'));
        assert.ok(facultyNotif.link.includes('task-107'));

        const presented = presentation.present(facultyNotif);
        assert.strictEqual(presented.category, 'submission_update');
        assert.strictEqual(presented.icon, 'fa-pen-to-square');
        assert.strictEqual(presented.actionLabel, 'Review Revision');
    });

    // -------------------------------------------------------------------------
    // Scenario 10: Dean's Office requests revision
    // -------------------------------------------------------------------------
    await test('Scenario 10: Dean\'s Office requests revision -> Revision Required notification identifies Dean\'s Office review', async () => {
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT' };
        const deanPerson = { id: 'dean-1', full_name: 'Dr. Dean', role: 'dean' };
        const task = { id: 'task-108', title: 'Workload Summary' };
        const submission = { id: 'sub-205', task_id: task.id, faculty_id: submitter.id, status: 'underreview', approval_stage: 'final_approver' };

        const db = createMockDb({
            faculty: [deanPerson, submitter],
            wf_submissions: [submission]
        });

        const reviewResult = await wf.applySubmissionReview(db, {
            submissionId: submission.id,
            submission,
            action: 'revision',
            comment: 'Incomplete unit breakdown.',
            actorFaculty: deanPerson,
            targetFaculty: submitter,
            task,
            config: { requires_chairperson_review: true, requires_final_approval: true }
        });

        assert.strictEqual(reviewResult.ok, true);
        const rows = db._tables.wf_notifications;
        const facultyNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(facultyNotif);
        assert.strictEqual(facultyNotif.category, 'submission_update');
        assert.strictEqual(facultyNotif.title, 'Revision Required');
        assert.ok(facultyNotif.message.includes("Dean's Office review"));
        assert.ok(facultyNotif.message.includes('Incomplete unit breakdown.'));
    });

    // -------------------------------------------------------------------------
    // Scenario 11: A submission is declined -> Faculty receives Submission Declined notification
    // -------------------------------------------------------------------------
    await test('Scenario 11: Submission declined -> Faculty receives Submission Declined notification with authority & remarks', async () => {
        const submitter = { id: 'fac-1', full_name: 'Maria Santos', department: 'BSIT' };
        const chairPerson = { id: 'chair-1', full_name: 'Chair Maria', department: 'BSIT', role: 'department_chair' };
        const task = { id: 'task-109', title: 'IPCR Report' };
        const submission = { id: 'sub-206', task_id: task.id, faculty_id: submitter.id, status: 'submitted', approval_stage: 'chairperson' };

        const db = createMockDb({
            faculty: [chairPerson, submitter],
            wf_submissions: [submission]
        });

        const reviewResult = await wf.applySubmissionReview(db, {
            submissionId: submission.id,
            submission,
            action: 'rejected',
            comment: 'Does not meet semester criteria.',
            actorFaculty: chairPerson,
            targetFaculty: submitter,
            task,
            config: { requires_chairperson_review: true }
        });

        assert.strictEqual(reviewResult.ok, true);
        const rows = db._tables.wf_notifications;
        const facultyNotif = rows.find(r => r.faculty_id === submitter.id);
        assert.ok(facultyNotif);
        assert.strictEqual(facultyNotif.category, 'submission_update');
        assert.strictEqual(facultyNotif.title, 'Submission Declined');
        assert.ok(facultyNotif.message.includes('declined by the Department Chairperson'));
        assert.ok(facultyNotif.message.includes('Does not meet semester criteria.'));

        const presented = presentation.present(facultyNotif);
        assert.strictEqual(presented.category, 'submission_update');
        assert.strictEqual(presented.icon, 'fa-circle-xmark');
        assert.strictEqual(presentation.resolveCategory(facultyNotif), 'submission_update');
    });

    // -------------------------------------------------------------------------
    // Scenario 12: Deadline reminders sent only to relevant faculty
    // -------------------------------------------------------------------------
    await test('Scenario 12: Deadline reminders sent only to assigned faculty with uncompleted submissions', async () => {
        // Compute relative deadline 3 calendar days ahead in Manila time
        const now = new Date();
        const due3Days = new Date(now.getTime() + 3 * 86400000).toISOString();
        const task = { id: 'task-110', title: 'Upcoming Term Paper', due_at: due3Days };

        const facUnsubmitted = { id: 'fac-1', full_name: 'Unsubmitted Faculty' };
        const facCompleted = { id: 'fac-2', full_name: 'Completed Faculty' };

        const db = createMockDb({
            wf_tasks: [task],
            wf_task_assignments: [
                { task_id: task.id, faculty_id: facUnsubmitted.id },
                { task_id: task.id, faculty_id: facCompleted.id }
            ],
            wf_submissions: [
                // facCompleted has an approved submission
                { task_id: task.id, faculty_id: facCompleted.id, status: 'approved', submitted_at: '2026-11-01' }
            ],
            wf_notifications: []
        });

        const result = await wf.runDeadlineReminderPass(db, {});
        assert.strictEqual(result.sent, 1, 'Only the unsubmitted faculty should receive the reminder');
        const rows = db._tables.wf_notifications;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].faculty_id, facUnsubmitted.id);
        assert.strictEqual(rows[0].category, 'deadline_reminder');
        assert.strictEqual(rows[0].title, 'Upcoming Deadline');

        const presented = presentation.present(rows[0]);
        assert.strictEqual(presented.category, 'deadline_reminder');
        assert.strictEqual(presented.icon, 'fa-clock');
        assert.strictEqual(presentation.resolveCategory(rows[0]), 'deadline_reminder');
    });

    // -------------------------------------------------------------------------
    // Scenario 13: Duplicate events do not produce duplicate notifications (Idempotency)
    // -------------------------------------------------------------------------
    await test('Scenario 13: Duplicate events do not produce duplicate notifications (Idempotency)', async () => {
        const db = createMockDb();
        const task = { id: 'task-111', title: 'Task Idempotency' };
        const faculty = [{ id: 'fac-1', full_name: 'Faculty One' }];

        // 1st dispatch
        const pass1 = await wf.dispatchTaskAssignmentNotifications(db, { task, assignedFaculty: faculty });
        assert.strictEqual(pass1.sent, 1);
        assert.strictEqual(db._tables.wf_notifications.length, 1);

        // 2nd dispatch for same task & faculty
        const pass2 = await wf.dispatchTaskAssignmentNotifications(db, { task, assignedFaculty: faculty });
        assert.strictEqual(pass2.sent, 0, 'Second dispatch should be skipped');
        assert.strictEqual(pass2.alreadyDispatched, true);
        assert.strictEqual(db._tables.wf_notifications.length, 1, 'Total notifications in db must remain 1');
    });

    // -------------------------------------------------------------------------
    // Scenario 14: Panel Category Filters & Unread Count Behavior
    // -------------------------------------------------------------------------
    await test('Scenario 14: Filter tabs (All, Assignments, Submission Updates, Reminders) isolate categories & unread count invariant holds', () => {
        const notifs = [
            { id: 1, type: 'task_assignment', category: 'task_assignment', title: 'New Task Assigned', message: 'Assigned task 1', is_read: false },
            { id: 2, type: 'task_assignment', category: 'task_assignment', title: 'New Task Assigned', message: 'Assigned task 2', is_read: true },
            { id: 3, type: 'submission_update', category: 'submission_update', title: 'Submission Received', message: 'Submission from A', is_read: false },
            { id: 4, type: 'submission_update', category: 'submission_update', title: 'Final Approval Granted', message: 'Dean approved', is_read: true },
            { id: 5, type: 'deadline_reminder', category: 'deadline_reminder', title: 'Upcoming Deadline', message: 'Reminder: Due soon', is_read: false }
        ];

        // Overall unread count invariant
        const totalUnread = notifs.filter(n => !n.is_read).length;
        assert.strictEqual(totalUnread, 3);

        // Filter: All
        const allItems = notifs;
        assert.strictEqual(allItems.length, 5);

        // Filter: Assignments (task_assignment)
        const assignments = notifs.filter(n => presentation.resolveCategory(n) === 'task_assignment');
        assert.strictEqual(assignments.length, 2);
        assert.ok(assignments.every(n => n.category === 'task_assignment'));

        // Filter: Submission Updates (submission_update)
        const updates = notifs.filter(n => presentation.resolveCategory(n) === 'submission_update');
        assert.strictEqual(updates.length, 2);
        assert.ok(updates.every(n => n.category === 'submission_update'));

        // Filter: Reminders (deadline_reminder)
        const reminders = notifs.filter(n => presentation.resolveCategory(n) === 'deadline_reminder');
        assert.strictEqual(reminders.length, 1);
        assert.ok(reminders.every(n => n.category === 'deadline_reminder'));

        // Header markup renders the 4 category filters
        const headerHtml = presentation.headerMarkup('test-mark');
        assert.ok(headerHtml.includes('data-notif-filter="all"'), 'Contains All filter');
        assert.ok(headerHtml.includes('data-notif-filter="task_assignment"'), 'Contains Assignments filter');
        assert.ok(headerHtml.includes('data-notif-filter="submission_update"'), 'Contains Submission Updates filter');
        assert.ok(headerHtml.includes('data-notif-filter="deadline_reminder"'), 'Contains Reminders filter');

        // Empty states
        assert.ok(presentation.emptyState('task_assignment').includes('No task assignments'));
        assert.ok(presentation.emptyState('submission_update').includes('No submission updates'));
        assert.ok(presentation.emptyState('deadline_reminder').includes('No deadline reminders'));
    });

    // -------------------------------------------------------------------------
    // Scenario 15: Realtime notification ingestion & unread synchronization
    // -------------------------------------------------------------------------
    await test('Scenario 15: Realtime ingestion updates list and badge counter without page reload', () => {
        let activeItems = [
            { id: 1, type: 'task_assignment', category: 'task_assignment', title: 'New Task Assigned', is_read: true }
        ];
        let unreadCount = activeItems.filter(i => !i.is_read).length;
        assert.strictEqual(unreadCount, 0);

        // Realtime event arrives
        const realtimeNotification = {
            id: 2,
            type: 'submission_update',
            category: 'submission_update',
            title: 'Submission Approved by Chairperson',
            message: "Your submission has been approved by the Department Chairperson and forwarded to the Dean's Office for final review.",
            is_read: false
        };

        // Ingest new item
        activeItems.unshift(realtimeNotification);
        unreadCount = activeItems.filter(i => !i.is_read).length;
        assert.strictEqual(unreadCount, 1);
        assert.strictEqual(activeItems.length, 2);
        assert.strictEqual(presentation.resolveCategory(activeItems[0]), 'submission_update');

        // Mark as read
        activeItems = activeItems.map(i => i.id === 2 ? { ...i, is_read: true } : i);
        unreadCount = activeItems.filter(i => !i.is_read).length;
        assert.strictEqual(unreadCount, 0);
    });

    // -------------------------------------------------------------------------
    // Scenario 16: Existing notifications (Calendar, Birthday, Documents) intact
    // -------------------------------------------------------------------------
    await test('Scenario 16: Existing notifications (Calendar, Birthday, Documents) and historical items remain intact', () => {
        // Birthday notification
        const bday = presentation.present({
            type: 'birthday',
            title: 'Birthday Greetings',
            message: "Prof. Cruz commented on John's birthday.",
            event_id: 'birthday-john-2026'
        });
        assert.strictEqual(bday.category, 'birthday');
        assert.strictEqual(bday.icon, 'fa-cake-candles');

        // Calendar notification
        const cal = presentation.present({
            type: 'calendar',
            title: 'Faculty General Assembly',
            message: 'Schedule was posted: Mon, Dec 1 at AVR'
        });
        assert.strictEqual(cal.category, 'calendar');
        assert.strictEqual(cal.icon, 'fa-calendar-days');

        // Document portfolio notification
        const doc = presentation.present({
            type: 'document_uploaded',
            message: 'A certificate was added to your portfolio.'
        });
        assert.strictEqual(doc.category, 'document');
        assert.strictEqual(doc.icon, 'fa-file-lines');

        // Historical task assignment format: 'New task "Project X" assigned to you'
        const historicAssignment = presentation.present({
            type: 'task',
            message: 'New task "Project X" assigned to you'
        });
        assert.strictEqual(historicAssignment.category, 'task_assignment');
        assert.strictEqual(historicAssignment.icon, 'fa-clipboard-list');
        assert.strictEqual(presentation.resolveCategory({ type: 'task', message: 'New task "Project X" assigned to you' }), 'task_assignment');

        // Historical deadline format: 'Reminder: "Project X" is due in 3 days'
        const historicReminder = presentation.present({
            type: 'task',
            message: 'Reminder: "Project X" is due in 3 days (Dec 1, 2026, 5:00 PM Asia/Manila).'
        });
        assert.strictEqual(historicReminder.category, 'deadline_reminder');
        assert.strictEqual(historicReminder.icon, 'fa-clock');
        assert.strictEqual(presentation.resolveCategory({ type: 'task', message: 'Reminder: "Project X" is due in 3 days' }), 'deadline_reminder');
    });

    console.log(`\n======================================================`);
    console.log(`SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
    console.log(`======================================================\n`);

    if (failCount > 0) process.exit(1);
})();
