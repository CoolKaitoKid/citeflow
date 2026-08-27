// ==============================================================================
// CITE-Flow Client-Side Role-Based Route Guard & Session Verifier
// Load shared/auth.js before this file when possible.
// ==============================================================================

(function () {
    function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (window.supabase && typeof window.supabase.createClient === 'function' && window.__SUPABASE_URL__ && window.__SUPABASE_ANON__) {
            return window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON__);
        }
        return null;
    }

    function fallbackNeedsOnboarding(facultyRecord, user) {
        const meta = user?.user_metadata || {};
        if (facultyRecord?.first_login_completed_at) return false;
        if (facultyRecord?.profile_completed === true) return false;
        if (meta.onboarding_completed_at || meta.first_login_completed_at) return false;
        if (meta.profile_completed === true) return false;
        if (facultyRecord?.must_change_password === true) return true;
        if (facultyRecord?.profile_completed === false) return true;
        if (facultyRecord?.auth_user_id && facultyRecord.profile_completed == null) return true;
        if (meta.must_change_password === true) return true;
        if (meta.profile_completed === false) return true;
        return false;
    }

    function needsOnboarding(facultyRecord, user) {
        if (window.CiteFlowAuth?.needsOnboarding) {
            return window.CiteFlowAuth.needsOnboarding(facultyRecord, user);
        }
        return fallbackNeedsOnboarding(facultyRecord, user);
    }

    function isOnboardingComplete(facultyRecord, user) {
        if (window.CiteFlowAuth?.isOnboardingComplete) {
            return window.CiteFlowAuth.isOnboardingComplete(facultyRecord, user);
        }
        return !fallbackNeedsOnboarding(facultyRecord, user);
    }

    async function initAuthGuard() {
        const currentPath = window.location.pathname.toLowerCase();

        const isAdminArea = currentPath.includes('/admin/') ||
            currentPath === '/dashboard' ||
            ['faculty-profiles', 'workload-tracker', 'engagement-logs', 'document-vault', 'workflow-approval', 'reports-analytics', 'feedback-summary', 'user-management', 'admin-profile'].some(p => currentPath.endsWith(p) || currentPath.endsWith(p + '.html'));

        const isFacultyArea = currentPath.includes('/faculty/') ||
            currentPath === '/faculty' ||
            ['dashboard', 'faculty-profile', 'calendar', 'document', 'status-tracking', 'submissions', 'system-settings'].some(p => currentPath === `/faculty/${p}` || currentPath === `/faculty/${p}.html`);

        const isOnboardingArea = currentPath.includes('onboarding');

        if (!isAdminArea && !isFacultyArea && !isOnboardingArea) return;

        const isInsideSubfolder = currentPath.includes('/admin/') || currentPath.includes('/faculty/');
        const prefix = isInsideSubfolder ? '../' : '';

        const sb = getClient();
        if (!sb) return;

        try {
            const { data: { session }, error } = await sb.auth.getSession();

            if (error || !session || !session.user) {
                console.warn("Auth Guard: No authenticated session detected. Redirecting to login...");
                window.location.href = `${prefix}login.html`;
                return;
            }

            async function redirectExpiredSession() {
                console.warn("Auth Guard: Session expired. Redirecting to login...");
                try {
                    await sb.auth.signOut({ scope: 'local' });
                } catch (e) { /* ignore */ }
                window.location.href = `${prefix}login.html`;
            }

            // getSession() returns a stored session even after the access JWT expires.
            // Refresh before any table queries so PostgREST does not return PGRST303.
            let activeSession = session;
            const expiresAt = Number(session.expires_at || 0);
            const nowSec = Math.floor(Date.now() / 1000);
            if (expiresAt && expiresAt <= nowSec + 15) {
                const refreshed = await sb.auth.refreshSession();
                if (refreshed.error || !refreshed.data?.session?.user) {
                    await redirectExpiredSession();
                    return;
                }
                activeSession = refreshed.data.session;
            }

            const user = activeSession.user;
            const role = String(user.user_metadata?.role || '').toLowerCase();
            const isWorkflowApprovalPage = currentPath.includes('workflow-approval');

            const facultyLookup = await sb
                .from('faculty')
                .select('id, role, position, admin_access, profile_completed, must_change_password, first_login_completed_at, department')
                .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`)
                .maybeSingle();

            const facultyAuthFailed = facultyLookup.error && (
                facultyLookup.status === 401
                || String(facultyLookup.error.code || '') === 'PGRST303'
                || String(facultyLookup.error.message || '').toLowerCase().includes('jwt expired')
            );
            if (facultyAuthFailed) {
                await redirectExpiredSession();
                return;
            }

            const facultyRecord = facultyLookup.data;

            const facultyRole = String(facultyRecord?.role || facultyRecord?.position || role || '').toLowerCase();
            const isChair = facultyRole.includes('chair');
            const isDean = facultyRole === 'dean';
            const isSecretary = facultyRole.includes('secretary');
            const isAdminRole = role === 'admin' || role === 'administrator' || facultyRole === 'admin' || facultyRole === 'administrator';
            const hasAdminAccess = facultyRecord?.admin_access === true;
            const onboardingRequired = needsOnboarding(facultyRecord, user);
            const onboardingDone = isOnboardingComplete(facultyRecord, user);

            // Sync validated encrypted session token with anti-tamper metadata
            if (window.CiteFlowAuth?.cacheUserInfo) {
                window.CiteFlowAuth.cacheUserInfo(user, isAdminRole ? 'Admin' : (facultyRecord?.role || 'Faculty'), facultyRecord);
            }

            if (isOnboardingArea) {
                if (onboardingDone) {
                    const adminDestination = (isAdminRole || isDean || isSecretary || (isChair && hasAdminAccess))
                        ? `${prefix}admin/dashboard.html`
                        : `${prefix}faculty/dashboard.html`;
                    window.location.href = adminDestination;
                }
                return;
            }

            if (isAdminArea) {
                if (isWorkflowApprovalPage) {
                    const canWorkflow = isAdminRole || isDean || isSecretary || isChair || hasAdminAccess;
                    if (!canWorkflow) {
                        window.location.href = `${prefix}login.html`;
                        return;
                    }
                } else if (role === 'faculty' || (facultyRole === 'faculty' && !hasAdminAccess && !isChair && !isDean && !isSecretary)) {
                    window.location.href = isInsideSubfolder ? '../faculty/dashboard.html' : 'faculty/dashboard.html';
                    return;
                }

                if (facultyRecord && onboardingRequired && !isAdminRole) {
                    window.location.href = `${prefix}onboarding.html`;
                    return;
                }
            } else if (isFacultyArea) {
                const isFacultyPortalRole = role === 'faculty' || facultyRole === 'faculty' || isChair;

                if (!facultyRecord && role !== 'admin' && role !== 'administrator') {
                    window.location.href = `${prefix}login.html`;
                    return;
                }

                if (facultyRecord && !isFacultyPortalRole && !isDean && !isSecretary && role !== 'admin' && role !== 'administrator') {
                    window.location.href = `${prefix}login.html`;
                    return;
                }

                if (onboardingRequired) {
                    console.info("Auth Guard: First-time onboarding required.");
                    window.location.href = `${prefix}onboarding.html`;
                    return;
                }
            }
        } catch (err) {
            console.error("Auth Guard check encountered error:", err);
        }
    }

    initAuthGuard();
})();
