// ==============================================================================
// CITE-Flow Universal Messenger Engine
// Works seamlessly on Admin and Faculty portals with real-time Supabase sync
// ==============================================================================

window.CiteFlowMessenger = (function () {

    // Helper: get user-scoped localStorage key
    function scopedKey(base, userId) {
        return userId ? `${base}_${userId}` : base;
    }

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
        // These are loaded lazily after user resolves (see loadUserScopedState)
        pinnedConvoIds: new Set(),
        archivedConvoIds: new Set(),
        manuallyUnreadConvoIds: new Set(),
        mutedConvoIds: new Set(),
        deletedConvoIds: new Set(),
        activeConversationParticipants: []
    };

    /** Load per-user state from localStorage after user ID is known */
    function loadUserScopedState() {
        const uid = State.currentUserId;
        try {
            State.pinnedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_pinned_convos', uid)) || '[]'));
            State.archivedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_archived_convos', uid)) || '[]'));
            State.manuallyUnreadConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_unread_convos', uid)) || '[]'));
            State.mutedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_muted_convos', uid)) || '[]'));
            State.deletedConvoIds = new Set(JSON.parse(localStorage.getItem(scopedKey('citeflow_deleted_convos', uid)) || '[]'));
        } catch (_) {}
    }

    function savePinnedState() {
        localStorage.setItem(scopedKey('citeflow_pinned_convos', State.currentUserId), JSON.stringify(Array.from(State.pinnedConvoIds)));
    }
    function saveArchivedState() {
        localStorage.setItem(scopedKey('citeflow_archived_convos', State.currentUserId), JSON.stringify(Array.from(State.archivedConvoIds)));
    }
    function saveUnreadState() {
        localStorage.setItem(scopedKey('citeflow_unread_convos', State.currentUserId), JSON.stringify(Array.from(State.manuallyUnreadConvoIds)));
    }
    function saveMutedState() {
        localStorage.setItem(scopedKey('citeflow_muted_convos', State.currentUserId), JSON.stringify(Array.from(State.mutedConvoIds)));
    }
    function saveDeletedState() {
        // "deleted" means hidden-for-this-user only — never affects other users
        localStorage.setItem(scopedKey('citeflow_deleted_convos', State.currentUserId), JSON.stringify(Array.from(State.deletedConvoIds)));
    }

    function saveConvoMeta(convoId, meta) {
        try {
            const saved = JSON.parse(localStorage.getItem('citeflow_convo_metas') || '{}');
            saved[convoId] = Object.assign(saved[convoId] || {}, meta);
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
     * Toast notification system
     */
    function showCustomToast(message, duration = 3200) {
        if (!message) return;
        let toast = document.getElementById("citeflowGlobalToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "citeflowGlobalToast";
            toast.className = "citeflow-toast";
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> <span>${message}</span>`;
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
                State.currentUserRole = session.user.user_metadata?.role || (window.location.pathname.includes('/admin/') ? 'Admin' : 'Faculty');
                loadUserScopedState();

                // If user is Admin, ensure admin_profiles table has their id and info
                if (State.currentUserRole === 'Admin' || window.location.pathname.includes('/admin/')) {
                    try {
                        const adminName = session.user.user_metadata?.name || session.user.user_metadata?.full_name || 'Administrator';
                        await sb.from('admin_profiles').upsert({
                            id: session.user.id,
                            email: State.currentUserEmail,
                            full_name: adminName,
                            name: adminName,
                            role: 'Admin'
                        }, { onConflict: 'id' });
                    } catch (_) {}
                }

                // If user is in faculty table, link auth_user_id
                if (State.currentUserEmail) {
                    try {
                        await sb.from('faculty')
                            .update({ auth_user_id: session.user.id })
                            .ilike('email', State.currentUserEmail);
                    } catch (_) {}
                }
                return true;
            }

            // Fallback: Check citeflow_user cache
            const cached = localStorage.getItem('citeflow_user');
            if (cached) {
                const parsed = JSON.parse(cached);
                State.currentUserId = parsed.id;
                State.currentUserEmail = (parsed.email || '').toLowerCase();
                State.currentUserRole = parsed.role || (window.location.pathname.includes('/admin/') ? 'Admin' : 'Faculty');
                loadUserScopedState();
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
    if (State.initialized) return;

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
        toggleDockedDetails(false);
        if (State.activeChatPollingTimer) {
            clearInterval(State.activeChatPollingTimer);
            State.activeChatPollingTimer = null;
        }
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
            const seen = new Set();
            const cleaned = (State.conversations || []).filter(c => {
                if (!c || !c.id || State.deletedConvoIds.has(String(c.id))) return false;
                const safeOthers = (c.others || []).filter(o =>
                    String(o.auth_user_id) !== String(State.currentUserId) &&
                    String(o.id) !== String(State.currentUserId) &&
                    (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
                );
                const key = c.is_group
                    ? `group_${c.id}`
                    : `direct_${safeOthers[0]?.auth_user_id || safeOthers[0]?.id || safeOthers[0]?.email || c.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const json = JSON.stringify(cleaned);
            localStorage.setItem("citeflow_convo_cache", json);
            if (State.currentUserId) {
                localStorage.setItem(`citeflow_convo_cache_${State.currentUserId}`, json);
            }
        } catch (e) {
            console.warn("Notice saving local convos:", e);
        }
    }

    function loadLocalConvos() {
        try {
            let parsed = [];
            if (State.currentUserId) {
                const userCached = localStorage.getItem(`citeflow_convo_cache_${State.currentUserId}`);
                if (userCached) {
                    parsed = JSON.parse(userCached);
                }
            }
            if (!parsed || parsed.length === 0) {
                const cached = localStorage.getItem("citeflow_convo_cache");
                if (cached) {
                    parsed = JSON.parse(cached);
                }
            }
            if (Array.isArray(parsed)) {
                const seen = new Set();
                return parsed.filter(c => {
                    if (!c || !c.id || State.deletedConvoIds.has(String(c.id))) return false;
                    const safeOthers = (c.others || []).filter(o =>
                        String(o.auth_user_id) !== String(State.currentUserId) &&
                        String(o.id) !== String(State.currentUserId) &&
                        (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
                    );
                    const key = c.is_group
                        ? `group_${c.id}`
                        : `direct_${safeOthers[0]?.auth_user_id || safeOthers[0]?.id || safeOthers[0]?.email || c.id}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }
        } catch (e) {
            console.warn("Notice loading local convos:", e);
        }
        return [];
    }

    function saveLocalMessages(conversationId, messages) {
        if (!conversationId || !Array.isArray(messages)) return;
        try {
            localStorage.setItem(`citeflow_messages_${conversationId}`, JSON.stringify(messages.slice(-200)));
        } catch (e) {
            console.warn("Notice saving local messages:", e);
        }
    }

    function loadLocalMessages(conversationId) {
        if (!conversationId) return [];
        try {
            const cached = localStorage.getItem(`citeflow_messages_${conversationId}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.warn("Notice loading local messages:", e);
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
        if (localCache.length > 0 && State.conversations.length === 0) {
            State.conversations = localCache;
            renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
            renderExpandedConvoList();
            updateUnreadBadge();
        }

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
            const { data: participantRows } = await sb
                .from("conversation_participants")
                .select("conversation_id, last_read_at")
                .eq("user_id", State.currentUserId);

            // 2. Fetch conversations created by current user
            const { data: createdRows } = await sb
                .from("conversations")
                .select("*")
                .eq("created_by", State.currentUserId);

            // 3. Fetch conversations where this user sent messages
            const { data: sentMsgs } = await sb
                .from("messages")
                .select("conversation_id")
                .eq("sender_id", State.currentUserId)
                .limit(50);

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
            if (sentMsgs) {
                sentMsgs.forEach(m => {
                    if (m.conversation_id) convoIdSet.add(m.conversation_id);
                });
            }

            // 4. Global Auto-Heal & Auto-Link for 1:1 Direct Conversations:
            // Fetch all 1-on-1 direct conversations in the database
            const { data: allDirectConvos } = await sb
                .from("conversations")
                .select("*")
                .or("is_group.eq.false,is_group.is.null")
                .order("created_at", { ascending: true })
                .limit(50);

            if (Array.isArray(allDirectConvos) && allDirectConvos.length > 0) {
                const directConvoIds = allDirectConvos.map(c => c.id);
                const { data: directParts } = await sb
                    .from("conversation_participants")
                    .select("conversation_id, user_id")
                    .in("conversation_id", directConvoIds);

                const partsByConvo = new Map();
                (directParts || []).forEach(p => {
                    if (!partsByConvo.has(p.conversation_id)) partsByConvo.set(p.conversation_id, []);
                    partsByConvo.get(p.conversation_id).push(p.user_id);
                });

                // Auto-link: ensure current user is registered as participant in all relevant direct conversations
                for (const dConv of allDirectConvos) {
                    const parts = partsByConvo.get(dConv.id) || [];
                    const isCreatedByMe = String(dConv.created_by) === String(State.currentUserId);
                    const isParticipant = parts.some(uid => String(uid) === String(State.currentUserId));

                    if (isCreatedByMe || isParticipant || allDirectConvos.length <= 3) {
                        convoIdSet.add(dConv.id);
                        if (!isParticipant) {
                            sb.from("conversation_participants").upsert({
                                conversation_id: dConv.id,
                                user_id: State.currentUserId,
                                last_read_at: new Date().toISOString()
                            }, { onConflict: "conversation_id, user_id" }).then();
                        }
                    }
                }

                // Deduplicate & Merge multiple direct conversations between the SAME two accounts:
                const matchedDirectConvos = allDirectConvos.filter(c => convoIdSet.has(c.id));
                if (matchedDirectConvos.length > 1) {
                    const primaryConvo = matchedDirectConvos[0];
                    for (let i = 1; i < matchedDirectConvos.length; i++) {
                        const dupConvo = matchedDirectConvos[i];
                        try {
                            // Move messages from duplicate into primary
                            await sb.from("messages").update({ conversation_id: primaryConvo.id }).eq("conversation_id", dupConvo.id);
                            const dupParts = partsByConvo.get(dupConvo.id) || [];
                            for (const pUid of dupParts) {
                                await sb.from("conversation_participants").upsert({
                                    conversation_id: primaryConvo.id,
                                    user_id: pUid
                                }, { onConflict: "conversation_id, user_id" });
                            }
                            convoIdSet.delete(dupConvo.id);
                        } catch (_) {}
                    }
                }
            }

            // Fetch ALL conversation IDs from DB (including soft-deleted/archived ones for this user)
            const allConvoIds = Array.from(convoIdSet).filter(id => id);

            if (allConvoIds.length === 0) {
                if (localCache.length > 0) {
                    State.conversations = localCache;
                } else {
                    State.conversations = [];
                }
                renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
                renderExpandedConvoList();
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
            // 5. Fetch fresh directory users for participant resolution
            State.directoryCache = await fetchDirectory();

            const allOtherUserIds = Array.from(new Set(
                (allParticipants || [])
                    .map(p => p.user_id)
                    .filter(uid => uid && uid !== State.currentUserId)
            ));

            const directoryUsers = allOtherUserIds.length > 0
                ? await getDirectoryUsersByIds(allOtherUserIds)
                : [];

            const userMap = new Map();
            userMap.set('admin-system', { id: 'admin-system', auth_user_id: 'admin-system', name: 'Administrator', display_name: 'Administrator', role: 'Admin', avatar_url: null });
            
            State.directoryCache.forEach(u => {
                // Skip adding self to the userMap to prevent self-resolution as "other"
                if (String(u.auth_user_id) === String(State.currentUserId)) return;
                if (String(u.id) === String(State.currentUserId)) return;
                if (u.email && u.email.toLowerCase() === State.currentUserEmail?.toLowerCase()) return;

                if (u.auth_user_id) userMap.set(String(u.auth_user_id), u);
                if (u.id) userMap.set(String(u.id), u);
                if (u.email) userMap.set(String(u.email).toLowerCase(), u);
            });
            directoryUsers.forEach(u => {
                // Skip adding self to the userMap
                if (String(u.auth_user_id) === String(State.currentUserId)) return;
                if (String(u.id) === String(State.currentUserId)) return;
                if (u.email && u.email.toLowerCase() === State.currentUserEmail?.toLowerCase()) return;

                if (u.auth_user_id) userMap.set(String(u.auth_user_id), u);
                if (u.id) userMap.set(String(u.id), u);
                if (u.email) userMap.set(String(u.email).toLowerCase(), u);
            });

            // Always query admin_profiles & faculty for all participant IDs to guarantee fresh name & avatar
            if (allOtherUserIds.length > 0) {
                try {
                    const { data: adminMatches } = await sb
                        .from('admin_profiles')
                        .select('id, full_name, name, first_name, last_name, email, avatar_url, profile_photo_url, department')
                        .in('id', allOtherUserIds);

                    if (Array.isArray(adminMatches)) {
                        for (const a of adminMatches) {
                            const adminName = a.full_name || a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || 'Administrator';
                            const adminEntry = {
                                id: a.id,
                                auth_user_id: a.id,
                                name: adminName,
                                display_name: adminName,
                                email: a.email,
                                avatar_url: a.avatar_url || a.profile_photo_url || null,
                                department: a.department || 'CITE Administration',
                                role: 'Administrator',
                                position: 'Administrator'
                            };
                            userMap.set(String(a.id), adminEntry);
                            if (a.email) userMap.set(a.email.toLowerCase(), adminEntry);
                        }
                    }
                } catch (_) {}

                // Try querying faculty table by auth_user_id or id for any unmapped IDs
                const unmappedIds = allOtherUserIds.filter(uid => !userMap.has(String(uid)));
                if (unmappedIds.length > 0) {
                    try {
                        const { data: facMatches } = await sb
                            .from('faculty')
                            .select('*')
                            .in('auth_user_id', unmappedIds);

                        if (Array.isArray(facMatches)) {
                            for (const f of facMatches) {
                                const fName = f.full_name || f.name || f.email || (f.role === 'Admin' ? 'Administrator' : 'Faculty Member');
                                const fEntry = {
                                    id: f.auth_user_id || f.id,
                                    auth_user_id: f.auth_user_id || f.id,
                                    name: fName,
                                    display_name: fName,
                                    email: f.email,
                                    avatar_url: f.avatar_url || f.profile_photo_url || null,
                                    department: f.department || 'BSIT',
                                    role: f.role || 'Faculty Member',
                                    position: f.position || f.role || 'Faculty Member'
                                };
                                userMap.set(String(f.auth_user_id || f.id), fEntry);
                                if (f.email) userMap.set(f.email.toLowerCase(), fEntry);
                            }
                        }
                    } catch (_) {}
                }

                // Check directoryCache for any remaining unmapped IDs before creating default placeholder
                for (const uid of allOtherUserIds) {
                    if (!userMap.has(String(uid))) {
                        const matchedCache = State.directoryCache.find(u =>
                            String(u.auth_user_id) === String(uid) ||
                            String(u.id) === String(uid) ||
                            (u.email && u.email.toLowerCase() === String(uid).toLowerCase())
                        );
                        if (matchedCache) {
                            userMap.set(String(uid), matchedCache);
                        } else {
                            userMap.set(String(uid), {
                                id: uid,
                                auth_user_id: uid,
                                name: State.currentUserRole === 'Faculty' ? 'Administrator' : 'Faculty Member',
                                display_name: State.currentUserRole === 'Faculty' ? 'Administrator' : 'Faculty Member',
                                email: null,
                                avatar_url: null,
                                role: 'Administrator'
                            });
                        }
                    }
                }
            }

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
            let enriched = (convData || []).map((conv) => {
                const myLastRead = pMap.get(conv.id) || null;
                const lastMsg = lastMsgMap.get(String(conv.id)) || null;

                const convoParticipantIds = (allParticipants || [])
                    .filter(p => p.conversation_id === conv.id && String(p.user_id) !== String(State.currentUserId))
                    .map(p => p.user_id);

                if (conv.created_by && String(conv.created_by) !== String(State.currentUserId) && !convoParticipantIds.includes(conv.created_by)) {
                    convoParticipantIds.push(conv.created_by);
                }

                let resolvedOthers = convoParticipantIds.map(uid => userMap.get(String(uid)) || {
                    id: uid,
                    auth_user_id: uid,
                    name: (String(uid).includes('admin') || String(conv.created_by) === String(uid)) ? "Administrator" : "Faculty Member",
                    display_name: (String(uid).includes('admin') || String(conv.created_by) === String(uid)) ? "Administrator" : "Faculty Member"
                });

                // Filter out self completely
                resolvedOthers = resolvedOthers.filter(o => 
                    String(o.auth_user_id) !== String(State.currentUserId) && 
                    String(o.id) !== String(State.currentUserId) && 
                    (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail).toLowerCase())
                );

                const meta = getConvoMeta(conv.id);
                if ((!resolvedOthers || resolvedOthers.length === 0) && meta && meta.others) {
                    resolvedOthers = meta.others.filter(o => 
                        String(o.auth_user_id) !== String(State.currentUserId) && 
                        String(o.id) !== String(State.currentUserId) && 
                        (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail).toLowerCase())
                    );
                }

                if (resolvedOthers.length === 0) {
                    resolvedOthers = [{
                        id: 'other',
                        auth_user_id: 'other',
                        name: State.currentUserRole === 'Admin' ? "Faculty Member" : "Administrator",
                        display_name: State.currentUserRole === 'Admin' ? "Faculty Member" : "Administrator"
                    }];
                }

                const isManuallyUnread = State.manuallyUnreadConvoIds.has(conv.id);
                const isCurrentlyOpen = String(State.activeConversationId) === String(conv.id);
                const unread = !isCurrentlyOpen && (isManuallyUnread || Boolean(
                    lastMsg &&
                    String(lastMsg.sender_id) !== String(State.currentUserId) &&
                    (!myLastRead || new Date(lastMsg.created_at) > new Date(myLastRead))
                ));

                const isPinned = State.pinnedConvoIds.has(conv.id);
                // Soft-deleted convos are treated as archived (hidden in main list, visible in Archive)
                const isSoftDeleted = State.deletedConvoIds.has(String(conv.id));
                const isArchived = isSoftDeleted || State.archivedConvoIds.has(conv.id);

                let displayName = conv.name || null;
                if (conv.is_group) {
                    displayName = conv.name || resolvedOthers.map(o => (o.name || o.display_name || '').split(' ')[0]).filter(Boolean).join(', ') || "Group Chat";
                } else {
                    displayName = resolvedOthers[0]?.name || resolvedOthers[0]?.display_name || "Faculty Member";
                    if (displayName === "Faculty Member" && meta?.displayName && meta.displayName !== "Faculty Member" && !meta.displayName.toLowerCase().includes(String(State.currentUserEmail).split('@')[0])) {
                        displayName = meta.displayName;
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

            // Never drop soft-deleted convos from State — they live in Archive tab

            // Merge with local cache so newly created conversations and custom edits are never lost
            const combinedMap = new Map();
            enriched.forEach(c => {
                if (c && c.id) {
                    combinedMap.set(String(c.id), c);
                }
            });
            localCache.forEach(c => {
                if (c && c.id) {
                    if (!combinedMap.has(String(c.id))) {
                        combinedMap.set(String(c.id), c);
                    } else {
                        const srv = combinedMap.get(String(c.id));
                        let bestLastMsg = srv.lastMessage || c.lastMessage || null;
                        if (srv.lastMessage && c.lastMessage) {
                            const srvTime = new Date(srv.lastMessage.created_at || 0).getTime();
                            const locTime = new Date(c.lastMessage.created_at || 0).getTime();
                            bestLastMsg = srvTime >= locTime ? srv.lastMessage : c.lastMessage;
                        }
                        const isSoftDeleted = State.deletedConvoIds.has(String(c.id));
                        combinedMap.set(String(c.id), {
                            ...c,
                            ...srv,
                            lastMessage: bestLastMsg,
                            displayName: (c.isCustomNickname && c.customNickname) ? c.customNickname : srv.displayName,
                            isPinned: State.pinnedConvoIds.has(c.id) || srv.isPinned || false,
                            isArchived: isSoftDeleted || State.archivedConvoIds.has(c.id) || srv.isArchived || false,
                            isSoftDeleted
                        });
                    }
                }
            });

            // Strict deduplication: keep only one 1:1 conversation per person (latest sortTime)
            const dedupedKeys = new Set();
            let finalConvos = Array.from(combinedMap.values()).filter(c => {
                if (!c || !c.id) return false;
                const safeOthers = (c.others || []).filter(o =>
                    String(o.auth_user_id) !== String(State.currentUserId) &&
                    String(o.id) !== String(State.currentUserId) &&
                    (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
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

            // Sort: pinned items first, then by sortTime descending
            finalConvos.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return new Date(b.sortTime || 0) - new Date(a.sortTime || 0);
            });

            State.conversations = finalConvos;
            saveLocalConvos();

            renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
            renderExpandedConvoList();
            updateUnreadBadge();
        } catch (err) {
            console.error("CiteFlowMessenger: Error loading conversations:", err);
            if (localCache.length > 0) {
                State.conversations = localCache;
                renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
                renderExpandedConvoList();
                updateUnreadBadge();
            } else if (listEl) {
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
            // Filter self out of others to prevent showing own avatar as "other person"
            const safeOthers = (c.others || []).filter(o =>
                String(o.auth_user_id) !== String(State.currentUserId) &&
                String(o.id) !== String(State.currentUserId) &&
                (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
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

        // Reset docked details panel if open
        toggleDockedDetails(false);

        // Optimistic UI: Clear unread badge & status instantly (0ms delay)
        conv.unread = false;
        State.manuallyUnreadConvoIds.delete(conv.id);
        saveUnreadState();
        updateUnreadBadge();

        const nameEl = document.getElementById("msgrChatName");
        const subEl = document.getElementById("msgrChatSub");
        const avatarEl = document.getElementById("msgrChatAvatar");

        // Always filter self out of others to prevent self-identity confusion
        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId) &&
            (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
        );

        // Determine display name from safeOthers
        let displayName = conv.displayName;
        if (!conv.is_group && safeOthers.length > 0) {
            displayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        } else if (!conv.is_group && safeOthers.length === 0) {
            if (conv.displayName && conv.displayName !== "Administrator" && conv.displayName !== "Faculty Member") {
                displayName = conv.displayName;
            } else {
                displayName = State.currentUserRole === 'Admin' ? "Faculty Member" : "Administrator";
            }
        }

        // Determine avatar — never show self avatar as the other person's avatar
        let otherAvatarUrl = (safeOthers.length > 0 && !conv.is_group) ? safeOthers[0].avatar_url : null;
        if (!otherAvatarUrl && !conv.is_group) {
            otherAvatarUrl = conv.avatar_url || conv.profile_photo_url || conv.others?.[0]?.avatar_url || null;
        }

        if (nameEl) nameEl.textContent = displayName;
        if (subEl) {
            subEl.textContent = conv.is_group 
                ? `${(safeOthers.length || 0) + 1} members` 
                : (safeOthers?.[0]?.department || safeOthers?.[0]?.role || "Member");
        }
        if (avatarEl) {
            avatarEl.outerHTML = renderAvatar(
                conv.is_group ? null : otherAvatarUrl,
                displayName,
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
            String(o.id) !== String(State.currentUserId) &&
            (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
        );

        let displayName = conv.displayName;
        if (!isGroup && safeOthers.length > 0) {
            displayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        }

        const otherAvatarUrl = (safeOthers.length > 0 && !isGroup) ? safeOthers[0].avatar_url : null;
        const isMuted = State.mutedConvoIds.has(conv.id);
        const sub = isGroup
            ? `${safeOthers.length + 1} members`
            : (safeOthers[0]?.department || safeOthers[0]?.role || "Member");

        const avatarHtml = renderAvatar(isGroup ? null : otherAvatarUrl, displayName, isGroup);

        const allMembers = [
            { name: 'You', department: State.currentUserRole, isSelf: true, avatar_url: null },
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
     * Load messages for active conversation with instant local cache + network sync
     */
    async function loadMessages(conversationId) {
        if (!conversationId) return;

        // 1. Instant render from local cache
        const localMsgs = loadLocalMessages(conversationId);
        if (localMsgs.length > 0) {
            renderMessages(localMsgs);
        }

        const sb = getClient();
        if (!sb) return;

        try {
            const { data, error } = await sb
                .from("messages")
                .select("*")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true })
                .limit(150);

            if (error) {
                console.warn("CiteFlowMessenger: Notice loading messages from DB:", error);
                return;
            }

            // Fetch participants for seen receipts
            try {
                const { data: partData } = await sb
                    .from("conversation_participants")
                    .select("user_id, last_read_at")
                    .eq("conversation_id", conversationId);
                if (Array.isArray(partData)) {
                    State.activeConversationParticipants = partData;
                }
            } catch (_) {}

            if (Array.isArray(data)) {
                // Purge temp messages that have been confirmed by database records
                const unconfirmedTemp = localMsgs.filter(lm => {
                    if (!String(lm.id).startsWith('temp_')) return false;
                    const matchedInDb = data.some(dm => 
                        String(dm.sender_id) === String(lm.sender_id) && 
                        dm.content === lm.content &&
                        Math.abs(new Date(dm.created_at) - new Date(lm.created_at)) < 30000
                    );
                    return !matchedInDb;
                });

                const combined = (data.length === 0 && localMsgs.length > 0) ? localMsgs : [...data, ...unconfirmedTemp];
                combined.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

                saveLocalMessages(conversationId, combined);
                renderMessages(combined);

                if (combined.length > 0) {
                    const newest = combined[combined.length - 1];
                    const targetConv = State.conversations.find(c => String(c.id) === String(conversationId));
                    if (targetConv) {
                        targetConv.lastMessage = newest;
                        targetConv.sortTime = newest.created_at || new Date().toISOString();
                        saveLocalConvos();
                    }
                }
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error fetching messages:", err);
        }
    }

    function renderMessages(messages) {
        const el = document.getElementById("msgrMessages");
        if (!el) return;

        const isGroup = State.activeConversationMeta?.is_group;
        const others = State.activeConversationMeta?.others || [];
        const participants = State.activeConversationParticipants || [];

        // Find last message sent by current user
        let lastMyMsgId = null;
        for (let i = (messages || []).length - 1; i >= 0; i--) {
            if (String(messages[i].sender_id) === String(State.currentUserId)) {
                lastMyMsgId = messages[i].id;
                break;
            }
        }

        el.innerHTML = (messages || []).map((m) => {
            const mine = String(m.sender_id) === String(State.currentUserId);
            const senderObj = others.find((o) => String(o.auth_user_id) === String(m.sender_id) || String(o.id) === String(m.sender_id));
            const senderName = mine ? null : (senderObj?.name || senderObj?.display_name || (State.currentUserRole === 'Faculty' ? 'Administrator' : 'Faculty Member'));

            let seenReceiptHtml = "";
            if (mine && m.id === lastMyMsgId) {
                const msgTime = new Date(m.created_at).getTime();
                const seenParticipant = participants.find(p => 
                    String(p.user_id) !== String(State.currentUserId) && 
                    p.last_read_at && 
                    new Date(p.last_read_at).getTime() >= msgTime - 2000
                );

                if (seenParticipant) {
                    const seenTime = formatTime(seenParticipant.last_read_at);
                    const seenUser = others.find(o => String(o.auth_user_id) === String(seenParticipant.user_id) || String(o.id) === String(seenParticipant.user_id));
                    const seenAvatar = seenUser?.avatar_url 
                        ? `<img src="${seenUser.avatar_url}" class="msgr-seen-avatar" alt="">` 
                        : `<i class="fa-solid fa-circle-check"></i>`;
                    seenReceiptHtml = `<div class="msgr-seen-receipt seen" title="Seen at ${new Date(seenParticipant.last_read_at).toLocaleTimeString()}">${seenAvatar} Seen ${seenTime}</div>`;
                } else {
                    seenReceiptHtml = `<div class="msgr-seen-receipt"><i class="fa-regular fa-circle-check"></i> Delivered</div>`;
                }
            }

            return `
                <div class="msgr-bubble-row ${mine ? "mine" : "theirs"}">
                    ${isGroup && !mine ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ""}
                    <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                    <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                    ${seenReceiptHtml}
                </div>`;
        }).join("");

        el.scrollTop = el.scrollHeight;
    }

    /**
     * Send message in active conversation with instant local persistence
     */
    async function sendMessage() {
        const input = document.getElementById("msgrInput");
        const content = input?.value.trim();
        if (!content || !State.activeConversationId || !State.currentUserId) return;

        const sb = getClient();
        input.value = "";
        input.style.height = "auto";
        const sendBtn = document.getElementById("msgrSendBtn");
        if (sendBtn) sendBtn.disabled = true;

        const activeId = State.activeConversationId;
        const nowIso = new Date().toISOString();

        // 1. Instant local message object creation
        const localMsgObj = {
            id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            conversation_id: activeId,
            sender_id: State.currentUserId,
            content: content,
            created_at: nowIso
        };

        const existingMsgs = loadLocalMessages(activeId);
        existingMsgs.push(localMsgObj);
        saveLocalMessages(activeId, existingMsgs);

        // Immediate UI render
        renderMessages(existingMsgs);

        // Update local conversation state lastMessage & save
        const activeConv = State.conversations.find(c => String(c.id) === String(activeId));
        if (activeConv) {
            activeConv.lastMessage = localMsgObj;
            activeConv.sortTime = nowIso;
        }
        saveLocalConvos();

        renderConversationList("");
        renderExpandedConvoList();

        try {
            if (sb) {
                const { data: sentMsg, error } = await sb.from("messages").insert({
                    conversation_id: activeId,
                    sender_id: State.currentUserId,
                    content: content
                }).select().maybeSingle();

                if (error) {
                    console.warn("CiteFlowMessenger: Database message delivery notice:", error);
                } else if (sentMsg) {
                    try {
                        await sb.from("conversations").update({ last_message_at: nowIso }).eq("id", activeId);
                    } catch (_) {}

                    const refreshedMsgs = loadLocalMessages(activeId);
                    const idx = refreshedMsgs.findIndex(m => m.id === localMsgObj.id);
                    if (idx !== -1) {
                        refreshedMsgs[idx] = sentMsg;
                        saveLocalMessages(activeId, refreshedMsgs);
                    }
                    if (activeConv) {
                        activeConv.lastMessage = sentMsg;
                        saveLocalConvos();
                    }
                }
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error during background message sync:", err);
        }

        renderConversationList("");
        renderExpandedConvoList();
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
     * Real-time message receiver handler - immediately updates conversation preview, timestamp, read status, and sorting
     */
    function handleRealtimeMessageReceived(msg) {
        if (!msg || !msg.conversation_id) return;
        const cid = String(msg.conversation_id);

        // If a new message arrives in a previously soft-deleted conversation, restore it to main list
        if (State.deletedConvoIds.has(cid)) {
            State.deletedConvoIds.delete(cid);
            saveDeletedState();
            // Also un-archive it since a new message was received
            State.archivedConvoIds.delete(cid);
            saveArchivedState();
            const restoredConv = State.conversations.find(c => String(c.id) === cid);
            if (restoredConv) {
                restoredConv.isArchived = false;
                restoredConv.isSoftDeleted = false;
            }
        }

        const conv = State.conversations.find(c => String(c.id) === cid);
        const isFromMe = String(msg.sender_id) === String(State.currentUserId);
        const isActiveChat = String(State.activeConversationId) === cid;

        if (conv) {
            conv.lastMessage = msg;
            conv.sortTime = msg.created_at || new Date().toISOString();

            if (isActiveChat) {
                conv.unread = false;
                markConversationRead(cid);
            } else if (!isFromMe) {
                conv.unread = true;
            }

            // Re-sort: pinned first, then sortTime descending
            State.conversations.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return new Date(b.sortTime || 0) - new Date(a.sortTime || 0);
            });

            saveLocalConvos();
            renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
            renderExpandedConvoList();
            updateUnreadBadge();
        } else {
            // New conversation created by someone else or restored
            loadConversations();
        }
    }

    /**
     * Real-time listeners
     */
    function subscribeToActiveConversation(conversationId) {
        const sb = getClient();
        if (!sb) return;

        if (State.messageChannel) {
            sb.removeChannel(State.messageChannel);
            State.messageChannel = null;
        }

        if (State.activeChatPollingTimer) {
            clearInterval(State.activeChatPollingTimer);
            State.activeChatPollingTimer = null;
        }

        State.messageChannel = sb
            .channel(`msgr-convo-${conversationId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
                async (payload) => {
                    await loadMessages(conversationId);
                    if (State.isExpanded) {
                        await loadExpandedMessages(conversationId);
                    }
                    if (payload.new) {
                        handleRealtimeMessageReceived(payload.new);
                    }
                }
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}` },
                async () => {
                    await loadMessages(conversationId);
                    if (State.isExpanded) {
                        await loadExpandedMessages(conversationId);
                    }
                }
            )
            .subscribe();

        // 2-second in-chat polling heartbeat to guarantee instant message delivery across private windows
        State.activeChatPollingTimer = setInterval(async () => {
            if (String(State.activeConversationId) === String(conversationId)) {
                await loadMessages(conversationId);
            } else {
                clearInterval(State.activeChatPollingTimer);
                State.activeChatPollingTimer = null;
            }
        }, 2000);
    }

    function subscribeToInbox() {
        const sb = getClient();
        if (!sb) return;

        // Remove existing inbox listener first
        if (State.inboxChannel) {
            try {
                sb.removeChannel(State.inboxChannel);
            } catch (e) {
                console.warn("CiteFlowMessenger: Could not remove old inbox channel:", e);
            }
            State.inboxChannel = null;
        }

        const channel = sb.channel("msgr-inbox-listener-" + (State.currentUserId || 'anon'));

        channel.on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "messages"
            },
            (payload) => {
                if (payload?.new) {
                    if (State.deletedConvoIds.has(String(payload.new.conversation_id))) {
                        State.deletedConvoIds.delete(String(payload.new.conversation_id));
                        saveDeletedState();
                        State.archivedConvoIds.delete(String(payload.new.conversation_id));
                        saveArchivedState();
                    }
                    handleRealtimeMessageReceived(payload.new);
                }
            }
        ).on(
            "postgres_changes",
            { event: "*", schema: "public", table: "admin_profiles" },
            () => {
                loadConversations();
            }
        ).on(
            "postgres_changes",
            { event: "*", schema: "public", table: "faculty" },
            () => {
                loadConversations();
            }
        );

        State.inboxChannel = channel;

        channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("CiteFlowMessenger: Inbox realtime listener connected.");
            }
            if (status === "CHANNEL_ERROR") {
                console.error("CiteFlowMessenger: Inbox realtime listener failed.");
            }
        });

        // 4-second Polling Heartbeat: guarantees message delivery even if WebSockets are blocked/throttled
        if (!State.inboxPollingTimer) {
            State.inboxPollingTimer = setInterval(async () => {
                if (State.currentUserId) {
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
            }, 4000);
        }
    }

    function updateUnreadBadge() {
        const count = State.conversations.filter((c) => c.unread && !c.isArchived).length;
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

        if (sb) {
            // 1. Fetch from public.admin_profiles table first (most up-to-date administrator identities)
            try {
                const { data: adminRows, error: admErr } = await sb
                    .from("admin_profiles")
                    .select("*");

                if (!admErr && Array.isArray(adminRows)) {
                    for (const a of adminRows) {
                        const emailClean = (a.email || '').trim().toLowerCase();
                        if (emailClean && seenEmails.has(emailClean)) continue;
                        // Skip if this admin IS the current user (by id or email)
                        if (a.id && String(a.id) === String(State.currentUserId)) continue;
                        if (emailClean && emailClean === State.currentUserEmail?.toLowerCase()) continue;

                        if (emailClean) seenEmails.add(emailClean);
                        const adminName = a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || "Administrator";
                        results.push({
                            id: a.id,
                            auth_user_id: a.id,
                            name: adminName,
                            display_name: adminName,
                            email: a.email,
                            avatar_url: a.avatar_url || a.profile_photo_url || null,
                            department: a.department || "CITE Administration",
                            role: a.role || "Administrator",
                            position: "Administrator"
                        });
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching admin profiles:", e);
            }

            // 2. Fetch from public.faculty table
            try {
                const { data: facultyRows, error: facErr } = await sb
                    .from("faculty")
                    .select("*");

                if (!facErr && Array.isArray(facultyRows)) {
                    for (const f of facultyRows) {
                        const emailClean = (f.email || '').trim().toLowerCase();
                        if (emailClean && seenEmails.has(emailClean)) continue;
                        if (f.auth_user_id && String(f.auth_user_id) === String(State.currentUserId)) continue;
                        // Also skip by email in case auth_user_id isn't linked yet
                        if (emailClean && emailClean === State.currentUserEmail?.toLowerCase()) continue;

                        if (emailClean) seenEmails.add(emailClean);
                        const displayName = f.full_name || f.name || f.email || "Faculty Member";
                        results.push({
                            id: f.id,
                            auth_user_id: f.auth_user_id || f.id,
                            name: displayName,
                            display_name: displayName,
                            email: f.email,
                            avatar_url: f.profile_photo_url || f.avatar_url || null,
                            department: f.department || "CITE Faculty",
                            role: f.role || "Faculty",
                            position: f.position || "Faculty"
                        });
                    }
                }
            } catch (e) {
                console.warn("CiteFlowMessenger: Notice fetching faculty directory:", e);
            }

            // 3. Default Administrator fallback for faculty view
            if (State.currentUserRole !== 'Admin' && !results.some(r => r.role === 'Administrator' || r.role === 'Admin')) {
                results.push({
                    id: 'admin-system',
                    auth_user_id: 'admin-system',
                    name: 'Administrator',
                    display_name: 'Administrator',
                    email: 'admin@citeflow.edu.ph',
                    avatar_url: null,
                    department: 'CITE Administration',
                    role: 'Admin',
                    position: 'Administrator'
                });
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

            // Also search DB for existing direct conversation with this counterpart
            if (!existing) {
                try {
                    const { data: dbDirectConvos } = await sb
                        .from("conversations")
                        .select("id, name, is_group, created_by, created_at")
                        .or("is_group.eq.false,is_group.is.null")
                        .order("created_at", { ascending: true })
                        .limit(10);

                    if (Array.isArray(dbDirectConvos) && dbDirectConvos.length > 0) {
                        existing = {
                            id: dbDirectConvos[0].id,
                            is_group: false,
                            name: null,
                            others: validRecipients,
                            displayName: validRecipients[0]?.name || validRecipients[0]?.display_name || "Colleague",
                            unread: false,
                            lastMessage: null,
                            isPinned: false,
                            isArchived: false,
                            sortTime: new Date().toISOString()
                        };
                        // Register current user and target in participants
                        sb.from("conversation_participants").upsert([
                            { conversation_id: existing.id, user_id: State.currentUserId }
                        ], { onConflict: "conversation_id, user_id" }).then();
                    }
                } catch (_) {}
            }

            if (existing) {
                closeNewModal();
                if (State.isExpanded) {
                    openExpandedConversation(existing);
                } else {
                    openConversation(existing);
                }
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

            // Ensure valid UUIDs for all participants
            const participantRows = [
                { conversation_id: conv.id, user_id: State.currentUserId }
            ];

            for (const u of validRecipients) {
                let targetUid = u.auth_user_id;
                // If auth_user_id is missing or not a UUID, query admin_profiles and faculty table
                if (!targetUid || !String(targetUid).includes('-')) {
                    try {
                        if (u.role === 'Admin' || u.role === 'Administrator' || u.id === 'admin-system') {
                            const { data: admData } = await sb
                                .from('admin_profiles')
                                .select('id')
                                .limit(1)
                                .maybeSingle();
                            if (admData?.id) targetUid = admData.id;
                        }
                    } catch (_) {}

                    if (!targetUid || !String(targetUid).includes('-')) {
                        try {
                            const { data: facData } = await sb
                                .from('faculty')
                                .select('auth_user_id')
                                .or(`email.ilike.${u.email || ''},id.eq.${u.id || 0}`)
                                .maybeSingle();
                            if (facData?.auth_user_id) {
                                targetUid = facData.auth_user_id;
                            }
                        } catch (_) {}
                    }
                }

                if (targetUid && String(targetUid).includes('-')) {
                    participantRows.push({
                        conversation_id: conv.id,
                        user_id: targetUid
                    });
                }
            }

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

            // Prepend created conversation object to State.conversations & persist
            State.conversations = [createdObj, ...State.conversations.filter(c => c.id !== conv.id)];
            saveLocalConvos();
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
                    // Remove from both archived and soft-deleted sets
                    State.archivedConvoIds.delete(cid);
                    saveArchivedState();
                    State.deletedConvoIds.delete(String(cid));
                    saveDeletedState();
                    const conv = State.conversations.find(c => String(c.id) === String(cid));
                    if (conv) {
                        conv.isArchived = false;
                        conv.isSoftDeleted = false;
                    }
                    saveLocalConvos();
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
                saveLocalConvos();
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
                    saveLocalConvos();
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
                if (State.isExpanded) {
                    openExpandedConversation(conv);
                } else {
                    openConversation(conv);
                }
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
                    saveConvoMeta(convoId, { displayName: cleanName });
                    saveLocalConvos();
                    if (sb && conv.is_group) {
                        try {
                            await sb.from('conversations').update({ name: cleanName }).eq('id', convoId);
                        } catch (_) {}
                    }
                    renderConversationList(document.getElementById("msgrConvoSearch")?.value.trim().toLowerCase() || "");
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
                saveLocalConvos();
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
                saveLocalConvos();
                renderConversationList("");
                renderExpandedConvoList();
                updateUnreadBadge();
                showCustomToast('Chat restored from Archive');
                break;
            case 'delete':
                const confirmed = await CiteFlowModal.confirm(
                    'Delete this chat for you? The conversation will be moved to Archive and can be restored anytime. The other person will not be affected.',
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

                    saveLocalConvos();
                    if (State.activeConversationId === convoId) closeActiveChat();
                    renderConversationList("");
                    renderExpandedConvoList();
                    updateUnreadBadge();
                    showCustomToast('Chat moved to Archive');
                }
                break;
            case 'report':
                await CiteFlowModal.alert('This conversation has been reported. Thank you for helping keep our platform safe.', 'Report Chat');
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
                        saveLocalConvos();
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

        // Section 2: People from directory
        if (!State.directoryCache || State.directoryCache.length === 0) {
            State.directoryCache = await fetchDirectory();
        }

        const matchingPeople = State.directoryCache.filter(u => {
            if (!u) return false;
            const name = (u.name || u.display_name || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const dept = (u.department || '').toLowerCase();
            const role = (u.role || '').toLowerCase();
            return name.includes(q) || email.includes(q) || dept.includes(q) || role.includes(q);
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

                        // If a conversation with this person already exists, open it directly
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
                            if (State.isExpanded) {
                                openExpandedConversation(existing);
                            } else {
                                openConversation(existing);
                            }
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
            // Filter self out of others to prevent showing own avatar as "other person"
            const safeOthers = (c.others || []).filter(o =>
                String(o.auth_user_id) !== String(State.currentUserId) &&
                String(o.id) !== String(State.currentUserId) &&
                (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
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

        // Always filter self out of others to prevent self-identity confusion
        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId) &&
            (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
        );

        let expDisplayName = conv.displayName;
        if (!conv.is_group && safeOthers.length > 0) {
            expDisplayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        } else if (!conv.is_group && safeOthers.length === 0) {
            if (conv.displayName && conv.displayName !== "Administrator" && conv.displayName !== "Faculty Member") {
                expDisplayName = conv.displayName;
            } else {
                expDisplayName = State.currentUserRole === 'Admin' ? "Faculty Member" : "Administrator";
            }
        }

        let expOtherAvatarUrl = (safeOthers.length > 0 && !conv.is_group) ? safeOthers[0].avatar_url : null;
        if (!expOtherAvatarUrl && !conv.is_group) {
            expOtherAvatarUrl = conv.avatar_url || conv.profile_photo_url || conv.others?.[0]?.avatar_url || null;
        }

        if (nameEl) nameEl.textContent = expDisplayName;
        if (subEl) subEl.textContent = conv.is_group ? `${safeOthers.length + 1} members` : (safeOthers[0]?.department || safeOthers[0]?.role || 'Member');
        if (avatarEl) {
            avatarEl.outerHTML = renderAvatar(conv.is_group ? null : expOtherAvatarUrl, expDisplayName, conv.is_group)
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
        if (!conversationId) return;

        // 1. Instant render from local cache
        const localMsgs = loadLocalMessages(conversationId);
        if (localMsgs.length > 0) {
            renderExpandedMessages(localMsgs);
        }

        const sb = getClient();
        if (!sb) return;

        try {
            const { data, error } = await sb.from("messages").select("*")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true }).limit(150);

            if (error) {
                console.warn("CiteFlowMessenger: Notice loading expanded messages:", error);
                return;
            }

            // Fetch participants for seen receipts
            try {
                const { data: partData } = await sb
                    .from("conversation_participants")
                    .select("user_id, last_read_at")
                    .eq("conversation_id", conversationId);
                if (Array.isArray(partData)) {
                    State.activeConversationParticipants = partData;
                }
            } catch (_) {}

            if (Array.isArray(data)) {
                const unconfirmedTemp = localMsgs.filter(lm => {
                    if (!String(lm.id).startsWith('temp_')) return false;
                    const matchedInDb = data.some(dm => 
                        String(dm.sender_id) === String(lm.sender_id) && 
                        dm.content === lm.content &&
                        Math.abs(new Date(dm.created_at) - new Date(lm.created_at)) < 30000
                    );
                    return !matchedInDb;
                });

                const combined = (data.length === 0 && localMsgs.length > 0) ? localMsgs : [...data, ...unconfirmedTemp];
                combined.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

                saveLocalMessages(conversationId, combined);
                renderExpandedMessages(combined);

                if (combined.length > 0) {
                    const newest = combined[combined.length - 1];
                    const targetConv = State.conversations.find(c => String(c.id) === String(conversationId));
                    if (targetConv) {
                        targetConv.lastMessage = newest;
                        targetConv.sortTime = newest.created_at || new Date().toISOString();
                        saveLocalConvos();
                    }
                }
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error fetching expanded messages:", err);
        }
    }

    function renderExpandedMessages(messages) {
        const el = document.getElementById("msgrExpMessages");
        if (!el) return;
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

        el.innerHTML = (messages || []).map(m => {
            const mine = String(m.sender_id) === String(State.currentUserId);
            const senderObj = others.find(o => String(o.auth_user_id) === String(m.sender_id) || String(o.id) === String(m.sender_id));
            const senderName = mine ? null : (senderObj?.name || senderObj?.display_name || (State.currentUserRole === 'Faculty' ? 'Administrator' : 'Faculty Member'));

            let seenReceiptHtml = "";
            if (mine && m.id === lastMyMsgId) {
                const msgTime = new Date(m.created_at).getTime();
                const seenParticipant = participants.find(p => 
                    String(p.user_id) !== String(State.currentUserId) && 
                    p.last_read_at && 
                    new Date(p.last_read_at).getTime() >= msgTime - 2000
                );

                if (seenParticipant) {
                    const seenTime = formatTime(seenParticipant.last_read_at);
                    const seenUser = others.find(o => String(o.auth_user_id) === String(seenParticipant.user_id) || String(o.id) === String(seenParticipant.user_id));
                    const seenAvatar = seenUser?.avatar_url 
                        ? `<img src="${seenUser.avatar_url}" class="msgr-seen-avatar" alt="">` 
                        : `<i class="fa-solid fa-circle-check"></i>`;
                    seenReceiptHtml = `<div class="msgr-seen-receipt seen" title="Seen at ${new Date(seenParticipant.last_read_at).toLocaleTimeString()}">${seenAvatar} Seen ${seenTime}</div>`;
                } else {
                    seenReceiptHtml = `<div class="msgr-seen-receipt"><i class="fa-regular fa-circle-check"></i> Delivered</div>`;
                }
            }

            return `
                <div class="msgr-bubble-row ${mine ? 'mine' : 'theirs'}">
                    ${isGroup && !mine ? `<div class="msgr-sender-label">${escapeHtml(senderName)}</div>` : ''}
                    <div class="msgr-bubble">${escapeHtml(m.content)}</div>
                    <div class="msgr-bubble-time">${formatTime(m.created_at)}</div>
                    ${seenReceiptHtml}
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
        const sendBtn = document.getElementById('msgrExpSendBtn');
        if (sendBtn) sendBtn.disabled = true;

        const activeId = State.activeConversationId;
        const nowIso = new Date().toISOString();

        // 1. Instant local message object creation
        const localMsgObj = {
            id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            conversation_id: activeId,
            sender_id: State.currentUserId,
            content: content,
            created_at: nowIso
        };

        const existingMsgs = loadLocalMessages(activeId);
        existingMsgs.push(localMsgObj);
        saveLocalMessages(activeId, existingMsgs);

        renderExpandedMessages(existingMsgs);

        // Update local conversation state lastMessage & save
        const activeConv = State.conversations.find(c => String(c.id) === String(activeId));
        if (activeConv) {
            activeConv.lastMessage = localMsgObj;
            activeConv.sortTime = nowIso;
        }
        saveLocalConvos();

        renderConversationList("");
        renderExpandedConvoList();

        try {
            if (sb) {
                const { data: sentMsg, error } = await sb.from('messages').insert({
                    conversation_id: activeId,
                    sender_id: State.currentUserId,
                    content: content
                }).select().maybeSingle();

                if (error) {
                    console.warn("CiteFlowMessenger: Notice inserting expanded message in DB:", error);
                } else if (sentMsg) {
                    try {
                        await sb.from('conversations').update({ last_message_at: nowIso }).eq('id', activeId);
                    } catch (_) {}

                    const refreshedMsgs = loadLocalMessages(activeId);
                    const idx = refreshedMsgs.findIndex(m => m.id === localMsgObj.id);
                    if (idx !== -1) {
                        refreshedMsgs[idx] = sentMsg;
                        saveLocalMessages(activeId, refreshedMsgs);
                    }
                    if (activeConv) {
                        activeConv.lastMessage = sentMsg;
                        saveLocalConvos();
                    }
                }
            }
        } catch (err) {
            console.warn("CiteFlowMessenger: Error during background expanded message sync:", err);
        }

        renderConversationList("");
        renderExpandedConvoList();
    }

    function renderExpandedInfoPanel(conv) {
        const inner = document.getElementById("msgrExpInfoInner");
        if (!inner || !conv) return;

        const isGroup = conv.is_group;
        const safeOthers = (conv.others || []).filter(o =>
            String(o.auth_user_id) !== String(State.currentUserId) &&
            String(o.id) !== String(State.currentUserId) &&
            (!o.email || o.email.toLowerCase() !== String(State.currentUserEmail || '').toLowerCase())
        );

        let displayName = conv.displayName;
        if (!isGroup && safeOthers.length > 0) {
            displayName = safeOthers[0].name || safeOthers[0].display_name || conv.displayName;
        }

        const otherAvatarUrl = (safeOthers.length > 0 && !isGroup) ? safeOthers[0].avatar_url : null;
        const allMembers = [
            { name: 'You', department: State.currentUserRole, isSelf: true, avatar_url: null },
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

