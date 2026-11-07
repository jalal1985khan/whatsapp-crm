import { NextRequest, NextResponse } from "next/server";
import { getCrmSnapshot } from "@/lib/crm-store";
import { requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId, ensureWorkspace } from "@/lib/postgres-pool";
import { saveTwilioAccount, testTwilioConnection, listTwilioAccounts } from "@/lib/twilio-credentials";
import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

type Row = QueryResultRow;

export const runtime = "nodejs";

export async function GET() {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  const snapshot = await getCrmSnapshot();
  const twilioAccounts = await listTwilioAccounts();
  return NextResponse.json(
    { numbers: snapshot.numbers, twilioAccounts },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    provider?: string;
    label?: string;
    number?: string;
    // Twilio
    twilioAccountId?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioAccountName?: string;
    // Meta
    metaPhoneNumberId?: string;
    metaWabaId?: string;
  } | null;

  if (body?.provider === "META" || body?.metaPhoneNumberId || body?.metaWabaId) {
    return NextResponse.json({ error: "This workspace is currently configured for Twilio only. Add a Twilio WhatsApp sender." }, { status: 400 });
  }

  if (!body?.number?.trim()) {
    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  }

  const normalized = body.number.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return NextResponse.json({ error: "Enter a phone number in international format, such as +14155550123." }, { status: 400 });
  }

  // --- Twilio Flow ---
  let twilioAccountId = body.twilioAccountId?.trim() || null;

  // If new credentials were provided inline, validate and save the TwilioAccount
  if (body.twilioAccountSid?.trim() && body.twilioAuthToken?.trim()) {
    const sid = body.twilioAccountSid.trim();
    const token = body.twilioAuthToken.trim();

    if (!sid.startsWith("AC") || sid.length < 30) {
      return NextResponse.json({ error: "Invalid Twilio Account SID format (must start with AC)." }, { status: 400 });
    }

    const check = await testTwilioConnection(sid, token);
    if (!check.ok) {
      return NextResponse.json({ error: `Twilio validation failed: ${check.error}` }, { status: 400 });
    }

    const saved = await saveTwilioAccount({
      friendlyName: body.twilioAccountName?.trim() || check.friendlyName || `Twilio (${sid.slice(-4)})`,
      accountSid: sid,
      authToken: token,
    });
    twilioAccountId = saved.id;
  }

  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const workspaceId = await ensureWorkspace(client);

      const existing = await client.query<Row>(
        `SELECT "id" FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "e164Number" = $2`,
        [workspaceId, normalized],
      );
      if (existing.rows.length) {
        throw new Error("That phone number is already configured in this workspace.");
      }

      const countResult = await client.query<Row>(
        `SELECT COUNT(*)::int AS count FROM "ChannelNumber" WHERE "workspaceId" = $1`,
        [workspaceId],
      );
      const count = Number(countResult.rows[0]?.count ?? 0);
      const priority = (count + 1) * 100;

      const channelId = randomUUID();
      const insertResult = await client.query<Row>(
        `INSERT INTO "ChannelNumber"
         ("id", "workspaceId", "label", "e164Number", "state", "provider", "twilioAccountId", "routingPriority", "approvedByUserId", "approvedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'TWILIO', $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING "id", "label", "e164Number", "state", "provider", "routingPriority", "createdAt"`,
        [channelId, workspaceId, body.label?.trim() || "Twilio Line", normalized, twilioAccountId, priority, session.userId],
      );

      await client.query(
        `INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
         VALUES ($1, $2, $3, 'CHANNEL_NUMBER_CREATED', 'CHANNEL_NUMBER', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
        [randomUUID(), workspaceId, session.userId, channelId, JSON.stringify({ provider: "TWILIO", e164Number: normalized, twilioAccountId })],
      );

      await client.query("COMMIT");
      const row = insertResult.rows[0];
      return NextResponse.json(
        {
          number: {
            id: String(row.id),
            label: String(row.label),
            number: String(row.e164Number),
            state: "Active",
            provider: "TWILIO",
            twilioAccountId,
            createdAt: new Date(String(row.createdAt)).toISOString(),
          },
        },
        { status: 201 },
      );
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not add Twilio number." }, { status: 400 });
    } finally {
      client.release();
    }
  }

  return NextResponse.json({ error: "PostgreSQL is required to add live Twilio WhatsApp senders." }, { status: 503 });
}
