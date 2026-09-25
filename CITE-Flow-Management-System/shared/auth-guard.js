// ==============================================================================
// CITE-Flow Client-Side Role-Based Route Guard & Session Verifier
// Load shared/auth.js before this file when possible.
//
// Auth states:
//   AUTH_INITIALIZING   — session restoration in progress (do NOT redirect)
//   AUTHENTICATED       — Supabase session confirmed
//   AUTH_UNAUTHENTICATED — session restoration finished with no user
// ==============================================================================

(function () {
    const AuthState = {
        INITIALIZING: 'AUTH_INITIALIZING',
        AUTHENTICATED: 'AUTHENTICATED',
        UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED'
    };

    let guardState = AuthState.INITIALIZING;
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });

    const guardApi = {
        state: AuthState.INITIALIZING,
        ready,
        session: null,
        user: null,
        faculty: null,
        AuthState
    };
    window.CiteFlowAuthGuard = guardApi;

    function getClient() {
        if (window.CiteFlowAuth?.ensureSharedClient) {
            return window.CiteFlowAuth.ensureSharedClient();
        }
        if (window.CiteFlowAuth?.getClient) {
            return window.CiteFlowAuth.getClient();
        }
        if (window.supabaseClient) return window.supabaseClient;
        if (window.supabase && typeof window.supabase.createClient === 'function' && window.__SUPABASE_URL__ && window.__SUPABASE_ANON__) {
            const options = window.CiteFlowAuth?.AUTH_CLIENT_OPTIONS || {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            };
            window.supabaseClient = window.supabase.createClient(
                window.__SUPABASE_URL__,
                window.__SUPABASE_ANON__,
                options
            );
            return window.supabaseClient;
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

    function finish(state, payload = {}) {
        guardState = state;
        guardApi.state = state;
        guardApi.session = payload.session || null;
        guardApi.user = payload.user || payload.session?.user || null;
        guardApi.faculty = payload.faculty || null;
        resolveReady(guardApi);
    }

    function buildLoginRedirect(prefix) {
        const next = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
        const encoded = encodeURIComponent(next);
        return `${prefix}login.html?next=${encoded}`;
    }

    function redirectToLogin(prefix) {
        console.warn('[AUTH TRACE] REDIRECT TO LOGIN', {
            path: window.location.pathname,
            search: window.location.search || '',
            guardState,
            reason: 'no confirmed session'
        });
        finish(AuthState.UNAUTHENTICATED);
        window.location.replace(buildLoginRedirect(prefix));
    }

    async function initAuthGuard() {
        const currentPath = window.location.pathname.toLowerCase();

        const isAdminArea = currentPath.includes('/admin/') ||
            currentPath === '/dashboard' ||
            ['faculty-profiles', 'workload-tracker', 'engagement-logs', 'document-vault', 'workflow-approval', 'reports-analytics', 'feedback-summary', 'user-management', 'admin-profile'].some(p => currentPath.endsWith(p) || currentPath.endsWith(p + '.html'));

        const isFacultyArea = currentPath.includes('/faculty/') ||
            currentPath === '/faculty' ||
            ['dashboard', 'faculty-profile', 'calendar', 'document', 'status-tracking', 'submissions', 'system-settings', 'mfo-report'].some(p => currentPath === `/faculty/${p}` || currentPath === `/faculty/${p}.html`);

        const isChairpersonArea = currentPath.includes('/chairperson/');
        const isOnboardingArea = currentPath.includes('onboarding');

        if (!isAdminArea && !isFacultyArea && !isOnboardingArea && !isChairpersonArea) {
            finish(AuthState.AUTHENTICATED);
            return;
        }

        const isInsideSubfolder = currentPath.includes('/admin/') || currentPath.includes('/faculty/') || currentPath.includes('/chairperson/');
        const prefix = isInsideSubfolder ? '../' : '';

        const sb = getClient();
        if (!sb) {
            // Client not ready yet — do not treat as logged out.
            console.warn('Auth Guard: Supabase client unavailable during init; skipping hard redirect.');
            finish(AuthState.INITIALIZING);
            return;
        }

        try {
            guardState = AuthState.INITIALIZING;
            guardApi.state = AuthState.INITIALIZING;

            const activeSession = await restoreSession(sb);

            console.info('[AUTH TRACE] AUTH GUARD', {
                hasSession: !!activeSession,
                hasUser: !!activeSession?.user,
                authUserId: activeSession?.user?.id || null,
                expiresAt: activeSession?.expires_at || null
            });

            if (!activeSession?.user || !activeSession?.access_token) {
                console.warn('Auth Guard: Session restoration finished with no authenticated user.');
                redirectToLogin(prefix);
                return;
            }

            async function redirectExpiredSession() {
                // Do not signOut(). A transient 401 during navigation would
                // wipe a recoverable session and force every menu click to login.
                const again = await restoreSession(sb);
                if (again?.user) {
                    activeSession = again;
                    return false;
                }
                console.warn('Auth Guard: Session expired after refresh failure. Redirecting to login...');
                redirectToLogin(prefix);
                return true;
            }

            const user = activeSession.user;
            const role = String(user.user_metadata?.role || '').toLowerCase();
            const isWorkflowApprovalPage = currentPath.includes('workflow-approval');

            let adminProfile = null;
            try {
                const adminLookup = await sb
                    .from('admin_profiles')
                    .select('id, role')
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
                const nowSec = Math.floor(Date.now() / 1000);
                let exp = Number(activeSession?.expires_at || 0);
                if (!exp && activeSession?.access_token) {
                    try {
                        const parts = activeSession.access_token.split('.');
                        if (parts.length === 3) {
                            const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                            if (p?.exp) exp = Number(p.exp);
                        }
                    } catch (_) {}
                }
                let refreshed = null;
                // Only attempt refresh if session is truly expired or near expiry
                if (!exp || exp <= nowSec + 30) {
                    refreshed = window.CiteFlowAuth?.refreshSessionShared
                        ? await window.CiteFlowAuth.refreshSessionShared(sb)
                        : null;
                }
                if (!refreshed?.user) {
                    if (activeSession?.user) {
                        console.warn('Auth Guard: refresh skipped/failed, retaining the existing authenticated session.');
                    } else if (await redirectExpiredSession()) {
                        return;
                    }
                }
                // JWT verified/refreshed — continue with existing user; do not treat RLS/data errors as logout.
            } else if (facultyLookup.error) {
                // Authorization/data error ≠ logged out.
                console.warn('Auth Guard: faculty lookup error (not treating as logout):', facultyLookup.error);
            }

            const facultyRows = Array.isArray(facultyLookup.data)
                ? facultyLookup.data
                : (facultyLookup.data ? [facultyLookup.data] : []);
            const facultyRecord = facultyRows.find((row) => String(row.auth_user_id || '') === String(user.id))
                || facultyRows.find((row) => /chair/i.test(String(row.role || row.position || '')))
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

            const facultyPortalOk = window.CiteFlowAuth?.isFacultyPortalRole
                ? window.CiteFlowAuth.isFacultyPortalRole(role, facultyRecord)
                : (Boolean(facultyRecord) || role === 'faculty' || isChair || isDean || isSecretary || isAdminRole);

            if (window.CiteFlowAuth?.cacheUserInfo) {
                const cachedRole = isAdminRole
                    ? 'Admin'
                    : (isChair ? (facultyRecord?.role || facultyRecord?.position || 'Chairperson') : (facultyRecord?.role || 'Faculty'));
                window.CiteFlowAuth.cacheUserInfo(user, cachedRole, facultyRecord);
            }

            finish(AuthState.AUTHENTICATED, {
                session: activeSession,
                user,
                faculty: facultyRecord
            });

            if (isOnboardingArea) {
                if (onboardingDone) {
                    const adminDestination = (isAdminRole || isDean || isSecretary || (isChair && hasAdminAccess))
                        ? `${prefix}admin/dashboard.html`
                        : `${prefix}faculty/dashboard.html`;
                    window.location.replace(adminDestination);
                }
                return;
            }

            if (isChairpersonArea) {
                window.location.replace(`${prefix}faculty/submissions.html#chair-review`);
                return;
            }

            if (isAdminArea) {
                const chairOnly = isChair && !isAdminRole && !isDean && !isSecretary && !hasAdminAccess;
                if (chairOnly) {
                    if (isWorkflowApprovalPage) {
                        const granted = await chairHasActiveGrant(sb, facultyRecord, user);
                        window.location.replace(granted
                            ? `${prefix}faculty/submissions.html#chair-review`
                            : `${prefix}faculty/dashboard.html`);
                        return;
                    }
                    window.location.replace(`${prefix}faculty/dashboard.html`);
                    return;
                } else if (isWorkflowApprovalPage) {
                    const canWorkflow = isAdminRole || isDean || isSecretary || isChair || hasAdminAccess;
                    if (!canWorkflow) {
                        window.location.replace(isInsideSubfolder ? 'dashboard.html' : `${prefix}admin/dashboard.html`);
                        return;
                    }
                } else if (role === 'faculty' || (facultyRole === 'faculty' && !hasAdminAccess && !isChair && !isDean && !isSecretary && !isAdminRole)) {
                    window.location.replace(isInsideSubfolder ? '../faculty/dashboard.html' : 'faculty/dashboard.html');
                    return;
                }

                if (facultyRecord && onboardingRequired && !isAdminRole) {
                    window.location.replace(`${prefix}onboarding.html`);
                    return;
                }
            } else if (isFacultyArea) {
                // Administrators should be sent to the admin dashboard
                if (isAdminRole) {
                    window.location.replace(`${prefix}admin/dashboard.html`);
                    return;
                }

                // Authenticated session is enough to stay on the faculty portal.
                // Missing faculty row or non-standard role titles must NOT force login.
                if (!facultyPortalOk && !isAdminRole && !isDean && !isSecretary && !facultyRecord) {
                    console.warn('Auth Guard: authenticated user has no faculty profile yet; allowing page to handle it.');
                }

                if (onboardingRequired && facultyRecord) {
                    console.info('Auth Guard: First-time onboarding required.');
                    window.location.replace(`${prefix}onboarding.html`);
                    return;
                }
            }
        } catch (err) {
            console.error('Auth Guard check encountered error:', err);
            // Do not redirect to login on unexpected errors — may be transient.
            finish(guardState === AuthState.AUTHENTICATED ? AuthState.AUTHENTICATED : AuthState.INITIALIZING);
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function restoreSession(sb) {
        if (!sb?.auth) return null;

        if (window.CiteFlowAuth?.ensureActiveSession) {
            const active = await window.CiteFlowAuth.ensureActiveSession(sb);
            if (active?.user && active?.access_token) return active;
        } else if (window.CiteFlowAuth?.rehydrateClientSession) {
            const rehydrated = await window.CiteFlowAuth.rehydrateClientSession(sb);
            if (rehydrated?.user && rehydrated?.access_token) return rehydrated;
        } else if (window.CiteFlowAuth?.waitForSession) {
            const waited = await window.CiteFlowAuth.waitForSession({ timeoutMs: 8000, client: sb });
            if (waited?.user && waited?.access_token) return waited;
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
                const { data } = await sb.auth.getSession();
                if (data?.session?.user && data?.session?.access_token) return data.session;
            } catch (_) {}
            await delay(200 * (attempt + 1));
        }
        return null;
    }

    function namesMatch(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
            && String(a || '').trim() !== '';
    }

    async function chairHasActiveGrant(sb, facultyRecord, user) {
        if (!facultyRecord || !sb) return false;
        if (window.CiteFlowWorkflow?.currentUserHasChairpersonGrant) {
            try {
                return await window.CiteFlowWorkflow.currentUserHasChairpersonGrant(sb, facultyRecord, user);
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
