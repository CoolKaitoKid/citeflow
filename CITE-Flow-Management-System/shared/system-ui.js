/* Global CITE-Flow UI utilities: notifications + theme */
(function initCiteFlowUI() {
    const LEGACY_THEME_KEY = 'citeflow_theme_color';
    const THEME_KEY_PREFIX = 'citeflow_theme_color_v2';
    const NOTIF_KEY = 'citeflow_notifications';
    const LEGACY_FEEDBACK_KEY = 'feedbackNotifications';
    const ROLE = getRoleFromPath();
    const PAGE_PATH = window.location.pathname.toLowerCase();

    const THEMES = ['#740A03', '#BB1919', '#250505', '#000000', '#E2E2B6'];
    const DEFAULT_THEME = '#740A03';

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
        if (legacyTheme && THEMES.includes(legacyTheme)) {
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

    function adjustTheme(color) {
        const theme = THEMES.includes(color) ? color : DEFAULT_THEME;
        const lum = luminance(theme);
        const text = lum > 0.55 ? '#111827' : '#FFFFFF';
        const hover = lum > 0.55 ? mix(theme, '#000000', 0.18) : mix(theme, '#FFFFFF', 0.14);
        const panel = lum > 0.55 ? mix(theme, '#FFFFFF', 0.74) : mix(theme, '#FFFFFF', 0.16);
        const panelText = luminance(panel) > 0.62 ? '#111827' : '#FFFFFF';
        return { theme, text, hover, panel, panelText };
    }

    function applyTheme() {
        const selected = getStoredTheme();
        const palette = adjustTheme(selected);
        const root = document.documentElement;
        root.style.setProperty('--cite-theme', palette.theme);
        root.style.setProperty('--cite-theme-text', palette.text);
        root.style.setProperty('--cite-theme-hover', palette.hover);
        root.style.setProperty('--cite-theme-soft', palette.panel);
        root.style.setProperty('--cite-theme-soft-text', palette.panelText);

        const css = `
            .sidebar { background-color: var(--cite-theme) !important; color: var(--cite-theme-text) !important; }
            .nav-item:hover, .nav-item.active { background-color: var(--cite-theme-hover) !important; }
            button[class*="bg-[#621708]"], .bg-\\[\\#621708\\], [data-theme-primary="true"] {
                background-color: var(--cite-theme) !important;
                color: var(--cite-theme-text) !important;
            }
            button[class*="hover:bg-[#4a1206]"], button[class*="hover:bg-[#8c2a10]"] {
                background-color: var(--cite-theme-hover) !important;
            }
            .theme-soft { background-color: var(--cite-theme-soft) !important; color: var(--cite-theme-soft-text) !important; }
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
        const all = getNotifications();
        return all.filter((n) => n.audience === 'all' || n.audience === ROLE);
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
        const rolePrefix = ROLE === 'admin' ? '/admin/' : '/faculty/';
        if (link.startsWith('/admin/') || link.startsWith('/faculty/')) {
            const filename = link.split('/').pop();
            return filename ? filename : '';
        }
        if (link.startsWith('/')) return link.split('/').pop() || '';
        if (link.includes('/')) return link.split('/').pop() || link;
        return link;
    }

    function renderBell() {
        if (document.getElementById('citeflow-bell-wrap')) return;

        const wrap = document.createElement('div');
        wrap.id = 'citeflow-bell-wrap';
        wrap.style.position = 'fixed';
        wrap.style.top = '16px';
        wrap.style.right = '22px';
        wrap.style.zIndex = '1000';
        wrap.innerHTML = `
            <div style="position: relative;">
                <button id="citeflow-bell-btn" aria-label="Notifications"
                    style="width:44px;height:44px;border:none;border-radius:12px;background:var(--cite-theme);color:var(--cite-theme-text);cursor:pointer;box-shadow:0 8px 18px rgba(0,0,0,.16);font-size:18px;">
                    🔔
                </button>
                <span id="citeflow-bell-badge"
                    style="position:absolute;top:-5px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#dc2626;color:#fff;font-size:11px;line-height:18px;text-align:center;display:none;">0</span>
            </div>
            <div id="citeflow-notif-panel"
                style="display:none;position:absolute;right:0;top:52px;width:330px;max-height:420px;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 14px 28px rgba(0,0,0,.2);border:1px solid #e5e7eb;">
                <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
                    <strong style="font-size:14px;">Notifications</strong>
                    <button id="citeflow-mark-all" style="border:none;background:none;color:var(--cite-theme);font-size:12px;cursor:pointer;">Mark all read</button>
                </div>
                <div id="citeflow-notif-list" style="padding:8px;"></div>
            </div>
        `;
        document.body.appendChild(wrap);

        const bell = document.getElementById('citeflow-bell-btn');
        const panel = document.getElementById('citeflow-notif-panel');
        const markAllBtn = document.getElementById('citeflow-mark-all');

        bell.addEventListener('click', function () {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            renderNotificationList();
        });

        markAllBtn.addEventListener('click', function () {
            markAllReadForRole();
            refreshBell();
            renderNotificationList();
        });

        document.addEventListener('click', function (event) {
            if (!wrap.contains(event.target)) {
                panel.style.display = 'none';
            }
        });

        refreshBell();
    }

    function renderNotificationList() {
        const listEl = document.getElementById('citeflow-notif-list');
        if (!listEl) return;
        const items = getVisibleNotifications().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (!items.length) {
            listEl.innerHTML = '<div style="padding:14px;color:#6b7280;font-size:13px;">No notifications yet.</div>';
            return;
        }

        listEl.innerHTML = items.map((n) => `
            <button data-id="${n.id}" data-link="${n.link || ''}" class="citeflow-notif-item"
                style="width:100%;text-align:left;border:1px solid #f1f5f9;background:${n.read ? '#fff' : '#fef2f2'};border-radius:10px;padding:10px 11px;margin-bottom:7px;cursor:pointer;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
                    <div style="font-size:13px;font-weight:600;color:#111827;">${n.title}</div>
                    ${n.read ? '' : '<span style="width:8px;height:8px;background:#dc2626;border-radius:999px;display:inline-block;flex:none;margin-top:4px;"></span>'}
                </div>
                <div style="font-size:12px;color:#4b5563;margin-top:3px;">${n.message || ''}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:6px;">${new Date(n.timestamp).toLocaleString()}</div>
            </button>
        `).join('');

        listEl.querySelectorAll('.citeflow-notif-item').forEach((el) => {
            el.addEventListener('click', function () {
                const id = el.getAttribute('data-id');
                const link = resolveLink(el.getAttribute('data-link'));
                markAsRead(id);
                refreshBell();
                renderNotificationList();
                if (link) window.location.href = link;
            });
        });
    }

    function refreshBell() {
        const badge = document.getElementById('citeflow-bell-badge');
        if (!badge) return;
        const unread = unreadCount();
        badge.textContent = String(unread);
        badge.style.display = unread > 0 ? 'inline-block' : 'none';
    }

    function addNotification(payload) {
        const list = getNotifications();
        list.unshift(normalizeNotification(payload));
        setNotifications(list);
        refreshBell();
    }

    window.CiteFlowUI = {
        setTheme: function (hexColor) {
            const selected = THEMES.includes(hexColor) ? hexColor : DEFAULT_THEME;
            saveTheme(selected);
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
            refreshBell();
            renderNotificationList();
        },
        routeFor: function (relativePath) {
            const clean = String(relativePath || '').replace(/^\/+/, '');
            return clean.split('/').pop() || clean;
        }
    };

    applyTheme();
    migrateLegacyFeedbackNotifications();
    document.addEventListener('DOMContentLoaded', function () {
        // Do not inject a floating notification bell.
        // Pages already provide their own notification UI (dropdown + sidebar badges).
        if (!PAGE_PATH.includes('/auth') && !PAGE_PATH.includes('login')) {
            // Keep data up to date for pages that read notifications from localStorage.
            migrateLegacyFeedbackNotifications();
        }
    });
})();
