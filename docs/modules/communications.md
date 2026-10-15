# Communications (email, SMS, WhatsApp) — school-wise and platform

> Status: Built 15 Oct 2026 (step 35) · Catalogue: `comms.outbox`, `comms.templates`, `comms.broadcast` (+ `settings.integrations`) · Migration: `0037_communications.sql` · Plan it came from: [plans/communications.md](../plans/communications.md)

## Purpose
Every school sends fee receipts, absence alerts, reminders, results and notices **automatically through its own accounts** (its own email / SMS sender / WhatsApp number — Settings → Integrations). CodersDuniya's own messages (subscription invoices, payment receipts to schools) go through the **platform's account** (Super Admin → Settings → Integrations). Razorpay works the same way: a school's parents pay into the school's Razorpay; schools pay CodersDuniya's subscription into the platform's Razorpay.

## The three accounts
| Who | Where configured | Used for |
|---|---|---|
| **A school** | `/app/settings/integrations` — Razorpay, Cloudinary, Email (SMTP or Resend), SMS (MSG91 DLT), WhatsApp (Meta Cloud API) | parent fees online, all messages to parents / staff of that school |
| **The platform (super admin)** | `/platform/settings/integrations` | subscription payments, invoices and receipts to schools, shared storage; optionally **shared** with schools that have no account of their own (a switch on each provider) |
| Fallback | environment variables for the platform Razorpay only | |

Secrets are AES-256-GCM encrypted (`SETTINGS_ENCRYPTION_KEY`); nobody can read them back. `resolveIntegration(school | null, provider)` picks the school's own enabled account, else the platform's shared one, else nothing — and every message row records which account carried it.

## How a message travels
1. **Event** (fee collected, attendance saved with absentees, results published, notice published with "also send to parents", online payment arrived, invoice created / paid, fee-reminder job, compose, defaulters screen) calls `queueMessages()` — never a provider.
2. For each person: channels = the school's notification switches (Settings → Notifications) ∩ connected accounts ∩ valid contact (10-digit mobile / email). Siblings sharing a number get **one** message. Opted-out families (`students.msg_opt_out`) and unreachable people get a visible **Skipped** row with the reason.
3. Rows go into `message_outbox` with a **dedupe key** (a receipt, an absence per day, a reminder per instalment and stage is never sent twice) and a `send_after` that respects **quiet hours** (default 21:00–07:00) unless urgent.
4. The **worker** (`processOutbox`) claims due rows (`claim_messages`, `for update skip locked`), sends through the right adapter, and reports (`finish_message`): sent, or retried after 10 / 20 minutes, or **failed** after the third attempt. Every outcome lands in `message_log`.
   It runs right after the action (`after()`), from **Send now**, and from `GET /api/cron/messages` (`CRON_SECRET`; `?job=reminders` also queues the daily fee reminders: 3 days before, due day, +7, +15, +30).
5. `MESSAGES_DRY_RUN=1` marks messages sent without calling any provider (for demos and tests).

## Channel specifics
- **Email** — SMTP (Gmail, Zoho, SES, Brevo…) or Resend; subject + text, simple HTML.
- **SMS** — MSG91 flow (DLT): the DLT-approved template id comes from Integrations (`tpl_<event>`) or the template row; variables go in order `var1…`.
- **WhatsApp** — Meta Cloud API **template** messages: set the approved template name per event in Messages → Templates (`name` or `name:hi`); body parameters in the order listed for the event.

## Screens
| Route | What's there |
|---|---|
| `/app/messages` | Connection status of the three channels, counts, what was sent, outbox with status / channel / event / search, pagination, **Retry**, **Cancel**, **Send now**, **Send a test** |
| `/app/messages/compose` | Broadcast: whole school, class, section, defaulters, staff or typed numbers; channels; language; schedule; "even in quiet hours" |
| `/app/messages/templates` | Per event × channel × language wording with placeholder check and live preview; provider template name / DLT id; reset to standard |
| `/app/fees/defaulters` | "Send reminders to all N" |
| student profile | switch automatic messages off for a family (parent opt-out) |
| `/platform/messages` | Super admin: the platform's own outbox |

## Database
`message_templates`, `message_outbox` (school null = platform), guardian opt-out columns, service-only `enqueue_messages`, `claim_messages`, `finish_message`; staff `outbox_retry`, `outbox_cancel`, `outbox_list`, `outbox_stats`. Tests: `communications.test.sql`.

## Rules
1. A user action never waits for a provider and never fails because of one.
2. Exactly once per dedupe key; retry never duplicates.
3. A school only ever uses its own account (or the platform's when explicitly shared); other schools' rows are invisible.
4. Message text carries no Aadhaar / medical data.

## Gaps & ideas
Delivery receipts via provider webhooks, two-way parent–teacher inbox, per-school daily caps and usage billing, birthday job, voice calls, push for the parent app.