/**
 * CITE-Flow Phase 5 — Chairperson Consolidated MFO Manual Editing Suite
 *
 * Verifies all requirements for Chairperson's Consolidated MFO Report manual editing:
 * 1. Content-only manual editing (overrides, additions, removals)
 * 2. Specialized table editing (Program Portion / Metrics)
 * 3. Official section and column preservation (empty sections render with N/A)
 * 4. Automatic fetching coexistence with faculty source update diff detection
 * 5. Reviewing and accepting vs declining source updates without losing edits
 * 6. Immutability of faculty source submissions
 * 7. Draft persistence across regeneration, reload, and metadata serialization
 * 8. Department isolation and RBAC authorization
 * 9. Immutable snapshot generation for Dean's Office submission
 * 10. UI helper functions and state management in CiteFlowChairReview
 */

const assert = require('assert');
const path = require('path');

const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const engine = require(path.join(__dirname, '..', 'shared', 'mfo-consolidation.js'));
const ChairReview = require(path.join(__dirname, '..', 'faculty', 'chairperson-review.js'));

let passCount = 0;
let failCount = 0;
const tests = [];

function registerTest(title, fn) {
    tests.push({ title, fn });
}

// Helper fixtures
const TASK_ID = 'task-consolidated-2026';
const DEPT = 'BSIT';

const SAMPLE_FACULTY = [
    { id: 101, full_name: 'Dr. Alan Turing', department: 'BSIT', academic_rank: 'Professor' },
    { id: 102, full_name: 'Prof. Ada Lovelace', department: 'BSIT', academic_rank: 'Associate Professor' },
    { id: 103, full_name: 'Grace Hopper', department: 'BSIT', academic_rank: 'Assistant Professor' }
];

const SAMPLE_SUBMISSIONS = [
    { id: 'sub-101', task_id: TASK_ID, faculty_id: 101, status: 'approved', submitted_at: '2026-03-20T08:00:00Z' },
    { id: 'sub-102', task_id: TASK_ID, faculty_id: 102, status: 'submitted', submitted_at: '2026-03-21T09:00:00Z' },
    { id: 'sub-103', task_id: TASK_ID, faculty_id: 103, status: 'approved', submitted_at: '2026-03-22T10:00:00Z' }
];

const SAMPLE_PACKETS = [
    { id: 'pkt-101', task_id: TASK_ID, faculty_id: 101, submission_id: 'sub-101', packet_state: 'approved' },
    { id: 'pkt-102', task_id: TASK_ID, faculty_id: 102, submission_id: 'sub-102', packet_state: 'submitted' },
    { id: 'pkt-103', task_id: TASK_ID, faculty_id: 103, submission_id: 'sub-103', packet_state: 'approved' }
];

function getSampleChildRows() {
    return {
        mfo_pi7_trainings: [
            {
                id: 'tr-1',
                packet_id: 'pkt-101',
                faculty_id: 101,
                title: 'Quantum Computing Foundations',
                venue: 'MIT / Online',
                activity_date: '2026-01-15',
                remarks: 'Completed with distinction'
            },
            {
                id: 'tr-2',
                packet_id: 'pkt-102',
                faculty_id: 102,
                title: 'Compiler Optimization Techniques',
                venue: 'Cambridge',
                activity_date: '2026-02-10',
                remarks: 'Attended full session'
            }
        ],
        mfo_pi4_syllabus: [
            {
                id: 'syl-1',
                packet_id: 'pkt-103',
                faculty_id: 103,
                subject_code: 'IT 311',
                course_title: 'Information Assurance and Security 1',
                date_submitted: '2026-01-20'
            }
        ]
    };
}

// =============================================================================
// AREA 1: CONTENT-ONLY MANUAL EDITING
// =============================================================================

registerTest('1.1 Manual Overrides: Chairperson edits accomplishment description, dates, and venue without altering source rows', () => {
    const childRows = getSampleChildRows();
    const originalTitle = childRows.mfo_pi7_trainings[0].title;

    const customizations = {
        manual_overrides: {
            'tr-1': {
                title: 'Advanced Quantum Computing Workshop (Chair Updated)',
                venue: 'MIT Center for Computing',
                start_date: '2026-01-16',
                remarks: 'Verified certificate of completion'
            }
        }
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations
    });

    const editedRow = consolidation.activeSections.mfo_pi7_trainings.find(r => r.id === 'tr-1');
    assert.ok(editedRow, 'tr-1 must be present in activeSections');
    assert.strictEqual(editedRow.title, 'Advanced Quantum Computing Workshop (Chair Updated)', 'Title must reflect chair edit');
    assert.strictEqual(editedRow.venue, 'MIT Center for Computing', 'Venue must reflect chair edit');
    assert.strictEqual(editedRow.start_date, '2026-01-16', 'Start date must reflect chair edit');
    assert.strictEqual(editedRow._isEdited, true, 'Item must be flagged as _isEdited');
    assert.ok(editedRow._manualOverride, 'Item must retain _manualOverride metadata');

    // Immutability of source: childRows input must not have been modified
    assert.strictEqual(childRows.mfo_pi7_trainings[0].title, originalTitle, 'Original child row title must remain untouched');
    assert.strictEqual(consolidation.summary.manuallyEditedCount, 1, 'manuallyEditedCount summary must equal 1');
});

registerTest('1.2 Manual Additions: Chairperson can add new accomplishment entries to an official section', () => {
    const childRows = getSampleChildRows();

    const customizations = {
        manual_additions: [
            {
                id: 'chair-add-999',
                section_code: 'mfo_pi7_trainings',
                title: 'Departmental AI Literacy Bootcamp',
                description: 'Department-wide faculty immersion on generative AI in education',
                venue: 'CITE Multimedia Hall',
                start_date: '2026-03-01',
                end_date: '2026-03-02',
                remarks: 'Sponsored by CITE Dean’s Initiative'
            }
        ]
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations
    });

    const addedItem = consolidation.activeSections.mfo_pi7_trainings.find(r => r.id === 'chair-add-999');
    assert.ok(addedItem, 'Manual addition must appear in activeSections');
    assert.strictEqual(addedItem._isManualAddition, true, 'Must have _isManualAddition flag');
    assert.strictEqual(addedItem.title, 'Departmental AI Literacy Bootcamp');
    assert.strictEqual(addedItem.venue, 'CITE Multimedia Hall');
    assert.strictEqual(addedItem.contributing_faculty_name, 'Chairperson Addition');
    assert.strictEqual(consolidation.summary.manualAdditionsCount, 1, 'manualAdditionsCount must equal 1');
});

registerTest('1.3 Manual Removals: Chairperson can remove unnecessary entry without deleting the official section', () => {
    const childRows = getSampleChildRows();

    const customizations = {
        manual_removals: ['tr-2']
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations
    });

    // tr-2 must be excluded from activeSections (which compiles to PDF)
    const activeRow = consolidation.activeSections.mfo_pi7_trainings.find(r => r.id === 'tr-2');
    assert.strictEqual(activeRow, undefined, 'Removed row tr-2 must not be present in activeSections');

    // tr-2 must be present in raw sections with is_manually_removed: true for review UI
    const fullRow = consolidation.sections.mfo_pi7_trainings.find(r => r.id === 'tr-2');
    assert.ok(fullRow, 'tr-2 should exist in full sections manifest for UI display');
    assert.strictEqual(fullRow.is_manually_removed, true, 'is_manually_removed must be true');
    assert.strictEqual(consolidation.summary.manuallyRemovedCount, 1, 'manuallyRemovedCount must equal 1');

    // The section itself must remain alive with remaining row tr-1
    assert.strictEqual(consolidation.activeSections.mfo_pi7_trainings.length, 1);
});

registerTest('1.4 Empty Section Preservation: Removing all items retains official section structure with empty array (renders N/A)', () => {
    const childRows = getSampleChildRows();

    // Remove the only item in syllabus
    const customizations = {
        manual_removals: ['syl-1']
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations
    });

    // Official section key mfo_pi4_syllabus / mfo1_pi4 MUST exist and be an empty array
    assert.ok(Array.isArray(consolidation.activeSections.mfo_pi4_syllabus), 'mfo_pi4_syllabus must exist in activeSections');
    assert.strictEqual(consolidation.activeSections.mfo_pi4_syllabus.length, 0, 'Must be empty array');
    assert.ok(Array.isArray(consolidation.activeSections.mfo1_pi4), 'mfo1_pi4 must exist in activeSections');
    assert.strictEqual(consolidation.activeSections.mfo1_pi4.length, 0, 'Must be empty array');

    // In mfo-report.js, an empty array in an official section produces an "N/A" row with table headers preserved
    assert.ok(consolidation.sections.mfo_pi4_syllabus, 'Must also exist in full sections list');
});

// =============================================================================
// AREA 2: SPECIALIZED TABLE EDITING (PROGRAM PORTION / METRICS)
// =============================================================================

registerTest('2.1 Program Portion Overrides: Chairperson can update specialized metrics (PI1 Licensure & PI2 Employment)', () => {
    const childRows = getSampleChildRows();

    const customizations = {
        program_portion_overrides: {
            pi1: {
                takers: 45,
                passers: 41,
                passing_rate: 91.11,
                remarks: 'Official PRC September 2026 Board Exam Result'
            },
            pi2: {
                total_graduates: 120,
                employed_graduates: 110,
                employment_rate: 91.67,
                remarks: 'CITE Alumni Tracer Study 2026'
            }
        }
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations
    });

    const pi1 = consolidation.programPortion.pi1;
    assert.strictEqual(pi1.takers, 45);
    assert.strictEqual(pi1.passers, 41);
    assert.strictEqual(pi1.passing_rate, 91.11);
    assert.strictEqual(pi1.remarks, 'Official PRC September 2026 Board Exam Result');
    assert.strictEqual(pi1._isOverridden, true);

    const pi2 = consolidation.programPortion.pi2;
    assert.strictEqual(pi2.total_graduates, 120);
    assert.strictEqual(pi2.employed_graduates, 110);
    assert.strictEqual(pi2.employment_rate, 91.67);
    assert.strictEqual(pi2.remarks, 'CITE Alumni Tracer Study 2026');
    assert.strictEqual(pi2._isOverridden, true);
});

// =============================================================================
// AREA 3: AUTOMATIC FETCHING & SOURCE UPDATE DIFF DETECTION
// =============================================================================

registerTest('3.1 Baseline Snapshot Recording: Initial consolidation captures baseline snapshots of auto-fetched rows', () => {
    const childRows = getSampleChildRows();

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows
    });

    assert.ok(consolidation.sourceSnapshots['tr-1'], 'Snapshot for tr-1 must be recorded');
    assert.strictEqual(consolidation.sourceSnapshots['tr-1'].title, 'Quantum Computing Foundations');
    assert.strictEqual(consolidation.sourceSnapshots['tr-1'].venue, 'MIT / Online');
    assert.strictEqual(consolidation.sourceSnapshots['tr-1'].start_date, '2026-01-15');
});

registerTest('3.2 Source Update Detection: Identifies when faculty modified accomplishment in underlying submission', () => {
    // Baseline snapshots from when draft was created
    const sourceSnapshots = {
        'tr-1': {
            id: 'tr-1',
            title: 'Quantum Computing Foundations',
            venue: 'MIT / Online',
            start_date: '2026-01-15',
            end_date: '',
            remarks: 'Completed with distinction'
        }
    };

    // Faculty member subsequently updated tr-1 in their submission
    const childRowsUpdated = getSampleChildRows();
    childRowsUpdated.mfo_pi7_trainings[0].title = 'Quantum Computing & Algorithms (Revised Title)';
    childRowsUpdated.mfo_pi7_trainings[0].venue = 'MIT Stata Center';

    const result = engine.detectSourceAccomplishmentUpdates({
        childRows: childRowsUpdated,
        sourceSnapshots,
        manualOverrides: {
            'tr-1': {
                title: 'Chair’s Custom Quantum Title'
            }
        }
    });

    assert.strictEqual(result.hasUpdates, true, 'hasUpdates must be true');
    assert.ok(result.updates.length >= 1, 'Should detect at least 1 update item');

    const u = result.updates.find(item => item.sourceRowId === 'tr-1' && item.field === 'title');
    assert.ok(u, 'Diff for tr-1 title must exist');
    assert.strictEqual(u.previousSourceValue, 'Quantum Computing Foundations');
    assert.strictEqual(u.newSourceValue, 'Quantum Computing & Algorithms (Revised Title)');
    assert.strictEqual(u.chairpersonValue, 'Chair’s Custom Quantum Title');
    assert.strictEqual(u.hasChairpersonOverride, true);
});

registerTest('3.3 Decision Accept: Accepting source update updates baseline snapshot and clears/syncs manual override', () => {
    const sourceSnapshots = {
        'tr-1': {
            title: 'Quantum Computing Foundations',
            venue: 'MIT / Online'
        }
    };
    const manualOverrides = {
        'tr-1': {
            title: 'Chair Custom Title'
        },
        'tr-2': {
            title: 'Unrelated Chair Edit'
        }
    };

    const updateItem = {
        sourceRowId: 'tr-1',
        diffs: [{ field: 'title', previousValue: 'Quantum Computing Foundations', facultyValue: 'New Faculty Title' }]
    };

    const result = engine.applySourceUpdateDecision({
        decision: 'accept',
        updateItem,
        sourceSnapshots,
        manualOverrides
    });

    // tr-1 snapshot should be updated to new faculty value
    assert.strictEqual(result.sourceSnapshots['tr-1'].title, 'New Faculty Title');
    // tr-1 override removed so new faculty value takes effect
    assert.strictEqual(result.manualOverrides['tr-1'], undefined);
    // tr-2 override untouched
    assert.strictEqual(result.manualOverrides['tr-2'].title, 'Unrelated Chair Edit');
});

registerTest('3.4 Decision Decline: Declining source update syncs baseline snapshot but PRESERVES Chairperson override', () => {
    const sourceSnapshots = {
        'tr-1': {
            title: 'Quantum Computing Foundations',
            venue: 'MIT / Online'
        }
    };
    const manualOverrides = {
        'tr-1': {
            title: 'Chair Custom Title (I want to keep this)'
        }
    };

    const updateItem = {
        sourceRowId: 'tr-1',
        diffs: [{ field: 'title', previousValue: 'Quantum Computing Foundations', facultyValue: 'New Faculty Title' }]
    };

    const result = engine.applySourceUpdateDecision({
        decision: 'decline',
        updateItem,
        sourceSnapshots,
        manualOverrides
    });

    // tr-1 snapshot is synced so update prompt disappears
    assert.strictEqual(result.sourceSnapshots['tr-1'].title, 'New Faculty Title');
    // tr-1 override is strictly preserved!
    assert.strictEqual(result.manualOverrides['tr-1'].title, 'Chair Custom Title (I want to keep this)');
});

// =============================================================================
// AREA 4: DRAFT PERSISTENCE & METADATA SERIALIZATION
// =============================================================================

registerTest('4.1 Metadata Roundtrip: formatManualCustomizations and extractManualCustomizations roundtrip perfectly', () => {
    const customizations = {
        manual_overrides: {
            'item-1': { title: 'Custom Title', remarks: 'Good' }
        },
        manual_additions: [
            { id: 'add-1', section_code: 'mfo_pi7_trainings', title: 'New Addition' }
        ],
        manual_removals: ['item-2', 'item-3'],
        source_snapshots: {
            'item-1': { title: 'Old Title' }
        },
        program_portion_overrides: {
            pi1: { takers: 50, passers: 45, passing_rate: 90 }
        }
    };

    const formatted = engine.formatManualCustomizations(customizations);
    const existingNotes = 'Chairperson remarks on draft.';
    const mergedNotes = engine.mergeNotesMetadata(existingNotes, formatted);

    assert.ok(mergedNotes.notes_text.startsWith('Chairperson remarks on draft.'));
    assert.ok(mergedNotes.citeflow_mfo_consolidation);

    const serialized = JSON.stringify(mergedNotes);
    const extracted = engine.extractManualCustomizations(serialized);

    assert.deepStrictEqual(extracted.manual_overrides, customizations.manual_overrides);
    assert.deepStrictEqual(extracted.manual_additions, customizations.manual_additions);
    assert.strictEqual(extracted.manual_removals.has('item-2'), true);
    assert.strictEqual(extracted.manual_removals.has('item-3'), true);
    assert.deepStrictEqual(extracted.source_snapshots, customizations.source_snapshots);
    assert.deepStrictEqual(extracted.program_portion_overrides, customizations.program_portion_overrides);
});

registerTest('4.2 Draft Regeneration: Preserves all manual customizations when draft is regenerated', () => {
    const childRows = getSampleChildRows();

    // Draft already has manual edits stored in its notes
    const priorCustomizations = {
        manual_overrides: {
            'tr-1': { title: 'Persisted Chair Title' }
        },
        manual_additions: [
            { id: 'add-99', section_code: 'mfo_pi7_trainings', title: 'Persisted Addition' }
        ],
        manual_removals: ['tr-2'],
        program_portion_overrides: {
            pi1: { takers: 100, passers: 95, passing_rate: 95.0 }
        }
    };

    const draftPacket = {
        id: 'draft-pkt-1',
        task_id: TASK_ID,
        department: DEPT,
        notes: JSON.stringify(engine.mergeNotesMetadata('Draft notes', engine.formatManualCustomizations(priorCustomizations))),
        created_at: '2026-03-25T10:00:00Z',
        updated_at: '2026-03-25T10:00:00Z'
    };

    const regenerationResult = engine.regenerateDepartmentDraft({
        draft: draftPacket,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        actorFaculty: { id: 1, full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' }
    });

    const activeTrainings = regenerationResult.consolidation.activeSections.mfo_pi7_trainings;

    // 1. Overridden tr-1 must still have chair title
    const tr1 = activeTrainings.find(r => r.id === 'tr-1');
    assert.ok(tr1);
    assert.strictEqual(tr1.title, 'Persisted Chair Title');

    // 2. Added item add-99 must still exist
    const add99 = activeTrainings.find(r => r.id === 'add-99');
    assert.ok(add99);
    assert.strictEqual(add99.title, 'Persisted Addition');

    // 3. Removed tr-2 must still be excluded
    const tr2 = activeTrainings.find(r => r.id === 'tr-2');
    assert.strictEqual(tr2, undefined, 'tr-2 must still be excluded from activeSections');

    // 4. Program portion must still be overridden
    assert.strictEqual(regenerationResult.consolidation.programPortion.pi1.passing_rate, 95.0);

    // 5. Notes metadata must have preserved all customizations
    const reExtracted = engine.extractManualCustomizations(regenerationResult.notes);
    assert.ok(reExtracted.manual_overrides['tr-1']);
    assert.strictEqual(reExtracted.manual_additions.length, 1);
    assert.strictEqual(reExtracted.manual_removals.has('tr-2'), true);
});

// =============================================================================
// AREA 5: FINAL SUBMISSION & IMMUTABILITY
// =============================================================================

registerTest('5.1 Submission Payload: prepareConsolidatedMfoSubmission embeds full customizations and activeSections', () => {
    const childRows = getSampleChildRows();

    const customizations = {
        manual_overrides: { 'tr-1': { title: 'Final Submitted Title' } },
        manual_additions: [{ id: 'final-add', section_code: 'mfo_pi7_trainings', title: 'Final Addition' }],
        manual_removals: ['tr-2']
    };

    const draftPacket = {
        id: 'draft-pkt-1',
        task_id: TASK_ID,
        department: DEPT,
        notes: JSON.stringify(engine.mergeNotesMetadata('Draft notes', engine.formatManualCustomizations(customizations)))
    };

    const prep = engine.prepareConsolidatedMfoSubmission({
        draft: draftPacket,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations,
        actorFaculty: { id: 1, full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' }
    });

    assert.ok(prep.ok, 'Submission prep must succeed');
    assert.strictEqual(prep.frozenPayload.department, DEPT);

    const submittedTrainings = prep.frozenPayload.sections.mfo_pi7_trainings;
    assert.ok(submittedTrainings.find(r => r.id === 'tr-1' && r.title === 'Final Submitted Title'));
    assert.ok(submittedTrainings.find(r => r.id === 'final-add'));
    assert.strictEqual(submittedTrainings.find(r => r.id === 'tr-2'), undefined);
});

registerTest('5.2 Submitted Snapshot Immutability: Subsequent draft edits do not mutate submitted snapshot payload', async () => {
    const childRows = getSampleChildRows();

    const initialCustomizations = {
        manual_overrides: { 'tr-1': { title: 'Snapshot Title V1' } }
    };

    // Mock DB storing snapshots
    const dbSnapshots = [];
    const dbPackets = [
        {
            id: 'draft-pkt-1',
            task_id: TASK_ID,
            department: DEPT,
            packet_state: 'draft',
            notes: JSON.stringify(engine.mergeNotesMetadata('Draft notes', engine.formatManualCustomizations(initialCustomizations)))
        }
    ];

    const mockDb = {
        from: (table) => ({
            insert: (payload) => {
                const arr = Array.isArray(payload) ? payload : [payload];
                if (table === 'mfo_snapshots') {
                    // Deep clone into db to simulate real persistent storage
                    dbSnapshots.push(...arr.map(r => JSON.parse(JSON.stringify(r))));
                }
                return {
                    select: () => ({
                        data: arr,
                        error: null,
                        single: () => ({ data: arr[0], error: null })
                    }),
                    error: null
                };
            },
            update: (updates) => ({
                eq: (col, val) => ({
                    select: () => ({
                        single: () => {
                            const row = dbPackets.find(p => p[col] === val);
                            if (row) Object.assign(row, updates);
                            return { data: row, error: null };
                        }
                    })
                })
            })
        })
    };

    const subResult = await engine.submitConsolidatedMfoToDean({
        db: mockDb,
        draft: dbPackets[0],
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows,
        customizations: initialCustomizations,
        actorFaculty: { id: 1, full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' }
    });

    assert.ok(subResult.ok, 'Submission must succeed');
    assert.strictEqual(dbSnapshots.length, 1, '1 snapshot created');

    const frozenTitle = dbSnapshots[0].payload.sections.mfo_pi7_trainings.find(r => r.id === 'tr-1').title;
    assert.strictEqual(frozenTitle, 'Snapshot Title V1');

    // Simulate subsequent draft edits by Chairperson
    initialCustomizations.manual_overrides['tr-1'].title = 'Mutated After Submission!';

    // Snapshot payload in dbSnapshots[0] MUST NOT have mutated
    const currentSnapshotTitle = dbSnapshots[0].payload.sections.mfo_pi7_trainings.find(r => r.id === 'tr-1').title;
    assert.strictEqual(currentSnapshotTitle, 'Snapshot Title V1', 'Snapshot must remain immutable');
});

// =============================================================================
// AREA 6: AUTHORIZATION AND DEPARTMENT ISOLATION
// =============================================================================

registerTest('6.1 Department Authorization: Chairperson can edit only their authorized department', () => {
    const chairBSIT = { id: 1, full_name: 'Dr. BSIT Chair', department: 'BSIT', role: 'chairperson' };
    const chairBSEMC = { id: 2, full_name: 'Dr. BSEMC Chair', department: 'BSEMC', role: 'chairperson' };

    // BSIT chair on BSIT department: allowed
    assert.strictEqual(engine.verifyChairpersonDepartmentAccess(chairBSIT, 'BSIT').authorized, true);

    // BSEMC chair on BSIT department without grant: denied
    assert.strictEqual(engine.verifyChairpersonDepartmentAccess(chairBSEMC, 'BSIT').authorized, false);

    // BSEMC chair with active OIC grant for BSIT: allowed
    const activeGrant = [{
        grantee_faculty_id: 2,
        department: 'BSIT',
        status: 'active',
        is_active: true,
        start_date: '2026-01-01',
        end_date: '2026-12-31'
    }];
    assert.strictEqual(engine.verifyChairpersonDepartmentAccess(chairBSEMC, 'BSIT', activeGrant).authorized, true);

    // BSEMC chair with expired/inactive grant for BSIT: denied
    const expiredGrant = [{
        grantee_faculty_id: 2,
        department: 'BSIT',
        status: 'expired',
        is_active: false,
        start_date: '2025-01-01',
        end_date: '2025-12-31'
    }];
    assert.strictEqual(engine.verifyChairpersonDepartmentAccess(chairBSEMC, 'BSIT', expiredGrant).authorized, false);
});

// =============================================================================
// AREA 7: UI EXPORTS & CONTRACT VERIFICATION
// =============================================================================

registerTest('7.1 CiteFlowChairReview Export Contract: All manual editing handlers are exposed', () => {
    const expectedMethods = [
        'rerenderConsolidatedMfoInPlace',
        'openEditAccomplishmentModal',
        'closeEditAccomplishmentModal',
        'saveEditAccomplishment',
        'openAddAccomplishmentModal',
        'closeAddAccomplishmentModal',
        'saveAddAccomplishment',
        'removeConsolidatedAccomplishment',
        'closeRemoveAccomplishmentModal',
        'confirmRemoveAccomplishment',
        'restoreConsolidatedAccomplishment',
        'setConsolidatedFilter',
        'setConsolidatedSearch',
        'openSourceUpdatesModal',
        'closeSourceUpdatesModal',
        'acceptSourceUpdate',
        'declineSourceUpdate',
        'acceptAllSourceUpdates',
        'openEditProgramPortionModal',
        'closeEditProgramPortionModal',
        'saveEditProgramPortion',
        'saveConsolidatedMfoEdits'
    ];

    expectedMethods.forEach(method => {
        assert.strictEqual(typeof ChairReview[method], 'function', `ChairReview must export ${method}`);
    });
});

registerTest('8.1 Consolidated Official Report Layout: Preserves official sections, headings, title block, and signatories', () => {
    const MfoFaculty = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));
    const state = MfoFaculty._state;
    state.isConsolidated = true;
    state.chairFaculty = {
        id: 99,
        full_name: 'Dr. Maria Santos',
        department: 'BSIT',
        department_code: 'bsit',
        program: 'Bachelor of Science in Information Technology',
        academic_rank: 'Associate Professor',
        role: 'chairperson'
    };
    state.task = {
        id: TASK_ID,
        department: 'BSIT',
        reporting_year: 2026,
        quarter: 2
    };
    state.period = {
        reporting_year: 2026,
        quarter: 2,
        period_label: '2nd Quarter – Months of April - June'
    };
    state.rows = {
        mfo_pi3_enrollment: [],
        mfo_pi4_syllabus: [],
        mfo_documentation_items: [
            {
                id: 'doc-1',
                section_code: 'documentation_other',
                title: 'Project Presentation Exhibit',
                activity_date: '2026-04-21',
                venue: 'Multimedia Room',
                narrative: 'Project presentation evidence'
            }
        ]
    };
    state.files = [];

    const docHtml = MfoFaculty._renderReportDocument();

    // Verify official Title block
    assert.ok(docHtml.includes('BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY'), 'Must include program heading in uppercase');
    assert.ok(docHtml.includes('CONSOLIDATED ACCOMPLISHMENT REPORT – CY 2026'), 'Must include CONSOLIDATED ACCOMPLISHMENT REPORT – CY 2026');
    assert.ok(docHtml.includes('2nd Quarter – Months of April - June'), 'Must include quarter and months format');
    assert.ok(!docHtml.includes('(for the Program Chairperson)'), 'Must not include individual faculty subtitle');
    assert.ok(!docHtml.includes('Instructions: Fill in the table with the required data'), 'Must not include individual faculty instructions');

    // Verify official Group Banners
    assert.ok(docHtml.includes('MFO 1: Advanced and Higher Education Services'), 'Must render official MFO 1 heading');
    assert.ok(docHtml.includes('MFO 2: Research and Development Services'), 'Must render official MFO 2 heading');
    assert.ok(docHtml.includes('MFO 3: Extension Services'), 'Must render official MFO 3 heading');

    // Verify official Signatories
    assert.ok(docHtml.includes('Prepared by:'), 'Must include Prepared by block');
    assert.ok(docHtml.includes('Chair, BSIT Department'), 'Must include Chair, BSIT Department');
    assert.ok(docHtml.includes('Submitted to:'), 'Must include Submitted to block');
    assert.ok(docHtml.includes('Dean, COTE'), 'Must include Dean, COTE');

    // Verify Gallery
    assert.ok(docHtml.includes('GALLERY'), 'Must include GALLERY header');
    assert.ok(docHtml.includes('VERIFIABLE EVIDENCE / DOCUMENTS'), 'Must include VERIFIABLE EVIDENCE / DOCUMENTS');
});

registerTest('8.2 Individual Faculty Report Layout: Preserves individual faculty profile, instructions, and signature block', () => {
    const MfoFaculty = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));
    const state = MfoFaculty._state;
    state.isConsolidated = false;
    state.faculty = {
        id: 101,
        full_name: 'Dr. Alan Turing',
        department: 'BSIT',
        academic_rank: 'Professor',
        employee_id: 'EMP-001'
    };
    state.chairFaculty = null;
    state.period = {
        reporting_year: 2026,
        quarter: 2,
        period_label: '2nd Quarter'
    };
    state.rows = {};
    state.files = [];

    const docHtml = MfoFaculty._renderReportDocument();

    assert.ok(docHtml.includes('Accomplishment Report – CY 2026'), 'Faculty report retains individual title');
    assert.ok(docHtml.includes('(for the Program Chairperson)'), 'Faculty report retains (for the Program Chairperson)');
    assert.ok(docHtml.includes('Reporting Faculty:'), 'Faculty report retains identity table with Reporting Faculty');
    assert.ok(docHtml.includes('Instructions: Fill in the table with the required data'), 'Faculty report retains instructions');
    assert.ok(docHtml.includes('Submitted by:'), 'Faculty report retains Submitted by');
    assert.ok(!docHtml.includes('CONSOLIDATED ACCOMPLISHMENT REPORT'), 'Faculty report must not say CONSOLIDATED ACCOMPLISHMENT REPORT');
});

// =============================================================================
// AREA 9: TARGET OFFICIAL MFO SECTION SELECTOR & OFFICIAL PDF TEMPLATE COMPLIANCE
// =============================================================================

registerTest('9.1 Target Official MFO Section Selector: Populates with all official PDF sections and handles empty error state', () => {
    const chairReview = CiteFlowChairReview;
    assert.ok(typeof chairReview.getOfficialMfoSections === 'function', 'getOfficialMfoSections must be exported');
    assert.ok(typeof chairReview.populateOfficialSectionDropdowns === 'function', 'populateOfficialSectionDropdowns must be exported');

    const sections = chairReview.getOfficialMfoSections();
    assert.ok(Array.isArray(sections), 'Sections must be an array');
    assert.strictEqual(sections.length, 21, 'Must include all 21 official sections matching the PDF');

    const codes = sections.map(s => s.code);
    assert.ok(codes.includes('MFO 1A') && codes.includes('MFO 1F') && codes.includes('MFO 1K'), 'Must include MFO 1A, specialized 1F, and specialized 1K');
    assert.ok(codes.includes('MFO 2A') && codes.includes('MFO 2B') && codes.includes('MFO 2C'), 'Must include MFO 2A, 2B, 2C');
    assert.ok(codes.includes('MFO 3A') && codes.includes('MFO 3B'), 'Must include MFO 3A, 3B');
    assert.ok(codes.includes('Production'), 'Must include Production');
    assert.ok(codes.includes('MFO 4A') && codes.includes('MFO 4B'), 'Must include MFO 4A, 4B');
    assert.ok(codes.includes('MFO 5'), 'Must include MFO 5');
    assert.ok(codes.includes('GALLERY'), 'Must include GALLERY');

    // Test DOM population in mock environment
    const fakeAddSelect = { tagName: 'SELECT', innerHTML: '', value: '' };
    const fakeEditSelect = { tagName: 'SELECT', innerHTML: '', value: '' };
    global.document = {
        getElementById: (id) => {
            if (id === 'chairAddSectionSelect') return fakeAddSelect;
            if (id === 'chairEditSectionSelect') return fakeEditSelect;
            return null;
        }
    };

    chairReview.populateOfficialSectionDropdowns('mfo_pi7_trainings');
    assert.ok(fakeAddSelect.innerHTML.includes('<optgroup label="MFO 1: Advanced and Higher Education Services">'), 'Add select must have optgroup');
    assert.ok(fakeAddSelect.innerHTML.includes('value="mfo_pi7_trainings"'), 'Add select must contain training table option');
    assert.strictEqual(fakeAddSelect.value, 'mfo_pi7_trainings', 'Pre-selected table should be set');

    assert.ok(fakeEditSelect.innerHTML.includes('value="mfo_pi7_trainings"'), 'Edit select must contain training table option');
    assert.strictEqual(fakeEditSelect.value, 'mfo_pi7_trainings', 'Pre-selected table should be set in edit select');
});

registerTest('9.2 Target Section Selection & Re-Assignment: Accomplishment appears in corresponding section', () => {
    // 1. Manual additions assignment
    const customizations = {
        manual_overrides: {},
        manual_additions: {
            mfo_pi7_trainings: [
                {
                    id: 'added-tr-1',
                    table: 'mfo_pi7_trainings',
                    title: 'Advanced AI Workshop',
                    start_date: '2026-05-10',
                    venue: 'CTU Argao Audio Visual Center',
                    contributing_faculty_name: 'Chairperson Addition'
                }
            ],
            mfo_accreditation_qa: [
                {
                    id: 'added-qa-1',
                    table: 'mfo_accreditation_qa',
                    program: 'BS Information Technology',
                    status: 'Level II Re-Accredited',
                    date_of_survey: '2026-06-15'
                }
            ]
        },
        manual_removals: {},
        source_snapshots: {},
        program_portion_overrides: {}
    };

    const consolidation = engine.buildDepartmentMfoConsolidation({
        taskId: TASK_ID,
        department: DEPT,
        submissions: SAMPLE_SUBMISSIONS,
        packets: SAMPLE_PACKETS,
        facultyList: SAMPLE_FACULTY,
        childRows: getSampleChildRows(),
        customizations
    });

    const trainings = consolidation.activeSections.mfo_pi7_trainings || [];
    assert.ok(trainings.some(t => t.id === 'added-tr-1' && t.title === 'Advanced AI Workshop'), 'Manual addition must appear in trainings section');

    const qa = consolidation.activeSections.mfo_accreditation_qa || [];
    assert.ok(qa.some(q => q.id === 'added-qa-1' && q.status === 'Level II Re-Accredited'), 'Manual addition must appear in accreditation section');
});

registerTest('9.3 Official Consolidated Template Compliance: Strictly matches MFO CONSOLIDATED REPORT.pdf', () => {
    const MfoFaculty = require(path.join(__dirname, '..', 'faculty', 'mfo-report.js'));
    const state = MfoFaculty._state;
    state.isConsolidated = true;
    state.chairFaculty = {
        id: 99,
        full_name: 'Dr. Christine Joy A. Tomol',
        department: 'BSIT',
        department_code: 'bsit',
        program: 'Bachelor of Science in Information Technology'
    };
    state.period = {
        reporting_year: 2026,
        quarter: 2,
        period_label: '2nd Quarter – Months of April - June'
    };
    state.programRows = {
        pi1: [{ exam_name: 'Licensure Examination for Teachers (Major in IT)', total_takers: 50, total_passers: 45, passing_rate: 90 }],
        pi2: [{ cohort_label: 'BSIT Batch 2024', total_graduates: 120, employed_graduates: 110, employed_percentage: 91.67 }]
    };
    state.rows = {
        mfo_pi1_licensure: [],
        mfo_pi2_employment: [],
        mfo_pi4_syllabus: [{ subject_code: 'IT 312', course_title: 'Web Systems and Technologies', syllabus_status: 'submitted', contributing_faculty_name: 'Prof. Ada Lovelace' }],
        mfo_pi5_certifications: [{ certification_title: 'AWS Certified Cloud Practitioner', certification_nature: 'Cloud Certification', granting_agency: 'Amazon Web Services', date_granted: '2026-04-10', contributing_faculty_name: 'Engr. Kent Unabia' }],
        mfo_pi6_postgraduate: [{ program_enrolled: 'Doctor in Information Technology', institution_name: 'Cebu Institute of Technology', earned_units: 36, current_units: 9, contributing_faculty_name: 'Prof. Alan Turing' }],
        mfo_accreditation_qa: [{ program: 'BS Information Technology', status: 'Level II Re-Accredited', date_of_survey: 'April 2026' }],
        mfo_pi7_trainings: [{ title: 'Regional Convention PSITE 7', venue: 'Tambuli Seaside Resort', activity_date: '2026-04-20', sponsoring_agency: 'PSITE 7', contributing_faculty_name: 'Dr. Melanie Albarracin' }],
        mfo_pi8_instructional_materials: [{ title: 'Python Programming Module', material_type: 'Module', courses_utilizing: 'IT 111', authors_text: 'Dr. Christine Joy Tomol' }],
        mfo_awards: [{ award_title: 'Outstanding Paper Presentation', award_nature: 'Research Excellence', granting_agency: 'IEEE Region 10', awarded_at: '2026-05-18', contributing_faculty_name: 'Dr. Christine Joy Tomol' }],
        mfo_other_initiatives: [{ activity_title: 'Panag-Ambit OJT Culminating Activity', activity_date: '2026-05-25', venue: 'Campus Gymnasium', faculty_involved: 'BSIT Faculty' }],
        mfo_pi3_enrollment: [
            { section: 'BSIT 3-A', students_enrolled: 42, adviser_name: 'Prof. Ada Lovelace' },
            { section: 'BSIT 3-B', students_enrolled: 38, adviser_name: 'Dr. Melanie Albarracin' }
        ],
        mfo_research_utilized: [{ research_title: 'Smart Waste Management IoT System', partner_name: 'LGU Argao', utilization_nature: 'Deployment and Pilot Testing' }],
        mfo_research_published: [{ research_title: 'Fuzzy TOPSIS Approach in Educational Evaluation', publication_name: 'Algorithms Journal (MDPI)', published_at: '2026-05-12' }],
        mfo_research_presented: [{ research_title: 'Intuitionistic Fuzzy EDAS for Large Language Models', conference_title: '15th International Research Conference', presented_at: '2026-04-28', venue: 'Cebu City' }],
        mfo_extension_partnerships: [{ project_title: 'Digital Literacy for Highland Farmers', partner_name: 'Barangay Linut-od', has_moa: true }],
        mfo_extension_trainings: [{ training_title: 'Data Analytics Training with TESDA', partner_agency: 'TESDA & CCA', beneficiaries_male: 15, beneficiaries_female: 25, training_hours: 120 }],
        mfo_production: [{ title: 'IT Solutions and Software Development Consultations' }],
        mfo_admin_initiatives: [{ title: 'Implementation of Automated Attendance and Flag Ceremony Tracking' }],
        mfo_support_services: [{ title: 'Maintenance and Upgrade of Multimedia and Networking Laboratories' }],
        mfo_resource_management: [{ title: 'Procurement of High-Performance Workstations for IT Capstone Lab' }],
        mfo_documentation_items: [{ title: 'Depzilla OJT Project Presentation', activity_date: '2026-04-21' }]
    };
    state.files = [];

    const docHtml = MfoFaculty._renderReportDocument();

    // 1. Title Block
    assert.ok(docHtml.includes('BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY'), 'Must have correct underlined program title');
    assert.ok(docHtml.includes('CONSOLIDATED ACCOMPLISHMENT REPORT – CY 2026'), 'Must have official consolidated report title');
    assert.ok(docHtml.includes('2nd Quarter – Months of April - June'), 'Must have official quarter format');

    // 2. Official Section Headings and 3-Column Tables
    const expectedSubheadings = [
        'MFO 1A', 'MFO 1B', 'MFO 1C', 'MFO 1D', 'MFO 1E', 'MFO 1F', 'MFO 1G', 'MFO 1H', 'MFO 1I', 'MFO 1J', 'MFO 1K',
        'MFO 2A', 'MFO 2B', 'MFO 2C', 'MFO 3A', 'MFO 3B', 'Production', 'MFO 4A', 'MFO 4B', 'MFO 5'
    ];
    expectedSubheadings.forEach(sub => {
        assert.ok(docHtml.includes(sub), `Consolidated report must include section ${sub}`);
    });

    // 3. Check 3-column table headers
    assert.ok(docHtml.includes('PERFORMANCE<br>INDICATOR'), 'Must include PERFORMANCE INDICATOR column header');
    assert.ok(docHtml.includes('ACCOMPLISHMENTS'), 'Must include ACCOMPLISHMENTS column header');
    assert.ok(docHtml.includes('CHED STRATEGIES/ACTIONS &amp;<br>OUTCOMES'), 'Must include CHED STRATEGIES column header');

    // 4. Check Specialized MFO 1F
    assert.ok(docHtml.includes('Accreditation &amp; QA'), 'MFO 1F must display Accreditation & QA');
    assert.ok(docHtml.includes('Accreditation Status'), 'MFO 1F must have Accreditation Status nested header');
    assert.ok(docHtml.includes('Date of Survey:'), 'MFO 1F must have Date of Survey column');
    assert.ok(docHtml.includes('Level II Re-Accredited'), 'MFO 1F must render accreditation data');

    // 5. Check Specialized MFO 1K
    assert.ok(docHtml.includes('Prog/Year/Sec'), 'MFO 1K must have Prog/Year/Sec column');
    assert.ok(docHtml.includes('No. of<br>Students'), 'MFO 1K must have No. of Students column');
    assert.ok(docHtml.includes('BSIT 3-A') && docHtml.includes('BSIT 3-B'), 'MFO 1K must render advisory rows');
    assert.ok(docHtml.includes('>TOTAL<') && docHtml.includes('>80<'), 'MFO 1K must render TOTAL row with computed sum (42 + 38 = 80)');

    // 6. Check Signatories Block
    assert.ok(docHtml.includes('Prepared by:'), 'Must include Prepared by block');
    assert.ok(docHtml.includes('Chair, BSIT Department'), 'Must include Chair, BSIT Department');
    assert.ok(docHtml.includes('Submitted to:'), 'Must include Submitted to block');
    assert.ok(docHtml.includes('Dean, COTE'), 'Must include Dean, COTE');

    // 7. Check Gallery
    assert.ok(docHtml.includes('GALLERY'), 'Must include GALLERY banner');
    assert.ok(docHtml.includes('VERIFIABLE EVIDENCE / DOCUMENTS'), 'Must include VERIFIABLE EVIDENCE / DOCUMENTS');
    assert.ok(docHtml.includes('DEPZILLA OJT PROJECT PRESENTATION'), 'Gallery must render item title in uppercase');
});

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function runSuite() {
    console.log('\n======================================================');
    console.log('   CITE-FLOW — CHAIRPERSON MFO MANUAL EDITING SUITE');
    console.log('======================================================\n');

    for (const test of tests) {
        try {
            await test.fn();
            console.log(`[PASS] ${test.title}`);
            passCount++;
        } catch (err) {
            console.error(`[FAIL] ${test.title}`);
            console.error(err);
            failCount++;
        }
    }

    console.log('\n======================================================');
    console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('======================================================\n');

    if (failCount > 0) {
        process.exit(1);
    }
}

runSuite();
