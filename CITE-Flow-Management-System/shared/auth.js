// ==============================================================================
// CITE-Flow Centralized Authentication & Onboarding Engine
// ==============================================================================

window.CiteFlowAuth = (function () {
    const AUTH_CLIENT_OPTIONS = {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    };

    /**
     * Single shared Supabase client for the whole app.
     */
    function getClient() {
        if (window.supabaseClient) {
            return window.supabaseClient;
        }
        if (window.supabase && typeof window.supabase.createClient === 'function' && window.__SUPABASE_URL__ && window.__SUPABASE_ANON__) {
            window.supabaseClient = window.supabase.createClient(
                window.__SUPABASE_URL__,
                window.__SUPABASE_ANON__,
                AUTH_CLIENT_OPTIONS
            );
            return window.supabaseClient;
        }
        console.error("CiteFlowAuth: Supabase client is not initialized.");
        return null;
    }

    function ensureSharedClient() {
        return getClient();
    }

    /**
     * Standardized storage key for user session caching
     */
    const USER_CACHE_KEY = 'citeflow_user';
    const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour session expiration
    const INSTITUTIONAL_SALT = 'CTU_CITEFLOW_SEC_KEY_v2_2026#@!';

    // =========================================================================
    // ENCRYPTED SESSION TOKEN & INTEGRITY HELPERS
    // =========================================================================

    /**
     * Fast, resilient cryptographic string hash (FNV-1a 64-bit hybrid)
     */
    function computeChecksum(str, salt = INSTITUTIONAL_SALT) {
        const full = `${salt}:${str}:${salt.split('').reverse().join('')}`;
        let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
        for (let i = 0; i < full.length; i++) {
            const code = full.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= (code << 3) | (code >> 5);
            h2 = Math.imul(h2, 0x100000001b3);
        }
        const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
        const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
        return `${p1}${p2}`;
    }

    /**
     * Obfuscate / Encrypt payload using multi-round XOR + dynamic S-Box + Base64
     */
    function encryptSessionPayload(rawObject, ttlMs = SESSION_TTL_MS) {
        try {
            const now = Date.now();
            const exp = now + (typeof ttlMs === 'number' ? ttlMs : SESSION_TTL_MS);
            const serialized = JSON.stringify(rawObject);
            const sig = computeChecksum(`${serialized}:${now}:${exp}`);

            const envelope = {
                v: 2,
                iat: now,
                exp: exp,
                sub: rawObject.id || 'anonymous',
                role: rawObject.role || 'Faculty',
                profileCompleted: Boolean(rawObject.profileCompleted),
                mustChangePassword: Boolean(rawObject.mustChangePassword),
                data: rawObject,
                sig: sig
            };

            const jsonStr = unescape(encodeURIComponent(JSON.stringify(envelope)));
            const salt = `${INSTITUTIONAL_SALT}_${now % 99991}`;
            let cipherChars = [];

            for (let i = 0; i < jsonStr.length; i++) {
                const charCode = jsonStr.charCodeAt(i);
                const saltCode = salt.charCodeAt(i % salt.length);
                const cipherCode = charCode ^ saltCode ^ ((i * 17) & 0xFF);
                cipherChars.push(String.fromCharCode(cipherCode));
            }

            const token = btoa(cipherChars.join(''))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            return {
                token: `cf_tok_v2.${now}.${exp}.${token}`,
                envelope
            };
        } catch (e) {
            console.warn("CiteFlowAuth: Token encryption notice:", e);
            return null;
        }
    }

    /**
     * Decrypt and verify session token envelope, validating integrity & expiration
     */
    function decryptSessionPayload(tokenString) {
        if (!tokenString || typeof tokenString !== 'string') return null;
        try {
            if (!tokenString.startsWith('cf_tok_v2.')) return null;

            const parts = tokenString.split('.');
            if (parts.length < 4) return null;

            const now = Date.now();
            const iat = Number(parts[1]);
            const exp = Number(parts[2]);
            const base64Cipher = parts[3]
                .replace(/-/g, '+')
                .replace(/_/g, '/');

            // 1. Verify token expiration
            if (isNaN(exp) || now > exp) {
                console.warn("CiteFlowAuth: Session token has expired.");
                return null;
            }

            // 2. Decrypt cipher stream
            const paddedBase64 = base64Cipher.padEnd(base64Cipher.length + (4 - base64Cipher.length % 4) % 4, '=');
            const cipherStr = atob(paddedBase64);
            const salt = `${INSTITUTIONAL_SALT}_${iat % 99991}`;
            let plainChars = [];

            for (let i = 0; i < cipherStr.length; i++) {
                const cipherCode = cipherStr.charCodeAt(i);
                const saltCode = salt.charCodeAt(i % salt.length);
                const plainCode = cipherCode ^ saltCode ^ ((i * 17) & 0xFF);
                plainChars.push(String.fromCharCode(plainCode));
            }

            const jsonStr = decodeURIComponent(escape(plainChars.join('')));
            const envelope = JSON.parse(jsonStr);

            // 3. Verify envelope structure and version
            if (!envelope || envelope.v !== 2 || !envelope.data || !envelope.sig) {
                console.warn("CiteFlowAuth: Invalid session token envelope.");
                return null;
            }

            // 4. Verify cryptographic signature (tampering detection)
            const serialized = JSON.stringify(envelope.data);
            const expectedSig = computeChecksum(`${serialized}:${envelope.iat}:${envelope.exp}`);
            if (envelope.sig !== expectedSig) {
                console.warn("CiteFlowAuth: Session tampering detected! Signature mismatch.");
                return null;
            }

            return envelope;
        } catch (e) {
            console.warn("CiteFlowAuth: Failed to decrypt session token:", e.message);
            return null;
        }
    }

    /**
     * Cache user metadata to localStorage with encrypted session token
     */
    function cacheUserInfo(user, role, profile = null) {
        if (!user || !user.id) return null;

        const userInfo = {
            id: user.id,
            email: user.email || profile?.email || '',
            name: profile?.name || profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
            role: role || user.user_metadata?.role || profile?.role || 'Faculty',
            profileCompleted: profile ? Boolean(profile.profile_completed) : Boolean(user.user_metadata?.profile_completed ?? true),
            mustChangePassword: profile ? Boolean(profile.must_change_password) : Boolean(user.user_metadata?.must_change_password ?? false),
            department: profile?.department || user.user_metadata?.department || 'BSIT',
            profilePhotoUrl: profile?.profile_photo_url || user.user_metadata?.profile_photo_url || null,
            cachedAt: new Date().toISOString()
        };

        try {
            const enc = encryptSessionPayload(userInfo);
            if (enc) {
                const storagePayload = {
                    ...userInfo,
                    __token: enc.token,
                    __exp: enc.envelope.exp,
                    __sig: enc.envelope.sig
                };
                localStorage.setItem(USER_CACHE_KEY, JSON.stringify(storagePayload));
            } else {
                localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userInfo));
            }
        } catch (e) {
            console.warn("CiteFlowAuth: Unable to cache user info to localStorage:", e);
        }
        return userInfo;
    }

    /**
     * Retrieve cached user info, validating encryption, timestamp expiration, and anti-tampering guards
     */
    function getCachedUser() {
        try {
            const raw = localStorage.getItem(USER_CACHE_KEY);
            if (!raw) return null;

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (_) {
                return null;
            }

            if (!parsed || typeof parsed !== 'object') return null;

            // 1. If encrypted token envelope is present, verify authenticity & timestamp
            if (parsed.__token) {
                const dec = decryptSessionPayload(parsed.__token);
                if (!dec) {
                    console.warn("CiteFlowAuth: Stored session is invalid or expired. Purging cache.");
                    clearUserCache();
                    return null;
                }

                // 2. Anti-tampering check: verify mirrored localStorage values match encrypted token payload
                const tokenData = dec.data;
                const isTampered =
                    String(parsed.id) !== String(tokenData.id) ||
                    String(parsed.role) !== String(tokenData.role) ||
                    Boolean(parsed.profileCompleted) !== Boolean(tokenData.profileCompleted) ||
                    Boolean(parsed.mustChangePassword) !== Boolean(tokenData.mustChangePassword);

                if (isTampered) {
                    console.warn("CiteFlowAuth: Critical security alert: Session cache tampering detected. Rejecting session.");
                    clearUserCache();
                    return null;
                }

                return tokenData;
            }

            // 2. Legacy fallback: auto-upgrade unencrypted session cache to encrypted token
            if (parsed.id) {
                const upgraded = cacheUserInfo(
                    { id: parsed.id, email: parsed.email, user_metadata: parsed },
                    parsed.role,
                    parsed
                );
                return upgraded || parsed;
            }

            return null;
        } catch (e) {
            console.warn("CiteFlowAuth: Error retrieving cached user:", e);
            return null;
        }
    }

    /**
     * Clears cached user info and session tokens from storage
     */
    function clearUserCache() {
        try {
            localStorage.removeItem(USER_CACHE_KEY);
        } catch (e) {
            // ignore
        }
    }

    /**
     * Verify if the active cached session token is non-expired and untampered
     */
    function isSessionValid() {
        return Boolean(getCachedUser());
    }

    /**
     * Guard against session tampering on first-time login / onboarding flow
     * Returns true if user session is valid and legitimately needs onboarding
     */
    async function verifyFirstTimeLoginSession() {
        const sb = getClient();
        if (!sb) return { valid: false, reason: 'auth_unavailable' };

        try {
            const { data: { session }, error } = await sb.auth.getSession();
            if (error || !session || !session.user) {
                clearUserCache();
                return { valid: false, reason: 'no_server_session' };
            }

            const cached = getCachedUser();
            if (cached && String(cached.id) !== String(session.user.id)) {
                console.warn("CiteFlowAuth: Cached user mismatch with server session. Resetting cache.");
                clearUserCache();
            }

            const { data: facultyRecord } = await sb
                .from('faculty')
                .select('id, auth_user_id, email, profile_completed, must_change_password, first_login_completed_at, role, position')
                .or(`auth_user_id.eq.${session.user.id},email.ilike.${session.user.email}`)
                .maybeSingle();

            const onboardingNeeded = needsOnboarding(facultyRecord, session.user);

            // Re-cache encrypted state to lock in validated values
            cacheUserInfo(session.user, facultyRecord?.role || 'Faculty', facultyRecord);

            return {
                valid: true,
                user: session.user,
                facultyRecord: facultyRecord,
                needsOnboarding: onboardingNeeded
            };
        } catch (e) {
            console.warn("CiteFlowAuth: Error verifying first-time session:", e);
            return { valid: false, reason: e.message };
        }
    }

    /**
     * Whether this faculty user must complete first-time onboarding (once only).
     * Faculty table is the primary source of truth; auth metadata is fallback.
     */
    function needsOnboarding(facultyProfile, user) {
        const meta = user?.user_metadata || {};

        // Onboarding is a one-time flow — once marked complete, never show again.
        if (facultyProfile?.first_login_completed_at) {
            return false;
        }
        if (facultyProfile?.profile_completed === true) {
            return false;
        }
        if (meta.onboarding_completed_at || meta.first_login_completed_at) {
            return false;
        }
        if (meta.profile_completed === true) {
            return false;
        }

        if (facultyProfile) {
            if (facultyProfile.must_change_password === true) {
                return true;
            }
            if (facultyProfile.profile_completed === false) {
                return true;
            }
            if (facultyProfile.auth_user_id && facultyProfile.profile_completed == null) {
                return true;
            }
        }

        if (meta.must_change_password === true) {
            return true;
        }
        if (meta.profile_completed === false) {
            return true;
        }

        return false;
    }

    function isOnboardingComplete(facultyProfile, user) {
        return !needsOnboarding(facultyProfile, user);
    }

    function isFacultyPortalRole(role, facultyProfile) {
        // A linked public.faculty row is enough for the faculty portal.
        if (facultyProfile && facultyProfile.id != null) return true;
        const r = String(role || facultyProfile?.role || facultyProfile?.position || '').toLowerCase();
        return !r
            || r === 'faculty'
            || r.includes('chair')
            || r === 'dean'
            || r.includes('secretary')
            || r === 'admin'
            || r === 'administrator';
    }

    function isAdminPortalRole(role, facultyProfile) {
        const r = String(role || '').toLowerCase();
        const profileRole = String(facultyProfile?.role || facultyProfile?.position || '').toLowerCase();
        if (r === 'admin' || r === 'administrator' || profileRole === 'admin' || profileRole === 'administrator') {
            return true;
        }
        if (profileRole === 'dean' || profileRole.includes('secretary')) {
            return true;
        }
        if (profileRole.includes('chair') && facultyProfile?.admin_access === true) {
            return true;
        }
        return false;
    }

    /**
     * Authenticate user with Email & Password and resolve the correct destination
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<{ user: object, role: string, destination: string }>}
     */
    async function login(email, password, options = {}) {
        const sb = getClient();
        if (!sb) throw new Error("Authentication service is unavailable. Please try again later.");

        const cleanEmail = email.trim();
        const { data: authData, error: authError } = await sb.auth.signInWithPassword({
            email: cleanEmail,
            password: password
        });

        if (authError) throw authError;

        let user = authData?.user;
        let session = authData?.session || null;
        if (!user) throw new Error("No user account returned from authentication.");

        // Confirm persisted session before any redirect.
        if (!session?.user) {
            const confirmed = await waitForSession({ timeoutMs: 5000 });
            session = confirmed;
            user = confirmed?.user || user;
        }
        if (!session?.user) {
            throw new Error("Login succeeded but the session could not be confirmed. Please try again.");
        }

        // Check user role in metadata
        let role = String(user.user_metadata?.role || '').trim().toLowerCase();

        // Prefer auth_user_id match; avoid maybeSingle crash on duplicate emails.
        let facultyProfile = null;
        const byAuth = await sb
            .from('faculty')
            .select('*')
            .eq('auth_user_id', user.id)
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (!byAuth.error && byAuth.data) {
            facultyProfile = byAuth.data;
        } else {
            const byEmail = await sb
                .from('faculty')
                .select('*')
                .or(`email.ilike.${cleanEmail},existing_email.ilike.${cleanEmail}`)
                .order('id', { ascending: true })
                .limit(5);
            if (byEmail.error && byEmail.error.code !== 'PGRST116') {
                console.warn("CiteFlowAuth: Warning fetching faculty profile:", byEmail.error.message);
            }
            const rows = byEmail.data || [];
            facultyProfile = rows.find((row) => String(row.auth_user_id || '') === String(user.id))
                || rows.find((row) => !row.auth_user_id)
                || rows[0]
                || null;
        }

        // Helper to resolve relative file paths for both Live Server & Express
        const isInsideSubfolder = window.location.pathname.toLowerCase().includes('/admin/') || window.location.pathname.toLowerCase().includes('/faculty/');
        const prefix = isInsideSubfolder ? '../' : '';

        // Determine effective role & destination
        let destination = `${prefix}admin/dashboard.html`;

        const portalRole = role || String(facultyProfile?.role || 'Faculty');

        if (isAdminPortalRole(role, facultyProfile) && isOnboardingComplete(facultyProfile, user)) {
            cacheUserInfo(user, 'Admin', facultyProfile);
            destination = `${prefix}admin/dashboard.html`;
            try {
                const meta = user.user_metadata || {};
                let firstName = meta.first_name || '';
                let lastName = meta.last_name || '';
                if (!firstName && !lastName) {
                    const rawName = meta.full_name || meta.name || user.email?.split('@')[0] || 'Administrator';
                    const parts = String(rawName).trim().split(/\s+/);
                    firstName = parts[0] || 'Administrator';
                    lastName = parts.slice(1).join(' ') || '';
                }
                // Self-heals an administrator whose row was never created at
                // registration. Without it wf_is_final_approver() stays false.
                const { error: adminProfileError } = await sb.from('admin_profiles').upsert({
                    id: user.id,
                    email: user.email,
                    first_name: firstName,
                    last_name: lastName,
                    role: 'Administrator',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
                if (adminProfileError) {
                    console.error(
                        'CiteFlowAuth: could not sync the admin_profiles record on login. Workflow writes '
                        + '(Grant Access, final approval) will be refused by RLS until it exists.',
                        adminProfileError
                    );
                }
            } catch (e) {
                console.error('CiteFlowAuth: admin_profiles sync failed on login:', e);
            }
        } else if (facultyProfile || isFacultyPortalRole(role, facultyProfile)) {
            const facultyRole = facultyProfile?.role || portalRole || 'Faculty';
            cacheUserInfo(user, facultyRole, facultyProfile);

            if (needsOnboarding(facultyProfile, user)) {
                destination = `${prefix}onboarding.html`;
            } else {
                destination = `${prefix}faculty/dashboard.html`;
            }
        } else {
            cacheUserInfo(user, portalRole || 'User', facultyProfile);
            destination = `${prefix}faculty/dashboard.html`;
        }

        destination = resolvePostLoginDestination(destination, options.next || null);

        return {
            user,
            session,
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

        // 3. Immediately insert newly registered administrator into public.admin_profiles table
        if (authData?.user?.id) {
            try {
                // This row is what wf_is_final_approver() reads, so losing it
                // silently leaves an administrator unable to grant workflow
                // access or approve anything. Report the failure loudly.
                const { error: adminProfileError } = await sb.from('admin_profiles').upsert({
                    id: authData.user.id,
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: cleanEmail,
                    role: 'Administrator',
                    department: 'CITE Administration',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
                if (adminProfileError) {
                    console.error(
                        'CiteFlowAuth: could not create the admin_profiles record. This account will not be '
                        + 'recognised as an administrator until it exists (see admin/018_fix_admin_final_approver.sql).',
                        adminProfileError
                    );
                }
            } catch (e) {
                console.error("CiteFlowAuth: failed creating admin_profiles record during registration:", e);
            }
        }

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

        // Refresh session so updated metadata is available on the next page load
        await sb.auth.refreshSession();

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
            first_login_completed_at: nowIso,
            updated_at: nowIso
        };

        if (photoUrl) {
            profilePayload.profile_photo_url = photoUrl;
        }

        const { error: profileError } = await sb
            .from('faculty')
            .upsert(profilePayload, { onConflict: 'auth_user_id' });

        if (profileError) {
            console.warn("CiteFlowAuth: Upsert failed (likely no UNIQUE on auth_user_id):", profileError.message, "— trying update fallback.");
            // Fallback 1: Update by auth_user_id
            const { error: updateErr1 } = await sb
                .from('faculty')
                .update(profilePayload)
                .eq('auth_user_id', user.id);

            if (updateErr1) {
                console.warn("CiteFlowAuth: Update by auth_user_id failed:", updateErr1.message, "— trying by email.");
                // Fallback 2: Update by email
                const { error: updateErr2 } = await sb
                    .from('faculty')
                    .update(profilePayload)
                    .eq('email', user.email);

                if (updateErr2) {
                    console.error("CiteFlowAuth: All faculty profile update methods failed:", updateErr2.message);
                    throw new Error("Profile record save failed: " + updateErr2.message);
                }
            }
        }

        // 4. Also update public.profiles for messenger name resolution
        try {
            await sb.from('profiles').upsert({
                id: user.id,
                email: user.email,
                first_name: fn,
                last_name: ln,
                role: 'Faculty'
            }, { onConflict: 'id' });
        } catch (_) {
            // Non-critical — profiles is a secondary source
        }

        // Cache updated info so login routing uses completed state immediately
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
     * Wait until Supabase has restored (or confirmed absence of) a session.
     * Distinguishes AUTH_INITIALIZING from AUTH_UNAUTHENTICATED.
     */
    async function waitForSession(options = {}) {
        const sb = getClient();
        if (!sb) return null;
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;

        try {
            const first = await sb.auth.getSession();
            if (first?.data?.session?.user) {
                return first.data.session;
            }
        } catch (_) {}

        return new Promise((resolve) => {
            let settled = false;
            let subscription = null;

            const finish = (session) => {
                if (settled) return;
                settled = true;
                try { subscription?.unsubscribe?.(); } catch (_) {}
                resolve(session || null);
            };

            try {
                const result = sb.auth.onAuthStateChange((event, session) => {
                    if (session?.user) {
                        finish(session);
                        return;
                    }
                    // After storage restore completes with no user, treat as unauthenticated.
                    if (event === 'INITIAL_SESSION') {
                        finish(null);
                    }
                });
                subscription = result?.data?.subscription || null;
            } catch (_) {
                finish(null);
                return;
            }

            // Safety bound only — primary signal is INITIAL_SESSION / getSession.
            setTimeout(async () => {
                try {
                    const again = await sb.auth.getSession();
                    finish(again?.data?.session || null);
                } catch (_) {
                    finish(null);
                }
            }, timeoutMs);
        });
    }

    /**
     * Token refresh is shared across the whole page.
     *
     * Several modules independently decide the token looks stale — the auth
     * guard, workflow, the sidebar's chairperson check, and each feature page.
     * Supabase rotates the refresh token on every use, so two concurrent
     * refreshes make the second one present an already-consumed token, and a
     * burst of those trips the endpoint rate limit and returns 429 to
     * everything on the page.
     *
     * So: concurrent callers share one in-flight refresh, and a 429 starts a
     * cooldown during which we keep using the session we already hold rather
     * than hammering the endpoint.
     */
    const REFRESH_COOLDOWN_MS = 60000;
    let refreshInFlight = null;
    let refreshBlockedUntil = 0;

    function isRateLimited(error) {
        const status = Number(error?.status || error?.statusCode || 0);
        const message = String(error?.message || '').toLowerCase();
        return status === 429
            || message.includes('rate limit')
            || message.includes('too many requests');
    }

    async function currentStoredSession(client) {
        try {
            const { data } = await client.auth.getSession();
            return data?.session || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Refresh the session at most once at a time. Returns the best session
     * available, which may be the existing one when a refresh is not possible.
     */
    async function refreshSessionShared(sb) {
        const client = sb || getClient();
        if (!client?.auth?.refreshSession) return null;

        if (Date.now() < refreshBlockedUntil) {
            return currentStoredSession(client);
        }
        if (refreshInFlight) return refreshInFlight;

        refreshInFlight = (async () => {
            try {
                const { data, error } = await client.auth.refreshSession();
                if (error) {
                    if (isRateLimited(error)) {
                        refreshBlockedUntil = Date.now() + REFRESH_COOLDOWN_MS;
                        console.warn('CiteFlowAuth: token refresh is rate limited. Continuing with the session already held.');
                        return currentStoredSession(client);
                    }
                    console.warn('CiteFlowAuth: token refresh failed.', error);
                    return null;
                }
                return data?.session || null;
            } catch (error) {
                if (isRateLimited(error)) {
                    refreshBlockedUntil = Date.now() + REFRESH_COOLDOWN_MS;
                }
                console.warn('CiteFlowAuth: token refresh threw.', error);
                return currentStoredSession(client);
            } finally {
                refreshInFlight = null;
            }
        })();

        return refreshInFlight;
    }

    async function getFreshSession(sb) {
        const client = sb || getClient();
        if (!client) return null;
        const waited = await waitForSession({ timeoutMs: 8000 });
        if (!waited?.user) return null;

        // getSession() already renews an expiring token when autoRefreshToken
        // is on, so only force a refresh once the token is actually at its end.
        const expiresAt = Number(waited.expires_at || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (!expiresAt || expiresAt > nowSec + 15) return waited;

        const refreshed = await refreshSessionShared(client);
        if (refreshed?.user) return refreshed;

        // Keep the session we hold rather than reporting a signed-out user: the
        // access token may still be accepted, and a real 401 from a query is
        // already handled by the callers.
        return waited.user ? waited : null;
    }

    function isSafeInternalNext(nextPath) {
        if (!nextPath || typeof nextPath !== 'string') return false;
        const value = nextPath.trim();
        if (!value.startsWith('/') && !value.startsWith('./') && !/^[a-z0-9_./?#&=%-]+$/i.test(value)) {
            return false;
        }
        if (value.includes('://') || value.startsWith('//') || value.toLowerCase().includes('javascript:')) {
            return false;
        }
        if (/login\.html|register\.html|forgot\.html/i.test(value)) return false;
        return true;
    }

    function resolvePostLoginDestination(defaultDestination, nextPath) {
        if (isSafeInternalNext(nextPath)) return nextPath;
        return defaultDestination;
    }

    /**
     * Get current session and user safely
     */
    async function getSession() {
        return waitForSession({ timeoutMs: 8000 });
    }

    return {
        login,
        register,
        registerAdmin,
        completeOnboarding,
        logout,
        getSession,
        waitForSession,
        getFreshSession,
        refreshSessionShared,
        ensureSharedClient,
        resolvePostLoginDestination,
        isSafeInternalNext,
        cacheUserInfo,
        getCachedUser,
        getUser: getCachedUser,
        clearUserCache,
        isSessionValid,
        verifyFirstTimeLoginSession,
        encryptSessionPayload,
        decryptSessionPayload,
        getClient,
        needsOnboarding,
        isOnboardingComplete,
        isFacultyPortalRole,
        isAdminPortalRole,
        AUTH_CLIENT_OPTIONS
    };
})();