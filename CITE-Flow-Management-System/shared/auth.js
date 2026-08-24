// ==============================================================================
// CITE-Flow Centralized Authentication & Onboarding Engine
// ==============================================================================

window.CiteFlowAuth = (function () {
    /**
     * Get the active Supabase client instance.
     */
    function getClient() {
        if (window.supabaseClient) {
            return window.supabaseClient;
        }
        if (window.supabase && typeof window.supabase.createClient === 'function' && window.__SUPABASE_URL__ && window.__SUPABASE_ANON__) {
            window.supabaseClient = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON__, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
            return window.supabaseClient;
        }
        console.error("CiteFlowAuth: Supabase client is not initialized.");
        return null;
    }

    /**
     * Standardized storage key for user session caching
     */
    const USER_CACHE_KEY = 'citeflow_user';

    /**
     * Cache user metadata to localStorage
     */
    function cacheUserInfo(user, role, profile = null) {
        const userInfo = {
            id: user.id,
            email: user.email,
            name: profile?.name || profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
            role: role || user.user_metadata?.role || 'Faculty',
            profileCompleted: profile ? profile.profile_completed : (user.user_metadata?.profile_completed ?? true),
            mustChangePassword: profile ? profile.must_change_password : (user.user_metadata?.must_change_password ?? false),
            department: profile?.department || user.user_metadata?.department || 'BSIT',
            profilePhotoUrl: profile?.profile_photo_url || user.user_metadata?.profile_photo_url || null,
            cachedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userInfo));
        } catch (e) {
            console.warn("Unable to cache user info to localStorage:", e);
        }
        return userInfo;
    }

    /**
     * Clears cached user info from storage
     */
    function clearUserCache() {
        try {
            localStorage.removeItem(USER_CACHE_KEY);
        } catch (e) {
            // ignore
        }
    }

    /**
     * Authenticate user with Email & Password and resolve the correct destination
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<{ user: object, role: string, destination: string }>}
     */
    async function login(email, password) {
        const sb = getClient();
        if (!sb) throw new Error("Authentication service is unavailable. Please try again later.");

        const cleanEmail = email.trim();
        const { data: authData, error: authError } = await sb.auth.signInWithPassword({
            email: cleanEmail,
            password: password
        });

        if (authError) throw authError;

        const user = authData?.user;
        if (!user) throw new Error("No user account returned from authentication.");

        // Check user role in metadata
        let role = String(user.user_metadata?.role || '').trim().toLowerCase();

        // Check if there is a matching record in the faculty table
        const { data: facultyProfile, error: facultyError } = await sb
            .from('faculty')
            .select('*')
            .or(`auth_user_id.eq.${user.id},email.ilike.${cleanEmail}`)
            .maybeSingle();

        if (facultyError && facultyError.code !== 'PGRST116') {
            console.warn("CiteFlowAuth: Warning fetching faculty profile:", facultyError.message);
        }

        // Helper to resolve relative file paths for both Live Server & Express
        const isInsideSubfolder = window.location.pathname.toLowerCase().includes('/admin/') || window.location.pathname.toLowerCase().includes('/faculty/');
        const prefix = isInsideSubfolder ? '../' : '';

        // Determine effective role & destination
        let destination = `${prefix}admin/dashboard.html`;

        if (role === 'admin' || role === 'administrator') {
            cacheUserInfo(user, 'Admin', null);
            destination = `${prefix}admin/dashboard.html`;
        } else if (facultyProfile || role === 'faculty' || !role) {
            // User is faculty
            const isFirstTime = facultyProfile?.must_change_password || 
                                user.user_metadata?.must_change_password || 
                                facultyProfile?.profile_completed === false || 
                                user.user_metadata?.profile_completed === false;

            cacheUserInfo(user, 'Faculty', facultyProfile);

            if (isFirstTime) {
                destination = `${prefix}onboarding.html`;
            } else {
                destination = `${prefix}faculty/dashboard.html`;
            }
        }

        return {
            user,
            role: role || (facultyProfile ? 'Faculty' : 'User'),
            facultyProfile,
            destination
        };
    }

    /**
     * Institutional Admin Registration Passcode
     */
    const VALID_ADMIN_PASSCODES = ['CITE-ADMIN-2026', 'CITEADMIN2026', 'CTU-CITE-ADMIN'];

    /**
     * Register a new Administrator with institutional authorization check
     * @param {object} params
     * @param {string} params.firstName
     * @param {string} params.lastName
     * @param {string} params.email
     * @param {string} params.employeeId
     * @param {string} params.adminPasscode
     * @param {string} params.password
     */
    async function registerAdmin({ firstName, lastName, email, employeeId, adminPasscode, password }) {
        const sb = getClient();
        if (!sb) throw new Error("Authentication service is unavailable. Please try again later.");

        // 1. Verify Admin Passcode
        const cleanPasscode = (adminPasscode || '').trim().toUpperCase();
        if (!VALID_ADMIN_PASSCODES.includes(cleanPasscode)) {
            throw new Error("Invalid Admin Authorization Passcode. Registration is restricted to designated administrators.");
        }

        const cleanEmail = email.trim();
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

        // 2. Sign up user as Admin in Supabase Auth
        const { data: authData, error: authError } = await sb.auth.signUp({
            email: cleanEmail,
            password: password,
            options: {
                data: {
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    full_name: fullName,
                    employee_id: employeeId.trim(),
                    role: 'Admin',
                    department: 'CITE Administration',
                    profile_completed: true,
                    must_change_password: false
                }
            }
        });

        if (authError) throw authError;
        return authData;
    }

    /**
     * Register a new user (general)
     */
    async function register({ firstName, lastName, email, employeeId, department, password }) {
        const sb = getClient();
        if (!sb) throw new Error("Authentication service is unavailable. Please try again later.");

        const cleanEmail = email.trim();
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

        const { data: authData, error: authError } = await sb.auth.signUp({
            email: cleanEmail,
            password: password,
            options: {
                data: {
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    full_name: fullName,
                    employee_id: employeeId.trim(),
                    department: department || 'BSIT',
                    role: 'Faculty',
                    profile_completed: false,
                    must_change_password: false
                }
            }
        });

        if (authError) throw authError;
        return authData;
    }

    /**
     * Complete the first-time onboarding flow (password change + profile details + photo upload)
     * @param {object} params
     * @param {string} params.newPassword
     * @param {string} params.fullName
     * @param {string} params.employeeId
     * @param {string} params.department
     * @param {string} params.phone
     * @param {string} params.birthdate
     * @param {string} params.sex
     * @param {string} params.position
     * @param {File|null} params.photoFile
     */
    async function completeOnboarding({
        newPassword,
        firstName,
        middleName,
        lastName,
        suffix,
        fullName,
        employeeId,
        department,
        phone,
        birthdate,
        sex,
        position,
        photoFile
    }) {
        const sb = getClient();
        if (!sb) throw new Error("Authentication service is unavailable.");

        const { data: { session }, error: sessionError } = await sb.auth.getSession();
        if (sessionError || !session?.user) {
            throw new Error("No active session found. Please log in again.");
        }

        const user = session.user;
        const nowIso = new Date().toISOString();
        let photoUrl = null;

        // --- MIDDLE INITIAL CONVERSION LOGIC ---
        let cleanMiddle = (middleName || '').trim();
        if (cleanMiddle.length > 0) {
            cleanMiddle = cleanMiddle.charAt(0).toUpperCase() + '.';
        }

        const fn = (firstName || '').trim();
        const ln = (lastName || '').trim();
        const sx = (suffix || '').trim();

        const formattedFullName = `${fn} ${cleanMiddle ? cleanMiddle + ' ' : ''}${ln}${sx ? ' ' + sx : ''}`.trim();

        // 1. Upload photo if provided
        if (photoFile && photoFile.size > 0) {
            const fileExt = photoFile.name.split('.').pop() || 'jpg';
            const filePath = `${user.id}/${Date.now()}.${fileExt}`;

            const { error: uploadError } = await sb.storage
                .from('faculty-profile-photos')
                .upload(filePath, photoFile, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (!uploadError) {
                const { data: publicUrlData } = sb.storage
                    .from('faculty-profile-photos')
                    .getPublicUrl(filePath);
                photoUrl = publicUrlData?.publicUrl || null;
            } else {
                console.warn("Photo upload notice:", uploadError.message);
                throw new Error("Photo upload failed: " + uploadError.message);
            }
        }

        // 2. Update Supabase Auth User (Password & Metadata)
        const updateAuthPayload = {
            data: {
                role: 'Faculty',
                first_name: fn,
                middle_name: cleanMiddle,
                last_name: ln,
                suffix: sx,
                full_name: formattedFullName,
                employee_id: employeeId,
                department: department,
                phone: phone,
                profile_photo_url: photoUrl,
                profile_completed: true,
                must_change_password: false,
                onboarding_completed_at: nowIso
            }
        };

        if (newPassword && newPassword.trim().length >= 8) {
            updateAuthPayload.password = newPassword;
        }

        const { error: updateAuthError } = await sb.auth.updateUser(updateAuthPayload);
        if (updateAuthError) throw updateAuthError;

        // 3. Upsert / Update public.faculty profile
        const profilePayload = {
            auth_user_id: user.id,
            name: formattedFullName,
            full_name: formattedFullName,
            first_name: fn || null,
            middle_name: cleanMiddle || null,
            last_name: ln || null,
            suffix: sx || null,
            employee_id: employeeId,
            department: department,
            phone: phone || null,
            birthdate: birthdate || null,
            sex: sex || null,
            position: position || 'Faculty',
            email: user.email,
            status: 'Active',
            role: 'Faculty',
            profile_completed: true,
            must_change_password: false,
            updated_at: nowIso
        };

        if (photoUrl) {
            profilePayload.profile_photo_url = photoUrl;
        }

        const { error: profileError } = await sb
            .from('faculty')
            .upsert(profilePayload, { onConflict: 'auth_user_id' });

        if (profileError) {
            console.warn("CiteFlowAuth: Public faculty record update error:", profileError.message);
            throw new Error("Profile record save failed: " + profileError.message);
        }

        // Cache updated info
        cacheUserInfo(user, 'Faculty', profilePayload);

        return { success: true };
    }

    /**
     * Sign out the active user and redirect to login
     */
    async function logout() {
        const sb = getClient();
        clearUserCache();
        if (sb) {
            try {
                await sb.auth.signOut();
            } catch (e) {
                console.warn("SignOut notice:", e);
            }
        }
        const isSub = window.location.pathname.toLowerCase().includes('/admin/') || window.location.pathname.toLowerCase().includes('/faculty/');
        window.location.href = isSub ? '../login.html' : 'login.html';
    }

    /**
     * Get current session and user safely
     */
    async function getSession() {
        const sb = getClient();
        if (!sb) return null;
        try {
            const { data: { session } } = await sb.auth.getSession();
            return session;
        } catch (e) {
            return null;
        }
    }

    return {
        login,
        register,
        registerAdmin,
        completeOnboarding,
        logout,
        getSession,
        cacheUserInfo,
        clearUserCache,
        getClient
    };
})();