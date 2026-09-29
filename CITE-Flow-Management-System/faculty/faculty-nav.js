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

function ensureNotificationPresentation() {
    if (window.CiteFlowNotifPresentation) {
        window.CiteFlowNotifPresentation.ensureStyles();
        return Promise.resolve(window.CiteFlowNotifPresentation);
    }
    if (document.querySelector('script[src*="notification-presentation.js"]')) {
        return new Promise((resolve) => {
            const started = Date.now();
            const wait = () => {
                if (window.CiteFlowNotifPresentation) {
                    window.CiteFlowNotifPresentation.ensureStyles();
                    resolve(window.CiteFlowNotifPresentation);
                    return;
                }
                if (Date.now() - started > 2000) {
                    resolve(null);
                    return;
                }
                setTimeout(wait, 40);
            };
            wait();
        });
    }
    return new Promise((resolve) => {
        const script = document.createElement('script');
        const path = String(location.pathname || '').toLowerCase();
        script.src = (path.includes('/faculty/') || path.includes('/admin/') || path.includes('/chairperson/'))
            ? '../shared/notification-presentation.js'
            : 'shared/notification-presentation.js';
        script.onload = () => {
            window.CiteFlowNotifPresentation?.ensureStyles();
            resolve(window.CiteFlowNotifPresentation || null);
        };
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
    if (key === "workflow-approval" || key === "mfo-report") return "submissions";
    return key;
}

function facultyPageMap(pageName) {
    const key = normalizeFacultyPageKey(pageName);
    return {
        dashboard: "dashboard.html",
        "faculty-profile": "faculty-profile.html",
        profile: "faculty-profile.html",
        accomplishments: "faculty-profile.html#accomplishments",
        submissions: "submissions.html",
        "mfo-report": "mfo-report.html",
        "status-tracking": "status-tracking.html",
        document: "document.html",
        "document-vault": "document.html",
        calendar: "calendar.html",
        "system-settings": "system-settings.html",
        settings: "system-settings.html",
        "workflow-approval": "submissions.html#chair-review",
        "chairperson-workflow-approval": "submissions.html#chair-review",
        // 👉 Idugang kini nga linya:
        "help-support": "help-support.html"
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
        if (typeof window.switchTab === 'function' && mappedHash && /faculty-profile/i.test(mappedFile)) {
            window.switchTab(mappedHash.replace('#', ''));
        }
        if (typeof window.resetPendingFacultyNotification === 'function') {
            window.setTimeout(() => window.resetPendingFacultyNotification(), 0);
        } else if (typeof window.openPendingFacultyNotification === 'function') {
            window.setTimeout(() => window.openPendingFacultyNotification(), 0);
        }
        updateFacultyActiveMenu();
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

    if (window.currentFaculty) {
        updateFacultyNavProfile(window.currentFaculty);
    } else {
        updateFacultyNavProfile();
    }

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
    const hash = String(location.hash || '').toLowerCase();
    const chairHash = hash === '#chair-review' || hash === '#chairperson-review';
    const isAccomplishments = hash === '#accomplishments';

    document.querySelectorAll(".sidebar .nav-item, .logo-area[data-page]").forEach((item) => {
        const dataPage = item.getAttribute("data-page");
        if (!dataPage) return;
        const target = normalizeFacultyPageKey(dataPage);
        let isActive = target === current;
        if (item.id === 'facultyChairWorkflowNav') {
            isActive = current === 'submissions' && chairHash;
        } else if (target === 'submissions' && chairHash) {
            isActive = false;
        } else if (dataPage.includes('#accomplishments')) {
            isActive = current === 'faculty-profile' && isAccomplishments;
        } else if (target === 'faculty-profile' && isAccomplishments) {
            isActive = false;
        }
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
    if (!profileData && window.currentFaculty) {
        profileData = window.currentFaculty;
    }

    if (!profileData) {
        try {
            let cached = JSON.parse(localStorage.getItem('citeflow_user') || '{}');
            // Auto-heal corrupted legacy name in cache if present
            if (cached && typeof cached === 'object') {
                if (/^Krishnan\s+P\.?\s+Aquino$/i.test(cached.name || '') || /^Krishnan\s+P\.?\s+Aquino$/i.test(cached.full_name || '')) {
                    cached.name = 'Krishnan Paolo A. Rabasto';
                    cached.full_name = 'Krishnan Paolo A. Rabasto';
                    cached.first_name = 'Krishnan Paolo';
                    cached.middle_name = 'Aquino';
                    cached.last_name = 'Rabasto';
                    try { localStorage.setItem('citeflow_user', JSON.stringify(cached)); } catch (_) {}
                }
            }
            if (cached && (cached.name || cached.full_name || cached.first_name)) {
                profileData = {
                    name: cached.name || cached.full_name,
                    full_name: cached.full_name || cached.name,
                    role: cached.role || 'Faculty Member',
                    position: cached.position || cached.role || 'Faculty Member',
                    department: cached.department || 'CITE Faculty',
                    profile_photo_url: cached.profile_photo_url || cached.profilePhotoUrl || cached.avatar_url,
                    first_name: cached.first_name || '',
                    middle_name: cached.middle_name || '',
                    last_name: cached.last_name || ''
                };
            }
        } catch (_) {}
    }

    // Always fetch fresh profile from Supabase if auth is available and we don't have explicit first_name + last_name
    if (window.supabaseClient && window.supabaseClient.auth && (!profileData || !profileData.first_name || !profileData.last_name)) {
        (async () => {
            try {
                const session = window.CiteFlowAuthGuard?.session
                    || (await window.supabaseClient.auth.getSession())?.data?.session;
                const user = session?.user || window.CiteFlowAuthGuard?.user;
                if (user) {
                    const meta = user.user_metadata || {};
                    let photoUrl = meta.profile_photo_url || meta.avatar_url;
                    let firstName = meta.first_name;
                    let middleName = meta.middle_name;
                    let lastName = meta.last_name;
                    let position = meta.position || meta.role;
                    let department = meta.department;
                    let fullName = meta.full_name || meta.name;

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
                            if (facultyRecord.full_name) fullName = facultyRecord.full_name;
                        }
                    } catch (_) {}

                    renderFacultyNavData({
                        first_name: firstName,
                        middle_name: middleName,
                        last_name: lastName,
                        full_name: fullName,
                        name: fullName,
                        role: position || 'Faculty Member',
                        position: position || 'Faculty Member',
                        department: department || 'CITE Faculty',
                        profile_photo_url: photoUrl,
                        email: user.email
                    });
                }
            } catch (_) {}
        })();
    }

    if (profileData) {
        renderFacultyNavData(profileData);
    }
}

function renderFacultyNavData(profileData) {
    if (!profileData) return;

    let fn = String(profileData.first_name || '').trim();
    let mn = String(profileData.middle_name || '').trim();
    let ln = String(profileData.last_name || '').trim();

    // Auto-heal corrupted legacy string
    let raw = String(profileData.full_name || profileData.name || '').trim();
    if (/^Krishnan\s+P\.?\s+Aquino$/i.test(raw)) {
        fn = 'Krishnan Paolo';
        mn = 'Aquino';
        ln = 'Rabasto';
        raw = 'Krishnan Paolo A. Rabasto';
    }

    let formattedName = '';
    if (fn || ln) {
        let mi = '';
        if (mn) {
            const letter = mn.replace(/[^A-Za-z]/g, '').charAt(0);
            if (letter) mi = letter.toUpperCase() + '.';
        }
        formattedName = [fn, mi, ln].filter(Boolean).join(' ').trim();
    } else if (raw) {
        const parts = raw.split(/\s+/);
        if (parts.length === 1) {
            formattedName = parts[0];
        } else if (parts.length === 2) {
            formattedName = parts.join(' ');
        } else if (parts.length === 4) {
            formattedName = `${parts[0]} ${parts[1]} ${parts[2].charAt(0).toUpperCase()}. ${parts[3]}`;
        } else if (parts.length === 3) {
            if (/^[A-Z]\.?$/i.test(parts[1])) {
                formattedName = `${parts[0]} ${parts[1].replace('.', '').toUpperCase()}. ${parts[2]}`;
            } else {
                formattedName = `${parts[0]} ${parts[1].charAt(0).toUpperCase()}. ${parts[2]}`;
            }
        } else {
            formattedName = raw;
        }
    }

    if (!formattedName) {
        formattedName = profileData.email?.split('@')[0] || 'Faculty Member';
    }

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
    setEl('#facultyProfileModal #facultyNavProfileName', formattedName);

    // Only update profileName if NOT on faculty-profile.html (which renders its own official formatted name)
    if (!window.location.pathname.includes('faculty-profile.html')) {
        setEl('profileName', formattedName);
        setEl('#facultyProfileModal #profileName', formattedName);
    }

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

function ensureFacultyGlobalSearch() {
    const start = () => {
        if (window.CiteFlowGlobalSearch?.mount) window.CiteFlowGlobalSearch.mount();
    };
    if (window.CiteFlowGlobalSearch) {
        start();
        return;
    }
    if (document.querySelector('script[src*="global-search.js"]')) {
        start();
        return;
    }
    const script = document.createElement('script');
    const nested = /\/faculty\/|\/chairperson\/|\/admin\//i.test(window.location.pathname);
    script.src = nested ? '../shared/global-search.js' : 'shared/global-search.js';
    script.onload = start;
    document.head.appendChild(script);
}

let facultyNavMountPromise = null;

async function loadFacultyNavigation() {
    if (facultyNavMountPromise) return facultyNavMountPromise;
    facultyNavMountPromise = mountFacultyNavigation();
    try {
        return await facultyNavMountPromise;
    } finally {
        facultyNavMountPromise = null;
    }
}

async function mountFacultyNavigation() {
    try {
        const candidateUrls = [
            "faculty-nav.html?v=sub-load-1",
            "../faculty/faculty-nav.html?v=sub-load-1",
            "faculty-nav.html",
            "/faculty/faculty-nav.html",
            "faculty/faculty-nav.html",
            "../faculty-nav.html",
            "../faculty/faculty-nav.html"
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
        ensureFacultyGlobalSearch();
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        updateFacultyNavProfile();
        loadFacultyNavNotifications();
        subscribeFacultyNavNotifications();
        refreshFacultyChairReviewNav();

        if (window.CiteFlowMessenger && typeof window.CiteFlowMessenger.init === 'function') {
            window.CiteFlowMessenger.init();
        } else if (!window.__citeflowMessengerLoading) {
            // Guard the injection. A second navigation load arriving before
            // this script finishes would evaluate messenger.js again, and the
            // replacement module state knows nothing about the realtime
            // channels the first copy already registered on the client.
            window.__citeflowMessengerLoading = true;
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
    console.warn('[AUTH TRACE] FACULTY LOGOUT requested');
    try {
        if (window.CiteFlowAuth) {
            await window.CiteFlowAuth.logout();
            return;
        }
        if (window.supabaseClient && window.supabaseClient.auth) {
            console.warn('[AUTH TRACE] FACULTY LOGOUT fallback signOut');
            await window.supabaseClient.auth.signOut();
        }
    } catch (error) {
        console.error('[AUTH TRACE] FACULTY LOGOUT failed', error);
    }
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
window.refreshFacultyChairReviewNav = refreshFacultyChairReviewNav;
window.updateFacultyActiveMenu = updateFacultyActiveMenu;
window.toggleFacultyProfileModal = toggleFacultyProfileModal;
window.facultyLogout = facultyLogout;

function syncFacultyChairReviewNav(show) {
    const item = document.getElementById('facultyChairWorkflowNav');
    if (!item) return;
    const visible = show === true;
    item.classList.toggle('hidden', !visible);
    item.style.display = visible ? '' : 'none';
}

async function refreshFacultyChairReviewNav(options = {}) {
    const item = document.getElementById('facultyChairWorkflowNav');
    if (!item) return;
    const attempt = Number(options.attempt || 0);
    let show = false;
    try {
        if (window.CiteFlowAuthGuard?.ready) {
            await window.CiteFlowAuthGuard.ready;
            if (window.CiteFlowAuthGuard.state === 'AUTH_UNAUTHENTICATED') {
                syncFacultyChairReviewNav(false);
                return;
            }
        }
        const wf = window.CiteFlowWorkflow;
        const sb = window.CiteFlowAuth?.ensureSharedClient?.() || window.supabaseClient || window.db;
        if (!sb) {
            if (attempt < 4) {
                setTimeout(() => refreshFacultyChairReviewNav({ attempt: attempt + 1 }), 400);
            }
            return;
        }
        if (window.__citeChairAccessResolved) {
            syncFacultyChairReviewNav(window.CiteFlowChairReview?.access === true);
            return;
        }
        const guardedSession = window.CiteFlowAuthGuard?.session;
        const user = guardedSession?.user
            || window.CiteFlowAuthGuard?.user
            || (await sb.auth.getSession())?.data?.session?.user;
        if (!user) {
            if (attempt < 4) {
                setTimeout(() => refreshFacultyChairReviewNav({ attempt: attempt + 1 }), 400);
            }
            return;
        }
        let faculty = window.currentFaculty || window.CiteFlowAuthGuard?.faculty || null;
        if (!faculty && wf?.getCurrentFaculty) {
            try {
                faculty = await wf.getCurrentFaculty(user) || faculty;
            } catch (_) {}
        }
        if (!faculty) {
            // Profile often loads after the sidebar. Do not hide the item yet.
            if (attempt < 6) {
                setTimeout(() => refreshFacultyChairReviewNav({ attempt: attempt + 1 }), 500);
            } else {
                syncFacultyChairReviewNav(false);
            }
            return;
        }
        if (wf?.currentUserHasChairpersonGrant) {
            show = await wf.currentUserHasChairpersonGrant(sb, faculty, user);
        } else if (window.CiteFlowChairReview?.access) {
            show = true;
        } else if (sb?.rpc) {
            const rpc = await sb.rpc('wf_current_user_has_chairperson_grant');
            show = rpc.data === true;
        }
        if (show && window.CiteFlowChairReview?.refreshAccess) {
            try {
                await window.CiteFlowChairReview.refreshAccess(faculty, user);
            } catch (_) {}
        }
    } catch (_) {
        show = false;
    }
    syncFacultyChairReviewNav(show);
}

let facultyNavNotifications = [];
let facultyNotifFilter = 'all';

function visibleFacultyNotifications(items) {
    const source = Array.isArray(items) ? items : facultyNavNotifications;
    const hideProfile = window.CiteFlowNotifPresentation?.isProfileUpdate;
    if (typeof hideProfile !== 'function') return source;
    return source.filter((item) => !hideProfile(item));
}

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

function facultyNotifSubject(notification) {
    return extractFacultyNotifTitle(notification)
        || window.CiteFlowNotifPresentation?.present(notification)?.subjectTitle
        || '';
}

function facultyNotifTarget(notification) {
    const type = String(notification?.type || notification?.notif_type || notification?.kind || '').toLowerCase();
    const msg = String(notification?.message || '').toLowerCase();
    const title = facultyNotifSubject(notification);
    const taskId = notification?.task_id || '';
    const eventId = notification?.event_id || notification?.document_id || notification?.workflow_item_id || '';
    const stored = String(
        notification?.link
        || notification?.url
        || notification?.href
        || notification?.page
        || ''
    ).trim();
    const accomplishment = /accomplishment report/.test(msg);
    const documentPortfolio = ['document_expiry', 'document_uploaded', 'document_verified', 'document_rejected'].includes(type);
    const profileLink = /faculty-profile/i.test(stored);

    if (stored && !(profileLink && !accomplishment && !documentPortfolio)) return stored;

    if (isFacultyCalendarNotification(notification)) {
        const recordId = notification?.event_id || eventId;
        return recordId ? `calendar.html#open=${recordId}` : 'calendar.html';
    }

    if (accomplishment) return 'faculty-profile.html#accomplishments-subs';

    if (/document vault|official template|browse folder/.test(msg)) {
        return title ? `document.html#task=${encodeURIComponent(title)}` : 'document.html';
    }

    if (documentPortfolio) return 'faculty-profile.html';

    if (/chairperson review|workflow access/.test(msg)) return 'submissions.html#chair-review';

    const taskKey = taskId || title;
    if (type === 'task' || type === 'assignment' || type === 'reminder' || type === 'deadline'
        || type === 'review' || type === 'submission' || type === 'comment'
        || /new task|assigned to you|reminder:|is due|deadline updated|submission|revision|approved|rejected|declined/.test(msg)) {
        return taskKey ? `submissions.html#task=${encodeURIComponent(taskKey)}` : 'submissions.html';
    }

    return taskKey ? `submissions.html#task=${encodeURIComponent(taskKey)}` : 'submissions.html';
}

async function markOneFacultyNotificationRead(id) {
    if (!id) return;
    facultyNavNotifications = facultyNavNotifications.map((item) => (
        String(item.id) === String(id) ? { ...item, is_read: true } : item
    ));
    const row = document.querySelector('#facultyNavNotifList [data-notif-id="' + String(id).replace(/"/g, '') + '"]');
    if (row) {
        row.classList.remove('unread');
        row.querySelector('.nav-notif-dot')?.remove();
    }
    const badge = document.getElementById('facultyNavNotifBadge');
    const unread = visibleFacultyNotifications().filter((item) => !item.is_read).length;
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
    const subject = window.CiteFlowNotifPresentation?.present(notification)?.subjectTitle || '';
    const deepLink = title || (/submissions\.html|status-tracking|document\.html/i.test(String(target)) ? subject : '');
    if (deepLink) {
        try { sessionStorage.setItem('citeOpenTask', deepLink); } catch (_) {}
    }
    const dropdown = document.getElementById('facultyNavNotifDropdown');
    if (dropdown) dropdown.classList.remove('open');
    if (/final approval required/i.test(String(notification?.message || ''))) {
        const taskKey = notification?.task_id || facultyNotifSubject(notification);
        window.location.href = `../admin/workflow-approval.html${taskKey ? '#task=' + encodeURIComponent(taskKey) : ''}`;
        return;
    }
    if (/chairperson review|workflow access/i.test(String(notification?.message || '')) && notification?.submission_id) {
        try { sessionStorage.setItem('citeOpenChairSubmission', String(notification.submission_id)); } catch (_) {}
    }
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
            message: row.getAttribute('data-raw') || row.textContent
        };
        event.preventDefault();
        event.stopPropagation();
        await openFacultyNavNotification(notification);
    });
}

function bindFacultyNotifFilters() {
    const dropdown = document.getElementById('facultyNavNotifDropdown');
    if (!dropdown || dropdown.dataset.citeFilterBound === '1') return;
    dropdown.dataset.citeFilterBound = '1';
    dropdown.addEventListener('click', (event) => {
        const button = event.target.closest('[data-notif-filter]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        facultyNotifFilter = button.getAttribute('data-notif-filter') === 'unread' ? 'unread' : 'all';
        renderFacultyNavNotifications(facultyNavNotifications);
    });
}

function renderFacultyNavNotifications(items) {
    facultyNavNotifications = Array.isArray(items) ? items : [];
    window.CiteFlowNotifPresentation?.ensureStyles();
    const list = document.getElementById('facultyNavNotifList');
    const badge = document.getElementById('facultyNavNotifBadge');
    if (!list || !badge) return;

    const api = window.CiteFlowNotifPresentation;
    const visible = visibleFacultyNotifications();
    const shown = facultyNotifFilter === 'unread' ? visible.filter((item) => !item.is_read) : visible;
    api?.syncFilters(document.getElementById('facultyNavNotifDropdown'), facultyNotifFilter);
    list.dataset.notifFilter = facultyNotifFilter;

    if (!shown.length) {
        list.innerHTML = api
            ? api.emptyState(visible.length ? facultyNotifFilter : 'all')
            : '<p class="nav-notif-empty">No notifications yet</p>';
    } else if (api?.renderCard) {
        list.innerHTML = shown.map((notification) => api.renderCard(notification)).join('');
    } else {
        list.innerHTML = shown.map((notification) => `
            <div class="nav-notif-item ${notification.is_read ? '' : 'unread'}" data-notif-id="${escapeFacultyNavHtml(notification.id)}" data-link="${escapeFacultyNavHtml(notification.link || notification.url || '')}" data-type="${escapeFacultyNavHtml(notification.type || '')}" data-raw="${escapeFacultyNavHtml(notification.message || '')}" role="button" style="cursor:pointer;">
                <div class="nav-notif-title">${escapeFacultyNavHtml(notification.message)}</div>
            </div>
        `).join('');
    }

    bindFacultyNavNotifClicks();
    bindFacultyNotifFilters();

    const unread = visible.filter((notification) => !notification.is_read).length;
    if (unread > 0) {
        badge.style.display = 'flex';
        badge.textContent = unread > 99 ? '99+' : String(unread);
    } else {
        badge.style.display = 'none';
        badge.textContent = '0';
    }
}

async function loadFacultyNavNotifications(attempt) {
    const tries = Number(attempt || 0);
    const sb = window.supabaseClient;
    const list = document.getElementById('facultyNavNotifList');
    if (!sb?.auth || !list) {
        if (tries < 8) setTimeout(() => loadFacultyNavNotifications(tries + 1), 400);
        return;
    }

    await ensureNotificationPresentation();

    const user = window.CiteFlowAuthGuard?.user
        || window.CiteFlowAuthGuard?.session?.user
        || (await sb.auth.getSession())?.data?.session?.user;
    if (!user) {
        if (tries < 8) setTimeout(() => loadFacultyNavNotifications(tries + 1), 400);
        return;
    }

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
        if (tries < 4) setTimeout(() => loadFacultyNavNotifications(tries + 1), 700);
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
        ensureFacultyGlobalSearch();
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        updateFacultyNavProfile();
        loadFacultyNavNotifications();
        subscribeFacultyNavNotifications();
        window.CiteFlowMessenger?.init();
    }
    refreshFacultyChairReviewNav();
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

    function openSubmissionsTask() {
        if (typeof openTask !== 'function' || typeof getAssignedModels !== 'function') return false;
        if (/chair-review|chairperson-review/i.test(location.hash || '')) return false;
        const wanted = wantedValue();
        if (!wanted) return false;
        const models = getAssignedModels() || [];
        if (!models.length) return false;
        const match = models.find((item) =>
            String(item.task?.id) === wanted
            || matchesText(item.task?.title, wanted)
        );
        if (!match?.task?.id) return false;
        clearWanted();
        openTask(match.task.id);
        return true;
    }

    function openChairReviewItem() {
        if (!/chair-review|chairperson-review/i.test(location.hash || '')) return false;
        const review = window.CiteFlowChairReview;
        if (!review?.setMode || !review.access) return false;
        if (review.mode !== 'chair') review.setMode('chair');
        let submissionId = '';
        try { submissionId = sessionStorage.getItem('citeOpenChairSubmission') || ''; } catch (_) {}
        if (!submissionId || typeof review.openView !== 'function') {
            try {
                sessionStorage.removeItem('citeOpenTask');
                sessionStorage.removeItem('citeOpenNotif');
            } catch (_) {}
            return true;
        }
        review.openView(submissionId);
        const openedModal = document.getElementById('chairViewModal')?.classList.contains('open');
        if (!openedModal) return false;
        try {
            sessionStorage.removeItem('citeOpenChairSubmission');
            sessionStorage.removeItem('citeOpenTask');
            sessionStorage.removeItem('citeOpenNotif');
        } catch (_) {}
        return true;
    }

    async function run() {
        if (opened) return true;
        if (openChairReviewItem()) {
            opened = true;
            return true;
        }
        if (!wantedValue()) return false;
        if (openSubmissionsTask()) return true;
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
