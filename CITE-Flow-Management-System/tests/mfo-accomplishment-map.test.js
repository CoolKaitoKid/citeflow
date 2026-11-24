/**
 * Mapper-level checks for faculty_accomplishments → MFO.
 * Loads shared/mfo-sources.js in Node. No database writes.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'shared', 'mfo-sources.js');
const context = { console, window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
const api = context.window.CiteFlowMfoSources;
if (!api) {
    throw new Error('CiteFlowMfoSources did not initialize');
}

const period = { period_start: '2026-01-01', period_end: '2026-03-31' };

function acc(overrides) {
    return Object.assign({
        id: 101,
        faculty_id: 61,
        title: 'Campus Training',
        accomplishment_type: 'Training',
        description: 'Faculty attended the training.',
        date_achieved: '2026-02-10',
        venue: 'CTU Argao Gym',
        photo_attachments: []
    }, overrides);
}

function loaded(rows) {
    return {
        rows: { faculty_accomplishments: rows },
        facultyById: new Map([['61', { id: 61, full_name: 'Test Faculty' }]])
    };
}

function candidatesFor(rows, opts) {
    return api.buildCandidates(loaded(rows), Object.assign({
        period,
        includeUndated: true
    }, opts));
}

function first(section, rows) {
    const list = candidatesFor(rows)[section] || [];
    return list[0] || null;
}

const results = [];
function test(name, fn) {
    try {
        fn();
        results.push({ name, ok: true });
    } catch (error) {
        results.push({ name, ok: false, error: error.message });
    }
}

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

test('TEST 1 Training → PI7', () => {
    const row = first('mfo1_pi7', [acc({ accomplishment_type: 'Training' })]);
    assert(row, 'missing PI7 candidate');
    assert(row.fields.title === 'Campus Training', 'title');
    assert(row.fields.activity_date === '2026-02-10', 'date');
    assert(row.fields.remarks === 'Faculty attended the training.', 'description');
    assert(row.fields.venue === 'CTU Argao Gym', 'venue');
    assert(row.sourceTable === 'faculty_accomplishments', 'source_table');
    assert(row.sourceId === '101', 'source_id');
});

test('TEST 2 Seminar → PI7', () => {
    assert(first('mfo1_pi7', [acc({ accomplishment_type: 'Seminar' })]), 'seminar');
});

test('TEST 3 Workshop → PI7', () => {
    assert(first('mfo1_pi7', [acc({ accomplishment_type: 'Workshop' })]), 'workshop');
});

test('TEST 4 Conference → PI7', () => {
    assert(first('mfo1_pi7', [acc({ accomplishment_type: 'Conference' })]), 'conference');
});

test('TEST 5 Certification → PI5', () => {
    const row = first('mfo1_pi5', [acc({ id: 102, accomplishment_type: 'Certification', title: 'NC II' })]);
    assert(row, 'missing PI5');
    assert(row.fields.certification_title === 'NC II', 'title');
    assert(row.fields.date_granted === '2026-02-10', 'date');
});

test('TEST 6 Award → awards', () => {
    const row = first('awards', [acc({ id: 103, accomplishment_type: 'Award', title: 'Best Paper' })]);
    assert(row, 'missing award');
    assert(row.fields.award_title === 'Best Paper', 'title');
});

test('TEST 7 Other → other_initiatives', () => {
    const row = first('other_initiatives', [acc({ id: 104, accomplishment_type: 'Other', title: 'Committee work' })]);
    assert(row, 'missing other');
    assert(row.fields.activity_title === 'Committee work', 'title');
    assert(row.fields.venue === 'CTU Argao Gym', 'venue');
    assert(row.table === 'mfo_other_initiatives', 'table');
});

test('TEST 8 venue copied into PI7', () => {
    const row = first('mfo1_pi7', [acc({ venue: 'Room 204' })]);
    assert(row.fields.venue === 'Room 204', 'venue not copied');
});

test('TEST 9 no duplicate on second merge', () => {
    const cand = candidatesFor([acc()])['mfo1_pi7'];
    const firstMerge = api.mergeCandidates([], cand, { newRow: () => ({}) });
    const secondMerge = api.mergeCandidates(firstMerge.rows, cand, { newRow: () => ({}), refreshSystemValues: true });
    assert(firstMerge.added === 1, 'first add');
    assert(secondMerge.added === 0, 'second add should be 0');
    assert(secondMerge.rows.length === 1, 'one row');
});

test('TEST 10 system field refreshes on edit', () => {
    const original = candidatesFor([acc({ title: 'Old title' })])['mfo1_pi7'];
    const merged = api.mergeCandidates([], original, { newRow: () => ({}) });
    const updated = candidatesFor([acc({ title: 'New title' })])['mfo1_pi7'];
    const again = api.mergeCandidates(merged.rows, updated, { newRow: () => ({}), refreshSystemValues: true });
    assert(again.rows[0].title === 'New title', 'system title should refresh');
    assert(again.added === 0, 'must not add a second row');
});

test('TEST 11 manual field is preserved', () => {
    const cand = candidatesFor([acc({ venue: 'Auto Venue' })])['mfo1_pi7'];
    const merged = api.mergeCandidates([], cand, { newRow: () => ({}) });
    api.markManual(merged.rows[0], 'venue');
    merged.rows[0].venue = 'Manually typed hall';
    const updated = candidatesFor([acc({ venue: 'Changed source venue' })])['mfo1_pi7'];
    const again = api.mergeCandidates(merged.rows, updated, { newRow: () => ({}), refreshSystemValues: true });
    assert(again.rows[0].venue === 'Manually typed hall', 'manual venue overwritten');
    assert(again.rows[0].title === 'Campus Training', 'system title still refreshes');
});

test('TEST 12 outside period is excluded', () => {
    const row = first('mfo1_pi7', [acc({ date_achieved: '2025-12-31' })]);
    assert(!row, 'out-of-period row was mapped');
});

test('TEST 13 inside period is included', () => {
    const row = first('mfo1_pi7', [acc({ date_achieved: '2026-03-31' })]);
    assert(row, 'in-period row missing');
});

test('Undated accomplishment is not mapped', () => {
    const row = first('mfo1_pi7', [acc({ date_achieved: null })]);
    assert(!row, 'undated row was mapped');
});

test('Other is not also mapped to PI7', () => {
    const all = candidatesFor([acc({ accomplishment_type: 'Other' })]);
    assert(!(all.mfo1_pi7 || []).length, 'Other leaked into PI7');
    assert((all.other_initiatives || []).length === 1, 'Other destination');
});

test('Photos produce documentation candidates without a second mapper', () => {
    const all = candidatesFor([acc({
        photo_attachments: [{ title: 'Session photo', photo_url: 'https://example.test/faculty-61/a.jpg' }]
    })]);
    const docs = all.documentation_pi7 || [];
    assert(docs.length === 1, 'documentation candidate');
    assert(docs[0].table === 'mfo_documentation_items', 'doc table');
    assert(docs[0].fields.section_code === 'mfo1_pi7', 'section');
    assert(docs[0].sourceId === '101', 'doc source id');
    const photos = api.accomplishmentPhotos(acc({
        photo_attachments: [{ title: 'Session photo', photo_url: 'https://example.test/faculty-61/a.jpg' }]
    }));
    assert(photos.length === 1 && photos[0].file_url.includes('faculty-61'), 'photo ref');
});

test('CITEFLOW metadata comments are stripped from descriptions across PI8, PI7, Research, and Documentation', () => {
    const docDataComment = '<!-- CITEFLOW_DOC_DATA:%7B%22media_files%22%3A%5B%7B%22name%22%3A%2201-File.pdf%22%7D%5D%2C%22extension_project_id%22%3Anull%2C%22sub_category%22%3A%22General%22%7D -->';
    const accompDataComment = '<!-- CITEFLOW_ACCOMP_DATA:%7B%22duration_hours%22%3A8%7D -->';
    const researchDataComment = '<!-- CITEFLOW_RESEARCH_DATA:%7B%22budget%22%3A50000%7D -->';

    const loadedWithMeta = {
        rows: {
            faculty_documents: [{
                id: 201,
                faculty_id: 61,
                title: 'work of tesla the goat',
                document_type: 'Teaching Material',
                category: 'Instructional',
                uploaded_at: '2026-02-15',
                description: `blah blah blah ${docDataComment}`
            }],
            faculty_accomplishments: [acc({
                id: 202,
                description: `Seminar remarks ${accompDataComment}`,
                photo_attachments: [{ title: 'Photo 1', photo_url: 'https://example.test/a.jpg' }]
            })],
            faculty_research_projects: [{
                id: 203,
                faculty_id: 61,
                title: 'AI Research',
                status: 'Completed',
                end_date: '2026-02-20',
                description: `Completed study ${researchDataComment}`
            }]
        },
        facultyById: new Map([['61', { id: 61, full_name: 'KrishPao A. Ars' }]])
    };

    const built = api.buildCandidates(loadedWithMeta, { period, includeUndated: true });
    const pi8 = (built.mfo1_pi8 || [])[0];
    assert(pi8, 'missing PI8 candidate');
    assert(pi8.fields.remarks === 'blah blah blah', `expected clean PI8 remarks, got: ${pi8.fields.remarks}`);

    const pi7 = (built.mfo1_pi7 || [])[0];
    assert(pi7, 'missing PI7 candidate');
    assert(pi7.fields.remarks === 'Seminar remarks', `expected clean PI7 remarks, got: ${pi7.fields.remarks}`);

    const docItem = (built.documentation_pi7 || [])[0];
    assert(docItem, 'missing documentation candidate');
    assert(docItem.fields.narrative === 'Seminar remarks', `expected clean doc narrative, got: ${docItem.fields.narrative}`);

    const resItem = (built.mfo3_pi2 || [])[0];
    assert(resItem, 'missing research candidate');
    assert(resItem.fields.remarks === 'Completed study', `expected clean research remarks, got: ${resItem.fields.remarks}`);
});

const failed = results.filter((item) => !item.ok);
results.forEach((item) => {
    console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.error ? ' — ' + item.error : ''}`);
});
if (failed.length) {
    console.error(`\n${failed.length} failed`);
    process.exit(1);
}
console.log(`\n${results.length} passed`);
