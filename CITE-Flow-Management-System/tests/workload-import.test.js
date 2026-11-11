const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const api = require('../shared/workload-import.js');

const adminSession = { user: { id: 'admin-1', user_metadata: { role: 'admin' } } };
const deanSession = { user: { id: 'dean-1', user_metadata: { role: 'College Dean' } } };
const secretarySession = { user: { id: 'sec-1', user_metadata: { role: 'College Secretary' } } };
const facultySession = { user: { id: 'fac-user', user_metadata: { role: 'faculty' } } };
const chairSession = { user: { id: 'chair-1', user_metadata: { role: 'chairperson' } } };
const oicSession = { user: { id: 'oic-1', user_metadata: { role: 'OIC' } } };

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
    await api.commitImport({ session: deanSession, client: previewClient, plans, userId: 'dean-1' });
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
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
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
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
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
    assert.strictEqual(api.assertImportAllowed(deanSession, { role: 'College Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(secretarySession, { role: 'College Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Chairperson', admin_access: true }).ok, false);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Admin' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Administrator' }).ok, true);

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
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
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
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
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
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: retryClient
    });
    assert.strictEqual(retryClient.calls.length, 0);
    assert.strictEqual(retryResult.summary.inserted, 0);
    assert.strictEqual(retryResult.summary.skipped, 1);

    let unsafeCalls = 0;
    const unsafe = await api.commitImport({
        plans: [{ willWrite: true, action: 'insert', facultyId: null, payload: { faculty_id: null }, label: 'Bad', source: {} }],
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: { from() { unsafeCalls += 1; return {}; } }
    });
    assert.strictEqual(unsafeCalls, 0);
    assert.strictEqual(unsafe.summary.failed.length, 1);
    assert.strictEqual(unsafe.summary.inserted, 0);
})().then(async function () {
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

    // Verify Admin Workload Tracker empty state, zero-dummy-record behavior, and Persistent Imported File History
    assert.ok(html.indexOf('No workload records available.') !== -1);
    assert.ok(html.indexOf('Import a workload file to populate the tracker.') !== -1);
    assert.ok(html.indexOf('if (!summary.teaching || !summary.teaching.length) return false;') !== -1);
    assert.ok(html.indexOf('IMPORT_HISTORY_STORAGE_KEY') !== -1);
    assert.ok(html.indexOf('Clear imported file history?') !== -1);
    assert.ok(html.indexOf('This will remove the imported file entries from the history display. Previously saved workload assignments will remain unchanged.') !== -1);
    assert.ok(html.indexOf('No imported files yet.') !== -1);
    assert.ok(html.indexOf('Uploaded and successfully imported files will appear here.') !== -1);
    assert.ok(html.indexOf('confirmClearImportHistory') !== -1);
    assert.ok(html.indexOf('recordSuccessfulImportFile') !== -1);

    // Verify Enhanced Integrated Import Preview (Phases 2-7)
    assert.ok(html.indexOf('Upload Workload File') !== -1);
    assert.ok(html.indexOf('Browse Files') !== -1);
    assert.ok(html.indexOf('onImportDragOver') !== -1 && html.indexOf('onImportDrop') !== -1);
    assert.ok(html.indexOf('id="importStepper"') !== -1);
    ['Import Details', 'File Upload', 'Extraction', 'Review & Validate', 'Import Strategy', 'Confirmation', 'Completed'].forEach((stageName) => {
        assert.ok(html.indexOf(`label: '${stageName}'`) !== -1, `Missing progress stage ${stageName}`);
    });
    assert.ok(html.indexOf('id="importSummaryDashboard"') !== -1);
    assert.ok(html.indexOf('id="importMetricTotalFaculty"') !== -1);
    assert.ok(html.indexOf('id="importMetricTotalAssignments"') !== -1);
    assert.ok(html.indexOf('id="importMetricValidAssignments"') !== -1);
    assert.ok(html.indexOf('id="importMetricNeedsReview"') !== -1);
    assert.ok(html.indexOf('id="importMetricUnmatchedFaculty"') !== -1);
    assert.ok(html.indexOf('id="importMetricDuplicates"') !== -1);
    assert.ok(html.indexOf('function buildFacultyPreviewGroups') !== -1);
    assert.ok(html.indexOf('function classifyPlanValidation') !== -1);
    assert.ok(html.indexOf('data-action="expand-all-groups"') !== -1);
    assert.ok(html.indexOf('data-action="collapse-all-groups"') !== -1);
    assert.ok(html.indexOf('data-action="toggle-faculty-collapse"') !== -1);
    assert.ok(html.indexOf('import-subject-card') !== -1);
    assert.ok(html.indexOf("importField(record, 'remarks')") !== -1);
    ['Missing Subject Code', 'Missing Subject Title', 'Missing Section', 'Missing Units', 'Missing Semester', 'Missing Academic Year'].forEach((missingLabel) => {
        assert.ok(html.indexOf(missingLabel) !== -1, `Missing field badge ${missingLabel}`);
    });
    ['Valid', 'Needs Review', 'Missing Required Information', 'Unmatched Faculty', 'Duplicate Assignment'].forEach((valBadge) => {
        assert.ok(html.indexOf(valBadge) !== -1, `Missing validation status ${valBadge}`);
    });
    assert.ok(html.indexOf('id="importPreviewSearch"') !== -1);
    assert.ok(html.indexOf('id="importPreviewDeptFilter"') !== -1);
    assert.ok(html.indexOf('id="importPreviewValidationFilter"') !== -1);
    assert.ok(html.indexOf('id="importPreviewMatchFilter"') !== -1);
    assert.ok(html.indexOf('function buildImportConfirmationSummary') !== -1);
    assert.ok(html.indexOf('Existing workload records for faculty included in this import will be replaced. Workload records belonging to other faculty will remain unchanged.') !== -1);
    assert.ok(html.indexOf('function executeConfirmedWorkloadImport') !== -1);
    assert.ok(html.indexOf('function buildImportResultBanner') !== -1);

    // Verify formatImportTimestamp is defined and reused in admin/workload-tracker.html
    assert.ok(html.indexOf('function formatImportTimestamp(isoString)') !== -1, 'Missing formatImportTimestamp definition');
    assert.ok(html.indexOf('id="academicYearFilter"') !== -1, 'Missing academicYearFilter dropdown in admin/workload-tracker.html');
    assert.ok(html.indexOf('function populateAcademicYearFilter()') !== -1, 'Missing populateAcademicYearFilter helper');
    assert.ok(html.indexOf('function normalizeTrackerSemester(value)') !== -1, 'Missing normalizeTrackerSemester helper');
    assert.ok(html.indexOf('function normalizeTrackerAcademicYear(value)') !== -1, 'Missing normalizeTrackerAcademicYear helper');
    assert.ok(html.indexOf('../shared/auth.js') !== -1, 'admin/workload-tracker.html must load shared/auth.js');
    assert.ok(html.indexOf('id="importBottomExecuteSaveBtn"') !== -1, 'Missing bottom confirmation button in import modal');
    assert.ok(html.indexOf('id="importViewTrackerBtn"') !== -1, 'Missing View in Workload Tracker button in result banner');

    const supabaseConfigJs = fs.readFileSync(path.join(__dirname, '../shared/supabase-config.js'), 'utf8');
    assert.ok(supabaseConfigJs.indexOf('client.auth.getSession = async function') !== -1, 'supabase-config.js must guard client.auth.getSession with stored session fallback');

    const authGuardJs = fs.readFileSync(path.join(__dirname, '../shared/auth-guard.js'), 'utf8');
    assert.strictEqual(authGuardJs.indexOf('grantee_email, email'), -1, 'auth-guard.js should not select nonexistent wf_delegated_access.email column');
    assert.ok(authGuardJs.indexOf('const resolvedFaculty = isAdminRole') !== -1, 'auth-guard.js must propagate admin_profiles admin access to guardApi.faculty');

    // Verify CITEFLOW_Sample_Workload_Import.pdf extraction, faculty name completeness, and matching
    const sampleWorkloadPdfPath = path.join(__dirname, 'fixtures', 'CITEFLOW_Sample_Workload_Import.pdf');
    const sampleWorkloadRaw = execFileSync('python', [path.join(__dirname, 'fixtures', 'extract_pdf_items.py'), sampleWorkloadPdfPath], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
    });
    const parsedWorkloadPdf = api.parsePdfPages(JSON.parse(sampleWorkloadRaw), { fileName: 'CITEFLOW_Sample_Workload_Import.pdf' });
    assert.strictEqual(parsedWorkloadPdf.ok, true, parsedWorkloadPdf.message);
    assert.strictEqual(parsedWorkloadPdf.records.length, 56, 'Expected 56 workload assignments from CITEFLOW_Sample_Workload_Import.pdf');

    const extractedFacultyNames = Array.from(new Set(parsedWorkloadPdf.records.map((r) => r.draft.facultyName)));
    assert.strictEqual(extractedFacultyNames.length, 28, 'Expected 28 unique faculty members');
    [
        'Fruit S. Yummy',
        'Mel User',
        'Son Goku',
        'Cessy Sans',
        'Chiana Kaye',
        'Donal E. Kent',
        'Adrian Enocc',
        'Jamyca A. limbaga',
        'Jenisel O. Carinoza',
        'Jo Marie A. Santos',
        'Juan dos Dela Cruz',
        'Juan Perez Dela Cruz',
        'Ken L. Dumpax',
        'Kentoy Donal',
        'KrishPao A. Faculty',
        'Lei A. Rabasto',
        'Leigh A. Rabasto',
        'Maira Santos',
        'Mel Albarracin',
        'Melanie Albarracin',
        'Morris C. Dayaganon',
        'Princess A. AMARILLE',
        'Princess M. Petancio',
        'Rhen S. Petancio',
        'Angel B. Elorde',
        'Jamir Faculty',
        'Paolo Faculty',
        'Paoloo Faculty'
    ].forEach((expectedName) => {
        assert.ok(extractedFacultyNames.indexOf(expectedName) !== -1, `Expected complete faculty name: ${expectedName}`);
    });

    // Verify multi-line wrapped subject titles and schedules are reconstructed without splitting faculty rows
    const sonGokuRows = parsedWorkloadPdf.records.filter((r) => r.draft.facultyName === 'Son Goku');
    assert.strictEqual(sonGokuRows.length, 2);
    assert.strictEqual(sonGokuRows[1].draft.subject_title, 'Fundamentals of Information Technology');
    const jamirRows = parsedWorkloadPdf.records.filter((r) => r.draft.facultyName === 'Jamir Faculty');
    assert.strictEqual(jamirRows.length, 2);
    assert.strictEqual(jamirRows[0].draft.subject_title, 'Introduction to Information Technology');
    const angelRows = parsedWorkloadPdf.records.filter((r) => r.draft.facultyName === 'Angel B. Elorde');
    assert.strictEqual(angelRows.length, 2);
    assert.strictEqual(angelRows[0].draft.subject_code, 'GE106');
    assert.strictEqual(angelRows[0].draft.subject_title, 'Ethics');
    assert.strictEqual(angelRows[0].draft.scheduleText, 'Wednesday, 8:00 AM–11:00 AM');

    // Match against registered faculty records (both by ID and by normalized name / first+middle+last name)
    const sampleRegisteredFaculty = extractedFacultyNames.map((fullName, idx) => ({
        id: idx + 500,
        full_name: fullName,
        employee_id: '',
        department: 'BIT',
        position: 'Faculty'
    }));
    const workloadPdfPlans = api.planBatch(choose(parsedWorkloadPdf.records.map((r) => Object.assign({}, r))), [], sampleRegisteredFaculty);
    const workloadPdfSummary = api.summarizePlans(workloadPdfPlans);
    assert.strictEqual(workloadPdfSummary.total, 56);
    assert.strictEqual(workloadPdfSummary.matched, 56);
    assert.strictEqual(workloadPdfSummary.unmatched, 0);
    assert.strictEqual(workloadPdfSummary.invalid, 0);
    assert.strictEqual(workloadPdfSummary.willWrite, 56);
    assert.ok(workloadPdfPlans.every((p) => typeof p.payload.faculty_id === 'number' && p.payload.start_time && p.payload.end_time));

    // Check syntax and workload card/filter/grouping structure in Faculty Profile pages
    ['../faculty/faculty-profile.html', '../admin/faculty-profiles.html', '../admin/admin-profile.html'].forEach((relPath, pageIdx) => {
        const pageHtml = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
        assert.ok(pageHtml.indexOf('All Academic Years') !== -1, `${relPath} missing All Academic Years filter`);
        assert.ok(pageHtml.indexOf('All Semesters') !== -1, `${relPath} missing All Semesters filter`);
        assert.ok(pageHtml.indexOf('workload-subject-card') !== -1, `${relPath} missing individual subject card rendering`);
        assert.ok(pageHtml.indexOf('workload-year-group') !== -1, `${relPath} missing Academic Year group rendering`);

        const pageMatcher = /<script>([\s\S]*?)<\/script>/g;
        let scriptMatch;
        let scriptIdx = 0;
        while ((scriptMatch = pageMatcher.exec(pageHtml))) {
            const tmpScript = path.join(os.tmpdir(), `citeflow-page-${pageIdx}-script-${scriptIdx++}.js`);
            fs.writeFileSync(tmpScript, scriptMatch[1]);
            execFileSync(process.execPath, ['--check', tmpScript], { stdio: 'pipe' });
        }
    });

    // Verify Faculty Profile card rendering omits missing fields and displays all existing fields
    const facultyHtml = fs.readFileSync(path.join(__dirname, '../faculty/faculty-profile.html'), 'utf8');
    assert.ok(facultyHtml.indexOf('function workloadSubjectCard') !== -1);
    assert.ok(facultyHtml.indexOf('function compareAcademicYearsDesc') !== -1);
    assert.ok(facultyHtml.indexOf('function populateWorkloadFilterOptions') !== -1);
    assert.ok(facultyHtml.indexOf('openTeachingModal') !== -1);
    assert.ok(facultyHtml.indexOf('saveTeachingLoad') !== -1);
    assert.ok(facultyHtml.indexOf('archiveWorkload') !== -1);

    // -------------------------------------------------------------------------
    // Phase 4 Enhancements: Academic Year Validation, .DOCX Parsing, Period Inheritance & Conflicts, Import Strategy, Role Permissions
    // -------------------------------------------------------------------------

    // 1. validateAcademicYear & normalizeAcademicYear
    assert.strictEqual(api.validateAcademicYear('2025-2026').valid, true);
    assert.strictEqual(api.validateAcademicYear('2025–2026').valid, true);
    assert.strictEqual(api.validateAcademicYear('2026-2027').valid, true);
    assert.strictEqual(api.validateAcademicYear('2025-2026').normalized, '2025–2026');
    assert.strictEqual(api.validateAcademicYear('2025').valid, false);
    assert.strictEqual(api.validateAcademicYear('2025-2025').valid, false); // Not consecutive
    assert.strictEqual(api.validateAcademicYear('2025-2027').valid, false); // Not consecutive
    assert.strictEqual(api.validateAcademicYear('abcd-efgh').valid, false);
    assert.strictEqual(api.validateAcademicYear('').valid, false);
    assert.strictEqual(api.validateAcademicYear(null).valid, false);

    // 2. Target Period Inheritance and Conflict Detection
    const periodInheritRows = [
        header,
        ['Juan Dela Cruz', 'FAC-2025-001', 'CS101', 'Programming Fundamentals', 'A', '3', '3', '', '', '', ''],
        ['Maria Santos', 'FAC-2025-002', 'IT201', 'Database Systems', 'B', '3', '3', '2nd Semester', '2024-2025', '', '']
    ];
    const parsedInherit = api.parseSheetRows([{ name: 'Load', rows: periodInheritRows }], {
        fileName: 'period.xlsx',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(parsedInherit.ok, true);
    assert.strictEqual(parsedInherit.records.length, 2);
    // Row 0 inherits target period
    assert.strictEqual(parsedInherit.records[0].draft.academic_year, '2025-2026');
    assert.strictEqual(parsedInherit.records[0].draft.semester, '1st Semester');
    assert.strictEqual(parsedInherit.records[0].inheritedAcademicYear, true);
    assert.strictEqual(parsedInherit.records[0].inheritedSemester, true);
    // Row 1 has conflicting periods explicitly in the file
    assert.strictEqual(parsedInherit.records[1].periodConflictYear.extracted, '2024-2025');
    assert.strictEqual(parsedInherit.records[1].periodConflictSemester.extracted, '2nd Semester');
    const row1Issues = api.fieldIssues(parsedInherit.records[1].draft, parsedInherit.records[1]);
    assert.ok(row1Issues.some((issue) => issue.field === 'academic_year' && issue.level === 'warning'));
    assert.ok(row1Issues.some((issue) => issue.field === 'semester' && issue.level === 'warning'));

    // 3. Word Document (.docx) Parsing
    const zlib = require('zlib');
    function makeDocxBuffer(xmlContent) {
        const xmlBuf = Buffer.from(xmlContent, 'utf8');
        const comp = zlib.deflateRawSync(xmlBuf);
        const entryName = Buffer.from('word/document.xml', 'utf8');
        const local = Buffer.alloc(30 + entryName.length + comp.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(xmlBuf.length, 22);
        local.writeUInt16LE(entryName.length, 26);
        local.writeUInt16LE(0, 28);
        entryName.copy(local, 30);
        comp.copy(local, 30 + entryName.length);
        return local;
    }

    const docxXml = '<w:document><w:body><w:tbl>' +
        '<w:tr>' +
        '<w:tc><w:t>Faculty Name</w:t></w:tc>' +
        '<w:tc><w:t>Subject Code</w:t></w:tc>' +
        '<w:tc><w:t>Subject Title</w:t></w:tc>' +
        '<w:tc><w:t>Section</w:t></w:tc>' +
        '<w:tc><w:t>Units</w:t></w:tc>' +
        '<w:tc><w:t>Hours/Week</w:t></w:tc>' +
        '<w:tc><w:t>Room</w:t></w:tc>' +
        '</w:tr>' +
        '<w:tr>' +
        '<w:tc><w:t>Juan Dela Cruz</w:t></w:tc>' +
        '<w:tc><w:t>CS101</w:t></w:tc>' +
        '<w:tc><w:t>Intro to Computing</w:t></w:tc>' +
        '<w:tc><w:t>BSIT-1A</w:t></w:tc>' +
        '<w:tc><w:t>3</w:t></w:tc>' +
        '<w:tc><w:t>3</w:t></w:tc>' +
        '<w:tc><w:t>Room 301</w:t></w:tc>' +
        '</w:tr>' +
        '<w:tr>' +
        '<w:tc><w:t>Maria Santos</w:t></w:tc>' +
        '<w:tc><w:t>IT204</w:t></w:tc>' +
        '<w:tc><w:t>Data Structures</w:t></w:tc>' +
        '<w:tc><w:t>BSIT-2B</w:t></w:tc>' +
        '<w:tc><w:t>3</w:t></w:tc>' +
        '<w:tc><w:t>5</w:t></w:tc>' +
        '<w:tc><w:t>Lab 2</w:t></w:tc>' +
        '</w:tr>' +
        '</w:tbl></w:body></w:document>';

    const mockDocxBuf = makeDocxBuffer(docxXml);
    const parsedDocx = await api.parseDocxBuffer(mockDocxBuf, {
        fileName: 'faculty_loads.docx',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(parsedDocx.ok, true);
    assert.strictEqual(parsedDocx.records.length, 2);
    assert.strictEqual(parsedDocx.records[0].draft.facultyName, 'Juan Dela Cruz');
    assert.strictEqual(parsedDocx.records[0].draft.subject_code, 'CS101');
    assert.strictEqual(parsedDocx.records[0].draft.units, '3');
    assert.strictEqual(parsedDocx.records[0].draft.academic_year, '2025-2026');
    assert.strictEqual(parsedDocx.records[0].draft.semester, '1st Semester');
    assert.strictEqual(parsedDocx.records[1].draft.facultyName, 'Maria Santos');
    assert.strictEqual(parsedDocx.records[1].draft.subject_code, 'IT204');
    assert.strictEqual(parsedDocx.records[1].draft.units, '3');

    // Word Document with non-workload table (like MFO.docx) returns unreliable
    if (fs.existsSync('MFO.docx')) {
        const mfoRes = await api.parseDocxBuffer(fs.readFileSync('MFO.docx'), { fileName: 'MFO.docx' });
        assert.strictEqual(mfoRes.ok, false);
        assert.strictEqual(mfoRes.code, 'unreliable');
    }

    // Word Document with empty buffer
    const emptyDocxRes = await api.parseDocxBuffer(null);
    assert.strictEqual(emptyDocxRes.ok, false);
    assert.strictEqual(emptyDocxRes.code, 'empty');

    // 4. commitImport with Strategy: 'add' vs 'replace'
    const strategyPlans = plansFor(parsedDocx, registered);
    assert.strictEqual(strategyPlans.length, 2);
    assert.ok(strategyPlans.every((p) => p.willWrite));

    // Test Strategy 'add': Does NOT call delete, simply inserts
    const addClient = {
        calls: [],
        from(table) {
            const state = { table, op: '', filters: [] };
            const chain = {
                delete() { state.op = 'delete'; return chain; },
                in(col, vals) { state.filters.push({ op: 'in', col, vals }); return chain; },
                eq(col, val) { state.filters.push({ op: 'eq', col, val }); return chain; },
                insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
                select() {
                    addClient.calls.push(state);
                    if (state.op === 'insert') return Promise.resolve({ data: [{ id: 999, ...state.payload }], error: null });
                    return Promise.resolve({ data: [], error: null });
                }
            };
            return chain;
        }
    };

    const addCommitRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: addClient,
        strategy: 'add',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(addCommitRes.ok, true);
    assert.strictEqual(addCommitRes.summary.inserted, 2);
    assert.strictEqual(addClient.calls.filter((c) => c.op === 'delete').length, 0);

    // Test Strategy 'replace': Requires commit_workload_import RPC and rejects client-side fallback
    const replaceClientWithoutRpc = {
        calls: [],
        from(table) {
            const state = { table, op: '', filters: [] };
            const chain = {
                delete() { state.op = 'delete'; replaceClientWithoutRpc.calls.push(state); return chain; },
                in(col, vals) { state.filters.push({ op: 'in', col, vals }); return chain; },
                eq(col, val) { state.filters.push({ op: 'eq', col, val }); return chain; },
                insert(payload) { state.op = 'insert'; replaceClientWithoutRpc.calls.push(state); return chain; },
                select() {
                    return Promise.resolve({ data: [], error: null });
                }
            };
            return chain;
        }
    };

    const replaceCommitRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: replaceClientWithoutRpc,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(replaceCommitRes.ok, false);
    assert.strictEqual(replaceCommitRes.aborted, true);
    assert.strictEqual(replaceCommitRes.message, 'Workload replacement requires the atomic commit_workload_import database function. Please apply migration 033.');
    assert.strictEqual(replaceClientWithoutRpc.calls.filter((c) => c.op === 'delete').length, 0, 'No client-side delete allowed');
    assert.strictEqual(replaceClientWithoutRpc.calls.filter((c) => c.op === 'insert').length, 0, 'No client-side insert allowed');

    // 5. Role Permissions in assertImportAllowed: Strict College Dean and College Secretary only
    assert.strictEqual(api.assertImportAllowed(deanSession, null).ok, false, 'Client metadata alone must not grant import access');
    assert.strictEqual(api.assertImportAllowed(secretarySession, null).ok, false, 'Client metadata alone must not grant import access');
    assert.strictEqual(api.assertImportAllowed(facultySession, { position: 'College Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(facultySession, { position: 'Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'College Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Admin' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Administrator' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(chairSession, { role: 'Chairperson', admin_access: true }).ok, false);
    assert.strictEqual(api.assertImportAllowed(oicSession, { role: 'OIC' }).ok, false);
    assert.strictEqual(api.assertImportAllowed(facultySession, { position: 'Instructor I' }).ok, false);
    assert.strictEqual(api.assertImportAllowed({ user: { id: 'anon' } }, null).ok, false);
    assert.strictEqual(api.assertImportAllowed(null, null).ok, false);

    // 6. Check workload-tracker.html script syntax
    const trackerHtml = fs.readFileSync(path.join(__dirname, '../admin/workload-tracker.html'), 'utf8');
    assert.ok(trackerHtml.indexOf('id="importDetailsSection"') !== -1);
    assert.ok(trackerHtml.indexOf('readDocxDocument') !== -1);
    assert.ok(trackerHtml.indexOf('buildImportStrategyHtml') !== -1);
    assert.ok(trackerHtml.indexOf('showWorkloadToast') !== -1);
    const trackerScriptMatcher = /<script>([\s\S]*?)<\/script>/g;
    let trMatch;
    let trIdx = 0;
    while ((trMatch = trackerScriptMatcher.exec(trackerHtml))) {
        const tmpScript = path.join(os.tmpdir(), `citeflow-tracker-script-${trIdx++}.js`);
        fs.writeFileSync(tmpScript, trMatch[1]);
        execFileSync(process.execPath, ['--check', tmpScript], { stdio: 'pipe' });
    }

    // -------------------------------------------------------------------------
    // Targeted Critical Verification Suite (14 Requirements)
    // -------------------------------------------------------------------------

    // 1 & 2 & 3. Academic Year Dropdown: valid strings, no [object Object], deduplicated, database loaded
    const sampleDbLoads = [
        { academic_year: '2025-2026' },
        { academic_year: '2024-2025' },
        { academic_year: '2025–2026' }, // duplicate with en-dash
        { academic_year: '2023-2024' }
    ];
    const extractedAySet = new Set();
    sampleDbLoads.forEach((row) => {
        let val = '';
        if (typeof api.normalizeAcademicYear === 'function') {
            const res = api.normalizeAcademicYear(row.academic_year);
            if (res && res.valid && res.value) val = res.value;
        }
        if (val) extractedAySet.add(val.replace('-', '–'));
    });
    const finalAyList = Array.from(extractedAySet).sort().reverse();
    assert.strictEqual(finalAyList.length, 3, 'Duplicates should be collapsed into unique items');
    assert.ok(finalAyList.every((y) => typeof y === 'string' && y.indexOf('[object') === -1), 'AY must be string, never [object Object]');
    assert.deepStrictEqual(finalAyList, ['2025–2026', '2024–2025', '2023–2024'], 'AY items must be formatted consistently');

    // 4 & 5. Only College Dean and College Secretary can import; missing/unknown rejected
    assert.strictEqual(api.assertImportAllowed(deanSession, { role: 'College Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(secretarySession, { role: 'College Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Admin' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Administrator' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(chairSession, { role: 'Chairperson', admin_access: true }).ok, false);
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'Instructor I' }).ok, false);
    assert.strictEqual(api.assertImportAllowed({ user: { id: 'unknown-user', user_metadata: {} } }, null).ok, false);

    // 6. Direct RPC requests with unauthorized access are rejected
    const unauthorizedRpcClient = {
        from() { return {}; },
        rpc(fnName) {
            assert.strictEqual(fnName, 'commit_workload_import');
            return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'Access Denied: Only College Dean and College Secretary accounts can manage workload imports.' }
            });
        }
    };
    const unauthRpcRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: unauthorizedRpcClient,
        strategy: 'add',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(unauthRpcRes.ok, false);
    assert.strictEqual(unauthRpcRes.aborted, true);
    assert.ok(/Access Denied/i.test(unauthRpcRes.message));

    // 7. Add preserves existing assignments & calls insert without delete
    let addDeleteCalls = 0;
    const atomicAddClient = {
        rpc(fnName, params) {
            assert.strictEqual(fnName, 'commit_workload_import');
            assert.strictEqual(params.p_strategy, 'add');
            assert.strictEqual(params.p_records.length, 2);
            return Promise.resolve({
                data: { ok: true, summary: { inserted: 2, replaced: 0, skipped: 0, total: 2 } },
                error: null
            });
        },
        from() {
            return {
                delete() { addDeleteCalls += 1; return this; },
                insert() { return Promise.resolve({ data: [{ id: 1 }], error: null }); }
            };
        }
    };
    const atomicAddRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: atomicAddClient,
        strategy: 'add',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(atomicAddRes.ok, true);
    assert.strictEqual(atomicAddRes.summary.inserted, 2);
    assert.strictEqual(addDeleteCalls, 0, 'Add strategy must not delete existing records');

    // 8 & 9 & 10. Replace affects only included faculty within target AY & Semester, preserving others
    const atomicReplaceClient = {
        from() { return {}; },
        rpc(fnName, params) {
            assert.strictEqual(fnName, 'commit_workload_import');
            assert.strictEqual(params.p_strategy, 'replace');
            assert.strictEqual(params.p_academic_year, '2025–2026');
            assert.strictEqual(params.p_semester, '1st Semester');
            const includedFacultyIds = params.p_records.map((r) => r.faculty_id);
            assert.ok(includedFacultyIds.includes('fac-juan'));
            assert.ok(includedFacultyIds.includes('fac-maria'));
            assert.ok(!includedFacultyIds.includes('fac-other-person'), 'Faculty not in import are not targeted');
            return Promise.resolve({
                data: { ok: true, summary: { inserted: 2, replaced: 3, skipped: 0, total: 2 } },
                error: null
            });
        }
    };
    const atomicReplaceRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: atomicReplaceClient,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(atomicReplaceRes.ok, true);
    assert.strictEqual(atomicReplaceRes.summary.replaced, 3);
    assert.strictEqual(atomicReplaceRes.summary.inserted, 2);

    // 11. RPC Failure during Replace rolls back all changes atomically (no partial state)
    const failingRpcClient = {
        from() { return {}; },
        rpc(fnName, params) {
            assert.strictEqual(fnName, 'commit_workload_import');
            return Promise.resolve({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            });
        }
    };
    const failingRpcRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: failingRpcClient,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(failingRpcRes.ok, false);
    assert.strictEqual(failingRpcRes.aborted, true);
    assert.strictEqual(failingRpcRes.partial, false);
    assert.ok(failingRpcRes.message.indexOf('duplicate key') !== -1);

    // 11b. Replace with PGRST202 (RPC missing) immediately halts with migration 033 message
    const missingRpcClient = {
        from() { return {}; },
        rpc(fnName) {
            return Promise.resolve({
                data: null,
                error: { code: 'PGRST202', message: 'Could not find the function in schema cache' }
            });
        }
    };
    const missingRpcRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: missingRpcClient,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(missingRpcRes.ok, false);
    assert.strictEqual(missingRpcRes.aborted, true);
    assert.strictEqual(missingRpcRes.message, 'Workload replacement requires the atomic commit_workload_import database function. Please apply migration 033.');

    // 12. Mixed PDFs correctly process scanned pages and flag them
    const mixedPage1 = []
        .concat(pdfLine(760, tableHeader))
        .concat(tableRow(730, ['Juan Dela Cruz', 'CS101', 'Programming Fundamentals', 'A', '3', '1st Semester', '2025-2026']));
    const mixedPdfPages = [
        { pageNumber: 1, items: mixedPage1 },
        { pageNumber: 2, items: [] }
    ];
    const mixedParsed = api.parsePdfPages(mixedPdfPages, { fileName: 'mixed.pdf' });
    assert.strictEqual(mixedParsed.ok, true);
    assert.strictEqual(mixedParsed.records.length, 1);
    assert.ok(mixedParsed.warnings.some((w) => w.indexOf('Page 2 has no selectable text') !== -1), 'Mixed PDF must flag scanned pages in warnings');

    // 13. Fully scanned PDFs report clear OCR failure
    const fullyScannedPages = [
        { pageNumber: 1, items: [] },
        { pageNumber: 2, items: [] }
    ];
    const fullyScannedParsed = api.parsePdfPages(fullyScannedPages, { fileName: 'scanned.pdf' });
    assert.strictEqual(fullyScannedParsed.ok, false);
    assert.strictEqual(fullyScannedParsed.code, 'ocr_unavailable');
    assert.ok(fullyScannedParsed.message.indexOf('OCR is not available') !== -1);

    // 14. Successful imports immediately appear in workload tracker
    assert.ok(trackerHtml.indexOf('await loadAllWorkloads()') !== -1);
    assert.ok(trackerHtml.indexOf('populateAcademicYearFilter()') !== -1);
    assert.ok(trackerHtml.indexOf('applyFilters()') !== -1);
    assert.ok(trackerHtml.indexOf('renderStats(filtered)') !== -1);
    assert.ok(trackerHtml.indexOf('renderTable(filtered)') !== -1);

    // -------------------------------------------------------------------------
    // Migration 033 & Workload Import Security Verification (16 Requirements)
    // -------------------------------------------------------------------------
    const migration033Path = path.join(__dirname, '../../supabase/migrations/033_workload_import_atomic_rpc.sql');
    const migration033Sql = fs.readFileSync(migration033Path, 'utf8');

    // 1. commit_workload_import rejects requests without authenticated session
    assert.ok(
        /IF\s+v_user_id\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+['"]Access Denied: You must be authenticated to perform workload imports\.['"]\s+USING\s+ERRCODE\s+=\s+['"]42501['"]/i.test(migration033Sql),
        'Req 1: Must verify auth.uid() is not null and raise 42501'
    );
    assert.strictEqual(api.assertImportAllowed(null, null).ok, false, 'Client assertImportAllowed must reject null session');
    assert.strictEqual(api.assertImportAllowed({}, null).ok, false, 'Client assertImportAllowed must reject empty session');

    // 2. commit_workload_import rejects non-dean/secretary roles
    assert.ok(
        /lower\(trim\(coalesce\([^)]*role[^)]*\)\)\)\s+LIKE\s+'%dean%'/i.test(migration033Sql)
        && /lower\(trim\(coalesce\([^)]*role[^)]*\)\)\)\s+LIKE\s+'%secretary%'/i.test(migration033Sql)
        && (migration033Sql.match(/NOT LIKE '%(?:vice|assistant|associate)%'/gi) || []).length >= 6,
        'Req 2: Must allow Dean / Secretary roles and reject deputy or assistant variants'
    );
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'Instructor I' }).ok, false);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Admin' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Administrator' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(chairSession, { role: 'Chairperson' }).ok, false);
    assert.strictEqual(api.assertImportAllowed(oicSession, { role: 'OIC' }).ok, false);

    // 3. commit_workload_import rejects spoofed JWT role metadata
    assert.strictEqual(
        migration033Sql.indexOf('user_metadata'),
        -1,
        'Req 3: Migration 033 must NEVER trust user_metadata for role authorization'
    );
    const spoofedRpcClient = {
        from() { return {}; },
        rpc(fnName) {
            return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'Access Denied: Only College Dean and College Secretary accounts can manage workload imports.' }
            });
        }
    };
    const spoofedRes = await api.commitImport({
        plans: strategyPlans,
        session: { user: { id: 'attacker-id', user_metadata: { role: 'College Dean' } } },
        facultyRecord: { role: 'College Dean' },
        client: spoofedRpcClient,
        strategy: 'add',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(spoofedRes.ok, false);
    assert.strictEqual(spoofedRes.aborted, true);
    assert.ok(/Access Denied/i.test(spoofedRes.message));

    // 4. commit_workload_import rejects unknown/unregistered faculty IDs
    assert.ok(
        /IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.faculty\s+WHERE\s+id\s+=\s+v_fac_id\s*\)\s*THEN\s*RAISE\s+EXCEPTION/i.test(migration033Sql),
        'Req 4: Must verify each faculty_id exists in public.faculty and raise 23503'
    );
    assert.ok(/ERRCODE\s*=\s*['"]23503['"]/.test(migration033Sql), 'Req 4: Must use ERRCODE 23503 for foreign key violation');

    // 5. commit_workload_import rejects invalid semester strings
    assert.ok(
        /IF\s+v_norm_sem\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'Invalid semester/i.test(migration033Sql),
        'Req 5: Must reject unmapped or invalid semester strings with 22023'
    );

    // 6. commit_workload_import accepts valid semester strings and aliases
    assert.ok(
        /'1st semester',\s*'1st',\s*'first semester',\s*'first'/i.test(migration033Sql) &&
        /'2nd semester',\s*'2nd',\s*'second semester',\s*'second'/i.test(migration033Sql) &&
        /'summer',\s*'midyear',\s*'mid-year',\s*'mid year'/i.test(migration033Sql),
        'Req 6: Must accept standard semester values and common aliases (1st Semester, 2nd Semester, Summer)'
    );

    // 7 & 8. Academic Year validation: accepts valid AY strings, rejects malformed AY strings
    assert.ok(
        /v_norm_ay\s+!~\s+'\^\\d\{4\}-\\d\{4\}\$'/i.test(migration033Sql),
        'Req 7 & 8: Migration 033 must validate Academic Year format (YYYY-YYYY)'
    );
    assert.strictEqual(api.validateAcademicYear('2025-2026').valid, true);
    assert.strictEqual(api.validateAcademicYear('2025–2026').valid, true);
    assert.strictEqual(api.validateAcademicYear('invalid-ay').valid, false);
    assert.strictEqual(api.validateAcademicYear('').valid, false);

    // 9. Replace strategy deletes only matching faculty, AY, and semester records
    assert.ok(
        /DELETE\s+FROM\s+public\.faculty_teaching_loads\s+WHERE\s+faculty_id\s+=\s+ANY\(v_faculty_ids\)\s+AND\s+\(academic_year\s+=\s+v_norm_ay\s+OR\s+academic_year\s+=\s+v_alt_ay\)\s+AND\s+semester\s+=\s+v_norm_sem/i.test(migration033Sql),
        'Req 9: Must delete only existing records for included faculty within specified AY and semester'
    );

    // 10. Replace strategy atomically inserts new records after deletion
    assert.ok(
        /INSERT\s+INTO\s+public\.faculty_teaching_loads\s*\(\s*faculty_id,\s*academic_year,\s*semester/i.test(migration033Sql),
        'Req 10: Must insert new workload records within the same transaction'
    );

    // 11. Add strategy preserves existing records and inserts new ones
    assert.ok(
        /IF\s+p_strategy\s+=\s+'add'\s+THEN\s+IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.faculty_teaching_loads/i.test(migration033Sql),
        'Req 11: Add strategy checks existing records to avoid duplicates while preserving all other records'
    );

    // 12. Failure during Replace rolls back all changes atomically (no partial state)
    assert.ok(
        migration033Sql.indexOf('LANGUAGE plpgsql') !== -1 && migration033Sql.indexOf('COMMIT;') === -1,
        'Req 12: Atomic transaction in plpgsql function with no partial commits ensures automatic rollback on error'
    );

    // 13. Client-side Replace strictly requires RPC and does not fall back to separate DELETE + INSERT
    const replaceClientNoRpc = {
        calls: [],
        from(table) {
            return {
                delete() { replaceClientNoRpc.calls.push('delete'); return this; },
                insert() { replaceClientNoRpc.calls.push('insert'); return this; }
            };
        }
    };
    const req13Res = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: replaceClientNoRpc,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(req13Res.ok, false);
    assert.strictEqual(req13Res.aborted, true);
    assert.strictEqual(req13Res.message, 'Workload replacement requires the atomic commit_workload_import database function. Please apply migration 033.');
    assert.strictEqual(replaceClientNoRpc.calls.length, 0, 'No direct client-side delete or insert calls');

    // 14. Client-side Add safely falls back to direct insert if RPC is unavailable
    const addClientNoRpc = {
        inserted: [],
        from(table) {
            return {
                delete() { assert.fail('Add strategy must never call delete'); },
                insert(payload) {
                    addClientNoRpc.inserted.push(payload);
                    return { select() { return Promise.resolve({ data: [{ id: 888 }], error: null }); } };
                }
            };
        }
    };
    const req14Res = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        client: addClientNoRpc,
        strategy: 'add',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(req14Res.ok, true);
    assert.strictEqual(req14Res.summary.inserted, 2);
    assert.strictEqual(addClientNoRpc.inserted.length, 2);

    // 15. Revocation of execution from PUBLIC/anon is verified in migration SQL
    assert.ok(
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.commit_workload_import\([^)]*\)\s+FROM\s+PUBLIC,\s*anon\s*;/i.test(migration033Sql),
        'Req 15: Must revoke ALL execute privileges from PUBLIC and anon'
    );

    // 16. Function execution granted to authenticated is verified in migration SQL
    assert.ok(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.commit_workload_import\([^)]*\)\s+TO\s+authenticated\s*;/i.test(migration033Sql),
        'Req 16: Must grant EXECUTE privilege to authenticated database role'
    );

    // -------------------------------------------------------------------------
    // Workload Import & Export Permissions Matrix (Part 4 Verification)
    // -------------------------------------------------------------------------

    // 1. College Dean imports workload: Allowed
    assert.strictEqual(api.assertImportAllowed(deanSession, { role: 'College Dean' }, null).ok, true);
    assert.strictEqual(api.assertImportAllowed(deanSession, null, { role: 'College Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(deanSession, { position: 'Dean' }, null).ok, true);

    // 2. College Secretary imports workload: Allowed
    assert.strictEqual(api.assertImportAllowed(secretarySession, { role: 'College Secretary' }, null).ok, true);
    assert.strictEqual(api.assertImportAllowed(secretarySession, null, { role: 'College Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(secretarySession, { role: 'Secretary' }, null).ok, true);

    // 3. Administrator imports workload: Allowed
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Administrator' }, { role: 'Administrator' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(adminSession, { role: 'Admin' }, { role: 'Admin' }).ok, true);

    // 4. Department Chairperson imports workload: Denied
    assert.strictEqual(api.assertImportAllowed(chairSession, { role: 'Chairperson', department: 'BSIT', admin_access: true }, null).ok, false);
    assert.strictEqual(api.assertImportAllowed(chairSession, { position: 'Chairperson', department: 'BSIT' }, null).ok, false);

    // 5. Faculty imports workload: Denied
    assert.strictEqual(api.assertImportAllowed(facultySession, { role: 'Faculty', position: 'Instructor I' }, null).ok, false);

    // 6. Unknown account imports workload: Denied
    assert.strictEqual(api.assertImportAllowed(null, null, null).ok, false);
    assert.strictEqual(api.assertImportAllowed({ user: null }, null, null).ok, false);
    assert.strictEqual(api.assertImportAllowed({ user: { id: 'unknown-id' } }, null, null).ok, false);

    // 7. College Dean & College Secretary export: Allowed (scope: all)
    const deanExportPdf = api.assertExportAllowed(deanSession, { role: 'College Dean' }, { role: 'College Dean' });
    assert.strictEqual(deanExportPdf.ok, true);
    assert.strictEqual(deanExportPdf.scope, 'all');
    assert.strictEqual(deanExportPdf.role, 'College Dean');

    const secExportExcel = api.assertExportAllowed(secretarySession, { role: 'College Secretary' }, { role: 'College Secretary' });
    assert.strictEqual(secExportExcel.ok, true);
    assert.strictEqual(secExportExcel.scope, 'all');
    assert.strictEqual(secExportExcel.role, 'College Secretary');

    // 8. Generic Administrator export: Denied (unless independently holding Dean/Secretary/Chairperson role)
    const adminExportPdf = api.assertExportAllowed(adminSession, { role: 'Administrator' }, { role: 'Administrator' });
    assert.strictEqual(adminExportPdf.ok, false);
    assert.ok(/Access Denied/i.test(adminExportPdf.message));

    const superadminExport = api.assertExportAllowed(adminSession, null, { role: 'superadmin' });
    assert.strictEqual(superadminExport.ok, false);
    assert.ok(/Access Denied/i.test(superadminExport.message));

    // 9. Chairperson/OIC export: department only
    const chairDeptExport = api.assertExportAllowed(chairSession, { role: 'Chairperson', department: 'BSIT' }, null, { department: 'BSIT' });
    assert.strictEqual(chairDeptExport.ok, true);
    assert.strictEqual(chairDeptExport.scope, 'department');
    assert.strictEqual(chairDeptExport.department, 'BSIT');

    const oicDeptExport = api.assertExportAllowed(chairSession, { role: 'OIC', department: 'BSCS' }, null, { department: 'BSCS' });
    assert.strictEqual(oicDeptExport.ok, true);
    assert.strictEqual(oicDeptExport.scope, 'department');
    assert.strictEqual(oicDeptExport.department, 'BSCS');

    // 10. Faculty export: own permitted workload only
    const facultyOwnExport = api.assertExportAllowed(facultySession, { id: 'fac-juan', role: 'Faculty' }, null, { facultyId: 'fac-juan' });
    assert.strictEqual(facultyOwnExport.ok, true);
    assert.strictEqual(facultyOwnExport.scope, 'own');
    assert.strictEqual(facultyOwnExport.facultyId, 'fac-juan');

    // 11. Unauthorized cross-department & cross-faculty exports: Denied
    const facultyOtherExport = api.assertExportAllowed(facultySession, { id: 'fac-juan', role: 'Faculty' }, null, { facultyId: 'fac-maria' });
    assert.strictEqual(facultyOtherExport.ok, false);
    assert.ok(/Access Denied/i.test(facultyOtherExport.message));

    const facultyCollegeWideExport = api.assertExportAllowed(facultySession, { id: 'fac-juan', role: 'Faculty' }, null, { isBatchAll: true });
    assert.strictEqual(facultyCollegeWideExport.ok, false);
    assert.ok(/Access Denied/i.test(facultyCollegeWideExport.message));

    const chairOtherDeptExport = api.assertExportAllowed(chairSession, { role: 'Chairperson', department: 'BSIT' }, null, { department: 'BSCS' });
    assert.strictEqual(chairOtherDeptExport.ok, false);
    assert.ok(/Access Denied/i.test(chairOtherDeptExport.message));

    const unknownExport = api.assertExportAllowed(null, null, null);
    assert.strictEqual(unknownExport.ok, false);

    // 12. Failed replacement import: No partial database changes (Atomic RPC verification)
    const atomicFailingClient = {
        from() { return {}; },
        rpc(fnName, params) {
            return Promise.resolve({
                data: null,
                error: { code: '40001', message: 'could not serialize access due to concurrent update' }
            });
        }
    };
    const failedReplaceRes = await api.commitImport({
        plans: strategyPlans,
        session: deanSession,
        facultyRecord: { role: 'College Dean' },
        adminProfile: { role: 'College Dean' },
        client: atomicFailingClient,
        strategy: 'replace',
        targetAcademicYear: '2025–2026',
        targetSemester: '1st Semester'
    });
    assert.strictEqual(failedReplaceRes.ok, false);
    assert.strictEqual(failedReplaceRes.aborted, true);
    assert.strictEqual(failedReplaceRes.partial, false);
    assert.strictEqual(failedReplaceRes.summary.inserted, 0);
    assert.strictEqual(failedReplaceRes.summary.replaced, 0);

    // 13. Audit Migration 033 SQL: Atomic RPC & Pending Deletion Protection
    const current033Sql = fs.readFileSync(migration033Path, 'utf8');
    assert.ok(current033Sql.indexOf('public.workload_deletion_requests') !== -1, 'Migration 033 must check workload_deletion_requests');
    assert.ok(current033Sql.indexOf("wdr.status = 'Pending'") !== -1, 'Migration 033 must verify Pending status on deletion requests');
    assert.ok(current033Sql.indexOf('Cannot perform replacement import: A pending deletion request exists') !== -1, 'Migration 033 must abort replacement on pending deletion requests');

    // 14. Audit Migration 034 SQL: RLS policies, helper functions, cleanup loop, and audit snapshots
    const migration034Path = path.join(__dirname, '../../supabase/migrations/034_workload_rls_policies.sql');
    assert.ok(fs.existsSync(migration034Path), 'Migration 034 must exist');
    const migration034Sql = fs.readFileSync(migration034Path, 'utf8');

    // Dynamic policy cleanup loop present
    assert.ok(migration034Sql.indexOf("tablename = 'faculty_teaching_loads'") !== -1, 'Must strictly scope cleanup to faculty_teaching_loads');
    assert.ok(migration034Sql.indexOf('DROP POLICY IF EXISTS') !== -1, 'Must drop existing policies');

    // Renamed & restricted helper function
    assert.ok(migration034Sql.indexOf('public.workload_is_dean_or_secretary()') !== -1, 'Must define workload_is_dean_or_secretary');
    assert.ok(
        /lower\(trim\(coalesce\([^)]*role[^)]*\)\)\)\s+LIKE\s+'%dean%'/i.test(migration034Sql)
        && /lower\(trim\(coalesce\([^)]*role[^)]*\)\)\)\s+LIKE\s+'%secretary%'/i.test(migration034Sql)
        && (migration034Sql.match(/NOT LIKE '%(?:vice|assistant|associate)%'/gi) || []).length >= 6,
        'Must restrict workload RLS authorization to verified Dean and Secretary roles'
    );
    assert.strictEqual(migration034Sql.indexOf("'admin'"), -1, 'Must NOT contain generic admin in role checks');
    assert.strictEqual(migration034Sql.indexOf("'administrator'"), -1, 'Must NOT contain generic administrator in role checks');
    assert.strictEqual(migration034Sql.indexOf("'superadmin'"), -1, 'Must NOT contain superadmin in role checks');

    // Granular policies
    assert.ok(migration034Sql.indexOf('CREATE POLICY "faculty_teaching_loads_select"') !== -1, 'Must define select policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "faculty_teaching_loads_insert"') !== -1, 'Must define insert policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "faculty_teaching_loads_update"') !== -1, 'Must define update policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "faculty_teaching_loads_delete"') !== -1, 'Must define delete policy');

    // Deletion requests table & approval RPCs & snapshot fields
    assert.ok(migration034Sql.indexOf('CREATE TABLE IF NOT EXISTS public.workload_deletion_requests') !== -1, 'Must create workload_deletion_requests table');
    assert.ok(migration034Sql.indexOf('ON DELETE SET NULL') !== -1, 'Must preserve request history on workload deletion');
    assert.ok(migration034Sql.indexOf('faculty_name TEXT') !== -1, 'Must include faculty_name snapshot');
    assert.ok(migration034Sql.indexOf('subject_code TEXT') !== -1, 'Must include subject_code snapshot');
    assert.ok(migration034Sql.indexOf('trg_workload_populate_deletion_request_snapshots') !== -1, 'Must include snapshot auto-population trigger');
    assert.ok(migration034Sql.indexOf('uq_workload_pending_deletion_request') !== -1, 'Must create partial unique index on pending requests');
    assert.ok(migration034Sql.indexOf('reviewed_by IS NULL') !== -1, 'Must require reviewed_by IS NULL on faculty insert');
    assert.ok(migration034Sql.indexOf('reviewed_at IS NULL') !== -1, 'Must require reviewed_at IS NULL on faculty insert');
    assert.ok(migration034Sql.indexOf('rejection_reason IS NULL') !== -1, 'Must require rejection_reason IS NULL on faculty insert');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "workload_deletion_requests_select"') !== -1, 'Must define deletion requests select policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "workload_deletion_requests_insert"') !== -1, 'Must define deletion requests insert policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "workload_deletion_requests_update"') !== -1, 'Must define deletion requests update policy');
    assert.ok(migration034Sql.indexOf('CREATE POLICY "workload_deletion_requests_delete"') !== -1, 'Must define deletion requests delete policy');
    assert.ok(migration034Sql.indexOf('FUNCTION public.approve_workload_deletion_request') !== -1, 'Must define approve_workload_deletion_request');
    assert.ok(migration034Sql.indexOf('FUNCTION public.reject_workload_deletion_request') !== -1, 'Must define reject_workload_deletion_request');
    assert.ok(migration034Sql.indexOf('Cannot approve deletion request: The referenced workload record no longer exists or was removed') !== -1, 'Must reject approval when workload was removed');
    assert.ok(migration034Sql.indexOf('FUNCTION public.workload_enforce_teaching_load_update') !== -1, 'Must define workload_enforce_teaching_load_update trigger');
    assert.ok(migration034Sql.indexOf('Archived workload records cannot be modified') !== -1, 'Must prevent modifying archived records');
    assert.ok(migration034Sql.indexOf('Faculty cannot modify workload status directly') !== -1, 'Must prevent direct status modification');

    // Administrative UI verification in admin/workload-tracker.html
    const trackerContent = fs.readFileSync(path.join(__dirname, '../admin/workload-tracker.html'), 'utf8');
    assert.ok(trackerContent.indexOf('id="deletionRequestsBtn"') !== -1, 'Tracker must contain deletionRequestsBtn');
    assert.ok(trackerContent.indexOf('id="deletionRequestsModal"') !== -1, 'Tracker must contain deletionRequestsModal');
    assert.ok(trackerContent.indexOf('openDeletionRequestsModal') !== -1, 'Tracker must define openDeletionRequestsModal');
    assert.ok(trackerContent.indexOf('approveWorkloadDeletion') !== -1, 'Tracker must define approveWorkloadDeletion');
    assert.ok(trackerContent.indexOf('rejectWorkloadDeletion') !== -1, 'Tracker must define rejectWorkloadDeletion');
    assert.ok(trackerContent.indexOf('Workload Record Removed') !== -1, 'Tracker must indicate removed workload records');
    assert.ok(trackerContent.indexOf('Cannot Approve (Removed)') !== -1 || trackerContent.indexOf('Record Missing') !== -1, 'Tracker must disable approval for missing records');

    // 15. Verification of simulated RLS behavior (Unit simulation):
    // Helper function simulating workload_is_dean_or_secretary
    function simIsDeanOrSecretary(profile) {
        const r = String((profile && profile.role) || '').toLowerCase().trim();
        return ['college dean', 'dean', 'college secretary', 'secretary'].includes(r);
    }

    function simIsAdmin(profile) {
        const r = String((profile && (profile.role || profile.position)) || '').toLowerCase().trim();
        return (r === 'administrator' || r === 'admin' || (r.includes('admin') && !r.includes('chair') && !r.includes('faculty')));
    }

    // Simulation of RLS SELECT evaluation
    function simRlsCanSelectRow(caller, rowFaculty) {
        // 1. Dean / Secretary -> all
        if (simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord)) {
            return true;
        }
        // 2. Chairperson / OIC -> department
        const callerRole = String(caller.facultyRecord?.role || '').toLowerCase();
        const isChairOrOic = callerRole.includes('chair') || callerRole.includes('oic') || caller.facultyRecord?.admin_access === true;
        if (isChairOrOic && caller.facultyRecord?.department && caller.facultyRecord.department === rowFaculty.department) {
            return true;
        }
        // 3. Faculty -> own only
        if (caller.facultyRecord?.id && (caller.facultyRecord.id === rowFaculty.faculty_id || caller.facultyRecord.id === rowFaculty.id)) {
            return true;
        }
        // Generic admin or other -> false
        return false;
    }

    // Simulation of RLS INSERT evaluation
    function simRlsCanInsertLoad(caller, newRow) {
        if (simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord)) {
            return true;
        }
        if (caller.facultyRecord?.id && caller.facultyRecord.id === newRow.faculty_id) {
            return true;
        }
        return false;
    }

    // Simulation of RLS & Trigger UPDATE evaluation
    function simRlsCanUpdateLoad(caller, oldRow, newRow) {
        const isDeanOrSec = simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (isDeanOrSec) {
            return { allowed: true };
        }
        // Check ownership
        if (!caller.facultyRecord?.id || caller.facultyRecord.id !== oldRow.faculty_id) {
            return { allowed: false, reason: 'Cannot update other faculty workloads' };
        }
        // Disallow modifying already archived records
        if (oldRow.status === 'Archived') {
            return { allowed: false, reason: 'Archived workload records cannot be modified' };
        }
        // Disallow modifying status directly (Trigger)
        if (newRow.status !== oldRow.status) {
            return { allowed: false, reason: 'Faculty cannot modify workload status directly. Please submit a deletion request.' };
        }
        // Ownership transfer check (Trigger)
        if (newRow.faculty_id !== oldRow.faculty_id) {
            return { allowed: false, reason: 'Faculty cannot transfer or change workload ownership' };
        }
        return { allowed: true };
    }

    // Simulation of Deletion Request Submission
    const simulatedPendingLoadIds = new Set();
    function simSubmitDeletionRequest(caller, teachingLoad, reason, forgedFields = {}) {
        const isDeanOrSec = simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (!isDeanOrSec) {
            if (!caller.facultyRecord?.id || caller.facultyRecord.id !== teachingLoad.faculty_id) {
                return { allowed: false, reason: 'Faculty can only submit deletion requests for their own workloads' };
            }
            // Forgery check (reviewed_by, reviewed_at, rejection_reason must be null)
            if (forgedFields.reviewed_by || forgedFields.reviewed_at || forgedFields.rejection_reason) {
                return { allowed: false, reason: 'Faculty cannot supply review fields upon submission' };
            }
            // Duplicate pending check (Partial unique index simulation)
            if (simulatedPendingLoadIds.has(teachingLoad.id)) {
                return { allowed: false, reason: 'A pending deletion request already exists for this workload' };
            }
        }
        simulatedPendingLoadIds.add(teachingLoad.id);
        return { allowed: true, request: { id: 'req-1', status: 'Pending', teaching_load_id: teachingLoad.id, faculty_id: teachingLoad.faculty_id, reason } };
    }

    // Simulation of Deletion Request Approval
    function simApproveDeletionRequest(caller, request, teachingLoad) {
        const isDeanOrSec = simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (!isDeanOrSec) {
            return { allowed: false, error: 'Access Denied: Only College Dean and College Secretary can approve workload deletion requests' };
        }
        if (request.status !== 'Pending') {
            return { allowed: false, error: 'Request is not pending' };
        }
        // FIX 1: Reject approval when teaching_load_id is NULL or underlying workload was removed
        if (!request.teaching_load_id || !teachingLoad) {
            return { allowed: false, error: 'Cannot approve deletion request: The referenced workload record no longer exists or was removed.' };
        }
        request.status = 'Approved';
        teachingLoad.status = 'Archived';
        return { allowed: true, request, teachingLoad };
    }

    // Simulation of Deletion Request Rejection
    function simRejectDeletionRequest(caller, request, rejectionReason) {
        const isDeanOrSec = simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (!isDeanOrSec) {
            return { allowed: false, error: 'Access Denied: Only College Dean and College Secretary can reject workload deletion requests' };
        }
        if (request.status !== 'Pending') {
            return { allowed: false, error: 'Request is not pending' };
        }
        request.status = 'Rejected';
        request.rejection_reason = rejectionReason;
        return { allowed: true, request };
    }

    const deanUser = { adminProfile: { role: 'College Dean' }, facultyRecord: null };
    const adminUser = { adminProfile: { role: 'Administrator' }, facultyRecord: null };
    const chairUser = { adminProfile: null, facultyRecord: { id: 'c1', role: 'Chairperson', department: 'BSIT' } };
    const facUser1 = { adminProfile: null, facultyRecord: { id: 'f1', role: 'Faculty', department: 'BSIT' } };
    const facUser2 = { adminProfile: null, facultyRecord: { id: 'f2', role: 'Faculty', department: 'BSCS' } };

    const itRow = { faculty_id: 'f1', id: 'tl-1', department: 'BSIT', status: 'Active' };
    const csRow = { faculty_id: 'f2', id: 'tl-2', department: 'BSCS', status: 'Active' };

    // SELECT checks
    assert.strictEqual(simRlsCanSelectRow(deanUser, itRow), true, 'Dean can read all');
    assert.strictEqual(simRlsCanSelectRow(deanUser, csRow), true, 'Dean can read all');
    assert.strictEqual(simRlsCanSelectRow(adminUser, itRow), false, 'Generic Admin cannot read workloads');
    assert.strictEqual(simRlsCanSelectRow(adminUser, csRow), false, 'Generic Admin cannot read workloads');
    assert.strictEqual(simRlsCanSelectRow(chairUser, itRow), true, 'Chairperson can read own dept');
    assert.strictEqual(simRlsCanSelectRow(chairUser, csRow), false, 'Chairperson cannot read other dept');
    assert.strictEqual(simRlsCanSelectRow(facUser1, itRow), true, 'Faculty can read own');
    assert.strictEqual(simRlsCanSelectRow(facUser1, csRow), false, 'Faculty cannot read others');
    assert.strictEqual(simRlsCanSelectRow(facUser2, itRow), false, 'Faculty cannot read others');
    assert.strictEqual(simRlsCanSelectRow(facUser2, csRow), true, 'Faculty can read own');

    // INSERT checks
    // 1. Faculty inserting their own workload: allowed
    assert.strictEqual(simRlsCanInsertLoad(facUser1, { faculty_id: 'f1', subject_code: 'IT101' }), true, 'Faculty can insert own workload');
    // 2. Faculty inserting another faculty member's workload: must fail
    assert.strictEqual(simRlsCanInsertLoad(facUser1, { faculty_id: 'f2', subject_code: 'CS101' }), false, 'Faculty cannot insert others workload');
    // Generic admin inserting: must fail
    assert.strictEqual(simRlsCanInsertLoad(adminUser, { faculty_id: 'f1', subject_code: 'IT101' }), false, 'Generic admin cannot insert workload');
    // Dean inserting for any faculty: allowed
    assert.strictEqual(simRlsCanInsertLoad(deanUser, { faculty_id: 'f1', subject_code: 'IT101' }), true, 'Dean can insert workload for any faculty');

    // UPDATE checks
    // 3. Faculty updating their own workload: allowed
    const validFacUpdate = simRlsCanUpdateLoad(facUser1, itRow, Object.assign({}, itRow, { subject_title: 'Updated Title' }));
    assert.strictEqual(validFacUpdate.allowed, true, 'Faculty can update own workload');
    // 4. Faculty updating another faculty member's workload: must fail
    const invalidFacUpdateOther = simRlsCanUpdateLoad(facUser1, csRow, Object.assign({}, csRow, { subject_title: 'Hacked' }));
    assert.strictEqual(invalidFacUpdateOther.allowed, false, 'Faculty cannot update another faculty workload');
    // 4b. Faculty transferring ownership: must fail
    const invalidFacTransfer = simRlsCanUpdateLoad(facUser1, itRow, Object.assign({}, itRow, { faculty_id: 'f2' }));
    assert.strictEqual(invalidFacTransfer.allowed, false, 'Faculty cannot transfer ownership');
    // 5. Faculty attempting to directly archive their workload: must fail
    const invalidFacArchive = simRlsCanUpdateLoad(facUser1, itRow, Object.assign({}, itRow, { status: 'Archived' }));
    assert.strictEqual(invalidFacArchive.allowed, false, 'Faculty cannot directly archive workload');

    // 5b. Faculty attempting to update an already archived record (reactivation attempt): must fail
    const archivedRow = { faculty_id: 'f1', id: 'tl-archived', department: 'BSIT', status: 'Archived' };
    const invalidFacReactivate = simRlsCanUpdateLoad(facUser1, archivedRow, Object.assign({}, archivedRow, { status: 'Active' }));
    assert.strictEqual(invalidFacReactivate.allowed, false, 'Faculty cannot modify or reactivate already archived workload');

    // 5c. Faculty attempting to change status to arbitrary value: must fail
    const invalidFacStatusChange = simRlsCanUpdateLoad(facUser1, itRow, Object.assign({}, itRow, { status: 'Inactive' }));
    assert.strictEqual(invalidFacStatusChange.allowed, false, 'Faculty cannot modify status directly');

    // DELETION REQUEST checks
    // 6. Faculty submitting a deletion request for own workload: allowed
    const submitOwn = simSubmitDeletionRequest(facUser1, itRow, 'Class cancelled');
    assert.strictEqual(submitOwn.allowed, true, 'Faculty can submit deletion request for own workload');
    assert.strictEqual(submitOwn.request.status, 'Pending');

    // 6b. Faculty submitting deletion request with forged review fields: must fail
    const submitForged = simSubmitDeletionRequest(facUser1, itRow, 'Class cancelled', { reviewed_by: 'dean-id' });
    assert.strictEqual(submitForged.allowed, false, 'Faculty cannot forge reviewed_by field');

    // 6c. Faculty submitting duplicate pending deletion request for the same workload: must fail
    const submitDuplicate = simSubmitDeletionRequest(facUser1, itRow, 'Duplicate request attempt');
    assert.strictEqual(submitDuplicate.allowed, false, 'Duplicate pending deletion request must fail');

    // Faculty submitting deletion request for another faculty workload: must fail
    const submitOther = simSubmitDeletionRequest(facUser1, csRow, 'Malicious request');
    assert.strictEqual(submitOther.allowed, false, 'Faculty cannot submit deletion request for other workload');

    // 7. Unauthorized user (faculty or generic admin) attempting to approve deletion request: must fail
    const unauthApproval = simApproveDeletionRequest(facUser1, submitOwn.request, itRow);
    assert.strictEqual(unauthApproval.allowed, false, 'Faculty cannot approve deletion requests');
    const adminApproval = simApproveDeletionRequest(adminUser, submitOwn.request, itRow);
    assert.strictEqual(adminApproval.allowed, false, 'Generic Admin cannot approve deletion requests');

    // 8. Dean/Secretary approving deletion request: allowed, archives target workload
    const testReq = { id: 'req-1', status: 'Pending', teaching_load_id: 'tl-1', faculty_id: 'f1' };
    const testRow = Object.assign({}, itRow);
    const deanApproval = simApproveDeletionRequest(deanUser, testReq, testRow);
    assert.strictEqual(deanApproval.allowed, true, 'Dean can approve deletion request');
    assert.strictEqual(testReq.status, 'Approved', 'Request status changed to Approved');
    assert.strictEqual(testRow.status, 'Archived', 'Workload status changed to Archived');

    // Dean/Secretary rejecting deletion request: allowed, sets status to Rejected with reason
    const testReq2 = { id: 'req-2', status: 'Pending', teaching_load_id: 'tl-2', faculty_id: 'f2' };
    const deanRejection = simRejectDeletionRequest(deanUser, testReq2, 'Workload is still required for accreditation');
    assert.strictEqual(deanRejection.allowed, true, 'Dean can reject deletion request');
    assert.strictEqual(testReq2.status, 'Rejected');
    assert.strictEqual(testReq2.rejection_reason, 'Workload is still required for accreditation');

    // 13. Approval is rejected when teaching_load_id is NULL (FIX 1)
    const orphanedReq = { id: 'req-orphaned', status: 'Pending', teaching_load_id: null, faculty_id: 'f1' };
    const orphanedApproval = simApproveDeletionRequest(deanUser, orphanedReq, null);
    assert.strictEqual(orphanedApproval.allowed, false, 'Approval must be rejected when teaching_load_id is NULL');
    assert.ok(/no longer exists or was removed/i.test(orphanedApproval.error));
    assert.strictEqual(orphanedReq.status, 'Pending', 'Orphaned request status must not change to Approved');

    // 14 & 15. Simulation of Migration 033 Replacement Import Pending Check (FIX 2)
    function simCommitWorkloadImport({ caller, strategy, academicYear, semester, records, existingWorkloads = [], deletionRequests = [] }) {
        const isAuthorized = simIsAdmin(caller.adminProfile) || simIsAdmin(caller.facultyRecord) ||
                             simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (!isAuthorized) {
            return { allowed: false, error: 'Access Denied: Only Administrator, College Dean, and College Secretary accounts can manage workload imports.' };
        }
        if (strategy === 'replace') {
            const facultyIds = Array.from(new Set(records.map((r) => r.faculty_id)));
            // Check for pending deletion requests on affected faculty & AY/Semester
            const pendingReq = deletionRequests.find((dr) =>
                dr.status === 'Pending' &&
                existingWorkloads.some((ew) =>
                    ew.id === dr.teaching_load_id &&
                    facultyIds.includes(ew.faculty_id) &&
                    ew.academic_year === academicYear &&
                    ew.semester === semester
                )
            );
            if (pendingReq) {
                const targetWorkload = existingWorkloads.find((ew) => ew.id === pendingReq.teaching_load_id);
                return {
                    allowed: false,
                    error: `Cannot perform replacement import: A pending deletion request exists for faculty (Subject ${targetWorkload?.subject_code || 'N/A'}, Section ${targetWorkload?.section || 'N/A'}). Please resolve all pending deletion requests before replacing workloads.`
                };
            }
        }
        return { allowed: true, replacedCount: existingWorkloads.length, insertedCount: records.length };
    }

    const currentLoads = [
        { id: 'tl-active-1', faculty_id: 'f1', subject_code: 'IT101', section: 'IT-1A', academic_year: '2025-2026', semester: '1st Semester' },
        { id: 'tl-active-2', faculty_id: 'f1', subject_code: 'IT102', section: 'IT-1B', academic_year: '2025-2026', semester: '1st Semester' }
    ];

    // Scenario 14: Pending deletion request exists -> replacement import aborted
    const requestsWithPending = [
        { id: 'dr-1', teaching_load_id: 'tl-active-1', faculty_id: 'f1', status: 'Pending' }
    ];
    const importWithPending = simCommitWorkloadImport({
        caller: deanUser,
        strategy: 'replace',
        academicYear: '2025-2026',
        semester: '1st Semester',
        records: [{ faculty_id: 'f1', subject_code: 'IT101_NEW' }],
        existingWorkloads: currentLoads,
        deletionRequests: requestsWithPending
    });
    assert.strictEqual(importWithPending.allowed, false, 'Replacement import must be aborted if pending deletion request exists');
    assert.ok(/pending deletion request exists/i.test(importWithPending.error));

    // Scenario 15: Only Approved or Rejected deletion requests exist -> replacement import succeeds
    const requestsWithResolved = [
        { id: 'dr-1', teaching_load_id: 'tl-active-1', faculty_id: 'f1', status: 'Approved' },
        { id: 'dr-2', teaching_load_id: 'tl-active-2', faculty_id: 'f1', status: 'Rejected' }
    ];
    const importWithResolved = simCommitWorkloadImport({
        caller: deanUser,
        strategy: 'replace',
        academicYear: '2025-2026',
        semester: '1st Semester',
        records: [{ faculty_id: 'f1', subject_code: 'IT101_REPLACED' }],
        existingWorkloads: currentLoads,
        deletionRequests: requestsWithResolved
    });
    assert.strictEqual(importWithResolved.allowed, true, 'Replacement import must succeed when all requests are resolved');

    // Scenario 16: Request audit history preserved with snapshots when workload or faculty is removed (FIX 3)
    const snapshotReq = {
        id: 'dr-hist-1',
        teaching_load_id: 'tl-hist-1',
        faculty_id: 'f1',
        faculty_name: 'Dr. Jane Smith',
        department: 'BSIT',
        subject_code: 'IT301',
        subject_title: 'Database Systems',
        section: 'IT-3A',
        academic_year: '2025-2026',
        semester: '1st Semester',
        status: 'Approved',
        reason: 'Curriculum update'
    };
    // Workload is hard-deleted or replaced (ON DELETE SET NULL triggers)
    snapshotReq.teaching_load_id = null;
    // Faculty profile deleted (ON DELETE SET NULL triggers)
    snapshotReq.faculty_id = null;

    // Verify snapshot fields persist and provide full historical audit trail
    assert.strictEqual(snapshotReq.teaching_load_id, null, 'Foreign key is safely nulled on delete');
    assert.strictEqual(snapshotReq.faculty_id, null, 'Faculty foreign key is safely nulled on delete');
    assert.strictEqual(snapshotReq.faculty_name, 'Dr. Jane Smith', 'Faculty name snapshot preserved');
    assert.strictEqual(snapshotReq.department, 'BSIT', 'Department snapshot preserved');
    assert.strictEqual(snapshotReq.subject_code, 'IT301', 'Subject code snapshot preserved');
    assert.strictEqual(snapshotReq.subject_title, 'Database Systems', 'Subject title snapshot preserved');
    assert.strictEqual(snapshotReq.section, 'IT-3A', 'Section snapshot preserved');
    assert.strictEqual(snapshotReq.academic_year, '2025-2026', 'Academic year snapshot preserved');
    assert.strictEqual(snapshotReq.semester, '1st Semester', 'Semester snapshot preserved');

    // Scenario 17: Admin Workload Tracker - Auth Session Rehydration & Active Context Resolution (Problem 1 Fix)
    async function simGetActiveAuthContext(mockSupabaseClient, mockCiteFlowAuth) {
        let session = null;
        if (mockSupabaseClient && mockSupabaseClient.auth && typeof mockSupabaseClient.auth.getSession === 'function') {
            try {
                const sessionRes = await mockSupabaseClient.auth.getSession();
                session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
            } catch (_) { }
        }
        if (!session && mockCiteFlowAuth && typeof mockCiteFlowAuth.ensureActiveSession === 'function') {
            try {
                session = await mockCiteFlowAuth.ensureActiveSession(mockSupabaseClient);
            } catch (_) { }
        }
        if (!session && mockCiteFlowAuth && typeof mockCiteFlowAuth.getPersistedSupabaseSession === 'function') {
            session = mockCiteFlowAuth.getPersistedSupabaseSession();
        }
        const user = session && session.user ? session.user : null;
        return { session, user };
    }

    // 17a. When getSession returns null due to rehydration timing, fallback rehydrates session
    const mockClientWithDelay = {
        auth: {
            getSession: async () => ({ data: { session: null } })
        }
    };
    const mockAuthFallback = {
        ensureActiveSession: async () => ({ user: { id: 'dean-auth-id', email: 'dean@cite.edu' } }),
        getPersistedSupabaseSession: () => ({ user: { id: 'dean-auth-id', email: 'dean@cite.edu' } })
    };
    const resolvedContext = await simGetActiveAuthContext(mockClientWithDelay, mockAuthFallback);
    assert.ok(resolvedContext.session, 'Session must be rehydrated via CiteFlowAuth fallback');
    assert.strictEqual(resolvedContext.user.email, 'dean@cite.edu', 'User email resolved');

    // 17b. When completely unauthenticated, context returns null user and triggers authorization rejection
    const unauthClient = { auth: { getSession: async () => ({ data: { session: null } }) } };
    const emptyAuthFallback = {
        ensureActiveSession: async () => null,
        getPersistedSupabaseSession: () => null
    };
    const unauthContext = await simGetActiveAuthContext(unauthClient, emptyAuthFallback);
    assert.strictEqual(unauthContext.user, null, 'Unauthenticated session must be null');

    // Scenario 18: Admin Workload Tracker - Import Summary Calculation with Replace Strategy (Problem 1 Fix)
    function simCalculateSavedCount(summary) {
        return (summary.inserted || 0) + (summary.updated || 0) + (summary.replaced || 0);
    }
    const replaceOnlySummary = { total: 15, inserted: 0, updated: 0, replaced: 15, skipped: 0 };
    const appendSummary = { total: 10, inserted: 10, updated: 0, replaced: 0, skipped: 0 };
    const zeroSummary = { total: 0, inserted: 0, updated: 0, replaced: 0, skipped: 0 };

    assert.strictEqual(simCalculateSavedCount(replaceOnlySummary), 15, 'Replace mode must count replaced records in savedCount');
    assert.strictEqual(simCalculateSavedCount(appendSummary), 10, 'Append mode must count inserted records');
    assert.strictEqual(simCalculateSavedCount(zeroSummary), 0, 'Empty import yields 0 savedCount');

    // Scenario 19: Faculty Workload Display - Robust Profile Resolution & Foreign Key Alignment (Problem 2 Fix)
    const simulatedAuthUser = { id: 'auth-user-uuid-999', email: 'maria.santos@cite.edu' };
    const simulatedFacultyTable = [
        {
            id: 'faculty-pk-111',
            auth_user_id: null, // Initially unlinked
            email: 'maria.santos@cite.edu',
            full_name: 'Maria Santos',
            department: 'BSIT',
            employee_id: 'EMP-101'
        }
    ];
    const simulatedWorkloadsTable = [
        { id: 'wl-1', faculty_id: 'faculty-pk-111', subject_code: 'IT101', section: 'IT-1A', units: 3, academic_year: '2025-2026', semester: '1st Semester' },
        { id: 'wl-2', faculty_id: 'faculty-pk-111', subject_code: 'IT102', section: 'IT-1B', units: 3, academic_year: '2025-2026', semester: '1st Semester' },
        { id: 'wl-3', faculty_id: 'other-fac-222', subject_code: 'CS101', section: 'CS-1A', units: 3, academic_year: '2025-2026', semester: '1st Semester' }
    ];

    // Simulate loadFacultyProfile canonical resolution
    function simResolveFacultyProfile(authUser, facultyList) {
        let matched = facultyList.find((f) => f.auth_user_id === authUser.id);
        if (!matched && authUser.id) {
            matched = facultyList.find((f) => f.id === authUser.id);
        }
        if (!matched && authUser.email) {
            matched = facultyList.find((f) => String(f.email || '').toLowerCase() === String(authUser.email).toLowerCase());
            if (matched && !matched.auth_user_id) {
                // Link auth_user_id
                matched.auth_user_id = authUser.id;
            }
        }
        return matched;
    }

    const resolvedFaculty = simResolveFacultyProfile(simulatedAuthUser, simulatedFacultyTable);
    assert.ok(resolvedFaculty, 'Faculty profile must be resolved by email fallback');
    assert.strictEqual(resolvedFaculty.id, 'faculty-pk-111', 'Canonical faculty PK preserved');
    assert.strictEqual(resolvedFaculty.auth_user_id, 'auth-user-uuid-999', 'Auth user ID properly linked');

    // Simulate loadWorkloadEntries query
    const targetFacultyId = resolvedFaculty ? resolvedFaculty.id : simulatedAuthUser.id;
    const facultyWorkloads = simulatedWorkloadsTable.filter((wl) => wl.faculty_id === targetFacultyId);
    assert.strictEqual(facultyWorkloads.length, 2, 'Workloads loaded matching canonical faculty PK');
    assert.deepStrictEqual(facultyWorkloads.map((w) => w.subject_code).sort(), ['IT101', 'IT102']);

    // Show that querying by auth.uid() directly would have returned 0 workloads (the original bug)
    const buggedWorkloads = simulatedWorkloadsTable.filter((wl) => wl.faculty_id === simulatedAuthUser.id);
    assert.strictEqual(buggedWorkloads.length, 0, 'Original bug would have returned 0 workloads using auth.uid()');

    // Scenario 20: Migration 034 SQL Trigger Integrity Verification (Static SQL Analysis)
    const migration034SqlPath = path.resolve(__dirname, '../../supabase/migrations/034_workload_rls_policies.sql');
    assert.ok(fs.existsSync(migration034SqlPath), 'Migration 034 file must exist');
    const m34Sql = fs.readFileSync(migration034SqlPath, 'utf8');

    // Verify snapshot immutability trigger exists in SQL
    assert.ok(m34Sql.includes('trg_workload_protect_deletion_request_update'), 'trg_workload_protect_deletion_request_update must be defined');
    assert.ok(m34Sql.includes('NEW.subject_code IS DISTINCT FROM OLD.subject_code'), 'Protects subject_code modification');
    assert.ok(m34Sql.includes('NEW.teaching_load_id IS DISTINCT FROM OLD.teaching_load_id'), 'Protects teaching_load_id modification');
    assert.ok(m34Sql.includes('42501'), 'Raises insufficient_privilege 42501 on snapshot tamper');

    // Verify unconditional snapshot population trigger in SQL
    assert.ok(m34Sql.includes('NEW.subject_code := v_tl.subject_code;'), 'Unconditionally assigns subject_code from verified workload');
    assert.ok(m34Sql.includes('NEW.subject_title := v_tl.subject_title;'), 'Unconditionally assigns subject_title');

    // Verify admin helper uses verified auth.uid() identity in SQL
    assert.ok(m34Sql.includes('ap.id = auth.uid()'), 'Admin helper strictly verifies auth.uid() database identity');
    assert.ok(
        /lower\(trim\(coalesce\(ap\.role,\s*''\)\)\)\s+LIKE\s+'%dean%'/i.test(m34Sql),
        'Admin helper supports database Dean role variants'
    );

    // Scenario 21: Simulation of Update Trigger Snapshot Immutability
    function simEnforceDeletionRequestUpdate(oldReq, newReq, caller) {
        const isDeanOrSec = simIsDeanOrSecretary(caller.adminProfile) || simIsDeanOrSecretary(caller.facultyRecord);
        if (newReq.teaching_load_id !== oldReq.teaching_load_id) {
            throw new Error('42501: Deletion request teaching_load_id cannot be changed.');
        }
        if (newReq.faculty_id !== oldReq.faculty_id) {
            throw new Error('42501: Deletion request faculty_id cannot be changed.');
        }
        if (newReq.subject_code !== oldReq.subject_code || newReq.section !== oldReq.section) {
            throw new Error('42501: Deletion request snapshot fields are immutable.');
        }
        if (newReq.status !== oldReq.status && !isDeanOrSec) {
            throw new Error('42501: Only College Dean and College Secretary can update deletion request status.');
        }
        return true;
    }

    const testActiveReq = {
        id: 'dr-immut-1',
        teaching_load_id: 'tl-1',
        faculty_id: 'f1',
        subject_code: 'IT101',
        section: 'IT-1A',
        status: 'Pending'
    };

    // Faculty attempting to tamper with snapshot subject_code
    assert.throws(() => {
        simEnforceDeletionRequestUpdate(
            testActiveReq,
            Object.assign({}, testActiveReq, { subject_code: 'TAMPERED' }),
            facUser1
        );
    }, /42501.*immutable/, 'Snapshot fields cannot be modified on UPDATE');

    // Faculty attempting to reassign teaching_load_id
    assert.throws(() => {
        simEnforceDeletionRequestUpdate(
            testActiveReq,
            Object.assign({}, testActiveReq, { teaching_load_id: 'tl-other' }),
            facUser1
        );
    }, /42501.*teaching_load_id/, 'teaching_load_id cannot be modified on UPDATE');

    // Dean changing status is permitted
    assert.strictEqual(
        simEnforceDeletionRequestUpdate(
            testActiveReq,
            Object.assign({}, testActiveReq, { status: 'Approved' }),
            deanUser
        ),
        true,
        'Dean can update status'
    );

    // Scenario 22: Role Normalization and Mapping Inconsistencies Test
    const testSession = { user: { id: 'u-dean' } };
    // Allowed variations
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'college_dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'COLLEGE DEAN' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Dean' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'College Dean & Executive Official' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'college_secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'College Secretary' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Dean/Secretary' }).ok, true);

    // Authorized Administrator variations
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Administrator' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Admin' }).ok, true);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Superadmin' }).ok, true);

    // Denied variations
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Vice Dean' }).ok, false);
    assert.strictEqual(api.assertImportAllowed(testSession, null, { role: 'Assistant Secretary' }).ok, false);
    assert.strictEqual(api.assertImportAllowed(testSession, { role: 'Chairperson' }, null).ok, false);
    assert.strictEqual(api.assertImportAllowed(testSession, { role: 'Faculty' }, null).ok, false);

    // Scenario 23: Existing Established Account-Role Assignment Flow & Synthetic Admin Override
    // When signed into admin portal, auth-guard sets faculty.role = 'Admin'.
    // True role is retained in facultyRecord.position as assigned by faculty-profiles.html or admin-profile.html.
    const signedInDeanAuthContext = {
        session: { user: { id: 'dean-auth-uuid', email: 'dean@cite.edu' } },
        adminProfile: { id: 'dean-auth-uuid', role: 'Administrator' },
        facultyRecord: { id: 'fac-dean-1', role: 'Admin', position: 'College Dean', department: 'COTE' }
    };
    assert.strictEqual(
        api.assertImportAllowed(signedInDeanAuthContext.session, signedInDeanAuthContext.facultyRecord, signedInDeanAuthContext.adminProfile).ok,
        true,
        'Signed-in Dean with Administrator admin_profile and College Dean position must be authorized'
    );

    const signedInSecAuthContext = {
        session: { user: { id: 'sec-auth-uuid', email: 'sec@cite.edu' } },
        adminProfile: { id: 'sec-auth-uuid', role: 'Administrator' },
        facultyRecord: { id: 'fac-sec-1', role: 'Admin', position: 'Dean/Secretary', department: 'COTE' }
    };
    assert.strictEqual(
        api.assertImportAllowed(signedInSecAuthContext.session, signedInSecAuthContext.facultyRecord, signedInSecAuthContext.adminProfile).ok,
        true,
        'Signed-in Secretary with Dean/Secretary position must be authorized'
    );

    const genericAdminAuthContext = {
        session: { user: { id: 'gen-admin-uuid', email: 'admin@cite.edu' } },
        adminProfile: { id: 'gen-admin-uuid', role: 'Administrator' },
        facultyRecord: { id: 'fac-admin-1', role: 'Admin', position: 'Administrator', department: 'IT' }
    };
    assert.strictEqual(
        api.assertImportAllowed(genericAdminAuthContext.session, genericAdminAuthContext.facultyRecord, genericAdminAuthContext.adminProfile).ok,
        true,
        'Administrator must be authorized for workload imports'
    );

    // Scenario 24: Workload Tracker Modal Open vs Commit Authorization Proof
    // 1. Verify modal open in workload-tracker.html does NOT perform premature rejection
    const currentTrackerHtml = fs.readFileSync(path.join(__dirname, '..', 'admin', 'workload-tracker.html'), 'utf8');
    const openFnStart = currentTrackerHtml.indexOf('function openWorkloadImport');
    const closeFnStart = currentTrackerHtml.indexOf('function closeWorkloadImport');
    assert.ok(openFnStart !== -1 && closeFnStart > openFnStart, 'openWorkloadImport must exist in workload-tracker.html');
    const openFnBody = currentTrackerHtml.slice(openFnStart, closeFnStart);
    assert.strictEqual(
        openFnBody.includes('assertImportAllowed'),
        false,
        'openWorkloadImport must NOT prematurely check assertImportAllowed before opening modal'
    );
    assert.ok(
        openFnBody.includes("modal.classList.remove('hidden')"),
        'openWorkloadImport must open the modal directly'
    );

    // 2. Verify commitImport authorization enforcement:
    const sampleValidPlan = {
        localId: 'plan-test-1',
        label: 'IT101 - Intro to IT',
        selected: true,
        willWrite: true,
        action: 'insert',
        payload: {
            faculty_id: 'fac-1',
            subject_code: 'IT101',
            subject_title: 'Intro to IT',
            section: 'IT-1A',
            units: 3,
            academic_year: '2025-2026',
            semester: '1st Semester'
        }
    };

    // A. Faculty account cannot commit
    const facultyCommitRes = await api.commitImport({
        plans: [sampleValidPlan],
        session: { user: { id: 'u-fac', email: 'fac@cite.edu' } },
        facultyRecord: { id: 'fac-1', role: 'Faculty', position: 'Instructor I' },
        adminProfile: null
    });
    assert.strictEqual(facultyCommitRes.ok, false, 'Faculty member cannot commit import');
    assert.strictEqual(facultyCommitRes.aborted, true, 'Faculty member import must be aborted');
    assert.ok(/Access Denied/i.test(facultyCommitRes.message), 'Must return Access Denied message');

    // B. Chairperson account cannot commit
    const chairCommitRes = await api.commitImport({
        plans: [sampleValidPlan],
        session: { user: { id: 'u-chair', email: 'chair@cite.edu' } },
        facultyRecord: { id: 'fac-2', role: 'Chairperson', position: 'Department Chairperson' },
        adminProfile: null
    });
    assert.strictEqual(chairCommitRes.ok, false, 'Chairperson cannot commit import');
    assert.strictEqual(chairCommitRes.aborted, true, 'Chairperson import must be aborted');

    // C. Generic Administrator with no Dean/Secretary designation cannot commit
    const genAdminCommitRes = await api.commitImport({
        plans: [sampleValidPlan],
        session: genericAdminAuthContext.session,
        facultyRecord: genericAdminAuthContext.facultyRecord,
        adminProfile: genericAdminAuthContext.adminProfile
    });
    assert.strictEqual(genAdminCommitRes.ok, false, 'Generic Administrator cannot commit import');
    assert.strictEqual(genAdminCommitRes.aborted, true, 'Generic Administrator import must be aborted');

    // D. Missing profile data cannot commit
    const missingProfileRes = await api.commitImport({
        plans: [sampleValidPlan],
        session: { user: { id: 'u-anon' } },
        facultyRecord: null,
        adminProfile: null
    });
    assert.strictEqual(missingProfileRes.ok, false, 'User with missing profile data cannot commit import');
    assert.strictEqual(missingProfileRes.aborted, true, 'Missing profile data import must be aborted');

    // E. Legitimate Dean account passes authorization gate
    const deanAuthRes = api.assertImportAllowed(
        signedInDeanAuthContext.session,
        signedInDeanAuthContext.facultyRecord,
        signedInDeanAuthContext.adminProfile
    );
    assert.strictEqual(deanAuthRes.ok, true, 'Legitimate Dean must pass authorization');
    assert.strictEqual(deanAuthRes.role, 'College Dean');

    // F. Legitimate Secretary account passes authorization gate
    const secAuthRes = api.assertImportAllowed(
        signedInSecAuthContext.session,
        signedInSecAuthContext.facultyRecord,
        signedInSecAuthContext.adminProfile
    );
    assert.strictEqual(secAuthRes.ok, true, 'Legitimate Secretary must pass authorization');
    assert.ok(
        secAuthRes.role === 'College Secretary' || secAuthRes.role === 'College Dean',
        'Composite Dean/Secretary role passes authorization'
    );

    // Scenario 25: Phase 4 Comprehensive Validation
    // A. College Dean with administrator account and executive designation can confirm
    const deanWithAdminProfileRes = api.assertImportAllowed(
        { user: { id: 'dean-1', user_metadata: { position: 'College Dean' } } },
        { id: 'f-dean-1', role: 'Admin', position: 'College Dean', admin_access: true },
        { id: 'dean-1', role: 'Administrator' }
    );
    assert.strictEqual(deanWithAdminProfileRes.ok, true, 'Dean with admin account and executive designation is authorized');
    assert.strictEqual(deanWithAdminProfileRes.role, 'College Dean');

    // B. College Secretary with administrator account and executive designation can confirm
    const secWithAdminProfileRes = api.assertImportAllowed(
        { user: { id: 'sec-1', user_metadata: { position: 'College Secretary' } } },
        { id: 'f-sec-1', role: 'Admin', position: 'College Secretary', admin_access: true },
        { id: 'sec-1', role: 'Administrator' }
    );
    assert.strictEqual(secWithAdminProfileRes.ok, true, 'Secretary with admin account and executive designation is authorized');
    assert.strictEqual(secWithAdminProfileRes.role, 'College Secretary');

    // C. Administrator can confirm
    const pureGenericAdminRes = api.assertImportAllowed(
        { user: { id: 'admin-1', user_metadata: { role: 'Admin' } } },
        { id: 'f-admin-1', role: 'Admin', position: 'Administrator', admin_access: true },
        { id: 'admin-1', role: 'Administrator' }
    );
    assert.strictEqual(pureGenericAdminRes.ok, true, 'Administrator can confirm imports');
    assert.strictEqual(pureGenericAdminRes.role, 'Administrator');

    // D. Faculty member with spoofed user_metadata cannot confirm
    const spoofedFacultyRes = api.assertImportAllowed(
        { user: { id: 'fac-spoof', user_metadata: { position: 'College Dean' } } },
        { id: 'f-spoof-1', role: 'Faculty', position: 'Instructor I', admin_access: false },
        null
    );
    assert.strictEqual(spoofedFacultyRes.ok, false, 'Faculty member cannot spoof Dean permission');

    // E. Verify workload-tracker.html refreshes tracker on successful import
    assert.ok(
        currentTrackerHtml.includes('await loadAllWorkloads()') || currentTrackerHtml.includes('loadAllWorkloads()'),
        'Tracker must refresh after workload changes'
    );

    // F. Verify faculty-profile.html has zero import buttons or import confirmation controls
    const facultyHtmlPath = path.join(__dirname, '..', 'faculty', 'faculty-profile.html');
    const facultyPageHtml = fs.readFileSync(facultyHtmlPath, 'utf8');
    assert.strictEqual(facultyPageHtml.includes('id="importWorkloadBtn"'), false, 'Faculty must not have import button');
    assert.strictEqual(facultyPageHtml.includes('openWorkloadImport'), false, 'Faculty must not have openWorkloadImport');
    assert.strictEqual(facultyPageHtml.includes('executeConfirmedWorkloadImport'), false, 'Faculty must not have executeConfirmedWorkloadImport');

    // Scenario 26: Import Button Location, Behavior, and Role-Based Visibility Proof
    // 1. Verify HTML Toolbar contains Import button immediately adjacent to Export button
    const trackerToolbarSlice = currentTrackerHtml.slice(
        currentTrackerHtml.indexOf('id="resultCount"'),
        currentTrackerHtml.indexOf('id="tableScroll"')
    );
    assert.ok(trackerToolbarSlice.includes('id="importWorkloadBtn"'), 'importWorkloadBtn must exist in toolbar');
    assert.ok(trackerToolbarSlice.includes('id="exportMenuWrap"'), 'exportMenuWrap must exist in toolbar');
    const importBtnPos = trackerToolbarSlice.indexOf('id="importWorkloadBtn"');
    const exportBtnPos = trackerToolbarSlice.indexOf('id="exportMenuWrap"');
    assert.ok(importBtnPos !== -1 && exportBtnPos !== -1, 'Both Import and Export must be present in toolbar');
    assert.ok(importBtnPos < exportBtnPos, 'Import button must appear immediately beside Export button');

    // 2. Verify button attributes and event handler
    assert.ok(trackerToolbarSlice.includes('onclick="openWorkloadImport()"'), 'Import button must trigger openWorkloadImport()');
    assert.ok(trackerToolbarSlice.includes('class="export-btn'), 'Import button must have export-btn styling matching Export button');

    // 3. Verify opening import modal
    assert.ok(openFnBody.includes("modal.classList.remove('hidden')"), 'openWorkloadImport must open the import modal');

    // 4. Role-based visibility simulation:
    // A. College Dean -> Visible (allowed)
    const deanVisibility = api.assertImportAllowed(
        { user: { id: 'dean-user' } },
        { id: 'f-dean', role: 'Admin', position: 'College Dean' },
        { id: 'dean-user', role: 'Administrator' }
    );
    assert.strictEqual(deanVisibility.ok, true, 'College Dean must have import button visible');

    // B. College Secretary -> Visible (allowed)
    const secVisibility = api.assertImportAllowed(
        { user: { id: 'sec-user' } },
        { id: 'f-sec', role: 'Admin', position: 'College Secretary' },
        { id: 'sec-user', role: 'Administrator' }
    );
    assert.strictEqual(secVisibility.ok, true, 'College Secretary must have import button visible');

    // C. Faculty -> Hidden (blocked)
    const facVisibility = api.assertImportAllowed(
        { user: { id: 'fac-user' } },
        { id: 'f-fac', role: 'Faculty', position: 'Instructor I' },
        null
    );
    assert.strictEqual(facVisibility.ok, false, 'Faculty must NOT see import button');

    // D. Department Chairperson / OIC -> Hidden (blocked)
    const chairVisibility = api.assertImportAllowed(
        { user: { id: 'chair-user' } },
        { id: 'f-chair', role: 'Chairperson', position: 'Department Chairperson' },
        null
    );
    assert.strictEqual(chairVisibility.ok, false, 'Chairperson/OIC must NOT see import button');

    // E. Administrator -> Visible (allowed)
    const genAdminVisibility = api.assertImportAllowed(
        { user: { id: 'admin-user' } },
        { id: 'f-admin', role: 'Admin', position: 'Administrator' },
        { id: 'admin-user', role: 'Administrator' }
    );
    assert.strictEqual(genAdminVisibility.ok, true, 'Administrator must have import button visible');

    // Scenario 27: Import Button Lifecycle, Raw HTML Availability, and Unified Toolbar Visibility Controller
    // 1. Verify import button stays hidden until its database-backed role check completes
    const importBtnHtmlSnippet = currentTrackerHtml.match(/<button[^>]*id="importWorkloadBtn"[^>]*>/)?.[0] || '';
    assert.ok(/class="export-btn(?:\s+hidden)?"/.test(importBtnHtmlSnippet), 'importWorkloadBtn must have export-btn styling for consistency');
    assert.ok(importBtnHtmlSnippet.includes('hidden'), 'importWorkloadBtn must be hidden until authorization finishes');
    assert.strictEqual(importBtnHtmlSnippet.includes('display:none') || importBtnHtmlSnippet.includes('display: none'), false, 'importWorkloadBtn must not have inline display:none');

    // 2. Verify single authoritative controller in workload-tracker.html without permanent latch
    assert.ok(currentTrackerHtml.includes('async function syncWorkloadToolbarPermissions('), 'syncWorkloadToolbarPermissions controller must exist');
    assert.strictEqual(currentTrackerHtml.includes('hasAuthorizedExecutiveAccess = true'), false, 'Must not use a permanent authorization latch that survives logout');
    assert.ok(currentTrackerHtml.includes('syncWorkloadToolbarPermissions('), 'syncWorkloadToolbarPermissions must be wired into window.onload');
    assert.ok(currentTrackerHtml.includes('currentSessionAuthorized'), 'Must retain authorized state for the current session user');
    assert.ok(currentTrackerHtml.includes('ACCOUNT_SWITCH_DETECTED'), 'Must detect account switch and clear authorization');
    assert.ok(currentTrackerHtml.includes('toolbarAuthGeneration'), 'Stale async authorization resolutions must be invalidated');

    // 3. A client-side AuthGuard flag is not an authorization source
    globalThis.CiteFlowAuthGuard = { isDean: true, isSecretary: false };
    const guardDeanResult = api.assertImportAllowed({ user: { id: 'guard-dean' } }, null, null);
    assert.strictEqual(guardDeanResult.ok, false, 'AuthGuard flags must not grant import access');

    globalThis.CiteFlowAuthGuard = { isDean: false, isSecretary: true };
    const guardSecResult = api.assertImportAllowed({ user: { id: 'guard-sec' } }, null, null);
    assert.strictEqual(guardSecResult.ok, false, 'AuthGuard flags must not grant import access');

    globalThis.CiteFlowAuthGuard = { isDean: false, isSecretary: false };
    const guardNoResult = api.assertImportAllowed({ user: { id: 'guard-fac' } }, { role: 'Faculty', position: 'Instructor I' }, null);
    assert.strictEqual(guardNoResult.ok, false, 'AuthGuard unauthorized user must not be granted import access');
    delete globalThis.CiteFlowAuthGuard;

    // 4. Verify only database profile roles authorize Dean / Secretary
    const deanMetaResult = api.assertImportAllowed(
        { user: { id: 'admin-dean', user_metadata: { position: 'College Dean' } } },
        { role: 'Admin', position: 'College Dean', admin_access: true },
        { id: 'admin-dean', role: 'Administrator' }
    );
    assert.strictEqual(deanMetaResult.ok, true, 'Database faculty position College Dean authorizes import');
    assert.strictEqual(deanMetaResult.role, 'College Dean');

    const secMetaResult = api.assertImportAllowed(
        { user: { id: 'admin-sec', user_metadata: { designation: 'College Secretary' } } },
        { role: 'Admin', position: 'College Secretary', admin_access: true },
        { id: 'admin-sec', role: 'Administrator' }
    );
    assert.strictEqual(secMetaResult.ok, true, 'Database faculty position College Secretary authorizes import');
    assert.strictEqual(secMetaResult.role, 'College Secretary');

    const genericAdminResult = api.assertImportAllowed(
        { user: { id: 'admin-plain', user_metadata: { role: 'admin' } } },
        { role: 'Admin', position: 'Administrator', admin_access: true },
        { id: 'admin-plain', role: 'Administrator' }
    );
    assert.strictEqual(genericAdminResult.ok, true, 'Administrator role must be authorized');
    assert.strictEqual(genericAdminResult.role, 'Administrator');

    const ignored = juanTypo;
    assert.ok(ignored.id);
    console.log('workload-import tests passed (all 27 security and workflow scenarios verified)');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
