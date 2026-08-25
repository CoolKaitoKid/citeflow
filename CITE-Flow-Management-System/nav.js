function getContent() {
    return document.getElementById("content");
}

function isSpa() {
    return Boolean(getContent());
}

function isInAdminFolder() {
    return window.location.pathname.toLowerCase().includes("/admin/");
}

function normalizePageKey(pageFile) {
    if (!pageFile) return "";
    return pageFile
        .replace(/^\.\.\//, "")
        .replace(/^admin\//, "")
        .replace(/\.html$/, "");
}

function pageMap(pageName) {
    const key = normalizePageKey(pageName);
    return {
        dashboard: "dashboard.html",
        "faculty-profiles": "faculty-profiles.html",
        "workload-tracker": "workload-tracker.html",
        "engagement-logs": "engagement-logs.html",
        "document-vault": "document-vault.html",
        "workflow-approval": "workflow-approval.html",
        calendar: "calendar.html",
        "reports-analytics": "reports-analytics.html",
        "feedback-summary": "feedback-summary.html",
        "user-management": "user-management.html",
        "system-settings": "system-settings.html",
        "admin-profile": "admin-profile.html",
        profile: "admin-profile.html"
    }[key] || `${key}.html`;
}

function resolveAdminPath(pageFile) {
    const mapped = pageMap(pageFile);
    const file = mapped.endsWith(".html") ? mapped : `${mapped}.html`;
    if (isInAdminFolder()) return file;
    return `admin/${file}`;
}

function getCurrentPageFile() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const current = parts[parts.length - 1] || "dashboard";
    return current.endsWith(".html") ? current : `${current}.html`;
}

function getPageFileFromItem(item) {
    if (!item) return null;
    const pageFile = item.getAttribute("data-page");
    if (pageFile) return pageFile;
    const onclick = item.getAttribute("onclick") || "";
    const match = onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (match) return match[1];
    const link = item.querySelector("a[href]");
    if (link) return link.getAttribute("href");
    return null;
}

// ==========================================
// MOBILE SIDEBAR TOGGLE & BACKDROP LOGIC
// ==========================================
function toggleMobileSidebar(forceClose = false) {
    const sidebar = document.querySelector("aside.sidebar, .sidebar");
    let backdrop = document.getElementById("sidebarBackdrop");

    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "sidebarBackdrop";
        backdrop.className = "sidebar-backdrop";
        backdrop.onclick = () => toggleMobileSidebar(true);
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
window.toggleMobileSidebar = toggleMobileSidebar;

async function loadPage(pageName) {
    const content = getContent();
    if (!content) return;

    const fileName = resolveAdminPath(pageMap(pageName));
    try {
        const response = await fetch(fileName);
        if (!response.ok) {
            throw new Error(`Page not found: ${fileName}`);
        }

        const html = await response.text();
        content.innerHTML = html;

        const scripts = content.querySelectorAll("script");
        scripts.forEach((oldScript) => {
            const newScript = document.createElement("script");
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                newScript.textContent = oldScript.textContent;
            }
            document.body.appendChild(newScript);
            document.body.removeChild(newScript);
        });
    } catch (error) {
        console.error(error);
        content.innerHTML = `<h1 style="color:red;">Failed to load ${fileName}</h1>`;
    }
    updateActiveMenu(fileName);
}

function normalizeMenuTarget(fileName) {
    return String(fileName || "")
        .replace(/^\.\.\//, "")
        .replace(/^admin\//, "")
        .toLowerCase();
}

function updateActiveMenu(fileName) {
    const normalized = normalizeMenuTarget(fileName || getCurrentPageFile());

    document.querySelectorAll(".nav-item, .logo-area[data-page]").forEach((item) => {
        const dataPage = item.getAttribute("data-page");
        if (!dataPage) return;
        const target = normalizeMenuTarget(dataPage);
        const isActive = target === normalized;
        item.classList.toggle("active", isActive);
    });
}

function navigateTo(pageFile) {
    if (typeof toggleMobileSidebar === "function") {
        toggleMobileSidebar(true); 
    }
    const pageKey = normalizePageKey(pageFile);
    if (isSpa()) {
        loadPage(pageKey);
        return;
    }
    changePage(pageKey);
}

function attachNavEvents() {
    document.addEventListener("click", (e) => {
        const mobileToggleBtn = e.target.closest("#mobileSidebarToggle, .mobile-toggle-btn");
        if (mobileToggleBtn) {
            e.preventDefault();
            toggleMobileSidebar();
            return;
        }

        const item = e.target.closest(".nav-item, .logo-area[data-page], .profile-link[data-page]");
        if (!item) return;
        const pageFile = getPageFileFromItem(item);
        if (!pageFile) return;
        e.preventDefault();
        navigateTo(pageFile);
    });

    const searchInput = document.querySelector("#navbar-container #searchInput");
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener("keypress", function (e) {
            if (e.key === "Enter") {
                alert("Searching for: " + this.value);
            }
        });
    }
}

function changePage(pageName) {
    window.location.href = resolveAdminPath(pageMap(pageName));
}

// ==========================================
// PROFILE MODAL & NAVBAR AUTO-LOADER
// ==========================================
async function loadNavbarProfileModal() {
    try {
        let client = window.supabaseClient;
        if (!client && typeof supabase !== 'undefined') {
            client = supabase.createClient(
                'https://uforealazougjckepggc.supabase.co',
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0'
            );
            window.supabaseClient = client;
        }
        if (!client) return;

        const { data: sessionData } = await client.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) return;

        const { data: profile } = await client
            .from('admin_profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        const meta = user.user_metadata || {};
        const firstName = profile?.first_name || meta.first_name || 'Admin';
        const lastName = profile?.last_name || meta.last_name || 'User';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        const role = profile?.role || meta.role || 'Administrator';
        const department = profile?.department || meta.department || 'BSIT';
        const avatarUrl = profile?.avatar_url || meta.avatar_url || '';

        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setTxt('profileName', fullName);
        setTxt('profileRole', role);
        setTxt('profileDepartment', department);
        setTxt('profileRoleDetail', role);

        // Pag-display sa Profile Picture sa Modal Header
        const avatarImg = document.getElementById('profileModalAvatar');
        const fallbackIcon = document.getElementById('profileModalFallbackIcon');

        if (avatarImg && fallbackIcon) {
            if (avatarUrl && avatarUrl.trim() !== '') {
                avatarImg.src = avatarUrl;
                avatarImg.classList.remove('hidden');
                fallbackIcon.style.display = 'none';
            } else {
                avatarImg.classList.add('hidden');
                fallbackIcon.style.display = 'block';
            }
        }
    } catch (err) {
        console.error("Navbar profile load error:", err);
    }
}

function toggleProfileModal() {
    const modal = document.getElementById("profileModal");
    const backdrop = document.getElementById("profileBackdrop");
    if (!modal || !backdrop) return;
    modal.classList.toggle("show");
    backdrop.classList.toggle("show");
    if (modal.classList.contains("show")) {
        loadNavbarProfileModal();
    }
}
window.toggleProfileModal = toggleProfileModal;

function mountNavPart(sourceNode, containerId, appendToBody) {
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

async function loadAdminNavigation() {
    try {
        const candidateUrls = ["/nav.html", "../nav.html", "nav.html"];
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
            throw new Error("Unable to fetch nav.html from candidate paths");
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        if (!document.querySelector('link[data-citeflow="fontawesome"]') && !document.querySelector('link[href*="font-awesome"]') && !document.querySelector('link[href*="fontawesome"]')) {
            const fa = document.createElement('link');
            fa.rel = 'stylesheet';
            fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            fa.setAttribute('data-citeflow', 'fontawesome');
            document.head.appendChild(fa);
        }

        if (!document.querySelector('link[data-citeflow="navcss"]') && !document.querySelector('link[href*="nav.css"]')) {
            const navCss = document.createElement('link');
            navCss.rel = 'stylesheet';
            navCss.href = isInAdminFolder() ? '../nav.css' : 'nav.css';
            navCss.setAttribute('data-citeflow', 'navcss');
            document.head.appendChild(navCss);
        }

        mountNavPart(doc.querySelector("aside.sidebar"), "sidebar-container");
        mountNavPart(doc.querySelector("nav.navbar"), "navbar-container");
        mountNavPart(doc.getElementById("profileBackdrop"), null, true);
        mountNavPart(doc.getElementById("profileModal"), null, true);
        mountNavPart(doc.querySelector(".message-btn"), "message-container", true);

        mountNavPart(doc.getElementById("msgrBackdrop"), null, true);
        mountNavPart(doc.getElementById("msgrDropdown"), null, true);
        mountNavPart(doc.getElementById("msgrPanel"), null, true);
        mountNavPart(doc.getElementById("msgrExpanded"), null, true);
        mountNavPart(doc.getElementById("msgrNewModal"), null, true);
        mountNavPart(doc.getElementById("msgrArchivedModal"), null, true);

        attachNavEvents();
        updateActiveMenu(getCurrentPageFile());
        loadNavbarProfileModal();

        if (window.CiteFlowMessenger && typeof window.CiteFlowMessenger.init === 'function') {
            window.CiteFlowMessenger.init();
        } else {
            const isSubfolder = isInAdminFolder();
            const msgrScript = document.createElement("script");
            msgrScript.src = isSubfolder ? "../shared/messenger.js" : "shared/messenger.js";
            msgrScript.onload = () => {
                window.CiteFlowMessenger?.init();
            };
            document.head.appendChild(msgrScript);
        }
    } catch (error) {
        console.error("Failed to load navigation:", error);
    }
}

async function loadSidebar() {
    return loadAdminNavigation();
}

window.loadSidebar = loadSidebar;
window.loadAdminNavigation = loadAdminNavigation;

document.addEventListener("click", (e) => {
    const modal = document.getElementById("profileModal");
    const backdrop = document.getElementById("profileBackdrop");
    if (!modal || !backdrop) return;
    const profileBtn = e.target.closest("[onclick='toggleProfileModal()']");
    if (modal.classList.contains("show") && !modal.contains(e.target) && !profileBtn) {
        modal.classList.remove("show");
        backdrop.classList.remove("show");
    }
});

window.addEventListener("load", async () => {
    if (!document.querySelector("aside.sidebar")) {
        await loadSidebar();
    }
    attachNavEvents();
    updateActiveMenu(getCurrentPageFile());
    loadNavbarProfileModal();
});

async function adminLogout() {
    try {
        if (window.CiteFlowAuth && typeof window.CiteFlowAuth.logout === "function") {
            await window.CiteFlowAuth.logout();
            return;
        }
        if (window.supabaseClient && window.supabaseClient.auth) {
            await window.supabaseClient.auth.signOut();
        }
    } catch (_) {}
    const isSub = window.location.pathname.toLowerCase().includes('/admin/') || window.location.pathname.toLowerCase().includes('/faculty/');
    window.location.href = isSub ? '../login.html' : 'login.html';
}
window.adminLogout = adminLogout;

window.openMessages = function() {
    if (window.CiteFlowMessenger) {
        window.CiteFlowMessenger.openMessages();
    }
};