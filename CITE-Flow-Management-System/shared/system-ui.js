/* Global CITE-Flow UI utilities: notifications + auto-contrast theme */
(function initCiteFlowUI() {
    const LEGACY_THEME_KEY = 'citeflow_theme_color';
    const THEME_KEY_PREFIX = 'citeflow_theme_color_v2';
    const NOTIF_KEY = 'citeflow_notifications';
    const LEGACY_FEEDBACK_KEY = 'feedbackNotifications';
    const ROLE = getRoleFromPath();
    const PAGE_PATH = window.location.pathname.toLowerCase();

    const THEMES = ['#740A03', '#BB1919', '#250505', '#000000', '#E2E2B6'];
    const DEFAULT_THEME = '#621708';

    function getRoleFromPath() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('/admin/')) return 'admin';
        if (path.includes('/faculty/')) return 'faculty';
        return 'all';
    }

    function getCurrentUserIdentity() {
        try {
            const raw = localStorage.getItem('citeflow_user');
            const user = raw ? JSON.parse(raw) : null;
            const id = user?.id || user?.userId || user?.email || user?.name || 'anonymous';
            return String(id).toLowerCase().replace(/\s+/g, '_');
        } catch (_) {
            return 'anonymous';
        }
    }

    function getThemeStorageKey() {
        const identity = getCurrentUserIdentity();
        return `${THEME_KEY_PREFIX}:${ROLE}:${identity}`;
    }

    function getStoredTheme() {
        const scopedKey = getThemeStorageKey();
        const scopedTheme = localStorage.getItem(scopedKey);
        if (scopedTheme) return scopedTheme;

        const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
        if (legacyTheme) {
            localStorage.setItem(scopedKey, legacyTheme);
            return legacyTheme;
        }
        return DEFAULT_THEME;
    }

    function saveTheme(theme) {
        localStorage.setItem(getThemeStorageKey(), theme);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function hexToRgb(hex) {
        const clean = hex.replace('#', '');
        const normalized = clean.length === 3
            ? clean.split('').map((c) => c + c).join('')
            : clean;
        const intVal = parseInt(normalized, 16);
        return {
            r: (intVal >> 16) & 255,
            g: (intVal >> 8) & 255,
            b: intVal & 255
        };
    }

    function rgbToHex(r, g, b) {
        const c = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
        return `#${c(r)}${c(g)}${c(b)}`;
    }

    function luminance(hex) {
        const { r, g, b } = hexToRgb(hex);
        const values = [r, g, b].map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
    }

    function mix(hexA, hexB, ratio) {
        const a = hexToRgb(hexA);
        const b = hexToRgb(hexB);
        const w = clamp(ratio, 0, 1);
        return rgbToHex(
            a.r + (b.r - a.r) * w,
            a.g + (b.g - a.g) * w,
            a.b + (b.b - a.b) * w
        );
    }

    /* Auto-Contrast Engine: Calculates text, border, hover, and panel palettes */
    function adjustTheme(color) {
        const theme = color || DEFAULT_THEME;
        const lum = luminance(theme);
        const isLight = lum > 0.52; // Threshold for bright/white backgrounds

        const text = isLight ? '#0f172a' : '#FFFFFF';
        const textMuted = isLight ? '#475569' : 'rgba(255, 255, 255, 0.75)';
        const border = isLight ? '#d1d5db' : 'rgba(255, 255, 255, 0.12)';
        const hover = isLight ? mix(theme, '#000000', 0.12) : mix(theme, '#FFFFFF', 0.16);
        const activeNav = isLight ? mix(theme, '#000000', 0.18) : mix(theme, '#000000', 0.25);
        const panel = isLight ? mix(theme, '#FFFFFF', 0.78) : mix(theme, '#FFFFFF', 0.16);
        const panelText = luminance(panel) > 0.55 ? '#0f172a' : '#FFFFFF';

        return { theme, text, textMuted, border, hover, activeNav, panel, panelText, isLight };
    }

    function applyTheme() {
        const selected = getStoredTheme();
        const palette = adjustTheme(selected);
        const root = document.documentElement;

        root.style.setProperty('--cite-theme', palette.theme);
        root.style.setProperty('--cite-theme-text', palette.text);
        root.style.setProperty('--cite-theme-text-muted', palette.textMuted);
        root.style.setProperty('--cite-theme-border', palette.border);
        root.style.setProperty('--cite-theme-hover', palette.hover);
        root.style.setProperty('--cite-theme-active', palette.activeNav);
        root.style.setProperty('--cite-theme-soft', palette.panel);
        root.style.setProperty('--cite-theme-soft-text', palette.panelText);
        root.style.setProperty('--cite-brand', palette.theme);
        root.style.setProperty('--cite-brand-2', palette.hover);

        const css = `
            .sidebar { 
                background-color: var(--cite-theme) !important; 
                color: var(--cite-theme-text) !important; 
                border-right: 1px solid var(--cite-theme-border) !important;
            }
            .sidebar .logo-area h2 {
                color: var(--cite-theme-text) !important;
            }
            .sidebar .section-title {
                color: var(--cite-theme-text-muted) !important;
            }
            .sidebar .nav-item {
                color: var(--cite-theme-text) !important;
            }
            .sidebar .nav-item:hover { 
                background-color: var(--cite-theme-hover) !important; 
            }
            .sidebar .nav-item.active { 
                background-color: var(--cite-theme-active) !important; 
                color: var(--cite-theme-text) !important;
            }
            .navbar {
                background-color: var(--cite-theme) !important;
                border-bottom: 1px solid var(--cite-theme-border) !important;
            }
            .navbar .nav-btn, .navbar .drawer-push-btn {
                color: var(--cite-theme-text) !important;
                background-color: ${palette.isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.15)'} !important;
                border: 1px solid var(--cite-theme-border) !important;
            }
            .navbar .nav-btn:hover, .navbar .drawer-push-btn:hover {
                background-color: ${palette.isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.25)'} !important;
            }
            button[class*="bg-[#621708]"], .bg-\\[\\#621708\\], [data-theme-primary="true"] {
                background-color: var(--cite-theme) !important;
                color: var(--cite-theme-text) !important;
                border: 1px solid var(--cite-theme-border) !important;
            }
            button[class*="hover:bg-[#4a1206]"]:hover, button[class*="hover:bg-[#8c2a10]"]:hover {
                background-color: var(--cite-theme-hover) !important;
            }
            .theme-soft { 
                background-color: var(--cite-theme-soft) !important; 
                color: var(--cite-theme-soft-text) !important; 
            }
            .profile-header {
                background-color: var(--cite-theme) !important;
                color: var(--cite-theme-text) !important;
            }
            .profile-header h2, .profile-header p {
                color: var(--cite-theme-text) !important;
            }
            .logout-btn {
                background-color: var(--cite-theme) !important;
                color: var(--cite-theme-text) !important;
                border: 1px solid var(--cite-theme-border) !important;
            }
            [class*="text-[#621708]"] { color: var(--cite-theme) !important; }
            [class*="border-[#621708]"] { border-color: var(--cite-theme) !important; }
            [class*="bg-[#621708]"] { background-color: var(--cite-theme) !important; }
            .tab-btn.active {
                color: var(--cite-theme) !important;
                border-bottom-color: var(--cite-theme) !important;
            }
            .day-num.today, .mini-day.active {
                background-color: var(--cite-theme) !important;
                color: var(--cite-theme-text) !important;
            }
            .cite-kicker { color: var(--cite-theme) !important; }
        `;

        let styleEl = document.getElementById('citeflow-theme-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'citeflow-theme-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    }

    function getNotifications() {
        return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]');
    }

    function setNotifications(list) {
        localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
    }

    function normalizeNotification(item) {
        return {
            id: item.id || `notif-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: item.title || 'System Notification',
            message: item.message || '',
            timestamp: item.timestamp || new Date().toISOString(),
            link: item.link || '',
            audience: item.audience || 'all',
            read: !!item.read
        };
    }

    function migrateLegacyFeedbackNotifications() {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_FEEDBACK_KEY) || '[]');
        if (!legacy.length) return;

        const existing = getNotifications();
        const ids = new Set(existing.map((n) => n.id));
        const migrated = [...existing];

        legacy.forEach((item) => {
            const id = item.id || `legacy-feedback-${item.timestamp || Date.now()}`;
            if (ids.has(id)) return;
            migrated.unshift(normalizeNotification({
                id,
                title: 'New Seminar Feedback',
                message: `${item.facultyName || 'Faculty'} submitted feedback for ${item.seminar || 'a seminar'}.`,
                timestamp: item.timestamp,
                link: '/admin/feedback-summary.html',
                audience: 'admin',
                read: !!item.read
            }));
        });

        setNotifications(migrated);
    }

    function getVisibleNotifications() {
        const all = getNotifications().filter((n) => n.audience === 'all' || n.audience === ROLE);
        if (ROLE === 'admin' && window.CiteFlowSettings?.filterNotifications) {
            return window.CiteFlowSettings.filterNotifications(all, 'admin');
        }
        return all;
    }

    function unreadCount() {
        return getVisibleNotifications().filter((n) => !n.read).length;
    }

    function markAsRead(id) {
        const list = getNotifications().map((n) => (n.id === id ? { ...n, read: true } : n));
        setNotifications(list);
    }

    function markAllReadForRole() {
        const list = getNotifications().map((n) => {
            const forRole = n.audience === 'all' || n.audience === ROLE;
            if (!forRole) return n;
            return { ...n, read: true };
        });
        setNotifications(list);
    }

    function resolveLink(rawLink) {
        if (!rawLink) return '';
        if (rawLink.startsWith('http')) return rawLink;
        const link = rawLink.replace(/\\/g, '/');
        if (link.startsWith('/admin/') || link.startsWith('/faculty/')) {
            const filename = link.split('/').pop();
            return filename ? filename : '';
        }
        if (link.startsWith('/')) return link.split('/').pop() || '';
        if (link.includes('/')) return link.split('/').pop() || link;
        return link;
    }

    function addNotification(payload) {
        const list = getNotifications();
        list.unshift(normalizeNotification(payload));
        setNotifications(list);
    }

    /* ── Global CITE-Flow Modal / Dialog System ──────────────────────── */
    let dialogResolve = null;

    function detectDialogType(title, message) {
        const text = `${title} ${message}`.toLowerCase();
        if (/success|saved|updated|created|submitted|approved|completed|registered|verified|restored/i.test(text)) return 'success';
        if (/error|failed|unable|cannot|rejected|exceed|not found|denied/i.test(text)) return 'error';
        if (/invalid|warning|warn|due|past|attention|notice|required|caution|overlap/i.test(text)) return 'warning';
        return 'info';
    }

    function ensureDialogDOM() {
        let root = document.getElementById('citeflow-dialog-root');
        if (root) return root;

        root = document.createElement('div');
        root.id = 'citeflow-dialog-root';
        root.innerHTML = `
            <div id="citeflow-dialog-backdrop" class="hidden fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-200">
                <div id="citeflow-dialog-card" class="bg-white rounded-[2rem] w-full max-w-md shadow-2xl border border-slate-100 p-6 sm:p-7 text-center transform transition-all duration-200 scale-95 opacity-0">
                    <div id="citeflow-dialog-icon-container" class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 transition-colors"></div>
                    <h3 id="citeflow-dialog-title" class="text-lg font-bold text-slate-900 leading-snug"></h3>
                    <div id="citeflow-dialog-message" class="text-sm text-slate-600 mt-2.5 leading-relaxed whitespace-pre-line text-left sm:text-center"></div>
                    <div class="mt-6 flex items-center justify-center gap-3">
                        <button id="citeflow-dialog-cancel-btn" type="button" class="hidden px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">Cancel</button>
                        <button id="citeflow-dialog-confirm-btn" type="button" class="w-full py-2.5 px-6 rounded-xl font-semibold text-sm text-white bg-[#621708] hover:bg-[#8c2a10] transition-colors shadow-sm cursor-pointer">OK</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        const backdrop = document.getElementById('citeflow-dialog-backdrop');
        const card = document.getElementById('citeflow-dialog-card');
        const confirmBtn = document.getElementById('citeflow-dialog-confirm-btn');
        const cancelBtn = document.getElementById('citeflow-dialog-cancel-btn');

        function closeDialog(result) {
            card.classList.remove('scale-100', 'opacity-100');
            card.classList.add('scale-95', 'opacity-0');
            backdrop.classList.add('hidden');
            backdrop.classList.remove('flex');
            backdrop.style.display = 'none';
            if (dialogResolve) {
                const cb = dialogResolve;
                dialogResolve = null;
                cb(result);
            }
        }

        confirmBtn.addEventListener('click', () => closeDialog(true));
        cancelBtn.addEventListener('click', () => closeDialog(false));
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeDialog(false);
        });

        document.addEventListener('keydown', (e) => {
            if (backdrop.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeDialog(false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                closeDialog(true);
            }
        });

        return root;
    }

    function showDialog(options = {}) {
        let title = options.title;
        let message = '';
        let type = options.type;
        let confirmText = options.confirmText || 'OK';
        let cancelText = options.cancelText || null;

        if (typeof options === 'string') {
            message = options;
        } else if (options && typeof options === 'object') {
            message = options.message || '';
        }

        if (!type) {
            type = detectDialogType(title || '', message);
        }
        if (!title) {
            const defaults = {
                success: 'Success',
                error: 'Error',
                warning: 'Notice',
                info: 'Information'
            };
            title = defaults[type] || 'Notice';
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => showDialog(options));
            return Promise.resolve(true);
        }

        ensureDialogDOM();

        const backdrop = document.getElementById('citeflow-dialog-backdrop');
        const card = document.getElementById('citeflow-dialog-card');
        const iconContainer = document.getElementById('citeflow-dialog-icon-container');
        const titleEl = document.getElementById('citeflow-dialog-title');
        const messageEl = document.getElementById('citeflow-dialog-message');
        const confirmBtn = document.getElementById('citeflow-dialog-confirm-btn');
        const cancelBtn = document.getElementById('citeflow-dialog-cancel-btn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;

        if (cancelText) {
            cancelBtn.textContent = cancelText;
            cancelBtn.classList.remove('hidden');
            confirmBtn.classList.remove('w-full');
            confirmBtn.classList.add('flex-1');
            cancelBtn.classList.add('flex-1');
        } else {
            cancelBtn.classList.add('hidden');
            confirmBtn.classList.add('w-full');
            confirmBtn.classList.remove('flex-1');
            cancelBtn.classList.remove('flex-1');
        }

        const icons = {
            success: {
                bg: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
                svg: `<svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
            },
            error: {
                bg: 'bg-red-50 text-red-600 border border-red-200',
                svg: `<svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`
            },
            warning: {
                bg: 'bg-amber-50 text-amber-600 border border-amber-200',
                svg: `<svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`
            },
            info: {
                bg: 'bg-rose-50 text-[#621708] border border-rose-200',
                svg: `<svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
            }
        };

        const config = icons[type] || icons.info;
        iconContainer.className = `w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 transition-colors ${config.bg}`;
        iconContainer.innerHTML = config.svg;

        backdrop.style.display = '';
        backdrop.classList.remove('hidden');
        backdrop.classList.add('flex');
        requestAnimationFrame(() => {
            card.classList.remove('scale-95', 'opacity-0');
            card.classList.add('scale-100', 'opacity-100');
            confirmBtn.focus();
        });

        return new Promise(resolve => {
            dialogResolve = resolve;
        });
    }

    window.CiteFlowUI = {
        setTheme: function (hexColor) {
            saveTheme(hexColor);
            applyTheme();
        },
        getTheme: function () {
            return getStoredTheme();
        },
        getAllowedThemes: function () {
            return [...THEMES];
        },
        addNotification: addNotification,
        refreshNotifications: function () {
            migrateLegacyFeedbackNotifications();
        },
        routeFor: function (relativePath) {
            const clean = String(relativePath || '').replace(/^\/+/, '');
            return clean.split('/').pop() || clean;
        },
        dialog: showDialog,
        alert: function (message, type, title) {
            return showDialog({ message, type, title });
        },
        confirm: function (message, title) {
            return showDialog({ message, title: title || 'Confirmation', cancelText: 'Cancel', confirmText: 'Confirm' });
        },
        confirmClear: function (options = {}) {
            if (typeof window.showClearConfirmModal === 'function') {
                return window.showClearConfirmModal(options);
            }
            return showDialog({
                message: typeof options === 'string' ? options : (options.message || 'Are you sure you want to clear all fields? This will reset your entries and clear the saved draft.'),
                title: (options && options.title) || 'Clear Form Fields?',
                type: 'warning',
                cancelText: 'Cancel',
                confirmText: (options && options.confirmText) || 'Clear All'
            });
        }
    };

    window.showNoticeModal = showDialog;
    window.showSuccessModal = (msg, title) => showDialog({ message: msg, title: title || 'Success', type: 'success' });
    window.showErrorModal = (msg, title) => showDialog({ message: msg, title: title || 'Error', type: 'error' });
    window.showWarningModal = (msg, title) => showDialog({ message: msg, title: title || 'Notice', type: 'warning' });

    // Polyfill window.alert to render our custom modal dialog consistently across all pages!
    if (typeof window !== 'undefined') {
        window.alert = function (msg) {
            return showDialog(msg);
        };
    }

    // Global Flatpickr Integration for ALL date inputs across CiteFlow
    (function initCiteFlowDatePickers() {
        if (!document.querySelector('link[href*="flatpickr"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
            document.head.appendChild(link);
        }

        const style = document.createElement('style');
        style.textContent = `
            .flatpickr-calendar {
                font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
                border-radius: 20px !important;
                box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.08) !important;
                border: none !important;
                padding: 10px !important;
                z-index: 999999 !important;
            }
            .flatpickr-day.selected, .flatpickr-day.startRange, .flatpickr-day.endRange,
            .flatpickr-day.selected:hover, .flatpickr-day.selected:focus {
                background: #621708 !important;
                border-color: #621708 !important;
                color: #ffffff !important;
                font-weight: 700 !important;
            }
            .flatpickr-day.today {
                border-color: #621708 !important;
            }
            .flatpickr-day:hover {
                background: #f1f5f9 !important;
            }
            .flatpickr-months .flatpickr-month {
                background: transparent !important;
                color: #0f172a !important;
                fill: #0f172a !important;
            }
            .flatpickr-current-month .flatpickr-monthDropdown-months, 
            .flatpickr-current-month input.cur-year {
                font-weight: 700 !important;
                color: #0f172a !important;
            }
            input[data-cite-picker="true"] {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'/%3E%3C/svg%3E") !important;
                background-repeat: no-repeat !important;
                background-position: right 14px center !important;
                background-size: 18px 18px !important;
                padding-right: 40px !important;
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);

        function attachFlatpickr() {
            if (typeof flatpickr !== 'function') return;
            const dateInputs = document.querySelectorAll('input[type="date"], input[data-cite-picker="true"]');
            dateInputs.forEach(input => {
                if (input._flatpickr) return;
                input.type = 'text';
                input.setAttribute('data-cite-picker', 'true');
                input.setAttribute('autocomplete', 'off');
                input.setAttribute('placeholder', 'YYYY-MM-DD');

                flatpickr(input, {
                    dateFormat: 'Y-m-d',
                    allowInput: true,
                    clickOpens: true,
                    closeOnSelect: true,
                    defaultDate: input.value || null,
                    onChange: function(selectedDates, dateStr, instance) {
                        input.value = dateStr;
                        instance.close();
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
            });
        }

        if (typeof flatpickr === 'function') {
            attachFlatpickr();
        } else if (!document.querySelector('script[src*="flatpickr"]')) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/flatpickr';
            script.onload = () => {
                attachFlatpickr();
            };
            document.head.appendChild(script);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                attachFlatpickr();
                const observer = new MutationObserver(() => attachFlatpickr());
                observer.observe(document.body, { childList: true, subtree: true });
            });
        } else {
            attachFlatpickr();
            const observer = new MutationObserver(() => attachFlatpickr());
            observer.observe(document.body, { childList: true, subtree: true });
        }
    })();

    applyTheme();
    migrateLegacyFeedbackNotifications();

    document.addEventListener('DOMContentLoaded', function () {
        if (!PAGE_PATH.includes('/auth') && !PAGE_PATH.includes('login')) {
            migrateLegacyFeedbackNotifications();
        }
        if (window.CiteFlowSettings?.loadPreferences) {
            window.CiteFlowSettings.loadPreferences().catch(() => {});
        }
    });
})();