import { NextRequest, NextResponse } from "next/server";
import { getSession, requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { syncWhatsAppTemplates } from "@/lib/meta-whatsapp";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = QueryResultRow;

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Sign in to view WhatsApp templates." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Template storage requires PostgreSQL." }, { status: 503 });
  try {
    const templates = await getPostgresPool().query<Row>(`SELECT "id", "wabaId", "metaTemplateId", "name", "language", "category", "status", "statusReason", "statusUpdatedAt", "qualityScore", "previousQualityScore", "qualityUpdatedAt", "components", "syncedAt"
      FROM "WhatsAppTemplate" WHERE "workspaceId" = $1 ORDER BY "wabaId", "name", "language"`, [getWorkspaceId()]);
    return NextResponse.json({ templates: templates.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load approved templates." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { wabaId?: string } | null;
  if (!body?.wabaId || !/^\d+$/.test(body.wabaId)) return NextResponse.json({ error: "Choose a valid numeric WABA ID." }, { status: 400 });
  try {
    const result = await syncWhatsAppTemplates(body.wabaId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync templates from Meta." }, { status: 400 });
  }
}
