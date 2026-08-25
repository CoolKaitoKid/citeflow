// ==============================================================================
// CITE-Flow Client-Side Role-Based Route Guard & Session Verifier
// ==============================================================================

(async function initAuthGuard() {
    function getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (window.supabase && typeof window.supabase.createClient === 'function' && window.__SUPABASE_URL__ && window.__SUPABASE_ANON__) {
            return window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON__);
        }
        return null;
    }

    const currentPath = window.location.pathname.toLowerCase();
    
    // Check page category
    const isAdminArea = currentPath.includes('/admin/') || 
                        currentPath === '/dashboard' || 
                        ['faculty-profiles', 'workload-tracker', 'engagement-logs', 'document-vault', 'workflow-approval', 'reports-analytics', 'feedback-summary', 'user-management', 'admin-profile'].some(p => currentPath.endsWith(p) || currentPath.endsWith(p + '.html'));

    const isFacultyArea = currentPath.includes('/faculty/') || 
                          currentPath === '/faculty' ||
                          ['dashboard', 'faculty-profile', 'calendar', 'document', 'status-tracking', 'submissions', 'system-settings'].some(p => currentPath === `/faculty/${p}` || currentPath === `/faculty/${p}.html`);

    const isOnboardingArea = currentPath.includes('onboarding');

    // Only protect admin, faculty, and onboarding routes
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

        const user = session.user;
        const role = String(user.user_metadata?.role || '').toLowerCase();
        const currentFile = currentPath.split('/').pop() || '';
        const isWorkflowApprovalPage = currentFile === 'workflow-approval.html' || currentFile === 'workflow-approval';

        let facultyRecord = null;
        try {
            const facultyResult = await sb
                .from('faculty')
                .select('id, role, admin_access, profile_completed, must_change_password, auth_user_id, email')
                .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`)
                .maybeSingle();
            if (facultyResult.error) {
                console.error('Auth Guard: faculty lookup failed:', facultyResult.error);
            } else {
                facultyRecord = facultyResult.data || null;
            }
        } catch (lookupError) {
            console.error('Auth Guard: faculty lookup exception:', lookupError);
        }

        const facultyRole = String(facultyRecord?.role || '').toLowerCase();
        const isChairperson = facultyRole === 'chairperson' || facultyRole.includes('chair');
        const hasFacultyAdminAccess = facultyRecord?.admin_access === true || facultyRecord?.admin_access === 'true' || facultyRecord?.admin_access === 1;
        const isAdminUser = role === 'admin' || role === 'administrator' || facultyRole === 'admin';

        if (isAdminArea) {
            // Regular faculty cannot enter the admin portal.
            // Chairpersons may open workflow-approval.html.
            // Chairperson + faculty.admin_access may use permitted admin pages.
            if (!isAdminUser) {
                if (isWorkflowApprovalPage && isChairperson) {
                    // Chairperson review dashboard is allowed.
                } else if (hasFacultyAdminAccess && isChairperson) {
                    // Chairperson with admin_access may use admin pages.
                } else if (role === 'faculty' || isChairperson || facultyRecord) {
                    console.error("Auth Guard: Faculty accounts cannot access this admin page.", {
                        page: currentFile,
                        metadataRole: role,
                        facultyRole,
                        admin_access: facultyRecord?.admin_access || false
                    });
                    if (isChairperson) {
                        window.location.href = isInsideSubfolder ? 'workflow-approval.html' : 'admin/workflow-approval.html';
                    } else {
                        window.location.href = isInsideSubfolder ? '../faculty/dashboard.html' : 'faculty/dashboard.html';
                    }
                    return;
                }
            }
        } else if (isFacultyArea) {
            if (!facultyRecord && !isAdminUser) {
                console.error("Auth Guard: No faculty profile associated with your account.");
                window.location.href = `${prefix}login.html`;
                return;
            }

            // Check if onboarding is required
            const needsOnboarding = facultyRecord?.must_change_password || 
                                    facultyRecord?.profile_completed === false || 
                                    user.user_metadata?.must_change_password || 
                                    user.user_metadata?.profile_completed === false;

            if (needsOnboarding && role !== 'admin') {
                console.info("Auth Guard: Onboarding required. Redirecting to onboarding...");
                window.location.href = isInsideSubfolder ? '../onboarding.html' : 'onboarding.html';
                return;
            }
        } else if (isOnboardingArea) {
            // If onboarding is already completed, route to faculty dashboard
            const { data: facultyRecord } = await sb
                .from('faculty')
                .select('id, profile_completed, must_change_password')
                .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`)
                .maybeSingle();

            const isDone = facultyRecord && facultyRecord.profile_completed && !facultyRecord.must_change_password;
            if (isDone) {
                window.location.href = isInsideSubfolder ? '../faculty/dashboard.html' : 'faculty/dashboard.html';
                return;
            }
        }
    } catch (err) {
        console.error("Auth Guard check encountered error:", err);
    }
})();
