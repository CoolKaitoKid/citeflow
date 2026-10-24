const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const api = require('../shared/workload-import.js');

const adminSession = { user: { id: 'admin-1', user_metadata: { role: 'admin' } } };
const facultySession = { user: { id: 'fac-user', user_metadata: { role: 'faculty' } } };

function person(id, name, extra) {
    return Object.assign({
        id,
        full_name: name,
        employee_id: '',
        department: 'CITE',
        position: 'Faculty'
    }, extra || {});
}

const juan = person('fac-juan', 'Juan Dela Cruz', { employee_id: 'FAC-2025-001' });
const maria = person('fac-maria', 'Maria Santos', { employee_id: 'FAC-2025-002' });
const juanTypo = person('fac-juan', 'Juan Dela Cruz', { employee_id: 'FAC-2025-001' });
const registered = [juan, maria];

const header = ['Faculty Name', 'Employee ID', 'Subject Code', 'Descriptive Title', 'Section', 'Units', 'Hours/Week', 'Semester', 'Academic Year', 'Students', 'Room'];

function dataRow(values) {
    return [
        values.name || '',
        values.id || '',
        values.code || '',
        values.title || '',
        values.section || '',
        values.units == null ? '' : values.units,
        values.hours == null ? '' : values.hours,
        values.semester || '1st Semester',
        values.year || '2025-2026',
        values.students == null ? '' : values.students,
        values.room || ''
    ];
}

function assignment(values) {
    return dataRow(Object.assign({
        name: 'Juan Dela Cruz',
        id: 'FAC-2025-001',
        code: 'CS101',
        title: 'Programming Fundamentals',
        section: 'A',
        units: 3,
        hours: 3
    }, values));
}

function parseExcel(rows, sheetName) {
    return api.parseSheetRows([{ name: sheetName || 'Load', rows }], { fileName: 'workload.xlsx' });
}

function choose(records) {
    (records || []).forEach((record) => { record.include = true; });
    return records;
}

function plansFor(parsed, faculty, existing, mutate) {
    assert.strictEqual(parsed.ok, true, parsed.message);
    const records = parsed.records.map((record) => Object.assign({}, record, { include: true }));
    if (mutate) records.forEach(mutate);
    return api.planBatch(records, existing || [], faculty || registered);
}

function recordingClient(responder) {
    const calls = [];
    return {
        calls,
        from(table) {
            const state = { table, op: '', payload: null, filters: [] };
            const chain = {
                insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
                update(payload) { state.op = 'update'; state.payload = payload; return chain; },
                eq(column, value) { state.filters.push([column, value]); return chain; },
                select() {
                    calls.push({
                        table: state.table,
                        op: state.op,
                        payload: state.payload,
                        filters: state.filters.slice()
                    });
                    return Promise.resolve(responder(calls[calls.length - 1], calls.length));
                }
            };
            return chain;
        }
    };
}

function pdfItem(str, x, y, width) {
    return { str, x, y, width: width || Math.max(24, String(str).length * 5) };
}

function pdfLine(y, cells) {
    return cells.map(([str, x]) => pdfItem(str, x, y));
}

const tableHeader = [
    ['Faculty Name', 40],
    ['Subject Code', 180],
    ['Subject Title', 300],
    ['Section', 480],
    ['Units', 560],
    ['Semester', 640],
    ['Academic Year', 760]
];

function tableRow(y, values) {
    return pdfLine(y, [
        [values[0], 40],
        [values[1], 180],
        [values[2], 300],
        [values[3], 480],
        [values[4], 560],
        [values[5], 640],
        [values[6], 760]
    ]);
}

(function validExcel() {
    const parsed = parseExcel([
        ['College of Information Technology'],
        header,
        assignment({}),
        assignment({ code: 'IT202', title: 'Database Systems', section: 'B', name: 'Maria Santos', id: 'FAC-2025-002' })
    ]);
    const plans = plansFor(parsed);
    assert.strictEqual(plans.length, 2);
    assert.strictEqual(plans[0].action, 'insert');
    assert.strictEqual(plans[0].facultyId, 'fac-juan');
    assert.strictEqual(plans[0].match.status, 'matched_id');
    assert.strictEqual(plans[1].facultyId, 'fac-maria');
    assert.strictEqual(plans[0].payload.subject_code, 'CS101');
    assert.strictEqual(plans[0].payload.subject_title, 'Programming Fundamentals');
    assert.strictEqual(plans[0].source.sheet, 'Load');
    assert.strictEqual(plans[0].source.row, 3);
    assert.strictEqual(plans[1].source.row, 4);
})();

(function validPdfTable() {
    const page1 = []
        .concat(pdfLine(760, tableHeader))
        .concat(tableRow(730, ['Juan Dela Cruz', 'CS101', 'Programming', 'A', '3', '1st Semester', '2025-2026']))
        .concat(pdfLine(716, [['Fundamentals', 300]]))
        .concat(tableRow(690, ['Maria Santos', 'IT202', 'Database Systems', 'B', '3', 'First Semester', 'SY 2025-26']));
    const page2 = []
        .concat(pdfLine(760, tableHeader))
        .concat(tableRow(730, ['Juan Dela Cruz', 'CS102', 'Algorithms', 'A', '3', '2nd', '2025-2026']));
    const parsed = api.parsePdfPages([
        { pageNumber: 1, items: page1 },
        { pageNumber: 2, items: [] },
        { pageNumber: 3, items: page2 }
    ], { fileName: 'loads.pdf' });
    assert.strictEqual(parsed.ok, true, parsed.message);
    assert.strictEqual(parsed.records.length, 3);
    assert.strictEqual(parsed.records[0].draft.subject_title, 'Programming Fundamentals');
    assert.strictEqual(parsed.records[1].draft.subject_title, 'Database Systems');
    assert.notStrictEqual(parsed.records[0].draft.subject_title, parsed.records[1].draft.subject_title);
    assert.strictEqual(parsed.records[1].draft.semester, '1st Semester');
    assert.strictEqual(parsed.records[1].draft.academic_year, '2025-2026');
    assert.strictEqual(parsed.records[0].source.page, 1);
    assert.strictEqual(parsed.records[2].source.page, 3);
    assert.strictEqual(parsed.records[2].draft.subject_code, 'CS102');
    assert.ok(parsed.warnings.some((warning) => warning.indexOf('OCR is not available') !== -1));
    const plans = api.planBatch(choose(parsed.records), [], registered);
    assert.strictEqual(plans.filter((plan) => plan.willWrite).length, 3);
    assert.strictEqual(plans[2].payload.semester, '2nd Semester');
})();

(function loosePdfAndRepeatedExcelHeader() {
    const parsedPdf = api.parsePdfPages([{
        pageNumber: 1,
        items: [
            pdfItem('DELA CRUZ, JUAN', 40, 700, 140),
            pdfItem('CS101 Programming Fundamentals A 3 3', 40, 670, 280),
            pdfItem('IT202 Database Systems B 3 3', 40, 640, 240)
        ]
    }], { fileName: 'loose.pdf' });
    assert.strictEqual(parsedPdf.ok, true, parsedPdf.message);
    assert.strictEqual(parsedPdf.records.length, 2);
    assert.strictEqual(parsedPdf.records[0].draft.facultyName, 'DELA CRUZ, JUAN');
    assert.strictEqual(parsedPdf.records[1].facultyCarry, true);
    assert.strictEqual(parsedPdf.records[0].draft.subject_code, 'CS101');
    assert.strictEqual(parsedPdf.records[1].draft.section, 'B');

    const parsedExcel = parseExcel([
        header,
        assignment({ code: 'CS101' }),
        header,
        assignment({ code: 'CS102', title: 'Algorithms' })
    ]);
    assert.strictEqual(parsedExcel.records.length, 2);
    assert.deepStrictEqual(parsedExcel.records.map((record) => record.draft.subject_code), ['CS101', 'CS102']);
})();

(function missingAndMalformedFields() {
    const parsed = parseExcel([
        header,
        assignment({ code: '', title: '', section: '', units: 'abc', semester: 'Winter', year: '2025' }),
        assignment({ hours: '', students: 'many' })
    ]);
    const plans = plansFor(parsed);
    assert.strictEqual(plans[0].willWrite, false);
    assert.strictEqual(plans[0].statusLabel, 'Needs details');
    assert.ok(plans[0].issues.some((item) => item.field === 'subject_code' && item.level === 'error'));
    assert.ok(plans[0].issues.some((item) => item.field === 'units' && item.level === 'error'));
    assert.ok(plans[0].issues.some((item) => item.field === 'semester'));
    assert.strictEqual(plans[1].willWrite, false);
    assert.ok(plans[1].issues.some((item) => item.field === 'total_students' && item.level === 'error'));
})();

(function facultyMatching() {
    const idMatch = plansFor(parseExcel([
        header,
        assignment({ name: 'Someone Else', id: 'fac 2025 001' })
    ]));
    assert.strictEqual(idMatch[0].match.status, 'matched_id');
    assert.strictEqual(idMatch[0].facultyId, 'fac-juan');
    assert.ok(idMatch[0].match.warnings.length);

    const exact = plansFor(parseExcel([
        header,
        assignment({ name: 'Dela Cruz, Juan', id: '' })
    ]));
    assert.strictEqual(exact[0].match.status, 'matched_name');
    assert.strictEqual(exact[0].facultyId, 'fac-juan');

    const suggested = plansFor(parseExcel([
        header,
        assignment({ name: 'Juan Dela Crus', id: '' })
    ]));
    assert.strictEqual(suggested[0].match.status, 'suggested');
    assert.strictEqual(suggested[0].willWrite, false);
    assert.strictEqual(suggested[0].facultyId, 'fac-juan');
    const confirmed = plansFor(parseExcel([
        header,
        assignment({ name: 'Juan Dela Crus', id: '' })
    ]), registered, [], (record) => { record.acceptSuggestion = true; });
    assert.strictEqual(confirmed[0].match.status, 'confirmed_suggestion');
    assert.strictEqual(confirmed[0].willWrite, true);

    const ambiguousFaculty = [
        person('fac-a', 'Juan A Cruz'),
        person('fac-b', 'Juan B Cruz')
    ];
    const ambiguous = plansFor(parseExcel([
        header,
        assignment({ name: 'Juan Cruz', id: '' })
    ]), ambiguousFaculty);
    assert.strictEqual(ambiguous[0].match.status, 'ambiguous');
    assert.strictEqual(ambiguous[0].facultyId, null);
    assert.ok(ambiguous[0].match.candidates.length >= 2);
    assert.strictEqual(ambiguous[0].willWrite, false);

    const sameName = plansFor(parseExcel([
        header,
        assignment({ name: 'Maria Santos', id: '' })
    ]), [person('fac-1', 'Maria Santos'), person('fac-2', 'Maria Santos')]);
    assert.strictEqual(sameName[0].match.status, 'ambiguous');
    assert.strictEqual(sameName[0].facultyId, null);

    const sameId = plansFor(parseExcel([header, assignment({ id: 'FAC-9' })]), [
        person('fac-1', 'Ana Reyes', { employee_id: 'FAC-9' }),
        person('fac-2', 'Ana Lopez', { employee_id: 'FAC-9' })
    ]);
    assert.strictEqual(sameId[0].match.status, 'ambiguous');
    assert.strictEqual(sameId[0].facultyId, null);

    const unmatched = plansFor(parseExcel([
        header,
        assignment({ name: 'Unregistered Person', id: 'NO-SUCH' })
    ]));
    assert.strictEqual(unmatched[0].match.status, 'unmatched');
    assert.strictEqual(unmatched[0].willWrite, false);
    assert.ok(api.unresolved(unmatched[0]));
})();

(function duplicatesUpdatesAndSkips() {
    const duplicateFile = plansFor(parseExcel([
        header,
        assignment({}),
        assignment({})
    ]));
    assert.strictEqual(duplicateFile[0].action, 'insert');
    assert.strictEqual(duplicateFile[1].action, 'duplicate');
    assert.strictEqual(duplicateFile[1].willWrite, false);

    const conflictFile = plansFor(parseExcel([
        header,
        assignment({ units: 3 }),
        assignment({ units: 6 })
    ]));
    assert.ok(conflictFile.every((plan) => plan.statusLabel === 'Conflict in file' && !plan.willWrite));

    const parsedConflict = parseExcel([header, assignment({ units: 3 }), assignment({ units: 6 })]);
    parsedConflict.records[0].include = true;
    parsedConflict.records[1].include = false;
    const keptOne = api.planBatch(parsedConflict.records, [], registered);
    assert.strictEqual(keptOne[0].willWrite, true);
    assert.strictEqual(keptOne[1].action, 'exclude');

    const existing = [{
        id: 'load-1',
        faculty_id: 'fac-juan',
        subject_code: 'CS 101',
        subject_title: 'Programming Fundamentals',
        section: 'a',
        units: 3,
        hours_per_week: 5,
        semester: 'First Semester',
        academic_year: 'SY 2025-26',
        status: 'Active',
        room: ''
    }];
    const unchanged = plansFor(parseExcel([header, assignment({ hours: '' })]), registered, existing);
    assert.strictEqual(unchanged[0].action, 'skip');
    assert.strictEqual(unchanged[0].willWrite, false);
    assert.ok(!unchanged[0].patch || !Object.prototype.hasOwnProperty.call(unchanged[0].patch, 'hours_per_week'));

    const conflict = plansFor(parseExcel([
        header,
        assignment({ title: 'Intro to Programming', hours: '', room: 'Lab 1' })
    ]), registered, existing);
    assert.strictEqual(conflict[0].statusLabel, 'Conflict');
    assert.strictEqual(conflict[0].willWrite, false);
    assert.ok(conflict[0].conflicts.some((item) => item.field === 'subject_title'));
    assert.ok(!conflict[0].conflicts.some((item) => item.field === 'hours_per_week'));

    const parsedUpdate = parseExcel([header, assignment({ title: 'Intro to Programming', hours: '', room: 'Lab 1' })]);
    choose(parsedUpdate.records);
    parsedUpdate.records[0].conflictChoice = 'imported';
    const updated = api.planBatch(parsedUpdate.records, existing, registered);
    assert.strictEqual(updated[0].action, 'update');
    assert.strictEqual(updated[0].patch.subject_title, 'Intro to Programming');
    assert.strictEqual(updated[0].patch.room, 'Lab 1');
    assert.ok(!Object.prototype.hasOwnProperty.call(updated[0].patch, 'hours_per_week'));
    assert.ok(!Object.prototype.hasOwnProperty.call(updated[0].patch, 'faculty_id'));
    assert.strictEqual(updated[0].existingId, 'load-1');

    parsedUpdate.records[0].conflictChoice = 'existing';
    const keepSaved = api.planBatch(parsedUpdate.records, existing, registered);
    assert.strictEqual(keepSaved[0].action, 'update');
    assert.strictEqual(keepSaved[0].patch.room, 'Lab 1');
    assert.ok(!Object.prototype.hasOwnProperty.call(keepSaved[0].patch, 'subject_title'));

    const archived = [Object.assign({}, existing[0], { status: 'Archived', room: 'Lab 1' })];
    const archivedPlan = plansFor(parseExcel([header, assignment({ room: 'Lab 1', hours: '' })]), registered, archived);
    assert.strictEqual(archivedPlan[0].willWrite, false);
    assert.ok(archivedPlan[0].conflicts.some((item) => item.field === 'status'));
    const parsedArchived = parseExcel([header, assignment({ room: 'Lab 1', hours: '' })]);
    choose(parsedArchived.records);
    parsedArchived.records[0].conflictChoice = 'existing';
    assert.strictEqual(api.planBatch(parsedArchived.records, archived, registered)[0].action, 'skip');
    parsedArchived.records[0].conflictChoice = 'imported';
    const revive = api.planBatch(parsedArchived.records, archived, registered);
    assert.strictEqual(revive[0].patch.status, 'Active');

    const ambiguousExisting = plansFor(parseExcel([header, assignment({ hours: '' })]), registered, [
        Object.assign({}, existing[0], { id: 'one' }),
        Object.assign({}, existing[0], { id: 'two' })
    ]);
    assert.strictEqual(ambiguousExisting[0].statusLabel, 'Ambiguous existing');
    assert.strictEqual(ambiguousExisting[0].willWrite, false);
})();

const sampleFacultyList = (async function sampleFacultyListPdf() {
    const pdfPath = path.join(__dirname, 'fixtures', 'Sample_Faculty_List.pdf');
    const raw = execFileSync('python', [path.join(__dirname, 'fixtures', 'extract_pdf_items.py'), pdfPath], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
    });
    const parsed = api.parsePdfPages(JSON.parse(raw), { fileName: 'Sample_Faculty_List.pdf' });
    assert.strictEqual(parsed.ok, true, parsed.message);
    assert.strictEqual(parsed.records.length, 21);
    assert.ok(parsed.records.every((record) => record.include === false));
    console.log('Sample_Faculty_List.pdf extracted rows: ' + parsed.records.length);
    assert.strictEqual(parsed.detailColumn.label, 'Section');
    assert.strictEqual(parsed.detailColumn.position, 8);
    assert.deepStrictEqual(parsed.mappedColumns.map((item) => item.target).sort(), ['department', 'email', 'facultyName', 'section']);
    ['No.', 'Role', 'Year Level', 'Subjects', 'Advisees', 'Points', 'Status'].forEach((label) => {
        assert.ok(parsed.ignoredColumns.some((item) => item.source === label), label);
    });
    assert.ok(!parsed.ignoredColumns.some((item) => item.source === 'Department'));
    assert.ok(parsed.missingTargets.some((item) => item.field === 'subject_code'));
    assert.ok(parsed.missingTargets.some((item) => item.field === 'subject_title'));
    assert.ok(parsed.missingTargets.some((item) => item.field === 'units'));
    assert.ok(!parsed.missingTargets.some((item) => item.field === 'section'));
    assert.ok(parsed.records.every((record) => record.draft.subject_code === '' && record.draft.subject_title === ''));

    const cessy = parsed.records.find((record) => record.draft.facultyName === 'Cessy Sans');
    assert.ok(cessy);
    assert.strictEqual(cessy.draft.email, 'cessy.sans@example.edu');
    assert.strictEqual(cessy.draft.section, 'BSIT 4A');
    assert.strictEqual(cessy.draft.department, 'BSIE');
    assert.strictEqual(cessy.draft.total_students, '');
    assert.strictEqual(cessy.ignoredValues.Subjects, '3');
    assert.strictEqual(cessy.ignoredValues['Year Level'], '1');
    assert.strictEqual(cessy.ignoredValues.Advisees, '3');
    assert.strictEqual(cessy.ignoredValues.Department, undefined);
    assert.notStrictEqual(cessy.draft.subject_code, '3');
    assert.strictEqual(cessy.draft.academic_year, '');
    assert.strictEqual(cessy.source.page, 1);
    assert.ok(api.renderPreviewInput(cessy, 'facultyName', 'Extracted faculty name').includes('value="Cessy Sans"'));
    assert.ok(api.renderPreviewInput(cessy, 'department', 'Department').includes('value="BSIE"'));
    assert.ok(api.renderPreviewInput(cessy, 'email', 'Email').includes('value="cessy.sans@example.edu"'));
    assert.ok(api.renderPreviewInput(cessy, 'section', 'Section').includes('value="BSIT 4A"'));
    assert.ok(api.renderPreviewInput(cessy, 'subject_code', 'Subject code').includes('value=""'));
    assert.ok(!api.renderPreviewInput(cessy, 'total_students', 'Students').includes('value="3"'));

    const jamycaRows = parsed.records.filter((record) => record.draft.facultyName === 'Jamyca A. Limbaga');
    assert.deepStrictEqual(jamycaRows.map((record) => record.draft.section).sort(), ['BSIT 3A', 'BSIT 4A']);
    assert.ok(jamycaRows.every((record) => record.detailSource === 'BSIT 3A, BSIT 4A'));
    assert.ok(jamycaRows.every((record) => record.draft.subject_code === '' && record.draft.subject_title === ''));
    assert.strictEqual(jamycaRows[0].ignoredValues.Subjects, '3');

    const faculty = [
        person('fac-maria', 'Maria Santos', { email: 'maria.santos@example.edu', employee_id: 'FAC-7', department: 'BSIT' }),
        person('fac-cessy', 'Cessandra Sans', { email: 'cessy.sans@example.edu', employee_id: 'FAC-1' }),
        person('fac-juan-a', 'Juan A Cruz'),
        person('fac-juan-b', 'Juan B Cruz')
    ];
    const plans = api.planBatch(parsed.records, [], faculty);
    assert.strictEqual(plans.length, 21);
    assert.ok(plans.every((plan) => plan.willWrite === false));
    assert.strictEqual(api.summarizePlans(plans).willWrite, 0);
    let writes = 0;
    const previewClient = { from() { writes += 1; throw new Error('preview must not query the database'); } };
    await api.commitImport({ session: adminSession, client: previewClient, plans, userId: 'admin-1' });
    assert.strictEqual(writes, 0);
    const maria = plans.find((plan) => plan.extractedName === 'Maria Santos');
    const mariaRecord = parsed.records.find((record) => record.draft.facultyName === 'Maria Santos');
    assert.strictEqual(maria.match.status, 'matched_email');
    assert.strictEqual(maria.facultyId, 'fac-maria');
    assert.strictEqual(api.selectedFacultyId(mariaRecord, maria.match), 'fac-maria');
    assert.strictEqual(maria.statusLabel, 'Not selected');
    assert.ok(maria.issues.some((item) => item.field === 'subject_code' && /count/i.test(item.message)));
    const cessyPlan = plans.find((plan) => plan.extractedName === 'Cessy Sans');
    assert.strictEqual(cessyPlan.match.status, 'matched_email');
    assert.strictEqual(cessyPlan.facultyId, 'fac-cessy');
    assert.ok(cessyPlan.match.warnings.some((warning) => /name is different/i.test(warning)));
    const paolo = plans.find((plan) => plan.extractedName === 'Paolo Javier');
    assert.strictEqual(paolo.match.status, 'unmatched');
    assert.ok(api.unresolved(paolo));

    const rosterHeader = ['No.', 'Name', 'Role', 'Department', 'Year Level', 'Subjects', 'Advisees', 'Section', 'Points', 'Email', 'Status'];
    const excel = api.parseSheetRows([{
        name: 'Faculty',
        rows: [
            ['Sample Faculty & Admin List'],
            rosterHeader,
            ['1', 'Maria Santos', 'Faculty', 'BSIT', '1', '4', '45', 'BSIT 1A', '42', 'maria.santos@example.edu', 'Active'],
            ['2', 'Paolo Javier', 'Faculty', 'BSIT', '3', '3', '29', 'BSIT 3A', '34', 'paolo.javier@example.edu', 'Active'],
            rosterHeader
        ]
    }], { fileName: 'Sample_Faculty_List.xlsx' });
    assert.strictEqual(excel.ok, true, excel.message);
    assert.strictEqual(excel.records.length, 2);
    assert.strictEqual(excel.records[0].draft.subject_code, '');
    assert.strictEqual(excel.records[0].draft.department, 'BSIT');
    assert.strictEqual(excel.records[0].draft.section, 'BSIT 1A');
    assert.strictEqual(excel.records[0].draft.facultyName, 'Maria Santos');
    assert.ok(api.renderPreviewInput(excel.records[0], 'section', 'Section').includes('value="BSIT 1A"'));
    assert.ok(api.renderPreviewInput(excel.records[0], 'department', 'Department').includes('value="BSIT"'));
    assert.strictEqual(excel.records[0].ignoredValues.Subjects, '4');
    assert.strictEqual(excel.records[1].source.row, 4);
    const excelPlans = api.planBatch(excel.records, [], faculty);
    assert.ok(excelPlans.every((plan) => plan.willWrite === false));
    assert.strictEqual(excelPlans[1].match.status, 'unmatched');

    api.applyPreviewEdit(cessy, 'section', 'BSIT 9Z');
    api.applyPreviewEdit(cessy, 'units', '3');
    assert.strictEqual(cessy.draft.section, 'BSIT 9Z');
    assert.strictEqual(cessy.draft.units, '3');
    assert.strictEqual(cessy.draft.facultyName, 'Cessy Sans');
    assert.strictEqual(cessy.draft.department, 'BSIE');
    assert.strictEqual(mariaRecord.draft.section === 'BSIT 9Z', false);
    assert.ok(api.renderPreviewInput(cessy, 'section', 'Section').includes('value="BSIT 9Z"'));
    assert.ok(api.renderPreviewInput(mariaRecord, 'facultyName', 'Extracted faculty name').includes('value="Maria Santos"'));

    api.applyPreviewEdit(mariaRecord, 'subject_code', 'IT101');
    api.applyPreviewEdit(mariaRecord, 'subject_title', 'Programming');
    api.applyPreviewEdit(mariaRecord, 'units', '3');
    api.applyPreviewEdit(mariaRecord, 'semester', '1st Semester');
    api.applyPreviewEdit(mariaRecord, 'academic_year', '2025-2026');
    const ready = api.planBatch([mariaRecord], [], faculty);
    assert.strictEqual(ready[0].willWrite, false);
    assert.strictEqual(ready[0].statusLabel, 'Not selected');
    assert.strictEqual(mariaRecord.include, false);
    api.applyPreviewEdit(mariaRecord, 'units', '4');
    assert.strictEqual(mariaRecord.include, false);
    assert.strictEqual(mariaRecord.draft.subject_code, 'IT101');
    assert.strictEqual(mariaRecord.draft.units, '4');
    api.applyPreviewEdit(mariaRecord, 'include', true);
    const rechecked = api.planBatch([mariaRecord], [], faculty);
    assert.strictEqual(rechecked[0].willWrite, true);
    assert.strictEqual(rechecked[0].payload.faculty_id, 'fac-maria');
    assert.strictEqual(rechecked[0].payload.subject_code, 'IT101');
    assert.strictEqual(rechecked[0].payload.units, 4);
    assert.strictEqual(rechecked[0].payload.department, undefined);
    assert.strictEqual(rechecked[0].payload.total_students, undefined);
    assert.notStrictEqual(mariaRecord.raw.subject_code, 'IT101');
    const paoloRecord = parsed.records.find((record) => record.draft.facultyName === 'Paolo Javier');
    api.applyPreviewEdit(paoloRecord, 'include', true);
    api.applyPreviewEdit(paoloRecord, 'subject_code', 'IT300');
    api.applyPreviewEdit(paoloRecord, 'subject_title', 'Networks');
    api.applyPreviewEdit(paoloRecord, 'units', '3');
    api.applyPreviewEdit(paoloRecord, 'semester', '1st Semester');
    api.applyPreviewEdit(paoloRecord, 'academic_year', '2025-2026');
    const forced = api.planBatch([paoloRecord], [], faculty);
    assert.strictEqual(forced[0].match.status, 'unmatched');
    assert.strictEqual(forced[0].willWrite, false);
    api.applyPreviewEdit(mariaRecord, 'facultyOverrideId', '');
    const cleared = api.planBatch([mariaRecord], [], faculty);
    assert.strictEqual(cleared[0].willWrite, false);
    assert.strictEqual(cleared[0].match.status, 'unmatched');
    api.applyPreviewEdit(mariaRecord, 'facultyOverrideId', 'fac-maria');
    const associated = api.planBatch([mariaRecord], [], faculty);
    assert.strictEqual(associated[0].match.status, 'manual');
    assert.strictEqual(associated[0].willWrite, true);
    assert.strictEqual(associated[0].payload.faculty_id, 'fac-maria');
    assert.strictEqual(api.selectedFacultyId(mariaRecord, associated[0].match), 'fac-maria');

    const synonym = api.parseSheetRows([{
        name: 'Load',
        rows: [
            ['Instructor', 'Dept', 'Class Section', 'Course Code', 'Descriptive Title', 'Credit Units', 'Term', 'School Year'],
            ['Maria Santos', 'BSIT', 'A', 'CS101', 'Programming Fundamentals', '3', 'First Semester', '2025-2026']
        ]
    }], { fileName: 'synonyms.xlsx' });
    assert.strictEqual(synonym.ok, true, synonym.message);
    assert.strictEqual(synonym.records[0].draft.facultyName, 'Maria Santos');
    assert.strictEqual(synonym.records[0].draft.department, 'BSIT');
    assert.strictEqual(synonym.records[0].draft.section, 'A');
    assert.strictEqual(synonym.records[0].draft.subject_code, 'CS101');
    assert.strictEqual(synonym.records[0].draft.subject_title, 'Programming Fundamentals');
    assert.ok(api.renderPreviewInput(synonym.records[0], 'subject_title', 'Subject title').includes('value="Programming Fundamentals"'));

    const eighth = api.parseSheetRows([{
        name: 'Load',
        rows: [
            ['No.', 'Name', 'Role', 'Department', 'Year Level', 'Subjects', 'Advisees', 'Workload', 'Points', 'Email', 'Status'],
            ['1', 'Maria Santos', 'Faculty', 'BSIT', '1', '2', '10', 'CS101 Programming A 3\nIT202 Database Systems B 3', '1', 'maria.santos@example.edu', 'Active']
        ]
    }], { fileName: 'eighth-column.xlsx' });
    assert.strictEqual(eighth.ok, true, eighth.message);
    assert.strictEqual(eighth.detailColumn.label, 'Workload');
    assert.strictEqual(eighth.detailColumn.position, 8);
    assert.strictEqual(eighth.records.length, 2);
    assert.deepStrictEqual(eighth.records.map((record) => record.draft.subject_code).sort(), ['CS101', 'IT202']);
    assert.strictEqual(eighth.records.find((record) => record.draft.subject_code === 'CS101').draft.section, 'A');
    assert.strictEqual(eighth.records.find((record) => record.draft.subject_code === 'IT202').draft.subject_title, 'Database Systems');
    assert.strictEqual(eighth.records[0].draft.semester, '');
    assert.strictEqual(eighth.records[0].draft.academic_year, '');
    assert.ok(eighth.records.every((record) => record.detailSource.indexOf('CS101') !== -1));
    const eighthPlans = api.planBatch(eighth.records, [], faculty);
    assert.ok(eighthPlans.every((plan) => plan.willWrite === false));

    const pdfjsPath = path.join(os.tmpdir(), 'pdfjs-check', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js');
    if (fs.existsSync(pdfjsPath)) {
        const pdfjs = require(pdfjsPath);
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
            const page = await doc.getPage(pageNumber);
            const content = await page.getTextContent();
            pages.push({
                pageNumber,
                items: (content.items || []).map((item) => ({
                    str: item.str || '',
                    x: item.transform ? item.transform[4] : 0,
                    y: item.transform ? item.transform[5] : 0,
                    width: item.width || 0
                }))
            });
        }
        const browserParsed = api.parsePdfPages(pages, { fileName: 'Sample_Faculty_List.pdf' });
        assert.strictEqual(browserParsed.ok, true, browserParsed.message);
        assert.strictEqual(browserParsed.records.length, 21);
        const browserJamyca = browserParsed.records.filter((record) => record.draft.facultyName === 'Jamyca A. Limbaga');
        assert.deepStrictEqual(browserJamyca.map((record) => record.draft.section).sort(), ['BSIT 3A', 'BSIT 4A']);
        console.log('pdf.js Sample_Faculty_List.pdf extracted rows: ' + browserParsed.records.length);
        const browserCessy = browserParsed.records.find((record) => record.draft.facultyName === 'Cessy Sans');
        assert.ok(browserCessy);
        assert.strictEqual(browserCessy.draft.department, 'BSIE');
        assert.strictEqual(browserCessy.draft.section, 'BSIT 4A');
        assert.strictEqual(browserCessy.draft.email, 'cessy.sans@example.edu');
        assert.strictEqual(browserCessy.draft.subject_code, '');
    }
})();

const checkedRowsImportIndependently = (async function checkedRowsImportIndependently() {
    const parsed = parseExcel([
        header,
        assignment({ code: 'CS101' }),
        assignment({ code: 'IT404', title: '', section: 'B' }),
        assignment({ name: 'Nobody Known', id: 'NOPE', code: 'XX1', title: 'Orphan', section: 'Z' })
    ]);
    assert.ok(parsed.records.every((record) => record.include === false));
    parsed.records.forEach((record) => api.applyPreviewEdit(record, 'include', true));
    assert.ok(parsed.records.every((record) => record.include === true));
    parsed.records.forEach((record) => api.applyPreviewEdit(record, 'include', false));
    assert.ok(parsed.records.every((record) => record.include === false));
    api.applyPreviewEdit(parsed.records[0], 'subject_title', 'Edited Title');
    assert.strictEqual(parsed.records[0].include, false);
    assert.strictEqual(parsed.records[0].draft.subject_title, 'Edited Title');
    assert.notStrictEqual(parsed.records[0].raw.subject_title, 'Edited Title');

    const none = api.planBatch(parsed.records, [], registered);
    assert.ok(none.every((plan) => plan.willWrite === false));
    let noneCalls = 0;
    const noneResult = await api.commitImport({
        plans: none,
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client: { from() { noneCalls += 1; throw new Error('No row was selected.'); } }
    });
    assert.strictEqual(noneCalls, 0);
    assert.strictEqual(noneResult.aborted, true);
    assert.strictEqual(noneResult.summary.inserted, 0);

    api.applyPreviewEdit(parsed.records[0], 'include', true);
    api.applyPreviewEdit(parsed.records[1], 'include', true);
    api.applyPreviewEdit(parsed.records[2], 'include', true);
    api.applyPreviewEdit(parsed.records[2], 'facultyOverrideId', 'fac-maria');
    const mixed = api.planBatch(parsed.records, [], registered);
    assert.strictEqual(mixed[0].willWrite, true);
    assert.strictEqual(mixed[0].payload.subject_title, 'Edited Title');
    assert.strictEqual(mixed[0].payload.faculty_id, 'fac-juan');
    assert.strictEqual(mixed[1].willWrite, false);
    assert.ok(mixed[1].issues.some((item) => item.field === 'subject_title' && /missing/i.test(item.message)));
    assert.ok(/subject title is missing/i.test(mixed[1].reason));
    assert.strictEqual(mixed[2].match.status, 'manual');
    assert.strictEqual(mixed[2].willWrite, true);
    assert.strictEqual(mixed[2].facultyId, 'fac-maria');

    const client = recordingClient(() => ({ data: [{ id: 'saved-row' }], error: null }));
    const result = await api.commitImport({
        plans: mixed,
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client
    });
    assert.strictEqual(client.calls.length, 2);
    assert.strictEqual(result.summary.inserted, 2);
    assert.ok(result.summary.skippedRows.some((row) => /subject title is missing/i.test(row.message)));
    assert.strictEqual(client.calls[1].payload.faculty_id, 'fac-maria');

    const again = api.planBatch(choose(parseExcel([
        header,
        assignment({ title: 'Edited Title' })
    ]).records), [{
        id: 'saved-row',
        faculty_id: 'fac-juan',
        subject_code: 'CS101',
        subject_title: 'Edited Title',
        section: 'A',
        units: 3,
        hours_per_week: 3,
        total_students: null,
        semester: '1st Semester',
        academic_year: '2025-2026',
        status: 'Active',
        room: ''
    }], registered);
    assert.strictEqual(again[0].action, 'skip');
    assert.strictEqual(again[0].willWrite, false);
})();

(function fileValidationAndUnsafePdf() {
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.pdf', size: 120 }).ok, true);
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.xlsx', size: 120 }).kind, 'excel');
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.xls', size: 120 }).ok, true);
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.txt', size: 120 }).code, 'unsupported');
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.pdf', size: 0 }).code, 'empty');
    assert.strictEqual(api.validateWorkloadFile(null).code, 'empty');
    assert.strictEqual(api.validateWorkloadFile({ name: 'loads.pdf', size: api.MAX_FILE_BYTES + 1 }).code, 'too_large');

    const scanned = api.parsePdfPages([{ pageNumber: 1, items: [] }], { fileName: 'scan.pdf' });
    assert.strictEqual(scanned.ok, false);
    assert.strictEqual(scanned.code, 'ocr_unavailable');
    assert.strictEqual(scanned.records.length, 0);

    const prose = api.parsePdfPages([{
        pageNumber: 1,
        items: [pdfItem('The faculty senate will meet on Monday at the main campus.', 40, 700, 320)]
    }]);
    assert.strictEqual(prose.ok, false);
    assert.strictEqual(prose.code, 'unreliable');
    assert.strictEqual(prose.records.length, 0);

    const broken = api.parseSheetRows([{ name: 'Notes', rows: [['Hello'], ['Not a workload']] }]);
    assert.strictEqual(broken.ok, false);
    assert.strictEqual(broken.records.length, 0);
})();

(async function authorizationAndCommit() {
    await sampleFacultyList;
    await checkedRowsImportIndependently;
    const parsed = parseExcel([
        header,
        assignment({}),
        assignment({ code: 'IT202', title: 'Database Systems', section: 'B', name: 'Maria Santos', id: 'FAC-2025-002' }),
        assignment({ name: 'Unregistered Person', id: 'NO-SUCH', code: 'XX100', title: 'Nowhere', section: 'Z' })
    ]);
    const plans = api.planBatch(choose(parsed.records), [], registered);
    assert.strictEqual(plans[2].willWrite, false);
    assert.strictEqual(api.assertImportAllowed(null, null).ok, false);
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'Faculty', admin_access: false }).ok, false);
    const chairSession = { user: { id: 'chair-1', user_metadata: { role: 'chairperson' } } };
    assert.strictEqual(api.assertImportAllowed(chairSession, { role: 'Chairperson', admin_access: false }).ok, false);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Chairperson', admin_access: true }).ok, true);

    let deniedCalls = 0;
    const denied = await api.commitImport({
        plans,
        session: facultySession,
        facultyRecord: { role: 'Faculty', admin_access: false },
        client: { from() { deniedCalls += 1; return {}; } }
    });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.aborted, true);
    assert.strictEqual(deniedCalls, 0);
    assert.strictEqual(denied.summary.inserted, 0);

    const client = recordingClient((call, count) => {
        if (count === 2) return { data: [], error: { message: 'permission denied for faculty_teaching_loads' } };
        return { data: [{ id: `saved-${count}` }], error: null };
    });
    const result = await api.commitImport({
        plans,
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client,
        now: new Date('2026-01-01T00:00:00Z')
    });
    assert.strictEqual(client.calls.length, 2);
    assert.strictEqual(client.calls[0].table, 'faculty_teaching_loads');
    assert.strictEqual(client.calls[0].op, 'insert');
    assert.strictEqual(client.calls[0].payload.faculty_id, 'fac-juan');
    assert.ok(!Object.prototype.hasOwnProperty.call(client.calls[0].payload, 'facultyName'));
    assert.strictEqual(result.summary.inserted, 1);
    assert.strictEqual(result.summary.failed.length, 1);
    assert.strictEqual(result.summary.excluded, 1);
    assert.strictEqual(result.partial, true);
    assert.strictEqual(result.ok, false);
    assert.ok(result.summary.failed[0].message.indexOf('permission denied') !== -1);
    assert.ok(result.summary.notice.indexOf('earlier rows stay saved') !== -1);

    const existing = [{
        id: 'load-1',
        faculty_id: 'fac-juan',
        subject_code: 'CS101',
        subject_title: 'Old Title',
        section: 'A',
        units: 3,
        hours_per_week: 5,
        semester: '1st Semester',
        academic_year: '2025-2026',
        status: 'Active'
    }];
    const parsedUpdate = parseExcel([header, assignment({ title: 'New Title', hours: '' })]);
    choose(parsedUpdate.records);
    parsedUpdate.records[0].conflictChoice = 'imported';
    const updatePlans = api.planBatch(parsedUpdate.records, existing, registered);
    const updateClient = recordingClient(() => ({ data: [{ id: 'load-1' }], error: null }));
    const updateResult = await api.commitImport({
        plans: updatePlans,
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client: updateClient,
        now: new Date('2026-01-02T00:00:00Z')
    });
    assert.strictEqual(updateResult.summary.updated, 1);
    assert.strictEqual(updateClient.calls[0].op, 'update');
    assert.deepStrictEqual(updateClient.calls[0].filters, [['id', 'load-1'], ['faculty_id', 'fac-juan']]);
    assert.strictEqual(updateClient.calls[0].payload.subject_title, 'New Title');
    assert.ok(!Object.prototype.hasOwnProperty.call(updateClient.calls[0].payload, 'hours_per_week'));
    assert.ok(!Object.prototype.hasOwnProperty.call(updateClient.calls[0].payload, 'faculty_id'));

    const retryRecords = parseExcel([header, assignment({ hours: 5 })]).records;
    choose(retryRecords);
    const retry = api.planBatch(retryRecords, [{
        id: 'load-1',
        faculty_id: 'fac-juan',
        subject_code: 'CS101',
        subject_title: 'Programming Fundamentals',
        section: 'A',
        units: 3,
        hours_per_week: 5,
        semester: '1st Semester',
        academic_year: '2025-2026',
        status: 'Active'
    }], registered);
    assert.strictEqual(retry[0].action, 'skip');
    const retryClient = recordingClient(() => ({ data: [{ id: 'should-not' }], error: null }));
    const retryResult = await api.commitImport({
        plans: retry,
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client: retryClient
    });
    assert.strictEqual(retryClient.calls.length, 0);
    assert.strictEqual(retryResult.summary.inserted, 0);
    assert.strictEqual(retryResult.summary.skipped, 1);

    let unsafeCalls = 0;
    const unsafe = await api.commitImport({
        plans: [{ willWrite: true, action: 'insert', facultyId: null, payload: { faculty_id: null }, label: 'Bad', source: {} }],
        session: adminSession,
        facultyRecord: { role: 'Admin' },
        client: { from() { unsafeCalls += 1; return {}; } }
    });
    assert.strictEqual(unsafeCalls, 0);
    assert.strictEqual(unsafe.summary.failed.length, 1);
    assert.strictEqual(unsafe.summary.inserted, 0);
})().then(function () {
    const source = fs.readFileSync(path.join(__dirname, '../shared/workload-import.js'), 'utf8');
    assert.strictEqual(source.indexOf(".from('faculty')"), -1);
    assert.strictEqual(source.indexOf('signUp'), -1);
    assert.strictEqual(source.indexOf('tesseract'), -1);

    const html = fs.readFileSync(path.join(__dirname, '../admin/workload-tracker.html'), 'utf8');
    assert.ok(html.indexOf('function getTeachingMetrics') !== -1);
    assert.ok(html.indexOf('function sumUnits') !== -1);
    assert.ok(html.indexOf('r.teachingTotal <= 27') !== -1);
    assert.ok(html.indexOf('r.teachingTotal > 27') !== -1);
    assert.ok(html.indexOf("from('faculty_teaching_loads')") !== -1);
    assert.ok(html.indexOf('id="workloadTable"') !== -1);
    assert.ok(html.indexOf('View Details') !== -1);
    assert.ok(html.indexOf('renderPreviewInput') !== -1);
    assert.ok(html.indexOf('selectedFacultyId') !== -1);
    assert.ok(html.indexOf('applyPreviewEdit') !== -1);
    assert.ok(html.indexOf('id="importWorkloadBtn"') !== -1);
    assert.ok(html.indexOf('data-field="include-all"') !== -1);
    assert.ok(html.indexOf('id="workloadLoadError"') !== -1);
    assert.strictEqual(html.indexOf('Cessy Sans'), -1);
    assert.ok(html.indexOf('flushActiveImportField') !== -1);
    assert.ok(html.indexOf('await loadAllWorkloads()') !== -1);
    assert.ok(html.indexOf('../shared/workload-import.js') !== -1);
    assert.ok(html.indexOf('Faculty') !== -1 && html.indexOf('Preparations') !== -1);

    const inline = [];
    const matcher = /<script>([\s\S]*?)<\/script>/g;
    let found;
    while ((found = matcher.exec(html))) inline.push(found[1]);
    assert.ok(inline.length >= 1);
    inline.forEach((script, index) => {
        const file = path.join(os.tmpdir(), `workload-tracker-inline-${index}.js`);
        fs.writeFileSync(file, script);
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    });

    const ignored = juanTypo;
    assert.ok(ignored.id);
    console.log('workload-import tests passed');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
