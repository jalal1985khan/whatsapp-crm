import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/postgres-pool";
import { refreshConnectionExpiryAlerts } from "@/lib/admin-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest, expected: string) {
  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(received).digest(); const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
function htmlEscape(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }

export async function POST(request: NextRequest) {
  const secret = process.env.ALERT_EMAIL_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "Email alert delivery is not configured." }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const apiKey = process.env.RESEND_API_KEY; const from = process.env.PASSWORD_RESET_FROM; const appBaseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !appBaseUrl || !process.env.DATABASE_URL) return NextResponse.json({ error: "Configure PostgreSQL, Resend, sender address, and APP_BASE_URL." }, { status: 503 });
  let baseUrl: URL;
  try { baseUrl = new URL(appBaseUrl); } catch { return NextResponse.json({ error: "APP_BASE_URL is invalid." }, { status: 503 }); }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || /[\r\n]/.test(from)) return NextResponse.json({ error: "Email alerts require a clean HTTPS APP_BASE_URL and safe sender address." }, { status: 503 });

  const pool = getPostgresPool(); const client = await pool.connect();
  type Pending = { id: string; workspaceId: string; severity: string; category: string; title: string; message: string; targetType: string | null; targetId: string | null; emailRecipients: string[]; emailAttempts: number };
  let pending: Pending[];
  try {
    await client.query("BEGIN");
    await refreshConnectionExpiryAlerts(client);
    const claimed = await client.query<Pending>(`WITH selected AS (
      SELECT a."id",COALESCE(a."emailRecipients",w."adminAlertEmails") AS "emailRecipients" FROM "AdminAlert" a JOIN "Workspace" w ON w."id"=a."workspaceId"
        WHERE w."emailAlertsEnabled"=true AND cardinality(w."adminAlertEmails")>0
          AND a."severity" IN ('WARNING','CRITICAL') AND a."emailSentAt" IS NULL AND a."emailAttempts"<5
          AND (a."emailNextAttemptAt" IS NULL OR a."emailNextAttemptAt"<=CURRENT_TIMESTAMP)
        ORDER BY a."createdAt" FOR UPDATE OF a SKIP LOCKED LIMIT 20
      )
      UPDATE "AdminAlert" a SET "emailAttempts"=a."emailAttempts"+1,"emailNextAttemptAt"=CURRENT_TIMESTAMP+INTERVAL '5 minutes',"emailRecipients"=COALESCE(a."emailRecipients",s."emailRecipients")
      FROM selected s WHERE a."id"=s."id"
      RETURNING a."id",a."workspaceId",a."severity",a."category",a."title",a."message",a."targetType",a."targetId",a."emailRecipients",a."emailAttempts"`);
    pending = claimed.rows;
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} return NextResponse.json({ error: error instanceof Error ? error.message : "Could not claim alert emails." }, { status: 503 }); }
  finally { client.release(); }

  let sent = 0; let failed = 0;
  for (const alert of pending) {
    const path = alert.targetType === "WEBHOOK_EVENT" ? "/admin/webhooks" : "/admin/numbers";
    const reviewUrl = new URL(path, baseUrl);
    if (alert.targetId && alert.targetType === "CHANNEL_NUMBER") reviewUrl.searchParams.set("number", alert.targetId);
    if (alert.targetId && alert.targetType === "WHATSAPP_BUSINESS_ACCOUNT") reviewUrl.searchParams.set("waba", alert.targetId);
    const url = reviewUrl.toString();
    const subject = `[Relay CRM ${alert.severity}] ${alert.title}`;
    const textBody = `${alert.title}\n\n${alert.message}\n\nCategory: ${alert.category}\nReview: ${url}`;
    const htmlBody = `<h2>${htmlEscape(alert.title)}</h2><p>${htmlEscape(alert.message)}</p><p><strong>Severity:</strong> ${htmlEscape(alert.severity)}<br><strong>Category:</strong> ${htmlEscape(alert.category)}</p><p><a href="${htmlEscape(url)}">Review in Relay CRM</a></p>`;
    let success = false;
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `admin-alert/${alert.id}` }, body: JSON.stringify({ from, to: alert.emailRecipients, subject, text: textBody, html: htmlBody }), signal: AbortSignal.timeout(10_000) });
      success = response.ok;
    } catch { success = false; }
    if (success) {
      await pool.query(`UPDATE "AdminAlert" SET "emailSentAt"=CURRENT_TIMESTAMP,"emailNextAttemptAt"=NULL,"emailLastError"=NULL WHERE "id"=$1`, [alert.id]); sent += 1;
    } else {
      const delay = Math.min(3600, 60 * 2 ** Math.max(0, alert.emailAttempts - 1));
      await pool.query(`UPDATE "AdminAlert" SET "emailLastError"='delivery_failed',"emailNextAttemptAt"=CASE WHEN "emailAttempts">=5 THEN NULL ELSE CURRENT_TIMESTAMP+($2::int*INTERVAL '1 second') END WHERE "id"=$1`, [alert.id, delay]); failed += 1;
    }
  }
  return NextResponse.json({ sent, failed, pending: pending.length, limitReached: pending.length === 20 });
}
