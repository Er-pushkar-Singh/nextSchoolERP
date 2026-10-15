# Front office

> Status: Built (step 22) · Catalogue: `frontdesk.visitors` (new), `frontdesk.enquiries`, `frontdesk.admissions`, `frontdesk.online_form` (see admissions.md) · Migration: `0024_front_office.sql`

## Purpose
One desk for everything that walks, calls or arrives at the school: visitors with passes, phone calls with follow-ups, the postal register, student early-leave gate passes — next to the admissions enquiries and pipeline it already feeds.

## Screens
| Route | What's there | Needs |
|---|---|---|
| `/app/frontdesk` | Today's counters (visitors, inside now, calls, follow-ups due, passes, new enquiries, open applications), visitor check-in form, "inside now" with check-out, shortcuts | `frontdesk.visitors.view` (or enquiries / admissions) |
| `/app/frontdesk/visitors` | Register by date range; filters purpose, inside/left, search (name, phone, pass, vehicle…); database paging; print | view |
| `/app/frontdesk/calls` | Log a call (incoming / outgoing, about, notes, follow-up date); filters, "due or overdue"; mark follow-up done | create / edit |
| `/app/frontdesk/postal` | Received / dispatched register (mode, AWB, party, subject, for / by); search, filter, print | create |
| `/app/frontdesk/gatepass` | New pass by admission no. with the named pick-up person; approve / refuse (reason), **Release child** (records out-time on today's attendance), cancel | create; edit approves |

## Database (`0024_front_office.sql`)
- Tables: `visitors`, `phone_calls`, `postal_items`, `gate_passes`, `front_office_settings` (number counters). RLS: read / create / edit / delete by `frontdesk.visitors.*` at school scope; gate passes are written by functions.
- Functions: `visitor_checkin`, `visitor_checkout`, `visitor_list` (paged), `gate_pass_request`, `gate_pass_decide`, `gate_pass_complete`, `gate_pass_cancel`, `call_followup_done`, `frontdesk_today`, `_fo_number` (V-YYMM-0001, GP-YYMM-0001).

## Rules
1. A visit needs a name; phone, if given, must look like a phone number; a parent visit can be linked to a student.
2. A visitor is checked out once. The "inside now" list is visits without an out-time.
3. A gate pass needs a reason and a named pick-up person; only active students; one open pass per student per day.
4. Someone who can approve (`frontdesk.visitors.edit`) gets passes approved at once; others raise a request for an approver. Refusing needs a reason.
5. Only an approved pass of **today** can be used; releasing the child sets `out_time` and a note on today's attendance row.

## Tests
`supabase/tests/front_office.test.sql` (19 checks).

## Gaps & ideas
Visitor photo / ID scan upload, pre-registered visitors with a QR pass, SMS to the parent on gate-pass release, convert a call or visitor to an enquiry with one click, complaint / grievance register, school-bus-late alerts from the call log.

## Refinements (step 25, migration `0027_front_office_v2.sql`)
- **Front desk page is the visitor register**: stat tiles, filters (dates, purpose, inside / left, source QR / staff, search), table with pagination, **Add visitor in a modal** (student picked by name search), edit in a modal, delete, check-out. `/app/frontdesk/visitors` redirects here.
- **Visitor QR**: the school has a private QR (`front_office_settings.visit_token`); visitors scan it, fill name / mobile / purpose on `/visit/<token>` and get a pass number; the entry appears as **Inside** with source QR. Rate-limited (60 / hour per school), duplicate mobile within 30 minutes refused, honeypot field; the QR can be regenerated.
- **Call log**: add / edit in a modal, delete, **follow-up status**: pending, done, no answer (call again on …), rescheduled (new date), dropped; filters for type, about, status, due.
- **Gate pass**: student chosen by name search (this school only), "taken by" is either a **staff member searched from the staff list** or a guardian typed in.
- **Admissions enquiries / follow-ups**: new enquiry and follow-up in modals; filters, sort and pagination; status quick-change, edit, delete (not when an application exists), reschedule / complete / delete follow-ups.
- **Type-ahead pickers**: `/api/lookup?kind=student|staff|applicant|member` (current school only, permission-checked).
