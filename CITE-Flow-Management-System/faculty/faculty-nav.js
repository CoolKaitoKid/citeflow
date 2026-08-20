// CITE-Flow Faculty Navigation Manager

function getFacultyCurrentPageFile() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const current = parts[parts.length - 1] || "dashboard";
    return current.endsWith(".html") ? current : `${current}.html`;
}

function normalizeFacultyPageKey(pageFile) {
    if (!pageFile) return "";
    return pageFile
        .replace(/^\.\.\//, "")
        .replace(/^faculty\//, "")
        .replace(/\.html$/, "");
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
        settings: "system-settings.html"
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
    const mapped = facultyPageMap(pageFile);
    window.location.href = mapped;
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
        // Toggle mobile drawer inig pislit sa hamburger push button
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
                    department: cached.department || 'CITE Faculty'
                };
            }
        } catch (_) {}
    }

    if (!profileData && window.supabaseClient && window.supabaseClient.auth) {
        window.supabaseClient.auth.getUser().then(({ data }) => {
            const user = data?.user;
            if (user) {
                const meta = user.user_metadata || {};
                const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'Faculty Member';
                updateFacultyNavProfile({
                    name: name,
                    full_name: name,
                    role: meta.role || 'Faculty Member',
                    position: meta.role || 'Faculty Member',
                    department: meta.department || 'CITE Faculty'
                });
            }
        }).catch(() => {});
        return;
    }

    if (!profileData) return;

    const name = profileData.full_name || profileData.name || profileData.email || 'Faculty Member';
    const role = profileData.position || profileData.role || 'Faculty Member';
    const dept = profileData.department || 'CITE Faculty';

    const setEl = (idOrSel, val) => {
        if (!val) return;
        const el = idOrSel.startsWith('#') || idOrSel.startsWith('.') 
            ? document.querySelector(idOrSel) 
            : document.getElementById(idOrSel);
        if (el) el.textContent = val;
    };

    setEl('facultyNavProfileName', name);
    setEl('profileName', name);
    setEl('#facultyProfileModal #facultyNavProfileName', name);
    setEl('#facultyProfileModal #profileName', name);

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
}

window.updateFacultyNavProfile = updateFacultyNavProfile;

async function loadFacultyNavigation() {
    try {
        const candidateUrls = ["faculty-nav.html", "/faculty/faculty-nav.html", "faculty/faculty-nav.html", "../faculty-nav.html"];
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

window.addEventListener("load", async () => {
    if (!document.querySelector("aside.sidebar")) {
        await loadFacultyNavigation();
    } else {
        attachFacultyNavEvents();
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        updateFacultyNavProfile();
        window.CiteFlowMessenger?.init();
    }
});