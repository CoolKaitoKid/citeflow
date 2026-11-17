/**
 * CITE-Flow: CHED Form E-0 Core Calculation & Export Engine
 * Standardized logic for Individual Faculty Workload Reporting
 *
 * Layout follows the CTU College of Technology and Engineering template
 * (sheet "SUCS FACULTY WORKLOAD REPORT"), captured in form-e0-template.js.
 * One sheet model (buildSheetModel) drives the Excel export, the on-screen
 * "Official Form Preview" and the legacy row output, so all three always match.
 */
(function (root, factory) {
    'use strict';
    let template = root && root.CiteFlowFormE0Template;
    if (!template && typeof require === 'function') {
        try { template = require('./form-e0-template.js'); } catch (e) { template = null; }
    }
    const api = factory(template, root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.CiteFlowFormE0Engine = api;
})(typeof window !== 'undefined' ? window : globalThis, function (TEMPLATE, root) {
    'use strict';

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------
    const LEVEL_KEYS = [
        { key: 'ELEM_SEC', label: 'ELEMENTARY/ SECONDARY', code: 'C1' },
        { key: 'TECH_VOC', label: 'TECH/VOC', code: 'C2' },
        { key: 'BACC', label: 'PRE-BACC/ BACC/ POST-BACC', code: 'C3' },
        { key: 'MASTERS', label: 'MASTERS LEVEL:', code: 'C4' },
        { key: 'DOCTORAL', label: 'DOCTORAL LEVEL:', code: 'C5' }
    ];

    const GENERIC_RANK_CODES = [
        { code: '09', label: 'Teaching Fellow / Teaching Associate' },
        { code: '10', label: 'Teacher / Master Teacher' },
        { code: '11', label: 'Lecturer / Senior Lecturer / Professorial Lecturer' },
        { code: '12', label: 'Professor Emeritus' },
        { code: '13', label: 'Visiting Professor' },
        { code: '14', label: 'Adjunct / Affiliate Faculty' },
        { code: '20', label: 'Instructor' },
        { code: '30', label: 'Assistant Professor' },
        { code: '40', label: 'Associate Professor' },
        { code: '50', label: 'Professor (incl. University Professor)' },
        { code: '90', label: 'Others' }
    ];

    const DEGREE_STATUS = {
        COMPLETED: 1,
        PURSUING: 2,
        UNCOMPLETED: 3,
        NOT_STARTED: 4
    };

    // B4 "BASIC SALARY CHARGED TO": the CTU template marks the source with "/"
    // in the column whose header (row 19) names it.
    const SALARY_SOURCE_COLUMNS = { 'PS ITEM': 'C', 'GAA LUMP SUM': 'D', 'SUC INCOME': 'E', 'LGU': 'F' };

    // Template rows (1-based) — see form-e0-template.js.
    const ROW = {
        CLASS_FIRST: 80,
        CLASS_TEMPLATE_SLOTS: 9,
        CLASS_LAST: 88,
        MATRIX_UNITS_FIRST: 102, // C1 .. C6
        MATRIX_HOURS_FIRST: 112  // D1 .. D6
    };

    const NON_TEACHING_ROWS = [
        { key: 'admin', code: 'E1', row: 58, label: 'Official Administrative Duties' },
        { key: 'research', code: 'E2', row: 59, label: 'Official Research Load' },
        { key: 'extension', code: 'E3', row: 60, label: 'Official Extension Service' },
        { key: 'production', code: 'E4', row: 61, label: 'Official Production or Income-Generation Work' },
        { key: 'study', code: 'E5', row: 62, label: 'Official Study Load' },
        { key: 'others', code: 'E6', row: 63, label: 'Other Load Credits' }
    ];

    // Calculation options. The defaults follow the CTU sample:
    //  - E8 "Subtotal teaching credits" = total teaching HOURS per week (sample: 18),
    //  - credit units = subject units (sample: 9/3/12 in both column groups).
    // Switch teachingCreditBasis to 'credit_units' if the college decides E8
    // should carry the C6 total credit units instead.
    const DEFAULT_OPTIONS = {
        teachingCreditBasis: 'hours',
        lecCreditFactor: 1,
        labCreditFactor: 1,
        maxGrandTotal: null
    };

    function resolveOptions(options) {
        const globalCfg = (root && root.CiteFlowFormE0Config) || {};
        return Object.assign({}, DEFAULT_OPTIONS, globalCfg, options || {});
    }

    // ------------------------------------------------------------------
    // Generic helpers
    // ------------------------------------------------------------------
    function num(val) {
        const n = Number(val);
        return Number.isFinite(n) ? n : 0;
    }

    function round2(val) {
        return Math.round(num(val) * 100) / 100;
    }

    function str(val) {
        return val == null ? '' : String(val).trim();
    }

    function isBlank(val) {
        return str(val) === '';
    }

    /** '1.0' -> '1', 1 -> '1', '' -> ''. Used for tenure / employment / degree status codes. */
    function normalizeCode(val) {
        const s = str(val);
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n)) return String(Math.trunc(n));
        const m = s.match(/^(\d+)/);
        return m ? String(Number(m[1])) : s;
    }

    function codeNumber(val) {
        const s = normalizeCode(val);
        return s && /^\d+$/.test(s) ? Number(s) : null;
    }

    function rankCodeFromText(text) {
        const s = str(text).toLowerCase();
        if (!s) return '';
        if (/^\d{1,2}(\.0+)?$/.test(s)) {
            const code = String(Math.trunc(Number(s))).padStart(2, '0');
            return GENERIC_RANK_CODES.some(function (r) { return r.code === code; }) ? code : '';
        }
        if (s.includes('emerit')) return '12';
        if (s.includes('visiting')) return '13';
        if (s.includes('adjunct') || s.includes('affiliate')) return '14';
        if (s.includes('fellow') || s.includes('teaching associate')) return '09';
        if (s.includes('lecturer')) return '11';
        if (s.includes('associate prof')) return '40';
        if (s.includes('assistant prof') || s.includes('asst. prof') || s.includes('asst prof')) return '30';
        if (s.includes('instructor')) return '20';
        if (s.includes('professor')) return '50';
        if (s.includes('teacher')) return '10';
        return '';
    }

    function normalizeRankCode(val) {
        return rankCodeFromText(val);
    }

    function getTemplate() {
        return TEMPLATE || (root && root.CiteFlowFormE0Template) || null;
    }

    function rankLabel(code) {
        const hit = GENERIC_RANK_CODES.find(function (r) { return r.code === code; });
        return hit ? hit.label : '';
    }

    function sslGradeFromRank(text) {
        const s = str(text).toLowerCase().replace(/\s+/g, ' ');
        if (!s) return null;
        const step = function (r) {
            return { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 }[r] || 0;
        };
        let m;
        if (/university\s+prof|college\s+prof/.test(s)) return 30;
        if ((m = s.match(/associate\s+prof(?:essor|\.)?\s*(vi|iv|v|iii|ii|i|[1-5])\b/))) return 18 + step(m[1]);
        if ((m = s.match(/(?:assistant|asst\.?)\s+prof(?:essor|\.)?\s*(iv|iii|ii|i|[1-4])\b/))) return 14 + step(m[1]);
        if ((m = s.match(/instructor\s*(iii|ii|i|[1-3])\b/))) return 11 + step(m[1]);
        if ((m = s.match(/\bprof(?:essor|\.)?\s*(vi|iv|v|iii|ii|i|[1-6])\b/))) return 23 + step(m[1]);
        if (s.includes('associate prof')) return 19;
        if (s.includes('assistant prof') || s.includes('asst prof') || s.includes('asst. prof')) return 15;
        if (s.includes('instructor')) return 12;
        if (/\bprofessor\b/.test(s)) return 24;
        return null;
    }

    function normalizeGender(val) {
        const s = str(val);
        if (!s) return '';
        const u = s.toUpperCase();
        if (u === 'M' || u === 'MALE') return 'MALE';
        if (u === 'F' || u === 'FEMALE') return 'FEMALE';
        if (/^LGBT/.test(u)) return 'LGBTQ';
        if (/PREFER/.test(u)) return 'PREFER NOT TO SAY';
        return u;
    }

    function isSixDigitCode(val) {
        return /^\d{6}$/.test(str(val).replace(/\.0+$/, ''));
    }

    function sixDigit(val) {
        const s = str(val).replace(/\.0+$/, '');
        return /^\d{6}$/.test(s) ? Number(s) : (s || '');
    }

    // ------------------------------------------------------------------
    // Dates
    // ------------------------------------------------------------------
    function validYMD(y, m, d) {
        if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }

    function ymd(y, m, d) {
        return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }

    /** Returns 'YYYY-MM-DD' for a valid date, '' for blank, and null for an invalid date (e.g. 02/31/2012). */
    function toYMD(val) {
        if (val == null || val === '') return '';
        if (val instanceof Date) {
            return isNaN(val.getTime()) ? null : ymd(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
        }
        const s = String(val).trim();
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n) && n > 10000 && n < 100000) {
            const d = new Date(Math.round((n - 25569) * 86400 * 1000));
            return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        }
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return validYMD(+m[1], +m[2], +m[3]) ? ymd(+m[1], +m[2], +m[3]) : null;
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return validYMD(+m[3], +m[1], +m[2]) ? ymd(+m[3], +m[1], +m[2]) : null;
        m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
        if (m) return validYMD(+m[3], +m[1], +m[2]) ? ymd(+m[3], +m[1], +m[2]) : null;
        return null;
    }

    function parseDateToYMD(val) {
        const v = toYMD(val);
        if (v === null) return String(val == null ? '' : val).trim();
        return v;
    }

    function formatDateDisplay(val, format) {
        format = format || 'MM/DD/YYYY';
        const v = toYMD(val);
        if (!v) return v === null ? String(val) : '';
        const p = v.split('-');
        if (format === 'MMDDYYYY') return p[1] + p[2] + p[0];
        return p[1] + '/' + p[2] + '/' + p[0];
    }

    function dateOnly(val) {
        if (!val) return '';
        const s = String(val);
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
                // Local calendar date of the timestamp.
                return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
            }
        }
        return toYMD(s) || '';
    }

    // ------------------------------------------------------------------
    // Term helpers
    // ------------------------------------------------------------------
    function schoolYearParts(ay) {
        const m = str(ay).match(/(\d{4})\D+(\d{4})/);
        if (m) return [Number(m[1]), Number(m[2])];
        const one = str(ay).match(/(\d{4})/);
        return one ? [Number(one[1]), Number(one[1]) + 1] : null;
    }

    function formatSchoolYear(ay, lower) {
        const p = schoolYearParts(ay);
        if (!p) return str(ay);
        return p[0] + (lower ? ' to ' : ' TO ') + p[1];
    }

    function semesterCode(sem) {
        const s = str(sem).toUpperCase();
        if (!s) return '';
        if (/^1\b|1ST|FIRST/.test(s)) return '1';
        if (/^2\b|2ND|SECOND/.test(s)) return '2';
        if (/SUMMER|MID\s*-?\s*YEAR|^SUM/.test(s)) return 'SUMMER';
        return s;
    }

    function semesterOrdinal(sem) {
        const c = semesterCode(sem);
        if (c === '1') return '1ST';
        if (c === '2') return '2ND';
        return c;
    }

    /** Approximate calendar window of a term, used only for warnings. */
    function termWindow(ay, sem) {
        const p = schoolYearParts(ay);
        if (!p) return null;
        const c = semesterCode(sem);
        if (c === '1') return { start: p[0] + '-08-01', end: p[0] + '-12-31' };
        if (c === '2') return { start: p[1] + '-01-01', end: p[1] + '-05-31' };
        if (c === 'SUMMER') return { start: p[1] + '-06-01', end: p[1] + '-07-31' };
        return null;
    }

    function normalizeDays(val) {
        const raw = str(val);
        if (!raw) return '';
        const s = raw.replace(/\s+/g, '').toUpperCase();
        const order = ['M', 'T', 'W', 'TH', 'F', 'S', 'SU'];
        const label = { M: 'M', T: 'T', W: 'W', TH: 'Th', F: 'F', S: 'S', SU: 'Su' };
        const range = s.match(/^(MON|M)-(FRI|F|SAT|S)$/);
        if (range) {
            const endIdx = /^S/.test(range[2]) ? 5 : 4;
            return order.slice(0, endIdx + 1).map(function (k) { return label[k]; }).join('');
        }
        const tokens = [];
        let i = 0;
        while (i < s.length) {
            const rest = s.slice(i);
            let m;
            if ((m = rest.match(/^(THURS|THUR|THU|TH|R)/))) { tokens.push('TH'); i += m[0].length; continue; }
            if ((m = rest.match(/^(SUN|SU)/))) { tokens.push('SU'); i += m[0].length; continue; }
            if ((m = rest.match(/^(SAT|SA|S)/))) { tokens.push('S'); i += m[0].length; continue; }
            if ((m = rest.match(/^(MON|MO|M)/))) { tokens.push('M'); i += m[0].length; continue; }
            if ((m = rest.match(/^(TUES|TUE|TU|T)/))) { tokens.push('T'); i += m[0].length; continue; }
            if ((m = rest.match(/^(WED|WE|W)/))) { tokens.push('W'); i += m[0].length; continue; }
            if ((m = rest.match(/^(FRI|FR|F)/))) { tokens.push('F'); i += m[0].length; continue; }
            if (/^[,/&-]/.test(rest)) { i += 1; continue; }
            return raw; // unknown text: leave as typed
        }
        const uniq = order.filter(function (k) { return tokens.indexOf(k) !== -1; });
        return uniq.map(function (k) { return label[k]; }).join('');
    }

    // ------------------------------------------------------------------
    // Classes
    // ------------------------------------------------------------------
    function normalizeLevel(level) {
        const s = String(level || 'BACC').toUpperCase().trim();
        if (s.includes('ELEM') || s === 'SEC' || s.includes('SECONDARY')) return 'ELEM_SEC';
        if (s.includes('VOC') || s.includes('TECH')) return 'TECH_VOC';
        if (s.includes('MASTER')) return 'MASTERS';
        if (s.includes('DOCTOR') || s.includes('PHD')) return 'DOCTORAL';
        return 'BACC';
    }

    function classParts(cls) {
        cls = cls || {};
        return {
            lecUnits: num(cls.lecture_units),
            labUnits: num(cls.lab_units),
            lecHours: num(cls.lecture_hours),
            labHours: num(cls.lab_hours),
            students: Math.max(0, Math.round(num(cls.num_students)))
        };
    }

    /** "LECTURE OR LAB?" column. CTU marks a subject with any lab component as LAB (e.g. CC111 = 2 lec + 1 lab). */
    function lecLabLabel(cls) {
        const p = classParts(cls);
        if (p.labUnits > 0 || p.labHours > 0) return 'LAB';
        if (p.lecUnits > 0 || p.lecHours > 0) return 'LEC';
        return cls && cls.is_lab ? 'LAB' : 'LEC';
    }

    function emptyUnitsRow(lvl) {
        return {
            code: lvl.code, label: lvl.label,
            lecSubjectUnits: 0, labSubjectUnits: 0, totalSubjectUnits: 0,
            lecCreditUnits: 0, labCreditUnits: 0, totalCreditUnits: 0
        };
    }

    function calculateMatrixUnits(classes, options) {
        const opt = resolveOptions(options);
        const matrix = {};
        LEVEL_KEYS.forEach(function (lvl) { matrix[lvl.key] = emptyUnitsRow(lvl); });

        (classes || []).forEach(function (cls) {
            const entry = matrix[normalizeLevel(cls.educational_level)];
            const p = classParts(cls);
            const lecCredit = p.lecUnits * num(opt.lecCreditFactor);
            const labCredit = p.labUnits * num(opt.labCreditFactor);
            entry.lecSubjectUnits += p.lecUnits;
            entry.labSubjectUnits += p.labUnits;
            entry.totalSubjectUnits += p.lecUnits + p.labUnits;
            entry.lecCreditUnits += lecCredit;
            entry.labCreditUnits += labCredit;
            entry.totalCreditUnits += lecCredit + labCredit;
        });

        const totals = emptyUnitsRow({ code: 'C6', label: 'TOTAL TEACHING LOAD:' });
        LEVEL_KEYS.forEach(function (lvl) {
            const e = matrix[lvl.key];
            ['lecSubjectUnits', 'labSubjectUnits', 'totalSubjectUnits', 'lecCreditUnits', 'labCreditUnits', 'totalCreditUnits'].forEach(function (k) {
                e[k] = round2(e[k]);
                totals[k] = round2(totals[k] + e[k]);
            });
        });
        return { matrix: matrix, totals: totals };
    }

    function emptyHoursRow(lvl) {
        return {
            code: lvl.code, label: lvl.label,
            lecHoursPerWeek: 0, labHoursPerWeek: 0, totalHoursPerWeek: 0,
            lecContactHours: 0, labContactHours: 0, totalContactHours: 0
        };
    }

    /**
     * Student-contact hours are summed class by class: hours/week x students of THAT class.
     * (The CTU sample multiplied the column totals, 9 hrs x 158 students = 1,422, which
     * overstates contact hours; the per-class sum for the same load is 363.)
     */
    function calculateMatrixHours(classes) {
        const matrix = {};
        LEVEL_KEYS.forEach(function (lvl) { matrix[lvl.key] = emptyHoursRow(lvl); });

        (classes || []).forEach(function (cls) {
            const entry = matrix[normalizeLevel(cls.educational_level)];
            const p = classParts(cls);
            entry.lecHoursPerWeek += p.lecHours;
            entry.labHoursPerWeek += p.labHours;
            entry.totalHoursPerWeek += p.lecHours + p.labHours;
            entry.lecContactHours += p.lecHours * p.students;
            entry.labContactHours += p.labHours * p.students;
            entry.totalContactHours += (p.lecHours + p.labHours) * p.students;
        });

        const totals = emptyHoursRow({ code: 'D6', label: 'TOTAL TEACHING LOAD:' });
        LEVEL_KEYS.forEach(function (lvl) {
            const e = matrix[lvl.key];
            ['lecHoursPerWeek', 'labHoursPerWeek', 'totalHoursPerWeek', 'lecContactHours', 'labContactHours', 'totalContactHours'].forEach(function (k) {
                e[k] = round2(e[k]);
                totals[k] = round2(totals[k] + e[k]);
            });
        });
        return { matrix: matrix, totals: totals };
    }

    function calculateWorkloadCredits(nonTeachingCredits, teachingSubtotal) {
        const credits = nonTeachingCredits || {};
        function getCreditVal(obj) {
            if (!obj) return 0;
            if (typeof obj === 'number') return obj;
            return num(obj.credits);
        }
        const e1 = getCreditVal(credits.admin);
        const e2 = getCreditVal(credits.research);
        const e3 = getCreditVal(credits.extension);
        const e4 = getCreditVal(credits.production);
        const e5 = getCreditVal(credits.study);
        const e6 = getCreditVal(credits.others);

        const subtotalNonTeaching = round2(e1 + e2 + e3 + e4 + e5 + e6);
        const subtotalTeaching = round2(teachingSubtotal);
        const grandTotal = round2(subtotalNonTeaching + subtotalTeaching);

        return {
            e1: e1, e2: e2, e3: e3, e4: e4, e5: e5, e6: e6,
            subtotalNonTeaching: subtotalNonTeaching,
            subtotalTeaching: subtotalTeaching,
            grandTotal: grandTotal
        };
    }

    function teachingSubtotal(units, hours, options) {
        const opt = resolveOptions(options);
        return opt.teachingCreditBasis === 'credit_units'
            ? units.totals.totalCreditUnits
            : hours.totals.totalHoursPerWeek;
    }

    function computeSummary(report, classes, options) {
        const opt = resolveOptions(options);
        const units = calculateMatrixUnits(classes, opt);
        const hours = calculateMatrixHours(classes);
        const workload = calculateWorkloadCredits((report || {}).non_teaching_credits, teachingSubtotal(units, hours, opt));
        return { units: units, hours: hours, workload: workload, teachingCreditBasis: opt.teachingCreditBasis };
    }

    // ------------------------------------------------------------------
    // Degrees
    // ------------------------------------------------------------------
    function findDegree(degrees, kind) {
        const list = Array.isArray(degrees) ? degrees : [];
        const byLevel = list.find(function (d) { return str(d.level).toUpperCase() === kind; });
        if (byLevel) return byLevel;
        const re = kind === 'BACC' ? /bacc|bachelor/i : (kind === 'MASTERS' ? /master/i : /doctor|phd/i);
        return list.find(function (d) { return re.test(d.level || '') || re.test(d.degree_title || ''); }) || {};
    }

    function hasDegree(d) {
        return !!(d && (str(d.degree_title) || str(d.institution_name)));
    }

    // ------------------------------------------------------------------
    // Validation (rules learned from the CTU sample's data-quality problems)
    // ------------------------------------------------------------------
    function validateReport(report, classes, options) {
        const r = report || {};
        const opt = resolveOptions(options);
        const errors = [];
        const warnings = [];
        function err(field, message) { errors.push({ field: field, message: message }); }
        function warn(field, message) { warnings.push({ field: field, message: message }); }
        function checkDate(field, label, val, required) {
            const v = toYMD(val);
            if (v === null) { err(field, label + ' is not a real calendar date (' + val + ').'); return null; }
            if (!v && required) { err(field, label + ' is required.'); return null; }
            return v || null;
        }
        const today = new Date();
        const todayYMD = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());

        // A. Identification
        if (isBlank(r.faculty_last_name)) err('fieldLastName', 'A4: family name is required.');
        if (isBlank(r.faculty_first_name)) err('fieldFirstName', 'A4: first name is required.');
        if (isBlank(r.email)) err('fieldEmail', 'A5: e-mail address is required.');
        else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r.email))) err('fieldEmail', 'A5: e-mail address is not valid.');
        if (!schoolYearParts(r.academic_year)) err('fieldSchoolYear', 'A1: school year must look like "2026 TO 2027".');
        const birth = checkDate('fieldBirthdate', 'A7: date of birth', r.birthdate, true);
        const appt = checkDate('fieldOriginalAppointment', 'A7: date of original appointment', r.original_appointment_date, true);
        if (birth && birth > todayYMD) err('fieldBirthdate', 'A7: date of birth is in the future.');
        if (appt && appt > todayYMD) err('fieldOriginalAppointment', 'A7: date of original appointment is in the future.');
        if (birth && appt && appt <= birth) err('fieldOriginalAppointment', 'A7: original appointment must be after the date of birth.');
        if (isBlank(r.gender)) err('fieldGender', 'A8: gender is required.');

        // B. Appointment
        const tenure = codeNumber(r.tenure_status_code);
        if (!(tenure >= 1 && tenure <= 3)) err('fieldTenure', 'B1: choose 1 (tenured), 2 (not tenured) or 3 (no PS item).');
        const emp = codeNumber(r.employment_type_code);
        if (!(emp >= 1 && emp <= 3)) err('fieldEmploymentType', 'B2: choose 1 (full-time), 2 (half-time) or 3 (part-time).');
        if (!SALARY_SOURCE_COLUMNS[str(r.salary_charge_to).toUpperCase()]) err('fieldSalaryCharge', 'B4: choose where the basic salary is charged.');
        if (!normalizeRankCode(r.generic_rank_code)) err('fieldRankCode', 'B5: generic faculty rank code is required (e.g. 30 = Assistant Professor).');
        const sg = num(r.salary_grade);
        const annual = num(r.annual_basic_salary);
        const fee = num(r.lecturer_fee_per_hour);
        if (r.has_plantilla_item) {
            if (!(sg >= 1 && sg <= 33)) err('fieldSalaryGrade', 'B6: SSL salary grade must be between 1 and 33.');
            if (!(annual > 0)) err('fieldAnnualSalary', 'B7: annual basic salary is required for a plantilla item.');
        } else if (!(annual > 0) && !(fee > 0)) {
            err('fieldLecturerFee', 'B7: enter the annual basic salary or the lecturer\'s fee per hour.');
        }
        if (annual > 0 && sg >= 10 && annual < 200000) {
            warn('fieldAnnualSalary', 'B7: ' + annual.toLocaleString('en-US') + ' looks like a MONTHLY salary for SG ' + sg +
                '. The form asks for the ANNUAL basic salary (monthly x 12 = ' + (annual * 12).toLocaleString('en-US') + ').');
        }
        [['leave_without_pay', 'B9', 'fieldLeaveWithoutPay'], ['leave_with_pay', 'B10', 'fieldLeaveWithPay']].forEach(function (lv) {
            const L = r[lv[0]] || {};
            const any = !isBlank(L.start_date) || !isBlank(L.end_date) || !isBlank(L.leave_type_code);
            if (!any) return;
            const s = checkDate(lv[2] + 'Start', lv[1] + ': leave start date', L.start_date, true);
            const e = checkDate(lv[2] + 'End', lv[1] + ': leave end date', L.end_date, true);
            if (isBlank(L.leave_type_code)) err(lv[2] + 'Type', lv[1] + ': type of leave code is required.');
            if (s && e && e < s) err(lv[2] + 'End', lv[1] + ': leave end date is before the start date.');
        });
        if (r.is_active_duty === false) {
            const anyLeave = ['leave_without_pay', 'leave_with_pay'].some(function (k) { return !isBlank((r[k] || {}).start_date); });
            if (!anyLeave) warn('fieldActiveDuty', 'B8 is NO: record the leave in B9 or B10.');
        }

        // C. Degrees
        [['BACC', 'Bac', 'C1-C5', false], ['MASTERS', 'Master', 'C6-C10', 'wrote_thesis'], ['DOCTORAL', 'Doc', 'C11-C15', 'wrote_dissertation']].forEach(function (cfg) {
            const d = findDegree(r.degrees_snapshot, cfg[0]);
            const p = 'field' + cfg[1];
            if (!hasDegree(d)) {
                if (cfg[0] === 'BACC') err(p + 'Title', cfg[2] + ': baccalaureate degree is required.');
                return;
            }
            const status = codeNumber(d.status_code);
            if (!(status >= 1 && status <= 4)) err(p + 'Status', cfg[2] + ': choose the degree status (1-4).');
            const done = checkDate(p + 'Date', cfg[2] + ': date completed', d.date_completed, status === DEGREE_STATUS.COMPLETED);
            if (status && status !== DEGREE_STATUS.COMPLETED && (done || toYMD(d.date_completed) === null)) {
                err(p + 'Date', cfg[2] + ': status is "' + ['', 'completed', 'still being pursued', 'started but uncompleted', 'not yet started'][status] +
                    '" so the date completed must be blank.');
            }
            if (done && done > todayYMD) err(p + 'Date', cfg[2] + ': date completed is in the future.');
            if (cfg[3] && d[cfg[3]] && status !== DEGREE_STATUS.COMPLETED) {
                err(p + (cfg[0] === 'MASTERS' ? 'Thesis' : 'Dissertation'), cfg[2] + ': a ' + (cfg[0] === 'MASTERS' ? 'thesis' : 'dissertation') +
                    ' can only be marked YES for a completed degree.');
            }
            if (isBlank(d.institution_name)) err(p + 'School', cfg[2] + ': where obtained is required.');
            if (!isSixDigitCode(d.discipline_code)) err(p + 'Discipline', cfg[2] + ': specific discipline must be a 6-digit code.');
        });

        // D. Teaching discipline
        if (!isSixDigitCode(r.primary_discipline_teaching)) err('fieldPrimaryDisciplineTeaching', 'D1: first teaching discipline must be a 6-digit code.');
        if (!isBlank(r.secondary_discipline_teaching) && !isSixDigitCode(r.secondary_discipline_teaching)) {
            err('fieldSecondaryDisciplineTeaching', 'D2: second teaching discipline must be a 6-digit code.');
        }

        // E. Non-teaching load credits
        const term = termWindow(r.academic_year, r.semester);
        const nt = r.non_teaching_credits || {};
        NON_TEACHING_ROWS.forEach(function (row, idx) {
            const e = nt[row.key] || {};
            const field = 'fieldE' + (idx + 1);
            const credits = num(e.credits);
            if (credits < 0) err(field + 'Credits', row.code + ': credits cannot be negative.');
            const s = checkDate(field + 'Start', row.code + ': start date', e.start_date, false);
            const en = checkDate(field + 'End', row.code + ': end date', e.end_date, false);
            if (credits > 0 && isBlank(e.details)) err(field + 'Details', row.code + ': specify the details (e.g. designation or project title).');
            if (credits > 0 && (!s || !en)) err(field + 'Start', row.code + ': start and end dates are required when credits are claimed.');
            if (s && en && en < s) err(field + 'End', row.code + ': end date is before the start date.');
            if (credits > 0 && s && en && term && (en < term.start || s > term.end)) {
                warn(field + 'Start', row.code + ': ' + formatDateDisplay(s) + ' - ' + formatDateDisplay(en) +
                    ' does not overlap the ' + semesterOrdinal(r.semester) + ' semester of ' + formatSchoolYear(r.academic_year) + '.');
            }
        });

        // Part 2: schedule of classes
        const list = classes || [];
        if (!list.length) warn('classesTbody', 'No classes listed in the schedule of classes.');
        list.forEach(function (cls, i) {
            const tag = 'Class A' + (i + 1);
            const p = classParts(cls);
            if (isBlank(cls.subject_code_title)) err('classesTbody', tag + ': subject number & title is required.');
            if (p.lecUnits + p.labUnits <= 0) err('classesTbody', tag + ': enter the lecture and/or lab units.');
            if (p.lecUnits > 0 && p.lecHours <= 0) err('classesTbody', tag + ': lecture units need lecture hours per week.');
            if (p.labUnits > 0 && p.labHours <= 0) err('classesTbody', tag + ': lab units need lab hours per week.');
            if (!(num(cls.num_students) > 0)) err('classesTbody', tag + ': number of students is required.');
            if (isBlank(cls.schedule_days) || isBlank(cls.schedule_time)) warn('classesTbody', tag + ': days and time are blank.');
        });

        const c = r.consultation_hours || {};
        if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].some(function (k) { return !isBlank(c[k]); })) {
            warn('consultMon', 'No consultation hours specified.');
        }

        const summary = computeSummary(r, list, opt);
        if (opt.maxGrandTotal && summary.workload.grandTotal > opt.maxGrandTotal) {
            warn('displayE9Total', 'E9: grand total of ' + summary.workload.grandTotal + ' exceeds the allowed ' + opt.maxGrandTotal + '.');
        }

        return { errors: errors, warnings: warnings, ok: errors.length === 0 };
    }

    // ------------------------------------------------------------------
    // Sheet model (CTU template)
    // ------------------------------------------------------------------
    const COLS = 'ABCDEFGHIJK';

    function colIndex(letter) { return COLS.indexOf(letter) + 1; }

    function splitAddr(addr) {
        const m = /^([A-Z]+)(\d+)$/.exec(addr);
        return { col: m[1], row: Number(m[2]) };
    }

    function printedName(r) {
        const first = str(r.faculty_first_name).toUpperCase();
        const mi = str(r.faculty_middle_initial).replace(/\.+$/, '').toUpperCase();
        const last = str(r.faculty_last_name).toUpperCase();
        const parts = [first, mi ? mi + '.' : '', last].filter(Boolean);
        return parts.length ? parts.join(' ') : str(r.faculty_printed_name).toUpperCase();
    }

    function buildSheetModel(report, classes, options) {
        if (!TEMPLATE) throw new Error('form-e0-template.js must be loaded before form-e0-engine.js');
        const r = report || {};
        const list = classes || [];
        const tpl = getTemplate();
        if (!tpl) {
            throw new Error('CHED Form E-0 template (form-e0-template.js) is not loaded.');
        }
        const opt = resolveOptions(options);
        const summary = computeSummary(r, list, opt);
        const extra = Math.max(0, list.length - ROW.CLASS_TEMPLATE_SLOTS);
        const shift = function (row) { return row > ROW.CLASS_LAST ? row + extra : row; };

        const cells = {};
        tpl.CELLS.forEach(function (c) {
            const a = splitAddr(c[0]);
            cells[a.col + shift(a.row)] = { s: c[1], v: c[2], label: c[2] != null };
        });

        const rowHeights = {};
        Object.keys(tpl.ROW_HEIGHTS).forEach(function (k) {
            rowHeights[shift(Number(k))] = tpl.ROW_HEIGHTS[k];
        });
        const merges = tpl.MERGES.map(function (m) {
            return [shift(m[0]), m[1], shift(m[2]), m[3]];
        });

        // Extra schedule rows (10th class onward) copy the style of the last template slot.
        for (let i = 1; i <= extra; i++) {
            const row = ROW.CLASS_LAST + i;
            COLS.split('').forEach(function (col) {
                const src = cells[col + ROW.CLASS_LAST];
                if (src) cells[col + row] = { s: src.s, v: null };
            });
            cells['A' + row] = { s: (cells['A' + ROW.CLASS_LAST] || {}).s || tpl.DEFAULT_STYLE, v: 'A' + (ROW.CLASS_TEMPLATE_SLOTS + i) };
            rowHeights[row] = tpl.ROW_HEIGHTS[ROW.CLASS_LAST];
            merges.push([row, colIndex('G'), row, colIndex('H')]);
        }

        function put(addr, value, type) {
            const a = splitAddr(addr);
            const key = a.col + shift(a.row);
            const cell = cells[key] || { s: tpl.DEFAULT_STYLE, v: null };
            cell.label = false;
            if (value === '' || value == null) {
                cell.v = null;
                delete cell.t;
            } else if (type === 'date') {
                const v = toYMD(value);
                if (v) { cell.v = v; cell.t = 'date'; } else { cell.v = String(value); delete cell.t; }
            } else {
                cell.v = value;
                delete cell.t;
            }
            cells[key] = cell;
        }
        function putNum(addr, value, blankZero) {
            const n = num(value);
            put(addr, blankZero && !n ? '' : n);
        }

        const schoolYear = formatSchoolYear(r.academic_year);
        const sem = semesterCode(r.semester);

        // ---- PAGE 1: A. identification ----
        put('B4', 'SEMESTER ( 1/2/ SUMMER) _______' + (sem || '') + '________');
        put('D4', 'SCHOOLYEAR:   ' + schoolYear);
        put('B5', 'COLLEGE : ' + str(r.college_name));
        put('D5', 'DEPARTMENT: ' + str(r.department_name));
        put('B6', 'CODE NUMBER: ' + str(r.discipline_code).replace(/\.0+$/, ''));
        put('C7', str(r.faculty_last_name).toUpperCase());
        put('E7', str(r.faculty_first_name).toUpperCase());
        put('G7', str(r.faculty_middle_initial).replace(/\.+$/, '').toUpperCase());
        put('B9', 'E-MAIL ADDRESS: ' + str(r.email));
        put('B10', 'CONTACT PHONE NUMBER: ' + str(r.phone));
        put('C11', r.birthdate, 'date');
        put('I11', r.original_appointment_date, 'date');
        put('C12', str(r.gender).toUpperCase());

        // ---- B. appointment ----
        put('D15', codeNumber(r.tenure_status_code));
        put('D16', codeNumber(r.employment_type_code));
        put('D17', r.has_plantilla_item == null ? '' : (r.has_plantilla_item ? 'YES' : 'NO'));
        const salaryCol = SALARY_SOURCE_COLUMNS[str(r.salary_charge_to).toUpperCase()];
        Object.keys(SALARY_SOURCE_COLUMNS).forEach(function (k) {
            put(SALARY_SOURCE_COLUMNS[k] + '18', SALARY_SOURCE_COLUMNS[k] === salaryCol ? '/' : '');
        });
        const rank = normalizeRankCode(r.generic_rank_code);
        put('C20', rank ? (rank.charAt(0) === '0' ? rank : Number(rank)) : '');
        putNum('C21', r.salary_grade, true);
        putNum('C22', r.annual_basic_salary, true);
        putNum('F22', r.lecturer_fee_per_hour, true);
        put('D23', r.is_active_duty === false ? 'NO' : 'YES');
        [['leave_without_pay', 24], ['leave_with_pay', 26]].forEach(function (lv) {
            const L = r[lv[0]] || {};
            put('C' + lv[1], L.start_date, 'date');
            put('E' + lv[1], L.end_date, 'date');
            put('I' + lv[1], str(L.leave_type_code));
        });

        // ---- C. degrees ----
        const degreeRows = [
            { kind: 'BACC', title: 'C30', status: 'I31', date: 'C32', school: 'C33', code: 'D34' },
            { kind: 'MASTERS', title: 'C36', status: 'I37', date: 'C38', school: 'C39', code: 'D40', paper: 'D41', paperKey: 'wrote_thesis' },
            { kind: 'DOCTORAL', title: 'C43', status: 'I44', date: 'C45', school: 'C46', code: 'D47', paper: 'D48', paperKey: 'wrote_dissertation' }
        ];
        degreeRows.forEach(function (cfg) {
            const d = findDegree(r.degrees_snapshot, cfg.kind);
            if (!hasDegree(d)) return;
            const status = codeNumber(d.status_code);
            put(cfg.title, str(d.degree_title));
            put(cfg.status, status);
            put(cfg.date, status === DEGREE_STATUS.COMPLETED ? d.date_completed : '', 'date');
            put(cfg.school, str(d.institution_name));
            put(cfg.code, sixDigit(d.discipline_code));
            if (cfg.paper) put(cfg.paper, d[cfg.paperKey] ? 'YES' : 'NO');
        });

        // ---- D. discipline of teaching load ----
        put('G51', sixDigit(r.primary_discipline_teaching));
        put('G52', sixDigit(r.secondary_discipline_teaching));

        // ---- E. non-teaching load credits ----
        const nt = r.non_teaching_credits || {};
        NON_TEACHING_ROWS.forEach(function (row) {
            const e = nt[row.key] || {};
            const used = num(e.credits) > 0 || !isBlank(e.details);
            putNum('C' + row.row, e.credits, true);
            put('D' + row.row, used ? e.start_date : '', 'date');
            put('E' + row.row, used ? e.end_date : '', 'date');
            put('F' + row.row, str(e.details));
        });
        putNum('C64', summary.workload.subtotalNonTeaching, true);
        putNum('C65', summary.workload.subtotalTeaching, true);
        putNum('C66', summary.workload.grandTotal, false);

        // ---- PAGE 2 ----
        put('B74', 'SEM /TRIM  ' + semesterOrdinal(r.semester) + '  SCHOOLYEAR  ' + formatSchoolYear(r.academic_year, true));

        list.forEach(function (cls, i) {
            const row = ROW.CLASS_FIRST + i; // rows past the template slots were inserted above
            const set = function (col, v) {
                const key = col + row;
                const cell = cells[key] || { s: tpl.DEFAULT_STYLE, v: null };
                cell.label = false;
                cell.v = (v === '' || v == null) ? null : v;
                cells[key] = cell;
            };
            set('B', (i + 1) + '. ' + str(cls.subject_code_title));
            set('C', str(cls.class_code));
            set('D', str(cls.schedule_days));
            set('E', str(cls.schedule_time));
            set('F', str(cls.room));
            set('G', lecLabLabel(cls));
            set('I', cls.is_team_teaching ? 'YES' : 'NO');
            set('J', classParts(cls).students || '');
        });

        const consult = r.consultation_hours || {};
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(function (k, i) {
            put('C' + (91 + i), str(consult[k]));
        });

        LEVEL_KEYS.concat([{ key: '__TOTAL__' }]).forEach(function (lvl, i) {
            const u = lvl.key === '__TOTAL__' ? summary.units.totals : summary.units.matrix[lvl.key];
            const h = lvl.key === '__TOTAL__' ? summary.hours.totals : summary.hours.matrix[lvl.key];
            const ru = ROW.MATRIX_UNITS_FIRST + i;
            const rh = ROW.MATRIX_HOURS_FIRST + i;
            putNum('C' + ru, u.lecSubjectUnits, true);
            putNum('D' + ru, u.labSubjectUnits, true);
            putNum('E' + ru, u.totalSubjectUnits, true);
            putNum('F' + ru, u.lecCreditUnits, true);
            putNum('G' + ru, u.labCreditUnits, true);
            putNum('I' + ru, u.totalCreditUnits, true);
            putNum('C' + rh, h.lecHoursPerWeek, true);
            putNum('D' + rh, h.labHoursPerWeek, true);
            putNum('E' + rh, h.totalHoursPerWeek, true);
            putNum('F' + rh, h.lecContactHours, true);
            putNum('G' + rh, h.labContactHours, true);
            putNum('I' + rh, h.totalContactHours, true);
        });

        // ---- Signatories ----
        const proxyNote = r.is_signed_by_chair_proxy ? ' (FILLED UP BY DEPARTMENT CHAIR ON BEHALF OF FACULTY MEMBER)' : '';
        put('B119', 'PRINTED NAME AND SIGNATURE OF FACULTY MEMBER: ' + printedName(r) + proxyNote);
        put('I119', 'DATE: ' + formatDateDisplay(dateOnly(r.submitted_at)));
        put('B121', 'PRINTED NAME AND SIGNATURE OF DEPARTMENT CHAIR:' + str(r.chair_certified_by_name).toUpperCase());
        put('I121', 'DATE:' + (r.chair_certified_at ? ' ' + formatDateDisplay(dateOnly(r.chair_certified_at)) : ''));
        if (str(r.final_approved_by_name)) {
            put('B123', 'PRINTED NAME AND SIGNATURE OF COLLEGE DEAN:' + str(r.final_approved_by_name).toUpperCase());
            put('I123', 'DATE: ' + formatDateDisplay(dateOnly(r.final_approved_at)));
        }

        return {
            sheetName: tpl.SHEET_NAME,
            columnCount: tpl.COLUMN_COUNT,
            rowCount: tpl.ROW_COUNT + extra,
            columnWidths: tpl.COLUMN_WIDTHS.slice(),
            defaultRowHeight: tpl.DEFAULT_ROW_HEIGHT,
            rowHeights: rowHeights,
            merges: merges,
            styles: tpl.STYLES,
            defaultStyle: tpl.DEFAULT_STYLE,
            pageBreakAfterRow: tpl.PAGE_BREAK_AFTER_ROW,
            cells: cells,
            summary: summary
        };
    }

    function cellDisplay(cell) {
        if (!cell || cell.v == null) return '';
        if (cell.t === 'date') return formatDateDisplay(cell.v);
        return cell.v;
    }

    /** Legacy array-of-arrays output (11 columns, A..K), now derived from the sheet model. */
    function generateChedFormE0Rows(report, classes, options) {
        const model = buildSheetModel(report, classes, options);
        const rows = [];
        for (let r = 1; r <= model.rowCount; r++) {
            const row = [];
            for (let c = 0; c < model.columnCount; c++) {
                const v = cellDisplay(model.cells[COLS[c] + r]);
                row.push(v === '' ? '' : v);
            }
            rows.push(row);
        }
        return rows;
    }

    // ------------------------------------------------------------------
    // Excel export
    // ------------------------------------------------------------------
    function excelJsStyle(st) {
        const out = {};
        if (st.font) {
            out.font = { name: st.font.name, size: st.font.size };
            if (st.font.bold) out.font.bold = true;
            if (st.font.italic) out.font.italic = true;
            if (st.font.underline) out.font.underline = true;
        }
        const b = st.border || {};
        const border = {};
        ['top', 'left', 'bottom', 'right'].forEach(function (k) {
            if (b[k]) border[k] = { style: b[k], color: { argb: 'FF000000' } };
        });
        if (Object.keys(border).length) out.border = border;
        const align = {};
        if (st.h) align.horizontal = st.h;
        if (st.v) align.vertical = st.v;
        if (st.wrap) align.wrapText = true;
        if (Object.keys(align).length) out.alignment = align;
        if (st.numFmt && st.numFmt !== 'General') out.numFmt = st.numFmt;
        return out;
    }

    /** Builds an ExcelJS workbook that reproduces the CTU template (fonts, borders, merges, widths, page break). */
    function buildExcelJsWorkbook(ExcelJS, report, classes, options) {
        const model = buildSheetModel(report, classes, options);
        const wb = new ExcelJS.Workbook();
        wb.creator = 'CITE-Flow';
        wb.created = new Date();
        const ws = wb.addWorksheet(model.sheetName, {
            pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
            properties: { defaultRowHeight: model.defaultRowHeight }
        });
        ws.columns = model.columnWidths.map(function (w) { return { width: w }; });
        // Merge first: ExcelJS copies the master style onto covered cells when merging,
        // so the per-cell styles (e.g. the right border of a merged box) are applied afterwards.
        model.merges.forEach(function (m) { ws.mergeCells(m[0], m[1], m[2], m[3]); });

        const styleCache = model.styles.map(function (st) { return st ? excelJsStyle(st) : {}; });
        for (let r = 1; r <= model.rowCount; r++) {
            const row = ws.getRow(r);
            if (model.rowHeights[r]) row.height = model.rowHeights[r];
            for (let c = 1; c <= model.columnCount; c++) {
                const addr = COLS[c - 1] + r;
                const cell = model.cells[addr];
                const sid = cell ? cell.s : model.defaultStyle;
                const xc = row.getCell(c);
                const st = styleCache[sid] || {};
                xc.style = {};
                if (st.font) xc.font = st.font;
                if (st.border) xc.border = st.border;
                if (st.alignment) xc.alignment = st.alignment;
                if (st.numFmt) xc.numFmt = st.numFmt;
                if (!cell || cell.v == null || xc.isMerged && xc.master !== xc) continue;
                if (cell.t === 'date') {
                    const p = cell.v.split('-').map(Number);
                    xc.value = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
                    xc.numFmt = 'mm/dd/yyyy';
                } else {
                    xc.value = cell.v;
                    if (typeof cell.v === 'string' && cell.v.indexOf('\n') !== -1) {
                        xc.alignment = Object.assign({}, xc.alignment || {}, { wrapText: true });
                    }
                }
            }
        }
        if (model.pageBreakAfterRow) ws.getRow(model.pageBreakAfterRow).addPageBreak();
        return wb;
    }

    function exportFileName(report) {
        const r = report || {};
        const clean = function (v) { return str(v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''); };
        const who = [clean(r.faculty_last_name), clean(r.faculty_first_name)].filter(Boolean).join('_') || clean(r.faculty_printed_name) || 'FACULTY';
        const sy = schoolYearParts(r.academic_year);
        return 'FORM-E0-' + who + '-' + semesterOrdinal(r.semester) + 'SEM' + (sy ? '-' + sy[0] + '-' + sy[1] : '') + '.xlsx';
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    async function exportToExcel(report, classes, options) {
        if (typeof window === 'undefined') return null;
        const filename = exportFileName(report);
        if (window.ExcelJS) {
            const wb = buildExcelJsWorkbook(window.ExcelJS, report, classes, options);
            const buf = await wb.xlsx.writeBuffer();
            downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
            return true;
        }
        if (window.XLSX) {
            // Fallback without cell styling: values, merges and column widths only.
            const model = buildSheetModel(report, classes, options);
            const ws = window.XLSX.utils.aoa_to_sheet(generateChedFormE0Rows(report, classes, options));
            ws['!merges'] = model.merges.map(function (m) { return { s: { r: m[0] - 1, c: m[1] - 1 }, e: { r: m[2] - 1, c: m[3] - 1 } }; });
            ws['!cols'] = model.columnWidths.map(function (w) { return { wch: w }; });
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, model.sheetName.slice(0, 31));
            window.XLSX.writeFile(wb, filename);
            return true;
        }
        throw new Error('The Excel export library (ExcelJS) is not loaded. Check your internet connection and reload the page.');
    }

    // ------------------------------------------------------------------
    // HTML rendering of the sheet (Official Form Preview / reviewer view)
    // ------------------------------------------------------------------
    function escHtml(val) {
        return String(val == null ? '' : val).replace(/[&<>'"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
        });
    }

    function cssForStyle(st) {
        if (!st) return '';
        const css = [];
        if (st.font) {
            css.push('font-family:' + (st.font.name === 'Arial Black' ? "'Arial Black',Arial" : 'Arial') + ',Helvetica,sans-serif');
            css.push('font-size:' + st.font.size + 'pt');
            if (st.font.bold) css.push('font-weight:bold');
            if (st.font.italic) css.push('font-style:italic');
            if (st.font.underline) css.push('text-decoration:underline');
        }
        const b = st.border || {};
        ['top', 'right', 'bottom', 'left'].forEach(function (k) {
            if (b[k]) css.push('border-' + k + ':' + (b[k] === 'medium' ? '2px' : '1px') + ' solid #000');
        });
        if (st.h) css.push('text-align:' + (st.h === 'centerContinuous' ? 'center' : st.h));
        css.push('vertical-align:' + (st.v === 'top' ? 'top' : (st.v === 'bottom' ? 'bottom' : 'middle')));
        if (st.wrap) css.push('white-space:pre-wrap');
        return css.join(';');
    }

    /**
     * Renders the sheet model as an HTML table that mirrors the Excel layout.
     * Returns markup for page 1 and page 2 separated by a print page break.
     */
    function renderSheetHtml(model, opts) {
        opts = opts || {};
        const pxWidths = model.columnWidths.map(function (w) { return Math.round(w * 7 + 5); });
        const covered = {};
        const spans = {};
        model.merges.forEach(function (m) {
            spans[COLS[m[1] - 1] + m[0]] = { rows: m[2] - m[0] + 1, cols: m[3] - m[1] + 1 };
            for (let r = m[0]; r <= m[2]; r++) {
                for (let c = m[1]; c <= m[3]; c++) {
                    if (r !== m[0] || c !== m[1]) covered[COLS[c - 1] + r] = true;
                }
            }
        });
        const highlight = opts.highlightValues !== false;
        const hasText = function (addr) {
            const c = model.cells[addr];
            return !!(c && c.v != null && c.v !== '');
        };
        const formatNumber = function (n, st) {
            if (st && /#,##0/.test(st.numFmt || '')) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
            return String(Math.round(n * 100) / 100);
        };

        function table(fromRow, toRow) {
            let html = '<table class="e0-sheet-table" style="border-collapse:collapse;table-layout:fixed;width:' +
                pxWidths.reduce(function (a, b) { return a + b; }, 0) + 'px">';
            html += '<colgroup>' + pxWidths.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>';
            for (let r = fromRow; r <= toRow; r++) {
                const h = Math.round((model.rowHeights[r] || model.defaultRowHeight) * 4 / 3);
                html += '<tr style="height:' + h + 'px">';
                for (let c = 0; c < model.columnCount; c++) {
                    const addr = COLS[c] + r;
                    if (covered[addr]) continue;
                    const cell = model.cells[addr];
                    const st = model.styles[cell ? cell.s : model.defaultStyle];
                    const span = spans[addr];
                    const text = cellDisplay(cell);
                    const s = String(text);
                    let css = cssForStyle(st) + ';padding:0 3px';
                    let inner = escHtml(typeof text === 'number' ? formatNumber(text, st) : s);
                    if (s.indexOf('\n') !== -1) css += ';white-space:pre-line;line-height:1.15;overflow:hidden';
                    else if (!(st && st.wrap)) {
                        // Like Excel: left-aligned text spills into empty neighbours and is cut off at the first filled one.
                        const leftAligned = !(st && st.h && st.h !== 'left') && typeof text !== 'number';
                        css += ';white-space:nowrap;overflow:' + (s && typeof text !== 'number' ? 'visible' : 'hidden');
                        if (leftAligned && s) {
                            let width = 0;
                            for (let k = c; k < c + (span ? span.cols : 1); k++) width += pxWidths[k];
                            for (let k = c + (span ? span.cols : 1); k < model.columnCount; k++) {
                                const nAddr = COLS[k] + r;
                                if (covered[nAddr] || hasText(nAddr)) break;
                                width += pxWidths[k];
                            }
                            inner = '<div style="width:' + (width - 6) + 'px;overflow:hidden">' + inner + '</div>';
                        }
                    } else css += ';overflow:hidden';
                    if (typeof text === 'number' && !(st && st.h)) css += ';text-align:right';
                    const attrs = (span && span.cols > 1 ? ' colspan="' + span.cols + '"' : '') + (span && span.rows > 1 ? ' rowspan="' + span.rows + '"' : '');
                    const isValue = highlight && cell && cell.v != null && !cell.label;
                    html += '<td' + attrs + ' data-cell="' + addr + '" style="' + css + '"' + (isValue ? ' class="e0-val"' : '') + '>' + inner + '</td>';
                }
                html += '</tr>';
            }
            return html + '</table>';
        }

        const brk = model.pageBreakAfterRow || model.rowCount;
        return '<div class="e0-sheet">' +
            '<div class="e0-sheet-page">' +
                '<div class="e0-page-caption no-print">Page 1 of 2 &middot; Part 1: Faculty Profile, Degrees &amp; Load Credits</div>' +
                table(1, brk) +
            '</div>' +
            '<div class="e0-sheet-break"></div>' +
            '<div class="e0-sheet-page">' +
                '<div class="e0-page-caption no-print">Page 2 of 2 &middot; Part 2: Schedule of Classes, Consultation Hours &amp; Summary Matrices</div>' +
                table(brk + 1, model.rowCount) +
            '</div>' +
            '</div>';
    }

    return {
        LEVEL_KEYS: LEVEL_KEYS,
        GENERIC_RANK_CODES: GENERIC_RANK_CODES,
        NON_TEACHING_ROWS: NON_TEACHING_ROWS,
        SALARY_SOURCE_COLUMNS: SALARY_SOURCE_COLUMNS,
        DEFAULT_OPTIONS: DEFAULT_OPTIONS,
        parseDateToYMD: parseDateToYMD,
        toYMD: toYMD,
        formatDateDisplay: formatDateDisplay,
        formatSchoolYear: formatSchoolYear,
        semesterCode: semesterCode,
        semesterOrdinal: semesterOrdinal,
        normalizeLevel: normalizeLevel,
        normalizeCode: normalizeCode,
        normalizeRankCode: normalizeRankCode,
        rankCodeFromText: rankCodeFromText,
        rankLabel: rankLabel,
        sslGradeFromRank: sslGradeFromRank,
        normalizeGender: normalizeGender,
        normalizeDays: normalizeDays,
        lecLabLabel: lecLabLabel,
        findDegree: findDegree,
        calculateMatrixUnits: calculateMatrixUnits,
        calculateMatrixHours: calculateMatrixHours,
        calculateWorkloadCredits: calculateWorkloadCredits,
        computeSummary: computeSummary,
        validateReport: validateReport,
        buildSheetModel: buildSheetModel,
        generateChedFormE0Rows: generateChedFormE0Rows,
        buildExcelJsWorkbook: buildExcelJsWorkbook,
        exportFileName: exportFileName,
        exportToExcel: exportToExcel,
        renderSheetHtml: renderSheetHtml
    };
});
