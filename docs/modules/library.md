# Library

> Status: Built 12 Oct 2026 (step 5), rebuilt 15 Oct 2026 (step 30) · Catalogue: `library.catalogue`, `library.circulation` · Plans: Standard, Premium · Migrations: `0007_standard_modules.sql`, `0032_library_v2.sql`

## Purpose
Catalogue and circulation desk for students and staff: issue by scanning the member's card, return with an automatic fine, renewals, reservations, lost books, fines posted to the day book, and a dashboard of what is read.

## Who uses it
| Role | Permissions (scope) |
|---|---|
| Librarian | `library.catalogue.*`, `library.circulation.*` (school) |
| Vice Principal | `library.catalogue.view` |
| Principal | everything |
| Parent / Student | `library.circulation.view` (child / self) |

## Screens
| Route | What's there |
|---|---|
| `/app/library` | Dashboard (titles, out now, due today, overdue, fines to collect, fines in 30 days; issues per month, categories, top titles, classes that read most) and the loan list: tabs *Out now / Overdue / Returned / Fines to collect / Everything*, search, borrower type, date range, pagination. **+ Issue a book** modal (book picker or accession no. / ISBN; member card code scanned or typed, or a student / staff picker; loan days optional). Row actions: **Return** modal (fine from the rules, lost, waive), **Renew**, WhatsApp the parent, **Collect** fine |
| `/app/library/books` | Catalogue search in the database (title, author, accession no., ISBN, category, tags), category / language / availability filters, pagination, copies available / reserved / times issued, add / edit modal (withdraw from circulation), delete |
| `/app/library/reservations` | Waiting members per title, reserve, cancel; "copy is back" is shown once the title is returned |
| `/app/library/labels` | Print QR labels (accession no.) for the filtered books — up to 120 at a time |
| `/app/library/settings` | Loan rules: days and books at a time for students and staff, fine per day, grace days, renewals allowed and days each adds, block issue while something is overdue |

## Server actions & API
`src/app/app/_actions/library.ts`: `saveBook, deleteBook, issueBook, returnBook, renewBook, collectLibraryFine, reserveBook, cancelReservation, saveLibrarySettings`. Pickers use `/api/lookup?kind=book|student|staff`.

## Database
- `library_books` (+ `active`, `tags`), `library_issues` (+ `renewals`, `lost`, `fine_paid_on`, `fine_waived`, `returned_by_name`), `library_settings` (one row per school; defaults apply until saved), `library_reservations`.
- Functions: `library_issue` (card code → student or staff via `_find_subject`, limits, overdue block, reservations keep their copy), `library_return`, `library_renew`, `library_reserve`, `library_cancel_reservation`, `library_collect_fine` (posts a **receipt voucher** under the income head "Library fines"), `library_issue_list`, `library_book_list`, `library_dashboard`, `_library_fine`.
- Trigger `guard_library_issue`: open issues can't exceed copies.

## Business rules
1. A title with N copies can have at most N open issues; a withdrawn book can't be issued.
2. A member can't hold more books than the rule, can't take a second copy of the same title, and can't borrow while something is overdue (switchable).
3. Fine = (days late − grace) × fine per day; a lost book adds its price and removes one copy; the librarian may override or waive.
4. A returned copy first goes to the oldest reservation; a book with someone waiting can't be renewed by another member.
5. A fine is collected once and appears in Accounts → Day book.

## Connects to
Students (profile card), HR staff (borrowers), Accounts (fine receipt voucher), parent page, Reports (library numbers on the principal dashboard).

## Tests
`standard_modules.test.sql` (copies limit, parent / other school) and `library_v2.test.sql` (card issue, limits, overdue block, renew limit, reservation priority, lost book, fine collection into the day book, search and pagination).

## Gaps & ideas
Per-copy accession numbers (today one accession number per title with copies), barcode scanner pages for the desk, CSV catalogue import, automatic overdue SMS / WhatsApp, e-library links, stock verification.
