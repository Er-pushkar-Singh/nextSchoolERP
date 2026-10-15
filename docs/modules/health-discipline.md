# Health & discipline

> Status: Built 15 Oct 2026 (step 31) · Catalogue: `wellbeing.medical`, `wellbeing.discipline` (+ `approve`) · Plans: Premium · Migration: `0033_wellbeing.sql`

## Purpose
A medical room that records every visit and whether the parent was told, a health record per student (blood group, allergies, conditions, emergency contact), periodic check-ups with BMI, and a discipline register with several students per incident, action taken, follow-up and confidential counselling notes.

## Who uses it
| Role | Permissions (scope) | Typical job |
|---|---|---|
| Principal | all, incl. `wellbeing.discipline.approve` | close / escalate incidents, read confidential ones, counselling notes |
| Vice Principal | medical + discipline | review incidents |
| Class teacher | `wellbeing.medical.view`, `wellbeing.discipline.view` / `create` (assigned sections) | report incidents of own students, see their health alerts |
| Subject teacher | `wellbeing.discipline.create` (assigned) | report an incident |
| Office admin / nurse | `wellbeing.medical.*` (school) | medical room, health records |

## Screens
| Route | What's there |
|---|---|
| `/app/health` | **Medical room**: visits today, sent home, follow-ups due, parents not yet told; period / search / outcome / follow-up filter, pagination; **+ Record a visit** modal (complaint, temperature, treatment, medicine, outcome, parent informed, follow-up date); allergy / condition alert on each row; "Mark informed" |
| `/app/health/records` | Health records with search and "only allergies / conditions"; add / edit modal; **+ Health check-up** modal (height, weight → BMI, vision, dental, camp) with the last check-up shown |
| `/app/discipline` | Incident register: filters (period, status, type, severity, search by student or text), stats, **+ Report an incident** modal (several students, victim / involved, type, severity, place, description, action, follow-up, parents informed, confidential), **Update** modal, counselling notes for the principal |
| student profile | "Health & discipline" card (blood group, allergy alert, emergency contact, visits in 90 days, incidents in 6 months) and a "Hostel" card |

## Server actions & API
`src/app/app/_actions/wellbeing.ts`: `addHealthVisit, informParent, saveHealthRecord, addCheckup, reportIncident, updateIncident, addCounselling`. Student picker: `/api/lookup?kind=student` (uses `student_lookup`, scope-aware).

## Database
`student_health`, `health_visits`, `health_checkups` (BMI generated), `discipline_incidents`, `discipline_students`, `counselling_notes`. Functions `health_visit_add`, `health_visit_inform`, `health_visit_list`, `discipline_report`, `discipline_update`, `discipline_list`, `counselling_add`, `student_wellbeing`, `can_incident`.

## Business rules
1. Medical data is visible only to those whose scope covers the student (`can_student`): a class teacher sees own section only.
2. A child can be sent home or to hospital only after the parent is informed; the time is recorded.
3. An incident needs at least one student and a description, and can't be dated in the future; a teacher can report only about own students.
4. Bullying and abuse are confidential automatically; confidential incidents are visible to approvers and the reporter only.
5. A serious incident starts "under review"; only an approver can close or escalate; "action taken" / "closed" need the action written.
6. Counselling notes are readable and writable by approvers only.

## Connects to
Students (profile card), Hostel (boarders), Reports (visits and incidents on the principal dashboard).

## Tests
`wellbeing.test.sql` — scope, parent-informed rule, search, confidential visibility, closing rights, counselling privacy, isolation.

## Gaps & ideas
Vaccination schedule, automatic WhatsApp to the parent when a visit is saved, disciplinary letters from the template studio, repeat-offender alerts, parent acknowledgement.
