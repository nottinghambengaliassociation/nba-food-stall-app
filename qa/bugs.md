# QA bugs — Charity Food Stall POS

Format: `BUG-<n> | severity | screen | steps | expected (CLAUDE.md) | actual | screenshot | status`

Severity key: **blocker** = requirement cannot be exercised / data loss / uncaught exception; **major** = requirement works incorrectly or breaks a stated minimum; **minor** = cosmetic or wording.

Status key: `open` → raised, `fixed` → Neo reports a fix, `verified` → Morpheus re-ran and it passes.

---

## Round 1 — 2026-10-17

Suites after test corrections (stable, reproduced on three consecutive runs):
unit **85/85 pass**; e2e **116 active tests** (58 per project) — **113 pass, 3 fail**, 6 live-smoke tests skipped by design.
Failing: `C-05` (phone), `C-07` (phone + tablet).

### BUG-1 | minor | Cash counter (`#/cash`) | status: **verified** (round 2)

**Steps**
1. Load `#/cash` (phone and tablet).
2. Tap `tile-fuchka` three times (£15.00 order).
3. Tap `pay-cash`, then tap `pay-card`.

**Expected** — `CLAUDE.md` → Cash counter 3: *"Cash or Card toggle. **Cash** shows quick tender buttons £5, £10, £20, £50 and 'Change to give'."* The quick tender buttons and the change readout belong to the cash path only; selecting Card must hide them. The data model backs this up: `tendered 2000 | null — cash only`.

**Actual** — With Card selected, `tender-500`, `tender-1000`, `tender-2000`, `tender-5000` remain visible and clickable:
`locator resolved to <button type="button" class="tender__btn" aria-pressed="false" data-testid="tender-2000">£20</button> — unexpected value "visible"`.
The stored `tendered` is correctly `null` on card orders, so this is presentation only, but it invites a volunteer to key a cash tender against a card sale.

**Test** `tests/e2e/cash.spec.js` → `C-07 cash and card toggle, quick tenders and change due`
**Screenshot** `test-results/cash-C-07-cash-and-card-toggle-quick-tenders-and-change-due-phone/test-failed-1.png` (and the `-tablet` variant)

---

### BUG-2 | blocker | Cash counter (`#/cash`), phone 390×844 | status: **verified** (round 2)

**Steps**
1. Load `#/cash` at 390×844.
2. Tap `tile-fuchka` three times (or any two different tiles).
3. Try to tap `line-inc-fuchka` on the Fuchka line.

**Expected** — `CLAUDE.md` → Cash counter 2: *"Order panel: name input, line items with − and + (each at least 52×52 px), line totals, big total."* The − and + controls must be tappable, and each element of the order panel must be readable. `CLAUDE.md` → Design: the phone layout has a *"sticky bottom order bar on cash"*, which must not cover the panel contents.

**Actual** — The whole order panel collapses on top of itself at 390 px: the Total row is drawn over the line items, the Cash/Card toggle is drawn over the second line item, the tender row is drawn under the Send button, and "Change to give" is pushed off the bottom. The + button cannot be tapped at all:
`<span class="total-row__value" data-testid="order-total">£15.00</span> from <div class="total-row">…</div> subtree intercepts pointer events` (29 retries, then timeout).
The buttons themselves measure 52×52 px, so this is stacking/height in the phone sticky sheet, not control size. The tablet layout is correct.

Raised to **blocker**: on a phone till a volunteer cannot correct a line quantity and cannot read the total reliably.

**Test** `tests/e2e/cash.spec.js` → `C-05 the minus and plus buttons are at least 52px and adjust the line`
**Screenshots**
- `qa/screenshots/phone-cash-orders.png` (shows the overlap clearly)
- `test-results/cash-C-05-the-minus-and-pl-0dc9d-st-52px-and-adjust-the-line-phone/test-failed-1.png`
- Compare with the correct tablet layout: `qa/screenshots/tablet-cash-orders.png`

---

### BUG-3 | major | Cash counter (`#/cash`) recent strip | status: **verified** (round 2)

**Steps**
1. Seed the scripted report day (one order still `new`).
2. Load `#/cash` and measure every visible control.

**Expected** — `CLAUDE.md` → Design: *"Touch targets at least 48 px."*

**Actual** — `button[cancel-A-005] = 40px`. The Cancel button in the recent-orders strip is 40 px tall.

**Test** `tests/e2e/crosscutting.spec.js` → `X-02 every visible control is at least 48px tall`
**Screenshot** `test-results/crosscutting-X-02-every-vi-5d49b-ntrol-is-at-least-48px-tall-phone/test-failed-1.png`

**Note** — seen once while Neo was still editing `public/`, then not reproducible for the rest of round 1. Round 2 confirms it independently: `.recent__cancel` measures **79.9 × 48 px** at 390, 1280 and 360 px wide. Closed as verified.

---

## Tests corrected against the brief (no app change required)

Per `CLAUDE.md` → Workflow 3 (*"If a test is wrong against the brief, Morpheus fixes the test and notes it"*):

| Test | Problem | Correction |
|---|---|---|
| `helpers.openApp` (affected `C-14`, `L-04`) | The init script cleared `localStorage` on **every** page load, including `page.reload()`, so the order sequence and the till letter could never survive a reload. That is the harness, not the app. | Clear once per tab, guarded by a `sessionStorage` sentinel. |
| `O-03` offline reload | Asserted that `page.reload()` works with `context.setOffline(true)`. Playwright's offline mode blocks the HTTP fetch of `index.html` itself, and the brief requires `persistentLocalCache` for offline *data*, not a service worker for offline *document* loads. | Rewritten to navigate within the SPA while offline and assert the menu still renders from the local cache. |
| `X-05` breakpoint | Asserted `col-new` has count 0 on phone. The brief asks for "tabs on kitchen" below 700 px; keeping the three column elements in the DOM and showing one at a time satisfies that. | Now asserts the three tabs are present and at most one column is visible. |
| `R-02`…`R-06`, `R-09` | Read KPI, peak-slot and pay-split text immediately after the element became visible, i.e. before the Firestore snapshot had landed, so the empty-state text ("No orders yet", "£0.00") was sampled. | Replaced flat waits with `expect.poll` on the rendered value. |
| `R-09` | Compared against a literal `£60.00` after a date round trip; a stray order left behind by a previous test's in-flight write made it `£75.00`. | Captures the loaded value first and asserts the round trip returns to it; `clearFirestore` now sweeps twice and `seedReportDay` verifies the emulator holds exactly the six fixture orders. |
| `C-01`, `C-05` size checks | `boundingBox()` returned `null` (reported as 0 px) when the cash screen re-rendered on a Firestore snapshot between the visibility check and the measurement. | `heightOf`/`boxOf` now retry for up to 1.8 s. |

## Round 2 — 2026-10-17 (after Neo's CSS fix)

Neo changed `public/css/app.css` only.

**Result: the suite is green.** unit **85/85 pass**; e2e **116 active tests — 116 pass, 0 fail**, 6 live-smoke skipped by design (the site is not deployed yet).

| Project | Tests run | Passed | Failed |
|---|---|---|---|
| phone 390×844 | 58 | 58 | 0 |
| tablet 1280×800 | 58 | 58 | 0 |
| (live smoke, both) | 6 | — | skipped |

### Independent verification of the fixes

Neo's hand-back was not taken on trust. A separate measurement sweep (outside the Playwright suite) enumerated every visible `button`, `a[href]`, `input`, `select`, `[role=button]`, `[role=tab]` and `label[for]` on all four routes, at **390 × 844**, **1280 × 800** and **360 × 740**, with an order already sent so the recent strip and its Cancel button were on screen, and a two-line order in the panel so the sheet was at its busiest.

Nothing interactive measured under 48 px at any of the three widths. The only elements below 48 px were `<label>` captions (`Name to call out` 23.2 px, `Day` 24.6 px, and a 1 × 1 visually-hidden `Till` label in the phone header). Those are text captions sitting above their controls, not touch targets; the controls they label are 52–64 px.

Key measurements, all three widths:

| Control | phone 390 | tablet 1280 | narrow 360 | Requirement |
|---|---|---|---|---|
| `send-order` | 358 × **72** | 332 × **84** | 328 × **72** | ≥ 72 px (Cash 4) |
| `cancel-A-001` | 79.9 × **48** | 79.9 × **48** | 79.9 × **48** | ≥ 48 px (Design) |
| `line-inc-fuchka` / `line-dec-fuchka` | **52 × 52** | **52 × 52** | **52 × 52** | ≥ 52 × 52 px (Cash 2) |
| `pay-cash` / `pay-card` | 173 × 64 | 160 × 64 | 158 × 64 | ≥ 48 px |
| `tender-2000` | 83.5 × 56 | 75.6 × 56 | 76 × 56 | ≥ 48 px |
| `customer-name` | 358 × 52 | 332 × 64 | 328 × 52 | ≥ 48 px |

Hit test on the Fuchka `+` button (`document.elementFromPoint` at the button's centre) returns the button itself at all three widths — **"OK (button receives the tap)"**, where round 1 returned `COVERED by span[order-total]`. BUG-2 is genuinely fixed, not merely passing on a timing change.

With Card selected, `tender-*` and `change-due` are both `display: none` at all three widths. BUG-1 fixed.

### Note on the de-stickied Send button

Neo flagged that Send is no longer `position: sticky` on phone, in case a test depended on it. **No test did.** The brief only requires Send to be ≥ 72 px and disabled when empty (`CLAUDE.md` → Cash 4), which is what `C-08` asserts; Playwright scrolls an element into view before clicking, so `placeOrder` is unaffected. No test change was needed.

One screenshot change was needed, though: the panel now scrolls inside its own bounds, so a `fullPage` capture was clipping whichever part of the sheet had been scrolled past. `helpers.shot()` now resets `window.scrollTo(0, 0)` and every inner scroller to the top before capturing, so `qa/screenshots/phone-cash-orders.png` shows the sheet from the toast down. That is screenshot fidelity for the handover, not a test assertion.

## Final status of every bug (Phase I)

| Id | Severity | Screen | Status |
|---|---|---|---|
| BUG-1 | minor | `#/cash` | **verified** — tender buttons and change readout hidden on Card |
| BUG-2 | blocker | `#/cash` phone | **verified** — panel rows no longer squashed; `+`/`−` receive taps |
| BUG-3 | major | `#/cash` recent strip | **verified** — Cancel is 48 px at 390, 1280 and 360 |

**Open bugs: none.** blocker 0 · major 0 · minor 0.

## Not automated (recorded, not a bug)

- **Food counter 6** — the audible Web Audio beep and `navigator.wakeLock` cannot be verified in headless Chromium. The suite checks only that the sound toggle exists in the header (`K-11`).

## Round 3 — live smoke, 2026-10-17

Run against `https://nottinghambengaliassociation.github.io/nba-food-stall-app/` (HTTP 200, real Firebase config served, `PASTE_` placeholder count = 0).

Command: `LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js` — **5 passed, 1 skipped by design, 0 failed.**

| Check | phone | tablet | Result |
|---|---|---|---|
| S-01 `#/` loads | pass | pass | header renders |
| S-01 `#/cash` loads | pass | pass | tiles render from the live menu |
| S-01 `#/kitchen` loads | pass | pass | board renders |
| S-01 `#/reports` loads | pass | pass | KPIs render |
| S-01 console errors | **0** | **0** | nothing ignored either — the raw capture was empty |
| S-02 "Storage not configured" banner | absent | absent | deployed config is wired up |
| S-02 connection pill | `Online · synced` | `Online · synced` | pass |
| S-03 QA-SMOKE round trip | skipped | **pass** | writes run once, not once per viewport |

### S-03 detail

The order-placing test is deliberately gated to one viewport (`tablet`) so the live smoke leaves two documents behind rather than four.

- `A-001` · name `QA-SMOKE` · card · £5.00 · placed at the till → appeared on the live kitchen → **Start → Ready → Collected** → left the board. Final status `collected`.
- `A-002` · name `QA-SMOKE` · card · £5.00 · placed, then **cancelled** from the recent strip while `new`. Final status `cancelled`.
- Live `#/reports` for the day then read: **orders 1, sales £5.00**, tile subtitle "excludes 1 cancelled". The cancelled order is correctly excluded.

Verified independently of the test, by a read-only REST query against the live project:

| docId | orderNo | name | status | day | till | total | payment |
|---|---|---|---|---|---|---|---|
| `rBed5Z0VLcKPHzJ53Sxc` | `A-001` | QA-SMOKE | `collected` | `2026-10-17` | A | 500 | card |
| `9OmbVmAbZ4I9hCk3KDGf` | `A-002` | QA-SMOKE | `cancelled` | `2026-10-17` | A | 500 | card |

Timestamp fields were checked on both documents and behave per the data model: unset stages are written as `null`, and each stamp is filled only at its transition. `A-001` carries `createdAtMs`, `startedAtMs`, `readyAtMs`, `collectedAtMs` with `cancelledAtMs: null`; `A-002` carries `createdAtMs`, `cancelledAtMs` with the other three `null`. No bug.

### The live menu seed was triggered by this run

Before the smoke run, a read-only probe showed the live project held **0 `menu` documents and 0 `orders`** — completely empty. Loading `#/cash` therefore fired the first-load seed, which wrote the six menu documents. Verified afterwards:

| id | price | station | colour |
|---|---|---|---|
| fuchka | 500 | chaat | #FDE68A |
| momo | 500 | momo | #BFDBFE |
| chat | 500 | chaat | #FECACA |
| samosa | 500 | sweets | #FED7AA |
| straw | 500 | sweets | #E9D5FF |
| fountain | 500 | sweets | #E7D3BF |

All six match the menu table in `CLAUDE.md`, all at 500 pence, `sort` 1–6. **This matters for the handover:** the live menu now exists and will not be re-seeded (seeding only runs when `menu` is empty), so prices can be edited in the Firebase console from here on, and the organisers will not see a seed happen on the day.

### QA data left in the live project — needs cleanup

**Yes, two documents need removing before the event**, and I did not remove them (deleting from the real project is Trinity's, per `CLAUDE.md` → Rules).

- Collection `orders`, day `2026-10-17`: `A-001` and `A-002`, both named exactly `QA-SMOKE`.
- Document ids: `rBed5Z0VLcKPHzJ53Sxc` and `9OmbVmAbZ4I9hCk3KDGf`.
- They are identifiable by `name == "QA-SMOKE"`.

If the event is on a different London date these two are harmless — reports query `where("day","==",day)`, so they will never appear in the event day's figures. They only matter if someone opens reports for `2026-10-17`. The **six `menu` documents must be kept**; only the two orders are test data.

One further note for the handover: the smoke run consumed `A-001` and `A-002` from the till-A sequence, but that sequence lives in `localStorage` on the device that placed them (this CI browser context, now discarded). Volunteers' tablets start from `A-001` on the day regardless, so nothing needs resetting.

### Live screenshots

14 files written to `qa/screenshots/`:

- `live-phone-landing.png`, `live-phone-cash.png`, `live-phone-kitchen.png`, `live-phone-reports.png`
- `live-tablet-landing.png`, `live-tablet-cash.png`, `live-tablet-kitchen.png`, `live-tablet-reports.png`
- `live-phone-cash-pill.png`, `live-tablet-cash-pill.png` (connection pill evidence)
- `live-cash-qa-smoke-sent.png`, `live-kitchen-qa-smoke.png`, `live-cash-qa-smoke-cancelled.png`, `live-reports-qa-smoke.png` (the QA-SMOKE round trip)

A plain-text run log is at `qa/live-smoke-record.txt`.

## Final state

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest) | 85 | 0 | 0 |
| e2e phone 390×844 | 58 | 0 | — |
| e2e tablet 1280×800 | 58 | 0 | — |
| live smoke | 5 | 0 | 1 (by design) |

**Open bugs: none.** blocker 0 · major 0 · minor 0. BUG-1, BUG-2 and BUG-3 all verified fixed.

---

## Round 3 — Phase II, 2026-10-18

Phase II features under test: **A** login / session / sign out (`G-01`…`G-20`), **B** Cash received (optional) (`T-01`…`T-13`), plus the Phase I suite re-run with login gating every route.

Clean full run, nothing else on the machine (`npm run test:unit`, then `npm run test:e2e`):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest, 7 files) | 116 | 0 | 0 |
| e2e phone 390×844 | 88 | 0 | 4 (3 live-smoke + `T-08`, tablet-only by design) |
| e2e tablet 1280×800 | 89 | 0 | 3 (live-smoke) |
| **e2e total** | **177** | **0** | **7** |

Zero flaky tests in the clean run. Live smoke is deliberately not run this round: Phase II is not deployed yet.

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### BUG-4 | major | Cash counter (`#/cash`), cash received | status: **verified**

**Steps**
1. `#/cash`, add 1 × Momo (£5.00), Cash selected.
2. Tap the **£20** quick button — "Change to give: £15.00" appears.
3. Tap **−** on the Momo line so the panel is empty.
4. Add 1 × Momo again, starting a fresh order.

**Expected** — `CLAUDE.md` → Cash counter 3: *"Switching to Card, sending, or **clearing the order** resets it."* Emptying the panel clears the order, so the next order must start with no quick button selected and no message.

**Actual** (first run of round 3) — the £20 selection survived, and the new £5.00 order opened showing **"Change to give: £15.00"**. A volunteer could hand back £15 against a £5 order that no one had tendered for.

**Test** `tests/e2e/tender.spec.js` → `T-09 it resets on Card, on send and on clearing the order`, part (d)
**Screenshot** `test-results/tender-T-09-…-tablet/test-failed-1.png` (transient; the fixed state is in `qa/screenshots/tablet-cash-tender.png`)
**Fix** Neo reset the cash-received state whenever the panel empties. Re-verified on phone and tablet in the clean run.

### BUG-5 | major | Cash counter (`#/cash`), stored order | status: **withdrawn (requirement change)**

Raised when a short amount (`10` on a £15.00 order) was stored as `tendered: null`, losing the figure. The user's requirement change of 2026-10-18 retired the question entirely: **Cash received is purely an on-screen calculator and nothing about it is persisted.** There is no stored tender to be wrong about. The tests were rewritten to assert the opposite — that an order document contains neither `tendered` nor `changeGiven` — and they pass. No action for Neo.

### Not bugs — confirmed against the brief

- **Sign out is 44 × 44 below 700 px.** `CLAUDE.md` → Login 7 specifies "icon-only 44×44 button", which is under the general 48 px rule in Design. `X-02` now exempts Sign out at phone width only; at 700 px and wider the 48 px floor still applies, and it is met.
- **No dark header on `#/login`.** Both login mock-ups are a plain centred card. `#/login` is not in the `X-04` dark-header route list.
- **Quick cash buttons at 44 px on phone / 54 px on tablet.** Explicit minimums in Cash 3, so also exempted from the 48 px floor in `X-02`.
- **Two `<h1>`s on the login screen** (the screen-title in the header plus the "Nottingham Bengali Association" card heading). Not a violation of anything in the brief, and axe reports no serious or critical issue on `#/login`.

### Test-side changes this round (not Neo's code)

1. `tests/e2e/session.js` (new) — a shared Playwright `test` that seeds `localStorage["nba.session"]` in the default context *and* in every `browser.newContext()`, so the Phase I suites run signed in. Every existing spec now imports `test`/`expect` from it. Login behaviour itself is exercised only by `tests/e2e/login.spec.js`, which uses the ungated base `test`.
2. `tests/e2e/creds.js` (new) — reads `APP_LOGIN_USER` / `APP_LOGIN_PASSWORD` from the gitignored `.secrets/app-login.env` at run time. No credential is written into any test, fixture, screenshot or log; failed logins use an obviously fake password; the `G-08` failure screenshot was dropped because it captured the real username, and `G-20` captures the same state with a made-up one.
3. `tests/unit/secrets.test.js` → `U-25` now also fails if either credential appears in a tracked file, and asserts `.secrets/` and `public/js/login-config.js` are untracked.
4. CSV expectations (`U-20`, `U-28`, `R-07`) and the order-shape checks (`C-05`, `C-06`, `D-01`) were updated to the 2026-10-18 requirement change: thirteen CSV columns, no `tendered`/`changeGiven` on the document.
5. `playwright.config.js` — `retries: 1` locally as well as in CI. The Firestore emulator is shared with whoever else is running the suite on this machine and can restart mid-run; the retry keeps a 12-minute suite from being written off by someone else's `emulators:exec`. The final numbers above come from a clean run with zero retries used.

---

## Round 4 — Hotfix H1 (split menu items), 2026-10-19

Under test: `CLAUDE.md` → "Menu" (the ten-row table) and "Hotfix H1: split menu items (18 Oct 2026)" 1–6. Plan: `qa/test-plan.md` sections 20–23 (`H-*`), written from the brief before reading Neo's code. **Phase III (`#/reports/days`) is deliberately out of scope this round.**

Clean full run with nothing else on the machine — no other Playwright process, no other Firestore emulator on 8080 (`npm run test:unit`, then `npm run test:e2e`):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest, 8 files) | 166 | 0 | 0 |
| e2e phone 390×844 | 99 | 0 | 14 (13 live-gated + `T-08`, tablet-only by design) |
| e2e tablet 1280×800 | 100 | 0 | 13 (live-gated) |
| **e2e total** | **199** | **0** | **27** |

Zero flaky tests, zero retries used. New this round: 50 unit cases (`tests/unit/menu.test.js`) and 22 e2e cases (`tests/e2e/menu-h1.spec.js`, 11 per viewport).

The 27 skips are the gated live specs — 16 `S-*` (`LIVE_SMOKE=1`) and 10 `H-20.*` (`LIVE_H1=1`) — plus the tablet-only `T-08`. H1 is not deployed, so neither live spec is run.

**Open bugs: none.** blocker 0 · major 0 · minor 0. No `BUG-*` was raised this round: every H1 case passed against Neo's implementation first time.

### The two highest-risk cases, confirmed

**1. Eighth tile at 390×844 is not covered by the sticky order bar** — `H-09`, both viewports.
Not a visibility check: with an order in the panel (bar at its tallest) each of the eight tiles is scrolled into its own tile area and `document.elementFromPoint` is read at the tile's exact centre. The element returned must be the tile or a descendant for all eight; the assertion message names the covering element so a failure would say what covered it. The eighth tile (`fountain`) is then clicked **by coordinate** with `page.mouse.click` and `qty-fountain` must read 1 — a tap that lands on the bar would not move the badge. This is the Phase I `BUG-2` failure mode, where a passing visibility assertion hid a covered control, so visibility alone is not accepted as evidence. Measured geometry on phone: the tile area is its own scroller ending at y≈338 and the order panel starts at y≈338, so there is no overlap at any scroll position. `H-10` adds: no horizontal scroll at 360×740 on any of the four routes with a full cart, and no tile spilling past the right edge.

**2. Orders holding the retired ids still render, report and export under their ORIGINAL names** — `H-05`, `H-06`, `H-11`, `H-12`, `H-13`, `H-15`, both viewports.
Fixtures are shaped exactly like the live 17 Oct documents (`{id:'samosa', name:'Sweets Box Samosa / Shingara'}`, `{id:'straw', name:'Chocolate Strawberry & Marshmallow (V)'}`), seeded straight into the emulator and never touched by the UI.

- **Kitchen** (`H-11`): the card renders, both lines keep their original names, each line carries an inline SVG (the retained `samosa` and `straw` icons), no "unknown"/"undefined" text, and Start → Ready → Collected still works on it. Screenshots `qa/screenshots/<project>-kitchen-legacy.png`.
- **Reports** (`H-12`): `item-row-samosa` "Sweets Box Samosa / Shingara" 2 × £10.00 and `item-row-samosa_only` "Samosa" 3 × £15.00 are **separate rows**; likewise `item-row-straw` and `item-row-choc_strawberry`. Nothing is merged or relabelled. Screenshots `qa/screenshots/<project>-reports-mixed.png`.
- **CSV** (`H-13`): the thirteen-column export carries `Sweets Box Samosa / Shingara` and `Chocolate Strawberry & Marshmallow (V)` verbatim alongside the new names, one row per line.
- **A legacy line with no stored `name`** (`H-05`) falls back to the retired `MENU` row and still reads "Chocolate Strawberry & Marshmallow (V)" — this is why the two retired rows must stay in the seed.
- **Nothing is migrated** (`H-15`): the stored `items` array is byte-identical before and after `#/kitchen`, `#/reports` and `#/cash` have all been opened and left running; status is untouched.
- `stationOf` (`H-03`) resolves all four new ids **and** both retired ids to `sweets` — it neither throws nor falls through to a default — and `H-16` proves the station filter greys a retired-id line exactly like a new sweets line, never hiding it.

### Menu and icon coverage

- `H-01` asserts `MENU` field for field against the brief's ten-row table (id, name, short, price, colour, station, active, sort) with one `it()` per row, plus unique ids ("Never reuse a retired id").
- `H-02`: exactly eight active rows, sorts 1–8 with no gaps, in the order `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain`; `samosa` 90 and `straw` 91 inactive; `ACTIVE_MENU` holds the eight and neither retired id.
- `H-04`: every one of the ten ids returns an inline SVG whose body differs from the `unknown` fallback — so the four new icons exist *and* `samosa`/`straw` are still there for old orders — all `aria-hidden`, stroke-only, no emoji code point.
- `H-07` (e2e): a fresh emulator seeds ten `menu/{id}` documents matching the same table, `active:false` on the two retired rows, and a second load does not duplicate them.
- `H-08`: the till renders exactly eight tiles in sort order; `tile-samosa` and `tile-straw` do not exist.
- `H-14`: an order built from the four new tiles is written with ids `sweet_box, samosa_only, choc_strawberry, marshmallow`, the new names and `price: 500`, and never a retired id.
- `H-17`: axe reports zero serious/critical violations on the eight-tile till; `send-order` ≥ 72 px and `line-inc-*`/`line-dec-*` ≥ 52 px are unchanged by the extra tiles.

### Contamination during the round (not bugs, not logged as such)

Three earlier full runs this round showed 5–11 failures each. Every one was environmental, not behavioural: Neo and Trinity were driving the **same** Firestore emulator on 8080 and the same `test-results/` directory at the same time. The signatures were unmistakable — `ENOENT … test-results/.playwright-artifacts-*` (another run clearing the output directory mid-test), a strict-mode violation on two `order-card-A-001` elements, an order document named `A-900 / "Legacy Lil"` that exists in no test in this repository, and seeded orders disappearing mid-test from another run's `DELETE …/documents`. Every one of those cases passed in isolation and in the clean run above. Per the Phase II lesson, none was written up as a bug. `npm run test:e2e` has no port guard, so two agents running it concurrently will always collide; that is noted for Trinity as a tooling gap, not an app defect.

### Test-side changes this round (not Neo's code, no app change required)

1. **Six-tile assertions updated to eight.** `C-01` now expects the eight active tiles in sort order and asserts `tile-samosa`/`tile-straw` are absent; `C-02` expects ten seeded `menu` documents (eight active, two retired with `active:false`, active sorts 1–8); `X-06`'s icon list is the eight active ids; `screenshots.spec.js` taps `tile-choc_strawberry` instead of the retired `tile-straw`. This is the hotfix landing, not a defect.
2. **`live-smoke.spec.js` S-08** now expects the ten live `menu` documents instead of six, and states why the two retired ids are never deleted.
3. **Phase I fixtures keep `samosa`** (`tests/unit/fixtures.js`, `reportFixture()` in `helpers.js`). They were left exactly as they were on purpose: they are now backwards-compatibility fixtures and exercise the retired-id path in `U-12`, `U-15`, `R-03` and `R-07` for free.
4. **H1 e2e fixtures use distinct order numbers** (`A-017`, `A-018`, `A-019`) and are looked up by `orderNo` rather than by collection index, so a legacy fixture can never be confused with an order the UI places (which always starts at `A-001`). This was hardened after the cross-run contamination above surfaced the fragility.
5. **`tests/e2e/live-h1.spec.js` (new, gated and read-only).** `H-20.1`…`H-20.5`: routes load clean, the live `menu` holds the ten H1 documents, the live till shows the eight tiles (and on phone the eighth is not covered), and the last trading day's takings and legacy item names are unchanged from the pre-deploy figures. It is skipped unless `LIVE_H1=1` and **has not been run** — H1 is not deployed. It performs GETs only: no order placed, no status changed, nothing cancelled, no menu document written. Apart from Trinity's single `scripts/menu-sync.mjs` run, nothing in this hotfix may write to live Firestore. Credentials are read at run time from the gitignored `.secrets/app-login.env`; the Show/Hide toggle is never pressed, so the password stays masked in every screenshot.

### Screenshots

All 28 emulator screenshots regenerated in the clean run, both viewports:
`<project>-{landing,cash,kitchen,reports}-{empty,orders}.png`, `<project>-login-{empty,error}.png`, `<project>-cash-{tender,confirm}.png`, plus the two new H1 captures `<project>-kitchen-legacy.png` (a card whose lines are `samosa` and `straw`) and `<project>-reports-mixed.png` (old and new item rows side by side). The 22 `live-*.png` are from the Phase II smoke and are deliberately **not** refreshed: H1 is not deployed yet.

### Final status of every bug after round 4

| id | severity | screen | status |
|---|---|---|---|
| BUG-1 | minor | `#/cash` | verified |
| BUG-2 | blocker | `#/cash` phone | verified — re-proved this round by `H-09` with eight tiles |
| BUG-3 | major | `#/cash` recent strip | verified |
| BUG-4 | major | `#/cash` cash received | verified |
| BUG-5 | major | `#/cash` stored order | withdrawn (requirement change) |

**No new bugs in round 4.**

Round 5 (live) added none either: see below.

---

## Round 5 — H1 live verification (read-only), 2026-10-19

Deploy under test: commit `21e45ff`, Pages run `39177899282`, `LIVE_URL` = https://nottinghambengaliassociation.github.io/nba-food-stall-app/ — after Trinity's single `menu-sync` run.

Command: `LIVE_H1=1 npx playwright test tests/e2e/live-h1.spec.js`. Evidence: `qa/screenshots/live-h1-*.png` (16 files) and `qa/live-smoke-record.txt`.

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| live phone 390×844 (`H-20.0`…`H-20.6`) | 7 | 0 | 0 |
| live tablet 1280×800 (`H-20.0`…`H-20.6`) | 7 | 0 | 0 |
| **live total** | **14** | **0** | **0** |

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### Pass/fail per check requested

| Check | Phone | Tablet | Evidence |
|---|---|---|---|
| Exactly eight tiles, in sort order, neither retired item shown | **PASS** | **PASS** | `[fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain]`; `tile-samosa`/`tile-straw` absent. `live-h1-<p>-cash-eight-tiles.png` |
| Eighth tile reachable and tappable with the order bar at its tallest | **PASS** | **PASS** | All eight answer `elementFromPoint` at their own centre; coordinate click on `tile-fountain` moved `qty-fountain` 0 → 1. `live-h1-<p>-cash-eighth-tile-tapped.png` |
| `#/reports` for 2026-10-18 shows the legacy items under their original names | **PASS** | **PASS** | `item-row-samosa` "Sweets Box Samosa / Shingara" ×2, `item-row-straw` "Chocolate Strawberry & Marshmallow (V)" ×3, `item-row-chat` "Papri Chat" ×1. KPIs £30.00 / 3 orders / 6 items match the live documents exactly. `live-h1-<p>-reports-2026-10-18.png` |
| CSV for that day carries the original names | **PASS** | **PASS** | 4 rows, 13 columns: `Papri Chat \| Sweets Box Samosa / Shingara \| Sweets Box Samosa / Shingara \| Chocolate Strawberry & Marshmallow (V)` |
| No console errors on any route, pill Online, login works | **PASS** | **PASS** | 0 console errors across `#/`, `#/cash`, `#/kitchen`, `#/reports`; pill "Online · synced" on all four; shared account signs in and lands on `#/`; no "Storage not configured" and no "Login not configured" banner |
| Live menu is the ten H1 documents, eight active | **PASS** | **PASS** | ids, names, shorts, stations and active flags all match the brief; active sorts exactly 1–8 |
| Nothing written to live Firestore | **PASS** | **PASS** | `orders` 3 → 3, byte-identical fingerprint (ids, names, quantities, status, totals); `menu` 10 → 10 |

### Difference from the brief found live (reported, not a failure)

Retired `menu/samosa` has `sort: 4` and `menu/straw` has `sort: 5`; the `CLAUDE.md` Menu table gives them 90 and 91. This is **correct behaviour**: `CLAUDE.md` → H1 4 tells `menu-sync` to "never overwrite a field that already has a different value … report differences instead", and both documents predate the hotfix. Both rows are `active: false`, so they are never tiles, and the reports group by id, not by sort — there is no functional effect. `H-20.2` therefore asserts name/short/station/active hard for all ten and the sort hard for the eight active rows only, and records the retired rows' sort as a difference. **For Trinity**, not for Neo.

### Differences from the emulator results

None of substance. The live run reproduced every emulator finding: eight tiles in the same order, the eighth tile tappable with the bar at full height, legacy ids reporting and exporting under their original names, and no migration of old documents. Two environmental notes:

1. The emulator seeds the retired rows with sorts 90/91 (matching the brief); live kept the pre-hotfix 4/5, as above. The emulator case `H-07` keeps asserting 90/91 because a fresh seed must follow the brief.
2. The live day under test (2026-10-18, 3 orders, £30.00) is real trading data rather than the synthetic mixed day used by `H-12`; both exercise the same path. Live has no order containing a *new* id yet, so the "old and new side by side" assertion only exists in the emulator case — placing a live order to create one would be a write, so it was **not** done.

### Test-side correction during this round (no app change)

`H-20.3`'s "nothing was sent" guard first asserted `order-toast` had **zero** nodes. That was wrong: the deployed `cash.js` builds the toast `<div>` once at screen construction and only shows/hides it (`public/js/cash.js`, `testid: 'order-toast'`), so its node count is always 1. The guard now asserts the toast is **not visible** and holds no order number, and then re-reads live Firestore to confirm the orders collection is unchanged — a direct check rather than a proxy. Live Firestore was independently queried the moment the guard tripped and held exactly the same 3 documents, all created 2026-10-18T16:55–16:59Z, so **no order was ever written**; the failure was in the assertion, not in the app or in the write discipline.

Tapping a tile is local state only — an order reaches Firestore solely through `send-order`, which this spec never clicks — and the panel is cleared again afterwards.

### Credential hygiene

Username and password were read at run time from the gitignored `.secrets/app-login.env`. The Show/Hide toggle is never pressed, so the password field is masked in every capture; the login screenshots are taken before the fields are filled. `qa/live-smoke-record.txt`, `qa/bugs.md`, `qa/test-plan.md` and all three new test files were re-scanned for the literal username, the literal password, `AIza[0-9A-Za-z_-]{35}` and `"private_key"`: **zero hits** (the three `AIza…` strings in `qa/test-plan.md` are the regex pattern quoted in prose, which `U-24`/`U-25` already tolerate).

---

## Round H2 — cart line alignment (19 Oct 2026)

Scope: `CLAUDE.md` → "Hotfix H2: cart line alignment (19 Oct 2026)" only. Phase III (Sales by day) remains deferred and untested.

**No `BUG-*` was raised this round.** The fix already in the working tree (`public/css/app.css`: `.line` as a grid of `minmax(0, 1fr) 52px 28px 52px 58px` with `column-gap: 6px`, `.line__name` 18 px wrapping, tabular numbers on `.line__qty` and `.line__amount`) passed every new assertion first time, on both viewports and at 360 px.

### New cases

`tests/e2e/cart-align-h2.spec.js` — `H-21`, `H-21.2`, `H-21.3`, both projects. Plan: `qa/test-plan.md` section 24.
`tests/e2e/live-h2.spec.js` — `H-22.0`…`H-22.3`, gated on `LIVE_H2=1`, **read-only with zero live writes**. Plan: section 25. Not run yet; run after the deploy.

The alignment assertions compare rows **against each other**, never against a hardcoded x, because the defect was a difference between rows.

### Measured geometry with all eight active items in the cart

Quantities 1…8. "Chocolate Strawberry" (longest active name) and "Momo" (shortest) are both present. All figures in CSS px.

**phone 390×844** — `.line` computed `display: grid`, `grid-template-columns: 144px 52px 28px 52px 58px`

| row | name | row.left | row.width | dec.left | inc.left | qty.left | amount.right | dec/inc size |
|---|---|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| momo | Momo | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| chat | Papri Chat | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| sweet_box | Sweet Box | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| samosa_only | Samosa | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| choc_strawberry | Chocolate Strawberry | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| marshmallow | Marshmallow (V) | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| fountain | Chocolate Fountain | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |

Spread across the eight rows: `dec.left` **0.00 px**, `inc.left` **0.00 px** (allowed ±1).

**tablet 1280×800** — `.line` computed `display: grid`, `grid-template-columns: 118.266px 52px 28px 52px 58px`

| row | name | row.left | row.width | dec.left | inc.left | qty.left | amount.right | dec/inc size |
|---|---|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| momo | Momo | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| chat | Papri Chat | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| sweet_box | Sweet Box | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| samosa_only | Samosa | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| choc_strawberry | Chocolate Strawberry | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| marshmallow | Marshmallow (V) | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| fountain | Chocolate Fountain | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |

Spread: `dec.left` **0.00 px**, `inc.left` **0.00 px**.

**360×740 (H-21.3)** — `dec.left` 136 and `inc.left` 228 on all eight rows, spread **0.00 px**; steppers 52×52; no horizontal scroll.

Overflow: every `.line__name` has `scrollWidth ≤ clientWidth` on all eight rows at all three widths; no name's right edge reaches its own `−` button; no row or line total passes the order panel's right edge. Steppers: 52×52 on every row, so the alignment was not bought by shrinking them.

`H-21.2`: stepping Momo out of the cart left `choc_strawberry`'s `dec.left` at 166 (phone) / 1024 (tablet) — unmoved — and a two-digit quantity on the longest line shifted neither column.

### Suite totals, one clean run (19 Oct 2026)

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (`vitest run`, 8 files) | 166 | 0 | 0 |
| e2e phone 390×844 | 102 | 0 | 20 |
| e2e tablet 1280×800 | 103 | 0 | 19 |
| **e2e total** | **205** | **0** | **39** |

Skips are the gated live specs (`live-smoke` 8, `live-h1` 7, `live-h2` 4 = 19 per project) plus `T-08` (the Clear link is tablet-only in the mock-ups), which is phone-only.

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### Screenshots

`qa/screenshots/phone-cash-cart-aligned.png` and `qa/screenshots/tablet-cash-cart-aligned.png` (eight-line cart). The standing `<project>-cash-empty.png` / `<project>-cash-orders.png` and every other screen were regenerated by the same run. `live-h2-cart-<project>.png` will be produced by the gated live check after the deploy.

### Test-side changes

None. No existing test needed updating for H2: the change is pure CSS and no assertion elsewhere depended on the flex layout. `H-17` already asserted `line-inc-*` / `line-dec-*` ≥ 52 px and still passes.

---

## Round H2 live — read-only check against the deployed site (19 Oct 2026)

Deploy under test: commit `bdf8954`, Pages run `39181519382`. `LIVE_H2=1 npx playwright test tests/e2e/live-h2.spec.js` against `https://nottinghambengaliassociation.github.io/nba-food-stall-app/`.

**8/8 passed** (`H-22.0`…`H-22.3` × phone 390×844 and tablet 1280×800). 0 failed, 0 skipped. **Open bugs: none.**

### How the cache was handled

The stylesheet is served with `cache-control: max-age=600`, so a context holding the pre-fix CSS could have measured the old layout against a correct origin. Three independent guards, all used:

1. **Fresh Playwright context per test** — no browser profile or cache is carried in from any earlier run.
2. **Browser HTTP cache switched off over CDP** — `Network.setCacheDisabled` before the first navigation. Logged per test: `HTTP cache disabled over CDP = true` on both viewports.
3. **Byte comparison on a cache-busted URL** (`H-22.2`) — `GET css/app.css?cb=<now>` straight to the origin: **29,794 bytes, SHA-256 `6dc050e2…ccfdff5b`**, identical to the committed `public/css/app.css` (same length, same digest). The served file contains `grid-template-columns: minmax(0, 1fr) 52px 28px 52px 58px` and zero occurrences of a `.line { … display: flex }` rule. Independently reproduced with `curl` outside Playwright, same digest.

**Not used: a `Cache-Control: no-cache` request header via `extraHTTPHeaders`.** First attempt did, and both `H-22.1` cases failed with the app stuck on "Loading…". That header is not CORS-safelisted, so Playwright attached it to the Firebase SDK's cross-origin module imports on `gstatic.com`, turning them into preflighted requests the CDN does not answer. **A test-harness fault, not an app or deploy fault** — no `BUG-*` raised. `Network.setCacheDisabled` does the same job at the network stack without touching request headers, and the spec now documents why the header must not be reintroduced.

### Pass/fail per check

| Check | Phone | Tablet | Evidence |
|---|---|---|---|
| Computed style on the live site is the five-track grid | **PASS** | **PASS** | `display: grid`; `grid-template-columns: 144px 52px 28px 52px 58px` (phone) / `118.266px 52px 28px 52px 58px` (tablet); `column-gap: 6px` |
| Served bytes are the committed stylesheet | **PASS** | **PASS** | cache-busted GET, SHA-256 `6dc050e2…ccfdff5b` = committed file; old flex rule absent |
| `line-dec-*` share one left x (±1 px) across all eight rows | **PASS** | **PASS** | 166 on all 8 (phone), 1024 on all 8 (tablet). Spread **0.00 px** |
| `line-inc-*` share one left x (±1 px) across all eight rows | **PASS** | **PASS** | 258 on all 8 (phone), 1116 on all 8 (tablet). Spread **0.00 px** |
| "Chocolate Strawberry" does not push its buttons past "Momo"'s | **PASS** | **PASS** | difference 0.00 px on both `dec` and `inc`, both viewports |
| No `.line__name` overflows its column | **PASS** | **PASS** | `scrollWidth ≤ clientWidth` on all 8 rows; no name reaches its own `−` |
| No row wider than the panel; no horizontal scroll | **PASS** | **PASS** | row 16/358 (phone), 899.73/332.27 (tablet) on every row; `scrollWidth ≤ clientWidth` on the document |
| Steppers still ≥ 52×52 | **PASS** | **PASS** | 52×52 on all 16 buttons, both viewports |
| No console errors, no "Storage not configured" | **PASS** | **PASS** | 0 console errors on `#/cash`; banner absent |
| Live data unchanged | **PASS** | **PASS** | `orders` 1 → 1 (`A-001/collected/2026-10-19`), byte-identical fingerprint; `menu` 10 → 10, all ten ids present |

### Measured x positions on the live site

**phone 390×844** — every one of the eight rows: `row.left` 16, `row.width` 358, `dec.left` **166**, `inc.left` **258**, `dec`/`inc` 52×52.
**tablet 1280×800** — every one of the eight rows: `row.left` 899.73, `row.width` 332.27, `dec.left` **1024**, `inc.left` **1116**, `dec`/`inc` 52×52.

Both spreads are exactly 0.00 px, and both match the emulator figures from the pre-deploy round to the pixel.

### Live data fingerprint

Before: 1 document, `A-001 / collected / 2026-10-19`. After: identical length and identical fingerprint (document id, orderNo, status, total, day and every line's `id|name|qty|price`). Menu: 10 documents before and after — `chat, choc_strawberry, fountain, fuchka, marshmallow, momo, samosa, samosa_only, straw, sweet_box`. **No order placed, nothing cancelled, no menu document touched. H2 made no live write of any kind** — every Firestore call in the spec is a GET, `send-order` was never clicked, and the panel was cleared with `order-toast` asserted hidden and holding no order number.

### Screenshots

- `qa/screenshots/live-h2-cart-phone.png` — the real 390×844 till with a full cart. The cart lines sit in an internal scroller inside the sticky bottom sheet, so one row is visible; that is the genuine phone rendering.
- `qa/screenshots/live-h2-cart-phone-all-lines.png` — the same live page at the **same 390 px width** on a taller viewport, where the sheet's line area grows to hold all eight rows. The grid is unchanged (`144px 52px 28px 52px 58px`) and the alignment is re-measured and re-asserted before the capture (`dec.left` 166, `inc.left` 258 on all eight), so the picture is verified rather than illustrative.
- `qa/screenshots/live-h2-cart-tablet.png` — all eight rows, steppers in one column, long names wrapping.

Credentials were read at run time from the gitignored `.secrets/app-login.env`. The Show/Hide toggle was never pressed and no capture includes the login form, so no password appears in any screenshot. `qa/live-smoke-record.txt` holds no credential and no API key.

---

## Round P3 — Phase III (Sales by day + app version), 2026-10-19

Suites on the first Phase III round (`npm test`, both viewport projects):

| Suite | Pass | Fail | Skipped |
|---|---|---|---|
| unit (`vitest`, 10 files) | **228** | 0 | 0 |
| e2e (`playwright`, phone + tablet) | **243** | **4** | 39 (live specs, gated off) |

Unit: 166 pre-existing, plus 56 new Phase III cases in `tests/unit/range.test.js` and 6 in `tests/unit/login-logic.test.js`.
E2E: 42 new Phase III tests (21 per project — 16 in `tests/e2e/reports-days.spec.js`, 5 in `tests/e2e/version.spec.js`); `#/reports/days` was also added to the cross-cutting route list in `crosscutting.spec.js` and to the route-guard list in `login.spec.js`.
**Phases I, II, H1 and H2 did not regress: every pre-existing case still passes, including `G-09` (ten wrong attempts then a correct sign-in) after Neo's `login.js` refactor onto `normaliseUser`/`sha256Hex`.**

All four failures are the same single defect, below:
`P3-16` (phone + tablet) and `X-07b` (phone + tablet, which now covers `#/reports/days`).

### BUG-6 | major | Sales by day (`#/reports/days`), Day by day table | status: **verified** (round P3b)

**Steps**
1. Seed a range of orders into the emulator and load `#/reports/days` (phone 390×844 and tablet 1280×800).
2. Run `@axe-core/playwright` `AxeBuilder({ page }).analyze()`.
3. Alternatively, read any "Open day" link's accessible name against its visible text.

**Expected** — `.claude/agents/morpheus.md` test plan item 11 and `qa/test-plan.md` X-07: *"`@axe-core/playwright` on every screen, zero serious or critical violations."* `CLAUDE.md` → Phase III 7 specifies the control's visible text (*"an 'Open day' button linking to `#/reports?day=YYYY-MM-DD`"*), and WCAG 2.1 SC 2.5.3 *Label in Name* (Level A) requires the visible label to be contained in the accessible name, so a speech-input user can say "Open day". An `aria-label` is allowed, but it must start from the visible words, e.g. `aria-label="Open day Tue 13 Oct"`.

**Actual** — every `open-day-<day>` link overrides its visible text with an unrelated accessible name:

```html
<a class="open-day" data-testid="open-day-2026-10-13" href="#/reports?day=2026-10-13"
   aria-label="Open the one day report for Tue 13 Oct">Open day</a>
```

axe reports one `label-content-name-mismatch` violation, impact **serious**, `wcag21a` / `wcag253`, with one node per trading day (5 nodes on the scripted fixture), on both viewports. A speech-input user saying "Open day" cannot activate the control.

Because `#/reports/days` is now in the cross-cutting route list, this also fails `X-07`/`X-07b` in `tests/e2e/crosscutting.spec.js` whenever that screen has trading days.

**Fix for Neo** — in `public/js/reports-days.js`, make the accessible name contain the visible text, e.g. `aria-label` = `Open day ${d.label}` (or drop the `aria-label` and append a visually-hidden span after "Open day"). No other change.

**Test** `tests/e2e/reports-days.spec.js` → `P3-16 axe finds no serious or critical violations on #/reports/days`, and `tests/e2e/crosscutting.spec.js` → `X-07b axe finds no serious or critical violations with orders present`
**Screenshot** `qa/screenshots/bug-6-open-day-label-in-name-phone.png`, `qa/screenshots/bug-6-open-day-label-in-name-tablet.png`

---

### Test-side corrections this round (no product defect)

1. `P3-09` expected 13 CSV rows for the scripted range; the fixture really holds **14** order lines (1+1 / 1+2 / 1+1 / 1+1+1 / 3+1). Arithmetic slip in the test, corrected. The unit case counts the lines from the fixture rather than from a literal, so it never had the error.
2. `P3-05` originally hovered one bar then tapped another while the mouse was still parked on the first. Playwright scrolls before tapping, which can re-fire `mouseenter` on the bar under the stationary pointer. The test now parks the pointer away from the chart between the hover, focus and tap steps. The product behaved correctly.
3. `V-02`/`V-05` seeded the session with `context.addInitScript` and then navigated by hash only. A `page.goto` that changes nothing but the fragment does **not** re-run init scripts, so the session never landed and the route guard bounced the test to `#/login` — correct app behaviour, wrong harness. The session is now written straight into `localStorage` before the hash change.

---

### BUG-7 | major | Sales by day (`#/reports/days`), the two wide table cards | status: **verified** (round P3b)

Raised retrospectively: this violation was **already in the round-P3 failure output** of `X-07b`, listed beneath `BUG-6` on the same screen, but was not written up separately. Neo found and fixed it in the same round while verifying `BUG-6`. It is recorded here so the fix has its own entry and its own regression guard.

**Steps**
1. Seed orders and load `#/reports/days` so the "Day by day" and "Items sold by day" cards hold more columns than fit.
2. Run `@axe-core/playwright`, or try to reach the off-screen columns with the keyboard alone.

**Expected** — `CLAUDE.md` → Phase III 7: *"Horizontal scroll inside the card on narrow screens."* A card that only a mouse or a finger can scroll hides the right-hand columns (Cash, Card, Avg order, Peak 30 min; the later trading days and the Total/Sales columns) from a keyboard user entirely, and from the stall lead using a tablet with a keyboard. `.claude/agents/morpheus.md` item 11 requires zero serious or critical axe violations.

**Actual (round P3)** — axe `scrollable-region-focusable`, impact **serious**:
`scrollable-region-focusable (serious): section[aria-label="Items by day"] > .table-wrap` — *"Scrollable region must have keyboard access"*. Both `.table-wrap` divs scrolled sideways with no `tabindex`, so neither could take focus.

**Fix (Neo, `public/js/reports-days.js` only)** — both `.table-wrap` divs now carry `tabindex="0" role="region"` with the distinct names "Day by day table" and "Items sold by day table"; the day `<section>`'s own `aria-label` changed from "Day by day table" to "Day by day" so the two landmark names stay unique.

**Checked against the brief** — the change is additive and contradicts nothing. `CLAUDE.md` Phase III 7 names the visible heading ("Day by day"), not the section's `aria-label`, and the mock-up `design/ReportsByDay.dc.html` wraps the table in a plain `overflow-x: auto` div with no name of its own — so renaming the section and naming the region takes nothing away from the brief or the mock-up. No assertion of mine depended on either `aria-label`: the tests address the tables through `days-table` and `items-by-day-table`, the rows through `day-row-<day>`, and the note through its visible text.

**How it was verified**
1. `P3-16` and `X-07`/`X-07b` (axe, both viewports, empty and with orders): zero serious or critical violations.
2. New regression guard `P3-17`, which does not rely on axe: every element in `main` that actually scrolls sideways (`scrollWidth > clientWidth`) must have `tabIndex >= 0` and a non-empty accessible name, the names must be distinct, and the card must take focus and actually scroll. Passes on phone and tablet.

**Test** `tests/e2e/reports-days.spec.js` → `P3-17`, plus `P3-16` and `tests/e2e/crosscutting.spec.js` → `X-07`/`X-07b`
**Screenshot** `qa/screenshots/phone-reports-days-orders.png`, `qa/screenshots/tablet-reports-days-orders.png` (recaptured after the fix)

---

## Round P3b — after Neo's accessibility fixes, 2026-10-19

Only `public/js/reports-days.js` changed. Full `npm test` rerun, unit and e2e, phone 390×844 and tablet 1280×800:

| Suite | Pass | Fail | Skipped |
|---|---|---|---|
| unit (`vitest`, 10 files) | **228** | **0** | 0 |
| e2e (`playwright`, phone + tablet) | **249** | **0** | 39 (live specs, gated off) |

`npm test` exits 0. The two tests that failed in round P3 (`P3-16` and `X-07b`, each on both viewports) now pass, and `P3-17` was added afterwards as a behavioural guard for both fixes — hence 249 rather than 247.

**No regression.** Every Phase I, Phase II, H1 and H2 case still passes, unchanged: the cash counter and cash-received suites, the kitchen flow, the one-day report and CSV, offline queueing, the two-till sequence, the H1 eight-tile menu and legacy-id compatibility, the H2 cart alignment, and the whole login suite including `G-09` (ten wrong attempts in a row, then a correct sign-in straight away) after Neo's refactor of `login.js` onto `normaliseUser`/`sha256Hex`.

Screenshots recaptured after the fix: `{phone,tablet}-reports-days-{orders,empty}.png`, `{phone,tablet}-login-version.png`, `{phone,tablet}-header-version.png`, and the whole pre-existing set regenerated by the usual `screenshots.spec.js` run.

### Bug status after this round

| Bug | Severity | Screen | Status |
|---|---|---|---|
| BUG-1 | minor | cash counter, card hides the tender buttons | verified |
| BUG-2 | blocker | cash counter phone, order bar covered a control | verified |
| BUG-3 | major | cash counter recent strip | verified |
| BUG-4 | major | cash received | verified |
| BUG-5 | major | stored order | withdrawn (requirement change) |
| BUG-6 | major | Sales by day, "Open day" accessible name | **verified** |
| BUG-7 | major | Sales by day, scrolling table cards had no keyboard access | **verified** |

**No open bugs.** Nothing in this round touched live Firestore; every write was to the emulator, and no `git`, `gh` or real-project `firebase` command was run.

---

## Round P3 live — read-only check against the deployed site (19 Oct 2026)

Run after the v1.2.0 deploy, commit `45340937b6d4e733cc9d35e8c3afe248b922881e` (short `4534093`), Pages run 39189833432.
Command: `LIVE_P3=1 LIVE_BUILD=4534093 npx playwright test tests/e2e/live-p3.spec.js`.
**20/20 passed, both viewports (phone 390×844 and tablet 1280×800). No bug raised.**

| Item | phone | tablet | Evidence |
|---|---|---|---|
| Every route loads, no console errors (`#/login`, `#/`, `#/cash`, `#/kitchen`, `#/reports`, `#/reports/days`) | **PASS** | **PASS** | 0 console errors signed out and signed in; no "Storage not configured" banner |
| Route guard signed out: all five guarded routes bounce to `#/login` | **PASS** | **PASS** | `P3L-01` |
| Sign in with the shared account; pill reads `Online · synced` | **PASS** | **PASS** | asserted on all five signed-in routes |
| **V-c:** `login-version` before sign-in | **PASS** | **PASS** | `Version 1.2.0 · build 4534093 · updated 19 Oct 2026` |
| **V-c:** `app-version` `v1.2.0` on all five screens, build `4534093`, no `-dirty` | **PASS** | **PASS** | title and `aria-label` identical on every route: `Version 1.2.0, build 4534093, updated 19 Oct 2026` |
| Outlined pill at tablet width (13 px bold, `#D6D3D1` on a 1 px `#57534E` border, fully rounded, right after the title) | n/a | **PASS** | computed style |
| 12 px bold line under the title on phone, header buttons still ≥ 44 px | **PASS** | n/a | computed style + header control heights |
| One day / Sales by day toggle, both ways, ≥ 48 px, current one filled ink | **PASS** | **PASS** | `P3L-04` |
| Default range: last 7 days ending today | **PASS** | **PASS** | `2026-10-13` → `2026-10-19` |
| Quick buttons Today and Last 7 days present | **PASS** | **PASS** | `P3L-05` |
| "This event" hidden because `settings/event` is absent | **PASS** | **PASS** | read `settings/event` → 404; button hidden; `CLAUDE.md` Phase III 2 |
| Tiles, chart, Day by day table, totals row, Items sold by day matrix | **PASS** | **PASS** | every figure recomputed from the live documents and compared |
| Open day → `#/reports?day=2026-10-19` with that date loaded and matching KPIs | **PASS** | **PASS** | `kpi-sales £40.00`, `kpi-orders 1` |
| "Open day" accessible name contains its visible text (BUG-6, live) | **PASS** | **PASS** | `P3L-06` |
| Range CSV: `nba-food-stall_2026-10-13_2026-10-19.csv`, 13 One day columns, no `tendered` | **PASS** | **PASS** | 8 data rows, every `lineTotal = qty × price`, every row inside the range, none cancelled |
| Sign out → `#/login`, session cleared, version line still on the card | **PASS** | **PASS** | `P3L-08` |
| **Nothing written to live Firestore** | **PASS** | **PASS** | `P3L-09` |

### The build string actually rendered

`Version 1.2.0 · build 4534093 · updated 19 Oct 2026` — on the login card before sign-in, on the login card after signing out, and behind the `v1.2.0` pill on all five signed-in headers, on both viewports. **It equals the pushed short SHA `4534093` exactly, with no `-dirty` suffix.** V-c passes. The browser HTTP cache was switched off over CDP before the first navigation and each test ran in a fresh context, so this is the origin's bytes, not a ten-minute-old copy.

### Live data seen

`orders` holds **one document**: `A-001`, `collected`, day `2026-10-19`, total £40.00, eight lines of one each at £5 (`fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain`), peak 30 min `01:00–01:30`.

That is the **same single document, byte-identical fingerprint, that the H2 live check recorded hours earlier** (`H-22.0 live orders before the check: 1 document(s) [A-001/collected/2026-10-19]`). So the stall has not traded on v1.2.0, and this is almost certainly the earlier QA smoke order rather than real service data. The range screen therefore showed one trading day rather than the "No sales in this range" state; that empty state is proved on the emulator instead (`P3-12`), and the live spec asserts it would render correctly if the range were empty.

`menu` holds its ten documents (`chat, choc_strawberry, fountain, fuchka, marshmallow, momo, samosa, samosa_only, straw, sweet_box`). `settings/event` does not exist.

### Write discipline

Every Firestore call in `tests/e2e/live-p3.spec.js` is a GET over the REST API. No till tile was tapped, `send-order` was never clicked, no status was changed, nothing was cancelled, and no menu or settings document was touched. `P3L-00` and `P3L-09` bracket the run: the orders collection is the same length with a byte-identical fingerprint, the menu still holds ten documents, and `settings/event` is still absent. Exporting the CSV is a download of data already fetched, not a write.

Credentials were read at run time from the gitignored `.secrets/app-login.env`. The Show/Hide toggle was never pressed, so the password field is masked in every capture; no screenshot, log line or entry in `qa/live-smoke-record.txt` contains the username, the password or the web API key.

### Screenshots

`qa/screenshots/live-p3-<project>-<screen>.png` for `project` ∈ {phone, tablet}:
`login-version`, `landing`, `cash`, `kitchen`, `reports`, `reports-days`, `reports-open-day`, `header-version`, `signed-out` — 18 files.

### Needs you

1. **`orders` still holds the QA smoke order `A-001` (2026-10-19, £40.00, collected).** It will appear in the one-day report for 19 Oct and in any range covering it, so the first real day's takings would be £40.00 over by eight items. QA is read-only and did not delete it: someone should remove that document in the Firebase console before trading, or accept and subtract it.
2. **`settings/event` does not exist**, so the "This event" quick range is hidden — correct per `CLAUDE.md` Phase III 2, but it means organisers have no one-tap event range. If they want it, create `settings/event` in the Firebase console as `{name, from, to}` with `from`/`to` as `YYYY-MM-DD` strings; the button appears on the next load with no deploy.

## Round P4 — Phase IV (Orders list and order detail), 2026-10-19

`npm test` against the emulator, both projects. **No application bug found.** Every Phase IV requirement in `CLAUDE.md` passed on the first full run except four cases that were wrong in the tests themselves; those are corrected below per `CLAUDE.md` → Workflow 3 (*"If a test is wrong against the brief, Morpheus fixes the test and notes it"*). No entry here needs anything from Neo.

### Tests corrected against the brief (no app change required)

| Test | Problem | Correction |
|---|---|---|
| `P4-09` (both projects) | Asserted the detail's item rows read quantity-first (`/2.{0,3}Fuchka/`). `CLAUDE.md` Phase IV 6 orders the table **icon, name, qty, price, line total**, which is what the app renders ("Fuchka / Gol Gappa 2 £5.00 £10.00"). The test, not the app, had the columns the wrong way round. | Tablet now reads `order-detail-items` structurally and asserts each row's name, qty, price and line total plus the Total row and the per-line icons; phone keeps a text check. |
| `P4-13` (phone) | Waited for the newly placed order on `[data-testid="orders-row-A-001"]`. `helpers.orderEntry` resolved its "row or card" choice **at call time**, before the live order existed, so on the phone it fell back to the tablet row id and could never match. | `orderEntry` now returns one locator over all four spellings, so it resolves whenever the element arrives. |
| `P4-17` (phone) | Opened an order, then clicked a status filter. On the phone the detail is full screen (`CLAUDE.md` Phase IV 7), so the filter row is correctly hidden; the test was driving a control the design deliberately removes from that view. | Returns to the list before using a filter. |
| `P4-U-07` CSV (unit) | Asserted the Orders export through `ordersToCsv` — the One day function, which the Export button never calls — and expected cancelled orders to be left out. `CLAUDE.md` Phase IV 8 exports "the orders currently shown", and Phase IV 5 shows cancelled orders; the settling case is filtering to Cancelled and exporting, where a header-only file would be plainly wrong. | Phase IV CSV cases now run through `exportOrdersCsv`, assert the cancelled row is exported with `cancelled` in the `status` column, assert the rows follow the list newest first, and keep one case on `ordersToCsv` asserting the One day and Sales by day exports still exclude cancelled, so the two functions cannot be collapsed back together. `P4-14` adds the same check on the real download. Recorded in `qa/test-plan.md` section 34.6. |

### Result after the corrections

Full suite green on both projects. Phase IV screenshots: `qa/screenshots/p4-{phone,tablet}-orders-{list,detail,empty}.png`, plus `{phone,tablet}-reports-orders-{empty,orders}.png` from the standard sweep.

### BUG-8 | minor | every screen's header and the login card | status: **verified** (live, round P4 live)

**Steps** Run `npm test`, or load any signed-in route and read the version pill (`qa/screenshots/p4-tablet-orders-list.png` shows it).
**Expected** `CLAUDE.md` Phase IV 10: *"`package.json` version 1.3.0; the version label shows v1.3.0 after deploy"*, with `package.json` the single source of truth (Phase III part 2, 1).
**Actual** `package.json` is still `1.2.0`, so `public/js/version.js` is generated as `APP_VERSION = "1.2.0"` and every header pill and the login version line read **v1.2.0** on a build that contains Phase IV.
**Screenshot** `qa/screenshots/p4-tablet-orders-list.png` (header, top left: `Reports v1.2.0`).
**Caught by** `P4-U-09` in `tests/unit/orders.test.js`, which fails until the bump. The `V-*` suite cannot catch this on its own: it reads the expected version out of `package.json`, so it agrees with whatever is there.
**Fix** One line: `version` to `1.3.0` in `package.json`. Trinity's `scripts/write-version.mjs` then stamps it into `version.js` on the next local run and in CI, and the live `V-c` check after deploy will read `v1.3.0`.
**Verified** `package.json` is on `1.3.0`, `P4-U-09` passes, and the deployed site renders `Version 1.3.0 · build 064f0a8 · updated 19 Oct 2026` on the login card and `v1.3.0` in all six signed-in headers on both viewports, read through the UI with the HTTP cache disabled (`P4L-01`, `P4L-03`, `P4L-10`).

### Open bugs

| Id | Severity | Screen | Status |
|---|---|---|---|
| BUG-8 | minor | version label, every screen | **verified** — bumped to 1.3.0 and confirmed live |

**Nothing is open against Phase IV: no blocker, no major, no minor.**

## Round P4 live — read-only check against the deployed site (19 Oct 2026)

`LIVE_P4=1 LIVE_BUILD=064f0a8 npx playwright test tests/e2e/live-p4.spec.js`, both viewports, against
`https://nottinghambengaliassociation.github.io/nba-food-stall-app/`.
**23 passed, 0 failed, 1 skipped** (`P4L-08` on phone: the CSV case is tablet-only by design). No bug found.

| Check | phone | tablet | Case |
|---|---|---|---|
| Login card reads `Version 1.3.0 · build 064f0a8 · updated 19 Oct 2026`, form not "not configured" | **PASS** | **PASS** | `P4L-01` |
| All six signed-in routes redirect to `#/login` when signed out; zero console errors | **PASS** | **PASS** | `P4L-01` |
| All seven routes load signed in, no "Storage not configured", pill reads `Online · synced`, **zero console errors** | **PASS** | **PASS** | `P4L-02` |
| `v1.3.0` pill in every dark header with matching `title`/`aria-label`, correct size, colour, border and placement | **PASS** | **PASS** | `P4L-03` |
| Orders tab on all three report screens; `One day \| By day \| Orders` on phone, `One day \| Sales by day \| Orders` on tablet; Orders filled ink and `aria-current="page"` | **PASS** | **PASS** | `P4L-04` |
| List renders the live order; summary `1 orders · £40.00` matches the live documents; every row field matches | **PASS** | **PASS** | `P4L-05` |
| Status filter in and out, payment filter (tablet), search by number and by name in both cases, empty message | **PASS** | **PASS** | `P4L-05` |
| Detail opens; number, name, status, till, payment, placed, wait, timeline, all eight item lines with icons, total | **PASS** | **PASS** | `P4L-06` |
| Phone: full-screen detail, "All orders" button **and** the browser Back button both return to the list | **PASS** | n/a | `P4L-06` |
| Tablet: detail beside the list, read-only note verbatim | n/a | **PASS** | `P4L-06` |
| `#/reports/orders?day=2026-10-19` and `?day=2020-01-01` each open their own day | **PASS** | **PASS** | `P4L-07` |
| CSV downloaded and **read**: `nba-food-stall_orders_2026-10-19.csv`, 13 One day columns, 8 data rows, `lineTotal = qty × price`, line totals add up to the stored £40.00, no `tendered` | skipped | **PASS** | `P4L-08` |
| Axe: zero serious or critical, list and detail | **PASS** | **PASS** | `P4L-09` |
| Sign out from `#/reports/orders` returns to `#/login` and clears the session | **PASS** | **PASS** | `P4L-10` |
| **Nothing written to live Firestore** | **PASS** | **PASS** | `P4L-11` |

### Live data seen

`orders` holds **one document**, unchanged from the H2 and P3 live checks: `A-001`, `collected`, day `2026-10-19`, total £40.00, eight lines of one each at £5. It is the leftover QA smoke order and was left exactly where it is — it is item 1 of "Needs you" above.
`menu` holds its ten documents (`chat, choc_strawberry, fountain, fuchka, marshmallow, momo, samosa, samosa_only, straw, sweet_box`).

### Write discipline

Every Firestore call in `tests/e2e/live-p4.spec.js` is a GET over the REST API. The Orders screen is itself read-only, so this round had even less to guard than P3: no till tile was tapped, `send-order` was never clicked, no status was changed, nothing was cancelled, no menu or settings document was touched. Exporting the CSV is a download of data already fetched. `P4L-00` and `P4L-11` bracket the run: after the check the orders collection is the same length with a byte-identical fingerprint (document id, orderNo, status, total, day and every line's `id|name|qty|price`), and the menu holds the same ten ids.

Credentials were read at run time from the gitignored `.secrets/app-login.env`. The Show/Hide toggle was never pressed, so the password is masked in every capture; no screenshot, log line or entry in `qa/live-smoke-record.txt` contains the username, the password or the web API key.

### Observation (not a bug)

The phone header carries the "Export these orders (CSV)" button, although `design/ReportsOrdersMobile.dc.html` shows no export control at that width. It is additive and takes nothing away from the brief (`CLAUDE.md` Phase IV 8 does not forbid it), so no bug is raised; the CSV case stays tablet-only, which is the conservative reading. If the export is meant to be available on the phone, the mobile mock-up should be updated to say so and `P4-14`/`P4L-08` can drop their skip.

### Screenshots

`qa/screenshots/live-p4-<project>-<screen>.png` for `project` ∈ {phone, tablet}:
`login-version`, `landing`, `cash`, `kitchen`, `reports`, `reports-days`, `reports-orders`, `reports-orders-detail`, `header-version`, `signed-out` — 20 files.

---

## Hotfix H3 round 1 — 2026-10-19 (v1.3.1, phone cash counter + seven-item menu)

**Result: green. No bugs raised.**

| Suite | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Unit (`vitest`, 11 files) | 307 | **307** | 0 | 0 |
| e2e `phone` (390×844) | 213 | 213 | 0 | — |
| e2e `tablet` (1280×800) | 213 | 213 | 0 | — |
| e2e `iphone13` (390×664) | 25 | 25 | 0 | — |
| e2e `iphone17` (402×694) | 25 | 25 | 0 | — |
| e2e `promax` (430×752) | 25 | 25 | 0 | — |
| **e2e total** | **501** | **387** | **0** | **114** |

The 114 skips are the gated live checks (`live-smoke`, `live-h1`, `live-h2`,
`live-p3`, `live-p4` — they need `LIVE_*=1`), the tablet-only block of
`cash-h3.spec.js` on the four small projects, the small-screen block on
`tablet`, and the tablet-only Clear-link case `T-08`. Run time 18.4 min
(`npm run test:e2e`, Firestore emulator, one worker).

### Test-side corrections made this round (deliberate spec change, not defects)

Hotfix H3 replaces the cash counter below 700 px and cuts the menu to seven
items, so tests written against the old layout were testing a screen the brief
no longer describes. Each of these was corrected against `CLAUDE.md`, not
against the implementation:

| Test | What changed | Brief |
|---|---|---|
| `C-01`, `C-02`, `H-07`, `H-08`, `X-06`, `H-21`, unit `H-01`..`H-06` | seven menu items, `fountain`/`samosa`/`straw` deleted, `marshmallow` renamed | Menu table; H3 7 |
| `C-04`, `C-05`, `C-07`, `C-09`, `C-16`, `T-01`..`T-13`, `H-21`, `H-17`, `X-09`, `G-15`..`G-17` | reach the order controls through the order bar and the Review & send sheet below 700 px | H3 3, 4 |
| `C-08` | "disabled when empty" below 700 px is "the order bar, and with it Send, is hidden when empty" | H3 3 |
| `C-05`, `H-21`, `H-17` | steppers 52 px on tablet, **48 px** in the sheet; Send 72 px on tablet, **60 px** in the sheet | Cash 2 / 4 vs H3 4 |
| `C-10`, `C-11`, `C-12`, `K-09`, `P-01` | recent orders read from ☰ → Recent orders below 700 px | H3 6 |
| `C-13` | the connection label is the short "Online" in the one-row phone header | H3 1 |
| `G-13`, `G-15`..`G-18` | Sign out is in the ☰ menu on the small cash counter, still red, still showing the in-page confirm | H3 1, Login 8 |
| `V-03`, `V-05` | the version line is read inside the ☰ menu on the small cash counter (it still carries `app-version`) | H3 1, Phase III part 2 6 |
| `X-05` | 3-column tiles below 700 px, not 2 | H3 2 |
| `X-02` | ☰ is allowed 44 px and the header till picker 40 px, in the small cash header only | H3 1 + `design/CashCounterSmall.dc.html` |
| `L-02` | `#/cash` is "loaded" when the tiles are up, not when Send is | H3 3 |
| `C-01`, `H-08` | the small tile shows icon + `short` name (no £5); the tablet tile keeps the full name and the price | H3 2 vs Cash 1 |
| `P3-08`, unit `P3-U-12` | rows for ids the menu no longer knows sort after the known ones, in an order the brief never fixes, so they are read as a set | H3 7 |
| `C-15` (new), `H-11`, `H-16`, unit `H-05b` | the unknown-id fallback is now driven by the deleted ids: stored line name plus the plate icon, no station | Menu ("Any item id the app doesn't know…") |
| unit `P4-U-09` | `package.json` is 1.3.1 | H3 8 |

### Harness changes

* `clearFirestore()` now deletes, re-reads and only returns after the `orders`
  collection comes back empty **twice**. A context that was still closing could
  flush a queued write just after the DELETE landed, leaving a stale order that
  made the next test read two documents with the same order number (seen as
  `strict mode violation: recent-A-001 resolved to 2 elements` and as a cancel
  assertion reading the wrong one of two `A-006`s). Those were harness races,
  not app defects: the UI showed the right thing in both screenshots.
* Three tests were re-run in isolation after failing in a run where the shared
  Firestore emulator was killed mid-suite by another agent on this machine
  (`H3-a8`, `H3-d1`, `H3-g`); all three pass against a clean emulator, and all
  pass in the final full run above.

### `scripts/reset-live.mjs` (H3-l), emulator only

Exercised by hand against the Firestore emulator with 2 orders, a menu holding
`fountain`/`samosa`/`straw` and a hand-edited `fuchka` price, and a
`settings/event` document. All five cases in `qa/test-plan.md` section 41 pass:
plan-only changes nothing and writes no backup; `--yes` backs up first, empties
`orders`, leaves exactly the 7 menu documents with the right fields (including
the `marshmallow` rename and the price put back to 500), deletes
`fountain`/`samosa`/`straw` and leaves `settings` alone; a second run is
harmless; an unwritable backup directory stops the run before any delete with
the seeded order still in place. Nothing was run against live Firestore.

### Observations, no bug raised

1. The ☰ version line carries both `app-version` (the id named in
   `CLAUDE.md` Phase III part 2, 6) and `menu-version`. The documented id is
   present, so the label is still findable on the small cash counter.
2. `review-sheet` exists at 700 px and wider as a `display: contents` wrapper
   that measures 0×0. It is never visible there, which is what `H3-h` asserts;
   tests should not measure it on tablet.
3. The sign-out confirm answers to `signout-confirm` / `signout-confirm-ok` /
   `signout-cancel`; `cash-h3.spec.js` resolves the box and its two buttons by
   role, so either spelling works.

---

## Hotfix H3 live check — 2026-10-19, build `9be6abd` (read-only)

`LIVE_H3=1 npx playwright test tests/e2e/live-h3.spec.js --project=iphone13 --project=iphone17`
against `https://nottinghambengaliassociation.github.io/nba-food-stall-app/`.

**Result: 22/22 pass at both viewports. No bugs raised. Nothing written.**

| Check | iphone13 390×664 | iphone17 402×694 | Observed |
|---|---|---|---|
| Sign in, all six routes, no console errors, pill Online | **PASS** | **PASS** | 0 console errors; pill "Online · synced" everywhere, short "Online" on the small cash header (H3 1) |
| 7 tiles, 3 columns, all visible without scrolling the menu area | **PASS** | **PASS** | `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow`; 3 left edges; menu area `scrollHeight == clientHeight` |
| Seventh tile: "Choc Marshmallow" / "Chocolate Marshmallow (V)" | **PASS** | **PASS** | visible text "Choc Marshmallow", accessible name "Add Chocolate Marshmallow (V)" |
| No Chocolate Fountain / Sweets Box / Chocolate Strawberry & Marshmallow anywhere | **PASS** | **PASS** | no such tile and no such wording in the page text |
| 0 orders: One day KPIs | **PASS** | **PASS** | sales £0.00, orders 0, items 0, avg order £0.00, avg wait — |
| 0 orders: Sales by day | **PASS** | **PASS** | 2026-10-13..2026-10-19 → "No sales in this range"; "This event" present but hidden (no `settings/event`) |
| 0 orders: Orders screen | **PASS** | **PASS** | "No orders match these filters.", summary `0 orders · £0.00` |
| Version: `v1.3.1` in headers, login card line | **PASS** | **PASS** | `Version 1.3.1 · build 9be6abd · updated 19 Oct 2026`; build is the clean 7-character form, no `-dirty`; `title`/`aria-label` match |
| H3 layout read-only: header, ☰, order bar, sheet | **PASS** | **PASS** | header one row 52 px, nothing wrapped; ☰ opens/closes with `aria-expanded`; bar "3 items · £15.00 Review & send" at 60 px; sheet `role="dialog"` top 40 px, lines aligned, steppers 48×48; Cash received "Change £5.00" with the Other amount link; closed on Add more, Escape and Back |
| CSV export (read path) | **PASS** | **PASS** | `orders-2026-10-19.csv`, 13 Phase I columns, 0 data rows, no `tendered` |
| **Nothing written** | **PASS** | **PASS** | `orders` 0 before and 0 after with an identical fingerprint; `menu` the same seven ids |

### Live data seen

`orders` **0 documents**. `menu` **7 documents** — `chat, choc_strawberry,
fuchka, marshmallow, momo, samosa_only, sweet_box` — each £5 and active, with
`marshmallow` reading "Chocolate Marshmallow (V)" / "Choc Marshmallow".
`settings` **0 documents**, so "This event" stays hidden. This matches Trinity's
report of the reset exactly.

### Write discipline

Every Firestore call in `tests/e2e/live-h3.spec.js` is a GET over the REST API.
`send-order` was never clicked, no status was changed, nothing was cancelled,
and no menu or settings document was touched. Three tiles were tapped to raise
the order bar and open the review sheet — in-page cart state that reaches
Firestore only through Send — and the cart was stepped back to empty before
leaving the screen (`H3L-05` asserts the order bar is hidden again). `H3L-00`
and `H3L-10` bracket the run: `orders` is 0 documents before and after with a
byte-identical fingerprint. Credentials were read at run time from the
gitignored `.secrets/app-login.env`; the Show/Hide toggle was never pressed, so
the password is masked in every capture, and no screenshot, log line or entry
in `qa/live-smoke-record.txt` contains the username, the password or the web
API key.

### Observations, no bug raised

1. The One day export is named `orders-<day>.csv`. `CLAUDE.md` Reports 6 does
   not specify a file name for that screen (only Phase III 9 and Phase IV 8 do,
   for their own exports), so this is not a defect.
2. The cart line in the small review sheet shows the `short` name
   ("Choc Marshmallow"), matching `design/CashCounterSmallOpen.dc.html`. The
   full name "Chocolate Marshmallow (V)" is the tile's accessible name and is
   what a saved order line, the reports and the CSV carry.

### Screenshots

`qa/screenshots/live-h3-<project>-<screen>.png` for `project` ∈ {iphone13, iphone17}:
`login`, `cash-empty`, `cash-bar`, `cash-sheet`, `reports-zero`,
`reports-days-zero`, `reports-orders-zero` — 14 files.

---

## Hotfix H4 round 1 — 2026-10-19 (v1.3.2, Card is the default payment)

Spec: `CLAUDE.md` → "Hotfix H4: Card is the default payment (v1.3.2)".
Tests: `tests/e2e/cash-h4.spec.js` (new, plan section 43) on `tablet`, `phone`
and `iphone13`; `tests/unit/orders.test.js` `P4-U-09` for the version.

### Totals

| Suite | Result |
|---|---|
| unit (`npx vitest run`) | **306 pass, 1 fail** of 307 — the failure is BUG-9 below |
| e2e (`npm run test:e2e`, 5 projects) | **408 pass, 0 fail, 0 flaky**, 172 skipped by design (gated live suites, and the layout-specific skips) |
| of which H4 | **21 pass, 0 fail**, 3 skipped by design (H4-04 below 700 px, H4-06 on tablet) |

Every H4 behaviour in the brief passes on all three layouts: Card selected on
first load, after Send, after Clear order and when the cart empties; Cash
reveals the calculator; Card hides **and resets** it; an order sent without
touching either button is written `payment: "card"`; cash orders are still
written `payment: "cash"` with no `tendered` field.

### BUG-9 | minor | every screen's header and the login card | status: **verified**

**Steps** `npx vitest run`, or load any signed-in route and read the version pill.
**Expected** `CLAUDE.md` → Hotfix H4 4: *"`package.json` version 1.3.2"*, and the
version table lists **1.3.2** as "Hotfix H4: Card is the default payment".
`package.json` is the single source of truth (Phase III part 2, 1), so the
header pill and the login version line follow it.
**Actual** `package.json` is still `1.3.1`, so `public/js/version.js` is stamped
`APP_VERSION = "1.3.1"` and every header pill and the login card read **v1.3.1**
on a build that contains H4.
**Screenshot** `qa/screenshots/iphone13-cash-sheet-card-default.png` (☰ menu
version line is generated from the same value; the pill is in every
`*-cash-*.png` from this round).
**Caught by** `P4-U-09` in `tests/unit/orders.test.js`. The `V-*` suite cannot
catch it: it reads the expected version out of `package.json`, so it agrees
with whatever is there.
**Fix** One line: `version` to `1.3.2` in `package.json`.

### Test changes made for H4 (no assertion weakened)

The Card default changes the till's **starting** state, so tests that used to
land on the cash path for free now ask for it. Full table in
`qa/test-plan.md` section 44. In short:

| File | Change | Why |
|---|---|---|
| `tests/e2e/helpers.js` | new `selectPayment()` / `cashReceivedVisible()`; `placeOrder()` picks the payment through `selectPayment` | one place says "mean cash"; `selectPayment` only taps an unpressed button (so it never trips "tapping a selected button deselects it") and asserts the button ends up pressed |
| `tests/e2e/tender.spec.js` | `cashWithOrder()` plus T-09 (b)(c)(d), T-10 (b)(c), T-11 choose the payment explicitly | those legs re-open Cash received on a **new** order, which H4 1 now starts on Card |
| `tests/e2e/cash-h3.spec.js` | H3-e now asserts the sheet opens with Cash received hidden, then taps Cash; H3-f taps Cash before keying £20 | same reason in the H3 sheet; H3-e gained an assertion rather than losing one |
| `tests/unit/orders.test.js` | `P4-U-09` expects `1.3.2` | CLAUDE.md H4 4 — this is BUG-9 |
| `playwright.config.js` | `iphone13` also matches `cash-h4.spec.js` | H4 1 "on every layout" |

### Noted, not a bug

1. **No Clear order control below 700 px.** H4 1 lists "after Clear order"
   among the resets, but `CLAUDE.md` H3 4 gives the Review & send sheet an
   Add more header, a scrolling body and a pinned Send footer only — the
   `clear-order` button is rendered but kept hidden there. H4-04 is therefore
   a tablet case and H4-05 (the cart emptied with the − stepper) covers the
   same reset on the phone.
2. **The Cash received block stays in the DOM when Card is selected**, with
   `hidden` set. The brief says Card "hides" it, not that it is removed, so
   H4-01 asserts it is not visible and that "Cash received" is absent from the
   page's `innerText`.
3. **Emulator contention.** The first H4 run overlapped another agent's
   `firebase emulators:exec` on port 8080; its `clearFirestore` deleted orders
   under this run and produced two phantom failures. Re-run alone: green. Only
   one emulator run at a time on this machine.

### Open bugs after this round

| Id | Severity | Screen | Status |
|---|---|---|---|
| BUG-9 | minor | version label (package.json) | **verified** (round 2 below) |

---

## Hotfix H4 round 2 — 2026-10-19 (full clean run on v1.3.2)

Trinity set `package.json` to `1.3.2` and regenerated `public/js/version.js`
(`APP_VERSION 1.3.2`, `APP_BUILD 5c863a0-dirty`). Full `npm test` re-run with
the emulator to this run alone (port 8080 confirmed free before starting; a
stale `http-server` on 5173 from the previous round was stopped so Playwright
started its own `webServer`).

### Totals

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (`npx vitest run`, 11 files) | **307** | **0** | 0 |
| e2e (`npm run test:e2e`, 5 projects) | **408** | **0** | 172 (by design) |
| — `phone` | 175 | 0 | 57 |
| — `tablet` | 154 | 0 | 78 |
| — `iphone13` | 31 | 0 | 13 |
| — `iphone17` | 24 | 0 | 12 |
| — `promax` | 24 | 0 | 12 |
| of which H4 (`cash-h4.spec.js`) | **21** | **0** | 3 (by design) |

e2e duration **19.6 min**, 0 flaky, no retries consumed. The 172 skips are the
gated live suites (`live-*.spec.js`, which need `LIVE_*=1`) plus the
layout-specific skips already documented in round 1. All five Playwright
projects ran as configured, and `cash-h4.spec.js` ran on `tablet`, `phone` and
`iphone13` (8 cases each; H4-04 skips below 700 px and H4-06 skips on tablet,
as recorded in round 1 "Noted, not a bug" 1).

### BUG-9 — closed

**Status: verified.** `package.json` reads `1.3.2`; `P4-U-09` in
`tests/unit/orders.test.js` passes, and the `V-*` version suite passes on both
projects, so the header pill and the login card now read **v1.3.2** on a build
that contains H4. No other bug was reopened and no new bug was found.

### Test fixed this round (not an app bug)

`tests/e2e/live-h3.spec.js` carried a hardcoded `1.3.1`, which the version bump
turned into an unsatisfiable test — two contradictory assertions on the same
value:

```js
expect(version, 'package.json is the single source of truth').toBe(PKG_VERSION);  // 1.3.2
expect(version, 'CLAUDE.md H3 8: package.json version 1.3.1').toBe('1.3.1');      // 1.3.1
```

`CLAUDE.md` → Phase III part 2, 1 makes `package.json` the single source of
truth and says every hotfix bumps the patch number, so the literal is the wrong
half. The H3 live suite is gated (skipped in this emulator run), so it did not
fail here — it would have failed on the next live check once v1.3.2 deploys.

Fixed to test the brief rather than a frozen number: the exact value comes from
`PKG_VERSION`, plus a floor assertion `atLeast(version, '1.3.1')` that still
proves the deployed build is the H3 release or later. Three places changed —
the login-card assertion (line ~199), the ☰ menu version line (`.toContain('v'
+ PKG_VERSION)`), and the H3L-03 record string. The stale test title "shows
Version 1.3.1" became "shows the package.json version". No assertion was
weakened or removed. `live-p4.spec.js` was checked for the same problem: it
already asserts `'v' + PKG_VERSION`, only its message string names v1.3.0, so
it was left alone.

### Open bugs after this round

**None.** All bugs BUG-1 … BUG-9 are fixed and verified.
