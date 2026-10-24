(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.CiteFlowWorkloadImport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const MAX_FILE_BYTES = 8 * 1024 * 1024;
    const MAX_ROWS = 1500;
    const OCR_MESSAGE = 'This PDF has no selectable text. OCR is not available, so a scanned workload report cannot be imported. Use an Excel file or a text-based PDF.';
    const UNRELIABLE_PDF = 'The PDF text could not be mapped to workload rows. Nothing was imported. Use an Excel file or a PDF with a clear table header.';
    const PARTIAL_NOTICE = 'Each assignment is saved separately. If a later row fails, earlier rows stay saved.';
    const CONFIRMED = { matched_id: 1, matched_email: 1, matched_name: 1, confirmed_suggestion: 1, manual: 1 };

    const HEADER_FIELDS = [
        { field: 'facultyName', aliases: ['faculty name', 'full name', 'name', 'faculty', 'instructor', 'instructor name', 'professor', 'professor name', 'teacher', 'teacher name', 'faculty member', 'name of faculty', 'employee name'] },
        { field: 'employeeId', aliases: ['employee id', 'employee no', 'employee number', 'emp id', 'emp no', 'id number', 'id no', 'faculty id', 'faculty number', 'staff id'] },
        { field: 'email', aliases: ['email', 'e mail', 'email address', 'faculty email', 'institutional email'] },
        { field: 'department', aliases: ['department', 'dept', 'college', 'department name', 'faculty department'] },
        { field: 'subject_code', aliases: ['subject code', 'course code', 'course no', 'course number', 'subj code', 'subject no', 'subject number', 'subject', 'course'] },
        { field: 'subject_title', aliases: ['subject title', 'course title', 'descriptive title', 'subject name', 'course name', 'description', 'title'] },
        { field: 'section', aliases: ['section', 'class section', 'block', 'sec'] },
        { field: 'units', aliases: ['units', 'unit', 'credit units', 'credit unit', 'lec units', 'no of units', 'number of units'] },
        { field: 'hours_per_week', aliases: ['hours per week', 'hours week', 'hrs week', 'hrs per week', 'teaching hours', 'contact hours', 'hours', 'hrs', 'no of hours'] },
        { field: 'semester', aliases: ['semester', 'term', 'sem'] },
        { field: 'academic_year', aliases: ['academic year', 'school year', 'school yr', 'acad year', 'ay', 'sy'] },
        { field: 'total_students', aliases: ['total students', 'no of students', 'number of students', 'students', 'class size', 'enrollment'] },
        { field: 'room', aliases: ['room', 'venue', 'classroom', 'room no'] },
        { field: 'remarks', aliases: ['remarks', 'remark', 'notes', 'note'] },
        { field: 'scheduleText', aliases: ['schedule', 'class schedule', 'day time', 'day and time', 'time schedule'] }
    ];

    const IGNORED_HEADERS = [
        { aliases: ['no', 'row', 'row no', 'row number'], reason: 'Row number is not a workload field.' },
        { aliases: ['role', 'designation'], reason: 'Role describes the person. This import does not change faculty roles.' },
        { aliases: ['year level', 'yr level'], reason: 'Year level is not a teaching-assignment field.' },
        { aliases: ['subjects', 'subject count', 'no of subjects', 'number of subjects', 'preparations'], reason: 'This column is a count of subjects. It was not turned into individual subject codes or titles.' },
        { aliases: ['advisees', 'advisee', 'advisory', 'advisory load'], reason: 'Advisee count is not class enrollment, so it was not imported as students.' },
        { aliases: ['points', 'point', 'score'], reason: 'Points has no teaching-assignment field.' },
        { aliases: ['status', 'account status'], reason: 'This status describes the person, not a teaching assignment.' }
    ];

    const TARGET_LABELS = {
        facultyName: 'Faculty',
        employeeId: 'Employee ID',
        email: 'Email',
        department: 'Department',
        subject_code: 'Subject code',
        subject_title: 'Subject title',
        section: 'Section',
        units: 'Units',
        hours_per_week: 'Hours/week',
        semester: 'Semester',
        academic_year: 'Academic year',
        total_students: 'Students',
        room: 'Room',
        remarks: 'Remarks',
        scheduleText: 'Schedule'
    };

    const REQUIRED_TARGETS = [
        ['subject_code', 'Subject code'],
        ['subject_title', 'Subject title'],
        ['section', 'Section'],
        ['units', 'Units'],
        ['semester', 'Semester'],
        ['academic_year', 'Academic year']
    ];

    const RAW_FIELDS = ['facultyName', 'employeeId', 'email', 'department', 'subject_code', 'subject_title', 'section', 'units', 'hours_per_week', 'semester', 'academic_year', 'total_students', 'room', 'remarks', 'scheduleText'];

    function collapse(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function blankRaw() {
        const raw = {};
        RAW_FIELDS.forEach((field) => { raw[field] = ''; });
        return raw;
    }

    function unique(list) {
        const seen = {};
        const out = [];
        (list || []).forEach((item) => {
            const key = String(item || '');
            if (!key || seen[key]) return;
            seen[key] = 1;
            out.push(key);
        });
        return out;
    }

    function normHeader(value) {
        return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function headerField(value) {
        const normalized = normHeader(value);
        if (!normalized) return '';
        for (let i = 0; i < HEADER_FIELDS.length; i++) {
            if (HEADER_FIELDS[i].aliases.indexOf(normalized) !== -1) return HEADER_FIELDS[i].field;
        }
        return '';
    }

    function ignoredHeader(value) {
        const normalized = normHeader(value);
        if (!normalized) return null;
        for (let i = 0; i < IGNORED_HEADERS.length; i++) {
            if (IGNORED_HEADERS[i].aliases.indexOf(normalized) !== -1) return IGNORED_HEADERS[i];
        }
        return null;
    }

    function cellString(value) {
        if (value == null) return '';
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'boolean') return '';
        if (typeof value === 'object') return collapse(value.text || value.w || value.v || '');
        return collapse(value);
    }

    function validateWorkloadFile(file) {
        if (!file) return { ok: false, code: 'empty', message: 'Choose a PDF or Excel file.' };
        const size = Number(file.size);
        if (!Number.isFinite(size) || size <= 0) return { ok: false, code: 'empty', message: 'The file is empty.' };
        if (size > MAX_FILE_BYTES) return { ok: false, code: 'too_large', message: 'The file is larger than 8 MB.' };
        const name = String(file.name || '');
        const ext = name.toLowerCase().split('.').pop();
        if (!name || name.indexOf('.') === -1 || ['pdf', 'xlsx', 'xls'].indexOf(ext) === -1) {
            return { ok: false, code: 'unsupported', message: 'Unsupported file. Use a .pdf, .xlsx, or .xls file.' };
        }
        return { ok: true, kind: ext === 'pdf' ? 'pdf' : 'excel', extension: ext };
    }

    function scoreHeaderCells(cells) {
        const columns = {};
        const ignored = [];
        const unmapped = [];
        let seen = 0;
        let detail = null;
        cells.forEach((cell, index) => {
            const text = typeof cell === 'string' ? cell : cell.text;
            const label = collapse(text);
            if (!label) return;
            seen += 1;
            const meta = {
                index,
                x: cell && cell.x != null && Number.isFinite(Number(cell.x)) ? Number(cell.x) : index,
                width: cell && Number(cell.width) > 0 ? Number(cell.width) : 0,
                label
            };
            if (seen === 8) detail = meta;
            const skipped = ignoredHeader(label);
            if (skipped) {
                ignored.push(Object.assign({ reason: skipped.reason }, meta));
                return;
            }
            const field = headerField(label);
            if (!field) {
                unmapped.push(meta);
                return;
            }
            if (columns[field] == null) columns[field] = meta;
        });
        if (detail) detail.field = headerField(detail.label) || '';
        const fields = Object.keys(columns);
        const identity = fields.indexOf('subject_code') !== -1 || fields.indexOf('facultyName') !== -1 || fields.indexOf('employeeId') !== -1 || fields.indexOf('email') !== -1;
        const accepted = identity && (fields.length >= 2 || ignored.length >= 1);
        return { score: accepted ? fields.length : 0, accepted, columns, ignored, unmapped, detail };
    }

    function findBestHeader(rows, limit) {
        let best = null;
        const max = Math.min(rows.length, limit || 40);
        for (let index = 0; index < max; index++) {
            const scored = scoreHeaderCells(rows[index]);
            if (scored.accepted && (!best || scored.score > best.score)) {
                best = {
                    index,
                    score: scored.score,
                    columns: scored.columns,
                    ignored: scored.ignored,
                    unmapped: scored.unmapped,
                    detail: scored.detail
                };
            }
        }
        return best;
    }

    function emptyColumnReport() {
        return { mappedColumns: [], ignoredColumns: [], missingTargets: REQUIRED_TARGETS.map(([field, label]) => ({ field, label })), unmappedColumns: [], detailColumn: null };
    }

    function absorbHeader(report, header) {
        Object.keys(header.columns || {}).forEach((field) => {
            const source = header.columns[field].label;
            if (!report.mappedColumns.some((item) => item.target === field && item.source === source)) {
                report.mappedColumns.push({ source, target: field, targetLabel: TARGET_LABELS[field] || field });
            }
        });
        (header.ignored || []).forEach((meta) => {
            if (!report.ignoredColumns.some((item) => item.source === meta.label)) {
                report.ignoredColumns.push({ source: meta.label, reason: meta.reason });
            }
        });
        (header.unmapped || []).forEach((meta) => {
            const label = typeof meta === 'string' ? meta : meta.label;
            if (label && report.unmappedColumns.indexOf(label) === -1) report.unmappedColumns.push(label);
        });
        if (header.detail && !report.detailColumn) {
            report.detailColumn = {
                position: 8,
                label: header.detail.label,
                target: header.detail.field || ''
            };
        }
        const mapped = {};
        report.mappedColumns.forEach((item) => { mapped[item.target] = 1; });
        report.missingTargets = REQUIRED_TARGETS.filter(([field]) => !mapped[field]).map(([field, label]) => ({ field, label }));
    }

    function withReport(result, report) {
        const source = report || emptyColumnReport();
        return Object.assign({
            mappedColumns: source.mappedColumns,
            ignoredColumns: source.ignoredColumns,
            missingTargets: source.missingTargets,
            detailColumn: source.detailColumn || null
        }, result);
    }

    function mapRow(row, header) {
        const raw = blankRaw();
        Object.keys(header.columns).forEach((field) => {
            raw[field] = cellString(row[header.columns[field].index]);
        });
        return raw;
    }

    function mapIgnored(row, header) {
        const ignored = {};
        (header.ignored || []).forEach((meta) => {
            const value = cellString(row[meta.index]);
            if (value) ignored[meta.label] = value;
        });
        return ignored;
    }

    function isRepeatedHeader(raw) {
        let hits = 0;
        Object.keys(raw).forEach((field) => {
            if (headerField(raw[field]) === field) hits += 1;
        });
        return hits >= 2;
    }

    function isProseDump(raw, ignoredValues) {
        const values = RAW_FIELDS.map((field) => collapse(raw[field])).filter(Boolean);
        const extras = Object.keys(ignoredValues || {}).map((key) => collapse(ignoredValues[key])).filter(Boolean);
        const populated = values.concat(extras);
        return populated.length === 1 && populated[0].length > 80;
    }

    function isBlankRaw(raw) {
        return RAW_FIELDS.every((field) => !collapse(raw[field]));
    }

    function isDataRow(raw) {
        return Boolean(collapse(raw.subject_code) || collapse(raw.subject_title) || collapse(raw.section) || collapse(raw.units) || collapse(raw.hours_per_week));
    }

    function isFacultyBanner(raw) {
        return Boolean((collapse(raw.facultyName) || collapse(raw.employeeId) || collapse(raw.email)) && !collapse(raw.subject_code) && !collapse(raw.subject_title) && !collapse(raw.section) && !collapse(raw.units) && !collapse(raw.hours_per_week));
    }

    function shellRecord(localId, source, raw, ignoredValues, detailText) {
        return {
            localId,
            source,
            raw,
            ignoredValues: ignoredValues || {},
            facultyCarry: false,
            include: false,
            acceptSuggestion: false,
            facultyOverrideId: '',
            facultyCleared: false,
            conflictChoice: '',
            detailText: cellRaw(detailText || ''),
            detailSource: '',
            detailAmbiguous: false
        };
    }

    function consumeRows(entries) {
        let pendingName = '';
        let pendingId = '';
        const out = [];
        entries.forEach((entry) => {
            const raw = Object.assign(blankRaw(), entry.raw || {});
            if (isFacultyBanner(raw) && !collapse(entry.detailText)) {
                if (collapse(raw.facultyName)) {
                    if (collapse(raw.facultyName) !== pendingName && !collapse(raw.employeeId)) pendingId = '';
                    pendingName = collapse(raw.facultyName);
                }
                if (collapse(raw.employeeId)) pendingId = collapse(raw.employeeId);
                return;
            }
            if (!isDataRow(raw) && !collapse(entry.detailText)) return;
            let facultyCarry = false;
            if (!collapse(raw.facultyName) && !collapse(raw.employeeId) && !collapse(raw.email) && (pendingName || pendingId)) {
                raw.facultyName = pendingName;
                raw.employeeId = pendingId;
                facultyCarry = true;
            } else {
                if (collapse(raw.facultyName) && collapse(raw.facultyName) !== pendingName && !collapse(raw.employeeId)) pendingId = '';
                if (collapse(raw.facultyName)) pendingName = collapse(raw.facultyName);
                if (collapse(raw.employeeId)) pendingId = collapse(raw.employeeId);
            }
            out.push(Object.assign({}, entry, { raw, facultyCarry }));
        });
        return out;
    }

    function displayCode(value) {
        return collapse(value).toUpperCase();
    }

    function canonicalCode(value) {
        return displayCode(value).replace(/[^A-Z0-9]/g, '');
    }

    function canonicalSection(value) {
        return collapse(value).toUpperCase();
    }

    function parseNumber(value) {
        if (value == null) return { value: null, missing: true, valid: true };
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value < 0) return { value: null, missing: false, valid: false };
            return { value, missing: false, valid: true };
        }
        const text = String(value).trim().replace(/,/g, '');
        if (!text || text === '-' || /^n\/?a$/i.test(text)) return { value: null, missing: true, valid: true };
        const number = Number(text);
        if (!Number.isFinite(number) || number < 0) return { value: null, missing: false, valid: false };
        return { value: number, missing: false, valid: true };
    }

    function normalizeSemester(value) {
        const original = collapse(value);
        if (!original) return { value: '', valid: false, missing: true };
        const text = original.toLowerCase().replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
        if (/summer|midyear|mid year/.test(text)) return { value: 'Summer', valid: true, missing: false };
        if (['1', '1st', 'first', '1st semester', 'first semester', '1st sem', 'sem 1', 'semester 1'].indexOf(text) !== -1) {
            return { value: '1st Semester', valid: true, missing: false };
        }
        if (['2', '2nd', 'second', '2nd semester', 'second semester', '2nd sem', 'sem 2', 'semester 2'].indexOf(text) !== -1) {
            return { value: '2nd Semester', valid: true, missing: false };
        }
        return { value: original, valid: false, missing: false };
    }

    function normalizeAcademicYear(value) {
        const original = collapse(value);
        if (!original) return { value: '', valid: false, missing: true };
        const match = original.match(/(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})/);
        if (!match) return { value: original, valid: false, missing: false };
        const start = Number(match[1]);
        const end = match[2].length === 2 ? Number(match[1].slice(0, 2) + match[2]) : Number(match[2]);
        if (end !== start + 1) return { value: `${start}-${end}`, valid: false, missing: false };
        return { value: `${start}-${end}`, valid: true, missing: false };
    }

    function parseSchedule(value) {
        const raw = collapse(value);
        if (!raw) return null;
        const match = raw.match(/^([A-Za-z][A-Za-z/,\s]{0,40}?)\s+(\d{1,2}(?::\d{2})?\s*(?:[AP]M)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:[AP]M)?)$/i);
        if (!match) return null;
        const day = collapse(match[1]);
        if (!day || /\d/.test(day)) return null;
        const start = collapse(match[2]);
        const end = collapse(match[3]);
        return {
            schedule_day: day,
            start_time: start,
            end_time: end,
            schedule_entries: [{ day, start_time: start, end_time: end }]
        };
    }

    function normalizeDraft(draft) {
        const source = draft || {};
        const units = parseNumber(source.units);
        const hours = parseNumber(source.hours_per_week);
        const students = parseNumber(source.total_students);
        const semester = normalizeSemester(source.semester);
        const year = normalizeAcademicYear(source.academic_year);
        return {
            facultyName: collapse(source.facultyName),
            employeeId: collapse(source.employeeId),
            email: collapse(source.email).toLowerCase(),
            department: collapse(source.department),
            subject_code: displayCode(source.subject_code),
            subjectCodeKey: canonicalCode(source.subject_code),
            subject_title: collapse(source.subject_title),
            section: collapse(source.section),
            sectionKey: canonicalSection(source.section),
            units: units.valid ? units.value : null,
            unitsMissing: units.missing,
            unitsInvalid: !units.valid,
            hours_per_week: hours.valid ? hours.value : null,
            hoursMissing: hours.missing,
            hoursInvalid: !hours.valid,
            total_students: students.valid ? students.value : null,
            studentsMissing: students.missing,
            studentsInvalid: !students.valid,
            semester: semester.valid ? semester.value : collapse(source.semester),
            semesterValid: semester.valid,
            semesterMissing: semester.missing,
            academic_year: year.valid ? year.value : collapse(source.academic_year),
            yearValid: year.valid,
            yearMissing: year.missing,
            room: collapse(source.room),
            remarks: collapse(source.remarks),
            scheduleText: collapse(source.scheduleText),
            schedule: parseSchedule(source.scheduleText)
        };
    }

    function initialDraft(raw) {
        const values = normalizeDraft(raw || {});
        return {
            facultyName: collapse(raw && raw.facultyName),
            employeeId: collapse(raw && raw.employeeId),
            email: collapse(raw && raw.email).toLowerCase(),
            department: collapse(raw && raw.department),
            subject_code: values.subject_code,
            subject_title: values.subject_title,
            section: values.section,
            units: values.unitsInvalid ? collapse(raw && raw.units) : (values.units == null ? '' : String(values.units)),
            hours_per_week: values.hoursInvalid ? collapse(raw && raw.hours_per_week) : (values.hours_per_week == null ? '' : String(values.hours_per_week)),
            semester: values.semester,
            academic_year: values.academic_year,
            total_students: values.studentsInvalid ? collapse(raw && raw.total_students) : (values.total_students == null ? '' : String(values.total_students)),
            room: values.room,
            remarks: values.remarks,
            scheduleText: values.scheduleText
        };
    }

    function hydrateRecord(record) {
        return Object.assign({}, record, { draft: initialDraft(record.raw) });
    }

    function sheetsFromWorkbook(workbook, utils) {
        if (!workbook || !utils || typeof utils.sheet_to_json !== 'function') {
            throw new Error('The Excel parser is not available.');
        }
        return (workbook.SheetNames || []).map((name) => ({
            name,
            rows: utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true })
        }));
    }

    function parseSheetRows(sheets, options) {
        const settings = options || {};
        if (!Array.isArray(sheets) || !sheets.length) {
            return { ok: false, code: 'empty', message: 'The spreadsheet has no readable worksheets.', records: [], warnings: [], unmappedColumns: [] };
        }
        const records = [];
        const warnings = [];
        const report = emptyColumnReport();
        let seq = 1;
        sheets.forEach((sheet) => {
            const rows = Array.isArray(sheet && sheet.rows) ? sheet.rows.map((row) => Array.isArray(row) ? row : []) : [];
            const matrix = rows.map((row) => row.map(cellString));
            const rawMatrix = rows.map((row) => row.map(cellRaw));
            const header = findBestHeader(matrix, 40);
            const sheetName = collapse(sheet && sheet.name) || 'Sheet';
            if (!header) {
                warnings.push(`"${sheetName}" has no recognizable workload header and was skipped.`);
                return;
            }
            absorbHeader(report, header);
            const entries = [];
            for (let index = header.index + 1; index < matrix.length; index++) {
                const raw = mapRow(matrix[index], header);
                const ignoredValues = mapIgnored(matrix[index], header);
                const detailText = header.detail ? cellRaw(rawMatrix[index][header.detail.index]) : '';
                if ((isBlankRaw(raw) && !collapse(detailText) && !Object.keys(ignoredValues).length) || isRepeatedHeader(raw)) continue;
                entries.push(shellRecord(`xls-${seq++}`, {
                    fileName: settings.fileName || '',
                    fileType: 'excel',
                    sheet: sheetName,
                    row: index + 1,
                    page: null
                }, raw, ignoredValues, detailText));
            }
            records.push.apply(records, expandDetailRecords(consumeRows(entries)));
        });
        if (records.length > MAX_ROWS) {
            return withReport({ ok: false, code: 'too_many', message: 'This file has more than 1500 assignments. Split it before importing.', records: [], warnings, unmappedColumns: report.unmappedColumns }, report);
        }
        if (!records.length) {
            return withReport({
                ok: false,
                code: 'unreliable',
                message: warnings[0] || 'No workload rows were found under a recognizable header.',
                records: [],
                warnings,
                unmappedColumns: report.unmappedColumns
            }, report);
        }
        return withReport({ ok: true, records, warnings, unmappedColumns: report.unmappedColumns }, report);
    }

    function textVolume(pages) {
        let count = 0;
        (pages || []).forEach((page) => {
            (page && page.items || []).forEach((item) => {
                count += String(item && item.str || '').replace(/[^A-Za-z0-9]/g, '').length;
            });
        });
        return count;
    }

    function groupLines(items) {
        const prepared = [];
        (items || []).forEach((item) => {
            const str = String(item && item.str || '');
            if (!collapse(str)) return;
            const x = Number(item.x);
            const y = Number(item.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            prepared.push({ str: str.trim(), x, y, width: Number(item.width) || 0 });
        });
        prepared.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines = [];
        prepared.forEach((item) => {
            const line = lines.find((entry) => Math.abs(entry.y - item.y) <= 3);
            if (line) line.items.push(item);
            else lines.push({ y: item.y, items: [item] });
        });
        lines.forEach((line) => line.items.sort((a, b) => a.x - b.x));
        return lines;
    }

    function itemRight(item) {
        const width = Number(item.width);
        if (Number.isFinite(width) && width > 0) return item.x + width;
        return item.x + String(item.str || '').length * 4.2;
    }

    function splitLineCells(line) {
        const items = (line.items || []).filter((item) => collapse(item.str));
        if (!items.length) return [];
        const gaps = [];
        for (let i = 1; i < items.length; i++) gaps.push(items[i].x - itemRight(items[i - 1]));
        const typical = gaps.filter((gap) => gap >= 0).sort((a, b) => a - b);
        const median = typical.length ? typical[Math.floor((typical.length - 1) / 2)] : 4;
        const threshold = Math.min(10, Math.max(6, median * 1.5));
        const cells = [];
        let current = { x: items[0].x, text: items[0].str, width: Math.max(1, itemRight(items[0]) - items[0].x) };
        for (let i = 1; i < items.length; i++) {
            const gap = items[i].x - itemRight(items[i - 1]);
            if (gap > threshold) {
                cells.push(current);
                current = { x: items[i].x, text: items[i].str, width: Math.max(1, itemRight(items[i]) - items[i].x) };
            } else {
                current.text = collapse(`${current.text} ${items[i].str}`);
                current.width = Math.max(1, itemRight(items[i]) - current.x);
            }
        }
        cells.push(current);
        return cells;
    }

    function spanCenter(x, width, text) {
        const size = Number(width) > 0 ? Number(width) : Math.max(8, String(text || '').length * 4.5);
        return Number(x) + size / 2;
    }

    function assignPdfRow(cells, header) {
        const raw = blankRaw();
        const ignoredValues = {};
        const detailValues = {};
        const columns = [];
        Object.keys(header.columns || {}).forEach((field) => {
            const meta = header.columns[field];
            columns.push({ kind: 'target', field, center: spanCenter(meta.x, meta.width, meta.label) });
        });
        (header.ignored || []).forEach((meta) => {
            columns.push({ kind: 'ignored', field: meta.label, center: spanCenter(meta.x, meta.width, meta.label) });
        });
        (header.unmapped || []).forEach((meta) => {
            if (!meta || meta.x == null) return;
            columns.push({ kind: 'detail', field: meta.label, center: spanCenter(meta.x, meta.width, meta.label) });
        });
        cells.forEach((cell) => {
            if (!columns.length) return;
            const center = spanCenter(cell.x, cell.width, cell.text);
            let chosen = columns[0];
            let best = Math.abs(center - chosen.center);
            columns.forEach((column) => {
                const distance = Math.abs(center - column.center);
                if (distance < best) {
                    best = distance;
                    chosen = column;
                }
            });
            if (chosen.kind === 'ignored') {
                ignoredValues[chosen.field] = collapse(ignoredValues[chosen.field] ? `${ignoredValues[chosen.field]} ${cell.text}` : cell.text);
                return;
            }
            if (chosen.kind === 'detail') {
                detailValues[chosen.field] = collapse(detailValues[chosen.field] ? `${detailValues[chosen.field]} ${cell.text}` : cell.text);
                return;
            }
            raw[chosen.field] = collapse(raw[chosen.field] ? `${raw[chosen.field]} ${cell.text}` : cell.text);
        });
        return { raw, ignoredValues, detailValues };
    }

    function onlySubjectTitle(raw) {
        return Boolean(collapse(raw.subject_title) && RAW_FIELDS.every((field) => field === 'subject_title' || !collapse(raw[field])));
    }

    function rowsFromPdfLines(lines, header, pageNumber, settings, idFactory) {
        const start = header.index == null ? 0 : header.index + 1;
        const entries = [];
        for (let index = start; index < lines.length; index++) {
            const cells = splitLineCells(lines[index]);
            if (!cells.length) continue;
            const assigned = assignPdfRow(cells, header);
            const raw = assigned.raw;
            if (isRepeatedHeader(raw)) continue;
            if (isProseDump(raw, assigned.ignoredValues)) continue;
            if (onlySubjectTitle(raw) && entries.length) {
                entries[entries.length - 1].raw.subject_title = collapse(`${entries[entries.length - 1].raw.subject_title} ${raw.subject_title}`);
                continue;
            }
            if (!isDataRow(raw) && !isFacultyBanner(raw)) continue;
            entries.push(shellRecord(idFactory(), {
                fileName: settings.fileName || '',
                fileType: 'pdf',
                sheet: '',
                row: null,
                page: pageNumber
            }, raw, assigned.ignoredValues, detailTextFor(raw, assigned, header)));
        }
        return expandDetailRecords(consumeRows(entries));
    }

    function cellRaw(value) {
        if (value == null) return '';
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'object') return cellRaw(value.text || value.w || value.v || '');
        return String(value).replace(/\r\n/g, '\n').trim();
    }

    function detailTextFor(raw, assigned, header) {
        const detail = header && header.detail;
        if (detail && detail.field && collapse(raw[detail.field])) return raw[detail.field];
        if (detail && assigned && assigned.ignoredValues && collapse(assigned.ignoredValues[detail.label])) return assigned.ignoredValues[detail.label];
        if (detail && assigned && assigned.detailValues && collapse(assigned.detailValues[detail.label])) return assigned.detailValues[detail.label];
        return raw.section || '';
    }

    function looksLikeSectionToken(value) {
        const text = collapse(value);
        if (!text || text.length > 24 || /^\d+$/.test(text)) return false;
        return /^[A-Za-z][A-Za-z0-9.&/-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.&/-]*){0,3}$/.test(text);
    }

    function splitDetailPieces(text) {
        const source = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!source) return [];
        let parts = source.split(/\n+|[;|]/).map(collapse).filter(Boolean);
        if (parts.length === 1 && parts[0].indexOf(',') !== -1) {
            const commaParts = parts[0].split(',').map(collapse).filter(Boolean);
            if (commaParts.length > 1 && commaParts.every(looksLikeSectionToken)) parts = commaParts;
        }
        return parts.map((part) => {
            const course = parseCourseLine(part);
            if (course) return Object.assign({ kind: 'course' }, course);
            if (looksLikeSectionToken(part)) return { kind: 'section', section: part };
            return { kind: 'ambiguous', original: part };
        });
    }

    function applyDetailPiece(raw, piece) {
        if (!piece || piece.kind === 'ambiguous') return;
        if (piece.kind === 'section') {
            raw.section = piece.section;
            return;
        }
        if (piece.subject_code) raw.subject_code = piece.subject_code;
        if (piece.subject_title) raw.subject_title = piece.subject_title;
        if (piece.section) raw.section = piece.section;
        if (piece.units) raw.units = piece.units;
        if (piece.hours) raw.hours_per_week = piece.hours;
        if (piece.students) raw.total_students = piece.students;
    }

    function expandDetailRecords(records) {
        const out = [];
        (records || []).forEach((record) => {
            const original = cellRaw(record.detailText || (record.raw && record.raw.section) || '');
            const pieces = splitDetailPieces(original);
            record.detailSource = collapse(original);
            if (pieces.length <= 1) {
                if (pieces.length === 1) {
                    applyDetailPiece(record.raw, pieces[0]);
                    record.detailAmbiguous = pieces[0].kind === 'ambiguous';
                    record.draft = initialDraft(record.raw);
                } else if (!record.draft) {
                    record.draft = initialDraft(record.raw);
                }
                out.push(record);
                return;
            }
            pieces.forEach((piece, index) => {
                const raw = Object.assign(blankRaw(), record.raw);
                applyDetailPiece(raw, piece);
                const copy = shellRecord(`${record.localId}-${index + 1}`, record.source, raw, record.ignoredValues, original);
                copy.detailSource = collapse(original);
                copy.detailAmbiguous = piece.kind === 'ambiguous';
                copy.facultyCarry = Boolean(record.facultyCarry);
                copy.include = record.include === true;
                out.push(hydrateRecord(copy));
            });
        });
        return out;
    }

    function looksLikeHeaderText(text) {
        const normalized = normHeader(text);
        let hits = 0;
        HEADER_FIELDS.forEach((entry) => {
            const found = entry.aliases.some((alias) => new RegExp(`(^|\\s)${alias.replace(/\s+/g, '\\s+')}(\\s|$)`).test(normalized));
            if (found) hits += 1;
        });
        return hits >= 3;
    }

    function parseCourseLine(text) {
        const match = collapse(text).match(/^([A-Z]{2,10}\s?-?\s?\d{2,4}[A-Z]?)\s+(.+)$/i);
        if (!match) return null;
        const parts = match[2].split(/\s+/).filter(Boolean);
        const numbers = [];
        while (parts.length && /^\d+(?:\.\d+)?$/.test(parts[parts.length - 1]) && numbers.length < 3) {
            numbers.unshift(parts.pop());
        }
        if (!numbers.length || parts.length < 2) return null;
        const section = parts.pop();
        const title = parts.join(' ');
        if (!title || title.length > 80 || !/^[A-Za-z0-9-]{1,12}$/.test(section)) return null;
        return {
            subject_code: match[1].replace(/\s+/g, ''),
            subject_title: title,
            section,
            units: numbers[0],
            hours: numbers[1] || '',
            students: numbers[2] || ''
        };
    }

    function parsePersonLine(text) {
        const value = collapse(text);
        if (!value || parseCourseLine(value) || looksLikeHeaderText(value)) return null;
        if (/\b(college|university|institute|campus|department|republic|workload|loading|schedule|official|page|prepared|approved|noted|total|semester|academic|subject|section|units|hours)\b/i.test(value)) return null;
        let name = value;
        let id = '';
        const idMatch = value.match(/\b([A-Z]{2,6}-?\d{2,6}(?:-?\d{2,6})?)\b/);
        if (idMatch) {
            id = idMatch[1];
            name = collapse(value.replace(idMatch[0], ''));
        }
        if (/\d/.test(name)) return null;
        const words = name.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5) return null;
        if (!words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))) return null;
        return { name, id };
    }

    function rowsFromLooseLines(lines, pageNumber, settings, idFactory) {
        let pendingName = '';
        let pendingId = '';
        let freshPerson = false;
        const records = [];
        lines.forEach((line) => {
            const text = collapse((line.items || []).map((item) => item.str).join(' '));
            if (!text || looksLikeHeaderText(text)) return;
            const course = parseCourseLine(text);
            if (course) {
                records.push(hydrateRecord(shellRecord(idFactory(), {
                    fileName: settings.fileName || '',
                    fileType: 'pdf',
                    sheet: '',
                    row: null,
                    page: pageNumber
                }, Object.assign(blankRaw(), {
                    facultyName: pendingName,
                    employeeId: pendingId,
                    subject_code: course.subject_code,
                    subject_title: course.subject_title,
                    section: course.section,
                    units: course.units,
                    hours_per_week: course.hours,
                    total_students: course.students
                }))));
                records[records.length - 1].facultyCarry = !freshPerson && Boolean(pendingName || pendingId);
                freshPerson = false;
                return;
            }
            const person = parsePersonLine(text);
            if (person) {
                pendingName = person.name;
                pendingId = person.id || '';
                freshPerson = true;
            }
        });
        return records.filter((record) => collapse(record.raw.facultyName) || collapse(record.raw.subject_code));
    }

    function parsePdfPages(pages, options) {
        const settings = options || {};
        if (textVolume(pages) < 15) {
            return { ok: false, code: 'ocr_unavailable', message: OCR_MESSAGE, records: [], warnings: [], unmappedColumns: [] };
        }
        const records = [];
        const warnings = [];
        const report = emptyColumnReport();
        let remembered = null;
        let seq = 1;
        const idFactory = () => `pdf-${seq++}`;
        (pages || []).forEach((page, pageIndex) => {
            const pageNumber = page && page.pageNumber ? page.pageNumber : pageIndex + 1;
            const items = page && Array.isArray(page.items) ? page.items : [];
            const letters = items.reduce((sum, item) => sum + String(item && item.str || '').replace(/[^A-Za-z0-9]/g, '').length, 0);
            if (!letters) {
                warnings.push(`Page ${pageNumber} has no selectable text. OCR is not available for that page.`);
                return;
            }
            const lines = groupLines(items);
            const header = findBestHeader(lines.map(splitLineCells), 40);
            let produced = [];
            if (header) {
                remembered = header;
                absorbHeader(report, header);
                produced = rowsFromPdfLines(lines, header, pageNumber, settings, idFactory);
            } else if (remembered) {
                produced = rowsFromPdfLines(lines, Object.assign({}, remembered, { index: -1 }), pageNumber, settings, idFactory);
            }
            if (!produced.length) produced = rowsFromLooseLines(lines, pageNumber, settings, idFactory);
            records.push.apply(records, produced);
        });
        if (records.length > MAX_ROWS) {
            return withReport({ ok: false, code: 'too_many', message: 'This file has more than 1500 assignments. Split it before importing.', records: [], warnings, unmappedColumns: report.unmappedColumns }, report);
        }
        if (!records.length) {
            const missing = report.missingTargets.map((item) => item.label).join(', ');
            const message = report.mappedColumns.length
                ? `Rows were read, but none contained a workload value. Missing target fields: ${missing}.`
                : UNRELIABLE_PDF;
            return withReport({ ok: false, code: 'unreliable', message, records: [], warnings, unmappedColumns: report.unmappedColumns }, report);
        }
        return withReport({ ok: true, records, warnings, unmappedColumns: report.unmappedColumns }, report);
    }

    function issue(level, field, message) {
        return { level, field, message };
    }

    function fieldIssues(values, record) {
        const issues = [];
        if (!values.subjectCodeKey) {
            const counted = record && record.ignoredValues && Object.keys(record.ignoredValues).some((label) => ignoredHeader(label) && /count of subjects/i.test(ignoredHeader(label).reason));
            issues.push(issue('error', 'subject_code', counted
                ? 'Subject code is missing. The Subjects column is a count and was not converted into a subject.'
                : 'Subject code is missing.'));
        }
        if (!values.subject_title) issues.push(issue('error', 'subject_title', 'Subject title is missing.'));
        if (!values.sectionKey) issues.push(issue('error', 'section', 'Section is missing.'));
        if (values.unitsInvalid) issues.push(issue('error', 'units', 'Units are not a valid number.'));
        else if (values.unitsMissing) issues.push(issue('error', 'units', 'Units are missing.'));
        if (values.hoursInvalid) issues.push(issue('error', 'hours_per_week', 'Teaching hours are not a valid number.'));
        else if (values.hoursMissing) issues.push(issue('warning', 'hours_per_week', 'Teaching hours were not in the file and will not be invented.'));
        if (values.studentsInvalid) issues.push(issue('error', 'total_students', 'Student count is not a valid number.'));
        if (values.semesterMissing) issues.push(issue('error', 'semester', 'Semester is missing.'));
        else if (!values.semesterValid) issues.push(issue('error', 'semester', 'Semester could not be mapped to 1st Semester, 2nd Semester, or Summer.'));
        if (values.yearMissing) issues.push(issue('error', 'academic_year', 'Academic year is missing.'));
        else if (!values.yearValid) issues.push(issue('error', 'academic_year', 'Academic year must look like 2025-2026.'));
        if (values.scheduleText && !values.schedule) issues.push(issue('warning', 'scheduleText', 'Schedule stays in the preview only. It is not a single day and time range, so it will not be saved.'));
        if (record && record.facultyCarry) issues.push(issue('warning', 'facultyName', 'Faculty name was continued from an earlier row because the source cell was blank.'));
        return issues;
    }

    function normalizeName(value) {
        let raw = collapse(value).replace(/^(dr|prof|professor|engr|atty|mr|mrs|ms|sir)\.?\s+/i, '');
        if (raw.indexOf(',') !== -1) {
            const parts = raw.split(',');
            const last = parts.shift();
            raw = `${parts.join(' ')} ${last}`;
        }
        return raw.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function nameKey(value) {
        return normalizeName(value).split(' ').filter(Boolean).sort().join(' ');
    }

    function canonicalId(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a) return b.length;
        if (!b) return a.length;
        const prev = new Array(b.length + 1);
        const curr = new Array(b.length + 1);
        for (let j = 0; j <= b.length; j++) prev[j] = j;
        for (let i = 1; i <= a.length; i++) {
            curr[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            }
            for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
        }
        return prev[b.length];
    }

    function scoreNames(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        const left = a.split(' ').filter(Boolean);
        const right = b.split(' ').filter(Boolean);
        const leftSet = {};
        const rightSet = {};
        left.forEach((token) => { leftSet[token] = 1; });
        right.forEach((token) => { rightSet[token] = 1; });
        let overlap = 0;
        Object.keys(leftSet).forEach((token) => { if (rightSet[token]) overlap += 1; });
        const union = {};
        Object.keys(leftSet).forEach((token) => { union[token] = 1; });
        Object.keys(rightSet).forEach((token) => { union[token] = 1; });
        const jaccard = overlap / Object.keys(union).length;
        const shorter = left.length <= right.length ? leftSet : rightSet;
        const longer = left.length <= right.length ? rightSet : leftSet;
        let contained = 0;
        const shorterTokens = Object.keys(shorter);
        shorterTokens.forEach((token) => { if (longer[token]) contained += 1; });
        const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
        const subsetScore = contained === shorterTokens.length && shorterTokens.length >= 2 && lengthRatio >= 0.55 ? 0.86 : 0;
        const edit = 1 - (levenshtein(a, b) / Math.max(a.length, b.length));
        return Math.max(jaccard, edit, subsetScore);
    }

    function facultyRecords(list) {
        return (list || []).map((row) => ({
            id: row && row.id,
            full_name: collapse(row && (row.full_name || row.name)),
            employee_id: collapse(row && row.employee_id),
            id_number: collapse(row && row.id_number),
            department: collapse(row && row.department),
            position: collapse(row && (row.position || row.academic_rank)),
            email: collapse(row && row.email)
        })).filter((row) => row.id != null && String(row.id) !== '');
    }

    function candidate(row, score) {
        return {
            id: row.id,
            full_name: row.full_name,
            employee_id: row.employee_id,
            department: row.department,
            position: row.position,
            score: score == null ? null : Math.round(score * 100) / 100
        };
    }

    function matchResult(status, faculty, candidates, reason, warnings) {
        return {
            status,
            faculty: faculty || null,
            facultyId: faculty ? faculty.id : null,
            candidates: candidates || [],
            reason,
            warnings: warnings || []
        };
    }

    function matchFaculty(values, facultyList) {
        const faculty = facultyRecords(facultyList);
        const idKey = canonicalId(values.employeeId);
        if (idKey) {
            const hits = faculty.filter((row) => canonicalId(row.employee_id) === idKey || canonicalId(row.id_number) === idKey);
            if (hits.length > 1) {
                return matchResult('ambiguous', null, hits.map((row) => candidate(row)), 'This employee ID matches more than one registered faculty record.');
            }
            if (hits.length === 1) {
                const warnings = [];
                const extracted = nameKey(values.facultyName);
                const registered = nameKey(hits[0].full_name);
                if (extracted && registered && extracted !== registered) {
                    warnings.push('The employee ID matches this faculty member, but the extracted name is different.');
                }
                return matchResult('matched_id', hits[0], [candidate(hits[0])], 'Matched on employee ID.', warnings);
            }
        }

        const emailKey = collapse(values.email).toLowerCase();
        if (emailKey && emailKey.indexOf('@') !== -1) {
            const hits = faculty.filter((row) => collapse(row.email).toLowerCase() === emailKey);
            if (hits.length > 1) {
                return matchResult('ambiguous', null, hits.map((row) => candidate(row)), 'This email matches more than one registered faculty record.');
            }
            if (hits.length === 1) {
                const warnings = [];
                const extracted = nameKey(values.facultyName);
                const registered = nameKey(hits[0].full_name);
                if (extracted && registered && extracted !== registered) {
                    warnings.push('The email matches this faculty member, but the extracted name is different.');
                }
                return matchResult('matched_email', hits[0], [candidate(hits[0])], 'Matched on email address.', warnings);
            }
        }

        const key = nameKey(values.facultyName);
        if (key) {
            const exact = faculty.filter((row) => nameKey(row.full_name) === key);
            if (exact.length > 1) {
                return matchResult('ambiguous', null, exact.map((row) => candidate(row)), 'More than one registered faculty member has this name.');
            }
            if (exact.length === 1) {
                const warnings = [];
                if (idKey) warnings.push('The employee ID was not found. The full name matched one registered faculty member.');
                else if (emailKey) warnings.push('The email was not found. The full name matched one registered faculty member.');
                return matchResult('matched_name', exact[0], [candidate(exact[0])], 'Exact normalized full-name match.', warnings);
            }
        }

        if (!key || key.length < 5) {
            return matchResult('unmatched', null, [], idKey
                ? 'The employee ID was not found, and the name is not enough to suggest a faculty member.'
                : 'No registered faculty member matches this name.');
        }

        const scored = faculty.map((row) => ({ row, score: scoreNames(key, nameKey(row.full_name)) }))
            .filter((item) => item.score >= 0.76)
            .sort((a, b) => b.score - a.score);
        if (!scored.length) {
            return matchResult('unmatched', null, [], idKey
                ? 'The employee ID was not found, and the name does not match a registered faculty member.'
                : 'No registered faculty member matches this name.');
        }
        const top = scored[0];
        const band = scored.filter((item) => item.score >= 0.8 && top.score - item.score <= 0.08);
        if (band.length >= 2) {
            return matchResult('ambiguous', null, band.slice(0, 5).map((item) => candidate(item.row, item.score)), 'Several registered faculty names are similarly close. Choose one.');
        }
        if (top.score >= 0.8 && (scored.length === 1 || top.score - scored[1].score >= 0.08)) {
            return matchResult('suggested', top.row, [candidate(top.row, top.score)], 'Close name match. Confirm this faculty member before import.');
        }
        return matchResult('unmatched', null, scored.slice(0, 3).map((item) => candidate(item.row, item.score)), 'No name was close enough to match automatically.');
    }

    function withDepartmentWarning(values, match) {
        if (!match || !match.faculty) return match;
        const extracted = collapse(values && values.department).toLowerCase();
        const registered = collapse(match.faculty.department).toLowerCase();
        if (!extracted || !registered || extracted === registered) return match;
        const warnings = (match.warnings || []).concat(['The file department differs from the registered faculty profile. The profile department was not changed.']);
        return Object.assign({}, match, { warnings });
    }

    function resolveFaculty(record, facultyList) {
        const values = normalizeDraft(record && record.draft);
        let match = matchFaculty(values, facultyList);
        if (record && record.facultyCleared) {
            match = matchResult('unmatched', null, match.candidates, 'The registered faculty match was cleared.');
        } else if (record && record.facultyOverrideId) {
            const chosen = facultyRecords(facultyList).find((row) => String(row.id) === String(record.facultyOverrideId));
            if (!chosen) {
                match = matchResult('unmatched', null, match.candidates, 'The selected faculty record is no longer available.');
            } else {
                match = matchResult('manual', chosen, match.candidates, 'Selected by the user.');
            }
        } else if (record && record.acceptSuggestion && match.status === 'suggested' && match.faculty) {
            match = Object.assign({}, match, { status: 'confirmed_suggestion' });
        }
        return { values, match: withDepartmentWarning(values, match) };
    }

    function selectedFacultyId(record, match) {
        if (record && record.facultyCleared) return '';
        if (record && record.facultyOverrideId) return String(record.facultyOverrideId);
        if (match && CONFIRMED[match.status] && match.facultyId) return String(match.facultyId);
        return '';
    }

    function previewValue(record, field) {
        const draft = record && record.draft;
        if (!draft || draft[field] == null) return '';
        return String(draft[field]);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[char]));
    }

    function renderPreviewInput(record, field, label) {
        return `<input data-field="${escapeHtml(field)}" aria-label="${escapeHtml(label || field)}" class="field" value="${escapeHtml(previewValue(record, field))}">`;
    }

    function applyPreviewEdit(record, field, value) {
        if (!record || !field) return record;
        if (field === 'include') {
            record.include = Boolean(value);
            return record;
        }
        if (field === 'conflictChoice') {
            record.conflictChoice = value || '';
            return record;
        }
        if (field === 'facultyOverrideId') {
            record.facultyOverrideId = value || '';
            record.facultyCleared = !value;
            record.acceptSuggestion = false;
            return record;
        }
        if (!record.draft) record.draft = initialDraft(record.raw);
        record.draft[field] = value == null ? '' : String(value);
        return record;
    }

    function assignmentKey(facultyId, values) {
        return [
            String(facultyId || ''),
            values.subjectCodeKey,
            values.sectionKey,
            values.semesterValid ? values.semester : collapse(values.semester).toLowerCase(),
            values.yearValid ? values.academic_year : collapse(values.academic_year)
        ].join('||');
    }

    function existingKey(row) {
        const semester = normalizeSemester(row && row.semester);
        const year = normalizeAcademicYear(row && row.academic_year);
        return [
            String(row && row.faculty_id || ''),
            canonicalCode(row && row.subject_code),
            canonicalSection(row && row.section),
            semester.valid ? semester.value : collapse(row && row.semester).toLowerCase(),
            year.valid ? year.value : collapse(row && row.academic_year)
        ].join('||');
    }

    function indexExisting(rows) {
        const map = new Map();
        (rows || []).forEach((row) => {
            const key = existingKey(row);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        });
        return map;
    }

    function sameText(a, b) {
        return collapse(a).toLowerCase() === collapse(b).toLowerCase();
    }

    function diffExisting(existing, values) {
        const conflicts = [];
        const fills = [];
        [['subject_title', 'Subject title'], ['room', 'Room'], ['remarks', 'Remarks']].forEach(([field, label]) => {
            const incoming = values[field];
            if (!incoming) return;
            const current = collapse(existing[field]);
            if (!current) fills.push({ field, label, existing: '', incoming });
            else if (!sameText(current, incoming)) conflicts.push({ field, label, existing: current, incoming });
        });
        [['units', 'Units'], ['hours_per_week', 'Hours/week'], ['total_students', 'Students']].forEach(([field, label]) => {
            if (values[field] == null) return;
            const current = existing[field];
            if (current == null || current === '') fills.push({ field, label, existing: '', incoming: String(values[field]) });
            else if (Number(current) !== Number(values[field])) conflicts.push({ field, label, existing: String(current), incoming: String(values[field]) });
        });
        if (values.schedule) {
            [['schedule_day', 'Day', values.schedule.schedule_day], ['start_time', 'Start time', values.schedule.start_time], ['end_time', 'End time', values.schedule.end_time]].forEach(([field, label, incoming]) => {
                if (!incoming) return;
                const current = collapse(existing[field]);
                if (!current) fills.push({ field, label, existing: '', incoming });
                else if (!sameText(current, incoming)) conflicts.push({ field, label, existing: current, incoming });
            });
        }
        if (String(existing.status || '') === 'Archived') {
            conflicts.push({ field: 'status', label: 'Status', existing: 'Archived', incoming: 'Active' });
        }
        return { conflicts, fills };
    }

    function valueSnapshot(values) {
        return JSON.stringify({
            title: collapse(values.subject_title).toLowerCase(),
            units: values.units,
            hours: values.hours_per_week,
            students: values.total_students,
            room: collapse(values.room).toLowerCase(),
            remarks: collapse(values.remarks).toLowerCase(),
            schedule: values.schedule ? [values.schedule.schedule_day, values.schedule.start_time, values.schedule.end_time] : null
        });
    }

    function insertPayload(facultyId, values) {
        const payload = {
            faculty_id: facultyId,
            subject_code: values.subject_code,
            subject_title: values.subject_title,
            section: values.section,
            units: values.units,
            semester: values.semester,
            academic_year: values.academic_year,
            status: 'Active'
        };
        if (values.hours_per_week != null) payload.hours_per_week = values.hours_per_week;
        if (values.total_students != null) payload.total_students = values.total_students;
        if (values.room) payload.room = values.room;
        if (values.remarks) payload.remarks = values.remarks;
        if (values.schedule) {
            payload.schedule_day = values.schedule.schedule_day;
            payload.start_time = values.schedule.start_time;
            payload.end_time = values.schedule.end_time;
            payload.schedule_entries = values.schedule.schedule_entries;
        }
        return payload;
    }

    function patchValue(entry, values) {
        if (entry.field === 'units' || entry.field === 'hours_per_week' || entry.field === 'total_students') return Number(entry.incoming);
        if (entry.field === 'status') return 'Active';
        return entry.incoming;
    }

    function buildPatch(values, decision, choice) {
        const patch = {};
        decision.fills.forEach((entry) => { patch[entry.field] = patchValue(entry, values); });
        if (choice === 'imported') {
            decision.conflicts.forEach((entry) => { patch[entry.field] = patchValue(entry, values); });
        }
        if (values.schedule && (patch.schedule_day || patch.start_time || patch.end_time)) {
            patch.schedule_entries = values.schedule.schedule_entries;
        }
        delete patch.faculty_id;
        return patch;
    }

    function planShell(record, values, match, extra) {
        return {
            localId: record.localId,
            source: record.source,
            action: extra.action,
            willWrite: Boolean(extra.willWrite),
            blocked: Boolean(extra.blocked),
            reason: extra.reason || '',
            facultyId: match.facultyId || null,
            faculty: match.faculty || null,
            match,
            issues: extra.issues || [],
            conflicts: extra.conflicts || [],
            fills: extra.fills || [],
            existingId: extra.existingId || null,
            payload: extra.payload || null,
            patch: extra.patch || null,
            label: collapse(`${values.subject_code || 'Untitled'} ${values.section || ''}`),
            extractedName: values.facultyName,
            statusLabel: extra.statusLabel,
            selected: record.include === true
        };
    }

    function planBatch(records, existingLoads, facultyList) {
        const existing = indexExisting(existingLoads);
        const prepared = (records || []).map((record, index) => {
            const resolved = resolveFaculty(record, facultyList);
            const issues = fieldIssues(resolved.values, record);
            return {
                record,
                index,
                values: resolved.values,
                match: resolved.match,
                issues,
                errors: issues.filter((item) => item.level === 'error'),
                confirmed: Boolean(CONFIRMED[resolved.match.status]),
                duplicateOf: null,
                fileConflict: false
            };
        });

        const groups = new Map();
        prepared.forEach((item) => {
            if (item.record.include !== true || !item.confirmed || item.errors.length) return;
            const key = assignmentKey(item.match.facultyId, item.values);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        groups.forEach((group) => {
            if (group.length < 2) return;
            const snapshot = valueSnapshot(group[0].values);
            if (group.every((item) => valueSnapshot(item.values) === snapshot)) {
                group.slice(1).forEach((item) => { item.duplicateOf = group[0].record.localId; });
            } else {
                group.forEach((item) => { item.fileConflict = true; });
            }
        });

        return prepared.map((item) => {
            if (item.record.include !== true) {
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', reason: 'This row is not checked.', issues: item.issues, statusLabel: 'Not selected'
                });
            }
            if (!item.confirmed) {
                const label = item.match.status === 'suggested' ? 'Suggested match' : (item.match.status === 'ambiguous' ? 'Ambiguous' : 'Unmatched');
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', blocked: true, reason: item.match.reason || 'Choose a registered faculty member before this row can be imported.', issues: item.issues, statusLabel: label
                });
            }
            if (item.errors.length) {
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', blocked: true, reason: item.errors.map((entry) => entry.message).join(' '), issues: item.issues, statusLabel: 'Needs details'
                });
            }
            if (item.fileConflict) {
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', blocked: true, issues: item.issues, statusLabel: 'Conflict in file',
                    reason: 'This file contains different values for the same assignment. Keep one row and exclude the others.'
                });
            }
            if (item.duplicateOf) {
                return planShell(item.record, item.values, item.match, {
                    action: 'duplicate', issues: item.issues, statusLabel: 'Duplicate',
                    reason: 'Duplicate of another row in this file.'
                });
            }

            const found = existing.get(assignmentKey(item.match.facultyId, item.values)) || [];
            if (found.length > 1 || found.some((row) => row.id == null || row.id === '')) {
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', blocked: true, issues: item.issues, statusLabel: 'Ambiguous existing',
                    reason: found.length > 1
                        ? 'More than one saved assignment matches this faculty, subject, section, semester, and academic year. It was not changed.'
                        : 'The saved assignment has no primary key, so it was not changed.'
                });
            }
            if (!found.length) {
                return planShell(item.record, item.values, item.match, {
                    action: 'insert', willWrite: true, issues: item.issues, statusLabel: 'New',
                    payload: insertPayload(item.match.facultyId, item.values)
                });
            }

            const current = found[0];
            const decision = diffExisting(current, item.values);
            if (decision.conflicts.length && !item.record.conflictChoice) {
                return planShell(item.record, item.values, item.match, {
                    action: 'exclude', blocked: true, issues: item.issues, conflicts: decision.conflicts, fills: decision.fills,
                    existingId: current.id, statusLabel: 'Conflict',
                    reason: 'Imported values differ from the saved assignment. Choose which values to keep.'
                });
            }
            if (decision.conflicts.some((entry) => entry.field === 'status') && item.record.conflictChoice === 'existing') {
                return planShell(item.record, item.values, item.match, {
                    action: 'skip', issues: item.issues, conflicts: decision.conflicts, existingId: current.id, statusLabel: 'Unchanged',
                    reason: 'The archived assignment was left unchanged.'
                });
            }
            const patch = buildPatch(item.values, decision, item.record.conflictChoice);
            if (!Object.keys(patch).length) {
                return planShell(item.record, item.values, item.match, {
                    action: 'skip', issues: item.issues, existingId: current.id, statusLabel: 'Unchanged',
                    reason: 'The saved assignment already matches this row.'
                });
            }
            return planShell(item.record, item.values, item.match, {
                action: 'update', willWrite: true, issues: item.issues, conflicts: decision.conflicts, fills: decision.fills,
                existingId: current.id, patch, statusLabel: 'Update'
            });
        });
    }

    function summarizePlans(plans) {
        const summary = {
            total: (plans || []).length,
            matched: 0,
            suggested: 0,
            ambiguous: 0,
            unmatched: 0,
            invalid: 0,
            inserts: 0,
            updates: 0,
            skips: 0,
            duplicates: 0,
            conflicts: 0,
            excluded: 0,
            willWrite: 0,
            skipped: 0
        };
        (plans || []).forEach((plan) => {
            const status = plan.match && plan.match.status;
            if (CONFIRMED[status]) summary.matched += 1;
            else if (status === 'suggested') summary.suggested += 1;
            else if (status === 'ambiguous') summary.ambiguous += 1;
            else summary.unmatched += 1;
            if ((plan.issues || []).some((item) => item.level === 'error')) summary.invalid += 1;
            if (plan.willWrite && plan.action === 'insert') summary.inserts += 1;
            else if (plan.willWrite && plan.action === 'update') summary.updates += 1;
            else if (plan.action === 'skip') summary.skips += 1;
            else if (plan.action === 'duplicate') summary.duplicates += 1;
            else summary.excluded += 1;
            if (plan.statusLabel === 'Conflict' || plan.statusLabel === 'Conflict in file' || plan.statusLabel === 'Ambiguous existing') summary.conflicts += 1;
            if (plan.willWrite) summary.willWrite += 1;
        });
        summary.skipped = summary.skips + summary.duplicates;
        return summary;
    }

    function planSignature(plans) {
        return JSON.stringify((plans || []).map((plan) => ({
            localId: plan.localId,
            action: plan.action,
            willWrite: plan.willWrite,
            existingId: plan.existingId,
            facultyId: plan.facultyId,
            payload: plan.payload,
            patch: plan.patch,
            blocked: plan.blocked
        })));
    }

    function assertImportAllowed(session, facultyRecord) {
        if (!session || !session.user) {
            return { ok: false, message: 'Sign in with an account that can manage workload before importing.' };
        }
        const metaRole = String(session.user.user_metadata && session.user.user_metadata.role || '').toLowerCase();
        const role = String(facultyRecord && (facultyRecord.role || facultyRecord.position) || '').toLowerCase();
        const adminAccess = Boolean(facultyRecord && facultyRecord.admin_access === true);
        const elevated = adminAccess
            || ['admin', 'administrator', 'dean'].indexOf(role) !== -1
            || ['admin', 'administrator', 'dean'].indexOf(metaRole) !== -1
            || role.indexOf('secretary') !== -1
            || metaRole.indexOf('secretary') !== -1
            || (role.indexOf('chair') !== -1 && adminAccess);
        if (elevated) return { ok: true, message: '' };
        if (!facultyRecord && !metaRole) return { ok: true, message: '' };
        return { ok: false, message: 'This account cannot import workload assignments.' };
    }

    function failure(plan, message) {
        return {
            localId: plan && plan.localId,
            label: plan && plan.label,
            source: plan && plan.source,
            extractedName: plan && plan.extractedName,
            message
        };
    }

    async function commitImport(input) {
        const request = input || {};
        const allowed = assertImportAllowed(request.session, request.facultyRecord);
        const summary = { inserted: 0, updated: 0, skipped: 0, excluded: 0, failed: [], skippedRows: [], notice: PARTIAL_NOTICE };
        if (!allowed.ok) return { ok: false, aborted: true, partial: false, message: allowed.message, summary };
        const list = Array.isArray(request.plans) ? request.plans : [];
        list.forEach((plan) => {
            if (!plan || plan.willWrite) return;
            if (plan.selected) {
                const messages = (plan.issues || []).filter((item) => item.level === 'error').map((item) => item.message);
                summary.skippedRows.push({
                    label: plan.label,
                    extractedName: plan.extractedName,
                    source: plan.source,
                    message: messages.join(' ') || plan.reason || 'This row was not imported.'
                });
            }
            if (plan.action === 'skip' || plan.action === 'duplicate') summary.skipped += 1;
            else summary.excluded += 1;
        });
        const writes = list.filter((plan) => plan && plan.willWrite && plan.selected !== false);
        if (!writes.length) {
            const detail = summary.skippedRows.map((row) => `${row.extractedName || row.label}: ${row.message}`).join(' ');
            return {
                ok: false,
                aborted: true,
                partial: false,
                message: detail || 'No selected rows are ready to import. Nothing was saved.',
                summary
            };
        }
        if (!request.client || typeof request.client.from !== 'function') {
            return { ok: false, aborted: true, partial: false, message: 'The database client is not available.', summary };
        }
        for (let i = 0; i < writes.length; i++) {
            const plan = writes[i];
            if (!plan.facultyId || (plan.action !== 'insert' && plan.action !== 'update')) {
                summary.failed.push(failure(plan, 'The assignment was not safe to write.'));
                continue;
            }
            try {
                let response;
                if (plan.action === 'insert') {
                    if (!plan.payload || String(plan.payload.faculty_id) !== String(plan.facultyId)) {
                        throw new Error('The insert did not have a confirmed faculty record.');
                    }
                    response = await request.client.from('faculty_teaching_loads').insert(plan.payload).select('id');
                } else {
                    if (!plan.existingId || !plan.patch || !Object.keys(plan.patch).length) {
                        throw new Error('The update did not identify an existing assignment.');
                    }
                    const patch = Object.assign({}, plan.patch, { updated_at: (request.now || new Date()).toISOString() });
                    delete patch.faculty_id;
                    response = await request.client.from('faculty_teaching_loads').update(patch).eq('id', plan.existingId).eq('faculty_id', plan.facultyId).select('id');
                }
                const error = response && response.error;
                const data = response && response.data;
                if (error || !Array.isArray(data) || !data.length || !data[0].id) {
                    summary.failed.push(failure(plan, (error && error.message) || 'The database did not confirm this change. It may have been blocked by permissions.'));
                } else if (plan.action === 'insert') summary.inserted += 1;
                else summary.updated += 1;
            } catch (err) {
                summary.failed.push(failure(plan, err && err.message ? err.message : 'The assignment could not be saved.'));
            }
        }
        const wrote = summary.inserted + summary.updated;
        return {
            ok: summary.failed.length === 0 && wrote > 0,
            aborted: false,
            partial: summary.failed.length > 0 && wrote > 0,
            message: '',
            summary
        };
    }

    function facultyLabel(faculty) {
        if (!faculty) return '';
        return [faculty.full_name, faculty.employee_id, faculty.department].filter(Boolean).join(' · ');
    }

    function sourceLabel(source) {
        if (!source) return '';
        if (source.fileType === 'pdf') return `Page ${source.page}`;
        return [source.sheet || 'Sheet', source.row ? `row ${source.row}` : ''].filter(Boolean).join(' · ');
    }

    function unresolved(plan) {
        const status = plan && plan.match && plan.match.status;
        return status === 'unmatched' || status === 'ambiguous' || status === 'suggested';
    }

    return {
        MAX_FILE_BYTES,
        OCR_MESSAGE,
        PARTIAL_NOTICE,
        validateWorkloadFile,
        sheetsFromWorkbook,
        parseSheetRows,
        parsePdfPages,
        normalizeDraft,
        matchFaculty,
        planBatch,
        summarizePlans,
        planSignature,
        assertImportAllowed,
        commitImport,
        facultyLabel,
        sourceLabel,
        unresolved,
        fieldIssues,
        selectedFacultyId,
        previewValue,
        renderPreviewInput,
        applyPreviewEdit
    };
});
