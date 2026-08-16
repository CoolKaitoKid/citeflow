const supabaseUrl =
    'https://uforealazougjckepggc.supabase.co';

const supabasePublishableKey =
    'sb_publishable_zsr5gF2_SeiOE6FHcj-p1A_XbieZ3GO';

const {
    createClient
} = supabase;

const supabaseClient =
    createClient(
        supabaseUrl,
        supabasePublishableKey
    );