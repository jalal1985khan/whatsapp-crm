# Product Requirements Document: Multi-Number WhatsApp CRM

**Status:** Draft v1.1  
**Prepared:** 20 October 2026  
**Product type:** Web application  
**Working name:** Relay CRM (product names may not include "WhatsApp" under Meta's brand guidelines)  

## 1. Executive summary

Build a web CRM with a WhatsApp-style shared inbox where a business team can manage customer records and WhatsApp conversations from one place. Authorized administrators can connect, approve, label, activate, pause, and order multiple business phone numbers. The CRM keeps a durable customer record and a unified internal message timeline across all connected numbers.

If a sender number becomes unavailable, the CRM can mark it unavailable and route eligible future outbound messages through the next administrator-approved, healthy number. The CRM’s continuity promise is internal: customer data and history remain visible to the team. Number switching does not transfer a WhatsApp conversation or make messages addressed to one number arrive at another number.

The product integrates with the official WhatsApp Business Platform (Meta Cloud API directly for the initial integration). The CRM owns its data model, inbox, routing, audit trail, and admin experience; Meta remains the authority for WhatsApp account/number provisioning, message acceptance, and enforcement.

## 2. Product vision and goals

### Vision

Give a business team one reliable workspace to manage customer conversations and records, even when the business uses multiple WhatsApp sender numbers or needs to change the active sender.

### Goals

1. Provide a shared inbox familiar to users of WhatsApp Web, with CRM capabilities around it.
2. Keep customers, conversations, and message history in a first-party database controlled by the business.
3. Let authorized admins onboard and manage several approved WhatsApp business numbers.
4. Route messages by selected number, team, policy, and availability, with understandable failover behavior.
5. Make it clear which business number sent or received every message.
6. Support manual human communication and auditable operational controls.
7. Reduce data loss and service interruption through durable storage, webhook processing, retries, and backups.

### Non-goals for v1

- Recreating the WhatsApp consumer client or supporting personal WhatsApp accounts / unofficial QR-session automation.
- Evading restrictions, bans, messaging limits, or policy enforcement by rotating numbers.
- Guaranteeing that a blocked number’s incoming messages are delivered to another number.
- Moving or merging WhatsApp-side chat threads between phone numbers.
- Full marketing automation, campaigns, bulk blasts, chatbot builder, commerce/catalog, payments, or WhatsApp voice calling.
- Replacing Meta’s account provisioning, verification, message templates, or policy review.
- Supporting multiple messaging channels in the initial release (SMS/email may be added later as separate channels).

## 3. Users and roles

### Primary user: Support / sales agent

Needs to see assigned and unassigned chats, quickly understand customer context, reply from the correct sender number, and record outcomes without losing history.

### Team lead / supervisor

Needs team queues, assignment and reassignment, SLA visibility, quality oversight, and ability to help with escalations.

### Workspace administrator

Owns workspace configuration, user access, connected WhatsApp numbers, routing rules, templates, data retention, and operational alerts.

### Owner / auditor

Needs workspace-level visibility, export and audit access, and reliable evidence of who changed numbers, routing, or customer data.

### Role permissions (baseline)

| Capability | Agent | Supervisor | Admin | Owner |
|---|---:|---:|---:|---:|
| View permitted inbox queues | Yes | Yes | Yes | Yes |
| Reply to a conversation | Yes | Yes | Optional | Optional |
| Assign / reassign chats | Own chats | Team chats | All chats | All chats |
| Manage contacts and notes | Limited | Team scope | All | All |
| Add / activate / pause numbers | No | No | Yes | Yes |
| Change routing and failover | No | No | Yes | Yes |
| Manage users and roles | No | No | Yes | Yes |
| Export data / view audit log | No | Limited | Yes | Yes |
| Delete workspace / set retention | No | No | No | Yes |

Permissions must be configurable within safe defaults. Every sensitive action is audited.

## 4. Product principles

- **One customer record, many conversations:** Identity and history are CRM concepts; a WhatsApp sender number is a channel endpoint.
- **Explicit sender identity:** Every message and conversation displays the number used.
- **No silent data loss:** Persist inbound webhook events before downstream processing and expose delivery/error states.
- **Failover is controlled:** Routing only uses numbers approved by admins and shown as operationally eligible. Do not repeatedly retry other numbers for policy or recipient errors.
- **No false continuity claim:** The CRM unifies its own records; it cannot redirect customer messages sent to another phone number.
- **Human-readable failure:** When automatic action is unsafe or ambiguous, pause and alert an operator instead of rotating senders blindly.
- **Business-owned access:** Connect numbers under a business-controlled Meta Business Portfolio/WABA with a documented admin recovery process.

## 5. Scope and assumptions

### Initial platform

- Responsive desktop-first web app, with mobile-friendly inbox for basic review/replies.
- One workspace per business organization in the initial release; design data isolation for future multi-tenant SaaS.
- Official Meta WhatsApp Business Platform Cloud API, using business-controlled Meta assets and OAuth/Embedded Signup or supported direct onboarding.
- A number may be attached to a customer conversation as its channel endpoint; the same contact may have conversation threads on multiple numbers.
- The CRM stores message content and relevant metadata under a disclosed privacy policy and retention configuration.
- **Mandatory frontend UI standard:** Build the application UI with **shadcn/ui**. This is a product implementation requirement, not an optional styling suggestion.

### Assumptions to validate during technical discovery

1. Which countries and number types will be supported at launch, and whether local virtual numbers are eligible for Meta verification.
2. Meta’s current account structure, number limits, onboarding flow, quality/status signals, messaging pricing, and webhook subscriptions at implementation time.
3. Whether each workspace will connect a Meta-owned WABA directly or use a Meta-approved integration partner for onboarding only. The product does not rely on a partner’s inbox or database.
4. Whether inbound history can be imported from any existing source. Default assumption: only messages received/sent through this CRM after connection are guaranteed to be stored; prior chat history import is not promised.
5. Applicable privacy, data-residency, consumer-protection, and retention requirements for operating locations.

## 6. Core concepts and terminology

- **Workspace:** Organization boundary for people, settings, customers, and channels.
- **WhatsApp Business Account (WABA):** Meta business asset that owns/organizes connected WhatsApp numbers.
- **Number / channel:** A verified WhatsApp sender endpoint connected to the CRM.
- **Contact:** CRM customer profile, potentially associated with one or more normalized phone numbers.
- **Conversation:** CRM thread for a contact and a channel endpoint. Multiple threads may be grouped into one contact timeline.
- **Unified timeline:** CRM view combining messages/events from the contact’s conversations across connected numbers.
- **Routing rule:** Determines which eligible channel is used for a new outbound conversation or reply.
- **Failover:** Routing to another approved healthy number after a confirmed sender-level failure, subject to rules and operator settings.
- **Template:** Meta-approved WhatsApp message template, including language and category, used when required by WhatsApp policy.

## 7. Key user journeys

### 7.0 Admin authentication and account recovery

1. Workspace owner/admin opens the CRM sign-in page and enters their registered email and password, or uses an explicitly configured identity provider.
2. The app validates credentials, applies rate limiting and suspicious-login checks, and requires MFA for admin/owner accounts before granting access to protected admin features.
3. First-time admin is prompted to enroll an authenticator app or another supported MFA factor, save recovery codes, and confirm the workspace identity.
4. Successful login creates a secure session, directs the user to the last visited inbox/workspace, and records a security audit event without logging secrets.
5. “Forgot password” sends a time-limited, single-use reset link to the verified email. The reset page does not reveal whether an email is registered. Existing sessions may be revoked after a password reset.
6. “Lost access to MFA” uses recovery codes or an owner-assisted identity verification and recovery workflow. Recovery is audited and may trigger a cooling-off period before number/routing administration is re-enabled.
7. Users can view and revoke active sessions, change password, enroll/replace MFA, and sign out. Admin role changes and account deactivation take effect promptly across sessions.

The login experience must not allow account recovery to bypass workspace authorization or Meta asset ownership checks. A CRM admin login grants access to CRM controls; it does not itself grant access to the underlying Meta Business Portfolio.

### 7.1 Admin creates workspace and connects first number

1. Admin creates workspace, enters business profile and timezone, and accepts data-processing/privacy setup.
2. Admin connects the business’s Meta assets through the official supported flow.
3. Admin selects or creates the relevant WABA, verifies a phone number, and grants the necessary permissions.
4. CRM receives number metadata and status; admin gives it a display label, e.g. “Main Support – India”.
5. CRM subscribes to required webhook events and verifies webhook authenticity.
6. Admin sends/receives a test message or completes a connection health check.
7. Number enters **Active** only after onboarding, webhook and send eligibility checks succeed.

### 7.2 Admin adds and approves additional numbers

1. Admin starts “Add number” from Channels.
2. The flow verifies business ownership/authorization and Meta onboarding for that number.
3. CRM validates that the number is not already attached to another incompatible integration, where the platform exposes this.
4. Admin sets label, purpose, teams, default eligibility, allowed use cases and priority order.
5. Admin reviews the status and confirms activation.
6. CRM records who connected/approved it and when.

Only admins/owners can activate a number or include it in automatic failover. A connected-but-unapproved number must never send messages.

### 7.3 Agent works a conversation

1. Agent opens the inbox and sees queue, customer, latest message, unread state, assignment, tags and sender number.
2. Agent opens the conversation and sees the channel-specific thread plus a collapsible contact-wide timeline.
3. Agent replies. The composer displays the sender number prominently and follows the active WhatsApp service-window/template rules.
4. CRM persists an outbound message as **Pending** before API dispatch; then updates it to **Sent**, **Delivered**, **Read**, or **Failed** from callbacks.
5. Agent can prepare a new send after a provider-confirmed rejection, subject to current consent, routing, sender eligibility and service-window/template checks. A pending or unknown outcome cannot be resent until delivery status is reconciled.
6. All assignments, notes, status changes and sender changes are reflected in the activity log.

### 7.4 Number becomes unhealthy; automatic failover

1. CRM receives a platform status event or observes a definitive sender-level API failure.
2. CRM classifies the event (sender unavailable, temporary network/API issue, quality warning, recipient issue, template/policy issue, account-wide restriction, unknown).
3. For a definitive **number-level send unavailability**, CRM marks the number **Degraded** or **Paused** and alerts admins.
4. If workspace automatic failover is enabled, CRM selects the next approved, active, compatible number according to routing priority and policy checks.
5. CRM retries the failed message only when the error is classified as safe-to-retry and the API outcome is known to be non-accepted. For unknown outcomes, CRM holds the message for status reconciliation; it does not issue another provider send.
6. Subsequent eligible messages use the backup number. An operator-visible audit event records the switch, cause and affected messages.
7. Optional customer notification is a separate, policy-checked action and is **not sent automatically by default**. Admin may enable it only for configured cases/templates where permitted; otherwise agent/admin receives a prompt to notify through an allowed channel.
8. If the condition suggests WABA/business-level restriction, CRM pauses all numbers under that scope and escalates; it does not rotate numbers to bypass enforcement.

### 7.5 Customer changes to a different number

When a customer contacts Number 2, CRM matches the phone number to the existing contact and opens or creates the Number 2 conversation. The contact profile shows both threads in one timeline. The CRM cannot make a message addressed to Number 1 arrive on Number 2.

### 7.6 Admin exports customer record

Admin selects scope and export format. CRM includes contact data, message timestamps, direction, channel number, platform message IDs, delivery states, assignments and notes, subject to role access and retention/deletion rules. Export is audited and protected from public link sharing.

## 8. Functional requirements

Priority meanings: **P0** required for initial usable release; **P1** important follow-up; **P2** later enhancement.

### 8.1 Authentication, workspace and access

- **FR-001 (P0):** Provide sign-in with verified email and password, plus an identity-provider option only when explicitly configured by the workspace.
- **FR-001a (P0):** Provide forgot-password flow using single-use, expiring links; responses must not disclose whether an account exists.
- **FR-001b (P0):** Require MFA for admin/owner accounts before production number activation or changes to routing/failover. Support enrollment, recovery codes, factor replacement and audited recovery.
- **FR-001c (P0):** Provide session list/revocation, sign-out, password change and prompt revocation of sessions after credential reset or role removal.
- **FR-001d (P0):** Apply login rate limits, secure password reset controls, session expiration, CSRF protection and generic authentication errors.
- **FR-002 (P0):** Workspace owner can invite, deactivate and assign roles to team members.
- **FR-003 (P0):** Enforce workspace-level authorization on every API and data query.
- **FR-004 (P0):** Support MFA for admins/owners or require it before production number activation.
- **FR-005 (P1):** SSO, SCIM provisioning and granular custom roles.
- **FR-006 (P0):** Audit log records actor, timestamp, action, target, source IP/device where lawful, and before/after values for sensitive configuration.

### 8.2 Number/channel administration

- **FR-010 (P0):** Admin can connect official WhatsApp Business Platform numbers through a supported Meta flow.
- **FR-011 (P0):** Admin can label, activate, pause, archive, and reorder connected numbers.
- **FR-012 (P0):** Show number, display name, WABA/Meta asset reference, connection status, last event time, messaging eligibility where available, quality/status signal where available, and error details.
- **FR-013 (P0):** Require explicit admin approval before a number is used for normal routing or failover.
- **FR-014 (P0):** Configure a default number, backup priority, permitted teams, permitted conversation types, and fallback mode per number.
- **FR-015 (P0):** Prevent accidental deletion; deactivation requires confirmation and explains impact. Keep CRM message history even after channel disconnection.
- **FR-016 (P1):** Admin can test webhook and send connectivity with an approved test recipient and show diagnostic result.
- **FR-017 (P1):** Support connection ownership/re-authentication and token expiry alerts without exposing access tokens.
- **FR-018 (P1):** Show number-level usage/cost estimates from available billing data; clearly label estimates.

### 8.3 Inbox and conversations

- **FR-020 (P0):** Shared inbox with filters: All, Unassigned, Mine, Team, Open, Waiting, Resolved, Failed, and number/channel.
- **FR-021 (P0):** Conversation list displays customer name/number, last message preview, timestamp, unread count, assignment, tags, status and channel label.
- **FR-022 (P0):** Conversation view presents messages in chronological order with delivery/read status, timestamps and sender number.
- **FR-023 (P0):** Contact-wide timeline combines conversations and CRM events across all channels/numbers while preserving thread boundaries.
- **FR-024 (P0):** Agents can assign/reassign conversations, set status, add internal notes, and apply tags.
- **FR-025 (P0):** Composer supports text and supported media/document types, within platform constraints; preview attachment and show upload/send state.
- **FR-026 (P0):** Clearly show active sender number before send; allow sender selection only from approved eligible numbers and only for roles authorized by admin.
- **FR-027 (P0):** Enforce policy-aware composer: service-window state, approved template requirement, template selection, variable validation and recipient eligibility checks as available.
- **FR-028 (P0):** Persist inbound and outbound messages independently of UI state; de-duplicate webhook deliveries.
- **FR-029 (P0):** Search contacts and messages by phone/name/text/date/number and filter by assigned team, tags and state.
- **FR-030 (P1):** Canned replies, template library, keyboard shortcuts and saved inbox views.
- **FR-031 (P1):** Contact merge/split tools with preview and audit log; avoid automatic merges based only on ambiguous names.
- **FR-032 (P1):** SLA indicators, first-response time and queue age.

### 8.4 Contacts and CRM data

- **FR-040 (P0):** Contact profile includes normalized phone number(s), display name, custom fields, tags, owner, consent/opt-in evidence, source, notes and created/updated times.
- **FR-041 (P0):** Store append-only explicit consent records: scope, wording/version, collection channel, timestamp, evidence/source, actor and revocation. Enforce the latest applicable WhatsApp consent before every outbound send; unknown and opted-out contacts are suppressed.
- **FR-042 (P0):** Match incoming sender phone to contact; if none exists, create a contact and mark unverified/unknown fields.
- **FR-043 (P0):** Support duplicate detection and admin-assisted merge while preserving original IDs and message references.
- **FR-044 (P1):** Custom fields and configurable customer segments.
- **FR-045 (P1):** Contact import with validation, duplicate preview, consent metadata requirements, and import audit.

### 8.5 Routing and failover

- **FR-050 (P0):** Admin defines deterministic routing: default channel, per-team channel, per-region/brand/customer segment rules, and priority order.
- **FR-051 (P0):** Admin can enable/disable automatic failover, define eligible failure classes, maximum retry attempts, cooldown, and whether human approval is required.
- **FR-052 (P0):** Failover only considers numbers that are connected, approved, active, compatible with the recipient/use case, and not restricted by known status.
- **FR-053 (P0):** Never automatically switch on a quality warning alone; notify admin and optionally require manual confirmation.
- **FR-054 (P0):** Never fail over to evade account/business-level enforcement. If an account-wide event or ambiguous enforcement failure is detected, halt automatic sends and alert admin.
- **FR-055 (P0):** Classify failures into transient, permanent recipient, sender-number, WABA/business-level, policy/template, authentication/configuration, and unknown; unknown is hold-for-review.
- **FR-056 (P0):** Protect against duplicate message sends using idempotency keys, provider message IDs, and reconciliation for ambiguous API timeouts.
- **FR-057 (P0):** Record failover event with old/new number, reason, time, rule version, triggering API response/event and resulting delivery state.
- **FR-058 (P0):** Show banner in conversation when active sender differs from prior thread’s number; offer internal prompt to notify customer but do not imply automatic delivery redirection.
- **FR-059 (P1):** Admin-configurable customer transition notification templates, with policy validation and approval workflow. Default off. Make target number and sending channel explicit.
- **FR-060 (P1):** Manual reroute of a conversation to a new number with confirmation, preview of customer-facing sender, and audit event.

### 8.6 Messaging and templates

- **FR-070 (P0):** Use official Cloud API endpoints for outbound messages and webhooks for inbound messages and delivery states.
- **FR-071 (P0):** Track message lifecycle: queued, sending, sent/accepted, delivered, read, failed, canceled, and unknown/reconciliation-needed.
- **FR-072 (P0):** Support approved templates by name, language, category and version; validate required variables before dispatch.
- **FR-073 (P0):** Record opt-in evidence and support opt-out/suppression state at contact/channel scope. The inbox must display the current state and history; unknown/opted-out states disable sending while internal notes remain available.
- **FR-074 (P0):** Respect service-window/template requirements and applicable WhatsApp messaging policies; policy logic must be configurable to match current platform requirements.
- **FR-075 (P0):** Inbound webhook processing validates signature, stores raw event securely, acknowledges promptly, then processes asynchronously.
- **FR-076 (P0):** Apply bounded exponential backoff to retryable CRM-owned work such as webhook and media processing. For outbound message requests, automatically retry only when the provider response definitively confirms non-acceptance and the specific failure has validated retry semantics. Network timeouts, connection resets after dispatch, HTTP 5xx responses, malformed responses and other ambiguous outcomes must enter reconciliation and must not be resent automatically. An MFA-verified Owner/Admin may create one new outbound send per confirmed failed message, with current consent, sender, routing, service-window/template, and policy checks; preserve and audit both attempts. Stale retry claims must transition to review and must not be automatically resent.
- **FR-077 (P1):** Media storage supports malware scanning, signed URL access, retention controls and access logging.
- **FR-078 (P1):** Template status changes and quality events are reflected in admin console.

### 8.7 Notifications and operations

- **FR-080 (P0):** In-app alerts for number disconnect/restriction, webhook outage, token/auth failure, message backlog, and failover.
- **FR-081 (P0):** Admin can configure email alerts for critical events.
- **FR-082 (P0):** Health dashboard shows active numbers, last inbound/outbound event, webhook lag, queue depth, failure rate and recent failovers.
- **FR-083 (P1):** Operational incident timeline and downloadable diagnostic bundle excluding secrets and unnecessary customer content.

### 8.8 Data rights and governance

- **FR-090 (P0):** Admin can export a contact’s data and conversation history in a usable format.
- **FR-091 (P0):** Support configurable retention and deletion workflows; honor legal holds where applicable.
- **FR-092 (P0):** Deletion removes or anonymizes data across primary DB, search index, caches and media storage according to documented deletion schedule.
- **FR-093 (P0):** Encrypt sensitive data in transit and at rest; secrets in managed secret storage.
- **FR-094 (P1):** Workspace data residency selection and customer-managed encryption keys where supported.

## 9. Failover policy specification

### 9.1 States

Each number has one CRM operational state:

- **Pending setup:** Onboarding not complete.
- **Active:** Approved and eligible for configured routing.
- **Degraded:** Connected but warning/quality issue; may be excluded from automatic routing.
- **Paused:** Admin disabled it or system paused after a definitive issue.
- **Restricted:** Platform reports restriction or sender cannot send; failover action depends on scope.
- **Disconnected:** Authorization/registration/webhook link is unavailable.
- **Archived:** Retained for history, not routable.

CRM state is an interpretation of Meta signals plus admin decisions; UI must identify the source and freshness of status.

### 9.2 Safe failover trigger matrix

| Signal/failure | Default CRM response | Automatic alternate sender? |
|---|---|---:|
| Explicit sender number disabled/unregistered | Pause that number; alert admin | Yes, only if platform confirms number-level scope and other sender is healthy |
| WABA/business account restricted | Pause affected WABA scope; alert owner/admin | No |
| Quality rating falls/warning | Mark degraded; alert admin; optionally reduce route priority | No by default |
| Temporary API/network timeout before confirmed acceptance | Retry same number with idempotency/reconcile | No immediate number switch |
| API timeout with unknown acceptance | Reconcile status; hold if ambiguous | No until duplicate risk cleared |
| Recipient invalid/blocked/opted out | Mark message/contact issue | No |
| Template rejected, missing, or policy error | Hold message; notify agent/admin | No |
| Auth token revoked/permission problem | Pause affected integration and alert admin | No, unless another separately authorized integration is intentionally configured |
| Unknown error | Hold for review; preserve error details | No |

### 9.3 Number-change notification

- Not automatic by default.
- If enabled, use a pre-approved, policy-compliant template or other allowed message path.
- Must truthfully say which business number is now used and request the customer to reply/contact it where needed.
- CRM must not claim that the customer’s old chat was transferred.
- Avoid duplicate notifications; log recipient, source number, destination number, template/version, consent basis, send status and suppression decision.
- Provide non-WhatsApp contact routes as an optional admin-authored footer/CTA.

## 10. Information architecture and screens

1. **Sign in / workspace selection** — email/password, configured SSO, MFA challenge, forgot password, recovery and session security settings.
2. **Inbox** — conversation list, search/filters, selected chat, customer profile panel.
3. **Contact profile** — identity, fields, consent, notes, unified timeline, conversation threads.
4. **Channels / WhatsApp numbers** — connect, approve, label, status, priority, assignment, usage and diagnostics.
5. **Routing & failover** — rules, backup order, eligible errors, dry-run preview, change history.
6. **Templates** — list, status, variables, languages, usage and notification mapping.
7. **Team & roles** — members, teams, permissions and invitation status.
8. **Reports** — volume, response time, resolution, delivery and number health.
9. **Audit & exports** — searchable admin events and data export controls.
10. **Workspace settings** — business profile, privacy, retention, notifications, integrations and security.

## 10.1 Mandatory frontend component system: shadcn/ui

The application frontend **must use shadcn/ui** for its component system. Do not substitute another component library or create a parallel design system.

- Use the shadcn/ui setup appropriate to the selected React framework and maintain the project’s component registry/configuration.
- Build screens from shadcn/ui components and their documented composition patterns: buttons, inputs, forms, labels, dialogs, dropdown menus, tabs, tables, command/search, badges, cards, tooltips, sheets, alerts, toasts, skeletons and navigation primitives as appropriate.
- Customize through shared design tokens, CSS variables, Tailwind theme configuration and local component variants. Keep reusable primitives in the shared UI layer; avoid one-off styles that create visual drift.
- Use accessible shadcn/ui patterns: keyboard-operable controls, visible focus, semantic labels, validation messaging, dialog focus management, and adequate contrast. Meet the accessibility target in Section 13.
- The inbox may use a purpose-built responsive layout, but its controls and interaction patterns must be implemented with shadcn/ui primitives. Preserve efficient dense desktop use while keeping mobile layouts usable.
- Establish a consistent visual language for sender-number state, message delivery state, conversation status, danger actions and admin warnings. Status must not rely on color alone.
- During implementation, verify the installed shadcn/ui component APIs and current project setup; the PRD mandates shadcn/ui but does not prescribe a specific framework version or component registry release.

## 11. Data model (logical)

### Workspace
`id, name, timezone, locale, status, retention_policy, created_at`

### User
`id, workspace_id, name, email, role, team_ids, status, mfa_state, last_login_at`

### ChannelNumber
`id, workspace_id, waba_ref, meta_phone_number_id, e164_number, display_name, label, state, approved_by, approved_at, routing_priority, allowed_team_ids, last_status_event_at, quality_signal, connection_ref, created_at, updated_at`

### Contact
`id, workspace_id, display_name, normalized_phone, custom_fields, tags, owner_user_id, source, suppression_state, created_at, updated_at`

### ContactIdentifier
`id, contact_id, type, normalized_value, verified, source, created_at`

### Conversation
`id, workspace_id, contact_id, channel_number_id, status, assigned_user_id, assigned_team_id, last_message_at, unread_count, service_window_expires_at, created_at, updated_at`

### Message
`id, workspace_id, conversation_id, contact_id, channel_number_id, direction, type, text_body, media_refs, template_ref, platform_message_id, idempotency_key, lifecycle_state, failure_class, failure_code, sent_at, delivered_at, read_at, received_at, created_at`

### WebhookEvent
`id, workspace_id, channel_number_id, platform_event_id, event_type, received_at, signature_valid, raw_payload_ref, processing_state, processed_at, error_summary`

### ConsentRecord
`id, workspace_id, contact_id, channel, scope, status, wording_version, evidence_source, captured_at, revoked_at`

### RoutingRule
`id, workspace_id, name, priority, conditions_json, channel_order, enabled, version, updated_by, updated_at`

### FailoverEvent
`id, workspace_id, conversation_id, triggering_message_id, from_channel_id, to_channel_id, scope, reason_class, source_event_id, outcome, created_at`

### AuditEvent
`id, workspace_id, actor_id, action, target_type, target_id, before_json, after_json, request_id, created_at`

### Note / Tag / Template / Attachment
Related entities with workspace scoping, actor references, platform identifiers and retention metadata.

Important constraints:
- All entities scoped by workspace; enforce tenant isolation at database and service layers.
- Persist original platform IDs and timestamps for reconciliation.
- Treat webhook delivery as at-least-once; use unique event/message keys.
- A conversation is associated with one specific channel number. Unified history is a contact-level presentation, not a destructive merge of channel threads.

## 12. Integration and system architecture

### High-level services

- Web frontend: inbox, admin console, real-time state updates.
- Application API: auth, contacts, conversations, routing, settings, exports.
- WhatsApp integration service: Meta API calls, webhook verification, number state sync, template sync.
- Message dispatch queue: rate-limited, priority-aware sending with idempotency, retry controls for confirmed-safe failures, and reconciliation for ambiguous provider outcomes.
- Webhook ingestion: signature verification, event persistence, deduplication, asynchronous processing.
- Database: relational source of truth for CRM entities and messages.
- Object storage: encrypted media with signed access URLs.
- Search service: indexed contacts/messages with deletion propagation.
- Notification service: in-app/email alerts.
- Observability: metrics, structured logs, traces, audit events, alerting.

### Delivery flow

Outbound: Agent action → authorize sender/contact/policy state → persist queued message + idempotency key → dispatch worker → Meta Cloud API → save platform ID/response → process webhook status callbacks → update inbox.

Inbound: Meta webhook → verify signature → persist event idempotently → acknowledge → worker maps phone number/contact → upsert message and conversation → publish inbox update → notify assigned team.

### Security requirements

- Never expose permanent tokens to browser clients.
- Use least-privilege Meta permissions and rotate/revoke tokens safely.
- Verify webhook signatures and reject invalid payloads.
- Redact tokens, secrets, and unnecessary message content from logs.
- Use CSRF protection, rate limiting, session expiration, secure cookies and abuse monitoring.
- Enforce authorization in the backend, not only the UI.
- Maintain tested backups and restore procedures.

## 13. Non-functional requirements

- **Availability:** Target 99.9% monthly CRM availability after general availability, excluding Meta platform outages.
- **Durability:** No acknowledged inbound event is lost after webhook persistence; recovery from worker outages is automatic.
- **Latency:** Inbox event appears within 5 seconds p95 after webhook receipt under normal load; message dispatch starts within 3 seconds p95 after user submit, excluding Meta latency.
- **Scale:** Initial target 100 agents, 100 connected numbers/workspace subject to Meta limits, 1 million contacts, and 10 million messages/year; architecture must scale horizontally.
- **Consistency:** Message state eventually reconciles with platform callbacks; show “unknown” rather than inventing delivery state.
- **Accessibility:** WCAG 2.2 AA target for core inbox/admin flows.
- **Localization:** E.164 phone storage, timezone-aware timestamps, Unicode and right-to-left readiness.
- **Data protection:** Encryption at rest/in transit, backup encryption, privacy export/deletion, documented retention.
- **Observability:** SLO dashboards for webhook lag, queue age, API failure rates, duplicate prevention and failover outcomes.

## 14. Analytics and success metrics

### Product outcomes
- Percentage of conversations with a CRM contact match.
- Median and p95 first response time.
- Conversation resolution time and reopen rate.
- Agent active usage and weekly active teams.
- Percentage of inbound messages stored successfully.
- Message delivery rate by number and message category.
- Number connection success rate and time to onboard.
- Failover event detection time, successful routing rate, duplicate-send rate and manual intervention rate.
- Percentage of customer records with valid consent/source metadata.

### Guardrail metrics
- Opt-out/block/report rates where available.
- Failed/undelivered messages and quality warnings.
- Unintended sender switches and duplicate outbound messages (target zero).
- Cross-workspace access incidents (target zero).
- Data export/deletion completion time.

Metrics should not encourage indiscriminate volume or number rotation. Track user experience, compliance and reliable handling.

## 15. Acceptance criteria for v1

1. An admin can connect, label, approve, pause, and inspect at least two eligible WhatsApp numbers.
2. An incoming message to either number creates/updates the correct contact and channel-specific conversation; both appear in the same contact timeline.
3. Every message visibly records the sender/receiver number and platform delivery state.
4. An authorized agent can reply through a selected eligible number; the CRM blocks sending through a paused/unapproved number.
5. Inbound events are authenticated, deduplicated, durably stored and retried after processing failure.
6. A number-level unavailable event can pause that number and, if enabled and safe, route a new eligible outbound message to the next approved number.
7. A WABA/business restriction or ambiguous error pauses automated failover and alerts an admin.
8. A customer’s message to Number 1 is not represented as delivered to Number 2; UI explains the channel-specific thread boundary.
9. Contact records and histories remain available in CRM after a number is disconnected.
10. Admin can export a contact’s messages and change/audit log; role checks prevent unauthorized exports.
11. Consent/opt-out and template/service-window checks are applied before outbound sends.
12. No number-change notification is sent without explicit configured policy/approval and a valid sending path.

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Meta API, eligibility, pricing, webhook or account rules change | Integration failure or unexpected cost | Keep integration behind adapter; review official docs before each release; feature flags; version and monitor API changes |
| WABA-level restriction affects all numbers | No WhatsApp sender available | Scope-aware halt; admin alert; backup non-WhatsApp contact path; do not bypass enforcement |
| Customer assumes same WhatsApp chat carries over | Missed replies/confusion | Explicit agent UI and customer notification wording; show channel-specific threads |
| Duplicate sends after timeouts | Poor experience | Idempotency, status reconciliation and hold ambiguous outcomes |
| Number ownership/recycled number or loss of OTP access | Channel disruption | Business-owned numbers, documented recovery contacts, access checks and periodic verification |
| Imported customer list lacks opt-in evidence | Policy/legal exposure | Require consent/source fields and suppress unknown/unconsented campaign sends |
| Centralized CRM holds sensitive chat data | Privacy/security impact | Minimize collection, RBAC, encryption, retention/deletion, audit and incident response |
| Provider/Meta dependency despite own CRM | Platform outage affects messaging | Own storage and abstraction; queue and surface outage state; keep non-WhatsApp channels as future resilience |
| Number-rotation used to circumvent restrictions | Business account enforcement | Never automate around account-level enforcement; halt and require appeal/review |

## 17. Rollout plan

### Phase 0: Discovery and compliance
- Confirm target geography, business type, volume, privacy obligations, Meta asset ownership and number eligibility.
- Validate direct Cloud API onboarding, required scopes, webhook events and status signals.
- Decide hosting region, retention defaults, consent model and incident process.

### Phase 1: Foundation and one-number pilot
- Auth, workspace, roles, contacts, one official number, webhooks, durable message storage, simple shared inbox and manual send.
- Internal pilot with opted-in test customers; validate delivery states and exports.

### Phase 2: Multi-number admin and unified timeline
- Add number onboarding, approval lifecycle, channel-specific conversations, contact-level history, number filters, routing priorities and audit log.

### Phase 3: Guarded failover
- Implement status/error classification, admin alerts, dry-run routing simulation, safe failover for confirmed number-specific outages, idempotency and human review.
- Start with failover disabled by default; enable for pilot workspaces after observed reliability.

### Phase 4: Production readiness
- Security review, privacy review, backup restore exercise, load/chaos testing, accessibility review, support playbooks, billing/usage dashboards and general availability.

## 18. Open decisions

1. Is the product for one company’s internal team or a SaaS CRM serving many independent businesses? This changes tenancy, onboarding, billing and Meta Tech Provider requirements.
2. Which geography/countries and local virtual-number vendors are in scope?
3. Should agents be able to choose the sender per message, or should routing always choose it automatically?
4. What are expected contacts, daily messages, agent count and uptime target?
5. Should the product allow only official Cloud API numbers, or also WhatsApp Business App coexistence where Meta supports it?
6. What prior history sources, if any, must be imported at launch?
7. Which alternate channels should be used to notify customers if WhatsApp is unavailable?
8. What retention duration and data residency are required?
9. Should failover require supervisor confirmation initially, or be automatic for only confirmed number-level outages?
10. Is customer-facing number-change notification required, and what approved consent/template process will govern it?

## 19. Glossary

- **Cloud API:** Meta-hosted API for WhatsApp Business Platform messaging.
- **CRM:** Customer relationship management system; in this product, it owns customer/contact/message records and agent workflow.
- **Failover:** Switching eligible future outbound traffic to a backup sender after a classified failure.
- **Meta Business Portfolio:** Meta business container that manages business assets and access.
- **WABA:** WhatsApp Business Account associated with the business and its phone numbers.
- **Webhook:** Signed HTTP event sent by Meta to the CRM when messages or account/number state changes.
- **Service window:** WhatsApp-defined period in which a business may reply under the current platform rules without using a template; exact behavior must be verified against current policy during implementation.
