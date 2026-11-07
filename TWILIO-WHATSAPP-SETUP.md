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
- Verified in Twilio Console on 2026-11-07: WhatsApp sender `+14432930029` (`XE585ede70d438d00e92e9c8477de0e89b`) is Online, high quality, and has no Messaging Service selected. Its sender-level incoming webhook is `https://crm.storeshop.biz/api/webhooks/twilio` using HTTP POST; its fallback URL is blank; its sender-level status callback is `https://crm.storeshop.biz/api/webhooks/twilio/status` using HTTP POST. This individual sender configuration supersedes the earlier pending note.
- Live inbound/outbound test: **Pending**
- Console page observed: **Messaging → WhatsApp Senders → sender details → Messaging Endpoint Configuration**. The individual sender webhook and status callback are set as above. Earlier **Conversations (classic) → Default Conversations Service → Integration** settings are separate and are not used by this sender because no Messaging Service is selected.
- CRM composer observed: customer has recorded opt-in; Reply mode is selected while the customer reply window is closed. The failed free-form message `hello` has Twilio error `63016`; use Template mode and send the approved Content SID rather than retrying the plain text.
- Template/account verification: Twilio Console shows the approved WhatsApp template `socialhive`, Content SID `HX7ffd3832d5e56cc794c764653474c7e8`, English, category Marketing, content type WhatsApp card, with two body placeholders and media/button content. The CRM's authenticated `/api/numbers` response confirms sender `Sales team` (`+14432930029`) is attached to the same Twilio Account SID shown in the template Console URL. The live `/api/twilio/templates?senderNumberId=244c77cc-46ec-48d6-b715-1e65010bc21d` response returned this template as `approved`, with placeholders `{{1}}` and `{{2}}`; the CRM inbox's Template composer also listed `socialhive · en` and displayed both variable inputs. Thus this approved template is visible in both the CRM API and UI; the earlier “No approved templates found” observation is stale. A second template, `greeting_message` (`HXcc7914c8e6b9cafe8cf2c1ba55e298be`), shows approval state **Received** in Twilio and is correctly excluded until WhatsApp marks it **Approved**.
- Current template support: the CRM composer sends the selected Content SID and entered body variables using Twilio's `ContentSid` and `ContentVariables` parameters. For this card template, enter values for `{{1}}` and `{{2}}`. The sent CRM timeline preview currently stores the rendered body text; the card's media/button rendering in the timeline has not been verified.
- Local code fix: also parse `approval_requests.status` from the `ContentAndApprovals` response, support pagination, and extract body text across content types. The local production build passes. Template API visibility has been confirmed live; the precise deployed revision has not been identified.
- Twilio Monitor → Messaging Logs observed inbound records from the CRM contact's WhatsApp phone to `+14432930029`, including message SID `SM9558c0af71fac25f066d0544e8bc889b`, status **Received**, and delivery step **TwiML Fetched** 1.26 seconds after receipt. A preceding inbound record was also **Received**. This proves Twilio received the inbound WhatsApp traffic and fetched a response from the configured webhook. The CRM Webhook Diagnostics page nevertheless showed no inbound message and no persisted events at inspection time. The handler verifies `X-Twilio-Signature` before persisting a Message, and unlike the Meta path it does not persist raw Twilio webhook events; inspect production app/database logs and the exact Twilio HTTP response to find why the inbound Message row is absent.
- Latest CRM Webhook Diagnostics recheck on 2026-11-07: one active number, no webhook backlog, queue depth 0, 0 failed of 3 messages in the last 24 hours, **no inbound message recorded**, and last outbound at 02:44:09. Persisted webhook-event counts remain zero; this page's event queue is primarily for the Meta path and does not record raw Twilio callbacks. The CRM contact conversation still has only the historic outbound timeline messages. This confirms the inbound absence persists after the earlier Twilio test; it does not identify whether production webhook processing, database persistence, or inbox retrieval is failing.
- Code fix pushed in commit `dbf4073a8fddfcff0d82908c9a24a5eb247ec07b`: Twilio status callback payloads can include `From`, `To`, and `MessageSid`, and incoming webhook payloads can include `MessageStatus`/`SmsStatus=received`. The shared handler now treats `received`/`receiving` with message identity as inbound, while other explicit lifecycle statuses are processed as delivery callbacks. It builds locally but is not confirmed deployed.
- Earlier Twilio Messaging Logs show outbound API messages to the same CRM contact marked **Read** and other sends marked **Delivered**; therefore basic outbound Twilio sends have worked historically. A send using the `socialhive` approved template and its status callback has not been verified end to end.
- Deployment status: `origin/main` contains the webhook fix commit `dbf4073a8fddfcff0d82908c9a24a5eb247ec07b` and the subsequent guide update `a217405757fd7f2eb25c86305cdef39544f9a184`. The repository has no checked-in automatic deployment workflow. Public HTTPS and a direct read-only HTTPS request to the historical origin both return HTTP 200 for the webhook GET route. SSH through the Cloudflare hostname times out; SSH to the historical origin rejects the existing laptop keys for the `jalal`, `root`, and `ubuntu` accounts. The logged-in DigitalOcean team has no Droplets and prompts for account setup/payment method, so it is not the production server account. Both laptop `.env.local` and `.env.production` point to `localhost:5432/whatsapp_crm`; PostgreSQL reports that the configured role `crm_user` does not exist, so these laptop files are not usable production database access. The current production revision and deploy credentials remain unavailable; do not add a payment method or deploy through an unrelated account.
- Live inbound/outbound delivery remains unverified. The inbound test message is present in Twilio but absent from the CRM message timeline and the CRM's `lastInboundAt` diagnostic. No CRM-originated WhatsApp template was sent; `socialhive` is a Marketing template that promotes SocialHive AI. Before using it as a delivery test, select an authorized recipient and confirm the customer-facing message is intended. For inbound verification, send another WhatsApp message to `+14432930029` and compare its Twilio log and webhook response with CRM Webhook Diagnostics and the inbox after production is updated with the local fix and server-side logging can be inspected.
- Last verified: **2026-11-07** (sender-level Twilio configuration, CRM diagnostics, template visibility)
- Reports error diagnosed on 2026-11-07: the team workload query selected `User.role`, but workspace roles are stored in `WorkspaceUser.role`. This invalid column made the all-or-nothing Reports load fail even though other admin screens could read PostgreSQL. Fixed in commit `a7ecc2f` and pushed to `main`; the production deployment is still pending because the server/DB access described above is unavailable and there is no checked-in auto-deploy workflow. Also fixed Twilio inbound duplicate-SID handling so repeated callbacks reserve the message SID before incrementing unread count or refreshing the customer service window. This code fix is not yet verified in production.
- Code pushed to `main` on 2026-11-07: `ea18284` prevents duplicate Twilio sends when the same idempotency key is retried, correlates a fast status callback only when exactly one recent message matches sender and recipient, and preserves higher/final delivery states when callbacks arrive out of order. Uncorrelated status callbacks now receive a retryable HTTP 503; lifecycle values the CRM does not model are acknowledged to avoid endless retries. `35c6041` updates the shared admin navigation to the shadcn Sidebar. A local production build passed after these changes. The production release was not directly verified; this repository has no checked-in auto-deployment workflow and the production host access described above remains unavailable.
- Authenticated Reports page observation on 2026-11-07: the CRM displayed live database data (1 contact, 1 active conversation, 2 inbound and 9 outbound messages in the selected seven-day view; the 24-hour delivery panel showed 7 outbound, 6 confirmed delivered, 0 failed, and 0 webhook backlog). This confirms the Reports API can read persisted message data, but does not prove that the specific recent Twilio inbound test is visible in the correct conversation, nor that the approved `socialhive` template has been sent successfully from the CRM. Production verification of those two flows is still pending.

## Official Twilio references

- [Programmable Messaging](https://www.twilio.com/docs/messaging)
- [WhatsApp quickstart: send and receive](https://www.twilio.com/docs/whatsapp/quickstart)
- [Incoming message webhook request](https://www.twilio.com/docs/messaging/guides/webhook-request)
- [Outbound message status callbacks](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks)
- [WhatsApp message templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
