import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const envFile of [".env.local", ".env"]) {
  try { process.loadEnvFile(path.join(projectRoot, envFile)); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy the PostgreSQL example from .env.example into your local environment.");
  process.exit(1);
}

const migrationsRoot = path.join(projectRoot, "prisma", "migrations");
// Earlier migration folders used future dates. They were renamed in order; databases that applied the
// old names have their ledger rows carried over so nothing runs twice.
const renamedVersions = {
  "20261021000000_meta_webhooks": "20261020000100_meta_webhooks",
  "20261022000000_whatsapp_templates": "20261020000200_whatsapp_templates",
  "20261023000000_guarded_failover": "20261020000300_guarded_failover",
  "20261024000000_webhook_recovery": "20261020000400_webhook_recovery",
  "20261025000000_auth_rate_limits": "20261020000500_auth_rate_limits",
  "20261026000000_auth_sessions": "20261020000600_auth_sessions",
  "20261027000000_password_resets": "20261020000700_password_resets",
  "20261028000000_mfa": "20261020000800_mfa",
  "20261029000000_contact_deletion_controls": "20261020000900_contact_deletion_controls",
  "20261030000000_admin_alerts": "20261020001000_admin_alerts",
  "20261031000000_admin_email_alerts": "20261020001100_admin_email_alerts",
  "20261101000000_meta_embedded_signup": "20261020001200_meta_embedded_signup",
  "20261102000000_message_attachments": "20261020001300_message_attachments",
  "20261103000000_team_records": "20261020001400_team_records",
  "20261104000000_contact_merge": "20261020001500_contact_merge",
  "20261105000000_canned_replies": "20261020001600_canned_replies",
  "20261106000000_saved_inbox_views": "20261020001700_saved_inbox_views",
  "20261107000000_failover_error_details": "20261020001800_failover_error_details",
  "20261108000000_failover_approval_policy": "20261020001900_failover_approval_policy",
  "20261109000000_failover_routing_provenance": "20261020002000_failover_routing_provenance",
  "20261110000000_customer_segments": "20261020002100_customer_segments",
  "20261111000000_media_malware_scan": "20261020002200_media_malware_scan",
  "20261112000000_backfill_channel_approvals": "20261020002300_backfill_channel_approvals",
  "20261113000000_workspace_invitations": "20261020002400_workspace_invitations",
  "20261114000000_template_lifecycle_events": "20261020002500_template_lifecycle_events",
  "20261115000000_message_retry_claims": "20261020002600_message_retry_claims",
  "20261116000000_contact_message_summary_index": "20261020002700_contact_message_summary_index",
};
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["whatsapp-crm-schema-migrations"]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "crm_schema_migrations" (
        "version" TEXT PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const directories = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const [oldVersion, newVersion] of Object.entries(renamedVersions)) {
      await client.query('UPDATE "crm_schema_migrations" SET "version" = $2 WHERE "version" = $1 AND NOT EXISTS (SELECT 1 FROM "crm_schema_migrations" WHERE "version" = $2)', [oldVersion, newVersion]);
    }
    const appliedVersions = (await client.query('SELECT "version" FROM "crm_schema_migrations"')).rows.map((row) => row.version);
    const latestApplied = appliedVersions.sort().at(-1);
    const outOfOrder = directories.filter((version) => latestApplied && version < latestApplied && !appliedVersions.includes(version));
    if (outOfOrder.length) throw new Error(`Migration ${outOfOrder.join(", ")} sorts before already-applied ${latestApplied}. Rename it with a later timestamp.`);
    const futureDated = directories.filter((version) => version.slice(0, 8) > new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    if (futureDated.length) console.warn(`Warning: migration ${futureDated.join(", ")} is dated in the future; new migrations created today would sort before it.`);

    let applied = 0;
    for (const version of directories) {
      const sqlPath = path.join(migrationsRoot, version, "migration.sql");
      let sql;
      try { sql = await readFile(sqlPath, "utf8"); }
      catch (error) {
        if (error?.code === "ENOENT") throw new Error(`Migration directory ${version} is missing migration.sql.`);
        throw error;
      }
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query('SELECT "checksum" FROM "crm_schema_migrations" WHERE "version" = $1', [version]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration ${version} changed after it was applied. Create a new migration instead.`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO "crm_schema_migrations" ("version", "checksum") VALUES ($1, $2)', [version, checksum]);
      applied += 1;
    }

    await client.query("COMMIT");
    console.log(applied ? `Applied ${applied} PostgreSQL migration${applied === 1 ? "" : "s"}.` : "PostgreSQL schema is up to date.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not apply PostgreSQL migrations.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
