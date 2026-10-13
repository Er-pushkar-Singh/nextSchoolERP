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

## Live tracking & reform (step 18) — migration `0020_transport_live.sql`
**Ola / Rapido style, for parents and the office.** Catalogue `transport.tracking.view` is now built.

| Who | Screen | What |
|---|---|---|
| Driver | `/drive/<token>` (no login) | Private link per vehicle. Start **morning pickup** / **evening drop**; the phone sends its GPS every ~4 s (heartbeat every 15 s when standing), screen wake-lock, End trip. Reopening the page resumes a running trip |
| Parent | `/p/<link>/bus` (button "Track bus live" on the parent page) | Full-screen map, bus glides to each new position, status chip (not started / starting / on the way / almost there / reached / no signal), **ETA** and distance to the child's stop, driver name with one-tap call, stops with ✓ for visited ones, "your child's stop" highlighted. Only the child's own bus is ever returned |
| Office / principal | `/app/transport/live` | All vehicles on one map, per-route colours, route stops and line for the selected vehicle, green trail of the current trip, searchable / filterable / paged list (route, status), counts on the road / no signal / idle. School location can be set on the map |
| Office | `/app/transport/trips`, `/trips/[id]` | Trip history (paged, per vehicle) and the recorded path of each trip on the map |

- **Locations**: `transport_stops.lat/lng` (click the map in the stop form, or "Use my location"), `schools.lat/lng`.
- **Data**: `transport_trips` (one running trip per vehicle), `transport_vehicle_position` (last position, deleted when the trip ends), `transport_position_log` (a point every ≥ 8 s, kept 45 days). `transport_vehicles.track_token` = the driver's private link; "New link" rotates it and ends any running trip.
- **Driver functions** (`driver_status / start_trip / ping / end_trip`) are service-role only and called by `/api/transport/driver`; the database throttles pings (2 s), rejects impossible coordinates and pings without a trip. Parent data comes from `child_bus(student)` via `/api/transport/child?token=` (blocked students get nothing). Office data: `live_vehicles`, `trip_trace`, `trip_history` (permission `transport.tracking.view`).
- **ETA** = straight-line distance ÷ max(current speed, 18 km/h) — an estimate; state `reached` within 150 m, `near` within 1 km, `offline` after 90 s without a ping.
- **Lists in the database** (search, filters, sort, count, pages): `transport_riders()` for Students on transport (search, route, stop, class, trip, stopped, sort; total and monthly fee), `vehicle_list()` for Vehicles (search, type, status, papers due), routes on the Transport home (search, vehicle, status), trip history.
- **Map**: Leaflet + OpenStreetMap tiles (no API key; keep to light use or switch to a paid tile provider for heavy use). The `Permissions-Policy` now allows `geolocation=(self)` for the driver page.
- **Honest limits**: web tracking works while the driver's page is open with the screen on (mobile browsers pause background tabs); a native driver app or a GPS box feeding `driver_ping` removes that. ETA ignores roads and traffic. No "approaching" push messages yet (they belong to the Communications module).
- **Tests**: `supabase/tests/transport_live.test.sql` (38 checks).
