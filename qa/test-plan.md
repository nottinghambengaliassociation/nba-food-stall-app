# QA test plan — Charity Food Stall POS, Phase I + Phase II + Hotfix H1

Author: Morpheus (QA). Source of truth: `CLAUDE.md` plus the mock-ups in `design/*.dc.html`.
**This plan tests the brief, not the implementation.** Where the app and `CLAUDE.md` disagree, the app is wrong and a bug is raised in `qa/bugs.md`.

---

## 1. Scope

In scope:

- Pure logic in `public/js/logic.js` (money, order numbers, Europe/London day string, change due, cash-received parsing and change calculation, report aggregation, CSV) — unit tested with Vitest.
- The five routes `#/login`, `#/`, `#/cash`, `#/kitchen`, `#/reports` — end-to-end tested with Playwright against the Firestore emulator.
- **Phase II Feature A** — login, session, route guard, Sign out in every header, the cash-counter discard confirm (sections 16).
- **Phase II Feature B** — Cash received (optional): quick buttons, Other amount, the four display states, resets, that it never blocks sending, and that **nothing about it is persisted** (section 17).
- Live data flow between two browser contexts (till → kitchen) via Firestore `onSnapshot`.
- Offline write queueing and the connection pill.
- Layout and touch-target constraints, accessibility (axe), console cleanliness.
- Secret hygiene: no committed string matching `AIza[0-9A-Za-z_-]{35}`.
- **Hotfix H1 (18 Oct 2026)** — the ten-row menu, the four new icons, `stationOf` for retired ids, the eight-tile till and phone layout, and backwards compatibility of orders holding `samosa`/`straw` (section 20–23).
- Live smoke against `LIVE_URL`.

Out of scope (per brief): **Phase III `#/reports/days` (Sales by day) — deferred, no case is written for it**, Firestore rules hardening (login is "a screen gate for volunteers, not security": `CLAUDE.md` → Login and sign out 9), Web Audio beep audibility and Screen Wake Lock behaviour (headless Chromium cannot assert these reliably — the *toggle control* is checked, the sound is not), Google Sheets integration, price editing UI.

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

IDs: `U-*` unit, `H-*` hotfix H1, `L-*` landing, `C-*` cash counter, `K-*` food counter, `R-*` reports, `D-*` data model, `O-*` offline/connection, `X-*` cross-cutting design/a11y, `S-*` live smoke, **`G-*` login gate / sign out (Phase II A)**, **`T-*` cash received (Phase II B)**.

Because login now gates every route, every pre-existing `L-*`, `C-*`, `K-*`, `R-*`, `D-*`, `O-*` and `X-*` case runs with a session already seeded into `localStorage["nba.session"]` by the shared Playwright fixture (`tests/e2e/session.js`). That is a harness change, not a product change.

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
> **Superseded by H-08 (hotfix H1, 18 Oct 2026): eight tiles, new ids.** The sizing and content assertions below still apply to each tile.

**Steps** Load `#/cash` on a fresh database.
**Expected** Eight tiles `tile-fuchka`, `tile-momo`, `tile-chat`, `tile-sweet_box`, `tile-samosa_only`, `tile-choc_strawberry`, `tile-marshmallow`, `tile-fountain`, seeded from the menu table. Each shows an inline SVG icon (no emoji), the item name and `£5.00` (or `£5`). Tiles are large: at least 48 px tall, mock-up `min-height: 212px` on tablet.

### C-02 Seed on first load (Menu table)
> **Superseded by H-07 (hotfix H1): ten documents, eight active.**

**Steps** Clear Firestore, load `#/cash`, then read the `menu` collection.
**Expected** Ten documents with ids `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain, samosa, straw`, `price: 500`, the colours and stations from the table. Seeding happens only when `menu` is empty — a second load does not duplicate.

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
**Expected** `change-due` reads `£5.00`. Tap `tender-1000` (short of £15): change is not shown or shows `£0.00` — never a negative amount. Tap `pay-card`: the quick cash buttons and `change-due` disappear. (Phase II: nothing about the tender is written to the order at all — see section 17.)

### C-08 Send button size and disabled state (FR Cash 4)
**Steps** Load `#/cash` with nothing in the order.
**Expected** `send-order` is present and `disabled`. Add one item: it enables and is at least 72 px tall (mock-up 84 px).

### C-09 Send writes the order, toasts, clears
**Steps** Build 3 × Fuchka (£15.00), name `Priya`, cash, tendered £20, tap `send-order`.
**Expected** `order-toast` appears containing the order number `A-001`; the panel clears (no lines, `order-total` £0.00, name empty, `send-order` disabled again); the toast disappears after about 4 s. Firestore holds one order with `orderNo:"A-001"`, `name:"Priya"`, `total:1500`, `payment:"cash"`, `status:"new"`, today's `day`, `till:"A"`, numeric `createdAtMs`, and **no** `tendered`/`changeGiven` key.

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
**Expected** A sent order has every field from the data model block: `orderNo, name, items[{id,name,qty,price}], total, payment, status, day, till, createdAtMs, createdAt`. `total` and every `price` are integers. It carries **no** `tendered` and **no** `changeGiven` key (requirement change 2026-10-18).

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
`qa/screenshots/<project>-<screen>-<state>.png` where `<project>` ∈ {phone, tablet}, `<screen>` ∈ {login, landing, cash, kitchen, reports}, `<state>` ∈ {empty, orders} (login uses `empty`, `error` and `confirm`; the cash screen also has `tender`). The password field is **always masked** in a screenshot — the Show/Hide toggle is never left on. 22 files minimum, plus failure screenshots from Playwright and `qa/screenshots/live-*.png` from the smoke run.

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

---

# Phase II

Added 2026-10-18. Source: `CLAUDE.md` → "Login and sign out" (1–9), "Cash counter" 3 (rewritten), the user's 2026-10-18 requirement change (cash received is screen-only: no `tendered`, no `changeGiven`, CSV unchanged), and the mock-ups `design/Login.dc.html`, `design/LoginMobile.dc.html`, `design/CashCounter.dc.html`, `design/CashCounterMobile.dc.html`.

## 16. Login, session and sign out — `#/login` (`G-*`)

### 16.0 Credential handling (rule for this whole section)

The shared username and password are read **at run time** from the gitignored `.secrets/app-login.env` (`APP_LOGIN_USER`, `APP_LOGIN_PASSWORD`) by `tests/e2e/creds.js`. They are **never** written into a test file, a fixture, a config file, a screenshot, a log, this plan or `qa/bugs.md` — all of those are committed to a public repo. A failed-login case always uses an obviously fake password (`"not-the-password-xxx"`). Screenshots are taken with the password field masked. `U-25` fails the build if either credential ever appears in a tracked file.

If `.secrets/app-login.env` is absent, the cases that need the real password skip with a clear message; the structural cases (`G-01`…`G-04`, `G-10`, `G-11`) still run.

### G-01 Login screen furniture (FR Login 1)
**Steps** Load `#/login` signed out, both projects.
**Expected** The NBA logo `public/img/nba-logo.png` with a non-empty `alt`, rendered about 168 px on tablet and 132 px on phone (±12 px, per the mock-ups); `h1` "Nottingham Bengali Association"; the subheading "Food Stall Application" in `#B5050F` (`rgb(181, 5, 15)`); a labelled Username field and a labelled Password field (`type="password"`); a Sign in button; the helper line "One shared login for stall volunteers. Ask the stall lead if you don't have it." exactly.

### G-02 Field sizes (FR Login 1)
**Expected** Username and Password inputs are 60 px tall on tablet (`design/Login.dc.html`), and at least 56 px on phone (`design/LoginMobile.dc.html`); tolerance −1 px. Sign in is at least 64 px tall, background `#B5050F` (`rgb(181, 5, 15)`), colour white.

### G-03 Show/Hide sits inside the password field (FR Login 1)
**Steps** Click the Show/Hide control.
**Expected** It is a real `<button type="button">` whose box is inside the password input's box; label reads "Show" when masked and "Hide" when revealed; the input's `type` flips `password` → `text` → `password`; `aria-pressed` tracks the state. The control is at least 44 px tall.

### G-04 "Login not configured" (FR Login 4)
**Steps** (a) Route `**/js/login-config.js` to the committed placeholder body (`PASTE_USER` / `PASTE_SHA256`); (b) route it to a 404. Load `#/login`.
**Expected** In both cases the text "Login not configured" is shown and **no** Username/Password form is rendered; no uncaught exception; no console error.

### G-05 Correct credentials sign in (FR Login 2, 5)
**Steps** Type the real username and password, submit.
**Expected** Redirect to `#/`; `localStorage["nba.session"]` parses to an object with exactly the shape `{"user": "<username>", "at": <number ms>}` — `user` equals the typed/normalised username, `at` is within 60 s of now. The plain password appears nowhere in `localStorage` or `sessionStorage`.

### G-06 Username is trimmed and case-insensitive (FR Login 2)
**Steps** Sign in with `"  " + USER.toUpperCase() + "  "` and the correct password.
**Expected** Signed in.

### G-07 Password is exact (FR Login 2)
**Steps** Correct username with (a) a leading space on the password, (b) the password's case flipped (skipped when the password has no letters).
**Expected** Both rejected with the wrong-attempt behaviour of `G-08`.

### G-08 Wrong attempt behaviour (FR Login 3)
**Steps** Correct username, obviously fake password, submit.
**Expected** All of:
1. A box with `role="alert"` whose text is exactly "Username or password is wrong. Check and try again." (ignoring whitespace runs; the mock-up bolds the first sentence).
2. Both the username and the password input are outlined red — computed `border-color` is a red (R ≥ 120, R ≥ G + 60, R ≥ B + 60), and different from the neutral border before the attempt.
3. The password input's value is empty.
4. `document.activeElement` is the password input.
5. No session is written; the route is still `#/login`.

### G-09 No lockout, no counter, no delay (FR Login 3, Definition of done)
**Steps** Submit 12 consecutive wrong attempts, timing each; then submit the correct credentials.
**Expected** The form stays usable throughout: Sign in is never `disabled`, the fields are never `disabled` or `readonly`, and the visible text never contains "attempt", "locked", "too many", "wait", "try again in" or a countdown. No attempt takes more than 1.5 s and attempt 12 is not slower than attempt 1 by more than 500 ms (no escalating delay). The 13th, correct, attempt signs in straight away.

### G-10 Route guard, signed out (FR Login 6)
**Steps** With no session, load `#/`, `#/cash`, `#/kitchen`, `#/reports`, and an unknown route, by deep link and by hash change.
**Expected** Each ends on `#/login` with the login form visible; no screen content from the guarded route is left on the page; no console error.

### G-11 Route guard, signed in (FR Login 6)
**Steps** With a session, load `#/login`.
**Expected** Redirected to `#/`.

### G-12 Session has no expiry (FR Login 5)
**Steps** After signing in: reload each of `#/`, `#/cash`, `#/kitchen`, `#/reports`; also go offline, reload, come back online.
**Expected** Still signed in every time; never bounced to `#/login`.

### G-13 Sign out is last in every dark header (FR Login 7)
**Steps** On `#/`, `#/cash`, `#/kitchen`, `#/reports`, both projects.
**Expected** Exactly one Sign out control inside `header`; it is the right-most interactive element in the header (its right edge is ≥ every other header control's right edge). Tablet (≥ 700 px): an icon plus the visible text "Sign out", at least 44 px tall. Phone (< 700 px): icon only, 44 × 44 px (±1), `aria-label="Sign out"`, no visible text, an inline `<svg>` child (no emoji).

### G-14 Sign out clears the session and keeps till state (FR Login 7)
**Steps** Set till B on `#/`, send one order from `#/cash` (so `seq:B:<day>` exists), then Sign out from `#/kitchen`.
**Expected** `nba.session` is removed; the till-letter key and every `seq:<till>:<day>` key survive untouched; the route becomes `#/login`. Signing back in and returning to `#/cash` continues the sequence at `B-002`, and the landing page still shows till B.

### G-15 Cash counter discard confirm (FR Login 8)
**Steps** On `#/cash` add two items, then tap Sign out. `window.confirm` is replaced by a spy that records a call and returns `false`.
**Expected** `window.confirm` is **never called**. An in-page element appears containing "Discard the unsent order and sign out?" with a Cancel button and a Sign out button. The session still exists at this point.

### G-16 Confirm — Cancel (FR Login 8)
**Expected** Cancel closes the confirm, leaves the session in place, stays on `#/cash`, and the order panel still holds the two items with the same total.

### G-17 Confirm — Sign out (FR Login 8)
**Expected** The Sign out button in the confirm clears `nba.session` and routes to `#/login`; nothing is written to `orders`.

### G-18 No confirm with an empty panel (FR Login 8)
**Steps** On `#/cash` with no items, tap Sign out.
**Expected** Signs out immediately, no confirm, `#/login`.

### G-19 Login screen quality
**Expected** No console errors; `@axe-core/playwright` reports zero `serious`/`critical` violations on `#/login` (empty and error states); no horizontal scroll at 360 px; body text ≥ 17 px; the form submits on Enter in the password field.

### G-20 Login screenshots
**Expected** `qa/screenshots/<project>-login-empty.png` and `<project>-login-error.png` for both projects, password masked, plus `<project>-cash-confirm.png` for the discard confirm.

---

## 17. Cash received (optional) — `#/cash` (`T-*`)

Spec: `CLAUDE.md` → Cash counter 3. "Cash received (optional)" replaces the Phase I fixed tender buttons.

> **Requirement change, 2026-10-18 (from the user, overrides `CLAUDE.md`).** Cash received is purely an on-screen calculator for the cashier. **Nothing about it is persisted:** the order document contains neither `tendered` nor `changeGiven` — the keys are absent, not null — and the CSV keeps the thirteen Phase I columns. The short-amount storage question is retired; a short amount simply shows "Short by £x.xx" and the order sends normally.

### T-01 Section visibility and label
**Steps** `#/cash`, add 3 × Fuchka (£15.00), Cash selected.
**Expected** A block labelled "Cash received" with "(optional)" is visible. Selecting Card hides the whole block (quick buttons, Other amount and the message). Selecting Cash again shows it.

### T-02 Quick buttons and their sizes
**Expected** Five quick buttons in order: Exact, £5, £10, £20, £50. Height ≥ 44 px on phone, ≥ 54 px on tablet (tolerance −1 px). Each exposes pressed state (`aria-pressed`).

### T-03 Exact equals the order total
**Steps** £15.00 order, tap Exact.
**Expected** Received = 1500; the display reads "Change to give: £0.00" (tablet) / "Change £0.00" (phone). Sending writes an order document with **no** `tendered` and **no** `changeGiven` key.

### T-04 Tapping a selected quick button deselects it
**Steps** Tap £20, then tap £20 again.
**Expected** After the second tap `aria-pressed="false"` and the message area is empty (the "nothing when empty" state) — not "Short by £15.00".

### T-05 Other amount parsing
**Steps** On a £15.00 order type each of `17.50`, `17.5`, `£17.50`, `17`, `1,000` into Other amount.
**Expected** Parsed to 1750, 1750, 1750, 1700, 100000 pence; the change display reads £2.50, £2.50, £2.50, £2.00, £985.00. The input has `inputmode="decimal"`.

### T-06 Other and the quick buttons are mutually exclusive
**Steps** Tap £20, then type `17.50`; then tap £10.
**Expected** Typing clears the quick selection (all `aria-pressed="false"`) and the change follows the typed amount; tapping a quick button empties the Other box and the change follows the button.

### T-07 The four display states, exact wording
**Expected** On tablet: received ≥ total → "Change to give: £x.xx" in teal (`#0F766E`/`#134E4A` family: G ≥ 80, G > R + 30, B ≥ 60); received < total → "Short by £x.xx" in amber `#B45309` (`rgb(180, 83, 9)`); unparseable (`abc`, `--`, `1.2.3`) → "Enter an amount like 17.50" in amber; empty → no message at all. On phone the short forms "Change £5.00", "Short £2.00", "Check amount" appear beside the "Cash received" label. The readout is exposed as `role="status"` (mock-ups).

### T-08 Clear link (tablet)
**Steps** Tablet, enter an amount, click Clear.
**Expected** The quick selection and Other box are empty and no message is shown. (On phone the mock-up has no Clear link; its absence there is not a defect.)

### T-09 Resets
**Expected** The cash-received state resets to empty when: (a) Card is selected; (b) the order is sent; (c) the order is cleared / emptied with the − buttons. After (b) a new order starts with no amount and no message.

### T-10 It never blocks sending (critical)
**Steps** Three separate £15.00 orders: (a) no amount entered; (b) `10` (short); (c) `abc` (unparseable).
**Expected** In all three, Send to food counter is enabled, the order is written, the toast shows the order number and the panel clears. (b) shows "Short by £5.00" and still sends. None of the three order documents contains a `tendered` or a `changeGiven` key.

### T-11 Nothing about cash received is persisted
**Requirement change, 2026-10-18 (overrides the `CLAUDE.md` data model):** Cash received is purely an on-screen calculator for the cashier.
**Steps** Send a £15.00 cash order with £20 keyed in (so "Change to give: £5.00" is on screen); send a card order.
**Expected** Neither order document contains a `tendered` key nor a `changeGiven` key — not even set to `null`. `Object.keys(order)` is asserted, so an explicit `null` fails.

### T-12 Send is only ever disabled by an empty order
**Expected** With items in the panel, Send is enabled for every cash-received state above, and is ≥ 72 px tall throughout.

### T-13 Cash received screenshots
**Expected** `qa/screenshots/<project>-cash-tender.png` with a change-to-give state on screen.

---

## 18. Phase II unit cases (`logic.js`)

### U-25 Secret hygiene — login credentials
**Expected** No tracked file (`git ls-files`) contains the `APP_LOGIN_USER` value or the `APP_LOGIN_PASSWORD` value from `.secrets/app-login.env`, nor a string matching `AIza[0-9A-Za-z_-]{35}`, nor `"private_key"`. `.secrets/` and `public/js/login-config.js` are untracked.

### U-26 Cash input parsing is pure and unit-testable
**Expected** `logic.js` exports a parser for the Other amount box (any of `parseAmountInput`, `parseMoneyInput`, `parseCashInput`, `parseTenderInput`, `parsePounds`, `parseAmount`). It returns pence for `17.50`→1750, `17.5`→1750, `£17.50`→1750, `17`→1700, `1,000`→100000, ` 17.50 `→1750, `£1,000.05`→100005; `null`/invalid for ``, `abc`, `--`, `1.2.3`, `-5`, `£`. `CLAUDE.md` → Technical constraints: "Put all pure logic (money …) in `public/js/logic.js` … so it is unit-testable".

### U-27 On-screen change calculation
**Expected** Where `logic.js` exposes the calculation as a pure function (`changeGiven` or similar), received ≥ total → received − total (0 when equal), received < total → `null`, nothing received → `null`. Nothing is stored; this pins the arithmetic behind the "Change to give" line only, and the case is skipped if the app keeps the calculation inside the view.

### U-28 CSV header is unchanged from Phase I
**Expected** The first line is exactly
`day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds`
— 13 columns, with **no** `tendered` and **no** `changeGiven` column (requirement change 2026-10-18). A stray `tendered`/`changeGiven` on a legacy order document must not leak into the export.

---

## 19. Phase II deliberate readings of the brief

1. **Nothing about cash received is persisted** (requirement change from the user, 2026-10-18, overriding the `CLAUDE.md` data model and Reports 6). The order document omits `tendered` and `changeGiven` entirely, the CSV keeps its thirteen Phase I columns, and there is nothing to assert about a short amount beyond the on-screen "Short by £x.xx" and the order sending normally.
2. **Field height on phone.** FR Login 1 says 60 px fields; `design/LoginMobile.dc.html` uses 56 px. The mock-up governs the phone, the brief governs the tablet.
3. **Touch targets below 700 px.** Sign out is deliberately exactly 44 × 44 under the breakpoint (`CLAUDE.md` Login 7), and the quick cash buttons have their own 44 px minimum (Cash 3), so `X-02` exempts those from the general 48 px floor at phone width only.
4. **"Teal"** for Change to give is accepted as the `#0F766E`/`#134E4A` family (the mock-up uses the darker `#134E4A` for text on white).
5. **Exact wording of the error box.** The mock-up bolds "Username or password is wrong." inside the alert; the assertion is on the whitespace-normalised text content, so markup inside the box is free.
6. **Login screen header.** Both login mock-ups are a plain centred card with no dark header bar, so `#/login` is not in the `X-04` route list.

---

# Hotfix H1 — split menu items (18 Oct 2026)

Added 2026-10-18, written from `CLAUDE.md` → "Menu" (the ten-row table) and "Hotfix H1: split menu items (18 Oct 2026)" (1–6), **before reading Neo's implementation**. Case ids `H-*`.

Scope of this hotfix for QA: the menu seed, the icons, `stationOf`, the till's tile set and phone layout with eight tiles, and — the part that matters most — **backwards compatibility of existing orders that contain the retired ids `samosa` and `straw`**. Live Firestore holds real trading records from this evening's service, two of which contain those ids, so a regression here corrupts actual accounts.

**Explicitly out of scope here:** Phase III (`#/reports/days`, Sales by day). It is deferred and no `H-*` case touches it.

**Write discipline.** Every H1 case runs against the Firestore emulator. Nothing in this hotfix writes to live Firestore; the single permitted live write is Trinity's `scripts/menu-sync.mjs` run, which Trinity tests against the emulator and which is not exercised by this suite. The H1 live verification (`H-20`) is **read-only**.

## 20. H1 unit cases — `public/js/logic.js`, `public/js/icons.js`

### H-01 The `MENU` seed is exactly the brief's table
**Expected** `MENU` has exactly ten rows and, row by row, field by field, matches the table in `CLAUDE.md` → Menu: `id`, `name`, `short`, `price` (500 everywhere, integer pence), `colour` (upper-case hex), `station`, `active`, `sort`.

| id | name | short | colour | station | active | sort |
|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | Fuchka | #FDE68A | chaat | true | 1 |
| momo | Momo | Momo | #BFDBFE | momo | true | 2 |
| chat | Papri Chat | Papri Chat | #FECACA | chaat | true | 3 |
| sweet_box | Sweet Box | Sweet Box | #FED7AA | sweets | true | 4 |
| samosa_only | Samosa | Samosa | #D9F99D | sweets | true | 5 |
| choc_strawberry | Chocolate Strawberry | Choc Strawberry | #E9D5FF | sweets | true | 6 |
| marshmallow | Marshmallow (V) | Marshmallow | #FBCFE8 | sweets | true | 7 |
| fountain | Chocolate Fountain | Choc Fountain | #E7D3BF | sweets | true | 8 |
| samosa | Sweets Box Samosa / Shingara | Sweets Box | #FED7AA | sweets | **false** | 90 |
| straw | Chocolate Strawberry & Marshmallow (V) | Choc Strawberry | #E9D5FF | sweets | **false** | 91 |

Ids are unique; no id is reused ("Never reuse a retired id").

### H-02 Eight active items, sorts 1–8
**Expected** Exactly eight rows have `active: true`, their `sort` values are exactly 1…8 with no gaps or duplicates, and in sort order they read `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain`. Exactly two rows have `active: false`: `samosa` (90) and `straw` (91). Whatever list `logic.js` exports for the till (`ACTIVE_MENU`) holds those eight and neither retired id.

### H-03 `stationOf` knows every id, old and new (H1 3)
**Expected** `stationOf` returns `sweets` for all four new ids (`sweet_box`, `samosa_only`, `choc_strawberry`, `marshmallow`) and for `fountain`; `chaat` for `fuchka` and `chat`; `momo` for `momo`. It still returns `sweets` for the **retired** `samosa` and `straw` — it does not throw and does not fall through to a default/`null`. An unknown id is still falsy and still does not throw. `inStation` follows: a retired-id line is inside the `sweets` filter and outside `chaat`/`momo`.

### H-04 Icons for the four new ids, and the two retired icons kept (H1 2)
**Expected** `itemIcon(id)` returns an inline `<svg>` for each of the ten ids. For all ten the body differs from the `unknown` fallback body — i.e. every menu id, including `samosa` and `straw`, has a real icon of its own. `sweet_box`, `samosa_only`, `choc_strawberry` and `marshmallow` are present; `samosa` and `straw` are still present ("Keep `samosa` and `straw` icons for old orders"). The markup is `aria-hidden="true"`, `focusable="false"`, stroke-only, no emoji code point anywhere.

### H-05 Reports name legacy lines by their original name (H1 6)
**Expected** `buildReport` on a day that mixes old and new lines produces **separate** rows for `samosa` and `samosa_only`, and for `straw` and `choc_strawberry` — ids are never merged. A line carrying `{id:'samosa', name:'Sweets Box Samosa / Shingara'}` reports under that name, not "Samosa". A line carrying `{id:'straw'}` with **no** `name` falls back to the seed and reports as "Chocolate Strawberry & Marshmallow (V)" — this is the reason the retired rows stay in `MENU`. New lines report under the new names. Units and revenue are per id.

### H-06 CSV exports legacy lines under their original names (H1 6)
**Expected** `ordersToCsv` writes the stored line name for legacy lines (`Sweets Box Samosa / Shingara`, `Chocolate Strawberry & Marshmallow (V)`) and the new names for new lines, in the same thirteen-column shape. Nothing is rewritten or migrated; the `item` column of a legacy row is byte-for-byte the stored name. The names containing a comma are not an issue here, but `Marshmallow (V)` and the `/` name are checked to survive unquoted/quoted correctly.

## 21. H1 end-to-end cases (both projects)

### H-07 Seed writes ten menu documents, eight active (H1 1)
**Steps** Clear Firestore, load `#/cash`, read the `menu` collection.
**Expected** Ten documents whose ids and `name/short/price/colour/station/active/sort` fields match the H-01 table exactly. `samosa` and `straw` are present with `active: false`. A second load does not duplicate or change them.

### H-08 The till shows exactly the eight active tiles (H1 5)
**Steps** Load `#/cash`.
**Expected** Exactly eight `[data-testid^="tile-"]` elements, in sort order `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain`. `tile-samosa` and `tile-straw` do **not** exist. Each tile shows an inline SVG, the item name and £5.00, and is at least 48 px tall.

### H-09 Phone layout: all eight tiles reachable, the order bar covers none (H1 5) — **critical**
**Steps** `phone` project (390 × 844), `#/cash`, with an order in the panel so the sticky bottom order bar is at its tallest. For each of the eight tiles: scroll it into view inside the tile area, then read `document.elementFromPoint(centreX, centreY)` at the tile's centre.
**Expected** For every tile, the element at its own centre is the tile or a descendant of it — not the sticky order bar, not an overlay. Then tap the **eighth** tile (`fountain`) by coordinate and assert its quantity badge increments, proving the tap landed on the tile. This is the Phase I blocker failure mode (BUG-2), where a passing visibility assertion hid a covered control, so visibility alone is not accepted as evidence.

### H-10 No horizontal scroll at 360 px with eight tiles
**Steps** 360 × 740, `#/cash` with an order in the panel, and `#/kitchen`, `#/reports`, `#/`.
**Expected** `scrollWidth <= clientWidth + 1` on every route, and no tile overflows the viewport on its right edge.

### H-11 Legacy order renders on the kitchen board (H1 6) — **critical**
**Steps** Seed an order directly into the emulator whose lines are `{id:'samosa', name:'Sweets Box Samosa / Shingara'}` and `{id:'straw', name:'Chocolate Strawberry & Marshmallow (V)'}` (the shape of a real 17 Oct order). Load `#/kitchen`.
**Expected** The card appears, shows both lines under their **original** names with quantities and an inline SVG icon each, and the Start → Ready → Collected action works on it. No console error, no "unknown item" text. With the station filter on `Sweets` neither line is greyed; on `Chaat` both are greyed but still shown (`CLAUDE.md` → Food counter 4).

### H-12 Legacy order in Reports under its original name (H1 6) — **critical**
**Steps** With the same seeded legacy order plus a new-id order on the same day, load `#/reports`.
**Expected** `item-row-samosa` and `item-row-straw` exist and show the original names and the right units/revenue; `item-row-samosa_only` and `item-row-choc_strawberry` are separate rows with the new names. The KPI totals include both. No row is merged or renamed.

### H-13 CSV export keeps the original names (H1 6)
**Steps** Export the CSV on that mixed day.
**Expected** The download parses; the `item` column holds `Sweets Box Samosa / Shingara` and `Chocolate Strawberry & Marshmallow (V)` for the legacy lines and the new names for the new lines; thirteen columns, one row per line.

### H-14 New orders use the new ids and names
**Steps** Place an order through the UI with all four new tiles.
**Expected** The written document's `items` carry ids `sweet_box, samosa_only, choc_strawberry, marshmallow` and names `Sweet Box, Samosa, Chocolate Strawberry, Marshmallow (V)`, `price: 500` each.

### H-15 Nothing is migrated (H1 6) — **critical**
**Steps** Snapshot the seeded legacy order document, then open `#/kitchen` and `#/reports` and let them run, then read it back.
**Expected** The stored `items` array is identical — same ids, same names — before and after. The app never rewrites a legacy order's lines. (Status transitions driven by a test are the only permitted change, and are not made in this case.)

### H-16 Kitchen station filter with the new ids (H1 3)
**Steps** An order with `fuchka` (chaat), `momo` (momo) and `marshmallow` (sweets); station filter `Sweets`.
**Expected** The `marshmallow` line is not greyed; `fuchka` and `momo` are greyed but visible. Under `Chaat` only `fuchka` is ungreyed.

### H-17 Quality on the eight-tile till
**Expected** `@axe-core/playwright`: zero serious/critical violations on `#/cash` with eight tiles, both projects. No console errors. Body text ≥ 17 px, `send-order` ≥ 72 px, `line-inc-*`/`line-dec-*` ≥ 52 px — unchanged by the extra tiles.

### H-18 Screenshots refreshed
**Expected** `qa/screenshots/<project>-cash-empty.png` and `<project>-cash-orders.png` regenerated showing eight tiles, both projects, plus `<project>-kitchen-legacy.png` showing a legacy-id card and `<project>-reports-mixed.png` showing old and new item rows side by side.

## 22. H1 live verification (gated, **read-only**) — `tests/e2e/live-h1.spec.js`

**Gate** `LIVE_H1=1`, the same style as the `S-*` smoke, so `npm run test:e2e` stays offline.
Run on 2026-10-19 against deploy `21e45ff` (Pages run `39177899282`), after Trinity's single `menu-sync` run. **14/14 passed, both viewports.**

**Write discipline.** Every Firestore call in the spec is a GET. No order is placed, no status changed, nothing cancelled, no menu document written. Tapping a till tile mutates the in-page order panel only — an order reaches Firestore solely through `send-order`, which is never clicked — and the panel is cleared afterwards. `H-20.0` and `H-20.6` bracket the run with a fingerprint of the orders collection to prove it. Apart from Trinity's `menu-sync`, nothing in this hotfix may write to live Firestore.

### H-20.0 Snapshot the live orders collection first
**Expected** A fingerprint (document id, orderNo, status, total, day, and every line's `id|name|qty|price`) is taken before anything else, for `H-20.6` to compare against.

### H-20.1 Every route loads clean, pill Online, login works
**Expected** `#/login` renders a real form (no "Login not configured"); the shared account signs in and lands on `#/`; `#/`, `#/cash`, `#/kitchen`, `#/reports` each render with no "Storage not configured" banner, `conn-pill` reading Online, and **zero** console errors across all four. Screenshots `qa/screenshots/live-h1-<project>-<screen>.png`, password masked.

### H-20.2 The live menu is the ten H1 documents, eight active
**Expected** Ten `menu/{id}` documents. `name`, `short`, `station` and `active` match the brief's table for all ten; the eight active rows in `sort` order are `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain` with sorts exactly 1–8; `samosa` and `straw` are present with `active: false` and are never deleted.
**Retired rows' `sort` is reported, not enforced.** `CLAUDE.md` → H1 4 tells `menu-sync` to "never overwrite a field that already has a different value … report differences instead", so a retired row that predates the hotfix legitimately keeps the sort it was created with. It is inactive (never a tile) and the reports group by id, so there is no functional effect. Any difference is written to `qa/live-smoke-record.txt` for Trinity.

### H-20.3 Exactly eight live tiles, and the eighth takes a real tap
**Expected** Exactly eight tiles in sort order; no `tile-samosa`, no `tile-straw`. Then, with items in the panel so the sticky order bar is at its tallest, every tile answers `document.elementFromPoint` at its own centre, and the **eighth** tile is clicked by coordinate with its quantity badge asserted to increment — the same proof as the emulator `H-09`, because visibility alone is not evidence. Finishes by clearing the panel and re-reading live Firestore to show the orders collection is untouched.

### H-20.4 The trading day still reports its legacy items under the original names
**Expected** On the most recent live trading day: total sales, order count and items sold equal the figures computed from the live documents, so the hotfix changed no past takings. Every id that traded has its own `item-row-<id>` showing the **stored** name and the right units, with no "unknown", "undefined" or blank. Spelled out for `samosa` → "Sweets Box Samosa / Shingara" and `straw` → "Chocolate Strawberry & Marshmallow (V)".

### H-20.5 The CSV for that day carries the original names
**Expected** The export downloads and parses: the thirteen Phase I columns, one row per order line, every `item` cell equal to the name stored on the live document — the retired ids under their original names — and no blank item cell.

### H-20.6 Nothing was written
**Expected** The orders collection is the same length and a byte-identical fingerprint to `H-20.0`; the menu still holds its ten documents.

## 23. H1 deliberate readings of the brief

1. **Tile order** is `sort` ascending. The brief gives sorts 1–8 for the active items, so that is the on-screen order; it is asserted, not left to insertion order.
2. **`samosa_only` and `choc_strawberry` reuse the retired items' icon art** (brief H1 2 says so explicitly), so H-04 asserts "has a real icon", not "has a unique icon".
3. **Station of the four new items is `sweets`** per H1 3, even though `samosa_only` is arguably chaat. The brief wins.
4. **Existing fixtures that carry `samosa`** (the Phase I report day) are kept deliberately: they are now backwards-compatibility fixtures and exercise H-05/H-12 for free.
5. **Six-tile assertions from Phase I are updated to eight.** That is the hotfix landing, not a defect, and is recorded in `qa/bugs.md` under "Test-side changes".
6. **Live retired rows keep their pre-hotfix `sort`** (4 and 5 rather than the table's 90 and 91). `menu-sync` is forbidden from overwriting an existing value, both rows are inactive, and reporting groups by id — so the live check records the difference instead of failing on it. A *fresh* seed must still follow the brief, which `H-01` and `H-07` enforce at 90/91.
