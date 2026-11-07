import { NextRequest, NextResponse } from "next/server";
import { processTwilioInboundMessage, processTwilioStatusCallback, verifyTwilioSignature } from "@/lib/twilio-whatsapp";
import { getTwilioAuthTokensByAccountSid } from "@/lib/twilio-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptyTwiML() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function getCandidateWebhookUrls(request: NextRequest): string[] {
  const urls = new Set<string>();
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;

  if (process.env.APP_BASE_URL) urls.add(`${process.env.APP_BASE_URL.replace(/\/$/, "")}${pathname}${search}`);

  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";

  if (host) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const candidates = [
      `${forwardedProto}://${host}${pathname}${search}`,
      `https://${host}${pathname}${search}`,
      `http://${host}${pathname}${search}`,
      ...(forwardedHost && forwardedHost !== host ? [`${forwardedProto}://${forwardedHost}${pathname}${search}`, `https://${forwardedHost}${pathname}${search}`] : []),
    ];
    for (const url of candidates) urls.add(url);
  }

  urls.add(request.nextUrl.toString());

  return Array.from(urls);
}

export async function GET() {
  return new Response("Twilio Webhook Endpoint is Active", { status: 200 });
}

export async function POST(request: NextRequest) {
  let params: Record<string, string> = {};

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          params[key] = value;
        }
      });
    } catch {
      return NextResponse.json({ error: "Could not parse form payload." }, { status: 400 });
    }
  } else {
    try {
      const text = await request.text();
      const parsed = new URLSearchParams(text);
      parsed.forEach((value, key) => {
        params[key] = value;
      });
    } catch {
      return NextResponse.json({ error: "Could not parse text payload." }, { status: 400 });
    }
  }

  // Resolve the account token and reject unsigned or invalid requests whenever configured.
  const twilioSignature = request.headers.get("x-twilio-signature");
  const accountSid = params.AccountSid;
  if (!twilioSignature || !accountSid) return NextResponse.json({ error: "Twilio signature and AccountSid are required." }, { status: 401 });
  {
    let authTokens: string[];
    try {
      authTokens = await getTwilioAuthTokensByAccountSid(accountSid);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      console.error("Twilio credential lookup failed before webhook signature verification.", code || "unknown error");
      return NextResponse.json({ error: "The CRM cannot access its Twilio credential store. Check the PostgreSQL connection." }, { status: 503 });
    }
    if (authTokens.length === 0) return NextResponse.json({ error: "No configured Twilio account matches this webhook." }, { status: 401 });
    {
      const candidateUrls = getCandidateWebhookUrls(request);
      let isValid = false;
      for (const token of authTokens) {
        for (const url of candidateUrls) {
          if (verifyTwilioSignature(url, params, twilioSignature, token)) {
            isValid = true;
            break;
          }
        }
        if (isValid) break;
      }
      if (!isValid) return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
    }
  }

  // Both inbound webhooks and outbound status callbacks can include From, To,
  // and MessageSid. Inbound webhooks may also carry MessageStatus/SmsStatus
  // with the value "received"; only the outbound lifecycle values are status
  // callbacks for our CRM message record.
  const messageStatus = (params.MessageStatus || params.SmsStatus || "").toLowerCase();
  const hasMessageIdentity = Boolean(params.From && params.To && (params.MessageSid || params.SmsMessageSid));
  const isInboundMessage = hasMessageIdentity && (!messageStatus || messageStatus === "received" || messageStatus === "receiving");
  const isStatusCallback = Boolean(messageStatus) && !isInboundMessage;

  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "CRM database is not configured; incoming messages cannot be stored." }, { status: 503 });
    if (isStatusCallback) {
      await processTwilioStatusCallback(params);
    } else if (isInboundMessage) {
      const inboundAccountTokens = await getTwilioAuthTokensByAccountSid(accountSid);
      if (!inboundAccountTokens.length) return NextResponse.json({ error: "Twilio account is not configured in this workspace." }, { status: 401 });
      await processTwilioInboundMessage(params);
    } else {
      return NextResponse.json({ error: "Webhook payload is missing message direction fields." }, { status: 400 });
    }
    return emptyTwiML();
  } catch (err) {
    console.error("Twilio webhook error:", err);
    return NextResponse.json({ error: "Twilio webhook processing failed. Check the CRM server logs and webhook health." }, { status: 500 });
  }
}

