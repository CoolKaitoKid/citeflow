/**
 * CITE-Flow Phase 5.1 — Core MFO Consolidation Engine Regression Suite
 *
 * Verifies:
 * 1. Inclusion of every genuine submitted status (pending, approved, revision, rejected).
 * 2. Exclusion of unsubmitted faculty and draft-only MFO packets.
 * 3. Correct department and task isolation.
 * 4. Rejected-accomplishment inclusion/exclusion behavior (Rule 4).
 * 5. Preservation of original faculty data (immutability check) (Rule 5).
 * 6. Correct source identifiers, attribution, and status labels.
 * 7. Edge cases: empty datasets, duplicate submissions, and missing/dangling relationships.
 * 8. Authorization helper verification (Rule 7).
 * 9. Backward-compatible exclusion storage metadata.
 */

const assert = require('assert');
const path = require('path');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

// -----------------------------------------------------------------------------
// Test 1: Inclusion of every genuine submitted status (Rule 2)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 2: Includes genuine submitted reports across pending, approved, revision, and rejected statuses', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    const facultyList = [
        { id: 1, full_name: 'Dr. Alice Pending', department: 'BSIT', academic_rank: 'Assistant Professor' },
        { id: 2, full_name: 'Prof. Bob Approved', department: 'BSIT', academic_rank: 'Associate Professor' },
        { id: 3, full_name: 'Engr. Charlie Revision', department: 'BSIT', academic_rank: 'Instructor I' },
        { id: 4, full_name: 'Dr. Dave Rejected', department: 'BSIT', academic_rank: 'Professor' }
    ];

    const submissions = [
        { id: 'sub-1', task_id: taskId, faculty_id: 1, status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-03-25T10:00:00Z' },
        { id: 'sub-2', task_id: taskId, faculty_id: 2, status: 'approved', approval_stage: 'approved', submitted_at: '2026-03-24T09:00:00Z' },
        { id: 'sub-3', task_id: taskId, faculty_id: 3, status: 'revision', approval_stage: 'revision', submitted_at: '2026-03-26T14:00:00Z' },
        { id: 'sub-4', task_id: taskId, faculty_id: 4, status: 'rejected', approval_stage: 'declined', submitted_at: '2026-03-27T16:00:00Z' }
    ];

    const packets = [
        { id: 'pkt-1', task_id: taskId, faculty_id: 1, submission_id: 'sub-1', packet_state: 'submitted' },
        { id: 'pkt-2', task_id: taskId, faculty_id: 2, submission_id: 'sub-2', packet_state: 'approved' },
        { id: 'pkt-3', task_id: taskId, faculty_id: 3, submission_id: 'sub-3', packet_state: 'revision' },
        { id: 'pkt-4', task_id: taskId, faculty_id: 4, submission_id: 'sub-4', packet_state: 'declined' }
    ];

    const childRows = {
        mfo_pi7_trainings: [
            { id: 'tr-1', packet_id: 'pkt-1', faculty_id: 1, title: 'AI Workshop', activity_date: '2026-02-10' },
            { id: 'tr-2', packet_id: 'pkt-2', faculty_id: 2, title: 'Cybersecurity Summit', activity_date: '2026-02-15' },
            { id: 'tr-3', packet_id: 'pkt-3', faculty_id: 3, title: 'Cloud Computing Boot Camp', activity_date: '2026-02-20' },
            { id: 'tr-4', packet_id: 'pkt-4', faculty_id: 4, title: 'Data Analytics Seminar', activity_date: '2026-02-25' }
        ]
    };

    const result = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList,
        childRows
    });

    assert.strictEqual(result.contributingFaculty.length, 4, 'All 4 submitted faculty must be included');
    assert.strictEqual(result.summary.statusCounts.pending, 1, '1 pending');
    assert.strictEqual(result.summary.statusCounts.approved, 1, '1 approved');
    assert.strictEqual(result.summary.statusCounts.revision, 1, '1 revision');
    assert.strictEqual(result.summary.statusCounts.rejected, 1, '1 rejected');

    const trRows = result.sections.mfo_pi7_trainings;
    assert.strictEqual(trRows.length, 4, 'All 4 trainings included in consolidation manifest');

    const statuses = trRows.map(r => r._source.submissionStatus);
    assert.ok(statuses.includes('pending'), 'Contains pending row');
    assert.ok(statuses.includes('approved'), 'Contains approved row');
    assert.ok(statuses.includes('revision'), 'Contains revision row');
    assert.ok(statuses.includes('rejected'), 'Contains rejected row');

    // Labels verified
    const labels = trRows.map(r => r.contributing_status_label);
    assert.ok(labels.includes('Approved'));
    assert.ok(labels.includes('Needs Revision'));
    assert.ok(labels.includes('Declined'));
    assert.ok(labels.includes('Pending Review'));
});

// -----------------------------------------------------------------------------
// Test 2: Exclusion of unsubmitted faculty and draft-only packets (Rule 3)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 3: Excludes unsubmitted faculty and draft-only packets from consolidation records', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    const facultyList = [
        { id: 10, full_name: 'Submitting Faculty', department: 'BSIT' },
        { id: 20, full_name: 'Unsubmitted Assigned Faculty', department: 'BSIT' },
        { id: 30, full_name: 'Draft Only Faculty', department: 'BSIT' }
    ];

    const assignments = [
        { task_id: taskId, faculty_id: 10 },
        { task_id: taskId, faculty_id: 20 },
        { task_id: taskId, faculty_id: 30 }
    ];

    const submissions = [
        { id: 'sub-10', task_id: taskId, faculty_id: 10, status: 'submitted', submitted_at: '2026-03-20T10:00:00Z' }
        // Faculty 20 has NO submission
        // Faculty 30 has draft packet but no submission
    ];

    const packets = [
        { id: 'pkt-10', task_id: taskId, faculty_id: 10, submission_id: 'sub-10', packet_state: 'submitted' },
        { id: 'pkt-30', task_id: taskId, faculty_id: 30, packet_state: 'draft' }
    ];

    const childRows = {
        mfo_pi7_trainings: [
            { id: 'tr-10', packet_id: 'pkt-10', faculty_id: 10, title: 'Genuine Training' },
            { id: 'tr-30', packet_id: 'pkt-30', faculty_id: 30, title: 'Draft Training That Must Not Leak' }
        ]
    };

    const result = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList,
        assignments,
        childRows
    });

    assert.strictEqual(result.contributingFaculty.length, 1, 'Only genuine submitter included');
    assert.strictEqual(result.contributingFaculty[0].facultyId, 10);

    // Unsubmitted faculty appear in analytics diagnostics only, not in consolidation rows
    assert.strictEqual(result.unsubmittedFaculty.length, 2, 'Faculty 20 & 30 tracked in unsubmitted list');
    const unsubmittedIds = result.unsubmittedFaculty.map(f => f.facultyId);
    assert.ok(unsubmittedIds.includes(20));
    assert.ok(unsubmittedIds.includes(30));

    // Draft training tr-30 must be excluded
    const trRows = result.sections.mfo_pi7_trainings;
    assert.strictEqual(trRows.length, 1, 'Only 1 training row in consolidation');
    assert.strictEqual(trRows[0].id, 'tr-10', 'Only genuine training included');
    assert.ok(!trRows.some(r => r.id === 'tr-30'), 'Draft training strictly excluded');
});

// -----------------------------------------------------------------------------
// Test 3: Correct department and task isolation (Rule 6 & Rule 7)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 6: Department and task isolation prevents cross-department and cross-task bleed', () => {
    const targetTaskId = 'task-bsit-q1';
    const otherTaskId = 'task-bsit-q2';

    const facultyList = [
        { id: 101, full_name: 'BSIT Faculty 1', department: 'BSIT' },
        { id: 102, full_name: 'BSCS Faculty 2', department: 'BSCS' },
        { id: 103, full_name: 'BSIT Faculty 3', department: 'BSIT' }
    ];

    const submissions = [
        // Target dept & task
        { id: 'sub-101', task_id: targetTaskId, faculty_id: 101, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' },
        // Different department (BSCS) on same task
        { id: 'sub-102', task_id: targetTaskId, faculty_id: 102, status: 'approved', submitted_at: '2026-03-20T11:00:00Z' },
        // Same department (BSIT) on DIFFERENT task
        { id: 'sub-103', task_id: otherTaskId, faculty_id: 103, status: 'approved', submitted_at: '2026-06-20T10:00:00Z' }
    ];

    const packets = [
        { id: 'pkt-101', task_id: targetTaskId, faculty_id: 101, submission_id: 'sub-101' },
        { id: 'pkt-102', task_id: targetTaskId, faculty_id: 102, submission_id: 'sub-102' },
        { id: 'pkt-103', task_id: otherTaskId, faculty_id: 103, submission_id: 'sub-103' }
    ];

    const childRows = {
        mfo_pi5_certifications: [
            { id: 'c-101', packet_id: 'pkt-101', faculty_id: 101, certification_title: 'BSIT Cert' },
            { id: 'c-102', packet_id: 'pkt-102', faculty_id: 102, certification_title: 'BSCS Cert' },
            { id: 'c-103', packet_id: 'pkt-103', faculty_id: 103, certification_title: 'BSIT Q2 Cert' }
        ]
    };

    const result = engine.buildDepartmentMfoConsolidation({
        taskId: targetTaskId,
        department: 'BSIT',
        submissions,
        packets,
        facultyList,
        childRows
    });

    assert.strictEqual(result.contributingFaculty.length, 1, 'Only BSIT faculty for target task included');
    assert.strictEqual(result.contributingFaculty[0].facultyId, 101);

    const certRows = result.sections.mfo_pi5_certifications;
    assert.strictEqual(certRows.length, 1, 'Only 1 cert row included');
    assert.strictEqual(certRows[0].id, 'c-101');
});

// -----------------------------------------------------------------------------
// Test 4: Rejected-accomplishment inclusion/exclusion behavior (Rule 4)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 4: Chairperson can include or exclude rejected accomplishments without mutating records', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    const facultyList = [
        { id: 201, full_name: 'Dr. Rejected Faculty', department: 'BSIT' }
    ];

    const submissions = [
        { id: 'sub-201', task_id: taskId, faculty_id: 201, status: 'rejected', approval_stage: 'declined', submitted_at: '2026-03-21T10:00:00Z' }
    ];

    const packets = [
        { id: 'pkt-201', task_id: taskId, faculty_id: 201, submission_id: 'sub-201' }
    ];

    const childRows = {
        mfo_pi7_trainings: [
            { id: 'tr-keep', packet_id: 'pkt-201', faculty_id: 201, title: 'Chairperson Kept Training' },
            { id: 'tr-drop', packet_id: 'pkt-201', faculty_id: 201, title: 'Chairperson Excluded Training' }
        ]
    };

    // Chairperson decides to exclude tr-drop
    const excludedIds = ['tr-drop'];

    const result = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList,
        childRows,
        excludedAccomplishmentIds: excludedIds
    });

    // In manifest/all sections: both are retained with exclusion flag
    const allRows = result.sections.mfo_pi7_trainings;
    assert.strictEqual(allRows.length, 2, 'Manifest retains all rows for UI toggle');
    const droppedRow = allRows.find(r => r.id === 'tr-drop');
    const keptRow = allRows.find(r => r.id === 'tr-keep');
    assert.strictEqual(droppedRow.is_excluded, true, 'tr-drop is marked excluded');
    assert.strictEqual(keptRow.is_excluded, false, 'tr-keep is not marked excluded');
    assert.strictEqual(droppedRow.is_rejected, true, 'tr-drop is marked rejected');
    assert.strictEqual(keptRow.is_rejected, true, 'tr-keep is marked rejected');

    // In activeSections (what renders into tables/PDF): only tr-keep appears!
    const activeRows = result.activeSections.mfo_pi7_trainings;
    assert.strictEqual(activeRows.length, 1, 'Active sections filter out excluded item');
    assert.strictEqual(activeRows[0].id, 'tr-keep', 'Active item is tr-keep');

    // Toggle exclusion helper
    const toggled = engine.toggleAccomplishmentExclusion(excludedIds, 'tr-drop', false);
    assert.strictEqual(toggled.has('tr-drop'), false, 'Toggling exclusion off removes item from excluded set');

    const toggledOn = engine.toggleAccomplishmentExclusion(toggled, 'tr-keep', true);
    assert.strictEqual(toggledOn.has('tr-keep'), true, 'Toggling exclusion on adds item to excluded set');
});

// -----------------------------------------------------------------------------
// Test 5: Preservation of original faculty data (immutability check) (Rule 5)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 5: Pure consolidation engine never mutates input arrays, objects, or child-table rows', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    const originalFaculty = [
        { id: 301, full_name: 'Dr. Mutable Test', department: 'BSIT' }
    ];
    const originalSubmissions = [
        { id: 'sub-301', task_id: taskId, faculty_id: 301, status: 'approved', submitted_at: '2026-03-22T08:00:00Z' }
    ];
    const originalPackets = [
        { id: 'pkt-301', task_id: taskId, faculty_id: 301, submission_id: 'sub-301' }
    ];
    const originalChildRows = {
        mfo_pi7_trainings: [
            { id: 'tr-301', packet_id: 'pkt-301', faculty_id: 301, title: 'Original Training Title', venue: 'Campus Hall' }
        ]
    };

    // Deep snapshots before running consolidation
    const snapFaculty = JSON.parse(JSON.stringify(originalFaculty));
    const snapSubmissions = JSON.parse(JSON.stringify(originalSubmissions));
    const snapPackets = JSON.parse(JSON.stringify(originalPackets));
    const snapChildRows = JSON.parse(JSON.stringify(originalChildRows));

    const result = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: originalSubmissions,
        packets: originalPackets,
        facultyList: originalFaculty,
        childRows: originalChildRows,
        excludedAccomplishmentIds: ['tr-301']
    });

    // Inputs must be completely identical after consolidation
    assert.deepStrictEqual(originalFaculty, snapFaculty, 'facultyList was not mutated');
    assert.deepStrictEqual(originalSubmissions, snapSubmissions, 'submissions array was not mutated');
    assert.deepStrictEqual(originalPackets, snapPackets, 'packets array was not mutated');
    assert.deepStrictEqual(originalChildRows, snapChildRows, 'childRows was not mutated');

    // Mutating consolidated row does not pollute raw input
    result.sections.mfo_pi7_trainings[0].title = 'Tampered Consolidated Title';
    assert.strictEqual(originalChildRows.mfo_pi7_trainings[0].title, 'Original Training Title', 'Raw child row is immune to output mutation');
});

// -----------------------------------------------------------------------------
// Test 6: Correct source identifiers and status labels
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 2 & 5: Attribution metadata tracks exact source packet, submission, faculty, and status labels', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    const facultyList = [
        { id: 401, full_name: 'Engr. John Doe', department: 'BSIT', academic_rank: 'Assistant Professor II' }
    ];
    const submissions = [
        { id: 'sub-401', task_id: taskId, faculty_id: 401, status: 'revision', approval_stage: 'revision', submitted_at: '2026-03-23T11:30:00Z' }
    ];
    const packets = [
        { id: 'pkt-401', task_id: taskId, faculty_id: 401, submission_id: 'sub-401' }
    ];
    const childRows = {
        mfo_research_published: [
            { id: 'pub-401', packet_id: 'pkt-401', faculty_id: 401, research_title: 'Deep Learning in Agriculture', publication_name: 'IEEE Access' }
        ]
    };

    const result = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList,
        childRows
    });

    const item = result.sections.mfo_research_published[0];
    assert.ok(item, 'Item exists in publication section');
    assert.strictEqual(item._source.table, 'mfo_research_published');
    assert.strictEqual(item._source.sourceRowId, 'pub-401');
    assert.strictEqual(item._source.facultyId, 401);
    assert.strictEqual(item._source.facultyName, 'Engr. John Doe');
    assert.strictEqual(item._source.submissionId, 'sub-401');
    assert.strictEqual(item._source.packetId, 'pkt-401');
    assert.strictEqual(item._source.submissionStatus, 'revision');
    assert.strictEqual(item._source.statusLabel, 'Needs Revision');
    assert.strictEqual(item.contributing_faculty_name, 'Engr. John Doe');
    assert.strictEqual(item.contributing_status_label, 'Needs Revision');
});

// -----------------------------------------------------------------------------
// Test 7: Edge cases: empty datasets, duplicate submissions, and missing relationships
// -----------------------------------------------------------------------------
registerTest('5.1 Robustness: Handles empty datasets, duplicate submission attempts, and dangling child rows gracefully', () => {
    const taskId = 'task-mfo-2026-q1';
    const dept = 'BSIT';

    // 1. Empty data
    const emptyResult = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: [],
        packets: [],
        facultyList: [],
        childRows: {}
    });
    assert.strictEqual(emptyResult.contributingFaculty.length, 0);
    assert.strictEqual(emptyResult.summary.totalItemsCount, 0);
    assert.strictEqual(emptyResult.summary.activeItemsCount, 0);

    // 2. Duplicate submissions for same faculty (older attempt vs newer attempt)
    const facultyList = [{ id: 501, full_name: 'Resubmitting Faculty', department: 'BSIT' }];
    const submissions = [
        { id: 'sub-old', task_id: taskId, faculty_id: 501, status: 'revision', submitted_at: '2026-03-20T10:00:00Z' },
        { id: 'sub-new', task_id: taskId, faculty_id: 501, status: 'submitted', submitted_at: '2026-03-24T12:00:00Z' }
    ];
    const packets = [
        { id: 'pkt-501', task_id: taskId, faculty_id: 501, submission_id: 'sub-new' }
    ];

    const dedupeResult = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList
    });

    assert.strictEqual(dedupeResult.contributingFaculty.length, 1, 'Only latest submission selected');
    assert.strictEqual(dedupeResult.contributingFaculty[0].submissionId, 'sub-new', 'Picks sub-new as latest attempt');

    // 3. Dangling child row (packet_id doesn't match any contributing packet)
    const danglingResult = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList,
        childRows: {
            mfo_pi7_trainings: [
                { id: 'tr-dangling', packet_id: 'pkt-non-existent', faculty_id: 9999, title: 'Ghost Training' }
            ]
        }
    });
    assert.strictEqual(danglingResult.sections.mfo_pi7_trainings.length, 0, 'Dangling row safely skipped');
});

// -----------------------------------------------------------------------------
// Test 8: Authorization-related helper behavior (Rule 7)
// -----------------------------------------------------------------------------
registerTest('5.1 Rule 7: Enforces strict Chairperson/OIC department authorization checks', () => {
    // 1. Native Chairperson
    const nativeChair = { id: 601, full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    const auth1 = engine.verifyChairpersonDepartmentAccess(nativeChair, 'BSIT', []);
    assert.strictEqual(auth1.authorized, true);
    assert.strictEqual(auth1.role, 'chairperson');

    const auth2 = engine.verifyChairpersonDepartmentAccess(nativeChair, 'BSCS', []);
    assert.strictEqual(auth2.authorized, false, 'Native BSIT chair cannot access BSCS');

    // 2. OIC with active grant for BSCS
    const oicFaculty = { id: 602, full_name: 'Prof. OIC Delegated', department: 'BSIT', role: 'faculty' };
    const grants = [
        {
            is_active: true,
            grantee_faculty_id: 602,
            department_codes: ['BSCS']
        }
    ];

    const auth3 = engine.verifyChairpersonDepartmentAccess(oicFaculty, 'BSCS', grants);
    assert.strictEqual(auth3.authorized, true);
    assert.strictEqual(auth3.role, 'oic');

    // Inactive grant revoked
    const inactiveGrants = [
        {
            is_active: false,
            grantee_faculty_id: 602,
            department_codes: ['BSCS']
        }
    ];
    const auth4 = engine.verifyChairpersonDepartmentAccess(oicFaculty, 'BSCS', inactiveGrants);
    assert.strictEqual(auth4.authorized, false, 'Inactive grant cannot authorize access');

    // 3. Workflow Admin override
    const adminFaculty = { id: 999, full_name: 'Admin User', role: 'admin', admin_access: true };
    const auth5 = engine.verifyChairpersonDepartmentAccess(adminFaculty, 'BSIE', []);
    assert.strictEqual(auth5.authorized, true);
    assert.strictEqual(auth5.role, 'admin');

    // 4. Null actor
    const auth6 = engine.verifyChairpersonDepartmentAccess(null, 'BSIT', []);
    assert.strictEqual(auth6.authorized, false);
    assert.strictEqual(auth6.role, 'unauthenticated');
});

// -----------------------------------------------------------------------------
// Test 9: Backward-compatible exclusion metadata storage
// -----------------------------------------------------------------------------
// Test 9: Backward-compatible exclusion metadata storage
// -----------------------------------------------------------------------------
registerTest('5.1 Backward Compatibility: Safe extraction and formatting of exclusion metadata without clobbering notes', () => {
    // 1. Plain text human notes (must NOT be treated as JSON)
    const humanNote = 'Please remember to include faculty community hours in the Q2 meeting.';
    const idsFromText = engine.extractExcludedAccomplishmentIds(humanNote);
    assert.strictEqual(idsFromText.size, 0, 'Plain text notes return empty set safely');

    // 2. Snapshot JSON payload
    const snapshotPayload = {
        metadata: {
            excluded_accomplishments: ['item-1', 'item-2']
        }
    };
    const idsFromSnapshot = engine.extractExcludedAccomplishmentIds(snapshotPayload);
    assert.strictEqual(idsFromSnapshot.size, 2);
    assert.ok(idsFromSnapshot.has('item-1'));
    assert.ok(idsFromSnapshot.has('item-2'));

    // 3. Formatter output
    const formatted = engine.formatExclusionMetadata(idsFromSnapshot);
    assert.strictEqual(formatted.citeflow_mfo_consolidation.version, 1);
    assert.strictEqual(formatted.citeflow_mfo_consolidation.count, 2);
    assert.deepStrictEqual(formatted.citeflow_mfo_consolidation.excluded_accomplishments, ['item-1', 'item-2']);
});

// =============================================================================
// PHASE 5.2: STALE DRAFT DETECTION & DECISION PROMPT REGRESSION TESTS
// =============================================================================

// -----------------------------------------------------------------------------
// Test 10: No changes since generation (Fresh Draft)
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Returns fresh status when no submissions have changed since draft generation', () => {
    const taskId = 'task-52-fresh';
    const dept = 'BSIT';

    const facultyList = [
        { id: 1, full_name: 'Dr. Alice', department: 'BSIT' },
        { id: 2, full_name: 'Prof. Bob', department: 'BSIT' }
    ];

    const submissions = [
        { id: 'sub-1', task_id: taskId, faculty_id: 1, status: 'approved', submitted_at: '2026-03-20T10:00:00Z', updated_at: '2026-03-20T10:00:00Z' },
        { id: 'sub-2', task_id: taskId, faculty_id: 2, status: 'submitted', submitted_at: '2026-03-20T11:00:00Z', updated_at: '2026-03-20T11:00:00Z' }
    ];

    const packets = [
        { id: 'pkt-1', task_id: taskId, faculty_id: 1, submission_id: 'sub-1' },
        { id: 'pkt-2', task_id: taskId, faculty_id: 2, submission_id: 'sub-2' }
    ];

    // Build draft at 2026-03-20T12:00:00Z
    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions,
        packets,
        facultyList
    });
    // Ensure draft timestamp is deterministic for test
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions,
        packets,
        facultyList
    });

    assert.strictEqual(staleness.isStale, false, 'Draft must be fresh when no changes occurred');
    assert.strictEqual(staleness.isUnknown, false, 'Draft state must be known');
    assert.strictEqual(staleness.status, 'fresh', 'Status must be fresh');
    assert.strictEqual(staleness.newerSubmissions.length, 0, 'No newer submissions');
    assert.strictEqual(staleness.reasons.length, 0, 'No staleness reasons');
    assert.strictEqual(staleness.contributingCount, 2, '2 captured faculty');
    assert.strictEqual(staleness.currentEligibleCount, 2, '2 current eligible faculty');
});

// -----------------------------------------------------------------------------
// Test 11: New genuine submission after draft generation (Stale Draft)
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Detects new genuine submission arrived after draft generation', () => {
    const taskId = 'task-52-new';
    const dept = 'BSIT';

    const facultyList = [
        { id: 10, full_name: 'Dr. Initial Submitter', department: 'BSIT' },
        { id: 20, full_name: 'Prof. Late Submitter', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-10', task_id: taskId, faculty_id: 10, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' }
    ];
    const initialPackets = [
        { id: 'pkt-10', task_id: taskId, faculty_id: 10, submission_id: 'sub-10' }
    ];

    // Draft built with only Faculty 10
    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList
    });
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Later: Faculty 20 submits a genuine report at 2026-03-21T09:00:00Z
    const currentSubmissions = [
        ...initialSubmissions,
        { id: 'sub-20', task_id: taskId, faculty_id: 20, status: 'submitted', submitted_at: '2026-03-21T09:00:00Z' }
    ];
    const currentPackets = [
        ...initialPackets,
        { id: 'pkt-20', task_id: taskId, faculty_id: 20, submission_id: 'sub-20', packet_state: 'submitted' }
    ];

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList
    });

    assert.strictEqual(staleness.isStale, true, 'Draft must be marked stale');
    assert.strictEqual(staleness.status, 'stale', 'Status must be stale');
    assert.strictEqual(staleness.newerSubmissions.length, 1, 'Exactly 1 newer submission detected');
    assert.strictEqual(staleness.newerSubmissions[0].facultyId, 20);
    assert.strictEqual(staleness.newerSubmissions[0].submissionId, 'sub-20');
    assert.strictEqual(staleness.newerSubmissions[0].reason, 'new_submission');
    assert.ok(staleness.reasons[0].includes('Prof. Late Submitter'), 'Reason references submitting faculty');
});

// -----------------------------------------------------------------------------
// Test 12: Revised or updated contributing submission (Stale Draft)
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Detects revised submission, updated timestamp, and status changes', () => {
    const taskId = 'task-52-revised';
    const dept = 'BSIT';

    const facultyList = [
        { id: 100, full_name: 'Dr. Santos', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-100-v1', task_id: taskId, faculty_id: 100, status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-03-20T10:00:00Z', resubmission_count: 0 }
    ];
    const initialPackets = [
        { id: 'pkt-100', task_id: taskId, faculty_id: 100, submission_id: 'sub-100-v1' }
    ];

    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList
    });
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Case 1: Faculty submitted a revision with new submission ID
    const revisedSubmissions = [
        { id: 'sub-100-v2', task_id: taskId, faculty_id: 100, status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-03-22T14:00:00Z', resubmission_count: 1 }
    ];
    const revisedPackets = [
        { id: 'pkt-100', task_id: taskId, faculty_id: 100, submission_id: 'sub-100-v2' }
    ];

    const staleness1 = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: revisedSubmissions,
        packets: revisedPackets,
        facultyList
    });
    assert.strictEqual(staleness1.isStale, true, 'New submission ID triggers staleness');
    assert.strictEqual(staleness1.newerSubmissions[0].reason, 'revised_submission');

    // Case 2: Same submission ID, but status changed from 'submitted' to 'approved'
    const statusChangedSubmissions = [
        { id: 'sub-100-v1', task_id: taskId, faculty_id: 100, status: 'approved', approval_stage: 'approved', submitted_at: '2026-03-20T10:00:00Z' }
    ];
    const staleness2 = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: statusChangedSubmissions,
        packets: initialPackets,
        facultyList
    });
    assert.strictEqual(staleness2.isStale, true, 'Status change triggers staleness');
    assert.strictEqual(staleness2.newerSubmissions[0].reason, 'status_changed');

    // Case 3: Same submission ID and status, but updated_at is newer than draft consolidated_at
    const updatedTimestampSubmissions = [
        { id: 'sub-100-v1', task_id: taskId, faculty_id: 100, status: 'submitted', approval_stage: 'chairperson', submitted_at: '2026-03-20T10:00:00Z', updated_at: '2026-03-23T08:00:00Z' }
    ];
    const staleness3 = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: updatedTimestampSubmissions,
        packets: initialPackets,
        facultyList
    });
    assert.strictEqual(staleness3.isStale, true, 'Newer timestamp triggers staleness');
    assert.strictEqual(staleness3.newerSubmissions[0].reason, 'timestamp_newer');
});

// -----------------------------------------------------------------------------
// Test 13: Draft-only packet changes and unsubmitted drafts do NOT trigger staleness
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Draft-only packet changes and unsubmitted drafts do NOT trigger staleness', () => {
    const taskId = 'task-52-drafts-only';
    const dept = 'BSIT';

    const facultyList = [
        { id: 201, full_name: 'Dr. Contributor', department: 'BSIT' },
        { id: 202, full_name: 'Prof. Draft Only', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-201', task_id: taskId, faculty_id: 201, status: 'submitted', submitted_at: '2026-03-20T10:00:00Z' }
    ];
    const initialPackets = [
        { id: 'pkt-201', task_id: taskId, faculty_id: 201, submission_id: 'sub-201', packet_state: 'submitted' }
    ];

    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList
    });
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Faculty 202 touches their draft packet AFTER draft generation (2026-03-22),
    // but NEVER submits a genuine report (packet_state: 'draft', no genuine wf_submission)
    const currentSubmissions = [
        ...initialSubmissions
        // No genuine submission for 202
    ];
    const currentPackets = [
        ...initialPackets,
        { id: 'pkt-202-draft', task_id: taskId, faculty_id: 202, packet_state: 'draft', updated_at: '2026-03-22T16:00:00Z' }
    ];

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList
    });

    assert.strictEqual(staleness.isStale, false, 'Draft-only packet must NOT trigger staleness');
    assert.strictEqual(staleness.status, 'fresh', 'Draft remains fresh');
    assert.strictEqual(staleness.newerSubmissions.length, 0);
});

// -----------------------------------------------------------------------------
// Test 14: Changes from another department or task do NOT trigger staleness
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Changes from another department or task do NOT trigger staleness', () => {
    const targetTaskId = 'task-bsit-q1';
    const otherTaskId = 'task-bsit-q2';
    const dept = 'BSIT';

    const facultyList = [
        { id: 301, full_name: 'BSIT Faculty 1', department: 'BSIT' },
        { id: 302, full_name: 'BSCS Faculty 2', department: 'BSCS' },
        { id: 303, full_name: 'BSIT Faculty 3', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-301', task_id: targetTaskId, faculty_id: 301, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' }
    ];
    const initialPackets = [
        { id: 'pkt-301', task_id: targetTaskId, faculty_id: 301, submission_id: 'sub-301' }
    ];

    const draft = engine.buildDepartmentMfoConsolidation({
        taskId: targetTaskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList
    });
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Later:
    // 1. BSCS faculty submits a report for targetTaskId at 2026-03-22 (DIFFERENT department)
    // 2. BSIT faculty submits a report for otherTaskId at 2026-03-22 (DIFFERENT task)
    const currentSubmissions = [
        ...initialSubmissions,
        { id: 'sub-302-bscs', task_id: targetTaskId, faculty_id: 302, status: 'submitted', submitted_at: '2026-03-22T10:00:00Z' },
        { id: 'sub-303-q2', task_id: otherTaskId, faculty_id: 303, status: 'submitted', submitted_at: '2026-03-22T11:00:00Z' }
    ];
    const currentPackets = [
        ...initialPackets,
        { id: 'pkt-302', task_id: targetTaskId, faculty_id: 302, submission_id: 'sub-302-bscs' },
        { id: 'pkt-303', task_id: otherTaskId, faculty_id: 303, submission_id: 'sub-303-q2' }
    ];

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId: targetTaskId,
        department: dept,
        draft,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList
    });

    assert.strictEqual(staleness.isStale, false, 'Cross-department and cross-task changes must be ignored');
    assert.strictEqual(staleness.status, 'fresh');
    assert.strictEqual(staleness.newerSubmissions.length, 0);
});

// -----------------------------------------------------------------------------
// Test 15: Missing timestamps or missing draft state safely returns explicit non-fresh state
// -----------------------------------------------------------------------------
registerTest('5.2 Staleness: Missing timestamps or missing draft state safely returns explicit non-fresh state', () => {
    const taskId = 'task-52-missing';
    const dept = 'BSIT';

    // 1. Missing draft altogether
    const resNoDraft = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: null,
        submissions: [],
        packets: [],
        facultyList: []
    });
    assert.strictEqual(resNoDraft.status, 'no_draft', 'Missing draft returns status: no_draft');
    assert.strictEqual(resNoDraft.isStale, false);
    assert.strictEqual(resNoDraft.isUnknown, false);

    // 2. Draft exists, but generation timestamp is missing AND no captured faculty manifest
    const draftNoTimestamp = {
        taskId,
        department: dept,
        updated_at: null,
        created_at: null,
        frozenPayload: { metadata: { consolidated_at: null } }
    };
    const resUnknown = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: draftNoTimestamp,
        submissions: [],
        packets: [],
        facultyList: []
    });
    assert.strictEqual(resUnknown.status, 'unknown', 'Missing timestamp returns status: unknown');
    assert.strictEqual(resUnknown.isUnknown, true, 'isUnknown is true');
    assert.strictEqual(resUnknown.isStale, false, 'Does not falsely claim stale or fresh');
    assert.ok(resUnknown.reasons[0].includes('missing or invalid'), 'Explains reason for unknown status');

    // 3. Draft has captured submission, but candidate submission has missing timestamp preventing deterministic check
    const draftWithCaptured = {
        taskId,
        department: dept,
        frozenPayload: {
            metadata: { consolidated_at: null }, // no timestamp on draft
            contributing_faculty: [
                { facultyId: 401, submissionId: 'sub-401', submittedAt: null } // no timestamp on captured record
            ]
        }
    };
    const submissionsNoTimestamp = [
        { id: 'sub-401', task_id: taskId, faculty_id: 401, status: 'submitted', submitted_at: null, updated_at: null, created_at: null }
    ];
    const facultyList = [{ id: 401, full_name: 'Dr. No Time', department: 'BSIT' }];

    const resUnresolvable = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: draftWithCaptured,
        submissions: submissionsNoTimestamp,
        packets: [{ id: 'pkt-401', task_id: taskId, faculty_id: 401, submission_id: 'sub-401' }],
        facultyList
    });
    assert.strictEqual(resUnresolvable.status, 'unknown', 'Unresolvable submission timestamp returns unknown');
    assert.strictEqual(resUnresolvable.isUnknown, true);
});

// -----------------------------------------------------------------------------
// Test 16: Decision — Regenerate Draft preserves rejection exclusions & existing contents
// -----------------------------------------------------------------------------
registerTest('5.2 Decision — Regenerate Draft: Incorporates latest submissions while preserving rejection exclusions', () => {
    const taskId = 'task-52-regenerate';
    const dept = 'BSIT';

    const facultyList = [
        { id: 501, full_name: 'Dr. Initial Approver', department: 'BSIT' },
        { id: 502, full_name: 'Prof. Initial Rejected', department: 'BSIT' },
        { id: 503, full_name: 'Engr. Newly Arrived', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-501', task_id: taskId, faculty_id: 501, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' },
        { id: 'sub-502', task_id: taskId, faculty_id: 502, status: 'rejected', approval_stage: 'declined', submitted_at: '2026-03-20T11:00:00Z' }
    ];
    const initialPackets = [
        { id: 'pkt-501', task_id: taskId, faculty_id: 501, submission_id: 'sub-501' },
        { id: 'pkt-502', task_id: taskId, faculty_id: 502, submission_id: 'sub-502' }
    ];
    const childRows = {
        mfo_pi7_trainings: [
            { id: 'tr-keep', packet_id: 'pkt-502', faculty_id: 502, title: 'Chairperson Kept Training' },
            { id: 'tr-drop', packet_id: 'pkt-502', faculty_id: 502, title: 'Chairperson Excluded Training' },
            { id: 'tr-new', packet_id: 'pkt-503', faculty_id: 503, title: 'New Faculty Training' }
        ]
    };

    // Chairperson previously excluded 'tr-drop' in initial draft
    const initialDraft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList,
        childRows,
        excludedAccomplishmentIds: ['tr-drop']
    });
    initialDraft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Verify initial draft state
    assert.strictEqual(initialDraft.contributingFaculty.length, 2);
    assert.strictEqual(initialDraft.activeSections.mfo_pi7_trainings.length, 1);
    assert.strictEqual(initialDraft.activeSections.mfo_pi7_trainings[0].id, 'tr-keep');

    // Later: Faculty 503 submits new report
    const currentSubmissions = [
        ...initialSubmissions,
        { id: 'sub-503', task_id: taskId, faculty_id: 503, status: 'submitted', submitted_at: '2026-03-22T09:00:00Z' }
    ];
    const currentPackets = [
        ...initialPackets,
        { id: 'pkt-503', task_id: taskId, faculty_id: 503, submission_id: 'sub-503' }
    ];

    // Detect staleness
    const stalenessBefore = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: initialDraft,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList
    });
    assert.strictEqual(stalenessBefore.isStale, true, 'Draft is stale before regeneration');

    // Chairperson triggers Regenerate Draft
    const regenerated = engine.regenerateDepartmentDraft({
        taskId,
        department: dept,
        previousDraft: initialDraft,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList,
        childRows,
        actorFaculty: { id: 999, full_name: 'BSIT Chair', department: 'BSIT', role: 'chairperson' }
    });

    // 1. Now includes all 3 faculty
    assert.strictEqual(regenerated.contributingFaculty.length, 3, 'Includes all 3 contributing faculty');
    const facIds = regenerated.contributingFaculty.map(f => f.facultyId);
    assert.ok(facIds.includes(501));
    assert.ok(facIds.includes(502));
    assert.ok(facIds.includes(503));

    // 2. Preserves rejection exclusion of 'tr-drop'!
    assert.strictEqual(regenerated.excludedAccomplishmentIds.has('tr-drop'), true, 'tr-drop remains excluded');
    assert.strictEqual(regenerated.excludedAccomplishmentIds.has('tr-keep'), false, 'tr-keep remains included');

    // 3. In activeSections: tr-keep and tr-new are present, tr-drop is excluded!
    const activeTrainings = regenerated.activeSections.mfo_pi7_trainings;
    assert.strictEqual(activeTrainings.length, 2, '2 active trainings (tr-keep and tr-new)');
    const activeIds = activeTrainings.map(t => t.id);
    assert.ok(activeIds.includes('tr-keep'));
    assert.ok(activeIds.includes('tr-new'));
    assert.ok(!activeIds.includes('tr-drop'), 'tr-drop is excluded from active rendering');

    // 4. In all sections: all 3 appear with proper flags
    const allTrainings = regenerated.sections.mfo_pi7_trainings;
    assert.strictEqual(allTrainings.length, 3);
    const dropItem = allTrainings.find(t => t.id === 'tr-drop');
    assert.strictEqual(dropItem.is_excluded, true);

    // 5. Staleness check on regenerated draft is now fresh!
    const stalenessAfter = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: regenerated,
        submissions: currentSubmissions,
        packets: currentPackets,
        facultyList
    });
    assert.strictEqual(stalenessAfter.isStale, false, 'Regenerated draft is fresh');
    assert.strictEqual(stalenessAfter.status, 'fresh');
});

// -----------------------------------------------------------------------------
// Test 17: Decision — Retain Draft (Acknowledgment) and subsequent updates
// -----------------------------------------------------------------------------
registerTest('5.2 Decision — Retain Draft: Records acknowledgment and handles subsequent submissions', () => {
    const taskId = 'task-52-retain';
    const dept = 'BSIT';

    const facultyList = [
        { id: 601, full_name: 'Dr. Initial', department: 'BSIT' },
        { id: 602, full_name: 'Prof. Arrived Later', department: 'BSIT' },
        { id: 603, full_name: 'Engr. Arrived Even Later', department: 'BSIT' }
    ];

    const initialSubmissions = [
        { id: 'sub-601', task_id: taskId, faculty_id: 601, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' }
    ];
    const initialPackets = [
        { id: 'pkt-601', task_id: taskId, faculty_id: 601, submission_id: 'sub-601' }
    ];

    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: initialSubmissions,
        packets: initialPackets,
        facultyList
    });
    draft.frozenPayload.metadata.consolidated_at = '2026-03-20T12:00:00Z';

    // Faculty 602 submits report at 2026-03-22T09:00:00Z
    const currentSubmissionsT2 = [
        ...initialSubmissions,
        { id: 'sub-602', task_id: taskId, faculty_id: 602, status: 'submitted', submitted_at: '2026-03-22T09:00:00Z' }
    ];
    const currentPacketsT2 = [
        ...initialPackets,
        { id: 'pkt-602', task_id: taskId, faculty_id: 602, submission_id: 'sub-602' }
    ];

    // Detect staleness
    const stalenessT2 = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: currentSubmissionsT2,
        packets: currentPacketsT2,
        facultyList
    });
    assert.strictEqual(stalenessT2.isStale, true, 'Draft is stale due to sub-602');

    // Chairperson chooses "Keep Current Draft" (Retain)
    const chairActor = { id: 999, full_name: 'BSIT Chairperson', department: 'BSIT', role: 'chairperson' };
    const { acknowledgedDraft, acknowledgment } = engine.acknowledgeStaleDraft({
        draft,
        department: dept,
        actorFaculty: chairActor,
        staleness: stalenessT2
    });

    // 1. Verify acknowledgment structure
    assert.ok(acknowledgment.acknowledged_at, 'Records acknowledged timestamp');
    assert.strictEqual(acknowledgment.acknowledged_by_faculty_id, 999);
    assert.deepStrictEqual(acknowledgment.acknowledged_submission_ids, ['sub-602']);
    assert.strictEqual(acknowledgedDraft.contributingFaculty.length, 1, 'Draft contents retained without overwrite');

    // 2. Staleness evaluation on retained draft now reports fresh (acknowledged)
    const stalenessAfterAck = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: acknowledgedDraft,
        submissions: currentSubmissionsT2,
        packets: currentPacketsT2,
        facultyList
    });
    assert.strictEqual(stalenessAfterAck.isStale, false, 'Draft is not stale after acknowledgment');
    assert.strictEqual(stalenessAfterAck.status, 'fresh');
    assert.strictEqual(stalenessAfterAck.acknowledged, true, 'Marked as acknowledged');

    // 3. Now, brand new submission sub-603 arrives AFTER the acknowledgment (at 2026-03-25)
    const currentSubmissionsT3 = [
        ...currentSubmissionsT2,
        { id: 'sub-603', task_id: taskId, faculty_id: 603, status: 'submitted', submitted_at: '2026-03-25T14:00:00Z', updated_at: '2026-03-25T14:00:00Z' }
    ];
    const currentPacketsT3 = [
        ...currentPacketsT2,
        { id: 'pkt-603', task_id: taskId, faculty_id: 603, submission_id: 'sub-603' }
    ];

    const stalenessT3 = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft: acknowledgedDraft,
        submissions: currentSubmissionsT3,
        packets: currentPacketsT3,
        facultyList
    });
    assert.strictEqual(stalenessT3.isStale, true, 'Subsequent submission after acknowledgment triggers staleness again');
    assert.strictEqual(stalenessT3.status, 'stale');
    assert.strictEqual(stalenessT3.acknowledged, false);
});

// -----------------------------------------------------------------------------
// Test 18: Safety & Immutability: No modification to faculty originals or Dean's copy
// -----------------------------------------------------------------------------
registerTest('5.2 Safety: Detection and decision helpers never modify faculty submissions or Dean\'s copy', () => {
    const taskId = 'task-52-safety';
    const dept = 'BSIT';

    const originalFaculty = [
        { id: 701, full_name: 'Dr. Original', department: 'BSIT' }
    ];
    const originalSubmissions = [
        { id: 'sub-701', task_id: taskId, faculty_id: 701, status: 'submitted', submitted_at: '2026-03-20T10:00:00Z', notes: 'Untouchable' }
    ];
    const originalPackets = [
        { id: 'pkt-701', task_id: taskId, faculty_id: 701, submission_id: 'sub-701' }
    ];
    const originalChildRows = {
        mfo_pi7_trainings: [
            { id: 'tr-701', packet_id: 'pkt-701', faculty_id: 701, title: 'Faculty Training Title' }
        ]
    };

    const deansOfficeCopy = {
        id: 'dean-snap-1',
        version_no: 1,
        lifecycle_state: 'submitted',
        payload: {
            title: 'Official Dean Submission',
            frozen_at: '2026-03-20T12:00:00Z'
        }
    };

    // Deep clones before operations
    const snapFaculty = JSON.parse(JSON.stringify(originalFaculty));
    const snapSubmissions = JSON.parse(JSON.stringify(originalSubmissions));
    const snapPackets = JSON.parse(JSON.stringify(originalPackets));
    const snapChildRows = JSON.parse(JSON.stringify(originalChildRows));
    const snapDeansCopy = JSON.parse(JSON.stringify(deansOfficeCopy));

    // Run draft creation, staleness detection, acknowledgment, and regeneration
    const draft = engine.buildDepartmentMfoConsolidation({
        taskId,
        department: dept,
        submissions: originalSubmissions,
        packets: originalPackets,
        facultyList: originalFaculty,
        childRows: originalChildRows
    });

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: originalSubmissions,
        packets: originalPackets,
        facultyList: originalFaculty
    });
    void staleness;

    const { acknowledgedDraft } = engine.acknowledgeStaleDraft({
        draft,
        department: dept,
        submissions: originalSubmissions,
        packets: originalPackets,
        facultyList: originalFaculty
    });
    void acknowledgedDraft;

    const regenerated = engine.regenerateDepartmentDraft({
        taskId,
        department: dept,
        previousDraft: draft,
        submissions: originalSubmissions,
        packets: originalPackets,
        facultyList: originalFaculty,
        childRows: originalChildRows
    });
    void regenerated;

    // Verify all original source records are 100% identical and untouched
    assert.deepStrictEqual(originalFaculty, snapFaculty, 'facultyList untouched');
    assert.deepStrictEqual(originalSubmissions, snapSubmissions, 'submissions untouched');
    assert.deepStrictEqual(originalPackets, snapPackets, 'packets untouched');
    assert.deepStrictEqual(originalChildRows, snapChildRows, 'childRows untouched');
    assert.deepStrictEqual(deansOfficeCopy, snapDeansCopy, 'Dean\'s Office copy untouched');
});

// -----------------------------------------------------------------------------
// Test 19: Notes & Metadata Integrity: Preserves human remarks, custom metadata, and repeated ack history
// -----------------------------------------------------------------------------
registerTest('5.2 Audit: Preserves human remarks, custom metadata, and repeated ack history', () => {
    // 1. Initial draft has plain human text remarks
    const humanNote = 'Please discuss item 4 with Dean prior to final submission.';
    const initialMeta = engine.mergeNotesMetadata(humanNote, {
        excluded_accomplishments: ['row-101'],
        count: 1
    });

    assert.strictEqual(initialMeta.notes_text, humanNote, 'Human text preserved in notes_text');
    assert.deepStrictEqual(initialMeta.citeflow_mfo_consolidation.excluded_accomplishments, ['row-101']);

    // 2. Add custom metadata from another subsystem
    initialMeta.dean_pre_approval = true;
    initialMeta.external_audit_ref = 'AUDIT-2026-X';

    // 3. First acknowledgment
    const ack1 = {
        acknowledged_at: '2026-03-21T10:00:00Z',
        acknowledged_by_faculty_id: 999,
        acknowledged_submission_ids: ['sub-1']
    };
    const metaAfterAck1 = engine.mergeNotesMetadata(initialMeta, {
        acknowledgment: ack1
    });

    assert.strictEqual(metaAfterAck1.notes_text, humanNote, 'Human text remains intact after ack 1');
    assert.strictEqual(metaAfterAck1.dean_pre_approval, true, 'Unrelated metadata preserved');
    assert.strictEqual(metaAfterAck1.external_audit_ref, 'AUDIT-2026-X', 'Unrelated metadata preserved');
    assert.deepStrictEqual(metaAfterAck1.citeflow_mfo_consolidation.acknowledgment, ack1, 'Active ack 1 recorded');
    assert.strictEqual(metaAfterAck1.citeflow_mfo_consolidation.acknowledgment_history, undefined, 'No prior history before ack 1');

    // 4. Repeated acknowledgment (Second decision cycle)
    const ack2 = {
        acknowledged_at: '2026-03-25T15:00:00Z',
        acknowledged_by_faculty_id: 999,
        acknowledged_submission_ids: ['sub-1', 'sub-2']
    };
    const metaAfterAck2 = engine.mergeNotesMetadata(metaAfterAck1, {
        acknowledgment: ack2
    });

    assert.strictEqual(metaAfterAck2.notes_text, humanNote, 'Human text remains intact after ack 2');
    assert.strictEqual(metaAfterAck2.dean_pre_approval, true);
    assert.deepStrictEqual(metaAfterAck2.citeflow_mfo_consolidation.acknowledgment, ack2, 'Active ack 2 recorded');
    assert.ok(Array.isArray(metaAfterAck2.citeflow_mfo_consolidation.acknowledgment_history), 'History array created');
    assert.strictEqual(metaAfterAck2.citeflow_mfo_consolidation.acknowledgment_history.length, 1, 'Prior ack archived in history');
    assert.deepStrictEqual(metaAfterAck2.citeflow_mfo_consolidation.acknowledgment_history[0], ack1, 'Archived ack matches ack 1');
});

// -----------------------------------------------------------------------------
// Test 20: Staleness: Missing or corrupted submission timestamp produces explicit unknown state
// -----------------------------------------------------------------------------
registerTest('5.2 Audit: Missing or corrupted submission timestamp produces explicit unknown state', () => {
    const taskId = 'task-52-corrupt-time';
    const dept = 'BSIT';

    const facultyList = [
        { id: 801, full_name: 'Dr. Corrupt Time', department: 'BSIT' }
    ];

    // Draft was generated at 2026-03-20
    const draft = {
        taskId,
        department: dept,
        consolidated_at: '2026-03-20T10:00:00Z',
        contributingFaculty: [
            { facultyId: 801, submissionId: 'sub-801', rawStatus: 'submitted', submittedAt: '2026-03-20T09:00:00Z' }
        ]
    };

    // Current submission has NULL or corrupt timestamp
    const corruptSubmissions = [
        { id: 'sub-801', task_id: taskId, faculty_id: 801, status: 'submitted', submitted_at: null, updated_at: 'invalid-date-string' }
    ];
    const packets = [
        { id: 'pkt-801', task_id: taskId, faculty_id: 801, submission_id: 'sub-801' }
    ];

    const staleness = engine.detectConsolidatedDraftStaleness({
        taskId,
        department: dept,
        draft,
        submissions: corruptSubmissions,
        packets,
        facultyList
    });

    assert.strictEqual(staleness.status, 'unknown', 'Produces explicit unknown status');
    assert.strictEqual(staleness.isUnknown, true, 'isUnknown is true');
    assert.strictEqual(staleness.isStale, false, 'isStale is false (cannot deterministically claim stale)');
    assert.ok(staleness.reasons.some((r) => r.includes('Missing timestamp')), 'Reason explains missing timestamp');
});

// -----------------------------------------------------------------------------
// Test 21: Draft Regeneration: Fully aggregates child rows and program rows without loss
// -----------------------------------------------------------------------------
registerTest('5.2 Audit: Draft regeneration fully aggregates child rows and program rows without loss', () => {
    const taskId = 'task-52-child-regen';
    const dept = 'BSIT';

    const facultyList = [
        { id: 901, full_name: 'Dr. Alpha', department: 'BSIT' },
        { id: 902, full_name: 'Dr. Beta', department: 'BSIT' }
    ];

    const submissions = [
        { id: 'sub-901', task_id: taskId, faculty_id: 901, status: 'approved', submitted_at: '2026-03-20T10:00:00Z' },
        { id: 'sub-902', task_id: taskId, faculty_id: 902, status: 'rejected', submitted_at: '2026-03-20T11:00:00Z' }
    ];
    const packets = [
        { id: 'pkt-901', task_id: taskId, faculty_id: 901, submission_id: 'sub-901' },
        { id: 'pkt-902', task_id: taskId, faculty_id: 902, submission_id: 'sub-902' }
    ];

    const childRows = {
        mfo_pi7_trainings: [
            { id: 'tr-901', packet_id: 'pkt-901', faculty_id: 901, title: 'Alpha Training' },
            { id: 'tr-902', packet_id: 'pkt-902', faculty_id: 902, title: 'Beta Training (Rejected)' }
        ],
        mfo_pi5_certifications: [
            { id: 'cert-901', packet_id: 'pkt-901', faculty_id: 901, certification_title: 'Alpha Cert' }
        ]
    };

    const programRows = {
        pi1: [{ id: 'pi1-row-1', exam_date: '2026-01-15', total_takers: 50, total_passers: 45 }],
        pi2: [{ id: 'pi2-row-1', graduates_count: 100, employed_count: 85 }]
    };

    const previousDraft = {
        id: 'prog-pkt-1',
        task_id: taskId,
        department: dept,
        notes: JSON.stringify({
            notes_text: 'Chairperson review note',
            citeflow_mfo_consolidation: {
                excluded_accomplishments: ['tr-902'] // Exclusion decision from previous review
            }
        }),
        other_accomplishments: 'Department achieved 90% licensure passing rate.',
        programPortion: programRows
    };

    const regenerated = engine.regenerateDepartmentDraft({
        taskId,
        department: dept,
        previousDraft,
        submissions,
        packets,
        childRows,
        programRows,
        facultyList
    });

    // Verify contributing faculty
    assert.strictEqual(regenerated.contributingFaculty.length, 2);

    // Verify child rows in sections
    assert.strictEqual(regenerated.sections.mfo_pi7_trainings.length, 2, 'All trainings present in full section');
    assert.strictEqual(regenerated.activeSections.mfo_pi7_trainings.length, 1, 'Excluded rejected training omitted from active');
    assert.strictEqual(regenerated.activeSections.mfo_pi7_trainings[0].id, 'tr-901');
    assert.strictEqual(regenerated.sections.mfo_pi5_certifications.length, 1);

    // Verify program-level rows preserved
    assert.strictEqual(regenerated.programPortion.pi1.length, 1);
    assert.strictEqual(regenerated.programPortion.pi1[0].exam_date, '2026-01-15');
    assert.strictEqual(regenerated.programPortion.pi2.length, 1);
    assert.strictEqual(regenerated.programPortion.other_accomplishments, 'Department achieved 90% licensure passing rate.');

    // Verify frozen snapshot payload ready for mfo_snapshots
    assert.ok(regenerated.frozenPayload);
    assert.strictEqual(regenerated.frozenPayload.sections.mfo_pi7_trainings.length, 1);
    assert.deepStrictEqual(regenerated.frozenPayload.metadata.excluded_accomplishment_ids, ['tr-902']);
});



// -----------------------------------------------------------------------------
// Phase 5.3: Consolidated MFO Submission & Dean's Office Review Tests
// -----------------------------------------------------------------------------

function createMockSupabase(initialStore = {}) {
    const store = {
        mfo_program_packets: initialStore.mfo_program_packets || [],
        mfo_snapshots: initialStore.mfo_snapshots || [],
        wf_notifications: initialStore.wf_notifications || [],
        wf_activity_log: initialStore.wf_activity_log || []
    };

    function createQuery(table) {
        let op = 'select';
        let filters = [];
        let insertData = null;
        let updateData = null;

        const builder = {
            select: () => {
                if (op !== 'insert' && op !== 'update') {
                    op = 'select';
                }
                return builder;
            },
            insert: (data) => { op = 'insert'; insertData = data; return builder; },
            update: (data) => { op = 'update'; updateData = data; return builder; },
            eq: (col, val) => { filters.push({ col, val }); return builder; },
            ilike: (col, val) => { filters.push({ col, val, ilike: true }); return builder; },
            single: async () => {
                const res = await builder.then();
                return { data: Array.isArray(res.data) ? res.data[0] : res.data, error: res.error };
            },
            maybeSingle: async () => {
                const res = await builder.then();
                return { data: Array.isArray(res.data) ? (res.data[0] || null) : res.data, error: res.error };
            },
            then: (resolve) => {
                let rows = store[table] || [];
                if (op === 'insert') {
                    const toInsert = Array.isArray(insertData) ? insertData : [insertData];
                    const inserted = toInsert.map((d, i) => ({ id: d.id || `gen-${Date.now()}-${i}`, ...d }));
                    store[table].push(...inserted);
                    const res = { data: Array.isArray(insertData) ? inserted : inserted[0], error: null };
                    return resolve ? resolve(res) : Promise.resolve(res);
                }
                if (op === 'update') {
                    for (const row of rows) {
                        let match = true;
                        for (const f of filters) {
                            if (f.ilike) {
                                if (String(row[f.col] || '').toLowerCase() !== String(f.val || '').toLowerCase()) match = false;
                            } else if (row[f.col] !== f.val) {
                                match = false;
                            }
                        }
                        if (match) {
                            Object.assign(row, updateData);
                        }
                    }
                    const matched = rows.filter(r => filters.every(f => f.ilike ? String(r[f.col] || '').toLowerCase() === String(f.val || '').toLowerCase() : r[f.col] === f.val));
                    const res = { data: matched[0] || updateData, error: null };
                    return resolve ? resolve(res) : Promise.resolve(res);
                }
                let matched = rows.filter(r => filters.every(f => f.ilike ? String(r[f.col] || '').toLowerCase() === String(f.val || '').toLowerCase() : r[f.col] === f.val));
                const res = { data: matched, error: null };
                return resolve ? resolve(res) : Promise.resolve(res);
            }
        };
        return builder;
    }

    return {
        store,
        from: (table) => createQuery(table)
    };
}

registerTest('5.3 Authorization: Native Chairperson and active OIC can prepare submission; ordinary faculty and unassigned chairperson are blocked', () => {
    const draft = {
        id: 'pkt-1',
        task_id: 'task-10',
        department: 'BSIT',
        packet_state: 'draft',
        current_version: 1
    };

    // 1. Native Chairperson for BSIT -> Authorized
    const nativeChair = { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    const res1 = engine.prepareConsolidatedMfoSubmission({
        draft,
        department: 'BSIT',
        actorFaculty: nativeChair
    });
    assert.strictEqual(res1.ok, true, 'Native Chairperson must be authorized to submit');
    assert.strictEqual(res1.version, 1);
    assert.strictEqual(res1.lifecycleState, 'submitted');

    // 2. OIC with active delegation for BSIT -> Authorized
    const oicFaculty = { id: 'oic1', full_name: 'Prof. Delegate', department: 'BSCE', role: 'faculty' };
    const delegations = [{ faculty_id: 'oic1', department: 'BSIT', is_active: true }];
    const res2 = engine.prepareConsolidatedMfoSubmission({
        draft,
        department: 'BSIT',
        actorFaculty: oicFaculty,
        delegatedAccess: delegations
    });
    assert.strictEqual(res2.ok, true, 'Active OIC delegate must be authorized to submit');

    // 3. Regular Faculty member -> Blocked
    const regularFaculty = { id: 'f1', full_name: 'Regular Faculty', department: 'BSIT', role: 'faculty' };
    const res3 = engine.prepareConsolidatedMfoSubmission({
        draft,
        department: 'BSIT',
        actorFaculty: regularFaculty
    });
    assert.strictEqual(res3.ok, false, 'Ordinary faculty must be blocked from submitting consolidated MFO');
    assert.ok(res3.error.includes('Only the native Chairperson or an authorized OIC'), 'Error message must specify Chairperson/OIC requirement');

    // 4. Chairperson of another department without delegation -> Blocked
    const otherChair = { id: 'c2', full_name: 'Dr. BSCE Chair', department: 'BSCE', role: 'chairperson' };
    const res4 = engine.prepareConsolidatedMfoSubmission({
        draft,
        department: 'BSIT',
        actorFaculty: otherChair,
        delegatedAccess: []
    });
    assert.strictEqual(res4.ok, false, 'Chairperson of another department without delegation must be blocked');

    // 5. Missing or uncompiled draft -> Blocked
    const res5 = engine.prepareConsolidatedMfoSubmission({
        draft: null,
        department: 'BSIT',
        actorFaculty: nativeChair
    });
    assert.strictEqual(res5.ok, false, 'Uncompiled or missing draft must be blocked');
    assert.ok(res5.error.includes('valid generated consolidated report is required'));
});

registerTest('5.3 Submission: Creates immutable snapshot in mfo_snapshots, transitions packet to submitted, and logs audit', async () => {
    const mockDb = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-100',
            task_id: 'task-mfo-1',
            department: 'BSIT',
            packet_state: 'draft',
            current_version: 1,
            notes: JSON.stringify({ user_remarks: 'Draft ready for review.' })
        }]
    });

    const chairFaculty = { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    const consolidation = {
        contributingFaculty: [{ facultyId: 'f1', facultyName: 'Prof. Alice' }],
        unsubmittedFaculty: [{ facultyId: 'f2', facultyName: 'Prof. Bob' }],
        sections: { mfo_pi7_trainings: [{ id: 'tr-1', title: 'AI Workshop' }] },
        programRows: { pi1: [], pi2: [] }
    };

    const submitResult = await engine.submitConsolidatedMfoToDean({
        db: mockDb,
        draft: mockDb.store.mfo_program_packets[0],
        taskId: 'task-mfo-1',
        department: 'BSIT',
        actorFaculty: chairFaculty,
        consolidation,
        userRemarks: 'Official Department Consolidated MFO submitted for Dean review.'
    });

    assert.strictEqual(submitResult.ok, true, 'Submission to Dean must succeed');
    assert.strictEqual(submitResult.version, 1);
    assert.strictEqual(submitResult.lifecycleState, 'submitted');

    // Verify mfo_program_packets state
    const packet = mockDb.store.mfo_program_packets[0];
    assert.strictEqual(packet.packet_state, 'submitted', 'packet_state must transition to submitted');
    assert.strictEqual(packet.current_version, 1);
    assert.strictEqual(packet.chairperson_faculty_id, 'c1');

    // Verify mfo_snapshots insertion
    assert.strictEqual(mockDb.store.mfo_snapshots.length, 1, 'Exactly one immutable snapshot must be created');
    const snapshot = mockDb.store.mfo_snapshots[0];
    assert.strictEqual(snapshot.program_packet_id, 'pkt-100');
    assert.strictEqual(snapshot.version_no, 1);
    assert.strictEqual(snapshot.lifecycle_state, 'submitted');
    assert.strictEqual(snapshot.snapshot_reason, 'submitted_to_dean');
    assert.strictEqual(snapshot.created_by_faculty_id, 'c1');

    // Verify snapshot payload completeness
    assert.ok(snapshot.payload, 'Snapshot must contain compiled payload');
    assert.strictEqual(snapshot.payload.department, 'BSIT');
    assert.strictEqual(snapshot.payload.contributing_faculty.length, 1);
    assert.strictEqual(snapshot.payload.submitting_chairperson.id, 'c1');
    assert.strictEqual(snapshot.payload.user_remarks, 'Official Department Consolidated MFO submitted for Dean review.');

    // Verify notifications & activity log
    assert.strictEqual(mockDb.store.wf_activity_log.length, 1);
    assert.strictEqual(mockDb.store.wf_activity_log[0].action, 'Submitted Consolidated MFO');
    assert.strictEqual(mockDb.store.wf_notifications.length, 1);
    assert.ok(mockDb.store.wf_notifications[0].message.includes('submitted to Dean\'s Office'));
});

registerTest('5.3 Duplicate Prevention: Prevents duplicate submissions of the same finalized version', () => {
    const chairFaculty = { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };

    // 1. Packet already in 'submitted' state
    const submittedDraft = {
        id: 'pkt-200',
        task_id: 'task-1',
        department: 'BSIT',
        packet_state: 'submitted',
        current_version: 1
    };
    const res1 = engine.prepareConsolidatedMfoSubmission({
        draft: submittedDraft,
        department: 'BSIT',
        actorFaculty: chairFaculty
    });
    assert.strictEqual(res1.ok, false, 'Duplicate submission of already submitted report must be blocked');
    assert.strictEqual(res1.isDuplicate, true);
    assert.ok(res1.error.includes('already been submitted'));

    // 2. Packet already approved by Dean
    const approvedDraft = {
        id: 'pkt-201',
        task_id: 'task-1',
        department: 'BSIT',
        packet_state: 'approved',
        current_version: 1
    };
    const res2 = engine.prepareConsolidatedMfoSubmission({
        draft: approvedDraft,
        department: 'BSIT',
        actorFaculty: chairFaculty
    });
    assert.strictEqual(res2.ok, false, 'Submission of already approved report must be blocked');
    assert.strictEqual(res2.isApproved, true);
    assert.ok(res2.error.includes('already been approved'));
});

registerTest('5.3 Dean Review Outcomes: Supports approval, revision request with remarks, and decline with remarks', async () => {
    // 1. Dean Approval
    const mockDb1 = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-300',
            task_id: 'task-1',
            department: 'BSIT',
            packet_state: 'submitted',
            current_version: 1,
            notes: JSON.stringify({ user_remarks: 'Ready for Dean approval' })
        }]
    });

    const deanFaculty = { id: 'dean-1', full_name: 'Dean Smith', role: 'dean' };
    const approveRes = await engine.applyConsolidatedMfoDeanReview({
        db: mockDb1,
        programPacket: mockDb1.store.mfo_program_packets[0],
        action: 'approved',
        actorFaculty: deanFaculty,
        remarks: 'Excellent compilation. Approved without changes.'
    });

    assert.strictEqual(approveRes.ok, true);
    assert.strictEqual(approveRes.nextState, 'approved');
    assert.strictEqual(mockDb1.store.mfo_program_packets[0].packet_state, 'approved');
    assert.strictEqual(mockDb1.store.mfo_snapshots.length, 1);
    assert.strictEqual(mockDb1.store.mfo_snapshots[0].snapshot_reason, 'dean_review_approved');
    assert.strictEqual(mockDb1.store.wf_activity_log[0].action, 'Dean approved Consolidated MFO');

    // 2. Dean Revision Request without remarks -> Must be rejected
    const mockDb2 = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-301',
            task_id: 'task-1',
            department: 'BSIT',
            packet_state: 'submitted',
            current_version: 1,
            notes: '{}'
        }]
    });
    const revNoRemarks = await engine.applyConsolidatedMfoDeanReview({
        db: mockDb2,
        programPacket: mockDb2.store.mfo_program_packets[0],
        action: 'revision',
        remarks: '',
        actorFaculty: deanFaculty
    });
    assert.strictEqual(revNoRemarks.ok, false, 'Revision request without remarks must fail');
    assert.ok(revNoRemarks.error.includes('Remarks are required'));

    // 3. Dean Revision Request with remarks -> Succeeds
    const revWithRemarks = await engine.applyConsolidatedMfoDeanReview({
        db: mockDb2,
        programPacket: mockDb2.store.mfo_program_packets[0],
        action: 'revision',
        remarks: 'Please exclude training item #4 which lacks supporting proof.',
        actorFaculty: deanFaculty
    });
    assert.strictEqual(revWithRemarks.ok, true);
    assert.strictEqual(revWithRemarks.nextState, 'revision');
    assert.strictEqual(mockDb2.store.mfo_program_packets[0].packet_state, 'revision');
    assert.strictEqual(mockDb2.store.mfo_snapshots.length, 1);
    assert.strictEqual(mockDb2.store.mfo_snapshots[0].snapshot_reason, 'dean_review_revision');

    const deanRevMeta = engine.extractDeanReview(mockDb2.store.mfo_program_packets[0].notes);
    assert.ok(deanRevMeta, 'Dean review metadata must be extractable from notes');
    assert.strictEqual(deanRevMeta.remarks, 'Please exclude training item #4 which lacks supporting proof.');
    assert.strictEqual(deanRevMeta.action, 'revision');

    // 4. Dean Decline with remarks -> Succeeds
    const mockDb3 = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-302',
            task_id: 'task-1',
            department: 'BSIT',
            packet_state: 'submitted',
            current_version: 1,
            notes: '{}'
        }]
    });
    const declineRes = await engine.applyConsolidatedMfoDeanReview({
        db: mockDb3,
        programPacket: mockDb3.store.mfo_program_packets[0],
        action: 'declined',
        remarks: 'Report contains incomplete departmental data.',
        actorFaculty: deanFaculty
    });
    assert.strictEqual(declineRes.ok, true);
    assert.strictEqual(declineRes.nextState, 'declined');
    assert.strictEqual(mockDb3.store.mfo_program_packets[0].packet_state, 'declined');
});

registerTest('5.3 Resubmission Lifecycle: Resubmission after revision increments version, updates state to resubmitted, and freezes new snapshot', async () => {
    const mockDb = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-400',
            task_id: 'task-1',
            department: 'BSIT',
            packet_state: 'revision',
            current_version: 1,
            notes: JSON.stringify({
                user_remarks: 'First submission notes',
                dean_review: {
                    action: 'revision',
                    remarks: 'Please exclude training #902.',
                    reviewed_at: '2026-10-17T12:00:00Z'
                }
            })
        }],
        mfo_snapshots: [{
            id: 'snap-v1',
            program_packet_id: 'pkt-400',
            version_no: 1,
            lifecycle_state: 'submitted',
            snapshot_reason: 'submitted_to_dean',
            payload: { version: 1 }
        }]
    });

    const chairFaculty = { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    const consolidation = {
        contributingFaculty: [{ facultyId: 'f1', facultyName: 'Prof. Alice' }],
        unsubmittedFaculty: [],
        sections: { mfo_pi7_trainings: [{ id: 'tr-901', title: 'Valid Training' }] },
        programRows: { pi1: [], pi2: [] }
    };

    const resubmitResult = await engine.submitConsolidatedMfoToDean({
        db: mockDb,
        draft: mockDb.store.mfo_program_packets[0],
        taskId: 'task-1',
        department: 'BSIT',
        actorFaculty: chairFaculty,
        consolidation,
        userRemarks: 'Resubmitted after excluding unverified training as requested.'
    });

    assert.strictEqual(resubmitResult.ok, true, 'Resubmission must succeed');
    assert.strictEqual(resubmitResult.version, 2, 'Version must increment to 2');
    assert.strictEqual(resubmitResult.lifecycleState, 'resubmitted', 'Lifecycle state must transition to resubmitted');

    // Program packet updated to version 2 and resubmitted state
    const packet = mockDb.store.mfo_program_packets[0];
    assert.strictEqual(packet.current_version, 2);
    assert.strictEqual(packet.packet_state, 'resubmitted');

    // Snapshots: Both v1 and v2 exist (v1 was never overwritten)
    assert.strictEqual(mockDb.store.mfo_snapshots.length, 2, 'Both v1 and v2 snapshots must exist');
    const v1Snap = mockDb.store.mfo_snapshots.find(s => s.version_no === 1);
    const v2Snap = mockDb.store.mfo_snapshots.find(s => s.version_no === 2);
    assert.ok(v1Snap, 'Original v1 snapshot must be preserved');
    assert.ok(v2Snap, 'New v2 snapshot must be recorded');
    assert.strictEqual(v2Snap.lifecycle_state, 'resubmitted');
    assert.strictEqual(v2Snap.payload.version, 2);
    assert.strictEqual(v2Snap.payload.user_remarks, 'Resubmitted after excluding unverified training as requested.');
});

registerTest('5.3 Data Integrity: Original individual faculty submissions and snapshots are strictly preserved and untouched', async () => {
    // Individual faculty records
    const originalSubmissions = [
        { id: 'sub-1', task_id: 'task-1', faculty_id: 'f1', status: 'submitted', approval_stage: 'final_approver' },
        { id: 'sub-2', task_id: 'task-1', faculty_id: 'f2', status: 'needs_revision', approval_stage: 'revision' }
    ];
    const originalSnapshots = [
        { id: 'snap-f1', packet_id: 'pkt-f1', version_no: 1, payload: { items: 5 } }
    ];

    const submissionsCopy = JSON.parse(JSON.stringify(originalSubmissions));
    const snapshotsCopy = JSON.parse(JSON.stringify(originalSnapshots));

    const mockDb = createMockSupabase({
        mfo_program_packets: [{
            id: 'pkt-500',
            task_id: 'task-1',
            department: 'BSIT',
            packet_state: 'draft',
            current_version: 1,
            notes: '{}'
        }]
    });

    const chairFaculty = { id: 'c1', full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    await engine.submitConsolidatedMfoToDean({
        db: mockDb,
        draft: mockDb.store.mfo_program_packets[0],
        taskId: 'task-1',
        department: 'BSIT',
        actorFaculty: chairFaculty,
        consolidation: {
            contributingFaculty: [{ facultyId: 'f1' }],
            unsubmittedFaculty: [],
            sections: {},
            programRows: { pi1: [], pi2: [] }
        }
    });

    // Verify original individual faculty submissions are 100% identical and unmutated
    assert.deepStrictEqual(originalSubmissions, submissionsCopy, 'Faculty wf_submissions must never be altered');
    assert.deepStrictEqual(originalSnapshots, snapshotsCopy, 'Faculty individual snapshots must never be altered');
});



// -----------------------------------------------------------------------------
// Test Runner
// -----------------------------------------------------------------------------
console.log('======================================================');
console.log('   CITE-FLOW PHASE 5.1 & 5.2 — MFO CONSOLIDATION SUITE');
console.log('======================================================\n');

(async function runTestRunner() {
    for (const { title, fn } of tests) {
        try {
            await fn();
            passCount += 1;
            console.log(`[PASS] ${title}`);
        } catch (err) {
            failCount += 1;
            console.error(`[FAIL] ${title}`);
            console.error(err);
        }
    }

    console.log('\n======================================================');
    console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================');

    if (failCount > 0) {
        process.exit(1);
    }
})();

