# Reports & analysis

> Status: Built 15 Oct 2026 (step 33) · Catalogue: `reports.overview`, `reports.fees`, `reports.academic`, `reports.udise` (view / export) · Migration: `0035_reports.sql`

## Purpose
One place for the principal and trustees: how many students, how many present, how much money came in and how much is overdue, how the last exam went — with charts that print, and CSV downloads for the office. Every number is computed in the database, so pages stay fast with thousands of students.

## Who uses it
| Role | Permissions |
|---|---|
| Principal, Vice Principal | `reports.overview.view` + `export`, `reports.academic.view`, `reports.fees.view` |
| Accountant | `reports.overview.view`, `reports.fees.*` — **not** exam analysis |
| Librarian | `reports.overview.view` (read-only) |
| Class / subject teacher | `reports.academic.view` (assigned) — exam analysis, enrolment and attendance of **own classes only**; no principal dashboard, no fees |

## Screens
| Route | What's there |
|---|---|
| `/app/reports` | **Principal dashboard**: period (today / 7 / 30 days / month / session / custom); students, attendance, fees collected, overdue, admissions, staff, last exam, visitors; attendance trend, lowest classes, billed vs collected, overdue by age, boys / girls, library / health / discipline / hostel / transport numbers |
| `/app/reports/enrolment` | Class × gender × category × RTE, seats vs students, chart; CSV |
| `/app/reports/attendance` | Present % by day, class table, students below 75%, weakest day; CSV |
| `/app/reports/fees` | Billed vs collected by month, by class, overdue ageing, payment modes; CSV |
| `/app/reports/academics` | Per declared exam: average, pass %, failed, absent, topper, weak subjects; CSV |
| `/app/reports/udise` | Class × category × gender strength table for UDISE+ / education office; CSV |
| `/app/reports/export?kind=` | CSV for `enrolment, attendance, fees, ageing, exam, udise` (permission re-checked in the database) |

## Database (0035)
`report_overview`, `report_enrolment`, `report_attendance_trend`, `report_attendance_by_class`, `report_fee_monthly`, `report_fee_by_class`, `report_defaulter_ageing`, `report_collection_by_mode`, `report_exam_by_class`, `report_exam_by_subject`, `report_udise_strength`, helper `_can_report`. Also `student_lookup` and an extended `staff_lookup` — pickers for people who have no student-profile access (librarian, warden, medical room), scope-aware.

## Business rules
1. Fee and exam reports need their own permission; the overview permission does not open exam analysis.
2. Only declared results are analysed; withheld results are excluded from the topper.
3. Overdue = due date before today and balance > 0.
4. A period never extends past today.

## Tests
`reports.test.sql` — counts, percentages, class tables, topper, permission boundaries, pickers.

## Gaps & ideas
Scheduled PDF to the management on Monday, year-on-year comparison, teacher-wise results, fee forecast, saved report views, drill-down from a chart bar to the student list.

## UDISE+ student-level sheet (step 42, 17 Oct 2026)
Reports → UDISE+ strength → **Student-level sheet (CSV)** (`/app/reports/udise/students`): every active student with the fields the UDISE+ student form asks for that the system holds (name, gender, DOB, class, social category, religion, nationality, mother tongue, parents, mobile, address, district, block, PIN, state, rural / urban, distance, PEN, APAAR, whether an Aadhaar document is on record — the number is never exported) and a **Missing** column for what the office must fix before data entry. It is a working sheet: the official DCF layout changes every year, so map the columns when the portal opens.
