/**
 * Presentation-only helpers for the CITE-Flow notification center.
 * Does not create, store, or mark notifications as read.
 */
(function (root) {
    function text(value) {
        return String(value ?? '');
    }

    function esc(value) {
        return text(value).replace(/[&<>'"]/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[char]));
    }

    function collapse(value) {
        return text(value).replace(/\s+/g, ' ').trim();
    }

    function sentence(value) {
        const clean = collapse(value);
        if (!clean) return '';
        return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    function quoted(value) {
        const match = text(value).match(/"([^"]+)"/);
        return match ? collapse(match[1]) : '';
    }

    function stripLabelPrefix(value) {
        return collapse(value).replace(/^(reminder|approval|rejection|revision|submission|task|notification)\s*:\s*/i, '');
    }

    function stripRef(value) {
        return collapse(value).replace(/\s*\[ref:[^\]]+\]\s*/gi, ' ');
    }

    function deansOffice(value) {
        let next = text(value);
        next = next.replace(/\bpending admin final approval\b/gi, "pending final approval from the Dean's Office");
        next = next.replace(/\badmin final approval\b/gi, "final approval from the Dean's Office");
        next = next.replace(/\bfinal approval by (the )?admin\b/gi, "final approval from the Dean's Office");
        next = next.replace(/\bapproved by (the )?admin\b/gi, "approved by the Dean's Office");
        next = next.replace(/\bby the admin\b/gi, "by the Dean's Office");
        next = next.replace(/\bby admin\b/gi, "by the Dean's Office");
        if (/pending final approval/i.test(next) && !/dean/i.test(next)) {
            next = next.replace(/pending final approval/i, "pending final approval from the Dean's Office");
        }
        return collapse(next);
    }

    function isProfileUpdate(notification) {
        const type = text(notification?.type).toLowerCase();
        if (type === 'profile' || type === 'profile_update' || type === 'profile-update') return true;
        const blob = `${notification?.title || ''} ${notification?.message || ''}`.toLowerCase();
        if (/\bdocument\b/.test(blob)) return false;
        return /\bprofile update\b|\bupdated (your|the|their|a) profile\b|\bprofile was updated\b|\bprofile has been updated\b/.test(blob);
    }

    function isMfo(value) {
        return /\bmfo\b/i.test(text(value));
    }

    function subjectPhrase(title, message) {
        const blob = `${title || ''} ${message || ''}`;
        if (isMfo(blob)) return 'MFO report';
        if (/accomplishment report/i.test(blob)) return 'accomplishment report';
        return 'submission';
    }

    function namedSubject(title, message) {
        const name = collapse(title);
        const phrase = subjectPhrase(name, message);
        if (!name) return `your ${phrase}`;
        if (phrase === 'MFO report' && /^mfo(\s+report)?$/i.test(name)) return 'your MFO report';
        if (phrase === 'accomplishment report' && /accomplishment report/i.test(name)) return 'your accomplishment report';
        return `your ${phrase} "${name}"`;
    }

    function accomplishmentPeriod(message) {
        const match = text(message).match(/accomplishment report\s*(\([^)]+\))/i);
        return match ? ` ${match[1]}` : '';
    }

    function remarksFrom(message) {
        const match = text(message).match(/remarks:\s*(.+)$/i);
        if (!match) return '';
        const remarks = collapse(match[1]);
        if (!remarks || /^please revise and resubmit\.?$/i.test(remarks)) return '';
        return remarks;
    }

    function afterColon(message) {
        const match = text(message).match(/:\s*(.+)$/);
        return match ? collapse(match[1].replace(/\.$/, '')) : '';
    }

    function personFrom(message) {
        const patterns = [
            /^(?:resubmission|new submission) from\s+(.+?)(?:\s+requires|:)/i,
            /^(.+?)\s+(?:deleted|replaced|added) a file on/i,
            /^(.+?)\s+updated files/i,
            /certified by chairperson\s+(.+?)\.?$/i,
            /returned for revision by\s+(.+?)(?:\.|$)/i,
            /declined by\s+(.+?)\.?$/i
        ];
        for (const pattern of patterns) {
            const match = text(message).match(pattern);
            if (match && collapse(match[1])) return collapse(match[1]);
        }
        return '';
    }

    const MANILA_TZ = 'Asia/Manila';

    function hasExplicitZone(value) {
        return /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
    }

    function parseInstant(value) {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        let iso = raw.indexOf('T') === -1 && raw.indexOf(' ') > 0 ? raw.replace(' ', 'T') : raw;
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
        else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) && !hasExplicitZone(iso)) iso += 'Z';
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function manilaDayStamp(date) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: MANILA_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const read = (type) => Number(parts.find((part) => part.type === type)?.value);
        return Date.UTC(read('year'), read('month') - 1, read('day'));
    }

    function formatRelativeTime(iso, now) {
        if (!iso) return '';
        const date = parseInstant(iso);
        const current = now == null || now === '' ? new Date() : parseInstant(now);
        if (!date || !current) return '';
        const diff = current.getTime() - date.getTime();
        if (diff < 45000) return 'Just now';
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
        const dayDiff = Math.round((manilaDayStamp(current) - manilaDayStamp(date)) / 86400000);
        if (dayDiff <= 0) {
            const hours = Math.floor(diff / 3600000);
            return hours <= 1 ? '1 hour ago' : `${hours} hours ago`;
        }
        if (dayDiff === 1) return 'Yesterday';
        if (dayDiff < 7) return `${dayDiff} days ago`;
        return new Intl.DateTimeFormat('en-US', {
            timeZone: MANILA_TZ,
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function view(partial) {
        return {
            category: partial.category || 'system',
            icon: partial.icon || 'fa-bell',
            tone: partial.tone || 'neutral',
            title: sentence(partial.title || 'Notification'),
            description: sentence(deansOffice(partial.description || '')),
            actionLabel: partial.actionLabel || '',
            subjectTitle: partial.subjectTitle || ''
        };
    }

    function present(notification) {
        const type = text(notification?.type).toLowerCase();
        const rawTitle = collapse(notification?.title);
        const rawMessage = stripRef(notification?.message);
        const message = stripLabelPrefix(rawMessage);
        const lower = `${rawTitle} ${rawMessage}`.toLowerCase();
        const taskTitle = quoted(rawMessage) || quoted(rawTitle);
        const trailing = afterColon(rawMessage);

        if (type === 'calendar' || type === 'event' || type === 'schedule' || /calendar schedule|was posted|was updated/.test(lower) && /schedule|seminar|workshop|meeting|exam|calendar/.test(lower)) {
            let title = 'New Schedule Posted';
            if (/cancel|removed/.test(lower)) title = 'Schedule Cancelled';
            else if (/updated/.test(lower)) title = 'Schedule Updated';
            return view({
                category: 'calendar',
                icon: 'fa-calendar-days',
                tone: 'calendar',
                title,
                description: message || rawTitle || 'A calendar schedule changed.',
                actionLabel: 'Open Calendar',
                subjectTitle: taskTitle
            });
        }

        if (type === 'leave' || /leave filing|filed\b.+\bleave\b/i.test(rawMessage)) {
            return view({
                category: 'calendar',
                icon: 'fa-calendar-days',
                tone: 'calendar',
                title: 'Leave Request Filed',
                description: message || rawTitle || 'A leave request was filed.',
                actionLabel: 'Open Calendar'
            });
        }

        if (type === 'feedback' || /submitted feedback|event feedback/.test(lower)) {
            const feedbackPage = /feedback-summary/i.test(text(notification?.link || notification?.url));
            return view({
                category: 'feedback',
                icon: 'fa-comment-dots',
                tone: 'neutral',
                title: 'Event Feedback Received',
                description: message || rawTitle || 'New event feedback was submitted.',
                actionLabel: feedbackPage ? 'View Feedback' : 'Open Calendar'
            });
        }

        if (type === 'document_expiry' || /has expired|will expire/.test(lower)) {
            const expired = /expired/.test(lower);
            return view({
                category: 'document',
                icon: 'fa-file-circle-exclamation',
                tone: 'revision',
                title: rawTitle && !/^reminder:/i.test(rawTitle) ? stripLabelPrefix(rawTitle) : (expired ? 'Document Expired' : 'Document Expiring Soon'),
                description: message || rawTitle,
                actionLabel: '',
                subjectTitle: taskTitle
            });
        }

        if (type === 'document_uploaded') {
            return view({
                category: 'document',
                icon: 'fa-file-lines',
                tone: 'submission',
                title: 'Document Uploaded',
                description: message || 'A document was added to your portfolio.',
                actionLabel: '',
                subjectTitle: taskTitle
            });
        }

        if (type === 'document_verified') {
            return view({
                category: 'approval',
                icon: 'fa-circle-check',
                tone: 'approval',
                title: 'Document Verified',
                description: message || 'A document in your portfolio was verified.',
                actionLabel: '',
                subjectTitle: taskTitle
            });
        }

        if (type === 'document_rejected') {
            return view({
                category: 'rejection',
                icon: 'fa-circle-xmark',
                tone: 'rejection',
                title: 'Document Declined',
                description: message || 'A document in your portfolio was declined.',
                actionLabel: '',
                subjectTitle: taskTitle
            });
        }

        if (/^reminder:/i.test(rawMessage) || /is due\b/i.test(rawMessage)) {
            const dueTitle = taskTitle || trailing || 'Assigned report';
            let title = 'Upcoming Deadline';
            if (/\bdue today\b/i.test(rawMessage)) title = 'Task Due Today';
            else if (/\bdue tomorrow\b/i.test(rawMessage)) title = 'Task Due Tomorrow';
            const when = rawMessage.match(/\(([^)]+)\)/);
            const phraseMatch = rawMessage.match(/is due\s+([^(]+)/i);
            const phrase = phraseMatch ? collapse(phraseMatch[1]) : 'soon';
            const whenText = when ? ` (${collapse(when[1]).replace(/\s*Asia\/Manila\.?$/i, '')})` : '';
            return view({
                category: 'deadline',
                icon: 'fa-clock',
                tone: 'revision',
                title,
                description: `The task "${dueTitle}" is due ${phrase}${whenText}.`,
                actionLabel: 'View Task',
                subjectTitle: dueTitle
            });
        }

        if (/new task\b/i.test(rawMessage) && /assigned/i.test(rawMessage)) {
            const assigned = taskTitle || trailing || 'a new task';
            return view({
                category: 'task',
                icon: 'fa-clipboard-list',
                tone: 'task',
                title: 'New Task Assigned',
                description: assigned === 'a new task'
                    ? 'A new task has been assigned to you.'
                    : `You have been assigned "${assigned}".`,
                actionLabel: 'View Task',
                subjectTitle: taskTitle || (assigned !== 'a new task' ? assigned : '')
            });
        }

        if (/deadline updated/i.test(rawMessage)) {
            const name = taskTitle || 'your task';
            const due = rawMessage.match(/:\s*due\s+(.+)$/i);
            return view({
                category: 'deadline',
                icon: 'fa-clock',
                tone: 'revision',
                title: 'Deadline Updated',
                description: due
                    ? `The deadline for "${name}" is now ${collapse(due[1]).replace(/\.$/, '')}.`
                    : message,
                actionLabel: 'View Task',
                subjectTitle: taskTitle
            });
        }

        if (/workflow access/i.test(rawMessage)) {
            return view({
                category: 'task',
                icon: 'fa-clipboard-list',
                tone: 'task',
                title: 'Workflow Access Granted',
                description: message,
                actionLabel: 'Review Submissions'
            });
        }

        if (/accomplishment report/i.test(rawMessage)) {
            const period = accomplishmentPeriod(rawMessage);
            const remarks = remarksFrom(rawMessage);
            const reviewer = personFrom(rawMessage);
            if (/revis|returned/i.test(rawMessage)) {
                return view({
                    category: 'revision',
                    icon: 'fa-pen-to-square',
                    tone: 'revision',
                    title: 'Revision Requested',
                    description: `Your accomplishment report${period} was returned for revision${reviewer ? ` by ${reviewer}` : ''}.${remarks ? ` Remarks: ${remarks}` : ''}`,
                    actionLabel: 'Review Revision'
                });
            }
            if (/declin|reject/i.test(rawMessage)) {
                return view({
                    category: 'rejection',
                    icon: 'fa-circle-xmark',
                    tone: 'rejection',
                    title: 'Report Declined',
                    description: `Your accomplishment report${period} was declined${reviewer ? ` by ${reviewer}` : ''}.`,
                    actionLabel: 'View Report'
                });
            }
            if (/certified/i.test(rawMessage)) {
                return view({
                    category: 'approval',
                    icon: 'fa-circle-check',
                    tone: 'approval',
                    title: 'Report Certified',
                    description: `Your accomplishment report${period} has been certified${reviewer ? ` by Chairperson ${reviewer.replace(/^chairperson\s+/i, '')}` : ' by the Chairperson'}.`,
                    actionLabel: 'View Report'
                });
            }
            if (/approved/i.test(rawMessage)) {
                return view({
                    category: 'approval',
                    icon: 'fa-circle-check',
                    tone: 'approval',
                    title: 'Final Approval Completed',
                    description: `Your accomplishment report${period} has received final approval from the Dean's Office.`,
                    actionLabel: 'View Report'
                });
            }
        }

        if (/chairperson review/i.test(rawMessage)) {
            const name = personFrom(rawMessage) || 'A faculty member';
            const item = taskTitle || trailing || '';
            const mfo = isMfo(item) || isMfo(rawMessage);
            const resubmit = /resubmission/i.test(rawMessage);
            const fileUpdate = /updated files|deleted a file|replaced a file|added a file/i.test(rawMessage);
            let title = mfo ? 'MFO Report Awaiting Review' : 'Submission Awaiting Review';
            let description = mfo
                ? 'An MFO report is waiting for your review.'
                : `${name} submitted a report that is waiting for your review.`;
            if (resubmit) {
                title = mfo ? 'MFO Report Awaiting Review' : 'Resubmission Awaiting Review';
                description = mfo
                    ? 'A resubmitted MFO report is waiting for your review.'
                    : `${name} resubmitted a report that is waiting for your review.`;
            } else if (fileUpdate) {
                title = 'Submission Awaiting Review';
                description = `${name} updated a submission and it is waiting for your review.`;
            }
            return view({
                category: 'submission',
                icon: 'fa-file-lines',
                tone: 'submission',
                title,
                description,
                actionLabel: 'Review Submission',
                subjectTitle: item
            });
        }

        if (/deleted a file|replaced a file|added a file|updated files/i.test(rawMessage)) {
            return view({
                category: 'submission',
                icon: 'fa-file-lines',
                tone: 'submission',
                title: 'Submission Updated',
                description: message,
                actionLabel: notification?.task_id || notification?.submission_id ? 'View Submission' : '',
                subjectTitle: taskTitle || trailing
            });
        }

        if (/final approval required/i.test(rawMessage)) {
            const name = taskTitle || trailing;
            const mfo = isMfo(name) || isMfo(rawMessage);
            return view({
                category: 'approval',
                icon: 'fa-circle-check',
                tone: 'approval',
                title: 'Final Approval Needed',
                description: mfo
                    ? "An MFO report is waiting for final approval from the Dean's Office."
                    : "A submission is waiting for final approval from the Dean's Office.",
                actionLabel: 'Review Submission',
                subjectTitle: name
            });
        }

        if (/approved by chair/i.test(rawMessage) || (/pending final approval/i.test(rawMessage) && /approv/i.test(rawMessage))) {
            const name = taskTitle || trailing;
            return view({
                category: 'approval',
                icon: 'fa-circle-check',
                tone: 'approval',
                title: 'Submission Approved',
                description: `${sentence(namedSubject(name, rawMessage))} has been approved by the Chairperson and is now pending final approval from the Dean's Office.`,
                actionLabel: 'View Submission',
                subjectTitle: name
            });
        }

        if (/fully approved/i.test(rawMessage) || (/^submission fully approved/i.test(rawMessage))) {
            const name = taskTitle || trailing;
            return view({
                category: 'approval',
                icon: 'fa-circle-check',
                tone: 'approval',
                title: 'Final Approval Completed',
                description: `${sentence(namedSubject(name, rawMessage))} has received final approval from the Dean's Office.`,
                actionLabel: 'View Submission',
                subjectTitle: name
            });
        }

        if (/revision required|returned for revision|needs revision/i.test(rawMessage)) {
            const name = taskTitle || trailing;
            const remarks = remarksFrom(rawMessage);
            return view({
                category: 'revision',
                icon: 'fa-pen-to-square',
                tone: 'revision',
                title: 'Revision Requested',
                description: `${sentence(namedSubject(name, rawMessage))} was returned for revision.${remarks ? ` Remarks: ${remarks}` : ' Please review the remarks and resubmit.'}`,
                actionLabel: 'Review Revision',
                subjectTitle: name
            });
        }

        if (/submission rejected|was rejected|was declined|\brejected\b|\bdeclined\b/i.test(rawMessage)) {
            const name = taskTitle || trailing;
            return view({
                category: 'rejection',
                icon: 'fa-circle-xmark',
                tone: 'rejection',
                title: 'Submission Declined',
                description: name
                    ? `${sentence(namedSubject(name, rawMessage))} was declined.`
                    : 'A submission was declined.',
                actionLabel: name || notification?.task_id || notification?.submission_id ? 'View Submission' : '',
                subjectTitle: name
            });
        }

        if (/^(?:resubmission|new submission) from\b/i.test(rawMessage)) {
            const name = taskTitle || trailing;
            const resubmit = /^resubmission/i.test(rawMessage);
            const mfo = isMfo(name) || isMfo(rawMessage);
            let title = resubmit ? 'Submission Resubmitted' : 'Submission Sent';
            if (mfo) title = resubmit ? 'MFO Report Resubmitted' : 'MFO Report Submitted';
            const owned = namedSubject(name, rawMessage);
            return view({
                category: 'submission',
                icon: 'fa-file-lines',
                tone: 'submission',
                title,
                description: resubmit
                    ? `${sentence(owned)} was resubmitted for review.`
                    : `${sentence(owned)} has been submitted.`,
                actionLabel: 'View Submission',
                subjectTitle: name
            });
        }

        if (type === 'task' || type === 'assignment' || type === 'reminder' || type === 'deadline') {
            return view({
                category: 'task',
                icon: 'fa-clipboard-list',
                tone: 'task',
                title: rawTitle && !/^reminder:/i.test(rawTitle) ? stripLabelPrefix(rawTitle) : 'Task Update',
                description: message || rawTitle,
                actionLabel: notification?.task_id || taskTitle ? 'View Task' : '',
                subjectTitle: taskTitle
            });
        }

        if (type === 'submission') {
            return view({
                category: 'submission',
                icon: 'fa-file-lines',
                tone: 'submission',
                title: 'Submission Update',
                description: message || rawTitle,
                actionLabel: notification?.task_id || notification?.submission_id || taskTitle ? 'View Submission' : '',
                subjectTitle: taskTitle
            });
        }

        if (type === 'review' || type === 'comment') {
            let category = 'approval';
            let icon = 'fa-circle-check';
            let tone = 'approval';
            let title = 'Review Update';
            let actionLabel = 'View Submission';
            if (/revis/.test(lower)) {
                category = 'revision';
                icon = 'fa-pen-to-square';
                tone = 'revision';
                title = 'Revision Requested';
                actionLabel = 'Review Revision';
            } else if (/reject|declin/.test(lower)) {
                category = 'rejection';
                icon = 'fa-circle-xmark';
                tone = 'rejection';
                title = 'Submission Declined';
            } else if (/approv|certif/.test(lower)) {
                title = /final|fully/.test(lower) ? 'Final Approval Completed' : 'Submission Approved';
            }
            return view({
                category,
                icon,
                tone,
                title,
                description: message || rawTitle,
                actionLabel: notification?.task_id || notification?.submission_id || notification?.link || taskTitle ? actionLabel : '',
                subjectTitle: taskTitle
            });
        }

        const fallbackTitle = stripLabelPrefix(rawTitle) || stripLabelPrefix(message).split(/[.!?]/)[0];
        return view({
            category: 'system',
            icon: 'fa-bell',
            tone: 'neutral',
            title: fallbackTitle || 'Notification',
            description: message && fallbackTitle && message.toLowerCase() !== fallbackTitle.toLowerCase() ? message : (message || rawTitle),
            actionLabel: '',
            subjectTitle: taskTitle
        });
    }

    function hasSpecificDestination(notification) {
        if (isProfileUpdate(notification)) return false;
        const stored = collapse(notification?.link || notification?.url || notification?.href || notification?.page);
        if (stored) return true;
        if (notification?.task_id || notification?.submission_id || notification?.event_id || notification?.document_id || notification?.workflow_item_id) {
            return true;
        }
        const presented = present(notification);
        if (presented.actionLabel) return true;
        const message = text(notification?.message).toLowerCase();
        if (/accomplishment report|chairperson review|calendar\.html|workflow access/.test(message)) return true;
        if (presented.subjectTitle) return true;
        return false;
    }

    function renderCard(notification, extraAttrs) {
        const presented = present(notification);
        const unread = !notification?.is_read;
        const action = hasSpecificDestination(notification) ? presented.actionLabel : '';
        const time = formatRelativeTime(notification?.created_at);
        const raw = collapse(notification?.message || notification?.title || '');
        const attrs = extraAttrs ? ` ${extraAttrs}` : '';
        return `
            <div class="nav-notif-item${unread ? ' unread' : ''}" data-notif-id="${esc(notification?.id)}" data-raw="${esc(raw)}" data-type="${esc(notification?.type || '')}" data-link="${esc(notification?.link || notification?.url || '')}" role="button" tabindex="0"${attrs}>
                <div class="nav-notif-row">
                    <span class="nav-notif-icon nav-notif-icon--${esc(presented.tone)}" aria-hidden="true"><i class="fa-solid ${esc(presented.icon)}"></i></span>
                    <div class="nav-notif-copy">
                        <div class="nav-notif-top">
                            <div class="nav-notif-title">${esc(presented.title)}</div>
                            <div class="nav-notif-meta">
                                ${time ? `<span class="nav-notif-time">${esc(time)}</span>` : ''}
                                ${unread ? '<span class="nav-notif-dot" aria-label="Unread"></span>' : ''}
                            </div>
                        </div>
                        ${presented.description ? `<p class="nav-notif-desc">${esc(presented.description)}</p>` : ''}
                        ${action ? `<button type="button" class="nav-notif-action">${esc(action)}</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function emptyState(filter) {
        if (filter === 'unread') {
            return '<div class="nav-notif-empty"><i class="fa-regular fa-circle-check" aria-hidden="true"></i><p>No unread notifications</p></div>';
        }
        return '<div class="nav-notif-empty"><i class="fa-regular fa-bell" aria-hidden="true"></i><p>No notifications yet</p></div>';
    }

    function headerMarkup(markId, markHandler) {
        const mark = markHandler
            ? `<button type="button" class="nav-notif-mark" onclick="${markHandler}">Mark all read</button>`
            : `<button type="button" class="nav-notif-mark"${markId ? ` id="${markId}"` : ''}>Mark all read</button>`;
        return `
            <div class="nav-notif-header">
                <div class="nav-notif-heading">
                    <span>Notifications</span>
                    ${mark}
                </div>
                <div class="nav-notif-filters" role="tablist" aria-label="Notification filters">
                    <button type="button" class="nav-notif-filter is-active" data-notif-filter="all">All</button>
                    <button type="button" class="nav-notif-filter" data-notif-filter="unread">Unread</button>
                </div>
            </div>
        `;
    }

    function syncFilters(root, filter) {
        if (!root) return;
        root.querySelectorAll('[data-notif-filter]').forEach((button) => {
            const active = button.getAttribute('data-notif-filter') === filter;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    const PANEL_CSS = `
.nav-notif-dropdown{width:min(400px,calc(100vw - 20px));background:#fff;border:1px solid #ece7e4;border-radius:16px;box-shadow:0 16px 40px rgba(60,24,16,.16);overflow:hidden}
.nav-notif-dropdown .nav-notif-header{display:block;padding:14px 16px 12px;border-bottom:1px solid #f1eeec;background:#fff}
.nav-notif-dropdown .nav-notif-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#1c1917;font-size:15px;font-weight:700;letter-spacing:-.01em}
.nav-notif-dropdown .nav-notif-mark,.nav-notif-dropdown .nav-notif-header button.nav-notif-mark{border:0;background:transparent;color:#621708;font-size:12px;font-weight:700;cursor:pointer;padding:0}
.nav-notif-dropdown .nav-notif-mark:hover{color:#4a1006}
.nav-notif-dropdown .nav-notif-filters{display:inline-flex;margin-top:12px;background:#f4f1ef;border-radius:999px;padding:3px;gap:2px}
.nav-notif-dropdown .nav-notif-filter{border:0;background:transparent;color:#57534e;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;line-height:1.2}
.nav-notif-dropdown .nav-notif-filter.is-active{background:#621708;color:#fff}
.nav-notif-dropdown .nav-notif-list{max-height:min(460px,70vh);overflow-y:auto;padding:0;background:#fff}
.nav-notif-dropdown .nav-notif-item{display:block;width:100%;text-align:left;padding:14px 16px;border:0;border-radius:0;background:#fff;color:#1c1917;cursor:pointer;font:inherit}
.nav-notif-dropdown .nav-notif-item+.nav-notif-item{border-top:1px solid #f3f0ee}
.nav-notif-dropdown .nav-notif-item.unread{background:#fdf6f4}
.nav-notif-dropdown .nav-notif-item:hover,.nav-notif-dropdown .nav-notif-item:focus-visible{background:#faf6f4;outline:none}
.nav-notif-dropdown .nav-notif-item.unread:hover,.nav-notif-dropdown .nav-notif-item.unread:focus-visible{background:#f8eee9}
.nav-notif-dropdown .nav-notif-row{display:flex;gap:12px;align-items:flex-start}
.nav-notif-dropdown .nav-notif-icon{width:36px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;background:#f6eee9;color:#621708;font-size:14px}
.nav-notif-dropdown .nav-notif-icon--approval{background:#eef8f2;color:#157347}
.nav-notif-dropdown .nav-notif-icon--rejection{background:#fdecec;color:#b42318}
.nav-notif-dropdown .nav-notif-icon--revision{background:#fff4e8;color:#b45309}
.nav-notif-dropdown .nav-notif-icon--submission,.nav-notif-dropdown .nav-notif-icon--task,.nav-notif-dropdown .nav-notif-icon--calendar{background:#f6eee9;color:#621708}
.nav-notif-dropdown .nav-notif-copy{min-width:0;flex:1}
.nav-notif-dropdown .nav-notif-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.nav-notif-dropdown .nav-notif-title{font-size:13.5px;line-height:1.35;font-weight:600;color:#44403c}
.nav-notif-dropdown .nav-notif-item.unread .nav-notif-title{font-weight:700;color:#1c1917}
.nav-notif-dropdown .nav-notif-meta{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:1px}
.nav-notif-dropdown .nav-notif-time{color:#a8a29e;font-size:11px;font-weight:500;white-space:nowrap}
.nav-notif-dropdown .nav-notif-item.unread .nav-notif-time{color:#78716c}
.nav-notif-dropdown .nav-notif-dot{width:8px;height:8px;border-radius:999px;background:#dc2626;display:inline-block}
.nav-notif-dropdown .nav-notif-desc{margin:4px 0 0;color:#78716c;font-size:12.5px;line-height:1.45;font-weight:400}
.nav-notif-dropdown .nav-notif-item:not(.unread) .nav-notif-desc{color:#a8a29e}
.nav-notif-dropdown .nav-notif-action{margin-top:10px;border:1px solid #e7e2df;background:#fff;color:#3f3f46;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;line-height:1.2}
.nav-notif-dropdown .nav-notif-action:hover{border-color:#621708;color:#621708;background:#fff}
.nav-notif-dropdown .nav-notif-empty{padding:36px 20px;text-align:center;color:#a8a29e;font-size:13px;margin:0}
.nav-notif-dropdown .nav-notif-empty i{display:block;font-size:22px;color:#c4b5ad;margin-bottom:8px}
.nav-notif-dropdown .nav-notif-empty p{margin:0}
`;

    function ensureStyles() {
        if (typeof document === 'undefined') return;
        let style = document.getElementById('cite-notif-center-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'cite-notif-center-styles';
            document.head.appendChild(style);
        }
        style.textContent = PANEL_CSS;
    }

    root.CiteFlowNotifPresentation = {
        present,
        renderCard,
        emptyState,
        headerMarkup,
        syncFilters,
        ensureStyles,
        isProfileUpdate,
        hasSpecificDestination,
        formatRelativeTime,
        deansOffice
    };
})(typeof window !== 'undefined' ? window : globalThis);
