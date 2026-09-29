(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.CiteFlowGlobalSearch = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    const MAROON = '#621708';
    const LIMIT = 8;

    const FACULTY_PAGES = [
        { title: 'Dashboard', keywords: 'dashboard home', href: 'dashboard.html', hint: 'Faculty' },
        { title: 'Submissions', keywords: 'submission submissions submit report reports task tasks', href: 'submissions.html', hint: 'Faculty' },
        { title: 'Status Tracking', keywords: 'status tracking pending approved rejected revision', href: 'status-tracking.html', hint: 'Faculty' },
        { title: 'MFO Report', keywords: 'mfo major final output accomplishment report', href: 'mfo-report.html', hint: 'Faculty' },
        { title: 'Document Vault', keywords: 'document documents doc vault file files folder', href: 'document.html', hint: 'Faculty' },
        { title: 'Calendar', keywords: 'calendar event events schedule', href: 'calendar.html', hint: 'Faculty' },
        { title: 'Accomplishments', keywords: 'accomplishment accomplishments award', href: 'faculty-profile.html#accomplishments', hint: 'Faculty' },
        { title: 'My Profile', keywords: 'my profile account', href: 'faculty-profile.html', hint: 'Faculty' },
        { title: 'Help & Support', keywords: 'help support', href: 'help-support.html', hint: 'Faculty' },
        { title: 'System Settings', keywords: 'settings system preference', href: 'system-settings.html', hint: 'Faculty' }
    ];

    const CHAIR_PAGES = FACULTY_PAGES.concat([
        { title: 'Chairperson Review', keywords: 'chairperson chair oic review pending submission workflow delegated', href: 'submissions.html#chair-review', hint: 'Chairperson' }
    ]);

    const ADMIN_PAGES = [
        { title: 'Dashboard', keywords: 'dashboard home', href: 'dashboard.html', hint: "Dean's Office" },
        { title: 'Faculty Profiles', keywords: 'faculty profile profiles people juan user users', href: 'faculty-profiles.html', hint: "Dean's Office" },
        { title: 'Workload Tracker', keywords: 'workload task tasks tracker', href: 'workload-tracker.html', hint: "Dean's Office" },
        { title: 'Engagement Logs', keywords: 'engagement log logs activity', href: 'engagement-logs.html', hint: "Dean's Office" },
        { title: 'Document Vault', keywords: 'document documents doc vault file files folder', href: 'document-vault.html', hint: "Dean's Office" },
        { title: 'Submissions', keywords: 'submission submissions workflow approval pending approved mfo report', href: 'workflow-approval.html', hint: "Dean's Office" },
        { title: 'Calendar', keywords: 'calendar event events schedule', href: 'calendar.html', hint: "Dean's Office" },
        { title: 'Reports & Analytics', keywords: 'report reports analytics', href: 'reports-analytics.html', hint: "Dean's Office" },
        { title: 'Seminar Feedback', keywords: 'feedback seminar', href: 'feedback-summary.html', hint: "Dean's Office" },
        { title: 'User Management', keywords: 'user users management account role', href: 'user-management.html', hint: "Dean's Office" },
        { title: 'My Profile', keywords: 'my profile admin profile', href: 'admin-profile.html', hint: "Dean's Office" },
        { title: 'System Settings', keywords: 'settings system', href: 'system-settings.html', hint: "Dean's Office" },
        { title: 'Help & Support', keywords: 'help support', href: 'help-support.html', hint: "Dean's Office" }
    ];

    function sanitizeQuery(value) {
        return String(value || '').replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function likePattern(query) {
        return '%' + sanitizeQuery(query).replace(/\s+/g, '%') + '%';
    }

    function words(query) {
        return sanitizeQuery(query).toLowerCase().split(' ').filter(Boolean);
    }

    function textHit(haystack, query) {
        const terms = words(query);
        if (!terms.length) return false;
        const hay = String(haystack || '').toLowerCase();
        return terms.every((term) => hay.includes(term));
    }

    function catalogFor(role) {
        if (role === 'admin') return ADMIN_PAGES;
        if (role === 'chair') return CHAIR_PAGES;
        return FACULTY_PAGES;
    }

    function matchPages(query, role) {
        return catalogFor(role).filter((page) => textHit(page.title + ' ' + page.keywords, query)).map((page) => ({
            id: 'page:' + page.href,
            category: 'pages',
            icon: 'fa-compass',
            title: page.title,
            detail: 'Page · ' + page.hint,
            href: page.href
        }));
    }

    function statusValuesFor(query) {
        const hay = words(query).join(' ');
        if (!hay) return null;
        if (/\bpending\b|\bunder review\b|\bawaiting\b/.test(hay)) return ['submitted', 'late', 'underreview'];
        if (/\brevision\b|\brevise\b/.test(hay)) return ['revision'];
        if (/\brejected\b|\bdeclined\b/.test(hay)) return ['rejected'];
        if (/\bapproved\b|\bapproval\b/.test(hay)) return ['approved'];
        if (/\bsubmitted\b|\bsubmission\b/.test(hay)) return ['submitted', 'late', 'underreview', 'approved', 'revision', 'rejected'];
        if (/\blate\b/.test(hay)) return ['late'];
        return null;
    }

    function statusLabel(status) {
        const value = String(status || '').toLowerCase();
        if (value === 'underreview') return 'Under review';
        if (value === 'notsubmitted') return 'Not submitted';
        if (!value) return '';
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function destinationFor(item, access) {
        const portal = access?.portal === 'admin' ? 'admin' : 'faculty';
        const adminPrefix = portal === 'faculty' ? '../admin/' : '';
        if (item.category === 'pages') return { href: portal === 'admin' ? item.href : item.href };
        if (item.category === 'calendar') {
            const file = portal === 'admin' ? adminPrefix + 'calendar.html' : 'calendar.html';
            return { href: file + '#open=' + encodeURIComponent(item.recordId), eventId: item.recordId };
        }
        if (item.category === 'documents') {
            if (portal === 'admin') return { href: adminPrefix + 'document-vault.html' };
            const name = item.title || '';
            return { href: 'document.html#task=' + encodeURIComponent(name), taskKey: name };
        }
        if (item.category === 'faculty') {
            if (portal === 'admin') return { href: adminPrefix + 'faculty-profiles.html' };
            if (item.ownProfile) return { href: 'faculty-profile.html' };
            return { href: item.href || 'submissions.html' };
        }
        if (item.category === 'submissions' && item.chairReview && item.recordId) {
            return { href: 'submissions.html#chair-review', chairSubmission: item.recordId, taskKey: item.taskId || '' };
        }
        if (item.category === 'submissions' || item.category === 'tasks') {
            const taskId = item.taskId || item.recordId || '';
            if (portal === 'admin') {
                return { href: adminPrefix + 'workflow-approval.html' + (taskId ? '#task=' + encodeURIComponent(taskId) : '') };
            }
            return { href: taskId ? 'submissions.html#task=' + encodeURIComponent(taskId) : 'submissions.html', taskKey: taskId };
        }
        return { href: portal === 'admin' ? 'dashboard.html' : 'dashboard.html' };
    }

    function groupResults(items, active) {
        const order = ['submissions', 'tasks', 'documents', 'calendar', 'faculty', 'pages'];
        const labels = {
            submissions: 'Submissions',
            tasks: 'Tasks',
            documents: 'Documents',
            calendar: 'Calendar',
            faculty: 'Faculty',
            pages: 'Pages'
        };
        const buckets = {};
        (items || []).forEach((item) => {
            if (!buckets[item.category]) buckets[item.category] = [];
            buckets[item.category].push(item);
        });
        const tabs = [{ id: 'all', label: 'All results', count: items.length }];
        order.forEach((id) => {
            const count = (buckets[id] || []).length;
            if (count) tabs.push({ id, label: labels[id], count });
        });
        const selected = tabs.some((tab) => tab.id === active) ? active : 'all';
        const visible = selected === 'all' ? items : (buckets[selected] || []);
        return { tabs, selected, visible };
    }

    function client() {
        return root.supabaseClient || root.CiteFlowWorkflow?.getSupabaseClient?.() || null;
    }

    function portalFromLocation() {
        return /\/admin\//i.test(String(root.location?.pathname || '')) ? 'admin' : 'faculty';
    }

    let accessCache = null;

    function readStoredSession(sb) {
        const read = sb?._citeFlowOriginalGetSession || sb?.auth?.getSession?.bind(sb.auth);
        return read ? read() : Promise.resolve({ data: { session: null } });
    }

    async function resolveAccess() {
        if (accessCache?.userId) return accessCache;
        const sb = client();
        const guard = root.CiteFlowAuthGuard;
        if (guard?.ready) {
            try {
                await Promise.race([
                    guard.ready,
                    new Promise((resolve) => setTimeout(resolve, 1200))
                ]);
            } catch (_) {}
        }
        let user = guard?.user || guard?.session?.user || null;
        if (!user && sb) {
            try {
                const { data } = await readStoredSession(sb);
                user = data?.session?.user || null;
            } catch (_) {
                user = null;
            }
        }
        if (!user) return null;
        const wf = root.CiteFlowWorkflow;
        let faculty = guard?.faculty || null;
        if (!faculty && sb) {
            try {
                const { data } = await sb.from('faculty').select('id,auth_user_id,full_name,name,email,department,role,position').eq('auth_user_id', user.id).maybeSingle();
                faculty = data || null;
            } catch (_) {
                faculty = null;
            }
        }
        const portal = portalFromLocation();
        let adminProfile = false;
        if (portal === 'admin' && sb) {
            try {
                const { data } = await sb.from('admin_profiles').select('id,role').eq('id', user.id).maybeSingle();
                adminProfile = !!data;
            } catch (_) {
                adminProfile = false;
            }
        }
        const isAdmin = portal === 'admin' && (adminProfile || !faculty || wf?.isWorkflowAdmin?.(faculty) || /admin|dean|secretary/i.test(String(faculty?.role || faculty?.position || user.user_metadata?.role || '')));
        let departments = [];
        let chair = false;
        if (!isAdmin && faculty && sb) {
            let grants = [];
            try {
                if (wf?.loadActiveDelegatedAccess) grants = await wf.loadActiveDelegatedAccess(sb);
                else {
                    const { data } = await sb.from('wf_delegated_access').select('*').eq('is_active', true);
                    grants = data || [];
                }
            } catch (_) {
                grants = [];
            }
            const roleText = String(faculty.role || faculty.position || '');
            chair = wf?.hasChairpersonWorkflowAccess
                ? wf.hasChairpersonWorkflowAccess(faculty, grants) && !wf.isWorkflowAdmin(faculty)
                : (/chair/i.test(roleText) || grants.length > 0);
            if (chair && wf?.chairpersonAuthorizedDepartments) {
                departments = wf.chairpersonAuthorizedDepartments(faculty, grants);
            } else if (chair) {
                departments = grants.flatMap((grant) => Array.isArray(grant.department_codes) ? grant.department_codes : []);
            }
        }
        accessCache = {
            portal: isAdmin ? 'admin' : 'faculty',
            role: isAdmin ? 'admin' : (chair ? 'chair' : 'faculty'),
            userId: user.id,
            facultyId: faculty?.id || null,
            faculty,
            departments: departments.map((code) => String(code || '').trim()).filter(Boolean)
        };
        return accessCache;
    }

    function orText(columns, query) {
        const terms = words(query);
        if (!terms.length) return '';
        return columns.map((column) => (
            'and(' + terms.map((term) => column + '.ilike.%' + term + '%').join(',') + ')'
        )).join(',');
    }

    async function searchTasks(sb, access, query) {
        const filter = orText(['title', 'instructions', 'assigned_label'], query);
        if (!filter) return [];
        if (access.role === 'faculty' || access.role === 'chair') {
            if (!access.facultyId) return [];
            const assigned = await sb.from('wf_task_assignments').select('task_id').eq('faculty_id', access.facultyId).limit(80);
            const ids = (assigned.data || []).map((row) => row.task_id).filter(Boolean);
            if (!ids.length) return [];
            const { data } = await sb.from('wf_tasks').select('id,title,instructions,assigned_label,due_at').in('id', ids).or(filter).limit(LIMIT);
            return data || [];
        }
        const { data } = await sb.from('wf_tasks').select('id,title,instructions,assigned_label,due_at').or(filter).limit(LIMIT);
        return data || [];
    }

    async function searchOwnSubmissions(sb, access, query, taskIds) {
        if (!access.facultyId) return [];
        const statuses = statusValuesFor(query);
        let request = sb.from('wf_submissions').select('id,task_id,faculty_id,status,review_remarks,submitted_at').eq('faculty_id', access.facultyId).limit(LIMIT);
        if (statuses) request = request.in('status', statuses);
        else if (taskIds.length) request = request.in('task_id', taskIds);
        else {
            const filter = orText(['review_remarks'], query);
            if (!filter) return [];
            request = request.or(filter);
        }
        const { data } = await request;
        return data || [];
    }

    async function searchAdminSubmissions(sb, query, taskIds) {
        const statuses = statusValuesFor(query);
        const rows = [];
        if (statuses) {
            const { data } = await sb.from('wf_submissions').select('id,task_id,faculty_id,status,review_remarks,submitted_at').in('status', statuses).limit(LIMIT);
            rows.push(...(data || []));
        }
        if (taskIds.length) {
            const { data } = await sb.from('wf_submissions').select('id,task_id,faculty_id,status,review_remarks,submitted_at').in('task_id', taskIds).limit(LIMIT);
            rows.push(...(data || []));
        }
        if (!statuses && !taskIds.length) {
            const filter = orText(['review_remarks'], query);
            if (filter) {
                const { data } = await sb.from('wf_submissions').select('id,task_id,faculty_id,status,review_remarks,submitted_at').or(filter).limit(LIMIT);
                rows.push(...(data || []));
            }
        }
        const seen = new Set();
        return rows.filter((row) => {
            if (!row?.id || seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
        });
    }

    async function searchChairQueue(sb, query) {
        const rpc = await sb.rpc('wf_list_chairperson_submissions');
        const queue = rpc.data || [];
        if (!queue.length || rpc.error) return [];
        const taskIds = [...new Set(queue.map((row) => row.task_id).filter(Boolean))];
        const facultyIds = [...new Set(queue.map((row) => row.faculty_id).filter(Boolean))];
        const filter = orText(['title', 'instructions'], query);
        const nameFilter = orText(['full_name', 'name', 'email', 'department'], query);
        let matchedTaskIds = new Set();
        let matchedFacultyIds = new Set();
        if (filter && taskIds.length) {
            const { data } = await sb.from('wf_tasks').select('id').in('id', taskIds).or(filter).limit(LIMIT);
            matchedTaskIds = new Set((data || []).map((row) => row.id));
        }
        if (nameFilter && facultyIds.length) {
            const { data } = await sb.from('faculty').select('id').in('id', facultyIds).or(nameFilter).limit(LIMIT);
            matchedFacultyIds = new Set((data || []).map((row) => String(row.id)));
        }
        const statuses = statusValuesFor(query);
        return queue.filter((row) => {
            if (matchedTaskIds.has(row.task_id)) return true;
            if (matchedFacultyIds.has(String(row.faculty_id))) return true;
            if (statuses && statuses.includes(String(row.status || '').toLowerCase())) return true;
            return textHit(row.review_remarks, query);
        }).slice(0, LIMIT);
    }

    function calendarFilter(query, access) {
        const text = orText(['title', 'location', 'notes'], query);
        if (!text) return '';
        if (access.role === 'admin') return text;
        const scopes = ['all_faculty', 'all', 'faculty', 'everyone'];
        const dept = String(access.faculty?.department || access.faculty?.department_code || '').toLowerCase();
        ['bsit', 'bsie', 'bit'].forEach((code) => {
            if (dept.includes(code) || access.departments.some((item) => String(item).toLowerCase().includes(code))) scopes.push(code);
        });
        if (access.role === 'chair') scopes.push('department_chairs', 'chair');
        const visibility = ['visibility_scope.is.null', 'visibility.is.null']
            .concat(scopes.map((scope) => 'visibility_scope.ilike.%' + scope + '%'))
            .concat(scopes.map((scope) => 'visibility.ilike.%' + scope + '%'));
        return 'and(or(' + text + '),or(' + visibility.join(',') + '))';
    }

    async function searchDocuments(sb, query) {
        const filter = orText(['name'], query);
        if (!filter) return { documents: [], folders: [] };
        const [documents, folders] = await Promise.all([
            sb.from('documents').select('id,name,folder_id').or(filter).limit(LIMIT),
            sb.from('folders').select('id,name').or(filter).limit(4)
        ]);
        return { documents: documents.data || [], folders: folders.data || [] };
    }

    async function searchPeople(sb, access, query) {
        const filter = orText(['full_name', 'name', 'email', 'department'], query);
        if (!filter || !textHit(query, query)) return [];
        if (access.role === 'faculty') {
            if (!access.facultyId) return [];
            const { data } = await sb.from('faculty').select('id,full_name,name,email,department,role').eq('id', access.facultyId).or(filter).limit(1);
            return data || [];
        }
        if (access.role === 'chair') return [];
        const { data } = await sb.from('faculty').select('id,full_name,name,email,department,role').or(filter).limit(LIMIT);
        return data || [];
    }

    async function taskMap(sb, ids) {
        const unique = [...new Set((ids || []).filter(Boolean))];
        if (!unique.length) return new Map();
        const { data } = await sb.from('wf_tasks').select('id,title').in('id', unique);
        return new Map((data || []).map((row) => [String(row.id), row]));
    }

    async function facultyMap(sb, ids) {
        const unique = [...new Set((ids || []).filter(Boolean))];
        if (!unique.length) return new Map();
        const { data } = await sb.from('faculty').select('id,full_name,name,department').in('id', unique);
        return new Map((data || []).map((row) => [String(row.id), row]));
    }

    function personName(row) {
        return row?.full_name || row?.name || 'Faculty';
    }

    async function searchAdminRelated(sb, people) {
        const ids = (people || []).map((person) => person.id).filter(Boolean);
        if (!ids.length) return { submissions: [], tasks: [], documents: [], assignments: [] };
        const nameFilters = (people || []).map((person) => sanitizeQuery(personName(person)).toLowerCase()).filter((name) => name && name !== 'faculty');
        const docFilter = nameFilters.map((name) => 'uploaded_by.ilike.%' + name.replace(/\s+/g, '%') + '%').join(',');
        const [subs, assignments, documents] = await Promise.all([
            sb.from('wf_submissions').select('id,task_id,faculty_id,status,review_remarks,submitted_at').in('faculty_id', ids).limit(LIMIT),
            sb.from('wf_task_assignments').select('task_id,faculty_id').in('faculty_id', ids).limit(LIMIT),
            docFilter
                ? sb.from('documents').select('id,name,folder_id,uploaded_by').or(docFilter).limit(LIMIT)
                : Promise.resolve({ data: [] })
        ]);
        const taskIds = [...new Set((assignments.data || []).map((row) => row.task_id).filter(Boolean))];
        let tasks = [];
        if (taskIds.length) {
            const { data } = await sb.from('wf_tasks').select('id,title,assigned_label').in('id', taskIds).limit(LIMIT);
            tasks = data || [];
        }
        return {
            submissions: subs.data || [],
            tasks,
            documents: documents.data || [],
            assignments: assignments.data || []
        };
    }

    async function collect(query, access) {
        const sb = client();
        const results = matchPages(query, access.role);
        if (!sb) return results;
        const calendarOr = calendarFilter(query, access);
        const [tasks, chairRows, docs, events, people] = await Promise.all([
            searchTasks(sb, access, query).catch(() => []),
            access.role === 'chair' ? searchChairQueue(sb, query).catch(() => []) : Promise.resolve([]),
            searchDocuments(sb, query).catch(() => ({ documents: [], folders: [] })),
            calendarOr
                ? sb.from('calendar_events').select('id,title,location,start_at,event_type,visibility_scope,visibility').or(calendarOr).limit(LIMIT).then((res) => res.data || []).catch(() => [])
                : Promise.resolve([]),
            searchPeople(sb, access, query).catch(() => [])
        ]);
        const taskIds = tasks.map((row) => row.id);
        const submissions = access.role === 'admin'
            ? await searchAdminSubmissions(sb, query, taskIds)
            : await searchOwnSubmissions(sb, access, query, taskIds);
        const related = access.role === 'admin' && people.length
            ? await searchAdminRelated(sb, people).catch(() => ({ submissions: [], tasks: [], documents: [], assignments: [] }))
            : { submissions: [], tasks: [], documents: [], assignments: [] };
        const ownIds = new Set(submissions.map((row) => String(row.id)));
        const scopedChair = (chairRows || []).filter((row) => !ownIds.has(String(row.id)) && String(row.faculty_id) !== String(access.facultyId));
        const relatedSubs = (related.submissions || []).filter((row) => !ownIds.has(String(row.id)));
        const allSubs = submissions.concat(scopedChair, relatedSubs);
        const tasksById = await taskMap(sb, allSubs.map((row) => row.task_id).concat(taskIds, (related.tasks || []).map((row) => row.id)));
        const peopleById = await facultyMap(sb, allSubs.map((row) => row.faculty_id).concat(people.map((row) => row.id)));
        people.forEach((person) => peopleById.set(String(person.id), person));
        const seenTasks = new Set();
        tasks.concat(related.tasks || []).forEach((task) => {
            if (!task?.id || seenTasks.has(String(task.id))) return;
            seenTasks.add(String(task.id));
            const assignment = (related.assignments || []).find((row) => String(row.task_id) === String(task.id));
            const person = assignment ? peopleById.get(String(assignment.faculty_id)) : null;
            results.push({
                id: 'task:' + task.id,
                category: 'tasks',
                icon: 'fa-clipboard-list',
                title: task.title || 'Task',
                detail: person
                    ? 'Task · ' + personName(person)
                    : ('Task' + (task.assigned_label ? ' · ' + task.assigned_label : '')),
                taskId: task.id,
                recordId: task.id
            });
        });
        const seenSubs = new Set();
        allSubs.forEach((row) => {
            if (!row?.id || seenSubs.has(String(row.id))) return;
            seenSubs.add(String(row.id));
            const task = tasksById.get(String(row.task_id));
            const person = peopleById.get(String(row.faculty_id));
            const title = task?.title || 'Submission';
            const chairReview = access.role === 'chair' && String(row.faculty_id) !== String(access.facultyId);
            const who = chairReview || access.role === 'admin' ? personName(person) : '';
            results.push({
                id: 'submission:' + row.id,
                category: 'submissions',
                icon: 'fa-file-lines',
                title: who && who !== 'Faculty' ? title + ' — ' + who : title,
                detail: 'Submission' + (statusLabel(row.status) ? ' · ' + statusLabel(row.status) : '') + (who && access.role === 'admin' ? '' : ''),
                recordId: row.id,
                taskId: row.task_id,
                chairReview
            });
        });
        const seenDocs = new Set();
        (docs.folders || []).forEach((folder) => {
            results.push({
                id: 'folder:' + folder.id,
                category: 'documents',
                icon: 'fa-folder',
                title: folder.name || 'Folder',
                detail: 'Document · Folder',
                recordId: folder.id
            });
        });
        (docs.documents || []).concat(related.documents || []).forEach((doc) => {
            if (!doc?.id || seenDocs.has(String(doc.id))) return;
            seenDocs.add(String(doc.id));
            results.push({
                id: 'document:' + doc.id,
                category: 'documents',
                icon: 'fa-file',
                title: doc.name || 'Document',
                detail: 'Document' + (doc.uploaded_by ? ' · ' + doc.uploaded_by : ' · Document Vault'),
                recordId: doc.id
            });
        });
        (events || []).forEach((event) => {
            const when = event.start_at ? new Date(event.start_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            results.push({
                id: 'event:' + event.id,
                category: 'calendar',
                icon: 'fa-calendar-days',
                title: event.title || 'Calendar event',
                detail: 'Calendar' + (when ? ' · ' + when : '') + (event.location ? ' · ' + event.location : ''),
                recordId: event.id
            });
        });
        people.forEach((person) => {
            const own = String(person.id) === String(access.facultyId);
            results.push({
                id: 'faculty:' + person.id,
                category: 'faculty',
                icon: 'fa-user',
                title: personName(person),
                detail: 'Faculty' + (person.department ? ' · ' + person.department : '') + (person.role ? ' · ' + person.role : ''),
                recordId: person.id,
                ownProfile: own && access.role !== 'admin'
            });
        });
        return results;
    }

    let stylesReady = false;
    let activeTab = 'all';
    let current = [];
    let selectedIndex = 0;
    let timer = 0;
    let requestSerial = 0;
    let panel = null;
    let boundInput = null;

    function ensureStyles() {
        if (stylesReady || !root.document) return;
        stylesReady = true;
        const style = root.document.createElement('style');
        style.setAttribute('data-citeflow', 'global-search');
        style.textContent = `
            .cite-search-panel{position:fixed;z-index:1200;width:min(440px,calc(100vw - 20px));background:#fff;border:1px solid #e7e5e4;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.12);overflow:hidden;color:#1c1917;font-family:Inter,system-ui,sans-serif}
            .cite-search-tabs{display:flex;gap:4px;padding:8px 10px 0;overflow-x:auto;border-bottom:1px solid #f1f5f9}
            .cite-search-tab{border:0;background:transparent;color:#57534e;font-size:12px;font-weight:600;padding:8px 8px 10px;white-space:nowrap;border-bottom:2px solid transparent;cursor:pointer}
            .cite-search-tab.is-active{color:${MAROON};border-bottom-color:${MAROON}}
            .cite-search-count{display:inline-flex;min-width:16px;height:16px;margin-left:4px;padding:0 4px;border-radius:999px;background:#f5f5f4;color:#44403c;font-size:10px;align-items:center;justify-content:center}
            .cite-search-tab.is-active .cite-search-count{background:#f3e8e4;color:${MAROON}}
            .cite-search-list{max-height:min(420px,60vh);overflow:auto;padding:6px}
            .cite-search-item{width:100%;display:flex;gap:10px;align-items:flex-start;text-align:left;border:0;background:transparent;border-radius:12px;padding:8px;cursor:pointer}
            .cite-search-item:hover,.cite-search-item.is-active{background:#faf7f6}
            .cite-search-icon{width:32px;height:32px;border-radius:10px;background:#f6f3f2;color:${MAROON};display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:13px}
            .cite-search-title{display:block;font-size:13px;font-weight:600;color:#1c1917;line-height:1.3}
            .cite-search-detail{display:block;margin-top:2px;font-size:12px;color:#78716c;line-height:1.35}
            .cite-search-empty,.cite-search-guide{padding:22px 16px;text-align:center;color:#78716c;font-size:13px}
            .cite-search-empty i,.cite-search-guide i{display:block;margin:0 auto 8px;color:${MAROON};font-size:16px}
            .cite-search-kbd{margin-left:auto;border:1px solid #e7e5e4;background:#fafaf9;color:#78716c;border-radius:6px;padding:1px 5px;font-size:10px;font-family:inherit;line-height:16px;flex:0 0 auto}
            .search-box .cite-search-clear{border:0;background:transparent;color:#78716c;cursor:pointer;padding:0 2px}
            @media (max-width:640px){.cite-search-kbd{display:none}}
        `;
        root.document.head.appendChild(style);
    }

    function esc(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function positionPanel() {
        if (!panel || !boundInput) return;
        const rect = boundInput.getBoundingClientRect();
        const width = Math.min(440, root.innerWidth - 20);
        let left = rect.left;
        if (left + width > root.innerWidth - 10) left = Math.max(10, root.innerWidth - width - 10);
        panel.style.width = width + 'px';
        panel.style.left = left + 'px';
        panel.style.top = (rect.bottom + 8) + 'px';
    }

    function closePanel() {
        if (panel) panel.hidden = true;
        selectedIndex = 0;
    }

    function openPanel() {
        ensurePanel();
        panel.hidden = false;
        positionPanel();
    }

    function renderPanel(state) {
        ensurePanel();
        const query = sanitizeQuery(boundInput?.value || '');
        if (!query) {
            panel.innerHTML = '<div class="cite-search-guide"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Search for submissions, tasks, documents, pages, or other accessible records.</div>';
            openPanel();
            return;
        }
        if (state.loading) {
            panel.innerHTML = '<div class="cite-search-guide"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Searching…</div>';
            openPanel();
            return;
        }
        const grouped = groupResults(current, activeTab);
        activeTab = grouped.selected;
        if (!current.length) {
            panel.innerHTML = '<div class="cite-search-empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>No results found for \'' + esc(query) + '\'.</div>';
            openPanel();
            return;
        }
        const tabs = grouped.tabs.map((tab) => (
            '<button type="button" class="cite-search-tab' + (tab.id === grouped.selected ? ' is-active' : '') + '" data-search-tab="' + esc(tab.id) + '">' +
            esc(tab.label) + '<span class="cite-search-count">' + tab.count + '</span></button>'
        )).join('');
        const rows = grouped.visible.map((item, index) => (
            '<button type="button" class="cite-search-item' + (index === selectedIndex ? ' is-active' : '') + '" data-search-index="' + index + '">' +
            '<span class="cite-search-icon" aria-hidden="true"><i class="fa-solid ' + esc(item.icon) + '"></i></span>' +
            '<span><span class="cite-search-title">' + esc(item.title) + '</span>' +
            '<span class="cite-search-detail">' + esc(item.detail) + '</span></span></button>'
        )).join('');
        panel.innerHTML = '<div class="cite-search-tabs" role="tablist">' + tabs + '</div><div class="cite-search-list">' + rows + '</div>';
        panel._visible = grouped.visible;
        openPanel();
    }

    async function runSearch() {
        const query = sanitizeQuery(boundInput?.value || '');
        const serial = ++requestSerial;
        if (!query) {
            current = [];
            renderPanel({ loading: false });
            return;
        }
        renderPanel({ loading: true });
        const access = await resolveAccess();
        if (serial !== requestSerial) return;
        if (!access) {
            current = [];
            panel.innerHTML = '<div class="cite-search-empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Search could not be completed. Your session was not changed.</div>';
            openPanel();
            return;
        }
        try {
            current = await collect(query, access);
        } catch (error) {
            console.warn('CITE-Flow search failed', error);
            current = matchPages(query, access.role);
        }
        if (serial !== requestSerial) return;
        selectedIndex = 0;
        activeTab = 'all';
        panel._access = access;
        renderPanel({ loading: false });
    }

    function scheduleSearch() {
        root.clearTimeout(timer);
        timer = root.setTimeout(runSearch, 180);
    }

    function visibleItems() {
        return panel?._visible || groupResults(current, activeTab).visible;
    }

    function choose(item) {
        if (!item) return;
        const access = panel?._access || { portal: portalFromLocation(), role: portalFromLocation() === 'admin' ? 'admin' : 'faculty' };
        const dest = destinationFor(item, access);
        try {
            if (dest.chairSubmission) root.sessionStorage.setItem('citeOpenChairSubmission', String(dest.chairSubmission));
            if (dest.taskKey) root.sessionStorage.setItem('citeOpenTask', String(dest.taskKey));
            if (dest.eventId) root.sessionStorage.setItem('citeOpenNotif', String(dest.eventId));
        } catch (_) {}
        closePanel();
        if (access.portal !== 'admin' && typeof root.navigateToFacultyPage === 'function' && !String(dest.href).startsWith('../')) {
            root.navigateToFacultyPage(dest.href);
            return;
        }
        root.location.href = dest.href;
    }

    function ensurePanel() {
        ensureStyles();
        if (panel) return panel;
        panel = root.document.createElement('div');
        panel.className = 'cite-search-panel';
        panel.hidden = true;
        panel.addEventListener('mousedown', (event) => event.preventDefault());
        panel.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-search-tab]');
            if (tab) {
                activeTab = tab.getAttribute('data-search-tab') || 'all';
                selectedIndex = 0;
                renderPanel({ loading: false });
                return;
            }
            const row = event.target.closest('[data-search-index]');
            if (!row) return;
            choose(visibleItems()[Number(row.getAttribute('data-search-index'))]);
        });
        root.document.body.appendChild(panel);
        root.addEventListener('resize', positionPanel);
        root.addEventListener('scroll', () => { if (panel && !panel.hidden) positionPanel(); }, true);
        return panel;
    }

    function enhanceInput(input) {
        if (!input || input.dataset.citeSearch === '1') return;
        input.dataset.citeSearch = '1';
        input.setAttribute('placeholder', 'Search by keyword');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-label', 'Search by keyword');
        const box = input.closest('.search-box');
        if (box && !box.querySelector('.cite-search-kbd')) {
            const kbd = root.document.createElement('kbd');
            kbd.className = 'cite-search-kbd';
            kbd.textContent = 'Ctrl K';
            box.appendChild(kbd);
        }
        input.addEventListener('focus', () => {
            boundInput = input;
            if (sanitizeQuery(input.value)) scheduleSearch();
            else renderPanel({ loading: false });
        });
        input.addEventListener('input', () => {
            boundInput = input;
            scheduleSearch();
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closePanel();
                return;
            }
            const items = visibleItems();
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
                renderPanel({ loading: false });
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                selectedIndex = Math.max(0, selectedIndex - 1);
                renderPanel({ loading: false });
            } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(items[selectedIndex] || items[0]);
            }
        });
    }

    function mount() {
        if (!root.document) return;
        ensureStyles();
        root.document.querySelectorAll('#searchInput, #facultySearchInput').forEach(enhanceInput);
        if (!root.document.documentElement.dataset.citeSearchDoc) {
            root.document.documentElement.dataset.citeSearchDoc = '1';
            root.document.addEventListener('mousedown', (event) => {
                if (!panel || panel.hidden) return;
                if (event.target.closest('.cite-search-panel, .search-box')) return;
                closePanel();
            });
            root.document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
                    const input = root.document.querySelector('#searchInput, #facultySearchInput');
                    if (!input) return;
                    event.preventDefault();
                    input.focus();
                    boundInput = input;
                    renderPanel({ loading: false });
                }
            });
        }
    }

    if (root.document) {
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
        else mount();
    }

    return {
        sanitizeQuery,
        likePattern,
        textHit,
        catalogFor,
        matchPages,
        statusValuesFor,
        destinationFor,
        groupResults,
        calendarFilter,
        mount
    };
});
