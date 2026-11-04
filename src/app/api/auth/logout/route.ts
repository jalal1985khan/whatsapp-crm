import { NextResponse } from "next/server";
import { clearMfaChallenge, destroySession } from "@/lib/auth";

export async function POST() {
  await destroySession();
  await clearMfaChallenge();
  return NextResponse.json({ ok: true });
}
