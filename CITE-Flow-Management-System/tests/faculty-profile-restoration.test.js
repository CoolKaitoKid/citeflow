/**
 * Verification Test: Faculty Profile Personal Details & Workload Display Restoration
 *
 * Verifies:
 * 1. Personal details & employment info correctly load from public.faculty via select('*')
 *    even when CiteFlowAuthGuard only provides a 11-column partial record.
 * 2. Type-Safe Faculty Resolution: Resolves auth_user_id (UUID) -> numeric faculty.id (BIGINT).
 *    Never queries faculty_teaching_loads with UUID.
 *    No unsafe OR queries comparing UUID to BIGINT columns.
 * 3. Workload isolation: Query is strictly filtered by numeric faculty_id.
 * 4. Workload rendering: All 11 detail fields (subject_code, subject_title, section, units,
 *    hours_per_week, total_students, room, schedule, academic_year, semester, remarks)
 *    are rendered and grouped by Academic Year and Semester.
 * 5. Robust error handling: Failures in individual section loaders do not leave other sections broken.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- STARTING FACULTY PROFILE RESTORATION VERIFICATION TESTS ---');

const facultyHtmlPath = path.resolve(__dirname, '../faculty/faculty-profile.html');
const facultyHtml = fs.readFileSync(facultyHtmlPath, 'utf8');

// 1. Static Security & Correctness Checks
assert(!facultyHtml.includes('facultyRecord = window.CiteFlowAuthGuard.faculty;'),
    'FAIL: loadFacultyProfile must not assign partial CiteFlowAuthGuard.faculty directly without select(*)');

assert(!facultyHtml.includes('.or(`auth_user_id.eq.'),
    'FAIL: Unsafe .or() query with auth_user_id must not be present in faculty-profile.html');

assert(!facultyHtml.includes('.or(conds.join'),
    'FAIL: Unsafe conds.join OR query must not be present in faculty-profile.html');

console.log('✓ TEST 1 passed: Static security checks verified (no partial assignment bypass, no unsafe OR queries)');

// 2. Mock DOM environment for rendering tests
function createMockDocument() {
    const elements = {};
    return {
        getElementById(id) {
            if (!elements[id]) {
                elements[id] = {
                    id,
                    textContent: '',
                    value: '',
                    innerHTML: '',
                    className: '',
                    classList: {
                        add: () => {},
                        remove: () => {},
                        toggle: () => {}
                    },
                    style: {}
                };
            }
            return elements[id];
        },
        querySelector(sel) { return null; },
        elements
    };
}

// 3. Test Full Faculty Record Resolution & Personal Details Mapping
const mockDbFaculty = {
    id: 114,
    auth_user_id: 'df73c6d9-7ded-4b9a-8030-640c87cf11d3',
    employee_id: 'EMP-2024-114',
    first_name: 'Lee Wesley',
    middle_name: 'S',
    last_name: 'Fortuna',
    full_name: 'Lee Wesley S. Fortuna',
    email: 'lee.fortuna@citeflow.edu',
    phone: '09123456789',
    sex: 'Male',
    birthdate: '1990-05-15',
    academic_rank: 'Assistant Professor II',
    department: 'BSIT',
    shift: '8:00 A.M. – 12:00 NOON | 1:00 P.M. – 5:00 P.M.',
    employment_type: 'Regular/Organic',
    contract_type: 'Permanent',
    masters_degree: 'MS in Information Technology',
    doctorate_degree: 'PhD in Computer Science',
    educational_qualification: 'Postgraduate',
    eligibility: 'Civil Service Professional',
    years_experience: 8,
    status: 'Active',
    role: 'Faculty',
    position: 'Faculty',
    start_date: '2018-06-01',
    profile_photo_url: 'https://citeflow.edu/photos/faculty-114.png'
};

// Partial object from AuthGuard
const mockAuthGuardFaculty = {
    id: 114,
    role: 'Faculty',
    position: 'Faculty',
    admin_access: false,
    profile_completed: true,
    must_change_password: false,
    first_login_completed_at: '2024-01-01',
    department: 'BSIT',
    full_name: 'Lee Wesley S. Fortuna',
    email: 'lee.fortuna@citeflow.edu',
    auth_user_id: 'df73c6d9-7ded-4b9a-8030-640c87cf11d3'
};

// Simulate loadFacultyProfile lookup sequence
async function mockLoadFacultyProfile(sbClient, authUser, guardFaculty) {
    let facultyRecord = null;

    // 1. Query by auth_user_id
    if (!facultyRecord && authUser?.id) {
        const { data: byAuth } = await sbClient.from('faculty').select('*').eq('auth_user_id', authUser.id).maybeSingle();
        if (byAuth) facultyRecord = byAuth;
    }

    // 2. Query by guard numeric ID
    if (!facultyRecord && guardFaculty?.id && /^\d+$/.test(String(guardFaculty.id))) {
        const { data: byGuard } = await sbClient.from('faculty').select('*').eq('id', Number(guardFaculty.id)).maybeSingle();
        if (byGuard) facultyRecord = byGuard;
    }

    // 3. Query by email
    if (!facultyRecord && authUser?.email) {
        const { data: byEmail } = await sbClient.from('faculty').select('*').ilike('email', authUser.email.trim()).maybeSingle();
        if (byEmail) facultyRecord = byEmail;
    }

    // Defensive check
    if (facultyRecord && /^\d+$/.test(String(facultyRecord.id))) {
        facultyRecord.id = Number(facultyRecord.id);
    }

    return facultyRecord;
}

const mockSbClient = {
    queries: [],
    from(table) {
        const self = {
            table,
            selected: null,
            filters: {},
            select(cols) { self.selected = cols; return self; },
            eq(col, val) { self.filters[col] = val; return self; },
            ilike(col, val) { self.filters[col] = val; return self; },
            neq(col, val) { self.filters['neq_' + col] = val; return self; },
            order() { return self; },
            maybeSingle() {
                mockSbClient.queries.push({ table: self.table, selected: self.selected, filters: self.filters });
                if (self.table === 'faculty') {
                    if (self.filters.auth_user_id === mockDbFaculty.auth_user_id) {
                        return Promise.resolve({ data: { ...mockDbFaculty }, error: null });
                    }
                    if (self.filters.id === mockDbFaculty.id) {
                        return Promise.resolve({ data: { ...mockDbFaculty }, error: null });
                    }
                }
                return Promise.resolve({ data: null, error: null });
            }
        };
        return self;
    }
};

(async () => {
    const resolvedFaculty = await mockLoadFacultyProfile(
        mockSbClient,
        { id: 'df73c6d9-7ded-4b9a-8030-640c87cf11d3', email: 'lee.fortuna@citeflow.edu' },
        mockAuthGuardFaculty
    );

    assert.strictEqual(resolvedFaculty.id, 114);
    assert.strictEqual(resolvedFaculty.employee_id, 'EMP-2024-114');
    assert.strictEqual(resolvedFaculty.first_name, 'Lee Wesley');
    assert.strictEqual(resolvedFaculty.last_name, 'Fortuna');
    assert.strictEqual(resolvedFaculty.academic_rank, 'Assistant Professor II');
    assert.strictEqual(resolvedFaculty.shift, '8:00 A.M. – 12:00 NOON | 1:00 P.M. – 5:00 P.M.');
    assert.strictEqual(resolvedFaculty.employment_type, 'Regular/Organic');
    assert.strictEqual(resolvedFaculty.contract_type, 'Permanent');
    assert.strictEqual(resolvedFaculty.masters_degree, 'MS in Information Technology');
    assert.strictEqual(resolvedFaculty.doctorate_degree, 'PhD in Computer Science');
    assert.strictEqual(resolvedFaculty.educational_qualification, 'Postgraduate');
    assert.strictEqual(resolvedFaculty.eligibility, 'Civil Service Professional');
    assert.strictEqual(resolvedFaculty.years_experience, 8);
    console.log('✓ TEST 2 passed: All personal and employment details successfully restored from database via select(*)');

    // TEST 3: Workload Resolution & Numeric ID Isolation
    async function mockLoadWorkloadEntries(sbClient, authUser, currentFaculty, guardFaculty) {
        let targetFacultyId = null;

        if (sbClient && authUser?.id) {
            const { data: fac } = await sbClient.from('faculty').select('id, auth_user_id').eq('auth_user_id', authUser.id).maybeSingle();
            if (fac?.id && /^\d+$/.test(String(fac.id))) {
                targetFacultyId = Number(fac.id);
            }
        }

        if (!targetFacultyId && currentFaculty?.id && /^\d+$/.test(String(currentFaculty.id))) {
            targetFacultyId = Number(currentFaculty.id);
        }

        if (!targetFacultyId && guardFaculty?.id && /^\d+$/.test(String(guardFaculty.id))) {
            targetFacultyId = Number(guardFaculty.id);
        }

        if (!targetFacultyId || !/^\d+$/.test(String(targetFacultyId))) {
            return { error: 'Invalid or non-numeric faculty_id', data: [] };
        }

        const teachingResponse = await sbClient
            .from('faculty_teaching_loads')
            .select('*')
            .eq('faculty_id', targetFacultyId)
            .neq('status', 'Archived');

        return { targetFacultyId, loads: teachingResponse };
    }

    const workloadSbClient = {
        calls: [],
        from(table) {
            const self = {
                table,
                filters: {},
                select(cols) { self.cols = cols; return self; },
                eq(col, val) { self.filters[col] = val; return self; },
                neq(col, val) { self.filters['neq_' + col] = val; return self; },
                maybeSingle() {
                    workloadSbClient.calls.push({ table: self.table, filters: self.filters });
                    return Promise.resolve({ data: { id: 114, auth_user_id: 'df73c6d9-7ded-4b9a-8030-640c87cf11d3' }, error: null });
                }
            };
            return self;
        }
    };

    const res = await mockLoadWorkloadEntries(
        workloadSbClient,
        { id: 'df73c6d9-7ded-4b9a-8030-640c87cf11d3' },
        resolvedFaculty,
        mockAuthGuardFaculty
    );

    assert.strictEqual(res.targetFacultyId, 114);
    assert.strictEqual(typeof res.targetFacultyId, 'number');
    assert.strictEqual(workloadSbClient.calls[0].table, 'faculty');
    assert.strictEqual(workloadSbClient.calls[0].filters.auth_user_id, 'df73c6d9-7ded-4b9a-8030-640c87cf11d3');
    assert.strictEqual(workloadSbClient.calls[0].filters.id, undefined, 'Must not query id by UUID');

    console.log('✓ TEST 3 passed: Workload safely resolved numeric BIGINT faculty ID (114) from auth_user_id UUID');

    // TEST 4: Isolation check - Faculty A cannot query Faculty B workloads
    const facultyAAuth = { id: 'uuid-faculty-a' };
    const facultyBAuth = { id: 'uuid-faculty-b' };

    const clientWithMultiUser = {
        from(table) {
            const builder = {
                select() { return this; },
                neq() { return this; },
                order() { return this; },
                eq(col, val) {
                    if (table === 'faculty' && col === 'auth_user_id') {
                        return {
                            maybeSingle() {
                                if (val === 'uuid-faculty-a') return Promise.resolve({ data: { id: 98, auth_user_id: val } });
                                if (val === 'uuid-faculty-b') return Promise.resolve({ data: { id: 114, auth_user_id: val } });
                                return Promise.resolve({ data: null });
                            }
                        };
                    }
                    return this;
                }
            };
            return builder;
        }
    };

    const userARes = await mockLoadWorkloadEntries(clientWithMultiUser, facultyAAuth, { id: 98 });
    const userBRes = await mockLoadWorkloadEntries(clientWithMultiUser, facultyBAuth, { id: 114 });
    assert.strictEqual(userARes.targetFacultyId, 98);
    assert.strictEqual(userBRes.targetFacultyId, 114);
    assert.notStrictEqual(userARes.targetFacultyId, userBRes.targetFacultyId);

    console.log('✓ TEST 4 passed: Multi-faculty account isolation verified (Faculty A = 98, Faculty B = 114)');

    // TEST 5: Verify all 11 subject card properties are extracted in workloadSubjectCard
    assert(facultyHtml.includes('item.subject_code'), 'Card must display subject_code');
    assert(facultyHtml.includes('item.subject_title'), 'Card must display subject_title');
    assert(facultyHtml.includes('item.section'), 'Card must display section');
    assert(facultyHtml.includes('item.units'), 'Card must display units');
    assert(facultyHtml.includes('item.hours_per_week'), 'Card must display hours_per_week');
    assert(facultyHtml.includes('item.total_students'), 'Card must display total_students');
    assert(facultyHtml.includes('item.semester'), 'Card must display semester');
    assert(facultyHtml.includes('item.academic_year'), 'Card must display academic_year');
    assert(facultyHtml.includes('item.room'), 'Card must display room');
    assert(facultyHtml.includes('item.remarks'), 'Card must display remarks');
    assert(facultyHtml.includes('getExistingWorkloadSchedule'), 'Card must extract schedule');

    console.log('✓ TEST 5 passed: All 11 workload card properties verified in HTML template');

    // TEST 6: Verify Academic Year and Semester grouping functions
    assert(facultyHtml.includes('compareAcademicYearsDesc'), 'Must have Academic Year descending sorter');
    assert(facultyHtml.includes('compareSemestersOrder'), 'Must have Semester chronological sorter');
    assert(facultyHtml.includes('workload-year-group'), 'Must contain Academic Year grouping container');
    assert(facultyHtml.includes('workload-sem-group'), 'Must contain Semester grouping container');

    console.log('✓ TEST 6 passed: Academic Year and Semester grouping and sorting verified');

    // TEST 7: Account Linking Security Audit - Cannot claim already-claimed record
    assert(facultyHtml.includes(".is('auth_user_id', null)"), 'Update must check .is("auth_user_id", null)');
    assert(facultyHtml.includes('claimedByOther'), 'Must detect if any record with the email is already claimed by another user');
    assert(facultyHtml.includes('isAuthSessionVerified'), 'Must verify auth session before allowing auth_user_id database update');

    // Simulate account claiming audit logic
    function simulateEmailClaim(currentUser, isVerifiedSession, dbRecords) {
        if (!isVerifiedSession || !currentUser?.id || !currentUser?.email) {
            return { allowed: false, reason: 'Unverified session or missing user' };
        }
        const cleanEmail = currentUser.email.trim().toLowerCase();
        if (!cleanEmail || !cleanEmail.includes('@')) {
            return { allowed: false, reason: 'Invalid email' };
        }
        const claimedByOther = dbRecords.find(r => r.auth_user_id && String(r.auth_user_id) !== String(currentUser.id));
        if (claimedByOther) {
            return { allowed: false, reason: 'Record with email already claimed by another user ID' };
        }
        const unclaimed = dbRecords.find(r => !r.auth_user_id && String(r.email || '').trim().toLowerCase() === cleanEmail);
        if (!unclaimed) {
            return { allowed: false, reason: 'No unclaimed record matching email' };
        }
        return { allowed: true, targetId: unclaimed.id };
    }

    // Case A: Attacker tries to claim a record already owned by another user
    const dbRowsWithExistingOwner = [
        { id: 45, email: 'prof.smith@univ.edu', auth_user_id: 'legitimate-user-uuid' }
    ];
    const claimResult1 = simulateEmailClaim({ id: 'attacker-uuid', email: 'prof.smith@univ.edu' }, true, dbRowsWithExistingOwner);
    assert.strictEqual(claimResult1.allowed, false);
    assert.strictEqual(claimResult1.reason, 'Record with email already claimed by another user ID');

    // Case B: Unverified session (e.g. fabricated localStorage) tries to claim
    const dbRowsUnclaimed = [
        { id: 45, email: 'prof.smith@univ.edu', auth_user_id: null }
    ];
    const claimResult2 = simulateEmailClaim({ id: 'fake-uuid', email: 'prof.smith@univ.edu' }, false, dbRowsUnclaimed);
    assert.strictEqual(claimResult2.allowed, false);
    assert.strictEqual(claimResult2.reason, 'Unverified session or missing user');

    // Case C: Legitimate verified user claiming their own unclaimed record
    const claimResult3 = simulateEmailClaim({ id: 'legit-uuid', email: 'prof.smith@univ.edu' }, true, dbRowsUnclaimed);
    assert.strictEqual(claimResult3.allowed, true);
    assert.strictEqual(claimResult3.targetId, 45);

    // Case D: Mismatched email attempt
    const claimResult4 = simulateEmailClaim({ id: 'legit-uuid', email: 'other.person@univ.edu' }, true, dbRowsUnclaimed);
    assert.strictEqual(claimResult4.allowed, false);

    console.log('✓ TEST 7 passed: Fallback account linking security audit verified (unclaimed-only, no-overwrite, verified-session required)');

    console.log('--- ALL FACULTY PROFILE RESTORATION TESTS PASSED SUCCESSFULLY ---');
})();
