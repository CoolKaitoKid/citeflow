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

        const isChairpersonArea = currentPath.includes('/chairperson/');
        const isOnboardingArea = currentPath.includes('onboarding');

        if (!isAdminArea && !isFacultyArea && !isOnboardingArea && !isChairpersonArea) return;

        const isInsideSubfolder = currentPath.includes('/admin/') || currentPath.includes('/faculty/') || currentPath.includes('/chairperson/');
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

            let adminProfile = null;
            try {
                const adminLookup = await sb
                    .from('admin_profiles')
                    .select('id, role, department')
                    .eq('id', user.id)
                    .maybeSingle();
                if (!adminLookup.error) adminProfile = adminLookup.data || null;
            } catch (_) {}

            const facultyLookup = await sb
                .from('faculty')
                .select('id, role, position, admin_access, profile_completed, must_change_password, first_login_completed_at, department, full_name, email, auth_user_id')
                .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`);

            const facultyAuthFailed = facultyLookup.error && (
                facultyLookup.status === 401
                || String(facultyLookup.error.code || '') === 'PGRST303'
                || String(facultyLookup.error.message || '').toLowerCase().includes('jwt expired')
            );
            if (facultyAuthFailed) {
                await redirectExpiredSession();
                return;
            }

            const facultyRows = Array.isArray(facultyLookup.data)
                ? facultyLookup.data
                : (facultyLookup.data ? [facultyLookup.data] : []);
            const facultyRecord = facultyRows.find((row) => /chair/i.test(String(row.role || row.position || '')))
                || facultyRows.find((row) => String(row.auth_user_id || '') === String(user.id))
                || facultyRows[0]
                || null;
            const adminProfileRole = String(adminProfile?.role || '').toLowerCase();
            const facultyRole = String(facultyRecord?.role || facultyRecord?.position || role || '').toLowerCase();
            const isChair = facultyRole.includes('chair');
            const isDean = facultyRole === 'dean' || adminProfileRole.includes('dean');
            const isSecretary = facultyRole.includes('secretary') || adminProfileRole.includes('secretary');
            const isAdminRole = role === 'admin'
                || role === 'administrator'
                || facultyRole === 'admin'
                || facultyRole === 'administrator'
                || adminProfileRole === 'admin'
                || adminProfileRole === 'administrator'
                || Boolean(adminProfile);
            const hasAdminAccess = facultyRecord?.admin_access === true;
            const onboardingRequired = needsOnboarding(facultyRecord, user);
            const onboardingDone = isOnboardingComplete(facultyRecord, user);

            // Sync validated encrypted session token with anti-tamper metadata
            if (window.CiteFlowAuth?.cacheUserInfo) {
                const cachedRole = isChair
                    ? (facultyRecord?.role || facultyRecord?.position || 'Chairperson')
                    : (isAdminRole ? 'Admin' : (facultyRecord?.role || 'Faculty'));
                window.CiteFlowAuth.cacheUserInfo(user, cachedRole, facultyRecord);
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

            if (isChairpersonArea) {
                window.location.href = `${prefix}faculty/submissions.html#chair-review`;
                return;
            }

            if (isAdminArea) {
                const chairOnly = isChair && !isAdminRole && !isDean && !isSecretary && !hasAdminAccess;
                if (chairOnly) {
                    if (isWorkflowApprovalPage) {
                        const granted = await chairHasActiveGrant(sb, facultyRecord, user);
                        window.location.href = granted
                            ? `${prefix}faculty/submissions.html#chair-review`
                            : `${prefix}faculty/dashboard.html`;
                        return;
                    }
                    window.location.href = `${prefix}faculty/dashboard.html`;
                    return;
                } else if (isWorkflowApprovalPage) {
                    const canWorkflow = isAdminRole || isDean || isSecretary || isChair || hasAdminAccess;
                    if (!canWorkflow) {
                        window.location.href = isInsideSubfolder ? 'dashboard.html' : `${prefix}admin/dashboard.html`;
                        return;
                    }
                } else if (role === 'faculty' || (facultyRole === 'faculty' && !hasAdminAccess && !isChair && !isDean && !isSecretary && !isAdminRole)) {
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

    function namesMatch(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
            && String(a || '').trim() !== '';
    }

    async function chairHasActiveGrant(sb, facultyRecord, user) {
        if (!facultyRecord || !sb) return false;
        if (window.CiteFlowWorkflow?.currentUserHasChairpersonGrant) {
            try {
                return await window.CiteFlowWorkflow.currentUserHasChairpersonGrant(sb, facultyRecord);
            } catch (_) {}
        }
        if (window.CiteFlowWorkflow?.hasChairpersonWorkflowAccess) {
            try {
                const { data, error } = await sb.from('wf_delegated_access').select('*').eq('is_active', true);
                if (error) return false;
                return window.CiteFlowWorkflow.hasChairpersonWorkflowAccess(facultyRecord, data || []);
            } catch (_) {
                return false;
            }
        }
        try {
            const { data, error } = await sb
                .from('wf_delegated_access')
                .select('id, is_active, grantee_faculty_id, grantee_auth_user_id, grantee_name, grantee_email, email')
                .eq('is_active', true);
            if (error || !Array.isArray(data) || !data.length) return false;
            const facultyId = facultyRecord.id != null ? String(facultyRecord.id) : '';
            const authId = String(facultyRecord.auth_user_id || user?.id || '');
            const facultyName = facultyRecord.full_name || facultyRecord.name || '';
            const facultyEmail = facultyRecord.email || user?.email || '';
            return data.some((grant) => {
                if (grant?.is_active === false) return false;
                if (facultyId && grant.grantee_faculty_id != null && String(grant.grantee_faculty_id) === facultyId) return true;
                if (authId && grant.grantee_auth_user_id != null && String(grant.grantee_auth_user_id) === authId) return true;
                if (namesMatch(grant.grantee_name, facultyName)) return true;
                if (namesMatch(grant.grantee_email || grant.email, facultyEmail)) return true;
                return false;
            });
        } catch (_) {
            return false;
        }
    }

    initAuthGuard();
})();
