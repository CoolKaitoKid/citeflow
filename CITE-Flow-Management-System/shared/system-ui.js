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
        }
    };

    applyTheme();
    migrateLegacyFeedbackNotifications();

    document.addEventListener('DOMContentLoaded', function () {
        if (!PAGE_PATH.includes('/auth') && !PAGE_PATH.includes('login')) {
            migrateLegacyFeedbackNotifications();
        }
    });
})();