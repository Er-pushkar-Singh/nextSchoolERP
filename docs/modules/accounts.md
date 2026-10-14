# Accounts (day book & vouchers)

> Status: Built (step 20) · Catalogue: `accounts.vouchers`, `accounts.books` · Migration: `0022_accounts.sql`

## Purpose
One day book for the whole school: every rupee in and out, whatever created it. Fee receipts, paid fee refunds and approved payroll flow in **by themselves**; everything else (donations, electricity bill, repairs, stationery, transfers between cash and bank) is entered as a **voucher**. This is a simple single-entry cash/bank book with income and expense heads — not a double-entry ledger (no trial balance / balance sheet yet).

## Who uses it
| Role | Permissions | Typical job |
|---|---|---|
| Accountant | `accounts.vouchers` view/create/edit/export, `accounts.books` | Enters vouchers, reconciles the day book |
| Principal | all | Approves vouchers above the limit, reviews income / expense |

## Screens
| Route | What's there |
|---|---|
| `/app/accounts` | Period (default: this month): income, expense, surplus, cash in hand, bank; books table (opening → money in / out → closing); income and expense by head with bars; pending-approval banner; latest entries |
| `/app/accounts/vouchers` | New / edit voucher (money received · money paid · cash⇄bank transfer), filters (period, type, status, head, search), database paging, approve / reject, cancel with reason |
| `/app/accounts/daybook` | Every entry of the period: filters book, direction, source, head, search; totals; print; CSV download (`/daybook/export`); fee receipts link to the receipt |
| `/app/accounts/setup` | Books (opening balance and date, close / reopen), income / expense heads (hide / add), approval limit |

## Database (`0022_accounts.sql`)
- Tables: `account_heads(kind income|expense)`, `account_books(kind cash|bank, opening_balance, opening_date)`, `account_settings(approval_above, next_no)`, `vouchers(no, date, kind receipt|payment|transfer, head, book, to_book, amount, party, mode, ref_no, narration, status posted|pending|rejected|cancelled)`.
- `_ledger` (internal) unions posted vouchers (a transfer is two legs), fee payment rows of non-cancelled receipts, paid refunds, and approved payroll runs (sum of net). `_ledger_fixed` places entries without a book into the first active cash book.
- Reports: `account_daybook` (paged, with totals), `account_books_summary`, `account_head_summary`, `voucher_list` (paged).
- Writes: `save_voucher`, `decide_voucher`, `cancel_voucher`; `ensure_account_defaults` (cash book + 7 income and 11 expense heads, created for existing schools by the migration and on first visit for new ones).
- RLS: read by `accounts.vouchers.view` / `accounts.books.view`; vouchers are written only through the functions; heads, books, settings need `accounts.vouchers.edit`.

## Rules
1. Fee money: cash payments go to the first active **cash** book, every other mode to the first active **bank** book (cash book if no bank). Cancelled receipts leave the day book.
2. Voucher number: `RV-` receipt, `PV-` payment, `TV-` transfer + 5-digit counter per school.
3. An income head only on a receipt, an expense head only on a payment; a transfer needs two different active books. No future dates; at most 400 days back.
4. Approval: if `approval_above > 0` and the amount is above it, a user **without** `accounts.vouchers.approve` creates the voucher as *pending* (not in books). Transfers never wait. Editing re-evaluates this.
5. Posted vouchers are edited in place (audit log keeps the old values) or **cancelled with a reason**; there is no delete.
6. Book balance = opening balance (from its opening date) + money in − money out up to the end of the period.

## Connects to
Fees (receipts, refunds), HR payroll (approved runs), audit log. Template studio: nothing printed yet (voucher print is a gap).

## Tests
`supabase/tests/accounts.test.sql` (30 checks): defaults, permissions, head/kind rules, transfer legs, fee/refund flow into the day book, book balances, head summary, approval threshold, cancel/edit, search and filters, school isolation, raw ledger not callable.

## Gaps & ideas
Voucher print (template studio kind), attachments (bill photo), bank reconciliation / statement import, budgets per head, recurring vouchers, double-entry ledger with trial balance / balance sheet, payroll paid per staff (today one salary entry per approved month), fee heads as income heads, GST.
