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
    const parts = window.location.pathname.split("/");
    const current = parts[parts.length - 1] || "dashboard.html";
    return current.includes(".html") ? current : "dashboard.html";
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
    const pageKey = normalizePageKey(pageFile);
    if (isSpa()) {
        loadPage(pageKey);
        return;
    }
    changePage(pageKey);
}

function attachNavEvents() {
    document.addEventListener("click", (e) => {
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

function openMessages() {
    alert("Opening Messages");
}

function toggleProfileModal() {
    const modal = document.getElementById("profileModal");
    const backdrop = document.getElementById("profileBackdrop");
    if (!modal || !backdrop) return;
    modal.classList.toggle("show");
    backdrop.classList.toggle("show");
}

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
        const response = await fetch("../nav.html");
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        mountNavPart(doc.querySelector("aside.sidebar"), "sidebar-container");
        mountNavPart(doc.querySelector("nav.navbar"), "navbar-container");
        mountNavPart(doc.getElementById("profileBackdrop"), null, true);
        mountNavPart(doc.getElementById("profileModal"), null, true);
        mountNavPart(doc.querySelector(".message-btn"), "message-container", true);

        attachNavEvents();
        updateActiveMenu(getCurrentPageFile());
    } catch (error) {
        console.error("Failed to load navigation:", error);
    }
}

async function loadSidebar() {
    return loadAdminNavigation();
}

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

window.addEventListener("load", () => {
    attachNavEvents();
    updateActiveMenu(getCurrentPageFile());
});
