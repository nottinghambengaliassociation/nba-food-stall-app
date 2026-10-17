# QA test plan — Charity Food Stall POS, Phase I

Author: Morpheus (QA). Source of truth: `CLAUDE.md` plus the mock-ups in `design/*.dc.html`.
**This plan tests the brief, not the implementation.** Where the app and `CLAUDE.md` disagree, the app is wrong and a bug is raised in `qa/bugs.md`.

---

## 1. Scope

In scope:

- Pure logic in `public/js/logic.js` (money, order numbers, Europe/London day string, change due, report aggregation, CSV) — unit tested with Vitest.
- The four routes `#/`, `#/cash`, `#/kitchen`, `#/reports` — end-to-end tested with Playwright against the Firestore emulator.
- Live data flow between two browser contexts (till → kitchen) via Firestore `onSnapshot`.
- Offline write queueing and the connection pill.
- Layout and touch-target constraints, accessibility (axe), console cleanliness.
- Secret hygiene: no committed string matching `AIza[0-9A-Za-z_-]{35}`.
- Live smoke against `LIVE_URL`.

Out of scope for Phase I (per brief): authentication, Firestore rules hardening, Web Audio beep audibility and Screen Wake Lock behaviour (headless Chromium cannot assert these reliably — the *toggle control* is checked, the sound is not), Google Sheets integration, price editing UI.

## 2. Environments

| Environment | URL | Backend |
|---|---|---|
| Unit | n/a (node) | none — `logic.js` has no Firebase imports |
| E2E | `http://127.0.0.1:5173/` served by `npm run serve` | Firestore emulator, project `demo-food-stall`, `127.0.0.1:8080`, started by `firebase emulators:exec` in `npm run test:e2e` |
| Live smoke | `https://nottinghambengaliassociation.github.io/nba-food-stall-app/` | real project `nba-food-stall-9fec6` if configured, else "Storage not configured" banner |

The app's own rule (`CLAUDE.md` → Technical constraints) is that on `localhost`/`127.0.0.1` it initialises with `{projectId:"demo-food-stall", apiKey:"demo"}` and connects to the emulator. Serving e2e from `127.0.0.1:5173` therefore selects the emulator path with no test-only configuration.

Firestore is cleared between e2e tests with
`DELETE http://127.0.0.1:8080/emulator/v1/projects/demo-food-stall/databases/(default)/documents`.
`localStorage` (till letter and `seq:<till>:<day>` counters) is cleared per test too, so order numbering starts from A-001.

### Viewport projects

| Project | Size | Flags | Layout under test |
|---|---|---|---|
| `phone` | 390 × 844 | `hasTouch`, `isMobile` | below the 700 px breakpoint: 2-column tiles, sticky bottom order bar, kitchen tabs |
| `tablet` | 1280 × 800 | `hasTouch` | above the breakpoint: tile grid + side order panel, three kitchen columns |

Chromium only. HTML report to `playwright-report/`, trace and screenshot on failure.

## 3. Test case index

IDs: `U-*` unit, `L-*` landing, `C-*` cash counter, `K-*` food counter, `R-*` reports, `D-*` data model, `O-*` offline/connection, `X-*` cross-cutting design/a11y, `S-*` live smoke.

---

## 4. Unit cases — `public/js/logic.js`

Exports under test (names fixed by the brief and `.claude/agents/neo.md`):
`formatPence`, `dayString(date)`, `nextOrderNo(till, day, storage)`, `orderTotal(items)`, `changeDue(total, tendered)`, `buildReport(orders)`, `ordersToCsv(orders)`, `stationOf(itemId)`.

### U-01 Money formatting
**What** `formatPence` renders integer pence as a £ string.
**Steps** Call with 0, 5, 50, 500, 1500, 123456, and a negative value.
**Expected** `£0.00`, `£0.05`, `£0.50`, `£5.00`, `£15.00`, `£1234.56` (thousands separator permitted: `£1,234.56`), `-£1.00` or `£-1.00`. Always exactly two decimals. Input is integer pence; no float arithmetic artefacts (`CLAUDE.md` → Rules: "Money is integer pence everywhere; format as £ only for display").

### U-02 Order total
**What** `orderTotal(items)` sums `qty × price` in pence.
**Steps** `[]`; one line `{qty:1, price:500}`; three lines `2×500 + 1×500 + 3×500`.
**Expected** `0`, `500`, `3000`. Result is an integer (`Number.isInteger`).

### U-03 Change due, including a short tender
**What** `changeDue(total, tendered)`.
**Steps** (1500, 2000); (1500, 1500); (1500, 1000); (1500, null/undefined).
**Expected** `500`; `0`; a short tender yields `0` or a negative number — the test accepts `<= 0` and asserts the UI never shows a negative "Change to give" (C-07). Null tender yields `0`/`null`, never `NaN`.

### U-04 Order number format and sequence
**What** `nextOrderNo(till, day, storage)` returns `<till>-<3-digit seq>` starting at 001.
**Steps** With a fresh in-memory storage stub, call three times for till `A`, day `2026-10-17`.
**Expected** `A-001`, `A-002`, `A-003`. Zero padded to 3 digits; `A-010`, `A-100` at the tenth and hundredth call.

### U-05 Sequence is per till
**Steps** Interleave calls for till `A` and till `B` on the same day.
**Expected** `A-001`, `B-001`, `A-002`, `B-002`. Two tills never collide (`CLAUDE.md` → Data model: "till letter + 3-digit daily sequence").

### U-06 Sequence resets on a new day
**Steps** Three calls on `2026-10-17`, then one on `2026-10-18`.
**Expected** `A-004` would be next on the 17th but the 18th gives `A-001`.

### U-07 localStorage key shape
**Steps** Inspect the storage stub after calls.
**Expected** Keys are exactly `seq:A:2026-10-17` (`CLAUDE.md`: `localStorage["seq:<till>:<day>"]`). The stored value is the last issued number.

### U-08 Europe/London day string — BST
**What** `dayString(date)` returns the Europe/London calendar date as `YYYY-MM-DD`.
**Steps** `2026-07-15T23:30:00Z` (BST, UTC+1 → 00:30 on the 16th locally).
**Expected** `2026-07-16`.

### U-09 Europe/London day string — GMT
**Steps** `2026-01-15T23:30:00Z` (GMT, UTC+0).
**Expected** `2026-01-15`.

### U-10 Day string either side of London midnight
**Steps** `2026-10-17T22:59:59Z` and `2026-10-17T23:00:00Z` (during BST, London is UTC+1).
**Expected** `2026-10-17` then `2026-10-18`.

### U-11 Day string across the BST→GMT change
**Steps** 2026 clocks go back at 02:00 BST on Sunday 25 October. Test `2026-10-25T00:30:00Z` (01:30 BST, still the 25th) and `2026-10-25T23:30:00Z` (23:30 GMT, still the 25th), plus `2026-03-29T01:30:00Z` (02:30 BST on the spring-forward day).
**Expected** `2026-10-25`, `2026-10-25`, `2026-03-29`. No UTC-offset drift either side of the transition.

### U-12 `stationOf`
**Steps** Call for each menu id.
**Expected** `fuchka`→`chaat`, `chat`→`chaat`, `momo`→`momo`, `samosa`/`straw`/`fountain`→`sweets` (menu table in `CLAUDE.md`). Unknown id returns a falsy/`"other"` value, never throws.

### U-13 Report KPIs
**What** `buildReport(orders)` produces the five KPI figures.
**Steps** Feed a hand-built fixture: 5 collected/ready orders plus 1 cancelled.
**Expected** `totalSales` = sum of non-cancelled totals in pence; `orders` = count of non-cancelled; `itemsSold` = sum of all `qty` over non-cancelled; `averageOrder` = round(totalSales / orders) in pence; `averageWait` = mean of `readyAtMs − createdAtMs` over orders that reached ready, in seconds.

### U-14 Cancelled orders excluded everywhere
**Steps** Same fixture; compare the report with and without the cancelled order.
**Expected** Identical: totals, order count, items sold, per-item rows, 30-minute buckets, peak, busiest 2 hours, cash/card split. (`CLAUDE.md` → Reports 2: "Cancelled orders excluded everywhere".)

### U-15 Sales by item
**Steps** Fixture with known units per item id.
**Expected** One row per item that sold, with `units` and `revenue` (pence) = units × price. Rows cover every id sold and nothing else.

### U-16 30-minute buckets and peak slot
**Steps** Orders at known `createdAtMs` across several half-hours, with two orders in one slot and three in another.
**Expected** Buckets keyed/labelled by half-hour (`12:00–12:30` style) in Europe/London; counts match; the peak slot is the busiest half hour; a tie resolves to the earliest slot.

### U-17 Busiest rolling 2 hours
**Steps** Fixture where the best 4 consecutive half-hour slots are not the ones containing the single peak slot.
**Expected** The reported window is the 4-slot (120-minute) run with the largest total, reported as `HH:MM–HH:MM` spanning 2 hours, with its count.

### U-18 Cash vs card split
**Steps** Fixture with known cash and card totals including a cancelled card order.
**Expected** `cash` and `card` amounts in pence sum to `totalSales`; percentages sum to 100 (rounding tolerated to ±1); the cancelled order contributes to neither.

### U-19 Average wait
**Steps** Orders with `createdAtMs`/`readyAtMs` 120 s and 300 s apart, plus one still `new` with no `readyAtMs`.
**Expected** Average is 210 s — orders with no `readyAtMs` are not counted (neither in the numerator nor the denominator). No `NaN` when nothing has reached ready.

### U-20 CSV header
**What** `ordersToCsv(orders)`.
**Expected** First line is exactly
`day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds`
(`CLAUDE.md` → Reports 6, in that order).

### U-21 CSV one row per order line
**Steps** Two orders, the first with 2 item lines, the second with 1.
**Expected** 1 header + 3 data rows. `qty`, `price`, `lineTotal` are numeric; `lineTotal = qty × price`.

### U-22 CSV quoting
**Steps** Names `Smith, Priya`, `O"Brien`, and an item name containing a comma (`Fuchka / Gol Gappa` plus a synthesised comma case).
**Expected** Fields containing a comma, a double quote or a newline are wrapped in double quotes and inner quotes doubled (`"Smith, Priya"`, `"O""Brien"`). A naive comma split of the raw line must not survive, but an RFC4180 parse must return the original values.

### U-23 CSV and cancelled rows
**Expected** The brief is ambiguous — it lists a `status` column (suggesting cancelled rows are included) and also says cancelled orders are "excluded everywhere". Both readings are accepted: the CSV either omits cancelled lines entirely, or includes them with `status=cancelled`. What is *not* acceptable is a cancelled line appearing with any other status, or a cancelled line being counted in a report aggregate.

### U-24 Secret hygiene guard
**What** No tracked file contains a Firebase-shaped API key.
**Steps** `git ls-files`, read each tracked text file, match `/AIza[0-9A-Za-z_-]{35}/`.
**Expected** Zero matches (`CLAUDE.md` → No keys or secrets in GitHub).

---

## 5. Landing page and till letter — `#/`

### L-01 Three big buttons
**Steps** Load `#/`.
**Expected** `nav-cash`, `nav-kitchen`, `nav-reports` are visible `<button>`/`<a>` elements, each at least 48 px tall (primary actions 64–84 px per Design).

### L-02 Routing
**Steps** Tap each button in turn, returning to `#/` between taps.
**Expected** The hash becomes `#/cash`, `#/kitchen`, `#/reports` and the matching screen renders.

### L-03 Till letter default
**Steps** Load `#/` with empty `localStorage`.
**Expected** `till-letter` shows `A` (`CLAUDE.md`: "Till letter is set on the landing page (default A)").

### L-04 Till letter persists
**Steps** Set `till-letter` to `B`, reload `#/`, then go to `#/cash`.
**Expected** The control still reads `B`; `localStorage` holds the till letter; orders placed from the cash screen are numbered `B-001` onward.

### L-05 Deep link
**Steps** Load `#/kitchen` directly (no prior visit to `#/`).
**Expected** The kitchen screen renders; no router crash; no console error.

---

## 6. Cash counter — `#/cash`

### C-01 Six tiles, icon, name, £5 (FR Cash 1)
**Steps** Load `#/cash` on a fresh database.
**Expected** Six tiles `tile-fuchka`, `tile-momo`, `tile-chat`, `tile-samosa`, `tile-straw`, `tile-fountain`, seeded from the menu table. Each shows an inline SVG icon (no emoji), the item name and `£5.00` (or `£5`). Tiles are large: at least 48 px tall, mock-up `min-height: 212px` on tablet.

### C-02 Seed on first load (Menu table)
**Steps** Clear Firestore, load `#/cash`, then read the `menu` collection.
**Expected** Six documents with ids `fuchka, momo, chat, samosa, straw, fountain`, `price: 500`, the colours and stations from the table. Seeding happens only when `menu` is empty — a second load does not duplicate.

### C-03 Tap adds one, quantity badge
**Steps** Tap `tile-fuchka` three times, `tile-momo` once.
**Expected** `qty-fuchka` reads `3`, `qty-momo` reads `1`; no badge on untouched tiles.

### C-04 Order panel lines and totals (FR Cash 2)
**Steps** With 3 × Fuchka and 1 × Momo in the order.
**Expected** `line-fuchka` shows the name, qty 3 and a line total of £15.00; `line-momo` £5.00; `order-total` reads £20.00.

### C-05 − and + buttons, size and effect
**Steps** Tap `line-inc-fuchka`, then `line-dec-fuchka` twice.
**Expected** Qty 3 → 4 → 3 → 2, with `order-total` and `qty-fuchka` following. Each `line-inc-*`/`line-dec-*` is at least 52 × 52 px (`CLAUDE.md` → Cash 2). Decrementing to 0 removes the line.

### C-06 Name input
**Steps** Type `Priya` into `customer-name`; separately leave it blank and send.
**Expected** The typed name is stored on the order; a blank name is stored as `Guest` (`CLAUDE.md` → Data model).

### C-07 Cash/card toggle and change due (FR Cash 3)
**Steps** Build a £15.00 order. `pay-cash` is selected by default or selectable; quick tender buttons `tender-500`, `tender-1000`, `tender-2000`, `tender-5000` are present. Tap `tender-2000`.
**Expected** `change-due` reads `£5.00`. Tap `tender-1000` (short of £15): change is not shown or shows `£0.00` — never a negative amount. Tap `pay-card`: the tender buttons and `change-due` disappear and `tendered` is written as `null`.

### C-08 Send button size and disabled state (FR Cash 4)
**Steps** Load `#/cash` with nothing in the order.
**Expected** `send-order` is present and `disabled`. Add one item: it enables and is at least 72 px tall (mock-up 84 px).

### C-09 Send writes the order, toasts, clears
**Steps** Build 3 × Fuchka (£15.00), name `Priya`, cash, tendered £20, tap `send-order`.
**Expected** `order-toast` appears containing the order number `A-001`; the panel clears (no lines, `order-total` £0.00, name empty, `send-order` disabled again); the toast disappears after about 4 s. Firestore holds one order with `orderNo:"A-001"`, `name:"Priya"`, `total:1500`, `payment:"cash"`, `tendered:2000`, `status:"new"`, today's `day`, `till:"A"`, numeric `createdAtMs`.

### C-10 Recent orders strip (FR Cash 5)
**Steps** Send three orders.
**Expected** `recent-A-001`, `recent-A-002`, `recent-A-003` appear in the strip with live status text. After six orders, only the last five are shown.

### C-11 Cancel while new
**Steps** Send an order, tap `cancel-A-001`.
**Expected** Status becomes `cancelled` in Firestore and in the strip. The card leaves the kitchen screen (K-08) and the order is excluded from reports (R-02).

### C-12 Cancel unavailable once preparing
**Steps** Send an order, start it on the kitchen screen, return to the cash screen.
**Expected** `cancel-A-001` is gone or disabled ("Cancel is available while status is `new`").

### C-13 Connection pill online (FR Cash 6)
**Steps** Load `#/cash` with the emulator reachable.
**Expected** `conn-pill` reads `Online · synced`.

### C-14 Order numbers increment and persist across reload
**Steps** Send two orders, reload, send a third.
**Expected** `A-001`, `A-002`, `A-003` — the sequence comes from `localStorage`, not from a count of documents.

---

## 7. Food counter — `#/kitchen`

### K-01 Live arrival without reload (FR Food 1)
**Steps** Two browser contexts: A on `#/cash`, B on `#/kitchen`. Place an order in A.
**Expected** `order-card-A-001` appears in B's New column within 2 s with no reload.

### K-02 Tablet columns / phone tabs
**Steps** Load `#/kitchen` in each project.
**Expected** tablet: `col-new`, `col-preparing`, `col-ready` all visible side by side. phone: `tab-new`, `tab-preparing`, `tab-ready` visible, each showing a count; only the selected tab's list is shown.

### K-03 Card content and age (FR Food 2)
**Steps** Inspect `order-card-A-001`.
**Expected** Shows the order number, the name, each item with `qty ×` and an inline SVG icon, and an age such as `just now` / `3 min`.

### K-04 Age turns amber at 6 minutes
**Steps** Seed an order with `createdAtMs` 7 minutes ago, load `#/kitchen`.
**Expected** The age element's colour is the amber warning `#B45309` (`rgb(180, 83, 9)`); a 2-minute-old order is not amber.

### K-05 Status flow via one big button (FR Food 3)
**Steps** Tap `action-A-001` three times, re-finding the card each time.
**Expected** New → Preparing → Ready → Collected. The card moves column (tablet) or tab (phone) each time; after Collected it is off the board. The button is at least 64 px tall at each step and labelled `Start`, `Ready`, `Collected`. Firestore gains `startedAtMs`, `readyAtMs`, `collectedAtMs`.

### K-06 Ready shows the name in capitals
**Steps** Order for `priya`; take it to Ready.
**Expected** The Ready card shows `PRIYA` — rendered capitals, verified by the element's text (the test accepts CSS `text-transform: uppercase` by comparing rendered text, not source text), at a large font size (mock-up 40 px).

### K-07 Undo last tap (FR Food 5)
**Steps** Tap `action-A-001` to Start, then tap `undo`.
**Expected** The order returns to `new` and the card is back in the New column/tab. `undo` is disabled when there is nothing to undo.

### K-08 Station filter greys, never hides (FR Food 4)
**Steps** Place an order with one chaat item and one momo item. Tap `station-momo`.
**Expected** `station-all`, `station-chaat`, `station-momo`, `station-sweets` all exist. With `momo` selected, the card is still shown and both lines are still present in the DOM; the chaat line is greyed (muted colour, mock-up `#A8A29E`) and the momo line is not. **Lines are greyed but still shown** — a hidden line is a bug.

### K-09 Cancelled order leaves the kitchen
**Steps** Place an order, cancel it from the cash strip.
**Expected** `order-card-*` disappears from the kitchen within 2 s without reload.

### K-10 Collected count / board cleanliness
**Expected** Collected orders are not shown in any of the three columns.

### K-11 Beep toggle present (FR Food 6)
**Expected** A sound toggle exists in the header and can be switched. The audible beep and the wake lock are not asserted in headless Chromium; noted as out of automated scope.

### K-12 Persistence across reload
**Steps** Advance an order to Preparing, reload `#/kitchen`.
**Expected** The order is still in the Preparing column.

---

## 8. Reports — `#/reports`

Fixture for R-01…R-07 (seeded directly into Firestore for today's London day, till A, each item £5):

| orderNo | items | total | pay | status | created | ready |
|---|---|---|---|---|---|---|
| A-001 | 2×fuchka | 1000 | cash | collected | 12:05 | 12:07 (120 s) |
| A-002 | 1×momo, 1×chat | 1000 | card | collected | 12:20 | 12:25 (300 s) |
| A-003 | 3×fuchka | 1500 | cash | ready | 12:40 | 12:44 (240 s) |
| A-004 | 1×samosa | 500 | card | collected | 13:10 | 13:13 (180 s) |
| A-005 | 4×momo | 2000 | cash | new | 13:40 | — |
| A-006 | 10×fountain | 5000 | card | **cancelled** | 13:20 | — |

Hand-calculated expectations (cancelled A-006 excluded everywhere):
total sales £60.00 (6000p); orders 5; items sold 12; average order £12.00 (1200p); average wait (120+300+240+180)/4 = 210 s = `3m 30s`.
Per item: fuchka 5 units £25.00; momo 5 units £25.00; chat 1 unit £5.00; samosa 1 unit £5.00; straw 0; fountain 0 (cancelled only).
Buckets: 12:00–12:30 → 2; 12:30–13:00 → 1; 13:00–13:30 → 1; 13:30–14:00 → 1. Peak slot = `12:00–12:30` with 2 orders (unique). Busiest 2 hours = `12:00–14:00` with 5 orders.
Cash vs card: cash A-001 1000 + A-003 1500 + A-005 2000 = £45.00 (75%); card A-002 1000 + A-004 500 = £15.00 (25%).

### R-01 Date input defaults to today (FR Reports 1)
**Expected** `report-date` is an `<input type="date">` whose value is today's Europe/London date.

### R-02 KPI tiles (FR Reports 2)
**Expected** `kpi-sales` £60.00, `kpi-orders` 5, `kpi-items` 12, `kpi-avg-order` £12.00, `kpi-avg-wait` 210 s rendered as `3m 30s` (any clear format containing 3 and 30 accepted). The cancelled order contributes nothing.

### R-03 Sales by item (FR Reports 3)
**Expected** `item-row-fuchka` 5 units £25.00; `item-row-momo` 5 units £25.00; `item-row-chat` 1 £5.00; `item-row-samosa` 1 £5.00. Each row has a bar whose width is proportional to units. `item-row-fountain` is absent or shows 0.

### R-04 30-minute chart, peak, busiest 2 hours (FR Reports 4)
**Expected** A bar per 30-minute slot; the peak bar is visually highlighted (distinct fill, mock-up `#B45309`); `peak-slot` reads `12:00–12:30` with 2 orders; `busiest-window` reads a 2-hour window of `12:00–14:00` with 5 orders.

### R-05 Show-as-table toggle
**Steps** Tap `chart-toggle`.
**Expected** A table of slot/orders replaces the chart with the same numbers; tapping again returns the chart. Toggle label flips between "Show as table" and "Show chart".

### R-06 Cash vs card split (FR Reports 5)
**Expected** `pay-split` shows cash £45.00 (75%) and card £15.00 (25%); percentages sum to 100.

### R-07 Export CSV (FR Reports 6)
**Steps** Tap `export-csv` and capture the download.
**Expected** A file downloads. Header exactly `day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds`. One data row per order line of the day. Values parse; `lineTotal = qty × price`; `waitSeconds` present where the order reached ready.

### R-08 Empty day
**Steps** Set `report-date` to a date with no orders.
**Expected** Zeroes, not `NaN`, `£NaN`, `Infinity` or a crash. `kpi-sales` £0.00, `kpi-orders` 0, `kpi-avg-wait` a dash or 0.

### R-09 Date change re-queries
**Steps** Change `report-date` to yesterday and back.
**Expected** Figures change and come back; only `where("day","==",day)` is used (no composite index error in the console).

---

## 9. Data model invariants

### D-01 Order document shape
**Expected** A sent order has every field from the data model block: `orderNo, name, items[{id,name,qty,price}], total, payment, tendered, status, day, till, createdAtMs, createdAt`. `total` and every `price` are integers.

### D-02 Timestamps stamp on transition
**Expected** `startedAtMs`, `readyAtMs`, `collectedAtMs`, `cancelledAtMs` are set, as numbers, at the moment of the corresponding transition and not before.

### D-03 `day` is the Europe/London date
**Expected** The order's `day` equals `dayString(new Date())` for Europe/London, not the UTC date.

### D-04 Two tills, no duplicate order numbers
**Steps** Two browser contexts, one with till `A`, one with till `B`; each sends three orders, interleaved.
**Expected** Six orders, `A-001..A-003` and `B-001..B-003`; `orderNo` values are all distinct.

### D-05 Menu documents
**Expected** `menu/{id}` documents carry `name, short, price, colour, station, active, sort`. Prices come from `menu` — the tile price follows a changed `menu` price without a code change.

---

## 10. Offline and the connection pill

### O-01 Offline write queues
**Steps** `context.setOffline(true)` on the cash context, place an order.
**Expected** The order number is issued immediately (local `localStorage` sequence); `order-toast` shows; `conn-pill` reads `Offline · N queued`.

### O-02 Queue drains on reconnect
**Steps** `context.setOffline(false)`.
**Expected** `conn-pill` returns to `Online · synced` and the order arrives on a separate kitchen context within a few seconds.

### O-03 Offline reload keeps the screen usable
**Steps** While offline, reload `#/cash`.
**Expected** The persistent local cache serves the menu; no crash, no "Storage not configured" banner on localhost.

---

## 11. Design, layout and accessibility

### X-01 No horizontal scroll at 360 px
**Steps** Set the viewport to 360 × 740 and visit all four routes.
**Expected** `document.documentElement.scrollWidth <= clientWidth + 1` (`CLAUDE.md` → Design).

### X-02 Touch targets at least 48 px
**Steps** Measure every visible `button`, `a[role=button]` and `input` on all four routes.
**Expected** Height ≥ 48 px (tolerance 1 px for sub-pixel layout). Primary actions 64–84 px; `send-order` ≥ 72 px; kitchen `action-*` ≥ 64 px; `line-inc-*`/`line-dec-*` ≥ 52 × 52 px.

### X-03 Body text at least 17 px
**Expected** The computed `font-size` of body text is ≥ 17 px.

### X-04 Dark header on every screen
**Expected** Each route has a header whose background is the ink colour `#1C1917` (`rgb(28, 25, 23)`).

### X-05 Phone layout at the breakpoint
**Expected** At 390 px: cash tiles are in 2 columns, the order bar is sticky at the bottom, the kitchen uses tabs. At 1280 px: tile grid plus side panel, three kitchen columns.

### X-06 No emoji in item icons
**Expected** Each tile and kitchen line icon is an inline `<svg>`; no emoji code points in the rendered text of tiles and kitchen cards.

### X-07 Accessibility — axe
**Steps** `@axe-core/playwright` `AxeBuilder().analyze()` on `#/`, `#/cash`, `#/kitchen`, `#/reports`, each in both projects, both empty and with orders.
**Expected** Zero violations of impact `serious` or `critical`.

### X-08 No console errors
**Steps** Collect `console` messages of type `error` and `pageerror` on every route in every e2e test.
**Expected** None. (Network noise from the emulator that is not an error-level console message is ignored; an uncaught exception is a blocker.)

### X-09 Keyboard and semantics
**Expected** Real `<button>`, `<label>`, `<input>` elements; `customer-name` has an associated label; `report-date` has a label; the station filter and payment toggle expose pressed/selected state.

---

## 12. Screenshots

Every screen, both projects, empty and with orders, written to
`qa/screenshots/<project>-<screen>-<state>.png` where `<project>` ∈ {phone, tablet}, `<screen>` ∈ {landing, cash, kitchen, reports}, `<state>` ∈ {empty, orders}. 16 files minimum, plus failure screenshots from Playwright and `qa/screenshots/live-*.png` from the smoke run.

---

## 13. Live smoke — `LIVE_URL`

### S-01 Routes load
**Steps** On both projects load `#/`, `#/cash`, `#/kitchen`, `#/reports` at `https://nottinghambengaliassociation.github.io/nba-food-stall-app/`.
**Expected** Each screen renders, no console errors, `conn-pill` present. Screenshots `qa/screenshots/live-<project>-<screen>.png`.

### S-02 Configuration banner
**Expected** If `public/js/firebase-config.js` is missing or still holds `PASTE_` placeholders, a clear "Storage not configured" banner is shown instead of a crash — that is a pass for the banner case and a "Needs you" item, not an app bug.

### S-03 QA-SMOKE order (only if real Firebase is configured)
**Steps** Place an order named `QA-SMOKE`, take it New → Preparing → Ready → Collected on `#/kitchen`. Place a second `QA-SMOKE` order and cancel it from the cash strip.
**Expected** Both complete; the collected order appears in `#/reports`; the cancelled one does not.

---

## 14. Bug reporting

Every failure is logged in `qa/bugs.md` as:
`BUG-<n> | severity (blocker/major/minor) | screen | steps | expected (citing CLAUDE.md) | actual | screenshot path | status (open/fixed/verified)`.

Severity:
- **blocker** — a functional requirement cannot be exercised at all, data loss, an uncaught exception, or `npm test` cannot run.
- **major** — a requirement works incorrectly (wrong money, wrong order number, missing live update, a serious/critical a11y violation, a missing touch-target minimum).
- **minor** — cosmetic deviation from the mock-ups, wording, or a non-blocking console warning.

Re-run after each Neo fix round and update statuses (max 5 rounds).

## 15. Known deliberate readings of the brief

1. `changeDue` with a tender below the total: the brief gives no number, so the UI must never show a negative change; the unit test accepts `0` or a negative return value but the e2e test requires a non-negative display.
2. Peak-slot ties: the brief is silent, so the earliest slot wins.
3. The CSV may either include cancelled rows (it has a `status` column) or omit them; the brief supports both. Aggregates must always exclude them.
4. Average wait counts only orders that reached `ready`.
5. The Web Audio beep and the Screen Wake Lock are checked for the presence of their control only; headless Chromium cannot verify sound or a wake lock.
