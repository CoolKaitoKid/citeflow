const assert = require('assert');
const path = require('path');

const api = require('../shared/workload-import.js');

async function testRpcAuthWiring() {
    console.log('--- STARTING WORKLOAD IMPORT RPC AUTHENTICATION TESTS ---');

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
        }
    ];

    // TEST 1: commitImport pins client.accessToken from request.session.access_token
    console.log('TEST 1: Verifying client.accessToken is pinned from request.session.access_token...');
    let pinnedToken = null;
    const mockClientWithPin = {
        from() { return { insert: () => Promise.resolve({ data: [] }) }; },
        async rpc(fnName, args) {
            if (typeof this.accessToken === 'function') {
                pinnedToken = await this.accessToken();
            }
            return {
                data: { ok: true, summary: { inserted: 1, replaced: 0, skipped: 0, total: 1 } },
                error: null
            };
        }
    };

    const adminSession = {
        access_token: 'auth-jwt-token-xyz-123',
        user: { id: 'admin-uuid-1', email: 'admin@ctu.edu.ph' }
    };
    const adminFaculty = { id: 1, role: 'Admin', position: 'Administrator', admin_access: true };
    const adminProfile = { id: 'admin-uuid-1', role: 'Administrator' };

    const res1 = await api.commitImport({
        plans: samplePlans,
        session: adminSession,
        facultyRecord: adminFaculty,
        adminProfile: adminProfile,
        client: mockClientWithPin,
        strategy: 'add',
        targetAcademicYear: '2025-2026',
        targetSemester: '1st Semester'
    });

    assert.strictEqual(res1.ok, true, 'Import should succeed');
    assert.strictEqual(pinnedToken, 'auth-jwt-token-xyz-123', 'client.accessToken must be pinned to the session access_token');
    console.log('✓ TEST 1 passed: client.accessToken was correctly pinned to the authenticated token');

    // TEST 2: commitImport resolves activeToken from client.auth.getSession() when request.session has no access_token
    console.log('TEST 2: Verifying token recovery via client.auth.getSession() when session.access_token is omitted...');
    let recoveredToken = null;
    const mockClientWithAuth = {
        auth: {
            getSession: async () => ({
                data: {
                    session: {
                        access_token: 'recovered-auth-jwt-456',
                        user: { id: 'admin-uuid-1', email: 'admin@ctu.edu.ph' }
                    }
                },
                error: null
            })
        },
        from() { return { insert: () => Promise.resolve({ data: [] }) }; },
        async rpc(fnName, args) {
            if (typeof this.accessToken === 'function') {
                recoveredToken = await this.accessToken();
            }
            return {
                data: { ok: true, summary: { inserted: 1, replaced: 0, skipped: 0, total: 1 } },
                error: null
            };
        }
    };

    const sessionWithoutToken = {
        user: { id: 'admin-uuid-1', email: 'admin@ctu.edu.ph' }
    };

    const res2 = await api.commitImport({
        plans: samplePlans,
        session: sessionWithoutToken,
        facultyRecord: adminFaculty,
        adminProfile: adminProfile,
        client: mockClientWithAuth,
        strategy: 'add',
        targetAcademicYear: '2025-2026',
        targetSemester: '1st Semester'
    });

    assert.strictEqual(res2.ok, true, 'Import should succeed with recovered token');
    assert.strictEqual(recoveredToken, 'recovered-auth-jwt-456', 'client.accessToken must be pinned to the recovered access_token');
    console.log('✓ TEST 2 passed: token was seamlessly recovered and pinned from client.auth.getSession()');

    // TEST 3: Handles 42501 permission denied gracefully with clear message
    console.log('TEST 3: Verifying 42501 / permission denied error handling...');
    const rejectingClient = {
        from() { return { insert: () => Promise.resolve({ data: [] }) }; },
        rpc: async () => ({
            data: null,
            error: {
                code: '42501',
                message: 'permission denied for function commit_workload_import'
            }
        })
    };

    const res3 = await api.commitImport({
        plans: samplePlans,
        session: adminSession,
        facultyRecord: adminFaculty,
        adminProfile: adminProfile,
        client: rejectingClient,
        strategy: 'add',
        targetAcademicYear: '2025-2026',
        targetSemester: '1st Semester'
    });

    assert.strictEqual(res3.ok, false, 'Import must report failure');
    assert.strictEqual(res3.aborted, true, 'Import must be aborted');
    assert.ok(res3.message.includes('permission denied') || res3.message.includes('Access Denied'), 'Error message must be preserved');
    console.log('✓ TEST 3 passed: 42501 error was correctly caught and surfaced');

    console.log('--- ALL WORKLOAD IMPORT RPC AUTHENTICATION TESTS PASSED ---');
}

testRpcAuthWiring().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});

