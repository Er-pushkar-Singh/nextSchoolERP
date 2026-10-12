# Transport

> Status: Built 12 Oct 2026 (step 5) · Catalogue: `transport.routes`, `transport.allocation` (built), `transport.tracking` (not yet) · Plans: Standard, Premium · Migration: `0007_standard_modules.sql` · Lib: `src/lib/transport.ts`

## Purpose
Manage school buses / vans, routes and stops, which students ride where, transport fees, and vehicle paperwork; give drivers a route sheet and parents the bus details.

## Who uses it
| Role | Permissions (scope) |
|---|---|
| Transport manager | `transport.routes.*`, `transport.allocation.*`, `transport.tracking.view` (school) |
| Accountant | `transport.allocation.view`; bills fees with `fees.dues.create` |
| Front office, Vice Principal | `transport.routes.view` |
| Principal | everything |
| Parent / Student | `transport.allocation.view` (child / self), tracking view |

## Screens
| Route | What's there |
|---|---|
| `/app/transport` | Stats (routes, vehicles & seats, students on transport, papers due in 30 days), **vehicle papers to renew** list, new route, route cards (vehicle, driver, stops, students / seats, fee range, "Almost full") |
| `/app/transport/routes/[id]` | Edit route (name, vehicle, active), stops table (order, pickup / drop time, fee per month, students) with add / change / remove, **students by stop** — printable route sheet with parent phones, delete route |
| `/app/transport/vehicles` | Vehicles (reg. no., type, seats, driver + phone + licence, attendant, insurance / fitness / permit / PUC valid-till, active, notes), expiry badges, add / edit / remove |
| `/app/transport/students` | Find student → choose route › stop, trip (both / pickup / drop), special monthly fee, from date; list with route filter, "Stop from today", remove, **Bill transport fees** card |

## Server actions
`src/app/app/_actions/transport.ts`: `saveVehicle, deleteVehicle, saveRoute, deleteRoute, saveStop, deleteStop, allocateStudent` (upsert on session+student), `endAllocation, removeAllocation, billTransport` (→ RPC).

## Database
- `transport_vehicles(reg_no unique per school, kind, capacity, driver_*, attendant_*, insurance_upto, fitness_upto, permit_upto, puc_upto, active)`
- `transport_routes(name unique, vehicle_id, active)`; `transport_stops(route_id, name, sort, pickup_time, drop_time, monthly_fee)`
- `transport_allocations(session_id, student_id — unique per session, route_id, stop_id, trip, monthly_fee null = stop fee, start_date, end_date)`
- Trigger `guard_transport_allocation`: stop must be on the route, student in the school, **vehicle seats are a hard limit**.
- `generate_transport_dues(sid, sess, label, due_date, months)` — needs `fees.dues.create`; creates head "Transport Fee" if missing; amount = (special fee or stop fee) × months; concessions for that head / all heads applied; `source_key = 'transport:<session>:<label>'` makes it idempotent.
- RLS: routes / stops / vehicles readable with routes.view **or** allocation.view (so families see their bus); allocations `can_student(… 'transport.allocation.view')`.

## Business rules
1. One allocation per student per session; changing stop updates it.
2. Seat limit counts current (not ended) allocations on the route.
3. Billing includes allocations that started on or before the due date and haven't ended before it.
4. Can't delete a stop or route that students still use.

## Connects to
Fees (dues, collection, defaulters, parent UPI), student profile card, parent page (route, stop, times, vehicle, driver phone).

## Tests
`standard_modules.test.sql` — setup by transport manager, seat limit, transport manager can't bill, principal bills (₹900 × 3 − 10% concession), re-billing adds nothing, parent sees own child's route, teacher sees nothing.

## Gaps & ideas
Live GPS tracking (`transport.tracking`) via driver phone app / GPS vendor API, transport attendance (boarded / dropped), route optimisation, distance-slab fees, fuel & maintenance log (could feed Accounts), driver document expiry, SMS when bus is delayed.
