// Custom 8-digit Forgot Password OTP.
// Validates a registered Auth account, emails a hashed OTP via EmailJS
// (Resend fallback), then updates the password with the service role.
// Does not use signInWithOtp and does not create accounts.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "CITE-Flow <onboarding@resend.dev>";
const OTP_HASH_SUFFIX = "citeflow-otp-v1";
const EMAILJS_SERVICE_ID = Deno.env.get("EMAILJS_SERVICE_ID") || "service_kmzgyii";
const EMAILJS_TEMPLATE_ID = Deno.env.get("EMAILJS_TEMPLATE_ID") || "template_lzzwr4e";
const EMAILJS_PUBLIC_KEY = Deno.env.get("EMAILJS_PUBLIC_KEY") || "VDfsAHXPAWgLCmHnk";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const IP_SEND_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ipHits = new Map<string, number[]>();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
}

function allowIp(ip: string, now = Date.now()) {
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_SEND_LIMIT) return false;
  recent.push(now);
  ipHits.set(ip, recent);
  return true;
}

function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashSecret(value: string, email: string) {
  return sha256Hex(`${value}:${email}:${OTP_HASH_SUFFIX}`);
}

function generateOtp() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(10000000 + (num % 90000000));
}

function generateResetToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function quotedEq(value: string) {
  return `eq."${String(value).replace(/"/g, "")}"`;
}

async function restSelect(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: restHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status})`);
  }
  return response.json();
}

async function safeSelect(path: string) {
  try {
    return await restSelect(path);
  } catch {
    return [];
  }
}

async function restInsert(table: string, row: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    throw new Error(`Unable to store verification request (${response.status})`);
  }
  return response.json();
}

async function restPatch(path: string, row: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    throw new Error(`Unable to update verification request (${response.status})`);
  }
  return response.json();
}

async function getAuthUserByEmail(email: string) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: restHeaders() },
  );
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload?.users?.length) return payload.users[0];
  if (payload?.id && payload?.email) return payload;
  return null;
}

async function getAuthUserById(id: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    headers: restHeaders(),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.id ? payload : payload?.user || null;
}

async function findRegisteredAuthUser(email: string) {
  const direct = await getAuthUserByEmail(email);
  if (direct?.id) return direct;

  const facultyRows = await safeSelect(
    `faculty?select=auth_user_id,email,existing_email&or=(email.${quotedEq(email)},existing_email.${quotedEq(email)})&limit=5`,
  );
  for (const row of facultyRows || []) {
    if (row?.auth_user_id) {
      const user = await getAuthUserById(row.auth_user_id);
      if (user?.id) return user;
    }
  }

  const adminRows = await safeSelect(
    `admin_profiles?select=id,email&email=${quotedEq(email)}&limit=5`,
  );
  for (const row of adminRows || []) {
    if (row?.id) {
      const user = await getAuthUserById(row.id);
      if (user?.id) return user;
    }
  }

  const profileRows = await safeSelect(
    `profiles?select=id,email&email=${quotedEq(email)}&limit=5`,
  );
  for (const row of profileRows || []) {
    if (row?.id) {
      const user = await getAuthUserById(row.id);
      if (user?.id) return user;
    }
  }

  return null;
}

async function sendViaResend(to: string, otp: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject: "Your CITE-Flow Password Reset Code",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111;">
          <h2 style="color:#621708;">Your CITE-Flow Password Reset Code</h2>
          <p>Your verification code is:</p>
          <p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0;">${otp}</p>
          <p>This code will expire in 10 minutes.</p>
          <p style="font-size:12px;color:#777;">If you did not request a password reset, you can ignore this email.</p>
        </div>
      `,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errText}`);
  }
}

async function sendViaEmailJs(to: string, otp: string, origin: string) {
  // EmailJS rejects non-browser calls unless an allowed page Origin is sent.
  // Faculty credential emails work from the browser for this reason.
  const pageOrigin = origin && origin !== "null" ? origin : "http://localhost:3000";
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: pageOrigin,
      Referer: `${pageOrigin.replace(/\/$/, "")}/forgot.html`,
    },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        name: "CITE-Flow User",
        email: to,
        to_email: to,
        otp,
        verification_code: otp,
        message: `Your CITE-Flow password reset code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        temporary_password: otp,
        role: "Password reset code — expires in 10 minutes",
        department: "CITE-Flow",
      },
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`EmailJS error (${response.status}): ${errText}`);
  }
}

async function sendOtpEmail(to: string, otp: string, origin: string) {
  try {
    await sendViaEmailJs(to, otp, origin);
    return;
  } catch (emailJsError) {
    console.error("EmailJS send failed:", (emailJsError as Error).message);
    if (RESEND_API_KEY) {
      await sendViaResend(to, otp);
      return;
    }
    throw emailJsError;
  }
}

async function updateAuthPassword(userId: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: restHeaders(),
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Unable to update password (${response.status}): ${errText}`);
  }
}

async function handleSend(email: string, req: Request) {
  if (!allowIp(clientIp(req))) {
    return json({ error: "rate_limited", message: "Please wait a moment before requesting another code." }, 429);
  }

  const user = await findRegisteredAuthUser(email);
  if (!user?.id) {
    return json({ error: "not_registered", message: "No registered CITE-Flow account was found for this email." }, 404);
  }

  const recent = await restSelect(
    `password_reset_otps?email=${quotedEq(email)}&order=created_at.desc&limit=${MAX_SENDS_PER_HOUR}`,
  );
  const now = Date.now();
  const newest = recent?.[0];
  if (newest?.created_at && now - new Date(newest.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return json({ error: "rate_limited", message: "Please wait a moment before requesting another code." }, 429);
  }
  const hourCount = (recent || []).filter((row: { created_at: string }) => (
    now - new Date(row.created_at).getTime() < 60 * 60 * 1000
  )).length;
  if (hourCount >= MAX_SENDS_PER_HOUR) {
    return json({ error: "rate_limited", message: "Too many reset requests. Try again later." }, 429);
  }

  await restPatch(
    `password_reset_otps?email=${quotedEq(email)}&consumed_at=is.null`,
    { consumed_at: new Date().toISOString() },
  );

  const otp = generateOtp();
  await restInsert("password_reset_otps", {
    email,
    auth_user_id: user.id,
    otp_hash: await hashSecret(otp, email),
    expires_at: new Date(now + OTP_TTL_MS).toISOString(),
    attempts: 0,
    max_attempts: MAX_ATTEMPTS,
  });

  await sendOtpEmail(email, otp, req.headers.get("origin") || "");
  return json({ ok: true });
}

async function loadActiveOtp(email: string) {
  const rows = await restSelect(
    `password_reset_otps?email=${quotedEq(email)}&consumed_at=is.null&order=created_at.desc&limit=1`,
  );
  return rows?.[0] || null;
}

async function handleVerify(email: string, otp: string) {
  if (!/^\d{8}$/.test(otp)) {
    return json({ error: "invalid_otp", message: "Invalid verification code." }, 400);
  }

  const row = await loadActiveOtp(email);
  if (!row) {
    return json({ error: "invalid_otp", message: "Invalid verification code." }, 400);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await restPatch(`password_reset_otps?id=eq.${row.id}`, { consumed_at: new Date().toISOString() });
    return json({ error: "expired_otp", message: "This verification code has expired. Please request a new one." }, 400);
  }
  if (Number(row.attempts || 0) >= Number(row.max_attempts || MAX_ATTEMPTS)) {
    await restPatch(`password_reset_otps?id=eq.${row.id}`, { consumed_at: new Date().toISOString() });
    return json({ error: "too_many_attempts", message: "Too many incorrect attempts. Please request a new code." }, 400);
  }

  const expected = await hashSecret(otp, email);
  if (expected !== row.otp_hash) {
    const attempts = Number(row.attempts || 0) + 1;
    await restPatch(`password_reset_otps?id=eq.${row.id}`, { attempts });
    if (attempts >= Number(row.max_attempts || MAX_ATTEMPTS)) {
      await restPatch(`password_reset_otps?id=eq.${row.id}`, { consumed_at: new Date().toISOString() });
      return json({ error: "too_many_attempts", message: "Too many incorrect attempts. Please request a new code." }, 400);
    }
    return json({ error: "invalid_otp", message: "Invalid verification code." }, 400);
  }

  const resetToken = generateResetToken();
  await restPatch(`password_reset_otps?id=eq.${row.id}`, {
    reset_token_hash: await hashSecret(resetToken, email),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  return json({ ok: true, resetToken });
}

async function handleReset(email: string, resetToken: string, password: string) {
  if (!resetToken || String(password || "").length < 8) {
    return json({ error: "invalid_reset", message: "Password reset failed. Please try again." }, 400);
  }

  const row = await loadActiveOtp(email);
  if (!row?.reset_token_hash) {
    return json({ error: "invalid_reset", message: "Please verify the 8-digit code before resetting your password." }, 400);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await restPatch(`password_reset_otps?id=eq.${row.id}`, { consumed_at: new Date().toISOString() });
    return json({ error: "expired_otp", message: "This verification code has expired. Please request a new one." }, 400);
  }

  const expected = await hashSecret(resetToken, email);
  if (expected !== row.reset_token_hash) {
    return json({ error: "invalid_reset", message: "Password reset failed. Please request a new code." }, 400);
  }

  await updateAuthPassword(row.auth_user_id, password);
  await restPatch(`password_reset_otps?id=eq.${row.id}`, { consumed_at: new Date().toISOString() });
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      throw new Error("Server configuration is incomplete.");
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const email = normalizeEmail(body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "invalid_email", message: "Please enter a valid email address." }, 400);
    }

    if (action === "send") return await handleSend(email, req);
    if (action === "verify") return await handleVerify(email, String(body?.otp || "").trim());
    if (action === "reset") return await handleReset(email, String(body?.resetToken || ""), String(body?.password || ""));

    return json({ error: "invalid_action", message: "Unsupported request." }, 400);
  } catch (error) {
    console.error("forgot-password-otp error:", (error as Error).message);
    return json({ error: "server_error", message: "Failed to process password reset. Please try again." }, 500);
  }
});
