# Inventory & assets (school property) — with the uniform & book shop

> Status: Built 15 Oct 2026 (steps 36 and 38) · Catalogue: `inventory.items`, `inventory.assign`, `inventory.purchase`, `inventory.sales` · Migrations: `0038_inventory.sql`, `0040_assets.sql`

## Purpose
Everything the school owns — fans, tube lights, benches, tables, computers, projectors, lab kits, sports goods, keys — with **how many are in the store, which room each one is in, and which staff member, student or department holds it**. Giving and taking back are recorded with dates and condition; the holder is told by email (and WhatsApp / SMS if the school switched those on). Repairs, write-offs and the recovery of a student's damaged or lost item through the fee account are part of the same trail. The uniform / book / stationery **shop** of step 36 is the third kind of item.

## Item kinds
| Kind | Example | What happens to it |
|---|---|---|
| **Asset** | fan, bench, laptop, projector, cricket kit | given to a **room**, a **staff member**, a **student** or a **department**; comes back; repaired; written off |
| **Consumable** | chalk, markers, printer paper | stock goes down when issued; re-order alerts |
| **Shop** | uniform, textbooks | sold at the counter (paid, or added to the student's fee account) |

## Who uses it
| Role | Permissions |
|---|---|
| Principal | everything |
| Office admin | items view / create / edit, **assign view / create / edit**, purchases, shop counter |
| Hostel warden, Transport manager | items view, assign (their rooms / buses' equipment) |
| Accountant | items and assignments view; purchases and shop full |
| Vice principal, Front office, Librarian | view (front office: shop counter) |

## Screens
| Route | What's there |
|---|---|
| `/app/inventory` | Overview: in the store, installed in rooms, with staff & students, value, overdue returns, open repairs, low stock; units by category; latest movements; **+ Give an item** |
| `/app/inventory/assignments` | Who / which room holds what — tabs (with people & rooms, overdue, returned, damaged / lost / repair), search, held-by filter, pagination; **Take back** (quantity, condition, note, recovery charge for a student) and **Move** (room to room, person to person) |
| `/app/inventory/rooms` | Rooms & places as cards (units, value, in-charge); one click creates a classroom for every section; add / edit |
| `/app/inventory/rooms/[id]` | Everything installed in that room; put an item here; take back / move; **printable room stock register** with signature lines |
| `/app/inventory/items` | Items with kind / category / stock filters: in store, given out, under repair, total owned and value; add / edit (kind, warranty, re-order level, opening stock); stock correction, write-off; **Give** |
| `/app/inventory/repairs` | Faults reported in a room and units that came back needing repair; close as fixed (back to the store) or written off, with cost and repairer |
| `/app/inventory/purchases` (+ `/new`, `/suppliers`) | Purchase bills raise stock; payment posts to the day book |
| `/app/inventory/ledger`, `/stocktake` | Every stock movement; physical count |
| `/app/inventory/shop`, `/sell`, `/sales` | The uniform & book shop (see below) |
| Student / staff profile | "School property with them" card |

## Emails
- **Given** (`asset_assigned`): to the staff member, the student's parent (guardian email, else the student's), or a room's in-charge — item, quantity, tag, return date.
- **Returned** (`asset_returned`): acknowledgement with the condition.
- **Overdue** (`asset_overdue`): weekly from the daily job (`/api/cron/messages?job=reminders`) while it is past the return date.
Defaults: email on, SMS off, WhatsApp on only for overdue — changeable in Settings → Notifications; wording in Messages → Templates.

## Database (0040)
`inventory_locations`, `inventory_assignments` (holder = location | staff | student | department; status active / returned / repair / damaged / lost), `inventory_assignment_events` (history), `inventory_repairs`; `inventory_items.kind`, `warranty_until`. Functions: `inventory_assign`, `inventory_return` (partial returns split the row; good → store; needs repair → repair ticket; damaged / lost → return + write-off in the ledger; recovery charge → fee account), `inventory_transfer`, `inventory_report_fault`, `inventory_repair_close`, `inventory_assignment_list`, `inventory_location_summary`, `inventory_repair_list`, `inventory_overview`, `inventory_item_list` (now with kind, assigned, in repair, owned).

## Rules
1. Store stock = the ledger; you cannot give more than the store has. Total owned = store + given out + in repair.
2. Shop items are sold, never assigned.
3. A recovery charge is only for a student's damaged or lost item and lands on the fee account (head "Damage / Loss Recovery").
4. Every give / take back / move is in the history with who did it.
5. Another school never sees or touches this property.

## Shop (step 36, unchanged)
Counter bill for a student / staff member / walk-in, paid at once (receipt voucher in the day book) or **added to the student's fee account** (head "Uniform & Books"); cancel returns stock; clerks sell at list price, discounts need `inventory.sales.edit`.

## Tests
`assets.test.sql` (39 checks), `inventory.test.sql` (36 checks).

## Gaps & ideas
Per-unit serial register with QR asset tags, annual physical verification by room with a signed report, depreciation, AMC / warranty reminders, staff clearance on leaving.
