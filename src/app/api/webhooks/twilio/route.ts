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

  urls.add(request.nextUrl.toString());

  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";

  if (host) {
    urls.add(`${forwardedProto}://${host}${pathname}${search}`);
    urls.add(`https://${host}${pathname}${search}`);
    urls.add(`http://${host}${pathname}${search}`);

    const altPath = pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
    urls.add(`${forwardedProto}://${host}${altPath}${search}`);
    urls.add(`https://${host}${altPath}${search}`);
  }

  if (process.env.APP_BASE_URL) {
    const base = process.env.APP_BASE_URL.replace(/\/$/, "");
    urls.add(`${base}${pathname}${search}`);
    const altPath = pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
    urls.add(`${base}${altPath}${search}`);
  }

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

  // Validate Twilio signature if auth token is available
  const twilioSignature = request.headers.get("x-twilio-signature");
  const accountSid = params.AccountSid;
  if (twilioSignature && accountSid) {
    const authTokens = await getTwilioAuthTokensByAccountSid(accountSid);
    if (authTokens.length > 0) {
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
      if (!isValid) {
        console.warn("Twilio signature validation failed for AccountSid:", accountSid, "tested URLs:", candidateUrls);
      }
    }
  }

  // Check if this is a Status Callback or Inbound Message
  const isStatusCallback = Boolean(params.MessageStatus || params.SmsStatus);

  try {
    if (isStatusCallback) {
      await processTwilioStatusCallback(params);
    } else if (params.From && params.To) {
      await processTwilioInboundMessage(params);
    }
    return emptyTwiML();
  } catch (err) {
    console.error("Twilio webhook error:", err);
    // Always return 200 to Twilio so it does not endlessly retry delivery of dropped webhooks
    return emptyTwiML();
  }
}

