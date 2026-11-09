# Khushi Biz

Restaurant & café POS at `/biz`, on the same shops, staff and Khushi Points data.

```
Floor  ->  Order  ->  Bill  ->  Paid
(tables)   (tap items) (GST, customer, UPI)   (invoice + points)
Setup: menu, tables, billing (owner only)
```

## Data (supabase/migrations/20261108000000_biz.sql)
- `menu_categories`, `menu_items`, `dining_tables`: the menu. Read with `biz_menu(shop)` (one call).
- `biz_orders`: one row per order, items in `lines` (jsonb). The id is made on the device.
- `biz_save_order(shop, order)`: create/update an open order. Safe to repeat.
- `biz_pay_order(shop, order, mode, series, consent)`: totals, invoice number, payment, then points via `add_bill`. Safe to repeat.
- `_biz_totals(lines, inclusive, discount)`: the bill maths. `money.ts` mirrors it for live totals; the database decides.

## Rules
- Invoice numbers: `<series><fy>-<seq>`, e.g. `A2627-0042`, sequential per shop, financial year and series.
- One open order per table.
- Points problems (no consent, bill under minimum) never block payment; they are stored in `points_error`.

Tests: `supabase/tests/biz_test.sql`.

## Kitchen (supabase/migrations/20261109010000_biz_kitchen.sql)
- `biz_send_to_kitchen(shop, order)`: what changed since the last send becomes a numbered ticket (`biz_tickets`).
  Added items are positive quantities, reduced or removed ones negative ("Cancel 1 × …"). Nothing changed: no ticket.
- `biz_kitchen(shop)`: tickets not done yet. `biz_ticket_status(shop, ticket, status)`: new → cooking → ready → done.
- Orders carry `sent` (quantity the kitchen has per dish) and `kitchen` (most urgent ticket state) for the screens.
