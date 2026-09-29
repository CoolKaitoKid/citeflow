const assert = require('assert');
const search = require('../shared/global-search.js');

const facultyPages = search.catalogFor('faculty').map((page) => page.title);
const chairPages = search.catalogFor('chair').map((page) => page.title);
const adminPages = search.catalogFor('admin').map((page) => page.title);

assert(facultyPages.includes('Submissions'));
assert(!facultyPages.includes('User Management'));
assert(!facultyPages.includes('Faculty Profiles'));
assert(chairPages.includes('Chairperson Review'));
assert(!chairPages.includes('User Management'));
assert(adminPages.includes('Faculty Profiles'));
assert(adminPages.includes('Submissions'));
assert(!adminPages.includes('Chairperson Review'));

const mfoPages = search.matchPages('mfo', 'faculty').map((item) => item.title);
assert(mfoPages.includes('MFO Report'), mfoPages.join(','));
assert(!search.matchPages('mfo', 'faculty').some((item) => item.href.includes('faculty-profile')));

assert(search.matchPages('sub', 'faculty').some((item) => item.title === 'Submissions'));
assert(search.matchPages('TASK', 'admin').some((item) => item.href === 'workload-tracker.html'));
assert(search.matchPages('doc', 'faculty').some((item) => item.href === 'document.html'));
assert(search.matchPages('calendar', 'admin').some((item) => item.href === 'calendar.html'));
assert.strictEqual(search.sanitizeQuery('  MFO  '), 'MFO');
assert(search.textHit('MFO Report — 1st Quarter', 'mfo report'));
assert.deepStrictEqual(search.statusValuesFor('pending'), ['submitted', 'late', 'underreview']);
assert.deepStrictEqual(search.statusValuesFor('Approved'), ['approved']);

const facultyTask = search.destinationFor({
    category: 'tasks',
    taskId: 'task-1',
    recordId: 'task-1'
}, { portal: 'faculty', role: 'faculty' });
assert.strictEqual(facultyTask.href, 'submissions.html#task=task-1');

const chairSubmission = search.destinationFor({
    category: 'submissions',
    recordId: 'sub-9',
    taskId: 'task-2',
    chairReview: true
}, { portal: 'faculty', role: 'chair' });
assert.strictEqual(chairSubmission.href, 'submissions.html#chair-review');
assert.strictEqual(chairSubmission.chairSubmission, 'sub-9');

const adminSubmission = search.destinationFor({
    category: 'submissions',
    recordId: 'sub-3',
    taskId: 'task-3'
}, { portal: 'admin', role: 'admin' });
assert.strictEqual(adminSubmission.href, 'workflow-approval.html#task=task-3');
assert(!adminSubmission.href.includes('faculty-profile'));

const facultyDoc = search.destinationFor({
    category: 'documents',
    title: 'MFO Template'
}, { portal: 'faculty', role: 'faculty' });
assert(facultyDoc.href.startsWith('document.html#task='));

const adminDoc = search.destinationFor({
    category: 'documents',
    title: 'Policy'
}, { portal: 'admin', role: 'admin' });
assert.strictEqual(adminDoc.href, 'document-vault.html');

const eventDest = search.destinationFor({
    category: 'calendar',
    recordId: 'event-1'
}, { portal: 'faculty', role: 'faculty' });
assert.strictEqual(eventDest.href, 'calendar.html#open=event-1');

const ownProfile = search.destinationFor({
    category: 'faculty',
    ownProfile: true
}, { portal: 'faculty', role: 'faculty' });
assert.strictEqual(ownProfile.href, 'faculty-profile.html');

const adminPerson = search.destinationFor({
    category: 'faculty'
}, { portal: 'admin', role: 'admin' });
assert.strictEqual(adminPerson.href, 'faculty-profiles.html');

const calendarSql = search.calendarFilter('seminar', { role: 'faculty', faculty: { department: 'BSIT' }, departments: [] });
assert(calendarSql.includes('title.ilike.%seminar%'));
assert(calendarSql.includes('bsit'));
assert(!calendarSql.includes('admin_only'));

const adminCalendar = search.calendarFilter('seminar', { role: 'admin', faculty: null, departments: [] });
assert(!adminCalendar.includes('visibility_scope'));

const grouped = search.groupResults([
    { category: 'tasks', title: 'A' },
    { category: 'submissions', title: 'B' },
    { category: 'pages', title: 'C' }
], 'all');
assert.strictEqual(grouped.tabs[0].count, 3);
assert(grouped.tabs.some((tab) => tab.id === 'submissions' && tab.count === 1));
assert(!grouped.tabs.some((tab) => tab.id === 'documents'));

console.log('global search checks passed');
