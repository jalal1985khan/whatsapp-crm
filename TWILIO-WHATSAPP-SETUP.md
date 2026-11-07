# Twilio WhatsApp setup and operations

Reference guide for configuring Twilio WhatsApp senders with the Relay CRM at `https://crm.storeshop.biz`. Keep this file with the project and update the verification date after each production configuration change. Never put an Auth Token, API secret, database password, or customer message into this document.

## Current application endpoints

Configure all URLs with HTTPS and the HTTP `POST` method:

| Purpose | URL | What it does |
| --- | --- | --- |
| Incoming WhatsApp messages | `https://crm.storeshop.biz/api/webhooks/twilio` | Receives Twilio form payloads, verifies `X-Twilio-Signature`, and stores inbound messages in PostgreSQL. |
| Outbound delivery status (recommended) | `https://crm.storeshop.biz/api/webhooks/twilio/status` | Receives status changes for sent messages and updates their CRM lifecycle state. |

Both endpoints also answer `GET` with a simple active message as a basic reachability check. A successful GET does **not** prove that Twilio is configured to call the webhook, that POST signature verification succeeds, or that the CRM can write to PostgreSQL.

## Twilio Console configuration

Repeat this for every WhatsApp sender connected to the CRM.

1. In Twilio Console, select the correct account or subaccount that owns the WhatsApp sender.
2. Open **Messaging → Senders → WhatsApp Senders** (Console labels can vary). Select the sender. Do not use **Conversations (classic) → Settings → Defaults** for this CRM's inbound webhook: that is a separate Conversations product configuration.
3. In its incoming-message configuration, set **WHEN A MESSAGE COMES IN** to `https://crm.storeshop.biz/api/webhooks/twilio`, method **HTTP POST**.
4. Save the sender configuration.
5. In the CRM, open **Admin → WhatsApp Numbers** and confirm that this sender is attached to the same Twilio account and that the number is active.
6. Configure the outgoing status callback for messages as `https://crm.storeshop.biz/api/webhooks/twilio/status`. The CRM passes this callback when creating outbound messages; if using a Twilio Messaging Service, check that service's status callback configuration too.
7. Confirm that the sender is WhatsApp-enabled/approved and belongs to the account being used by the CRM. A plain SMS-capable Twilio number is not automatically a WhatsApp sender.

Do not configure Twilio to call a development `localhost` address. Twilio needs a public HTTPS endpoint. If the application is behind a reverse proxy, it must forward the original public host and HTTPS protocol correctly; the CRM also uses `APP_BASE_URL` when verifying webhook signatures.

## Twilio credentials in the CRM

Prefer adding credentials through the CRM's **Admin → WhatsApp Numbers → Twilio account** form. The form validates the Account SID/Auth Token against Twilio and stores the Auth Token encrypted in PostgreSQL using `SESSION_SECRET`.

- Use the Account SID for the account that owns the sender.
- Never put a token in source code, a chat message, screenshots, or this guide.
- Keep `SESSION_SECRET` stable. Changing it makes previously encrypted Twilio credentials unreadable; re-enter credentials if it changes.
- Keep `DATABASE_URL` pointed at the production PostgreSQL database. Durable inbox history, account credentials, and webhook processing depend on it.
- API keys can be used for API authentication, but this CRM's stored-account UI currently expects an Account SID and Auth Token.

## Deploying the current CRM code

The project deployment script targets a DigitalOcean host at `/var/www/html/crm/whatsapp-crm`. It pulls `origin main`, installs dependencies, applies migrations, builds, and reloads PM2. Local code changes do not affect the live CRM until they are committed/pushed and deployed.

Before deploying, ensure the production host has the correct `DATABASE_URL`, stable `SESSION_SECRET`, and `APP_BASE_URL=https://crm.storeshop.biz`. Run the project deployment process, then check the application/PM2 logs and webhook event health in **Admin → Webhooks**. Do not run a deployment against a different database or environment.

## WhatsApp messaging rules

- After a customer sends a message, the business can send free-form replies during the 24-hour customer service window measured from the customer's latest message.
- Outside that window, initiate/reopen contact with an approved WhatsApp template. In this CRM, choose **Template** in the composer and select an approved Twilio Content template for the selected sender/account.
- The app checks template approval and variables before sending. A free-form message failure with Twilio error `63016` means a template is required; changing numbers or repeatedly retrying the same free-form text does not resolve that rule.
- Respect customer opt-outs and consent records. Do not use number failover to bypass a WhatsApp sender restriction, customer opt-out, or template requirement.

## Verification checklist

1. Visit the two endpoint URLs above in a browser. They should return their respective active messages. This only verifies public GET reachability.
2. In Twilio Console, check **Monitor → Logs → Messaging** for the expected sender and destination. Inspect failed message error codes and delivery status details.
3. In the CRM, check **Admin → Webhooks** for recent inbound/status webhook events and failures.
4. Have an authorized WhatsApp user send a real inbound message to the configured business sender. Confirm the message appears in Twilio logs and then in the CRM conversation. This live test sends/receives a customer message and should be coordinated with the account owner.
5. Reply in the CRM while the customer's 24-hour window is open. Confirm the outgoing Twilio record and subsequent status callback.
6. For a closed window, use an approved template and confirm its result in both Twilio logs and the CRM.

## Troubleshooting map

| Symptom | Check |
| --- | --- |
| Inbound message appears in Twilio but not CRM | Correct sender's incoming webhook URL/method; public HTTPS reachability; PostgreSQL connectivity; `Admin → Webhooks`; app logs; signature URL/proxy headers and `APP_BASE_URL`. |
| Webhook returns 401 | Twilio signature or AccountSid missing/invalid, the Twilio account is not registered in CRM, token is wrong, or the URL used for signature verification differs from the public URL Twilio called. |
| Webhook returns 503 | CRM cannot access its PostgreSQL credential store or database is not configured/available. |
| Webhook returns 500 | Inspect CRM server logs and webhook event details; processing or database write failed. Twilio may retry according to its webhook behavior. |
| Outbound message fails with 63016 | Customer service window is closed; use an approved template. |
| Outbound message is undelivered | Open the message in Twilio Monitor logs and use its specific error code and detail; do not assume the number is blocked. Check WhatsApp sender approval, recipient format, template state, opt-in, and account balance as applicable. |
| Status remains queued/sent | Confirm the status callback was supplied/configured and reachable; inspect Twilio webhook logs and CRM webhook health. |
| Approved template exists in Twilio but is missing from CRM | In the CRM select **Template** (not Reply); confirm the currently selected CRM sender belongs to the same Twilio account that owns the Content SID; confirm production has `/api/twilio/templates` deployed; check browser Network/server logs for `401` (session), `409` (sender credentials), `502` (Twilio Content API/auth/API), or `503` (database/credential store). Twilio's `ContentAndApprovals` response exposes approval state under `approval_requests`; the CRM lookup has been updated locally to read that field and still accepts `approvals.whatsapp` variants. Twilio templates are account-scoped. |
| Template panel loads but send fails | Confirm the selected template's Content SID begins `HX`, its WhatsApp approval is still `Approved` (not paused/disabled), all variables are filled, the sender is WhatsApp-enabled on the same Twilio account, and inspect the exact Twilio error in Monitor → Logs → Messaging. |

## Configuration record

- Production base URL: `https://crm.storeshop.biz`
- Inbound webhook: `POST /api/webhooks/twilio`
- Status callback: `POST /api/webhooks/twilio/status`
- Verified in Twilio Console: **Integration page saved and URLs visible**; sender association and sender-level webhook still pending
- Live inbound/outbound test: **Pending**
- Console page observed: **Messaging → Default Messaging Service for Conversations → Integration**. **Send a webhook** is selected with the inbound URL set to `https://crm.storeshop.biz/api/webhooks/twilio` using HTTP POST; the delivery status callback is set to `https://crm.storeshop.biz/api/webhooks/twilio/status`. Twilio displayed a successful-save confirmation. The fallback URL is blank.
- CRM composer observed: customer has recorded opt-in; Reply mode is selected while the customer reply window is closed. The failed free-form message `hello` has Twilio error `63016`; use Template mode and send the approved Content SID rather than retrying the plain text.
- CRM template lookup observed: the live CRM currently displays **No approved WhatsApp templates found**. The current sender/account mapping and Twilio Content API response still need verification. The application uses the Twilio account attached to the selected sender, so a template in a different Twilio account will not appear.
- Local code fix: parse `approval_requests.status` from the documented `ContentAndApprovals` response, in addition to the older WhatsApp approval aliases; the live CRM will continue to show the old behavior until the change is deployed.
- Deployment blocker: SSH to `crm.storeshop.biz` on port 22 timed out during the deployment check. DigitalOcean's dashboard is not signed in in the available browser session. The source change has not been pushed or deployed; production remains unchanged.
- Sender Pool membership and the WhatsApp sender's individual webhook configuration have not been verified. The Messaging Service Integration URL being correct does not prove that the CRM's sender is attached to that service or that the individual sender uses that service's webhook.
- Live inbound/outbound delivery remains unverified. The user must send an inbound WhatsApp test to the configured sender, then CRM delivery should be checked against Twilio Monitor logs and **Admin → Webhooks**.
- Last verified: **2026-11-07** (Messaging Service Integration settings and live CRM composer observed)

## Official Twilio references

- [Programmable Messaging](https://www.twilio.com/docs/messaging)
- [WhatsApp quickstart: send and receive](https://www.twilio.com/docs/whatsapp/quickstart)
- [Incoming message webhook request](https://www.twilio.com/docs/messaging/guides/webhook-request)
- [Outbound message status callbacks](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks)
- [WhatsApp message templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
