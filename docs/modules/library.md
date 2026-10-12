# Library

> Status: Built 12 Oct 2026 (step 5) · Catalogue: `library.catalogue`, `library.circulation` · Plans: Standard, Premium · Migration: `0007_standard_modules.sql`

## Purpose
Book catalogue and issue / return desk for students and staff, with overdue tracking, fines and parent reminders.

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
| `/app/library` | Stats (titles & copies, issued now, overdue, recent fines), **Issue a book** (accession no. or ISBN — or pre-picked from the catalogue via `?book=<id>` — + student admission no. or a staff member, days, default 14), books out / `?show=overdue` with late days, **Return** with suggested fine (₹1/day, editable — constant `FINE_PER_DAY`), **Renew 7 days**, WhatsApp parent when overdue, recently returned |
| `/app/library/books` | Search (title, author, accession, ISBN, category), available / copies, Issue link, add / edit / delete book |

## Server actions
`src/app/app/_actions/library.ts`: `saveBook, deleteBook, issueBook, returnBook, renewBook`.

## Database
- `library_books(accession_no unique per school, title, author, publisher, isbn, category, language, shelf, copies ≥ 0, price)`
- `library_issues(book_id, student_id xor staff_id, issued_on, due_on, returned_on, fine, issued_by_name, note)`
- Trigger `guard_library_issue`: **open issues can't exceed copies** (row lock on the book), borrower must belong to the school.
- RLS: books readable with catalogue or circulation view; issues readable school-wide by circulation viewers, by families for their child (`can_student`), and by staff for their own loans.

## Business rules
1. A title with N copies can have at most N open issues.
2. Books with issue history can't be deleted (set copies to 0).
3. Fine is recorded on return (not collected through Fees yet).

## Connects to
Students (profile card), HR staff (borrowers), parent page (books with the child).

## Tests
`standard_modules.test.sql` — issue, copies limit, return then re-issue, parent sees only own child, other school sees nothing, unlicensed module refuses writes.

## Gaps & ideas
Per-copy accession numbers and barcode scanning, fine collection through Fees (or a library receipt), configurable fine / loan days per school (prefs), max books per borrower, reservations, CSV catalogue import, e-library links, stock verification.
