/**
 * Phase 1 regression tests for department scope, faculty upload rollback,
 * resubmission stage, and Dean's Office review persistence.
 * Local mocks only. No database connection.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

function mockDb(resolve) {
    const calls = [];
    function from(table) {
        const op = { table, kind: 'select', payload: null, filters: [] };
        const builder = {
            update(payload) { op.kind = 'update'; op.payload = payload; return builder; },
            insert(payload) { op.kind = 'insert'; op.payload = payload; return builder; },
            delete() { op.kind = 'delete'; return builder; },
            select() { return builder; },
            eq(column, value) { op.filters.push([column, value]); return builder; },
            neq() { return builder; },
            limit() { return builder; },
            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            single() { return Promise.resolve({ data: { id: 'row-1' }, error: null }); },
            then(onFulfilled, onRejected) {
                calls.push({
                    table: op.table,
                    kind: op.kind,
                    payload: op.payload ? { ...op.payload } : null,
                    filters: op.filters.slice()
                });
                return Promise.resolve(resolve(op)).then(onFulfilled, onRejected);
            }
        };
        return builder;
    }
    return {
        calls,
        from,
        rpc() {
            throw new Error('generic chairperson grant RPC must not be used to authorize a review');
        }
    };
}

function chairSubmission(facultyId, department) {
    return {
        submission: {
            id: 'sub-1',
            task_id: 'task-1',
            faculty_id: facultyId,
            status: 'submitted',
            approval_stage: 'chairperson',
            resubmission_count: 0
        },
        task: { id: 'task-1', title: 'Syllabus', requires_chairperson_review: true },
        config: { requires_chairperson_review: true, requires_final_approval: true },
        target: { id: facultyId, full_name: 'Faculty', department }
    };
}

const oic = { id: 'oic-1', full_name: 'BSIT OIC', role: 'faculty', department: 'bscs' };
const bsitGrant = [{
    id: 'grant-bsit',
    is_active: true,
    department_codes: ['bsit'],
    grantee_faculty_id: 'oic-1'
}];

registerTest('active BSIT OIC grant does not authorize a BSCS submission', async () => {
    const db = mockDb(() => ({ data: [{ id: 'sub-1' }], error: null }));
    const row = chairSubmission('fac-bscs', 'bscs');
    const result = await wf.applySubmissionReview(db, {
        submissionId: 'sub-1',
        submission: row.submission,
        action: 'approved',
        comment: 'Looks good',
        actorFaculty: oic,
        targetFaculty: row.target,
        task: row.task,
        config: row.config,
        delegatedAccess: bsitGrant
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(db.calls.some((call) => call.table === 'wf_submissions'), false);
});

registerTest('active BSIT OIC grant still authorizes a BSIT submission', async () => {
    const db = mockDb((op) => {
        if (op.kind === 'update') return { data: [{ id: 'sub-1' }], error: null };
        return { data: [], error: null };
    });
    const row = chairSubmission('fac-bsit', 'bsit');
    const result = await wf.applySubmissionReview(db, {
        submissionId: 'sub-1',
        submission: row.submission,
        action: 'approved',
        comment: 'Approved for the department',
        actorFaculty: oic,
        targetFaculty: row.target,
        task: row.task,
        config: row.config,
        delegatedAccess: bsitGrant
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.transition.nextStage, 'final_approver');
    const update = db.calls.find((call) => call.table === 'wf_submissions' && call.kind === 'update');
    assert.ok(update);
    assert.strictEqual(update.payload.approval_stage, 'final_approver');
});

registerTest('missing target department fails closed', async () => {
    const db = mockDb(() => ({ data: [{ id: 'sub-1' }], error: null }));
    const row = chairSubmission('fac-unknown', '');
    const result = await wf.applySubmissionReview(db, {
        submissionId: 'sub-1',
        submission: row.submission,
        action: 'revision',
        comment: 'Which department is this?',
        actorFaculty: oic,
        targetFaculty: row.target,
        task: row.task,
        config: row.config,
        delegatedAccess: bsitGrant
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(wf.canReviewAsChairperson(row.submission, oic, row.target, { delegatedAccess: bsitGrant }), false);
    assert.strictEqual(db.calls.some((call) => call.kind === 'update'), false);
});

registerTest('a native BSIT chairperson can still review BSIT faculty', () => {
    const chair = { id: 'chair-it', full_name: 'BSIT Chair', role: 'chairperson', department: 'bsit' };
    const faculty = { id: 'fac-bsit', department: 'bsit' };
    const other = { id: 'fac-bscs', department: 'bscs' };
    const submission = {
        id: 'sub-1',
        faculty_id: 'fac-bsit',
        status: 'submitted',
        approval_stage: 'chairperson'
    };
    assert.strictEqual(wf.canReviewAsChairperson(submission, chair, faculty, { delegatedAccess: [] }), true);
    assert.strictEqual(wf.canReviewAsChairperson(
        { ...submission, faculty_id: 'fac-bscs' },
        chair,
        other,
        { delegatedAccess: [] }
    ), false);
});

registerTest('first submission that requires Chairperson review starts at chairperson', () => {
    const config = { requires_chairperson_review: true };
    const task = { id: 'task-1', requires_chairperson_review: true };
    assert.strictEqual(wf.resolveFacultySubmissionApprovalStage(null, config, task), 'chairperson');
});

registerTest('Chairperson revision resubmits to the Chairperson', () => {
    const config = { requires_chairperson_review: true };
    const task = { id: 'task-1', requires_chairperson_review: true };
    const existing = {
        id: 'sub-1',
        status: 'revision',
        approval_stage: 'chairperson',
        resubmission_count: 1
    };
    assert.strictEqual(wf.resolveFacultySubmissionApprovalStage(existing, config, task), 'chairperson');
});

registerTest('Dean\'s Office revision resubmits to final_approver', () => {
    const config = { requires_chairperson_review: true };
    const task = { id: 'task-1', requires_chairperson_review: true };
    const existing = {
        id: 'sub-1',
        status: 'revision',
        approval_stage: 'final_approver',
        reviewed_at: '2026-10-20T00:00:00Z',
        resubmission_count: 1
    };
    assert.strictEqual(wf.resolveFacultySubmissionApprovalStage(existing, config, task), 'final_approver');
    const resubmitted = {
        ...existing,
        status: 'submitted',
        approval_stage: 'final_approver'
    };
    assert.strictEqual(wf.getApprovalStage(resubmitted, config, task), 'final_approver');
});

registerTest('failed upload of a new submission rolls the new row back', async () => {
    const db = mockDb((op) => {
        if (op.kind === 'delete' && op.table === 'wf_submissions') return { data: [{ id: 'new-1' }], error: null };
        return { data: [], error: null };
    });
    const result = await wf.submitFacultyTaskWithUploads(db, {
        existingSubmission: null,
        payload: { status: 'submitted', approval_stage: 'chairperson' },
        saveRecord: async () => ({ data: { id: 'new-1' }, error: null }),
        uploadRequired: true,
        upload: async () => { throw new Error('Storage bucket "submissions" is missing.'); }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, 'upload');
    assert.match(result.error, /not left as submitted/);
    const removed = db.calls.find((call) => call.table === 'wf_submissions' && call.kind === 'delete');
    assert.ok(removed);
    assert.deepStrictEqual(removed.filters, [['id', 'new-1']]);
});

registerTest('failed upload reports a rollback that cannot be confirmed', async () => {
    const db = mockDb(() => ({ data: [], error: null }));
    const result = await wf.submitFacultyTaskWithUploads(db, {
        existingSubmission: null,
        payload: { status: 'submitted' },
        saveRecord: async () => ({ data: { id: 'new-2' }, error: null }),
        uploadRequired: true,
        upload: async () => { throw new Error('network reset'); }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, 'rollback');
    assert.match(result.error, /could not be restored/i);
    assert.match(result.error, /could not be confirmed as removed/i);
});

registerTest('failed upload restores an existing submission and does not delete it', async () => {
    const db = mockDb((op) => {
        if (op.kind === 'update') return { data: [{ id: 'sub-9' }], error: null };
        return { data: [], error: null };
    });
    const existing = {
        id: 'sub-9',
        status: 'revision',
        approval_stage: 'final_approver',
        submitted_at: '2026-10-01T00:00:00Z',
        is_late: false,
        submitted_status: 'on_time',
        resubmission_count: 1,
        review_remarks: 'Please correct the hours.'
    };
    const result = await wf.submitFacultyTaskWithUploads(db, {
        existingSubmission: existing,
        payload: { status: 'submitted', approval_stage: 'final_approver', resubmission_count: 2 },
        saveRecord: async () => ({ data: { id: 'sub-9' }, error: null }),
        uploadRequired: true,
        upload: async () => { throw new Error('upload rejected'); }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, 'upload');
    assert.strictEqual(db.calls.some((call) => call.kind === 'delete' && call.table === 'wf_submissions'), false);
    assert.strictEqual(db.calls.some((call) => call.kind === 'delete' && call.table === 'wf_submission_files'), false);
    const restore = db.calls.find((call) => call.kind === 'update');
    assert.strictEqual(restore.payload.status, 'revision');
    assert.strictEqual(restore.payload.approval_stage, 'final_approver');
    assert.strictEqual(restore.payload.resubmission_count, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(restore.payload, 'review_remarks'), false);
});

registerTest('successful upload does not roll back and reports the saved id', async () => {
    const db = mockDb(() => ({ data: [{ id: 'new-3' }], error: null }));
    let uploadedId = null;
    const result = await wf.submitFacultyTaskWithUploads(db, {
        existingSubmission: null,
        payload: { status: 'submitted', approval_stage: 'chairperson' },
        saveRecord: async () => ({ data: { id: 'new-3' }, error: null }),
        uploadRequired: true,
        upload: async ({ submissionId }) => { uploadedId = submissionId; }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.submissionId, 'new-3');
    assert.strictEqual(uploadedId, 'new-3');
    assert.strictEqual(db.calls.some((call) => call.kind === 'delete'), false);
});

registerTest('zero-row Dean\'s Office update is not success', async () => {
    const db = mockDb((op) => {
        if (op.kind === 'update') return { data: [], error: null };
        return { data: [], error: null };
    });
    const submission = {
        id: 'sub-final',
        task_id: 'task-1',
        faculty_id: 'fac-1',
        status: 'underreview',
        approval_stage: 'final_approver',
        review_remarks: 'Chairperson note',
        reviewed_at: '2026-10-18T00:00:00Z',
        resubmission_count: 0
    };
    const result = await wf.applySubmissionReview(db, {
        submissionId: 'sub-final',
        submission,
        action: 'approved',
        comment: '',
        actorFaculty: { id: 'dean-1', full_name: 'College Dean', role: 'admin', admin_access: true, department: 'all' },
        targetFaculty: { id: 'fac-1', department: 'bsit' },
        task: { id: 'task-1', requires_chairperson_review: true },
        config: { requires_chairperson_review: true, requires_final_approval: true },
        delegatedAccess: []
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /No submission was updated/);
    const update = db.calls.find((call) => call.kind === 'update');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(update.payload, 'review_remarks'), false);
    assert.strictEqual(db.calls.some((call) => call.table === 'wf_approval_history'), false);
});

registerTest('blank approval does not clear stored remarks and decline does not increment the counter', () => {
    const submission = { resubmission_count: 2, review_remarks: 'Keep this note' };
    const approved = wf.buildReviewUpdate(
        { nextStage: 'approved', nextStatus: 'approved', historyAction: 'final_approved', actorRoleLabel: 'FINAL APPROVER' },
        '   ',
        'College Dean',
        submission
    );
    assert.strictEqual(Object.prototype.hasOwnProperty.call(approved, 'review_remarks'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(approved, 'resubmission_count'), false);

    const declined = wf.buildReviewUpdate(
        { nextStage: 'final_approver', nextStatus: 'rejected', historyAction: 'final_declined', actorRoleLabel: 'FINAL APPROVER' },
        'Declined because the file is incomplete.',
        'College Dean',
        submission
    );
    assert.strictEqual(Object.prototype.hasOwnProperty.call(declined, 'resubmission_count'), false);
    assert.strictEqual(declined.review_remarks, 'Declined because the file is incomplete.');

    const revised = wf.buildReviewUpdate(
        { nextStage: 'final_approver', nextStatus: 'revision', historyAction: 'final_revision', actorRoleLabel: 'FINAL APPROVER' },
        'Please revise.',
        'College Dean',
        submission
    );
    assert.strictEqual(revised.resubmission_count, 3);
    assert.strictEqual(revised.approval_stage, 'final_approver');
});

registerTest('admin review page has one writer and it confirms the row', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'admin', 'workflow-approval.html'),
        'utf8'
    );
    const writers = html.match(/async function applyReviewRealtime/g) || [];
    assert.strictEqual(writers.length, 1);
    assert.strictEqual(html.includes('applyReviewRealtime ='), false);
    const start = html.indexOf('async function applyReviewRealtime');
    const end = html.indexOf('openReviewModal = async function', start);
    const body = html.slice(start, end);
    assert.ok(body.includes('CiteFlowWorkflow.applySubmissionReview'));
    assert.strictEqual(body.includes(".from('wf_submissions')"), false);
    assert.strictEqual(body.includes('review_remarks: comment'), false);
    assert.ok(body.includes("String(comment || '').trim()"));
    assert.ok(body.includes("transition.nextStatus === 'revision'"));
    const facultyPage = fs.readFileSync(
        path.join(__dirname, '..', 'faculty', 'submissions.html'),
        'utf8'
    );
    assert.ok(facultyPage.includes('submitFacultyTaskWithUploads'));
    assert.ok(facultyPage.includes('resolveFacultySubmissionApprovalStage'));
    assert.strictEqual(facultyPage.includes("file_url:\n                            '',"), false);
});

(async () => {
    for (const test of tests) {
        try {
            await test.fn();
            passCount += 1;
            console.log(`[PASS] ${test.title}`);
        } catch (error) {
            failCount += 1;
            console.error(`[FAIL] ${test.title}`);
            console.error(error);
        }
    }
    console.log(`\nSUBMISSION LIFECYCLE: ${passCount} PASSED, ${failCount} FAILED`);
    if (failCount) process.exit(1);
})();
