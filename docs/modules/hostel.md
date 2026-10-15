# Hostel

> Status: Built 15 Oct 2026 (step 32) · Catalogue: `hostel.rooms`, `hostel.allocation`, `hostel.rollcall` (+ `approve`), `hostel.mess` · Plans: Premium · Migration: `0034_hostel.sql`

## Purpose
Hostels (boys / girls / mixed) with rooms and beds, bed allocation with gender and capacity checks, the hostel fee billed into the normal fee account, night / morning roll call, outpass with approval and return, visitors, and the mess menu.

## Who uses it
| Role | Permissions (scope) |
|---|---|
| Principal | everything incl. approving outpasses |
| Vice Principal | view all, approve outpass |
| Hostel warden | `hostel.rollcall.*`, `hostel.mess.*`, rooms / allocation view |
| Accountant | fees → *Hostel Fee* head appears in collection and defaulters like any fee |

## Screens
| Route | What's there |
|---|---|
| `/app/hostel` | Overview: beds, boarders, free, out on outpass, absent last night, pending outpass; occupancy ring; per-hostel table; **+ New hostel** modal |
| `/app/hostel/rooms` | Hostel switcher, rooms by floor as cards with every bed and its occupant, **Allot a bed** (per room), vacate, add / edit room, hostel details (warden, closed) |
| `/app/hostel/allocation` | Boarders table (search, hostel, living / left / all, pagination) with hostel dues and WhatsApp reminder, **+ Allot a bed**, **Bill hostel fee** (label, due date, months) |
| `/app/hostel/rollcall` | Hostel + date + night / morning: present / absent / leave per boarder with note; totals; saved roll calls can be changed |
| `/app/hostel/outpass` | Outpass list with status tabs and search; **+ New outpass**; approve / refuse (reason) / student has left / student is back / cancel; late-back flag; **+ Visitor** and recent visitors with sign-out |
| `/app/hostel/mess` | Weekly menu (breakfast, lunch, snacks, dinner) for the whole school or one hostel; today highlighted; edit modal |

## Server actions & API
`src/app/app/_actions/hostel.ts`: `saveHostel, saveRoom, allocateBed, vacateBed, generateHostelFee, saveRollcall, requestOutpass, outpassStep, addHostelVisitor, visitorOut, saveMess`.

## Database
`hostels`, `hostel_rooms`, `hostel_allocations` (one active bed per student and per bed — partial unique indexes), `hostel_attendance` (unique per student / date / slot), `hostel_outpasses`, `hostel_visitors`, `mess_menu`. Functions `hostel_allocate`, `hostel_vacate`, `generate_hostel_dues` (head "Hostel Fee", `source_key 'hostel:<session>:<label>'`, safe to repeat), `hostel_overview`, `hostel_room_grid`, `hostel_allocation_list`, `hostel_save_rollcall`, `hostel_outpass_request`, `hostel_outpass_step`, `hostel_outpass_list`.

## Business rules
1. A girl can't get a bed in a boys hostel and vice versa; a room can't exceed its beds; a student holds one bed.
2. A student who is out on an outpass can't be vacated; a room can't be reduced below its boarders.
3. Roll call can't be for a future date and only counts students who live in that hostel.
4. An outpass needs a return time after the going-out time, only one open outpass per student; an outpass raised by an approver is approved at once; only an approved pass can be used and only once.
5. Hostel fee uses the room fee unless a per-student fee is set; billing the same label again adds nothing; concessions apply as for other heads.

## Connects to
Fees (dues, collection, defaulters), Students (profile "Hostel" card), Front office (visitors are separate), Reports.

## Tests
`hostel.test.sql` — capacity, gender, single bed, overview, search, fee generation and idempotence, per-student fee, roll call rules, outpass flow.

## Gaps & ideas
Room-change history screen, hostel attendance report by month, mess billing per meal, laundry / complaint register, parent view of outpass status.
