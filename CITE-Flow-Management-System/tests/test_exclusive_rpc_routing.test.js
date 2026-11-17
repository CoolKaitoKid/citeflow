// ==============================================================================
// TEST: Exclusive commit_workload_import RPC Routing & Direct INSERT Prevention
// ==============================================================================

const assert = require('assert');
const api = require('../shared/workload-import.js');

async function runTests() {
    console.log('--- STARTING EXCLUSIVE RPC ROUTING & DIRECT INSERT PREVENTION TESTS ---');

    const adminSession = {
        access_token: 'fake-admin-jwt-token',
        user: { id: 'admin-uuid-1', role: 'authenticated' }
    };
    const adminFaculty = { role: 'Administrator', admin_access: true };
    const adminProfile = { id: 'admin-uuid-1', role: 'Administrator' };

    const samplePlans = [
        {
            willWrite: true,
            action: 'insert',
            selected: true,
            facultyId: 43,
            label: 'Row 1',
            source: { fileType: 'pdf', page: 1 },
            payload: {
                faculty_id: 43,
                subject_code: 'GEN103',
                subject_title: 'Technology',
                section: 'BSIT 4A',
                units: 3,
                academic_year: '2026-2027',
                semester: '1st Semester',
                schedule_day: 'Friday',
                start_time: '9:00 AM',
                end_time: '12:00 PM',
                status: 'Active',
                schedule_entries: [{ day: 'Friday', start_time: '9:00 AM', end_time: '12:00 PM' }]
            }
        }
    ];

    // TEST 1: Strategy 'add' with { success: true, inserted_count: 1 } return shape
    // Must succeed via RPC and NEVER call client.from('faculty_teaching_loads').insert
    {
        console.log("TEST 1: RPC returning { success: true, inserted_count: 1 }...");
        let rpcCalled = false;
        let directInsertCalled = false;
        const mockClient = {
            rpc(fn, args) {
                rpcCalled = true;
                assert.strictEqual(fn, 'commit_workload_import');
                assert.strictEqual(args.p_strategy, 'add');
                assert.strictEqual(args.p_records[0].faculty_id, 43);
                assert.strictEqual(args.p_records[0].subject_code, 'GEN103');
                return Promise.resolve({
                    data: {
                        success: true,
                        inserted_count: 1,
                        deleted_count: 0,
                        skipped_count: 0,
                        strategy: 'add'
                    },
                    error: null
                });
            },
            from(table) {
                if (table === 'faculty_teaching_loads') {
                    directInsertCalled = true;
                }
                return {
                    insert() { return Promise.resolve({ data: [{ id: 999 }], error: null }); },
                    select() { return Promise.resolve({ data: [], error: null }); }
                };
            }
        };

        const result = await api.commitImport({
            plans: samplePlans,
            session: adminSession,
            facultyRecord: adminFaculty,
            adminProfile: adminProfile,
            client: mockClient,
            strategy: 'add',
            targetAcademicYear: '2026-2027',
            targetSemester: '1st Semester'
        });

        assert.strictEqual(rpcCalled, true, 'Must call commit_workload_import RPC');
        assert.strictEqual(directInsertCalled, false, 'Must NEVER call client.from(faculty_teaching_loads)');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.summary.inserted, 1);
        console.log("✓ TEST 1 passed: Returned success and 0 direct table queries.");
    }

    // TEST 2: Strategy 'add' with { ok: true, summary: { inserted: 1 } } return shape
    {
        console.log("TEST 2: RPC returning { ok: true, summary: ... }...");
        let rpcCalled = false;
        let directInsertCalled = false;
        const mockClient = {
            rpc(fn, args) {
                rpcCalled = true;
                return Promise.resolve({
                    data: {
                        ok: true,
                        strategy: 'add',
                        summary: { inserted: 1, replaced: 0, skipped: 0, total: 1 }
                    },
                    error: null
                });
            },
            from(table) {
                directInsertCalled = true;
                return {};
            }
        };

        const result = await api.commitImport({
            plans: samplePlans,
            session: adminSession,
            facultyRecord: adminFaculty,
            adminProfile: adminProfile,
            client: mockClient,
            strategy: 'add',
            targetAcademicYear: '2026-2027',
            targetSemester: '1st Semester'
        });

        assert.strictEqual(rpcCalled, true);
        assert.strictEqual(directInsertCalled, false, 'Must NEVER call client.from(faculty_teaching_loads)');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.summary.inserted, 1);
        console.log("✓ TEST 2 passed: Standard shape handled without direct table access.");
    }

    // TEST 3: Strategy 'add' with PGRST202 error does NOT fall back to direct INSERT
    {
        console.log("TEST 3: PGRST202 on strategy 'add' halts safely without direct INSERT...");
        let directInsertCalled = false;
        const mockClient = {
            rpc() {
                return Promise.resolve({
                    data: null,
                    error: { code: 'PGRST202', message: 'Could not find function public.commit_workload_import' }
                });
            },
            from() {
                directInsertCalled = true;
                return {};
            }
        };

        const result = await api.commitImport({
            plans: samplePlans,
            session: adminSession,
            facultyRecord: adminFaculty,
            adminProfile: adminProfile,
            client: mockClient,
            strategy: 'add',
            targetAcademicYear: '2026-2027',
            targetSemester: '1st Semester'
        });

        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.aborted, true);
        assert.strictEqual(directInsertCalled, false, 'PGRST202 must NOT trigger direct INSERT fallback!');
        assert.ok(/migration 033/i.test(result.message));
        console.log("✓ TEST 3 passed: PGRST202 cleanly halted with migration message.");
    }

    // TEST 4: Strategy 'replace' deletes and replaces atomically through RPC
    {
        console.log("TEST 4: Strategy 'replace' routes through RPC...");
        let rpcCalled = false;
        let directInsertCalled = false;
        const mockClient = {
            rpc(fn, args) {
                rpcCalled = true;
                assert.strictEqual(args.p_strategy, 'replace');
                return Promise.resolve({
                    data: {
                        success: true,
                        inserted_count: 1,
                        deleted_count: 2,
                        strategy: 'replace'
                    },
                    error: null
                });
            },
            from() {
                directInsertCalled = true;
                return {};
            }
        };

        const result = await api.commitImport({
            plans: samplePlans,
            session: adminSession,
            facultyRecord: adminFaculty,
            adminProfile: adminProfile,
            client: mockClient,
            strategy: 'replace',
            targetAcademicYear: '2026-2027',
            targetSemester: '1st Semester'
        });

        assert.strictEqual(rpcCalled, true);
        assert.strictEqual(directInsertCalled, false);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.summary.inserted, 1);
        assert.strictEqual(result.summary.replaced, 2);
        console.log("✓ TEST 4 passed: Replace strategy handled atomically via RPC.");
    }

    // TEST 5: Browser context guard prevents any direct table fallback if rpc is missing
    {
        console.log("TEST 5: Browser environment strictly forbids direct table fallback...");
        global.window = { CiteFlowAuth: {} };
        let directCalled = false;
        const clientWithoutRpc = {
            from() {
                directCalled = true;
                return {};
            }
        };

        const result = await api.commitImport({
            plans: samplePlans,
            session: adminSession,
            facultyRecord: adminFaculty,
            adminProfile: adminProfile,
            client: clientWithoutRpc,
            strategy: 'add',
            targetAcademicYear: '2026-2027',
            targetSemester: '1st Semester'
        });

        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.aborted, true);
        assert.strictEqual(directCalled, false, 'Browser must NEVER call client.from() fallback');
        delete global.window;
        console.log("✓ TEST 5 passed: Browser environment strictly blocks direct table write fallback.");
    }

    console.log('--- ALL EXCLUSIVE RPC ROUTING & DIRECT INSERT PREVENTION TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});

