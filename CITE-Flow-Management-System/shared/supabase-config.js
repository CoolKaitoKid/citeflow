// CITE-Flow Centralized Supabase Configuration & Client Provider
(function () {
    const SUPABASE_URL = 'https://uforealazougjckepggc.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

    window.__SUPABASE_URL__ = SUPABASE_URL;
    window.__SUPABASE_ANON__ = SUPABASE_ANON_KEY;

    if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
        if (!window.supabaseClient) {
            window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
        }
    }
})();
