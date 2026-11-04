import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ duplicates: [], configurable: false });
  try {
    const result = await getPostgresPool().query<QueryResultRow>(`SELECT a."id" AS "firstId",COALESCE(a."displayName",a."primaryPhone") AS "firstName",a."primaryPhone" AS "firstPhone",b."id" AS "secondId",COALESCE(b."displayName",b."primaryPhone") AS "secondName",b."primaryPhone" AS "secondPhone",
      ARRAY_REMOVE(ARRAY[CASE WHEN lower(COALESCE(a."email",''))=lower(COALESCE(b."email",'')) AND COALESCE(a."email",'')<>'' THEN 'matching email' END,CASE WHEN lower(trim(COALESCE(a."displayName",'')))=lower(trim(COALESCE(b."displayName",''))) AND COALESCE(a."displayName",'')<>'' THEN 'matching name' END,CASE WHEN EXISTS (SELECT 1 FROM "ContactIdentifier" ai JOIN "ContactIdentifier" bi ON bi."workspaceId"=ai."workspaceId" AND bi."type"=ai."type" AND bi."normalizedValue"=ai."normalizedValue" WHERE ai."workspaceId"=a."workspaceId" AND ai."contactId"=a."id" AND bi."contactId"=b."id" AND ai."type"='PHONE') THEN 'matching phone history' END],NULL) AS "reasons"
      FROM "Contact" a JOIN "Contact" b ON b."workspaceId"=a."workspaceId" AND a."id"<b."id"
      WHERE a."workspaceId"=$1 AND a."mergedIntoContactId" IS NULL AND b."mergedIntoContactId" IS NULL AND (lower(trim(COALESCE(a."displayName",'')))=lower(trim(COALESCE(b."displayName",''))) AND COALESCE(a."displayName",'')<>'' OR lower(COALESCE(a."email",''))=lower(COALESCE(b."email",'')) AND COALESCE(a."email",'')<>'' OR EXISTS (SELECT 1 FROM "ContactIdentifier" ai JOIN "ContactIdentifier" bi ON bi."workspaceId"=ai."workspaceId" AND bi."type"=ai."type" AND bi."normalizedValue"=ai."normalizedValue" WHERE ai."workspaceId"=a."workspaceId" AND ai."contactId"=a."id" AND bi."contactId"=b."id" AND ai."type"='PHONE'))
      ORDER BY a."createdAt" DESC,b."createdAt" DESC LIMIT 50`, [getWorkspaceId()]);
    return NextResponse.json({ duplicates: result.rows.map((row) => ({ firstId: String(row.firstId), firstName: String(row.firstName), firstPhone: String(row.firstPhone), secondId: String(row.secondId), secondName: String(row.secondName), secondPhone: String(row.secondPhone), reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [] })), configurable: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not find possible duplicate records." }, { status: 503 }); }
}
