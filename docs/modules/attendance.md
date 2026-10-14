# Attendance (students & staff)

> Status: Built · Catalogue: `attendance.students` (built), `attendance.staff` (built); `attendance.leave` (student leave: not yet) · Migrations: `0001_erp.sql`, `0021_attendance_modern.sql`

## Purpose
One place for every way a school marks attendance: **manual class-wise**, **QR scan** (teacher's phone or a gate kiosk), **biometric / RFID machines**, **staff self check-in by location**, and **CSV import** of a machine's export. All methods write the same `attendance` / `staff_attendance` rows, so reports do not care how a mark arrived.

## Who uses it
Class teacher (`assigned` scope: own sections only), Principal / VP / office (school scope), every staff member (own check-in), a tablet at the gate (private device token, no login).

## Screens
| Route | What's there |
|---|---|
| `/app/attendance` | Today's numbers (strength, present, late, absent, not marked, marked by scan), method tiles, manual grid per class/section/date (P / A / L / H / LV), WhatsApp queue for absentees, section progress |
| `/app/attendance/scan` | Camera QR scanner (BarcodeDetector, jsQR fallback) + USB-scanner / typed code field. Result card with name, class, time, late flag; last scans list |
| `/scan/<token>` | **Kiosk** for a fixed tablet: no login, only the device token. Same scanner, big result, scans-today counter |
| `/app/attendance/devices` | Late time and staff check-in radius, devices (kiosk / biometric / RFID) with copy-link, new link, switch off, remove; **import punches** (`code,YYYY-MM-DD HH:MM`); recent punches log (paged, filter by result) |
| `/app/attendance/staff` | Staff day list (manual or by scan / device / phone), counters, month summary with **suggested unpaid days** for payroll |
| `/app/attendance/me` | Staff phone: "I have reached school" (geolocation vs school location) + last 30 days |
| `/app/attendance/low` | Students below N% in a date range; class/section/search filter, database paging, call / WhatsApp parent |
| `/app/attendance/qr` | Printable plain QR cards for students or staff (for people with no ID card yet) |
| `/api/attendance/punch` | POST `{token, code, at?, direction?}` (JSON or form) for biometric / RFID machines and the kiosk; `{token, action:"info"}` |
| `/app/attendance/register` | Printable monthly register per section |

## Codes (what a scan carries)
- Every student and staff member has a private random `att_code` (12 hex). The **QR block** in the template studio (`{{student.qr}}` / `{{staff.qr}}`) puts it on ID cards; the two default ID card presets already carry one.
- A biometric machine may send anything it knows: `att_code`, **admission number** (students) or **employee code** (staff). Lookup order: att_code, admission no., employee code.
- Rendering: SQL `render_document` writes `<img data-qr="code" src="">`; the page fills `src` with an SVG data-URL (`src/lib/qr.ts` → `withQr`, no network). The HTML sanitiser allows `data-qr`.

## Rules (database: `_punch_core`)
- First punch of the day: `P`, or `L` if after **Late after** (`attendance_settings.late_after`). An existing `A` / `LV` becomes present/late (the student came after all).
- A later punch ≥ 10 minutes after the in-time sets the **out-time**; anything sooner is `already` (no change).
- Students not `active` (left / TC) and staff not `active` are refused (`inactive`) and logged.
- Unknown codes are logged (`unknown`), nothing is marked. Every punch lands in `attendance_punches` with source, device, direction, result.
- A manual save (grid) sets `source = 'manual'` and overwrites; the in-time stays.
- Staff check-in: `staff_check_in` requires the login to be linked to an active staff row and the school location (Transport → Live bus map) to be set; distance > `geofence_m` returns `far`, nothing is marked.
- Future times are refused. Imports run each line through the same rules.

## Database (`0021_attendance_modern.sql`)
- Tables: `attendance_settings`, `attendance_devices` (token, kind `qr_kiosk | biometric | rfid`), `attendance_punches`, `staff_attendance(staff_id, date, status P/A/L/H/LV/OD, in_time, out_time, source)`. Columns added: `attendance.source / in_time / out_time / note`, `students.att_code`, `staff.att_code`.
- Functions: `_punch_core`, `_find_subject` (internal); `device_scan`, `device_info` (**service role only**); `scan_attendance` (signed-in, `can_section` on the student's section — fails closed), `staff_check_in`, `import_punch`, `add_device`, `rotate_device_token`; reports `attendance_day`, `attendance_low` (paged), `staff_attendance_day`, `staff_attendance_month`.
- `document_data` is wrapped (`document_data_base`) to add `att_code`; `render_document` knows `student.qr` / `staff.qr`.
- RLS: devices / punches readable with `attendance.students.edit` (punches also `attendance.staff.view`); staff attendance readable with `attendance.staff.view` or by the person themselves; writes through the functions and `attendance.staff.create|edit`.

## Tests
`supabase/tests/attendance_modern.test.sql` (27 checks): codes, devices, token isolation, kiosk scans (in / already / by admission no. / left / unknown), biometric staff punch, scan permission across schools, day overview, low attendance (+ search), geofence check-in, staff day/month access.

## Connects to
Dashboard and parent page (session %), template studio (QR block on ID cards), Transport (school location), HR / payroll (suggested unpaid days — typed into the payslip run by hand for now).

## Gaps & ideas
Student leave requests from parents (`attendance.leave`); automatic SMS / WhatsApp for absent and late arrivals (see `docs/plans/communications.md`); pushing "suggested unpaid days" straight into payroll; period-wise attendance; face recognition; holiday calendar (the month summary uses the school's working days only); vendor-specific push protocols (ZKTeco ADMS etc.) — today a machine must POST JSON/form to `/api/attendance/punch`, or export a CSV.
