import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const envFile of [".env.production.local", ".env.production", ".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(projectRoot, envFile));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL is not configured.");
  process.exit(1);
}

const args = process.argv.slice(2);
const email = args[0]?.trim().toLowerCase();
const password = args[1]?.trim();
const name = args.slice(2).join(" ").trim() || "Owner";

if (!email || !password) {
  console.log(`
Usage:
  node scripts/create-owner.mjs <email> <password> [name]

Example:
  node scripts/create-owner.mjs admin@storeshop.biz "MySecurePass123!" "Admin"
`);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("❌ Invalid email address:", email);
  process.exit(1);
}

if (password.length < 12) {
  console.error("❌ Password must be at least 12 characters long.");
  process.exit(1);
}

const workspaceId = process.env.CRM_WORKSPACE_ID || "default-workspace";
const workspaceName = process.env.CRM_WORKSPACE_NAME || "WhatsApp CRM";

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ensure workspace exists
    await client.query(
      `INSERT INTO "Workspace" ("id", "name", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
      [workspaceId, workspaceName]
    );

    // 2. Hash password using scrypt
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

    // 3. Upsert User
    const existingUser = await client.query(`SELECT "id" FROM "User" WHERE lower("email") = $1`, [email]);
    let userId;
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
      await client.query(
        `UPDATE "User" SET "name" = $1, "passwordHash" = $2, "active" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $3`,
        [name, passwordHash, userId]
      );
      console.log(`✓ Updated existing user credentials for ${email}`);
    } else {
      userId = randomUUID();
      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "passwordHash", "active", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, email, name, passwordHash]
      );
      console.log(`✓ Created new user record for ${email}`);
    }

    // 4. Upsert WorkspaceUser as OWNER
    await client.query(
      `INSERT INTO "WorkspaceUser" ("workspaceId", "userId", "role", "joinedAt")
       VALUES ($1, $2, 'OWNER'::"WorkspaceRole", CURRENT_TIMESTAMP)
       ON CONFLICT ("workspaceId", "userId") DO UPDATE SET "role" = 'OWNER'::"WorkspaceRole"`,
      [workspaceId, userId]
    );

    // 5. Clean up any pending bootstrap owner invitations
    await client.query(
      `DELETE FROM "WorkspaceInvitation" WHERE "workspaceId" = $1 AND "role" = 'OWNER'::"WorkspaceRole"`,
      [workspaceId]
    );

    await client.query("COMMIT");

    console.log(`
==================================================
🎉 Owner account ready!
==================================================
Email:    ${email}
Name:     ${name}
Role:     Owner
Workspace: ${workspaceName} (${workspaceId})

You can now log in at:
👉 https://crm.storeshop.biz/login
==================================================
`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error("❌ Failed to create owner account:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
