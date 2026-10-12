# Fees

> Status: Built · Catalogue: `fees.structure, dues, collection, receipts, concessions, defaulters` (built); `fees.online`, `fees.refunds` (not yet) · Migrations: `0001_erp.sql`, `0003` (RLS + RPCs), `0007` (`source_key`)

## Purpose
The money module and the main reason schools buy: fee structure → dues per student → collection desk with printable receipts → defaulters with WhatsApp reminders → reports.

## Who uses it
Accountant (everything except cancelling receipts), Front office (collect, print, defaulters), Principal (approve = cancel receipts, concessions approve), Parents (child: view dues/receipts on the parent page).

## Screens
| Route | What's there |
|---|---|
| `/app/fees` | Overview: billed / collected / overdue, daily collection by mode |
| `/app/fees/structure` | Fee heads (Tuition, Admission, Annual, Exam, Transport…); **add schedule** = head × classes × frequency (monthly / quarterly / half-yearly / annual / once) with due day → `fee_plans`; delete; **Generate dues** (idempotent) |
| `/app/fees/collect` | Find student → unpaid dues, suggested late fine → amount, mode (cash/UPI/cheque/bank/card/online), reference, date → receipt |
| `/app/fees/receipts`, `/receipts/[id]`, `/receipts/export` | Receipt list by day / mode, printable receipt (amount in words), **cancel** with reason (approve perm), CSV |
| `/app/fees/defaulters`, `/defaulters/export` | Overdue on a date, class filter, minimum amount, one-tap WhatsApp reminder + "Send to next" queue, CSV |

## Server actions
`src/app/app/_actions/fees.ts`: `addFeeHead, deleteFeeHead, addSchedule, deletePlan, generateDues, collectFee, cancelReceipt`. Reminder text: `src/lib/reminders.ts`. Maths: `balance()`, `allocate()` in `src/lib/erp.ts`.

## Database
- `fee_heads`, `fee_plans(session, class, head, label, due_date, amount)`, `student_concessions(student, head|null, kind percent|amount, value)`
- `fee_dues(student, fee_plan_id, fee_head_id, label, due_date, amount, concession, fine, paid, status generated: due|partial|paid, source_key)` — unique `(student_id, fee_plan_id)`; partial unique `(student_id, source_key)` for non-plan dues (transport)
- `fee_receipts(receipt_no, student, paid_on, mode, reference, amount, cancelled, cancelled_reason)`, `fee_receipt_lines(receipt, due, amount)`
- Functions: `generate_dues(sid, sess, cls?)` (applies concessions), `collect_fee(...)` (allocates oldest due first, adds fine to the oldest unpaid due, rejects over-payment, numbers receipts via `next_school_number`), `recalc_due`, triggers `on_receipt_line`, `on_receipt_cancel`; reports `fee_summary`, `defaulters`, `class_fee_summary`.

## Business rules
1. Payments allocate to the **oldest due first**; partial payments OK; can't pay more than total due.
2. Cancelling a receipt (approve perm only) restores the dues (`paid` recalculated).
3. Generating dues twice creates nothing new.
4. Deleting an instalment is refused if anyone has paid against it.
5. Receipts are inserted only through `collect_fee()`; dues only through `generate_dues()` / `generate_transport_dues()`.

## Connects to
Students (ledger, concessions), Transport (`generate_transport_dues` → "Transport Fee" dues), Dashboard, parent page (UPI pay link `upi://pay?...` to the school's UPI ID — the school still records the payment).

## Tests
`permissions.test.sql` (accountant can't cancel, teacher blocked), `standard_modules.test.sql` (teacher can't call `collect_fee` directly; transport billing).

## Gaps & ideas
**Online payment** with the school's Razorpay + webhook auto-receipts (`fees.online`; integration settings exist), refunds (`fees.refunds`), automatic reminders by SMS/WhatsApp API, cheque bounce, fee-head-wise reports, previous-year arrears carry-forward, sibling discount rules.
