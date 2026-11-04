import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasOwner } from "@/lib/crm-store";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ hasOwner: await hasOwner(), databaseConfigured: Boolean(process.env.DATABASE_URL), bootstrapSecretRequired: Boolean(process.env.DATABASE_URL && process.env.NODE_ENV === "production"), user: session ? { email: session.email, name: session.name, role: session.role } : null }, { headers: { "Cache-Control": "no-store" } });
}
