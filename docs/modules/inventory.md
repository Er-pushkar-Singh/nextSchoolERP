# Inventory & sales

> Status: Built 15 Oct 2026 (step 36) · Catalogue: `inventory.items`, `inventory.purchase`, `inventory.sales` · Plans: Premium · Migration: `0038_inventory.sql`

## Purpose
Uniform, books and stationery: one stock ledger, purchases from suppliers, counter sales to a student / staff member / walk-in (paid at once, or added to the student's fee account), issue to teachers and classes, stock take, low-stock alerts — with the money flowing into the day book by itself.

## Who uses it
| Role | Permissions |
|---|---|
| Principal | everything |
| Accountant | items view, purchases and sales full |
| Office admin | items view / create / edit, purchases view / create, sales view / create / print |
| Front office (uniform counter) | items view, sales view / create / print |
| Vice principal | items and sales view |

## Screens
| Route | What's there |
|---|---|
| `/app/inventory` | Sales today / month, stock value, items to re-order, amounts waiting on fee accounts, sales vs purchases chart, best sellers, re-order list |
| `/app/inventory/sell` | The counter: customer (student picker pre-listed, staff, walk-in), tap items (search, categories, stock shown), quantities, bill total, discount (needs sales-edit), payment mode incl. **add to fee account** |
| `/app/inventory/sales` | Bills with filters and pagination, receipt, cancel (returns stock, cancels the voucher / removes the unpaid fee charge) |
| `/app/inventory/sales/[id]` | Printable receipt |
| `/app/inventory/items` | Search / category / stock state / active filters, pagination, add / edit modal (opening stock), stock correction, write-off, issue / return to a teacher or class |
| `/app/inventory/purchases` (+ `/new`, `/suppliers`) | Purchase bills with the cart, supplier, amount paid and mode; suppliers |
| `/app/inventory/ledger` | Every stock movement with who and why (filter by item, type, dates) |
| `/app/inventory/stocktake` | Type the counted quantities; only the differences become corrections |

## Database (0038)
`inventory_items` (`on_hand` kept equal to the ledger by trigger, cannot be edited by hand, never negative for counted items), `inventory_moves` (signed ledger), `inventory_suppliers`, `inventory_purchases` / `_lines`, `inventory_sales` / `_lines`, `inventory_settings` (numbers SL-00001 / PU-0001). Functions: `inventory_purchase`, `inventory_sell`, `inventory_cancel_sale`, `inventory_adjust`, `inventory_issue`, `inventory_stock_take`, `inventory_item_list`, `inventory_sale_list`, `inventory_move_list`, `inventory_dashboard`.

## Rules
1. Stock = sum of the ledger; selling more than is in stock is refused and leaves no half-saved bill.
2. A clerk sells at the list price; changing a price or giving a discount needs `inventory.sales.edit`.
3. Paid sales post a receipt voucher ("Sale of books & uniform"); purchase payments post a payment voucher ("Inventory purchases"); fee-account sales create a due under the head "Uniform & Books" and post no voucher until the parent pays at the fee counter.
4. A sale whose fee-account charge was already (partly) paid cannot be cancelled — refund it from Fees first.
5. Another school never sees or sells this stock.

## Tests
`inventory.test.sql` (36 checks): ledger, guards, purchase, sale, fee account, permissions, cancel, issue, stock take, lists, dashboard, isolation.

## Gaps & ideas
Barcode scanner on the counter, class-wise book sets sold in one tap, GST invoices, purchase returns, supplier payments ledger, per-student uniform entitlement, CSV import of items.