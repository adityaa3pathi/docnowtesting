# WhatsApp Integration Artifact

## Scope

This document captures the deferred WhatsApp integration plan so it can be implemented later without rediscovering product and backend decisions.

## Goals

- Send OTPs through approved WhatsApp templates
- Send report-ready notifications through WhatsApp only after a report is successfully stored
- Keep provider-specific logic isolated behind a Meta adapter and a notification service

## Product Decisions

### OTP over WhatsApp

WhatsApp OTP should plug into the existing OTP send routes:

- signup send OTP
- login send OTP
- forgot-password send OTP

The existing OTP generation and verification logic stays unchanged. The delivery channel expands from "logged/generated OTP" to "send through WhatsApp template".

### Report-ready notifications

Report WhatsApp notifications should trigger only after report ingestion succeeds and the report is durably stored.

Do not send the raw PDF as the v1 default. Send an app link that takes the user to the report or booking flow inside DOCNOW.

Why:

- access control stays with DOCNOW
- links are easier to revoke or rotate
- media/document-send flows are more brittle than URL-based notification

## Data Needed From Client

Collect these exact values before implementation:

- WhatsApp Business phone number ID
- permanent access token
- WABA ID
- exact approved template names
- exact approved language codes
- final approved template text with placeholder mapping
- whether OTP template is `authentication` or `utility`
- whether report template is text-only, CTA button, or document/media based
- Meta webhook verify token
- confirmation that Indian user numbers should be sent as `91 + mobile`

## Recommended Architecture

### New adapter

Create:

- `server/src/adapters/metaWhatsApp.ts`

Responsibilities:

- send a template message
- normalize provider errors
- return provider message IDs

### New service layer

Create:

- `server/src/services/notificationService.ts`

Responsibilities:

- `sendOtpViaWhatsApp`
- `sendReportReadyViaWhatsApp`

This keeps auth and report pipelines free from Meta-specific code.

### Phone formatting

Create:

- `server/src/utils/phone.ts`

Responsibilities:

- normalize Indian numbers into WhatsApp-safe format
- validate and standardize `91XXXXXXXXXX`

## Integration Points

### OTP flow

Update the OTP send points in:

- `server/src/routes/auth.ts`

Hook points:

- signup send OTP
- login send OTP
- forgot-password send OTP

Recommended sequence:

1. generate OTP
2. persist OTP
3. send WhatsApp template
4. return success only if delivery trigger succeeds

### Report flow

Update:

- `server/src/services/reportIngestion.ts`

Hook point:

- after report storage succeeds
- after DB state is updated to stored/ready

Recommended sequence:

1. ingest and store report
2. confirm durable storage
3. resolve booking and user
4. send report-ready WhatsApp notification

## Idempotency and Delivery Safety

### OTP

Reuse the existing resend and OTP record controls already present in auth routes.

### Report notifications

Add one of:

- `whatsappSentAt` on `Report`
- or a dedicated `NotificationLog` table

This must prevent duplicate sends if:

- Healthians retries the same webhook
- report ingestion is retried
- the same report is corrected or refreshed

## Suggested Env Vars

- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_OTP_TEMPLATE`
- `META_WHATSAPP_REPORT_TEMPLATE`
- `META_WHATSAPP_DEFAULT_LANGUAGE`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`

## Webhook Follow-up

Later, add:

- `server/src/controllers/webhooks/metaWhatsApp.ts`

Track:

- sent
- delivered
- read
- failed

This is not required for the first outbound version, but it is strongly recommended for production observability.

## Recommended Rollout Order

1. Meta adapter
2. phone normalization helper
3. notification service
4. OTP send integration
5. report-ready notification integration
6. idempotency tracking
7. Meta delivery webhook

## Acceptance Criteria

### OTP

- signup OTP sends through WhatsApp
- login OTP sends through WhatsApp
- forgot-password OTP sends through WhatsApp
- delivery failure is surfaced gracefully

### Report-ready

- report-ready notification sends only after durable report storage
- duplicate report webhooks do not produce duplicate messages
- notification contains a DOCNOW app link, not a raw PDF as the default v1 behavior

