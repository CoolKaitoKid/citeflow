// CITE-Flow Faculty Navigation Manager

function ensureCiteFlowSettings() {
    if (window.CiteFlowSettings) return Promise.resolve(window.CiteFlowSettings);
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '../shared/cite-settings.js';
        script.onload = () => resolve(window.CiteFlowSettings || null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
    });
}

function getFacultyCurrentPageFile() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const current = parts[parts.length - 1] || "dashboard";
    return current.endsWith(".html") ? current : `${current}.html`;
}

function normalizeFacultyPageKey(pageFile) {
    if (!pageFile) return "";
    const key = pageFile
        .replace(/^\.\.\//, "")
        .replace(/^faculty\//, "")
        .replace(/^chairperson\//, "")
        .replace(/\.html$/, "");
    if (key === "workflow-approval") return "submissions";
    return key;
}

function facultyPageMap(pageName) {
    const key = normalizeFacultyPageKey(pageName);
    return {
        dashboard: "dashboard.html",
        "faculty-profile": "faculty-profile.html",
        profile: "faculty-profile.html",
        submissions: "submissions.html",
        "status-tracking": "status-tracking.html",
        document: "document.html",
        "document-vault": "document.html",
        calendar: "calendar.html",
        "system-settings": "system-settings.html",
        settings: "system-settings.html",
        "workflow-approval": "submissions.html#chair-review",
        "chairperson-workflow-approval": "submissions.html#chair-review"
    }[key] || `${key}.html`;
}

// ==========================================
// MOBILE DRAWER TOGGLE & BACKDROP LOGIC
// ==========================================
function toggleFacultyMobileSidebar(forceClose = false) {
    const sidebar = document.querySelector("aside.sidebar, .sidebar");
    let backdrop = document.getElementById("facultySidebarBackdrop");

    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "facultySidebarBackdrop";
        backdrop.className = "sidebar-backdrop";
        backdrop.onclick = () => toggleFacultyMobileSidebar(true);
        document.body.appendChild(backdrop);
    }

    if (!sidebar) return;

    const isOpen = sidebar.classList.contains("open");

    if (forceClose || isOpen) {
        sidebar.classList.remove("open");
        backdrop.classList.remove("show");
        document.body.style.overflow = "";
    } else {
        sidebar.classList.add("open");
        backdrop.classList.add("show");
        document.body.style.overflow = "hidden";
    }
}

window.toggleFacultyMobileSidebar = toggleFacultyMobileSidebar;

function navigateToFacultyPage(pageFile) {
    if (typeof toggleFacultyMobileSidebar === "function") {
        toggleFacultyMobileSidebar(true);
    }
    const raw = String(pageFile || '');
    if (raw.includes('workflow-approval') || raw.includes('chairperson/')) {
        window.location.href = 'submissions.html#chair-review';
        return;
    }
    const hashIndex = raw.indexOf('#');
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
    const filePart = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const mapped = facultyPageMap(filePart);
    const mappedFile = String(mapped).split('#')[0];
    const mappedHash = hash || (String(mapped).includes('#') ? '#' + String(mapped).split('#')[1] : '');
    const dest = mappedFile + mappedHash;
    const currentFile = getFacultyCurrentPageFile();
    const samePage = normalizeFacultyPageKey(currentFile) === normalizeFacultyPageKey(mappedFile);
    if (samePage) {
        if (mappedHash && location.hash !== mappedHash) {
            location.hash = mappedHash;
        }
        if (typeof window.resetPendingFacultyNotification === 'function') {
            window.setTimeout(() => window.resetPendingFacultyNotification(), 0);
        } else if (typeof window.openPendingFacultyNotification === 'function') {
            window.setTimeout(() => window.openPendingFacultyNotification(), 0);
        }
        return;
    }
    const inChairperson = window.location.pathname.toLowerCase().includes('/chairperson/');
    if (inChairperson && !dest.startsWith('../') && !dest.startsWith('/')) {
        window.location.href = `../faculty/${dest}`;
        return;
    }
    window.location.href = dest;
}

function toggleFacultyProfileModal() {
    const modal = document.getElementById("facultyProfileModal");
    const backdrop = document.getElementById("facultyProfileBackdrop");
    if (!modal || !backdrop) return;
    modal.classList.toggle("show");
    backdrop.classList.toggle("show");
}

function mountFacultyNavPart(sourceNode, containerId, appendToBody) {
    if (!sourceNode) return;
    const container = containerId ? document.getElementById(containerId) : null;
    if (container) {
        container.innerHTML = "";
        container.appendChild(sourceNode);
        return;
    }
    if (appendToBody && !document.getElementById(sourceNode.id)) {
        document.body.appendChild(sourceNode);
    }
}

function updateFacultyActiveMenu(fileName) {
    const current = normalizeFacultyPageKey(fileName || getFacultyCurrentPageFile());
    document.querySelectorAll(".sidebar .nav-item, .logo-area[data-page]").forEach((item) => {
        const dataPage = item.getAttribute("data-page");
        if (!dataPage) return;
        const target = normalizeFacultyPageKey(dataPage);
        const isActive = target === current;
        item.classList.toggle("active", isActive);
    });
}

function attachFacultyNavEvents() {
    document.addEventListener("click", (e) => {
        const mobileToggleBtn = e.target.closest("#mobileSidebarToggle, .drawer-push-btn, .mobile-toggle-btn");
        if (mobileToggleBtn) {
            e.preventDefault();
            toggleFacultyMobileSidebar();
            return;
        }

        const item = e.target.closest(".sidebar .nav-item, .sidebar .logo-area[data-page], #facultyProfileModal .nav-item[data-page], .profile-link[data-page]");
        if (!item) return;
        const pageFile = item.getAttribute("data-page");
        if (!pageFile) return;
        e.preventDefault();
        navigateToFacultyPage(pageFile);
    });

    const modal = document.getElementById("facultyProfileModal");
    const backdrop = document.getElementById("facultyProfileBackdrop");
    if (modal && backdrop) {
        document.addEventListener("click", (e) => {
            const profileBtn = e.target.closest("[onclick='toggleFacultyProfileModal()']");
            if (modal.classList.contains("show") && !modal.contains(e.target) && !profileBtn) {
                modal.classList.remove("show");
                backdrop.classList.remove("show");
            }
        });
    }
}

function updateFacultyNavProfile(profileData) {
    if (!profileData) {
        try {
            const cached = JSON.parse(localStorage.getItem('citeflow_user') || '{}');
            if (cached && (cached.name || cached.full_name)) {
                profileData = {
                    name: cached.name || cached.full_name,
                    full_name: cached.name || cached.full_name,
                    role: cached.role || 'Faculty Member',
                    position: cached.role || 'Faculty Member',
                    department: cached.department || 'CITE Faculty',
                    profile_photo_url: cached.profile_photo_url || cached.profilePhotoUrl || cached.avatar_url,
                    first_name: cached.first_name,
                    middle_name: cached.middle_name,
                    last_name: cached.last_name
                };
            }
        } catch (_) {}
    }

    if (!profileData && window.supabaseClient && window.supabaseClient.auth) {
        window.supabaseClient.auth.getUser().then(async ({ data }) => {
            const user = data?.user;
            if (user) {
                const meta = user.user_metadata || {};
                let photoUrl = meta.profile_photo_url || meta.avatar_url;
                let firstName = meta.first_name;
                let middleName = meta.middle_name;
                let lastName = meta.last_name;
                let position = meta.position || meta.role;
                let department = meta.department;

                try {
                    const { data: facultyRecord } = await window.supabaseClient
                        .from('faculty')
                        .select('profile_photo_url, full_name, first_name, middle_name, last_name, position, department, name')
                        .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`)
                        .maybeSingle();
                    if (facultyRecord) {
                        if (facultyRecord.profile_photo_url) photoUrl = facultyRecord.profile_photo_url;
                        if (facultyRecord.first_name) firstName = facultyRecord.first_name;
                        if (facultyRecord.middle_name) middleName = facultyRecord.middle_name;
                        if (facultyRecord.last_name) lastName = facultyRecord.last_name;
                        if (facultyRecord.position) position = facultyRecord.position;
                        if (facultyRecord.department) department = facultyRecord.department;
                    }
                } catch (_) {}

                updateFacultyNavProfile({
                    first_name: firstName,
                    middle_name: middleName,
                    last_name: lastName,
                    role: position || 'Faculty Member',
                    position: position || 'Faculty Member',
                    department: department || 'CITE Faculty',
                    profile_photo_url: photoUrl,
                    email: user.email
                });
            }
        }).catch(() => {});
        return;
    }

    if (!profileData) return;

    // --- STRICT FORMATTING: FIRST NAME + MIDDLE INITIAL + LAST NAME (WALAY SUFFIX) ---
    let fn = profileData.first_name || '';
    let mn = profileData.middle_name || '';
    let ln = profileData.last_name || '';

    if (!fn && !ln && (profileData.full_name || profileData.name)) {
        const parts = (profileData.full_name || profileData.name).trim().split(/\s+/);
        if (parts.length === 1) {
            fn = parts[0];
        } else if (parts.length === 2) {
            fn = parts[0];
            ln = parts[1];
        } else if (parts.length >= 3) {
            fn = parts[0];
            mn = parts[1];
            ln = parts[2];
        }
    }

    if (mn && mn.length > 1 && !mn.endsWith('.')) {
        mn = mn.charAt(0).toUpperCase() + '.';
    }

    // Walay lakip nga suffix diri
    const formattedName = `${fn} ${mn ? mn + ' ' : ''}${ln}`.trim() || profileData.email?.split('@')[0] || 'Faculty Member';

    const role = profileData.position || profileData.role || 'Faculty Member';
    const dept = profileData.department || 'CITE Faculty';
    const photoUrl = profileData.profile_photo_url || profileData.profilePhotoUrl || profileData.avatar_url;

    const setEl = (idOrSel, val) => {
        if (!val) return;
        const el = idOrSel.startsWith('#') || idOrSel.startsWith('.')
            ? document.querySelector(idOrSel)
            : document.getElementById(idOrSel);
        if (el) el.textContent = val;
    };

    setEl('facultyNavProfileName', formattedName);
    setEl('profileName', formattedName);
    setEl('#facultyProfileModal #facultyNavProfileName', formattedName);
    setEl('#facultyProfileModal #profileName', formattedName);

    setEl('facultyNavProfileRole', role);
    setEl('profileRole', role);
    setEl('#facultyProfileModal #facultyNavProfileRole', role);
    setEl('#facultyProfileModal #profileRole', role);

    setEl('facultyNavDept', dept);
    setEl('profileDepartment', dept);
    setEl('#facultyProfileModal #facultyNavDept', dept);
    setEl('#facultyProfileModal #profileDepartment', dept);

    setEl('facultyNavRoleDetail', role);
    setEl('profileRoleDetail', role);
    setEl('#facultyProfileModal #facultyNavRoleDetail', role);
    setEl('#facultyProfileModal #profileRoleDetail', role);

    // --- DISPLAY PROFILE PHOTO SA MODAL ---
    if (photoUrl) {
        const modalImg = document.getElementById('modalProfileImg');
        const modalIcon = document.getElementById('modalProfileIcon');

        if (modalImg) {
            modalImg.src = photoUrl;
            modalImg.style.display = 'block';
        }
        if (modalIcon) {
            modalIcon.style.display = 'none';
        }

        document.querySelectorAll('img.nav-profile-img, .profile-avatar-img').forEach(img => {
            img.src = photoUrl;
            img.style.display = 'block';
        });
        document.querySelectorAll('.profile-icon, .profile-avatar-icon').forEach(icon => {
            if (icon.id !== 'modalProfileIcon') {
                icon.style.display = 'none';
            }
        });
    }
}

window.updateFacultyNavProfile = updateFacultyNavProfile;

async function loadFacultyNavigation() {
    try {
        const candidateUrls = [
            "faculty-nav.html",
            "/faculty/faculty-nav.html",
            "faculty/faculty-nav.html",
            "../faculty-nav.html",
            "../faculty/faculty-nav.html",
            "faculty-nav.html?v=chair-review-1",
            "../faculty/faculty-nav.html?v=chair-review-1"
        ];
        let response = null;
        for (const url of candidateUrls) {
            try {
                const res = await fetch(url);
                if (res && res.ok) {
                    response = res;
                    break;
                }
            } catch (_) {}
        }
        if (!response) {
            throw new Error("Unable to fetch faculty-nav.html from candidate paths");
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        mountFacultyNavPart(doc.querySelector("aside.sidebar"), "sidebar-container");
        mountFacultyNavPart(doc.querySelector("nav.navbar"), "navbar-container");
        mountFacultyNavPart(doc.getElementById("facultyProfileBackdrop"), null, true);
        mountFacultyNavPart(doc.getElementById("facultyProfileModal"), null, true);

        attachFacultyNavEvents();
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        updateFacultyNavProfile();
        loadFacultyNavNotifications();
        subscribeFacultyNavNotifications();
        removeFacultyChairWorkflowNavItem();

        if (window.CiteFlowMessenger && typeof window.CiteFlowMessenger.init === 'function') {
            window.CiteFlowMessenger.init();
        } else {
            const script = document.createElement("script");
            script.src = "../shared/messenger.js";
            script.onload = () => {
                window.CiteFlowMessenger?.init();
            };
            document.head.appendChild(script);
        }
    } catch (error) {
        console.error("Failed to load faculty navigation:", error);
    }
}

async function facultyLogout() {
    try {
        if (window.CiteFlowAuth) {
            await window.CiteFlowAuth.logout();
            return;
        }
        if (window.supabaseClient && window.supabaseClient.auth) {
            await window.supabaseClient.auth.signOut();
        }
    } catch (_) {}
    window.location.href = "../login.html";
}

function openFacultyMessages() {
    if (window.CiteFlowMessenger && typeof window.CiteFlowMessenger.openPanel === 'function') {
        window.CiteFlowMessenger.openPanel();
    } else {
        const panel = document.getElementById("msgrPanel");
        if (panel) panel.classList.add("show");
    }
}

window.openFacultyMessages = openFacultyMessages;
window.loadSidebar = loadFacultyNavigation;
window.loadFacultyNavigation = loadFacultyNavigation;
window.toggleFacultyProfileModal = toggleFacultyProfileModal;
window.facultyLogout = facultyLogout;

function removeFacultyChairWorkflowNavItem() {
    document.getElementById('facultyChairWorkflowNav')?.remove();
    document.getElementById('chairWorkflowDashCard')?.remove();
    document.getElementById('chairWorkflowPageBanner')?.remove();
}

let facultyNavNotifications = [];

function escapeFacultyNavHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
}

function formatFacultyNavDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isFacultyCalendarNotification(notification) {
    const type = String(notification?.type || '').toLowerCase();
    const link = String(notification?.link || notification?.url || '').toLowerCase();
    const message = String(notification?.message || '').toLowerCase();
    return type === 'calendar' || type === 'event' || type === 'schedule'
        || link.includes('calendar.html')
        || /calendar schedule|faculty calendar|was posted|was updated/.test(message);
}

function extractFacultyNotifTitle(notification) {
    const msg = String(notification?.message || '');
    const quoted = msg.match(/"([^"]+)"/);
    return quoted ? quoted[1] : '';
}

function facultyNotifTarget(notification) {
    const stored = String(
        notification?.link
        || notification?.url
        || notification?.href
        || notification?.page
        || ''
    ).trim();
    if (stored) return stored;

    const type = String(notification?.type || notification?.notif_type || notification?.kind || '').toLowerCase();
    const msg = String(notification?.message || '').toLowerCase();
    const title = extractFacultyNotifTitle(notification);
    const recordId = notification?.task_id || notification?.document_id || notification?.workflow_item_id || notification?.event_id || '';

    if (isFacultyCalendarNotification(notification)) {
        return recordId ? `calendar.html#open=${recordId}` : 'calendar.html';
    }

    if (/document vault|official template|browse folder/.test(msg)) {
        return title ? `document.html#task=${encodeURIComponent(title)}` : 'document.html';
    }

    if (type === 'task' || type === 'assignment' || type === 'reminder' || type === 'deadline'
        || /new task|assigned to you|reminder:|is due/.test(msg)) {
        return recordId
            ? `status-tracking.html#open=${recordId}`
            : (title ? `status-tracking.html#task=${encodeURIComponent(title)}` : 'status-tracking.html');
    }

    return title ? `status-tracking.html#task=${encodeURIComponent(title)}` : 'status-tracking.html';
}

async function markOneFacultyNotificationRead(id) {
    if (!id) return;
    facultyNavNotifications = facultyNavNotifications.map((item) => (
        String(item.id) === String(id) ? { ...item, is_read: true } : item
    ));
    const row = document.querySelector('#facultyNavNotifList [data-notif-id="' + String(id).replace(/"/g, '') + '"]');
    if (row) row.classList.remove('unread');
    const badge = document.getElementById('facultyNavNotifBadge');
    const unread = facultyNavNotifications.filter((item) => !item.is_read).length;
    if (badge) {
        if (unread > 0) {
            badge.style.display = 'flex';
            badge.textContent = unread > 99 ? '99+' : String(unread);
        } else {
            badge.style.display = 'none';
            badge.textContent = '0';
        }
    }
    const sb = window.supabaseClient;
    if (!sb) return;
    const { error } = await sb.from('wf_notifications').update({ is_read: true }).eq('id', id);
    if (error) console.warn('Could not mark faculty notification read:', error);
}

async function openFacultyNavNotification(notification) {
    await markOneFacultyNotificationRead(notification?.id);
    const target = facultyNotifTarget(notification);
    if (!target) return;
    const hashMatch = String(target).match(/#(?:open|task)=([^&]+)/i);
    if (hashMatch) {
        try { sessionStorage.setItem('citeOpenNotif', decodeURIComponent(hashMatch[1])); } catch (_) {}
    }
    const title = extractFacultyNotifTitle(notification);
    if (title) {
        try { sessionStorage.setItem('citeOpenTask', title); } catch (_) {}
    }
    const dropdown = document.getElementById('facultyNavNotifDropdown');
    if (dropdown) dropdown.classList.remove('open');
    navigateToFacultyPage(target);
}

function filterFacultyNavNotifications(items, facultyId) {
    const scoped = (items || []).filter((notification) => {
        if (facultyId != null && notification.faculty_id != null) {
            return String(notification.faculty_id) === String(facultyId);
        }
        return notification.faculty_id == null;
    });
    if (!window.CiteFlowSettings?.filterNotifications) {
        return scoped;
    }
    const filtered = window.CiteFlowSettings.filterNotifications(scoped, 'faculty');
    const kept = new Set((filtered || []).map((item) => item.id));
    const extras = scoped.filter((item) => !kept.has(item.id) && isFacultyCalendarNotification(item));
    return extras.concat(filtered || []);
}

function bindFacultyNavNotifClicks() {
    const list = document.getElementById('facultyNavNotifList');
    if (!list || list.dataset.citeClickBound === '1') return;
    list.dataset.citeClickBound = '1';
    list.addEventListener('click', async (event) => {
        if (event.button != null && event.button !== 0) return;
        const row = event.target.closest('.nav-notif-item');
        if (!row) return;
        const id = row.getAttribute('data-notif-id');
        const notification = facultyNavNotifications.find((item) => String(item.id) === String(id)) || {
            id,
            link: row.getAttribute('data-link'),
            type: row.getAttribute('data-type'),
            message: row.textContent
        };
        event.preventDefault();
        event.stopPropagation();
        await openFacultyNavNotification(notification);
    });
}

function renderFacultyNavNotifications(items) {
    facultyNavNotifications = Array.isArray(items) ? items : [];
    const list = document.getElementById('facultyNavNotifList');
    const badge = document.getElementById('facultyNavNotifBadge');
    if (!list || !badge) return;

    if (!facultyNavNotifications.length) {
        list.innerHTML = '<p class="nav-notif-empty">No notifications yet</p>';
        badge.style.display = 'none';
        badge.textContent = '0';
        return;
    }

    list.innerHTML = facultyNavNotifications.map((notification) => `
        <div class="nav-notif-item ${notification.is_read ? '' : 'unread'}" data-notif-id="${escapeFacultyNavHtml(notification.id)}" data-link="${escapeFacultyNavHtml(notification.link || notification.url || '')}" data-type="${escapeFacultyNavHtml(notification.type || '')}" role="button" style="cursor:pointer;">
            <div class="flex-1">
                <div>${escapeFacultyNavHtml(notification.message)}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${formatFacultyNavDate(notification.created_at)}</div>
            </div>
        </div>
    `).join('');

    bindFacultyNavNotifClicks();

    const unread = facultyNavNotifications.filter((notification) => !notification.is_read).length;
    if (unread > 0) {
        badge.style.display = 'flex';
        badge.textContent = unread > 99 ? '99+' : String(unread);
    } else {
        badge.style.display = 'none';
        badge.textContent = '0';
    }
}

async function loadFacultyNavNotifications() {
    const sb = window.supabaseClient;
    if (!sb?.auth) return;

    const { data: sessionData } = await sb.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    await ensureCiteFlowSettings();
    if (window.CiteFlowSettings?.loadPreferences) {
        try {
            await window.CiteFlowSettings.loadPreferences();
        } catch (_) { /* keep defaults if preferences cannot be loaded */ }
    }

    let facultyId = null;
    if (window.CiteFlowWorkflow?.getCurrentFaculty) {
        const faculty = await window.CiteFlowWorkflow.getCurrentFaculty(user);
        facultyId = faculty?.id ?? null;
    }

    if (facultyId != null && window.CiteFlowWorkflow?.processDeadlineReminders) {
        await CiteFlowWorkflow.processDeadlineReminders(sb, { facultyId });
    }

    let query = sb
        .from('wf_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (facultyId != null) {
        query = query.or(`faculty_id.eq.${facultyId},faculty_id.is.null`);
    }

    const { data, error } = await query;
    if (error) {
        console.warn('Faculty nav notifications could not be loaded:', error);
        return;
    }

    renderFacultyNavNotifications(filterFacultyNavNotifications(data || [], facultyId));
}

function subscribeFacultyNavNotifications() {
    const sb = window.supabaseClient;
    if (!sb || window.__facultyWfNotifChannel) return;
    window.__facultyWfNotifChannel = sb
        .channel('faculty-wf-notifications-bell')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wf_notifications' }, () => {
            loadFacultyNavNotifications();
        })
        .subscribe();
}

function refreshFacultyNavNotifications(items) {
    if (Array.isArray(items)) {
        renderFacultyNavNotifications(items);
        return;
    }
    loadFacultyNavNotifications();
}

function toggleFacultyNotifications() {
    const dropdown = document.getElementById('facultyNavNotifDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) {
        loadFacultyNavNotifications();
    }
}

async function markFacultyNavNotificationsRead() {
    const sb = window.supabaseClient;
    const ids = facultyNavNotifications.filter((notification) => !notification.is_read).map((notification) => notification.id);
    if (!sb || !ids.length) return;

    const { error } = await sb.from('wf_notifications').update({ is_read: true }).in('id', ids);
    if (error) {
        console.warn('Could not mark faculty notifications read:', error);
        return;
    }

    facultyNavNotifications = facultyNavNotifications.map((notification) => ({ ...notification, is_read: true }));
    renderFacultyNavNotifications(facultyNavNotifications);
}

window.toggleFacultyNotifications = toggleFacultyNotifications;
window.markFacultyNavNotificationsRead = markFacultyNavNotificationsRead;
window.refreshFacultyNavNotifications = refreshFacultyNavNotifications;
window.loadFacultyNavNotifications = loadFacultyNavNotifications;

document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('facultyNavNotifDropdown');
    const button = document.getElementById('facultyNavNotifBtn');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    if (button?.contains(event.target) || dropdown.contains(event.target)) return;
    dropdown.classList.remove('open');
});

window.addEventListener("load", async () => {
    if (!document.querySelector("aside.sidebar")) {
        await loadFacultyNavigation();
    } else {
        attachFacultyNavEvents();
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        updateFacultyNavProfile();
        loadFacultyNavNotifications();
        subscribeFacultyNavNotifications();
        window.CiteFlowMessenger?.init();
    }
    removeFacultyChairWorkflowNavItem();
});

(function bindFacultyNotificationDeepLink(global) {
    let opened = false;

    function wantedValue() {
        const hash = String(location.hash || '').replace(/^#/, '');
        let value = '';
        if (hash.startsWith('task=')) value = decodeURIComponent(hash.slice(5));
        else if (hash.startsWith('folder=')) value = decodeURIComponent(hash.slice(7));
        else if (hash.startsWith('open=')) value = decodeURIComponent(hash.slice(5));
        try {
            if (!value) value = sessionStorage.getItem('citeOpenTask') || sessionStorage.getItem('citeOpenNotif') || '';
        } catch (_) {}
        return String(value || '').trim();
    }

    function clearWanted() {
        opened = true;
        try {
            sessionStorage.removeItem('citeOpenTask');
            sessionStorage.removeItem('citeOpenNotif');
        } catch (_) {}
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }

    function matchesText(value, needle) {
        const text = String(value || '').toLowerCase().trim();
        const want = String(needle || '').toLowerCase().trim();
        if (!text || !want) return false;
        return text === want || text.includes(want) || want.includes(text);
    }

    function openStatusTask() {
        if (typeof computeRows !== 'function' || typeof selectRow !== 'function') return false;
        const wanted = wantedValue();
        if (!wanted) return false;
        const rows = computeRows();
        if (!rows.length) return false;
        const match = rows.find((row) =>
            String(row.task?.id) === wanted
            || String(row.assignment?.task_id) === wanted
            || String(row.key) === wanted
            || matchesText(row.task?.title, wanted)
        );
        if (!match) return false;

        clearWanted();
        if (typeof filterStatus === 'function') filterStatus('all');
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        try { searchTerm = ''; } catch (_) {}
        selectRow(match.key);
        window.setTimeout(() => {
            document.querySelector('#statusList .task-row.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 60);
        return true;
    }

    async function openVaultFolder() {
        const list = (typeof folders !== 'undefined' && Array.isArray(folders)) ? folders : [];
        if (typeof openFolder !== 'function' || !list.length) return false;
        const wanted = wantedValue();
        if (!wanted) return false;
        const formatName = typeof formatVaultFolderName === 'function' ? formatVaultFolderName : (name) => name;
        const folder = list.find((item) =>
            String(item.id) === wanted
            || matchesText(item.name, wanted)
            || matchesText(formatName(item.name), wanted)
        );
        if (!folder) return false;

        clearWanted();
        const category = document.getElementById('vault-category-filter');
        if (category) {
            const option = Array.from(category.options).find((opt) =>
                String(opt.value).toLowerCase() === wanted.toLowerCase()
                || String(opt.text).toLowerCase().includes(wanted.toLowerCase())
            );
            if (option) category.value = option.value;
        }
        await openFolder(folder.id);
        return true;
    }

    async function run() {
        if (opened) return true;
        if (!wantedValue()) return false;
        if (openStatusTask()) return true;
        if (await openVaultFolder()) return true;
        return false;
    }

    function wrapAfter(name) {
        const original = global[name];
        if (typeof original !== 'function' || original.__citeNotifWrapped) return;
        const wrapped = async function () {
            const result = await original.apply(this, arguments);
            window.setTimeout(() => { run(); }, 40);
            return result;
        };
        wrapped.__citeNotifWrapped = true;
        global[name] = wrapped;
    }

    function tryWrap() {
        ['fetchAllData', 'loadFolders', 'renderFolders', 'renderRows'].forEach(wrapAfter);
    }

    global.openPendingFacultyNotification = run;
    global.resetPendingFacultyNotification = function () {
        opened = false;
        return run();
    };

    window.addEventListener('hashchange', () => {
        opened = false;
        run();
    });

    function boot() {
        tryWrap();
        [200, 600, 1200, 2200, 4000, 7000].forEach((ms) => {
            window.setTimeout(() => {
                tryWrap();
                run();
            }, ms);
        });
    }

    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', boot);
})(window);
