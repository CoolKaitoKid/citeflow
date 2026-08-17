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

function navigateToFacultyPage(pageFile) {
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
        const item = e.target.closest(".sidebar .nav-item, .sidebar .logo-area[data-page], #facultyProfileModal .nav-item[data-page]");
        if (!item) return;
        const pageFile = item.getAttribute("data-page");
        if (!pageFile) return;
        e.preventDefault();
        navigateToFacultyPage(pageFile);
    });
}

async function loadFacultyNavigation() {
    try {
        const candidateUrls = ["faculty-nav.html", "/faculty/faculty-nav.html", "faculty/faculty-nav.html"];
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

        // Ensure CiteFlowMessenger is initialized
        if (window.CiteFlowMessenger && typeof window.CiteFlowMessenger.init === 'function') {
            window.CiteFlowMessenger.init();
        } else {
            // Load messenger.js dynamically if not already on the page
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

window.loadSidebar = loadFacultyNavigation;
window.loadFacultyNavigation = loadFacultyNavigation;
window.toggleFacultyProfileModal = toggleFacultyProfileModal;
window.facultyLogout = facultyLogout;

window.addEventListener("load", async () => {
    if (!document.querySelector("aside.sidebar")) {
        await loadFacultyNavigation();
    } else {
        updateFacultyActiveMenu(getFacultyCurrentPageFile());
        window.CiteFlowMessenger?.init();
    }
});
