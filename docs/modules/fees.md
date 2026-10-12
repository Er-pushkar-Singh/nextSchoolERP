# Fees

> Status: Built (Fees 2.0, step 10 — 12 Oct 2026) · Catalogue: `fees.structure, dues, collection, receipts, concessions, defaulters, online, refunds` (all built) · Migrations: `0001_erp.sql`, `0003` (RLS + RPCs), `0007` (`source_key`), `0012_fees_v2.sql`

## Purpose
The money module and the main reason schools buy: fee structure → dues per student → collection desk (split payments, advance, cheques, online) → receipts → defaulters → reports, with every change to a student's account recorded and every exception approved by the principal.

## Who uses it
| Role | Can do |
|---|---|
| Accountant | structure, dues, collect, charges, cheques (deposit / clear), request refunds, concession requests, day close, reports. **Cannot** waive, approve concessions or refunds, cancel receipts or mark a cheque bounced |
| Principal | everything incl. waive fine / due, approve concessions & refunds, cancel receipts, bounce cheques, move a payment back to advance |
| Front office | collect, print, defaulters |
| Parents | the parent page: dues, receipts, UPI and **Pay online** |

## Screens
| Route | What's there |
|---|---|
| `/app/fees` | Overview + "needs attention" strip (pending concessions, open refunds, cheques in hand, advance held) |
| `/app/fees/structure` | Fee heads, schedules (head × classes × frequency), **Generate dues** |
| `/app/fees/collect` | Find student → tick instalments (or oldest first) → up to 3 payment lines (cash + UPI + cheque…), advance use, receipt date, extra fine → receipt. Below: **Adjust an instalment** (change amount, extend due date, waive, waive fine, move a payment back to advance) and the student's recent receipts / changes |
| `/app/fees/receipts`, `/[id]`, `/export` | List by day / mode (incl. mixed, wallet), printable receipt with split lines, advance, footer; cancel with reason; CSV |
| `/app/fees/ledger/[id]` | Printable **fee statement** for a student: instalments, receipts, changes, advance |
| `/app/fees/concessions` | Pending / approved / rejected; approve or reject (reason to reject); new concession with category, head, validity |
| `/app/fees/charges` | One-time charge to a class / section; update late fines; **carry arrears** to the next session |
| `/app/fees/cheques` | Cheque register: received → deposited → cleared / bounced |
| `/app/fees/refunds` | Request → approve → pay (from advance only) |
| `/app/fees/daybook` | A day's receipts by mode and collector; **close the day** (counted cash vs expected) |
| `/app/fees/reports` | Collection by day / month / head / class / mode / collector; ageing of outstanding; concession counts |
| `/app/fees/settings` | Late fine rule, concession approval, advance allowed, bounce charge, receipt footer, online payment on/off |
| `/app/fees/defaulters` | Overdue on a date + WhatsApp reminders (unchanged) |
| `/p/[token]` | **Pay online** box (when enabled and the school's own Razorpay is connected) |
| `/api/razorpay/fees` | Webhook of the **school's** Razorpay account (`payment_link.paid`) → automatic receipt |

## Server actions
`_actions/fees.ts` (structure, `generateDues`, legacy `collectFee`, `cancelReceipt`); `_actions/fees2.ts`: `saveFeeSettings, collectFeeV2, addConcessionV2, decideConcession, adjustDue, addCharge, runLateFines, carryForward, chequeStatus, requestRefund, decideRefund, payRefund, closeDay`; `app/p/[token]/actions.ts`: `startOnlinePayment`. Constants in `src/lib/fees.ts`.

## Database (0012)
- `fee_settings` (one row per school): `fine_enabled, fine_mode per_day|per_month|flat, fine_amount, fine_grace_days, fine_cap, concession_approval, advance_allowed, bounce_charge, online_enabled, online_min_amount, online_allow_partial, receipt_footer`.
- `fee_dues` + `fine_auto, fine_waived, kind plan|charge|arrears|bounce, note, original_due_date`. `fine` stays the total shown everywhere; `fine_auto` is the part the rule produced.
- `student_concessions` + `category, status pending|approved|rejected, decided_by/at, decision_note, valid_from/to`. Only **approved** concessions within their validity are billed (`concession_for()`).
- `fee_receipt_payments` (one row per mode used — the source of truth for "by mode" reports), `fee_wallet_entries` (advance ledger: advance / applied / reversal / refund), `fee_cheques`, `fee_adjustments` (reversal, waiver, carried, extension, amount_change, fine_waiver — each with reason and who), `fee_refunds`, `fee_day_close`, `fee_online_orders`.
- Functions (all `security definer`, permission-checked): `collect_fee_v2`, `collect_fee` (old signature kept), `reapply_concessions`, `waive_due`, `waive_fine`, `adjust_due_amount`, `extend_dues`, `add_charge`, `carry_forward_dues`, `apply_late_fines`, `set_cheque_status`, `reverse_payment`, `request_refund`, `decide_refund`, `pay_refund`, `close_day`, `cash_expected`, `wallet_balance`, reports `fee_report`, `fee_aging`. Service role only: `create_online_order`, `complete_online_order`, `apply_late_fines_all`. Internal (no API access): `collect_fee_core`, `apply_late_fines_core`, `next_school_number_core`, `concession_for`, `recalc_due`, `bill_student_dues`.
- Trigger `guard_fee_due`: a signed-in user cannot change `amount / concession / fine / paid / due_date / kind` of a due directly; only the functions above can.

## Business rules
1. A payment goes to the chosen instalments, else the oldest first. Anything above the total due becomes **advance** (if the school allows it) and is used later or refunded.
2. Late fine = rule × days late after grace (capped); recomputed on every payment and on demand; a waived part never comes back. A manual extra fine is still possible on the desk.
3. A receipt can be cancelled (principal): dues return. A **bounced cheque** does the same automatically and bills the bounce charge.
4. Concessions entered by staff without approve permission become **pending** when the school requires approval; billing ignores pending / rejected / expired ones.
5. Waivers, fine waivers, amount changes, extensions, reversals and carry-forward always need a reason and are listed in the student's statement.
6. Refunds are paid only from the advance balance (move a paid fee back first, principal). A request holds its amount; paid refunds appear in the day book.
7. Carry-forward closes the old balance (as a "carried" adjustment) and creates one Arrears instalment in the new session; running it twice changes nothing.
8. Online: the amount is checked against what is due on the server; the receipt is created only by the webhook after the **school's** signature check; a repeated webhook or a wrong amount never makes a second / wrong receipt. The platform's Razorpay account is never used for fees.

## Connects to
Students (ledger, concessions), Admissions (`bill_student_dues`), Transport (`generate_transport_dues`, now concession-aware), Certificates / Documents (no-dues check), Dashboard, parent page, Platform (tenant export includes the new tables).

## Tests
`supabase/tests/fees_v2.test.sql` (71 checks: approval workflow, direct-edit guard, fine rule / cap / waiver / idempotence, split payment, advance and wallet, cheque bounce, adjust / extend / waive, reversal and refund approval chain, day close, reports, carry-forward, online order + duplicate webhook + wrong amount, isolation). Plus `permissions.test.sql`, `standard_modules.test.sql`.

## Setup for online payment
Settings → Integrations → Razorpay (school's own key id, key secret, webhook secret) → Razorpay dashboard: webhook URL `<app url>/api/razorpay/fees`, event `payment_link.paid`, same secret → Fee settings: switch **Allow online payment** on.

## Fees add-ons (step 11) — migration `0013_admissions_fees_addons.sql`
- **Sibling discount**: `fee_settings.sibling_percent` (+ `sibling_head_id`); applied automatically at admission and with one click on the collect screen (`apply_sibling_discount`); once per student. The collect screen lists siblings with their balances.
- **Promise to pay**: `fee_followups` (date, amount, note); `/app/fees/followups`; the daily job `mark_broken_promises()` settles passed promises as kept / broken; overdue count on the Fees overview.
- **Structure tools** (`/app/fees/charges`): copy one class's instalments to other classes (`copy_fee_plans`), copy the whole structure to a new session with date shift and % increase (`copy_session_plans`).
- **Split an instalment** (collect screen → Adjust → Split): equal parts with a gap in days; concession divided; recorded as `fee_adjustments.kind = 'split'`; part-paid instalments cannot be split.
- **Outstanding by class × fee head** (`fee_outstanding`, `/app/fees/reports`, CSV).
- **Daily late-fine job**: `/api/cron/late-fines` (vercel cron 04:00, `Authorization: Bearer CRON_SECRET`) calls `apply_late_fines_all()` and `mark_broken_promises()`.

## Demo data
`supabase/seed/demo_data.sql` (set `v_code`, run in the SQL editor after `setup.sql`) creates one school's worth of realistic data through the real functions — fee structure for Nursery–10, 39 students incl. siblings and RTE, 16 applications in every state, 6 enquiries, concessions in all states, receipts in all modes (split, cheque cleared / deposited / received / bounced, advance), refunds in all states, waivers, extension, split, promises, day close. Run once; `supabase/seed/demo_remove.sql` removes it. Both verified on a fresh database.

## Gaps & ideas
Automatic SMS / WhatsApp reminders and receipt messages, sibling-discount rules, Tally export, a daily job calling `apply_late_fines_all` (currently fines update at payment time or by button), refunds paid back through Razorpay, instalment plans for individual students, receipt print in Hindi.
