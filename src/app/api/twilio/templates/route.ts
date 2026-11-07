import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTwilioCredentialsForNumber } from "@/lib/twilio-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TwilioContent = {
  sid?: string;
  friendly_name?: string;
  language?: string;
  types?: Record<string, { body?: string; text?: string }>;
  approvals?: { whatsapp?: { status?: string; name?: string; category?: string; rejection_reason?: string } };
};

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Sign in to view Twilio templates." }, { status: 401 });
  const senderNumberId = request.nextUrl.searchParams.get("senderNumberId");
  if (!senderNumberId) return NextResponse.json({ error: "Choose a Twilio sender number." }, { status: 400 });

  try {
    const credentials = await getTwilioCredentialsForNumber(senderNumberId);
    if (!credentials) return NextResponse.json({ error: "Twilio credentials are unavailable for this sender. Check its connected Twilio account in Admin → WhatsApp numbers." }, { status: 409 });
    const response = await fetch("https://content.twilio.com/v1/ContentAndApprovals?PageSize=500", {
      headers: { Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const data = await response.json() as { contents?: TwilioContent[]; message?: string; code?: number };
    if (!response.ok) return NextResponse.json({ error: data.message || `Twilio Content API returned HTTP ${response.status}.` }, { status: 502 });
    const templates = (data.contents ?? []).map((item) => {
      const body = item.types?.["twilio/text"]?.body ?? item.types?.["whatsapp/text"]?.body ?? item.types?.["twilio/text"]?.text ?? "";
      return {
        sid: item.sid ?? "",
        name: item.approvals?.whatsapp?.name || item.friendly_name || item.sid || "WhatsApp template",
        language: item.language ?? "",
        body,
        status: item.approvals?.whatsapp?.status?.toLowerCase() ?? "unsubmitted",
        category: item.approvals?.whatsapp?.category ?? "",
        variables: [...new Set([...body.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]))],
      };
    }).filter((item) => item.sid && item.status === "approved");
    return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "28000" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
      console.error("Twilio template lookup could not access the CRM credential store.", code);
      return NextResponse.json({ error: "The CRM cannot access its Twilio credentials. Check the PostgreSQL connection." }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load templates from Twilio." }, { status: 502 });
  }
}
