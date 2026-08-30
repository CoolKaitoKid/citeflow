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

function injectAdminNotifCss() {
    let style = document.getElementById("cite-admin-bell-css");
    if (!style) {
        style = document.createElement("style");
        style.id = "cite-admin-bell-css";
        document.head.appendChild(style);
    }
    style.textContent = `
      nav.navbar, .navbar, .nav-actions, #navbar-container { overflow: visible !important; }
      .nav-notif-wrap { position: relative; display: inline-flex; align-items: center; }
      .nav-notif-badge {
        position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
        padding: 0 4px; border-radius: 999px; background: #dc2626; color: #fff;
        font-size: 10px; font-weight: 700; display: none; align-items: center;
        justify-content: center; border: 2px solid var(--cite-theme, #621708); z-index: 2;
      }
      #adminNavNotifDropdown.nav-notif-dropdown {
        position: absolute !important; top: calc(100% + 10px) !important; right: 0 !important;
        width: 340px; max-width: calc(100vw - 24px); background: #fff !important;
        border: 1px solid #e5e7eb; border-radius: 12px;
        box-shadow: 0 10px 40px rgba(15, 23, 42, 0.14);
        display: none !important; z-index: 99999 !important; overflow: hidden;
      }
      #adminNavNotifDropdown.nav-notif-dropdown.open { display: block !important; }
      #adminNavNotifDropdown .nav-notif-header {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 16px; border-bottom: 1px solid #eee; color: #111;
        font-size: 14px; font-weight: 700;
      }
      #adminNavNotifDropdown .nav-notif-header button {
        border: 0; background: transparent; color: #621708; font-size: 12px;
        font-weight: 700; cursor: pointer;
      }
      #adminNavNotifDropdown .nav-notif-list {
        max-height: 380px; overflow-y: auto; padding: 4px 0;
      }
      #adminNavNotifDropdown .nav-notif-item {
        display: block; width: 100%; text-align: left; padding: 12px 16px;
        border: 0; border-radius: 0; background: transparent; color: #374151;
        font-size: 13px; line-height: 1.45; font-weight: 400; cursor: pointer;
      }
      #adminNavNotifDropdown .nav-notif-item.unread { background: #eff6ff; }
      #adminNavNotifDropdown .nav-notif-item small,
      #adminNavNotifDropdown .nav-notif-date {
        display: block; margin-top: 6px; color: #9ca3af; font-size: 12px; font-weight: 400;
      }
      #adminNavNotifDropdown .nav-notif-empty {
        padding: 24px 16px; text-align: center; color: #9ca3af; font-size: 13px; margin: 0;
      }
    `;
}

function findAdminBellButton() {
    if (document.getElementById("facultyNavNotifBtn")) return null;
    const wired = document.getElementById("adminNavNotifBtn");
    if (wired) return wired;
    const roots = [
        document.querySelector("nav.navbar"),
        document.querySelector(".navbar"),
        document.getElementById("navbar-container")
    ].filter(Boolean);
    for (const root of roots) {
        const icon = root.querySelector(".fa-bell, i[class*='fa-bell']");
        if (!icon) continue;
        const btn = icon.closest(".nav-btn, button, [onclick]");
        if (btn && !btn.querySelector(".fa-circle-user, .fa-user")) return btn;
    }
    return null;
}

function setAdminNotifOpen(open) {
    const panel = document.getElementById("adminNavNotifDropdown");
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.style.display = open ? "block" : "none";
}

function wireAdminNavbarBell() {
    if (document.getElementById("facultyNavNotifBtn")) return true;
    const btn = findAdminBellButton();
    if (!btn) return false;
    if (btn.dataset.citeWired === "5") return true;

    injectAdminNotifCss();

    let wrap = btn.closest(".nav-notif-wrap") || document.getElementById("adminNavNotifWrap");
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "adminNavNotifWrap";
        wrap.className = "nav-notif-wrap";
        btn.parentNode.insertBefore(wrap, btn);
        wrap.appendChild(btn);
    }

    const fresh = btn.cloneNode(true);
    fresh.removeAttribute("onclick");
    fresh.onclick = null;
    fresh.id = "adminNavNotifBtn";
    fresh.dataset.citeWired = "5";
    fresh.setAttribute("title", "Notifications");
    fresh.setAttribute("role", "button");
    btn.replaceWith(fresh);

    if (!wrap.querySelector("#adminNavNotifBadge")) {
        const badge = document.createElement("span");
        badge.id = "adminNavNotifBadge";
        badge.className = "nav-notif-badge";
        badge.setAttribute("data-notif-badge", "");
        badge.textContent = "0";
        badge.style.display = "none";
        wrap.appendChild(badge);
    }

    if (!wrap.querySelector("#adminNavNotifDropdown")) {
        wrap.insertAdjacentHTML("beforeend", `
          <div id="adminNavNotifDropdown" class="nav-notif-dropdown">
            <div class="nav-notif-header">
              <span>Notifications</span>
              <button type="button" id="cite-mark-all-read">Mark all read</button>
            </div>
            <div id="adminNavNotifList" class="nav-notif-list">
              <p class="nav-notif-empty">No notifications yet</p>
            </div>
          </div>
        `);
    }

    fresh.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const panel = document.getElementById("adminNavNotifDropdown");
        const willOpen = !(panel && panel.classList.contains("open"));
        setAdminNotifOpen(willOpen);
        if (willOpen && window.CalendarNotifications && typeof window.CalendarNotifications.refreshAdmin === "function") {
            window.CalendarNotifications.refreshAdmin();
        }
    });

    if (!document.documentElement.dataset.citeAdminBellOutside) {
        document.documentElement.dataset.citeAdminBellOutside = "1";
        document.addEventListener("click", (event) => {
            const wrapEl = document.getElementById("adminNavNotifWrap");
            const panel = document.getElementById("adminNavNotifDropdown");
            if (!panel || !panel.classList.contains("open")) return;
            if (wrapEl && wrapEl.contains(event.target)) return;
            setAdminNotifOpen(false);
        });
    }

    const markAll = document.getElementById("cite-mark-all-read");
    if (markAll && !markAll.dataset.bound) {
        markAll.dataset.bound = "1";
        markAll.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (window.CalendarNotifications && typeof window.CalendarNotifications.markAllRead === "function") {
                window.CalendarNotifications.markAllRead();
            }
        });
    }

    return true;
}

function watchAdminNavbarBell() {
    if (wireAdminNavbarBell()) return;
    if (document.documentElement.dataset.citeAdminBellWatch) return;
    document.documentElement.dataset.citeAdminBellWatch = "1";
    const obs = new MutationObserver(() => {
        if (wireAdminNavbarBell()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    [120, 400, 1000, 2000, 4000].forEach((ms) => {
        window.setTimeout(() => wireAdminNavbarBell(), ms);
    });
}

function ensureCalendarNotifications() {
    watchAdminNavbarBell();
    const start = () => {
        wireAdminNavbarBell();
        if (window.CalendarNotifications && typeof window.CalendarNotifications.startAdminListener === "function") {
            window.CalendarNotifications.startAdminListener();
        }
    };
    if (window.CalendarNotifications) {
        start();
        return;
    }
    const existing = document.querySelector('script[src*="calendar-notifications.js"]');
    if (existing) {
        window.setTimeout(start, 200);
        return;
    }
    const script = document.createElement("script");
    script.src = isInAdminFolder() ? "../shared/calendar-notifications.js" : "shared/calendar-notifications.js";
    script.onload = start;
    document.head.appendChild(script);
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

        const logoImg = document.querySelector(".logo-area img");
        if (logoImg) {
            const prefix = isInAdminFolder() ? "../" : "";
            logoImg.src = `${prefix}assets/ctu-logo.png`;
        }

        mountNavPart(doc.getElementById("msgrBackdrop"), null, true);
        mountNavPart(doc.getElementById("msgrDropdown"), null, true);
        mountNavPart(doc.getElementById("msgrPanel"), null, true);
        mountNavPart(doc.getElementById("msgrExpanded"), null, true);
        mountNavPart(doc.getElementById("msgrNewModal"), null, true);
        mountNavPart(doc.getElementById("msgrArchivedModal"), null, true);

        attachNavEvents();
        updateActiveMenu(getCurrentPageFile());
        loadNavbarProfileModal();
        ensureCalendarNotifications();

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
    ensureCalendarNotifications();
    watchAdminNavbarBell();
});

watchAdminNavbarBell();

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
