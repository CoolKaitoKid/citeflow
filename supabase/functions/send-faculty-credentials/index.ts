// Supabase Edge Function: send-faculty-credentials
//
// Sends the generated Faculty ID + temporary password to the faculty member's
// private email, and sends a separate notification to the admin confirming
// that delivery happened. Uses Resend (resend.com) for actual email sending —
// swap the RESEND_API_URL/fetch call below for SendGrid/SMTP/etc if you prefer
// a different provider.
//
// Deploy with:
//   supabase functions deploy send-faculty-credentials
//
// Before deploying, set your Resend API key as a secret:
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//
// You also need a verified sending domain/address in Resend. Set it below or
// as another secret (RESEND_FROM_EMAIL).

// No external imports needed — Deno.serve() is built into the Supabase Edge
// Runtime. Avoiding a remote import here removes a network fetch from the
// cold-start path, which can otherwise cause intermittent boot failures.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "CITE-Flow <onboarding@resend.dev>";

interface RequestBody {
  to: string;               // faculty's private email
  adminNotifyEmail: string; // admin's email
  facultyId: string;
  password: string;
  fullName: string;
  loginEmail: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errText}`);
  }

  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY secret is not set. Run: supabase secrets set RESEND_API_KEY=your_key");
    }

    const body: RequestBody = await req.json();
    const { to, adminNotifyEmail, facultyId, password, fullName, loginEmail } = body;

    if (!to || !facultyId || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, facultyId, password" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Email the faculty member with their credentials
    await sendEmail(
      to,
      "Your CITE-Flow Faculty Account Credentials",
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#621708;">Welcome to CITE-Flow, ${fullName}</h2>
          <p>An administrator has created a faculty account for you. Here are your login details:</p>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
              <td style="padding:8px; background:#f5f5f5; font-weight:bold;">Faculty ID</td>
              <td style="padding:8px; background:#f5f5f5;">${facultyId}</td>
            </tr>
            <tr>
              <td style="padding:8px; font-weight:bold;">Login Email</td>
              <td style="padding:8px;">${loginEmail}</td>
            </tr>
            <tr>
              <td style="padding:8px; background:#f5f5f5; font-weight:bold;">Temporary Password</td>
              <td style="padding:8px; background:#f5f5f5;">${password}</td>
            </tr>
          </table>
          <p style="color:#b91c1c;"><strong>You will be required to change this password when you first log in.</strong></p>
          <p style="font-size:12px; color:#777;">If you did not expect this email, please contact your department administrator immediately.</p>
        </div>
      `
    );

    // 2. Notify the admin that the credentials were sent
    if (adminNotifyEmail) {
      await sendEmail(
        adminNotifyEmail,
        "Faculty Credentials Sent Successfully",
        `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h3 style="color:#621708;">Credential Delivery Confirmation</h3>
            <p>The login credentials for <strong>${fullName}</strong> (Faculty ID: ${facultyId}) were sent to their private email:</p>
            <p style="padding:8px; background:#f5f5f5;">${to}</p>
            <p style="font-size:12px; color:#777;">This is an automated notification from CITE-Flow.</p>
          </div>
        `
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-faculty-credentials error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});