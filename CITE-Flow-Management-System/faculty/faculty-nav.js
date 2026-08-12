function getContent() {
    return document.getElementById("content");
}

function isSpa() {
    return Boolean(getContent());
}

function normalizePageKey(pageFile) {
    if (!pageFile) return "";
    return pageFile
        .replace(/^\.\.\//, "")
        .replace(/^faculty\//, "")
        .replace(/\.html$/, "");
}

function pageMap(pageName) {
    const key = normalizePageKey(pageName);
    return {
        dashboard: "dashboard.html",
        "faculty-profile": "faculty-profile.html",
        calendar: "calendar.html",
        document: "document.html",
        "status-tracking": "status-tracking.html",
        submissions: "submissions.html",
        "system-settings": "system-settings.html"
    }[key] || `${key}.html`;
}

function resolveFacultyPath(pageFile) {
    const mapped = pageMap(pageFile);
    return mapped.endsWith(".html") ? mapped : `${mapped}.html`;
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

    const fileName = resolveFacultyPath(pageMap(pageName));
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
        .replace(/^faculty\//, "")
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
    window.location.href = resolveFacultyPath(pageMap(pageName));
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

async function loadFacultyNavigation() {
    try {
        const response = await fetch("faculty-nav.html");
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        // Ensure Font Awesome is available for nav icons
        if (!document.querySelector('link[data-citeflow="fontawesome"]') && !document.querySelector('link[href*="font-awesome"]') && !document.querySelector('link[href*="fontawesome"]')) {
            const fa = document.createElement('link');
            fa.rel = 'stylesheet';
            fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            fa.setAttribute('data-citeflow', 'fontawesome');
            document.head.appendChild(fa);
        }

        // Ensure faculty-nav.css is loaded when not present in the page head
        if (!document.querySelector('link[data-citeflow="navcss"]') && !document.querySelector('link[href*="faculty-nav.css"]')) {
            const navCss = document.createElement('link');
            navCss.rel = 'stylesheet';
            navCss.href = 'faculty-nav.css';
            navCss.setAttribute('data-citeflow', 'navcss');
            document.head.appendChild(navCss);
        }

        mountNavPart(doc.querySelector("aside.sidebar"), "sidebar-container");
        mountNavPart(doc.querySelector("nav.navbar"), "navbar-container");
        mountNavPart(doc.getElementById("profileBackdrop"), null, true);
        mountNavPart(doc.getElementById("profileModal"), null, true);
        mountNavPart(doc.querySelector(".message-btn"), "message-container", true);

        // Messenger panel — mounted the same way as the profile modal
        mountNavPart(doc.getElementById("msgrBackdrop"), null, true);
        mountNavPart(doc.getElementById("msgrPanel"), null, true);
        mountNavPart(doc.getElementById("msgrNewModal"), null, true);

        attachNavEvents();
        updateActiveMenu(getCurrentPageFile());

        await initMessenger();
    } catch (error) {
        console.error("Failed to load navigation:", error);
    }
}

async function loadSidebar() {
    return loadFacultyNavigation();
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

/* =========================================================
   CITE-Flow Messenger (faculty side)
   =========================================================
   Same wiring assumptions as the admin nav.js version:

   1. A Supabase client already exists on the page, e.g.
      `const supabaseClient = createClient(...)`, loaded
      before this file. Looked up under window.supabaseClient,
      then window.supabase, then window._supabase.

   2. People live in the `public.directory` view (created by
      messenger-schema.sql), which unions faculty + admin into:
      auth_user_id, display_name, email, avatar_url, role.

   3. The logged-in user's id is auth.users.id (Supabase Auth).

   Faculty pages sit flat (no /admin/-style subfolder), so
   unlike the admin version this file does NOT prefix asset
   paths with "../" — messenger.html / messenger.css are
   expected right next to faculty-nav.html.
   ========================================================= */

const MSGR_CONFIG = {
    directoryView: "directory",
    partialUrl: "messenger.html",
    cssHref: "messenger.css"
};

function msgrGetClient() {
    return window.supabaseClient || window.supabase || window._supabase || null;
}

const MsgrState = {
    currentUserId: null,
    currentUserRow: null,
    conversations: [],          // [{id, is_group, name, other, lastMessage, unread}]
    activeConversationId: null,
    activeConversationMeta: null,
    directoryCache: [],         // full directory, loaded once, filtered client-side for search
    selectedNewUsers: [],       // user rows picked in the "new message" modal
    messageChannel: null,
    listChannel: null,
    shellReady: false,          // panel HTML injected + buttons wired (fast, rarely fails)
    dataReady: false            // auth + first conversation load attempted
};

/* ---------------------------------------------------------
   Bootstrapping
   ---------------------------------------------------------
   Opening the panel and loading its data are kept separate on
   purpose: the panel (and its Close button) must always work
   even if the Supabase queries below fail, so a setup problem
   never leaves the user stuck with a panel they can't dismiss.
   --------------------------------------------------------- */

async function ensureMessengerShell() {
    if (MsgrState.shellReady) return;
    ensureMessengerCss();
    await injectMessengerPanel();
    wireMessengerEvents();
    MsgrState.shellReady = true;
}

async function loadMessengerData() {
    const sb = msgrGetClient();
    try {
        if (!sb) {
            throw new Error("No Supabase client found (checked window.supabaseClient / window.supabase / window._supabase).");
        }

        if (!MsgrState.currentUserId) {
            const { data: authData, error: authError } = await sb.auth.getUser();
            if (authError || !authData?.user) {
                throw authError || new Error("Could not resolve the current user — are they signed in?");
            }
            MsgrState.currentUserId = authData.user.id;

            const { data: myRow } = await sb
                .from(MSGR_CONFIG.directoryView)
                .select("*")
                .eq("auth_user_id", MsgrState.currentUserId)
                .maybeSingle();
            MsgrState.currentUserRow = myRow || null;
        }

        await loadConversations();

        if (!MsgrState.dataReady) {
            subscribeToInbox();
        }
        MsgrState.dataReady = true;
    } catch (err) {
        console.error("Messenger: setup failed —", err);
        showListError(err);
    }
}

function showListError(err) {
    const listEl = document.getElementById("msgrList");
    if (!listEl) return;
    listEl.innerHTML = `
        <div class="msgr-empty">
            <i class="fa-solid fa-triangle-exclamation"></i>
            Couldn't load messages. Open the browser console for details —
            most likely messenger-schema.sql hasn't been run in Supabase yet,
            or the person isn't signed in.
        </div>`;
}

function ensureMessengerCss() {
    if (document.querySelector('link[data-citeflow="messengercss"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = MSGR_CONFIG.cssHref;
    link.setAttribute("data-citeflow", "messengercss");
    document.head.appendChild(link);
}

async function injectMessengerPanel() {
    if (document.getElementById("msgrPanel")) return;
    try {
        const res = await fetch(MSGR_CONFIG.partialUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
    } catch (err) {
        console.error("Messenger: failed to load messenger.html", err);
    }
}

/* ---------------------------------------------------------
   Event wiring
   --------------------------------------------------------- */

function wireMessengerEvents() {
    document.getElementById("msgrCloseBtn")?.addEventListener("click", closeMessengerPanel);
    document.getElementById("msgrBackdrop")?.addEventListener("click", closeMessengerPanel);
    document.getElementById("msgrBackBtn")?.addEventListener("click", closeActiveConversation);

    document.getElementById("msgrConvoSearch")?.addEventListener("input", (e) => {
        renderConversationList(e.target.value.trim().toLowerCase());
    });

    document.getElementById("msgrNewBtn")?.addEventListener("click", openNewConversationModal);
    document.getElementById("msgrNewCloseBtn")?.addEventListener("click", closeNewConversationModal);
    document.getElementById("msgrNewModal")?.addEventListener("click", (e) => {
        if (e.target.id === "msgrNewModal") closeNewConversationModal();
    });

    document.getElementById("msgrUserSearch")?.addEventListener("input", (e) => {
        renderUserResults(e.target.value.trim().toLowerCase());
    });

    document.getElementById("msgrCreateBtn")?.addEventListener("click", createConversation);

    const input = document.getElementById("msgrInput");
    input?.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 90) + "px";
        document.getElementById("msgrSendBtn").disabled = input.value.trim().length === 0;
    });
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById("msgrSendBtn")?.addEventListener("click", sendMessage);
}

function openMessengerPanel() {
    document.getElementById("msgrPanel")?.classList.add("show");
    document.getElementById("msgrBackdrop")?.classList.add("show");
}

function closeMessengerPanel() {
    document.getElementById("msgrPanel")?.classList.remove("show");
    document.getElementById("msgrBackdrop")?.classList.remove("show");
    closeActiveConversation();
}

/* Called by the floating message button (replaces the old alert()) */
async function openMessages() {
    await ensureMessengerShell();   // panel + Close button — always works
    openMessengerPanel();
    loadMessengerData();            // conversations — can fail without breaking the panel
}

/* ---------------------------------------------------------
   Conversation list
   --------------------------------------------------------- */

async function loadConversations() {
    const sb = msgrGetClient();

    const { data: rows, error } = await sb
        .from("conversation_participants")
        .select("conversation_id, conversations(id, is_group, name, created_at)")
        .eq("user_id", MsgrState.currentUserId);

    if (error) {
        console.error("Messenger: failed to load conversations", error);
        throw error;
    }

    const conversations = (rows || [])
        .map((r) => r.conversations)
        .filter(Boolean);

    const enriched = await Promise.all(conversations.map(enrichConversation));
    enriched.sort((a, b) => new Date(b.sortTime) - new Date(a.sortTime));
    MsgrState.conversations = enriched;
    renderConversationList("");
}

async function enrichConversation(conv) {
    const sb = msgrGetClient();

    // Views like `directory` don't have FK relationships PostgREST can embed
    // automatically, so this is a two-step lookup: get the other member ids,
    // then fetch their directory rows separately.
    const { data: participantRows } = await sb
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conv.id);

    const otherIds = (participantRows || [])
        .map((p) => p.user_id)
        .filter((id) => id !== MsgrState.currentUserId);

    let others = [];
    if (otherIds.length > 0) {
        const { data: dirRows } = await sb
            .from(MSGR_CONFIG.directoryView)
            .select("auth_user_id, display_name, avatar_url, role")
            .in("auth_user_id", otherIds);
        others = dirRows || [];
    }

    const { data: lastMsgRows } = await sb
        .from("messages")
        .select("content, created_at, sender_id")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1);

    const lastMessage = lastMsgRows?.[0] || null;

    const { data: myParticipant } = await sb
        .from("conversation_participants")
        .select("last_read_at")
        .eq("conversation_id", conv.id)
        .eq("user_id", MsgrState.currentUserId)
        .maybeSingle();

    const unread = Boolean(
        lastMessage &&
        lastMessage.sender_id !== MsgrState.currentUserId &&
        (!myParticipant?.last_read_at || new Date(lastMessage.created_at) > new Date(myParticipant.last_read_at))
    );

    const displayName = conv.is_group
        ? (conv.name || others.map((o) => firstNameOf(o.display_name)).join(", "))
        : (others[0]?.display_name || "Unknown user");

    return {
        ...conv,
        others,
        lastMessage,
        unread,
        displayName,
        sortTime: lastMessage?.created_at || conv.created_at
    };
}

function firstNameOf(fullName) {
    if (!fullName) return "Unknown";
    return fullName.split(" ")[0];
}

function initialsOf(fullName) {
    if (!fullName) return "?";
    const parts = fullName.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function renderConversationList(filter) {
    const listEl = document.getElementById("msgrList");
    if (!listEl) return;

    const items = MsgrState.conversations.filter((c) =>
        !filter || c.displayName.toLowerCase().includes(filter)
    );

    if (items.length === 0) {
        listEl.innerHTML = `
            <div class="msgr-empty">
                <i class="fa-regular fa-comments"></i>
                ${MsgrState.conversations.length === 0
                    ? "No conversations yet. Tap the compose icon to start one."
                    : "No conversations match your search."}
            </div>`;
        return;
    }

    listEl.innerHTML = items.map((c) => {
        const avatarHtml = renderAvatar(c.is_group ? null : c.others[0]?.avatar_url, c.displayName, c.is_group);
        const preview = c.lastMessage
            ? (c.lastMessage.sender_id === MsgrState.currentUserId ? "You: " : "") + escapeHtml(c.lastMessage.content)
            : "No messages yet";
        const time = c.lastMessage ? formatTime(c.lastMessage.created_at) : "";

        return `
            <div class="msgr-convo${MsgrState.activeConversationId === c.id ? " active" : ""}" data-conversation-id="${c.id}">
                ${avatarHtml}
                <div class="msgr-convo-info">
                    <div class="msgr-convo-name">${escapeHtml(c.displayName)}</div>
                    <div class="msgr-convo-preview${c.unread ? " unread" : ""}">${preview}</div>
                </div>
                <div class="msgr-convo-meta">
                    <div class="msgr-convo-time">${time}</div>
                    ${c.unread ? '<div class="msgr-unread-dot"></div>' : ""}
                </div>
            </div>`;
    }).join("");

    listEl.querySelectorAll(".msgr-convo").forEach((el) => {
        el.addEventListener("click", () => {
            const conv = MsgrState.conversations.find((c) => c.id === el.dataset.conversationId);
            if (conv) openConversation(conv);
        });
    });
}

function renderAvatar(url, name, isGroup) {
    const cls = "msgr-avatar" + (isGroup ? " group" : "");
    if (url) {
        return `<div class="${cls}"><img src="${url}" alt=""></div>`;
    }
    if (isGroup) {
        return `<div class="${cls}"><i class="fa-solid fa-user-group"></i></div>`;
    }
    return `<div class="${cls}">${initialsOf(name)}</div>`;
}

/* ---------------------------------------------------------
   Active conversation / messages
   --------------------------------------------------------- */

async function openConversation(conv) {
    MsgrState.activeConversationId = conv.id;
    MsgrState.activeConversationMeta = conv;

    document.getElementById("msgrChatName").textContent = conv.displayName;
    document.getElementById("msgrChatSub").textContent = conv.is_group
        ? `${conv.others.length + 1} members`
        : (conv.others[0]?.role ? capitalize(conv.others[0].role) : "");
    document.getElementById("msgrChatAvatar").outerHTML = renderAvatar(
        conv.is_group ? null : conv.others[0]?.avatar_url,
        conv.displayName,
        conv.is_group
    ).replace('class="msgr-avatar', 'id="msgrChatAvatar" class="msgr-avatar');

    document.getElementById("msgrChat")?.classList.add("show");
    renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");

    await loadMessages(conv.id);
    await markConversationRead(conv.id);
    subscribeToActiveConversation(conv.id);
}

function closeActiveConversation() {
    document.getElementById("msgrChat")?.classList.remove("show");
    MsgrState.activeConversationId = null;
    MsgrState.activeConversationMeta = null;
    if (MsgrState.messageChannel) {
        msgrGetClient()?.removeChannel(MsgrState.messageChannel);
        MsgrState.messageChannel = null;
    }
}

async function loadMessages(conversationId) {
    const sb = msgrGetClient();
    const { data, error } = await sb
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);

    if (error) {
        console.error("Messenger: failed to load messages", error);
        return;
    }
    renderMessages(data || []);
}

function renderMessages(messages) {
    const el = document.getElementById("msgrMessages");
    if (!el) return;

    const isGroup = MsgrState.activeConversationMeta?.is_group;
    const others = MsgrState.activeConversationMeta?.others || [];

    el.innerHTML = messages.map((m) => {
        const mine = m.sender_id === MsgrState.currentUserId;
        const senderName = mine
            ? null
            : (others.find((o) => o.auth_user_id === m.sender_id)?.display_name || "Member");

        return `
            <div class="msgr-bubble-row ${mine ? "mine" : "theirs"}">
                ${isGroup && !mine ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ""}
                <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
            </div>`;
    }).join("");

    el.scrollTop = el.scrollHeight;
}

async function markConversationRead(conversationId) {
    const sb = msgrGetClient();
    await sb
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", MsgrState.currentUserId);

    const conv = MsgrState.conversations.find((c) => c.id === conversationId);
    if (conv) conv.unread = false;
    updateUnreadBadge();
}

async function sendMessage() {
    const input = document.getElementById("msgrInput");
    const content = input?.value.trim();
    if (!content || !MsgrState.activeConversationId) return;

    const sb = msgrGetClient();
    input.value = "";
    input.style.height = "auto";
    document.getElementById("msgrSendBtn").disabled = true;

    const { error } = await sb.from("messages").insert({
        conversation_id: MsgrState.activeConversationId,
        sender_id: MsgrState.currentUserId,
        content
    });

    if (error) {
        console.error("Messenger: failed to send message", error);
        input.value = content; // give it back so nothing's lost
    }
}

/* ---------------------------------------------------------
   Realtime
   --------------------------------------------------------- */

function subscribeToActiveConversation(conversationId) {
    const sb = msgrGetClient();
    if (MsgrState.messageChannel) {
        sb.removeChannel(MsgrState.messageChannel);
    }

    MsgrState.messageChannel = sb
        .channel(`msgr-conversation-${conversationId}`)
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
            async (payload) => {
                await loadMessages(conversationId);
                if (payload.new.sender_id !== MsgrState.currentUserId) {
                    await markConversationRead(conversationId);
                }
            }
        )
        .subscribe();
}

function subscribeToInbox() {
    const sb = msgrGetClient();
    if (MsgrState.listChannel) sb.removeChannel(MsgrState.listChannel);

    MsgrState.listChannel = sb
        .channel("msgr-inbox")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            async (payload) => {
                const inThisConvo = MsgrState.conversations.some((c) => c.id === payload.new.conversation_id);
                if (!inThisConvo) return; // message in a conversation we're not part of, ignore
                await loadConversations();
                updateUnreadBadge();
            }
        )
        .subscribe();
}

function updateUnreadBadge() {
    const count = MsgrState.conversations.filter((c) => c.unread).length;
    const btn = document.querySelector(".message-btn");
    if (!btn) return;
    let badge = btn.querySelector(".msgr-fab-badge");
    if (count === 0) {
        badge?.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement("div");
        badge.className = "msgr-fab-badge";
        btn.appendChild(badge);
    }
    badge.textContent = count > 9 ? "9+" : String(count);
}

/* ---------------------------------------------------------
   New conversation / new group
   --------------------------------------------------------- */

async function openNewConversationModal() {
    MsgrState.selectedNewUsers = [];
    document.getElementById("msgrUserSearch").value = "";
    document.getElementById("msgrGroupNameInput").value = "";
    document.getElementById("msgrGroupNameField")?.classList.remove("show");
    document.getElementById("msgrNewModal")?.classList.add("show");
    updateCreateButtonState();

    if (MsgrState.directoryCache.length === 0) {
        const sb = msgrGetClient();
        const { data, error } = await sb
            .from(MSGR_CONFIG.directoryView)
            .select("auth_user_id, display_name, email, avatar_url, role")
            .neq("auth_user_id", MsgrState.currentUserId)
            .order("display_name");
        if (error) {
            console.error("Messenger: failed to load directory", error);
        }
        MsgrState.directoryCache = data || [];
    }
    renderUserResults("");
}

function closeNewConversationModal() {
    document.getElementById("msgrNewModal")?.classList.remove("show");
}

function renderUserResults(filter) {
    const el = document.getElementById("msgrUserResults");
    if (!el) return;

    const items = MsgrState.directoryCache.filter((u) =>
        !filter ||
        u.display_name?.toLowerCase().includes(filter) ||
        u.email?.toLowerCase().includes(filter)
    );

    if (items.length === 0) {
        el.innerHTML = `<div class="msgr-empty">No matches.</div>`;
        return;
    }

    el.innerHTML = items.map((u) => {
        const checked = MsgrState.selectedNewUsers.some((s) => s.auth_user_id === u.auth_user_id);
        return `
            <label class="msgr-user-row">
                <input type="checkbox" data-uid="${u.auth_user_id}" ${checked ? "checked" : ""}>
                ${renderAvatar(u.avatar_url, u.display_name, false)}
                <div class="msgr-user-row-info">
                    <div class="name">${escapeHtml(u.display_name || u.email)}</div>
                    <div class="role">${capitalize(u.role || "")}</div>
                </div>
            </label>`;
    }).join("");

    el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", () => {
            const uid = cb.dataset.uid;
            const user = MsgrState.directoryCache.find((u) => u.auth_user_id === uid);
            if (cb.checked) {
                if (!MsgrState.selectedNewUsers.some((s) => s.auth_user_id === uid)) {
                    MsgrState.selectedNewUsers.push(user);
                }
            } else {
                MsgrState.selectedNewUsers = MsgrState.selectedNewUsers.filter((s) => s.auth_user_id !== uid);
            }
            document.getElementById("msgrGroupNameField")?.classList.toggle("show", MsgrState.selectedNewUsers.length > 1);
            updateCreateButtonState();
        });
    });
}

function updateCreateButtonState() {
    const btn = document.getElementById("msgrCreateBtn");
    if (!btn) return;
    btn.disabled = MsgrState.selectedNewUsers.length === 0;
    document.getElementById("msgrNewHint").textContent =
        MsgrState.selectedNewUsers.length > 1
            ? "Starting a group chat — give it a name below."
            : "Pick one person to message, or a few to start a group.";
}

async function createConversation() {
    if (MsgrState.selectedNewUsers.length === 0) return;
    const sb = msgrGetClient();
    const isGroup = MsgrState.selectedNewUsers.length > 1;
    const groupName = document.getElementById("msgrGroupNameInput")?.value.trim();

    // Reuse an existing 1:1 conversation instead of creating a duplicate
    if (!isGroup) {
        const existing = MsgrState.conversations.find(
            (c) => !c.is_group && c.others[0]?.auth_user_id === MsgrState.selectedNewUsers[0].auth_user_id
        );
        if (existing) {
            closeNewConversationModal();
            openConversation(existing);
            openMessengerPanel();
            return;
        }
    }

    const { data: conv, error: convError } = await sb
        .from("conversations")
        .insert({
            is_group: isGroup,
            name: isGroup ? (groupName || null) : null,
            created_by: MsgrState.currentUserId
        })
        .select()
        .single();

    if (convError || !conv) {
        console.error("Messenger: failed to create conversation", convError);
        return;
    }

    const participantRows = [
        { conversation_id: conv.id, user_id: MsgrState.currentUserId },
        ...MsgrState.selectedNewUsers.map((u) => ({ conversation_id: conv.id, user_id: u.auth_user_id }))
    ];

    const { error: partError } = await sb.from("conversation_participants").insert(participantRows);
    if (partError) {
        console.error("Messenger: failed to add participants", partError);
        return;
    }

    closeNewConversationModal();
    await loadConversations();
    const created = MsgrState.conversations.find((c) => c.id === conv.id);
    if (created) openConversation(created);
    openMessengerPanel();
}

/* ---------------------------------------------------------
   Small utilities
   --------------------------------------------------------- */

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function formatTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

/* initMessenger is called once loadFacultyNavigation() finishes
   mounting the nav — it just wires up the FAB badge state so an
   unread count is visible even before the panel is opened. */
async function initMessenger() {
    // Nothing to preload eagerly; conversations load lazily when
    // the user actually opens the panel via openMessages().
}