// ==============================================================================
// CITE-Flow Centralized Storage Cipher & Supabase Configuration
// ==============================================================================

(function initCiteFlowStorageCipher() {
    if (window.__CITEFLOW_STORAGE_CIPHER_INITIALIZED__) return;
    window.__CITEFLOW_STORAGE_CIPHER_INITIALIZED__ = true;

    const PREFIX = 'cf_enc_v2::';
    const INSTITUTIONAL_KEY = 'CTU_CITEFLOW_STORAGE_CIPHER_PROT_KEY_2026_@#!';

    function isSupabaseAuthKey(key) {
        const lower = String(key || '').toLowerCase();
        return lower.startsWith('sb-') || lower.includes('auth-token');
    }

    function shouldEncryptKey(key) {
        if (!key || typeof key !== 'string') return false;
        // Supabase must read its own session JSON. Encrypting sb-* keys made
        // getSession() return nothing, so Postgres saw auth.uid() as null.
        if (isSupabaseAuthKey(key)) return false;
        const lower = key.toLowerCase();
        return (
            lower.startsWith('citeflow_') ||
            lower.startsWith('cf_') ||
            lower.includes('convo_')
        );
    }

    function encryptValue(str) {
        if (typeof str !== 'string') str = String(str);
        if (!str || str.startsWith(PREFIX)) return str;

        try {
            const utf8Bytes = new TextEncoder().encode(str);
            const saltBytes = new TextEncoder().encode(INSTITUTIONAL_KEY);
            const iv = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
            const ivBytes = new TextEncoder().encode(iv);

            const out = new Uint8Array(utf8Bytes.length);
            for (let i = 0; i < utf8Bytes.length; i++) {
                const sByte = saltBytes[(i + (i % 7)) % saltBytes.length];
                const ivByte = ivBytes[i % ivBytes.length];
                const k = (sByte ^ ivByte ^ ((i * 31 + 17) & 0xFF)) & 0xFF;
                out[i] = utf8Bytes[i] ^ k;
            }

            let binary = '';
            const chunk = 8192;
            for (let i = 0; i < out.length; i += chunk) {
                const slice = out.subarray(i, i + chunk);
                binary += String.fromCharCode.apply(null, slice);
            }
            const b64 = btoa(binary);

            return `${PREFIX}${iv}::${b64}`;
        } catch (err) {
            console.warn('StorageCipher: Encryption warning:', err);
            return str;
        }
    }

    function decryptValue(str) {
        if (typeof str !== 'string' || !str.startsWith(PREFIX)) {
            return str;
        }

        try {
            const parts = str.split('::');
            if (parts.length < 3) return str;

            const iv = parts[1];
            const b64 = parts[2];

            const binary = atob(b64);
            const cipherBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                cipherBytes[i] = binary.charCodeAt(i);
            }

            const saltBytes = new TextEncoder().encode(INSTITUTIONAL_KEY);
            const ivBytes = new TextEncoder().encode(iv);

            const out = new Uint8Array(cipherBytes.length);
            for (let i = 0; i < cipherBytes.length; i++) {
                const sByte = saltBytes[(i + (i % 7)) % saltBytes.length];
                const ivByte = ivBytes[i % ivBytes.length];
                const k = (sByte ^ ivByte ^ ((i * 31 + 17) & 0xFF)) & 0xFF;
                out[i] = cipherBytes[i] ^ k;
            }

            return new TextDecoder().decode(out);
        } catch (err) {
            console.warn('StorageCipher: Decryption warning, returning raw:', err);
            return str;
        }
    }

    const nativeSetItem = Storage.prototype.setItem;
    const nativeGetItem = Storage.prototype.getItem;
    const nativeRemoveItem = Storage.prototype.removeItem;

    // GoTrue deletes the session with storage.removeItem(), including paths that
    // never call _removeSession(). Only an explicit Sign Out may do that.
    Storage.prototype.removeItem = function (key) {
        if (isSupabaseAuthKey(key) && !window.__citeflowAllowAuthStorageDelete) {
            console.warn('[AUTH TRACE] blocked auth storage delete', {
                key,
                path: window.location.pathname
            });
            return;
        }
        return nativeRemoveItem.call(this, key);
    };

    Storage.prototype.setItem = function (key, value) {
        if (shouldEncryptKey(key) && value !== null && value !== undefined) {
            const encrypted = encryptValue(typeof value === 'string' ? value : String(value));
            return nativeSetItem.call(this, key, encrypted);
        }
        return nativeSetItem.call(this, key, value);
    };

    Storage.prototype.getItem = function (key) {
        const raw = nativeGetItem.call(this, key);
        if (raw === null || raw === undefined) return raw;
        if (typeof raw === 'string' && raw.startsWith(PREFIX)) {
            return decryptValue(raw);
        }
        return raw;
    };

    function migrateStorage(storage) {
        if (!storage) return;
        try {
            const len = storage.length;
            const keysToMigrate = [];
            for (let i = 0; i < len; i++) {
                const k = storage.key(i);
                if (shouldEncryptKey(k)) {
                    keysToMigrate.push(k);
                }
            }
            keysToMigrate.forEach(k => {
                const raw = nativeGetItem.call(storage, k);
                if (raw && typeof raw === 'string' && !raw.startsWith(PREFIX)) {
                    nativeSetItem.call(storage, k, encryptValue(raw));
                }
            });
        } catch (_) {}
    }

    migrateStorage(window.localStorage);
    migrateStorage(window.sessionStorage);

    window.CiteFlowStorageCipher = {
        encrypt: encryptValue,
        decrypt: decryptValue,
        migrate: function () {
            migrateStorage(window.localStorage);
            migrateStorage(window.sessionStorage);
        }
    };
})();

(function installCiteFlowSharedClient() {
    if (window.__citeflowCreateClientPatched || !window.supabase || typeof window.supabase.createClient !== 'function') return;
    const originalCreate = window.supabase.createClient.bind(window.supabase);

    const REFRESH_LOCK_KEY = 'citeflow_auth_refresh_lock';
    const REFRESH_LOCK_TTL_MS = 8000;
    const pageRefreshOwner = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    function readRefreshLock() {
        try {
            const parsed = JSON.parse(localStorage.getItem(REFRESH_LOCK_KEY) || 'null');
            if (!parsed || typeof parsed.until !== 'number' || parsed.until < Date.now()) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function writeRefreshLock(owner) {
        try {
            localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({
                owner,
                until: Date.now() + REFRESH_LOCK_TTL_MS
            }));
        } catch (_) {}
    }

    function clearRefreshLock(owner) {
        try {
            const current = readRefreshLock();
            if (!current || current.owner === owner) localStorage.removeItem(REFRESH_LOCK_KEY);
        } catch (_) {}
    }

    function readStoredAuthSession() {
        try {
            const key = Object.keys(localStorage).find((name) => name.startsWith('sb-') && name.endsWith('-auth-token'));
            if (!key) return null;
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            const session = parsed?.currentSession?.access_token ? parsed.currentSession : parsed;
            if (!session?.access_token || !session?.refresh_token) return null;
            return session;
        } catch (_) {
            return null;
        }
    }

    function accessTokenStillValid(session) {
        let exp = Number(session?.expires_at || 0);
        if (!exp && session?.access_token) {
            try {
                const part = session.access_token.split('.')[1];
                const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
                exp = Number(payload?.exp || 0);
            } catch (_) {}
        }
        if (!exp) return Boolean(session?.access_token && session?.user);
        return exp * 1000 > Date.now();
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // One refresh at a time across Faculty page loads. A second page must not
    // rotate the same refresh token while the previous page is still saving it.
    async function coordinateRefresh(refreshToken, originalCall) {
        const other = readRefreshLock();
        if (other && other.owner !== pageRefreshOwner) {
            const deadline = Math.min(other.until + 200, Date.now() + REFRESH_LOCK_TTL_MS);
            while (Date.now() < deadline) {
                const session = readStoredAuthSession();
                if (session?.user && session.refresh_token && session.refresh_token !== refreshToken) {
                    return { session, error: null };
                }
                if (!readRefreshLock()) break;
                await wait(200);
            }
            const settled = readStoredAuthSession();
            if (settled?.user && accessTokenStillValid(settled)) {
                return { session: settled, error: null };
            }
        }

        writeRefreshLock(pageRefreshOwner);
        try {
            return await originalCall(refreshToken);
        } finally {
            clearRefreshLock(pageRefreshOwner);
        }
    }

    function sessionFromRefreshResult(result) {
        if (result?.session?.access_token) return result.session;
        if (result?.data?.session?.access_token) return result.data.session;
        if (result?.data?.access_token && result?.data?.user) return result.data;
        return null;
    }

    function patchSharedAuth(client) {
        if (!client?.auth || client.__citeflowAuthPatched) return;
        client.__citeflowAuthPatched = true;
        const originalRefresh = client.auth.refreshSession.bind(client.auth);
        const originalGetUser = client.auth.getUser.bind(client.auth);
        const originalSignOut = client.auth.signOut.bind(client.auth);
        const originalRemoveSession = typeof client.auth._removeSession === 'function'
            ? client.auth._removeSession.bind(client.auth)
            : null;
        const originalCallRefresh = typeof client.auth._callRefreshToken === 'function'
            ? client.auth._callRefreshToken.bind(client.auth)
            : null;

        // GoTrue treats invalid_grant / AuthSessionMissingError as "signed out"
        // and deletes the sb-* token. A second page refreshing the same token
        // during navigation produces that error while the access token is still
        // good. Only an explicit signOut may clear it.
        if (originalRemoveSession) {
            client.auth._removeSession = function () {
                if (client.__citeflowExplicitSignOut || window.__citeflowAllowAuthStorageDelete) {
                    return originalRemoveSession();
                }
                const stored = readStoredAuthSession();
                console.warn('[AUTH TRACE] blocked automatic session removal', {
                    path: window.location.pathname,
                    userId: stored?.user?.id || null,
                    expiresAt: stored?.expires_at || null
                });
                return Promise.resolve();
            };
        }
        client.auth.signOut = function (options) {
            console.warn('[AUTH TRACE] signOut called', { path: window.location.pathname });
            client.__citeflowExplicitSignOut = true;
            window.__citeflowAllowAuthStorageDelete = true;
            return Promise.resolve(originalSignOut(options)).finally(() => {
                client.__citeflowExplicitSignOut = false;
                window.__citeflowAllowAuthStorageDelete = false;
            });
        };
        client.auth.refreshSession = function (currentSession) {
            if (window.__citeflowRefreshInFlight) return window.__citeflowRefreshInFlight;
            window.__citeflowRefreshInFlight = Promise.resolve()
                .then(() => originalRefresh(currentSession))
                .finally(() => { window.__citeflowRefreshInFlight = null; });
            return window.__citeflowRefreshInFlight;
        };
        if (originalCallRefresh) {
            // __loadSession and _refreshSession read `{ data, error }`, where
            // `data` is the session itself. Returning `{ session }` made
            // getSession() come back empty and the auth guard send the user
            // to login. A still-valid access token must not be refreshed just
            // because this page loaded.
            client.auth._callRefreshToken = function (refreshToken) {
                const storedNow = readStoredAuthSession();
                if (storedNow && accessTokenStillValid(storedNow)) {
                    if (!window.__citeflowLoggedRefreshSkip) {
                        window.__citeflowLoggedRefreshSkip = true;
                        console.info('[AUTH TRACE] refresh skipped', {
                            path: window.location.pathname,
                            userId: storedNow.user?.id || null,
                            reason: 'access token still valid'
                        });
                    }
                    return Promise.resolve({ data: storedNow, error: null });
                }
                if (window.__citeflowCallRefreshInFlight) return window.__citeflowCallRefreshInFlight;
                console.info('[AUTH TRACE] refresh started', { path: window.location.pathname });
                window.__citeflowCallRefreshInFlight = coordinateRefresh(refreshToken, originalCallRefresh)
                    .then((result) => {
                        const session = sessionFromRefreshResult(result);
                        const error = result?.error || null;
                        console.info('[AUTH TRACE] refresh finished', {
                            path: window.location.pathname,
                            ok: Boolean(!error && session?.access_token),
                            userId: session?.user?.id || null
                        });
                        if (!error && session?.access_token) return { data: session, error: null };
                        const latest = readStoredAuthSession();
                        if (latest && accessTokenStillValid(latest)) {
                            window.__citeflowRefreshCooldownUntil = Date.now() + 20000;
                            console.warn('[AUTH TRACE] refresh failed; keeping the unexpired access token', error);
                            return { data: latest, error: null };
                        }
                        return { data: session || null, error };
                    })
                    .finally(() => { window.__citeflowCallRefreshInFlight = null; });
                return window.__citeflowCallRefreshInFlight;
            };
        }
        if (!client.__citeflowAuthEventLogged && typeof client.auth.onAuthStateChange === 'function') {
            client.__citeflowAuthEventLogged = true;
            client.auth.onAuthStateChange((event, session) => {
                console.info('[AUTH TRACE] auth event', event, {
                    path: window.location.pathname,
                    userId: session?.user?.id || null
                });
            });
        }
        client.auth.getUser = async function (jwt) {
            if (!jwt) {
                try {
                    const read = client._citeFlowOriginalGetSession || client.auth.getSession.bind(client.auth);
                    const { data } = await read();
                    if (data?.session?.user) return { data: { user: data.session.user }, error: null };
                } catch (_) {}
                return { data: { user: null }, error: null };
            }
            try {
                return await originalGetUser(jwt);
            } catch (error) {
                return { data: { user: null }, error };
            }
        };
    }

    window.supabase.createClient = function (url, key, options) {
        const persist = options?.auth?.persistSession !== false;
        if (persist && window.supabaseClient) return window.supabaseClient;
        const client = originalCreate(url, key, options);
        if (persist) {
            window.supabaseClient = client;
            patchSharedAuth(client);
        }
        return client;
    };
    window.__citeflowCreateClientPatched = true;
    if (window.supabaseClient) patchSharedAuth(window.supabaseClient);
})();

(function () {
    const SUPABASE_URL = 'https://uforealazougjckepggc.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

    window.__SUPABASE_URL__ = SUPABASE_URL;
    window.__SUPABASE_ANON__ = SUPABASE_ANON_KEY;

    if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
        if (!window.supabaseClient) {
            const options = (window.CiteFlowAuth && window.CiteFlowAuth.AUTH_CLIENT_OPTIONS) || {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                },
                storage: {
                    useNewHostname: true
                }
            };
            window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
        }
        console.info('[AUTH TRACE] SHARED CLIENT', {
            hasClient: !!window.supabaseClient,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        });
    }
})();
