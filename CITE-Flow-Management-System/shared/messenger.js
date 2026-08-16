// =========================================================
// CITE-Flow Messenger
// COMPLETE UPDATED VERSION
// =========================================================

(function () {

    "use strict";


    // =====================================================
    // PRIVATE STATE
    // =====================================================

    let messengerCurrentUser = null;
    let messengerCurrentProfile = null;

    let messengerUsers = [];
    let selectedMessengerUsers = [];

    let messengerInitialized = false;

    let currentConversationId = null;

    let messengerRealtimeChannel = null;
    let messengerMessageChannel = null;

    let isSendingMessage = false;


    // =====================================================
    // INITIALIZE
    // =====================================================

    async function initializeMessenger() {

        if (messengerInitialized) {

            console.log(
                "Messenger is already initialized."
            );

            return;

        }


        console.log(
            "CITE-Flow Messenger starting..."
        );


        try {

            // -------------------------------------------------
            // SUPABASE CHECK
            // -------------------------------------------------

            if (
                typeof supabaseClient ===
                "undefined"
            ) {

                console.error(
                    "Supabase client was not found."
                );

                showMessengerError(
                    "Supabase connection could not be loaded."
                );

                return;

            }


            // -------------------------------------------------
            // AUTH USER
            // -------------------------------------------------

            const {
                data: {
                    user
                },
                error: userError
            } =
                await supabaseClient.auth.getUser();


            if (userError) {

                console.error(
                    "Unable to get authenticated user:",
                    userError
                );

                showMessengerError(
                    "Unable to verify your account."
                );

                return;

            }


            if (!user) {

                console.error(
                    "No authenticated user found."
                );

                showMessengerError(
                    "You are not logged in. Please log in first."
                );

                return;

            }


            messengerCurrentUser =
                user;


            console.log(
                "Authenticated user:",
                messengerCurrentUser.id
            );


            // -------------------------------------------------
            // SESSION
            // -------------------------------------------------

            const {
                data: {
                    session
                },
                error: sessionError
            } =
                await supabaseClient.auth.getSession();


            console.log(
                "Supabase session exists:",
                !!session
            );


            console.log(
                "Supabase session user ID:",
                session?.user?.id || null
            );


            console.log(
                "Access token exists:",
                !!session?.access_token
            );


            if (sessionError) {

                console.error(
                    "Session verification error:",
                    sessionError
                );

                showMessengerError(
                    "Your login session could not be verified."
                );

                return;

            }


            if (!session) {

                showMessengerError(
                    "Your login session has expired. Please log in again."
                );

                return;

            }


            // -------------------------------------------------
            // PROFILE
            // -------------------------------------------------

            await loadCurrentProfile();


            // -------------------------------------------------
            // ENSURE REQUIRED HTML
            // -------------------------------------------------

            ensureMessengerUI();


            // -------------------------------------------------
            // UI EVENTS
            // -------------------------------------------------

            initializeMessengerUI();


            // -------------------------------------------------
            // LOAD CONVERSATIONS
            // -------------------------------------------------

            await loadMessengerConversations();


            // -------------------------------------------------
            // GLOBAL REALTIME
            // -------------------------------------------------

            initializeMessengerRealtime();


            messengerInitialized = true;


            console.log(
                "Messenger initialized successfully."
            );


        } catch (error) {

            console.error(
                "Messenger initialization error:",
                error
            );

            showMessengerError(
                error.message ||
                "Something went wrong while loading Messenger."
            );

        }

    }


    // =====================================================
    // ENSURE MESSENGER UI
    // =====================================================

    function ensureMessengerUI() {

        console.log(
            "Checking Messenger UI elements..."
        );


        const chatPanel =
            document.getElementById(
                "msgrChat"
            );


        if (!chatPanel) {

            console.error(
                "Messenger chat panel #msgrChat was not found."
            );

            return;

        }


        // =================================================
        // ENSURE MESSAGES CONTAINER
        // =================================================

        let messagesContainer =
            document.getElementById(
                "msgrMessages"
            );


        if (!messagesContainer) {

            console.warn(
                "Messages container missing. Creating it."
            );


            messagesContainer =
                document.createElement("div");


            messagesContainer.id =
                "msgrMessages";


            messagesContainer.className =
                "messages-container";


            chatPanel.appendChild(
                messagesContainer
            );

        }


        // =================================================
        // ENSURE MESSAGE COMPOSER
        // =================================================

        let composer =
            document.getElementById(
                "msgrComposer"
            );


        if (!composer) {

            composer =
                document.querySelector(
                    ".message-composer"
                );

        }


        if (!composer) {

            console.warn(
                "Message composer missing. Creating composer dynamically."
            );


            composer =
                document.createElement("div");


            composer.id =
                "msgrComposer";


            composer.className =
                "message-composer";


            composer.innerHTML = `

                <textarea
                    id="msgrInput"
                    rows="1"
                    placeholder="Type a message..."
                    autocomplete="off"
                    disabled
                ></textarea>

                <button
                    type="button"
                    class="send-message-btn"
                    id="msgrSendBtn"
                    disabled
                    title="Send message"
                >

                    <i class="fa-solid fa-paper-plane"></i>

                </button>

            `;


            chatPanel.appendChild(
                composer
            );

        }


        // =================================================
        // ENSURE INPUT
        // =================================================

        let input =
            document.getElementById(
                "msgrInput"
            );


        if (!input) {

            input =
                document.createElement("textarea");


            input.id =
                "msgrInput";


            input.rows =
                1;


            input.placeholder =
                "Type a message...";


            input.autocomplete =
                "off";


            input.disabled =
                true;


            composer.appendChild(
                input
            );

        }


        // =================================================
        // ENSURE SEND BUTTON
        // =================================================

        let sendButton =
            document.getElementById(
                "msgrSendBtn"
            );


        if (!sendButton) {

            sendButton =
                document.createElement("button");


            sendButton.type =
                "button";


            sendButton.id =
                "msgrSendBtn";


            sendButton.className =
                "send-message-btn";


            sendButton.disabled =
                true;


            sendButton.title =
                "Send message";


            sendButton.innerHTML =
                `<i class="fa-solid fa-paper-plane"></i>`;


            composer.appendChild(
                sendButton
            );

        }


        // =================================================
        // FORCE BASIC COMPOSER LAYOUT
        // =================================================

        composer.style.width =
            "100%";


        composer.style.boxSizing =
            "border-box";


        console.log(
            "Message composer verified:",
            composer
        );


        console.log(
            "Message input verified:",
            input
        );


        console.log(
            "Send button verified:",
            sendButton
        );

    }


    // =====================================================
    // LOAD CURRENT PROFILE
    // =====================================================

    async function loadCurrentProfile() {

        if (!messengerCurrentUser) {
            return;
        }


        const {
            data: profile,
            error
        } =
            await supabaseClient
                .from("profiles")
                .select(`
                    id,
                    first_name,
                    last_name,
                    email,
                    role,
                    is_admin
                `)
                .eq(
                    "id",
                    messengerCurrentUser.id
                )
                .single();


        if (error) {

            console.error(
                "Unable to load current profile:",
                error
            );

            showMessengerError(
                "Your user profile could not be loaded."
            );

            return;

        }


        messengerCurrentProfile =
            profile;


        console.log(
            "Current profile:",
            profile
        );


        const subtitle =
            document.querySelector(
                ".messenger-title-area p"
            );


        if (subtitle) {

            const fullName =
                `${profile.first_name || ""} ${profile.last_name || ""}`
                    .trim();


            subtitle.textContent =
                fullName
                    ? `Signed in as ${fullName}`
                    : "Communicate with faculty and administrators";

        }

    }


    // =====================================================
    // INITIALIZE UI
    // =====================================================

    function initializeMessengerUI() {

        console.log(
            "Initializing Messenger interface..."
        );


        // -------------------------------------------------
        // NEW MESSAGE BUTTON
        // -------------------------------------------------

        const newMessageButton =
            document.getElementById(
                "msgrNewBtn"
            );


        if (newMessageButton) {

            newMessageButton.onclick =
                async function () {

                    console.log(
                        "New Message button clicked."
                    );


                    const modal =
                        document.getElementById(
                            "msgrNewModal"
                        );


                    if (!modal) {

                        console.error(
                            "New message modal not found."
                        );

                        return;

                    }


                    selectedMessengerUsers =
                        [];


                    updateCreateButton();


                    modal.classList.add(
                        "show"
                    );


                    modal.style.display =
                        "flex";


                    await loadMessengerUsers();

                };

        }


        // -------------------------------------------------
        // CLOSE
        // -------------------------------------------------

        const closeButton =
            document.getElementById(
                "msgrNewCloseBtn"
            );


        if (closeButton) {

            closeButton.onclick =
                function () {

                    closeNewMessageModal();

                };

        }


        // -------------------------------------------------
        // MODAL OUTSIDE CLICK
        // -------------------------------------------------

        const modal =
            document.getElementById(
                "msgrNewModal"
            );


        if (modal) {

            modal.onclick =
                function (event) {

                    if (
                        event.target ===
                        modal
                    ) {

                        closeNewMessageModal();

                    }

                };

        }


        // -------------------------------------------------
        // USER SEARCH
        // -------------------------------------------------

        const userSearch =
            document.getElementById(
                "msgrUserSearch"
            );


        if (userSearch) {

            userSearch.oninput =
                function () {

                    renderMessengerUsers(
                        userSearch.value
                    );

                };

        }


        // -------------------------------------------------
        // CREATE CONVERSATION
        // -------------------------------------------------

        const createButton =
            document.getElementById(
                "msgrCreateBtn"
            );


        if (createButton) {

            createButton.onclick =
                async function () {

                    await createConversation();

                };

        }


        // -------------------------------------------------
        // CONVERSATION SEARCH
        // -------------------------------------------------

        const conversationSearch =
            document.getElementById(
                "msgrConvoSearch"
            );


        if (conversationSearch) {

            conversationSearch.oninput =
                function () {

                    filterConversationList(
                        conversationSearch.value
                    );

                };

        }


        // -------------------------------------------------
        // SEND BUTTON
        // -------------------------------------------------

        initializeMessageComposerEvents();


        console.log(
            "Messenger interface ready."
        );

    }


    // =====================================================
    // MESSAGE COMPOSER EVENTS
    // =====================================================

    function initializeMessageComposerEvents() {

        const input =
            document.getElementById(
                "msgrInput"
            );


        const sendButton =
            document.getElementById(
                "msgrSendBtn"
            );


        if (!input) {

            console.error(
                "Message input #msgrInput not found."
            );

            return;

        }


        if (!sendButton) {

            console.error(
                "Send button #msgrSendBtn not found."
            );

            return;

        }


        // Avoid duplicate listeners

        if (
            input.dataset.messengerEventsAttached ===
            "true"
        ) {

            return;

        }


        input.dataset.messengerEventsAttached =
            "true";


        sendButton.dataset.messengerEventsAttached =
            "true";


        // -------------------------------------------------
        // SEND BUTTON
        // -------------------------------------------------

        sendButton.addEventListener(
            "click",
            async function () {

                await sendMessage();

            }
        );


        // -------------------------------------------------
        // ENTER TO SEND
        // -------------------------------------------------

        input.addEventListener(
            "keydown",
            async function (event) {

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    await sendMessage();

                }

            }
        );


        // -------------------------------------------------
        // AUTO RESIZE
        // -------------------------------------------------

        input.addEventListener(
            "input",
            function () {

                input.style.height =
                    "auto";


                input.style.height =
                    Math.min(
                        input.scrollHeight,
                        140
                    ) + "px";

            }
        );


        console.log(
            "Message composer events initialized."
        );

    }


    // =====================================================
    // ENABLE MESSAGE COMPOSER
    // =====================================================

    function enableMessageComposer() {

        let composer =
            document.getElementById(
                "msgrComposer"
            );


        if (!composer) {

            composer =
                document.querySelector(
                    ".message-composer"
                );

        }


        // -------------------------------------------------
        // LAST RESORT: CREATE COMPOSER
        // -------------------------------------------------

        if (!composer) {

            console.warn(
                "Message composer missing. Creating dynamically."
            );


            const chatPanel =
                document.getElementById(
                    "msgrChat"
                );


            if (!chatPanel) {

                console.error(
                    "Cannot create composer because #msgrChat is missing."
                );

                return;

            }


            composer =
                document.createElement("div");


            composer.id =
                "msgrComposer";


            composer.className =
                "message-composer";


            composer.innerHTML = `

                <textarea
                    id="msgrInput"
                    rows="1"
                    placeholder="Type a message..."
                    autocomplete="off"
                ></textarea>

                <button
                    type="button"
                    class="send-message-btn"
                    id="msgrSendBtn"
                    title="Send message"
                >
                    <i class="fa-solid fa-paper-plane"></i>
                </button>

            `;


            chatPanel.appendChild(
                composer
            );

        }


        const input =
            document.getElementById(
                "msgrInput"
            );


        const sendButton =
            document.getElementById(
                "msgrSendBtn"
            );


        // -------------------------------------------------
        // FORCE VISIBILITY
        // -------------------------------------------------

        composer.hidden =
            false;


        composer.removeAttribute(
            "hidden"
        );


        composer.style.display =
            "flex";


        composer.style.visibility =
            "visible";


        composer.style.opacity =
            "1";


        composer.style.width =
            "100%";


        composer.style.boxSizing =
            "border-box";


        // -------------------------------------------------
        // ENABLE INPUT
        // -------------------------------------------------

        if (input) {

            input.disabled =
                false;


            input.readOnly =
                false;


            input.removeAttribute(
                "disabled"
            );


            input.focus();

        }


        // -------------------------------------------------
        // ENABLE BUTTON
        // -------------------------------------------------

        if (sendButton) {

            sendButton.disabled =
                false;


            sendButton.removeAttribute(
                "disabled"
            );

        }


        // -------------------------------------------------
        // EVENTS
        // -------------------------------------------------

        initializeMessageComposerEvents();


        console.log(
            "MESSAGE COMPOSER ENABLED:",
            composer
        );

    }


    // =====================================================
    // LOAD USERS
    // =====================================================

    async function loadMessengerUsers() {

        const results =
            document.getElementById(
                "msgrUserResults"
            );


        if (!results) {
            return;
        }


        results.innerHTML = `

            <div class="user-results-empty">

                <i class="fa-solid fa-spinner fa-spin"></i>

                <p>
                    Loading users...
                </p>

            </div>

        `;


        try {

            const {
                data: users,
                error
            } =
                await supabaseClient
                    .from("profiles")
                    .select(`
                        id,
                        first_name,
                        last_name,
                        email,
                        role,
                        is_admin
                    `)
                    .order(
                        "first_name",
                        {
                            ascending: true
                        }
                    );


            if (error) {

                console.error(
                    "Unable to load users:",
                    error
                );


                results.innerHTML = `

                    <div class="user-results-empty">

                        <i class="fa-solid fa-circle-exclamation"></i>

                        <p>
                            Unable to load users.
                        </p>

                    </div>

                `;

                return;

            }


            messengerUsers =
                (users || []).filter(
                    user =>
                        user.id !==
                        messengerCurrentUser.id
                );


            renderMessengerUsers();

        } catch (error) {

            console.error(
                "User loading error:",
                error
            );

        }

    }


    // =====================================================
    // RENDER USERS
    // =====================================================

    function renderMessengerUsers(
        searchTerm = ""
    ) {

        const results =
            document.getElementById(
                "msgrUserResults"
            );


        if (!results) {
            return;
        }


        const search =
            String(searchTerm)
                .trim()
                .toLowerCase();


        const filtered =
            messengerUsers.filter(
                user => {

                    const first =
                        user.first_name || "";

                    const last =
                        user.last_name || "";

                    const email =
                        user.email || "";

                    const role =
                        user.role || "";


                    const fullName =
                        `${first} ${last}`;


                    return (
                        !search ||
                        fullName
                            .toLowerCase()
                            .includes(search) ||
                        email
                            .toLowerCase()
                            .includes(search) ||
                        role
                            .toLowerCase()
                            .includes(search)
                    );

                }
            );


        if (!filtered.length) {

            results.innerHTML = `

                <div class="user-results-empty">

                    <i class="fa-solid fa-user-slash"></i>

                    <p>
                        No users found.
                    </p>

                </div>

            `;

            return;

        }


        results.innerHTML =
            filtered
                .map(
                    user =>
                        createUserResultHTML(user)
                )
                .join("");


        results
            .querySelectorAll(
                ".messenger-user-result"
            )
            .forEach(
                element => {

                    element.onclick =
                        function () {

                            toggleMessengerUser(
                                element.dataset.userId
                            );

                        };

                }
            );

    }


    // =====================================================
    // USER RESULT HTML
    // =====================================================

    function createUserResultHTML(
        user
    ) {

        const selected =
            selectedMessengerUsers.some(
                item =>
                    item.id ===
                    user.id
            );


        const first =
            user.first_name || "";


        const last =
            user.last_name || "";


        const fullName =
            `${first} ${last}`.trim();


        const role =
            user.role === "admin" ||
            user.is_admin
                ? "Administrator"
                : "Faculty";


        return `

            <div
                class="messenger-user-result ${
                    selected ? "selected" : ""
                }"
                data-user-id="${escapeHTML(user.id)}"
                role="button"
                tabindex="0"
            >

                <div class="messenger-user-avatar">

                    ${escapeHTML(
                        getInitials(
                            first,
                            last
                        )
                    )}

                </div>

                <div class="messenger-user-info">

                    <strong>
                        ${escapeHTML(
                            fullName ||
                            user.email ||
                            "User"
                        )}
                    </strong>

                    <span>
                        ${escapeHTML(role)}
                    </span>

                    ${
                        user.email
                            ? `
                                <small>
                                    ${escapeHTML(user.email)}
                                </small>
                              `
                            : ""
                    }

                </div>

                <div class="messenger-user-check">

                    ${
                        selected
                            ? `
                                <i class="fa-solid fa-circle-check"></i>
                              `
                            : `
                                <i class="fa-regular fa-circle"></i>
                              `
                    }

                </div>

            </div>

        `;

    }


    // =====================================================
    // SELECT USER
    // =====================================================

    function toggleMessengerUser(
        userId
    ) {

        const user =
            messengerUsers.find(
                item =>
                    item.id ===
                    userId
            );


        if (!user) {
            return;
        }


        const index =
            selectedMessengerUsers.findIndex(
                item =>
                    item.id ===
                    userId
            );


        if (index >= 0) {

            selectedMessengerUsers.splice(
                index,
                1
            );

        } else {

            selectedMessengerUsers.push(
                user
            );

        }


        const search =
            document.getElementById(
                "msgrUserSearch"
            );


        renderMessengerUsers(
            search
                ? search.value
                : ""
        );


        updateCreateButton();

    }


    // =====================================================
    // CREATE BUTTON
    // =====================================================

    function updateCreateButton() {

        const button =
            document.getElementById(
                "msgrCreateBtn"
            );


        const hint =
            document.getElementById(
                "msgrNewHint"
            );


        const groupField =
            document.getElementById(
                "msgrGroupNameField"
            );


        const count =
            selectedMessengerUsers.length;


        if (button) {

            button.disabled =
                count === 0;

        }


        if (groupField) {

            groupField.style.display =
                count > 1
                    ? "block"
                    : "none";

        }


        if (hint) {

            hint.textContent =
                count === 0
                    ? "Pick one person to message, or select multiple people to start a group."
                    : count === 1
                        ? "One person selected."
                        : `${count} people selected.`;

        }

    }


    // =====================================================
    // LOAD CONVERSATIONS
    // =====================================================

    async function loadMessengerConversations() {

        const list =
            document.getElementById(
                "msgrList"
            );


        const countElement =
            document.getElementById(
                "conversationCount"
            );


        if (!list) {

            console.error(
                "Conversation list #msgrList not found."
            );

            return;

        }


        list.innerHTML = `

            <div class="messenger-empty">

                <i class="fa-solid fa-spinner fa-spin"></i>

                <p>
                    Loading conversations...
                </p>

            </div>

        `;


        try {

            const {
                data: conversations,
                error
            } =
                await supabaseClient
                    .from("conversations")
                    .select(`
                        id,
                        is_group,
                        name,
                        created_by,
                        created_at,
                        conversation_participants (
                            user_id
                        )
                    `)
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    );


            if (error) {

                throw error;

            }


            const mine =
                (conversations || [])
                    .filter(
                        conversation => {

                            const participants =
                                conversation
                                    .conversation_participants ||
                                [];


                            return participants.some(
                                participant =>
                                    participant.user_id ===
                                    messengerCurrentUser.id
                            );

                        }
                    );


            if (!mine.length) {

                list.innerHTML = `

                    <div class="messenger-empty">

                        <i class="fa-regular fa-comments"></i>

                        <p>
                            No conversations yet.
                        </p>

                        <small>
                            Click New Message to start chatting.
                        </small>

                    </div>

                `;


                if (countElement) {

                    countElement.textContent =
                        "0 Conversations";

                }


                return;

            }


            // -------------------------------------------------
            // PARTICIPANT IDS
            // -------------------------------------------------

            const participantIds = [
                ...new Set(
                    mine.flatMap(
                        conversation =>
                            (
                                conversation
                                    .conversation_participants ||
                                []
                            ).map(
                                participant =>
                                    participant.user_id
                            )
                    )
                )
            ];


            // -------------------------------------------------
            // PROFILES
            // -------------------------------------------------

            let profiles = [];


            if (participantIds.length) {

                const {
                    data,
                    error:
                        profileError
                } =
                    await supabaseClient
                        .from("profiles")
                        .select(`
                            id,
                            first_name,
                            last_name,
                            email,
                            role,
                            is_admin
                        `)
                        .in(
                            "id",
                            participantIds
                        );


                if (profileError) {

                    console.error(
                        "Profile loading error:",
                        profileError
                    );

                } else {

                    profiles =
                        data || [];

                }

            }


            const profileMap =
                new Map(
                    profiles.map(
                        profile => [
                            profile.id,
                            profile
                        ]
                    )
                );


            mine.forEach(
                conversation => {

                    (
                        conversation
                            .conversation_participants ||
                        []
                    ).forEach(
                        participant => {

                            participant.profile =
                                profileMap.get(
                                    participant.user_id
                                ) || null;

                        }
                    );

                }
            );


            if (countElement) {

                countElement.textContent =
                    `${mine.length} ${
                        mine.length === 1
                            ? "Conversation"
                            : "Conversations"
                    }`;

            }


            list.innerHTML =
                mine
                    .map(
                        conversation =>
                            createConversationHTML(
                                conversation
                            )
                    )
                    .join("");


            list
                .querySelectorAll(
                    ".messenger-conversation"
                )
                .forEach(
                    element => {

                        element.onclick =
                            async function () {

                                const id =
                                    element.dataset.conversationId;


                                if (!id) {
                                    return;
                                }


                                await openConversation(
                                    id
                                );

                            };

                    }
                );


        } catch (error) {

            console.error(
                "Conversation loading error:",
                error
            );


            list.innerHTML = `

                <div class="messenger-empty">

                    <i class="fa-solid fa-circle-exclamation"></i>

                    <p>
                        Unable to load conversations.
                    </p>

                    <small>
                        ${escapeHTML(
                            error.message
                        )}
                    </small>

                </div>

            `;

        }

    }


    // =====================================================
    // CONVERSATION HTML
    // =====================================================

    function createConversationHTML(
        conversation
    ) {

        const participants =
            conversation
                .conversation_participants ||
            [];


        const others =
            participants.filter(
                participant =>
                    participant.user_id !==
                    messengerCurrentUser.id
            );


        let name =
            "Conversation";


        let initials =
            "C";


        let subtitle =
            "Conversation";


        if (conversation.is_group) {

            const names =
                others
                    .map(
                        participant => {

                            const profile =
                                participant.profile;


                            if (!profile) {
                                return null;
                            }


                            return (
                                `${profile.first_name || ""} ${
                                    profile.last_name || ""
                                }`
                            ).trim();

                        }
                    )
                    .filter(Boolean);


            name =
                conversation.name ||
                names.join(", ") ||
                "Group Conversation";


            initials =
                "GP";


            subtitle =
                `${participants.length} participants`;

        } else {

            const other =
                others[0];


            const profile =
                other
                    ? other.profile
                    : null;


            if (profile) {

                name =
                    `${profile.first_name || ""} ${
                        profile.last_name || ""
                    }`.trim();


                if (!name) {

                    name =
                        profile.email ||
                        "User";

                }


                initials =
                    getInitials(
                        profile.first_name,
                        profile.last_name
                    );


                subtitle =
                    profile.role === "admin" ||
                    profile.is_admin
                        ? "Administrator"
                        : "Faculty";

            }

        }


        return `

            <div
                class="messenger-conversation ${
                    currentConversationId === conversation.id
                        ? "active"
                        : ""
                }"
                data-conversation-id="${escapeHTML(
                    conversation.id
                )}"
                role="button"
                tabindex="0"
            >

                <div class="conversation-avatar">
                    ${escapeHTML(initials)}
                </div>

                <div class="conversation-info">

                    <strong>
                        ${escapeHTML(name)}
                    </strong>

                    <span>
                        ${escapeHTML(subtitle)}
                    </span>

                </div>

            </div>

        `;

    }


    // =====================================================
    // FILTER
    // =====================================================

    function filterConversationList(
        value
    ) {

        const search =
            String(value || "")
                .toLowerCase()
                .trim();


        document
            .querySelectorAll(
                ".messenger-conversation"
            )
            .forEach(
                element => {

                    element.style.display =
                        !search ||
                        element.textContent
                            .toLowerCase()
                            .includes(search)
                            ? ""
                            : "none";

                }
            );

    }


    // =====================================================
    // CREATE CONVERSATION
    // =====================================================

    async function createConversation() {

        if (
            !messengerCurrentUser ||
            !selectedMessengerUsers.length
        ) {

            return;

        }


        const button =
            document.getElementById(
                "msgrCreateBtn"
            );


        const originalHTML =
            button
                ? button.innerHTML
                : "";


        try {

            const {
                data: {
                    user
                },
                error:
                    authError
            } =
                await supabaseClient.auth.getUser();


            if (
                authError ||
                !user
            ) {

                throw new Error(
                    "No authenticated user found."
                );

            }


            const isGroup =
                selectedMessengerUsers.length > 1;


            let conversationName =
                null;


            if (isGroup) {

                const groupInput =
                    document.getElementById(
                        "msgrGroupNameInput"
                    );


                conversationName =
                    groupInput
                        ? groupInput.value.trim()
                        : "";


                if (!conversationName) {

                    conversationName =
                        selectedMessengerUsers
                            .map(
                                user =>
                                    `${user.first_name || ""} ${
                                        user.last_name || ""
                                    }`.trim()
                            )
                            .join(", ");

                }

            }


            // -------------------------------------------------
            // PRIVATE EXISTING
            // -------------------------------------------------

            if (!isGroup) {

                const existing =
                    await findExistingPrivateConversation(
                        selectedMessengerUsers[0].id
                    );


                if (existing) {

                    closeNewMessageModal();

                    await loadMessengerConversations();

                    await openConversation(
                        existing.id
                    );

                    return;

                }

            }


            if (button) {

                button.disabled =
                    true;


                button.innerHTML = `
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    Creating...
                `;

            }


            // -------------------------------------------------
            // CREATE CONVERSATION
            // -------------------------------------------------

            const {
                data: conversation,
                error:
                    conversationError
            } =
                await supabaseClient
                    .from("conversations")
                    .insert({
                        is_group:
                            isGroup,

                        name:
                            conversationName,

                        created_by:
                            user.id
                    })
                    .select()
                    .single();


            if (conversationError) {

                throw conversationError;

            }


            // -------------------------------------------------
            // PARTICIPANTS
            // -------------------------------------------------

            const participantIds = [
                user.id,
                ...selectedMessengerUsers.map(
                    selected =>
                        selected.id
                )
            ];


            const participantRows =
                participantIds.map(
                    id => ({

                        conversation_id:
                            conversation.id,

                        user_id:
                            id

                    })
                );


            const {
                error:
                    participantError
            } =
                await supabaseClient
                    .from(
                        "conversation_participants"
                    )
                    .insert(
                        participantRows
                    );


            if (participantError) {

                await supabaseClient
                    .from("conversations")
                    .delete()
                    .eq(
                        "id",
                        conversation.id
                    );


                throw participantError;

            }


            console.log(
                "Conversation created successfully:",
                conversation.id
            );


            closeNewMessageModal();


            await loadMessengerConversations();


            await openConversation(
                conversation.id
            );


        } catch (error) {

            console.error(
                "Unable to create conversation:",
                error
            );


            alert(
                "Unable to start conversation.\n\n" +
                (
                    error.message ||
                    "Unknown error."
                )
            );


            if (button) {

                button.disabled =
                    false;


                button.innerHTML =
                    originalHTML;

            }

        }

    }


    // =====================================================
    // FIND EXISTING PRIVATE CONVERSATION
    // =====================================================

    async function findExistingPrivateConversation(
        otherUserId
    ) {

        const {
            data: mine,
            error
        } =
            await supabaseClient
                .from(
                    "conversation_participants"
                )
                .select(
                    "conversation_id"
                )
                .eq(
                    "user_id",
                    messengerCurrentUser.id
                );


        if (error) {
            throw error;
        }


        const ids =
            (mine || []).map(
                item =>
                    item.conversation_id
            );


        if (!ids.length) {
            return null;
        }


        const {
            data: conversations,
            error:
                conversationError
        } =
            await supabaseClient
                .from("conversations")
                .select(`
                    id,
                    is_group,
                    name,
                    created_by,
                    created_at
                `)
                .in(
                    "id",
                    ids
                )
                .eq(
                    "is_group",
                    false
                );


        if (conversationError) {
            throw conversationError;
        }


        if (!conversations?.length) {
            return null;
        }


        const {
            data: participants,
            error:
                participantError
        } =
            await supabaseClient
                .from(
                    "conversation_participants"
                )
                .select(`
                    conversation_id,
                    user_id
                `)
                .in(
                    "conversation_id",
                    ids
                );


        if (participantError) {
            throw participantError;
        }


        return (
            conversations.find(
                conversation => {

                    const members =
                        (participants || [])
                            .filter(
                                participant =>
                                    participant.conversation_id ===
                                    conversation.id
                            );


                    return (
                        members.length === 2 &&
                        members.some(
                            member =>
                                member.user_id ===
                                otherUserId
                        )
                    );

                }
            ) || null
        );

    }

// =====================================================
// FORCE HIDE MESSENGER BACKDROP
// =====================================================

function hideMessengerBackdrop() {

    const backdrop =
        document.getElementById("msgrBackdrop");

    if (!backdrop) {
        return;
    }

    backdrop.classList.remove("show");

    backdrop.style.display = "none";
    backdrop.style.visibility = "hidden";
    backdrop.style.opacity = "0";
    backdrop.style.pointerEvents = "none";

    console.log(
        "Messenger backdrop hidden."
    );
}
    // =====================================================
    // OPEN CONVERSATION
    // =====================================================

    async function openConversation(
        conversationId
    ) {
        cleanupMessengerOverlays();

        console.log(
            "Opening conversation:",
            conversationId
        );

        hideMessengerBackdrop();

        currentConversationId =
            conversationId;


        // -------------------------------------------------
        // ENSURE COMPOSER EXISTS FIRST
        // -------------------------------------------------

        ensureMessengerUI();


        const chatPanel =
            document.getElementById(
                "msgrChat"
            );


        const messagesContainer =
            document.getElementById(
                "msgrMessages"
            );


        const messageInput =
            document.getElementById(
                "msgrInput"
            );


        const sendButton =
            document.getElementById(
                "msgrSendBtn"
            );
            const composer =
    document.getElementById(
        "msgrComposer"
    );

console.log(
    "Checking Messenger UI elements..."
);

console.log(
    "Message composer:",
    composer
);

console.log(
    "Message input:",
    messageInput
);

console.log(
    "Send button:",
    sendButton
);

if (composer) {

    composer.style.display = "flex";
    composer.style.visibility = "visible";
    composer.style.opacity = "1";
    composer.style.width = "100%";
    composer.style.boxSizing = "border-box";
    composer.style.position = "relative";
    composer.style.zIndex = "10001";

}


        const chatName =
            document.getElementById(
                "msgrChatName"
            );


        const chatSub =
            document.getElementById(
                "msgrChatSub"
            );


        // -------------------------------------------------
        // DISABLE WHILE LOADING
        // -------------------------------------------------

        if (messageInput) {

            messageInput.disabled =
                true;

        }


        if (sendButton) {

            sendButton.disabled =
                true;

        }


        // -------------------------------------------------
        // SHOW CHAT
        // -------------------------------------------------

        if (chatPanel) {

            chatPanel.classList.add(
                "mobile-chat-visible"
            );

            chatPanel.style.display = "flex";
            chatPanel.style.visibility = "visible";
            chatPanel.style.opacity = "1";
            chatPanel.style.position = "relative";
            chatPanel.style.zIndex = "1000";

        }


        // -------------------------------------------------
        // ACTIVE
        // -------------------------------------------------

        document
            .querySelectorAll(
                ".messenger-conversation"
            )
            .forEach(
                item => {

                    item.classList.toggle(
                        "active",
                        item.dataset.conversationId ===
                        conversationId
                    );

                }
            );


        if (messagesContainer) {

            messagesContainer.innerHTML = `

                <div class="chat-welcome">

                    <div class="chat-welcome-icon">

                        <i class="fa-solid fa-spinner fa-spin"></i>

                    </div>

                    <p>
                        Loading conversation...
                    </p>

                </div>

            `;

        }


        try {

            // =================================================
            // LOAD CONVERSATION
            // =================================================

            const {
                data: conversation,
                error:
                    conversationError
            } =
                await supabaseClient
                    .from("conversations")
                    .select(`
                        id,
                        is_group,
                        name,
                        created_by,
                        created_at
                    `)
                    .eq(
                        "id",
                        conversationId
                    )
                    .single();


            if (conversationError) {

                throw conversationError;

            }


            // =================================================
            // LOAD PARTICIPANTS
            // =================================================

            const {
                data: participants,
                error:
                    participantError
            } =
                await supabaseClient
                    .from(
                        "conversation_participants"
                    )
                    .select(`
                        user_id
                    `)
                    .eq(
                        "conversation_id",
                        conversationId
                    );


            if (participantError) {

                throw participantError;

            }


            // =================================================
            // VERIFY PARTICIPANT
            // =================================================

            const isParticipant =
                (participants || [])
                    .some(
                        participant =>
                            participant.user_id ===
                            messengerCurrentUser.id
                    );


            if (!isParticipant) {

                throw new Error(
                    "You are not a participant in this conversation."
                );

            }


            // =================================================
            // LOAD PROFILES
            // =================================================

            const participantIds =
                (participants || [])
                    .map(
                        participant =>
                            participant.user_id
                    );


            let profiles = [];


            if (participantIds.length) {

                const {
                    data,
                    error:
                        profileError
                } =
                    await supabaseClient
                        .from("profiles")
                        .select(`
                            id,
                            first_name,
                            last_name,
                            email,
                            role,
                            is_admin
                        `)
                        .in(
                            "id",
                            participantIds
                        );


                if (profileError) {

                    console.error(
                        "Unable to load profiles:",
                        profileError
                    );

                } else {

                    profiles =
                        data || [];

                }

            }


            // =================================================
            // DETERMINE NAME
            // =================================================

            const others =
                profiles.filter(
                    profile =>
                        profile.id !==
                        messengerCurrentUser.id
                );


            let displayName =
                "Conversation";


            let subtitle =
                "Conversation";


            if (conversation.is_group) {

                displayName =
                    conversation.name ||
                    others
                        .map(
                            profile =>
                                `${profile.first_name || ""} ${
                                    profile.last_name || ""
                                }`.trim()
                        )
                        .filter(Boolean)
                        .join(", ") ||
                    "Group Conversation";


                subtitle =
                    `${participantIds.length} participants`;

            } else {

                const other =
                    others[0];


                if (other) {

                    displayName =
                        `${other.first_name || ""} ${
                            other.last_name || ""
                        }`.trim();


                    if (!displayName) {

                        displayName =
                            other.email ||
                            "User";

                    }


                    subtitle =
                        other.role === "admin" ||
                        other.is_admin
                            ? "Administrator"
                            : "Faculty";

                }

            }


            // =================================================
            // UPDATE HEADER
            // =================================================

            if (chatName) {

                chatName.textContent =
                    displayName;

            }


            if (chatSub) {

                chatSub.textContent =
                    subtitle;

            }


            // =================================================
            // AVATAR
            // =================================================

            const avatar =
                document.getElementById(
                    "msgrChatAvatar"
                );


            if (avatar) {

                avatar.textContent =
                    conversation.is_group
                        ? "GP"
                        : getInitials(
                            others[0]?.first_name,
                            others[0]?.last_name
                        );

            }


            // =================================================
            // LOAD MESSAGES
            // =================================================

            console.log(
                "Loading messages for conversation:",
                conversationId
            );


            const {
                data: messages,
                error:
                    messagesError
            } =
                await supabaseClient
                    .from("messages")
                    .select(`
                        id,
                        conversation_id,
                        sender_id,
                        content,
                        created_at,
                        updated_at
                    `)
                    .eq(
                        "conversation_id",
                        conversationId
                    )
                    .order(
                        "created_at",
                        {
                            ascending: true
                        }
                    );


            if (messagesError) {

                throw messagesError;

            }


            console.log(
                "Messages loaded:",
                messages
            );


            // =================================================
            // RENDER
            // =================================================

            renderConversationMessages(
                messages || [],
                profiles
            );


            // =================================================
            // ENABLE COMPOSER
            // =================================================

            enableMessageComposer();

            // =====================================================
// FINAL COMPOSER VISIBILITY FIX
// =====================================================

if (composer) {

    composer.style.display = "flex";
    composer.style.visibility = "visible";
    composer.style.opacity = "1";
    composer.style.width = "100%";
    composer.style.boxSizing = "border-box";
    composer.style.position = "relative";
    composer.style.zIndex = "10001";

}

hideMessengerBackdrop();

requestAnimationFrame(() => {

    if (composer) {

        composer.scrollIntoView({
            behavior: "auto",
            block: "end"
        });

    }

});

            // =================================================
            // REALTIME
            // =================================================

            subscribeToConversationMessages(
                conversationId
            );
            cleanupMessengerOverlays();

const finalComposer =
    document.getElementById(
        "msgrComposer"
    );

if (finalComposer) {

    finalComposer.style.display = "flex";
    finalComposer.style.visibility = "visible";
    finalComposer.style.opacity = "1";
    finalComposer.style.pointerEvents = "auto";
    finalComposer.style.position = "relative";
    finalComposer.style.zIndex = "10001";

}


            console.log(
                "Conversation opened successfully:",
                conversationId
            );


            // -------------------------------------------------
            // FOCUS INPUT
            // -------------------------------------------------

            setTimeout(
                function () {

                    const input =
                        document.getElementById(
                            "msgrInput"
                        );


                    if (input) {

                        input.disabled =
                            false;


                        input.focus();

                    }

                },
                100
            );


        } catch (error) {

            console.error(
                "Unable to load conversation:",
                error
            );


            if (messagesContainer) {

                messagesContainer.innerHTML = `

                    <div class="chat-welcome">

                        <div class="chat-welcome-icon">

                            <i class="fa-solid fa-circle-exclamation"></i>

                        </div>

                        <h2>
                            Unable to open conversation
                        </h2>

                        <p>
                            ${escapeHTML(
                                error.message ||
                                "Something went wrong."
                            )}
                        </p>

                    </div>

                `;

            }

        }

    }
    // =====================================================
// MESSENGER OVERLAY CLEANUP
// =====================================================

function cleanupMessengerOverlays() {

    const selectors = [
        "#msgrBackdrop",
        ".msgr-backdrop",
        ".messenger-backdrop"
    ];

    selectors.forEach(selector => {

        document
            .querySelectorAll(selector)
            .forEach(element => {

                element.classList.remove("show");

                element.style.display = "none";
                element.style.visibility = "hidden";
                element.style.opacity = "0";
                element.style.pointerEvents = "none";

            });

    });

}


    // =====================================================
    // RENDER MESSAGES
    // =====================================================

    function renderConversationMessages(
        messages,
        profiles
    ) {

        const container =
            document.getElementById(
                "msgrMessages"
            );


        if (!container) {

            console.error(
                "Messages container not found."
            );

            return;

        }


        if (!messages.length) {

            container.innerHTML = `

                <div class="chat-welcome">

                    <div class="chat-welcome-icon">

                        <i class="fa-regular fa-comments"></i>

                    </div>

                    <h2>
                        No messages yet
                    </h2>

                    <p>
                        Send a message to start the conversation.
                    </p>

                </div>

            `;

            return;

        }


        const profileMap =
            new Map(
                (profiles || []).map(
                    profile => [
                        profile.id,
                        profile
                    ]
                )
            );


        container.innerHTML =
            messages
                .map(
                    message =>
                        createMessageHTML(
                            message,
                            profileMap
                        )
                )
                .join("");


        scrollMessagesToBottom();

    }


    // =====================================================
    // MESSAGE HTML
    // =====================================================

    function createMessageHTML(
        message,
        profileMap
    ) {

        const isMine =
            message.sender_id ===
            messengerCurrentUser.id;


        const sender =
            profileMap.get(
                message.sender_id
            );


        const senderName =
            sender
                ? `${sender.first_name || ""} ${
                    sender.last_name || ""
                  }`.trim()
                : "User";


        return `

            <div
                class="message-row ${
                    isMine
                        ? "message-row-sent"
                        : "message-row-received"
                }"
                data-message-id="${escapeHTML(
                    message.id
                )}"
            >

                ${
                    !isMine
                        ? `
                            <div class="message-avatar">

                                ${escapeHTML(
                                    getInitials(
                                        sender?.first_name,
                                        sender?.last_name
                                    )
                                )}

                            </div>
                          `
                        : ""
                }

                <div class="message-content-wrapper">

                    ${
                        !isMine
                            ? `
                                <div class="message-sender">
                                    ${escapeHTML(senderName)}
                                </div>
                              `
                            : ""
                    }

                    <div
                        class="message-bubble ${
                            isMine
                                ? "message-bubble-sent"
                                : "message-bubble-received"
                        }"
                    >

                        ${escapeHTML(
                            message.content
                        )}

                    </div>

                    <div class="message-time">

                        ${escapeHTML(
                            formatMessageTime(
                                message.created_at
                            )
                        )}

                    </div>

                </div>

            </div>

        `;

    }


    // =====================================================
    // SEND MESSAGE
    // =====================================================

    async function sendMessage() {

        if (isSendingMessage) {
            return;
        }


        if (!messengerCurrentUser) {

            alert(
                "You are not authenticated."
            );

            return;

        }


        if (!currentConversationId) {

            alert(
                "Please select a conversation first."
            );

            return;

        }


        const input =
            document.getElementById(
                "msgrInput"
            );


        const sendButton =
            document.getElementById(
                "msgrSendBtn"
            );


        if (!input) {

            console.error(
                "Message input not found."
            );

            return;

        }


        const content =
            input.value.trim();


        if (!content) {
            return;
        }


        isSendingMessage =
            true;


        const originalHTML =
            sendButton
                ? sendButton.innerHTML
                : "";


        try {

            // -------------------------------------------------
            // SESSION
            // -------------------------------------------------

            const {
                data: {
                    session
                },
                error:
                    sessionError
            } =
                await supabaseClient.auth.getSession();


            if (sessionError) {
                throw sessionError;
            }


            if (!session) {

                throw new Error(
                    "Your session has expired."
                );

            }


            // -------------------------------------------------
            // PARTICIPATION
            // -------------------------------------------------

            const {
                data: participation,
                error:
                    participationError
            } =
                await supabaseClient
                    .from(
                        "conversation_participants"
                    )
                    .select(
                        "conversation_id"
                    )
                    .eq(
                        "conversation_id",
                        currentConversationId
                    )
                    .eq(
                        "user_id",
                        messengerCurrentUser.id
                    )
                    .maybeSingle();


            if (participationError) {

                throw participationError;

            }


            if (!participation) {

                throw new Error(
                    "You are not a participant in this conversation."
                );

            }


            // -------------------------------------------------
            // BUTTON
            // -------------------------------------------------

            if (sendButton) {

                sendButton.disabled =
                    true;


                sendButton.innerHTML = `
                    <i class="fa-solid fa-spinner fa-spin"></i>
                `;

            }


            // -------------------------------------------------
            // INSERT
            // -------------------------------------------------

            const {
                data: newMessage,
                error:
                    messageError
            } =
                await supabaseClient
                    .from("messages")
                    .insert({
                        conversation_id:
                            currentConversationId,

                        sender_id:
                            messengerCurrentUser.id,

                        content:
                            content
                    })
                    .select(`
                        id,
                        conversation_id,
                        sender_id,
                        content,
                        created_at,
                        updated_at
                    `)
                    .single();


            if (messageError) {

                throw messageError;

            }


            console.log(
                "Message sent successfully:",
                newMessage
            );


            // -------------------------------------------------
            // CLEAR
            // -------------------------------------------------

            input.value = "";

            input.style.height =
                "auto";


            // -------------------------------------------------
            // DISPLAY IMMEDIATELY
            // -------------------------------------------------

            await appendMessageIfNotExists(
                newMessage
            );


        } catch (error) {

            console.error(
                "Unable to send message:",
                error
            );


            alert(
                "Unable to send message.\n\n" +
                (
                    error.message ||
                    "Unknown error."
                )
            );


        } finally {

            isSendingMessage =
                false;


            if (sendButton) {

                sendButton.disabled =
                    false;


                sendButton.innerHTML =
                    originalHTML ||
                    `<i class="fa-solid fa-paper-plane"></i>`;

            }

        }

    }


    // =====================================================
    // APPEND MESSAGE
    // =====================================================

    async function appendMessageIfNotExists(
        message
    ) {

        if (!message) {
            return;
        }


        if (
            message.conversation_id !==
            currentConversationId
        ) {

            return;

        }


        const container =
            document.getElementById(
                "msgrMessages"
            );


        if (!container) {
            return;
        }


        const existing =
            container.querySelector(
                `[data-message-id="${CSS.escape(
                    message.id
                )}"]`
            );


        if (existing) {

            scrollMessagesToBottom();

            return;

        }


        const welcome =
            container.querySelector(
                ".chat-welcome"
            );


        if (welcome) {
            welcome.remove();
        }


        let sender = null;


        if (message.sender_id) {

            const {
                data
            } =
                await supabaseClient
                    .from("profiles")
                    .select(`
                        id,
                        first_name,
                        last_name,
                        email,
                        role,
                        is_admin
                    `)
                    .eq(
                        "id",
                        message.sender_id
                    )
                    .maybeSingle();


            sender =
                data || null;

        }


        const profileMap =
            new Map();


        if (sender) {

            profileMap.set(
                sender.id,
                sender
            );

        }


        const wrapper =
            document.createElement(
                "div"
            );


        wrapper.innerHTML =
            createMessageHTML(
                message,
                profileMap
            );


        const row =
            wrapper.firstElementChild;


        if (row) {

            container.appendChild(
                row
            );

        }


        scrollMessagesToBottom();

    }


    // =====================================================
    // REALTIME GLOBAL
    // =====================================================

    function initializeMessengerRealtime() {

        if (
            !supabaseClient ||
            !messengerCurrentUser
        ) {

            return;

        }


        if (messengerRealtimeChannel) {

            supabaseClient.removeChannel(
                messengerRealtimeChannel
            );


            messengerRealtimeChannel =
                null;

        }


        console.log(
            "Initializing Messenger realtime..."
        );


        messengerRealtimeChannel =
            supabaseClient
                .channel(
                    "citeflow-messenger-global"
                )
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "conversation_participants"
                    },
                    function () {

                        loadMessengerConversations();

                    }
                )
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "conversations"
                    },
                    function () {

                        loadMessengerConversations();

                    }
                )
                .subscribe(
                    function (status) {

                        console.log(
                            "Messenger realtime status:",
                            status
                        );

                    }
                );

    }


    // =====================================================
    // REALTIME CURRENT CONVERSATION
    // =====================================================

    function subscribeToConversationMessages(
        conversationId
    ) {

        if (!conversationId) {
            return;
        }


        console.log(
            "Subscribing to realtime messages:",
            conversationId
        );


        // -------------------------------------------------
        // REMOVE OLD CHANNEL
        // -------------------------------------------------

        if (messengerMessageChannel) {

            console.log(
                "Removing previous Messenger message channel."
            );


            supabaseClient.removeChannel(
                messengerMessageChannel
            );


            messengerMessageChannel =
                null;

        }


        // -------------------------------------------------
        // CREATE CHANNEL
        // -------------------------------------------------

        messengerMessageChannel =
            supabaseClient
                .channel(
                    `citeflow-messages-${conversationId}`
                )
                .on(
                    "postgres_changes",
                    {
                        event: "INSERT",
                        schema: "public",
                        table: "messages",
                        filter:
                            `conversation_id=eq.${conversationId}`
                    },
                    async function (payload) {

                        console.log(
                            "Realtime message received:",
                            payload
                        );


                        if (
                            !payload ||
                            !payload.new
                        ) {

                            return;

                        }


                        if (
                            payload.new.conversation_id !==
                            currentConversationId
                        ) {

                            return;

                        }


                        await appendMessageIfNotExists(
                            payload.new
                        );

                    }
                )
                .subscribe(
                    function (status) {

                        console.log(
                            "Messenger message realtime status:",
                            status
                        );

                    }
                );

    }


    // =====================================================
    // CLOSE MODAL
    // =====================================================

    function closeNewMessageModal() {

        const modal =
            document.getElementById(
                "msgrNewModal"
            );


        if (modal) {

            modal.classList.remove(
                "show"
            );


            modal.style.display =
                "none";

        }


        selectedMessengerUsers =
            [];


        const search =
            document.getElementById(
                "msgrUserSearch"
            );


        if (search) {

            search.value = "";

        }


        const group =
            document.getElementById(
                "msgrGroupNameInput"
            );


        if (group) {

            group.value = "";

        }


        updateCreateButton();

    }


    // =====================================================
    // SCROLL
    // =====================================================

    function scrollMessagesToBottom() {

        const container =
            document.getElementById(
                "msgrMessages"
            );


        if (!container) {
            return;
        }


        requestAnimationFrame(
            function () {

                container.scrollTop =
                    container.scrollHeight;

            }
        );

    }


    // =====================================================
    // TIME
    // =====================================================

    function formatMessageTime(
        timestamp
    ) {

        if (!timestamp) {
            return "";
        }


        const date =
            new Date(timestamp);


        return date.toLocaleString(
            [],
            {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            }
        );

    }


    // =====================================================
    // INITIALS
    // =====================================================

    function getInitials(
        firstName,
        lastName
    ) {

        const first =
            String(firstName || "")
                .trim()
                .charAt(0)
                .toUpperCase();


        const last =
            String(lastName || "")
                .trim()
                .charAt(0)
                .toUpperCase();


        return (
            `${first}${last}` ||
            "U"
        );

    }


    // =====================================================
    // ESCAPE HTML
    // =====================================================

    function escapeHTML(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );

    }


    // =====================================================
    // ERROR
    // =====================================================

    function showMessengerError(
        message
    ) {

        const list =
            document.getElementById(
                "msgrList"
            );


        if (!list) {
            return;
        }


        list.innerHTML = `

            <div class="messenger-empty">

                <i class="fa-solid fa-circle-exclamation"></i>

                <p>
                    ${escapeHTML(message)}
                </p>

            </div>

        `;

    }


    // =====================================================
    // EXPOSE INITIALIZER
    // =====================================================

    window.initializeMessenger =
        initializeMessenger;


    // =====================================================
    // DEBUG
    // =====================================================

    window.citeFlowMessengerDebug = {

        getCurrentUser:
            function () {
                return messengerCurrentUser;
            },

        getCurrentConversation:
            function () {
                return currentConversationId;
            },

        reloadConversations:
            function () {
                return loadMessengerConversations();
            },

        openConversation:
            function (id) {
                return openConversation(id);
            },

        enableComposer:
            function () {
                return enableMessageComposer();
            },

        sendMessage:
            function () {
                return sendMessage();
            }

    };


})();