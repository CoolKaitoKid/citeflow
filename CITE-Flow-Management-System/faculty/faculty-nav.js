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