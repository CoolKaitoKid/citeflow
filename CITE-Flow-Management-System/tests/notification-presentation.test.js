/**
 * Presentation mapping for the notification center.
 * No database access.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'shared', 'notification-presentation.js');
const context = { console, window: {}, globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
const api = context.window.CiteFlowNotifPresentation;
if (!api) throw new Error('CiteFlowNotifPresentation did not initialize');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const now = new Date('2026-09-29T12:00:00+08:00');

function present(notification) {
    return api.present(notification);
}

const reminder = present({
    type: 'task',
    message: 'Reminder: "MFO Report" is due in 3 days (Sep 29, 2026, 5:00 PM Asia/Manila).',
    task_id: 4,
    is_read: false,
    created_at: '2026-09-29T11:55:00'
});
assert(reminder.title === 'Upcoming Deadline', 'reminder title: ' + reminder.title);
assert(!/^reminder:/i.test(reminder.title), 'reminder prefix removed');
assert(reminder.description.startsWith('The task "MFO Report" is due in 3 days'), reminder.description);
assert(!/Asia\/Manila/i.test(reminder.description), 'timezone label removed from description');
assert(reminder.icon === 'fa-clock', reminder.icon);
assert(reminder.actionLabel === 'View Task', reminder.actionLabel);

const dueToday = present({ type: 'task', message: 'Reminder: "Syllabus" is due today (Sep 29, 2026, 5:00 PM Asia/Manila).' });
assert(dueToday.title === 'Task Due Today', dueToday.title);

const assigned = present({ type: 'task', message: 'New task "Refine color tokens" assigned to you', task_id: 8 });
assert(assigned.title === 'New Task Assigned', assigned.title);
assert(assigned.description === 'You have been assigned "Refine color tokens".', assigned.description);
assert(assigned.icon === 'fa-clipboard-list', assigned.icon);

const chair = present({
    type: 'submission',
    message: 'New submission from Juan Dela Cruz requires Chairperson review: MFO Report',
    task_id: 3
});
assert(chair.title === 'MFO Report Awaiting Review', chair.title);
assert(chair.actionLabel === 'Review Submission', chair.actionLabel);
assert(chair.description === 'An MFO report is waiting for your review.', chair.description);
assert(!/^your /i.test(chair.description), 'chair copy must not be faculty-facing');

const dean = present({
    type: 'review',
    message: 'Final approval required: MFO Report',
    task_id: 3
});
assert(dean.title === 'Final Approval Needed', dean.title);
assert(dean.actionLabel === 'Review Submission', dean.actionLabel);
assert(/Dean's Office/.test(dean.description), dean.description);
assert(!/has been approved by the Chairperson/.test(dean.description), dean.description);

const approved = present({
    type: 'review',
    message: 'Submission approved by chairperson — pending final approval: MFO Report',
    task_id: 3
});
assert(approved.title === 'Submission Approved', approved.title);
assert(approved.description === "Your MFO report has been approved by the Chairperson and is now pending final approval from the Dean's Office.", approved.description);
assert(!/\badmin\b/i.test(approved.description), 'admin word in approval description');
assert(approved.icon === 'fa-circle-check', approved.icon);

const finalApproval = present({ type: 'review', message: 'Submission fully approved: Weekly Report', task_id: 9 });
assert(finalApproval.title === 'Final Approval Completed', finalApproval.title);
assert(/Dean's Office/.test(finalApproval.description), finalApproval.description);

const revision = present({ type: 'review', message: 'Revision required: Lesson Plan', task_id: 2 });
assert(revision.title === 'Revision Requested', revision.title);
assert(revision.actionLabel === 'Review Revision', revision.actionLabel);
assert(revision.icon === 'fa-pen-to-square', revision.icon);

const declined = present({ type: 'review', message: 'Submission rejected: Lesson Plan', task_id: 2 });
assert(declined.title === 'Submission Declined', declined.title);
assert(declined.icon === 'fa-circle-xmark', declined.icon);

const submitted = present({ type: 'submission', message: 'New submission from Ana Reyes: MFO Report', task_id: 6 });
assert(submitted.title === 'MFO Report Submitted', submitted.title);
assert(submitted.description === 'Your MFO report has been submitted.', submitted.description);

const certified = present({
    type: 'review',
    message: 'Your accomplishment report (Jan 1, 2026 – Jan 31, 2026) has been certified by Chairperson Maria Santos.',
    link: 'faculty-profile.html#accomplishments-subs'
});
assert(certified.title === 'Report Certified', certified.title);
assert(/Chairperson Maria Santos/.test(certified.description), certified.description);
assert(certified.actionLabel === 'View Report', certified.actionLabel);

const reportFinal = present({
    type: 'review',
    message: 'Your accomplishment report (Jan 1, 2026 – Jan 31, 2026) has been fully approved by Admin User.'
});
assert(reportFinal.title === 'Final Approval Completed', reportFinal.title);
assert(/Dean's Office/.test(reportFinal.description), reportFinal.description);
assert(!/\badmin\b/i.test(reportFinal.description), reportFinal.description);

const calendar = present({
    type: 'calendar',
    title: 'New calendar schedule',
    message: 'Design Review (meeting) was posted • Mon, Sep 29, 9:00 AM.',
    link: 'calendar.html'
});
assert(calendar.title === 'New Schedule Posted', calendar.title);
assert(calendar.actionLabel === 'Open Calendar', calendar.actionLabel);
assert(calendar.icon === 'fa-calendar-days', calendar.icon);

const access = present({
    type: 'system',
    message: 'You were granted Chairperson/OIC workflow access for BSIT.'
});
assert(access.title === 'Workflow Access Granted', access.title);
assert(access.actionLabel === 'Review Submissions', access.actionLabel);

const expiry = present({
    type: 'document_expiry',
    title: 'Document Expired',
    message: 'Your document "License" has expired on 2026-09-01. Please upload a renewed copy. [ref:abc12345]'
});
assert(expiry.title === 'Document Expired', expiry.title);
assert(!/\[ref:/i.test(expiry.description), expiry.description);
assert(expiry.actionLabel === '', 'document expiry has no invented action');

assert(api.isProfileUpdate({ type: 'profile_update', message: 'Your profile was updated.' }), 'profile type hidden');
assert(api.isProfileUpdate({ type: 'system', message: 'Faculty profile update saved.' }), 'profile wording hidden');
assert(!api.isProfileUpdate({ type: 'document_uploaded', message: 'An administrator uploaded "Profile" to your documents portfolio.' }), 'document upload stays');
assert(!api.isProfileUpdate(approved), 'approval is not a profile update');

assert(api.formatRelativeTime('2026-09-29T11:55:00+08:00', now) === '5 minutes ago', api.formatRelativeTime('2026-09-29T11:55:00+08:00', now));
assert(api.formatRelativeTime('2026-09-29T03:55:00Z', now) === '5 minutes ago', api.formatRelativeTime('2026-09-29T03:55:00Z', now));
assert(api.formatRelativeTime('2026-09-29T10:00:00+08:00', now) === '2 hours ago', api.formatRelativeTime('2026-09-29T10:00:00+08:00', now));
assert(api.formatRelativeTime('2026-09-28T15:00:00+08:00', now) === 'Yesterday', api.formatRelativeTime('2026-09-28T15:00:00+08:00', now));
assert(api.formatRelativeTime('2026-09-28T10:00:00Z', new Date('2026-09-29T00:30:00Z')) === 'Yesterday', api.formatRelativeTime('2026-09-28T10:00:00Z', new Date('2026-09-29T00:30:00Z')));
assert(api.formatRelativeTime('2026-09-20T16:30:00Z', new Date('2026-10-01T16:00:00Z')) === 'Sep 21', api.formatRelativeTime('2026-09-20T16:30:00Z', new Date('2026-10-01T16:00:00Z')));
assert(api.formatRelativeTime(new Date().toISOString()) === 'Just now', api.formatRelativeTime(new Date().toISOString()));

const card = api.renderCard({
    id: 12,
    type: 'review',
    message: 'Submission approved by chairperson — pending final approval: MFO Report',
    is_read: false,
    created_at: '2026-09-29T11:55:00',
    task_id: 3
});
assert(card.includes('fa-circle-check'), 'icon rendered');
assert(card.includes('nav-notif-dot'), 'unread dot');
assert(card.includes('View Submission'), 'action button');
assert(!card.includes('Reminder:'), 'stored prefix not shown');
assert(!/>[^<]*\bAdmin\b/i.test(card), 'admin label not shown in card');

const readCard = api.renderCard({ id: 13, type: 'task', message: 'New task "Syllabus" assigned to you', is_read: true, task_id: 1 });
assert(!readCard.includes('nav-notif-dot'), 'read card has no unread dot');
assert(!readCard.includes('unread'), 'read card is not marked unread');

console.log('notification presentation checks passed');
