# Charity Food Stall POS: Phase I build brief

You are the orchestrator. Build, test and deploy a working prototype end to end with three subagents:

| Agent | Role | Owns |
|---|---|---|
| `neo` | UI developer | `public/` (except the generated `public/js/firebase-config.js`), app scripts in `package.json` |
| `morpheus` | QA tester | `tests/`, `qa/`, `playwright.config.js`, `vitest.config.js` |
| `trinity` | Platform / DevOps | Firebase project and Firestore, GitHub repo, secrets, Pages, `firebase.json`, `.firebaserc`, `firestore.rules`, `.github/`, `.gitignore`, `scripts/`, every `git`, `gh` and `firebase` (non-emulator) command |

**Run without stopping.** Never ask the user a question. When something is unclear, pick the option closest to this brief, write one line in `DECISIONS.md`, and carry on. If a step is impossible (missing login, missing permission), skip it, record it in `HANDOVER.md` under "Needs you", and finish everything else.

App security is out of scope for Phase I: no login, open Firestore rules. **Secret hygiene is in scope** (next section).

## Settings

```
GITHUB_OWNER         = nottinghambengaliassociation      # a GitHub user account (gh is logged in as it), not an org
REPO_NAME            = nba-food-stall-app
LIVE_URL             = https://nottinghambengaliassociation.github.io/nba-food-stall-app/
FIREBASE_PROJECT_ID  = nba-food-stall-9fec6              # display name "nba-food-stall"; created by the user with Firestore (default) already set up. Use it, never create another project or database
FIRESTORE_LOCATION   = europe-west2                      # London
EMULATOR_PROJECT_ID  = demo-food-stall                   # demo- prefix: emulator runs with no login
```

## No keys or secrets in GitHub

- Nothing secret or environment-specific is ever committed: no Firebase config values, API keys, tokens, service-account JSON, `.env` files.
- `public/js/firebase-config.js` is **generated, never committed**. It is in `.gitignore`. Locally it is written by `scripts/write-firebase-config.mjs` from `firebase apps:sdkconfig`; in CI the Pages workflow writes it from GitHub Actions secrets just before upload.
- `public/js/firebase-config.example.js` (placeholders only) is committed so the shape is documented.
- GitHub Actions secrets, set by Trinity with `gh secret set` reading from a local gitignored file, never from a literal on the command line: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `APP_LOGIN_USER`, `APP_LOGIN_PASSWORD_SHA256`.
- Login credentials live only in `.secrets/app-login.env` on this Mac (`APP_LOGIN_USER=…`, `APP_LOGIN_PASSWORD=…`, already created by the user). Never copy the username or password into code, tests, docs, commit messages or this file. `public/js/login-config.js` is **generated, never committed**: it holds the username and the SHA-256 of the password, written by `scripts/write-login-config.mjs` (locally from `.secrets/app-login.env`, in CI from the two `APP_LOGIN_*` secrets). `public/js/login-config.example.js` (placeholders) is committed.
- Guardrails: `.gitignore` covers `public/js/firebase-config.js`, `public/js/login-config.js`, `.env*`, `.secrets/`, `*service-account*.json`, `*-sdkconfig.json`; a git pre-commit hook (`scripts/check-secrets.sh`) blocks staged files matching `AIza[0-9A-Za-z_-]{35}` or `"private_key"`; GitHub secret scanning and push protection are enabled on the repo.
- Never print secret values in chat, logs, `DECISIONS.md` or `HANDOVER.md`.
- Plain fact for the handover: a Firebase web API key always ends up in the browser of a deployed web app. It identifies the project, it is not a password. Keeping it out of GitHub is still the rule here; restricting the key to the Pages domain is the extra step (Trinity does it if `gcloud` is available, otherwise "Needs you").

## What it does

One static single-page app, a shared login, three working screens, shared data in Cloud Firestore.

| Route | Screen | Used by |
|---|---|---|
| `#/login` | Sign in with the one shared account. Every other route redirects here until signed in | Everyone |
| `#/cash` | Cash counter: build order, take name, cash or card, send | Till volunteer (tablet or phone) |
| `#/kitchen` | Food counter: New → Preparing → Ready → Collected | Food counter volunteers (tablet or phone) |
| `#/reports` | One day: daily totals, per item, peak demand, cash vs card, CSV export | Organisers |
| `#/reports/days` | Phase III. Sales by day across a date range | Organisers |
| `#/reports/orders` | Phase IV. List a day's orders and view each order's items | Organisers |
| `#/` | Landing page after sign-in: three big buttons to the above, till letter setting | Everyone |

### Menu (seed into Firestore on first load if `menu` is empty)

| id | name | short | price (pence) | tile colour | station | active | sort |
|---|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | Fuchka | 500 | #FDE68A | chaat | true | 1 |
| momo | Momo | Momo | 500 | #BFDBFE | momo | true | 2 |
| chat | Papri Chat | Papri Chat | 500 | #FECACA | chaat | true | 3 |
| sweet_box | Sweet Box | Sweet Box | 500 | #FED7AA | sweets | true | 4 |
| samosa_only | Samosa | Samosa | 500 | #D9F99D | sweets | true | 5 |
| choc_strawberry | Chocolate Strawberry | Choc Strawberry | 500 | #E9D5FF | sweets | true | 6 |
| marshmallow | Chocolate Marshmallow (V) | Choc Marshmallow | 500 | #FBCFE8 | sweets | true | 7 |

This is the whole menu from v1.3.1: 7 items. Hotfix H3 resets the live database (no real orders exist yet), so the retired ids `samosa`, `straw` and `fountain` are deleted rather than kept inactive. Don't reuse those ids. Any item id the app doesn't know still renders with the name stored on the order line and the plate icon.

Prices are edited in the Firebase console in Phase I; the app reads them from `menu`, never hard-codes them outside the seed.

### Data model

```
orders/{autoId}
  orderNo      "A-043"          till letter + 3-digit daily sequence
  name         "Priya"          name to call out; "Guest" if blank
  items        [{id, name, qty, price}]   price in pence
  total        1500             pence, integers only
  payment      "cash" | "card"
  tendered     2000             Phase I orders only. Not written since Phase II (Cash received is a calculator, not stored)
  status       "new" | "preparing" | "ready" | "collected" | "cancelled"
  day          "2026-10-17"     Europe/London date
  till         "A"
  createdAtMs, startedAtMs, readyAtMs, collectedAtMs, cancelledAtMs   Date.now() numbers
  createdAt    serverTimestamp()

menu/{id}
  name, short, price, colour, station, active, sort
```

Order numbers are generated on the device: `localStorage["seq:<till>:<day>"]`, so the till never waits for the network. Till letter is set on the landing page (default A) and stored in `localStorage`.

Queries: only `where("day", "==", day)`; filter and sort on the client. No composite indexes.

## Functional requirements

### Phase II: Login and sign out (built and live, 18 Oct 2026)
Mock-ups: `design/Login.dc.html`, `design/LoginMobile.dc.html`, and the Sign out button in the headers of the other mock-ups.

1. Login screen: NBA logo (`public/img/nba-logo.png`, about 168 px tablet, 132 px phone), heading "Nottingham Bengali Association", subheading "Food Stall Application" in #B5050F, Username and Password fields (60 px tall), a Show/Hide button inside the password field, a "Sign in" button (at least 64 px, #B5050F, white text), and the helper line "One shared login for stall volunteers. Ask the stall lead if you don't have it."
2. Check: username trimmed and case-insensitive; password exact. Compare `crypto.subtle.digest("SHA-256", password)` (hex) with `loginPasswordSha256` from `public/js/login-config.js`. Never hold the plain password anywhere except the input.
3. Wrong attempt: show "Username or password is wrong. Check and try again." in a red `role="alert"` box, outline both fields red, clear the password, focus the password field. **No lockout, no attempt counter, no delay, unlimited retries.**
4. If `login-config.js` is missing or has placeholders: show "Login not configured" on the login screen instead of a form.
5. Success: store `localStorage["nba.session"] = {"user": "<username>", "at": <ms>}` and go to `#/`. The session lasts until Sign out (no expiry), so a refresh or dropped connection never sends a volunteer back to the login screen.
6. Route guard: any route other than `#/login` with no session redirects to `#/login`. `#/login` with a session redirects to `#/`.
7. Sign out on every screen's dark header, last item on the right: icon plus "Sign out" at 700 px and wider; icon-only 44×44 button with `aria-label="Sign out"` below 700 px. It clears `nba.session` (keep till letter and order sequences) and goes to `#/login`.
8. On the cash counter, if the order panel has items, Sign out first shows an in-page confirm ("Discard the unsent order and sign out?" with Cancel and Sign out buttons). Never `window.confirm`.
9. Login is a screen gate for volunteers, not security: Firestore rules stay open in Phase I.

### Cash counter
1. Six big item tiles with icon, name and £5. Tap adds one. Quantity badge on the tile.
2. Order panel: name input, line items with − and + (each at least 52×52 px), line totals, big total.
3. Cash or Card toggle. **Phase II (built and live, 18 Oct 2026):** with Cash selected, show **Cash received (optional)** (mock-ups: `design/CashCounter.dc.html`, `design/CashCounterMobile.dc.html`):
   - Quick buttons: Exact, £5, £10, £20, £50 (at least 44 px tall on phone, 54 px on tablet). Tapping a selected button deselects it. Exact = the order total.
   - "Other amount" text box (`inputmode="decimal"`, £ prefix) for any amount. Accepts `17.50`, `17.5`, `£17.50`, `17`, `1,000`. Typing in it clears the quick button; tapping a quick button clears it.
   - Show "Change to give: £x.xx" (teal) when received ≥ total, "Short by £x.xx" (amber) when less, "Enter an amount like 17.50" (amber) when it can't be parsed, and nothing when empty. Phone shows a short form beside the label ("Change £5.00", "Short £2.00", "Check amount").
   - A Clear link (tablet) resets it. Switching to Card, sending, or clearing the order resets it.
   - It never blocks sending: an order can go with no amount, a short amount, or an unparseable amount.
   - It's a calculator for the volunteer only. Nothing about it is saved to the order or exported (decision during the Phase II build, recorded in `DECISIONS.md`). It resets when the order panel empties.
4. "Send to food counter" button (at least 72 px tall), disabled when empty. On send: write the order, show a confirmation with the order number for 4 s, clear the panel.
5. Recent orders strip (last 5 from this till) with live status. Cancel is available while status is `new`.
6. Connection pill: "Online · synced" or "Offline · N queued" (use `navigator.onLine` plus snapshot `hasPendingWrites`).

### Food counter
1. Live `onSnapshot` on today's orders. Three columns on tablet (New, Preparing, Ready); tabs with counts on phone.
2. Card shows order number, name, items with quantities and icons, and age ("3 min"). Age turns amber at 6 min or more.
3. One big action button per card: Start → Ready → Collected (at least 64 px tall). Ready cards show the name in large capitals for calling out.
4. Station filter: All, Chaat, Momo, Sweets. Lines not for the station are greyed but still shown.
5. "Undo last tap" restores the previous status.
6. Short beep on a new order (Web Audio, toggle in header). Request a screen wake lock where supported.

### Reports
1. Date input, default today (Europe/London).
2. KPI tiles: total sales, orders, items sold, average order, average wait (createdAt to readyAt). Cancelled orders excluded everywhere.
3. Sales by item: units, revenue, bar.
4. Orders per 30 minutes as a bar chart, peak bar highlighted, "Peak 30 min" and "Busiest 2 hours" callouts, "Show as table" toggle.
5. Cash vs card split with amounts and percentages.
6. "Export CSV" downloads one row per order line: day, orderNo, till, name, item, qty, price, lineTotal, payment, status, createdAt, readyAt, waitSeconds.

### Hotfix H1: split menu items (18 Oct 2026) — shipped 19 Oct, don't rebuild
The menu change itself may already have been made by hand in the Firebase console (4 new documents, `samosa` and `straw` set `active: false`, `fountain` sort 8). The hotfix makes the code match:

1. `MENU` seed in `public/js/logic.js` = the table above, including the two retired rows with `active: false`, so `stationOf` knows every id and a fresh emulator seeds the same menu.
2. Icons in `public/js/icons.js` for the four new ids: `sweet_box` (a box with a ribbon), `samosa_only` (the existing samosa triangle), `choc_strawberry` (the existing strawberry), `marshmallow` (two stacked rounded cylinders). Keep `samosa` and `straw` icons for old orders.
3. Station filter: all four new ids are `sweets`.
4. `scripts/menu-sync.mjs` (Trinity): idempotent. Using the web SDK and the live Firebase config, create any missing new document and set `active: false` on `samosa` and `straw` and `sort: 8` on `fountain`. Never overwrite a field that already has a different value (it may have been edited in the console); report differences instead. Never delete a document. This is the only permitted write to live Firestore in a follow-up run.
5. Till: 8 tiles. Phone layout must still show all 8 tiles and the bottom order bar without the bar covering a tile (scroll the tile area if needed).
6. Reports and CSV: orders containing `samosa` or `straw` still show under their original names; new orders under the new names. Nothing is migrated in old orders.

Ship H1 on its own, before Phase III: build, test, push to `main`, run `menu-sync`, live check (read-only apart from `menu-sync`).

### Hotfix H2: cart line alignment (19 Oct 2026) — shipped 19 Oct, don't rebuild
Cosmetic bug on the cash counter: the − / + buttons sat at different positions on each cart row because each row was a flex row sized by its item name ("Chocolate Strawberry" pushed its buttons right, "Momo" didn't).

The fix is **already in the working tree, uncommitted**: `public/css/app.css`, `.line` is now a grid with fixed columns `minmax(0, 1fr) 52px 28px 52px 58px`, `column-gap: 6px`; `.line__name` 18 px and wraps; `.line__qty` and `.line__amount` use tabular numbers. Don't redesign it; keep the 52 px steppers.

1. Morpheus: add an e2e test (phone and tablet) that fills the cart with all active menu items and asserts every row's `line-dec-*` and `line-inc-*` share the same left x (±1 px), no `.line__name` overflows, and the steppers stay at least 52 px. Rerun the full suite.
2. Neo: only if that test fails, adjust the column widths in `.line`. No other changes.
3. Trinity: commit `public/css/app.css` and the test with message `fix(cash): align cart line steppers in fixed columns`, push to `main`, watch the deploy.
4. Morpheus: read-only live check of `#/cash` with items in the cart, both viewports, screenshot `qa/screenshots/live-h2-cart-*.png`. Place no orders.
5. Add a line to `HANDOVER.md` under "What changed". Remind volunteers to refresh open tills.

### Phase III: Sales by day report (shipped 19 Oct 2026 as v1.2.0, don't rebuild)
Mock-ups: `design/ReportsByDay.dc.html` and the One day / Sales by day toggle in `design/Reports.dc.html`. Read-only: no change to how orders are stored.

1. Toggle at the top of both report screens: "One day" (`#/reports`) and "Sales by day" (`#/reports/days`), pill buttons at least 48 px, current one filled ink.
2. Range: From and To date inputs (Europe/London days) and quick buttons Today, Last 7 days, This event. Default: Last 7 days ending today. "This event" uses `settings/event` (`{name, from, to}`, edited in the Firebase console) and is hidden when that document doesn't exist. To before From swaps them. Maximum 31 days; longer ranges show "Pick 31 days or fewer" and don't query.
3. Query: `where("day", ">=", from)` and `where("day", "<=", to)` on `orders`, single field so no composite index. Exclude cancelled. One read per order in range.
4. Only days with at least one order appear ("trading days"). No orders in range: "No sales in this range".
5. Totals tiles: Total sales; Orders (note "excludes cancelled"); Items sold (note "x.x per order"); Best day (day and its sales); Average per trading day (sales, note "n orders a day").
6. "Sales per day" bar chart: one bar per trading day, value label above each bar, weekday and date below, best day #B45309, others #FBBF24, hovered #F59E0B, £ gridlines. Hover, focus or tap shows "Sun 18 Oct · £2,005.00 · 208 orders". Each bar is a real `<button>` with an aria-label.
7. "Day by day" table: Day, Orders, Items, Sales, Cash, Card, Avg order, Peak 30 min, and an "Open day" button linking to `#/reports?day=YYYY-MM-DD` (the One day report opens on that date). Totals row. Horizontal scroll inside the card on narrow screens.
8. "Items sold by day" table: menu items as rows, trading days as columns, then Total and Sales. Each item's best day cell shaded #FEF3C7. Note under it: "Shading marks each item's best day."
9. "Export CSV for Sheets" on this screen exports every order line in the range, same columns as the One day CSV, file name `nba-food-stall_<from>_<to>.csv`.
10. Some Phase I orders carry a `tendered` field and newer ones don't. Ignore it: it's not used anywhere in this report or the CSV.

### Phase III (part 2): App version on login and headers (shipped 19 Oct 2026 as v1.2.0)
Mock-ups: footer of `design/Login.dc.html` and `design/LoginMobile.dc.html`; the `v1.2.0` label in the header of every other mock-up. Nothing secret is involved.

| Version | What |
|---|---|
| 1.0.0 | Phase I (17 Oct 2026) |
| 1.1.0 | Phase II: login, sign out, Cash received calculator (18 Oct) |
| 1.1.1 | Hotfix H1: menu split into eight items (19 Oct) |
| 1.1.2 | Hotfix H2: cart line alignment (19 Oct) |
| 1.2.0 | Phase III: Sales by day report and app version (19 Oct, live) |
| 1.3.0 | Phase IV: Orders list and order detail in Reports (19 Oct, live) |
| **1.3.1** | **Hotfix H3: phone cash counter layout (next run)** |

1. `package.json` `version` is the single source of truth. Set it to `1.2.0` in this run. Every later phase bumps the minor number, every hotfix the patch number, and `HANDOVER.md` "What changed" names the version.
2. `scripts/write-version.mjs` (Trinity) writes `public/js/version.js`: `APP_VERSION` from `package.json`, `APP_BUILD` the 7-character commit SHA, `APP_DATE` the build date (Europe/London, `YYYY-MM-DD`). Locally it uses `git rev-parse --short HEAD`, adding `-dirty` when the working tree has uncommitted changes. In CI it uses `GITHUB_SHA`. The file is generated and gitignored, like the other config files. Add a Pages workflow step that runs it before the upload.
3. The app imports `version.js` dynamically. If it's missing, every label shows `dev` and nothing errors.
4. Login screen (tablet and phone): one line at the bottom of the card, always visible (before and after sign-in): "Version 1.2.0 · build a1b2c3d · updated 19 Oct 2026". 13 px, #78716C, centred. On phone it sits at the bottom of the screen.
5. Every dark header (landing, cash counter, food counter, both reports), 700 px and wider: an outlined pill right after the screen title, text `v1.2.0`, 13 px bold, #D6D3D1 text, 1 px #57534E border, fully rounded. Below 700 px: `v1.2.0` in 12 px bold #A8A29E under the title, so it never squeezes the header buttons.
6. Both carry `title` and `aria-label` "Version 1.2.0, build a1b2c3d, updated 19 Oct 2026". Test ids: `login-version`, `app-version`.

### Phase IV: Orders list and order detail (v1.3.0, shipped 19 Oct, don't rebuild)
Mock-ups: `design/ReportsOrders.dc.html` (tablet/desktop), `design/ReportsOrdersMobile.dc.html` (phone), and the third "Orders" tab added to `design/Reports.dc.html` and `design/ReportsByDay.dc.html`. Read-only: no change to how orders are stored, no writes.

1. Third tab on every report screen: One day | Sales by day | **Orders** (`#/reports/orders`). Same pill style; current tab filled ink. On phone the labels are One day | By day | Orders.
2. Filters (tablet): Day date input (default today, Europe/London; `#/reports/orders?day=YYYY-MM-DD` opens that day), search box "Search order number or name" (case-insensitive, matches order number or name), Status buttons (All, New, Preparing, Ready, Collected, Cancelled), Payment buttons (All, Cash, Card). Phone: date and search on one row, status buttons in a sideways-scrolling row, no payment filter.
3. Data: the same single-field query as the One day report (`where("day", "==", day)`), live via `onSnapshot` so new orders and status changes appear without a refresh. Cancelled orders are listed but excluded from the total.
4. Summary line above the list: "<n> orders · £<total> (excludes <c> cancelled)", reflecting the current filters. The "(excludes …)" part only when c > 0.
5. Tablet list: table, newest first: Order (a real `<button>` showing the order number; opens the detail), Time (HH:MM), Name, Items ("2× Fuchka, 1× Momo", menu `short` names), Total (grey for cancelled), Pay, Status pill (New #FDE68A, Preparing #BFDBFE, Ready #0F766E white text, Collected #E7E5E4, Cancelled white with #B91C1C border and text), Wait (placed to ready, "—" if not ready). Selected row shaded #FEF3C7. Horizontal scroll inside the card on narrow widths. Empty: "No orders match these filters."
6. Tablet detail panel (right of the list, stacks below it under 1100 px): order number, name, status pill; Till, Payment, Placed (day and time), Wait; Timeline Placed → Started → Ready → Collected (or Placed → Cancelled) with times, "—" and a grey dot for steps not reached; Items table with icon, name, qty, price, line total and a Total row; note "Read-only. Orders are cancelled from the cash counter; status changes happen on the food counter. Cancelled orders are listed but excluded from every total." Nothing selected: "Select an order to see its items." Default selection: none.
7. Phone: order cards (number, name, status pill, items, "HH:MM · Cash · till A", total); tapping a card opens the full-screen detail with an "All orders" back button. The browser back button also returns to the list.
8. "Export these orders (CSV)" exports the orders currently shown (after filters), same columns as the One day CSV, file `nba-food-stall_orders_<day>.csv`.
9. Retired items (`samosa`, `straw`) in older orders show under their original names and icons.
10. `package.json` version 1.3.0; the version label shows v1.3.0 after deploy.

### Hotfix H3: phone cash counter layout (v1.3.1)
Problem: on an iPhone 13 in Safari (about 390×664 visible) the always-open order panel takes over half the screen, only two menu tiles show, the header wraps to three rows and the payment buttons get squeezed.

Mock-ups: `design/CashCounterSmall.dc.html` (menu and order bar, iPhone 13), `design/CashCounterSmallOpen.dc.html` (Review & send sheet open), `design/CashCounterSmall17.dc.html` (iPhone 17, 402×694). Applies to the cash counter on **every screen narrower than 700 px**, replacing the current phone cash layout. Tablet and desktop (700 px and wider) are unchanged. No data change.

1. **Header, one row, 52 px:** till picker ("Till A", same stored till letter as the landing page), connection dot with a short label ("Online", "Offline · 2 queued"), "Next A-045", and a ☰ button (44 px, `aria-expanded`). The ☰ button opens a dropdown with Food counter, Reports, Recent orders, Sign out (red; keeps the unsent-order confirm) and the version line. It closes on outside tap, Escape or choosing an item.
2. **Menu tiles:** 3 columns, about 112 px tall, icon 40 px, `short` name 14 px bold, quantity badge top right. All 7 tiles fit without scrolling at 390×664 (8 would too); the area scrolls if the menu grows. Bottom padding keeps the last row clear of the order bar.
3. **Order bar:** hidden while the cart is empty. With items: fixed to the bottom, one 60 px teal button "<n> items · £x.xx  Review & send ›". Honour `env(safe-area-inset-bottom)`.
4. **Review & send sheet:** slides up over the menu (top offset 40 px, dimmed backdrop, `role="dialog"`). Header "Order · <n> items" with an **Add more** button that closes it. Scrolling body: Name to call out, cart lines (the H2 aligned grid, steppers 48 px), Total, Cash / Card, and with Cash: Cash received (optional) quick buttons Exact, £5, £10, £20, £50 with "Change £x.xx" or "Short £x.xx" beside the label, and an **Other amount** link that reveals the existing Other amount box (same parsing and messages). Footer pinned: "Send to food counter · £x.xx", 60 px, always visible. Removing the last item closes the sheet. Escape and the browser Back button close it. Focus moves into the sheet on open and back to the order bar on close.
5. **Send:** unchanged behaviour (writes the order, clears the cart, closes the sheet). The confirmation toast with the order number shows for 4 s above the order bar.
6. **Recent orders:** the phone recent-orders strip moves to ☰ → Recent orders, which opens a small sheet with the last 5 orders from this till, their live status and Cancel while New. Not in the mock-ups; same styling as the review sheet.
7. **Menu changes and live clean-up (same release).** The system isn't in use and holds no real orders, so H3 resets live data completely:
   - Menu becomes exactly the 7-item table above: `marshmallow` renamed "Chocolate Marshmallow (V)" / short "Choc Marshmallow"; Chocolate Fountain removed.
   - Code: the `MENU` seed in `public/js/logic.js` equals the table (no retired rows). Remove the retired-id special cases from the code (station lists, name maps, the old H1 sync whitelist). Keep the generic fallback: an unknown item id shows its stored line name and the plate icon.
   - `scripts/reset-live.mjs` (Trinity), run once against live after the H3 deploy:
     1. Back up every document in `orders`, `menu` and `settings` to `.secrets/backups/live-<timestamp>.json` (gitignored). Stop if the backup fails.
     2. Delete every document in `orders`.
     3. Make `menu` exactly the 7-item table: write all 7 documents in full, delete any other menu document (`samosa`, `straw`, `fountain` and anything else).
     4. Leave `settings` alone.
     5. Requires `--yes`; without it, prints the plan (counts per collection, ids to delete) and changes nothing. Print counts only, never document contents.
   - `scripts/menu-sync.mjs` stays for future menu edits, but drop its H1 whitelist.
   - After the reset, reports start empty, order numbers restart naturally the next trading day, and devices keep their till letter.
8. `package.json` version 1.3.1.

## Design

Reference mock-ups are in `design/*.dc.html` (the `/_blob/…` image in the login mock-ups is `public/img/nba-logo.png`; the credential check in them is a placeholder) (read the markup for layout, sizes and colours; they are not runnable as-is). Match them.

- Fonts: Bricolage Grotesque 600/800 for headings and numbers, Atkinson Hyperlegible 400/700 for everything else (Google Fonts).
- Colours: ink #1C1917, muted #57534E, line #E7E5E4, page #F5F5F4, card #FFFFFF, marigold #FDE68A (selected), action blue #1D4ED8 (Start), teal #0F766E (Ready, Send), amber warning #B45309, NBA red #E20613 (logo only), NBA red dark #B5050F (Sign in button, subheading; passes contrast with white).
- Dark header bar on every screen.
- Touch targets at least 48 px; primary actions 64 to 84 px. Body text at least 17 px.
- Breakpoint 700 px: below it, phone layout (2-column tiles, sticky bottom order bar on cash, tabs on kitchen). Above it, tablet/desktop layout.
- Icons: inline stroke SVG per item (see `design/ItemIcon.dc.html`). No emoji.
- No horizontal scroll at 360 px width.

## Technical constraints

- No build step. Plain HTML, CSS and ES modules in `public/`, served as-is by GitHub Pages.
- Firebase modular JS SDK imported from `https://www.gstatic.com/firebasejs/<version>/...`. Pin the version: run `npm view firebase version` and use that.
- Firestore with `persistentLocalCache` and `persistentMultipleTabManager` for offline writes.
- On `localhost` or `127.0.0.1`: initialise with `{ projectId: "demo-food-stall", apiKey: "demo" }` and `connectFirestoreEmulator(db, "127.0.0.1", 8080)`. Add `?live=1` to use the real project locally. Elsewhere: load `public/js/firebase-config.js` with a dynamic `import()`. If it is missing or still has `PASTE_` placeholders, show a clear banner "Storage not configured" instead of crashing.
- Put all pure logic (money, order numbers, day string, report aggregation, CSV) in `public/js/logic.js` with no Firebase imports, so it is unit-testable.
- `firebase.json` (Trinity) configures the Firestore emulator on port 8080, UI off, and points at `firestore.rules`: `allow read, write: if true;` (prototype only).
- Dev tooling via npm (devDependencies only): `firebase-tools`, `@playwright/test`, `@axe-core/playwright`, `vitest`, `http-server`.

### Suggested layout
```
public/index.html  public/css/app.css  public/manifest.webmanifest
public/js/{app,router,store,logic,cash,kitchen,reports,icons}.js
public/js/firebase-config.example.js     committed, placeholders
public/js/login-config.js                generated, gitignored
public/js/version.js                     generated, gitignored (Phase III)
public/js/login-config.example.js        committed, placeholders
public/js/login.js                       login screen, session, route guard, sign out
public/img/nba-logo.png                  NBA logo (provided)
public/js/firebase-config.js             generated, gitignored
tests/unit/*.test.js   tests/e2e/*.spec.js
qa/test-plan.md  qa/bugs.md  qa/screenshots/
scripts/write-firebase-config.mjs  scripts/write-login-config.mjs  scripts/check-secrets.sh
firebase.json  .firebaserc  firestore.rules  .gitignore
playwright.config.js  vitest.config.js  package.json
.github/workflows/pages.yml
```

### npm scripts
```
"serve":    "http-server public -p 5173 -c-1 --silent"
"test:unit":"vitest run"
"test:e2e": "firebase emulators:exec --only firestore --project demo-food-stall \"playwright test\""
"test":     "npm run test:unit && npm run test:e2e"
```

## Workflow

**If the app is already built and deployed** (a previous run exists: `HANDOVER.md` present), do only the follow-up work that isn't built yet:

| Phase | Work | Who |
|---|---|---|
| II | Login and sign out | **Built and live 18 Oct 2026.** Don't rebuild |
| II | Cash received calculator (not stored) | **Built and live 18 Oct 2026.** Don't rebuild |
| III | Sales by day report | Neo |

Morpheus adds tests for each phase built and re-runs everything. Then Trinity commits and pushes to `main` (no pull request; the user starts the run when the stall isn't trading) and Morpheus runs the live check. Update `HANDOVER.md` with a "What changed" section per phase.

**Protecting live data on a follow-up run:** all build and test work uses the emulator, as before. The live check is read-only: load every route, sign in, open both reports, export a CSV. Place no orders and write nothing to the live Firestore.


1. **Platform first (Trinity), in parallel with step 2.** Pre-flight checks, then: git repo and guardrails (`.gitignore`, pre-commit hook, example config) before any commit; Firebase project, web app, Firestore `(default)` in London, rules; local `firebase-config.js`; GitHub repo, secrets, Pages, secret scanning. Every failure goes to "Needs you" and the build carries on against the emulator.
2. **Build and test plan in parallel.**
   - Neo: scaffold, `npm install`, implement all three screens and the landing page against the emulator.
   - Morpheus: write `qa/test-plan.md` from this brief, then unit and e2e tests. Morpheus tests the brief, not Neo's code.
3. **Test loop.** Morpheus runs `npm test`, writes failures to `qa/bugs.md` (id, severity, steps, expected, actual, screenshot). Hand the bug list to Neo. Neo fixes, never edits tests. Repeat until green, maximum 5 rounds. If a test is wrong against the brief, Morpheus fixes the test and notes it.
4. **Deploy (Trinity).**
   - Run `scripts/check-secrets.sh` on the whole tree and `git status --ignored` to confirm `firebase-config.js` is ignored. Then commit and push to `main`.
   - `.github/workflows/pages.yml`: on push to `main`, write `public/js/firebase-config.js` from the six `FIREBASE_*` secrets, then `actions/upload-pages-artifact` (path `public`) and `actions/deploy-pages`.
   - `gh run watch` until green. Live URL is `LIVE_URL`.
   - If Firebase secrets are missing, still deploy; the banner shows and it goes under "Needs you".
5. **Live smoke (Morpheus).** Against the live URL: all routes load, no console errors, connection pill shows Online. If real Firebase is configured, place one order named `QA-SMOKE`, take it to Collected, then cancel a second `QA-SMOKE` order.
6. **Handover (you).** Write `HANDOVER.md`: live URLs for each screen, how to set up a till and a kitchen tablet on the day, test results (counts, pass/fail), links to `qa/screenshots/`, Playwright report path, known issues, "Needs you" list. Open the Playwright HTML report and the live URL in the browser if the platform allows (`open` on macOS, `xdg-open` on Linux, `start` on Windows).

## Definition of done

- `npm test` green: unit and e2e, phone (390×844) and tablet (1280×800) projects.
- Screenshots of every screen at both sizes in `qa/screenshots/`.
- Live on GitHub Pages and smoke-tested.
- `git log -p` contains no Firebase config values, keys, tokens, login username or password; secret scanning shows no alerts.
- Login works on the live site with the shared account; ten wrong attempts in a row still leave the form usable.
- `HANDOVER.md`, `DECISIONS.md`, `qa/test-plan.md`, `qa/bugs.md` (with final status of each bug) committed and pushed.

## Rules

- Never `git push --force`, never `git add -f`, never delete a repo, never use `sudo`.
- Only Trinity runs `git commit`, `git push`, `gh` and real-project `firebase` commands. Neo and Morpheus may run the emulator through `npm` scripts.
- Neo does not touch `tests/`, `qa/` or platform files. Morpheus does not touch `public/` or platform files. Trinity does not touch app code or tests.
- Money is integer pence everywhere; format as £ only for display.
- Keep it simple. If a feature in this brief threatens the deadline, ship without it and list it in `HANDOVER.md`.
