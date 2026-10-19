# QA test plan — Charity Food Stall POS, Phase I + Phase II + Hotfixes H1/H2 + Phase III + Phase IV

Author: Morpheus (QA). Source of truth: `CLAUDE.md` plus the mock-ups in `design/*.dc.html`.
**This plan tests the brief, not the implementation.** Where the app and `CLAUDE.md` disagree, the app is wrong and a bug is raised in `qa/bugs.md`.

---

## 1. Scope

In scope:

- Pure logic in `public/js/logic.js` (money, order numbers, Europe/London day string, change due, cash-received parsing and change calculation, report aggregation, CSV) — unit tested with Vitest.
- The routes `#/login`, `#/`, `#/cash`, `#/kitchen`, `#/reports`, `#/reports/days` and `#/reports/orders` — end-to-end tested with Playwright against the Firestore emulator.
- **Phase II Feature A** — login, session, route guard, Sign out in every header, the cash-counter discard confirm (sections 16).
- **Phase II Feature B** — Cash received (optional): quick buttons, Other amount, the four display states, resets, that it never blocks sending, and that **nothing about it is persisted** (section 17).
- Live data flow between two browser contexts (till → kitchen) via Firestore `onSnapshot`.
- Offline write queueing and the connection pill.
- Layout and touch-target constraints, accessibility (axe), console cleanliness.
- Secret hygiene: no committed string matching `AIza[0-9A-Za-z_-]{35}`.
- **Hotfix H1 (18 Oct 2026)** — the ten-row menu, the four new icons, `stationOf` for retired ids, the eight-tile till and phone layout, and backwards compatibility of orders holding `samosa`/`straw` (section 20–23).
- **Hotfix H2 (19 Oct 2026)** — cart line alignment (sections 24–26).
- **Phase III (19 Oct 2026)** — the Sales by day report `#/reports/days`, the One day / Sales by day toggle, the range rules and the range CSV (sections 27–28), and the app version label on the login card and in every dark header (section 29).
- **Phase IV (19 Oct 2026)** — the Orders list and order detail `#/reports/orders`, the third report tab, the filters, the live list, the detail panel and the orders CSV (sections 32–34), and the read-only live verification of the deployed v1.3.0 (section 35).
- Live smoke against `LIVE_URL`.

Out of scope (per brief): Firestore rules hardening (login is "a screen gate for volunteers, not security": `CLAUDE.md` → Login and sign out 9), Web Audio beep audibility and Screen Wake Lock behaviour (headless Chromium cannot assert these reliably — the *toggle control* is checked, the sound is not), Google Sheets integration, price editing UI.

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

IDs: `U-*` unit, `H-*` hotfix H1/H2, `L-*` landing, `C-*` cash counter, `K-*` food counter, `R-*` reports, `D-*` data model, `O-*` offline/connection, `X-*` cross-cutting design/a11y, `S-*` live smoke, `G-*` login gate / sign out (Phase II A), `T-*` cash received (Phase II B), **`P3-U-*` Phase III unit, `P3-*` Phase III end to end, `V-*` app version (Phase III part 2)**.

The cross-cutting `X-*` cases and the route-guard `G-10`/`G-12`/`G-13` cases now run over five routes, not four: `#/reports/days` was added to their route lists when Phase III landed.

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
`qa/screenshots/<project>-<screen>-<state>.png` where `<project>` ∈ {phone, tablet}, `<screen>` ∈ {login, landing, cash, kitchen, reports, reports-days}, `<state>` ∈ {empty, orders} (login uses `empty`, `error`, `confirm` and `version`; the cash screen also has `tender`; `reports-days` uses `orders` for the scripted range and `empty` for a range with no sales; `header-version` captures the header pill). The password field is **always masked** in a screenshot — the Show/Hide toggle is never left on. 22 files minimum, plus failure screenshots from Playwright and `qa/screenshots/live-*.png` from the smoke run.

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

**Explicitly out of scope here:** Phase III (`#/reports/days`, Sales by day) — it was deferred when H1 shipped and is covered from section 27 onwards instead. No `H-*` case touches it.

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

## 24. H2 end-to-end cases — cart line alignment (both projects)

Spec: `CLAUDE.md` → "Hotfix H2: cart line alignment (19 Oct 2026)" and "Cash counter 2" ("line items with − and + (each at least 52×52 px)"). File: `tests/e2e/cart-align-h2.spec.js`.

The defect was cosmetic but real: each cart row was a flex row sized by its item name, so "Chocolate Strawberry" pushed its − / + buttons further right than "Momo" did and the steppers did not line up down the column. **The assertions therefore compare the rows against each other, never against a hardcoded x.** A test pinned to a number would pass or fail for the wrong reason at a different viewport or font fallback, and would not describe the bug. Tolerance ±1 px, as the hotfix brief states.

Every case fills the cart with **all eight active menu items** (quantities 1…8, so the longest name "Chocolate Strawberry" and the shortest "Momo" are both in, and the quantity and line-total columns vary too).

### H-21 Steppers line up, nothing overflows, 52 px kept
**Steps** `#/cash`, tap each of the eight tiles (1…8 times), measure the whole cart in one layout pass.
**Expected**
1. **Alignment.** The spread of `line-dec-*` left x across the eight rows is ≤ 1 px, and likewise for `line-inc-*`. Spelled out for the two ends of the bug: `choc_strawberry` and `momo` have the same `dec.left` and the same `inc.left`. The quantity column's left edge and the line-total's right edge are also identical across rows (fixed columns plus tabular numbers), and every row starts at the same x with the same width.
2. **No overflow.** For every row, `.line__name` has `scrollWidth ≤ clientWidth` (it wraps, it does not clip or spill), the name's right edge is left of its own − button, the row is no wider than the container it sits in, and neither the row nor the line total spills past the order panel's right edge. The document still has no horizontal scroll.
3. **52 px kept.** Every `line-dec-*` and `line-inc-*` is ≥ 52 px wide **and** ≥ 52 px tall. `CLAUDE.md` → Cash counter 2 and the H2 note "keep the 52 px steppers" mean a fix that aligned the columns by shrinking the buttons would be wrong, so this is asserted explicitly rather than assumed.

A full geometry table (row left/width, dec and inc left/width/height, qty left, amount right) is printed for both viewports so the measured positions are in the run log whether the case passes or fails, and is embedded in every failure message.

### H-21.2 The column survives an edit
**Steps** From the full cart, step Momo down to zero so its row leaves, then push `choc_strawberry` to a two-digit quantity.
**Expected** Removing the shortest row does not move the stepper column (`choc_strawberry`'s `dec.left` is unchanged, ±1 px) and the remaining seven rows stay aligned. A two-digit quantity does not shift either column — the quantity has its own fixed track with `font-variant-numeric: tabular-nums` — and no row grows wider than its container.

### H-21.3 Alignment at 360 px
**Steps** Viewport 360×740, full cart.
**Expected** Both stepper columns still line up to ±1 px, no `.line__name` overflows, both steppers are still ≥ 52 px, no row spills past the panel, and there is no horizontal scroll (`CLAUDE.md` → Design).

### H-21 screenshots
`qa/screenshots/<project>-cash-cart-aligned.png` for both projects, showing the eight-line cart.

## 25. H2 live check (gated, **read-only, zero writes**) — `tests/e2e/live-h2.spec.js`

**Gate** `LIVE_H2=1`. Not run as part of `npm run test:e2e`; run after the deploy with `LIVE_H2=1 npx playwright test tests/e2e/live-h2.spec.js`.
Run on 2026-10-19 against deploy `bdf8954` (Pages run `39181519382`). **8/8 passed, both viewports.**

**Cache discipline.** The stylesheet is served with `cache-control: max-age=600`, so a context holding the pre-fix CSS could measure the old layout against a correct origin and report a false failure. Three guards: a fresh Playwright context per test; the browser HTTP cache switched off over CDP (`Network.setCacheDisabled`) before the first navigation; and `H-22.2`'s cache-busted byte comparison. A `Cache-Control: no-cache` request header is deliberately **not** used — it is not CORS-safelisted, so Playwright would attach it to the Firebase SDK's cross-origin module imports and preflight them into failure, hanging the app on "Loading…".

**Write discipline — stricter than H1.** H2 permits **no write to live Firestore at all**, not even the single `menu-sync` exception H1 had. Every Firestore call in the spec is a GET. No order is placed (`send-order` is never clicked), no status is changed, nothing is cancelled, no menu document is touched. Tapping a till tile mutates the in-page order panel only — local state that reaches Firestore solely through `send-order` — and the panel is cleared again afterwards. `H-22.0` and `H-22.3` bracket the run with a fingerprint of the orders collection (document id, orderNo, status, total, day and every line's `id|name|qty|price`) to prove it.

**Credentials** read at run time from the gitignored `.secrets/app-login.env`. Never in a test file, a log line, a screenshot or `qa/live-smoke-record.txt`. The Show/Hide toggle is never pressed, so the password field stays masked in every capture.

### H-22.0 Snapshot the live orders collection first
**Expected** A fingerprint is taken before anything else, for `H-22.3` to compare against.

### H-22.1 The live cart lines up with every active item in it
**Steps** Sign in, open `#/cash`, tap each of the eight tiles (local state only), measure the cart. Both viewports.
**Expected** The same three groups as `H-21`: stepper columns aligned to ±1 px row against row (spelled out for "Chocolate Strawberry" vs "Momo"), no `.line__name` overflow and no row past the panel edge, steppers still ≥ 52×52, no horizontal scroll, no "Storage not configured" banner and zero console errors. Screenshots `qa/screenshots/live-h2-cart-<project>.png`, plus `live-h2-cart-phone-all-lines.png`: on the phone the cart lines sit in an internal scroller inside the sticky sheet, so the 390×844 capture shows one row: a second capture is taken at the **same 390 px width** on a taller viewport, with the grid tracks and the stepper alignment re-measured and re-asserted before the shutter so the picture is verified, not illustrative. Finishes by clearing the panel and asserting `order-toast` is hidden and holds no order number.

### H-22.2 The deployed stylesheet really carries the fixed-column rule
**Expected** Two independent reads. (i) The **served bytes**: a cache-busted `GET css/app.css?cb=<now>` contains `grid-template-columns: minmax(0, 1fr) 52px 28px 52px 58px`, contains no `.line { … display: flex }` rule, and has the same SHA-256 as the committed `public/css/app.css`. (ii) The **resolved computed style** in the browser that just measured the cart: `display: grid` with **five** tracks, the second and fourth ≥ 52 px. Measurement alone could in principle pass on a stale cached bundle that happened to line up; this catches one instead of measuring it.

### H-22.3 Nothing was written
**Expected** The orders collection is the same length and a byte-identical fingerprint to `H-22.0`; the menu still holds its ten documents.

## 26. H2 deliberate readings of the brief

1. **Row-against-row, not against a number.** The brief describes the defect as a *difference between rows*, so every alignment assertion is a spread across the eight rows. No expected x is hardcoded anywhere in `cart-align-h2.spec.js`.
2. **Quantities 1…8, all single digit, in the main case.** The brief's grid gives the quantity a fixed 28 px track and the line total 58 px. Varying the quantity proves the steppers do not move when the numbers change width, without asking those two tracks to hold more than the brief sizes them for. The two-digit case is kept in `H-21.2`, where only the stepper columns and the row width are asserted.
3. **52 px is asserted on width *and* height.** `CLAUDE.md` → Cash counter 2 says "each at least 52×52 px"; the H2 note says keep them. A fix that aligned the columns by narrowing the buttons would satisfy alignment and break the brief, so both dimensions are checked on all eight rows.
4. **Overflow is checked three ways** — `scrollWidth` vs `clientWidth` on the name, the name's right edge against its own − button, and the row's right edge against the order panel's — because a grid track with `minmax(0, 1fr)` can clip content without ever widening the row.
5. **H2 adds no unit case.** The change is pure CSS; `logic.js` is untouched, so there is nothing new to unit-test. The existing `U-*` suite is unchanged.
6. **Phase III (Sales by day) landed on 19 Oct 2026** and is covered from section 27 onwards. H2's assertions are unchanged by it.

---

# Phase III — Sales by day, and the app version label

Added 2026-10-19. Source: `CLAUDE.md` → "Phase III: Sales by day report" 1–10 and "Phase III (part 2): App version on login and headers" 1–6, plus the mock-ups `design/ReportsByDay.dc.html` (the whole file, including the script that fixes the layout maths, colours and label formats), the One day / Sales by day toggle in `design/Reports.dc.html`, the `v1.2.0` pill in the headers of the other mock-ups and the version footer of `design/Login.dc.html` / `design/LoginMobile.dc.html`.

Written against the brief, not against `public/js/reports-days.js`. Every figure asserted end to end is hand-calculated in section 27.1 and restated as literals in `tests/e2e/helpers.js` → `rangeExpect()`; the unit fixture `tests/unit/range-fixtures.js` carries the same numbers for the pure layer. Where a value could be produced by the code under test (a weekday name, a money string), the test computes it independently.

**Write discipline.** Everything in this phase runs against the Firestore emulator. Nothing here writes to live Firestore; the live check comes after the deploy and is read-only.

## 27. Phase III unit cases — `public/js/logic.js` (`P3-U-*`), `tests/unit/range.test.js`

### 27.1 The scripted range (hand-calculated)

Seven consecutive days, five of which trade. Every item is £5. In the unit fixture the range is 13–19 Oct 2026; end to end it is the last seven London days, so the screen's default range covers it exactly.

| Day | Orders | Lines | Items | Sales | Cash | Card | Avg order | Peak 30 min |
|---|---|---|---|---|---|---|---|---|
| Tue 13 Oct | 2 | 2 | 3 | £15.00 | £10.00 | £5.00 | £7.50 | 11:00–11:30 |
| Wed 14 Oct (+1 **cancelled**) | 2 | 3 | 5 | £25.00 | £15.00 | £10.00 | £12.50 | 12:00–12:30 |
| Thu 15 Oct | — | — | — | — | — | — | — | *no orders: absent* |
| Fri 16 Oct (legacy ids, one order carries `tendered`) | 2 | 2 | 3 | £15.00 | £10.00 | £5.00 | £7.50 | 13:00–13:30 |
| Sat 17 Oct (**best day**) | 3 | 3 | 16 | £80.00 | £60.00 | £20.00 | £26.67 | 14:00–14:30 |
| Sun 18 Oct | — | — | — | — | — | — | — | *no orders: absent* |
| Mon 19 Oct | 2 | 4 | 6 | £30.00 | £15.00 | £15.00 | £15.00 | 10:00–10:30 |
| **Total** | **11** | **14** | **33** | **£165.00** | **£110.00** | **£55.00** | **£15.00** | — |

Derived tiles: items per order 33/11 = **3.0**; best day **Sat 17 Oct £80.00**; average per trading day £165.00/5 = **£33.00**, note **2 orders a day** (round(11/5)).

Items sold by day (menu sort order; retired ids keep their original names and never merge with the new ones):

| Item | Tue | Wed | Fri | Sat | Mon | Total | Sales | Best day |
|---|---|---|---|---|---|---|---|---|
| Fuchka / Gol Gappa | 2 | 0 | 0 | 10 | 1 | 13 | £65.00 | Sat |
| Momo | 1 | 0 | 0 | 4 | 1 | 6 | £30.00 | Sat |
| Papri Chat | 0 | 3 | 0 | 0 | 1 | 4 | £20.00 | Wed |
| Sweet Box | 0 | 1 | 0 | 0 | 0 | 1 | £5.00 | Wed |
| Chocolate Strawberry | 0 | 0 | 0 | 0 | 3 | 3 | £15.00 | Mon |
| Marshmallow (V) | 0 | 1 | 0 | 0 | 0 | 1 | £5.00 | Wed |
| Chocolate Fountain | 0 | 0 | 0 | 2 | 0 | 2 | £10.00 | Sat |
| Sweets Box Samosa / Shingara (**retired**) | 0 | 0 | 2 | 0 | 0 | 2 | £10.00 | Fri |
| Chocolate Strawberry & Marshmallow (V) (**retired**) | 0 | 0 | 1 | 0 | 0 | 1 | £5.00 | Fri |

`samosa_only` never sold in the range, so it has no row at all.

### P3-U-01 `isDayString`
**Expected** `true` only for a real `YYYY-MM-DD` calendar day (`2026-02-29` is false, `2024-02-29` true). Never throws on `''`, `19/10/2026`, `null`, a number or an object.

### P3-U-02 `addDays` / `dayDiff` / `rangeLength` / `listDays`
**Expected** Calendar arithmetic over month and year ends. **Crossing the BST → GMT change on 25 Oct 2026 adds exactly one day, not 23 or 25 hours** (the arithmetic runs at UTC midnight on day strings that are already Europe/London dates). `rangeLength` is inclusive and order-independent; `listDays` is ascending whichever way round the ends are, and `[]` for an unusable end.

### P3-U-03 Day labels
**Expected** `weekdayShort('2026-10-18') === 'Sun'`, `formatDayShort === '18 Oct'`, `formatDayLabel === 'Sun 18 Oct'` (the chart and table label from the mock-up), `formatDayLong('2026-10-19') === '19 Oct 2026'` (the version line). `''` for junk.

### P3-U-04 `clampRange` (`CLAUDE.md` Phase III 2)
**Expected** A good range is untouched. **To before From swaps them** (`swapped: true`). **Exactly 31 days is allowed**; **32 days is `tooLong`, carries the message `Pick 31 days or fewer` and lists no days**, so the screen has nothing to query — the same when the long range is given the wrong way round. One end missing collapses to the other; both missing is invalid and never throws.

### P3-U-05 Default and quick ranges
**Expected** `defaultRange('2026-10-19')` is `2026-10-13 → 2026-10-19` — **the last 7 days ending today**. `todayRange` is a single day. With no argument both end on the Europe/London today.

### P3-U-06 `ordersInRange`
**Expected** Inclusive on both ends, by `day` string; `[]` for an unusable end; nothing in a range with no orders.

### P3-U-07 Trading days only (`CLAUDE.md` Phase III 4)
**Expected** One row per day that traded, ascending; the two quiet days appear nowhere, not even as zero rows. An empty range gives `tradingDays: 0`, `empty: true`, zeroes rather than `NaN`, `best: null`, and the message constant is `No sales in this range`. A range holding only cancelled orders is empty.

### P3-U-08 Per-day rows
**Expected** Row by row, field by field, the table in 27.1: weekday, date, label, orders, items, sales, cash, card, average order and peak 30 minutes. `cash + card === sales` on every row and sales is an integer.

### P3-U-09 Cancelled orders excluded everywhere (`CLAUDE.md` Phase III 3)
**Expected** The whole report — every day row, the totals, the matrix, the best day — is byte-identical to a report built from the same orders with the cancelled one removed before it ever arrives.

### P3-U-10 Totals tiles (`CLAUDE.md` Phase III 5)
**Expected** Total sales £165.00, orders 11, items 33 (3.0 per order), best day Sat 17 Oct £80.00, average per trading day £33.00 with 2 orders a day. **A tie for best day goes to the earlier day** (the brief is silent; the earlier day is the deliberate reading, matching the peak-slot rule).

### P3-U-11 Totals row of the day table (`CLAUDE.md` Phase III 7)
**Expected** Each total equals the sum of the rows actually on screen, and `cash + card === sales`.

### P3-U-12 Items sold by day (`CLAUDE.md` Phase III 8, Hotfix H1 6)
**Expected** The matrix in 27.1: one row per item that sold, in menu order with the retired ids last; a cell per trading day; `Total` and `Sales` columns; **each item's best day flagged exactly once**; retired ids under their original names, never merged with `samosa_only`/`choc_strawberry`. Row totals sum to 33 items and £165.00.

### P3-U-13 The legacy `tendered` field is ignored (`CLAUDE.md` Phase III 10)
**Expected** Deleting `tendered` from every order changes nothing in the report.

### P3-U-14 Range CSV (`CLAUDE.md` Phase III 9)
**Expected** Exactly the One day columns, in the One day order. One row per order line in range, cancelled excluded. **No `tendered` or `changeGiven` column, and the legacy tender amount never appears on its order's row.** Retired ids keep their stored names. Every trading day is represented. The file name is `nba-food-stall_<from>_<to>.csv`.

### P3-U-15 Money formatting on the by-day screen
**Expected** `formatPenceGrouped(200500) === '£2,005.00'` (thousands grouped, as the mock-up), `formatPoundsRounded(200500) === '£2,005'` (gridlines), and bar labels stay exact until the figures reach four digits. The readout string is `Sun 18 Oct · £2,005.00 · 208 orders`.

## 28. Phase III end-to-end cases — `#/reports/days` (`P3-*`, both projects)

Every case clears Firestore and seeds the scripted range from 27.1 relative to today's London day, so the screen's default range ("Last 7 days ending today") covers it exactly. File: `tests/e2e/reports-days.spec.js`.

### P3-01 The toggle, both ways (`CLAUDE.md` Phase III 1)
**Steps** `#/reports`, then `#/reports/days`.
**Expected** `report-toggle-day` and `report-toggle-days` are present on **both** report screens, each at least 48 px tall. The current view is filled ink `#1C1917` and the other is not. Tapping each navigates to the other route and the other screen renders.

### P3-02 Direct load and the default range (`CLAUDE.md` Phase III 2)
**Expected** `#/reports/days` loads straight from the URL. `range-from` and `range-to` are `input[type=date]`; To is today and From is today − 6.

### P3-03 Trading days only, cancelled excluded (`CLAUDE.md` Phase III 3, 4)
**Expected** A `day-row-<day>` and a `day-bar-<day>` for each of the five trading days; **nothing at all** for the two quiet days; five rows plus the totals row in `days-table`. The cancelled Wednesday order shows in no figure.

### P3-04 The five totals tiles and their notes (`CLAUDE.md` Phase III 5)
**Expected** `tile-total-sales` £165.00; `tile-orders` 11 with the note "excludes cancelled"; `tile-items` 33 with "3.0 per order"; `tile-best-day` naming Sat 17 Oct and £80.00; `tile-avg-day` £33.00 with "2 orders a day".

### P3-05 The bar chart (`CLAUDE.md` Phase III 6)
**Expected** One bar per trading day and no more. Each bar is a **real `<button>`** with an `aria-label` carrying its day, its sales and its order count, and a value label on the bar. **Best day `#B45309`, every other bar `#FBBF24`.** Weekday and date under each bar. The readout `days-readout` reads `Sat 17 Oct · £80.00 · 3 orders` — the mock-up format — on **hover, on focus and on tap**, each asserted separately with the pointer parked away from the chart in between.

### P3-06 The Day by day table (`CLAUDE.md` Phase III 7)
**Expected** Columns Day, Orders, Items, Sales, Cash, Card, Avg order, Peak 30 min (plus the Open column). Every cell of every `day-row-<day>` matches 27.1 exactly, and `days-totals-row` matches the Total line.

### P3-07 "Open day" (`CLAUDE.md` Phase III 7)
**Expected** `open-day-<day>`'s `href` is exactly `#/reports?day=<day>`; following it lands on the One day report **with `report-date` set to that day** and `kpi-sales`, `kpi-orders`, `kpi-items` equal to that day's hand-calculated figures.

### P3-08 Items sold by day (`CLAUDE.md` Phase III 8, Hotfix H1 6)
**Expected** `items-by-day-table` header is `Item`, one column per trading day, then `Total` and `Sales`. The rows are the matrix in 27.1, in the same order, with the same numbers. **Each item's best-day cell is shaded `#FEF3C7` and no other day cell in that row is.** The retired ids appear under their original names alongside the new ones. The note reads "Shading marks each item's best day."

### P3-09 Export CSV for Sheets (`CLAUDE.md` Phase III 9, 10)
**Expected** The download is named `nba-food-stall_<from>_<to>.csv`; the header is the thirteen One day columns in the One day order; there are **14** data rows (one per order line in range) and the cancelled order is absent; `lineTotal = qty × price` on every row; every trading day is represented; **`tendered` appears nowhere**, including on the legacy order's row; the legacy line's `item` cell is its stored name.

### P3-10 Swap, Today and Last 7 days (`CLAUDE.md` Phase III 2)
**Expected** Entering To before From swaps the two inputs and shows no error. `quick-today` sets both inputs to today and leaves only today's figures (£30.00). `quick-7days` restores today − 6 → today and the full £165.00.

### P3-11 The 31-day maximum (`CLAUDE.md` Phase III 2) — **and that it makes no query**
**Expected** A 31-day range is accepted and queried. A 32-day range shows `range-error` reading exactly `Pick 31 days or fewer`, and **no request to the Firestore emulator carries the out-of-range From date** — proved by recording every request to `127.0.0.1:8080` (URL and body) across the change, not by watching the screen. Coming back inside the limit recovers.

### P3-12 An empty range (`CLAUDE.md` Phase III 4)
**Expected** `days-empty` shows `No sales in this range`, `days-table` is hidden, and the tiles read £0.00 — never `NaN`, `Infinity` or `undefined`.

### P3-13 "This event" (`CLAUDE.md` Phase III 2)
**Expected** `quick-event` is **hidden** while `settings/event` does not exist. After seeding `settings/event = {name, from, to}` into the emulator and reloading, it is visible; tapping it sets the inputs to the event's `from`/`to` and the report holds only the trading days inside the event (£125.00 on the scripted range), with the days outside it absent.

### P3-14 Layout, touch targets and console
**Expected** Every control in the main area is at least 48 px tall (chart bars excepted: they are sized by their value); no horizontal scroll at 360 px; no console errors.

### P3-16 Accessibility
**Expected** `@axe-core/playwright`: **zero serious or critical violations** on `#/reports/days` with trading days on screen, both projects.

### P3-17 Named from the visible text, and the scrolling cards take the keyboard
Behavioural guard for `BUG-6` and `BUG-7`, written so neither can come back silently if the axe ruleset ever changes.
**Expected**
1. Every `open-day-<day>` link's visible text is exactly "Open day" and its **accessible name contains that visible text** (WCAG 2.1 SC 2.5.3 *Label in Name*: a speech-input user says what they see). An `aria-label` that adds the date after it is fine; one that replaces it is not.
2. Every element in `main` that **actually** scrolls sideways (`scrollWidth > clientWidth` at the viewport under test) has `tabIndex >= 0` and a non-empty accessible name, and the names of the scrolling cards are distinct from one another.
3. The scrolling card takes focus and really moves — `CLAUDE.md` Phase III 7 puts the wide tables in a card that scrolls sideways, and a scroller only a mouse can reach hides Cash, Card, Avg order and Peak 30 min from a keyboard user.

### P3-15 Screenshots
**Expected** `qa/screenshots/<project>-reports-days-orders.png` (the scripted range) and `<project>-reports-days-empty.png` (a range with no sales), both projects.

## 29. App version cases (`V-*`), `tests/e2e/version.spec.js`

Spec: `CLAUDE.md` → "Phase III (part 2): App version on login and headers" 1–6.

> **The build string is asserted by shape, never by value.** Trinity regenerates `public/js/version.js` immediately before the commit, so a literal SHA in a test would break the suite the moment the tree is committed. The accepted shape is a 7-character hex SHA, optionally `-dirty` while the working tree is uncommitted, or `dev` when the file is missing.

### V-01 `login-version` (`CLAUDE.md` Phase III part 2, 4 and 6)
**Expected** A `login-version` element on `#/login` reading `Version <version> · build <build> · updated <date>`, where `<version>` equals `package.json` `version` read at run time ("package.json is the single source of truth"), `<build>` matches the shape above and `<date>` is `19 Oct 2026` shaped. Its `title` and `aria-label` both read `Version …, build …, updated …` with the **same three values**. 13 px and centred.

### V-02 Always visible (`CLAUDE.md` Phase III part 2, 4: "always visible (before and after sign-in)")
**Expected** The line is there on a fresh login screen, still there after a failed attempt (an obviously fake password), and still there — with the same text — on the login screen reached after signing in and back out again.

### V-03 `app-version` in every dark header (`CLAUDE.md` Phase III part 2, 5 and 6)
**Expected** On `#/`, `#/cash`, `#/kitchen`, `#/reports` and `#/reports/days`, in both projects: an `app-version` element inside `header` reading `v<version>`, with matching `title` and `aria-label` of the same three values.
- **Tablet (≥ 700 px):** 13 px bold, text `#D6D3D1`, a 1 px `#57534E` border, fully rounded, sitting **right after** the screen title on its line.
- **Phone (< 700 px):** 12 px bold on its **own line under the title**, and every header button and select still at least 44 px tall — the version must never squeeze them.
No console errors throughout. Screenshot `qa/screenshots/<project>-header-version.png`.

### V-04 It never covers a header control
**Expected** The version label's box intersects no header button, select or link, and no header control is pushed off screen by it.

### V-05 Fallback when `version.js` is missing (`CLAUDE.md` Phase III part 2, 3)
**Steps** Intercept `**/js/version.js` with a 404 and load the app.
**Expected** `login-version` reads `Version dev · build dev · updated dev`, its `title` and `aria-label` read `Version dev, build dev, updated dev`, and the header label on all five routes falls back to `dev` and never shows a stale version. **No uncaught exception and no application console error** — the browser's own "failed to load resource" note for the 404 is the browser, not the app, and is the only message tolerated.

## 30. Phase III deliberate readings of the brief

1. **Best-day tie → the earlier day.** The brief does not say. The earlier day wins, matching the peak-slot rule already used by the One day report.
2. **"Always visible (before and after sign-in)"** is read as: the version line is on the login card in every state of that screen — fresh, after a failed attempt, and after signing out again. Signing in navigates away from the card, so there is no "after sign-in" state of the card itself to assert.
3. **The build string is asserted by shape, not by value** (see section 29). A literal SHA would be wrong within minutes of the test being written.
4. **The matrix is read through `items-by-day-table`, not through per-cell test ids.** `.claude/agents/neo.md` fixes `items-by-day-table` as the contract; the row and cell ids the implementation also carries are not in it, so the test parses the table structurally instead of depending on them.
5. **"Fires no query" is proved from the network, not from the screen.** Every request to `127.0.0.1:8080` is recorded across the range change and searched for the out-of-range From date.
6. **Chart bars are exempt from the 48 px floor.** A bar's height is its value; `CLAUDE.md` Phase III 6 sizes it by the data. Every other control on the screen is held to 48 px.
7. **One `aria-label` reading is a defect, not a reading.** `CLAUDE.md` Phase III 7 fixes the visible text of "Open day"; WCAG 2.5.3 then requires that text to be inside the accessible name. See `BUG-6` (fixed and verified).
7a. **The scrolling table cards are named regions.** `CLAUDE.md` Phase III 7 asks for horizontal scroll inside the card; it does not say how the card is exposed, and the mock-up's plain `overflow-x: auto` div has no name. Giving each card `tabindex="0" role="region"` with its own name, and renaming the day `<section>`'s `aria-label` from "Day by day table" to "Day by day" so the two names stay unique, is additive and takes nothing from the brief or the mock-up — the visible heading is still "Day by day". No case here depends on either `aria-label`: the tables are addressed through `days-table` and `items-by-day-table`, the rows through `day-row-<day>`, the note through its visible text. See `BUG-7`.
8. **`settings/event` is seeded and removed through the emulator**, never in live Firestore, so both the hidden and the visible state of "This event" are proved on the same run.

## 31. Phase III live verification (gated, **read-only, zero writes**) — `tests/e2e/live-p3.spec.js`

**Gate** `LIVE_P3=1`, the same style as the `S-*`, `H-20` and `H-22` live specs, so `npm run test:e2e` stays offline and deterministic. Run after the deploy with
`LIVE_P3=1 LIVE_BUILD=<short sha> npx playwright test tests/e2e/live-p3.spec.js`.
Run on 2026-10-19 against deploy `4534093` (Pages run 39189833432). **20/20 passed, both viewports.**

**Write discipline — as strict as H2.** No write to live Firestore of any kind. Every Firestore call in the spec is a GET over the REST API; no till tile is tapped, `send-order` is never clicked, no status is changed, nothing is cancelled, and no menu or `settings` document is touched. Exporting the CSV is a download of data already fetched, not a write. `P3L-00` and `P3L-09` bracket the run with a fingerprint of the orders collection (document id, orderNo, status, total, day and every line's `id|name|qty|price`) to prove it, and also check the menu's ten documents and the presence or absence of `settings/event` are unchanged. Live `orders` may hold real trading records, so every document is treated as real data.

**Cache discipline.** A fresh Playwright context per test and the browser HTTP cache switched off over CDP (`Network.setCacheDisabled`) before the first navigation, because static assets carry `max-age=600` and a ten-minute-old `version.js` would otherwise be read as a deploy failure. A `Cache-Control: no-cache` request header is deliberately **not** used — it is not CORS-safelisted, so Playwright would attach it to the Firebase SDK's cross-origin module imports and preflight them into failure (observed in the H2 live round).

**The expected build is passed in at run time** (`LIVE_BUILD`), never written into the spec: a literal SHA in a committed test is stale the moment the next commit lands. With it set, the rendered build must equal it exactly; without it, the spec still requires a clean 7-character hex SHA with no `-dirty`.

### P3L-00 Snapshot live Firestore first
**Expected** A fingerprint of `orders`, and the presence or absence of `settings/event`, recorded before anything else for `P3L-09` to compare against.

### P3L-01 Signed out: the guard, and the version line before sign-in
**Expected** `#/login` renders a real form (not "Login not configured"); `login-version` reads `Version <package.json version> · build <7-char sha> · updated <d MMM yyyy>`; every one of the five guarded routes redirects to `#/login`; zero console errors.

### P3L-02 Signed in: every route, the pill, the console
**Expected** The shared account signs in and lands on `#/`; `#/`, `#/cash`, `#/kitchen`, `#/reports` and `#/reports/days` each render with no "Storage not configured" banner and `conn-pill` reading `Online · synced`; **zero** console errors across all five.

### P3L-03 V-c — the rendered build equals the pushed commit
**Expected** On all five signed-in screens, `app-version` reads `v<version>` with `title` and `aria-label` identical and carrying the same version, build and date; the build equals `LIVE_BUILD` with no `-dirty`. Tablet: 13 px bold, `#D6D3D1` on a 1 px `#57534E` border, fully rounded, right after the screen title. Phone: 12 px bold under the title, with every header button and select still at least 44 px. **Read through the app's own UI, never by fetching `version.js`** — the point of V-c is that the labels a volunteer sees match the commit that was pushed.

### P3L-04 The toggle, live
**Expected** Both pills on both report screens, each at least 48 px, the current one filled ink `#1C1917`, and each navigating to the other route.

### P3L-05 Sales by day, live
**Expected** Default range is the last 7 days ending today; Today and Last 7 days are present; **"This event" is visible exactly when `settings/event` exists** (the spec reads the document first and asserts the button against it, so either state is a pass and the state is recorded). Then either (a) trading days exist, in which case every tile, the bar count, each bar being a real `<button>` with an `aria-label`, both tables, the totals row and the readout format are checked against figures recomputed from the live documents; or (b) the range is empty, in which case `days-empty` must read "No sales in this range", `days-table` must be hidden and the tiles must read £0.00 with no `NaN`. An empty live range is a pass, not a failure.

### P3L-06 Open day, live
**Expected** `open-day-<day>`'s `href` is exactly `#/reports?day=<day>`; following it loads the One day report with `report-date` set to that day and `kpi-sales`/`kpi-orders` equal to the figures recomputed from the live documents. Also re-checks `BUG-6` live: the link's accessible name contains its visible text. Skips with a recorded note if the live default range has no trading day.

### P3L-07 The range CSV, live
**Expected** The download is named `nba-food-stall_<from>_<to>.csv` from the inputs actually on screen; the header is the thirteen One day columns in the One day order; no `tendered` anywhere; every row has 13 fields, `lineTotal = qty × price`, a `day` inside the range, a status that is not `cancelled` and a non-blank item name.

### P3L-08 Sign out, live
**Expected** Sign out returns to `#/login`, clears `nba.session`, and the version line is still on the card with the same version and build — the "after sign-in" half of `CLAUDE.md` Phase III part 2, 4.

### P3L-09 Nothing was written
**Expected** `orders` is the same length with a byte-identical fingerprint to `P3L-00`; `menu` still holds its ten documents; `settings/event` is still in the state it was found in.

### P3L screenshots
`qa/screenshots/live-p3-<project>-<screen>.png` for both projects: `login-version`, `landing`, `cash`, `kitchen`, `reports`, `reports-days`, `reports-open-day`, `header-version`, `signed-out`.

---

# Phase IV — Orders list and order detail (`#/reports/orders`, v1.3.0)

Spec: `CLAUDE.md` → "Phase IV: Orders list and order detail", requirements 1–10; the orchestrator's Phase IV DOM contract; the mock-ups `design/ReportsOrders.dc.html` (tablet/desktop), `design/ReportsOrdersMobile.dc.html` (phone) and the third tab in `design/Reports.dc.html` and `design/ReportsByDay.dc.html`. **Read-only screen: it must write nothing.**

| Req | What it says | Covered by |
|---|---|---|
| 1 | Third tab on every report screen, phone labels One day / By day / Orders, current filled ink | P4-01, P4-02 |
| 2 | Day input (default today, `?day=`), search, status buttons, payment buttons (tablet only) | P4-03, P4-07, P4-U-02 |
| 3 | `where("day","==",day)`, live `onSnapshot`, cancelled listed but out of the total | P4-08, P4-13, P4-U-02 |
| 4 | Summary line, "(excludes n cancelled)" only when n > 0 | P4-06, P4-U-03 |
| 5 | Tablet table: columns, newest first, pill colours, grey cancelled total, selected row, empty message | P4-04, P4-05, P4-08, P4-11, P4-U-01, P4-U-04, P4-U-05 |
| 6 | Detail panel: fields, timeline (incl. the cancelled path), items, total, note, nothing-selected state, stacking under 1100 px | P4-09, P4-10, P4-11, P4-U-06 |
| 7 | Phone cards, full-screen detail, "All orders" back and the browser back button | P4-04, P4-12 |
| 8 | "Export these orders (CSV)": the filtered set, One day columns, `nba-food-stall_orders_<day>.csv` | P4-14, P4-U-07 |
| 9 | Retired `samosa` / `straw` keep their original names and icons | P4-04, P4-14, P4-U-04, P4-U-07 |
| 10 | `package.json` 1.3.0 and the version label reads v1.3.0 | **P4-U-09** pins the number itself; the existing `V-*` suite (`tests/e2e/version.spec.js`) then checks the label matches `package.json` on every screen, and `V-c` checks it live after deploy |

## 32. Phase IV unit cases — `public/js/logic.js` (`P4-U-*`), `tests/unit/orders.test.js`

### 32.1 The scripted day (hand-calculated)

One trading day, every item £5. The same orders are used end to end (`helpers.ordersFixture`), pinned there to today's London date. 17 Oct 2026 is inside BST.

| Order | Time | Name | Till | Pay | Status | Lines | Items | Total | Ready | Wait |
|---|---|---|---|---|---|---|---|---|---|---|
| A-010 | 09:30 | Josh | A | cash | collected | 2× `samosa` (**retired**, carries `tendered: 2000`) | 2 | £10.00 | 09:34 | 4 min |
| A-011 | 09:40 | Rina | A | card | collected | 1× `straw` (**retired**) | 1 | £5.00 | 09:43 | 3 min |
| A-040 | 10:05 | Lucy | A | cash | collected | 2× Sweet Box, 1× Samosa | 3 | £15.00 | 10:09 | 4 min |
| A-041 | 10:12 | Priya | A | cash | collected | 2× Fuchka, 1× Momo | 3 | £15.00 | 10:16 | 4 min |
| B-017 | 10:20 | Tom | B | card | collected | 3× Fuchka | 3 | £15.00 | 10:25 | 5 min |
| A-042 | 10:30 | Sam | A | card | ready | 1× Fuchka, 1× Choc Strawberry | 2 | £10.00 | 10:35 | 5 min |
| A-043 | 10:40 | Meera | A | cash | preparing | 1× Choc Fountain, 1× Sweet Box | 2 | £10.00 | — | — |
| B-019 | 10:50 | Ahmed | B | cash | new | 2× Momo, 1× Papri Chat | 3 | £15.00 | — | — |
| A-044 | 10:55 | Guest | A | card | **cancelled** | 2× Samosa | 2 | £10.00 | — | — |
| *A-900* | *12:00 **the day before*** | *Yesterday* | *A* | *cash* | *collected* | *1× Fuchka* | *1* | *£5.00* | *12:03* | *3 min* |

Derived by hand:

- Rows on today's list: **9** (the cancelled order is listed, A-900 is on another day).
- Total shown: £15 + £15 + £15 + £10 + £10 + £15 + £10 + £5 = **£95.00**; the cancelled £10.00 is out.
- Summary line with no filters: **`9 orders · £95.00 (excludes 1 cancelled)`**.
- Newest first: A-044, B-019, A-043, A-042, B-017, A-041, A-040, A-011, A-010.
- CSV with no filters: **14 rows** of order lines, the cancelled A-044's line included (see section 34.6); cash only: **9 rows**; Cancelled only: **1 row**.

Filters, hand-calculated (rows newest first; total over the non-cancelled rows):

| Filter | Rows | Total | Cancelled in view |
|---|---|---|---|
| none / All | all 9 | £95.00 | 1 |
| New | B-019 | £15.00 | 0 |
| Preparing | A-043 | £10.00 | 0 |
| Ready | A-042 | £10.00 | 0 |
| Collected | B-017, A-041, A-040, A-011, A-010 | £60.00 | 0 |
| Cancelled | A-044 | **£0.00** | 1 |
| Cash | B-019, A-043, A-041, A-040, A-010 | £65.00 | 0 |
| Card | A-044, A-042, B-017, A-011 | £30.00 | 1 |
| search `a-04` | A-044, A-043, A-042, A-041, A-040 | £50.00 | 1 |
| search `priya` / `PRIYA` / `  priya  ` | A-041 | £15.00 | 0 |
| search `b-0` | B-019, B-017 | £30.00 | 0 |
| search `eer` | A-043 (Meera) | £10.00 | 0 |
| search `zzz` | — | £0.00 | 0 |
| Collected + Cash + `a-0` | A-041, A-040, A-010 | £40.00 | 0 |
| Cancelled + Cash | — | £0.00 | 0 |

### P4-U-00 The Phase IV logic API
**Expected** `logic.js` exports the pure functions the screen is built from, under the names `.claude/agents/neo.md` fixes (`filterOrders`, `orderSummary`, `orderTimeline`, `orderWaitMinutes`) plus a summary-line function and a CSV file-name function. `logic.js` still imports nothing from Firebase.

### P4-U-01 Newest first (`CLAUDE.md` Phase IV 5)
**Steps** Shuffle the day into order-number order, then run it through the list's sort.
**Expected** A-044, B-019, A-043, A-042, B-017, A-041, A-040, A-011, A-010. An order with no `createdAtMs` sorts last rather than throwing. The caller's array is never reordered in place (the screen is read-only).

### P4-U-02 `filterOrders` (`CLAUDE.md` Phase IV 2, 3)
**Steps** Every row of the filter table above, plus rubbish input (`null`, `[]`, no options at all).
**Expected** Exactly the listed order numbers in the listed order. Search is a case-insensitive substring of **order number or name only** (searching `Fuchka`, an item name, matches nothing), trimmed before use, and a blank search matches everything. Cancelled orders are listed, never hidden. Nothing throws. A single day's query never mixes in A-900.

### P4-U-03 The summary line (`CLAUDE.md` Phase IV 4)
**Expected** `9 orders · £95.00 (excludes 1 cancelled)` unfiltered; `5 orders · £60.00` with Collected, **with no "(excludes …)" clause at all** when nothing in view is cancelled; `1 orders · £0.00 (excludes 1 cancelled)` with Cancelled — the row is counted, its money is not. Every filter row of the table is checked for count, total and clause. An empty list reads `0 orders · £0.00`, never `NaN`.

### P4-U-04 `orderSummary`: the Items column (`CLAUDE.md` Phase IV 5, 9)
**Expected** `2× Fuchka, 1× Momo` — menu **short** names, a `×` (U+00D7), `, ` between lines, no long names ("Gol Gappa" never appears). Retired ids keep their own identity: the old `samosa` line reads as a **Sweets Box**, never as the new `Samosa` item; the old `straw` line still reads as a strawberry item. An id that is in no menu at all falls back to the name stored on the order line. An order with no lines gives `''`, and `null`/`{}` never throw.

### P4-U-05 Wait, placed to ready (`CLAUDE.md` Phase IV 5)
**Expected** 4, 3, 4, 4, 5, 5 minutes for A-010, A-011, A-040, A-041, B-017, A-042; `null` (rendered `—`) for A-043, B-019 and the cancelled A-044. A half-written order (ready before placed, no timestamps at all) returns `null`, never `NaN`, and never throws.

### P4-U-06 `orderTimeline` (`CLAUDE.md` Phase IV 6)
**Expected** A collected order gives Placed → Started → Ready → Collected with `10:12 / 10:13 / 10:16 / 10:17`, all four reached. A preparing order gives the same four steps with Ready and Collected unreached and shown as `—`. A new order has only Placed reached. **A cancelled order gives exactly Placed → Cancelled** (`10:55 / 10:56`) and no other step. Nothing throws on a half-written order.

### P4-U-07 The orders CSV (`CLAUDE.md` Phase IV 8, 9)
**Expected** File name `nba-food-stall_orders_2026-10-17.csv`. Header exactly the thirteen One day columns in the One day order. One row per line of **the orders currently shown** — 14 rows unfiltered, 9 with Cash, **1 with Cancelled** — every row 13 fields with `lineTotal = qty × price`. The cancelled A-044 is exported, with `cancelled` in the `status` column (section 34.6). The rows follow the list, newest first. A view with no rows gives a header and nothing else. The One day and Sales by day exports (`ordersToCsv` / `rangeToCsv`) are re-checked here and still leave cancelled orders out. Retired items are written under the name stored on the line (`Sweets Box Samosa / Shingara`). The Phase I `tendered` value never appears, as a column or as a value. A name containing a comma is quoted. Rubbish input gives a header, not an exception.

### P4-U-08 Read-only
**Expected** Filtering, summarising, rendering a timeline, computing a wait and exporting the CSV leave every order object byte-identical.

### P4-U-09 The Phase IV version (`CLAUDE.md` Phase IV 10)
**Expected** `package.json` `version` is `1.3.0`; every version label follows from it.

## 33. Phase IV end-to-end cases — `#/reports/orders` (`P4-*`, both projects), `tests/e2e/reports-orders.spec.js`

Each test clears the emulator and seeds the scripted day above (`seedOrdersDay`), pinned to today's London date so the screen's default day covers it.

### P4-01 The third tab is on all three report screens (`CLAUDE.md` Phase IV 1)
**Steps** Load `#/reports`, `#/reports/days` and `#/reports/orders`.
**Expected** The Orders tab is present on all three, at least 48 px tall, and the three labels read **One day / Sales by day / Orders** on tablet and **One day / By day / Orders** on phone.

### P4-02 The current tab is filled ink, and every tab navigates (`CLAUDE.md` Phase IV 1)
**Expected** On `#/reports/orders` the Orders pill is `#1C1917` and carries `aria-current="page"`; the other two are not filled. Orders → One day → Orders → Sales by day → Orders all navigate and render.

### P4-03 The day (`CLAUDE.md` Phase IV 2)
**Expected** `orders-day` is a `date` input defaulting to today (Europe/London) and yesterday's A-900 is not listed. `#/reports/orders?day=<yesterday>` loads directly, sets the input to that day and lists exactly A-900 with `1 orders · £5.00`. Typing today's date back into the input restores the nine rows.

### P4-04 The list (`CLAUDE.md` Phase IV 5, 7, 9)
**Expected** Rows in the newest-first order above. Tablet: for every order the eight columns read exactly the hand-calculated Order, Time, Name, Items, Total, Pay, Status and Wait of the table in 32.1 (`—` for the two orders that never went ready); the Order cell is a real `<button>` with an `aria-label` naming the order. Phone: each card carries the number, the name, the status, the items and `HH:MM · Cash · till A`, plus the total. Retired lines (A-010, A-011) show their own names, never the new items'.

### P4-05 Status pill colours (`CLAUDE.md` Phase IV 5)
**Expected** New `#FDE68A`, Preparing `#BFDBFE`, Ready `#0F766E` with white text, Collected `#E7E5E4`, Cancelled white with a `#B91C1C` border and `#B91C1C` text — on every row (tablet) or card (phone).

### P4-06 The summary line (`CLAUDE.md` Phase IV 4)
**Expected** `9 orders · £95.00 (excludes 1 cancelled)` to start; after each status filter and (tablet) each payment filter, the count, the total and the presence or absence of the "(excludes …)" clause match the filter table in 32.1. Cancelled-only reads `£0.00` with the clause.

### P4-07 Filters, search and the empty state (`CLAUDE.md` Phase IV 2, 5)
**Expected** Each status button leaves exactly its hand-calculated rows and is the one with `aria-pressed="true"`. Tablet: Cash and Card do the same. **Phone has no payment filter at all** (`orders-pay-cash` has zero matches). Search matches order number or name, case-insensitively and trimmed; `zzz` shows `orders-empty` reading exactly "No orders match these filters.". Status + payment + search together give A-041, A-040, A-010 and `£40.00`.

### P4-08 Cancelled: listed, not counted (`CLAUDE.md` Phase IV 3, 5)
**Expected** A-044 has a row; the summary still reads £95.00 and never £105.00; on tablet its Total cell reads £10.00 in `#78716C`.

### P4-09 The detail panel (`CLAUDE.md` Phase IV 6)
**Expected** Before anything is selected, tablet shows "Select an order to see its items." Opening A-041 shows the number, name, Collected pill, Till A, Payment Cash, Placed (with the time 10:12 and, on tablet, the day), Wait 4 min, a Placed → Started → Ready → Collected timeline reading 10:12 / 10:13 / 10:16 / 10:17 with no Cancelled step, the two item lines with their line totals, a £15.00 total, and (tablet) the note verbatim: "Read-only. Orders are cancelled from the cash counter; status changes happen on the food counter. Cancelled orders are listed but excluded from every total."

### P4-10 Unreached steps and the cancelled path (`CLAUDE.md` Phase IV 6)
**Expected** A-043 (preparing) shows Placed 10:40, Started 10:42, Ready `—`, Collected `—`, Wait `—`. A-044 shows **only** Placed 10:55 → Cancelled 10:56; `order-step-started`, `-ready` and `-collected` do not exist for it.

### P4-11 Tablet layout (`CLAUDE.md` Phase IV 5, 6)
**Expected** The selected row is shaded `#FEF3C7` and no other row is. At 1280 px the detail panel sits to the right of the list; resized to 1000 px it stacks underneath.

### P4-12 Phone: detail and both ways back (`CLAUDE.md` Phase IV 7)
**Expected** Tapping a card hides the list and opens the full-screen detail. The "All orders" button (at least 44 px) returns to the list; opening another order and pressing the **browser back button** also returns to the list, with all nine rows still there.

### P4-13 Live updates (`CLAUDE.md` Phase IV 3)
**Steps** With the Orders screen open, a second browser context takes B-019 from New to Preparing on `#/kitchen`, then places a new £5.00 cash order on `#/cash`.
**Expected** B-019's row turns Preparing and the new order appears, both without a reload; the summary becomes `10 orders · £100.00 (excludes 1 cancelled)`.

### P4-14 Export these orders (CSV) (`CLAUDE.md` Phase IV 8, 9)
**Expected** File name `nba-food-stall_orders_<today>.csv`; the thirteen One day columns in the One day order; **14 rows** in the list's own newest-first order, all on today's day, none from yesterday, each with `lineTotal = qty × price`; the cancelled A-044's line is there with `cancelled` in the `status` column; `tendered` nowhere; A-010's item reads "Sweets Box Samosa / Shingara". Filtering to Cash and exporting again gives 9 rows, all `cash`; filtering to **Cancelled** and exporting gives the header and **one row**, not an empty file. **Phone is skipped**: `design/ReportsOrdersMobile.dc.html` carries no export control.

### P4-15 Read-only (`CLAUDE.md` Phase IV, heading)
**Steps** Record a fingerprint of `orders`, then filter, search and open a detail with every request to the emulator watched.
**Expected** No write request (a POST/PATCH/PUT/DELETE carrying a document write) leaves the page, the fingerprint is unchanged and the collection still holds ten documents.

### P4-16 Layout and touch targets
**Expected** Every button, link, input and select in `main` is at least 44 px tall; the three report tabs at least 48 px; at 360 px wide the document does not scroll sideways.

### P4-17 Console
**Expected** Loading the list, opening a detail, switching the status filter and searching for nothing produce no application console error.

### P4-18 Accessibility
**Expected** `@axe-core/playwright` finds zero serious or critical violations on both viewports, both in the list state and with an order open.

### P4-19 Screenshots
`qa/screenshots/p4-<project>-orders-list.png`, `-detail.png` and `-empty.png` for both projects. The plain empty-day and with-orders shots of the route also come from `tests/e2e/screenshots.spec.js` as `<project>-reports-orders-empty.png` and `<project>-reports-orders-orders.png`.

### P4-20 A retired item keeps its name and icon in the detail (`CLAUDE.md` Phase IV 9)
**Steps** Open A-010, whose two lines are the retired `samosa`.
**Expected** The panel names it as a Sweets Box, never as the live `Samosa` item; at least one inline SVG icon is drawn on the item lines; where the lines carry per-item test ids, the retired id is the one used and `order-line-samosa_only` is absent.

## 34. Phase IV deliberate readings of the brief

1. **Two names exist for five elements.** The orchestrator's DOM contract says `orders-row-<no>`, `orders-open-<no>`, `orders-back`, `export-orders-csv`, `report-view-orders`; `.claude/agents/neo.md` says `order-row-<no>`, `order-open-<no>`, `order-back`, `orders-export-csv`, `report-view-orders`. The helpers try the contract name first and the `neo.md` name second, so the tests assert the brief rather than one spelling. Neither document is "the app", so this is not a bug.
2. **Where the sort lives is not specified.** `CLAUDE.md` Phase IV 5 fixes the *order on screen*, not the function that produces it. The unit cases compose `sortOrdersNewestFirst(filterOrders(...))` when `logic.js` exports a sort, and assert the composed result; the e2e cases read the rendered order, which is the real requirement.
3. **The summary-line and CSV-file-name functions are resolved by name list.** No contract names them. The test fails with the list of names it tried, so a rename is a one-line fix rather than a mystery.
4. **"<n> orders" is not forced into a singular.** Both mock-ups render `rows.length + ' orders'`, so `1 orders` is what the design does; the tests accept `1 order` or `1 orders` and pin everything else exactly.
5. **The money format is not grouped below £1,000.** The fixture keeps every figure under £1,000, where `£95.00` and `£95.00` are the same string either way, so the tests do not accidentally pin a thousands separator the brief never asks for.
6. **The Orders CSV includes cancelled orders; the other two exports still don't.** `CLAUDE.md` Phase IV 8 exports "the orders currently shown (after filters)", and a cancelled order *is* shown: Phase IV 5 lists it and Phase IV 4 keeps it out of the **total** only. The `status` column exists precisely so an exported row can read `cancelled`. The settling case is the one a reader would try: filter Status to Cancelled and export — a header with no rows would be plainly wrong. So the Orders export is every row on screen, cancelled included, in the list's newest-first order. This **deliberately differs** from the One day (`Reports` 6) and Sales by day (Phase III 9) exports, which follow `Reports` 2 ("Cancelled orders excluded everywhere") and must not change; `P4-U-07` asserts both behaviours side by side so neither can drift into the other. ("Same columns as the One day CSV" is about the columns, which are identical.)
7. **No export button on the phone, in the tests.** `design/ReportsOrdersMobile.dc.html` has no export control and `CLAUDE.md` Phase IV 8 does not require one at that width, so `P4-14` and `P4L-08` run on tablet only. The app does render the button at phone width; that is additive and takes nothing from the brief, so it is recorded as an observation in `qa/bugs.md` rather than a bug, and the tests keep the conservative reading.
8. **Retired names are pinned where they are unambiguous.** `straw`'s short name (`Choc Strawberry`) is identical to the live `choc_strawberry`'s, so on screen the two cannot be told apart by text; the identity of a retired line is pinned instead in the CSV, which carries the name stored on the order line, and by `samosa` (short `Sweets Box`) never rendering as the new `Samosa`.
9. **The version bump (requirement 10) needs a case of its own.** The `V-*` suite deliberately reads the expected version out of `package.json` rather than a literal, so it agrees with whatever number is there and can never catch a missed bump. `P4-U-09` therefore asserts `package.json` is on `1.3.0` — the one number `CLAUDE.md` Phase IV 10 states outright. It is the only Phase IV case failing at the end of this round (`BUG-8`).
10. **A-900 is seeded on the day before** so that "the same single-field `day ==` query" is proved by a day that *has* data to leak, not by an empty neighbour.

## 35. Phase IV live verification (gated, **read-only, zero writes**) — `tests/e2e/live-p4.spec.js`

**Gate** `LIVE_P4=1`, the same style as the `S-*`, `H-20`, `H-22` and `P3L-*` live specs, so `npm run test:e2e` stays offline and deterministic. Run after the deploy with
`LIVE_P4=1 LIVE_BUILD=<short sha> npx playwright test tests/e2e/live-p4.spec.js`.
Run on 2026-10-19 against deploy `064f0a8`. **23/23 passed, 1 skipped (phone CSV, by design), both viewports.**

**Write discipline — as strict as H2 and P3.** No write to live Firestore of any kind. Every Firestore call in the spec is a GET over the REST API; the Orders screen is itself read-only, so no till tile is tapped, `send-order` is never clicked, no status is changed, nothing is cancelled, and no menu or `settings` document is touched. Exporting the CSV is a download of data already fetched. `P4L-00` and `P4L-11` bracket the run with a fingerprint of the orders collection and the list of menu ids. The leftover QA smoke order `A-001` is read, never altered.

**Cache discipline.** A fresh Playwright context per test and the browser HTTP cache switched off over CDP (`Network.setCacheDisabled`) before the first navigation. A `Cache-Control: no-cache` request header is deliberately **not** used: it is not CORS-safelisted and would preflight the Firebase SDK's cross-origin imports into failure.

**The version is read through the UI, never by fetching `version.js`.** Reading the file would prove the deploy; the labels are what Phase IV ships. The expected build is passed in at run time (`LIVE_BUILD`), never written into the spec.

**Expectations are recomputed from the live documents**, not hard-coded: the summary line, every row field, the timeline times and the CSV row count are derived from what `orders` actually holds at the moment of the run, so the spec keeps working as live data changes.

### P4L-00 Snapshot live Firestore first
**Expected** A fingerprint of `orders` and the list of `menu` ids, recorded before anything else for `P4L-11` to compare against.

### P4L-01 Signed out: the guard, and the v1.3.0 line on the card
**Expected** `#/login` renders a real form (not "Login not configured"); `login-version` reads `Version 1.3.0 · build <7-char sha> · updated <d MMM yyyy>` and the build equals `LIVE_BUILD`; all six guarded routes redirect to `#/login`; zero console errors.

### P4L-02 Signed in: all seven routes
**Expected** The shared account signs in and lands on `#/`; `#/`, `#/cash`, `#/kitchen`, `#/reports`, `#/reports/days` and `#/reports/orders` each render with no "Storage not configured" banner and `conn-pill` reading `Online · synced`; **zero** console errors across all of them.

### P4L-03 The v1.3.0 pill in every dark header
**Expected** On all six signed-in screens `app-version` reads `v1.3.0` with `title` and `aria-label` identical and carrying the same version, build and date, and the build equals `LIVE_BUILD`. Tablet: 13 px, `#D6D3D1` on a 1 px `#57534E` border, fully rounded, right after the screen title. Phone: 12 px under the title with every header button still at least 44 px.

### P4L-04 The third tab, live (`CLAUDE.md` Phase IV 1)
**Expected** All three tabs on all three report screens, at least 48 px; labels `One day | Sales by day | Orders` at tablet width and `One day | By day | Orders` on phone; on `#/reports/orders` the Orders tab is filled ink `#1C1917` with `aria-current="page"` and neither other tab is filled.

### P4L-05 The live list, its summary, filters and search
**Expected** The Day input holds the day being read; the summary line equals the one recomputed from the live documents; the listed order numbers are the live ones, newest first; every field of the newest row (number, time, name, items in menu short names, total, pay, status, and wait on tablet / `HH:MM · Pay · till X` on phone) matches its document. Selecting the order's own status keeps it, another status empties the list with "No orders match these filters."; on tablet the payment filter does the same; search by order number and by name matches in lower and upper case; a nonsense search shows the empty message. Zero console errors.

### P4L-06 The detail, live
**Expected** Tablet starts with "Select an order to see its items."; opening the order shows its number, name, status, till, payment, placed time, wait, the timeline (Placed always, then Started/Ready/Collected, or Placed → Cancelled), every item line with an icon, and the total — all matching the live document. Phone: the detail is full screen, the "All orders" button returns to the list, and the **browser Back button** does too. Tablet: the panel sits beside the list and the read-only note reads verbatim.

### P4L-07 `?day=`, live
**Expected** `#/reports/orders?day=<day with orders>` opens that day with its order and its summary; `#/reports/orders?day=2020-01-01` opens that day with `0 orders · £0.00` and the empty message.

### P4L-08 The orders CSV, live — downloaded and read
**Expected** The download is named `nba-food-stall_orders_<day>.csv` from the day actually on screen; the header is the thirteen One day columns in the One day order; one row per line of the orders shown, in the list's newest-first order; every row has 13 fields on the exported day with `lineTotal = qty × price` and a non-blank item name; each order's line totals add up to the `total` stored on its document; no `tendered` anywhere. **The bytes are parsed and asserted, not inferred from a 200.** Tablet only (section 34.7).

### P4L-09 Accessibility, live
**Expected** `@axe-core/playwright` finds zero serious or critical violations on `#/reports/orders`, both viewports, in the list state and with an order open.

### P4L-10 Sign out from the Orders screen
**Expected** Sign out returns to `#/login`, clears `nba.session`, and the version line is still on the card with the same version and build.

### P4L-11 Nothing was written
**Expected** `orders` is the same length with a byte-identical fingerprint to `P4L-00`, and `menu` holds exactly the same ten document ids.

### P4L screenshots
`qa/screenshots/live-p4-<project>-<screen>.png` for both projects: `login-version`, `landing`, `cash`, `kitchen`, `reports`, `reports-days`, `reports-orders`, `reports-orders-detail`, `header-version`, `signed-out` — 20 files.

---

# Hotfix H3 — phone cash counter layout and the seven-item menu (v1.3.1)

Spec: `CLAUDE.md` → "Hotfix H3: phone cash counter layout (v1.3.1)" 1–8 and the
revised "Menu" table ("This is the whole menu from v1.3.1: 7 items").
Mock-ups: `design/CashCounterSmall.dc.html` (menu and order bar, iPhone 13),
`design/CashCounterSmallOpen.dc.html` (Review & send sheet),
`design/CashCounterSmall17.dc.html` (iPhone 17, 402×694). The second and third
render the same component at different props, so the first is the one with the
detail.

**Scope of the change.** The cash counter is rebuilt on *every screen narrower
than 700 px*, not only on the `phone` project. Tablet and desktop (700 px and
wider) are unchanged. No data change beyond the menu.

## 36. H3 viewports and how the suite is split

Three Playwright projects are added, all chromium, `hasTouch`, `isMobile`,
`deviceScaleFactor: 2`:

| Project | Viewport | Why |
|---|---|---|
| `iphone13` | 390×664 | the visible area named in the brief |
| `iphone17` | 402×694 | the visible area named in the brief |
| `promax` | 430×752 | iPhone Pro Max 430×932 less the same 180 px of Safari chrome that gives 664 from 844 and 694 from 874 |

They are scoped with `testMatch: /cash-h3\.spec\.js/` and run **that spec only**.
The e2e suite is already ~286 cases; running all of it three more times would
make the fix loop unusable, and every assertion that actually depends on the
small-screen geometry lives in `cash-h3.spec.js`. `phone` (390×844) is also
below the 700 px breakpoint, so the rest of the suite still exercises the H3
layout once per run. `phone` and `tablet` are otherwise untouched.

`cash-h3.spec.js` splits itself by viewport rather than by project name: the
`H3 the small cash counter` block skips at 700 px and wider, and the
`H3-h the tablet cash counter is unchanged` block skips below it. So `tablet`
runs only the tablet block, and the four small projects only the H3 block.

## 37. H3 unit cases — `public/js/logic.js`, `public/js/icons.js` (`H-01`..`H-06`, `tests/unit/menu.test.js`)

| id | Case | Expected |
|---|---|---|
| H-01 | `MENU` is the brief table | Exactly 7 rows, field for field: id, name, short, price 500, colour, station, `active: true`, sort. `marshmallow` reads "Chocolate Marshmallow (V)" / "Choc Marshmallow". No `fountain`, `samosa` or `straw` anywhere in the seed |
| H-02 | Seven active, sorts 1..7 | Every row is active — H3 removes the retired rows from the seed entirely. Sorts 1..7, no gaps. `ACTIVE_MENU` holds the same seven, in sort order |
| H-03 | `stationOf` | The four sweets ids resolve to `sweets`, fuchka/chat to `chaat`, momo to `momo`. A deleted id (`samosa`, `straw`, `fountain`) is now simply **unknown** — falsy, never throwing. `inStation(unknown, 'all')` is true; `inStation(unknown, <any station>)` is false |
| H-04 | Icons | Every one of the seven ids has its own stroke SVG, never the plate fallback; an unknown id (and `''`, `null`, `undefined`) gets the plate icon and never throws; no emoji; `itemIcon(id, 32)` honours the size |
| H-05 | `buildReport` over a mixed day | Old ids and new ids stay separate rows. An older `samosa` line reports as "Sweets Box Samosa / Shingara", a `fountain` line as "Chocolate Fountain", `samosa_only` as "Samosa", `marshmallow` as "Chocolate Marshmallow (V)". Totals: £60.00, 4 orders, 12 items; per-item revenue and units sum to the totals |
| H-05b | Unknown-id fallback | `lineShortName` / `lineFullName` return the name stored on the line for any id the menu doesn't hold; a known id still uses the menu wording ("Choc Marshmallow" short, "Chocolate Marshmallow (V)" full); a line with neither degrades to the id, never to a crash |
| H-06 | `ordersToCsv` | The thirteen Phase I columns unchanged, one row per line, older lines under their stored names, current lines under their current names, nothing rewritten |

## 38. H3 end-to-end cases — `tests/e2e/cash-h3.spec.js`

Run on `phone`, `iphone13`, `iphone17` and `promax` unless noted.

| id | Case | Expected |
|---|---|---|
| H3-a1 | Header geometry | One row, at most 56 px tall and within 6 px of 52; every visible child inside the header band (nothing wrapped onto a second line); nothing spills past the right edge. At 390, 402 and 430 wide |
| H3-a2 | Header contents | Till picker (`till-select`) in the header reading "Till A"; `conn-pill` reads "Online" in a short label (≤ 22 characters); "Next A-0NN"; ☰ `menu-button` at least 44×44 with `aria-expanded="false"` |
| H3-a3 | Till picker ↔ landing page | Setting the till to B on the landing page shows "B" in the cash header and "Next B-001"; changing it to C in the header stores the letter and the landing page shows C |
| H3-a4 | Next order number | A fresh till advertises "Next A-001"; after sending A-001 it reads A-002, then A-003 |
| H3-a5 | ☰ menu contents | Opens on tap, `aria-expanded` flips to true, lists Food counter, Reports, Recent orders, Sign out (red) and a version line; every item at least 48 px tall |
| H3-a6 | ☰ menu closing | Closes on an outside tap, on Escape and on choosing an item; `aria-expanded` returns to false |
| H3-a7 | ☰ menu destinations | Food counter → `#/kitchen`; Reports → `#/reports…`; Recent orders → the `recent-sheet` |
| H3-a8 | Sign out with a cart | The in-page `sign-out-confirm` appears, **never `window.confirm`**; Cancel keeps the order and the session; confirming clears `nba.session` and goes to `#/login` |
| H3-b1 | Seven tiles, three columns | Exactly the seven ids in sort order, none of `fountain`/`samosa`/`straw`; three distinct left edges; with an empty cart every tile is fully inside the viewport **and the menu area's `scrollHeight` fits its `clientHeight`**; tiles within 16 px of 112 tall, icons within 6 px of 40 |
| H3-b2 | Tapping and the order bar | A tap adds one and badges the tile top right; with the bar up every tile can be scrolled into view and `elementFromPoint` at its centre is the tile; a real coordinate tap on the last tile adds one |
| H3-c | Order bar | Hidden with an empty cart; with items it reads "<n> items · £x.xx  Review & send", is within 4 px of 60 tall and sits at the bottom of the viewport; emptying the cart hides it again |
| H3-d1 | The sheet | `role="dialog"`, top within 4 px of 40, reaching the bottom; a dimmed full-screen backdrop behind it; header "Order · <n> items"; the order bar is not competing with it |
| H3-d2 | Closing the sheet | Add more, Escape and the browser Back button each close it; Back leaves the route at `#/cash` and keeps the cart |
| H3-d3 | Focus | Focus is inside the sheet after opening and back on `order-bar-open` after closing |
| H3-d4 | Last item | Stepping the last line to zero closes the sheet and hides the order bar |
| H3-d5 | Cart grid | With all seven items in the cart every `line-dec-*` shares one left x and every `line-inc-*` shares one left x (±1 px); no `.line__name` overflows; no row is wider than its column; steppers at least 48×48 |
| H3-d6 | Pinned footer | With all seven items in the cart the Send button is fully inside the viewport, uncovered, within 4 px of 60 tall, reads "Send to food counter · £35.00", and stays put when the sheet body is scrolled to the bottom. At all three H3 viewports |
| H3-d7 | Sheet body | Name input at least 48 px; total; Cash/Card both at least 48 px with `aria-pressed` |
| H3-e | Cash received in the sheet | "Cash received (optional)"; five quick buttons Exact/£5/£10/£20/£50, each at least 44 px; £20 on £15 → "Change £5.00"; £10 → "Short £5.00"; tapping the selected button deselects it; the **Other amount link** reveals the box (`inputmode="decimal"`), which parses `17.50`, `17.5`, `£17.50`, `17`, `1,000`, shows "Short £3.00" for `12` and "Check amount" for `abc`; Card hides the block |
| H3-f | Send | Writes the order, toasts the number, closes the sheet, clears the cart, toast on screen and gone within 4 s; the document carries no `tendered` and no `changeGiven` |
| H3-g | Recent orders | No recent strip on the small menu screen; ☰ → Recent orders opens `recent-sheet` with the last five, live status, and Cancel while New working |
| H3-i1 | 360 px | No horizontal scroll with an empty cart, a full cart with the bar up, or the sheet open |
| H3-i2 | Axe | Zero serious or critical violations with the cart empty, the ☰ menu open, the order bar up, the review sheet open and the recent sheet open |
| H3-j | Menu rename | The tile reads "Choc Marshmallow"; the cart names the renamed item and never the old "Marshmallow (V)"; the saved order line stores "Chocolate Marshmallow (V)"; the `menu` collection holds exactly the seven ids |
| H3-h | **Tablet unchanged** (1280×800 only) | The order panel is always open with an empty cart, Send is disabled and at least 72 px, none of `order-bar`, `order-bar-open`, `review-sheet`, `sheet-add-more`, `menu-button`, `app-menu`, `recent-sheet` is visible, steppers stay 52×52, and the recent strip stays on the screen |

Menu-wide coverage that is not viewport specific stays in `tests/e2e/menu-h1.spec.js`
(`H-07`..`H-17`), rewritten for the seven-item menu: the seed writes seven
documents matching the table, the till shows seven tiles in sort order, every
tile is tappable with the order bar up, no horizontal scroll at 360 px, an order
carrying a deleted id still renders on the kitchen board with its stored name
and the plate icon and still moves through the flow, the station filter greys by
station (an unknown id belongs to none), the reports and the CSV keep old and
new names apart, nothing is migrated, and a new order is written with the
current ids and names.

## 39. H3 screenshots

`qa/screenshots/<project>-cash-h3-empty.png`, `-cash-h3-bar.png` and
`-cash-h3-sheet.png` for `phone`, `iphone13`, `iphone17` and `promax`: the cash
counter with an empty cart, with the cart filled and the order bar showing, and
with the Review & send sheet open on Cash. The standard `screenshots.spec.js`
run adds `<project>-cash-orders.png` and `<project>-cash-sheet.png` below 700 px.

## 40. H3 deliberate readings of the brief

1. **390×844 is a small screen too.** The brief says "every screen narrower than
   700 px", so the existing `phone` project gets the new layout. The phone paths
   in `cash.spec.js`, `tender.spec.js`, `cart-align-h2.spec.js`,
   `offline.spec.js`, `crosscutting.spec.js`, `screenshots.spec.js`,
   `version.spec.js` and `live-smoke.spec.js` were updated to go through the
   order bar and the sheet. These are test updates to match a deliberate spec
   change, not bug fixes.
2. **Send is 60 px in the sheet, 72 px on tablet.** CLAUDE.md Cash 4 asks for
   "at least 72 px"; H3 4 pins a 60 px footer button for the sheet. The more
   specific instruction wins below 700 px, as it does for the steppers (52 px
   on tablet, 48 px in the sheet) and the quick cash buttons (54 / 44).
3. **"Disabled when empty" becomes "hidden when empty".** There is no Send
   button at all on the small screen with an empty cart: the order bar, the only
   route to it, is hidden (H3 3). That is this layout's form of Cash 4.
4. **No price on the small tile.** CLAUDE.md Cash 1 puts "£5" on the tile; H3 2
   and the mock-up draw the small tile as icon plus `short` name only. The £5
   assertion therefore applies at 700 px and wider.
5. **The till picker is 40 px.** The Design rule is 48 px touch targets, but the
   mock-up draws the header till control at 40 px inside a 52 px header, and the
   brief itself sets the ☰ at 44 px. X-02 allows 44 px for ☰ and 40 px for the
   till picker **in the small cash header only**.
6. **The version label moves into ☰.** CLAUDE.md Phase III part 2, 5 puts a
   version label in every dark header; H3 1 lists "the version line" as part of
   the ☰ dropdown and gives the header a fixed one-row 52 px budget. On the
   small cash counter V-03 and V-05 read the label inside the ☰ menu; every
   other route is unchanged.
7. **Cart naming.** H3 7 renames the item; the brief does not say whether the
   cart line uses the full or the short name. The test asserts the cart names
   the renamed item and never the old "Marshmallow (V)", and pins the hard
   facts elsewhere: the tile shows "Choc Marshmallow", the saved order line and
   the one-day report and CSV show "Chocolate Marshmallow (V)". The Orders list
   Items column keeps using `short` names, per Phase IV 5.
8. **An unknown id belongs to no station.** With the retired-id special cases
   removed (H3 7), `stationOf('samosa')` is falsy, so such a line is greyed
   under every specific station filter and shown under All. It is never hidden
   (Food counter 4).
9. **`tests/e2e/live-h1.spec.js` is superseded.** Its ten-document live menu
   assertions describe the 19 Oct state that H3's reset replaces. It stays
   gated behind `LIVE_H1=1` as the record of that run; the current live menu is
   checked by `live-smoke.spec.js`.

## 41. H3-l `scripts/reset-live.mjs` against the emulator

Run by hand against the Firestore emulator (`node scripts/reset-live.mjs
--emulator [--yes]`), never against the live project — Trinity runs it there
once, after the H3 deploy. Spec: `CLAUDE.md` → Hotfix H3 7.

Fixture: 2 orders, a `menu` holding `fountain`, `samosa`, `straw` and a
hand-edited `fuchka` at 600p, and a `settings/event` document.

| Case | Expected |
|---|---|
| H3-l-1 without `--yes` | Prints the plan — counts per collection, the order ids it would delete, the 7 menu ids it would write, the 3 it would delete, "settings … left exactly as they are" — and changes nothing. Orders still 2, menu still the 4 seeded ids, no backup file written |
| H3-l-2 with `--yes` | Backup written **first** (`.secrets/backups/emulator-<timestamp>.json`, gitignored), then `orders` emptied, then `menu` made exactly the 7 documents with the right fields (`marshmallow` = "Chocolate Marshmallow (V)" / "Choc Marshmallow" / 500 / sort 7), the hand-edited price put back to 500 ("write all 7 documents in full"), `fountain`/`samosa`/`straw` deleted, `settings/event` untouched |
| H3-l-3 second run | Harmless: 0 orders deleted, the same 7 menu documents rewritten, 0 deleted, settings untouched |
| H3-l-4 failed backup | With the backup directory unwritable the run stops at the backup step (`EACCES`, "Nothing further was changed.", exit 1) **before any delete**; the seeded order is still there afterwards |
| H3-l-5 output hygiene | Counts and document ids only — no document contents, no config value, no secret |

**Result (19 Oct 2026): all five pass.**

## 42. H3 live verification (gated, **read-only, zero writes**) — `tests/e2e/live-h3.spec.js`

`LIVE_H3=1 npx playwright test tests/e2e/live-h3.spec.js --project=iphone13 --project=iphone17`

Run after the v1.3.1 deploy and after `scripts/reset-live.mjs`. **Write
discipline:** `send-order` is never clicked, no status is changed, nothing is
cancelled, no menu or settings document is touched. Tapping a tile mutates the
in-page cart only, and the cart is emptied again before leaving the screen.
`H3L-00` and `H3L-10` bracket the run with a count and a fingerprint of
`orders`. Credentials are read at run time from the gitignored
`.secrets/app-login.env`; the Show/Hide toggle is never pressed.

| id | Case | Expected |
|---|---|---|
| H3L-00 | `orders` before | 0 documents |
| H3L-01 | `menu` and `settings` | exactly the 7 H3 ids, each £5 and active, `marshmallow` = "Chocolate Marshmallow (V)" / "Choc Marshmallow"; no `fountain`, `samosa`, `straw` |
| H3L-02 | Login card | `Version 1.3.1 · build <7-char sha> · updated <date>`, matching `title` and `aria-label`, build **clean** (no `-dirty`), version equal to `package.json` |
| H3L-03 | Every route signed in | `#/`, `#/cash`, `#/kitchen`, `#/reports`, `#/reports/days`, `#/reports/orders` all load, no "Storage not configured", pill reads Online, `v1.3.1` in each dark header and in the ☰ menu on the small cash counter, zero console errors |
| H3L-04 | The till | 7 tiles in sort order, 3 columns, every tile inside the viewport with an empty cart and the menu area not scrolling, ~112 px tall, 40 px icons; the seventh reads "Choc Marshmallow" with "Chocolate Marshmallow (V)" as its accessible name; no deleted item's wording anywhere on the screen |
| H3L-05 | H3 layout, read-only | header one row ≤ 56 px with nothing wrapped; ☰ opens (aria-expanded) and closes on Escape; order bar hidden when empty, then "3 items · £15.00 Review & send" at 60 px; sheet is `role="dialog"` at top 40 px with aligned lines and 48 px steppers; Cash received shows the five quick buttons, "Change £5.00" and the Other amount link; the sheet closes on Add more, Escape and Back; **the cart is emptied and Send is never clicked** |
| H3L-06 | One day report | every KPI zero for today |
| H3L-07 | Sales by day | default range is the last 7 days ending today, `range-empty` reads "No sales in this range", "This event" not visible (no `settings/event`) |
| H3L-08 | Orders screen | `orders-empty` reads "No orders match these filters.", summary `0 orders · £0.00` with no "(excludes …)" |
| H3L-09 | CSV read path | the One day export downloads, parses, has the thirteen Phase I columns and no data rows; no `tendered` |
| H3L-10 | Nothing was written | `orders` still 0 with a byte-identical fingerprint; `menu` still the same seven ids |

Screenshots: `qa/screenshots/live-h3-<project>-<screen>.png` for `iphone13`
and `iphone17`: `login`, `cash-empty`, `cash-bar`, `cash-sheet`,
`reports-zero`, `reports-days-zero`, `reports-orders-zero` — 14 files.

**Result (19 Oct 2026, build `9be6abd`): 22/22 pass, zero console errors,
nothing written.**

---

# Hotfix H4 — Card is the default payment (v1.3.2)

Spec: `CLAUDE.md` → "Hotfix H4: Card is the default payment (v1.3.2)", items
1–4. Read-only change to the till's opening state: no change to the data model,
the reports or the CSV (`payment` is still `"cash"` or `"card"`).

## 43. H4 end-to-end cases — `tests/e2e/cash-h4.spec.js`

Projects: `tablet` (1280×800, the always-open order panel), `phone` (390×844)
and `iphone13` (390×664, the small phone from H3 — `cash-h4.spec.js` is added
to that project's `testMatch` in `playwright.config.js`). "Every layout" in H4 1
means both the panel and the Review & send sheet, which is exactly these three.

| id | Case | Expected (CLAUDE.md) |
|---|---|---|
| H4-01 | First load of `#/cash` | Tablet, empty cart: `pay-card` `aria-pressed="true"`, `pay-cash` `"false"`. With items in the cart, both layouts: same pair, and no part of the Cash received block on screen, nor the words "Cash received" (H4 1, H4 2) |
| H4-02 | Cash shows it, Card hides and resets it | Tapping Cash → `cash true / card false` and the calculator appears; £20 reads "Change £5.00" / "Change to give: £5.00"; tapping Card → `cash false / card true` and the block is hidden; tapping Cash again → a **cleared** calculator (no quick button pressed, no message). Repeated for a typed Other amount: the box comes back empty (H4 2) |
| H4-03 | After Send | The sent order is still `payment: "cash"` (H4 3); the next order opens on Card with Cash received hidden — "The choice is not remembered between orders" (H4 1) |
| H4-04 | After Clear order (**tablet only**) | `clear-order` with Cash selected and £50 keyed in; the next order is on Card with Cash received hidden (H4 1). Skipped below 700 px: CLAUDE.md H3 4 gives the sheet an Add more header, a scrolling body and a pinned Send footer — no Clear order control — so the phone form of this reset is H4-05 |
| H4-05 | Cart emptied by the − stepper | The last `line-dec-*` tap empties the cart (and closes the sheet below 700 px); tablet shows Card immediately; the next order is on Card either way (H4 1, "when the cart empties") |
| H4-06 | Phone Review & send sheet (`phone`, `iphone13`) | The sheet opens on Card with no Cash received; a cash sale from the sheet still writes `payment: "cash"`; reopening the sheet for the next customer is back on Card. Screenshot `qa/screenshots/<project>-cash-sheet-card-default.png` |
| H4-07 | No payment tap at all | Add two items, name, Send without touching either button → Firestore holds `payment: "card"`, total correct, still no `tendered` field (H4 1, H4 3) |
| H4-08 | Card survives panel open/close | Card stays selected while items are added to the same order; once **Cash** is chosen for the order in hand it stays chosen while the cart still has items (H4 1 resets "for every new order", not on every re-render) |

Zero console errors on `#/cash` in H4-01, H4-02, H4-03, H4-06 and H4-07.

**Deliberate readings of the brief.** (a) H4 1 lists "after Clear order" among
the resets; the small layout has no such control (H3 4), so H4-04 is a tablet
case and H4-05 covers the same reset on the phone. (b) "Starts with Card
selected" is read as the state of a **new** order: H4-08 pins that Cash, once
chosen, stays chosen while the cart still holds items, otherwise the toggle
would be unusable. (c) The Cash received block stays in the DOM `hidden` with
Card selected; H4-01 asserts it is not *visible* (and that "Cash received" is
not in the page's `innerText`), not that the node is absent — the brief says
"hides", not "removes".

## 44. Existing tests changed for H4, and why

The Card default changes the **starting state** of the till, so tests that used
to land on the cash path for free now have to ask for it. No assertion was
weakened; each change makes an implicit assumption explicit.

| File | Change | Why |
|---|---|---|
| `tests/e2e/helpers.js` | new `selectPayment(page, 'cash'\|'card')` and `cashReceivedVisible(page)`; `placeOrder()` now chooses the payment through `selectPayment` | One place says "mean cash". `selectPayment` only taps when the button is not already pressed, so it never trips the "tapping a selected button deselects it" rule, and it asserts the button ends up pressed — a silently-ignored tap now fails loudly |
| `tests/e2e/tender.spec.js` | `cashWithOrder()` uses `selectPayment`; T-09 (b)(c)(d) and T-10 (b)(c) choose Cash again after Send / Clear order / the cart emptying; T-11's card leg says `selectPayment(page, 'card')` | Those legs re-open the Cash received box on a **new** order, which H4 1 now starts on Card. Without the extra tap the box is not rendered at all and the case would fail for the wrong reason |
| `tests/e2e/cash-h3.spec.js` | H3-e asserts the sheet opens with Cash received hidden, then taps Cash; H3-f taps Cash before keying £20 and still asserts `payment: "cash"` | Same reason in the H3 sheet. H3-e gains a real H4 assertion rather than losing one |
| `tests/unit/orders.test.js` | `P4-U-09` now expects `package.json` version `1.3.2` | CLAUDE.md H4 4 and the version table ("1.3.2 — Hotfix H4") |
| `playwright.config.js` | `iphone13` also matches `cash-h4.spec.js` | H4 1 "on every layout"; `iphone17` and `promax` stay on the H3 suite only, to keep the fix loop short |

Unchanged on purpose: `cash.spec.js` C-07 and C-16 already tap `pay-cash`
first, and every `placeOrder({ payment: 'cash' })` call goes through the helper
above, so those cases keep testing what they always tested.

## 45. Version literals in the gated live suites (fixed round 2)

`tests/e2e/live-h3.spec.js` pinned the literal `1.3.1` next to an assertion
that the same value equals `PKG_VERSION` (read from `package.json`). Once H4
bumped the version to 1.3.2 the two could never both hold, so the H3 live
check became unsatisfiable. It is gated behind `LIVE_H3=1`, so it skips in
`npm run test:e2e` and the contradiction only surfaces on a live check.

`CLAUDE.md` → Phase III part 2, 1 is explicit that `package.json` is the single
source of truth and that every hotfix bumps the patch number, so the frozen
literal is what was wrong, not the app. The exact value now comes from
`PKG_VERSION` everywhere (login card, ☰ menu line, header pill, record string),
with a floor check `atLeast(version, '1.3.1')` that still proves the deployed
build is the H3 release or later. The stale test title was updated to match.

Rule for later phases: a live spec asserts `PKG_VERSION` for the exact value
and a floor for "this release or later". Never a bare version literal — it
rots at the next bump. `live-p4.spec.js` already follows this (only its
message string names a version) and was left alone.
