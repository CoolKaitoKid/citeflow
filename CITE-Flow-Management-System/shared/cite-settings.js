/* Academic period + in-app notification preferences for CITE-Flow Settings */
(function initCiteFlowSettings() {
    const SEMESTERS = ['First Semester', 'Second Semester', 'Summer'];
    const FALLBACK_PERIOD = { academic_year: '2026-2027', semester: 'First Semester' };

    const ADMIN_DEFAULT_PREFS = {
        submissions: true,
        tasks: true,
        reviews: true,
        seminar_feedback: true
    };

    const FACULTY_DEFAULT_PREFS = {
        tasks: true,
        approvals: true,
        revision: true,
        rejection: true,
        submissions: true
    };

    let periodCache = null;
    let prefsCache = null;

    function getClient() {
        return window.supabaseClient || null;
    }

    function currentRole() {
        const path = String(window.location.pathname || '').toLowerCase();
        if (path.includes('/admin/')) return 'admin';
        if (path.includes('/faculty/')) return 'faculty';
        return 'faculty';
    }

    function defaultPrefs(role) {
        return { ...((role || currentRole()) === 'admin' ? ADMIN_DEFAULT_PREFS : FACULTY_DEFAULT_PREFS) };
    }

    function tableMissing(error) {
        if (!error) return false;
        const code = String(error.code || '').toUpperCase();
        const message = String(error.message || '').toLowerCase();
        return code === '42P01' || code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache');
    }

    async function getAcademicPeriod(force) {
        if (periodCache && !force) return periodCache;
        const sb = getClient();
        if (!sb) {
            periodCache = { ...FALLBACK_PERIOD, fromFallback: true };
            return periodCache;
        }
        try {
            const { data, error } = await sb
                .from('system_settings')
                .select('academic_year, semester')
                .limit(1)
                .maybeSingle();
            if (error || !data) {
                periodCache = { ...FALLBACK_PERIOD, fromFallback: true, error: error || null };
                return periodCache;
            }
            periodCache = {
                academic_year: data.academic_year || FALLBACK_PERIOD.academic_year,
                semester: SEMESTERS.includes(data.semester) ? data.semester : FALLBACK_PERIOD.semester,
                fromFallback: false
            };
            return periodCache;
        } catch (error) {
            periodCache = { ...FALLBACK_PERIOD, fromFallback: true, error };
            return periodCache;
        }
    }

    async function saveAcademicPeriod({ academic_year, semester }) {
        const sb = getClient();
        if (!sb) throw new Error('Supabase is not available.');
        const year = String(academic_year || '').trim();
        if (!year) throw new Error('Enter an academic year.');
        if (!SEMESTERS.includes(semester)) throw new Error('Select a valid semester.');

        const { data: auth } = await sb.auth.getUser();
        const payload = {
            academic_year: year,
            semester,
            updated_at: new Date().toISOString(),
            updated_by: auth?.user?.id || null
        };

        const { data: existing, error: readError } = await sb
            .from('system_settings')
            .select('id')
            .limit(1)
            .maybeSingle();
        if (readError && tableMissing(readError)) {
            throw new Error('Academic period table is not set up yet. Run shared/system-settings.sql in Supabase.');
        }

        const { error } = existing?.id
            ? await sb.from('system_settings').update(payload).eq('id', existing.id)
            : await sb.from('system_settings').insert(payload);
        if (error) {
            if (tableMissing(error)) {
                throw new Error('Academic period table is not set up yet. Run shared/system-settings.sql in Supabase.');
            }
            throw error;
        }
        periodCache = { academic_year: year, semester, fromFallback: false };
        return periodCache;
    }

    function mapToTeachingSemester(semester) {
        if (semester === 'First Semester') return '1st Semester';
        if (semester === 'Second Semester') return '2nd Semester';
        return semester || '1st Semester';
    }

    function formatPeriodLabel(period) {
        const p = period || FALLBACK_PERIOD;
        return `Academic Year ${p.academic_year} • ${p.semester}`;
    }

    async function currentUserId() {
        const sb = getClient();
        if (!sb?.auth) return null;
        const { data } = await sb.auth.getUser();
        return data?.user?.id || null;
    }

    async function loadPreferences(force) {
        if (prefsCache && !force) return prefsCache;
        const defaults = defaultPrefs();
        const sb = getClient();
        const userId = await currentUserId();
        if (!sb || !userId) {
            prefsCache = defaults;
            return prefsCache;
        }
        try {
            const { data, error } = await sb
                .from('user_preferences')
                .select('notification_prefs')
                .eq('user_id', userId)
                .maybeSingle();
            if (error || !data) {
                prefsCache = defaults;
                return prefsCache;
            }
            prefsCache = { ...defaults, ...(data.notification_prefs || {}) };
            return prefsCache;
        } catch (_) {
            prefsCache = defaults;
            return prefsCache;
        }
    }

    async function savePreferences(prefs) {
        const sb = getClient();
        const userId = await currentUserId();
        if (!sb || !userId) throw new Error('You must be signed in to save preferences.');
        const merged = { ...defaultPrefs(), ...prefs };
        const { error } = await sb.from('user_preferences').upsert({
            user_id: userId,
            notification_prefs: merged,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) {
            if (tableMissing(error)) {
                throw new Error('Preferences table is not set up yet. Run shared/system-settings.sql in Supabase.');
            }
            throw error;
        }
        prefsCache = merged;
        return merged;
    }

    function getCachedPreferences() {
        return prefsCache || defaultPrefs();
    }

    function reviewKind(notification) {
        const message = String(notification?.message || notification?.title || '').toLowerCase();
        if (message.includes('revis')) return 'revision';
        if (message.includes('reject')) return 'rejection';
        if (message.includes('approv')) return 'approvals';
        return 'approvals';
    }

    function isSeminarFeedbackItem(notification) {
        const text = `${notification?.title || ''} ${notification?.message || ''}`;
        return /feedback/i.test(text);
    }

    function matchesNotification(notification, prefs, role) {
        const p = prefs || getCachedPreferences();
        const r = role || currentRole();
        const type = String(notification?.type || '').toLowerCase();

        if (r === 'admin') {
            if (type === 'submission') return p.submissions !== false;
            if (type === 'task') return p.tasks !== false;
            if (type === 'review') return p.reviews !== false;
            if (isSeminarFeedbackItem(notification)) return p.seminar_feedback !== false;
            if (notification?.audience === 'admin') return p.seminar_feedback !== false;
            return true;
        }

        if (type === 'task') return p.tasks !== false;
        if (type === 'submission') return p.submissions !== false;
        if (type === 'review') {
            const kind = reviewKind(notification);
            if (kind === 'revision') return p.revision !== false;
            if (kind === 'rejection') return p.rejection !== false;
            return p.approvals !== false;
        }
        return true;
    }

    function filterNotifications(items, role) {
        const list = Array.isArray(items) ? items : [];
        const prefs = getCachedPreferences();
        return list.filter((item) => matchesNotification(item, prefs, role));
    }

    window.CiteFlowSettings = {
        SEMESTERS,
        FALLBACK_PERIOD,
        defaultPrefs,
        getAcademicPeriod,
        saveAcademicPeriod,
        mapToTeachingSemester,
        formatPeriodLabel,
        loadPreferences,
        savePreferences,
        getCachedPreferences,
        matchesNotification,
        filterNotifications
    };
})();
