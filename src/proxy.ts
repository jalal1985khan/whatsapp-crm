import { NextRequest, NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SIGNED_META_WEBHOOK = "/api/webhooks/whatsapp";

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method) || request.nextUrl.pathname === SIGNED_META_WEBHOOK) return NextResponse.next();

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return csrfDenied();

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
      const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().replace(/:$/, "");
      const expectedHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
      const expectedProto = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
      if (new URL(origin).origin !== `${expectedProto}://${expectedHost}`) return csrfDenied();
    } catch {
      return csrfDenied();
    }
  }
  return NextResponse.next();
}

function csrfDenied() {
  return NextResponse.json({ error: "This request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/api/:path*"] };
