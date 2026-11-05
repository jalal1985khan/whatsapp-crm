import { NextRequest } from "next/server";
import { POST as handleTwilioWebhook } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleTwilioWebhook(request);
}

export async function GET() {
  return new Response("Twilio Status Webhook Active", { status: 200 });
}

