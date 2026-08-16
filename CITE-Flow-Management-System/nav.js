// =========================================================
// CITE-Flow Navigation
// UPDATED MESSENGER DRAWER VERSION
// =========================================================


// =========================================================
// BASIC HELPERS
// =========================================================

function getContent() {
    return document.getElementById("content");
}


function isSpa() {
    return Boolean(getContent());
}


function isInAdminFolder() {
    return window.location.pathname
        .toLowerCase()
        .includes("/admin/");
}


function normalizePageKey(pageFile) {

    if (!pageFile) {
        return "";
    }

    return pageFile
        .replace(/^\.\.\//, "")
        .replace(/^admin\//, "")
        .replace(/\.html$/, "");

}


function pageMap(pageName) {

    const key =
        normalizePageKey(pageName);

    return {

        dashboard:
            "dashboard.html",

        "faculty-profiles":
            "faculty-profiles.html",

        "workload-tracker":
            "workload-tracker.html",

        "engagement-logs":
            "engagement-logs.html",

        "document-vault":
            "document-vault.html",

        "workflow-approval":
            "workflow-approval.html",

        calendar:
            "calendar.html",

        "reports-analytics":
            "reports-analytics.html",

        "feedback-summary":
            "feedback-summary.html",

        "user-management":
            "user-management.html",

        "system-settings":
            "system-settings.html",

        "admin-profile":
            "admin-profile.html",

        profile:
            "admin-profile.html"

    }[key] || `${key}.html`;

}


function resolveAdminPath(pageFile) {

    const mapped =
        pageMap(pageFile);

    const file =
        mapped.endsWith(".html")
            ? mapped
            : `${mapped}.html`;

    if (isInAdminFolder()) {
        return file;
    }

    return `admin/${file}`;

}


function getCurrentPageFile() {

    const parts =
        window.location.pathname.split("/");

    const current =
        parts[parts.length - 1] ||
        "dashboard.html";

    return current.includes(".html")
        ? current
        : "dashboard.html";

}


function getPageFileFromItem(item) {

    if (!item) {
        return null;
    }


    const pageFile =
        item.getAttribute("data-page");

    if (pageFile) {
        return pageFile;
    }


    const onclick =
        item.getAttribute("onclick") || "";

    const match =
        onclick.match(
            /window\.location\.href\s*=\s*['"]([^'"]+)['"]/
        );

    if (match) {
        return match[1];
    }


    const link =
        item.querySelector("a[href]");

    if (link) {
        return link.getAttribute("href");
    }


    return null;

}


// =========================================================
// LOAD PAGE
// =========================================================

async function loadPage(pageName) {

    const content =
        getContent();

    if (!content) {
        return;
    }


    const fileName =
        resolveAdminPath(
            pageMap(pageName)
        );


    try {

        const response =
            await fetch(fileName);


        if (!response.ok) {

            throw new Error(
                `Page not found: ${fileName}`
            );

        }


        const html =
            await response.text();


        content.innerHTML =
            html;


        // -------------------------------------------------
        // Re-execute scripts inside loaded page
        // -------------------------------------------------

        const scripts =
            content.querySelectorAll("script");


        scripts.forEach(
            oldScript => {

                const newScript =
                    document.createElement("script");


                if (oldScript.src) {

                    newScript.src =
                        oldScript.src;

                } else {

                    newScript.textContent =
                        oldScript.textContent;

                }


                document.body.appendChild(
                    newScript
                );


                document.body.removeChild(
                    newScript
                );

            }
        );


    } catch (error) {

        console.error(error);


        content.innerHTML = `
            <h1 style="color:red;">
                Failed to load ${fileName}
            </h1>
        `;

    }


    updateActiveMenu(
        fileName
    );

}


// =========================================================
// MENU
// =========================================================

function normalizeMenuTarget(fileName) {

    return String(fileName || "")
        .replace(/^\.\.\//, "")
        .replace(/^admin\//, "")
        .toLowerCase();

}


function updateActiveMenu(fileName) {

    const normalized =
        normalizeMenuTarget(
            fileName ||
            getCurrentPageFile()
        );


    document
        .querySelectorAll(
            ".nav-item, .logo-area[data-page]"
        )
        .forEach(
            item => {

                const dataPage =
                    item.getAttribute(
                        "data-page"
                    );


                if (!dataPage) {
                    return;
                }


                const target =
                    normalizeMenuTarget(
                        dataPage
                    );


                item.classList.toggle(
                    "active",
                    target === normalized
                );

            }
        );

}


// =========================================================
// NAVIGATION
// =========================================================

function navigateTo(pageFile) {

    const pageKey =
        normalizePageKey(
            pageFile
        );


    if (isSpa()) {

        loadPage(
            pageKey
        );

        return;

    }


    changePage(
        pageKey
    );

}


function changePage(pageName) {

    window.location.href =
        resolveAdminPath(
            pageMap(pageName)
        );

}


// =========================================================
// MESSENGER
// =========================================================

let messengerScriptLoading = false;
let messengerScriptLoaded = false;


// =========================================================
// LOAD MESSENGER SCRIPT ONLY ONCE
// =========================================================

function loadMessengerScript() {

    return new Promise(
        (resolve, reject) => {

            if (
                messengerScriptLoaded ||
                typeof window.initializeMessenger ===
                "function"
            ) {

                messengerScriptLoaded =
                    true;

                resolve();

                return;

            }


            if (messengerScriptLoading) {

                const checkInterval =
                    setInterval(
                        () => {

                            if (
                                typeof window.initializeMessenger ===
                                "function"
                            ) {

                                clearInterval(
                                    checkInterval
                                );


                                messengerScriptLoaded =
                                    true;

                                messengerScriptLoading =
                                    false;


                                resolve();

                            }

                        },
                        50
                    );

                return;

            }


            messengerScriptLoading =
                true;


            console.log(
                "Loading messenger.js..."
            );


            const script =
                document.createElement(
                    "script"
                );


            script.src =
                "../shared/messenger.js";


            script.onload =
                () => {

                    console.log(
                        "messenger.js loaded successfully."
                    );


                    messengerScriptLoaded =
                        true;

                    messengerScriptLoading =
                        false;


                    resolve();

                };


            script.onerror =
                error => {

                    console.error(
                        "Failed to load messenger.js:",
                        error
                    );


                    messengerScriptLoading =
                        false;


                    reject(
                        new Error(
                            "Unable to load Messenger."
                        )
                    );

                };


            document.body.appendChild(
                script
            );

        }
    );

}


// =========================================================
// FORCE MESSENGER DRAWER STRUCTURE
// =========================================================

function prepareMessengerDrawer() {

    const panel =
        document.getElementById(
            "msgrPanel"
        );


    if (!panel) {

        console.error(
            "prepareMessengerDrawer(): #msgrPanel not found."
        );

        return null;

    }


    // -----------------------------------------------------
    // PANEL
    // -----------------------------------------------------

    panel.style.position =
        "fixed";

    panel.style.top =
        "0";

    panel.style.right =
        "0";

    panel.style.bottom =
        "0";

    panel.style.width =
        "min(420px, 100vw)";

    panel.style.height =
        "100vh";

    panel.style.zIndex =
        "10001";

    panel.style.background =
        "#ffffff";

    panel.style.display =
        "flex";

    panel.style.flexDirection =
        "column";

    panel.style.overflow =
        "hidden";

    panel.style.boxSizing =
        "border-box";


    // -----------------------------------------------------
    // CONVERSATION LIST
    // -----------------------------------------------------

    const list =
        document.getElementById(
            "msgrList"
        );


    if (list) {

        list.style.overflowY =
            "auto";

        list.style.flex =
            "1 1 auto";

        list.style.minHeight =
            "0";

    }


    // -----------------------------------------------------
    // CHAT
    // -----------------------------------------------------

    let chat =
        document.getElementById(
            "msgrChat"
        );


    // If the chat exists somewhere else in the DOM,
    // move it INSIDE the Messenger drawer.

    if (
        chat &&
        chat.parentElement !== panel
    ) {

        panel.appendChild(
            chat
        );

        console.log(
            "Moved #msgrChat inside #msgrPanel."
        );

    }


    // -----------------------------------------------------
    // CHAT PANEL
    // -----------------------------------------------------

    if (chat) {

        chat.style.position =
            "absolute";

        chat.style.top =
            "0";

        chat.style.left =
            "0";

        chat.style.right =
            "0";

        chat.style.bottom =
            "0";

        chat.style.width =
            "100%";

        chat.style.height =
            "100%";

        chat.style.background =
            "#ffffff";

        chat.style.zIndex =
            "10002";

        chat.style.display =
            "none";

        chat.style.flexDirection =
            "column";

        chat.style.boxSizing =
            "border-box";

        chat.style.overflow =
            "hidden";

    }


    // -----------------------------------------------------
    // CHAT HEADER
    // -----------------------------------------------------

    const chatHeader =
        chat
            ? chat.querySelector(
                ".chat-header"
            )
            : null;


    if (chatHeader) {

        chatHeader.style.flex =
            "0 0 auto";

        chatHeader.style.zIndex =
            "2";

    }


    // -----------------------------------------------------
    // MESSAGES CONTAINER
    // -----------------------------------------------------

    const messages =
        document.getElementById(
            "msgrMessages"
        );


    if (messages) {

        messages.style.flex =
            "1 1 auto";

        messages.style.minHeight =
            "0";

        messages.style.overflowY =
            "auto";

        messages.style.overflowX =
            "hidden";

        messages.style.boxSizing =
            "border-box";

    }


    // -----------------------------------------------------
    // MESSAGE COMPOSER
    // -----------------------------------------------------

    const composer =
        document.getElementById(
            "msgrComposer"
        );


    if (composer) {

        composer.style.display =
            "flex";

        composer.style.visibility =
            "visible";

        composer.style.opacity =
            "1";

        composer.style.pointerEvents =
            "auto";

        composer.style.position =
            "relative";

        composer.style.zIndex =
            "10003";

        composer.style.width =
            "100%";

        composer.style.flex =
            "0 0 auto";

        composer.style.boxSizing =
            "border-box";

        composer.style.background =
            "#ffffff";

    }


    // -----------------------------------------------------
    // MESSAGE INPUT
    // -----------------------------------------------------

    const input =
        document.getElementById(
            "msgrInput"
        );


    if (input) {

        input.style.pointerEvents =
            "auto";

        input.style.position =
            "relative";

        input.style.zIndex =
            "10004";

    }


    // -----------------------------------------------------
    // SEND BUTTON
    // -----------------------------------------------------

    const sendButton =
        document.getElementById(
            "msgrSendBtn"
        );


    if (sendButton) {

        sendButton.style.pointerEvents =
            "auto";

        sendButton.style.position =
            "relative";

        sendButton.style.zIndex =
            "10004";

    }


    console.log(
        "Messenger drawer prepared."
    );


    return panel;

}


// =========================================================
// HIDE MESSENGER BACKDROP
// =========================================================

function hideMessengerBackdrop() {

    const backdrop =
        document.getElementById(
            "msgrBackdrop"
        );


    if (!backdrop) {
        return;
    }


    backdrop.classList.remove(
        "show"
    );


    backdrop.style.display =
        "none";

    backdrop.style.visibility =
        "hidden";

    backdrop.style.opacity =
        "0";

    backdrop.style.pointerEvents =
        "none";


    console.log(
        "Messenger backdrop hidden."
    );

}


// =========================================================
// SHOW MESSENGER BACKDROP
// =========================================================

function showMessengerBackdrop() {

    const backdrop =
        document.getElementById(
            "msgrBackdrop"
        );


    if (!backdrop) {
        return;
    }


    backdrop.classList.add(
        "show"
    );


    backdrop.style.display =
        "block";

    backdrop.style.visibility =
        "visible";

    backdrop.style.opacity =
        "1";

    backdrop.style.pointerEvents =
        "auto";


    // IMPORTANT:
    // Backdrop MUST stay underneath the panel.

    backdrop.style.zIndex =
        "10000";

}


// =========================================================
// OPEN MESSAGES
// =========================================================

async function openMessages() {

    console.log(
        "Opening Messages..."
    );


    const panel =
        document.getElementById(
            "msgrPanel"
        );


    if (!panel) {

        console.error(
            "Messenger panel #msgrPanel was not found."
        );

        return;

    }


    // -----------------------------------------------------
    // PREPARE DRAWER
    // -----------------------------------------------------

    prepareMessengerDrawer();


    // -----------------------------------------------------
    // SHOW PANEL
    // -----------------------------------------------------

    panel.classList.add(
        "show"
    );


    panel.style.display =
        "flex";

    panel.style.visibility =
        "visible";

    panel.style.opacity =
        "1";

    panel.style.zIndex =
        "10001";


    // -----------------------------------------------------
    // SHOW BACKDROP BEHIND PANEL
    // -----------------------------------------------------

    showMessengerBackdrop();


    // -----------------------------------------------------
    // LOAD MESSENGER JS
    // -----------------------------------------------------

    try {

        await loadMessengerScript();


        // -------------------------------------------------
        // INITIALIZE MESSENGER
        // -------------------------------------------------

        if (
            typeof window.initializeMessenger ===
            "function"
        ) {

            console.log(
                "Initializing Messenger..."
            );


            await window.initializeMessenger();


            // -------------------------------------------------
            // PREPARE AGAIN AFTER INITIALIZATION
            // Messenger.js may create/re-render elements.
            // -------------------------------------------------

            prepareMessengerDrawer();

        } else {

            console.error(
                "initializeMessenger() was not found."
            );

        }


    } catch (error) {

        console.error(
            "Messenger loading error:",
            error
        );

    }

}


// =========================================================
// CLOSE MESSAGES
// =========================================================

function closeMessages() {

    console.log(
        "Closing Messages..."
    );


    const panel =
        document.getElementById(
            "msgrPanel"
        );


    const backdrop =
        document.getElementById(
            "msgrBackdrop"
        );


    const newModal =
        document.getElementById(
            "msgrNewModal"
        );


    const chat =
        document.getElementById(
            "msgrChat"
        );


    // -----------------------------------------------------
    // CLOSE PANEL
    // -----------------------------------------------------

    if (panel) {

        panel.classList.remove(
            "show"
        );

        panel.style.display =
            "none";

        panel.style.visibility =
            "hidden";

        panel.style.opacity =
            "0";

    }


    // -----------------------------------------------------
    // CLOSE BACKDROP
    // -----------------------------------------------------

    if (backdrop) {

        backdrop.classList.remove(
            "show"
        );

        backdrop.style.display =
            "none";

        backdrop.style.visibility =
            "hidden";

        backdrop.style.opacity =
            "0";

        backdrop.style.pointerEvents =
            "none";

    }


    // -----------------------------------------------------
    // CLOSE NEW MESSAGE MODAL
    // -----------------------------------------------------

    if (newModal) {

        newModal.classList.remove(
            "show"
        );

    }


    // -----------------------------------------------------
    // HIDE CHAT
    // -----------------------------------------------------

    if (chat) {

        chat.style.display =
            "none";

        chat.classList.remove(
            "show"
        );

    }

}


// =========================================================
// NAV EVENTS
// =========================================================

function attachNavEvents() {

    document.addEventListener(
        "click",
        e => {

            const item =
                e.target.closest(
                    ".nav-item, .logo-area[data-page], .profile-link[data-page]"
                );


            if (!item) {
                return;
            }


            const pageFile =
                getPageFileFromItem(
                    item
                );


            if (!pageFile) {
                return;
            }


            e.preventDefault();


            navigateTo(
                pageFile
            );

        }
    );


    const searchInput =
        document.querySelector(
            "#navbar-container #searchInput"
        );


    if (
        searchInput &&
        !searchInput.dataset.bound
    ) {

        searchInput.dataset.bound =
            "true";


        searchInput.addEventListener(
            "keypress",
            function (e) {

                if (
                    e.key === "Enter"
                ) {

                    alert(
                        "Searching for: " +
                        this.value
                    );

                }

            }
        );

    }

}


// =========================================================
// PROFILE MODAL
// =========================================================

function toggleProfileModal() {

    const modal =
        document.getElementById(
            "profileModal"
        );


    const backdrop =
        document.getElementById(
            "profileBackdrop"
        );


    if (
        !modal ||
        !backdrop
    ) {

        return;

    }


    modal.classList.toggle(
        "show"
    );


    backdrop.classList.toggle(
        "show"
    );

}


// =========================================================
// MOUNT NAVIGATION PARTS
// =========================================================

function mountNavPart(
    sourceNode,
    containerId,
    appendToBody
) {

    if (!sourceNode) {
        return;
    }


    const container =
        containerId
            ? document.getElementById(
                containerId
            )
            : null;


    if (container) {

        container.innerHTML =
            "";

        container.appendChild(
            sourceNode
        );

        return;

    }


    if (
        appendToBody &&
        !document.getElementById(
            sourceNode.id
        )
    ) {

        document.body.appendChild(
            sourceNode
        );

    }

}


// =========================================================
// LOAD ADMIN NAVIGATION
// =========================================================

async function loadAdminNavigation() {

    try {

        const response =
            await fetch(
                "../nav.html"
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const html =
            await response.text();


        const doc =
            new DOMParser()
                .parseFromString(
                    html,
                    "text/html"
                );


        // -------------------------------------------------
        // FONT AWESOME
        // -------------------------------------------------

        if (
            !document.querySelector(
                'link[data-citeflow="fontawesome"]'
            ) &&
            !document.querySelector(
                'link[href*="font-awesome"]'
            ) &&
            !document.querySelector(
                'link[href*="fontawesome"]'
            )
        ) {

            const fa =
                document.createElement(
                    "link"
                );


            fa.rel =
                "stylesheet";


            fa.href =
                "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";


            fa.setAttribute(
                "data-citeflow",
                "fontawesome"
            );


            document.head.appendChild(
                fa
            );

        }


        // -------------------------------------------------
        // NAVIGATION CSS
        // -------------------------------------------------

        if (
            !document.querySelector(
                'link[data-citeflow="navcss"]'
            ) &&
            !document.querySelector(
                'link[href*="nav.css"]'
            )
        ) {

            const navCss =
                document.createElement(
                    "link"
                );


            navCss.rel =
                "stylesheet";


            navCss.href =
                isInAdminFolder()
                    ? "../nav.css"
                    : "nav.css";


            navCss.setAttribute(
                "data-citeflow",
                "navcss"
            );


            document.head.appendChild(
                navCss
            );

        }


        // -------------------------------------------------
        // SIDEBAR
        // -------------------------------------------------

        mountNavPart(
            doc.querySelector(
                "aside.sidebar"
            ),
            "sidebar-container"
        );


        // -------------------------------------------------
        // NAVBAR
        // -------------------------------------------------

        mountNavPart(
            doc.querySelector(
                "nav.navbar"
            ),
            "navbar-container"
        );


        // -------------------------------------------------
        // PROFILE
        // -------------------------------------------------

        mountNavPart(
            doc.getElementById(
                "profileBackdrop"
            ),
            null,
            true
        );


        mountNavPart(
            doc.getElementById(
                "profileModal"
            ),
            null,
            true
        );


        // -------------------------------------------------
        // MESSENGER BUTTON
        // -------------------------------------------------

        mountNavPart(
            doc.querySelector(
                ".message-btn"
            ),
            "message-container",
            true
        );


        // -------------------------------------------------
        // MESSENGER BACKDROP
        // -------------------------------------------------

        mountNavPart(
            doc.getElementById(
                "msgrBackdrop"
            ),
            null,
            true
        );


        // -------------------------------------------------
        // MESSENGER PANEL
        // -------------------------------------------------

        mountNavPart(
            doc.getElementById(
                "msgrPanel"
            ),
            null,
            true
        );


        // -------------------------------------------------
        // NEW MESSAGE MODAL
        // -------------------------------------------------

        mountNavPart(
            doc.getElementById(
                "msgrNewModal"
            ),
            null,
            true
        );


        // -------------------------------------------------
        // ATTACH NAV EVENTS
        // -------------------------------------------------

        attachNavEvents();


        updateActiveMenu(
            getCurrentPageFile()
        );


        // -------------------------------------------------
        // MESSENGER CLOSE BUTTON
        // -------------------------------------------------

        const closeButton =
            document.getElementById(
                "msgrCloseBtn"
            );


        if (closeButton) {

            closeButton.onclick =
                closeMessages;

        }


        // -------------------------------------------------
        // MESSENGER BACKDROP
        // -------------------------------------------------

        const messengerBackdrop =
            document.getElementById(
                "msgrBackdrop"
            );


        if (messengerBackdrop) {

            messengerBackdrop.onclick =
                closeMessages;

        }


        // -------------------------------------------------
        // MESSENGER BACK BUTTON
        // -------------------------------------------------

        const backButton =
            document.getElementById(
                "msgrBackBtn"
            );


        if (backButton) {

            backButton.onclick =
                () => {

                    const chat =
                        document.getElementById(
                            "msgrChat"
                        );


                    if (chat) {

                        chat.style.display =
                            "none";

                        chat.classList.remove(
                            "show"
                        );

                    }

                };

        }


        // -------------------------------------------------
        // MESSENGER PANEL INITIAL PREPARATION
        // -------------------------------------------------

        const messengerPanel =
            document.getElementById(
                "msgrPanel"
            );


        if (messengerPanel) {

            messengerPanel.style.zIndex =
                "10001";

        }


        console.log(
            "Admin navigation loaded successfully."
        );


    } catch (error) {

        console.error(
            "Failed to load navigation:",
            error
        );

    }

}


// =========================================================
// SIDEBAR
// =========================================================

async function loadSidebar() {

    return loadAdminNavigation();

}


// =========================================================
// PROFILE OUTSIDE CLICK
// =========================================================

document.addEventListener(
    "click",
    e => {

        const modal =
            document.getElementById(
                "profileModal"
            );


        const backdrop =
            document.getElementById(
                "profileBackdrop"
            );


        if (
            !modal ||
            !backdrop
        ) {

            return;

        }


        const profileBtn =
            e.target.closest(
                "[onclick='toggleProfileModal()']"
            );


        if (
            modal.classList.contains(
                "show"
            ) &&
            !modal.contains(
                e.target
            ) &&
            !profileBtn
        ) {

            modal.classList.remove(
                "show"
            );


            backdrop.classList.remove(
                "show"
            );

        }

    }
);


// =========================================================
// THEME
// =========================================================

function loadTheme() {

    const savedTheme =
        localStorage.getItem(
            "citeTheme"
        );


    if (savedTheme) {

        document.documentElement.style.setProperty(
            "--cite-theme",
            savedTheme
        );

    }

}


// =========================================================
// PAGE LOAD
// =========================================================

window.addEventListener(
    "load",
    () => {

        loadTheme();


        attachNavEvents();


        updateActiveMenu(
            getCurrentPageFile()
        );

    }
);