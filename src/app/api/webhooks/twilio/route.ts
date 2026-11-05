import { NextRequest, NextResponse } from "next/server";
import { processTwilioInboundMessage, processTwilioStatusCallback, verifyTwilioSignature } from "@/lib/twilio-whatsapp";
import { getTwilioCredentialsByAccountSid } from "@/lib/twilio-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptyTwiML() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
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
    const authToken = await getTwilioCredentialsByAccountSid(accountSid);
    if (authToken) {
      const fullUrl = request.nextUrl.toString();
      const isValid = verifyTwilioSignature(fullUrl, params, twilioSignature, authToken);
      if (!isValid) {
        console.warn("Twilio signature validation failed for AccountSid:", accountSid);
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

