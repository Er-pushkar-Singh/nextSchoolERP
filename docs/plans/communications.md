# Plan — Communications 2.0 (automatic SMS / WhatsApp / email)

> Status: **Planned** (not started) · Proposed as step 12 · Module code: `comms` (new submodules `comms.messages`, `comms.templates`, `comms.outbox`) · Depends on: Fees, Attendance, Exams, Admissions, Notices (all built)

## 1. Why this next
Every module built so far *creates events* — a fee is received, a student is marked absent, a result is published, an admission is confirmed, a fee falls overdue — and today staff must tap a `wa.me` link by hand for each one. The pieces for automatic sending already exist (SMS / WhatsApp / email senders, notification preferences, `message_log`), but **nothing triggers them**. Wiring them together gives the largest visible value for the least new surface: parents get receipts and alerts without staff effort, and defaulters get reminders on a schedule (this directly raises fee collection).

## 2. What already exists (do not rebuild)
| Piece | Where |
|---|---|
| Senders: `sendSms` (MSG91 flow), `sendWhatsAppTemplate` (Meta Cloud API), `sendEmail` (SMTP / Resend) | `src/lib/integrations.ts` |
| School's own or platform-shared account, secrets encrypted | `resolveIntegration()`, Settings → Integrations |
| Event × channel switches, quiet hours | `src/lib/prefs.ts`, Settings → Notifications |
| `message_log` (channel, event, recipient, status, error) and `effective_integrations()` | migration 0005 |
| Reminder wording for fees, WhatsApp-link flow | `src/lib/reminders.ts`, `WaQueue` |
| Daily cron pattern with `CRON_SECRET` | `/api/cron/billing`, `/api/cron/late-fines` |

## 3. Scope
### MVP (build first)
1. **Outbox** — every message is a row in `message_outbox` (to, channel, event, template, variables, status `queued → sending → sent / failed / skipped`, attempts, `send_after`, `dedupe_key`). Nothing calls a provider inline from a user action; a worker drains the outbox. This makes sending retry-able, auditable, rate-limited and impossible to double-send.
2. **Event producers** (SQL triggers / functions that only *enqueue*):
   | Event | Trigger | Audience | Dedupe key |
   |---|---|---|---|
   | Fee received | after `fee_receipts` insert | primary guardian | receipt id |
   | Fee due reminder | daily job: due in 3 days / due today / 7 and 15 days overdue | guardian | student + due + stage |
   | Promise-to-pay due | daily job | guardian | promise id |
   | Cheque bounced | `set_cheque_status` | guardian | cheque id |
   | Absent alert | after attendance save, once per student per day | guardian | student + date |
   | Result published | exam `published` flips true | guardians of the class | exam + student |
   | Admission confirmed / offer approved / offer expiring | `admit_application`, status → approved, daily job | applicant's phone | application + stage |
   | Notice | `notices` insert (audience class / whole school) | guardians in audience, staff | notice + student |
   | Birthday | daily job | student / staff | person + year |
3. **Templates** — one table per school (`message_templates`: event, channel, language en/hi, body with `{{student}}`, `{{amount}}`, `{{balance}}`, `{{link}}` …) seeded with sensible English + Hindi defaults. Rendering in SQL (same HTML-escape-free text renderer pattern as Documents). WhatsApp / DLT SMS need **provider-approved** template ids, so each template row stores the provider template name / id and the ordered variable list.
4. **Worker** — `/api/cron/messages` (every 5 minutes via cron, plus a "Send now" button): claims queued rows (`for update skip locked`), respects quiet hours (re-schedules to `quiet_to`), per-school rate limit, retries with back-off (3 attempts), writes the result to `message_log`.
5. **Screens**
   - `/app/messages` — outbox & log: filters (event, channel, status, date), failed ones with reason and **Retry**, per-message detail.
   - `/app/messages/templates` — edit wording, per-channel on/off, provider template id, preview with a real student.
   - `/app/messages/compose` — ad-hoc broadcast to a class / section / whole school / defaulters / staff with preview of recipient count and cost estimate, schedule for later.
   - Settings → Notifications keeps the event × channel matrix (unchanged) and gains per-event "send time".
6. **Guardian contact hygiene** — send only to a validated 10-digit mobile; skip with reason when missing; **opt-out** flag per guardian (STOP / parent request) honoured by every producer; duplicate-number collapsing (siblings share a phone → one message listing both children for fee and notice events).

### Later (separate follow-ups, not in the MVP)
Two-way parent–teacher messages and replies (`comms.messages` inbox via WhatsApp webhook), delivery receipts from MSG91 / Meta webhooks, SMS credit balance and per-school usage reports for billing, school calendar & holiday notices, voice call alerts, in-app push for the future parent PWA.

## 4. Data model (migration `0014_communications.sql`)
- `message_templates(school_id, event, channel, language, body, provider_template, variables text[], active)` unique `(school_id, event, channel, language)`.
- `message_outbox(id, school_id, channel, event, to_phone / to_email, recipient_name, student_id null, template_id, variables jsonb, body_rendered, send_after, status, attempts, last_error, provider_ref, dedupe_key, created_at, sent_at)` unique `(school_id, dedupe_key)`.
- `guardians.opted_out_at`, `guardians.preferred_language`.
- `enqueue_message(...)` (security definer, internal — no API access) and producer functions; worker functions `claim_messages(limit)` / `finish_message(id, ok, ref, error)` granted to `service_role` only.
- RLS: outbox readable with `comms.outbox.view`, retry / cancel with `comms.outbox.edit`; templates with `comms.templates.*`. Audit triggers; message bodies masked in the audit log.

## 5. Business rules
1. A user action never waits for a provider; it only enqueues. If the provider is down the action still succeeds.
2. Exactly-once per `dedupe_key`; a retry never re-enqueues.
3. Quiet hours (default 21:00–07:00) delay SMS / WhatsApp; fee receipts are delayed too, OTP-type messages are not (none in MVP).
4. A school with no connected account for a channel simply gets `skipped (no channel)` rows — visible, not silent — and the existing `wa.me` link flow keeps working.
5. Platform-shared accounts are used only when the platform owner enabled sharing; usage is counted per school (basis for future billing).
6. Message text never contains Aadhaar, medical data or fee concessions' reasons.
7. Bulk composes are capped per day per school (configurable) to protect DLT reputation and cost.

## 6. Build sequence (about 4 working sessions)
| # | Deliverable | Verification |
|---|---|---|
| 1 | Migration 0014: tables, templates seed, `enqueue_message`, dedupe, opt-out, claim / finish functions, RLS, audit | new `communications.test.sql`: dedupe, isolation, opt-out, quiet-hour scheduling, service-only functions |
| 2 | Producers: fee receipt, absent, result, admission, notice, cheque bounce (trigger-based) | tests per producer with a fake guardian set; sibling collapsing |
| 3 | Worker route + provider adapters (reuse existing senders), retry / back-off, daily reminder job (fees, offers, birthdays, promises), `vercel.json` cron | unit test of back-off & quiet-hour maths; dry-run mode (`MESSAGES_DRY_RUN=1`) that logs instead of sending |
| 4 | Screens: outbox, templates, compose, settings tweaks; docs `docs/modules/communications.md`; seed demo messages | click-through on the demo school; `tsc`, `eslint`, `build` |

## 7. Decisions needed from you before starting
1. **Channels to prioritise:** WhatsApp Cloud API first (cheapest, richest, needs Meta-approved templates), SMS (MSG91, needs DLT registration), or both together? *Recommendation: build both behind the same outbox; demo with dry-run, go live with whichever account the first school has.*
2. **Who pays for messages:** school's own provider account (already supported) or platform-shared account billed to schools? *Recommendation: school's own for now; usage counters recorded so shared billing can be added.*
3. **Default language:** English, Hindi, or per-guardian preference? *Recommendation: per-guardian, default Hindi + English template pair.*
4. **Absent alerts:** send immediately when attendance is saved, or only if still absent after a cut-off time (e.g. 10:30)? *Recommendation: cut-off time setting, default 10:30.*
5. **Fee reminders cadence:** 3 days before, on due date, +7, +15 days — okay, or different?
6. **Real sample templates:** if the school already has DLT-approved SMS templates / WhatsApp templates, share them so wording and variable order match exactly.

## 8. Risks
- DLT / Meta template approval is outside the app; until approved, sends fail. Dry-run mode and clear "template not approved" errors mitigate this.
- Shared phone numbers (siblings, one family phone) can cause duplicate or confusing messages — handled by collapsing per number per event per day.
- Cost surprises — daily caps, recipient-count preview and usage counters.

## 9. After this module (suggested order)
1. **Staff attendance → payroll LOP** (fills `attendance.staff`; payroll already waits for unpaid days).
2. **Timetable + substitution + school calendar / holidays** (calendar also feeds working days and fee due dates).
3. **Accounts** (vouchers, day book posting from fees and salary) — completes the Premium tier.
4. **Parent & student logins (PWA)**, admit cards, UDISE+ export.
5. Hostel / inventory / health & discipline.
