const assert = require('assert');
const path = require('path');

// Load workload-import module
const workloadImportPath = path.resolve(__dirname, '../shared/workload-import.js');
const api = require('../shared/workload-import.js');

async function testAllFourRoles() {
    console.log('--- STARTING 4-ROLE WORKLOAD IMPORT AUTHORIZATION TESTS ---');

    const samplePlans = [
        {
            localId: 'p-1',
            willWrite: true,
            action: 'insert',
            payload: {
                faculty_id: 101,
                subject_code: 'IT 101',
                subject_title: 'Intro to IT',
                section: 'BSIT 1-A',
                units: 3.0,
                hours_per_week: 3.0,
                academic_year: '2025-2026',
                semester: '1st Semester'
            }
        },
        {
            localId: 'p-2',
            willWrite: true,
            action: 'insert',
            payload: {
                faculty_id: 102,
                subject_code: 'IT 102',
                subject_title: 'Programming 1',
                section: 'BSIT 1-B',
                units: 3.0,
                hours_per_week: 3.0,
                academic_year: '2025-2026',
                semester: '1st Semester'
            }
        }
    ];

    // Mock DB client that simulates commit_workload_import RPC
    function makeMockClient(userRole) {
        return {
            from() {
                return {
                    insert: () => Promise.resolve({ data: [{ id: 'mock-load-1' }], error: null }),
                    update: () => Promise.resolve({ data: [{ id: 'mock-load-1' }], error: null }),
                    select: () => Promise.resolve({ data: [], error: null })
                };
            },
            rpc(fnName, args) {
                if (fnName === 'commit_workload_import') {
                    // Check userRole
                    const norm = String(userRole || '').toLowerCase();
                    const isAuthorized = norm.includes('admin') || norm.includes('dean') || norm.includes('secretary');
                    if (!isAuthorized || norm.includes('chair') || norm.includes('faculty')) {
                        return Promise.resolve({
                            data: null,
                            error: {
                                code: '42501',
                                message: 'Access Denied: Only Administrator, College Dean, and College Secretary accounts can manage workload imports.'
                            }
                        });
                    }
                    return Promise.resolve({
                        data: {
                            ok: true,
                            strategy: args.p_strategy,
                            summary: {
                                inserted: args.p_records.length,
                                replaced: 0,
                                skipped: 0,
                                total: args.p_records.length
                            }
                        },
                        error: null
                    });
                }
                return Promise.reject(new Error('Unknown RPC: ' + fnName));
            }
        };
    }

    // 1. Role 1: Administrator
    console.log('Testing Role 1: Administrator...');
    const adminSession = { user: { id: 'admin-uuid-1', email: 'admin@cite.edu' } };
    const adminFacultyRecord = { id: 1, role: 'Admin', position: 'Administrator', admin_access: true };
    const adminProfile = { id: 'admin-uuid-1', role: 'Administrator' };

    const adminCheck = api.assertImportAllowed(adminSession, adminFacultyRecord, adminProfile);
    assert.strictEqual(adminCheck.ok, true, 'Administrator must be allowed');
    assert.strictEqual(adminCheck.role, 'Administrator', 'Role must resolve to Administrator');

    const adminSaveRes = await api.commitImport({
        plans: samplePlans,
        session: adminSession,
        facultyRecord: adminFacultyRecord,
        adminProfile: adminProfile,
        client: makeMockClient('Administrator'),
        strategy: 'add',
        academicYear: '2025-2026',
        semester: '1st Semester'
    });
    assert.strictEqual(adminSaveRes.ok, true, 'Administrator import and save must succeed');
    assert.strictEqual(adminSaveRes.summary.inserted, 2, 'Administrator must insert records');
    console.log('✓ Administrator: import and save succeeded');

    // 2. Role 2: College Dean
    console.log('Testing Role 2: College Dean...');
    const deanSession = { user: { id: 'dean-uuid-1', email: 'dean@cite.edu' } };
    const deanFacultyRecord = { id: 2, role: 'Admin', position: 'College Dean', admin_access: true };
    const deanAdminProfile = { id: 'dean-uuid-1', role: 'College Dean' };

    const deanCheck = api.assertImportAllowed(deanSession, deanFacultyRecord, deanAdminProfile);
    assert.strictEqual(deanCheck.ok, true, 'College Dean must be allowed');
    assert.strictEqual(deanCheck.role, 'College Dean', 'Role must resolve to College Dean');

    const deanSaveRes = await api.commitImport({
        plans: samplePlans,
        session: deanSession,
        facultyRecord: deanFacultyRecord,
        adminProfile: deanAdminProfile,
        client: makeMockClient('College Dean'),
        strategy: 'replace',
        academicYear: '2025-2026',
        semester: '1st Semester'
    });
    assert.strictEqual(deanSaveRes.ok, true, 'College Dean import and save must succeed');
    assert.strictEqual(deanSaveRes.summary.inserted, 2, 'College Dean must insert records');
    console.log('✓ College Dean: import and save succeeded');

    // 3. Role 3: College Secretary
    console.log('Testing Role 3: College Secretary...');
    const secSession = { user: { id: 'sec-uuid-1', email: 'sec@cite.edu' } };
    const secFacultyRecord = { id: 3, role: 'Admin', position: 'College Secretary', admin_access: true };
    const secAdminProfile = { id: 'sec-uuid-1', role: 'College Secretary' };

    const secCheck = api.assertImportAllowed(secSession, secFacultyRecord, secAdminProfile);
    assert.strictEqual(secCheck.ok, true, 'College Secretary must be allowed');
    assert.strictEqual(secCheck.role, 'College Secretary', 'Role must resolve to College Secretary');

    const secSaveRes = await api.commitImport({
        plans: samplePlans,
        session: secSession,
        facultyRecord: secFacultyRecord,
        adminProfile: secAdminProfile,
        client: makeMockClient('College Secretary'),
        strategy: 'add',
        academicYear: '2025-2026',
        semester: '1st Semester'
    });
    assert.strictEqual(secSaveRes.ok, true, 'College Secretary import and save must succeed');
    assert.strictEqual(secSaveRes.summary.inserted, 2, 'College Secretary must insert records');
    console.log('✓ College Secretary: import and save succeeded');

    // 4. Role 4: Faculty Account (Excluded)
    console.log('Testing Role 4: Faculty...');
    const facSession = { user: { id: 'fac-uuid-1', email: 'fac@cite.edu' } };
    const facRecord = { id: 4, role: 'Faculty', position: 'Instructor I', admin_access: false };
    const facAdminProfile = null;

    const facCheck = api.assertImportAllowed(facSession, facRecord, facAdminProfile);
    assert.strictEqual(facCheck.ok, false, 'Faculty must NOT be allowed to import');
    assert.ok(facCheck.message.includes('Access Denied'), 'Message must indicate access denied');

    // Attempting commitImport with client check
    const facSaveRes = await api.commitImport({
        plans: samplePlans,
        session: facSession,
        facultyRecord: facRecord,
        adminProfile: facAdminProfile,
        client: makeMockClient('Faculty'),
        strategy: 'add',
        academicYear: '2025-2026',
        semester: '1st Semester'
    });
    assert.strictEqual(facSaveRes.ok, false, 'Faculty import must be aborted');
    assert.strictEqual(facSaveRes.aborted, true, 'Faculty import must be aborted before execution');

    // Direct RPC call by Faculty
    const facDirectRpc = await makeMockClient('Faculty').rpc('commit_workload_import', {
        p_strategy: 'add',
        p_records: samplePlans.map(p => p.payload)
    });
    assert.ok(facDirectRpc.error, 'Direct RPC call by Faculty must return error');
    assert.strictEqual(facDirectRpc.error.code, '42501', 'Direct RPC call must return 42501');
    assert.ok(facDirectRpc.error.message.includes('Access Denied'), 'Direct RPC call must be Access Denied');
    console.log('✓ Faculty: import is unavailable and direct RPC calls are rejected');

    // 5. Additional Role: Chairperson (Excluded)
    console.log('Testing Chairperson...');
    const chairSession = { user: { id: 'chair-uuid-1', email: 'chair@cite.edu' } };
    const chairRecord = { id: 5, role: 'Chairperson', position: 'Department Chairperson', admin_access: false };

    const chairCheck = api.assertImportAllowed(chairSession, chairRecord, null);
    assert.strictEqual(chairCheck.ok, false, 'Chairperson must NOT be allowed to import');

    const chairDirectRpc = await makeMockClient('Chairperson').rpc('commit_workload_import', {
        p_strategy: 'add',
        p_records: samplePlans.map(p => p.payload)
    });
    assert.ok(chairDirectRpc.error, 'Direct RPC call by Chairperson must return error');
    assert.strictEqual(chairDirectRpc.error.code, '42501', 'Direct RPC call must return 42501');
    console.log('✓ Chairperson: import is unavailable and direct RPC calls are rejected');

    console.log('--- ALL 4-ROLE WORKLOAD IMPORT AUTHORIZATION TESTS PASSED ---');
}

testAllFourRoles().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
