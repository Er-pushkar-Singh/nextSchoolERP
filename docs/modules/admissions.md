# Admissions & enquiries

> Status: Built (enquiries) · Catalogue: `frontdesk.enquiries` (built); `frontdesk.admissions`, `frontdesk.online_form`, `frontdesk.visitors` (not yet) · Route: `/app/admissions`

## Purpose
Track every admission enquiry from first call to admission, so follow-ups aren't missed and the school knows which sources bring students.

## Who uses it
Front office (create/edit), Principal / Vice Principal.

## Screens
`/app/admissions` — pipeline chips with counts: **new → contacted → visited → test → admitted / lost**; add / edit enquiry (student, class sought, parent, phone, email, source, status, follow-up date, notes); sources: Walk-in, Phone call, WhatsApp, Website, Google, Facebook/Instagram, Banner/Hoarding, Referral, Other; conversion %; WhatsApp link; **Admit** → `/app/students/new?enquiry=<id>` (pre-filled; on save the enquiry becomes `admitted` with `student_id`).

## Server actions
`src/app/app/_actions/admissions.ts`: `saveEnquiry`. Admission itself is `saveStudent` in `students.ts`.

## Database
`enquiries(student_name, class_sought, parent_name, phone, email, source, status, follow_up_date, notes, student_id)`. RLS on `frontdesk.enquiries.*`.

## Connects to
Dashboard (follow-ups due today), Students (admit).

## Gaps & ideas
Public online admission form (`frontdesk.online_form`) feeding enquiries, visitor log (`frontdesk.visitors`), admission approval step, entrance-test scheduling, source-wise conversion report, follow-up reminders.
