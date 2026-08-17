// ==============================================================================
// CITE-Flow Universal Messenger Engine
// Works seamlessly on Admin and Faculty portals with real-time Supabase sync
// ==============================================================================

window.CiteFlowMessenger = (function () {
    const State = {
        currentUserId: null,
        currentUserEmail: null,
        currentUserRole: null,
        conversations: [],
        activeConversationId: null,
        activeConversationMeta: null,
        directoryCache: [],
        selectedNewUsers: [],
        messageChannel: null,
        inboxChannel: null,
        mounted: false,
        initialized: false,
        activeFilter: "all",
        isExpanded: false,
        openDropdownId: null,
        pinnedConvoIds: new Set(JSON.parse(localStorage.getItem('citeflow_pinned_convos') || '[]')),
        archivedConvoIds: new Set(JSON.parse(localStorage.getItem('citeflow_archived_convos') || '[]')),
        manuallyUnreadConvoIds: new Set(JSON.parse(localStorage.getItem('citeflow_unread_convos') || '[]'))
    };

    function savePinnedState() {
        localStorage.setItem('citeflow_pinned_convos', JSON.stringify(Array.from(State.pinnedConvoIds)));
    }
    function saveArchivedState() {
        localStorage.setItem('citeflow_archived_convos', JSON.stringify(Array.from(State.archivedConvoIds)));
    }
    function saveUnreadState() {
        localStorage.setItem('citeflow_unread_convos', JSON.stringify(Array.from(State.manuallyUnreadConvoIds)));
    }

    function saveConvoMeta(convoId, meta) {
        try {
            const saved = JSON.parse(localStorage.getItem('citeflow_convo_metas') || '{}');
            saved[convoId] = meta;
            localStorage.setItem('citeflow_convo_metas', JSON.stringify(saved));
        } catch (_) {}
    }

    function getConvoMeta(convoId) {
        try {
            const saved = JSON.parse(localStorage.getItem('citeflow_convo_metas') || '{}');
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
                        </div>

                        <div class="msgr-messages" id="msgrMessages"></div>

                        <div class="msgr-composer">
                            <textarea id="msgrInput" rows="1" placeholder="Type a message..."></textarea>
                            <button type="button" class="msgr-send-btn" id="msgrSendBtn" disabled>
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
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

                <div class="msgr-new-modal" id="msgrNewModal">
                    <div class="msgr-new-card">
                        <div class="msgr-new-header">
                            <h3><i class="fa-solid fa-user-plus"></i> New Message</h3>
                            <button type="button" class="msgr-icon-btn" id="msgrNewCloseBtn" style="color:#64748b; background:#f1f5f9;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="msgr-new-body">
                            <input type="text" id="msgrUserSearch" placeholder="Search by name, email, or department...">
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

        // Enhanced search: shows conversations + directory people
        document.getElementById("msgrConvoSearch")?.addEventListener("input", (e) => {
            handleEnhancedSearch(e.target.value.trim());
        });
        document.getElementById("msgrConvoSearch")?.addEventListener("focus", (e) => {
            if (e.target.value.trim()) handleEnhancedSearch(e.target.value.trim());
        });

        // Filter tabs (All, Unread, Groups)
        document.querySelectorAll(".msgr-filter-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".msgr-filter-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                State.activeFilter = tab.dataset.filter || "all";
                renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
            });
        });

        // Expand messenger
        document.getElementById("msgrExpandBtn")?.addEventListener("click", openExpandedView);
        document.getElementById("msgrCollapseBtn")?.addEventListener("click", closeExpandedView);
        document.getElementById("msgrExpNewBtn")?.addEventListener("click", openNewModal);

        // Expanded view filter tabs
        document.querySelectorAll("#msgrExpanded .msgr-filter-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                document.querySelectorAll("#msgrExpanded .msgr-filter-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                State.activeFilter = tab.dataset.filter || "all";
                renderExpandedConvoList();
            });
        });

        // Expanded search
        document.getElementById("msgrExpSearch")?.addEventListener("input", () => renderExpandedConvoList());

        // Expanded composer
        const expInput = document.getElementById("msgrExpInput");
        const expSendBtn = document.getElementById("msgrExpSendBtn");
        expInput?.addEventListener("input", () => {
            expInput.style.height = "auto";
            expInput.style.height = Math.min(expInput.scrollHeight, 100) + "px";
            expSendBtn.disabled = expInput.value.trim().length === 0;
        });
        expInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessageExpanded(); }
        });
        expSendBtn?.addEventListener("click", sendMessageExpanded);

        document.getElementById("msgrNewBtn")?.addEventListener("click", openNewModal);
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

        const input = document.getElementById("msgrInput");
        const sendBtn = document.getElementById("msgrSendBtn");

        input?.addEventListener("input", () => {
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 100) + "px";
            sendBtn.disabled = input.value.trim().length === 0;
        });

        input?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sendBtn?.addEventListener("click", sendMessage);
    }

    /**
     * Ensure current session is resolved
     */
    async function resolveCurrentUser() {
        const sb = getClient();
        if (!sb) return false;

        try {
            const { data: { session } } = await sb.auth.getSession();
            if (session?.user) {
                State.currentUserId = session.user.id;
                State.currentUserEmail = (session.user.email || '').toLowerCase();
                State.currentUserRole = session.user.user_metadata?.role || 'Faculty';
                return true;
            }

            // Fallback: Check citeflow_user cache
            const cached = localStorage.getItem('citeflow_user');
            if (cached) {
                const parsed = JSON.parse(cached);
                State.currentUserId = parsed.id;
                State.currentUserEmail = (parsed.email || '').toLowerCase();
                State.currentUserRole = parsed.role || 'Faculty';
                return true;
            }
        } catch (e) {
            console.warn("CiteFlowMessenger: Error resolving user session:", e);
        }
        return false;
    }

    /**
     * Initialize current user and start real-time listener
     */
    async function init() {
        mountDOM();
        const hasUser = await resolveCurrentUser();
        if (hasUser) {
            await loadConversations();
            subscribeToInbox();
            State.initialized = true;
        }
    }

    async function openPanel() {
        mountDOM();
        document.getElementById("msgrPanel")?.classList.add("show");
        document.getElementById("msgrBackdrop")?.classList.add("show");
        
        await resolveCurrentUser();
        await loadConversations();
    }

    function closePanel() {
        closeConvoDropdown();
        document.getElementById("msgrPanel")?.classList.remove("show");
        document.getElementById("msgrBackdrop")?.classList.remove("show");
        closeActiveChat();
    }

    function closeActiveChat() {
        closeConvoDropdown();
        document.getElementById("msgrChat")?.classList.remove("show");
        State.activeConversationId = null;
        State.activeConversationMeta = null;
        if (State.messageChannel) {
            const sb = getClient();
            sb?.removeChannel(State.messageChannel);
            State.messageChannel = null;
        }
        renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
        renderExpandedConvoList();
    }

    function saveLocalConvos() {
        try {
            if (Array.isArray(State.conversations) && State.conversations.length > 0) {
                localStorage.setItem("citeflow_convo_cache", JSON.stringify(State.conversations));
            }
        } catch (e) {
            console.warn("Notice saving local convos:", e);
        }
    }

    function loadLocalConvos() {
        try {
            const cached = localStorage.getItem("citeflow_convo_cache");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn("Notice loading local convos:", e);
        }
        return [];
    }

    /**
     * Load all conversations for current user using resilient direct queries
     */
    async function loadConversations() {
        const sb = getClient();
        const listEl = document.getElementById("msgrList");

        if (!State.currentUserId) {
            await resolveCurrentUser();
        }

        const localCache = loadLocalConvos();

        if (!sb || !State.currentUserId) {
            if (localCache.length > 0) {
                State.conversations = localCache;
                renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
                renderExpandedConvoList();
                updateUnreadBadge();
                return;
            }
            if (listEl) {
                listEl.innerHTML = `
                    <div class="msgr-empty">
                        <i class="fa-regular fa-comments"></i>
                        No conversations yet. Click the compose icon to start chatting.
                    </div>`;
            }
            return;
        }

        try {
            // 1. Fetch conversations where user is listed as a participant
            const { data: participantRows, error: pErr } = await sb
                .from("conversation_participants")
                .select("conversation_id, last_read_at")
                .eq("user_id", State.currentUserId);

            // 2. Fetch conversations created by current user
            const { data: createdRows, error: cErr } = await sb
                .from("conversations")
                .select("*")
                .eq("created_by", State.currentUserId);

            const pMap = new Map();
            if (participantRows) {
                participantRows.forEach(r => {
                    if (r.conversation_id) pMap.set(r.conversation_id, r.last_read_at);
                });
            }

            const convoIdSet = new Set([...pMap.keys()]);
            if (createdRows) {
                createdRows.forEach(c => convoIdSet.add(c.id));
            }

            const allConvoIds = Array.from(convoIdSet).filter(Boolean);

            if (allConvoIds.length === 0) {
                State.conversations = [];
                renderConversationList("");
                updateUnreadBadge();
                return;
            }

            // 3. Fetch full conversation rows
            const { data: convData, error: convError } = await sb
                .from("conversations")
                .select("*")
                .in("id", allConvoIds);

            if (convError) throw convError;

            // 4. Fetch all participants for these conversations
            const { data: allParticipants } = await sb
                .from("conversation_participants")
                .select("conversation_id, user_id")
                .in("conversation_id", allConvoIds);

            // 5. Fetch directory users for participant resolution
            if (!State.directoryCache || State.directoryCache.length === 0) {
                State.directoryCache = await fetchDirectory();
            }

            const allOtherUserIds = Array.from(new Set(
                (allParticipants || [])
                    .map(p => p.user_id)
                    .filter(uid => uid && uid !== State.currentUserId)
            ));

            const directoryUsers = allOtherUserIds.length > 0
                ? await getDirectoryUsersByIds(allOtherUserIds)
                : [];

            const userMap = new Map();
            State.directoryCache.forEach(u => {
                if (u.auth_user_id) userMap.set(String(u.auth_user_id), u);
                if (u.id) userMap.set(String(u.id), u);
                if (u.email) userMap.set(String(u.email).toLowerCase(), u);
            });
            directoryUsers.forEach(u => {
                if (u.auth_user_id) userMap.set(String(u.auth_user_id), u);
                if (u.id) userMap.set(String(u.id), u);
            });

            // 6. Fetch latest message for each conversation
            const { data: allMessages } = await sb
                .from("messages")
                .select("conversation_id, content, created_at, sender_id")
                .in("conversation_id", allConvoIds)
                .order("created_at", { ascending: false });

            const lastMsgMap = new Map();
            if (allMessages) {
                for (const msg of allMessages) {
                    const cidStr = String(msg.conversation_id);
                    if (!lastMsgMap.has(cidStr)) {
                        lastMsgMap.set(cidStr, msg);
                    }
                }
            }

            // 7. Assemble enriched conversations
            const enriched = (convData || []).map((conv) => {
                const myLastRead = pMap.get(conv.id) || null;
                const lastMsg = lastMsgMap.get(String(conv.id)) || null;

                const convoParticipantIds = (allParticipants || [])
                    .filter(p => p.conversation_id === conv.id && p.user_id !== State.currentUserId)
                    .map(p => p.user_id);

                let resolvedOthers = convoParticipantIds.map(uid => userMap.get(uid) || {
                    id: uid,
                    auth_user_id: uid,
                    name: "Faculty Member",
                    display_name: "Faculty Member"
                });

                const meta = getConvoMeta(conv.id);
                if ((!resolvedOthers || resolvedOthers.length === 0) && meta && meta.others) {
                    resolvedOthers = meta.others;
                }

                const isManuallyUnread = State.manuallyUnreadConvoIds.has(conv.id);
                const unread = isManuallyUnread || Boolean(
                    lastMsg &&
                    lastMsg.sender_id !== State.currentUserId &&
                    (!myLastRead || new Date(lastMsg.created_at) > new Date(myLastRead))
                );

                const isPinned = State.pinnedConvoIds.has(conv.id);
                const isArchived = State.archivedConvoIds.has(conv.id);

                let displayName = conv.name || null;
                if (conv.is_group) {
                    displayName = conv.name || resolvedOthers.map(o => (o.name || o.display_name || '').split(' ')[0]).filter(Boolean).join(', ') || "Group Chat";
                } else {
                    displayName = resolvedOthers[0]?.name || resolvedOthers[0]?.display_name || (meta ? meta.displayName : null) || "Faculty Member";
                }

                if (!displayName || displayName === "Colleague") {
                    displayName = meta?.displayName || resolvedOthers[0]?.name || "Faculty Member";
                }

                return {
                    ...conv,
                    others: resolvedOthers,
                    lastMessage: lastMsg,
                    unread,
                    isPinned,
                    isArchived,
                    displayName,
                    sortTime: lastMsg?.created_at || conv.last_message_at || conv.created_at || new Date().toISOString()
                };
            });

            // Deduplicate 1:1 conversations with the same recipient
            const seenKeys = new Set();
            enriched = enriched.filter((c) => {
                const key = c.is_group 
                    ? `group_${c.id}` 
                    : `direct_${c.others?.[0]?.auth_user_id || c.others?.[0]?.id || c.others?.[0]?.email || c.id}`;
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });

            // Sort: pinned items first, then by sortTime descending
            enriched.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return new Date(b.sortTime) - new Date(a.sortTime);
            });

            // Merge with local cache so newly created conversations are never lost
            const combinedMap = new Map();
            localCache.forEach(c => { if (c && c.id) combinedMap.set(String(c.id), c); });
            enriched.forEach(c => { if (c && c.id) combinedMap.set(String(c.id), c); });

            State.conversations = Array.from(combinedMap.values());
            saveLocalConvos();

            renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
            renderExpandedConvoList();
            updateUnreadBadge();
        } catch (err) {
            console.error("CiteFlowMessenger: Error loading conversations:", err);
            if (listEl) {
                listEl.innerHTML = `
                    <div class="msgr-empty">
                        <i class="fa-regular fa-comments"></i>
                        No conversations yet. Click the compose icon to start chatting.
                    </div>`;
            }
        }
    }

    /**
     * Render conversation list items
     */
    function renderConversationList(filter = "") {
        const listEl = document.getElementById("msgrList");
        if (!listEl) return;

        // Exclude archived conversations unless explicitly viewing archived
        let activeItems = State.conversations.filter(c => !c.isArchived);

        // Apply search text filter
        let items = activeItems.filter((c) =>
            !filter || c.displayName.toLowerCase().includes(filter)
        );

        // Apply tab filter
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
            }
            listEl.innerHTML = `
                <div class="msgr-empty">
                    <i class="fa-regular fa-comments"></i>
                    ${emptyMsg}
                </div>`;
            return;
        }

        listEl.innerHTML = items.map((c) => {
            const avatarHtml = renderAvatar(c.is_group ? null : c.others[0]?.avatar_url, c.displayName, c.is_group);
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

        // Wire up click handlers
        listEl.querySelectorAll(".msgr-convo").forEach((el) => {
            el.addEventListener("click", (e) => {
                if (e.target.closest(".msgr-convo-options")) return;
                const conv = State.conversations.find((c) => String(c.id) === String(el.dataset.id));
                if (conv) openConversation(conv);
            });
        });

        // Wire up context menu buttons
        listEl.querySelectorAll(".msgr-convo-options").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                showConvoDropdown(btn.dataset.convoid, btn);
            });
        });
    }

    function renderAvatar(url, name, isGroup) {
        const cls = "msgr-avatar" + (isGroup ? " group" : "");
        if (url) {
            return `<div class="${cls}"><img src="${url}" alt="" onerror="this.parentElement.innerHTML='${initialsOf(name)}'"></div>`;
        }
        if (isGroup) {
            return `<div class="${cls}"><i class="fa-solid fa-users"></i></div>`;
        }
        return `<div class="${cls}">${initialsOf(name)}</div>`;
    }

    function initialsOf(str) {
        if (!str) return "?";
        const parts = str.trim().split(/\s+/);
        return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
    }

    /**
     * Open active chat view for conversation
     */
    async function openConversation(conv) {
        State.activeConversationId = conv.id;
        State.activeConversationMeta = conv;

        // Optimistic UI: Clear unread badge & status instantly (0ms delay)
        conv.unread = false;
        State.manuallyUnreadConvoIds.delete(conv.id);
        saveUnreadState();
        updateUnreadBadge();

        const nameEl = document.getElementById("msgrChatName");
        const subEl = document.getElementById("msgrChatSub");
        const avatarEl = document.getElementById("msgrChatAvatar");

        if (nameEl) nameEl.textContent = conv.displayName;
        if (subEl) {
            subEl.textContent = conv.is_group 
                ? `${(conv.others?.length || 0) + 1} members` 
                : (conv.others?.[0]?.department || conv.others?.[0]?.role || "Member");
        }
        if (avatarEl) {
            avatarEl.outerHTML = renderAvatar(
                conv.is_group ? null : conv.others?.[0]?.avatar_url,
                conv.displayName,
                conv.is_group
            ).replace('class="msgr-avatar', 'id="msgrChatAvatar" class="msgr-avatar');
        }

        document.getElementById("msgrChat")?.classList.add("show");
        renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");

        // Load messages and sync DB read status in parallel (non-blocking)
        loadMessages(conv.id);
        markConversationRead(conv.id);
        subscribeToActiveConversation(conv.id);
    }

    /**
     * Load messages for active conversation
     */
    async function loadMessages(conversationId) {
        const sb = getClient();
        if (!sb) return;

        const { data, error } = await sb
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(150);

        if (error) {
            console.error("CiteFlowMessenger: Error loading messages:", error);
            return;
        }
        renderMessages(data || []);
    }

    function renderMessages(messages) {
        const el = document.getElementById("msgrMessages");
        if (!el) return;

        const isGroup = State.activeConversationMeta?.is_group;
        const others = State.activeConversationMeta?.others || [];

        el.innerHTML = messages.map((m) => {
            const mine = m.sender_id === State.currentUserId;
            const senderObj = others.find((o) => o.auth_user_id === m.sender_id || o.id === m.sender_id);
            const senderName = mine ? null : (senderObj?.name || senderObj?.display_name || "Member");

            return `
                <div class="msgr-bubble-row ${mine ? "mine" : "theirs"}">
                    ${isGroup && !mine ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ""}
                    <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                    <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                </div>`;
        }).join("");

        el.scrollTop = el.scrollHeight;
    }

    /**
     * Send message in active conversation
     */
    async function sendMessage() {
        const input = document.getElementById("msgrInput");
        const content = input?.value.trim();
        if (!content || !State.activeConversationId || !State.currentUserId) return;

        const sb = getClient();
        input.value = "";
        input.style.height = "auto";
        document.getElementById("msgrSendBtn").disabled = true;

        // Optimistic UI rendering: display bubble immediately
        const messagesEl = document.getElementById("msgrMessages");
        if (messagesEl) {
            const tempBubble = document.createElement("div");
            tempBubble.className = "msgr-bubble-row mine";
            tempBubble.innerHTML = `
                <div class="msgr-bubble">${escapeHtml(content)}</div>
                <div class="msgr-bubble-time">${formatTime(new Date().toISOString())}</div>
            `;
            messagesEl.appendChild(tempBubble);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        const { data: sentMsg, error } = await sb.from("messages").insert({
            conversation_id: State.activeConversationId,
            sender_id: State.currentUserId,
            content: content
        }).select().maybeSingle();

        if (error) {
            console.error("CiteFlowMessenger: Error sending message:", error);
            input.value = content;
            alert("Could not deliver message: " + error.message);
        } else {
            // Update last_message_at on conversations table
            try {
                await sb.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", State.activeConversationId);
            } catch (_) {}

            // Update local state lastMessage optimistically
            const activeConv = State.conversations.find(c => String(c.id) === String(State.activeConversationId));
            if (activeConv) {
                activeConv.lastMessage = {
                    conversation_id: State.activeConversationId,
                    sender_id: State.currentUserId,
                    content,
                    created_at: new Date().toISOString()
                };
                activeConv.sortTime = new Date().toISOString();
            }

            renderConversationList("");
            renderExpandedConvoList();

            // Background refresh of database state
            await loadConversations();
            renderExpandedConvoList();
            await loadMessages(State.activeConversationId);
        }
    }

    /**
     * Mark conversation read
     */
    async function markConversationRead(conversationId) {
        const sb = getClient();
        if (!sb || !State.currentUserId) return;

        State.manuallyUnreadConvoIds.delete(conversationId);
        saveUnreadState();

        await sb
            .from("conversation_participants")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", conversationId)
            .eq("user_id", State.currentUserId);

        const conv = State.conversations.find((c) => c.id === conversationId);
        if (conv) conv.unread = false;
        updateUnreadBadge();
    }

    /**
     * Real-time listeners
     */
    function subscribeToActiveConversation(conversationId) {
        const sb = getClient();
        if (!sb) return;

        if (State.messageChannel) {
            sb.removeChannel(State.messageChannel);
        }

        State.messageChannel = sb
            .channel(`msgr-convo-${conversationId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
                async (payload) => {
                    await loadMessages(conversationId);
                    if (payload.new.sender_id !== State.currentUserId) {
                        await markConversationRead(conversationId);
                    }
                }
            )
            .subscribe();
    }

    function subscribeToInbox() {
        const sb = getClient();
        if (!sb) return;

        if (State.inboxChannel) sb.removeChannel(State.inboxChannel);

        State.inboxChannel = sb
            .channel("msgr-inbox-listener")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages" },
                async () => {
                    await loadConversations();
                }
            )
            .subscribe();
    }

    function updateUnreadBadge() {
        const count = State.conversations.filter((c) => c.unread).length;
        const btn = document.getElementById("citeflowMessageFab") || document.querySelector(".message-btn");
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

    /**
     * Directory loading for Compose modal
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

        State.directoryCache = await fetchDirectory();
        renderUserResults("");
    }

    function closeNewModal() {
        document.getElementById("msgrNewModal")?.classList.remove("show");
    }

    /**
     * Comprehensive directory search covering Faculty, Admins, and in-memory caches
     */
    async function fetchDirectory() {
        const sb = getClient();
        const results = [];
        const seenEmails = new Set();
        if (State.currentUserEmail) {
            seenEmails.add(State.currentUserEmail.toLowerCase());
        }

        // 1. Memory fallback (e.g. when on faculty-profiles.html where facultyData is already loaded)
        if (typeof window !== 'undefined' && Array.isArray(window.facultyData) && window.facultyData.length > 0) {
            for (const f of window.facultyData) {
                const emailClean = (f.email || '').trim().toLowerCase();
                if (emailClean && emailClean !== '-' && seenEmails.has(emailClean)) continue;
                if (f.auth_user_id && f.auth_user_id === State.currentUserId) continue;

                if (emailClean && emailClean !== '-') seenEmails.add(emailClean);
                const dName = f.name || f.full_name || f.email || "Faculty Member";
                results.push({
                    id: f.id,
                    auth_user_id: f.auth_user_id || f.id,
                    name: dName,
                    display_name: dName,
                    email: f.email,
                    avatar_url: f.profile_photo_url || f.avatar_url,
                    department: f.department || "CITE Faculty",
                    role: f.role || "Faculty",
                    position: f.position || "Faculty"
                });
            }
        }

        if (sb) {
            // 2. Fetch from public.faculty table
            try {
                const { data: facultyRows, error: facErr } = await sb
                    .from("faculty")
                    .select("*");

                if (!facErr && Array.isArray(facultyRows)) {
                    for (const f of facultyRows) {
                        const emailClean = (f.email || '').trim().toLowerCase();
                        if (emailClean && seenEmails.has(emailClean)) continue;
                        if (f.auth_user_id && f.auth_user_id === State.currentUserId) continue;

                        if (emailClean) seenEmails.add(emailClean);
                        const displayName = f.full_name || f.name || f.email || "Faculty Member";
                        results.push({
                            id: f.id,
                            auth_user_id: f.auth_user_id || f.id,
                            name: displayName,
                            display_name: displayName,
                            email: f.email,
                            avatar_url: f.profile_photo_url || f.avatar_url,
                            department: f.department || "CITE Faculty",
                            role: f.role || "Faculty",
                            position: f.position || "Faculty"
                        });
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching faculty directory:", e);
            }

            // 3. Fetch from public.admin_profiles table
            try {
                const { data: adminRows, error: admErr } = await sb
                    .from("admin_profiles")
                    .select("*");

                if (!admErr && Array.isArray(adminRows)) {
                    for (const a of adminRows) {
                        const emailClean = (a.email || '').trim().toLowerCase();
                        if (emailClean && seenEmails.has(emailClean)) continue;
                        if (a.id && a.id === State.currentUserId) continue;

                        if (emailClean) seenEmails.add(emailClean);
                        const adminName = a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || "Administrator";
                        results.push({
                            id: a.id,
                            auth_user_id: a.id,
                            name: adminName,
                            display_name: adminName,
                            email: a.email,
                            avatar_url: a.avatar_url,
                            department: a.department || "CITE Administration",
                            role: a.role || "Administrator",
                            position: "Administrator"
                        });
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching admin profiles:", e);
            }
        }

        return results;
    }

    async function getDirectoryUsersByIds(ids) {
        if (!ids || ids.length === 0) return [];
        if (!State.directoryCache || State.directoryCache.length === 0) {
            State.directoryCache = await fetchDirectory();
        }

        const matched = [];
        const idSet = new Set(ids.map(String));

        for (const u of State.directoryCache) {
            const authIdStr = u.auth_user_id ? String(u.auth_user_id) : null;
            const idStr = u.id ? String(u.id) : null;
            if ((authIdStr && idSet.has(authIdStr)) || (idStr && idSet.has(idStr))) {
                matched.push(u);
            }
        }

        return matched;
    }

    function renderUserResults(filter = "") {
        const el = document.getElementById("msgrUserResults");
        if (!el) return;

        const filterClean = filter.trim().toLowerCase();

        const items = State.directoryCache.filter((u) => {
            const name = (u.name || u.display_name || "").toLowerCase();
            const email = (u.email || "").toLowerCase();
            const dept = (u.department || "").toLowerCase();
            const role = (u.role || "").toLowerCase();
            return !filterClean || name.includes(filterClean) || email.includes(filterClean) || dept.includes(filterClean) || role.includes(filterClean);
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
                        <div class="role">${escapeHtml(u.department || u.role || "Faculty")} • ${escapeHtml(u.role || "Member")}</div>
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

        // DOM Failsafe: if selectedNewUsers didn't catch, pull directly from checked inputs
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
            alert("Please select at least one colleague to message.");
            return;
        }

        const sb = getClient();
        if (!sb) {
            alert("Database connection unavailable. Please refresh the page.");
            return;
        }

        if (!State.currentUserId) {
            await resolveCurrentUser();
        }

        if (!State.currentUserId) {
            alert("Could not resolve your active user session. Please sign in again.");
            return;
        }

        const isGroup = validRecipients.length > 1;
        const groupName = document.getElementById("msgrGroupNameInput")?.value.trim();

        // If 1:1 conversation already exists, open it directly
        if (!isGroup) {
            const targetUser = validRecipients[0];
            const targetKey = String(targetUser.auth_user_id || targetUser.id || '');
            const targetEmail = (targetUser.email || '').toLowerCase();

            const existing = State.conversations.find((c) => {
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
                openConversation(existing);
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
                console.error("CiteFlowMessenger: Error creating conversation:", convError);
                throw convError || new Error("Failed to initialize conversation record");
            }

            const participantRows = [
                { conversation_id: conv.id, user_id: State.currentUserId },
                ...validRecipients.map((u) => ({
                    conversation_id: conv.id,
                    user_id: u.auth_user_id || u.id
                }))
            ];

            const { error: partError } = await sb
                .from("conversation_participants")
                .insert(participantRows);

            if (partError) {
                console.warn("CiteFlowMessenger: Notice inserting participants:", partError);
            }

            const targetDisplayName = isGroup 
                ? (groupName || conv.name || "Group Chat") 
                : (validRecipients[0]?.name || validRecipients[0]?.display_name || validRecipients[0]?.email || "Faculty Member");

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

            // Prepend created conversation object to State.conversations
            State.conversations = [createdObj, ...State.conversations.filter(c => c.id !== conv.id)];
            renderConversationList("");
            renderExpandedConvoList();
            closeNewModal();

            if (State.isExpanded) {
                openExpandedConversation(createdObj);
            } else {
                openConversation(createdObj);
            }
        } catch (e) {
            console.error("CiteFlowMessenger: Conversation creation exception:", e);
            alert("Could not start conversation: " + (e.message || "Database error"));
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

        // Highlight selected chat row so user knows which chat it is from
        const rowEl = anchorBtn.closest(".msgr-convo");
        if (rowEl) rowEl.classList.add("msgr-convo-target");

        const isGroup = conv.is_group;
        const isUnread = conv.unread;
        const isPinned = conv.isPinned;

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
                <button class="msgr-dropdown-item" data-action="archive">
                    <i class="fa-solid fa-box-archive"></i>
                    Archive chat
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

        // Smart Flip Positioning + Popover Arrow Pointer
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

        // Wire action buttons
        dropdown.querySelectorAll(".msgr-dropdown-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                handleConvoAction(item.dataset.action, convoId);
                closeConvoDropdown();
            });
        });

        // Window-wide click & scroll auto-close
        setTimeout(() => {
            function autoCloseWindow(evt) {
                if (!evt.target.closest("#msgrDropdown") && 
                    !evt.target.closest(".msgr-convo-options") && 
                    !evt.target.closest("#msgrHeaderOptionsBtn") && 
                    !evt.target.closest("#msgrExpHeaderOptionsBtn")) {
                    closeConvoDropdown();
                    window.removeEventListener("click", autoCloseWindow);
                    window.removeEventListener("scroll", autoCloseWindow, true);
                }
            }
            window.addEventListener("click", autoCloseWindow);
            window.addEventListener("scroll", autoCloseWindow, true);
        }, 50);
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
                    alert('Notifications muted.');
                } else if (action === 'status') {
                    alert('Active status is set to Online.');
                }
            });
        });

        setTimeout(() => {
            function autoCloseHeaderWindow(evt) {
                if (!evt.target.closest("#msgrDropdown") && 
                    !evt.target.closest("#msgrHeaderOptionsBtn") && 
                    !evt.target.closest("#msgrExpHeaderOptionsBtn")) {
                    closeConvoDropdown();
                    window.removeEventListener("click", autoCloseHeaderWindow);
                    window.removeEventListener("scroll", autoCloseHeaderWindow, true);
                }
            }
            window.addEventListener("click", autoCloseHeaderWindow);
            window.addEventListener("scroll", autoCloseHeaderWindow, true);
        }, 50);
    }

    function openArchivedModal() {
        let modal = document.getElementById("msgrArchivedModal");
        if (!modal) {
            mountDOM();
            modal = document.getElementById("msgrArchivedModal");
        }

        if (!modal) {
            modal = document.createElement("div");
            modal.className = "msgr-new-modal";
            modal.id = "msgrArchivedModal";
            modal.innerHTML = `
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
            `;
            document.body.appendChild(modal);
            document.getElementById("msgrArchivedCloseBtn")?.addEventListener("click", closeArchivedModal);
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
                        if (State.isExpanded) {
                            openExpandedConversation(conv);
                        } else {
                            openConversation(conv);
                        }
                    }
                });
            });

            body.querySelectorAll('.msgr-unarchive-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cid = btn.dataset.id;
                    State.archivedConvoIds.delete(cid);
                    saveArchivedState();
                    const conv = State.conversations.find(c => String(c.id) === String(cid));
                    if (conv) conv.isArchived = false;
                    openArchivedModal();
                    renderConversationList("");
                    renderExpandedConvoList();
                });
            });
        }

        modal.style.display = "flex";
        modal.classList.add("show");
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
                renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
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
                    renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
                    renderExpandedConvoList();
                    updateUnreadBadge();
                }
                break;
            case 'open':
                openConversation(conv);
                break;
            case 'mute':
                alert('Notifications muted for this chat.');
                break;
            case 'archive':
                State.archivedConvoIds.add(convoId);
                saveArchivedState();
                if (conv) conv.isArchived = true;
                if (State.activeConversationId === convoId) closeActiveChat();
                renderConversationList("");
                renderExpandedConvoList();
                updateUnreadBadge();
                openArchivedModal();
                break;
            case 'delete':
                if (confirm('Delete this chat? This cannot be undone.')) {
                    try {
                        if (sb) {
                            await sb.from('messages').delete().eq('conversation_id', convoId);
                            await sb.from('conversation_participants').delete().eq('conversation_id', convoId);
                            await sb.from('conversations').delete().eq('id', convoId);
                        }
                        State.conversations = State.conversations.filter(c => c.id !== convoId);
                        if (State.activeConversationId === convoId) closeActiveChat();
                        renderConversationList("");
                        renderExpandedConvoList();
                        updateUnreadBadge();
                    } catch (e) {
                        console.error('Error deleting chat:', e);
                        alert('Could not delete chat: ' + (e.message || 'Database error'));
                    }
                }
                break;
            case 'report':
                alert('This conversation has been reported. Thank you.');
                break;
            case 'leave':
                if (confirm('Leave this group? You will no longer receive messages.')) {
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
                    } catch (e) {
                        console.error('Error leaving group:', e);
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
            // Hide search results, show normal list
            if (searchResults) searchResults.style.display = "none";
            if (list) list.style.display = "";
            if (filterTabs) filterTabs.style.display = "";
            renderConversationList("");
            return;
        }

        // Hide normal list, show search results
        if (list) list.style.display = "none";
        if (filterTabs) filterTabs.style.display = "none";
        if (searchResults) searchResults.style.display = "block";

        const q = query.toLowerCase();

        // Section 1: Matching conversations
        const matchingConvos = State.conversations.filter(c =>
            c.displayName.toLowerCase().includes(q)
        );

        // Section 2: People from directory not yet in a conversation
        if (State.directoryCache.length === 0) {
            State.directoryCache = await fetchDirectory();
        }

        const conversedUserIds = new Set();
        State.conversations.forEach(c => {
            (c.others || []).forEach(o => {
                if (o.auth_user_id) conversedUserIds.add(o.auth_user_id);
                if (o.id) conversedUserIds.add(o.id);
            });
        });

        const matchingPeople = State.directoryCache.filter(u => {
            const uid = u.auth_user_id || u.id;
            if (conversedUserIds.has(uid)) return false;
            const name = (u.name || u.display_name || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const dept = (u.department || '').toLowerCase();
            return name.includes(q) || email.includes(q) || dept.includes(q);
        });

        let html = '';

        // Section 1
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

        // Section 2
        if (matchingPeople.length > 0) {
            html += `<div class="msgr-search-section-label">People</div>`;
            html += matchingPeople.map(u => {
                const avatarHtml = renderAvatar(u.avatar_url, u.name || u.display_name, false);
                return `
                    <div class="msgr-convo msgr-search-item" data-uid="${u.auth_user_id || u.id}" data-type="person">
                        ${avatarHtml}
                        <div class="msgr-convo-info">
                            <div class="msgr-convo-name">${escapeHtml(u.name || u.display_name || u.email)}</div>
                            <div class="msgr-convo-preview">${escapeHtml(u.department || u.role || 'Faculty')}</div>
                        </div>
                    </div>`;
            }).join('');
        }

        if (!html) {
            html = `<div class="msgr-empty"><i class="fa-solid fa-magnifying-glass"></i> No results for "${escapeHtml(query)}"</div>`;
        }

        searchResults.innerHTML = html;

        // Wire clicks
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
                        if (State.isExpanded) {
                            openExpandedConversation(conv);
                        } else {
                            openConversation(conv);
                        }
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
                        State.selectedNewUsers = [user];
                        await createConversation();
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
            const avatarHtml = renderAvatar(c.is_group ? null : c.others[0]?.avatar_url, c.displayName, c.is_group);
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
                if (conv) openExpandedConversation(conv);
            });
        });
    }

    async function openExpandedConversation(conv) {
        State.activeConversationId = conv.id;
        State.activeConversationMeta = conv;

        // Show active chat panel, hide placeholder
        const placeholder = document.getElementById("msgrExpChatPlaceholder");
        const active = document.getElementById("msgrExpChatActive");
        if (placeholder) placeholder.style.display = "none";
        if (active) active.style.display = "flex";

        // Set chat header
        const nameEl = document.getElementById("msgrExpChatName");
        const subEl = document.getElementById("msgrExpChatSub");
        const avatarEl = document.getElementById("msgrExpChatAvatar");
        if (nameEl) nameEl.textContent = conv.displayName;
        if (subEl) subEl.textContent = conv.is_group ? `${(conv.others?.length || 0) + 1} members` : (conv.others?.[0]?.department || conv.others?.[0]?.role || 'Member');
        if (avatarEl) {
            avatarEl.outerHTML = renderAvatar(conv.is_group ? null : conv.others?.[0]?.avatar_url, conv.displayName, conv.is_group)
                .replace('class="msgr-avatar', 'id="msgrExpChatAvatar" class="msgr-avatar');
        }

        // Render right info panel
        renderExpandedInfoPanel(conv);

        // Update sidebar active state
        renderExpandedConvoList();

        // Load messages
        await loadExpandedMessages(conv.id);
        await markConversationRead(conv.id);
        subscribeToActiveConversation(conv.id);
    }

    async function loadExpandedMessages(conversationId) {
        const sb = getClient();
        if (!sb) return;
        const { data, error } = await sb.from("messages").select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }).limit(150);
        if (error) return;

        const el = document.getElementById("msgrExpMessages");
        if (!el) return;
        const isGroup = State.activeConversationMeta?.is_group;
        const others = State.activeConversationMeta?.others || [];

        el.innerHTML = (data || []).map(m => {
            const mine = m.sender_id === State.currentUserId;
            const senderObj = others.find(o => o.auth_user_id === m.sender_id || o.id === m.sender_id);
            const senderName = mine ? null : (senderObj?.name || senderObj?.display_name || 'Member');
            return `
                <div class="msgr-bubble-row ${mine ? 'mine' : 'theirs'}">
                    ${isGroup && !mine ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ''}
                    <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                    <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                </div>`;
        }).join('');
        el.scrollTop = el.scrollHeight;
    }

    async function sendMessageExpanded() {
        const input = document.getElementById("msgrExpInput");
        const content = input?.value.trim();
        if (!content || !State.activeConversationId || !State.currentUserId) return;

        const sb = getClient();
        input.value = '';
        input.style.height = 'auto';
        document.getElementById('msgrExpSendBtn').disabled = true;

        const messagesEl = document.getElementById('msgrExpMessages');
        if (messagesEl) {
            const tempBubble = document.createElement('div');
            tempBubble.className = 'msgr-bubble-row mine';
            tempBubble.innerHTML = `<div class="msgr-bubble">${escapeHtml(content)}</div><div class="msgr-bubble-time">${formatTime(new Date().toISOString())}</div>`;
            messagesEl.appendChild(tempBubble);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        const { error } = await sb.from('messages').insert({
            conversation_id: State.activeConversationId,
            sender_id: State.currentUserId,
            content
        }).select().maybeSingle();

        if (error) {
            input.value = content;
            alert('Could not deliver message: ' + error.message);
        } else {
            try { await sb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', State.activeConversationId); } catch (_) {}
            
            // Optimistic update of local conversation state lastMessage
            const activeConv = State.conversations.find(c => String(c.id) === String(State.activeConversationId));
            if (activeConv) {
                activeConv.lastMessage = {
                    conversation_id: State.activeConversationId,
                    sender_id: State.currentUserId,
                    content,
                    created_at: new Date().toISOString()
                };
                activeConv.sortTime = new Date().toISOString();
            }

            renderConversationList("");
            renderExpandedConvoList();

            await loadConversations();
            await loadExpandedMessages(State.activeConversationId);
            renderExpandedConvoList();
        }
    }

    function renderExpandedInfoPanel(conv) {
        const inner = document.getElementById("msgrExpInfoInner");
        if (!inner) return;

        const isGroup = conv.is_group;
        const others = conv.others || [];
        const allMembers = [{ name: 'You', department: State.currentUserRole, isSelf: true }, ...others];

        const avatarHtml = renderAvatar(isGroup ? null : others[0]?.avatar_url, conv.displayName, isGroup)
            .replace('class="msgr-avatar', 'class="msgr-avatar msgr-exp-info-avatar');

        inner.innerHTML = `
            <div class="msgr-exp-info-profile">
                ${avatarHtml}
                <h3>${escapeHtml(conv.displayName)}</h3>
            </div>
            <div class="msgr-exp-info-actions">
                <button class="msgr-exp-info-action-btn" title="Mute"><i class="fa-solid fa-bell"></i><span>Mute</span></button>
                <button class="msgr-exp-info-action-btn" title="Search"><i class="fa-solid fa-magnifying-glass"></i><span>Search</span></button>
            </div>
            <details class="msgr-exp-info-section" open>
                <summary>Chat info</summary>
                <div class="msgr-exp-info-detail">
                    <span>Type:</span> ${isGroup ? 'Group Chat' : 'Direct Message'}
                </div>
            </details>
            <details class="msgr-exp-info-section">
                <summary>Customize chat</summary>
                <div class="msgr-exp-info-detail">Change theme, emoji, and nicknames</div>
            </details>
            <details class="msgr-exp-info-section" ${isGroup ? 'open' : ''}>
                <summary>Chat members</summary>
                <div class="msgr-exp-members">
                    ${allMembers.map(m => {
                        const memberAvatar = renderAvatar(m.avatar_url, m.name || m.display_name || 'Member', false);
                        const addedBy = m.isSelf ? '' : '<div class="msgr-exp-member-sub">Added by creator</div>';
                        return `
                            <div class="msgr-exp-member-row">
                                ${memberAvatar}
                                <div class="msgr-exp-member-info">
                                    <div class="msgr-exp-member-name">${escapeHtml(m.name || m.display_name || 'Member')}${m.isSelf ? ' (you)' : ''}</div>
                                    ${addedBy}
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </details>
        `;
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
        closeMessages: closePanel,
        loadConversations,
        sendMessage,
        openExpandedView,
        closeExpandedView
    };
})();

// Global alias for compatibility
window.openMessages = function () {
    window.CiteFlowMessenger?.openMessages();
};

