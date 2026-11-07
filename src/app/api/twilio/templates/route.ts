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
  approval_requests?: { status?: string; name?: string; category?: string; rejection_reason?: string; content_type?: string };
  approvals?: {
    whatsapp?: { status?: string; name?: string; category?: string; rejection_reason?: string };
    WhatsApp?: { status?: string; name?: string; category?: string; rejection_reason?: string };
  };
};

type TwilioContentPage = {
  contents?: TwilioContent[];
  meta?: { next_page_url?: string | null };
  message?: string;
  code?: number;
};

const TWILIO_CONTENT_ORIGIN = "https://content.twilio.com";

async function fetchApprovedContent(accountSid: string, authToken: string) {
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const templates: TwilioContent[] = [];
  let nextUrl: string | null = `${TWILIO_CONTENT_ORIGIN}/v1/ContentAndApprovals?PageSize=500`;
  const visited = new Set<string>();

  // Twilio caps Content API pages at roughly 500 templates / 1 MB.
  while (nextUrl && templates.length < 6000) {
    const url: URL = new URL(nextUrl);
    if (url.origin !== TWILIO_CONTENT_ORIGIN || !url.pathname.startsWith("/v1/ContentAndApprovals")) {
      throw new Error("Twilio returned an unexpected Content API pagination URL.");
    }
    if (visited.has(url.toString())) throw new Error("Twilio Content API returned a repeated pagination URL.");
    visited.add(url.toString());

    const response = await fetch(url, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const page = await response.json() as TwilioContentPage;
    if (!response.ok) throw new Error(page.message || `Twilio Content API returned HTTP ${response.status}.`);
    templates.push(...(page.contents ?? []));

    const candidate = page.meta?.next_page_url;
    if (!candidate) nextUrl = null;
    else {
      const parsed: URL = new URL(candidate, TWILIO_CONTENT_ORIGIN);
      if (parsed.origin !== TWILIO_CONTENT_ORIGIN) throw new Error("Twilio returned an unexpected Content API pagination URL.");
      nextUrl = parsed.toString();
    }
  }

  return templates;
}

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Sign in to view Twilio templates." }, { status: 401 });
  const senderNumberId = request.nextUrl.searchParams.get("senderNumberId");
  if (!senderNumberId) return NextResponse.json({ error: "Choose a Twilio sender number." }, { status: 400 });

  try {
    const credentials = await getTwilioCredentialsForNumber(senderNumberId);
    if (!credentials) return NextResponse.json({ error: "Twilio credentials are unavailable for this sender. Check its connected Twilio account in Admin → WhatsApp numbers." }, { status: 409 });
    const contents = await fetchApprovedContent(credentials.accountSid, credentials.authToken);
    const templates = contents.map((item) => {
      const body = item.types?.["twilio/text"]?.body
        ?? item.types?.["whatsapp/text"]?.body
        ?? item.types?.["twilio/text"]?.text
        ?? Object.values(item.types ?? {}).find((contentType) => contentType.body)?.body
        ?? "";
      // ContentAndApprovals v1 uses `approval_requests`; the per-template
      // ApprovalRequests endpoint instead returns `whatsapp`. Support both.
      const approval = item.approval_requests ?? item.approvals?.whatsapp ?? item.approvals?.WhatsApp;
      return {
        sid: item.sid ?? "",
        name: approval?.name || item.friendly_name || item.sid || "WhatsApp template",
        language: item.language ?? "",
        body,
        status: approval?.status?.trim().toLowerCase() ?? "unsubmitted",
        category: approval?.category ?? "",
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
