// ==============================================================================
// CITE-Flow Universal Messenger Engine (Production-Ready Edition)
// Works seamlessly on Admin and Faculty portals with real-time Supabase sync
// ==============================================================================

window.CiteFlowMessenger = (function () {

    // Helper: get user-scoped localStorage key
    function scopedKey(base, userId) {
        return userId ? `${base}_${userId}` : base;
    }

    function getConvoSearchFilter() {
        const el = document.getElementById("msgrConvoSearch");
        return (el && typeof el.value === 'string' ? el.value : '').trim().toLowerCase();
    }

    const State = {
        currentUserId: null,
        currentUserEmail: null,
        currentUserRole: null,
        currentUserName: null,
        currentUserAvatar: null,
        conversations: [],
        activeConversationId: null,
        activeConversationMeta: null,
        activeConversationParticipants: [],
        _currentActiveMessages: [],
        directoryCache: [],
        userResolutionCache: new Map(),
        selectedNewUsers: [],
        messageChannel: null,
        inboxChannel: null,
        presenceChannel: null,
        onlineUserIds: new Set(),
        inboxPollingTimer: null,
        reconnectTimer: null,
        isReconnecting: false,
        mounted: false,
        initialized: false,
        activeFilter: "all",
        isExpanded: false,
        openDropdownId: null,
        isLoadingConvos: false,
        isLoadingMessages: false,
        globalEventsBound: false,
        _lifecycleBound: false,
        // Typing indicator tracking
        isTypingLocally: false,
        localTypingTimer: null,
        remoteTypingTimers: new Map(),
        // User-scoped sets
        pinnedConvoIds: new Set(),
        archivedConvoIds: new Set(),
        manuallyUnreadConvoIds: new Set(),
        mutedConvoIds: new Set(),
        deletedConvoIds: new Set(),
        _lastRenderedMsgSig: null,
        _lastExpRenderedMsgSig: null,
        _participantsChanged: false
    };

    /** Load per-user state from localStorage after user ID is known */
    function loadUserScopedState() {
        const uid = State.currentUserId;
        if (!uid) {
            State.pinnedConvoIds = new Set();
            State.archivedConvoIds = new Set();
            State.manuallyUnreadConvoIds = new Set();
            State.mutedConvoIds = new Set();
            State.deletedConvoIds = new Set();
            return;
        }
        try {
            State.pinnedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_pinned_convos', uid)) || '[]'));
            State.archivedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_archived_convos', uid)) || '[]'));
            State.manuallyUnreadConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_unread_convos', uid)) || '[]'));
            State.mutedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_muted_convos', uid)) || '[]'));
            State.deletedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_deleted_convos', uid)) || '[]'));
        } catch (_) {
            State.pinnedConvoIds = new Set();
            State.archivedConvoIds = new Set();
            State.manuallyUnreadConvoIds = new Set();
            State.mutedConvoIds = new Set();
            State.deletedConvoIds = new Set();
        }
    }

    function savePinnedState() {
        if (!State.currentUserId) return;
        localStorage.setItem(scopedKey('citeflow_pinned_convos', State.currentUserId), JSON.stringify(Array.from(State.pinnedConvoIds)));
    }
    function saveArchivedState() {
        if (!State.currentUserId) return;
        localStorage.setItem(scopedKey('citeflow_archived_convos', State.currentUserId), JSON.stringify(Array.from(State.archivedConvoIds)));
    }
    function saveUnreadState() {
        if (!State.currentUserId) return;
        localStorage.setItem(scopedKey('citeflow_unread_convos', State.currentUserId), JSON.stringify(Array.from(State.manuallyUnreadConvoIds)));
    }
    function saveMutedState() {
        if (!State.currentUserId) return;
        localStorage.setItem(scopedKey('citeflow_muted_convos', State.currentUserId), JSON.stringify(Array.from(State.mutedConvoIds)));
    }
    function saveDeletedState() {
        if (!State.currentUserId) return;
        localStorage.setItem(scopedKey('citeflow_deleted_convos', State.currentUserId), JSON.stringify(Array.from(State.deletedConvoIds)));
    }

    function saveConvoMeta(convoId, meta) {
        if (!State.currentUserId || !convoId) return;
        try {
            const key = scopedKey('citeflow_convo_metas', State.currentUserId);
            const saved = JSON.parse(localStorage.getItem(key) || '{}');
            saved[convoId] = Object.assign(saved[convoId] || {}, meta);
            localStorage.setItem(key, JSON.stringify(saved));
        } catch (_) {}
    }

    function getConvoMeta(convoId) {
        if (!State.currentUserId || !convoId) return null;
        try {
            const key = scopedKey('citeflow_convo_metas', State.currentUserId);
            const saved = JSON.parse(localStorage.getItem(key) || '{}');
            return saved[convoId] || null;
        } catch (_) { return null; }
    }

    const DEFAULT_SUPABASE_URL = 'https://uforealazougjckepggc.supabase.co';
    const DEFAULT_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

    function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (window.CiteFlowAuth && typeof window.CiteFlowAuth.getClient === 'function') {
            const client = window.CiteFlowAuth.getClient();
            if (client) {
                window.supabaseClient = client;
                return client;
            }
        }
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            const url = window.__SUPABASE_URL__ || DEFAULT_SUPABASE_URL;
            const key = window.__SUPABASE_ANON__ || DEFAULT_SUPABASE_ANON;
            window.supabaseClient = window.supabase.createClient(url, key, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            });
            return window.supabaseClient;
        }
        return null;
    }

    /**
     * Toast notification system
     */
    function showCustomToast(message, duration = 3000) {
        if (!message) return;
        let toast = document.getElementById("citeflowGlobalToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "citeflowGlobalToast";
            toast.className = "citeflow-toast";
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> <span>${escapeHtml(message)}</span>`;
        toast.classList.add("show");
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove("show");
        }, duration);
    }

    /**
     * Professional custom Modal dialog system replacing native alert/confirm/prompt
     */
    function createModalDOM() {
        if (document.getElementById("citeflowModalOverlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "citeflowModalOverlay";
        overlay.className = "citeflow-modal-overlay";
        overlay.innerHTML = `
            <div class="citeflow-modal-card">
                <div class="citeflow-modal-header">
                    <div class="citeflow-modal-icon" id="citeflowModalIcon">
                        <i class="fa-solid fa-circle-info"></i>
                    </div>
                    <h3 id="citeflowModalTitle" class="citeflow-modal-title">CITE-Flow</h3>
                </div>
                <div class="citeflow-modal-body">
                    <p id="citeflowModalMessage" class="citeflow-modal-message"></p>
                    <input type="text" id="citeflowModalInput" class="citeflow-modal-input" style="display:none;" />
                </div>
                <div class="citeflow-modal-footer">
                    <button type="button" id="citeflowModalCancelBtn" class="citeflow-modal-btn citeflow-modal-cancel">Cancel</button>
                    <button type="button" id="citeflowModalConfirmBtn" class="citeflow-modal-btn citeflow-modal-confirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    function showModalDialog(options) {
        return new Promise((resolve) => {
            createModalDOM();
            const overlay = document.getElementById("citeflowModalOverlay");
            const iconEl = document.getElementById("citeflowModalIcon");
            const titleEl = document.getElementById("citeflowModalTitle");
            const messageEl = document.getElementById("citeflowModalMessage");
            const inputEl = document.getElementById("citeflowModalInput");
            const cancelBtn = document.getElementById("citeflowModalCancelBtn");
            const confirmBtn = document.getElementById("citeflowModalConfirmBtn");

            const type = options.type || "alert";
            titleEl.textContent = options.title || "CITE-Flow System";
            messageEl.textContent = options.message || "";

            if (options.isDanger) {
                iconEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
                iconEl.className = "citeflow-modal-icon danger";
            } else if (type === "prompt") {
                iconEl.innerHTML = `<i class="fa-solid fa-pen-to-square"></i>`;
                iconEl.className = "citeflow-modal-icon info";
            } else if (type === "confirm") {
                iconEl.innerHTML = `<i class="fa-solid fa-circle-question"></i>`;
                iconEl.className = "citeflow-modal-icon info";
            } else {
                iconEl.innerHTML = `<i class="fa-solid fa-circle-info"></i>`;
                iconEl.className = "citeflow-modal-icon info";
            }

            if (type === "prompt") {
                inputEl.style.display = "block";
                inputEl.value = options.defaultValue || "";
                inputEl.placeholder = options.placeholder || "Enter value...";
                setTimeout(() => {
                    inputEl.focus();
                    inputEl.select();
                }, 100);
            } else {
                inputEl.style.display = "none";
            }

            confirmBtn.textContent = options.confirmText || (type === "confirm" ? "Confirm" : "OK");
            confirmBtn.className = `citeflow-modal-btn citeflow-modal-confirm ${options.isDanger ? "danger" : ""}`;

            if (type === "alert") {
                cancelBtn.style.display = "none";
            } else {
                cancelBtn.style.display = "inline-flex";
                cancelBtn.textContent = options.cancelText || "Cancel";
            }

            function cleanup() {
                overlay.classList.remove("show");
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                inputEl.onkeyup = null;
            }

            confirmBtn.onclick = () => {
                cleanup();
                if (type === "prompt") resolve(inputEl.value.trim());
                else if (type === "confirm") resolve(true);
                else resolve(true);
            };

            cancelBtn.onclick = () => {
                cleanup();
                if (type === "prompt") resolve(null);
                else if (type === "confirm") resolve(false);
                else resolve(false);
            };

            if (type === "prompt") {
                inputEl.onkeyup = (e) => {
                    if (e.key === "Enter") confirmBtn.click();
                    if (e.key === "Escape") cancelBtn.click();
                };
            }

            overlay.classList.add("show");
        });
    }

    const CiteFlowModal = {
        alert: (message, title) => showModalDialog({ type: "alert", message, title }),
        confirm: (message, title, options = {}) => showModalDialog({ type: "confirm", message, title, ...options }),
        prompt: (message, defaultValue, title) => showModalDialog({ type: "prompt", message, defaultValue, title }),
        toast: (message, duration) => showCustomToast(message, duration)
    };

    window.CiteFlowModal = CiteFlowModal;

    /**
     * Clean name formatter helper (e.g. "juan.delacruz@ctu.edu.ph" -> "Juan Delacruz")
     */
    function formatNameFromEmail(email) {
        if (!email || typeof email !== 'string') return null;
        const prefix = email.split('@')[0] || '';
        const parts = prefix.replace(/[._\-+]/g, ' ').trim().split(/\s+/);
        if (parts.length === 0 || !parts[0]) return null;
        return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    }

    /**
     * User resolution helper: ensures name, avatar, and department are never generic placeholders
     */
    function resolveUserIdentity(rawUser, fallbackRole = null) {
        if (!rawUser) {
            return {
                id: 'unknown',
                auth_user_id: 'unknown',
                name: fallbackRole === 'Admin' ? 'Administrator' : 'Faculty Member',
                display_name: fallbackRole === 'Admin' ? 'Administrator' : 'Faculty Member',
                avatar_url: null,
                department: 'CITE',
                role: fallbackRole || 'User'
            };
        }

        // Check if string ID passed
        if (typeof rawUser === 'string') {
            const cached = State.userResolutionCache.get(rawUser) || State.userResolutionCache.get(rawUser.toLowerCase());
            if (cached) return cached;
            const fromDir = (State.directoryCache || []).find(d =>
                String(d.auth_user_id) === rawUser ||
                String(d.id) === rawUser ||
                (d.email && d.email.toLowerCase() === rawUser.toLowerCase())
            );
            if (fromDir) return fromDir;

            const nameFromMail = rawUser.includes('@') ? formatNameFromEmail(rawUser) : null;
            return {
                id: rawUser,
                auth_user_id: rawUser,
                name: nameFromMail || (rawUser.includes('admin') ? 'Administrator' : 'Faculty Member'),
                display_name: nameFromMail || (rawUser.includes('admin') ? 'Administrator' : 'Faculty Member'),
                email: rawUser.includes('@') ? rawUser : null,
                avatar_url: null,
                department: 'CITE',
                role: rawUser.includes('admin') ? 'Admin' : 'Faculty'
            };
        }

        // Raw object passed
        const email = (rawUser.email || '').trim().toLowerCase();
        let name = [rawUser.first_name, rawUser.last_name].filter(Boolean).join(' ').trim() ||
            rawUser.full_name ||
            rawUser.name ||
            rawUser.display_name;

        if (!name || name === 'Administrator' || name === 'Faculty Member') {
            const nameFromMail = formatNameFromEmail(email);
            if (nameFromMail) name = nameFromMail;
            else if (!name) {
                name = rawUser.role === 'Admin' || rawUser.role === 'Administrator' ? 'Administrator' : 'Faculty Member';
            }
        }

        const avatar = rawUser.avatar_url || rawUser.profile_photo_url || rawUser.photo_url || rawUser.profilePhotoUrl || null;
        const role = rawUser.role || (rawUser.position ? 'Faculty' : (email.includes('admin') ? 'Admin' : 'Faculty'));
        const dept = rawUser.department || (role === 'Admin' ? 'CITE Administration' : 'BSIT');

        const isGenericName = (n) => !n || n === 'Faculty Member' || n === 'Administrator' || n === 'User';

        const resolved = {
            id: rawUser.auth_user_id || rawUser.id || email || 'unknown',
            auth_user_id: rawUser.auth_user_id || (rawUser.id && String(rawUser.id).includes('-') ? rawUser.id : null),
            name: name,
            display_name: name,
            email: email || null,
            avatar_url: avatar,
            department: dept,
            role: role,
            position: rawUser.position || role
        };

        // Smart cache: don't overwrite real names with generic ones, but DO overwrite generic with real
        const cacheKeys = [
            resolved.id ? String(resolved.id) : null,
            resolved.auth_user_id ? String(resolved.auth_user_id) : null,
            resolved.email ? resolved.email.toLowerCase() : null
        ].filter(Boolean);

        for (const key of cacheKeys) {
            const existing = State.userResolutionCache.get(key);
            if (existing && !isGenericName(existing.name) && isGenericName(resolved.name)) {
                // Existing cache has a real name but new resolution is generic — merge instead
                if (avatar && !existing.avatar_url) existing.avatar_url = avatar;
                if (email && !existing.email) existing.email = email;
                if (dept && dept !== 'BSIT' && existing.department === 'BSIT') existing.department = dept;
                return existing;
            }
            State.userResolutionCache.set(key, resolved);
        }

        return resolved;
    }

    /**
     * Batch fetch participant identities across profiles, admin_profiles, and faculty.
     * Faculty table is the authoritative source for names and avatars.
     */
    async function batchFetchParticipants(userIds) {
        if (!Array.isArray(userIds) || userIds.length === 0) return [];
        const sb = getClient();
        if (!sb) return [];

        const cleanIds = Array.from(new Set(userIds.filter(id => id && String(id) !== 'unknown')));
        if (cleanIds.length === 0) return [];

        try {
            // Fetch from all three tables in parallel
            const [profilesRes, adminRes, facultyRes] = await Promise.all([
                sb.from('profiles').select('*').in('id', cleanIds),
                sb.from('admin_profiles').select('*').in('id', cleanIds),
                sb.from('faculty').select('*').in('auth_user_id', cleanIds)
            ]);

            // Build a map keyed by auth UUID, merging data from all sources
            const mergedMap = new Map();

            // 1. Process profiles first (lowest priority for names)
            if (Array.isArray(profilesRes?.data)) {
                for (const p of profilesRes.data) {
                    mergedMap.set(String(p.id), {
                        auth_user_id: p.id,
                        email: p.email,
                        first_name: p.first_name,
                        last_name: p.last_name,
                        role: p.role || 'Faculty'
                    });
                }
            }

            // 2. Process admin_profiles (overrides profiles for admins)
            if (Array.isArray(adminRes?.data)) {
                for (const a of adminRes.data) {
                    const existing = mergedMap.get(String(a.id)) || {};
                    const adminName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim();
                    mergedMap.set(String(a.id), {
                        ...existing,
                        auth_user_id: a.id,
                        first_name: a.first_name,
                        last_name: a.last_name,
                        name: adminName || existing.name,
                        email: a.email || existing.email,
                        avatar_url: existing.avatar_url || null,
                        department: 'CITE Administration',
                        role: 'Administrator'
                    });
                }
            }

            // 3. Process faculty LAST (highest priority — authoritative source)
            if (Array.isArray(facultyRes?.data)) {
                for (const f of facultyRes.data) {
                    const uid = String(f.auth_user_id || f.id);
                    const existing = mergedMap.get(uid) || {};
                    mergedMap.set(uid, {
                        ...existing,
                        ...f,
                        auth_user_id: f.auth_user_id || f.id,
                        avatar_url: f.profile_photo_url || f.avatar_url || existing.avatar_url,
                        role: f.role || existing.role || 'Faculty'
                    });
                }
            }

            // 4. Resolve all merged entries and force-cache them
            const resolvedList = [];
            for (const [uid, data] of mergedMap) {
                const resolved = resolveUserIdentity(data);
                // Force-set the cache with the merged (best) data
                State.userResolutionCache.set(uid, resolved);
                if (resolved.auth_user_id) State.userResolutionCache.set(String(resolved.auth_user_id), resolved);
                if (resolved.email) State.userResolutionCache.set(resolved.email.toLowerCase(), resolved);
                resolvedList.push(resolved);
            }

            return resolvedList;
        } catch (err) {
            console.warn("CiteFlowMessenger: Notice fetching participant batches:", err);
            return [];
        }
    }

    /**
     * Inject Messenger DOM elements if not already present
     */
    function mountDOM() {
        if (State.mounted) return;

        // 1. Ensure Messenger CSS is loaded
        if (!document.querySelector('link[data-citeflow="universal-messenger-css"]')) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            const isSubfolder = window.location.pathname.includes('/admin/') || window.location.pathname.includes('/faculty/');
            link.href = isSubfolder ? "../shared/messenger.css" : "shared/messenger.css";
            link.setAttribute("data-citeflow", "universal-messenger-css");
            document.head.appendChild(link);
        }

        // 2. Floating Action Button
        if (!document.getElementById("citeflowMessageFab") && !document.querySelector(".message-btn")) {
            const fab = document.createElement("button");
            fab.type = "button";
            fab.id = "citeflowMessageFab";
            fab.className = "message-btn";
            fab.title = "Open Messages";
            fab.innerHTML = `<i class="fa-solid fa-comments"></i>`;
            fab.addEventListener("click", openPanel);
            document.body.appendChild(fab);
        } else {
            const existingBtn = document.getElementById("citeflowMessageFab") || document.querySelector(".message-btn");
            if (existingBtn && !existingBtn.getAttribute("data-wired")) {
                existingBtn.setAttribute("data-wired", "true");
                existingBtn.onclick = openPanel;
            }
        }

        // 3. Backdrop & Slide-out Panel
        const existingPanel = document.getElementById("msgrPanel");
        if (existingPanel && !document.getElementById("msgrExpandBtn")) {
            existingPanel.remove();
            document.getElementById("msgrBackdrop")?.remove();
            document.getElementById("msgrNewModal")?.remove();
        }

        if (!document.getElementById("msgrPanel")) {
            const panelWrapper = document.createElement("div");
            panelWrapper.innerHTML = `
                <div id="msgrBackdrop" class="msgr-backdrop"></div>
                <div id="msgrPanel" class="msgr-panel">
                    <div class="msgr-header">
                        <h2>Chats</h2>
                        <div class="msgr-header-actions">
                            <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrHeaderOptionsBtn" title="Options">
                                <i class="fa-solid fa-ellipsis"></i>
                            </button>
                            <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrExpandBtn" title="Expand">
                                <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                            </button>
                            <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrNewBtn" title="New Message">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrCloseBtn" title="Close">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>

                    <div class="msgr-search">
                        <input type="text" id="msgrConvoSearch" placeholder="Search Messenger">
                    </div>

                    <div class="msgr-filter-tabs" id="msgrFilterTabs">
                        <button type="button" class="msgr-filter-tab active" data-filter="all">All</button>
                        <button type="button" class="msgr-filter-tab" data-filter="unread">Unread</button>
                        <button type="button" class="msgr-filter-tab" data-filter="groups">Groups</button>
                        <button type="button" class="msgr-filter-tab" data-filter="archived">Archived</button>
                    </div>

                    <!-- Search results overlay (hidden by default) -->
                    <div class="msgr-search-results" id="msgrSearchResults" style="display:none;"></div>

                    <div class="msgr-list" id="msgrList">
                        <div class="msgr-empty">
                            <i class="fa-regular fa-comments"></i>
                            No conversations yet. Click the compose icon to start one.
                        </div>
                    </div>

                    <!-- Context menu dropdown (hidden) -->
                    <div class="msgr-dropdown" id="msgrDropdown" style="display:none;"></div>

                    <div class="msgr-chat" id="msgrChat">
                        <div class="msgr-chat-header">
                            <button type="button" class="msgr-back-btn" id="msgrBackBtn" title="Back to conversations">
                                <i class="fa-solid fa-arrow-left"></i>
                            </button>
                            <div class="msgr-avatar" id="msgrChatAvatar"></div>
                            <div class="msgr-chat-title">
                                <div class="name" id="msgrChatName">Chat</div>
                                <div class="sub" id="msgrChatSub">Online</div>
                            </div>
                            <div class="msgr-chat-header-actions">
                                <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrChatInfoBtn" title="Chat Details">
                                    <i class="fa-solid fa-circle-info"></i>
                                </button>
                            </div>
                        </div>

                        <div class="msgr-messages" id="msgrMessages"></div>

                        <div class="msgr-composer">
                            <textarea id="msgrInput" rows="1" placeholder="Type a message..."></textarea>
                            <button type="button" class="msgr-send-btn" id="msgrSendBtn" disabled>
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                        </div>

                        <!-- Docked Chat Details Panel (Slide-in) -->
                        <div class="msgr-docked-details" id="msgrDockedDetails" style="display:none;">
                            <div class="msgr-docked-details-header">
                                <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrDockedDetailsBackBtn" title="Back to chat">
                                    <i class="fa-solid fa-arrow-left"></i>
                                </button>
                                <h3>Chat Details</h3>
                            </div>
                            <div class="msgr-docked-details-body" id="msgrDockedDetailsBody"></div>
                        </div>
                    </div>
                </div>

                <!-- Expanded Messenger View (full page) -->
                <div id="msgrExpanded" class="msgr-expanded" style="display:none;">
                    <div class="msgr-exp-sidebar">
                        <div class="msgr-exp-sidebar-header">
                            <h2>Chats</h2>
                            <div class="msgr-header-actions">
                                <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrExpHeaderOptionsBtn" title="Options"><i class="fa-solid fa-ellipsis"></i></button>
                                <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrCollapseBtn" title="Collapse"><i class="fa-solid fa-down-left-and-up-right-to-center"></i></button>
                                <button type="button" class="msgr-icon-btn msgr-icon-btn-flat" id="msgrExpNewBtn" title="New Message"><i class="fa-solid fa-pen-to-square"></i></button>
                            </div>
                        </div>
                        <div class="msgr-search">
                            <input type="text" id="msgrExpSearch" placeholder="Search Messenger">
                        </div>
                        <div class="msgr-filter-tabs">
                            <button type="button" class="msgr-filter-tab active" data-filter="all">All</button>
                            <button type="button" class="msgr-filter-tab" data-filter="unread">Unread</button>
                            <button type="button" class="msgr-filter-tab" data-filter="groups">Groups</button>
                            <button type="button" class="msgr-filter-tab" data-filter="archived">Archived</button>
                        </div>
                        <div class="msgr-list" id="msgrExpList"></div>
                    </div>
                    <div class="msgr-exp-chat">
                        <div class="msgr-exp-chat-placeholder" id="msgrExpChatPlaceholder">
                            <i class="fa-regular fa-comments"></i>
                            <p>Select a conversation to start messaging</p>
                        </div>
                        <div class="msgr-exp-chat-active" id="msgrExpChatActive" style="display:none;">
                            <div class="msgr-chat-header">
                                <div class="msgr-avatar" id="msgrExpChatAvatar"></div>
                                <div class="msgr-chat-title">
                                    <div class="name" id="msgrExpChatName">Chat</div>
                                    <div class="sub" id="msgrExpChatSub">Online</div>
                                </div>
                            </div>
                            <div class="msgr-messages" id="msgrExpMessages"></div>
                            <div class="msgr-composer">
                                <textarea id="msgrExpInput" rows="1" placeholder="Type a message..."></textarea>
                                <button type="button" class="msgr-send-btn" id="msgrExpSendBtn" disabled>
                                    <i class="fa-solid fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="msgr-exp-info" id="msgrExpInfo">
                        <div class="msgr-exp-info-inner" id="msgrExpInfoInner">
                            <div class="msgr-exp-info-placeholder">
                                <i class="fa-regular fa-circle-info"></i>
                                <p>Chat info will appear here</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- New Message Modal -->
                <div class="msgr-new-modal" id="msgrNewModal">
                    <div class="msgr-new-card">
                        <div class="msgr-new-header">
                            <h3><i class="fa-solid fa-user-plus"></i> New Message</h3>
                            <button type="button" class="msgr-icon-btn" id="msgrNewCloseBtn" style="color:#64748b; background:#f1f5f9;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="msgr-new-body">
                            <input type="text" id="msgrUserSearch" placeholder="Search by name, email, department, or role...">
                            <div class="msgr-group-name-field" id="msgrGroupNameField">
                                <input type="text" id="msgrGroupNameInput" placeholder="Group Name (e.g. BSIT Committee)">
                            </div>
                            <div id="msgrUserResults">
                                <div class="msgr-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading directory...</div>
                            </div>
                        </div>
                        <div class="msgr-new-footer">
                            <div class="msgr-hint" id="msgrNewHint">Pick a colleague to message, or multiple to create a group.</div>
                            <button type="button" class="msgr-create-btn" id="msgrCreateBtn" disabled>Start Conversation</button>
                        </div>
                    </div>
                </div>

                <!-- Archived Chats Modal -->
                <div class="msgr-new-modal" id="msgrArchivedModal" style="display:none;">
                    <div class="msgr-new-card">
                        <div class="msgr-new-header">
                            <h3><i class="fa-solid fa-box-archive"></i> Archived Chats</h3>
                            <button type="button" class="msgr-icon-btn" id="msgrArchivedCloseBtn" style="color:#64748b; background:#f1f5f9;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="msgr-new-body" id="msgrArchivedBody">
                            <div class="msgr-empty"><i class="fa-regular fa-folder-open"></i> No archived chats</div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(panelWrapper);
        }

        bindEvents();
        setupLifecycleListeners();
        State.mounted = true;
    }

    /**
     * Bind DOM interaction listeners
     */
    function bindEvents() {
        if (!State.globalEventsBound) {
            State.globalEventsBound = true;
            document.addEventListener("click", (e) => {
                const expandBtn = e.target.closest("#msgrExpandBtn") || e.target.closest(".msgr-header button[title='Expand']");
                if (expandBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    openExpandedView();
                    return;
                }
                const collapseBtn = e.target.closest("#msgrCollapseBtn") || e.target.closest("button[title='Collapse']");
                if (collapseBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeExpandedView();
                    return;
                }
                const headerOptsBtn = e.target.closest("#msgrHeaderOptionsBtn") || e.target.closest("#msgrExpHeaderOptionsBtn") || e.target.closest("button[title='Options']");
                if (headerOptsBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    showHeaderOptionsDropdown(headerOptsBtn);
                    return;
                }
                const convoOptsBtn = e.target.closest(".msgr-convo-options");
                if (convoOptsBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const convoId = convoOptsBtn.dataset.convoid;
                    if (convoId) {
                        showConvoDropdown(convoId, convoOptsBtn);
                    }
                    return;
                }
                const dropdown = document.getElementById("msgrDropdown");
                if (dropdown && dropdown.style.display !== "none" && !e.target.closest("#msgrDropdown")) {
                    closeConvoDropdown();
                }
            });
        }

        document.getElementById("msgrCloseBtn")?.addEventListener("click", closePanel);
        document.getElementById("msgrBackdrop")?.addEventListener("click", closePanel);
        document.getElementById("msgrBackBtn")?.addEventListener("click", closeActiveChat);

        // Docked chat details toggle
        document.getElementById("msgrChatInfoBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDockedDetails(true);
        });
        document.getElementById("msgrDockedDetailsBackBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDockedDetails(false);
        });

        // Search in panel
        document.getElementById("msgrConvoSearch")?.addEventListener("input", (e) => {
            handleEnhancedSearch(e.target.value.trim());
        });
        document.getElementById("msgrConvoSearch")?.addEventListener("focus", (e) => {
            if (e.target.value.trim()) handleEnhancedSearch(e.target.value.trim());
        });

        // Filter tabs in panel
        document.querySelectorAll("#msgrFilterTabs .msgr-filter-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                document.querySelectorAll("#msgrFilterTabs .msgr-filter-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                State.activeFilter = tab.dataset.filter || "all";
                renderConversationList(getConvoSearchFilter());
            });
        });

        // Filter tabs in expanded view
        document.querySelectorAll("#msgrExpanded .msgr-filter-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                document.querySelectorAll("#msgrExpanded .msgr-filter-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                State.activeFilter = tab.dataset.filter || "all";
                renderExpandedConvoList();
            });
        });

        // Expanded view search
        document.getElementById("msgrExpSearch")?.addEventListener("input", () => renderExpandedConvoList());

        // Panel composer & typing listeners
        const input = document.getElementById("msgrInput");
        const sendBtn = document.getElementById("msgrSendBtn");

        input?.addEventListener("input", () => {
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 100) + "px";
            sendBtn.disabled = input.value.trim().length === 0;
            triggerLocalTyping();
        });

        input?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitChatMessage(false);
            }
        });

        input?.addEventListener("blur", () => {
            stopLocalTypingImmediately();
        });

        sendBtn?.addEventListener("click", () => submitChatMessage(false));

        // Expanded composer & typing listeners
        const expInput = document.getElementById("msgrExpInput");
        const expSendBtn = document.getElementById("msgrExpSendBtn");

        expInput?.addEventListener("input", () => {
            expInput.style.height = "auto";
            expInput.style.height = Math.min(expInput.scrollHeight, 100) + "px";
            expSendBtn.disabled = expInput.value.trim().length === 0;
            triggerLocalTyping();
        });

        expInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitChatMessage(true);
            }
        });

        expInput?.addEventListener("blur", () => {
            stopLocalTypingImmediately();
        });

        expSendBtn?.addEventListener("click", () => submitChatMessage(true));

        // Compose modal events
        document.getElementById("msgrNewBtn")?.addEventListener("click", openNewModal);
        document.getElementById("msgrExpNewBtn")?.addEventListener("click", openNewModal);
        document.getElementById("msgrNewCloseBtn")?.addEventListener("click", closeNewModal);
        document.getElementById("msgrArchivedCloseBtn")?.addEventListener("click", closeArchivedModal);
        document.getElementById("msgrNewModal")?.addEventListener("click", (e) => {
            if (e.target.id === "msgrNewModal") closeNewModal();
        });
        document.getElementById("msgrArchivedModal")?.addEventListener("click", (e) => {
            if (e.target.id === "msgrArchivedModal") closeArchivedModal();
        });

        document.getElementById("msgrUserSearch")?.addEventListener("input", (e) => {
            renderUserResults(e.target.value.trim().toLowerCase());
        });

        document.getElementById("msgrCreateBtn")?.addEventListener("click", createConversation);
    }

    /**
     * Resilient lifecycle event listeners (tab visibility, network recovery, window focus)
     */
    function setupLifecycleListeners() {
        if (State._lifecycleBound) return;
        State._lifecycleBound = true;

        const handleWakeSync = async () => {
            if (!State.currentUserId) return;
            await loadConversations(false);
            if (State.activeConversationId) {
                await loadAndRenderActiveMessages(State.activeConversationId);
            }
            if (!State.inboxChannel || State.inboxChannel.state === 'closed' || State.inboxChannel.state === 'errored') {
                subscribeToInbox();
            }
            if (!State.presenceChannel || State.presenceChannel.state === 'closed' || State.presenceChannel.state === 'errored') {
                subscribeToPresence();
            }
            if (State.activeConversationId && (!State.messageChannel || State.messageChannel.state === 'closed' || State.messageChannel.state === 'errored')) {
                subscribeToActiveConversation(State.activeConversationId);
            }
        };

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                handleWakeSync();
            }
        });

        window.addEventListener('online', () => {
            CiteFlowModal.toast('Network connected. Messenger synced.');
            handleWakeSync();
        });

        window.addEventListener('focus', () => {
            if (State.currentUserId) {
                updateUnreadBadge();
            }
        });
    }

    /**
     * Ensure current session is resolved
     */
    async function resolveCurrentUser() {
        const sb = getClient();
        if (!sb) return false;

        try {
            const prevUid = State.currentUserId;
            const { data: { session } } = await sb.auth.getSession();
            let newUid = null;
            let newEmail = null;
            let newRole = null;
            let newName = null;
            let newAvatar = null;

            if (session?.user) {
                newUid = session.user.id;
                newEmail = (session.user.email || '').toLowerCase();
                const meta = session.user.user_metadata || {};
                newRole = meta.role || (window.location.pathname.includes('/admin/') ? 'Admin' : 'Faculty');
                newName = [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim() || meta.full_name || meta.name || formatNameFromEmail(newEmail) || 'User';
                newAvatar = meta.profile_photo_url || meta.avatar_url || meta.photo_url || null;
            } else {
                const cached = localStorage.getItem('citeflow_user');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    newUid = parsed.id;
                    newEmail = (parsed.email || '').toLowerCase();
                    newRole = parsed.role || (window.location.pathname.includes('/admin/') ? 'Admin' : 'Faculty');
                    newName = parsed.name || formatNameFromEmail(newEmail) || 'User';
                    newAvatar = parsed.profilePhotoUrl || parsed.profile_photo_url || parsed.avatar_url || null;
                }
            }

            if (!newUid) return false;

            // If user ID changed (account switch / fresh login), reset all in-memory and UI state
            if (prevUid && String(prevUid) !== String(newUid)) {
                State.conversations = [];
                State.activeConversationId = null;
                State.activeConversationMeta = null;
                State.activeConversationParticipants = [];
                State._currentActiveMessages = [];
                State.userResolutionCache.clear();
                State.directoryCache = [];
                State.selectedNewUsers = [];
                State._lastRenderedMsgSig = null;
                State._lastExpRenderedMsgSig = null;
                if (State.messageChannel) {
                    try { sb.removeChannel(State.messageChannel); } catch (_) {}
                    State.messageChannel = null;
                }
                if (State.inboxChannel) {
                    try { sb.removeChannel(State.inboxChannel); } catch (_) {}
                    State.inboxChannel = null;
                }
                if (State.presenceChannel) {
                    try { sb.removeChannel(State.presenceChannel); } catch (_) {}
                    State.presenceChannel = null;
                }
            }

            State.currentUserId = newUid;
            State.currentUserEmail = newEmail;
            State.currentUserRole = newRole;
            State.currentUserName = newName;
            State.currentUserAvatar = newAvatar;

            // Reload user-scoped state strictly for the new user ID
            loadUserScopedState();

            // Purge any legacy unscoped localStorage caches if present
            try {
                localStorage.removeItem('citeflow_convo_metas');
                localStorage.removeItem('citeflow_convo_cache');
            } catch (_) {}

            State.userResolutionCache.set(String(newUid), {
                id: newUid,
                auth_user_id: newUid,
                name: newName,
                display_name: newName,
                email: newEmail,
                avatar_url: newAvatar,
                role: newRole
            });

            return true;
        } catch (e) {
            console.warn("CiteFlowMessenger: Error resolving user session:", e);
        }
        return false;
    }

    /**
     * Realtime Global Presence tracking (tracks who is online)
     */
    function subscribeToPresence() {
        const sb = getClient();
        if (!sb || !State.currentUserId) return;

        if (State.presenceChannel) {
            try { sb.removeChannel(State.presenceChannel); } catch (_) {}
            State.presenceChannel = null;
        }

        const channel = sb.channel('msgr-presence-global', {
            config: { presence: { key: State.currentUserId } }
        });

        channel
            .on('presence', { event: 'sync' }, () => {
                const presenceState = channel.presenceState();
                State.onlineUserIds.clear();
                for (const key in presenceState) {
                    (presenceState[key] || []).forEach(p => {
                        if (p.userId) State.onlineUserIds.add(String(p.userId));
                    });
                }
                // Refresh active messages UI to reflect Sent -> Delivered state in real time
                if (State.activeConversationId && Array.isArray(State._currentActiveMessages)) {
                    renderActiveMessagesUI(State._currentActiveMessages);
                }
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                (newPresences || []).forEach(p => {
                    if (p.userId) State.onlineUserIds.add(String(p.userId));
                });
                if (State.activeConversationId && Array.isArray(State._currentActiveMessages)) {
                    renderActiveMessagesUI(State._currentActiveMessages);
                }
            })
            .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                (leftPresences || []).forEach(p => {
                    if (p.userId) State.onlineUserIds.delete(String(p.userId));
                });
                if (State.activeConversationId && Array.isArray(State._currentActiveMessages)) {
                    renderActiveMessagesUI(State._currentActiveMessages);
                }
            });

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                try {
                    await channel.track({
                        userId: State.currentUserId,
                        email: State.currentUserEmail,
                        onlineAt: new Date().toISOString()
                    });
                } catch (_) {}
            }
        });

        State.presenceChannel = channel;
    }

    /**
     * Initialize messenger
     */
    async function init() {
        if (State.initialized) return;

        mountDOM();

        const hasUser = await resolveCurrentUser();
        console.log("CiteFlowMessenger: init() hasUser:", hasUser, "userId:", State.currentUserId);
        if (hasUser) {
            await loadConversations(true);
            subscribeToInbox();
            subscribeToPresence();
            State.initialized = true;
        }
    }

    async function openPanel() {
        mountDOM();
        document.getElementById("msgrPanel")?.classList.add("show");
        document.getElementById("msgrBackdrop")?.classList.add("show");

        await resolveCurrentUser();
        console.log("CiteFlowMessenger: openPanel() userId:", State.currentUserId);
        await loadConversations(State.conversations.length === 0);
        if (!State.inboxChannel) subscribeToInbox();
        if (!State.presenceChannel) subscribeToPresence();
    }

    function closePanel() {
        closeConvoDropdown();
        document.getElementById("msgrPanel")?.classList.remove("show");
        document.getElementById("msgrBackdrop")?.classList.remove("show");
        closeActiveChat();
    }

    function closeActiveChat() {
        closeConvoDropdown();
        toggleDockedDetails(false);
        stopLocalTypingImmediately();

        document.getElementById("msgrChat")?.classList.remove("show");
        State.activeConversationId = null;
        State.activeConversationMeta = null;
        State._currentActiveMessages = [];

        if (State.messageChannel) {
            const sb = getClient();
            try {
                sb?.removeChannel(State.messageChannel);
            } catch (_) {}
            State.messageChannel = null;
        }

        renderConversationList(getConvoSearchFilter());
        renderExpandedConvoList();
    }

    /**
     * Render conversation list skeleton loaders while loading
     */
    function renderSkeletons(targetEl, count = 4) {
        if (!targetEl) return;
        targetEl.innerHTML = Array.from({ length: count }).map(() => `
            <div class="msgr-skeleton-convo">
                <div class="msgr-skeleton-avatar msgr-skeleton-shimmer"></div>
                <div class="msgr-skeleton-lines">
                    <div class="msgr-skeleton-title msgr-skeleton-shimmer"></div>
                    <div class="msgr-skeleton-subtitle msgr-skeleton-shimmer"></div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Render message bubble skeleton loaders while loading active chat
     */
    function renderMessageSkeletons(targetEl) {
        if (!targetEl) return;
        targetEl.innerHTML = `
            <div class="msgr-skeleton-bubble-row theirs">
                <div class="msgr-skeleton-bubble msgr-skeleton-shimmer"></div>
            </div>
            <div class="msgr-skeleton-bubble-row mine">
                <div class="msgr-skeleton-bubble msgr-skeleton-shimmer"></div>
            </div>
            <div class="msgr-skeleton-bubble-row theirs">
                <div class="msgr-skeleton-bubble msgr-skeleton-shimmer" style="width: 240px;"></div>
            </div>
        `;
    }

    /**
     * Load all conversations for current user strictly restricted to their own participant records
     */
    async function loadConversations(showSkeletons = false) {
        const sb = getClient();
        const listEl = document.getElementById("msgrList");
        const expListEl = document.getElementById("msgrExpList");

        if (!State.currentUserId) {
            await resolveCurrentUser();
        }

        if (!sb || !State.currentUserId) {
            if (listEl && State.conversations.length === 0) {
                listEl.innerHTML = `
                    <div class="msgr-empty">
                        <i class="fa-regular fa-comments"></i>
                        Please sign in to view your conversations.
                    </div>`;
            }
            return;
        }

        if (showSkeletons && State.conversations.length === 0) {
            if (listEl) renderSkeletons(listEl);
            if (expListEl) renderSkeletons(expListEl);
        }

        try {
            State.isLoadingConvos = true;

            console.log("CiteFlowMessenger: loadConversations for userId:", State.currentUserId);

            // STRICT PRIVACY: Query ONLY conversations where current user is registered as a participant
            const { data: participantRows, error: pErr } = await sb
                .from("conversation_participants")
                .select("conversation_id, last_read_at")
                .eq("user_id", State.currentUserId);

            if (pErr) {
                console.error("CiteFlowMessenger: Error querying participants:", pErr);
                throw pErr;
            }

            console.log("CiteFlowMessenger: participantRows found:", participantRows?.length || 0);

            const pMap = new Map();
            if (Array.isArray(participantRows)) {
                participantRows.forEach(r => {
                    if (r.conversation_id) pMap.set(String(r.conversation_id), r.last_read_at);
                });
            }

            const allConvoIds = Array.from(pMap.keys()).filter(Boolean);

            if (allConvoIds.length === 0) {
                State.conversations = [];
                renderConversationList(getConvoSearchFilter());
                renderExpandedConvoList();
                updateUnreadBadge();
                return;
            }

            const [{ data: convData, error: convError }, { data: allParticipants }, { data: allMessages }] = await Promise.all([
                sb.from("conversations").select("*").in("id", allConvoIds),
                sb.from("conversation_participants").select("conversation_id, user_id, last_read_at").in("conversation_id", allConvoIds),
                sb.from("messages").select("conversation_id, content, created_at, sender_id").in("conversation_id", allConvoIds).order("created_at", { ascending: false })
            ]);

            if (convError) throw convError;

            const allOtherUserIds = Array.from(new Set(
                (allParticipants || [])
                    .map(p => p.user_id)
                    .concat((convData || []).map(c => c.created_by))
                    .filter(uid => uid && String(uid) !== String(State.currentUserId))
            ));

            if (allOtherUserIds.length > 0) {
                await batchFetchParticipants(allOtherUserIds);
            }

            const lastMsgMap = new Map();
            if (allMessages) {
                for (const msg of allMessages) {
                    const cidStr = String(msg.conversation_id);
                    if (!lastMsgMap.has(cidStr)) {
                        lastMsgMap.set(cidStr, msg);
                    }
                }
            }

            let enriched = (convData || []).map((conv) => {
                const myLastRead = pMap.get(String(conv.id)) || null;
                const lastMsg = lastMsgMap.get(String(conv.id)) || null;

                const convoParticipantIds = (allParticipants || [])
                    .filter(p => String(p.conversation_id) === String(conv.id) && String(p.user_id) !== String(State.currentUserId))
                    .map(p => p.user_id);

                if (conv.created_by && String(conv.created_by) !== String(State.currentUserId) && !convoParticipantIds.includes(conv.created_by)) {
                    convoParticipantIds.push(conv.created_by);
                }

                let resolvedOthers = convoParticipantIds.map(uid => resolveUserIdentity(uid));

                resolvedOthers = resolvedOthers.filter(o =>
                    String(o.auth_user_id) !== String(State.currentUserId) &&
                    String(o.id) !== String(State.currentUserId) &&
                    (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail).toLowerCase())
                );

                const meta = getConvoMeta(conv.id);
                if (resolvedOthers.length === 0 && meta?.others) {
                    resolvedOthers = meta.others.filter(o =>
                        String(o.auth_user_id) !== String(State.currentUserId) &&
                        String(o.id) !== String(State.currentUserId) &&
                        (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail).toLowerCase())
                    );
                }

                if (resolvedOthers.length === 0) {
                    resolvedOthers = [resolveUserIdentity(null, State.currentUserRole === 'Admin' ? 'Faculty' : 'Admin')];
                }

                const isManuallyUnread = State.manuallyUnreadConvoIds.has(conv.id);
                const isCurrentlyOpen = String(State.activeConversationId) === String(conv.id);
                const unread = !isCurrentlyOpen && (isManuallyUnread || Boolean(
                    lastMsg &&
                    String(lastMsg.sender_id) !== String(State.currentUserId) &&
                    (!myLastRead || new Date(lastMsg.created_at) > new Date(myLastRead))
                ));

                const isPinned = State.pinnedConvoIds.has(conv.id);
                const isSoftDeleted = State.deletedConvoIds.has(String(conv.id));
                const isArchived = isSoftDeleted || State.archivedConvoIds.has(conv.id);

                let displayName = conv.name || null;
                if (conv.is_group) {
                    displayName = meta?.customNickname || conv.name || meta?.displayName || resolvedOthers.map(o => (o.name || o.display_name || '').split(' ')[0]).filter(Boolean).join(', ') || "Group Chat";
                } else {
                    const otherPerson = resolvedOthers[0];
                    const otherName = otherPerson?.name || otherPerson?.display_name;
                    if (meta?.customNickname) {
                        displayName = meta.customNickname;
                    } else if (otherName && otherName !== "Faculty Member" && otherName !== "Administrator") {
                        displayName = otherName;
                    } else if (meta?.displayName && meta.displayName !== "Faculty Member" && meta.displayName !== "Administrator") {
                        displayName = meta.displayName;
                    } else {
                        displayName = otherName || (State.currentUserRole === 'Admin' ? "Faculty Member" : "Administrator");
                    }
                }

                return {
                    ...conv,
                    others: resolvedOthers,
                    lastMessage: lastMsg,
                    unread,
                    isPinned,
                    isArchived,
                    isSoftDeleted,
                    displayName,
                    sortTime: lastMsg?.created_at || conv.last_message_at || conv.created_at || new Date().toISOString()
                };
            });

            const dedupedKeys = new Set();
            let finalConvos = enriched.filter(c => {
                if (!c || !c.id) return false;
                const safeOthers = (c.others || []).filter(o =>
                    String(o.auth_user_id) !== String(State.currentUserId) &&
                    String(o.id) !== String(State.currentUserId)
                );

                let recipientKey = null;
                if (c.is_group) {
                    recipientKey = `group_${c.id}`;
                } else if (safeOthers.length > 0) {
                    const o = safeOthers[0];
                    recipientKey = `direct_${(o.auth_user_id || o.id || o.email || o.name || '').toLowerCase()}`;
                } else {
                    recipientKey = `direct_${(c.displayName || '').toLowerCase().replace(/\s+/g, '')}`;
                }

                if (dedupedKeys.has(recipientKey)) return false;
                dedupedKeys.add(recipientKey);
                return true;
            });

            finalConvos.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return new Date(b.sortTime || 0) - new Date(a.sortTime || 0);
            });

            State.conversations = finalConvos;
            console.log("CiteFlowMessenger: Loaded", finalConvos.length, "conversations.");

            renderConversationList(getConvoSearchFilter());
            renderExpandedConvoList();
            updateUnreadBadge();
        } catch (err) {
            console.error("CiteFlowMessenger: Error loading conversations:", err);
            if (listEl && State.conversations.length === 0) {
                listEl.innerHTML = `
                    <div class="msgr-empty">
                        <i class="fa-regular fa-comments"></i>
                        Could not load conversations. Please refresh the page.
                    </div>`;
            }
        } finally {
            State.isLoadingConvos = false;
        }
    }

    /**
     * Render conversation list items with rich unread visual highlighting
     */
    function renderConversationList(filter = "") {
        const listEl = document.getElementById("msgrList");
        if (!listEl) return;

        let activeItems = State.conversations.filter(c => !c.isArchived);
        let items = activeItems.filter((c) =>
            !filter || c.displayName.toLowerCase().includes(filter)
        );

        const tabFilter = State.activeFilter || "all";
        if (tabFilter === "unread") {
            items = activeItems.filter(c => c.unread);
        } else if (tabFilter === "groups") {
            items = activeItems.filter(c => c.is_group);
        } else if (tabFilter === "archived") {
            items = State.conversations.filter(c => c.isArchived);
        }

        if (items.length === 0) {
            let emptyMsg = "No conversations yet. Click the compose icon to start chatting.";
            if (filter) {
                emptyMsg = "No conversations match your search.";
            } else if (tabFilter === "unread") {
                emptyMsg = "No unread messages. You're all caught up! 🎉";
            } else if (tabFilter === "groups") {
                emptyMsg = "No group chats yet. Start one with the compose button.";
            } else if (tabFilter === "archived") {
                emptyMsg = "No archived conversations.";
            }
            listEl.innerHTML = `
                <div class="msgr-empty">
                    <i class="fa-regular fa-comments"></i>
                    ${emptyMsg}
                </div>`;
            return;
        }

        listEl.innerHTML = items.map((c) => {
            const safeOthers = (c.others || []).filter(o =>
                String(o.auth_user_id) !== String(State.currentUserId) &&
                String(o.id) !== String(State.currentUserId)
            );
            const avatarHtml = renderAvatar(c.is_group ? null : safeOthers[0]?.avatar_url, c.displayName, c.is_group);
            const preview = c.lastMessage
                ? (String(c.lastMessage.sender_id) === String(State.currentUserId) ? "You: " : "") + escapeHtml(c.lastMessage.content)
                : "No messages yet";
            const time = c.lastMessage ? formatTime(c.lastMessage.created_at) : "";
            const unreadClass = c.unread ? " unread" : "";

            return `
                <div class="msgr-convo${unreadClass}${String(State.activeConversationId) === String(c.id) ? " active" : ""}" data-id="${c.id}">
                    ${avatarHtml}
                    <div class="msgr-convo-info">
                        <div class="msgr-convo-name">${c.isPinned ? '<i class="fa-solid fa-thumbtack msgr-pin-icon" title="Pinned"></i> ' : ''}${escapeHtml(c.displayName)}</div>
                        <div class="msgr-convo-preview">${preview} ${time ? '<span class="msgr-convo-time-inline"> · ' + time + '</span>' : ''}</div>
                    </div>
                    <div class="msgr-convo-meta">
                        <button type="button" class="msgr-convo-options" data-convoid="${c.id}" title="More options">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                        ${c.unread ? '<div class="msgr-unread-dot"></div>' : ""}
                    </div>
                </div>`;
        }).join("");

        listEl.querySelectorAll(".msgr-convo").forEach((el) => {
            el.addEventListener("click", (e) => {
                if (e.target.closest(".msgr-convo-options")) return;
                const conv = State.conversations.find((c) => String(c.id) === String(el.dataset.id));
                if (conv) activateConversation(conv, false);
            });
        });

        listEl.querySelectorAll(".msgr-convo-options").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                showConvoDropdown(btn.dataset.convoid, btn);
            });
        });
    }

    /**
     * Safe avatar renderer with zero-flash fallback
     */
    function renderAvatar(url, name, isGroup, customClass = "") {
        const cls = `msgr-avatar${isGroup ? " group" : ""} ${customClass}`.trim();
        const initials = initialsOf(name);

        if (url && typeof url === 'string' && url.trim().length > 0) {
            const cleanUrl = url.replace(/"/g, '&quot;');
            return `
                <div class="${cls}">
                    <img src="${cleanUrl}" alt="" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
                    <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${initials}</div>
                </div>`;
        }
        if (isGroup) {
            return `<div class="${cls}"><i class="fa-solid fa-users"></i></div>`;
        }
        return `<div class="${cls}">${initials}</div>`;
    }

    function initialsOf(str) {
        if (!str || typeof str !== 'string') return "?";
        const parts = str.trim().split(/\s+/);
        if (parts.length === 1) return (parts[0].slice(0, 2)).toUpperCase();
        return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase() || "?";
    }

    /**
     * Unified Conversation Activation: merged openConversation & openExpandedConversation
     */
    async function activateConversation(conv, isExpandedView = false) {
        if (!conv) return;

        State.activeConversationId = conv.id;
        State.activeConversationMeta = conv;
        State.isExpanded = isExpandedView;

        toggleDockedDetails(false);
        stopLocalTypingImmediately();

        // Optimistically remove unread highlight immediately upon opening
        conv.unread = false;
        State.manuallyUnreadConvoIds.delete(conv.id);
        saveUnreadState();
        updateUnreadBadge();

        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId)
        );

        const meta = getConvoMeta(conv.id);
        let displayName = conv.displayName;
        if (meta?.customNickname) {
            displayName = meta.customNickname;
        } else if (!conv.is_group && safeOthers.length > 0) {
            const otherName = safeOthers[0].name || safeOthers[0].display_name;
            // Only use otherName if it's a real name, not a generic fallback
            if (otherName && otherName !== 'Faculty Member' && otherName !== 'Administrator' && otherName !== 'User') {
                displayName = otherName;
            }
            // If displayName is still generic, try convo meta
            if (!displayName || displayName === 'Faculty Member' || displayName === 'Administrator') {
                displayName = meta?.displayName || conv.displayName || otherName || 'Chat';
            }
        }

        const otherAvatarUrl = (safeOthers.length > 0 && !conv.is_group) ? safeOthers[0].avatar_url : (conv.avatar_url || null);
        const subText = conv.is_group
            ? `${safeOthers.length + 1} members`
            : (safeOthers[0]?.department || safeOthers[0]?.role || "Online");

        // Panel View updates
        const nameEl = document.getElementById("msgrChatName");
        const subEl = document.getElementById("msgrChatSub");
        const avatarEl = document.getElementById("msgrChatAvatar");

        if (nameEl) nameEl.textContent = displayName;
        if (subEl) subEl.textContent = subText;
        if (avatarEl) {
            avatarEl.outerHTML = renderAvatar(conv.is_group ? null : otherAvatarUrl, displayName, conv.is_group)
                .replace('class="msgr-avatar', 'id="msgrChatAvatar" class="msgr-avatar');
        }

        // Expanded View updates
        const expNameEl = document.getElementById("msgrExpChatName");
        const expSubEl = document.getElementById("msgrExpChatSub");
        const expAvatarEl = document.getElementById("msgrExpChatAvatar");
        const placeholderEl = document.getElementById("msgrExpChatPlaceholder");
        const activeEl = document.getElementById("msgrExpChatActive");

        if (placeholderEl) placeholderEl.style.display = "none";
        if (activeEl) activeEl.style.display = "flex";
        if (expNameEl) expNameEl.textContent = displayName;
        if (expSubEl) expSubEl.textContent = subText;
        if (expAvatarEl) {
            expAvatarEl.outerHTML = renderAvatar(conv.is_group ? null : otherAvatarUrl, displayName, conv.is_group)
                .replace('class="msgr-avatar', 'id="msgrExpChatAvatar" class="msgr-avatar');
        }

        if (!isExpandedView) {
            document.getElementById("msgrChat")?.classList.add("show");
        }

        renderExpandedInfoPanel(conv);
        renderConversationList(getConvoSearchFilter());
        renderExpandedConvoList();

        const msgContainer = isExpandedView ? document.getElementById("msgrExpMessages") : document.getElementById("msgrMessages");
        if (msgContainer) renderMessageSkeletons(msgContainer);

        State._lastRenderedMsgSig = null;
        State._lastExpRenderedMsgSig = null;
        State._participantsChanged = true;

        await loadAndRenderActiveMessages(conv.id);
        markConversationRead(conv.id);
        subscribeToActiveConversation(conv.id);
    }

    function toggleDockedDetails(show) {
        const panel = document.getElementById("msgrDockedDetails");
        if (!panel) return;
        if (show) {
            panel.style.display = "flex";
            if (State.activeConversationMeta) {
                renderDockedInfoPanel(State.activeConversationMeta);
            }
        } else {
            panel.style.display = "none";
        }
    }

    function renderDockedInfoPanel(conv) {
        const body = document.getElementById("msgrDockedDetailsBody");
        if (!body || !conv) return;

        const isGroup = conv.is_group;
        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId)
        );

        const meta = getConvoMeta(conv.id);
        let displayName = meta?.customNickname || conv.displayName;
        if (!isGroup && safeOthers.length > 0 && !meta?.customNickname) {
            displayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        }

        const otherAvatarUrl = (safeOthers.length > 0 && !isGroup) ? safeOthers[0].avatar_url : null;
        const isMuted = State.mutedConvoIds.has(conv.id);
        const sub = isGroup
            ? `${safeOthers.length + 1} members`
            : (safeOthers[0]?.department || safeOthers[0]?.role || "Member");

        const avatarHtml = renderAvatar(isGroup ? null : otherAvatarUrl, displayName, isGroup);

        const allMembers = [
            { name: 'You', department: State.currentUserRole, isSelf: true, avatar_url: State.currentUserAvatar },
            ...safeOthers
        ];

        body.innerHTML = `
            <div class="msgr-docked-profile">
                ${avatarHtml}
                <h3>${escapeHtml(displayName)}</h3>
                <p>${escapeHtml(sub)}</p>
            </div>
            <div class="msgr-docked-actions">
                <button type="button" class="msgr-docked-action-btn ${isMuted ? 'active' : ''}" id="msgrDockedMuteBtn">
                    <div class="icon-circle">
                        <i class="fa-solid ${isMuted ? 'fa-bell-slash' : 'fa-bell'}"></i>
                    </div>
                    <span>${isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button type="button" class="msgr-docked-action-btn" id="msgrDockedRenameBtn">
                    <div class="icon-circle">
                        <i class="fa-solid fa-pen"></i>
                    </div>
                    <span>Edit Name</span>
                </button>
            </div>
            <details class="msgr-docked-section" open>
                <summary>Chat info</summary>
                <div class="msgr-docked-detail-row">
                    <span>Type:</span>
                    <div>${isGroup ? 'Group Chat' : 'Direct Message'}</div>
                </div>
                ${!isGroup && safeOthers[0]?.department ? `
                <div class="msgr-docked-detail-row">
                    <span>Department:</span>
                    <div>${escapeHtml(safeOthers[0].department)}</div>
                </div>` : ''}
            </details>
            <details class="msgr-docked-section" ${isGroup ? 'open' : ''}>
                <summary>Chat members (${allMembers.length})</summary>
                <div class="msgr-docked-members">
                    ${allMembers.map(m => {
                        const mAvatar = renderAvatar(m.avatar_url, m.name || m.display_name || 'Member', false);
                        return `
                            <div class="msgr-docked-member-row">
                                ${mAvatar}
                                <div class="msgr-docked-member-info">
                                    <div class="msgr-docked-member-name">${escapeHtml(m.name || m.display_name || 'Member')}${m.isSelf ? ' (you)' : ''}</div>
                                    <div class="msgr-docked-member-sub">${escapeHtml(m.department || m.role || 'Member')}</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
        `;

        document.getElementById("msgrDockedMuteBtn")?.addEventListener("click", () => {
            handleConvoAction('mute', conv.id);
            renderDockedInfoPanel(conv);
        });

        document.getElementById("msgrDockedRenameBtn")?.addEventListener("click", () => {
            handleConvoAction('rename', conv.id);
        });
    }

    /**
     * Unified message loader and renderer
     */
    async function loadAndRenderActiveMessages(conversationId) {
        if (!conversationId) return;

        const sb = getClient();
        if (!sb) return;

        try {
            const [{ data, error }, { data: partData }] = await Promise.all([
                sb.from("messages")
                    .select("*")
                    .eq("conversation_id", conversationId)
                    .order("created_at", { ascending: true })
                    .limit(200),
                sb.from("conversation_participants")
                    .select("user_id, last_read_at")
                    .eq("conversation_id", conversationId)
            ]);

            if (error) {
                console.warn("CiteFlowMessenger: Error loading messages:", error);
                return;
            }

            if (Array.isArray(partData)) {
                State.activeConversationParticipants = partData;
            }

            const messages = Array.isArray(data) ? data : [];
            State._currentActiveMessages = messages;

            const newSig = messages.map(m => m.id).join(',');
            if (State._lastRenderedMsgSig === newSig && !State._participantsChanged) {
                return;
            }
            State._lastRenderedMsgSig = newSig;
            State._lastExpRenderedMsgSig = newSig;
            State._participantsChanged = false;

            renderActiveMessagesUI(messages);

            if (messages.length > 0) {
                const newest = messages[messages.length - 1];
                const targetConv = State.conversations.find(c => String(c.id) === String(conversationId));
                if (targetConv) {
                    targetConv.lastMessage = newest;
                    targetConv.sortTime = newest.created_at || new Date().toISOString();
                }
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error fetching messages:", err);
        }
    }

    /**
     * Unified message bubble HTML builder with Sent / Delivered / Seen states and group sender avatars
     */
    function renderActiveMessagesUI(messages) {
        const panelEl = document.getElementById("msgrMessages");
        const expEl = document.getElementById("msgrExpMessages");
        if (!panelEl && !expEl) return;

        const isGroup = State.activeConversationMeta?.is_group;
        const others = State.activeConversationMeta?.others || [];
        const participants = State.activeConversationParticipants || [];

        let lastMyMsgId = null;
        for (let i = (messages || []).length - 1; i >= 0; i--) {
            if (String(messages[i].sender_id) === String(State.currentUserId)) {
                lastMyMsgId = messages[i].id;
                break;
            }
        }

        const messagesHtml = (messages || []).map((m) => {
            const mine = String(m.sender_id) === String(State.currentUserId);
            const senderObj = others.find((o) => String(o.auth_user_id) === String(m.sender_id) || String(o.id) === String(m.sender_id));
            const senderName = mine ? null : (senderObj?.name || senderObj?.display_name || 'Colleague');
            const senderAvatar = senderObj?.avatar_url;

            let seenReceiptHtml = "";
            if (mine && m.id === lastMyMsgId) {
                const msgTime = new Date(m.created_at).getTime();

                // 1. Seen State: Has the recipient opened the conversation after this message was sent?
                const seenParticipant = participants.find(p =>
                    String(p.user_id) !== String(State.currentUserId) &&
                    p.last_read_at &&
                    new Date(p.last_read_at).getTime() >= msgTime - 2000
                );

                if (seenParticipant) {
                    const seenTime = formatTime(seenParticipant.last_read_at);
                    const seenUser = others.find(o => String(o.auth_user_id) === String(seenParticipant.user_id) || String(o.id) === String(seenParticipant.user_id));
                    const seenAvatar = seenUser?.avatar_url
                        ? `<img src="${escapeHtml(seenUser.avatar_url)}" class="msgr-seen-avatar" alt="">`
                        : `<i class="fa-solid fa-circle-check"></i>`;
                    seenReceiptHtml = `<div class="msgr-seen-receipt seen" title="Seen at ${new Date(seenParticipant.last_read_at).toLocaleTimeString()}">${seenAvatar} Seen ${seenTime}</div>`;
                } else {
                    // 2. Delivered vs Sent State: Is recipient currently online in Realtime Presence?
                    const isRecipientOnline = others.some(o =>
                        (o.auth_user_id && State.onlineUserIds.has(String(o.auth_user_id))) ||
                        (o.id && State.onlineUserIds.has(String(o.id)))
                    );

                    if (isRecipientOnline) {
                        seenReceiptHtml = `<div class="msgr-seen-receipt delivered" title="Delivered"><i class="fa-solid fa-circle-check"></i> Delivered</div>`;
                    } else {
                        seenReceiptHtml = `<div class="msgr-seen-receipt sent" title="Sent"><i class="fa-regular fa-circle-check"></i> Sent</div>`;
                    }
                }
            }

            if (mine) {
                return `
                    <div class="msgr-bubble-row mine">
                        <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                        <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                        ${seenReceiptHtml}
                    </div>`;
            } else {
                const avatarBubbleHtml = isGroup ? renderAvatar(senderAvatar, senderName, false, "msgr-msg-avatar") : '';
                return `
                    <div class="msgr-bubble-row theirs">
                        <div class="msgr-bubble-group-wrapper">
                            ${avatarBubbleHtml}
                            <div class="msgr-bubble-content-col">
                                ${isGroup ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ""}
                                <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                                <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                            </div>
                        </div>
                    </div>`;
            }
        }).join("");

        if (panelEl) {
            panelEl.innerHTML = messagesHtml;
            panelEl.scrollTop = panelEl.scrollHeight;
        }
        if (expEl) {
            expEl.innerHTML = messagesHtml;
            expEl.scrollTop = expEl.scrollHeight;
        }
    }

    /**
     * Typing indicators logic via Supabase Realtime Broadcast
     */
    function triggerLocalTyping() {
        if (!State.activeConversationId || !State.messageChannel) return;

        if (!State.isTypingLocally) {
            State.isTypingLocally = true;
            broadcastTyping(true);
        }

        clearTimeout(State.localTypingTimer);
        State.localTypingTimer = setTimeout(() => {
            stopLocalTypingImmediately();
        }, 2200);
    }

    function stopLocalTypingImmediately() {
        if (State.isTypingLocally) {
            State.isTypingLocally = false;
            broadcastTyping(false);
        }
        clearTimeout(State.localTypingTimer);
    }

    function broadcastTyping(isTyping) {
        if (!State.messageChannel || !State.activeConversationId || !State.currentUserId) return;
        try {
            State.messageChannel.send({
                type: 'broadcast',
                event: 'typing',
                payload: {
                    userId: State.currentUserId,
                    userName: State.currentUserName || 'Colleague',
                    isTyping: !!isTyping
                }
            });
        } catch (_) {}
    }

    function handleRemoteTyping(payload) {
        if (!payload || String(payload.userId) === String(State.currentUserId)) return;

        const { userId, userName, isTyping } = payload;
        const panelEl = document.getElementById("msgrMessages");
        const expEl = document.getElementById("msgrExpMessages");

        const removeIndicator = () => {
            document.querySelectorAll(".msgr-typing-indicator").forEach(el => el.remove());
            State.remoteTypingTimers.delete(userId);
        };

        if (!isTyping) {
            removeIndicator();
            return;
        }

        if (!document.getElementById(`typing-${userId}`)) {
            const indicatorHtml = `
                <div class="msgr-typing-indicator" id="typing-${userId}">
                    <div class="msgr-typing-bubble">
                        <span class="msgr-dot"></span>
                        <span class="msgr-dot"></span>
                        <span class="msgr-dot"></span>
                    </div>
                    <span class="msgr-typing-text">${escapeHtml(userName)} is typing...</span>
                </div>
            `;
            if (panelEl) {
                panelEl.insertAdjacentHTML('beforeend', indicatorHtml);
                panelEl.scrollTop = panelEl.scrollHeight;
            }
            if (expEl) {
                expEl.insertAdjacentHTML('beforeend', indicatorHtml);
                expEl.scrollTop = expEl.scrollHeight;
            }
        }

        if (State.remoteTypingTimers.has(userId)) {
            clearTimeout(State.remoteTypingTimers.get(userId));
        }
        State.remoteTypingTimers.set(userId, setTimeout(removeIndicator, 3500));
    }

    /**
     * Unified message sender
     */
    async function submitChatMessage(isExpanded = false) {
        const inputId = isExpanded ? "msgrExpInput" : "msgrInput";
        const btnId = isExpanded ? "msgrExpSendBtn" : "msgrSendBtn";

        const input = document.getElementById(inputId);
        const sendBtn = document.getElementById(btnId);
        const content = input?.value.trim();

        if (!content || !State.activeConversationId || !State.currentUserId) return;

        const sb = getClient();
        if (!sb) return;

        stopLocalTypingImmediately();

        input.value = "";
        input.style.height = "auto";
        if (sendBtn) sendBtn.disabled = true;

        const activeId = State.activeConversationId;
        const nowIso = new Date().toISOString();

        try {
            const meta = State.activeConversationMeta;
            if (meta && !meta.is_group && Array.isArray(meta.others)) {
                for (const other of meta.others) {
                    const recipientUid = other.auth_user_id || other.id;
                    if (recipientUid && String(recipientUid) !== String(State.currentUserId) && String(recipientUid).includes('-')) {
                        const { error: upsertErr } = await sb.from("conversation_participants").upsert({
                            conversation_id: activeId,
                            user_id: recipientUid
                        }, { onConflict: "conversation_id,user_id" });
                        if (upsertErr) console.warn("CiteFlowMessenger: Upsert recipient participant error:", upsertErr);
                    }
                }
            }

            const { error: selfUpsertErr } = await sb.from("conversation_participants").upsert({
                conversation_id: activeId,
                user_id: State.currentUserId
            }, { onConflict: "conversation_id,user_id" });
            if (selfUpsertErr) console.warn("CiteFlowMessenger: Upsert self participant error:", selfUpsertErr);

            const { data: sentMsg, error } = await sb.from("messages").insert({
                conversation_id: activeId,
                sender_id: State.currentUserId,
                content: content
            }).select().maybeSingle();

            if (error) {
                console.warn("CiteFlowMessenger: Error sending message:", error);
                if (typeof CiteFlowModal !== 'undefined' && CiteFlowModal.toast) {
                    CiteFlowModal.toast("Failed to send message. Please try again.");
                } else {
                    showCustomToast("Failed to send message. Please try again.");
                }
                if (sendBtn) sendBtn.disabled = false;
                return;
            }

            if (sentMsg) {
                try {
                    await sb.from("conversations").update({ last_message_at: nowIso }).eq("id", activeId);
                } catch (_) {}

                const activeConv = State.conversations.find(c => String(c.id) === String(activeId));
                if (activeConv) {
                    activeConv.lastMessage = sentMsg;
                    activeConv.sortTime = nowIso;
                }

                State._lastRenderedMsgSig = null;
                State._lastExpRenderedMsgSig = null;

                await loadAndRenderActiveMessages(activeId);
                renderConversationList("");
                renderExpandedConvoList();
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error during submitChatMessage:", err);
        }

        if (sendBtn) sendBtn.disabled = false;
    }

    /**
     * Mark conversation read
     */
    async function markConversationRead(conversationId) {
        const sb = getClient();
        if (!sb || !State.currentUserId || !conversationId) return;

        State.manuallyUnreadConvoIds.delete(conversationId);
        saveUnreadState();

        try {
            await sb
                .from("conversation_participants")
                .update({ last_read_at: new Date().toISOString() })
                .eq("conversation_id", conversationId)
                .eq("user_id", State.currentUserId);
        } catch (_) {}

        State._participantsChanged = true;

        const conv = State.conversations.find((c) => String(c.id) === String(conversationId));
        if (conv) conv.unread = false;
        updateUnreadBadge();
    }

    /**
     * Real-time message receiver handler with strict privacy filtering
     */
    async function handleRealtimeMessageReceived(msg) {
        if (!msg || !msg.conversation_id) return;
        const cid = String(msg.conversation_id);

        let conv = State.conversations.find(c => String(c.id) === cid);

        if (!conv) {
            // STRICT PRIVACY: Verify current user is actually a participant before reacting
            const sb = getClient();
            if (!sb || !State.currentUserId) return;
            const { data: isParticipant } = await sb
                .from("conversation_participants")
                .select("conversation_id")
                .eq("conversation_id", msg.conversation_id)
                .eq("user_id", State.currentUserId)
                .maybeSingle();

            if (!isParticipant) {
                // Ignore message completely - current user is not a participant!
                return;
            }

            await loadConversations(false);
            return;
        }

        if (State.deletedConvoIds.has(cid)) {
            State.deletedConvoIds.delete(cid);
            saveDeletedState();
            State.archivedConvoIds.delete(cid);
            saveArchivedState();
            conv.isArchived = false;
            conv.isSoftDeleted = false;
        }

        const isFromMe = String(msg.sender_id) === String(State.currentUserId);
        const isActiveChat = String(State.activeConversationId) === cid;

        conv.lastMessage = msg;
        conv.sortTime = msg.created_at || new Date().toISOString();

        if (isActiveChat) {
            conv.unread = false;
            markConversationRead(cid);
        } else if (!isFromMe) {
            conv.unread = true;
        }

        State.conversations.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.sortTime || 0) - new Date(a.sortTime || 0);
        });

        renderConversationList(getConvoSearchFilter());
        renderExpandedConvoList();
        updateUnreadBadge();
    }

    /**
     * Real-time Active Conversation Channel (Messages + Seen Receipts + Typing Broadcast)
     */
    function subscribeToActiveConversation(conversationId) {
        const sb = getClient();
        if (!sb || !conversationId) return;

        if (State.messageChannel) {
            try {
                sb.removeChannel(State.messageChannel);
            } catch (_) {}
            State.messageChannel = null;
        }

        const channel = sb.channel(`msgr-convo-${conversationId}`);

        channel
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
                async (payload) => {
                    await loadAndRenderActiveMessages(conversationId);
                    if (payload.new) {
                        handleRealtimeMessageReceived(payload.new);
                    }
                }
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}` },
                async () => {
                    State._participantsChanged = true;
                    await loadAndRenderActiveMessages(conversationId);
                }
            )
            .on("broadcast", { event: "typing" }, ({ payload }) => {
                handleRemoteTyping(payload);
            });

        channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log(`CiteFlowMessenger: Active chat listener connected for ${conversationId}.`);
            }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.warn(`CiteFlowMessenger: Active chat listener error (${status}). Reconnecting...`);
                setTimeout(() => {
                    if (String(State.activeConversationId) === String(conversationId)) {
                        subscribeToActiveConversation(conversationId);
                    }
                }, 3000);
            }
        });

        State.messageChannel = channel;
    }

    /**
     * Real-time Global Inbox Channel with graceful reconnect
     */
    function subscribeToInbox() {
        const sb = getClient();
        if (!sb || !State.currentUserId) return;

        if (State.inboxChannel) {
            try {
                sb.removeChannel(State.inboxChannel);
            } catch (_) {}
            State.inboxChannel = null;
        }

        const channel = sb.channel(`msgr-inbox-${State.currentUserId}`);

        channel
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages" },
                (payload) => {
                    if (payload?.new) {
                        handleRealtimeMessageReceived(payload.new);
                    }
                }
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations" },
                () => {
                    loadConversations(false);
                }
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversation_participants" },
                () => {
                    loadConversations(false);
                }
            );

        channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("CiteFlowMessenger: Inbox realtime listener connected.");
            }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                console.warn(`CiteFlowMessenger: Inbox listener status: ${status}. Scheduling recovery...`);
                clearTimeout(State.reconnectTimer);
                State.reconnectTimer = setTimeout(() => {
                    subscribeToInbox();
                }, 4000);
            }
        });

        State.inboxChannel = channel;

        // Background poller safety net (runs only every 12s as a backup)
        if (!State.inboxPollingTimer) {
            State.inboxPollingTimer = setInterval(async () => {
                if (State.currentUserId && document.visibilityState === 'visible') {
                    const lastKnownMsg = State.conversations[0]?.lastMessage;
                    if (lastKnownMsg?.created_at) {
                        try {
                            const { data: newMsgs } = await sb
                                .from("messages")
                                .select("*")
                                .gt("created_at", lastKnownMsg.created_at)
                                .order("created_at", { ascending: true })
                                .limit(20);

                            if (Array.isArray(newMsgs) && newMsgs.length > 0) {
                                for (const msg of newMsgs) {
                                    handleRealtimeMessageReceived(msg);
                                }
                            }
                        } catch (_) {}
                    }
                }
            }, 12000);
        }
    }

    /**
     * Unread count badge on the floating message icon showing distinct unread conversations
     */
    function updateUnreadBadge() {
        const count = State.conversations.filter((c) => c.unread && !c.isArchived && !c.isSoftDeleted).length;
        const allBtns = document.querySelectorAll("#citeflowMessageFab, .message-btn, .msgr-fab-trigger, .msgr-launcher-btn, [data-msgr-trigger]");

        allBtns.forEach(btn => {
            let badge = btn.querySelector(".msgr-fab-badge");
            if (count === 0) {
                badge?.remove();
            } else {
                if (!badge) {
                    badge = document.createElement("div");
                    badge.className = "msgr-fab-badge";
                    btn.appendChild(badge);
                }
                badge.textContent = count > 9 ? "9+" : String(count);
            }
        });
    }

    /**
     * Directory loading for Compose modal - always fetches fresh data
     */
    async function openNewModal() {
        State.selectedNewUsers = [];
        const searchInput = document.getElementById("msgrUserSearch");
        const groupInput = document.getElementById("msgrGroupNameInput");
        if (searchInput) searchInput.value = "";
        if (groupInput) groupInput.value = "";
        document.getElementById("msgrGroupNameField")?.classList.remove("show");
        document.getElementById("msgrNewModal")?.classList.add("show");
        updateCreateBtnState();

        const resultsEl = document.getElementById("msgrUserResults");
        if (resultsEl) {
            resultsEl.innerHTML = `<div class="msgr-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading directory...</div>`;
        }

        // Always fetch fresh directory records on modal open
        State.directoryCache = await fetchDirectory(true);
        renderUserResults("");
    }

    function closeNewModal() {
        document.getElementById("msgrNewModal")?.classList.remove("show");
    }

    /**
     * Comprehensive directory search covering Faculty, Admins, and Profiles
     */
    async function fetchDirectory(forceRefresh = false) {
        const sb = getClient();
        const results = [];
        const seenEmails = new Set();
        const seenUids = new Set();

        if (State.currentUserEmail) {
            seenEmails.add(State.currentUserEmail.toLowerCase());
        }
        if (State.currentUserId) {
            seenUids.add(String(State.currentUserId));
        }

        if (sb) {
            try {
                // 1. Fetch all profiles
                const { data: profileRows } = await sb.from("profiles").select("*");
                if (Array.isArray(profileRows)) {
                    for (const p of profileRows) {
                        const emailClean = (p.email || '').trim().toLowerCase();
                        if (p.id && seenUids.has(String(p.id))) continue;
                        if (emailClean && seenEmails.has(emailClean)) continue;

                        if (p.id) seenUids.add(String(p.id));
                        if (emailClean) seenEmails.add(emailClean);

                        results.push(resolveUserIdentity({
                            ...p,
                            auth_user_id: p.id,
                            avatar_url: p.avatar_url || p.profile_photo_url
                        }));
                    }
                }
            } catch (_) {}

            try {
                // 2. Fetch all admin profiles
                const { data: adminRows } = await sb.from("admin_profiles").select("*");
                if (Array.isArray(adminRows)) {
                    for (const a of adminRows) {
                        const emailClean = (a.email || '').trim().toLowerCase();
                        if (a.id && seenUids.has(String(a.id))) continue;
                        if (emailClean && seenEmails.has(emailClean)) continue;

                        if (a.id) seenUids.add(String(a.id));
                        if (emailClean) seenEmails.add(emailClean);

                        results.push(resolveUserIdentity({
                            ...a,
                            role: 'Administrator',
                            avatar_url: a.avatar_url || a.profile_photo_url
                        }));
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching admin profiles:", e);
            }

            try {
                // 3. Fetch all faculty members (including newly registered/created ones)
                const { data: facultyRows } = await sb.from("faculty").select("*");
                if (Array.isArray(facultyRows)) {
                    for (const f of facultyRows) {
                        const emailClean = (f.email || '').trim().toLowerCase();
                        const fUid = f.auth_user_id || f.id;

                        if (fUid && seenUids.has(String(fUid))) continue;
                        if (emailClean && seenEmails.has(emailClean)) continue;

                        if (fUid) seenUids.add(String(fUid));
                        if (emailClean) seenEmails.add(emailClean);

                        results.push(resolveUserIdentity({
                            ...f,
                            auth_user_id: f.auth_user_id || (String(f.id).includes('-') ? f.id : null),
                            avatar_url: f.profile_photo_url || f.avatar_url
                        }));
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching faculty directory:", e);
            }
        }

        return results;
    }

    function renderUserResults(filter = "") {
        const el = document.getElementById("msgrUserResults");
        if (!el) return;

        const filterClean = filter.trim().toLowerCase();

        const items = (State.directoryCache || []).filter((u) => {
            const name = (u.name || u.display_name || "").toLowerCase();
            const email = (u.email || "").toLowerCase();
            const dept = (u.department || "").toLowerCase();
            const role = (u.role || "").toLowerCase();
            const pos = (u.position || "").toLowerCase();
            return !filterClean || name.includes(filterClean) || email.includes(filterClean) || dept.includes(filterClean) || role.includes(filterClean) || pos.includes(filterClean);
        });

        if (items.length === 0) {
            el.innerHTML = `<div class="msgr-empty"><i class="fa-solid fa-magnifying-glass"></i> No colleagues found matching "${escapeHtml(filter)}".</div>`;
            return;
        }

        el.innerHTML = items.map((u, idx) => {
            const userKey = String(u.auth_user_id || u.id || u.email || idx);
            const userEmail = (u.email || '').toLowerCase();
            const checked = State.selectedNewUsers.some((s) =>
                (s.auth_user_id && String(s.auth_user_id) === userKey) ||
                (s.id && String(s.id) === userKey) ||
                (s.email && s.email.toLowerCase() === userEmail)
            );
            return `
                <label class="msgr-user-row">
                    <input type="checkbox" data-uid="${escapeHtml(userKey)}" data-email="${escapeHtml(userEmail)}" ${checked ? "checked" : ""}>
                    ${renderAvatar(u.avatar_url, u.name || u.display_name, false)}
                    <div class="msgr-user-row-info">
                        <div class="name">${escapeHtml(u.name || u.display_name || u.email)}</div>
                        <div class="role">${escapeHtml(u.department || u.role || "Faculty")} • ${escapeHtml(u.position || u.role || "Member")}</div>
                    </div>
                </label>`;
        }).join("");

        el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.addEventListener("change", () => {
                const uid = String(cb.dataset.uid || '');
                const email = String(cb.dataset.email || '').toLowerCase();
                const user = State.directoryCache.find((u) => u && (
                    (u.auth_user_id && String(u.auth_user_id) === uid) ||
                    (u.id && String(u.id) === uid) ||
                    (u.email && u.email.toLowerCase() === email)
                ));

                if (cb.checked) {
                    if (user && !State.selectedNewUsers.some((s) => s && (
                        (s.auth_user_id && String(s.auth_user_id) === uid) ||
                        (s.id && String(s.id) === uid) ||
                        (s.email && s.email.toLowerCase() === email)
                    ))) {
                        State.selectedNewUsers.push(user);
                    }
                } else {
                    State.selectedNewUsers = State.selectedNewUsers.filter((s) => s && !(
                        (s.auth_user_id && String(s.auth_user_id) === uid) ||
                        (s.id && String(s.id) === uid) ||
                        (s.email && s.email.toLowerCase() === email)
                    ));
                }
                State.selectedNewUsers = State.selectedNewUsers.filter(Boolean);
                document.getElementById("msgrGroupNameField")?.classList.toggle("show", State.selectedNewUsers.length > 1);
                updateCreateBtnState();
            });
        });
    }

    function updateCreateBtnState() {
        const btn = document.getElementById("msgrCreateBtn");
        if (!btn) return;
        const checkedCount = document.querySelectorAll('#msgrUserResults input[type="checkbox"]:checked').length;
        const validCount = Math.max((State.selectedNewUsers || []).filter(Boolean).length, checkedCount);
        btn.disabled = validCount === 0;
        const hint = document.getElementById("msgrNewHint");
        if (hint) {
            hint.textContent = validCount > 1
                ? "Starting a group chat — enter a group title above."
                : "Pick a colleague to message, or multiple to create a group.";
        }
    }

    async function createConversation() {
        let validRecipients = (State.selectedNewUsers || []).filter((u) => u && (u.auth_user_id || u.id || u.email));

        if (validRecipients.length === 0) {
            const checkedInputs = Array.from(document.querySelectorAll('#msgrUserResults input[type="checkbox"]:checked'));
            for (const cb of checkedInputs) {
                const uid = String(cb.dataset.uid || '');
                const email = String(cb.dataset.email || '').toLowerCase();
                const matched = State.directoryCache.find((u) => u && (
                    (u.auth_user_id && String(u.auth_user_id) === uid) ||
                    (u.id && String(u.id) === uid) ||
                    (u.email && u.email.toLowerCase() === email)
                ));
                if (matched && !validRecipients.some(v => (v.email && v.email === matched.email) || (v.id && v.id === matched.id))) {
                    validRecipients.push(matched);
                }
            }
        }

        if (validRecipients.length === 0) {
            await CiteFlowModal.alert("Please select at least one colleague to message.", "New Message");
            return;
        }

        const sb = getClient();
        if (!sb) {
            await CiteFlowModal.alert("Database connection unavailable. Please refresh the page.", "Connection Error");
            return;
        }

        if (!State.currentUserId) {
            await resolveCurrentUser();
        }

        if (!State.currentUserId) {
            await CiteFlowModal.alert("Could not resolve your active user session. Please sign in again.", "Authentication");
            return;
        }

        const isGroup = validRecipients.length > 1;
        const groupName = document.getElementById("msgrGroupNameInput")?.value.trim();

        if (!isGroup) {
            const targetUser = validRecipients[0];
            const targetKey = String(targetUser.auth_user_id || targetUser.id || '');
            const targetEmail = (targetUser.email || '').toLowerCase();

            let existing = State.conversations.find((c) => {
                if (c.is_group) return false;
                const other = c.others?.[0];
                if (!other) return false;
                return (
                    (other.auth_user_id && String(other.auth_user_id) === targetKey) ||
                    (other.id && String(other.id) === targetKey) ||
                    (other.email && other.email.toLowerCase() === targetEmail)
                );
            });

            if (existing) {
                closeNewModal();
                activateConversation(existing, State.isExpanded);
                return;
            }
        }

        const createBtn = document.getElementById("msgrCreateBtn");
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = "Starting...";
        }

        try {
            const { data: conv, error: convError } = await sb
                .from("conversations")
                .insert({
                    is_group: isGroup,
                    name: isGroup ? (groupName || null) : null,
                    created_by: State.currentUserId
                })
                .select()
                .single();

            if (convError || !conv) {
                throw convError || new Error("Failed to initialize conversation record");
            }

            const participantRows = [
                { conversation_id: conv.id, user_id: State.currentUserId }
            ];

            for (const u of validRecipients) {
                let targetUid = u.auth_user_id;
                if (!targetUid || !String(targetUid).includes('-')) {
                    // Try resolving auth UUID from profiles by email
                    if (u.email) {
                        try {
                            const { data: prof } = await sb.from('profiles').select('id').eq('email', u.email.toLowerCase()).maybeSingle();
                            if (prof?.id) targetUid = prof.id;
                        } catch (_) {}
                    }
                    // Fallback: try resolving from resolveUserIdentity cache
                    if (!targetUid || !String(targetUid).includes('-')) {
                        const resolved = resolveUserIdentity(u);
                        targetUid = resolved.auth_user_id || resolved.id;
                    }
                    // Last resort: check faculty table for auth_user_id by name/email
                    if (!targetUid || !String(targetUid).includes('-')) {
                        if (u.email || u.name) {
                            try {
                                let q = sb.from('faculty').select('auth_user_id, id');
                                if (u.email) {
                                    q = q.eq('email', u.email.toLowerCase());
                                } else if (u.name) {
                                    q = q.eq('name', u.name);
                                }
                                const { data: fRow } = await q.maybeSingle();
                                if (fRow?.auth_user_id && String(fRow.auth_user_id).includes('-')) {
                                    targetUid = fRow.auth_user_id;
                                } else if (fRow?.id && String(fRow.id).includes('-')) {
                                    targetUid = fRow.id;
                                }
                            } catch (_) {}
                        }
                    }
                }

                if (targetUid && String(targetUid).includes('-')) {
                    participantRows.push({
                        conversation_id: conv.id,
                        user_id: targetUid
                    });
                } else {
                    console.warn("CiteFlowMessenger: Could not resolve auth UUID for recipient:", u.name || u.email, "targetUid=", targetUid);
                }
            }

            if (participantRows.length < 2) {
                console.warn("CiteFlowMessenger: Only", participantRows.length, "participant(s) resolved. Recipients may not have auth UUIDs.");
            }

            const { error: partErr } = await sb.from("conversation_participants").insert(participantRows);
            if (partErr) {
                console.error("CiteFlowMessenger: Error inserting participants:", partErr);
            }

            const targetDisplayName = isGroup
                ? (groupName || conv.name || "Group Chat")
                : (validRecipients[0]?.name || validRecipients[0]?.display_name || "Colleague");

            const createdObj = {
                id: conv.id,
                is_group: isGroup,
                name: conv.name || groupName || null,
                others: validRecipients,
                displayName: targetDisplayName,
                unread: false,
                lastMessage: null,
                isPinned: false,
                isArchived: false,
                sortTime: new Date().toISOString()
            };

            saveConvoMeta(conv.id, {
                others: validRecipients,
                displayName: targetDisplayName
            });

            State.conversations = [createdObj, ...State.conversations.filter(c => c.id !== conv.id)];
            renderConversationList("");
            renderExpandedConvoList();
            closeNewModal();

            activateConversation(createdObj, State.isExpanded);
        } catch (e) {
            console.error("CiteFlowMessenger: Conversation creation exception:", e);
            await CiteFlowModal.alert("Could not start conversation: " + (e.message || "Database error"), "Error");
        } finally {
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = "Start Conversation";
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    function formatTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    // =========================================================================
    //  FEATURE 1: CONVERSATION CONTEXT MENU (More Options ⋯)
    // =========================================================================
    function closeConvoDropdown() {
        const dropdown = document.getElementById("msgrDropdown");
        if (dropdown) {
            dropdown.style.display = "none";
            dropdown.className = "msgr-dropdown";
        }
        document.querySelectorAll(".msgr-convo.msgr-convo-target").forEach(el => el.classList.remove("msgr-convo-target"));
        State.openDropdownId = null;
    }

    function showConvoDropdown(convoId, anchorBtn) {
        const dropdown = document.getElementById("msgrDropdown");
        if (!dropdown) return;

        closeConvoDropdown();

        const conv = State.conversations.find(c => String(c.id) === String(convoId)) || {
            id: convoId,
            displayName: "Chat Options",
            is_group: false,
            unread: false
        };
        State.openDropdownId = convoId;

        const rowEl = anchorBtn.closest(".msgr-convo");
        if (rowEl) rowEl.classList.add("msgr-convo-target");

        const isGroup = conv.is_group;
        const isUnread = conv.unread;
        const isPinned = conv.isPinned;
        const isArchivedMode = Boolean(conv.isArchived || conv.isSoftDeleted || State.activeFilter === "archived");

        dropdown.innerHTML = `
            <div class="msgr-dropdown-menu">
                <button class="msgr-dropdown-item" data-action="toggle-pin">
                    <i class="fa-solid fa-thumbtack"></i>
                    ${isPinned ? 'Unpin chat' : 'Pin chat'}
                </button>
                <button class="msgr-dropdown-item" data-action="toggle-unread">
                    <i class="fa-solid ${isUnread ? 'fa-envelope-open' : 'fa-envelope'}"></i>
                    ${isUnread ? 'Mark as read' : 'Mark as unread'}
                </button>
                <button class="msgr-dropdown-item" data-action="open">
                    <i class="fa-solid fa-comment-dots"></i>
                    Open messaging
                </button>
                <button class="msgr-dropdown-item" data-action="mute">
                    <i class="fa-solid fa-bell-slash"></i>
                    Mute notifications
                </button>
                <div class="msgr-dropdown-divider"></div>
                <button class="msgr-dropdown-item" data-action="${isArchivedMode ? 'unarchive' : 'archive'}">
                    <i class="fa-solid ${isArchivedMode ? 'fa-box-open' : 'fa-box-archive'}"></i>
                    ${isArchivedMode ? 'Unarchive chat' : 'Archive chat'}
                </button>
                <button class="msgr-dropdown-item msgr-dropdown-danger" data-action="delete">
                    <i class="fa-solid fa-trash-can"></i>
                    Delete chat
                </button>
                <button class="msgr-dropdown-item" data-action="report">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Report
                </button>
                ${isGroup ? `<div class="msgr-dropdown-divider"></div>
                <button class="msgr-dropdown-item msgr-dropdown-danger" data-action="leave">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    Leave group
                </button>` : ''}
            </div>
        `;

        dropdown.style.position = "fixed";
        dropdown.style.display = "block";
        dropdown.style.zIndex = "10060";

        const rect = anchorBtn.getBoundingClientRect();
        const dropdownHeight = 280;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
            dropdown.style.top = Math.max(10, (rect.top - dropdownHeight - 6)) + "px";
            dropdown.className = "msgr-dropdown arrow-down";
        } else {
            dropdown.style.top = (rect.bottom + 6) + "px";
            dropdown.className = "msgr-dropdown arrow-up";
        }

        const rightEdge = window.innerWidth - rect.right;
        dropdown.style.right = Math.max(10, rightEdge) + "px";
        dropdown.style.left = "auto";

        dropdown.querySelectorAll(".msgr-dropdown-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                handleConvoAction(item.dataset.action, convoId);
                closeConvoDropdown();
            });
        });
    }

    function showHeaderOptionsDropdown(anchorBtn) {
        const dropdown = document.getElementById("msgrDropdown");
        if (!dropdown) return;

        closeConvoDropdown();

        const validArchived = State.conversations.filter(c => c.isArchived);
        const archivedCount = validArchived.length;

        dropdown.innerHTML = `
            <div class="msgr-dropdown-menu">
                <button class="msgr-dropdown-item" data-header-action="archived">
                    <i class="fa-solid fa-box-archive"></i>
                    Archived chats ${archivedCount > 0 ? `<span class="msgr-dropdown-badge">${archivedCount}</span>` : ''}
                </button>
                <button class="msgr-dropdown-item" data-header-action="mute-all">
                    <i class="fa-solid fa-bell-slash"></i>
                    Mute notifications
                </button>
                <div class="msgr-dropdown-divider"></div>
                <button class="msgr-dropdown-item" data-header-action="status">
                    <i class="fa-solid fa-circle" style="color: #22c55e; font-size: 0.65rem;"></i>
                    Active status: Online
                </button>
            </div>
        `;

        dropdown.style.position = "fixed";
        dropdown.style.display = "block";
        dropdown.style.zIndex = "10060";
        dropdown.className = "msgr-dropdown arrow-up";

        const rect = anchorBtn.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 6) + "px";
        const rightEdge = window.innerWidth - rect.right;
        dropdown.style.right = Math.max(10, rightEdge) + "px";
        dropdown.style.left = "auto";

        dropdown.querySelectorAll(".msgr-dropdown-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = item.dataset.headerAction;
                closeConvoDropdown();
                if (action === 'archived') {
                    openArchivedModal();
                } else if (action === 'mute-all') {
                    CiteFlowModal.toast('All notifications muted.');
                } else if (action === 'status') {
                    CiteFlowModal.toast('Active status is set to Online.');
                }
            });
        });
    }

    function openArchivedModal() {
        let modal = document.getElementById("msgrArchivedModal");
        if (!modal) {
            mountDOM();
            modal = document.getElementById("msgrArchivedModal");
        }

        const body = document.getElementById("msgrArchivedBody");
        if (!body) return;

        modal.style.display = "flex";
        modal.classList.add("show");

        const archivedItems = State.conversations.filter(c => c.isArchived);

        if (archivedItems.length === 0) {
            body.innerHTML = `<div class="msgr-empty"><i class="fa-regular fa-folder-open"></i> No archived chats</div>`;
        } else {
            body.innerHTML = archivedItems.map(c => {
                const avatarHtml = renderAvatar(c.is_group ? null : c.others[0]?.avatar_url, c.displayName, c.is_group);
                return `
                    <div class="msgr-convo" data-id="${c.id}" style="cursor:pointer;">
                        ${avatarHtml}
                        <div class="msgr-convo-info">
                            <div class="msgr-convo-name">${escapeHtml(c.displayName)}</div>
                            <div class="msgr-convo-preview">Archived conversation</div>
                        </div>
                        <div class="msgr-convo-meta">
                            <button type="button" class="msgr-unarchive-btn" data-id="${c.id}" title="Unarchive chat">
                                <i class="fa-solid fa-box-open"></i> Unarchive
                            </button>
                        </div>
                    </div>`;
            }).join('');

            body.querySelectorAll('.msgr-convo').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.msgr-unarchive-btn')) return;
                    const cid = row.dataset.id;
                    const conv = State.conversations.find(c => String(c.id) === String(cid));
                    if (conv) {
                        closeArchivedModal();
                        activateConversation(conv, State.isExpanded);
                    }
                });
            });

            body.querySelectorAll('.msgr-unarchive-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cid = btn.dataset.id;
                    State.archivedConvoIds.delete(cid);
                    saveArchivedState();
                    State.deletedConvoIds.delete(String(cid));
                    saveDeletedState();
                    const conv = State.conversations.find(c => String(c.id) === String(cid));
                    if (conv) {
                        conv.isArchived = false;
                        conv.isSoftDeleted = false;
                    }
                    openArchivedModal();
                    renderConversationList("");
                    renderExpandedConvoList();
                    CiteFlowModal.toast('Chat restored from Archive');
                });
            });
        }
    }

    function closeArchivedModal() {
        const modal = document.getElementById("msgrArchivedModal");
        if (modal) {
            modal.classList.remove("show");
            modal.style.display = "none";
        }
    }

    async function handleConvoAction(action, convoId) {
        const sb = getClient();
        const conv = State.conversations.find(c => String(c.id) === String(convoId));
        if (!conv && action !== 'close') return;

        switch (action) {
            case 'toggle-pin':
                if (conv.isPinned) {
                    State.pinnedConvoIds.delete(convoId);
                    conv.isPinned = false;
                } else {
                    State.pinnedConvoIds.add(convoId);
                    conv.isPinned = true;
                }
                savePinnedState();
                State.conversations.sort((a, b) => {
                    if (a.isPinned && !b.isPinned) return -1;
                    if (!a.isPinned && b.isPinned) return 1;
                    return new Date(b.sortTime) - new Date(a.sortTime);
                });
                renderConversationList(getConvoSearchFilter());
                renderExpandedConvoList();
                break;
            case 'toggle-unread':
                if (conv.unread) {
                    await markConversationRead(convoId);
                } else {
                    State.manuallyUnreadConvoIds.add(convoId);
                    saveUnreadState();
                    conv.unread = true;
                    if (sb && State.currentUserId) {
                        try {
                            await sb.from("conversation_participants")
                                .update({ last_read_at: "1970-01-01T00:00:00Z" })
                                .eq("conversation_id", convoId)
                                .eq("user_id", State.currentUserId);
                        } catch (_) {}
                    }
                    renderConversationList(getConvoSearchFilter());
                    renderExpandedConvoList();
                    updateUnreadBadge();
                }
                break;
            case 'open':
                activateConversation(conv, State.isExpanded);
                break;
            case 'mute':
                if (State.mutedConvoIds.has(convoId)) {
                    State.mutedConvoIds.delete(convoId);
                    saveMutedState();
                    showCustomToast('Notifications unmuted for this chat');
                } else {
                    State.mutedConvoIds.add(convoId);
                    saveMutedState();
                    showCustomToast('Notifications muted for this chat');
                }
                break;
            case 'rename':
            case 'customize':
                const currentName = conv.displayName || '';
                const newName = await CiteFlowModal.prompt('Enter a new name or nickname for this chat:', currentName, 'Rename Chat');
                if (newName && newName.trim() && newName.trim() !== currentName) {
                    const cleanName = newName.trim();
                    conv.displayName = cleanName;
                    conv.isCustomNickname = true;
                    conv.customNickname = cleanName;
                    saveConvoMeta(convoId, { displayName: cleanName, customNickname: cleanName });
                    if (sb && conv.is_group) {
                        try {
                            await sb.from('conversations').update({ name: cleanName }).eq('id', convoId);
                        } catch (_) {}
                    }
                    renderConversationList(getConvoSearchFilter());
                    renderExpandedConvoList();
                    if (State.activeConversationId === convoId) {
                        const nameEl = document.getElementById("msgrChatName");
                        if (nameEl) nameEl.textContent = cleanName;
                        const expNameEl = document.getElementById("msgrExpChatName");
                        if (expNameEl) expNameEl.textContent = cleanName;
                        renderExpandedInfoPanel(conv);
                    }
                }
                break;
            case 'archive':
                State.archivedConvoIds.add(String(convoId));
                saveArchivedState();
                if (conv) conv.isArchived = true;
                if (State.activeConversationId === convoId) closeActiveChat();
                renderConversationList("");
                renderExpandedConvoList();
                updateUnreadBadge();
                showCustomToast('Chat moved to Archive');
                break;
            case 'unarchive':
                State.archivedConvoIds.delete(String(convoId));
                State.deletedConvoIds.delete(String(convoId));
                saveArchivedState();
                saveDeletedState();
                if (conv) {
                    conv.isArchived = false;
                    conv.isSoftDeleted = false;
                }
                renderConversationList("");
                renderExpandedConvoList();
                updateUnreadBadge();
                showCustomToast('Chat restored from Archive');
                break;
            case 'delete':
                const confirmed = await CiteFlowModal.confirm(
                    'Delete this chat for you? The conversation will be moved to Archive and can be restored anytime. Other participants will not be affected.',
                    'Delete Chat',
                    { isDanger: true, confirmText: 'Delete' }
                );
                if (confirmed) {
                    State.deletedConvoIds.add(String(convoId));
                    saveDeletedState();
                    State.archivedConvoIds.add(String(convoId));
                    saveArchivedState();
                    if (conv) {
                        conv.isArchived = true;
                        conv.isSoftDeleted = true;
                    }
                    if (State.activeConversationId === convoId) closeActiveChat();
                    renderConversationList("");
                    renderExpandedConvoList();
                    updateUnreadBadge();
                    showCustomToast('Chat moved to Archive');
                }
                break;
            case 'report':
                await CiteFlowModal.alert('This conversation has been reported to administration. Thank you.', 'Report Chat');
                break;
            case 'leave':
                const leaveConfirmed = await CiteFlowModal.confirm(
                    'Leave this group? You will no longer receive messages.',
                    'Leave Group',
                    { isDanger: true, confirmText: 'Leave' }
                );
                if (leaveConfirmed) {
                    try {
                        if (sb) {
                            await sb.from('conversation_participants').delete()
                                .eq('conversation_id', convoId)
                                .eq('user_id', State.currentUserId);
                        }
                        State.conversations = State.conversations.filter(c => c.id !== convoId);
                        if (State.activeConversationId === convoId) closeActiveChat();
                        renderConversationList("");
                        renderExpandedConvoList();
                        updateUnreadBadge();
                        showCustomToast('Left group conversation');
                    } catch (e) {
                        await CiteFlowModal.alert('Could not leave group: ' + (e.message || 'Database error'), 'Error');
                    }
                }
                break;
        }
    }

    // =========================================================================
    //  FEATURE 2: ENHANCED SEARCH (Conversations + Directory People)
    // =========================================================================
    async function handleEnhancedSearch(query) {
        const searchResults = document.getElementById("msgrSearchResults");
        const list = document.getElementById("msgrList");
        const filterTabs = document.getElementById("msgrFilterTabs");

        if (!query) {
            if (searchResults) searchResults.style.display = "none";
            if (list) list.style.display = "";
            if (filterTabs) filterTabs.style.display = "";
            renderConversationList("");
            return;
        }

        if (list) list.style.display = "none";
        if (filterTabs) filterTabs.style.display = "none";
        if (searchResults) searchResults.style.display = "block";

        const q = query.toLowerCase();

        const matchingConvos = State.conversations.filter(c =>
            c.displayName.toLowerCase().includes(q)
        );

        if (!State.directoryCache || State.directoryCache.length === 0) {
            State.directoryCache = await fetchDirectory(true);
        }

        const matchingPeople = (State.directoryCache || []).filter(u => {
            if (!u) return false;
            const name = (u.name || u.display_name || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const dept = (u.department || '').toLowerCase();
            const role = (u.role || '').toLowerCase();
            const pos = (u.position || '').toLowerCase();
            return name.includes(q) || email.includes(q) || dept.includes(q) || role.includes(q) || pos.includes(q);
        });

        let html = '';

        if (matchingConvos.length > 0) {
            html += `<div class="msgr-search-section-label">Conversations</div>`;
            html += matchingConvos.map(c => {
                const avatarHtml = renderAvatar(c.is_group ? null : c.others[0]?.avatar_url, c.displayName, c.is_group);
                const preview = c.lastMessage
                    ? (c.lastMessage.sender_id === State.currentUserId ? 'You: ' : '') + escapeHtml(c.lastMessage.content)
                    : 'No messages yet';
                const time = c.lastMessage ? formatTime(c.lastMessage.created_at) : '';
                return `
                    <div class="msgr-convo msgr-search-item" data-id="${c.id}" data-type="convo">
                        ${avatarHtml}
                        <div class="msgr-convo-info">
                            <div class="msgr-convo-name">${escapeHtml(c.displayName)}</div>
                            <div class="msgr-convo-preview">${preview} ${time ? '<span class="msgr-convo-time-inline"> · ' + time + '</span>' : ''}</div>
                        </div>
                    </div>`;
            }).join('');
        }

        if (matchingPeople.length > 0) {
            html += `<div class="msgr-search-section-label">People</div>`;
            html += matchingPeople.map(u => {
                const avatarHtml = renderAvatar(u.avatar_url, u.name || u.display_name, false);
                return `
                    <div class="msgr-convo msgr-search-item" data-uid="${u.auth_user_id || u.id}" data-type="person">
                        ${avatarHtml}
                        <div class="msgr-convo-info">
                            <div class="msgr-convo-name">${escapeHtml(u.name || u.display_name || u.email)}</div>
                            <div class="msgr-convo-preview">${escapeHtml(u.department || u.role || 'Faculty')} • ${escapeHtml(u.position || u.role || 'Member')}</div>
                        </div>
                    </div>`;
            }).join('');
        }

        if (!html) {
            html = `<div class="msgr-empty"><i class="fa-solid fa-magnifying-glass"></i> No results for "${escapeHtml(query)}"</div>`;
        }

        searchResults.innerHTML = html;

        searchResults.querySelectorAll(".msgr-search-item").forEach(el => {
            el.addEventListener("click", async () => {
                const targetId = el.dataset.id;
                const targetUid = el.dataset.uid;
                if (el.dataset.type === 'convo') {
                    const conv = State.conversations.find(c => String(c.id) === String(targetId));
                    if (conv) {
                        const searchInput = document.getElementById("msgrConvoSearch") || document.getElementById("msgrExpSearch");
                        if (searchInput) searchInput.value = '';
                        handleEnhancedSearch('');
                        activateConversation(conv, State.isExpanded);
                    }
                } else if (el.dataset.type === 'person') {
                    const user = State.directoryCache.find(u =>
                        (u.auth_user_id && String(u.auth_user_id) === String(targetUid)) ||
                        (u.id && String(u.id) === String(targetUid)) ||
                        (u.email && u.email.toLowerCase() === String(targetUid).toLowerCase())
                    );
                    if (user) {
                        const searchInput = document.getElementById("msgrConvoSearch") || document.getElementById("msgrExpSearch");
                        if (searchInput) searchInput.value = '';
                        handleEnhancedSearch('');

                        const targetKey = String(user.auth_user_id || user.id || '');
                        const targetEmail = (user.email || '').toLowerCase();
                        const existing = State.conversations.find(c => !c.is_group && (c.others || []).some(o =>
                            (targetKey && String(o.auth_user_id) === targetKey) ||
                            (targetKey && String(o.id) === targetKey) ||
                            (targetEmail && o.email && o.email.toLowerCase() === targetEmail)
                        ));

                        if (existing) {
                            if (State.deletedConvoIds.has(String(existing.id))) {
                                State.deletedConvoIds.delete(String(existing.id));
                                saveDeletedState();
                            }
                            activateConversation(existing, State.isExpanded);
                        } else {
                            State.selectedNewUsers = [user];
                            await createConversation();
                        }
                    }
                }
            });
        });
    }

    // =========================================================================
    //  FEATURE 3: EXPANDED MESSENGER VIEW
    // =========================================================================
    function openExpandedView() {
        closePanel();
        State.isExpanded = true;

        let expEl = document.getElementById("msgrExpanded");
        if (!expEl) {
            mountDOM();
            expEl = document.getElementById("msgrExpanded");
        }

        if (expEl) expEl.style.display = "flex";
        document.body.style.overflow = "hidden";
        renderExpandedConvoList();
    }

    function closeExpandedView() {
        State.isExpanded = false;
        const expEl = document.getElementById("msgrExpanded");
        if (expEl) expEl.style.display = "none";
        document.body.style.overflow = "";
        State.activeConversationId = null;
        State.activeConversationMeta = null;
        State._currentActiveMessages = [];
    }

    function renderExpandedConvoList() {
        const listEl = document.getElementById("msgrExpList");
        if (!listEl) return;

        const search = (document.getElementById("msgrExpSearch")?.value || "").trim().toLowerCase();
        let items = State.conversations.filter(c => !c.isArchived);
        items = items.filter(c => !search || c.displayName.toLowerCase().includes(search));

        const tabFilter = State.activeFilter || "all";
        if (tabFilter === "unread") items = items.filter(c => c.unread);
        else if (tabFilter === "groups") items = items.filter(c => c.is_group);
        else if (tabFilter === "archived") items = State.conversations.filter(c => c.isArchived);

        if (items.length === 0) {
            listEl.innerHTML = `<div class="msgr-empty"><i class="fa-regular fa-comments"></i> No conversations</div>`;
            return;
        }

        listEl.innerHTML = items.map(c => {
            const safeOthers = (c.others || []).filter(o =>
                String(o.auth_user_id) !== String(State.currentUserId) &&
                String(o.id) !== String(State.currentUserId)
            );
            const avatarHtml = renderAvatar(c.is_group ? null : safeOthers[0]?.avatar_url, c.displayName, c.is_group);
            const preview = c.lastMessage
                ? (String(c.lastMessage.sender_id) === String(State.currentUserId) ? 'You: ' : '') + escapeHtml(c.lastMessage.content)
                : 'No messages yet';
            const time = c.lastMessage ? formatTime(c.lastMessage.created_at) : '';
            const unreadClass = c.unread ? ' unread' : '';
            const activeClass = String(State.activeConversationId) === String(c.id) ? ' active' : '';
            return `
                <div class="msgr-convo${unreadClass}${activeClass}" data-id="${c.id}">
                    ${avatarHtml}
                    <div class="msgr-convo-info">
                        <div class="msgr-convo-name">${c.isPinned ? '<i class="fa-solid fa-thumbtack msgr-pin-icon" title="Pinned"></i> ' : ''}${escapeHtml(c.displayName)}</div>
                        <div class="msgr-convo-preview">${preview} ${time ? '<span class="msgr-convo-time-inline"> · ' + time + '</span>' : ''}</div>
                    </div>
                    <div class="msgr-convo-meta">
                        <button type="button" class="msgr-convo-options" data-convoid="${c.id}" title="More options">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                        ${c.unread ? '<div class="msgr-unread-dot"></div>' : ""}
                    </div>
                </div>`;
        }).join('');

        listEl.querySelectorAll('.msgr-convo').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.msgr-convo-options')) return;
                const conv = State.conversations.find(c => String(c.id) === String(el.dataset.id));
                if (conv) activateConversation(conv, true);
            });
        });
    }

    function renderExpandedInfoPanel(conv) {
        const inner = document.getElementById("msgrExpInfoInner");
        if (!inner || !conv) return;

        const isGroup = conv.is_group;
        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId)
        );

        const meta = getConvoMeta(conv.id);
        let displayName = meta?.customNickname || conv.displayName;
        if (!isGroup && safeOthers.length > 0 && !meta?.customNickname) {
            displayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        }

        const otherAvatarUrl = (safeOthers.length > 0 && !isGroup) ? safeOthers[0].avatar_url : null;
        const allMembers = [
            { name: 'You', department: State.currentUserRole, isSelf: true, avatar_url: State.currentUserAvatar },
            ...safeOthers
        ];
        const isMuted = State.mutedConvoIds.has(conv.id);

        const avatarHtml = renderAvatar(isGroup ? null : otherAvatarUrl, displayName, isGroup)
            .replace('class="msgr-avatar', 'class="msgr-avatar msgr-exp-info-avatar');

        inner.innerHTML = `
            <div class="msgr-exp-info-profile">
                ${avatarHtml}
                <h3>${escapeHtml(displayName)}</h3>
            </div>
            <div class="msgr-exp-info-actions">
                <button class="msgr-exp-info-action-btn" id="msgrExpMuteBtn" title="${isMuted ? 'Unmute' : 'Mute'}">
                    <i class="fa-solid ${isMuted ? 'fa-bell-slash' : 'fa-bell'}"></i>
                    <span>${isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button class="msgr-exp-info-action-btn" id="msgrExpCustomizeBtn" title="Customize">
                    <i class="fa-solid fa-pen"></i>
                    <span>Edit Name</span>
                </button>
            </div>
            <details class="msgr-exp-info-section" open>
                <summary>Chat info</summary>
                <div class="msgr-exp-info-detail">
                    <span>Type:</span> ${isGroup ? 'Group Chat' : 'Direct Message'}
                </div>
                ${!isGroup && safeOthers[0]?.department ? `
                <div class="msgr-exp-info-detail">
                    <span>Department:</span> ${escapeHtml(safeOthers[0].department)}
                </div>` : ''}
            </details>
            <details class="msgr-exp-info-section" ${isGroup ? 'open' : ''}>
                <summary>Chat members (${allMembers.length})</summary>
                <div class="msgr-exp-members">
                    ${allMembers.map(m => {
                        const memberAvatar = renderAvatar(m.avatar_url, m.name || m.display_name || 'Member', false);
                        const roleDesc = m.department || m.role || (m.isSelf ? State.currentUserRole : 'Member');
                        return `
                            <div class="msgr-exp-member-row">
                                ${memberAvatar}
                                <div class="msgr-exp-member-info">
                                    <div class="msgr-exp-member-name">${escapeHtml(m.name || m.display_name || 'Member')}${m.isSelf ? ' (you)' : ''}</div>
                                    <div class="msgr-exp-member-sub">${escapeHtml(roleDesc)}</div>
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </details>
        `;

        document.getElementById("msgrExpMuteBtn")?.addEventListener("click", () => {
            handleConvoAction('mute', conv.id);
            renderExpandedInfoPanel(conv);
        });

        document.getElementById("msgrExpCustomizeBtn")?.addEventListener("click", () => {
            handleConvoAction('rename', conv.id);
        });
    }

    // Auto-mount on DOM ready
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                init();
            });
        } else {
            init();
        }
    }

    return {
        init,
        openMessages: openPanel,
        openPanel,
        closeMessages: closePanel,
        closePanel,
        loadConversations,
        sendMessage: () => submitChatMessage(false),
        openExpandedView,
        closeExpandedView,
        activateConversation
    };
})();

// Global alias for compatibility
window.openMessages = function () {
    window.CiteFlowMessenger?.openMessages();
};
