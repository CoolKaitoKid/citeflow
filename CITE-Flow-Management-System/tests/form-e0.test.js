/**
 * Tests for CHED Form E-0 Calculation & Export Engine
 *
 * The layout assertions use the cell addresses of the CTU College of Technology
 * and Engineering sample ("SUCS FACULTY WORKLOAD REPORT"). The fixture mirrors
 * the sample's structure with anonymized personal data.
 */
const assert = require('assert');
const path = require('path');
const engine = require(path.join(__dirname, '..', 'shared', 'form-e0-engine.js'));
const template = require(path.join(__dirname, '..', 'shared', 'form-e0-template.js'));

console.log('--- RUNNING CHED FORM E-0 ENGINE TESTS ---');

// ---------------------------------------------------------------------------
// Fixture: same load structure as the CTU sample
// ---------------------------------------------------------------------------
function sampleClasses() {
    const cc111 = (code, days, students) => ({
        subject_code_title: 'CC111 - INTRODUCTION TO COMPUTING',
        class_code: code,
        schedule_days: days,
        schedule_time: '1:00 - 3:00 PM\n1:00 - 4:00 PM',
        room: 'IT COMPLAB 1',
        educational_level: 'BACC',
        lecture_units: 2, lab_units: 1,
        lecture_hours: 2, lab_hours: 3,
        num_students: students
    });
    return [
        cc111('CS4', 'TWTh', 35),
        cc111('CS13', 'TTh', 41),
        cc111('CS22', 'MTWThF', 35),
        {
            subject_code_title: 'PC4114 - CAPSTONE PROJECT AND RESEARCH 2',
            class_code: 'CS78',
            schedule_days: 'WThF',
            schedule_time: '10:00 - 11:00 AM\n10:00 - 12:00 PM',
            room: 'IT COMPLAB 4',
            educational_level: 'BACC',
            lecture_units: 3, lab_units: 0,
            lecture_hours: 3, lab_hours: 0,
            num_students: 47
        }
    ];
}

function sampleReport(overrides) {
    return Object.assign({
        academic_year: '2026-2027',
        semester: '1',
        college_name: 'Technology and Engineering',
        department_name: 'Information Technology',
        discipline_code: '464108',
        faculty_last_name: 'Dela Cruz',
        faculty_first_name: 'Juana',
        faculty_middle_initial: 'B',
        email: 'juana.delacruz@ctu.edu.ph',
        phone: '09000000000',
        birthdate: '1987-08-15',
        original_appointment_date: '2017-08-30',
        gender: 'FEMALE',
        tenure_status_code: '1.0',
        employment_type_code: '1',
        has_plantilla_item: true,
        salary_charge_to: 'PS ITEM',
        generic_rank_code: 'Assistant Professor III',
        salary_grade: 22,
        annual_basic_salary: 972000,
        lecturer_fee_per_hour: 0,
        is_active_duty: true,
        leave_without_pay: { start_date: '', end_date: '', leave_type_code: '' },
        leave_with_pay: { start_date: '', end_date: '', leave_type_code: '' },
        degrees_snapshot: [
            { level: 'BACC', degree_title: 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY', status_code: '1', date_completed: '2008-04-15', institution_name: 'SOUTHWESTERN UNIVERSITY', discipline_code: '464108' },
            { level: 'MASTERS', degree_title: 'Master of Arts in Teaching -ICT', status_code: '1', date_completed: '2012-03-31', institution_name: 'SOUTHWESTERN UNIVERSITY', discipline_code: '464108', wrote_thesis: false },
            { level: 'DOCTORAL', degree_title: 'DOCTOR IN PHILOSOPHY IN TECHNOLOGY MANAGEMENT', status_code: '2', date_completed: '', institution_name: 'CTU Main Campus', discipline_code: '464108', wrote_dissertation: false }
        ],
        primary_discipline_teaching: '464108',
        secondary_discipline_teaching: '',
        non_teaching_credits: {
            admin: { credits: 15, start_date: '2026-08-03', end_date: '2026-12-18', details: 'Program Chairperson' },
            research: { credits: 0, start_date: '', end_date: '', details: '' },
            extension: { credits: 0, start_date: '', end_date: '', details: '' },
            production: { credits: 0, start_date: '', end_date: '', details: '' },
            study: { credits: 0, start_date: '', end_date: '', details: '' },
            others: { credits: 0, start_date: '', end_date: '', details: '' }
        },
        consultation_hours: { mon: '8:00 - 10:00', tue: '', wed: '2:00-4:00', thu: '', fri: '', sat: '' },
        submitted_at: '2026-09-30T02:00:00Z'
    }, overrides || {});
}

// 1. Dates ------------------------------------------------------------------
console.log('1. Testing date conversions...');
assert.strictEqual(engine.parseDateToYMD('32004.0'), '1987-08-15', 'Excel serial 32004 = 1987-08-15');
assert.strictEqual(engine.formatDateDisplay('32004.0', 'MMDDYYYY'), '08151987');
assert.strictEqual(engine.parseDateToYMD('42977.0'), '2017-08-30');
assert.strictEqual(engine.parseDateToYMD('43819.0'), '2019-12-20');
assert.strictEqual(engine.toYMD('02/31/2012'), null, 'Feb 31 is not a real date (sample C38)');
assert.strictEqual(engine.toYMD('09/30/2026'), '2026-09-30');
assert.strictEqual(engine.formatDateDisplay('2026-09-30'), '09/30/2026');

// 2. Codes & helpers -----------------------------------------------------------
console.log('2. Testing code helpers...');
assert.strictEqual(engine.normalizeCode('1.0'), '1');
assert.strictEqual(engine.normalizeCode(2), '2');
assert.strictEqual(engine.rankCodeFromText('Assistant Professor III'), '30');
assert.strictEqual(engine.rankCodeFromText('Associate Professor V'), '40');
assert.strictEqual(engine.rankCodeFromText('Instructor I'), '20');
assert.strictEqual(engine.rankCodeFromText('Professor VI'), '50');
assert.strictEqual(engine.rankCodeFromText('30'), '30');
assert.strictEqual(engine.rankCodeFromText('9'), '09');
assert.strictEqual(engine.normalizeDays('TWThu'), 'TWTh');
assert.strictEqual(engine.normalizeDays('M-F'), 'MTWThF');
assert.strictEqual(engine.normalizeDays('TTh'), 'TTh');
assert.strictEqual(engine.normalizeDays('WThF'), 'WThF');
assert.strictEqual(engine.lecLabLabel(sampleClasses()[0]), 'LAB', 'CC111 has a lab component');
assert.strictEqual(engine.lecLabLabel(sampleClasses()[3]), 'LEC');

// 3. Matrix C (units) -----------------------------------------------------------
console.log('3. Testing Matrix C (subject & credit units)...');
const mu = engine.calculateMatrixUnits(sampleClasses());
assert.strictEqual(mu.matrix.BACC.lecSubjectUnits, 9);
assert.strictEqual(mu.matrix.BACC.labSubjectUnits, 3);
assert.strictEqual(mu.matrix.BACC.totalSubjectUnits, 12);
assert.strictEqual(mu.totals.totalCreditUnits, 12, 'CTU: credit units = subject units');
assert.strictEqual(mu.matrix.DOCTORAL.totalSubjectUnits, 0, 'undergraduate subjects never land in DOCTORAL');
const muLab = engine.calculateMatrixUnits(sampleClasses(), { labCreditFactor: 1.5 });
assert.strictEqual(muLab.totals.labCreditUnits, 4.5, 'lab credit factor is configurable');

// 4. Matrix D (hours & contact hours) ----------------------------------------------
console.log('4. Testing Matrix D (hours & student-contact hours)...');
const mh = engine.calculateMatrixHours(sampleClasses());
assert.strictEqual(mh.totals.lecHoursPerWeek, 9);
assert.strictEqual(mh.totals.labHoursPerWeek, 9);
assert.strictEqual(mh.totals.totalHoursPerWeek, 18);
// 2x35 + 2x41 + 2x35 + 3x47 = 363 (the sample's 1,422 multiplied the column totals)
assert.strictEqual(mh.totals.lecContactHours, 363);
// 3x(35 + 41 + 35) = 333
assert.strictEqual(mh.totals.labContactHours, 333);
assert.strictEqual(mh.totals.totalContactHours, 696);

// 5. Workload credits -----------------------------------------------------------------
console.log('5. Testing E7-E9 workload credits...');
const wl = engine.calculateWorkloadCredits({ admin: { credits: 3 }, research: { credits: 1.5 } }, 18);
assert.strictEqual(wl.subtotalNonTeaching, 4.5);
assert.strictEqual(wl.subtotalTeaching, 18);
assert.strictEqual(wl.grandTotal, 22.5);
const sumHours = engine.computeSummary(sampleReport(), sampleClasses());
assert.strictEqual(sumHours.workload.subtotalTeaching, 18, 'default E8 basis = teaching hours (CTU sample)');
assert.strictEqual(sumHours.workload.subtotalNonTeaching, 15);
assert.strictEqual(sumHours.workload.grandTotal, 33);
const sumUnits = engine.computeSummary(sampleReport(), sampleClasses(), { teachingCreditBasis: 'credit_units' });
assert.strictEqual(sumUnits.workload.subtotalTeaching, 12);
assert.strictEqual(sumUnits.workload.grandTotal, 27);

// 6. Template matches the CTU sample's labels ------------------------------------------------
console.log('6. Testing template labels against the CTU sample...');
const labels = Object.fromEntries(template.CELLS.filter(c => c[2] != null).map(c => [c[0], c[2]]));
const expectedLabels = {
    A1: 'Form E-0:  INDIVIDUAL FACULTY WORKLOAD REPORT',
    A2: 'NOTE:  EVERY FACULTY MEMBER SHOULD FILL UP THIS FORM EVERY FIRST SEMESTER.',
    D8: 'FAMILY', E8: 'FIRST NAME', G8: 'M.I.',
    E11: 'DATE OF ORIGINAL APPOINTMENT: (MMDDYYYY)',
    B15: '1. TENURED 2. NOT TENURED 3. NO PS ITEM',
    C19: 'PS ITEM', D19: 'GAA LUMP SUM', E19: 'SUC INCOME', F19: 'LGU',
    I25: 'TYPE OF LEAVE ( USE CODE)',
    B30: 'BACCALAUREATE DEGREE:',
    B51: 'FIRST SPECIFIC DISCIPLINE WHERE MOST TEACHING IS DONE ( USE 6-DIGIT CODE):',
    C55: 'INCLUDE ONLY OFFICIALLY-APPROVED LOAD CREDITS.',
    B66: 'GRAND TOTAL WORKLOAD CREDITS',
    B69: 'REMARKS: SEE INSTRUCTIONS FOR CHED FORM E1 AND E2',
    C76: 'SCHEDULE OF CLASSES: List all subjects in all levels.',
    B78: 'SUBJECT NUMBER & TITLE', G78: 'LECTURE OR LAB?', J78: 'NO. OF STUDENTS',
    B90: 'CONSULTATION HOURS:  SPECIFY TIME',
    C99: '"SUBJECT UNITS" and "CREDIT UNITS"',
    B104: 'PRE-BACC/ BACC/ POST-BACC',
    I111: 'TOTAL CONTACT HOURS PER WEEK',
    B120: 'CERTIFIED CORRECT BY:',
    B130: 'IF FACULTY MEMBER IS ABROAD, THIS FORM WILL BE FILLED UP BY THE DEPARTMENT CHAIR IN BEHALF OF ABSENT FACULTY MEMBER.'
};
Object.entries(expectedLabels).forEach(([addr, text]) => {
    assert.strictEqual(labels[addr], text, `template label ${addr}`);
});
assert.strictEqual(template.SHEET_NAME, 'SUCS FACULTY WORKLOAD REPORT');
assert.strictEqual(template.ROW_COUNT, 131);
assert.strictEqual(template.COLUMN_COUNT, 11);
['TOMOL', 'CHRISTINE', '81000', 'CS4'].forEach(token => {
    assert(!JSON.stringify(template.CELLS).includes(token), `template must not contain sample data (${token})`);
});

// 7. Sheet model places values where the CTU sample has them --------------------------------------
console.log('7. Testing value placement (CTU cell addresses)...');
const model = engine.buildSheetModel(sampleReport(), sampleClasses());
const v = addr => (model.cells[addr] || {}).v;
assert.strictEqual(model.sheetName, 'SUCS FACULTY WORKLOAD REPORT');
assert.strictEqual(v('B4'), 'SEMESTER ( 1/2/ SUMMER) _______1________');
assert.strictEqual(v('D4'), 'SCHOOLYEAR:   2026 TO 2027');
assert.strictEqual(v('B5'), 'COLLEGE : Technology and Engineering');
assert.strictEqual(v('D5'), 'DEPARTMENT: Information Technology');
assert.strictEqual(v('B6'), 'CODE NUMBER: 464108');
assert.strictEqual(v('C7'), 'DELA CRUZ');
assert.strictEqual(v('E7'), 'JUANA');
assert.strictEqual(v('G7'), 'B');
assert.strictEqual(v('B9'), 'E-MAIL ADDRESS: juana.delacruz@ctu.edu.ph');
assert.strictEqual(v('C11'), '1987-08-15');
assert.strictEqual(model.cells.C11.t, 'date');
assert.strictEqual(v('I11'), '2017-08-30', 'original appointment is in column I');
assert.strictEqual(v('C12'), 'FEMALE');
assert.strictEqual(v('D15'), 1, 'tenure code is a number, not "1.0"');
assert.strictEqual(v('D16'), 1);
assert.strictEqual(v('D17'), 'YES');
assert.strictEqual(v('C18'), '/', 'B4 tick under PS ITEM');
assert.strictEqual(v('D18'), null);
assert.strictEqual(v('C20'), 30, 'B5 generic rank code');
assert.strictEqual(v('C21'), 22);
assert.strictEqual(v('C22'), 972000);
assert.strictEqual(v('D23'), 'YES');
assert.strictEqual(v('C30'), 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY');
assert.strictEqual(v('I31'), 1);
assert.strictEqual(v('C32'), '2008-04-15');
assert.strictEqual(v('C33'), 'SOUTHWESTERN UNIVERSITY');
assert.strictEqual(v('D34'), 464108);
assert.strictEqual(v('C36'), 'Master of Arts in Teaching -ICT');
assert.strictEqual(v('D41'), 'NO');
assert.strictEqual(v('I44'), 2);
assert.strictEqual(v('C45'), null, 'no date completed while still pursuing');
assert.strictEqual(v('D48'), 'NO');
assert.strictEqual(v('G51'), 464108, 'D1 is in column G');
assert.strictEqual(v('C58'), 15);
assert.strictEqual(v('D58'), '2026-08-03');
assert.strictEqual(v('F58'), 'Program Chairperson');
assert.strictEqual(v('C59'), null, 'zero credits stay blank');
assert.strictEqual(v('C64'), 15, 'E7');
assert.strictEqual(v('C65'), 18, 'E8 (teaching hours, as in the sample)');
assert.strictEqual(v('C66'), 33, 'E9');
assert.strictEqual(v('B74'), 'SEM /TRIM  1ST  SCHOOLYEAR  2026 to 2027');
assert.strictEqual(v('A80'), 'A1 ');
assert.strictEqual(v('B80'), '1. CC111 - INTRODUCTION TO COMPUTING');
assert.strictEqual(v('C80'), 'CS4');
assert.strictEqual(v('E80'), '1:00 - 3:00 PM\n1:00 - 4:00 PM');
assert.strictEqual(v('G80'), 'LAB');
assert.strictEqual(v('I80'), 'NO');
assert.strictEqual(v('J80'), 35);
assert.strictEqual(v('B83'), '4. PC4114 - CAPSTONE PROJECT AND RESEARCH 2');
assert.strictEqual(v('G83'), 'LEC');
assert.strictEqual(v('B84'), null);
assert.strictEqual(v('C91'), '8:00 - 10:00');
assert.strictEqual(v('C93'), '2:00-4:00');
assert.strictEqual(v('C104'), 9, 'C3 BACC lecture subject units');
assert.strictEqual(v('I104'), 12);
assert.strictEqual(v('C106'), null, 'DOCTORAL row stays blank');
assert.strictEqual(v('I107'), 12, 'C6 total credit units');
assert.strictEqual(v('E114'), 18, 'D3 total hours/week');
assert.strictEqual(v('F114'), 363);
assert.strictEqual(v('G114'), 333);
assert.strictEqual(v('I117'), 696);
assert.strictEqual(v('B119'), 'PRINTED NAME AND SIGNATURE OF FACULTY MEMBER: JUANA B. DELA CRUZ');
assert.strictEqual(v('B121'), 'PRINTED NAME AND SIGNATURE OF DEPARTMENT CHAIR:');
assert(String(v('I119')).startsWith('DATE: 09/30/2026') || String(v('I119')).startsWith('DATE: 10/01/2026'));

const salaryGaa = engine.buildSheetModel(sampleReport({ salary_charge_to: 'SUC INCOME' }), []);
assert.strictEqual(salaryGaa.cells.E18.v, '/');
assert.strictEqual(salaryGaa.cells.C18.v, null);

const onLeave = engine.buildSheetModel(sampleReport({ leave_with_pay: { start_date: '2026-09-01', end_date: '2026-09-30', leave_type_code: 'SL' } }), []);
assert.strictEqual(onLeave.cells.C26.v, '2026-09-01', 'B10 leave start');
assert.strictEqual(onLeave.cells.E26.v, '2026-09-30');
assert.strictEqual(onLeave.cells.I26.v, 'SL');

// 8. More than nine classes pushes page 2 down -------------------------------------------------------
console.log('8. Testing schedule overflow beyond the 9 template rows...');
const many = [];
for (let i = 0; i < 11; i++) many.push(Object.assign({}, sampleClasses()[3], { class_code: 'X' + i }));
const big = engine.buildSheetModel(sampleReport(), many);
assert.strictEqual(big.rowCount, 133);
assert.strictEqual(big.cells.B90.v, '11. PC4114 - CAPSTONE PROJECT AND RESEARCH 2');
assert.strictEqual(big.cells.A90.v, 'A11');
assert.strictEqual(big.cells.B92.v, 'CONSULTATION HOURS:  SPECIFY TIME');
assert(String(big.cells.B121.v).startsWith('PRINTED NAME AND SIGNATURE OF FACULTY MEMBER'));
assert(big.merges.some(m => m[0] === 90 && m[1] === 7 && m[3] === 8), 'G:H merge added for the new row');

// 9. Validation rules (from the sample's data-quality problems) ------------------------------------
console.log('9. Testing validation rules...');
const clean = engine.validateReport(sampleReport(), sampleClasses());
assert.deepStrictEqual(clean.errors, [], 'clean fixture has no errors: ' + JSON.stringify(clean.errors));

const bad = engine.validateReport(sampleReport({
    generic_rank_code: '',
    annual_basic_salary: 81000,
    degrees_snapshot: [
        { level: 'BACC', degree_title: 'BSIT', status_code: '1', date_completed: '2008-04-15', institution_name: 'SWU', discipline_code: '464108' },
        { level: 'MASTERS', degree_title: 'MAT-ICT', status_code: '1', date_completed: '02/31/2012', institution_name: 'SWU', discipline_code: '464108' },
        { level: 'DOCTORAL', degree_title: 'PhD TM', status_code: '2', date_completed: '2019-12-20', institution_name: 'CTU', discipline_code: '464108', wrote_dissertation: true }
    ],
    non_teaching_credits: { admin: { credits: 15, start_date: '2026-01-03', end_date: '2026-05-30', details: 'Program Chairperson' } }
}), sampleClasses());
const errFields = bad.errors.map(e => e.field);
const warnFields = bad.warnings.map(e => e.field);
assert(errFields.includes('fieldRankCode'), 'missing rank code is an error');
assert(errFields.includes('fieldMasterDate'), 'Feb 31 is an error');
assert(errFields.includes('fieldDocDate'), 'date completed while still pursuing is an error');
assert(errFields.includes('fieldDocDissertation'), 'dissertation YES while still pursuing is an error');
assert(warnFields.includes('fieldAnnualSalary'), '81,000 at SG 22 is flagged as a monthly salary');
assert(warnFields.includes('fieldE1Start'), 'load credit outside the term is flagged');
assert(!bad.ok);

// 10. Legacy row output ------------------------------------------------------------------------------
console.log('10. Testing legacy row output...');
const fullRows = engine.generateChedFormE0Rows(sampleReport(), sampleClasses());
assert.strictEqual(fullRows.length, 131);
assert.strictEqual(fullRows[0][0], 'Form E-0:  INDIVIDUAL FACULTY WORKLOAD REPORT');
assert.strictEqual(fullRows[10][2], '08/15/1987', 'C11 rendered as MM/DD/YYYY');
assert.strictEqual(fullRows[10][8], '08/30/2017', 'I11 rendered as MM/DD/YYYY');

// 11. HTML preview & regression guards --------------------------------------------------------------
console.log('11. Testing HTML preview & regression guards...');
const html = engine.renderSheetHtml(model);
assert(html.includes('data-cell="C7"'));
assert(html.includes('DELA CRUZ'));
assert(html.includes('e0-sheet-page'), 'renders distinct bond-paper page cards');
assert(html.includes('e0-sheet-break'), 'page break after row 70');
assert(!html.includes('<script'), 'values are escaped');

assert.strictEqual(engine.semesterCode('First Semester'), '1');
assert.strictEqual(engine.semesterCode('1st Semester'), '1');
assert.strictEqual(engine.semesterCode('Second Semester'), '2');
assert.strictEqual(engine.semesterCode('2nd Semester'), '2');
assert.strictEqual(engine.semesterCode('Summer'), 'SUMMER');
assert.strictEqual(engine.semesterCode('Midyear'), 'SUMMER');

assert.strictEqual(engine.normalizeGender('Male'), 'MALE');
assert.strictEqual(engine.normalizeGender('Female'), 'FEMALE');
assert.strictEqual(engine.normalizeGender('LGBTQ'), 'LGBTQ');
assert.strictEqual(engine.normalizeGender('Prefer not to say'), 'PREFER NOT TO SAY');
assert.strictEqual(engine.buildSheetModel(sampleReport({ gender: 'LGBTQ' }), []).cells.C12.v, 'LGBTQ');
assert.strictEqual(engine.buildSheetModel(sampleReport({ gender: 'Prefer not to say' }), []).cells.C12.v, 'PREFER NOT TO SAY');

assert.strictEqual(engine.sslGradeFromRank('Instructor I'), 12);
assert.strictEqual(engine.sslGradeFromRank('Associate Professor IV'), 22);

const fs = require('fs');
['../faculty/form-e0.js', '../shared/form-e0-engine.js', '../shared/form-e0-review.js', '../faculty/chairperson-review.js'].forEach(rel => {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert(!/\b(alert|confirm|prompt)\s*\(/.test(src), `${rel} must not use native browser dialogs`);
    assert(!/addEventListener\s*\(\s*['"]beforeunload['"]/.test(src), `${rel} must not use native beforeunload prompt`);
    assert(!/getFacultySession/.test(src), `${rel} must not call nonexistent getFacultySession`);
    assert(!/\.from\([^)]+\)[^\n;]*\.catch\s*\(/.test(src), `${rel} must not chain .catch() onto PostgrestFilterBuilder`);
});

// 12. Chairperson Review Queue Integration ----------------------------------------------------------
console.log('12. Testing Form E-0 visibility in Chairperson Review...');
const wf = require(path.join(__dirname, '..', 'shared', 'workflow.js'));
const ChairReview = require(path.join(__dirname, '..', 'faculty', 'chairperson-review.js'));

global.CiteFlowWorkflow = wf;
global.currentFaculty = { id: 101, full_name: 'Ella G. Rodriguez', department: 'BSIT', role: 'Chairperson' };
global.currentUser = { id: 'chair-auth-1' };

ChairReview.access = true;
ChairReview.review.access = true;
ChairReview.review.grants = [];
ChairReview.review.faculty = [
    { id: 101, full_name: 'Ella G. Rodriguez', department: 'BSIT', role: 'Chairperson' },
    { id: 202, full_name: 'KrishPao A. Ars', department: 'BSIT', role: 'Faculty' },
    { id: 303, full_name: 'Juan BSIE', department: 'BSIE', role: 'Faculty' }
];
ChairReview.review.tasks = [];
ChairReview.review.assignments = [];
ChairReview.review.submissions = [];
ChairReview.review.arSubmissions = [];
ChairReview.review.configs = [];
ChairReview.review.mfoPackets = [];
ChairReview.review.formE0Reports = [
    {
        id: 'e0-krishpao',
        faculty_id: 202,
        faculty_printed_name: 'ARS, KRISHPAO A.',
        department_name: 'Information Technology',
        academic_year: '2026 TO 2027',
        semester: '1',
        status: 'submitted',
        grand_total_credits: 21,
        subtotal_teaching: 18,
        subtotal_non_teaching: 3,
        submitted_at: '2026-11-14T06:30:00Z'
    },
    {
        id: 'e0-chair-own',
        faculty_id: 101,
        faculty_printed_name: 'RODRIGUEZ, ELLA G.',
        department_name: 'Information Technology',
        academic_year: '2026 TO 2027',
        semester: '1',
        status: 'submitted',
        grand_total_credits: 24,
        submitted_at: '2026-11-14T06:00:00Z'
    },
    {
        id: 'e0-other-dept',
        faculty_id: 303,
        faculty_printed_name: 'BSIE, JUAN',
        department_name: 'Industrial Engineering',
        academic_year: '2026 TO 2027',
        semester: '1',
        status: 'submitted',
        grand_total_credits: 18,
        submitted_at: '2026-11-14T05:00:00Z'
    },
    {
        id: 'e0-draft',
        faculty_id: 202,
        faculty_printed_name: 'ARS, KRISHPAO A.',
        department_name: 'Information Technology',
        academic_year: '2025 TO 2026',
        semester: '1',
        status: 'draft',
        grand_total_credits: 15,
        updated_at: '2026-11-13T05:00:00Z'
    }
];

const chairRows = ChairReview.buildRows();
assert.strictEqual(chairRows.length, 2, 'BSIT Chair sees BSIT non-draft Form E-0 reports only');
const krishRow = chairRows.find(r => r.id === 'e0-krishpao');
const ownRow = chairRows.find(r => r.id === 'e0-chair-own');
assert(krishRow && krishRow.is_form_e0, 'KrishPao Form E-0 is included in Chairperson Review rows');
assert.strictEqual(ChairReview.isPending(krishRow), true, 'KrishPao submitted Form E-0 is pending Chair certification');
assert.strictEqual(ChairReview.isPending(ownRow), false, 'Chair cannot certify own Form E-0 (goes to Dean)');

const cardHtml = ChairReview.renderCard(krishRow);
assert(cardHtml.includes('CHED Form E-0'), 'Card displays CHED Form E-0 badge');
assert(cardHtml.includes('KrishPao A. Ars'), 'Card displays faculty name');
assert(cardHtml.includes('form-e0-review.html?id=e0-krishpao'), 'Card links to Form E-0 review page');
assert(cardHtml.includes('Certify Correct'), 'Pending card renders Certify Correct action');

const draftsInScope = ChairReview.scopedDraftFormE0Rows();
assert.strictEqual(draftsInScope.length, 1, 'Unsubmitted BSIT Form E-0 draft is surfaced in scopedDraftFormE0Rows');
assert.strictEqual(draftsInScope[0].id, 'e0-draft');

console.log('ALL CHED FORM E-0 TESTS PASSED SUCCESSFULLY!');
