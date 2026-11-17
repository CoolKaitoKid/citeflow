/**
 * Tests for Workload Tracker & Faculty Profile Synchronization
 *
 * Verifies:
 * 1. Dynamic Academic Year filter options (newest first, no duplicates, handles new years)
 * 2. Dynamic Semester filter options (standard term order, no duplicates, handles new terms)
 * 3. Multi-filter combination and metrics aggregation (preps, units, hours, sections, students)
 * 4. Action details inspection (verifies presence of all 11 required fields)
 * 5. Post-import refresh trigger logic (success/skipped vs error/abort)
 * 6. Faculty Profile workload grouping by Academic Year and Semester
 */

const assert = require('assert');

// ── 1. Academic Year Normalization and Sorting (Newest First) ───────────
function normalizeTrackerAcademicYear(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/(20\d{2})\s*[-–—/]\s*(20\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    return raw.replace(/\s+/g, ' ');
}

function parseYearNum(y) {
    const m = String(y || '').match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : 0;
}

function getSortedAcademicYears(records) {
    return [...new Set(
        records
            .map((t) => normalizeTrackerAcademicYear(t.academic_year || t.school_year || ''))
            .filter(Boolean)
    )].sort((a, b) => {
        const diff = parseYearNum(b) - parseYearNum(a);
        return diff !== 0 ? diff : b.localeCompare(a);
    });
}

// ── 2. Semester Normalization and Sorting (Standard Term Order) ─────────
function normalizeTrackerSemester(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (/^(1st|first)\b/.test(lower) || /\b1st\s*sem/i.test(lower)) return '1st Semester';
    if (/^(2nd|second)\b/.test(lower) || /\b2nd\s*sem/i.test(lower)) return '2nd Semester';
    if (/summer|midyear|mid-year/i.test(lower)) return 'Summer';
    return raw;
}

function getSortedSemesters(records) {
    const semesterOrder = { '1st semester': 1, '2nd semester': 2, 'summer': 3, 'midyear': 3, 'mid-year': 3 };
    const rawSemesters = records
        .map((t) => normalizeTrackerSemester(t.semester || t.term || ''))
        .filter(Boolean);
    return [...new Set(rawSemesters)].sort((a, b) => {
        const ordA = semesterOrder[a.toLowerCase()] || 99;
        const ordB = semesterOrder[b.toLowerCase()] || 99;
        if (ordA !== ordB) return ordA - ordB;
        return a.localeCompare(b);
    });
}

// ── 3. Multi-Filter and Aggregation Logic ────────────────────────────────
function aggregateFacultyTeaching(teaching) {
    const preparations = new Set(teaching.map(t => t.subject_code || t.subject_title)).size;
    const sections = [...new Set(teaching.map(t => t.section).filter(Boolean))];
    const totalStudents = teaching.reduce((sum, t) => sum + (Number(t.total_students) || 0), 0);
    const units = teaching.reduce((sum, t) => sum + (Number(t.units) || 0), 0);
    const hours = teaching.reduce((sum, t) => sum + (Number(t.hours_per_week) || Number(t.units) || 0), 0);
    return { preparations, sections, totalStudents, units, hours };
}

function applyTrackerFilters(faculties, loads, { query = '', dept = '', academicYear = '', semester = '' }) {
    const normAY = normalizeTrackerAcademicYear(academicYear);
    const normSem = normalizeTrackerSemester(semester);
    const q = query.toLowerCase().trim();

    return faculties.map(f => {
        const facultyLoads = loads.filter(l => String(l.faculty_id) === String(f.id));
        const filtered = facultyLoads.filter(item => {
            if (normSem && normalizeTrackerSemester(item.semester || item.term || '') !== normSem) return false;
            if (normAY && normalizeTrackerAcademicYear(item.academic_year || item.school_year || '') !== normAY) return false;
            return true;
        });

        const metrics = aggregateFacultyTeaching(filtered);
        return {
            facultyId: f.id,
            facultyName: f.full_name,
            department: f.department,
            teaching: filtered,
            ...metrics
        };
    }).filter(row => {
        if (dept && row.department !== dept) return false;
        if (q) {
            const matchName = (row.facultyName || '').toLowerCase().includes(q);
            const matchDept = (row.department || '').toLowerCase().includes(q);
            const matchSubj = row.teaching.some(t =>
                (t.subject_code || '').toLowerCase().includes(q) ||
                (t.subject_title || '').toLowerCase().includes(q) ||
                (t.section || '').toLowerCase().includes(q)
            );
            if (!matchName && !matchDept && !matchSubj) return false;
        }
        return row.teaching.length > 0;
    });
}

// ── 4. Faculty Profile Workload Sub-Grouping ─────────────────────────────
function groupWorkloadsByYearAndSemester(loads) {
    const yearGroups = new Map();
    loads.forEach(item => {
        const yKey = normalizeTrackerAcademicYear(item.academic_year) || 'Unspecified Year';
        if (!yearGroups.has(yKey)) yearGroups.set(yKey, []);
        yearGroups.get(yKey).push(item);
    });

    const sortedYearKeys = [...yearGroups.keys()].sort((a, b) => parseYearNum(b) - parseYearNum(a));

    const result = [];
    sortedYearKeys.forEach(yearKey => {
        const itemsInYear = yearGroups.get(yearKey);
        const semGroups = new Map();
        itemsInYear.forEach(item => {
            const sKey = normalizeTrackerSemester(item.semester) || 'Unspecified Semester';
            if (!semGroups.has(sKey)) semGroups.set(sKey, []);
            semGroups.get(sKey).push(item);
        });

        const semesterOrder = { '1st semester': 1, '2nd semester': 2, 'summer': 3 };
        const sortedSemKeys = [...semGroups.keys()].sort((a, b) => {
            const ordA = semesterOrder[a.toLowerCase()] || 99;
            const ordB = semesterOrder[b.toLowerCase()] || 99;
            return (ordA - ordB) || a.localeCompare(b);
        });

        const semesters = sortedSemKeys.map(semKey => {
            const items = semGroups.get(semKey);
            const units = items.reduce((sum, i) => sum + (Number(i.units) || 0), 0);
            return { semester: semKey, items, count: items.length, units };
        });

        const totalUnits = itemsInYear.reduce((sum, i) => sum + (Number(i.units) || 0), 0);
        result.push({ academicYear: yearKey, totalSubjects: itemsInYear.length, totalUnits, semesters });
    });

    return result;
}

// ── TESTS ───────────────────────────────────────────────────────────────

console.log('--- Test Suite: Workload Tracker & Faculty Profile Synchronization ---');

// Test 1: Academic Year Filter sorting (Newest First)
{
    const sampleLoads = [
        { academic_year: '2024-2025' },
        { academic_year: '2026-2027' },
        { academic_year: '2025-2026' },
        { academic_year: '2026 - 2027' }, // Spacing variant
        { academic_year: '2023-2024' }
    ];
    const sortedYears = getSortedAcademicYears(sampleLoads);
    assert.deepStrictEqual(sortedYears, ['2026-2027', '2025-2026', '2024-2025', '2023-2024']);
    console.log('✓ Academic Year options deduplicated and sorted newest-first');
}

// Test 2: Semester Filter sorting (Standard Term Order)
{
    const sampleLoads = [
        { semester: 'Summer' },
        { semester: '2nd Semester' },
        { semester: '1st Semester' },
        { semester: '2nd Sem' }, // Alias
        { semester: 'First Semester' } // Alias
    ];
    const sortedSemesters = getSortedSemesters(sampleLoads);
    assert.deepStrictEqual(sortedSemesters, ['1st Semester', '2nd Semester', 'Summer']);
    console.log('✓ Semester options deduplicated and ordered standard term order (1st, 2nd, Summer)');
}

// Test 3: Multi-Filter Combination and Aggregation
{
    const faculties = [
        { id: '1', full_name: 'Dr. Jane Smith', department: 'Computer Science' },
        { id: '2', full_name: 'Prof. Alan Turing', department: 'Information Technology' }
    ];
    const loads = [
        { faculty_id: '1', subject_code: 'CS101', subject_title: 'Intro to CS', section: 'A', units: 3, hours_per_week: 3, total_students: 40, academic_year: '2026-2027', semester: '1st Semester' },
        { faculty_id: '1', subject_code: 'CS102', subject_title: 'Data Structures', section: 'B', units: 3, hours_per_week: 4, total_students: 35, academic_year: '2026-2027', semester: '1st Semester' },
        { faculty_id: '1', subject_code: 'CS201', subject_title: 'Algorithms', section: 'A', units: 3, hours_per_week: 3, total_students: 30, academic_year: '2025-2026', semester: '1st Semester' },
        { faculty_id: '2', subject_code: 'IT200', subject_title: 'Web Dev', section: 'IT-1', units: 3, hours_per_week: 5, total_students: 45, academic_year: '2026-2027', semester: '1st Semester' }
    ];

    // Filter by AY 2026-2027 + 1st Semester
    const results = applyTrackerFilters(faculties, loads, { academicYear: '2026-2027', semester: '1st Semester' });
    assert.strictEqual(results.length, 2);

    const jane = results.find(r => r.facultyId === '1');
    assert.strictEqual(jane.teaching.length, 2);
    assert.strictEqual(jane.preparations, 2);
    assert.strictEqual(jane.sections.length, 2);
    assert.strictEqual(jane.totalStudents, 75);
    assert.strictEqual(jane.units, 6);
    assert.strictEqual(jane.hours, 7);

    // Filter with Department: 'Information Technology'
    const itOnly = applyTrackerFilters(faculties, loads, { dept: 'Information Technology', academicYear: '2026-2027' });
    assert.strictEqual(itOnly.length, 1);
    assert.strictEqual(itOnly[0].facultyName, 'Prof. Alan Turing');

    console.log('✓ Multi-filter combinations work properly and aggregate preparation, units, hours, sections, and students');
}

// Test 4: Action Control Subject Details contains all 11 required fields
{
    const item = {
        subject_code: 'ITEC 101',
        subject_title: 'Living in the IT Era',
        section: 'BSIT 1A',
        units: 3,
        hours_per_week: 3,
        total_students: 42,
        room: 'Lab 3',
        schedule_entries: [{ day: 'Mon', start_time: '8:00 AM', end_time: '11:00 AM' }],
        remarks: 'Face-to-face',
        academic_year: '2026-2027',
        semester: '1st Semester'
    };

    function formatSchedule(row) {
        if (row.schedule_entries && row.schedule_entries.length) {
            return row.schedule_entries.map(s => `${s.day || ''} ${s.start_time || ''}-${s.end_time || ''}`.trim()).filter(Boolean).join(' / ');
        }
        return `${row.schedule_day || ''} ${row.start_time || ''}-${row.end_time || ''}`.trim();
    }

    const sched = formatSchedule(item);
    const studentCount = item.total_students != null && item.total_students !== '' ? `${Number(item.total_students)} students` : '';
    const remarksText = item.remarks ? `Remarks: ${item.remarks}` : '';
    const metaParts = [item.section, sched, item.room, studentCount, item.semester, item.academic_year, remarksText].map(v => String(v || '').trim()).filter(Boolean);

    // Verify all 11 required fields
    assert.strictEqual(item.subject_code, 'ITEC 101');
    assert.strictEqual(item.subject_title, 'Living in the IT Era');
    assert.strictEqual(Number(item.units), 3);
    assert.strictEqual(Number(item.hours_per_week), 3);
    assert.ok(metaParts.some(p => p.includes('BSIT 1A')), 'Section in metaParts');
    assert.ok(metaParts.some(p => p.includes('Mon 8:00 AM-11:00 AM')), 'Schedule in metaParts');
    assert.ok(metaParts.some(p => p.includes('Lab 3')), 'Room in metaParts');
    assert.ok(metaParts.some(p => p.includes('42 students')), 'Student count in metaParts');
    assert.ok(metaParts.some(p => p.includes('1st Semester')), 'Semester in metaParts');
    assert.ok(metaParts.some(p => p.includes('2026-2027')), 'Academic Year in metaParts');
    assert.ok(metaParts.some(p => p.includes('Remarks: Face-to-face')), 'Remarks in metaParts');

    console.log('✓ Action control details display all 11 required subject properties');
}

// Test 5: Post-Import Trigger Logic
{
    function shouldTriggerRefresh(result, savedCount) {
        if (!result || !result.ok || result.aborted) return false;
        return savedCount > 0 || (result.summary && result.summary.skipped > 0);
    }

    // Success with inserts
    assert.strictEqual(shouldTriggerRefresh({ ok: true, summary: { inserted: 5, updated: 0, skipped: 0 } }, 5), true);
    // Success with only duplicates/skipped (re-import)
    assert.strictEqual(shouldTriggerRefresh({ ok: true, summary: { inserted: 0, updated: 0, skipped: 10 } }, 0), true);
    // Failure / aborted
    assert.strictEqual(shouldTriggerRefresh({ ok: false, error: 'Database error' }, 0), false);
    assert.strictEqual(shouldTriggerRefresh({ ok: true, aborted: true }, 0), false);

    console.log('✓ Post-import triggers table refresh on insert, update, or skipped-up-to-date, but halts on failure');
}

// Test 6: Faculty Profile Workload Grouping by Academic Year AND Semester
{
    const facultyLoads = [
        { id: 1, subject_code: 'CS1', units: 3, academic_year: '2026-2027', semester: '2nd Semester' },
        { id: 2, subject_code: 'CS2', units: 3, academic_year: '2026-2027', semester: '1st Semester' },
        { id: 3, subject_code: 'CS3', units: 2, academic_year: '2026-2027', semester: '1st Semester' },
        { id: 4, subject_code: 'CS4', units: 3, academic_year: '2025-2026', semester: 'Summer' }
    ];

    const grouped = groupWorkloadsByYearAndSemester(facultyLoads);
    assert.strictEqual(grouped.length, 2, 'Two academic years');

    // Check 2026-2027 group
    const y2026 = grouped.find(g => g.academicYear === '2026-2027');
    assert.strictEqual(y2026.totalSubjects, 3);
    assert.strictEqual(y2026.totalUnits, 8);
    assert.strictEqual(y2026.semesters.length, 2, '1st Sem and 2nd Sem separated');

    const sem1 = y2026.semesters[0];
    assert.strictEqual(sem1.semester, '1st Semester');
    assert.strictEqual(sem1.count, 2);
    assert.strictEqual(sem1.units, 5);

    const sem2 = y2026.semesters[1];
    assert.strictEqual(sem2.semester, '2nd Semester');
    assert.strictEqual(sem2.count, 1);
    assert.strictEqual(sem2.units, 3);

    console.log('✓ Faculty profile groups by Academic Year, then cleanly distinguishes by Semester with counts and units');
}

console.log('\nALL 6 TESTS PASSED SUCCESSFULLY!');

