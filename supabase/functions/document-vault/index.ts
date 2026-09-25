const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "documents";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function withCors(status: number, body: BodyInit | null, extra?: Record<string, string>) {
  const headers = new Headers(corsHeaders);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return new Response(body, { status, headers });
}

function json(body: Record<string, unknown>, status = 200) {
  return withCors(status, JSON.stringify(body), { "Content-Type": "application/json" });
}

function errorResponse(status: number, message: string) {
  try {
    return json({ error: message }, status);
  } catch {
    return new Response(
      JSON.stringify({ error: "Document Vault storage failed." }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3000",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Vary": "Origin",
          "Content-Type": "application/json",
        },
      },
    );
  }
}

function safeObjectPath(value: unknown) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 512) return "";
  return path;
}

function isMultipart(req: Request) {
  const contentType = (req.headers.get("Content-Type") || "").toLowerCase();
  return contentType.includes("multipart/form-data");
}

async function requireVaultAdmin(authHeader: string) {
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON_KEY },
  });
  if (!userRes.ok) return { error: "Your session expired. Please sign in again.", status: 401 };

  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_document_vault_admin`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!checkRes.ok) return { error: "Unable to verify Document Vault access.", status: 403 };
  const allowed = await checkRes.json();
  if (allowed !== true) return { error: "You do not have permission to manage the Document Vault.", status: 403 };
  return { error: null, status: 200 };
}

function objectUrl(path: string) {
  const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`;
}

async function storageRequest(path: string, method: string, body?: BodyInit, contentType?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SERVICE_ROLE}`,
    apikey: SERVICE_ROLE,
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (method === "POST") headers["x-upsert"] = "false";
  return await fetch(objectUrl(path), { method, headers, body });
}

async function storageError(res: Response) {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || text || `Storage request failed (${res.status})`;
  } catch {
    return text || `Storage request failed (${res.status})`;
  }
}

function clientStatus(status: number) {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 405) return status;
  return 500;
}

async function handleUpload(req: Request) {
  const form = await req.formData();
  const action = String(form.get("action") || "upload");
  const path = safeObjectPath(form.get("path"));
  if (action !== "upload") return errorResponse(400, "Unsupported upload action.");
  if (!path) return errorResponse(400, "A valid file path is required.");

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return errorResponse(400, "A file is required.");
  }

  const type = String(form.get("contentType") || file.type || "application/octet-stream");
  const uploaded = await storageRequest(path, "POST", await file.arrayBuffer(), type);
  if (!uploaded.ok) return errorResponse(clientStatus(uploaded.status), await storageError(uploaded));
  return json({ path, bucket: BUCKET }, 200);
}

async function handleJson(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const path = safeObjectPath(body.path);
  if (!path) return errorResponse(400, "A valid file path is required.");

  if (action === "delete") {
    const removed = await storageRequest(path, "DELETE");
    if (!removed.ok && removed.status !== 404) {
      return errorResponse(clientStatus(removed.status), await storageError(removed));
    }
    return json({ path, deleted: true }, 200);
  }

  if (action === "download") {
    const downloaded = await storageRequest(path, "GET");
    if (!downloaded.ok) return errorResponse(clientStatus(downloaded.status), await storageError(downloaded));
    const bytes = await downloaded.arrayBuffer();
    const type = downloaded.headers.get("Content-Type") || "application/octet-stream";
    return withCors(200, bytes, {
      "Content-Type": type,
      "Cache-Control": "private, max-age=60",
    });
  }

  return errorResponse(400, "Unsupported Document Vault action.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(204, null);
  }

  try {
    if (req.method !== "POST") return errorResponse(405, "Method not allowed");
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
      return errorResponse(500, "Document Vault storage is not configured.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return errorResponse(401, "Your session expired. Please sign in again.");
    }

    const admin = await requireVaultAdmin(authHeader);
    if (admin.error) return errorResponse(admin.status, admin.error);

    if (isMultipart(req)) return await handleUpload(req);
    return await handleJson(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document Vault storage failed.";
    return errorResponse(500, message);
  }
});
