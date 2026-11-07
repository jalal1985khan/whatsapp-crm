import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getPostgresPool, getWorkspaceId, ensureWorkspace } from "@/lib/postgres-pool";
import { getTwilioCredentialsForNumber, getTwilioCredentialsByAccountSid } from "@/lib/twilio-credentials";
import { triggerAgentNumberFailover } from "@/lib/agent-number-failover";

type Row = QueryResultRow;

export type TwilioSendResult = {
  id: string;
  platformMessageId?: string;
  status: string;
  duplicate: boolean;
};

/**
 * Validate incoming request signature from Twilio using HMAC-SHA1
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature || !authToken) return false;

  // Twilio signature calculation:
  // 1. Start with the full webhook URL
  // 2. Sort the parameter keys alphabetically
  // 3. Append each key and its value to the URL
  // 4. Compute HMAC-SHA1 using authToken and encode in base64
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const receivedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Clean a phone number string to E.164 (e.g. "whatsapp:+14155238886" -> "+14155238886")
 */
export function normalizeWhatsAppE164(input: string): string {
  const bare = input.replace(/^whatsapp:/i, "").trim();
  const digits = bare.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

/**
 * Send an outbound text message through Twilio WhatsApp
 */
export async function sendTwilioTextMessage(input: {
  contactId: string;
  senderNumberId: string;
  text?: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  idempotencyKey: string;
  statusCallbackUrl?: string;
}): Promise<TwilioSendResult> {
  if (!process.env.DATABASE_URL) throw new Error("Database is required for messaging.");

  const creds = await getTwilioCredentialsForNumber(input.senderNumberId);
  if (!creds || !creds.accountSid || !creds.authToken) {
    throw new Error("Twilio credentials are not configured for this sender number. Please configure your Twilio Account in Admin -> WhatsApp Numbers.");
  }

  let renderedText = input.text?.trim() ?? "";
  if (input.contentSid) {
    if (!/^HX[a-fA-F0-9]{32}$/.test(input.contentSid)) throw new Error("Choose a valid Twilio Content SID.");
    const authorization = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
    const approvalResponse = await fetch(`https://content.twilio.com/v1/Content/${encodeURIComponent(input.contentSid)}/ApprovalRequests`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const approval = await approvalResponse.json() as { whatsapp?: { status?: string }; message?: string };
    if (!approvalResponse.ok) throw new Error(approval.message || "Could not verify the Twilio template approval status.");
    if (approval.whatsapp?.status?.toLowerCase() !== "approved") throw new Error("This WhatsApp template is not approved for sending.");
    const contentResponse = await fetch(`https://content.twilio.com/v1/Content/${encodeURIComponent(input.contentSid)}`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const content = await contentResponse.json() as { types?: Record<string, { body?: string; text?: string }> };
    if (!contentResponse.ok) throw new Error("Could not load the selected Twilio template content.");
    const templateText = content.types?.["twilio/text"]?.body
      ?? content.types?.["whatsapp/text"]?.body
      ?? content.types?.["twilio/text"]?.text
      ?? Object.values(content.types ?? {}).find((contentType) => contentType.body)?.body
      ?? "";
    const requiredVariables = [...new Set([...templateText.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]))];
    const suppliedVariables = Object.keys(input.contentVariables ?? {});
    if (requiredVariables.some((key) => !input.contentVariables?.[key]?.trim()) || suppliedVariables.some((key) => !requiredVariables.includes(key))) {
      throw new Error("Provide a non-empty value for every variable in the selected Twilio template.");
    }
    if (suppliedVariables.some((key) => input.contentVariables![key].length > 1024 || /[\r\n]/.test(input.contentVariables![key]))) {
      throw new Error("Template values must be one line and no longer than 1,024 characters.");
    }
    renderedText = templateText.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, key: string) => input.contentVariables?.[key] ?? `{{${key}}}`);
    if (!renderedText) renderedText = `WhatsApp template ${input.contentSid}`;
  } else if (!renderedText) {
    throw new Error("Enter a message.");
  }

  const pool = getPostgresPool();
  const client = await pool.connect();
  let messageId = "";
  let conversationId = "";
  let recipient = "";
  let fromNumber = creds.fromE164;
  let workspaceId = "";

  try {
    await client.query("BEGIN");
    workspaceId = await ensureWorkspace(client);

    // Check idempotency
    const prior = await client.query<Row>(
      `SELECT "id", "status", "platformMessageId" FROM "Message" WHERE "workspaceId" = $1 AND "idempotencyKey" = $2`,
      [workspaceId, input.idempotencyKey],
    );
    if (prior.rows.length) {
      const row = prior.rows[0];
      await client.query("COMMIT");
      const priorStatus = String(row.status);
      if (priorStatus === "SENT" || priorStatus === "DELIVERED" || priorStatus === "READ") {
        return { id: String(row.id), platformMessageId: String(row.platformMessageId || ""), status: priorStatus.toLowerCase(), duplicate: true };
      }
    }

    // Load contact and conversation
    const target = await client.query<Row>(
      `SELECT c."id" AS "contactId", c."primaryPhone", c."suppressionState", n."id" AS "numberId", n."e164Number",
              v."id" AS "conversationId", v."serviceWindowExpiresAt"
       FROM "Contact" c
       JOIN "ChannelNumber" n ON n."workspaceId" = c."workspaceId"
       LEFT JOIN "Conversation" v ON v."contactId" = c."id" AND v."workspaceId" = c."workspaceId" AND v."channelNumberId" = n."id"
       WHERE c."workspaceId" = $1 AND c."id" = $2 AND n."id" = $3
       FOR UPDATE OF c`,
      [workspaceId, input.contactId, input.senderNumberId],
    );

    const row = target.rows[0];
    if (!row) throw new Error("Customer or sender number not found.");
    if (row.suppressionState === "OPTED_OUT") throw new Error("This customer has opted out of WhatsApp messages.");
    if (!input.contentSid && (!row.conversationId || !row.serviceWindowExpiresAt || new Date(String(row.serviceWindowExpiresAt)).getTime() <= Date.now())) {
      throw new Error("The WhatsApp customer service window is closed. Choose an approved Twilio WhatsApp template to continue the conversation.");
    }
    recipient = normalizeWhatsAppE164(String(row.primaryPhone));
    fromNumber = normalizeWhatsAppE164(String(row.e164Number || fromNumber));

    // Ensure conversation
    if (row.conversationId) {
      conversationId = String(row.conversationId);
    } else {
      const newConv = await client.query<Row>(
        `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelNumberId", "state", "lastMessageAt", "serviceWindowExpiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP)
         RETURNING "id"`,
        [randomUUID(), workspaceId, input.contactId, input.senderNumberId],
      );
      conversationId = String(newConv.rows[0].id);
    }

    messageId = randomUUID();
    await client.query(
      `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "messageType", "textBody", "idempotencyKey", "createdAt")
       VALUES ($1, $2, $3, $4, $5, 'OUTBOUND', 'QUEUED', 'text', $6, $7, CURRENT_TIMESTAMP)`,
      [messageId, workspaceId, conversationId, input.contactId, input.senderNumberId, renderedText, input.idempotencyKey],
    );

    await client.query(
      `UPDATE "Conversation" SET "lastMessageAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      [conversationId],
    );

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  // Call Twilio REST API
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const formBody = new URLSearchParams();
  formBody.append("From", `whatsapp:${fromNumber}`);
  formBody.append("To", `whatsapp:${recipient}`);
  if (input.contentSid) {
    formBody.append("ContentSid", input.contentSid);
    if (input.contentVariables && Object.keys(input.contentVariables).length) formBody.append("ContentVariables", JSON.stringify(input.contentVariables));
  } else formBody.append("Body", renderedText);

  const callbackUrl = input.statusCallbackUrl || (process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/twilio/status` : "");
  if (callbackUrl) formBody.append("StatusCallback", callbackUrl);

  let response: Response;
  let data: { sid?: string; status?: string; message?: string; code?: number };
  try {
    response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    data = await response.json() as typeof data;
  } catch (err) {
    // Network failure
    const updateClient = await pool.connect();
    try {
      await updateClient.query(`UPDATE "Message" SET "status" = 'FAILED', "failureCode" = 'TIMEOUT' WHERE "id" = $1`, [messageId]);
    } finally {
      updateClient.release();
    }
    throw new Error("Twilio request timed out. Check network connection.");
  }

  const updateClient = await pool.connect();
  try {
    if (response.ok && data.sid) {
      await updateClient.query(
        `UPDATE "Message" SET "status" = 'SENT', "platformMessageId" = $2, "sentAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        [messageId, data.sid],
      );
      return { id: messageId, platformMessageId: data.sid, status: "sent", duplicate: false };
    } else {
      const errCode = data.code ? `${data.code}${data.message ? `: ${data.message.slice(0, 180)}` : ""}` : `HTTP_${response.status}${data.message ? `: ${data.message.slice(0, 180)}` : ""}`;
      await updateClient.query(
        `UPDATE "Message" SET "status" = 'FAILED', "failureCode" = $2 WHERE "id" = $1`,
        [messageId, errCode],
      );

      const isBlockedSender = [63007, 63013, 63032, 21211, 21610, 21614].includes(Number(data.code))
        || /block|suspend|restrict|violation/i.test(data.message || "");

      if (isBlockedSender && workspaceId) {
        try {
          const failover = await triggerAgentNumberFailover({
            workspaceId,
            blockedNumberId: input.senderNumberId,
            reason: `TWILIO_${errCode}: ${data.message || "Number blocked or restricted"}`,
          });

          if (failover.success && failover.reallocated && failover.replacementNumber) {
            // Immediate retry with the newly assigned exclusive replacement number
            return await sendTwilioTextMessage({
              ...input,
              senderNumberId: failover.replacementNumber.id,
              idempotencyKey: `${input.idempotencyKey}-failover-${failover.replacementNumber.id}`,
              statusCallbackUrl: input.statusCallbackUrl,
            });
          }
        } catch {
          // If failover execution fails, proceed to throw original error
        }
      }

      throw new Error(`Twilio error: ${data.message || `HTTP ${response.status}`}`);
    }
  } finally {
    updateClient.release();
  }
}

/**
 * Handle incoming WhatsApp message received from Twilio webhook
 */
export async function processTwilioInboundMessage(params: Record<string, string>): Promise<{ conversationId: string; messageId: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  const toRaw = params.To || "";
  const fromRaw = params.From || "";
  const toE164 = normalizeWhatsAppE164(toRaw);
  const fromE164 = normalizeWhatsAppE164(fromRaw);
  const body = params.Body || "";
  const messageSid = params.MessageSid || params.SmsMessageSid || "";
  const profileName = params.ProfileName || null;
  const numMedia = parseInt(params.NumMedia || "0", 10);
  const mediaUrl0 = numMedia > 0 ? params.MediaUrl0 : null;

  if (!toE164 || !fromE164 || !messageSid) {
    client.release();
    throw new Error("Missing required Twilio webhook parameters (To, From, MessageSid).");
  }

  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);

    // 1. Locate the ChannelNumber matching the 'To' address
    const duplicate = await client.query<Row>(
      `SELECT "id", "conversationId" FROM "Message" WHERE "workspaceId" = $1 AND "platformMessageId" = $2 LIMIT 1`,
      [workspaceId, messageSid],
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return { conversationId: String(duplicate.rows[0].conversationId), messageId: String(duplicate.rows[0].id) };
    }

    // A repeated Twilio delivery must not increment unreadCount or extend the
    // customer service window. Reserve the provider SID before touching the
    // conversation so concurrent webhook retries remain idempotent as well.
    let numberRow = (
      await client.query<Row>(
        `SELECT "id", "workspaceId" FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "provider" = 'TWILIO' AND "e164Number" = $2 LIMIT 1`,
        [workspaceId, toE164],
      )
    ).rows[0];

    // If not found by exact string, search by digits
    if (!numberRow) {
      numberRow = (
        await client.query<Row>(
          `SELECT "id", "workspaceId" FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "provider" = 'TWILIO' AND regexp_replace("e164Number", '\\D', '', 'g') = $2 LIMIT 1`,
          [workspaceId, toE164.replace(/\D/g, "")],
        )
      ).rows[0];
    }

    // Do not silently create a sender. Admins must register and approve each Twilio sender.
    let channelNumberId = numberRow ? String(numberRow.id) : "";
    if (!channelNumberId) {
      throw new Error(`Inbound Twilio sender ${toE164} is not registered in this CRM workspace. Add it in Admin → WhatsApp numbers.`);
    }

    // 2. Find or Create Contact
    const existingContact = await client.query<Row>(
      `SELECT "id" FROM "Contact" WHERE "workspaceId" = $1 AND ("primaryPhone" = $2 OR regexp_replace("primaryPhone", '\\D', '', 'g') = $3) LIMIT 1`,
      [workspaceId, fromE164, fromE164.replace(/\D/g, "")],
    );

    let contactId = "";
    if (existingContact.rows.length) {
      contactId = String(existingContact.rows[0].id);
      if (profileName) {
        await client.query(
          `UPDATE "Contact" SET "displayName" = COALESCE("displayName", $3), "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "id" = $2`,
          [workspaceId, contactId, profileName],
        );
      }
    } else {
      const newContact = await client.query<Row>(
        `INSERT INTO "Contact" ("id", "workspaceId", "displayName", "primaryPhone", "updatedAt")
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT ("workspaceId", "primaryPhone") DO UPDATE SET "displayName" = COALESCE("Contact"."displayName", EXCLUDED."displayName"), "updatedAt" = CURRENT_TIMESTAMP
         RETURNING "id"`,
        [randomUUID(), workspaceId, profileName || "WhatsApp Customer", fromE164],
      );
      contactId = String(newContact.rows[0].id);

      await client.query(
        `INSERT INTO "ContactIdentifier" ("id", "workspaceId", "contactId", "type", "normalizedValue", "verified", "source")
         VALUES ($1, $2, $3, 'PHONE', $4, true, 'TWILIO_WHATSAPP')
         ON CONFLICT ("contactId", "type", "normalizedValue") DO NOTHING`,
        [randomUUID(), workspaceId, contactId, fromE164],
      );
    }

    // Auto-record opt-in on customer-initiated inbound communication (unless customer explicitly opted out)
    await client.query(
      `UPDATE "Contact"
       SET "suppressionState" = 'OPTED_IN', "suppressedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $1 AND "id" = $2 AND ("suppressionState" IS NULL OR "suppressionState" = 'UNKNOWN')`,
      [workspaceId, contactId],
    );
    await client.query(
      `INSERT INTO "ConsentRecord" ("id", "workspaceId", "contactId", "channel", "scope", "status", "evidenceSource", "wordingVersion", "capturedAt")
       VALUES ($1, $2, $3, 'WHATSAPP', 'WHATSAPP_MESSAGING', 'OPTED_IN', 'Inbound WhatsApp message', 'v1.0', CURRENT_TIMESTAMP)
       ON CONFLICT ("id") DO NOTHING`,
      [randomUUID(), workspaceId, contactId],
    );

    // 3. Find or Create Conversation
    const convResult = await client.query<Row>(
      `INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelNumberId", "state", "unreadCount", "lastMessageAt", "serviceWindowExpiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'OPEN', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP)
       ON CONFLICT ("contactId", "channelNumberId")
       DO UPDATE SET "id" = "Conversation"."id"
       RETURNING "id"`,
      [randomUUID(), workspaceId, contactId, channelNumberId],
    );
    const conversationId = String(convResult.rows[0].id);

    const reservation = await client.query<Row>(
      `INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "messageType", "textBody", "platformMessageId", "receivedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, 'INBOUND', 'SENT', 'text', $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("platformMessageId") DO NOTHING
       RETURNING "id"`,
      [randomUUID(), workspaceId, conversationId, contactId, channelNumberId, body || (mediaUrl0 ? "[Attachment]" : ""), messageSid],
    );
    if (!reservation.rows[0]) {
      await client.query("COMMIT");
      const existing = await client.query<Row>(`SELECT "id", "conversationId" FROM "Message" WHERE "platformMessageId"=$1 LIMIT 1`, [messageSid]);
      return { conversationId: String(existing.rows[0]?.conversationId ?? conversationId), messageId: String(existing.rows[0]?.id ?? "") };
    }
    await client.query(`UPDATE "Conversation" SET "unreadCount"="unreadCount"+1,"lastMessageAt"=CURRENT_TIMESTAMP,"serviceWindowExpiresAt"=CURRENT_TIMESTAMP+INTERVAL '24 hours',"state"='OPEN',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [conversationId]);

    // 4. Insert Inbound Message (Idempotent by platformMessageId)
    const mediaPayload = mediaUrl0 ? JSON.stringify({ mediaUrl: mediaUrl0, contentType: params.MediaContentType0 || "media" }) : null;
    const msgType = mediaUrl0 ? (params.MediaContentType0?.startsWith("image/") ? "image" : "document") : "text";

    await client.query(`UPDATE "Message" SET "messageType"=$2,"textBody"=$3,"media"=$4::jsonb WHERE "id"=$1`, [String(reservation.rows[0].id), msgType, body || (mediaUrl0 ? "[Attachment]" : ""), mediaPayload]);

    await client.query("COMMIT");
    return {
      conversationId,
      messageId: String(reservation.rows[0].id),
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Handle delivery status callbacks from Twilio (delivered, read, failed, undelivered)
 */
export async function processTwilioStatusCallback(params: Record<string, string>): Promise<boolean> {
  const messageSid = params.MessageSid || params.SmsSid;
  const status = (params.MessageStatus || params.SmsStatus || "").toLowerCase();
  const errorCode = params.ErrorCode || null;
  const errorMessage = params.ErrorMessage?.trim().slice(0, 180) || null;
  const providerError = errorCode && errorMessage ? `${errorCode}: ${errorMessage}` : errorCode;

  if (!messageSid || !status) return false;

  let dbStatus = "SENT";
  if (status === "delivered") dbStatus = "DELIVERED";
  else if (status === "read") dbStatus = "READ";
  else if (status === "failed" || status === "undelivered") dbStatus = "FAILED";
  else if (status === "queued" || status === "sending") dbStatus = "QUEUED";

  const pool = getPostgresPool();
  await pool.query(
    `UPDATE "Message"
     SET "status" = $2::"MessageStatus",
         "failureCode" = COALESCE($3, "failureCode"),
         "deliveredAt" = CASE WHEN $2 = 'DELIVERED' AND "deliveredAt" IS NULL THEN CURRENT_TIMESTAMP ELSE "deliveredAt" END,
         "readAt" = CASE WHEN $2 = 'READ' AND "readAt" IS NULL THEN CURRENT_TIMESTAMP ELSE "readAt" END
     WHERE "platformMessageId" = $1`,
    [messageSid, dbStatus, providerError],
  );

  // If status is failed/undelivered due to channel block, auto-failover the sender number
  if ((status === "failed" || status === "undelivered") && errorCode && [63007, 63013, 63032, 21211, 21610, 21614].includes(Number(errorCode))) {
    try {
      const msgRes = await pool.query<Row>(
        `SELECT "channelNumberId", "workspaceId" FROM "Message" WHERE "platformMessageId" = $1 LIMIT 1`,
        [messageSid],
      );
      if (msgRes.rows[0]) {
        await triggerAgentNumberFailover({
          workspaceId: String(msgRes.rows[0].workspaceId),
          blockedNumberId: String(msgRes.rows[0].channelNumberId),
          reason: `TWILIO_CALLBACK_CODE_${errorCode}`,
        });
      }
    } catch {
      // Non-blocking for webhook ack
    }
  }

  return true;
}

