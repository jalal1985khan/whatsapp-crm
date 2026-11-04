import { getCrmSnapshot } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { TemplateAdmin } from "@/components/template-admin";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";
type Row = QueryResultRow;

export default async function TemplatesPage() {
  const snapshot = await getCrmSnapshot();
  let templates: Row[] = [];
  let hasConnectedMetaToken = false;
  if (process.env.DATABASE_URL) {
    try {
      const result = await getPostgresPool().query<Row>(`SELECT "id", "wabaId", "metaTemplateId", "name", "language", "category", "status", "statusReason", "statusUpdatedAt", "qualityScore", "previousQualityScore", "qualityUpdatedAt", "components", "syncedAt" FROM "WhatsAppTemplate" WHERE "workspaceId" = $1 ORDER BY "wabaId", "name", "language"`, [getWorkspaceId()]);
      templates = result.rows;
      const connection = await getPostgresPool().query(`SELECT 1 FROM "WhatsAppConnection" c WHERE c."workspaceId"=$1 AND c."status"='ACTIVE' AND (c."tokenExpiresAt" IS NULL OR c."tokenExpiresAt">CURRENT_TIMESTAMP) AND EXISTS (SELECT 1 FROM "ChannelNumber" n WHERE n."workspaceId"=c."workspaceId" AND n."whatsappConnectionId"=c."id" AND n."metaWabaId"=c."wabaId") LIMIT 1`, [getWorkspaceId()]);
      hasConnectedMetaToken = connection.rows.length > 0;
    } catch { templates = []; }
  }
  const wabas = [...new Map(snapshot.numbers.filter((number) => number.metaWabaId).map((number) => [number.metaWabaId!, { id: number.metaWabaId!, label: number.label }])).values()];
  const initialTemplates = templates.map((row) => ({
    id: String(row.id), wabaId: String(row.wabaId), metaTemplateId: row.metaTemplateId == null ? undefined : String(row.metaTemplateId),
    name: String(row.name), language: String(row.language), category: String(row.category), status: String(row.status),
    statusReason: row.statusReason == null ? null : String(row.statusReason), statusUpdatedAt: row.statusUpdatedAt == null ? null : new Date(String(row.statusUpdatedAt)).toISOString(),
    qualityScore: row.qualityScore == null ? null : String(row.qualityScore), previousQualityScore: row.previousQualityScore == null ? null : String(row.previousQualityScore), qualityUpdatedAt: row.qualityUpdatedAt == null ? null : new Date(String(row.qualityUpdatedAt)).toISOString(),
    components: Array.isArray(row.components) ? row.components as { type?: string; text?: string }[] : [],
    syncedAt: new Date(String(row.syncedAt)).toISOString(),
  }));
  return <TemplateAdmin initialTemplates={initialTemplates} wabas={wabas} metaConfigured={Boolean(process.env.DATABASE_URL && (process.env.META_ACCESS_TOKEN || hasConnectedMetaToken))} />;
}
